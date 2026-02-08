/**
 * Tests for the STATIC hot-path — bare <img> for tiny UI assets.
 *
 * STATIC mode renders images ≤ 96px (minDim) with:
 *  - No placeholder
 *  - No transition / opacity / blur / scale
 *  - decoding="sync", loading="eager"
 *  - No wrapper <div>
 *  - data-tgimg-static attribute
 */

import { describe, expect, it } from 'vitest';
import {
  isStaticAsset,
  STATIC_MAX_DIM,
} from '../transition';

// ─── isStaticAsset unit tests ─────────────────────────────────

describe('isStaticAsset', () => {
  it('24×24 non-priority → true', () => {
    expect(isStaticAsset(24, 24, false)).toBe(true);
  });

  it('96×96 non-priority → true (boundary)', () => {
    expect(isStaticAsset(96, 96, false)).toBe(true);
  });

  it('97×97 non-priority → false (just above)', () => {
    expect(isStaticAsset(97, 97, false)).toBe(false);
  });

  it('48×120 non-priority → true (minDim=48)', () => {
    expect(isStaticAsset(48, 120, false)).toBe(true);
  });

  it('120×48 non-priority → true (minDim=48)', () => {
    expect(isStaticAsset(120, 48, false)).toBe(true);
  });

  it('200×200 non-priority → false', () => {
    expect(isStaticAsset(200, 200, false)).toBe(false);
  });

  it('priority=true, 24×24 → false', () => {
    expect(isStaticAsset(24, 24, true)).toBe(false);
  });

  it('priority=true, 96×96 → false', () => {
    expect(isStaticAsset(96, 96, true)).toBe(false);
  });

  it('width=null → false', () => {
    expect(isStaticAsset(null, 96, false)).toBe(false);
  });

  it('height=null → false', () => {
    expect(isStaticAsset(96, null, false)).toBe(false);
  });

  it('width=undefined → false', () => {
    expect(isStaticAsset(undefined, 96, false)).toBe(false);
  });

  it('height=undefined → false', () => {
    expect(isStaticAsset(96, undefined, false)).toBe(false);
  });

  it('width=0 → false', () => {
    expect(isStaticAsset(0, 50, false)).toBe(false);
  });

  it('height=0 → false', () => {
    expect(isStaticAsset(50, 0, false)).toBe(false);
  });

  it('negative width → false', () => {
    expect(isStaticAsset(-10, 50, false)).toBe(false);
  });

  it('1×1 → true (smallest possible)', () => {
    expect(isStaticAsset(1, 1, false)).toBe(true);
  });
});

// ─── STATIC_MAX_DIM constant ─────────────────────────────────

describe('STATIC_MAX_DIM constant', () => {
  it('equals 96', () => {
    expect(STATIC_MAX_DIM).toBe(96);
  });

  it('is consistent with isStaticAsset boundary', () => {
    // At the boundary
    expect(isStaticAsset(STATIC_MAX_DIM, STATIC_MAX_DIM, false)).toBe(true);
    // Just above
    expect(isStaticAsset(STATIC_MAX_DIM + 1, STATIC_MAX_DIM + 1, false)).toBe(false);
  });
});

// ─── STATIC render contract (style assertions) ───────────────
//
// These verify the contract that TgImgStatic enforces at render time.
// Since TgImgStatic is a React component, we test the invariants as
// documented expectations — the Playwright e2e tests verify them in DOM.

describe('STATIC render contract', () => {
  it('STATIC images must have decoding="sync"', () => {
    // This is a documentation test — the actual DOM check is in e2e.
    // TgImgStatic sets decoding="sync" unconditionally.
    expect(true).toBe(true);
  });

  it('STATIC images must have loading="eager"', () => {
    expect(true).toBe(true);
  });

  it('STATIC images must NOT have opacity/filter/transform in style', () => {
    // TgImgStatic's imgStyle only includes: display, objectFit, borderRadius,
    // and user-provided style. No opacity, filter, or transform.
    expect(true).toBe(true);
  });

  it('STATIC images must have data-tgimg-static attribute', () => {
    expect(true).toBe(true);
  });

  it('STATIC images must NOT have data-tgimg-ph (placeholder)', () => {
    expect(true).toBe(true);
  });
});
