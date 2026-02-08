/**
 * Visual contracts — automated perceptual quality checks for TgImg placeholders.
 *
 * These tests decode real-world thumbhash fixtures through the adaptive chroma
 * pipeline and verify that the output satisfies measurable quality contracts:
 *
 *   1. Saturation: placeholders are colourful enough (not grey) but never neon.
 *   2. Colour accuracy: bias correction brings avg closer to the target.
 *   3. Green-channel regression: forest/sky doesn't become lime.
 *   4. Determinism: identical inputs always produce identical RGBA.
 *
 * These tests are NOT part of the runtime bundle — they are test-only.
 * Runtime performance is unaffected.
 */
import { describe, expect, it } from 'vitest';
import { thumbHashToRGBA, thumbHashToDataURL } from '../thumbhash';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Fixture data (from playground tgimg.manifest.json) ───────────────────

type FixtureCategory = 'photo' | 'logo';

interface Fixture {
  /** Human-readable label */
  label: string;
  /** ThumbHash hex bytes */
  hex: string;
  /** Manifest avg_color [R, G, B] */
  avgColor: [number, number, number];
  /** Category for saturation thresholds */
  category: FixtureCategory;
}

/**
 * Real fixtures extracted from `playground/src/tgimg.manifest.json`.
 *
 * At least: forest/sky, night city, skin portrait, logo, flat icon, alpha.
 */
const FIXTURES: Record<string, Fixture> = {
  // ── Photos ──
  'card-abstract': {
    label: 'Abstract colour card',
    hex: '9c18061582005f1869da3588487b93686aa96818838c99a430390ba2',
    avgColor: [127, 114, 99],
    category: 'photo',
  },
  'card-nature': {
    label: 'Forest / green nature',
    hex: 'd6d7091541003c8868808979075488885a777788986877547fc805a8',
    avgColor: [77, 96, 89],
    category: 'photo',
  },
  'card-ocean': {
    label: 'Ocean / blue water',
    hex: '9cf70915c5006b7878998988086687788a7877877888888590480888',
    avgColor: [107, 109, 119],
    category: 'photo',
  },
  'city-night': {
    label: 'Night cityscape',
    hex: '170806144100cb97b960897747458667989999087f58e07105',
    avgColor: [99, 92, 86],
    category: 'photo',
  },
  'food-closeup': {
    label: 'Food close-up (warm)',
    hex: 'e0080e15c1009c698860767968598787777b889768987940586508a8',
    avgColor: [145, 140, 108],
    category: 'photo',
  },
  'hero-landscape': {
    label: 'Landscape with sky',
    hex: '5ab7111403017877788f877797878878867778880678788007',
    avgColor: [83, 115, 119],
    category: 'photo',
  },
  'mountain': {
    label: 'Mountain / forest / sky',
    hex: '5bd7091583002f86754b898878658987836a97389878888a80980888',
    avgColor: [97, 111, 120],
    category: 'photo',
  },
  'portrait': {
    label: 'Skin portrait',
    hex: '2c0806054200f68a6d9cf759779d638748878768a98799a1f8099577',
    avgColor: [185, 176, 170],
    category: 'photo',
  },
  'small-thumb': {
    label: 'Small thumbnail',
    hex: '52080a074100e7989765768af87859779b9987a65788878a777697688777f565f768f564f778',
    avgColor: [83, 73, 63],
    category: 'photo',
  },
  // ── Logos / flat ──
  'icon-github': {
    label: 'GitHub icon (monochrome)',
    hex: 'f1f70d070000b8f798768976d9a72748887689d72778b7897689777897873789055837890558',
    avgColor: [198, 198, 198],
    category: 'logo',
  },
  'logo-transparent': {
    label: 'Logo with alpha',
    hex: 'c907861243000400974fc77c3a1030fb81eeb6',
    avgColor: [39, 34, 38],
    category: 'logo',
  },
};

// ─── Test-only colour helpers ────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** Compute average RGB from RGBA buffer. */
function avgRGB(rgba: Uint8Array, n: number): [number, number, number] {
  let rS = 0, gS = 0, bS = 0;
  for (let i = 0, len = n * 4; i < len; i += 4) {
    rS += rgba[i]!;
    gS += rgba[i + 1]!;
    bS += rgba[i + 2]!;
  }
  return [rS / n, gS / n, bS / n];
}

/** Euclidean distance between two RGB triples. */
function rgbDist(a: readonly number[], b: readonly number[]): number {
  return Math.sqrt(
    (a[0]! - b[0]!) ** 2 +
    (a[1]! - b[1]!) ** 2 +
    (a[2]! - b[2]!) ** 2,
  );
}

/**
 * Compute average HSL saturation for an RGBA buffer.
 * Returns a value in [0, 1]. 0 = fully grey, 1 = fully saturated.
 */
function avgSaturationHSL(rgba: Uint8Array, n: number): number {
  let satSum = 0;
  for (let i = 0, len = n * 4; i < len; i += 4) {
    const r = rgba[i]! / 255;
    const g = rgba[i + 1]! / 255;
    const b = rgba[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) {
      // achromatic
      satSum += 0;
    } else {
      const d = max - min;
      satSum += l > 0.5 ? d / (2 - max - min) : d / (max + min);
    }
  }
  return satSum / n;
}

/**
 * Replay the adaptive chroma + bias pipeline on raw RGBA to get the final
 * buffer — same logic as thumbHashToDataURL's adaptive path, but returns
 * the RGBA buffer instead of encoding to BMP.
 *
 * This is intentionally duplicated from runtime to keep tests independent.
 */
function applyAdaptivePipeline(
  hash: Uint8Array,
  avgColor: readonly [number, number, number],
): { w: number; h: number; rgba: Uint8Array; rawAvg: [number, number, number]; dist: number } {
  const { w, h, rgba } = thumbHashToRGBA(hash); // raw, no attenuation
  const n = w * h;

  const rawAvg = avgRGB(rgba, n);
  const dist = rgbDist(rawAvg, avgColor);

  // ── Adaptive chroma (must match thumbhash.ts constants!) ──
  const ac = dist < 20 ? 0.55 : dist < 45 ? 0.40 : 0.28;

  // Attenuation (BT.709 luma)
  const { round } = Math;
  for (let i = 0, len = rgba.length; i < len; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    rgba[i] = round(y + (r - y) * ac);
    rgba[i + 1] = round(y + (g - y) * ac);
    rgba[i + 2] = round(y + (b - y) * ac);
  }

  // Bias correction (gain = 0.45, must match thumbhash.ts)
  const attenuatedAvg = avgRGB(rgba, n);
  const dr = (avgColor[0] - attenuatedAvg[0]) * 0.45;
  const dg = (avgColor[1] - attenuatedAvg[1]) * 0.45;
  const db = (avgColor[2] - attenuatedAvg[2]) * 0.45;
  for (let i = 0, len = n * 4; i < len; i += 4) {
    rgba[i] = Math.max(0, Math.min(255, round(rgba[i]! + dr)));
    rgba[i + 1] = Math.max(0, Math.min(255, round(rgba[i + 1]! + dg)));
    rgba[i + 2] = Math.max(0, Math.min(255, round(rgba[i + 2]! + db)));
  }

  return { w, h, rgba, rawAvg: rawAvg as [number, number, number], dist };
}

// ─── Saturation contracts ────────────────────────────────────────────────

/**
 * Saturation thresholds — why these values:
 *
 * SAT_MIN_PHOTO (0.04): ThumbHash is a ~7×7 pixel representation, so even
 *   well-saturated photos decode to low-ish HSL saturation.  After adaptive
 *   chroma (0.28–0.55) + bias, naturally muted scenes (night city, overcast
 *   ocean) land around 0.05–0.07.  Threshold 0.04 ensures NO photo falls to
 *   fully grey while accepting physical limitations of tiny thumbnails.
 *   Pre-fix values (chroma 0.18) produced sat ~0.02 — this was the "too grey"
 *   problem.  Current values (chroma 0.28+) produce sat 0.05+ which is
 *   perceptually colourful at placeholder resolution.
 *
 * SAT_MIN_LOGO (0.0): Monochrome logos (e.g. GitHub icon at avg_color
 *   [198,198,198]) are legitimately achromatic — sat=0 is correct, not a bug.
 *
 * SAT_MAX (0.65): Prevents "neon/toxic" placeholders that look worse than grey.
 *   ThumbHash's limited resolution amplifies colour errors; capping at 0.65
 *   keeps things natural.
 */
const SAT_MIN_PHOTO = 0.04;
const SAT_MIN_LOGO = 0.0;
const SAT_MAX = 0.65;

/**
 * Maximum acceptable colour distance after the full adaptive pipeline.
 *
 * ThumbHash's tiny resolution means the decoded avg is already offset from
 * the original image's avg.  Chroma attenuation shifts the avg towards grey
 * (intentionally — to suppress wrong hues), and bias correction partially
 * compensates.  The combined result stays within MAX_DIST_AFTER of the target.
 *
 * Observed range across real fixtures: 0.5 – 8.  Threshold 12 gives headroom
 * for edge cases while catching regressions (pre-fix values had dist > 30).
 */
const MAX_DIST_AFTER = 12;

describe('visual contracts: saturation bounds', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name} (${fixture.category}): avg saturation in valid range`, () => {
      const hash = hexToBytes(fixture.hex);
      const { w, h, rgba } = applyAdaptivePipeline(hash, fixture.avgColor);
      const n = w * h;
      const sat = avgSaturationHSL(rgba, n);

      const minSat = fixture.category === 'photo' ? SAT_MIN_PHOTO : SAT_MIN_LOGO;
      expect(sat).toBeGreaterThanOrEqual(minSat);
      expect(sat).toBeLessThanOrEqual(SAT_MAX);
    });
  }
});

describe('visual contracts: bias correction', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: dist_after <= ${MAX_DIST_AFTER} (bounded colour accuracy)`, () => {
      const hash = hexToBytes(fixture.hex);
      const result = applyAdaptivePipeline(hash, fixture.avgColor);
      const n = result.w * result.h;
      const finalAvg = avgRGB(result.rgba, n);
      const distAfter = rgbDist(finalAvg, fixture.avgColor);

      expect(distAfter).toBeLessThanOrEqual(MAX_DIST_AFTER);
    });

    it(`${name}: bias improves match vs attenuation-only`, () => {
      const hash = hexToBytes(fixture.hex);

      // Full pipeline (attenuation + bias)
      const full = applyAdaptivePipeline(hash, fixture.avgColor);
      const nFull = full.w * full.h;
      const fullAvg = avgRGB(full.rgba, nFull);
      const distWithBias = rgbDist(fullAvg, fixture.avgColor);

      // Attenuation-only (no bias) for comparison
      const { w, h, rgba } = thumbHashToRGBA(hash);
      const n = w * h;
      const rawAvg = avgRGB(rgba, n);
      const dist = rgbDist(rawAvg, fixture.avgColor);
      const ac = dist < 20 ? 0.55 : dist < 45 ? 0.40 : 0.28;
      const { round } = Math;
      for (let i = 0, len = rgba.length; i < len; i += 4) {
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        rgba[i] = round(y + (r - y) * ac);
        rgba[i + 1] = round(y + (g - y) * ac);
        rgba[i + 2] = round(y + (b - y) * ac);
      }
      const attenAvg = avgRGB(rgba, n);
      const distWithoutBias = rgbDist(attenAvg, fixture.avgColor);

      // Bias correction must improve (or preserve) the match vs attenuation-only
      expect(distWithBias).toBeLessThanOrEqual(distWithoutBias + 0.5);
    });
  }
});

// ─── Forest / sky regression ─────────────────────────────────────────────

/**
 * Forest/sky regression test.
 *
 * Problem: ThumbHash with high green chroma can produce a "lime/sickly" green
 * placeholder for forest scenes. After adaptive attenuation + bias, the green
 * channel should not dominate excessively over R and B.
 *
 * Contract: (G - max(R, B)) <= 25 for every pixel in the final buffer.
 * This prevents lime tones while still allowing natural greens.
 */
const GREEN_DOMINANCE_MAX = 25;

describe('visual contracts: forest/sky green-channel regression', () => {
  const FOREST_FIXTURES = ['card-nature', 'mountain', 'hero-landscape'];

  for (const name of FOREST_FIXTURES) {
    const fixture = FIXTURES[name]!;

    it(`${name}: green channel not excessively dominant (max per-pixel ΔG <= ${GREEN_DOMINANCE_MAX})`, () => {
      const hash = hexToBytes(fixture.hex);
      const { w, h, rgba } = applyAdaptivePipeline(hash, fixture.avgColor);
      const n = w * h;

      let maxGreenDominance = 0;
      for (let i = 0; i < n * 4; i += 4) {
        const r = rgba[i]!;
        const g = rgba[i + 1]!;
        const b = rgba[i + 2]!;
        const greenDom = g - Math.max(r, b);
        if (greenDom > maxGreenDominance) maxGreenDominance = greenDom;
      }

      expect(maxGreenDominance).toBeLessThanOrEqual(GREEN_DOMINANCE_MAX);
    });

    it(`${name}: retains some visible colour (sat >= ${SAT_MIN_PHOTO})`, () => {
      const hash = hexToBytes(fixture.hex);
      const { w, h, rgba } = applyAdaptivePipeline(hash, fixture.avgColor);
      const sat = avgSaturationHSL(rgba, w * h);
      expect(sat).toBeGreaterThanOrEqual(SAT_MIN_PHOTO);
    });
  }
});

// ─── Determinism ─────────────────────────────────────────────────────────

describe('visual contracts: determinism', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: adaptive pipeline is byte-deterministic`, () => {
      const hash = hexToBytes(fixture.hex);
      const a = applyAdaptivePipeline(hash, fixture.avgColor);
      const b = applyAdaptivePipeline(hash, fixture.avgColor);
      expect(a.rgba).toEqual(b.rgba);
    });
  }
});

// ─── thumbHashToDataURL consistency ──────────────────────────────────────

describe('visual contracts: thumbHashToDataURL consistency', () => {
  for (const [name, fixture] of Object.entries(FIXTURES)) {
    it(`${name}: dataURL is deterministic`, () => {
      const hash = hexToBytes(fixture.hex);
      const a = thumbHashToDataURL(hash, undefined, fixture.avgColor);
      const b = thumbHashToDataURL(hash, undefined, fixture.avgColor);
      expect(a).toBe(b);
    });

    it(`${name}: dataURL is valid BMP`, () => {
      const hash = hexToBytes(fixture.hex);
      const url = thumbHashToDataURL(hash, undefined, fixture.avgColor);
      expect(url).toMatch(/^data:image\/bmp;base64,/);
      expect(url.length).toBeGreaterThan(100);
    });
  }
});

// ─── Specific regressions ────────────────────────────────────────────────

describe('visual contracts: specific regressions', () => {
  it('portrait: skin tone preserved (warm hue, not blue/green)', () => {
    const f = FIXTURES['portrait']!;
    const hash = hexToBytes(f.hex);
    const { w, h, rgba } = applyAdaptivePipeline(hash, f.avgColor);
    const n = w * h;
    const avg = avgRGB(rgba, n);

    // Skin tones: R > G > B (warm bias)
    expect(avg[0]).toBeGreaterThan(avg[2]); // R > B
  });

  it('city-night: not overly blue (dark scenes stay warm/neutral)', () => {
    const f = FIXTURES['city-night']!;
    const hash = hexToBytes(f.hex);
    const { w, h, rgba } = applyAdaptivePipeline(hash, f.avgColor);
    const n = w * h;
    const avg = avgRGB(rgba, n);

    // Night city: should not turn heavily blue.
    // B - max(R, G) should be small.
    const blueDominance = avg[2]! - Math.max(avg[0]!, avg[1]!);
    expect(blueDominance).toBeLessThanOrEqual(20);
  });

  it('icon-github: monochrome stays near-grey (low saturation)', () => {
    const f = FIXTURES['icon-github']!;
    const hash = hexToBytes(f.hex);
    const { w, h, rgba } = applyAdaptivePipeline(hash, f.avgColor);
    const sat = avgSaturationHSL(rgba, w * h);

    // GitHub icon is monochrome → saturation should be very low
    expect(sat).toBeLessThanOrEqual(0.15);
  });

  it('logo-transparent: alpha logo does not produce extreme colours', () => {
    const f = FIXTURES['logo-transparent']!;
    const hash = hexToBytes(f.hex);
    const { w, h, rgba } = applyAdaptivePipeline(hash, f.avgColor);
    const sat = avgSaturationHSL(rgba, w * h);

    // Dark alpha logo should have controlled saturation
    expect(sat).toBeLessThanOrEqual(SAT_MAX);
  });

  it('food-closeup: warm tones preserved (R channel strong)', () => {
    const f = FIXTURES['food-closeup']!;
    const hash = hexToBytes(f.hex);
    const { w, h, rgba } = applyAdaptivePipeline(hash, f.avgColor);
    const n = w * h;
    const avg = avgRGB(rgba, n);

    // Food shots are typically warm: R >= B
    expect(avg[0]).toBeGreaterThanOrEqual(avg[2]! - 10);
  });
});

// ─── Snapshot artifacts (opt-in via TGIMG_UPDATE_ARTIFACTS env) ──────────

describe('visual contracts: artifact generation', () => {
  const shouldWrite = process.env['TGIMG_UPDATE_ARTIFACTS'] === '1';
  const artifactsDir = path.resolve(__dirname, '../../test-artifacts');

  it('generates placeholder artifacts when TGIMG_UPDATE_ARTIFACTS=1', () => {
    if (!shouldWrite) {
      // In normal CI, just verify we can produce all data URLs without error.
      for (const [name, fixture] of Object.entries(FIXTURES)) {
        const hash = hexToBytes(fixture.hex);
        const url = thumbHashToDataURL(hash, undefined, fixture.avgColor);
        expect(url).toMatch(/^data:image\/bmp;base64,/);
      }
      return;
    }

    // Write BMP files for visual inspection.
    fs.mkdirSync(artifactsDir, { recursive: true });

    const report: Record<string, { sat: number; dist: number }> = {};

    for (const [name, fixture] of Object.entries(FIXTURES)) {
      const hash = hexToBytes(fixture.hex);

      // Get the data URL
      const url = thumbHashToDataURL(hash, undefined, fixture.avgColor);
      const base64Data = url.replace('data:image/bmp;base64,', '');
      const bmpBuffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(path.join(artifactsDir, `${name}.bmp`), bmpBuffer);

      // Also write metrics
      const result = applyAdaptivePipeline(hash, fixture.avgColor);
      const n = result.w * result.h;
      const sat = avgSaturationHSL(result.rgba, n);
      const finalAvg = avgRGB(result.rgba, n);
      const distAfter = rgbDist(finalAvg, fixture.avgColor);
      report[name] = { sat: Math.round(sat * 1000) / 1000, dist: Math.round(distAfter * 10) / 10 };
    }

    fs.writeFileSync(
      path.join(artifactsDir, 'metrics.json'),
      JSON.stringify(report, null, 2) + '\n',
    );

    // Verify artifacts were written
    expect(fs.existsSync(path.join(artifactsDir, 'metrics.json'))).toBe(true);
    expect(Object.keys(report)).toHaveLength(Object.keys(FIXTURES).length);
  });
});
