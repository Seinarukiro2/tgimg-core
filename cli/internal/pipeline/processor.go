package pipeline

import (
	"encoding/base64"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"

	"github.com/AnyUserName/tgimg-cli/internal/encoder"
	"github.com/AnyUserName/tgimg-cli/internal/hasher"
	"github.com/AnyUserName/tgimg-cli/internal/manifest"
	"github.com/AnyUserName/tgimg-cli/internal/thumbhash"
	"github.com/disintegration/imaging"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"
)

// processResult holds the result of processing a single source image.
type processResult struct {
	key            string
	asset          manifest.Asset
	err            error
	skippedRegress int // variants skipped because larger than original
}

// processImage handles a single source image: decode, thumbhash, resize, encode.
func processImage(src Source, cfg Config, registry *encoder.Registry) processResult {
	result := processResult{key: src.Key}

	// Open and decode image.
	f, err := os.Open(src.AbsPath)
	if err != nil {
		result.err = fmt.Errorf("open %s: %w", src.RelPath, err)
		return result
	}
	defer f.Close()

	img, _, err := image.Decode(f)
	if err != nil {
		result.err = fmt.Errorf("decode %s: %w", src.RelPath, err)
		return result
	}

	bounds := img.Bounds()
	origW := bounds.Dx()
	origH := bounds.Dy()
	hasAlpha := thumbhash.HasAlpha(img)

	// Generate thumbhash.
	hash := thumbhash.Encode(img)
	thumbHashB64 := base64.StdEncoding.EncodeToString(hash)

	// Compute average color.
	avg := computeAvgColor(img)

	// Fill original info.
	result.asset = manifest.Asset{
		Original: manifest.OriginalInfo{
			Width:    origW,
			Height:   origH,
			Format:   src.Format,
			Size:     src.Size,
			HasAlpha: hasAlpha,
		},
		ThumbHash:   thumbHashB64,
		AspectRatio: float64(origW) / float64(origH),
		AvgColor:    &avg,
	}

	// Determine target widths.
	widths := cfg.Profile.EffectiveWidths(origW)

	// Determine output formats.
	formats := registry.ResolveFormats(cfg.Profile.Formats, hasAlpha)

	// Ensure output subdirectory exists.
	keyDir := filepath.Dir(src.Key)
	if keyDir != "." {
		os.MkdirAll(filepath.Join(cfg.OutputDir, keyDir), 0o755)
	}

	// Generate variants.
	for _, w := range widths {
		// Calculate proportional height.
		h := int(float64(origH) * float64(w) / float64(origW))
		if h < 1 {
			h = 1
		}

		// Resize.
		resized := imaging.Resize(img, w, h, imaging.Lanczos)

		for _, format := range formats {
			enc := registry.Get(format)
			if enc == nil {
				continue
			}

			// Encode.
			data, err := enc.Encode(resized, cfg.Profile.Quality)
			if err != nil {
				if cfg.Verbose {
					fmt.Fprintf(os.Stderr, "[tgimg] warn: encode %s@%dx%d as %s: %v\n",
						src.Key, w, h, format, err)
				}
				continue
			}

			// Skip variant if encoded size >= original (--no-regress-size).
			if cfg.NoRegressSize && int64(len(data)) >= src.Size {
				if cfg.Verbose {
					fmt.Fprintf(os.Stderr, "[tgimg] skip: %s@%dx%d %s — encoded %d >= original %d bytes\n",
						src.Key, w, h, format, len(data), src.Size)
				}
				result.skippedRegress++
				continue
			}

			// Content hash for filename.
			contentHash := hasher.ContentHash(data, 16)

			// Build filename: key.w.h.hash.ext
			fileName := fmt.Sprintf("%s.%d.%d.%s.%s",
				filepath.Base(src.Key), w, h, contentHash[:8], enc.Extension())
			relPath := filepath.ToSlash(filepath.Join(keyDir, fileName))

			// Write file.
			outPath := filepath.Join(cfg.OutputDir, relPath)
			if err := os.WriteFile(outPath, data, 0o644); err != nil {
				result.err = fmt.Errorf("write %s: %w", relPath, err)
				return result
			}

			result.asset.Variants = append(result.asset.Variants, manifest.Variant{
				Format: format,
				Width:  w,
				Height: h,
				Size:   int64(len(data)),
				Hash:   contentHash,
				Path:   relPath,
			})
		}
	}

	return result
}

// computeAvgColor calculates the average RGB color of an image.
func computeAvgColor(img image.Image) [3]uint8 {
	bounds := img.Bounds()
	w := uint64(bounds.Dx())
	h := uint64(bounds.Dy())
	count := w * h
	if count == 0 {
		return [3]uint8{0, 0, 0}
	}
	var rSum, gSum, bSum uint64
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			rSum += uint64(r >> 8)
			gSum += uint64(g >> 8)
			bSum += uint64(b >> 8)
		}
	}
	return [3]uint8{
		uint8(rSum / count),
		uint8(gSum / count),
		uint8(bSum / count),
	}
}
