/**
 * Manifest versioning and schema compatibility tests.
 *
 * Verifies:
 * - Version 1 manifests are accepted
 * - Future versions (>max) produce a warning, not a crash
 * - Ancient/invalid versions are rejected
 * - Unknown fields are silently ignored (forward compat)
 */

import { describe, expect, it } from 'vitest';
import { validateManifestVersion } from '../manifest';
import type { TgImgManifest } from '../types';
import { MANIFEST_VERSION_MIN, MANIFEST_VERSION_MAX } from '../types';

function makeManifest(overrides: Partial<TgImgManifest> = {}): TgImgManifest {
  return {
    version: 1,
    generated_at: '2025-01-15T12:00:00Z',
    profile: 'telegram-webview',
    base_path: './',
    assets: {},
    stats: {
      total_input_bytes: 0,
      total_output_bytes: 0,
      total_assets: 0,
      total_variants: 0,
    },
    ...overrides,
  };
}

describe('manifest version validation', () => {
  it('accepts version 1 (current)', () => {
    const m = makeManifest({ version: 1 });
    expect(validateManifestVersion(m)).toBeNull();
  });

  it('rejects version 0', () => {
    const m = makeManifest({ version: 0 });
    const err = validateManifestVersion(m);
    expect(err).toContain('Unsupported manifest version');
  });

  it('rejects negative version', () => {
    const m = makeManifest({ version: -1 });
    const err = validateManifestVersion(m);
    expect(err).toContain('Unsupported');
  });

  it('warns on future version (> max)', () => {
    const m = makeManifest({ version: MANIFEST_VERSION_MAX + 1 });
    const err = validateManifestVersion(m);
    expect(err).toContain('newer than this runtime');
    expect(err).toContain('Update @tgimg/react');
  });

  it('exports version constants', () => {
    expect(MANIFEST_VERSION_MIN).toBe(1);
    expect(MANIFEST_VERSION_MAX).toBe(1);
  });
});

describe('manifest forward compatibility', () => {
  it('ignores unknown fields in manifest', () => {
    const m = makeManifest();
    // Simulate future field — TypeScript allows extra fields at runtime.
    (m as any).new_future_field = 'hello';
    (m as any).build_info = { workers: 8, pool_entry_kb: 167 };

    expect(validateManifestVersion(m)).toBeNull();
  });

  it('ignores unknown fields in stats', () => {
    const m = makeManifest();
    (m.stats as any).new_metric = 42;

    expect(validateManifestVersion(m)).toBeNull();
  });
});

describe('manifest schema roundtrip', () => {
  it('serializes and deserializes correctly', () => {
    const m = makeManifest({
      assets: {
        'test/image': {
          original: { width: 800, height: 600, format: 'jpeg', size: 100000, has_alpha: false },
          thumbhash: 'YJqGPQw7sFlslqhFafSE+Q6oJ1h2iA==',
          aspect_ratio: 1.3333,
          variants: [
            { format: 'webp', width: 320, height: 240, size: 5000, hash: 'abcd1234', path: 'test/image.320.240.abcd1234.webp' },
          ],
        },
      },
    });

    const json = JSON.stringify(m);
    const parsed = JSON.parse(json) as TgImgManifest;

    expect(parsed.version).toBe(1);
    expect(parsed.assets['test/image']?.thumbhash).toBe(m.assets['test/image']?.thumbhash);
    expect(parsed.assets['test/image']?.variants).toHaveLength(1);
    expect(validateManifestVersion(parsed)).toBeNull();
  });
});
