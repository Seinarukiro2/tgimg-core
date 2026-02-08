/**
 * Core hook for the TgImg component.
 *
 * Render behaviour:
 *  1. First paint  — placeholderUrl is computed synchronously (useMemo),
 *                    so the thumbhash background is visible on the very first frame.
 *  2. Layout phase — useLayoutEffect attaches the ResizeObserver so the
 *                    container width is available before the browser paints.
 *  3. Async        — format detection runs once (cached globally), variant
 *                    selection + image load follow.
 *
 * Re-render budget (for a list of 50 <TgImg>):
 *  - Initial mount:    1 render (placeholder visible)
 *  - Format detection:  1 render (shared, so only 1 setState for all instances)
 *  - Container sized:   1 render (variant selected, <img> src set)
 *  - Image decoded:     1 render (fade-in)
 *  Total: 4 renders per component, 0 cascade.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { detectFormats, getFormatsSync } from './format-detect';
import { base64ToUint8Array, thumbHashToDataURL } from './thumbhash';
import type { FormatSupport, TgImgAsset } from './types';
import { selectVariant } from './variant-select';

// SSR-safe useLayoutEffect: falls back to useEffect on the server.
const useIsomorphicLayoutEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export interface UseTgImgOptions {
  asset: TgImgAsset | undefined;
  priority: boolean;
  baseUrl: string;
  /** Chroma attenuation for placeholder (0 = grayscale, 1 = full color). */
  chroma?: number;
  /** Target avg_color from manifest — enables adaptive chroma + bias correction. */
  avgColor?: readonly number[];
}

export interface UseTgImgResult {
  containerRef: React.RefCallback<HTMLElement>;
  placeholderUrl: string | null;
  imgSrc: string | null;
  srcSet: string | null;
  loaded: boolean;
  /** Measured container width in CSS px (0 until first measurement). */
  containerWidth: number;
  aspectRatio: number;
  onImgLoad: () => void;
  error: Error | null;
}

// ─── shared format detection (one probe for all instances) ────

let _formatPromise: Promise<FormatSupport> | null = null;

function ensureFormatDetection(
  set: (f: FormatSupport) => void,
): void {
  const cached = getFormatsSync();
  if (cached) {
    set(cached);
    return;
  }
  if (!_formatPromise) {
    _formatPromise = detectFormats();
  }
  _formatPromise.then(set);
}

// ─── hook ─────────────────────────────────────────────────────

export function useTgImg(options: UseTgImgOptions): UseTgImgResult {
  const { asset, priority, baseUrl, chroma, avgColor } = options;

  // --- Format detection (one global probe, cached) ---
  const [formats, setFormats] = useState<FormatSupport | null>(getFormatsSync);

  useEffect(() => {
    if (!formats) ensureFormatDetection(setFormats);
  }, [formats]);

  // --- Container size (useLayoutEffect → measured before paint) ---
  const [containerWidth, setContainerWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((node: HTMLElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!node) return;

    // Synchronous measurement — available before browser paints.
    const w = node.getBoundingClientRect().width;
    if (w > 0) setContainerWidth(w);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const inlineSize =
          entry.contentBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
        if (inlineSize > 0) setContainerWidth(inlineSize);
      });
      ro.observe(node);
      observerRef.current = ro;
    }
  }, []);

  // Cleanup observer on unmount.
  useIsomorphicLayoutEffect(() => {
    return () => observerRef.current?.disconnect();
  }, []);

  // --- Placeholder (synchronous — visible on first paint) ---
  // CRITICAL INVARIANT: this is useMemo (NOT useEffect / useState + useEffect).
  // The computed URL is available in the return value of the very first render,
  // so the <div style="background-image: url(...)"> is painted immediately.
  // ResizeObserver / format detection do NOT block this.
  const placeholderUrl = useMemo(() => {
    if (!asset?.thumbhash) return null;
    try {
      return thumbHashToDataURL(base64ToUint8Array(asset.thumbhash), chroma, avgColor);
    } catch {
      return null;
    }
  }, [asset?.thumbhash, chroma, avgColor]);

  // --- Variant selection (pure, memoised) ---
  const dpr =
    typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const selection = useMemo(() => {
    if (!asset || !formats || containerWidth <= 0) return null;
    return selectVariant({
      variants: asset.variants,
      containerWidth,
      dpr,
      formats,
    });
  }, [asset, formats, containerWidth, dpr]);

  const imgSrc = useMemo(() => {
    if (!selection) return null;
    return `${baseUrl}${selection.variant.path}`;
  }, [selection, baseUrl]);

  // srcset: all widths of the chosen format.
  const srcSet = useMemo(() => {
    if (!asset || !selection) return null;
    const fmt = selection.format;
    const candidates = asset.variants.filter((v) => v.format === fmt);
    if (candidates.length === 0) return null;
    return candidates
      .sort((a, b) => a.width - b.width)
      .map((v) => `${baseUrl}${v.path} ${v.width}w`)
      .join(', ');
  }, [asset, selection, baseUrl]);

  // --- Loading state ---
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const prevSrc = useRef(imgSrc);

  // Reset only when src actually changes (avoid spurious re-renders).
  if (prevSrc.current !== imgSrc) {
    prevSrc.current = imgSrc;
    if (loaded) setLoaded(false);
    if (error) setError(null);
  }

  const onImgLoad = useCallback(() => setLoaded(true), []);

  // --- Prefetch for priority images ---
  useEffect(() => {
    if (!priority || !imgSrc || typeof document === 'undefined') return;
    const existing = document.querySelector(
      `link[rel="preload"][href="${CSS.escape(imgSrc)}"]`,
    );
    if (existing) return;

    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = imgSrc;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [priority, imgSrc]);

  return {
    containerRef,
    placeholderUrl,
    imgSrc,
    srcSet,
    loaded,
    containerWidth,
    aspectRatio: asset?.aspect_ratio ?? 16 / 9,
    onImgLoad,
    error,
  };
}
