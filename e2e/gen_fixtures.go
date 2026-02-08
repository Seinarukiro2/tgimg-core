//go:build ignore

// gen_fixtures creates small test images for the E2E smoke test.
// Usage: go run gen_fixtures.go <output_dir>
package main

import (
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: gen_fixtures <output_dir>")
		os.Exit(1)
	}
	dir := os.Args[1]
	os.MkdirAll(filepath.Join(dir, "cards"), 0o755)

	// Banner (JPEG, 400x225)
	writeJPEG(filepath.Join(dir, "banner.jpg"), gradient(400, 225))

	// Cards (PNG, 200x150 each)
	for i := 1; i <= 3; i++ {
		name := fmt.Sprintf("card-%d.png", i)
		writeImage(filepath.Join(dir, "cards", name), solidWithBorder(200, 150, uint8(i*60)))
	}

	// Small alpha image
	writeImage(filepath.Join(dir, "logo.png"), alphaGradient(100, 100))

	fmt.Fprintf(os.Stderr, "[gen_fixtures] created 5 fixtures in %s\n", dir)
}

func gradient(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 255 / w),
				G: uint8(y * 255 / h),
				B: 128,
				A: 255,
			})
		}
	}
	return img
}

func solidWithBorder(w, h int, base uint8) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.NRGBA{R: base, G: base + 40, B: base + 80, A: 255}
			if x < 4 || x >= w-4 || y < 4 || y >= h-4 {
				c = color.NRGBA{R: 255, G: 255, B: 255, A: 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func alphaGradient(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: 220, G: 60, B: 30,
				A: uint8(x * 255 / w),
			})
		}
	}
	return img
}

func writeImage(path string, img *image.NRGBA) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := png.Encode(f, img); err != nil {
		panic(err)
	}
}

func writeJPEG(path string, img *image.NRGBA) {
	f, err := os.Create(path)
	if err != nil {
		panic(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 85}); err != nil {
		panic(err)
	}
}
