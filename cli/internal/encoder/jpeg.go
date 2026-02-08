package encoder

import (
	"bytes"
	"image"
	"image/jpeg"
)

// JPEGEncoder encodes images to JPEG using Go's standard library.
type JPEGEncoder struct{}

func (e *JPEGEncoder) Format() string    { return "jpeg" }
func (e *JPEGEncoder) Extension() string { return "jpeg" }
func (e *JPEGEncoder) Available() bool   { return true }

func (e *JPEGEncoder) Encode(img image.Image, quality int) ([]byte, error) {
	if quality <= 0 || quality > 100 {
		quality = 82
	}

	var buf bytes.Buffer
	buf.Grow(256 * 1024) // pre-alloc 256KB — avoids repeated grow for typical photos

	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: quality})
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
