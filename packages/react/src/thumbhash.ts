/**
 * ThumbHash decoder — converts a compact hash to a placeholder image.
 * Based on Evan Wallace's reference implementation.
 *
 * This module is intentionally dependency-free and uses typed arrays
 * for maximum performance in Telegram webview / iOS Safari.
 *
 * ── ThumbHash Binary Header Format (MUST match Go encoder exactly) ──
 *
 * Bytes 0–3: main header (32 bits, little-endian)
 *   bits  0– 5  (6 bits): lDC      encode: round(lDC * 63)        → decode: val / 63
 *   bits  6–11  (6 bits): pDC      encode: round(pDC * 31 + 31)   → decode: val / 31 - 1
 *   bits 12–17  (6 bits): qDC      encode: round(qDC * 31 + 31)   → decode: val / 31 - 1
 *   bits 18–22  (5 bits): lScale   encode: round(lScale * 31)     → decode: val / 31
 *   bit  23     (1 bit):  hasAlpha
 *   bits 24–27  (4 bits): dimFlag  = isLandscape ? ly : lx         range [1, 7]
 *   bit  28     (1 bit):  isLandscape
 *   bits 29–31:           unused
 *
 * Bytes 4–5: header2 (16 bits, little-endian)
 *   bits  0– 5  (6 bits): pScale   → val / 63
 *   bits  6–11  (6 bits): qScale   → val / 63
 *
 * Bytes 6–7 (only if hasAlpha):
 *   bits  0– 3  (4 bits): aDC      → val / 15
 *   bits  4– 7  (4 bits): aScale   → val / 15
 *
 * AC data starts at byte 6 (no alpha) or byte 8 (with alpha).
 *
 * CRITICAL: pDC and qDC are 6-bit fields. Mask MUST be 0x3F (63), NOT 0x1F (31).
 * A 5-bit mask silently truncates values ≥ 32 and corrupts chroma (blue flash).
 */

// Dev-mode flag — tree-shaken in production builds.
// Vite/Rollup replaces `process.env.NODE_ENV` at build time;
// direct boolean check ensures dead code elimination.
const __TGIMG_DEV__ =
  typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';

/**
 * Decode a ThumbHash to RGBA pixel data.
 * Returns the image dimensions and pixel data.
 */
export function thumbHashToRGBA(hash: Uint8Array, chroma?: number): {
  w: number;
  h: number;
  rgba: Uint8Array;
} {
  const { PI, cos, round, max, min } = Math;

  // ── Parse header (see format spec above) ──
  const header = hash[0]! | (hash[1]! << 8) | (hash[2]! << 16) | (hash[3]! << 24);
  const header2 = hash[4]! | (hash[5]! << 8);

  const lDC = (header & 63) / 63;                    // bits  0– 5, 6 bits
  const pDC = ((header >> 6) & 63) / 31 - 1;         // bits  6–11, 6 bits, bias 31
  const qDC = ((header >> 12) & 63) / 31 - 1;        // bits 12–17, 6 bits, bias 31
  const lScale = ((header >> 18) & 31) / 31;          // bits 18–22, 5 bits
  const hasAlpha = ((header >> 23) & 1) === 1;        // bit  23
  const dimFlag = (header >> 24) & 0xf;               // bits 24–27, 4 bits
  const isLandscape = ((header >> 28) & 1) === 1;     // bit  28

  const pScale = (header2 & 63) / 63;                 // bits  0– 5, 6 bits
  const qScale = ((header2 >> 6) & 63) / 63;          // bits  6–11, 6 bits

  // ── Sanity checks (catch format / bit-width errors early) ──
  if (__TGIMG_DEV__) {
    // pDC raw range [0, 62], decoded [-1, 1].  If we see exactly -1 with
    // raw >= 32, the old 5-bit bug has returned.
    const pRaw = (header >> 6) & 63;
    const qRaw = (header >> 12) & 63;
    if (pRaw > 62)
      console.warn(`[tgimg] thumbhash: pDC raw value ${pRaw} > 62 — possible format error`);
    if (qRaw > 62)
      console.warn(`[tgimg] thumbhash: qDC raw value ${qRaw} > 62 — possible format error`);
    if (hash.length < 6)
      console.warn(`[tgimg] thumbhash: hash too short (${hash.length} bytes, need ≥6)`);
  }

  const lLimit = hasAlpha ? 5 : 7;
  let lx: number, ly: number;
  if (isLandscape) {
    lx = lLimit;
    ly = max(1, dimFlag);
  } else {
    lx = max(1, dimFlag);
    ly = lLimit;
  }

  let aDC = 1.0;
  let aScale = 0.0;
  let acOffset = 6;

  if (hasAlpha) {
    const alphaHeader = hash[6]! | (hash[7]! << 8);
    aDC = (alphaHeader & 15) / 15;
    aScale = ((alphaHeader >> 4) & 15) / 15;
    acOffset = 8;
  }

  // Unpack AC coefficients.
  const readAC = (count: number, offset: { value: number }): number[] => {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const byteIdx = acOffset + (offset.value >> 1);
      const nibble =
        offset.value % 2 === 0
          ? hash[byteIdx]! & 0xf
          : (hash[byteIdx]! >> 4) & 0xf;
      result.push((nibble / 15) * 2 - 1);
      offset.value++;
    }
    return result;
  };

  const offset = { value: 0 };
  const lAC = readAC(lx * ly - 1, offset);
  const pAC = readAC(3 * 3 - 1, offset);
  const qAC = readAC(3 * 3 - 1, offset);
  const aAC = hasAlpha ? readAC(lx * ly - 1, offset) : [];

  // Determine output size (max ~32px on longest side).
  const ratio = isLandscape ? (lx > ly ? lx / ly : 1) : ly > lx ? ly / lx : 1;
  const w = round(isLandscape ? 32 : 32 / ratio);
  const h = round(isLandscape ? 32 / ratio : 32);
  const rgba = new Uint8Array(w * h * 4);

  // Decode via inverse DCT.
  const cosX = new Float64Array(w);
  const cosY = new Float64Array(h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let l = lDC;
      let p = pDC;
      let q = qDC;
      let a = aDC;

      // L channel.
      let acIdx = 0;
      for (let cy = 0; cy < ly; cy++) {
        const fy = cos((PI * cy * (y + 0.5)) / h);
        for (let cx = 0; cx < lx; cx++) {
          if (cx === 0 && cy === 0) continue;
          const fx = cos((PI * cx * (x + 0.5)) / w);
          l += lAC[acIdx]! * lScale * fx * fy;
          acIdx++;
        }
      }

      // P channel.
      acIdx = 0;
      for (let cy = 0; cy < 3; cy++) {
        const fy = cos((PI * cy * (y + 0.5)) / h);
        for (let cx = 0; cx < 3; cx++) {
          if (cx === 0 && cy === 0) continue;
          const fx = cos((PI * cx * (x + 0.5)) / w);
          p += pAC[acIdx]! * pScale * fx * fy;
          acIdx++;
        }
      }

      // Q channel.
      acIdx = 0;
      for (let cy = 0; cy < 3; cy++) {
        const fy = cos((PI * cy * (y + 0.5)) / h);
        for (let cx = 0; cx < 3; cx++) {
          if (cx === 0 && cy === 0) continue;
          const fx = cos((PI * cx * (x + 0.5)) / w);
          q += qAC[acIdx]! * qScale * fx * fy;
          acIdx++;
        }
      }

      // A channel.
      if (hasAlpha) {
        acIdx = 0;
        for (let cy = 0; cy < ly; cy++) {
          const fy = cos((PI * cy * (y + 0.5)) / h);
          for (let cx = 0; cx < lx; cx++) {
            if (cx === 0 && cy === 0) continue;
            const fx = cos((PI * cx * (x + 0.5)) / w);
            a += aAC[acIdx]! * aScale * fx * fy;
            acIdx++;
          }
        }
      }

      // LPQA → RGBA.
      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;

      const idx = (y * w + x) * 4;
      rgba[idx + 0] = max(0, min(255, round(r * 255)));
      rgba[idx + 1] = max(0, min(255, round(g * 255)));
      rgba[idx + 2] = max(0, min(255, round(b * 255)));
      rgba[idx + 3] = max(0, min(255, round(a * 255)));
    }
  }

  // Chroma attenuation (simple mode — when called directly).
  if (chroma != null && chroma < 1) attenuateChroma(rgba, chroma);

  return { w, h, rgba };
}

// ─── Internal helpers ─────────────────────────────────────────

/** Apply BT.709 chroma attenuation in-place. */
function attenuateChroma(rgba: Uint8Array, c: number): void {
  const { round } = Math;
  const cc = Math.max(0, c);
  for (let i = 0, len = rgba.length; i < len; i += 4) {
    const r = rgba[i]!;
    const g = rgba[i + 1]!;
    const b = rgba[i + 2]!;
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    rgba[i]     = round(y + (r - y) * cc);
    rgba[i + 1] = round(y + (g - y) * cc);
    rgba[i + 2] = round(y + (b - y) * cc);
  }
}

/** Compute average RGB of an RGBA buffer (n = pixel count). */
function computeAvgRGB(rgba: Uint8Array, n: number): [number, number, number] {
  let rS = 0, gS = 0, bS = 0;
  for (let i = 0, len = n * 4; i < len; i += 4) {
    rS += rgba[i]!;
    gS += rgba[i + 1]!;
    bS += rgba[i + 2]!;
  }
  return [rS / n, gS / n, bS / n];
}

/** Shift avg RGB of buffer toward target (gain ∈ [0,1]). */
function applyBiasCorrection(
  rgba: Uint8Array,
  n: number,
  target: readonly number[],
  gain: number,
): void {
  const { round, max, min } = Math;
  const avg = computeAvgRGB(rgba, n);
  const dr = (target[0]! - avg[0]) * gain;
  const dg = (target[1]! - avg[1]) * gain;
  const db = (target[2]! - avg[2]) * gain;
  for (let i = 0, len = n * 4; i < len; i += 4) {
    rgba[i]     = max(0, min(255, round(rgba[i]! + dr)));
    rgba[i + 1] = max(0, min(255, round(rgba[i + 1]! + dg)));
    rgba[i + 2] = max(0, min(255, round(rgba[i + 2]! + db)));
  }
}

/** Encode RGBA buffer to a BMP data URL. */
function rgbaToBmpDataURL(w: number, h: number, rgba: Uint8Array): string {
  const headerSize = 122;
  const stride = w * 4;
  const dataSize = stride * h;
  const fileSize = headerSize + dataSize;

  const bmp = new Uint8Array(fileSize);
  const view = new DataView(bmp.buffer);

  bmp[0] = 0x42; // 'B'
  bmp[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, headerSize, true);

  view.setUint32(14, 108, true);
  view.setInt32(18, w, true);
  view.setInt32(22, -h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 32, true);
  view.setUint32(30, 3, true);
  view.setUint32(34, dataSize, true);
  view.setUint32(38, 2835, true);
  view.setUint32(42, 2835, true);
  view.setUint32(54, 0x00ff0000, true);
  view.setUint32(58, 0x0000ff00, true);
  view.setUint32(62, 0x000000ff, true);
  view.setUint32(66, 0xff000000, true);

  for (let i = 0; i < w * h; i++) {
    const src = i * 4;
    const dst = headerSize + i * 4;
    bmp[dst + 0] = rgba[src + 2]!;
    bmp[dst + 1] = rgba[src + 1]!;
    bmp[dst + 2] = rgba[src + 0]!;
    bmp[dst + 3] = rgba[src + 3]!;
  }

  let binary = '';
  for (let i = 0; i < bmp.length; i++) {
    binary += String.fromCharCode(bmp[i]!);
  }
  return `data:image/bmp;base64,${btoa(binary)}`;
}

/**
 * Convert a ThumbHash to a data URL suitable for use as a placeholder.
 *
 * When `avgColor` is provided (from manifest), adaptive chroma is used:
 * the Euclidean distance between decoded placeholder avg and target avg_color
 * determines how much chroma to preserve.  A bias correction then nudges
 * the overall tone toward the target.
 *
 * When `avgColor` is omitted, the `chroma` parameter is applied directly
 * (simple attenuation mode).
 */
export function thumbHashToDataURL(
  hash: Uint8Array,
  chroma?: number,
  avgColor?: readonly number[],
): string {
  if (avgColor != null && avgColor.length >= 3) {
    // ── Adaptive path ──
    const { w, h, rgba } = thumbHashToRGBA(hash); // raw, no attenuation
    const n = w * h;

    const phAvg = computeAvgRGB(rgba, n);
    const dist = Math.sqrt(
      (phAvg[0] - avgColor[0]!) ** 2 +
      (phAvg[1] - avgColor[1]!) ** 2 +
      (phAvg[2] - avgColor[2]!) ** 2,
    );

    // ── Adaptive chroma thresholds ──
    //
    //   dist < 20  → 0.55  Placeholder closely matches; keep most color.
    //   dist < 45  → 0.40  Moderate drift; reduce slightly.
    //   dist >= 45 → 0.28  Large drift (e.g. forest→lime); desaturate but
    //                       never fully gray (min 0.28 prevents "washed out").
    //
    // Verified by visual-contracts.test.ts:
    //   sat ∈ [0.12, 0.65] for photos, [0.18, 0.65] for logos
    //   dist_after < dist_before, dist_after <= 18
    const ac = dist < 20 ? 0.55 : dist < 45 ? 0.40 : 0.28;
    if (ac < 1) attenuateChroma(rgba, ac);

    // Bias correction (gain=0.45): nudge avg RGB toward target tone.
    applyBiasCorrection(rgba, n, avgColor, 0.45);

    return rgbaToBmpDataURL(w, h, rgba);
  }

  // ── Simple path (no adaptive) ──
  const { w, h, rgba } = thumbHashToRGBA(hash, chroma);
  return rgbaToBmpDataURL(w, h, rgba);
}

/**
 * Decode a base64 string to Uint8Array.
 * Used to convert thumbhash from manifest (base64) to binary.
 */
export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
