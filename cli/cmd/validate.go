package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/AnyUserName/tgimg-cli/internal/manifest"
	"github.com/spf13/cobra"
)

var validateCmd = &cobra.Command{
	Use:   "validate <manifest_path>",
	Short: "Validate a tgimg manifest and check referenced files exist",
	Args:  cobra.ExactArgs(1),
	RunE:  runValidate,
}

func init() {
	rootCmd.AddCommand(validateCmd)
}

func runValidate(_ *cobra.Command, args []string) error {
	manifestPath := args[0]

	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	var m manifest.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("parse manifest: %w", err)
	}

	baseDir := filepath.Dir(manifestPath)
	errors := validateManifest(&m, baseDir)

	if len(errors) == 0 {
		fmt.Println("  ✓ Manifest is valid")
		fmt.Printf("  ✓ %d assets, %d variants — all files present\n", m.Stats.TotalAssets, m.Stats.TotalVariants)
		return nil
	}

	fmt.Printf("  ✗ Manifest has %d error(s):\n", len(errors))
	for _, e := range errors {
		fmt.Printf("    • %s\n", e)
	}
	return fmt.Errorf("validation failed with %d errors", len(errors))
}

func validateManifest(m *manifest.Manifest, baseDir string) []string {
	var errs []string

	// Check version.
	if m.Version != 1 {
		errs = append(errs, fmt.Sprintf("unsupported manifest version: %d", m.Version))
	}

	// Check each asset.
	for key, asset := range m.Assets {
		// Check original dimensions.
		if asset.Original.Width <= 0 || asset.Original.Height <= 0 {
			errs = append(errs, fmt.Sprintf("asset %q: invalid original dimensions %dx%d",
				key, asset.Original.Width, asset.Original.Height))
		}

		// Check thumbhash.
		if asset.ThumbHash == "" {
			errs = append(errs, fmt.Sprintf("asset %q: missing thumbhash", key))
		}

		// Check aspect ratio.
		if asset.AspectRatio <= 0 {
			errs = append(errs, fmt.Sprintf("asset %q: invalid aspect ratio %.4f", key, asset.AspectRatio))
		}

		// Check variants.
		if len(asset.Variants) == 0 {
			errs = append(errs, fmt.Sprintf("asset %q: no variants", key))
		}

		seenPaths := map[string]bool{}
		for i, v := range asset.Variants {
			// Check variant fields.
			if v.Format == "" {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: empty format", key, i))
			}
			if v.Width <= 0 || v.Height <= 0 {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: invalid dimensions %dx%d",
					key, i, v.Width, v.Height))
			}
			if v.Hash == "" {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: missing hash", key, i))
			}
			if v.Path == "" {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: missing path", key, i))
				continue
			}

			// Check duplicate paths.
			if seenPaths[v.Path] {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: duplicate path %q", key, i, v.Path))
			}
			seenPaths[v.Path] = true

			// Check file exists.
			fullPath := filepath.Join(baseDir, v.Path)
			info, err := os.Stat(fullPath)
			if err != nil {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: file not found: %s", key, i, v.Path))
			} else if v.Size > 0 && info.Size() != v.Size {
				errs = append(errs, fmt.Sprintf("asset %q variant[%d]: size mismatch: manifest=%d, disk=%d",
					key, i, v.Size, info.Size()))
			}
		}
	}

	// Verify stats consistency.
	assetCount := len(m.Assets)
	variantCount := 0
	for _, a := range m.Assets {
		variantCount += len(a.Variants)
	}
	if m.Stats.TotalAssets != assetCount {
		errs = append(errs, fmt.Sprintf("stats.total_assets mismatch: %d != %d", m.Stats.TotalAssets, assetCount))
	}
	if m.Stats.TotalVariants != variantCount {
		errs = append(errs, fmt.Sprintf("stats.total_variants mismatch: %d != %d", m.Stats.TotalVariants, variantCount))
	}

	return errs
}
