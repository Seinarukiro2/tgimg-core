// Package thumbhash implements the ThumbHash algorithm for compact image
// placeholders.  Based on Evan Wallace's reference implementation.
//
// Performance design:
//   - float32 throughout (sufficient for 4-bit nibble output, halves pool size)
//   - sync.Pool for ~167 KB workBuf → 1 alloc/op (only the returned hash)
//   - Integer accumulation in all downscale loops (no per-pixel float conv)
//   - LUT-based YCbCr→RGB with direct subsample addressing (420/422/444)
//   - Fast paths: NRGBA, RGBA, YCbCr, Gray — zero image.At calls
//   - Pre-computed cosine tables, pure multiply-add DCT
//   - Deterministic: identical input → identical output regardless of parallelism
package thumbhash

import (
	"image"
	"image/color"
	"math"
	"sync"
)

const maxThumbDim = 100

// ─── YCbCr → RGB lookup tables ───────────────────────────────
// Pre-computed at init.  4 tables × 256 × 4 bytes = 4 KB.
// Avoids per-pixel floating-point in the JPEG hot path.
var (
	ycbcrCrR [256]int32 // R = Y + ycbcrCrR[Cr]
	ycbcrCbG [256]int32 // G = Y - ycbcrCbG[Cb] - ycbcrCrG[Cr]
	ycbcrCrG [256]int32
	ycbcrCbB [256]int32 // B = Y + ycbcrCbB[Cb]
)

func init() {
	for i := 0; i < 256; i++ {
		v := float64(i) - 128.0
		ycbcrCrR[i] = int32(math.Round(1.40200 * v))
		ycbcrCbG[i] = int32(math.Round(0.34414 * v))
		ycbcrCrG[i] = int32(math.Round(0.71414 * v))
		ycbcrCbB[i] = int32(math.Round(1.77200 * v))
	}
}

// ─── work buffer + pool ──────────────────────────────────────
// float32 throughout.  Total ~167 KB per pool entry (half of float64).
type workBuf struct {
	rgba [maxThumbDim * maxThumbDim * 4]float32 // 160 KB
	cosX [8 * maxThumbDim]float32               // 3.2 KB
	cosY [8 * maxThumbDim]float32               // 3.2 KB
	ac   [128]float32                           // 0.5 KB
}

var wbPool = sync.Pool{New: func() any { return new(workBuf) }}

// ─── public API ────────────────────────────────────────────────

// Encode generates a ThumbHash from any image.Image.
// Output: 20–35 bytes.  Deterministic for identical input.
// Steady-state allocations: 1 per call (the returned []byte).
func Encode(img image.Image) []byte {
	bounds := img.Bounds()
	srcW, srcH := bounds.Dx(), bounds.Dy()
	if srcW <= 0 || srcH <= 0 {
		return nil
	}

	dstW, dstH := thumbDims(srcW, srcH)

	wb := wbPool.Get().(*workBuf)
	n := dstW * dstH * 4
	zeroF32(wb.rgba[:n])

	if srcW <= dstW && srcH <= dstH {
		extractPixels(img, bounds, dstW, dstH, wb.rgba[:n])
	} else {
		areaDownscale(img, bounds, srcW, srcH, dstW, dstH, wb.rgba[:n])
	}

	hash := assembleHash(dstW, dstH, wb)
	wbPool.Put(wb)
	return hash
}

func thumbDims(srcW, srcH int) (int, int) {
	if srcW <= maxThumbDim && srcH <= maxThumbDim {
		return srcW, srcH
	}
	if srcW >= srcH {
		return maxThumbDim, max1(srcH * maxThumbDim / srcW)
	}
	return max1(srcW * maxThumbDim / srcH), maxThumbDim
}

// ─── area downsample (destination-order, integer accumulation) ─

func areaDownscale(img image.Image, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	switch src := img.(type) {
	case *image.NRGBA:
		dsNRGBA(src, bounds, srcW, srcH, dstW, dstH, rgba)
	case *image.RGBA:
		dsRGBA(src, bounds, srcW, srcH, dstW, dstH, rgba)
	case *image.YCbCr:
		dsYCbCr(src, bounds, srcW, srcH, dstW, dstH, rgba)
	case *image.Gray:
		dsGray(src, bounds, srcW, srcH, dstW, dstH, rgba)
	default:
		dsGeneric(img, bounds, srcW, srcH, dstW, dstH, rgba)
	}
}

// dsNRGBA — non-premultiplied RGBA (PNG). uint32 accumulation.
func dsNRGBA(src *image.NRGBA, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	pix := src.Pix
	stride := src.Stride
	bY := bounds.Min.Y - src.Rect.Min.Y
	bX4 := (bounds.Min.X - src.Rect.Min.X) * 4

	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)

			var rS, gS, bS, aS uint32
			for sy := sy0; sy < sy1; sy++ {
				off := (bY+sy)*stride + bX4 + sx0*4
				for range sx1 - sx0 {
					rS += uint32(pix[off])
					gS += uint32(pix[off+1])
					bS += uint32(pix[off+2])
					aS += uint32(pix[off+3])
					off += 4
				}
			}

			inv := float32(1) / (float32((sy1-sy0)*(sx1-sx0)) * 255)
			di := (dy*dstW + dx) * 4
			rgba[di] = float32(rS) * inv
			rgba[di+1] = float32(gS) * inv
			rgba[di+2] = float32(bS) * inv
			rgba[di+3] = float32(aS) * inv
		}
	}
}

// dsRGBA — premultiplied RGBA. uint32 accumulation + un-premultiply.
func dsRGBA(src *image.RGBA, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	pix := src.Pix
	stride := src.Stride
	bY := bounds.Min.Y - src.Rect.Min.Y
	bX4 := (bounds.Min.X - src.Rect.Min.X) * 4

	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)

			var rS, gS, bS, aS uint32
			for sy := sy0; sy < sy1; sy++ {
				off := (bY+sy)*stride + bX4 + sx0*4
				for range sx1 - sx0 {
					rS += uint32(pix[off])
					gS += uint32(pix[off+1])
					bS += uint32(pix[off+2])
					aS += uint32(pix[off+3])
					off += 4
				}
			}

			di := (dy*dstW + dx) * 4
			if aS > 0 {
				aF := float32(aS)
				rgba[di] = float32(rS) / aF
				rgba[di+1] = float32(gS) / aF
				rgba[di+2] = float32(bS) / aF
			}
			rgba[di+3] = float32(aS) / (float32((sy1-sy0)*(sx1-sx0)) * 255)
		}
	}
}

// ─── YCbCr fast paths (LUT + direct subsample addressing) ────

func dsYCbCr(src *image.YCbCr, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	switch src.SubsampleRatio {
	case image.YCbCrSubsampleRatio420:
		dsYCbCr420(src, bounds, srcW, srcH, dstW, dstH, rgba)
	case image.YCbCrSubsampleRatio422:
		dsYCbCr422(src, bounds, srcW, srcH, dstW, dstH, rgba)
	default: // 444, 440, 411, 410
		dsYCbCrAny(src, bounds, srcW, srcH, dstW, dstH, rgba)
	}
}

// dsYCbCr420 — most common JPEG subsampling.
// Two-pass for cache efficiency:
//   Pass 1: downsample Y plane (sequential byte reads, 4-wide unrolled)
//   Pass 2: downsample Cb/Cr at half res, convert Y/Cb/Cr → RGB per dest pixel
func dsYCbCr420(src *image.YCbCr, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	yData := src.Y
	cbData := src.Cb
	crData := src.Cr
	yStride := src.YStride
	cStride := src.CStride

	yBY := bounds.Min.Y - src.Rect.Min.Y
	yBX := bounds.Min.X - src.Rect.Min.X

	// Pass 1: downsample Y.
	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)
			var yS uint32
			for sy := sy0; sy < sy1; sy++ {
				off := (yBY+sy)*yStride + yBX + sx0
				n := sx1 - sx0
				// 4-wide unroll for better pipelining.
				for ; n >= 4; n -= 4 {
					yS += uint32(yData[off]) + uint32(yData[off+1]) +
						uint32(yData[off+2]) + uint32(yData[off+3])
					off += 4
				}
				for ; n > 0; n-- {
					yS += uint32(yData[off])
					off++
				}
			}
			rgba[(dy*dstW+dx)*4] = float32(yS) / float32((sy1-sy0)*(sx1-sx0))
		}
	}

	// Chroma dimensions for 420.
	cSrcW := (srcW + 1) >> 1
	cSrcH := (srcH + 1) >> 1
	cBY := bounds.Min.Y/2 - src.Rect.Min.Y/2
	cBX := bounds.Min.X/2 - src.Rect.Min.X/2

	// Pass 2: downsample Cb/Cr + convert.
	for dy := 0; dy < dstH; dy++ {
		csy0, csy1 := srcSpan(dy, dstH, cSrcH)
		for dx := 0; dx < dstW; dx++ {
			csx0, csx1 := srcSpan(dx, dstW, cSrcW)

			var cbS, crS uint32
			for csy := csy0; csy < csy1; csy++ {
				off := (cBY+csy)*cStride + cBX + csx0
				for range csx1 - csx0 {
					cbS += uint32(cbData[off])
					crS += uint32(crData[off])
					off++
				}
			}

			cnt := float32((csy1 - csy0) * (csx1 - csx0))
			cb := float32(cbS)/cnt - 128
			cr := float32(crS)/cnt - 128

			di := (dy*dstW + dx) * 4
			y := rgba[di]

			rgba[di] = clamp01f((y + 1.402*cr) / 255)
			rgba[di+1] = clamp01f((y - 0.34414*cb - 0.71414*cr) / 255)
			rgba[di+2] = clamp01f((y + 1.772*cb) / 255)
			rgba[di+3] = 1
		}
	}
}

// dsYCbCr422 — half-width chroma, full-height.
func dsYCbCr422(src *image.YCbCr, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	yData := src.Y
	cbData := src.Cb
	crData := src.Cr
	yStride := src.YStride
	cStride := src.CStride

	yBY := bounds.Min.Y - src.Rect.Min.Y
	yBX := bounds.Min.X - src.Rect.Min.X

	// Pass 1: downsample Y.
	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)
			var yS uint32
			for sy := sy0; sy < sy1; sy++ {
				off := (yBY+sy)*yStride + yBX + sx0
				n := sx1 - sx0
				for ; n >= 4; n -= 4 {
					yS += uint32(yData[off]) + uint32(yData[off+1]) +
						uint32(yData[off+2]) + uint32(yData[off+3])
					off += 4
				}
				for ; n > 0; n-- {
					yS += uint32(yData[off])
					off++
				}
			}
			rgba[(dy*dstW+dx)*4] = float32(yS) / float32((sy1-sy0)*(sx1-sx0))
		}
	}

	cSrcW := (srcW + 1) >> 1
	cSrcH := srcH
	cBY := bounds.Min.Y - src.Rect.Min.Y
	cBX := bounds.Min.X/2 - src.Rect.Min.X/2

	// Pass 2: downsample Cb/Cr + convert.
	for dy := 0; dy < dstH; dy++ {
		csy0, csy1 := srcSpan(dy, dstH, cSrcH)
		for dx := 0; dx < dstW; dx++ {
			csx0, csx1 := srcSpan(dx, dstW, cSrcW)

			var cbS, crS uint32
			for csy := csy0; csy < csy1; csy++ {
				off := (cBY+csy)*cStride + cBX + csx0
				for range csx1 - csx0 {
					cbS += uint32(cbData[off])
					crS += uint32(crData[off])
					off++
				}
			}

			cnt := float32((csy1 - csy0) * (csx1 - csx0))
			cb := float32(cbS)/cnt - 128
			cr := float32(crS)/cnt - 128

			di := (dy*dstW + dx) * 4
			y := rgba[di]

			rgba[di] = clamp01f((y + 1.402*cr) / 255)
			rgba[di+1] = clamp01f((y - 0.34414*cb - 0.71414*cr) / 255)
			rgba[di+2] = clamp01f((y + 1.772*cb) / 255)
			rgba[di+3] = 1
		}
	}
}

// dsYCbCrAny — fallback for 444, 440, 411, 410.  Uses COffset but still LUT.
// No per-pixel clamp; clamp final average.
func dsYCbCrAny(src *image.YCbCr, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	yData, cbData, crData := src.Y, src.Cb, src.Cr
	yStride := src.YStride
	minX, minY := bounds.Min.X, bounds.Min.Y
	ryBase := minY - src.Rect.Min.Y
	rxBase := minX - src.Rect.Min.X

	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)

			var rS, gS, bS int32
			for sy := sy0; sy < sy1; sy++ {
				yOff := (ryBase+sy)*yStride + rxBase
				for sx := sx0; sx < sx1; sx++ {
					y := int32(yData[yOff+sx])
					ci := src.COffset(minX+sx, minY+sy)
					cr, cb := crData[ci], cbData[ci]

					rS += y + ycbcrCrR[cr]
					gS += y - ycbcrCbG[cb] - ycbcrCrG[cr]
					bS += y + ycbcrCbB[cb]
				}
			}

			cnt255 := float32((sy1-sy0)*(sx1-sx0)) * 255
			inv := float32(1) / cnt255
			di := (dy*dstW + dx) * 4
			rgba[di] = clamp01f(float32(rS) * inv)
			rgba[di+1] = clamp01f(float32(gS) * inv)
			rgba[di+2] = clamp01f(float32(bS) * inv)
			rgba[di+3] = 1
		}
	}
}

// dsGray — grayscale. uint32 accumulation.
func dsGray(src *image.Gray, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	pix := src.Pix
	stride := src.Stride
	bY := bounds.Min.Y - src.Rect.Min.Y
	bX := bounds.Min.X - src.Rect.Min.X

	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)

			var vS uint32
			for sy := sy0; sy < sy1; sy++ {
				off := (bY+sy)*stride + bX + sx0
				for range sx1 - sx0 {
					vS += uint32(pix[off])
					off++
				}
			}

			v := float32(vS) / (float32((sy1-sy0)*(sx1-sx0)) * 255)
			di := (dy*dstW + dx) * 4
			rgba[di] = v
			rgba[di+1] = v
			rgba[di+2] = v
			rgba[di+3] = 1
		}
	}
}

// dsGeneric — fallback using image.At (interface dispatch per pixel).
func dsGeneric(img image.Image, bounds image.Rectangle, srcW, srcH, dstW, dstH int, rgba []float32) {
	minX, minY := bounds.Min.X, bounds.Min.Y
	for dy := 0; dy < dstH; dy++ {
		sy0, sy1 := srcSpan(dy, dstH, srcH)
		for dx := 0; dx < dstW; dx++ {
			sx0, sx1 := srcSpan(dx, dstW, srcW)

			var rS, gS, bS, aS float32
			for sy := sy0; sy < sy1; sy++ {
				for sx := sx0; sx < sx1; sx++ {
					cr, cg, cb, ca := img.At(minX+sx, minY+sy).RGBA()
					af := float32(ca) / 65535
					if af > 0 {
						rS += float32(cr) / 65535 / af
						gS += float32(cg) / 65535 / af
						bS += float32(cb) / 65535 / af
					}
					aS += af
				}
			}

			inv := float32(1) / float32((sy1-sy0)*(sx1-sx0))
			di := (dy*dstW + dx) * 4
			rgba[di] = rS * inv
			rgba[di+1] = gS * inv
			rgba[di+2] = bS * inv
			rgba[di+3] = aS * inv
		}
	}
}

// ─── direct extraction (no downscale, small images ≤100px) ───

func extractPixels(img image.Image, bounds image.Rectangle, w, h int, rgba []float32) {
	switch src := img.(type) {
	case *image.NRGBA:
		pix := src.Pix
		stride := src.Stride
		bY := bounds.Min.Y - src.Rect.Min.Y
		bX4 := (bounds.Min.X - src.Rect.Min.X) * 4
		di := 0
		for y := 0; y < h; y++ {
			off := (bY+y)*stride + bX4
			for x := 0; x < w; x++ {
				rgba[di] = float32(pix[off]) / 255
				rgba[di+1] = float32(pix[off+1]) / 255
				rgba[di+2] = float32(pix[off+2]) / 255
				rgba[di+3] = float32(pix[off+3]) / 255
				off += 4
				di += 4
			}
		}
	case *image.RGBA:
		pix := src.Pix
		stride := src.Stride
		bY := bounds.Min.Y - src.Rect.Min.Y
		bX4 := (bounds.Min.X - src.Rect.Min.X) * 4
		di := 0
		for y := 0; y < h; y++ {
			off := (bY+y)*stride + bX4
			for x := 0; x < w; x++ {
				a := float32(pix[off+3])
				if a > 0 {
					rgba[di] = float32(pix[off]) / a
					rgba[di+1] = float32(pix[off+1]) / a
					rgba[di+2] = float32(pix[off+2]) / a
				}
				rgba[di+3] = a / 255
				off += 4
				di += 4
			}
		}
	case *image.YCbCr:
		yData, cbData, crData := src.Y, src.Cb, src.Cr
		yStride := src.YStride
		minX, minY := bounds.Min.X, bounds.Min.Y
		ryBase := minY - src.Rect.Min.Y
		rxBase := minX - src.Rect.Min.X
		di := 0
		for y := 0; y < h; y++ {
			yOff := (ryBase+y)*yStride + rxBase
			for x := 0; x < w; x++ {
				yv := int32(yData[yOff+x])
				ci := src.COffset(minX+x, minY+y)
				cr, cb := crData[ci], cbData[ci]
				rgba[di] = float32(clampByte(yv+ycbcrCrR[cr])) / 255
				rgba[di+1] = float32(clampByte(yv-ycbcrCbG[cb]-ycbcrCrG[cr])) / 255
				rgba[di+2] = float32(clampByte(yv+ycbcrCbB[cb])) / 255
				rgba[di+3] = 1
				di += 4
			}
		}
	case *image.Gray:
		pix := src.Pix
		stride := src.Stride
		bY := bounds.Min.Y - src.Rect.Min.Y
		bX := bounds.Min.X - src.Rect.Min.X
		di := 0
		for y := 0; y < h; y++ {
			off := (bY+y)*stride + bX
			for x := 0; x < w; x++ {
				v := float32(pix[off]) / 255
				rgba[di] = v
				rgba[di+1] = v
				rgba[di+2] = v
				rgba[di+3] = 1
				off++
				di += 4
			}
		}
	default:
		di := 0
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			for x := bounds.Min.X; x < bounds.Max.X; x++ {
				r, g, b, a := img.At(x, y).RGBA()
				af := float32(a) / 65535
				if af > 0 {
					rgba[di] = float32(r) / 65535 / af
					rgba[di+1] = float32(g) / 65535 / af
					rgba[di+2] = float32(b) / 65535 / af
				}
				rgba[di+3] = af
				di += 4
			}
		}
	}
}

// ─── DCT hash encoding ─────────────────────────────────────────

func assembleHash(w, h int, wb *workBuf) []byte {
	count := w * h
	rgba := wb.rgba[:count*4]

	// Average colour weighted by alpha.
	var avgR, avgG, avgB, avgA float32
	for i := 0; i < count; i++ {
		a := rgba[i*4+3]
		avgR += a * rgba[i*4]
		avgG += a * rgba[i*4+1]
		avgB += a * rgba[i*4+2]
		avgA += a
	}
	if avgA > 0 {
		avgR /= avgA
		avgG /= avgA
		avgB /= avgA
	}
	avgA /= float32(count)

	hasAlpha := avgA < 1
	lLimit := 7
	if hasAlpha {
		lLimit = 5
	}
	maxWH := imax(w, h)
	lx := max1(roundF(float32(lLimit*w) / float32(maxWH)))
	ly := max1(roundF(float32(lLimit*h) / float32(maxWH)))
	px := max1(roundF(float32(3*w) / float32(maxWH)))
	py := max1(roundF(float32(3*h) / float32(maxWH)))
	var ax, ay int
	if hasAlpha {
		ax = max1(roundF(float32(5*w) / float32(maxWH)))
		ay = max1(roundF(float32(5*h) / float32(maxWH)))
	}

	// RGBA → LPQA in-place.
	for i := 0; i < count; i++ {
		off := i * 4
		af := rgba[off+3]
		r := rgba[off] * af
		g := rgba[off+1] * af
		b := rgba[off+2] * af
		rgba[off] = (r + g + b) / 3
		rgba[off+1] = (r+g)/2 - b
		rgba[off+2] = r - g
	}

	// Pre-compute cosine tables (one set for all channels).
	maxNx := imax(lx, px)
	maxNy := imax(ly, py)
	if hasAlpha {
		maxNx = imax(maxNx, ax)
		maxNy = imax(maxNy, ay)
	}
	cosX := wb.cosX[:maxNx*w]
	for cx := 0; cx < maxNx; cx++ {
		s := math.Pi * float64(cx) / float64(w)
		base := cx * w
		for x := 0; x < w; x++ {
			cosX[base+x] = float32(math.Cos(s * (float64(x) + 0.5)))
		}
	}
	cosY := wb.cosY[:maxNy*h]
	for cy := 0; cy < maxNy; cy++ {
		s := math.Pi * float64(cy) / float64(h)
		base := cy * h
		for y := 0; y < h; y++ {
			cosY[base+y] = float32(math.Cos(s * (float64(y) + 0.5)))
		}
	}

	// Partition the AC buffer into contiguous per-channel slices.
	lN := lx*ly - 1
	pN := px*py - 1
	qN := pN
	aN := 0
	if hasAlpha {
		aN = ax*ay - 1
	}
	lAC := wb.ac[0:lN]
	pAC := wb.ac[lN : lN+pN]
	qAC := wb.ac[lN+pN : lN+pN+qN]
	var aAC []float32
	if hasAlpha {
		aAC = wb.ac[lN+pN+qN : lN+pN+qN+aN]
	}

	// Encode channels.
	lScale, lDC := encodeChan(rgba, 0, 4, w, h, lx, ly, cosX, cosY, lAC)
	pScale, pDC := encodeChan(rgba, 1, 4, w, h, px, py, cosX, cosY, pAC)
	qScale, qDC := encodeChan(rgba, 2, 4, w, h, px, py, cosX, cosY, qAC)
	var aScale, aDC float32
	if hasAlpha {
		aScale, aDC = encodeChan(rgba, 3, 4, w, h, ax, ay, cosX, cosY, aAC)
	}

	// ── ThumbHash Binary Header Format (MUST match JS decoder exactly) ──
	//
	// Bytes 0–3: main header (32 bits, little-endian)
	//   bits  0– 5  (6 bits): lDC      = round(lDC * 63)             range [0, 63]
	//   bits  6–11  (6 bits): pDC      = round(pDC * 31 + 31)        range [0, 62]  → decode: val/31 - 1
	//   bits 12–17  (6 bits): qDC      = round(qDC * 31 + 31)        range [0, 62]  → decode: val/31 - 1
	//   bits 18–22  (5 bits): lScale   = round(lScale * 31)          range [0, 31]
	//   bit  23     (1 bit):  hasAlpha
	//   bits 24–27  (4 bits): dimFlag  = isLandscape ? ly : lx       range [1, 7]
	//   bit  28     (1 bit):  isLandscape
	//   bits 29–31:           unused (always 0)
	//
	// Bytes 4–5: header2 (16 bits, little-endian)
	//   bits  0– 5  (6 bits): pScale   = round(pScale * 63)          range [0, 63]
	//   bits  6–11  (6 bits): qScale   = round(qScale * 63)          range [0, 63]
	//   bits 12–15:           unused
	//
	// Bytes 6–7 (only if hasAlpha): alpha header (16 bits)
	//   bits  0– 3  (4 bits): aDC      = round(aDC * 15)             range [0, 15]
	//   bits  4– 7  (4 bits): aScale   = round(aScale * 15)          range [0, 15]
	//   bits  8–15:           unused
	//
	// Remaining bytes: AC coefficients packed as 4-bit nibbles.
	//   Order: lAC, pAC, qAC [, aAC if hasAlpha].
	//   Each nibble = round(clamp01(coeff/2 + 0.5) * 15).
	//   acOffset = hasAlpha ? 8 : 6.
	//
	// IMPORTANT: pDC and qDC use 6-bit fields (not 5). Both the Go encoder
	// and JS decoder MUST use a 6-bit mask (& 63 / & 0x3F) for these fields.
	// Using a 5-bit mask silently truncates values ≥ 32, corrupting chroma.

	isLandscape := w > h
	header := uint32(math.Round(float64(lDC)*63)) |
		uint32(math.Round(float64(pDC)*31+31))<<6 |
		uint32(math.Round(float64(qDC)*31+31))<<12 |
		uint32(math.Round(float64(lScale)*31))<<18 |
		boolU32(hasAlpha)<<23
	if isLandscape {
		header |= uint32(ly) << 24
	} else {
		header |= uint32(lx) << 24
	}
	header |= boolU32(isLandscape) << 28

	header2 := uint16(math.Round(float64(pScale)*63)) |
		uint16(math.Round(float64(qScale)*63))<<6

	var alphaHdr uint16
	if hasAlpha {
		alphaHdr = uint16(math.Round(float64(aDC)*15)) |
			uint16(math.Round(float64(aScale)*15))<<4
	}

	// Assemble hash bytes — sole heap allocation.
	totalAC := lN + pN + qN + aN
	hashLen := 6
	if hasAlpha {
		hashLen = 8
	}
	hashLen += (totalAC + 1) / 2

	hash := make([]byte, hashLen)
	hash[0] = byte(header)
	hash[1] = byte(header >> 8)
	hash[2] = byte(header >> 16)
	hash[3] = byte(header >> 24)
	hash[4] = byte(header2)
	hash[5] = byte(header2 >> 8)

	acOff := 6
	if hasAlpha {
		hash[6] = byte(alphaHdr)
		hash[7] = byte(alphaHdr >> 8)
		acOff = 8
	}

	nib := 0
	packAC := func(ac []float32) {
		for _, c := range ac {
			v := clamp01f(c/2 + 0.5)
			b := byte(math.Round(float64(v) * 15))
			pos := acOff + nib/2
			if nib%2 == 0 {
				hash[pos] = b
			} else {
				hash[pos] |= b << 4
			}
			nib++
		}
	}
	packAC(lAC)
	packAC(pAC)
	packAC(qAC)
	if hasAlpha {
		packAC(aAC)
	}

	return hash
}

// encodeChan computes DCT coefficients for one LPQA channel.
func encodeChan(data []float32, chanOff, stride, w, h, nx, ny int,
	cosX, cosY []float32, dst []float32) (float32, float32) {

	var dc, acMax float32
	idx := 0
	wh := float32(w * h)

	for cy := 0; cy < ny; cy++ {
		cyBase := cy * h
		for cx := 0; cx < nx; cx++ {
			var f float32
			cxBase := cx * w
			for y := 0; y < h; y++ {
				fy := cosY[cyBase+y]
				rowOff := y * w * stride
				for x := 0; x < w; x++ {
					f += data[rowOff+x*stride+chanOff] * cosX[cxBase+x] * fy
				}
			}
			f /= wh

			if cx == 0 && cy == 0 {
				dc = f
				continue
			}

			dst[idx] = f
			af := f
			if af < 0 {
				af = -af
			}
			if af > acMax {
				acMax = af
			}
			idx++
		}
	}

	if acMax > 0 {
		inv := float32(1) / acMax
		for i := range dst[:idx] {
			dst[i] *= inv
		}
	}

	return acMax, dc
}

// ─── HasAlpha ──────────────────────────────────────────────────

// HasAlpha reports whether any pixel has alpha < fully opaque.
func HasAlpha(img image.Image) bool {
	switch src := img.(type) {
	case *image.NRGBA:
		for i := 3; i < len(src.Pix); i += 4 {
			if src.Pix[i] < 255 {
				return true
			}
		}
		return false
	case *image.RGBA:
		for i := 3; i < len(src.Pix); i += 4 {
			if src.Pix[i] < 255 {
				return true
			}
		}
		return false
	case *image.YCbCr, *image.Gray:
		return false
	default:
		bounds := img.Bounds()
		for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
			for x := bounds.Min.X; x < bounds.Max.X; x++ {
				_, _, _, a := img.At(x, y).RGBA()
				if a < 65535 {
					return true
				}
			}
		}
		return false
	}
}

// ImageToNRGBA converts any image to NRGBA format.
func ImageToNRGBA(img image.Image) *image.NRGBA {
	if n, ok := img.(*image.NRGBA); ok {
		return n
	}
	b := img.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			out.Set(x, y, color.NRGBAModel.Convert(img.At(x, y)))
		}
	}
	return out
}

// ─── helpers ──────────────────────────────────────────────────

func srcSpan(d, dstSize, srcSize int) (int, int) {
	s0 := d * srcSize / dstSize
	s1 := (d + 1) * srcSize / dstSize
	if s1 <= s0 {
		s1 = s0 + 1
	}
	if s1 > srcSize {
		s1 = srcSize
	}
	return s0, s1
}

func max1(v int) int {
	if v < 1 {
		return 1
	}
	return v
}

func imax(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func boolU32(b bool) uint32 {
	if b {
		return 1
	}
	return 0
}

// clampByte clamps an int32 to [0, 255].
func clampByte(v int32) int32 {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return v
}

func clamp01f(v float32) float32 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func roundF(v float32) int {
	return int(math.Round(float64(v)))
}

// zeroF32 zeroes a float32 slice.  Compiler can vectorise.
func zeroF32(s []float32) {
	for i := range s {
		s[i] = 0
	}
}
