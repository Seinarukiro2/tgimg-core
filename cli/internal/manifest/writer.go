package manifest

import (
	"encoding/json"
	"os"
	"time"
)

// New creates an empty manifest with defaults.
func New(profileName string) *Manifest {
	return &Manifest{
		Version:     1,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339),
		Profile:     profileName,
		BasePath:    "./",
		Assets:      make(map[string]Asset),
	}
}

// ComputeStats recalculates aggregate statistics from assets.
func (m *Manifest) ComputeStats() {
	var s Stats
	s.TotalAssets = len(m.Assets)
	for _, a := range m.Assets {
		s.TotalInputBytes += a.Original.Size
		s.TotalVariants += len(a.Variants)
		for _, v := range a.Variants {
			s.TotalOutputBytes += v.Size
		}
	}
	m.Stats = s
}

// WriteJSON serializes the manifest to a JSON file with stable ordering.
func WriteJSON(m *Manifest, path string) error {
	m.ComputeStats()

	data, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(path, data, 0o644)
}
