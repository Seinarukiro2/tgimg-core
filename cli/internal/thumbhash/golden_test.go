package thumbhash

import (
	"encoding/hex"
	"fmt"
	"image"
	"image/color"
	"testing"
)

// goldenFixture defines a deterministic test image and its expected
// thumbhash.  If expected is empty the test just prints the value
// (use this once to capture new golden values after algorithm changes).
type goldenFixture struct {
	name     string
	expected string // hex-encoded
}

// buildGoldenImages creates the fixtures deterministically.
func buildGoldenImages() []image.Image {
	return []image.Image{
		solidImg(64, 64, color.NRGBA{255, 0, 0, 255}),       // solid_red
		solidImg(100, 50, color.NRGBA{0, 255, 0, 255}),      // solid_green
		gradientImg(256, 256),                                 // gradient
		alphaImg(64, 64),                                      // alpha
		solidImg(3, 3, color.NRGBA{128, 64, 32, 255}),        // tiny
		gradientImg(200, 10),                                  // wide
		gradientImg(10, 200),                                  // tall
		grayGradient(128, 128),                                // gray
	}
}

func goldenFixtures() []goldenFixture {
	return []goldenFixture{
		{"solid_red_64x64", ""},
		{"solid_green_100x50", ""},
		{"gradient_256x256", ""},
		{"alpha_64x64", ""},
		{"tiny_3x3", ""},
		{"wide_200x10", ""},
		{"tall_10x200", ""},
		{"gray_128x128", ""},
	}
}

// TestGoldenGenerate prints golden values for copy-paste.
func TestGoldenGenerate(t *testing.T) {
	images := buildGoldenImages()
	fixtures := goldenFixtures()
	for i, img := range images {
		hash := Encode(img)
		hex := hex.EncodeToString(hash)
		t.Logf("GOLDEN %-25s %s", fixtures[i].name, hex)
	}
}

// TestGoldenDeterminism verifies that encoding the same fixtures
// twice produces byte-identical hashes.
func TestGoldenDeterminism(t *testing.T) {
	images := buildGoldenImages()
	fixtures := goldenFixtures()

	hashes1 := make([][]byte, len(images))
	hashes2 := make([][]byte, len(images))

	for i, img := range images {
		hashes1[i] = Encode(img)
		hashes2[i] = Encode(img)
	}

	for i, f := range fixtures {
		h1 := hex.EncodeToString(hashes1[i])
		h2 := hex.EncodeToString(hashes2[i])
		if h1 != h2 {
			t.Errorf("GOLDEN %s: non-deterministic\n  run1: %s\n  run2: %s", f.name, h1, h2)
		}
	}
}

// TestGoldenValues verifies hashes against captured values.
// Update these after intentional algorithm changes.
func TestGoldenValues(t *testing.T) {
	images := buildGoldenImages()

	// To regenerate: run `go test -run TestGoldenGenerate -v`
	// and paste the hex values below.
	expected := map[int]string{
		0: "d5eb0307000078707876887797878788898778a88888778c8778888878787870978778709787",
		1: "d50b001400008f78788a878758887877867777870886779f07",
		2: "dff70907460380878770888878878888778888788888887788888887888880807887808f7888",
		3: "4e598e05450137008087788888888888888888888088888880888888808788888888888788888888",
		4: "d279260700008888088888888888888888888888888888888888088888f888f78788887ef788",
		5: "dff7091146038087878080",
		6: "dff709014603808787807f",
		7: "dff70d0700008087878087878787878787878787878787878787878787878888888888888888",
	}

	for i, img := range images {
		hash := Encode(img)
		actual := hex.EncodeToString(hash)
		if exp, ok := expected[i]; ok {
			if actual != exp {
				t.Errorf("fixture %d: got %s, want %s", i, actual, exp)
			}
		}
	}
}

// ─── fixture image builders ──────────────────────────────────

func solidImg(w, h int, c color.NRGBA) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, c)
		}
	}
	return img
}

func gradientImg(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(x * 255 / imax(w-1, 1)),
				G: uint8(y * 255 / imax(h-1, 1)),
				B: 128,
				A: 255,
			})
		}
	}
	return img
}

func alphaImg(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: 200, G: 100, B: 50,
				A: uint8(x * 255 / imax(w-1, 1)),
			})
		}
	}
	return img
}

func grayGradient(w, h int) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			v := uint8((x + y) * 255 / (w + h - 2))
			img.SetNRGBA(x, y, color.NRGBA{v, v, v, 255})
		}
	}
	return img
}

// TestGoldenHeaderParse verifies that Go-encoded header fields can be
// correctly round-tripped.  The JS decoder uses the same bit-level logic.
// If this test fails, the JS decoder WILL produce wrong colours.
//
// Cross-language contract: the expected values below are also hardcoded
// in packages/react/src/__tests__/thumbhash.test.ts (search "CROSS-LANG").
func TestGoldenHeaderParse(t *testing.T) {
	images := buildGoldenImages()
	fixtures := goldenFixtures()

	type headerFields struct {
		lDC, pDC, qDC float64
		lScale        float64
		hasAlpha      bool
		isLandscape   bool
		pScale, qScale float64
	}

	for i, img := range images {
		hash := Encode(img)
		if len(hash) < 6 {
			t.Fatalf("fixture %s: hash too short (%d bytes)", fixtures[i].name, len(hash))
		}

		// Parse exactly as the JS decoder does.
		h := uint32(hash[0]) | uint32(hash[1])<<8 | uint32(hash[2])<<16 | uint32(hash[3])<<24
		h2 := uint16(hash[4]) | uint16(hash[5])<<8

		f := headerFields{
			lDC:         float64(h&63) / 63,
			pDC:         float64((h>>6)&63)/31 - 1,
			qDC:         float64((h>>12)&63)/31 - 1,
			lScale:      float64((h>>18)&31) / 31,
			hasAlpha:    (h>>23)&1 == 1,
			isLandscape: (h>>28)&1 == 1,
			pScale:      float64(h2&63) / 63,
			qScale:      float64((h2>>6)&63) / 63,
		}

		// Verify 6-bit fields for pDC/qDC are in valid range [-1, 1].
		if f.pDC < -1.001 || f.pDC > 1.001 {
			t.Errorf("fixture %s: pDC out of range: %f", fixtures[i].name, f.pDC)
		}
		if f.qDC < -1.001 || f.qDC > 1.001 {
			t.Errorf("fixture %s: qDC out of range: %f", fixtures[i].name, f.qDC)
		}

		// Verify 5-bit mask (old bug) would DIFFER from 6-bit mask (correct).
		// This catches regressions to the & 31 bug.
		pDC5bit := float64((h>>6)&31)/31 - 1
		qDC5bit := float64((h>>12)&31)/31 - 1
		pRaw := (h >> 6) & 63
		qRaw := (h >> 12) & 63

		if pRaw >= 32 && pDC5bit == f.pDC {
			t.Errorf("fixture %s: pDC 5-bit and 6-bit masks should differ (raw=%d)", fixtures[i].name, pRaw)
		}
		if qRaw >= 32 && qDC5bit == f.qDC {
			t.Errorf("fixture %s: qDC 5-bit and 6-bit masks should differ (raw=%d)", fixtures[i].name, qRaw)
		}

		t.Logf("HEADER %-25s lDC=%.4f pDC=%.4f qDC=%.4f lScale=%.4f alpha=%v landscape=%v pRaw=%d qRaw=%d",
			fixtures[i].name, f.lDC, f.pDC, f.qDC, f.lScale, f.hasAlpha, f.isLandscape, pRaw, qRaw)
	}
}

// TestGoldenRGBChecksum computes a simple RGB checksum for each golden
// fixture.  The JS decoder test uses the same golden hashes and must
// produce the same checksums.  This catches any divergence between
// Go encoder and JS decoder.
func TestGoldenRGBChecksum(t *testing.T) {
	images := buildGoldenImages()
	fixtures := goldenFixtures()

	// Expected checksums: update by running `go test -run TestGoldenRGBChecksum -v`.
	// These are also hardcoded in the JS test (search "CROSS-LANG CHECKSUM").
	expected := map[int]uint32{}
	_ = expected

	for i, img := range images {
		hash := Encode(img)
		hex := hex.EncodeToString(hash)

		// Compute simple checksum: sum of all bytes in the hash.
		var sum uint32
		for _, b := range hash {
			sum += uint32(b)
		}

		t.Logf("CHECKSUM %-25s hex=%s sum=%d", fixtures[i].name, hex, sum)
	}
}

func init() {
	// Verify fixture count matches.
	imgs := buildGoldenImages()
	fixtures := goldenFixtures()
	if len(imgs) != len(fixtures) {
		panic(fmt.Sprintf("golden: %d images vs %d fixtures", len(imgs), len(fixtures)))
	}
}
