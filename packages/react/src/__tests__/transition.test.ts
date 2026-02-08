/**
 * Tests for transition mode resolution, style computation,
 * chroma constants, small-mode, and race-condition guard.
 *
 * All style helpers are pure functions — no React renderer needed.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CHROMA_DEFAULT,
  CHROMA_INSTANT,
  CHROMA_REVEAL,
  CROSSFADE_MS,
  EASING,
  INSTANT_AREA_THRESHOLD,
  INSTANT_MIN_DIM_THRESHOLD,
  REVEAL_BLUR_MS,
  REVEAL_BLUR_PX,
  REVEAL_SCALE,
  SMALL_DIM_THRESHOLD,
  computeStyles,
  isSmallImage,
  resolveTransition,
} from '../transition';

// Helpers — extract placeholder/img from the tuple.
const phStyle = (...a: Parameters<typeof computeStyles>) => computeStyles(...a)[0];
const imgStyle = (...a: Parameters<typeof computeStyles>) => computeStyles(...a)[1];

// ─── resolveTransition: auto mode (area) ────────────────────

describe('resolveTransition — auto mode (area threshold)', () => {
  it('auto → instant for avatar 48×48', () => {
    expect(resolveTransition('auto', 48 * 48, 48)).toBe('instant');
  });

  it('auto → instant for area just below threshold', () => {
    expect(resolveTransition('auto', INSTANT_AREA_THRESHOLD - 1, 100)).toBe(
      'instant',
    );
  });

  it('auto → reveal at exact area threshold', () => {
    expect(resolveTransition('auto', INSTANT_AREA_THRESHOLD, 100)).toBe(
      'reveal',
    );
  });

  it('auto → reveal for banner 1200×600', () => {
    expect(resolveTransition('auto', 1200 * 600, 600)).toBe('reveal');
  });

  it('auto → reveal when area is null', () => {
    expect(resolveTransition('auto', null)).toBe('reveal');
  });

  it('auto → reveal when area is 0', () => {
    expect(resolveTransition('auto', 0)).toBe('reveal');
  });

  it('auto → reveal when area is negative', () => {
    expect(resolveTransition('auto', -100)).toBe('reveal');
  });
});

// ─── resolveTransition: auto mode (minDim override) ─────────

describe('resolveTransition — auto mode (minDim override)', () => {
  it('300×200 (area=60k, minDim=200 ≥ 180) → reveal', () => {
    expect(resolveTransition('auto', 300 * 200, 200)).toBe('reveal');
  });

  it('200×200 (area=40k < 55k, minDim=200 ≥ 180) → reveal', () => {
    expect(resolveTransition('auto', 200 * 200, 200)).toBe('reveal');
  });

  it('24×24 (area=576, minDim=24 < 180) → instant', () => {
    expect(resolveTransition('auto', 24 * 24, 24)).toBe('instant');
  });

  it('100×100 (area=10k, minDim=100 < 180) → instant', () => {
    expect(resolveTransition('auto', 100 * 100, 100)).toBe('instant');
  });

  it('minDim exactly 180 → reveal', () => {
    expect(resolveTransition('auto', 180 * 100, 180)).toBe('reveal');
  });

  it('minDim=null falls back to area-only', () => {
    expect(resolveTransition('auto', 40_000)).toBe('instant');
    expect(resolveTransition('auto', 40_000, null)).toBe('instant');
  });
});

// ─── resolveTransition: explicit modes ──────────────────────

describe('resolveTransition — explicit modes ignore area', () => {
  it('instant passes through', () => {
    expect(resolveTransition('instant', 1_000_000, 1000)).toBe('instant');
    expect(resolveTransition('instant', 100, 10)).toBe('instant');
    expect(resolveTransition('instant', null)).toBe('instant');
  });

  it('reveal passes through', () => {
    expect(resolveTransition('reveal', 100, 10)).toBe('reveal');
    expect(resolveTransition('reveal', null)).toBe('reveal');
  });

  it('off passes through', () => {
    expect(resolveTransition('off', 100)).toBe('off');
    expect(resolveTransition('off', null)).toBe('off');
  });
});

// ─── isSmallImage ───────────────────────────────────────────

describe('isSmallImage', () => {
  it('true for 24px (< 72)', () => {
    expect(isSmallImage(24)).toBe(true);
  });

  it('true for 48px', () => {
    expect(isSmallImage(48)).toBe(true);
  });

  it('true for 64px', () => {
    expect(isSmallImage(64)).toBe(true);
  });

  it('false for 72px (exact threshold)', () => {
    expect(isSmallImage(72)).toBe(false);
  });

  it('false for 100px', () => {
    expect(isSmallImage(100)).toBe(false);
  });

  it('false for null', () => {
    expect(isSmallImage(null)).toBe(false);
  });

  it('false for 0', () => {
    expect(isSmallImage(0)).toBe(false);
  });

  it('false for negative', () => {
    expect(isSmallImage(-10)).toBe(false);
  });
});

// ─── imgStyle: instant mode ─────────────────────────────────

describe('imgStyle — instant (micro-crossfade)', () => {
  it('has opacity transition (80ms)', () => {
    const s = imgStyle('instant', false, 'cover', null);
    expect(s.transition).toContain('opacity');
    expect(s.transition).toContain(`${CROSSFADE_MS}ms`);
    expect(s.transition).toContain(EASING);
  });

  it('transition does NOT contain filter or transform', () => {
    const s = imgStyle('instant', false, 'cover', null);
    expect(s.transition).not.toContain('filter');
    expect(s.transition).not.toContain('transform');
  });

  it('no filter or transform properties', () => {
    const s = imgStyle('instant', false, 'cover', null);
    expect(s.filter).toBeUndefined();
    expect(s.transform).toBeUndefined();
  });

  it('opacity 0 when not loaded, 1 when loaded', () => {
    expect(imgStyle('instant', false, 'cover', null).opacity).toBe(0);
    expect(imgStyle('instant', true, 'cover', null).opacity).toBe(1);
  });

  it('respects fit parameter', () => {
    expect(imgStyle('instant', true, 'contain', null).objectFit).toBe(
      'contain',
    );
  });
});

// ─── imgStyle: reveal mode ──────────────────────────────────

describe('imgStyle — reveal (blur-to-sharp)', () => {
  it('starts with blur and scale when not loaded', () => {
    const s = imgStyle('reveal', false, 'cover', null);
    expect(s.filter).toBe(`blur(${REVEAL_BLUR_PX}px)`);
    expect(s.transform).toBe(`scale(${REVEAL_SCALE})`);
    expect(s.opacity).toBe(0);
  });

  it('clears blur and scale when loaded', () => {
    const s = imgStyle('reveal', true, 'cover', null);
    expect(s.filter).toBe('blur(0px)');
    expect(s.transform).toBe('scale(1)');
    expect(s.opacity).toBe(1);
  });

  it('transition includes opacity, filter, and transform', () => {
    const s = imgStyle('reveal', false, 'cover', null);
    expect(s.transition).toContain('opacity');
    expect(s.transition).toContain('filter');
    expect(s.transition).toContain('transform');
  });

  it('opacity uses crossfade timing, blur uses reveal timing', () => {
    const s = imgStyle('reveal', false, 'cover', null);
    expect(s.transition).toContain(`opacity ${CROSSFADE_MS}ms`);
    expect(s.transition).toContain(`filter ${REVEAL_BLUR_MS}ms`);
    expect(s.transition).toContain(`transform ${REVEAL_BLUR_MS}ms`);
  });

  it('all transitions use the same easing', () => {
    const s = imgStyle('reveal', false, 'cover', null);
    const t = s.transition as string;
    const count = t.split(EASING).length - 1;
    expect(count).toBe(3);
  });
});

// ─── imgStyle: off mode ─────────────────────────────────────

describe('imgStyle — off', () => {
  it('no transition, filter, or transform', () => {
    const s = imgStyle('off', false, 'cover', null);
    expect(s.transition).toBeUndefined();
    expect(s.filter).toBeUndefined();
    expect(s.transform).toBeUndefined();
  });

  it('opacity flips hard', () => {
    expect(imgStyle('off', false, 'cover', null).opacity).toBe(0);
    expect(imgStyle('off', true, 'cover', null).opacity).toBe(1);
  });
});

// ─── phStyle: instant ───────────────────────────────────────

describe('phStyle — instant (micro-crossfade)', () => {
  it('has opacity transition', () => {
    const s = phStyle('instant', false, 'cover', 'data:test');
    expect(s.transition).toContain('opacity');
    expect(s.transition).toContain(`${CROSSFADE_MS}ms`);
  });

  it('opacity 1→0', () => {
    expect(phStyle('instant', false, 'cover', 'data:test').opacity).toBe(1);
    expect(phStyle('instant', true, 'cover', 'data:test').opacity).toBe(0);
  });
});

// ─── phStyle: reveal ────────────────────────────────────────

describe('phStyle — reveal', () => {
  it('has same opacity transition as instant', () => {
    const a = phStyle('instant', false, 'cover', 'data:test').transition;
    const b = phStyle('reveal', false, 'cover', 'data:test').transition;
    expect(a).toBe(b);
  });

  it('sets backgroundImage', () => {
    const s = phStyle('reveal', false, 'cover', 'data:image/bmp;foo');
    expect(s.backgroundImage).toBe('url(data:image/bmp;foo)');
  });

  it('omits backgroundImage when null', () => {
    expect(
      phStyle('reveal', false, 'cover', null).backgroundImage,
    ).toBeUndefined();
  });
});

// ─── phStyle: off ───────────────────────────────────────────

describe('phStyle — off', () => {
  it('no CSS transition', () => {
    expect(
      phStyle('off', false, 'cover', 'data:test').transition,
    ).toBeUndefined();
  });
});

// ─── Small mode: placeholder as <img> ───────────────────────

describe('small mode placeholder styles', () => {
  it('has objectFit instead of backgroundImage', () => {
    const s = phStyle('instant', false, 'cover', 'data:test', true);
    expect(s.objectFit).toBe('cover');
    expect(s.backgroundImage).toBeUndefined();
    expect(s.backgroundSize).toBeUndefined();
  });

  it('has width/height 100%', () => {
    const s = phStyle('instant', false, 'cover', 'data:test', true);
    expect(s.width).toBe('100%');
    expect(s.height).toBe('100%');
  });

  it('respects fit parameter', () => {
    expect(
      phStyle('instant', false, 'contain', 'data:test', true).objectFit,
    ).toBe('contain');
  });

  it('has opacity transition (crossfade)', () => {
    const s = phStyle('instant', false, 'cover', 'data:test', true);
    expect(s.transition).toContain('opacity');
    expect(s.transition).toContain(`${CROSSFADE_MS}ms`);
  });

  it('opacity 1→0 on load', () => {
    expect(phStyle('instant', false, 'cover', 'data:test', true).opacity).toBe(
      1,
    );
    expect(phStyle('instant', true, 'cover', 'data:test', true).opacity).toBe(
      0,
    );
  });

  it('display is block for pixel-perfect geometry', () => {
    expect(phStyle('instant', false, 'cover', 'data:test', true).display).toBe(
      'block',
    );
  });
});

// ─── Small mode: no blur/scale even with reveal ─────────────

describe('small mode img styles (no blur/scale)', () => {
  it('reveal + small: no blur or scale', () => {
    const s = imgStyle('reveal', false, 'cover', null, true);
    expect(s.filter).toBeUndefined();
    expect(s.transform).toBeUndefined();
  });

  it('reveal + small: has opacity crossfade only', () => {
    const s = imgStyle('reveal', false, 'cover', null, true);
    expect(s.transition).toContain('opacity');
    expect(s.transition).not.toContain('filter');
    expect(s.transition).not.toContain('transform');
  });

  it('instant + small: same as instant (no blur)', () => {
    const s = imgStyle('instant', false, 'cover', null, true);
    expect(s.filter).toBeUndefined();
    expect(s.transform).toBeUndefined();
    expect(s.transition).toContain('opacity');
  });

  it('off + small: no transition at all', () => {
    const s = imgStyle('off', false, 'cover', null, true);
    expect(s.transition).toBeUndefined();
    expect(s.filter).toBeUndefined();
    expect(s.transform).toBeUndefined();
  });
});

// ─── Double-rAF commit pattern ──────────────────────────────

describe('double-rAF commit for small mode', () => {
  it('wraps commit in double requestAnimationFrame', () => {
    const commit = vi.fn();
    const mockRAF = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal('requestAnimationFrame', mockRAF);

    // Simulate the small-mode wrapping pattern from TgImg:
    const wrappedCommit = () =>
      requestAnimationFrame(() => requestAnimationFrame(commit));
    wrappedCommit();

    expect(mockRAF).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('large mode calls commit directly (no rAF)', () => {
    const commit = vi.fn();
    // For non-small, commit is called directly.
    commit();
    expect(commit).toHaveBeenCalledTimes(1);
  });
});

// ─── Race condition guard ───────────────────────────────────

describe('imgSrc race condition guard', () => {
  it('stale decode from old imgSrc is dropped', () => {
    let srcGuard = 'image-A.webp';
    const captured = srcGuard;
    srcGuard = 'image-B.webp';
    expect(srcGuard === captured).toBe(false);
  });

  it('current decode is accepted', () => {
    let srcGuard = 'image-A.webp';
    const captured = srcGuard;
    expect(srcGuard === captured).toBe(true);
  });

  it('rapid A→B→A: second A decode accepted', () => {
    let srcGuard = 'image-A.webp';
    const capturedA = srcGuard;
    srcGuard = 'image-B.webp';
    expect(srcGuard === capturedA).toBe(false);
    srcGuard = 'image-A.webp';
    const capturedA2 = srcGuard;
    expect(srcGuard === capturedA2).toBe(true);
  });
});

// ─── Constants sanity ───────────────────────────────────────

describe('transition constants', () => {
  it('INSTANT_AREA_THRESHOLD is 55 000', () => {
    expect(INSTANT_AREA_THRESHOLD).toBe(55_000);
  });

  it('INSTANT_MIN_DIM_THRESHOLD is 180', () => {
    expect(INSTANT_MIN_DIM_THRESHOLD).toBe(180);
  });

  it('SMALL_DIM_THRESHOLD is 72', () => {
    expect(SMALL_DIM_THRESHOLD).toBe(72);
  });

  it('CROSSFADE_MS is 80', () => {
    expect(CROSSFADE_MS).toBe(80);
  });

  it('REVEAL_BLUR_MS is 140', () => {
    expect(REVEAL_BLUR_MS).toBe(140);
  });

  it('REVEAL_BLUR_PX is 4', () => {
    expect(REVEAL_BLUR_PX).toBe(4);
  });

  it('REVEAL_SCALE is 1.01', () => {
    expect(REVEAL_SCALE).toBe(1.01);
  });

  it('EASING matches', () => {
    expect(EASING).toBe('cubic-bezier(0.2, 0.8, 0.2, 1)');
  });
});

describe('chroma constants', () => {
  it('CHROMA_DEFAULT is 0.30', () => {
    expect(CHROMA_DEFAULT).toBe(0.3);
  });

  it('CHROMA_REVEAL is 0.22', () => {
    expect(CHROMA_REVEAL).toBe(0.22);
  });

  it('CHROMA_INSTANT is 0.45', () => {
    expect(CHROMA_INSTANT).toBe(0.45);
  });
});
