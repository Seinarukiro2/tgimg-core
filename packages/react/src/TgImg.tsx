/**
 * <TgImg /> — zero-blink image component for Telegram Mini Apps.
 *
 * Renders an instant thumbhash placeholder (with chroma attenuation for
 * neutral tones), observes container size, selects the optimal variant
 * (format + resolution), and transitions to the real image once decoded.
 *
 * Transition modes:
 *  - "auto"    — instant for small UI elements, reveal for large photos.
 *  - "instant" — micro-crossfade 80ms (opacity only, no blur/scale).
 *  - "reveal"  — 80ms opacity + 140ms blur-to-sharp.
 *  - "off"     — no transition.
 *
 * Static hot-path (auto):
 *  Images with min(width, height) <= 96px and !priority render as a bare
 *  <img> with no placeholder, no transition, no decode-gating — instant
 *  from cache, indistinguishable from native HTML.
 *
 * Small images (minDim < 72): pixel-perfect placeholder as <img>,
 * no blur/scale, double-rAF commit to avoid blink.
 */

import React, { memo, useContext, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { ManifestContext, validateManifestVersion } from './manifest';
import {
  CHROMA_DEFAULT,
  CHROMA_INSTANT,
  CHROMA_REVEAL,
  computeStyles,
  isSmallImage,
  isStaticAsset,
  resolveTransition,
} from './transition';
import type { TgImgAsset, TgImgManifest, TgImgProps } from './types';
import { useTgImg } from './use-tgimg';

// ─── Provider ─────────────────────────────────────────────────

/**
 * Provider that supplies the tgimg manifest to all nested <TgImg /> components.
 */
export function TgImgProvider({
  manifest,
  children,
}: {
  manifest: TgImgManifest;
  children: React.ReactNode;
}) {
  // One-time version check (warn, don't crash — forward compatibility).
  const warned = useRef(false);
  if (!warned.current) {
    warned.current = true;
    const err = validateManifestVersion(manifest);
    if (err) console.warn(err);
  }

  return (
    <ManifestContext.Provider value={manifest}>
      {children}
    </ManifestContext.Provider>
  );
}

// ─── Component (thin wrapper — dispatches to Static or Full) ──

/**
 * Image component with instant placeholder and adaptive loading.
 *
 * @example
 * ```tsx
 * <TgImgProvider manifest={manifest}>
 *   <TgImg src="promo/banner" alt="Promo" />
 *   <TgImg src="cards/item-1" alt="Item" width={320} fit="cover" />
 *   <TgImg src="hero" alt="Hero" priority transition="reveal" />
 *   <TgImg src="icons/star" alt="Star" width={24} height={24} />
 * </TgImgProvider>
 * ```
 */
export const TgImg = memo(function TgImg(
  props: TgImgProps & { manifest?: TgImgManifest },
) {
  const {
    src,
    alt,
    width,
    height,
    priority = false,
    className,
    style,
    manifest: directManifest,
  } = props;

  // ── Resolve manifest (always — useContext count must be stable) ──
  const contextManifest = useContext(ManifestContext);
  const manifest = directManifest ?? contextManifest;

  if (!manifest) {
    if (
      typeof globalThis !== 'undefined' &&
      (globalThis as any).__DEV__ !== false
    ) {
      console.warn(
        `[tgimg] No manifest for "${src}". Provide via <TgImgProvider> or manifest prop.`,
      );
    }
    return <img src="" alt={alt} className={className} style={style} />;
  }

  const asset = manifest.assets[src];
  const baseUrl = props.baseUrl ?? manifest.base_path ?? './';

  // ── Static hot-path: bare <img>, no hooks beyond useContext ──
  // Conditions: known dimensions, minDim <= 96, not priority.
  if (
    isStaticAsset(width, height, priority) &&
    asset != null &&
    asset.variants.length > 0
  ) {
    return (
      <TgImgStatic
        {...props}
        manifest={manifest}
        asset={asset}
        baseUrl={baseUrl}
      />
    );
  }

  // ── Full pipeline (placeholder + transition + decode-gating) ──
  return <TgImgFull {...props} manifest={manifest} />;
});

TgImg.displayName = 'TgImg';

// ─── Static hot-path ──────────────────────────────────────────

/**
 * Static image — no placeholder, no transition, no decode-gating.
 *
 * Renders a bare <img> with:
 *  - `loading="eager"` — start fetching immediately
 *  - `decoding="sync"` — decode in the current frame
 *  - content-addressed src (immutable) — instant from cache on reload
 *  - width/height attributes — prevents CLS
 *  - NO wrapper div, NO inline opacity/transform
 *
 * This path is for tiny UI assets (icons, emojis, stickers ≤ 96px)
 * where any placeholder or animation would draw unwanted attention.
 */
const TgImgStatic = memo(function TgImgStatic({
  src,
  alt,
  width,
  height,
  fit = 'cover',
  radius,
  className,
  style,
  baseUrl,
  asset,
  onLoad,
  onError,
}: TgImgProps & {
  manifest: TgImgManifest;
  asset: TgImgAsset;
  baseUrl: string;
}) {
  // Pick the smallest variant — for ≤96px images this is the optimal choice.
  // No async format detection needed: WebP is universally supported (99%+),
  // and the tiny file size makes any format fast.
  const variant = asset.variants.reduce(
    (min, v) => (v.size < min.size ? v : min),
    asset.variants[0]!,
  );

  const resolvedSrc = `${baseUrl}${variant.path}`;

  const imgStyle = useMemo(
    (): CSSProperties => ({
      display: 'block',
      objectFit: fit as CSSProperties['objectFit'],
      borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
      ...style,
    }),
    [fit, radius, style],
  );

  return (
    <img
      src={resolvedSrc}
      width={width!}
      height={height!}
      alt={alt ?? ''}
      loading="eager"
      decoding="sync"
      className={className}
      style={imgStyle}
      data-tgimg={src}
      data-tgimg-static=""
      onLoad={onLoad ? () => onLoad() : undefined}
      onError={
        onError
          ? () => onError(new Error(`[tgimg] Failed to load: ${src}`))
          : undefined
      }
    />
  );
});

TgImgStatic.displayName = 'TgImgStatic';

// ─── Full pipeline (placeholder + transition + decode) ────────

const TgImgFull = memo(function TgImgFull(
  props: TgImgProps & { manifest: TgImgManifest },
) {
  const {
    src,
    alt,
    width,
    height,
    ratio,
    fit = 'cover',
    radius,
    priority = false,
    className,
    style,
    transition: transitionProp = 'auto',
    placeholderChroma: chromaProp,
    baseUrl: baseUrlProp,
    manifest,
    onLoad,
    onError,
  } = props;

  const asset = manifest.assets[src];
  const baseUrl = baseUrlProp ?? manifest.base_path ?? './';

  // ── Chroma selection (before useTgImg) ──
  const hasUserChroma = chromaProp != null;
  const propsArea = width && height ? width * height : null;
  const propsMinDim = width && height ? Math.min(width, height) : null;
  const earlyResolved = resolveTransition(transitionProp, propsArea, propsMinDim);
  const modeChroma =
    earlyResolved === 'instant'
      ? CHROMA_INSTANT
      : earlyResolved === 'reveal'
        ? CHROMA_REVEAL
        : CHROMA_DEFAULT;
  const effectiveChroma = hasUserChroma
    ? Math.max(0, Math.min(1, chromaProp))
    : modeChroma;

  const adaptiveAvgColor = !hasUserChroma ? asset?.avg_color : undefined;

  const {
    containerRef,
    placeholderUrl,
    imgSrc,
    srcSet,
    loaded,
    containerWidth,
    aspectRatio: manifestRatio,
    onImgLoad,
  } = useTgImg({ asset, priority, baseUrl, chroma: effectiveChroma, avgColor: adaptiveAvgColor });

  // ── Aspect ratio ──
  const aspectRatio =
    ratio ?? (width && height ? width / height : manifestRatio);

  // ── Resolve transition mode (final, with container measurement) ──
  const containerHeight =
    containerWidth > 0 && aspectRatio > 0
      ? containerWidth / aspectRatio
      : 0;

  const area =
    width && height
      ? width * height
      : containerWidth > 0
        ? containerWidth * containerHeight
        : null;

  const minDim =
    width && height
      ? Math.min(width, height)
      : containerWidth > 0 && containerHeight > 0
        ? Math.min(containerWidth, containerHeight)
        : null;

  const resolved = resolveTransition(transitionProp, area, minDim);

  // ── Small-image mode (pixel-perfect placeholder, no blur) ──
  const small = isSmallImage(minDim);

  // ── Race condition guard: ignore stale decode callbacks ──
  const srcGuardRef = useRef(imgSrc);
  srcGuardRef.current = imgSrc;

  // ── Container styles ──
  const containerStyle = useMemo(
    (): React.CSSProperties => ({
      position: 'relative',
      overflow: 'hidden',
      width: width ? `${width}px` : '100%',
      aspectRatio: height ? undefined : `${aspectRatio}`,
      height: height ? `${height}px` : undefined,
      borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
      ...style,
    }),
    [width, height, aspectRatio, radius, style],
  );

  // ── Placeholder + img styles (pure, memoised) ──
  const [pStyle, iStyle] = useMemo(
    () => computeStyles(resolved, loaded, fit, placeholderUrl, small),
    [resolved, loaded, fit, placeholderUrl, small],
  );

  // ── Load handler: decode() + stale-src guard + double-rAF for small ──
  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const capturedSrc = imgSrc;

    const commit = () => {
      if (srcGuardRef.current !== capturedSrc) return;
      onImgLoad();
      onLoad?.();
    };

    const finalCommit = small
      ? () => requestAnimationFrame(() => requestAnimationFrame(commit))
      : commit;

    if (typeof img.decode === 'function') {
      img.decode().then(finalCommit).catch(finalCommit);
    } else {
      finalCommit();
    }
  };

  const handleError = () => {
    onError?.(new Error(`[tgimg] Failed to load: ${src}`));
  };

  // ── Render ──
  return (
    <div
      ref={containerRef}
      className={className ? `tgimg ${className}` : 'tgimg'}
      style={containerStyle}
      data-tgimg={src}
    >
      {/* Placeholder — small: <img> for pixel-perfect geometry; large: <div> */}
      {small ? (
        <img
          className="tgimg__placeholder"
          data-tgimg-ph=""
          src={placeholderUrl ?? undefined}
          alt=""
          style={pStyle}
          aria-hidden="true"
        />
      ) : (
        <div
          className="tgimg__placeholder"
          data-tgimg-ph=""
          style={pStyle}
          aria-hidden="true"
        />
      )}

      {/* Real image — rendered once variant is selected */}
      {imgSrc && (
        <img
          src={imgSrc}
          srcSet={srcSet ?? undefined}
          sizes={width ? `${width}px` : '100vw'}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          style={iStyle}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  );
});

TgImgFull.displayName = 'TgImgFull';
