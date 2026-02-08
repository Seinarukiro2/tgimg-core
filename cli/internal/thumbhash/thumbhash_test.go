package thumbhash

import (
	"image"
	"image/color"
	"testing"
)

func TestEncode_Deterministic(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 8), G: uint8(y * 8), B: 128, A: 255,
			})
		}
	}

	h1 := Encode(img)
	h2 := Encode(img)

	if len(h1) == 0 {
		t.Fatal("empty hash")
	}
	if len(h1) != len(h2) {
		t.Fatalf("length mismatch: %d vs %d", len(h1), len(h2))
	}
	for i := range h1 {
		if h1[i] != h2[i] {
			t.Fatalf("byte %d differs: %02x vs %02x", i, h1[i], h2[i])
		}
	}
}

func TestEncode_SizeRange(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 64, 48))
	for y := 0; y < 48; y++ {
		for x := 0; x < 64; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x + y) % 256), G: uint8((x * 2) % 256),
				B: uint8((y * 3) % 256), A: 255,
			})
		}
	}

	hash := Encode(img)
	if len(hash) < 5 || len(hash) > 60 {
		t.Errorf("unexpected hash size: %d bytes", len(hash))
	}
}

func TestHasAlpha_Opaque(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 255, G: 0, B: 0, A: 255})
		}
	}
	if HasAlpha(img) {
		t.Error("opaque image reported as having alpha")
	}
}

func TestHasAlpha_Transparent(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 255, G: 0, B: 0, A: 128})
		}
	}
	if !HasAlpha(img) {
		t.Error("transparent image not detected")
	}
}

func TestHasAlpha_RGBA(t *testing.T) {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	for y := 0; y < 4; y++ {
		for x := 0; x < 4; x++ {
			img.SetRGBA(x, y, color.RGBA{R: 128, G: 0, B: 0, A: 128})
		}
	}
	if !HasAlpha(img) {
		t.Error("RGBA with alpha not detected")
	}
}

func TestHasAlpha_YCbCr(t *testing.T) {
	img := image.NewYCbCr(image.Rect(0, 0, 8, 8), image.YCbCrSubsampleRatio420)
	if HasAlpha(img) {
		t.Error("YCbCr should never report alpha")
	}
}

func TestHasAlpha_Gray(t *testing.T) {
	img := image.NewGray(image.Rect(0, 0, 8, 8))
	if HasAlpha(img) {
		t.Error("Gray should never report alpha")
	}
}

// Legacy benchmark (kept for backwards-compatibility in reporting).
func BenchmarkEncode(b *testing.B) {
	img := image.NewNRGBA(image.Rect(0, 0, 256, 256))
	for y := 0; y < 256; y++ {
		for x := 0; x < 256; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x), G: uint8(y), B: uint8((x + y) / 2), A: 255,
			})
		}
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}
