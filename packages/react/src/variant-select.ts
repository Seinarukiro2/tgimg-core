/**
 * Variant selection algorithm.
 *
 * Given a container size, DPR, and supported formats — picks the
 * optimal image variant from the manifest. Prefers:
 *   1. Best supported format (avif > webp > jpeg > png)
 *   2. Smallest width >= required width
 *   3. Falls back to largest available if none is big enough
 */

import type { FormatSupport, ImageFormat, TgImgVariant } from './types';

/** Format priority (lower = better). */
const FORMAT_PRIORITY: Record<string, number> = {
  avif: 0,
  webp: 1,
  jpeg: 2,
  png: 3,
};

export interface SelectionInput {
  /** All variants for the asset. */
  variants: TgImgVariant[];
  /** Container width in CSS pixels. */
  containerWidth: number;
  /** Device pixel ratio. */
  dpr: number;
  /** Browser format support. */
  formats: FormatSupport;
}

export interface SelectionResult {
  /** Selected variant. */
  variant: TgImgVariant;
  /** The format that was chosen. */
  format: ImageFormat;
  /** Effective pixel width requested. */
  requestedWidth: number;
}

/**
 * Select the best variant for the current context.
 */
export function selectVariant(input: SelectionInput): SelectionResult | null {
  const { variants, containerWidth, dpr, formats } = input;

  if (variants.length === 0) return null;

  const requiredWidth = Math.ceil(containerWidth * dpr);

  // Determine best supported format.
  const formatOrder = getFormatOrder(formats);

  // Try each format in priority order.
  for (const format of formatOrder) {
    const candidates = variants.filter((v) => v.format === format);
    if (candidates.length === 0) continue;

    // Sort by width ascending.
    candidates.sort((a, b) => a.width - b.width);

    // Find smallest variant >= required width.
    let selected = candidates.find((v) => v.width >= requiredWidth);

    // Fallback: use largest available.
    if (!selected) {
      selected = candidates[candidates.length - 1]!;
    }

    return {
      variant: selected,
      format: format as ImageFormat,
      requestedWidth: requiredWidth,
    };
  }

  // Absolute fallback: pick the first variant.
  return {
    variant: variants[0]!,
    format: variants[0]!.format as ImageFormat,
    requestedWidth: requiredWidth,
  };
}

/**
 * Get formats in priority order, filtered by browser support.
 */
function getFormatOrder(formats: FormatSupport): string[] {
  const all: [string, number][] = [];

  for (const [fmt, supported] of Object.entries(formats)) {
    if (supported) {
      all.push([fmt, FORMAT_PRIORITY[fmt] ?? 99]);
    }
  }

  all.sort((a, b) => a[1] - b[1]);
  return all.map(([fmt]) => fmt);
}

/**
 * Compute the set of srcset entries for a given asset,
 * filtered by the best supported format.
 * Useful for generating <img srcset="...">.
 */
export function buildSrcSet(
  variants: TgImgVariant[],
  formats: FormatSupport,
  baseUrl: string,
): string | null {
  const formatOrder = getFormatOrder(formats);

  for (const format of formatOrder) {
    const candidates = variants
      .filter((v) => v.format === format)
      .sort((a, b) => a.width - b.width);

    if (candidates.length === 0) continue;

    return candidates
      .map((v) => `${baseUrl}${v.path} ${v.width}w`)
      .join(', ');
  }

  return null;
}
