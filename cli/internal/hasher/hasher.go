package hasher

import (
	"encoding/hex"
	"io"

	"github.com/cespare/xxhash/v2"
)

// ContentHash computes the xxHash64 of data and returns a hex string
// truncated to the given length. For content-addressed filenames we
// use 16 hex chars (64 bits), which is collision-safe for practical
// asset counts.
func ContentHash(data []byte, hexLen int) string {
	h := xxhash.Sum64(data)
	full := hex.EncodeToString(uint64ToBytes(h))
	if hexLen > 0 && hexLen < len(full) {
		return full[:hexLen]
	}
	return full
}

// ContentHashReader computes xxHash64 from a reader, streaming.
func ContentHashReader(r io.Reader, hexLen int) (string, error) {
	h := xxhash.New()
	if _, err := io.Copy(h, r); err != nil {
		return "", err
	}
	full := hex.EncodeToString(uint64ToBytes(h.Sum64()))
	if hexLen > 0 && hexLen < len(full) {
		return full[:hexLen], nil
	}
	return full, nil
}

func uint64ToBytes(v uint64) []byte {
	b := make([]byte, 8)
	b[0] = byte(v >> 56)
	b[1] = byte(v >> 48)
	b[2] = byte(v >> 40)
	b[3] = byte(v >> 32)
	b[4] = byte(v >> 24)
	b[5] = byte(v >> 16)
	b[6] = byte(v >> 8)
	b[7] = byte(v)
	return b
}
