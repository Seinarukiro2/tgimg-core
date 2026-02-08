import { describe, expect, it } from 'vitest';
import type { FormatSupport, TgImgVariant } from '../types';
import { selectVariant, buildSrcSet } from '../variant-select';

// Helper to create test variants.
function makeVariant(
  format: string,
  width: number,
  height: number,
): TgImgVariant {
  return {
    format,
    width,
    height,
    size: width * height * 0.1,
    hash: `hash_${format}_${width}`,
    path: `test.${width}.${height}.hash.${format}`,
  };
}

const ALL_FORMATS: FormatSupport = {
  avif: true,
  webp: true,
  jpeg: true,
  png: true,
};

const NO_AVIF: FormatSupport = {
  avif: false,
  webp: true,
  jpeg: true,
  png: true,
};

const JPEG_ONLY: FormatSupport = {
  avif: false,
  webp: false,
  jpeg: true,
  png: true,
};

const variants: TgImgVariant[] = [
  makeVariant('avif', 320, 180),
  makeVariant('avif', 640, 360),
  makeVariant('avif', 960, 540),
  makeVariant('avif', 1280, 720),
  makeVariant('webp', 320, 180),
  makeVariant('webp', 640, 360),
  makeVariant('webp', 960, 540),
  makeVariant('webp', 1280, 720),
  makeVariant('jpeg', 320, 180),
  makeVariant('jpeg', 640, 360),
  makeVariant('jpeg', 960, 540),
  makeVariant('jpeg', 1280, 720),
];

describe('selectVariant', () => {
  it('selects avif when supported', () => {
    const result = selectVariant({
      variants,
      containerWidth: 300,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    expect(result).not.toBeNull();
    expect(result!.format).toBe('avif');
    expect(result!.variant.width).toBe(320);
  });

  it('falls back to webp when avif not supported', () => {
    const result = selectVariant({
      variants,
      containerWidth: 300,
      dpr: 1,
      formats: NO_AVIF,
    });

    expect(result!.format).toBe('webp');
  });

  it('falls back to jpeg when only jpeg supported', () => {
    const result = selectVariant({
      variants,
      containerWidth: 300,
      dpr: 1,
      formats: JPEG_ONLY,
    });

    expect(result!.format).toBe('jpeg');
  });

  it('accounts for DPR in width selection', () => {
    const result = selectVariant({
      variants,
      containerWidth: 300,
      dpr: 2,
      formats: ALL_FORMATS,
    });

    // 300 * 2 = 600 → needs >= 600, so 640
    expect(result!.variant.width).toBe(640);
  });

  it('selects smallest variant >= required width', () => {
    const result = selectVariant({
      variants,
      containerWidth: 500,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    // 500 → needs >= 500, so 640
    expect(result!.variant.width).toBe(640);
  });

  it('falls back to largest when none is big enough', () => {
    const result = selectVariant({
      variants,
      containerWidth: 2000,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    expect(result!.variant.width).toBe(1280);
  });

  it('returns null for empty variants', () => {
    const result = selectVariant({
      variants: [],
      containerWidth: 300,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    expect(result).toBeNull();
  });

  it('handles exact width match', () => {
    const result = selectVariant({
      variants,
      containerWidth: 640,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    expect(result!.variant.width).toBe(640);
  });

  it('prefers avif over webp at same width', () => {
    const result = selectVariant({
      variants,
      containerWidth: 320,
      dpr: 1,
      formats: ALL_FORMATS,
    });

    expect(result!.format).toBe('avif');
    expect(result!.variant.width).toBe(320);
  });
});

describe('buildSrcSet', () => {
  it('builds srcset with best format', () => {
    const srcSet = buildSrcSet(variants, ALL_FORMATS, './');

    expect(srcSet).not.toBeNull();
    expect(srcSet).toContain('avif');
    expect(srcSet).toContain('320w');
    expect(srcSet).toContain('640w');
    expect(srcSet).toContain('960w');
    expect(srcSet).toContain('1280w');
  });

  it('falls back format in srcset', () => {
    const srcSet = buildSrcSet(variants, NO_AVIF, './');

    expect(srcSet).not.toBeNull();
    expect(srcSet).toContain('webp');
    expect(srcSet).not.toContain('avif');
  });

  it('handles empty variants', () => {
    const srcSet = buildSrcSet([], ALL_FORMATS, './');
    expect(srcSet).toBeNull();
  });

  it('prepends base URL', () => {
    const srcSet = buildSrcSet(variants, ALL_FORMATS, '/assets/');

    expect(srcSet).toContain('/assets/test.');
  });
});
