/**
 * Manifest context — provides the tgimg manifest to all TgImg components.
 */

import { createContext, useContext } from 'react';
import type { TgImgAsset, TgImgManifest } from './types';
import { MANIFEST_VERSION_MIN, MANIFEST_VERSION_MAX } from './types';

/** React context for the manifest data. */
export const ManifestContext = createContext<TgImgManifest | null>(null);

/**
 * Hook to access the manifest from context.
 * Throws if no manifest is provided via TgImgProvider.
 */
export function useManifest(): TgImgManifest {
  const manifest = useContext(ManifestContext);
  if (!manifest) {
    throw new Error(
      '[tgimg] No manifest found. Wrap your app in <TgImgProvider manifest={...}>.',
    );
  }
  return manifest;
}

/**
 * Hook to look up a single asset by key.
 * Returns undefined if not found.
 */
export function useAsset(key: string): TgImgAsset | undefined {
  const manifest = useManifest();
  return manifest.assets[key];
}

/**
 * Resolve an asset from either a direct manifest prop or context.
 */
export function resolveAsset(
  key: string,
  directManifest?: TgImgManifest | null,
  contextManifest?: TgImgManifest | null,
): TgImgAsset | undefined {
  const manifest = directManifest ?? contextManifest;
  if (!manifest) return undefined;
  return manifest.assets[key];
}

/**
 * Validate manifest version compatibility.
 * Returns null if OK, or an error message string.
 * The runtime accepts versions in [MANIFEST_VERSION_MIN, MANIFEST_VERSION_MAX]
 * and silently ignores unknown fields for forward compatibility.
 */
export function validateManifestVersion(manifest: TgImgManifest): string | null {
  const v = manifest.version;
  if (typeof v !== 'number' || v < MANIFEST_VERSION_MIN) {
    return `[tgimg] Unsupported manifest version: ${v}. Minimum supported: ${MANIFEST_VERSION_MIN}.`;
  }
  if (v > MANIFEST_VERSION_MAX) {
    return `[tgimg] Manifest version ${v} is newer than this runtime supports (max ${MANIFEST_VERSION_MAX}). Update @tgimg/react.`;
  }
  return null;
}
