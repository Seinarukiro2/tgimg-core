package encoder

import (
	"bytes"
	"image"
	"image/png"
)

// PNGEncoder encodes images to PNG using Go's standard library.
// Used as fallback for images with alpha transparency.
type PNGEncoder struct{}

func (e *PNGEncoder) Format() string    { return "png" }
func (e *PNGEncoder) Extension() string { return "png" }
func (e *PNGEncoder) Available() bool   { return true }

func (e *PNGEncoder) Encode(img image.Image, _ int) ([]byte, error) {
	var buf bytes.Buffer
	buf.Grow(512 * 1024) // pre-alloc 512KB

	enc := &png.Encoder{CompressionLevel: png.BestCompression}
	err := enc.Encode(&buf, img)
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
