# tgimg Performance Report

> Measured on the playground demo (13 real images — photos, stickers, logos).
> Lab environment: Vite preview, Chromium, localhost.

---

## Summary

| Metric | Before (raw `<img>`) | After (`<TgImg>`) | Delta |
|--------|---------------------|--------------------|-------|
| **Total bytes** | 1.62 MB | 154.4 KB | **-91%** |
| **Requests per card** | 1 (full original) | 1 (best variant) | same count, -91% weight |
| **Placeholder** | none (grey block) | instant thumbhash | **no blink** |
| **CLS** | > 0 (no aspect-ratio) | **0.00** | fixed |
| **LCP (lab)** | ~1200 ms | **< 800 ms** | **-30%+** |
| **Console errors** | 0 | 0 | clean |

---

## Per-asset breakdown

| Asset | Original | Size | Best variant | Size | Format | Saving |
|-------|----------|-----:|--------------|-----:|--------|-------:|
| card-abstract | 800x600 JPEG | 61.4 KB | 320x240 | 11.3 KB | WebP | -82% |
| card-nature | 800x600 JPEG | 110.6 KB | 320x240 | 25.9 KB | WebP | -77% |
| card-ocean | 800x600 JPEG | 29.3 KB | 320x240 | 4.1 KB | WebP | -86% |
| city-night | 1600x900 JPEG | 155.7 KB | 320x180 | 13.4 KB | WebP | -91% |
| food-closeup | 1200x800 JPEG | 94.1 KB | 320x213 | 12.8 KB | WebP | -86% |
| hero-landscape | 1920x1080 JPEG | 299.3 KB | 320x180 | 8.7 KB | WebP | -97% |
| icon-github | 560x560 PNG | 7.1 KB | 320x320 | 2.8 KB | WebP | -60% |
| logo-transparent | 544x184 PNG | 13.2 KB | 320x108 | 7.9 KB | JPEG | -40% |
| mountain | 2048x1365 JPEG | 755.8 KB | 320x213 | 22.3 KB | WebP | -97% |
| portrait | 600x900 JPEG | 52.9 KB | 320x480 | 16.7 KB | WebP | -68% |
| small-thumb | 400x400 JPEG | 26.9 KB | 320x320 | 17.1 KB | WebP | -36% |
| stickers-large | 302x160 PNG | 34.5 KB | 302x160 | 7.2 KB | JPEG | -79% |
| stickers-small | 159x84 PNG | 13.9 KB | 159x84 | 4.1 KB | JPEG | -70% |

> "Best variant" = smallest variant selected for a 320px-wide mobile viewport.
> On wider screens, TgImg selects a larger variant automatically via ResizeObserver + DPR.

---

## What "before" looks like

Without tgimg, a typical Telegram Mini App loads images as-is:

- **Grey blocks** while JPEG/PNG loads over the network
- **Layout shift (CLS > 0)** — no `aspect-ratio` set, images pop in
- **Full originals** sent to every device (1920x1080 JPEG on a 320px phone)
- **No format selection** — PNG where WebP would be 3x smaller

## What "after" looks like

With `<TgImg>`:

1. **Instant placeholder** — ThumbHash decoded synchronously in `useMemo` (< 1ms).
   Placeholder appears on the first paint frame, zero delay.

2. **Zero CLS** — container has `aspect-ratio` from manifest before any image loads.

3. **Adaptive variant** — ResizeObserver measures the actual container, picks the
   closest width >= required, prefers WebP (or AVIF if supported).

4. **Smooth transition** — `img.decode()` completes, then:
   - Small images (< 72px min dim): 80ms opacity crossfade, no blur.
   - Large images: 80ms opacity + 140ms blur-to-sharp reveal.

5. **Content-addressed caching** — filenames like `card-ocean.320.240.71df819f.webp`
   with `Cache-Control: immutable`. Deploy new images without cache busting.

---

## E2E verification (Playwright)

The following checks run in CI on every commit:

| Test | What it checks | Status |
|------|---------------|--------|
| `placeholders are visible before images load` | Block all image requests, verify ThumbHash placeholder divs have `background-image` or `src` with `data:` URL and non-zero layout | PASS |
| `cumulative layout shift is zero` | PerformanceObserver `layout-shift` entries sum ≤ 0.01 after full page load + scroll | PASS |
| `at most 1 image request per asset` | Count network requests per asset key. Non-priority assets: exactly 1. Priority (hero): ≤ 2 (immediate + optimal after ResizeObserver) | PASS |
| `LCP is under 2.5s` | PerformanceObserver `largest-contentful-paint` < 2500ms | PASS |
| `page loads without console errors` | No `console.error` or unhandled exceptions | PASS |

---

## Runtime bundle

| Module | Raw | Gzip |
|--------|----:|-----:|
| `@tgimg/react` (ESM) | 22.7 KB | ~6.8 KB |

Includes: ThumbHash decoder, BMP encoder, adaptive chroma + bias, variant selection,
ResizeObserver, AVIF/WebP feature detection, transition system. Zero external dependencies.

---

## Build pipeline

| Metric | Value |
|--------|-------|
| CLI build time (13 images) | ~2.3s |
| Workers | 12 (auto = CPU count) |
| Pool footprint | ~2.0 MB (12 x 167 KB) |
| ThumbHash generation | ~1.2 ms / image (M3 Pro) |
| Output variants | 56 (WebP + JPEG + PNG for alpha) |
| Manifest size | 10 KB |

---

## How to reproduce

```bash
cd playground

# 1. Download test images + build CLI + process
bash setup.sh

# 2. Run e2e perf tests
npm run e2e

# 3. Or start dev server and inspect manually
npm run dev
```
