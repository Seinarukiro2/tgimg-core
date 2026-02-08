package manifest

// Manifest is the top-level output of a tgimg build.
type Manifest struct {
	Version     int              `json:"version"`
	GeneratedAt string           `json:"generated_at"`
	Profile     string           `json:"profile"`
	BasePath    string           `json:"base_path"`
	BuildInfo   *BuildInfo       `json:"build_info,omitempty"`
	Assets      map[string]Asset `json:"assets"`
	Stats       Stats            `json:"stats"`
}

// BuildInfo captures build-time parameters for diagnostics.
type BuildInfo struct {
	Workers     int `json:"workers"`
	PoolEntryKB int `json:"pool_entry_kb"` // per-worker thumbhash pool (~167 KB for float32)
}

// Asset describes a single source image and all its generated variants.
type Asset struct {
	Original    OriginalInfo `json:"original"`
	ThumbHash   string       `json:"thumbhash"`              // base64-encoded thumbhash bytes
	AspectRatio float64      `json:"aspect_ratio"`            // width / height
	AvgColor    *[3]uint8    `json:"avg_color,omitempty"`     // [R,G,B] 0–255, optional
	Variants    []Variant    `json:"variants"`
}

// OriginalInfo holds metadata about the source image.
type OriginalInfo struct {
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Format   string `json:"format"`
	Size     int64  `json:"size"`
	HasAlpha bool   `json:"has_alpha"`
}

// Variant is one encoded output of an asset at a specific size and format.
type Variant struct {
	Format string `json:"format"`  // "avif", "webp", "jpeg", "png"
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Size   int64  `json:"size"`    // bytes on disk
	Hash   string `json:"hash"`    // first 16 hex chars of xxhash64
	Path   string `json:"path"`    // relative to base_path
}

// Stats aggregates build metrics.
type Stats struct {
	TotalInputBytes  int64 `json:"total_input_bytes"`
	TotalOutputBytes int64 `json:"total_output_bytes"`
	TotalAssets      int   `json:"total_assets"`
	TotalVariants    int   `json:"total_variants"`
	SkippedRegress   int   `json:"skipped_regress,omitempty"` // variants skipped (larger than original)
}

// SupportedManifestVersion is the current schema version.
const SupportedManifestVersion = 1
