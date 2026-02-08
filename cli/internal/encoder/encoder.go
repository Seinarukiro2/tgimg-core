package encoder

import (
	"image"
)

// Encoder encodes an image to a specific format.
type Encoder interface {
	// Format returns the output format name (e.g. "jpeg", "webp", "avif", "png").
	Format() string

	// Encode converts the image to bytes at the given quality (1-100).
	Encode(img image.Image, quality int) ([]byte, error)

	// Available returns true if the encoder is ready to use.
	// External encoders (cwebp, avifenc) may not be installed.
	Available() bool

	// Extension returns the file extension without dot.
	Extension() string
}
