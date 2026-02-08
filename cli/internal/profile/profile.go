package profile

// Profile defines image processing parameters for a target platform.
type Profile struct {
	Name    string
	Widths  []int    // target widths for resize
	Formats []string // output formats in priority order
	Quality int      // encoding quality 1-100
	Retina  bool     // generate 2x variants for retina
}

// Built-in profiles.
var profiles = map[string]Profile{
	"telegram-webview": {
		Name:    "telegram-webview",
		Widths:  []int{320, 640, 960, 1280},
		Formats: []string{"webp", "jpeg"}, // avif added when encoder available
		Quality: 82,
		Retina:  true,
	},
	"telegram-webview-hq": {
		Name:    "telegram-webview-hq",
		Widths:  []int{320, 640, 960, 1280, 1920},
		Formats: []string{"avif", "webp", "jpeg"},
		Quality: 85,
		Retina:  true,
	},
	"minimal": {
		Name:    "minimal",
		Widths:  []int{320, 640},
		Formats: []string{"webp", "jpeg"},
		Quality: 78,
		Retina:  false,
	},
}

// Get returns a profile by name. Falls back to telegram-webview if unknown.
func Get(name string) Profile {
	if p, ok := profiles[name]; ok {
		return p
	}
	p := profiles["telegram-webview"]
	p.Name = name // preserve requested name
	return p
}

// EffectiveWidths returns all widths including retina variants.
func (p Profile) EffectiveWidths(originalWidth int) []int {
	seen := map[int]bool{}
	var result []int

	for _, w := range p.Widths {
		if w > originalWidth {
			continue // don't upscale
		}
		if !seen[w] {
			seen[w] = true
			result = append(result, w)
		}
		if p.Retina {
			w2 := w * 2
			if w2 <= originalWidth && !seen[w2] {
				seen[w2] = true
				result = append(result, w2)
			}
		}
	}

	// Always include original width if not already present
	// (for cases where original is smaller than smallest target).
	if len(result) == 0 && originalWidth > 0 {
		result = append(result, originalWidth)
	}

	return result
}
