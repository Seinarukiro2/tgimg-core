package encoder

import (
	"fmt"
	"strings"
)

// Registry holds all available encoders and selects the best one per format.
type Registry struct {
	encoders map[string]Encoder
}

// NewRegistry creates a registry, probing all encoders for availability.
func NewRegistry() *Registry {
	r := &Registry{
		encoders: make(map[string]Encoder),
	}

	// Register all encoders. Only available ones will be used.
	all := []Encoder{
		&AVIFEncoder{},
		&WebPEncoder{},
		&JPEGEncoder{},
		&PNGEncoder{},
	}

	for _, enc := range all {
		if enc.Available() {
			r.encoders[enc.Format()] = enc
		}
	}

	return r
}

// Get returns an encoder for the given format, or nil if unavailable.
func (r *Registry) Get(format string) Encoder {
	return r.encoders[strings.ToLower(format)]
}

// Available returns all available format names.
func (r *Registry) Available() []string {
	var result []string
	// Maintain priority order.
	for _, f := range []string{"avif", "webp", "jpeg", "png"} {
		if _, ok := r.encoders[f]; ok {
			result = append(result, f)
		}
	}
	return result
}

// ResolveFormats filters requested formats to only those available,
// and ensures at least one fallback format is present.
func (r *Registry) ResolveFormats(requested []string, hasAlpha bool) []string {
	var resolved []string
	seen := map[string]bool{}

	for _, f := range requested {
		f = strings.ToLower(f)
		if _, ok := r.encoders[f]; ok && !seen[f] {
			resolved = append(resolved, f)
			seen[f] = true
		}
	}

	// Ensure we always have at least one output format.
	if len(resolved) == 0 {
		if hasAlpha {
			if r.encoders["png"] != nil {
				resolved = append(resolved, "png")
			}
		} else {
			if r.encoders["jpeg"] != nil {
				resolved = append(resolved, "jpeg")
			}
		}
	}

	// For alpha images, ensure PNG is included as fallback
	// (webp/avif may not support alpha well on all decoders).
	if hasAlpha && !seen["png"] && r.encoders["png"] != nil {
		resolved = append(resolved, "png")
	}

	return resolved
}

// String returns a summary of available encoders.
func (r *Registry) String() string {
	avail := r.Available()
	if len(avail) == 0 {
		return "no encoders available"
	}
	return fmt.Sprintf("encoders: %s", strings.Join(avail, ", "))
}
