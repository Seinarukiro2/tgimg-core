/**
 * Transition mode resolution and style computation for TgImg.
 *
 * Two modes after "auto" resolution:
 *  - instant: 80 ms micro-crossfade (opacity only, no blur/scale).
 *  - reveal:  80 ms opacity + 140 ms blur(4px→0) + scale(1.01→1).
 *
 * Small images (minDim < 72) force "instant" behavior with pixel-perfect
 * placeholder geometry — no blur/scale regardless of resolved mode.
 *
 * Chroma attenuation defaults (fallback when no adaptive avg_color):
 *  - instant (UI elements): 0.45 (more color)
 *  - reveal  (photos):      0.22 (neutral but not gray)
 *  - default:                0.30
 */

import type { CSSProperties } from 'react';

// ─── Constants ────────────────────────────────────────────────

/** Area threshold in CSS px².  Below → instant (unless minDim overrides). */
export const INSTANT_AREA_THRESHOLD = 55_000;

/**
 * Min-dimension override: if min(width, height) >= this value,
 * use reveal even when area is below the threshold.
 */
export const INSTANT_MIN_DIM_THRESHOLD = 180;

/** Below this min-dimension → "small" mode (pixel-perfect, no blur/scale). */
export const SMALL_DIM_THRESHOLD = 72;

/**
 * Static hot-path threshold.
 *
 * Images with min(width, height) <= this value bypass the entire placeholder /
 * transition / decode-gating pipeline.  A bare `<img>` is rendered instead,
 * with `loading="eager"` and `decoding="sync"`.
 *
 * Why: for tiny UI assets (icons, emojis, gift stickers, market cards),
 * ANY placeholder or fade transition draws the user's attention to the fact
 * that something loaded.  The best UX is to render the image as if it was
 * always part of the HTML — instant, no animation, straight from cache.
 *
 * The threshold is set to 96 CSS px because:
 *   - Below 96px, images occupy < 9216 px² — too small for blur/fade to help.
 *   - At 96px the file is typically < 5 KB WebP — loads in < 10 ms on 3G.
 *   - After the first visit, the content-addressed filename (immutable) ensures
 *     the asset is served from disk/memory cache in the same frame.
 */
export const STATIC_MAX_DIM = 96;

/** Shared easing for all transition modes. */
export const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** Opacity crossfade duration — shared by instant and reveal. */
export const CROSSFADE_MS = 80;

/** Reveal: blur + scale transition duration. */
export const REVEAL_BLUR_MS = 140;
/** Reveal: initial blur radius (px). */
export const REVEAL_BLUR_PX = 4;
/** Reveal: initial scale factor. */
export const REVEAL_SCALE = 1.01;

/** Auto chroma values for placeholder (fallback when no adaptive avg_color). */
export const CHROMA_DEFAULT = 0.30;
export const CHROMA_REVEAL = 0.22;
export const CHROMA_INSTANT = 0.45;

// Pre-computed CSS strings (avoids per-call concatenation).
const _crossfade = `opacity ${CROSSFADE_MS}ms ${EASING}`;
const _revealImg =
  `opacity ${CROSSFADE_MS}ms ${EASING},` +
  `filter ${REVEAL_BLUR_MS}ms ${EASING},` +
  `transform ${REVEAL_BLUR_MS}ms ${EASING}`;
const _bOn = `blur(${REVEAL_BLUR_PX}px)`;
const _sOn = `scale(${REVEAL_SCALE})`;

// ─── Types ────────────────────────────────────────────────────

export type TransitionMode = 'auto' | 'instant' | 'reveal' | 'off';
export type ResolvedTransition = 'instant' | 'reveal' | 'off';

// ─── Resolution ───────────────────────────────────────────────

/**
 * Resolve "auto" to a concrete mode.
 *
 * @param mode   - User-specified transition mode.
 * @param area   - Rendered area in CSS px² (width × height), or null.
 * @param minDim - min(width, height) in CSS px, or null/undefined.
 */
export function resolveTransition(
  mode: TransitionMode,
  area: number | null,
  minDim?: number | null,
): ResolvedTransition {
  if (mode !== 'auto') return mode;
  if (area === null || area <= 0) return 'reveal';
  // Min-dimension override: medium images feel better with reveal.
  if (minDim != null && minDim >= INSTANT_MIN_DIM_THRESHOLD) return 'reveal';
  return area < INSTANT_AREA_THRESHOLD ? 'instant' : 'reveal';
}

/** Detect "small" image mode — used for pixel-perfect placeholder. */
export function isSmallImage(minDim: number | null): boolean {
  return minDim != null && minDim > 0 && minDim < SMALL_DIM_THRESHOLD;
}

/**
 * Detect static hot-path eligibility.
 *
 * Static mode renders a bare `<img>` with no placeholder, no transition,
 * no decode-gating.  Conditions:
 *  - Both width AND height are known (non-null, > 0)
 *  - min(width, height) <= STATIC_MAX_DIM (96px)
 *  - NOT a priority image (priority always uses the full pipeline for preload/LCP)
 */
export function isStaticAsset(
  width: number | undefined | null,
  height: number | undefined | null,
  priority: boolean,
): boolean {
  if (priority) return false;
  if (width == null || height == null || width <= 0 || height <= 0) return false;
  return Math.min(width, height) <= STATIC_MAX_DIM;
}

// ─── Styles ───────────────────────────────────────────────────

/**
 * Returns [placeholderStyle, imgStyle] for the given state.
 *
 * When `small` is true:
 *  - Placeholder style uses object-fit instead of background-image
 *    (rendered as <img> in TgImg for pixel-perfect geometry).
 *  - Blur/scale are suppressed regardless of resolved mode.
 */
export function computeStyles(
  resolved: ResolvedTransition,
  loaded: boolean,
  fit: string,
  placeholderUrl: string | null,
  small?: boolean,
): [CSSProperties, CSSProperties] {
  const off = resolved === 'off';
  // Small mode never uses blur/scale — only opacity crossfade.
  const reveal = resolved === 'reveal' && !small;

  // ── Placeholder ──
  const ph: CSSProperties = small
    ? {
        // Small: placeholder is an <img> — must match real image geometry.
        position: 'absolute',
        inset: 0,
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: fit as CSSProperties['objectFit'],
        objectPosition: 'center',
        opacity: loaded ? 0 : 1,
        zIndex: 1,
        pointerEvents: 'none',
        transition: off ? undefined : _crossfade,
      }
    : {
        // Large: placeholder is a <div> with background-image.
        position: 'absolute',
        inset: 0,
        backgroundImage: placeholderUrl ? `url(${placeholderUrl})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        opacity: loaded ? 0 : 1,
        zIndex: 1,
        pointerEvents: 'none',
        transition: off ? undefined : _crossfade,
      };

  // ── Image ──
  const img: CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    objectFit: fit as CSSProperties['objectFit'],
    objectPosition: 'center',
    opacity: loaded ? 1 : 0,
    filter: reveal ? (loaded ? 'blur(0px)' : _bOn) : undefined,
    transform: reveal ? (loaded ? 'scale(1)' : _sOn) : undefined,
    transition: off ? undefined : reveal ? _revealImg : _crossfade,
  };

  return [ph, img];
}
