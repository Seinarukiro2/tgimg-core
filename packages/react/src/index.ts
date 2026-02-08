// @tgimg/react — Ultra-fast image component for Telegram Mini Apps.

// Core component.
export { TgImg, TgImgProvider } from './TgImg';

// Hooks.
export { useTgImg } from './use-tgimg';
export { useManifest, useAsset, ManifestContext, validateManifestVersion } from './manifest';

// Utilities.
export { selectVariant, buildSrcSet } from './variant-select';
export {
  thumbHashToRGBA,
  thumbHashToDataURL,
  base64ToUint8Array,
} from './thumbhash';
export {
  detectFormats,
  getFormatsSync,
  getSupportedFormats,
} from './format-detect';

// Transition.
export {
  resolveTransition,
  isSmallImage,
  isStaticAsset,
  INSTANT_AREA_THRESHOLD,
  INSTANT_MIN_DIM_THRESHOLD,
  SMALL_DIM_THRESHOLD,
  STATIC_MAX_DIM,
  CHROMA_DEFAULT,
  CHROMA_REVEAL,
  CHROMA_INSTANT,
} from './transition';
export type { TransitionMode, ResolvedTransition } from './transition';

// Types.
export type {
  TgImgManifest,
  TgImgAsset,
  TgImgVariant,
  TgImgStats,
  TgImgProps,
  ImageFormat,
  FormatSupport,
} from './types';
export { MANIFEST_VERSION_MIN, MANIFEST_VERSION_MAX } from './types';
