/**
 * Format detection for Telegram webview and iOS Safari.
 *
 * Uses 1x1 image probes to detect AVIF and WebP support.
 * Results are cached after first check to avoid repeated probes.
 */

import type { FormatSupport, ImageFormat } from './types';

/** Cached detection result. */
let _cached: FormatSupport | null = null;

/** Pending detection promise. */
let _pending: Promise<FormatSupport> | null = null;

// Minimal 1x1 test images (base64).
const WEBP_PROBE =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const AVIF_PROBE =
  'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADybWV0YQAAAAAAAAAoaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAGxpYmF2aWYAAAAADnBpdG0AAAAAAAEAAAAeaWxvYwAAAABEAAABAAEAAAABAAABGgAAAB0AAAAoaWluZgAAAAAAAQAAABppbmZlAgAAAAABAABhdjAxQ29sb3IAAAAAamlwcnAAAABLaXBjbwAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAAAxhdjFDgQ0MAAAAABNjb2xybmNseAACAAIAAYAAAAAXaXBtYQAAAAAAAAABAAEEAQKDBAAAACVtZGF0EgAKCBgANogQEAwgMg8f8D///8WfhwB8+ErZ';

/**
 * Probe whether the browser can decode a given image format.
 */
function probeFormat(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    // If not in browser context (SSR), return false.
    if (typeof Image === 'undefined') {
      resolve(false);
      return;
    }

    const img = new Image();
    img.onload = () => resolve(img.width > 0 && img.height > 0);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

/**
 * Detect supported image formats asynchronously.
 * Results are cached after first call.
 */
export async function detectFormats(): Promise<FormatSupport> {
  if (_cached) return _cached;
  if (_pending) return _pending;

  _pending = (async () => {
    const [avif, webp] = await Promise.all([
      probeFormat(AVIF_PROBE),
      probeFormat(WEBP_PROBE),
    ]);

    const result: FormatSupport = {
      avif,
      webp,
      jpeg: true, // always supported
      png: true,  // always supported
    };

    _cached = result;
    _pending = null;
    return result;
  })();

  return _pending;
}

/**
 * Get cached format support synchronously.
 * Returns null if detection hasn't completed yet.
 * Call detectFormats() first to trigger async detection.
 */
export function getFormatsSync(): FormatSupport | null {
  return _cached;
}

/**
 * Get the list of supported formats in priority order.
 * Returns the best format first: avif > webp > jpeg > png.
 */
export function getSupportedFormats(support: FormatSupport): ImageFormat[] {
  const result: ImageFormat[] = [];
  if (support.avif) result.push('avif');
  if (support.webp) result.push('webp');
  result.push('jpeg');
  result.push('png');
  return result;
}

/**
 * Reset cache (for testing).
 */
export function _resetFormatCache(): void {
  _cached = null;
  _pending = null;
}
