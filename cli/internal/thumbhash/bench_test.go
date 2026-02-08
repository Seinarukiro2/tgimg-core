package thumbhash

import (
	"bytes"
	"image"
	"image/color"
	"runtime"
	"sync"
	"testing"
)

// ─── test image generators ───────────────────────────────────

func makeNRGBA(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8((x * 251) % 256),
				G: uint8((y * 179) % 256),
				B: uint8(((x + y) * 113) % 256),
				A: 255,
			})
		}
	}
	return img
}

func makeRGBA(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r := uint8((x * 251) % 256)
			g := uint8((y * 179) % 256)
			b := uint8(((x + y) * 113) % 256)
			img.SetRGBA(x, y, color.RGBA{R: r, G: g, B: b, A: 255})
		}
	}
	return img
}

func makeYCbCr(w, h int) *image.YCbCr {
	img := image.NewYCbCr(image.Rect(0, 0, w, h), image.YCbCrSubsampleRatio420)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			yi := y*img.YStride + x
			img.Y[yi] = uint8((x*3 + y*7) % 256)
		}
	}
	cw := (w + 1) / 2
	ch := (h + 1) / 2
	for cy := 0; cy < ch; cy++ {
		for cx := 0; cx < cw; cx++ {
			ci := cy*img.CStride + cx
			img.Cb[ci] = uint8((cx*11 + cy*13) % 256)
			img.Cr[ci] = uint8((cx*17 + cy*19) % 256)
		}
	}
	return img
}

func makeGray(w, h int) *image.Gray {
	img := image.NewGray(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetGray(x, y, color.Gray{Y: uint8((x*7 + y*11) % 256)})
		}
	}
	return img
}

func makeNRGBAAlpha(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: 200, G: 100, B: 50,
				A: uint8((x * 3) % 256),
			})
		}
	}
	return img
}

// ─── benchmarks: input-size scaling ──────────────────────────

func BenchmarkEncode_128(b *testing.B) {
	img := makeNRGBA(128, 128)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_256(b *testing.B) {
	img := makeNRGBA(256, 256)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_512(b *testing.B) {
	img := makeNRGBA(512, 512)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_1024(b *testing.B) {
	img := makeNRGBA(1024, 1024)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_1920x1080(b *testing.B) {
	img := makeNRGBA(1920, 1080)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

// ─── benchmarks: image types ────────────────────────────────

func BenchmarkEncode_RGBA_512(b *testing.B) {
	img := makeRGBA(512, 512)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_YCbCr_1920(b *testing.B) {
	img := makeYCbCr(1920, 1080)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

func BenchmarkEncode_Gray_512(b *testing.B) {
	img := makeGray(512, 512)
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = Encode(img)
	}
}

// ─── determinism: concurrent ─────────────────────────────────

func TestDeterminism_Concurrent(t *testing.T) {
	img := makeNRGBA(512, 512)
	reference := Encode(img)

	const workers = 32
	const iterations = 50
	var wg sync.WaitGroup
	errCh := make(chan string, workers*iterations)

	for w := 0; w < workers; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				result := Encode(img)
				if !bytes.Equal(result, reference) {
					errCh <- "mismatch"
				}
			}
		}()
	}
	wg.Wait()
	close(errCh)

	mismatches := 0
	for range errCh {
		mismatches++
	}
	if mismatches > 0 {
		t.Fatalf("determinism failed: %d/%d mismatches across %d workers",
			mismatches, workers*iterations, workers)
	}
	t.Logf("OK: %d workers * %d iterations = %d hashes — all identical (%d bytes)",
		workers, iterations, workers*iterations, len(reference))
}

func TestDeterminism_OrderIndependent(t *testing.T) {
	images := make([]*image.NRGBA, 20)
	for i := range images {
		images[i] = makeNRGBA(200+i*50, 150+i*30)
	}

	pass1 := make([][]byte, len(images))
	for i, img := range images {
		pass1[i] = Encode(img)
	}

	pass2 := make([][]byte, len(images))
	for i := len(images) - 1; i >= 0; i-- {
		pass2[i] = Encode(images[i])
	}

	pass3 := make([][]byte, len(images))
	var wg sync.WaitGroup
	for i, img := range images {
		wg.Add(1)
		go func(idx int, im *image.NRGBA) {
			defer wg.Done()
			pass3[idx] = Encode(im)
		}(i, img)
	}
	wg.Wait()

	for i := range images {
		if !bytes.Equal(pass1[i], pass2[i]) {
			t.Errorf("image %d: pass1 != pass2 (order-dependent)", i)
		}
		if !bytes.Equal(pass1[i], pass3[i]) {
			t.Errorf("image %d: pass1 != pass3 (concurrency-dependent)", i)
		}
	}
}

// ─── determinism: image types produce identical hash ─────────

func TestDeterminism_ImageTypes(t *testing.T) {
	// Create the same visual content as NRGBA, RGBA, and generic.
	w, h := 64, 48
	nrgba := makeNRGBA(w, h)
	rgba := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := nrgba.NRGBAAt(x, y)
			rgba.SetRGBA(x, y, color.RGBA{R: c.R, G: c.G, B: c.B, A: c.A})
		}
	}

	h1 := Encode(nrgba)
	h2 := Encode(rgba)

	if !bytes.Equal(h1, h2) {
		t.Errorf("NRGBA and RGBA produce different hashes for same opaque content\n  NRGBA: %x\n  RGBA:  %x", h1, h2)
	}
}

// ─── correctness: no panic on odd/edge sizes ─────────────────

func TestNoPanic_OddSizes(t *testing.T) {
	sizes := [][2]int{
		{1, 1}, {1, 2}, {2, 1}, {3, 3},
		{7, 13}, {13, 7}, {99, 1}, {1, 99},
		{100, 100}, {101, 101}, {256, 1}, {1, 256},
		{1920, 1}, {1, 1080}, {3, 4000}, {4000, 3},
		{0, 0}, {0, 100}, {100, 0},
	}

	for _, s := range sizes {
		w, h := s[0], s[1]
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("panic at %dx%d: %v", w, h, r)
				}
			}()
			img := image.NewNRGBA(image.Rect(0, 0, w, h))
			for y := 0; y < h; y++ {
				for x := 0; x < w; x++ {
					img.SetNRGBA(x, y, color.NRGBA{
						R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255,
					})
				}
			}
			hash := Encode(img)
			if w > 0 && h > 0 && len(hash) == 0 {
				t.Errorf("%dx%d: expected non-empty hash", w, h)
			}
			if (w == 0 || h == 0) && hash != nil {
				t.Errorf("%dx%d: expected nil hash", w, h)
			}
		}()
	}
}

// ─── correctness: downscale quality sanity ──────────────────

func TestDownscaleQuality(t *testing.T) {
	// A solid-colour image should produce a thumbhash that decodes
	// to approximately the same solid colour.  We just verify the
	// hash is non-empty and deterministic (the visual quality test
	// is left to the TS decode side).
	img := image.NewNRGBA(image.Rect(0, 0, 800, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 800; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 180, G: 60, B: 30, A: 255})
		}
	}

	h1 := Encode(img)
	h2 := Encode(img)

	if len(h1) == 0 {
		t.Fatal("empty hash for solid image")
	}
	if !bytes.Equal(h1, h2) {
		t.Fatal("non-deterministic for identical solid image")
	}
}

// ─── correctness: image type fast paths ─────────────────────

func TestEncode_YCbCr(t *testing.T) {
	img := makeYCbCr(640, 480)
	hash := Encode(img)
	if len(hash) == 0 {
		t.Fatal("empty hash for YCbCr")
	}
	// Determinism.
	if !bytes.Equal(hash, Encode(img)) {
		t.Fatal("non-deterministic YCbCr hash")
	}
}

func TestEncode_Gray(t *testing.T) {
	img := makeGray(320, 240)
	hash := Encode(img)
	if len(hash) == 0 {
		t.Fatal("empty hash for Gray")
	}
	if !bytes.Equal(hash, Encode(img)) {
		t.Fatal("non-deterministic Gray hash")
	}
}

func TestEncode_WithAlpha(t *testing.T) {
	img := makeNRGBAAlpha(128, 96)
	hash := Encode(img)
	if len(hash) == 0 {
		t.Fatal("empty hash for alpha image")
	}
	// Bit 23 of header = hasAlpha.
	if (hash[2]>>7)&1 != 1 {
		t.Error("hasAlpha bit not set")
	}
	if !bytes.Equal(hash, Encode(img)) {
		t.Fatal("non-deterministic alpha hash")
	}
}

// ─── memory: no leak ─────────────────────────────────────────

func TestMemoryStability_Batch(t *testing.T) {
	img := makeNRGBA(512, 512)

	// Warmup pool.
	for i := 0; i < 10; i++ {
		_ = Encode(img)
	}

	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)

	const n = 500
	for i := 0; i < n; i++ {
		_ = Encode(img)
	}

	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)

	heapGrowth := int64(after.HeapAlloc) - int64(before.HeapAlloc)
	totalAlloc := after.TotalAlloc - before.TotalAlloc

	t.Logf("batch %d images:", n)
	t.Logf("  heap growth after GC: %d KB", heapGrowth/1024)
	t.Logf("  total allocated:      %d KB  (%.1f KB/image)", totalAlloc/1024, float64(totalAlloc)/1024/n)
	t.Logf("  GC cycles:            %d", after.NumGC-before.NumGC)

	if heapGrowth > 5*1024*1024 {
		t.Errorf("heap grew by %d MB — possible leak", heapGrowth/(1024*1024))
	}
}
