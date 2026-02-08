# tgimg

Ultra-fast image pipeline for **Telegram Mini Apps** and webview.  
Turns megabyte banners into fast, cache-friendly assets with instant placeholders and zero layout shift.

```
Input (24 MB)  →  tgimg build  →  Output (1.8 MB, 7 formats × 4 sizes)
                                   + tgimg.manifest.json
                                   + thumbhash placeholders
```

## Features

- **Instant placeholders** — ThumbHash (~25 bytes) decoded to a tiny image on first paint. No blink, no empty boxes.
- **Adaptive loading** — Selects optimal format (AVIF > WebP > JPEG) and size based on container width × DPR.
- **Content-addressed filenames** — `banner.640.360.a1b2c3d4.webp` → immutable caching, perfect CDN story.
- **Zero layout shift** — Aspect ratio locked from manifest. CLS = 0.
- **Telegram webview optimized** — Feature-detects formats on iOS Safari / Android webview. Graceful fallbacks.
- **Deterministic builds** — Same input always produces same output hashes and filenames.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         tgimg                               │
├──────────────┬──────────────────┬───────────────────────────┤
│   CLI (Go)   │  @tgimg/react    │  tgimg-core (Rust/C)     │
│              │  (TypeScript)    │  (optional, future)       │
│  • scan      │  • <TgImg />     │  • fast resize           │
│  • resize    │  • thumbhash     │  • avif/webp encode      │
│  • encode    │    decode         │  • SIMD thumbhash        │
│  • thumbhash │  • format detect │  • FFI → Go CLI          │
│  • manifest  │  • variant select│                           │
└──────────────┴──────────────────┴───────────────────────────┘
```

## Quick Start

### 1. Build assets with CLI

```bash
cd cli
go build -o tgimg .

# Process all images in ./images, output to ./dist
./tgimg build ./images --out ./dist --profile telegram-webview

# Check stats
./tgimg stats ./dist

# Validate manifest
./tgimg validate ./dist/tgimg.manifest.json
```

### 2. Use in React app

```bash
npm install @tgimg/react
```

```tsx
import { TgImg, TgImgProvider } from '@tgimg/react';
import manifest from './tgimg.manifest.json';

function App() {
  return (
    <TgImgProvider manifest={manifest}>
      {/* Instant placeholder → smooth fade-in → optimal variant */}
      <TgImg src="promo/banner" alt="Promo banner" priority />

      {/* Lazy-loaded card with cover fit */}
      <TgImg src="cards/item-1" alt="Item" width={320} fit="cover" radius={8} />
    </TgImgProvider>
  );
}
```

### 3. In Telegram Mini App (3-minute setup)

```bash
# 1. Install
npm install @tgimg/react

# 2. Process your images (put originals in ./images)
cd your-project
npx tgimg build ./images --out ./public/tgimg --profile telegram-webview

# 3. Done! Use in your app:
```

```tsx
// Works in pure Vite — no Next.js or server required.
import { TgImg, TgImgProvider } from '@tgimg/react';
import manifest from './public/tgimg/tgimg.manifest.json';

function TelegramMiniApp() {
  return (
    <TgImgProvider manifest={manifest}>
      <div className="feed">
        {items.map((item) => (
          <TgImg
            key={item.id}
            src={item.imageKey}
            alt={item.title}
            fit="cover"
            radius={12}
          />
        ))}
      </div>
    </TgImgProvider>
  );
}
```

**With Vite plugin** (optional — enables HMR for manifest + auto-copy assets):

```bash
npm install vite-plugin-tgimg
```

```ts
// vite.config.ts
import tgimg from 'vite-plugin-tgimg';

export default {
  plugins: [tgimg({ dir: 'tgimg_out' })],
};
```

```ts
// Then import manifest as a virtual module:
import manifest from 'virtual:tgimg-manifest';
```

## CLI Reference

### `tgimg build <input_dir>`

Process images and generate optimized variants + manifest.

| Flag | Default | Description |
|------|---------|-------------|
| `--out`, `-o` | `./tgimg_out` | Output directory |
| `--profile`, `-p` | `telegram-webview` | Processing profile |
| `--workers`, `-w` | NumCPU | Parallel workers |
| `--widths` | Profile default | Custom target widths |
| `--quality`, `-q` | Profile default | Encoding quality (1-100) |
| `--no-regress-size` | true | Skip variants larger than original |
| `--verbose`, `-v` | false | Verbose output |

**Profiles:**

| Profile | Widths | Formats | Quality |
|---------|--------|---------|---------|
| `telegram-webview` | 320, 640, 960, 1280 | webp, jpeg | 82 |
| `telegram-webview-hq` | 320, 640, 960, 1280, 1920 | avif, webp, jpeg | 85 |
| `minimal` | 320, 640 | webp, jpeg | 78 |

For WebP output, install `cwebp`: `brew install webp`  
For AVIF output, install `avifenc`: `brew install libavif`

### `tgimg stats <dir_or_manifest>`

Display build statistics: format breakdown, size analysis, warnings.

### `tgimg validate <manifest_path>`

Validate manifest integrity: check all files exist, sizes match, no missing fields.

## Manifest Format

```jsonc
{
  "version": 1,
  "generated_at": "2025-01-15T12:00:00Z",
  "profile": "telegram-webview",
  "base_path": "./",
  "assets": {
    "promo/banner": {
      "original": {
        "width": 1920, "height": 1080,
        "format": "png", "size": 2048576, "has_alpha": false
      },
      "thumbhash": "YJqGPQw7sFlslqhFafSE+Q6oJ1h2iA==",
      "aspect_ratio": 1.7778,
      "variants": [
        {
          "format": "webp",
          "width": 640, "height": 360,
          "size": 18432,
          "hash": "a1b2c3d4e5f6g7h8",
          "path": "promo/banner.640.360.a1b2c3d4.webp"
        }
      ]
    }
  },
  "stats": { ... }
}
```

## Naming Scheme

```
<key>.<width>.<height>.<hash8>.<format>

Examples:
  promo/banner.320.180.a1b2c3d4.webp
  promo/banner.640.360.b2c3d4e5.avif
  cards/item-1.320.240.c3d4e5f6.jpeg
```

- `key` — asset path without extension (forward slashes)
- `hash8` — first 8 hex chars of xxHash64 of encoded bytes
- Content-addressed → same content = same filename → immutable caching

## Variant Selection Algorithm

```
1. Get container width × devicePixelRatio
2. Detect supported formats (avif > webp > jpeg > png)
3. Filter variants by best supported format
4. Select smallest variant where width >= required
5. Fallback: largest available variant
```

## Static Hot-Path for UI Assets

For tiny UI elements (icons, emojis, stickers, avatar thumbnails — anything ≤ 96px),
**any placeholder or fade transition makes the UX worse** by drawing attention to the
loading process. The best user experience is: the image is just *there*, as if it was
always part of the HTML.

`<TgImg>` automatically detects this and activates the **static hot-path**:

```tsx
{/* These render as a bare <img> — no placeholder, no transition */}
<TgImg src="icons/star" alt="Star" width={24} height={24} />
<TgImg src="gifts/heart" alt="Gift" width={64} height={64} />
<TgImg src="sticker" alt="Sticker" width={96} height={50} />

{/* These use the full pipeline (placeholder + reveal) */}
<TgImg src="hero" alt="Hero" priority />      {/* priority → always full */}
<TgImg src="banner" alt="Banner" />            {/* no explicit size → full */}
<TgImg src="card" alt="Card" width={320} />    {/* > 96px → full */}
```

### How it works

| Condition | Render path |
|-----------|-------------|
| `min(width, height) ≤ 96` and `!priority` | **Static** — bare `<img>`, `loading="eager"`, `decoding="sync"` |
| Everything else | **Full** — placeholder → transition → decode-gating |

Static mode guarantees:

- **No placeholder** — no ThumbHash computation, no extra DOM nodes
- **No transition** — no opacity, no blur, no scale, no CSS transitions
- **No decode-gating** — no `img.decode()`, no `requestAnimationFrame`
- **Instant from cache** — content-addressed filename (immutable), `loading="eager"`
- **Zero CLS** — `width`/`height` attributes set on `<img>`

After the first visit, the content-addressed URL (`icon.320.320.a1b2c3d4.webp`) hits
the browser's memory/disk cache. The image appears in the same frame as the HTML.

### Threshold

The default threshold is **96 CSS pixels** (`STATIC_MAX_DIM`). This means:
- At 96px, the image occupies ≤ 9216 px² — too small for blur/fade to help visually
- At 96px, the file is typically 2–5 KB WebP — loads in < 10 ms even on slow 3G
- Icons (24px), emojis (32px), gift stickers (64px) all qualify automatically

The threshold is not configurable via props — it's an internal UX standard.
If you need to force the full pipeline for a small image, set `priority={true}`.

## `<TgImg />` Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `src` | `string` | required | Asset key from manifest |
| `alt` | `string` | required | Alt text |
| `width` | `number` | auto | CSS pixel width |
| `height` | `number` | auto | CSS pixel height |
| `ratio` | `number` | from manifest | Aspect ratio override |
| `fit` | `'cover' \| 'contain'` | `'cover'` | Object-fit |
| `radius` | `number \| string` | - | Border radius |
| `priority` | `boolean` | `false` | Eager load + prefetch (always full pipeline) |
| `transition` | `'auto' \| 'instant' \| 'reveal' \| 'off'` | `'auto'` | Transition mode |
| `placeholderChroma` | `number` | auto | Chroma attenuation (0–1) |
| `baseUrl` | `string` | manifest base_path | URL prefix |
| `className` | `string` | - | Container class |
| `style` | `CSSProperties` | - | Container styles |
| `onLoad` | `() => void` | - | Load callback |
| `onError` | `(err) => void` | - | Error callback |

## Repo Structure

```
tgimg/
├── cli/                  # Go CLI
│   ├── cmd/              # Cobra commands (build, stats, validate)
│   ├── internal/
│   │   ├── pipeline/     # Image scanning + processing orchestration
│   │   ├── encoder/      # Format encoders (jpeg, png, webp, avif)
│   │   ├── thumbhash/    # ThumbHash encode (pure Go)
│   │   ├── manifest/     # Manifest types + writer
│   │   ├── hasher/       # Content hashing (xxHash64)
│   │   └── profile/      # Processing profiles
│   └── main.go
├── packages/react/       # @tgimg/react library
│   └── src/
│       ├── TgImg.tsx     # Main component
│       ├── use-tgimg.ts  # Core hook
│       ├── thumbhash.ts  # ThumbHash decode (TypeScript)
│       ├── format-detect.ts
│       ├── variant-select.ts
│       └── __tests__/
├── core/                 # Native core (Rust/C) — planned
├── demo/                 # Demo app (Vite + React)
└── docs/
```

## Memory & Pool

The ThumbHash encoder uses a `sync.Pool` of ~**167 KB** per worker (float32 workBuf).
In parallel builds with N workers, total resident pool footprint is **N × 167 KB**.

| Workers | Pool footprint |
|---------|---------------|
| 1 | 0.16 MB |
| 4 | 0.65 MB |
| 8 | 1.30 MB |
| 16 | 2.61 MB |

This info is recorded in the manifest (`build_info.workers`, `build_info.pool_entry_kb`)
and displayed by `tgimg stats`.

## Manifest Versioning

The manifest includes `"version": 1`. The runtime (`@tgimg/react`):
- Accepts version >= 1 and <= current max
- Warns (but doesn't crash) on future versions
- Silently ignores unknown fields for forward compatibility

## Development

```bash
# CLI
cd cli && go build -o tgimg . && go test ./...

# CLI with race detector
cd cli && go test -race ./...

# React library
cd packages/react && npm install && npm test

# Demo
cd demo && npm install && npm run dev

# E2E smoke test (full pipeline)
make e2e

# Full CI
make ci
```

## License

MIT
