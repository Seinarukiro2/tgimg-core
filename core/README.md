# tgimg-core (Native Core)

Optional native performance core for tgimg. Provides hardware-accelerated image
encoding/decoding and thumbhash generation.

## Architecture

```
┌─────────────┐     FFI/cgo      ┌───────────────┐
│  Go CLI     │ ◄──────────────► │  tgimg-core   │
│  (tgimg)    │                  │  (Rust / C)   │
└─────────────┘                  └───────────────┘
```

## Planned Components

- **Resize**: Lanczos3 / Bilinear via `fast_image_resize` (Rust) or `stb_image_resize` (C)
- **WebP encode**: `libwebp` bindings
- **AVIF encode**: `libavif` / `rav1e` bindings
- **ThumbHash**: SIMD-optimized encode/decode
- **XXHash**: SIMD xxh3 for content hashing

## Build

```bash
# Rust path
cargo build --release
cbindgen --config cbindgen.toml --crate tgimg-core --output tgimg_core.h

# C path
make -C core/
```

## Integration

The Go CLI detects `libtgimg_core.{so,dylib,dll}` at runtime and falls back
to pure-Go implementations if the native library is absent. Zero configuration
required.

## Status

🔧 **Not yet implemented** — the pure-Go pipeline in `cli/` is fully functional.
This module will be added for 2-5× throughput improvement on large batches.
