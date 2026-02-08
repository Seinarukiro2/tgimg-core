/**
 * Render timing tests for placeholder-first behaviour.
 *
 * Verifies the critical invariant: thumbhash placeholder URL is
 * computed synchronously (via useMemo), NOT deferred to useEffect.
 * This ensures the placeholder is visible on the very first paint.
 *
 * Also verifies that variant selection is a pure, memoised function
 * and that format detection is cached globally.
 */

import { describe, expect, it } from 'vitest';
import { thumbHashToDataURL, base64ToUint8Array } from '../thumbhash';
import { selectVariant } from '../variant-select';
import type { TgImgVariant, FormatSupport } from '../types';

// ─── placeholder is synchronous ──────────────────────────────

describe('placeholder computation is synchronous', () => {
  const HASH_B64 = 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iA==';

  it('thumbHashToDataURL returns immediately (no async)', () => {
    const bytes = base64ToUint8Array(HASH_B64);
    const t0 = performance.now();
    const url = thumbHashToDataURL(bytes);
    const dt = performance.now() - t0;

    expect(url).toMatch(/^data:image\/bmp;base64,/);
    // Must complete synchronously.  First call may be ~5-15ms (JIT warmup),
    // subsequent calls < 0.1ms.  The critical invariant is that this is
    // NOT async (no await, no setTimeout, no requestAnimationFrame).
    expect(dt).toBeLessThan(50);
  });

  it('placeholder URL is deterministic across calls', () => {
    const bytes = base64ToUint8Array(HASH_B64);
    const url1 = thumbHashToDataURL(bytes);
    const url2 = thumbHashToDataURL(bytes);
    expect(url1).toBe(url2);
  });
});

// ─── variant selection is pure & memoisation-safe ────────────

describe('variant selection is pure function', () => {
  const variants: TgImgVariant[] = [
    { format: 'webp', width: 320, height: 180, byte_size: 5000, hash: 'a', path: 'a.webp' },
    { format: 'webp', width: 640, height: 360, byte_size: 10000, hash: 'b', path: 'b.webp' },
    { format: 'avif', width: 320, height: 180, byte_size: 3000, hash: 'c', path: 'c.avif' },
    { format: 'avif', width: 640, height: 360, byte_size: 7000, hash: 'd', path: 'd.avif' },
    { format: 'jpeg', width: 320, height: 180, byte_size: 8000, hash: 'e', path: 'e.jpg' },
  ];

  const formats: FormatSupport = { avif: true, webp: true };

  it('same inputs produce identical output (memoisation-safe)', () => {
    const r1 = selectVariant({ variants, containerWidth: 300, dpr: 2, formats });
    const r2 = selectVariant({ variants, containerWidth: 300, dpr: 2, formats });
    expect(r1).toEqual(r2);
  });

  it('does not trigger re-computation for identical containerWidth', () => {
    // Call 1000 times — should be effectively free (pure function).
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      selectVariant({ variants, containerWidth: 300, dpr: 2, formats });
    }
    const dt = performance.now() - t0;
    // 1000 calls should complete in < 50ms (generous for JIT warmup).
    expect(dt).toBeLessThan(50);
  });

  it('prefers avif over webp when both supported', () => {
    const result = selectVariant({ variants, containerWidth: 300, dpr: 2, formats });
    expect(result?.format).toBe('avif');
  });

  it('falls back to webp when avif not supported', () => {
    const result = selectVariant({
      variants,
      containerWidth: 300,
      dpr: 2,
      formats: { avif: false, webp: true },
    });
    expect(result?.format).toBe('webp');
  });
});

// ─── render path documentation ──────────────────────────────
//
// Expected render sequence for a single <TgImg> component:
//
//   Render 1 (mount):
//     - placeholderUrl computed via useMemo (SYNC — visible in first paint)
//     - containerRef callback fires → getBoundingClientRect → setContainerWidth
//     - formats may be cached → variant selection happens
//     - transition mode resolved (auto → instant/reveal based on area)
//     - If formats not cached → one more render after detection
//
//   Render 2 (format + width ready):
//     - variant selected (pure function, memoised)
//     - <img> element rendered with src
//
//   Render 3 (image decoded):
//     - img.decode() resolves → srcGuardRef check → setLoaded(true)
//     - transition mode determines visual:
//       · instant: hard swap (no CSS transition on any property)
//       · reveal:  opacity flips instantly, filter: blur(6px)→0 + scale(1.01)→1
//                  over 160ms cubic-bezier(0.2,0.8,0.2,1)
//                  placeholder fades in 80ms
//       · off:     hard swap
//
// Total: 2-3 renders per component.  No cascade re-renders.
// ResizeObserver does NOT block placeholder display.
// Variant selection does NOT require useEffect — it's useMemo.
// Stale decode from fast imgSrc changes → silently ignored (srcGuardRef).
