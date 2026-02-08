package manifest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestRoundtrip(t *testing.T) {
	m := New("test-profile")
	m.BuildInfo = &BuildInfo{Workers: 4, PoolEntryKB: 167}
	m.Assets["test/image"] = Asset{
		Original: OriginalInfo{
			Width: 800, Height: 600,
			Format: "jpeg", Size: 100000, HasAlpha: false,
		},
		ThumbHash:   "YJqGPQw7sFlslqhFafSE+Q6oJ1h2iA==",
		AspectRatio: 1.3333,
		Variants: []Variant{
			{Format: "webp", Width: 320, Height: 240, Size: 5000, Hash: "abcd1234", Path: "test/image.320.240.abcd1234.webp"},
		},
	}
	m.ComputeStats()

	// Write to temp file.
	dir := t.TempDir()
	path := filepath.Join(dir, "tgimg.manifest.json")
	if err := WriteJSON(m, path); err != nil {
		t.Fatalf("write: %v", err)
	}

	// Read back and parse.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read: %v", err)
	}

	var m2 Manifest
	if err := json.Unmarshal(data, &m2); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	// Verify fields.
	if m2.Version != SupportedManifestVersion {
		t.Errorf("version: got %d, want %d", m2.Version, SupportedManifestVersion)
	}
	if m2.Profile != "test-profile" {
		t.Errorf("profile: got %q", m2.Profile)
	}
	if m2.BuildInfo == nil {
		t.Fatal("build_info missing")
	}
	if m2.BuildInfo.Workers != 4 {
		t.Errorf("workers: got %d", m2.BuildInfo.Workers)
	}
	if m2.BuildInfo.PoolEntryKB != 167 {
		t.Errorf("pool_entry_kb: got %d", m2.BuildInfo.PoolEntryKB)
	}

	a, ok := m2.Assets["test/image"]
	if !ok {
		t.Fatal("asset test/image missing")
	}
	if a.ThumbHash != "YJqGPQw7sFlslqhFafSE+Q6oJ1h2iA==" {
		t.Errorf("thumbhash: got %q", a.ThumbHash)
	}
	if len(a.Variants) != 1 {
		t.Errorf("variants: got %d", len(a.Variants))
	}
	if a.Variants[0].Format != "webp" {
		t.Errorf("variant format: got %q", a.Variants[0].Format)
	}

	// Stats.
	if m2.Stats.TotalAssets != 1 {
		t.Errorf("total_assets: got %d", m2.Stats.TotalAssets)
	}
	if m2.Stats.TotalVariants != 1 {
		t.Errorf("total_variants: got %d", m2.Stats.TotalVariants)
	}
}

func TestManifestVersion(t *testing.T) {
	m := New("v-test")
	if m.Version != SupportedManifestVersion {
		t.Errorf("new manifest version: got %d, want %d", m.Version, SupportedManifestVersion)
	}
}

func TestManifestIgnoresUnknownFields(t *testing.T) {
	// Simulate a future manifest with extra fields.
	raw := `{
		"version": 1,
		"generated_at": "2025-01-01T00:00:00Z",
		"profile": "test",
		"base_path": "./",
		"future_field": "should be ignored",
		"build_info": { "workers": 8, "pool_entry_kb": 167, "new_flag": true },
		"assets": {},
		"stats": { "total_input_bytes": 0, "total_output_bytes": 0, "total_assets": 0, "total_variants": 0, "new_stat": 42 }
	}`

	var m Manifest
	if err := json.Unmarshal([]byte(raw), &m); err != nil {
		t.Fatalf("unmarshal with unknown fields: %v", err)
	}
	if m.Version != 1 {
		t.Errorf("version: got %d", m.Version)
	}
	if m.BuildInfo == nil || m.BuildInfo.Workers != 8 {
		t.Error("build_info not parsed correctly")
	}
}
