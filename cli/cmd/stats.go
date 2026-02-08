package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"

	"github.com/AnyUserName/tgimg-cli/internal/manifest"
	"github.com/spf13/cobra"
)

var statsCmd = &cobra.Command{
	Use:   "stats <out_dir_or_manifest>",
	Short: "Display statistics for a built asset directory",
	Args:  cobra.ExactArgs(1),
	RunE:  runStats,
}

func init() {
	rootCmd.AddCommand(statsCmd)
}

func runStats(_ *cobra.Command, args []string) error {
	path := args[0]

	// If path is a directory, look for manifest inside.
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if info.IsDir() {
		path = filepath.Join(path, "tgimg.manifest.json")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read manifest: %w", err)
	}

	var m manifest.Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return fmt.Errorf("parse manifest: %w", err)
	}

	printStats(&m)
	return nil
}

func printStats(m *manifest.Manifest) {
	fmt.Println()
	fmt.Printf("  Manifest version: %d\n", m.Version)
	fmt.Printf("  Generated:        %s\n", m.GeneratedAt)
	fmt.Printf("  Profile:          %s\n", m.Profile)
	if m.BuildInfo != nil {
		poolMB := float64(m.BuildInfo.Workers*m.BuildInfo.PoolEntryKB) / 1024
		fmt.Printf("  Workers:          %d\n", m.BuildInfo.Workers)
		fmt.Printf("  Pool footprint:   %d × %d KB ≈ %.1f MB\n",
			m.BuildInfo.Workers, m.BuildInfo.PoolEntryKB, poolMB)
	} else {
		workers := runtime.NumCPU()
		poolMB := float64(workers*167) / 1024
		fmt.Printf("  Workers (est):    %d  (pool ≈ %.1f MB)\n", workers, poolMB)
	}
	fmt.Println()

	s := m.Stats
	fmt.Printf("  Total assets:     %d\n", s.TotalAssets)
	fmt.Printf("  Total variants:   %d\n", s.TotalVariants)
	fmt.Printf("  Input size:       %s\n", formatBytes(s.TotalInputBytes))
	fmt.Printf("  Output size:      %s\n", formatBytes(s.TotalOutputBytes))

	if s.TotalInputBytes > 0 {
		ratio := float64(s.TotalOutputBytes) / float64(s.TotalInputBytes) * 100
		fmt.Printf("  Compression:      %.1f%% of original\n", ratio)
	}
	fmt.Println()

	// Per-format breakdown.
	formatStats := map[string]struct {
		count int
		bytes int64
	}{}
	for _, a := range m.Assets {
		for _, v := range a.Variants {
			fs := formatStats[v.Format]
			fs.count++
			fs.bytes += v.Size
			formatStats[v.Format] = fs
		}
	}

	fmt.Println("  Format breakdown:")
	for _, f := range []string{"avif", "webp", "jpeg", "png"} {
		if fs, ok := formatStats[f]; ok {
			fmt.Printf("    %-6s  %4d files  %s\n", f, fs.count, formatBytes(fs.bytes))
		}
	}
	fmt.Println()

	// Per-width breakdown.
	widthStats := map[int]int{}
	for _, a := range m.Assets {
		for _, v := range a.Variants {
			widthStats[v.Width]++
		}
	}
	var widths []int
	for w := range widthStats {
		widths = append(widths, w)
	}
	sort.Ints(widths)
	fmt.Println("  Width breakdown:")
	for _, w := range widths {
		fmt.Printf("    %5dpx  %4d variants\n", w, widthStats[w])
	}
	fmt.Println()

	// Assets with largest thumbhash payloads.
	type thInfo struct {
		key  string
		size int
	}
	var ths []thInfo
	for key, a := range m.Assets {
		if a.ThumbHash != "" {
			ths = append(ths, thInfo{key, len(a.ThumbHash)})
		}
	}
	fmt.Printf("  ThumbHash coverage: %d / %d assets\n", len(ths), len(m.Assets))

	// Warnings.
	var warnings []string
	for key, a := range m.Assets {
		if len(a.Variants) == 0 {
			warnings = append(warnings, fmt.Sprintf("asset %q has no variants", key))
		}
		if a.ThumbHash == "" {
			warnings = append(warnings, fmt.Sprintf("asset %q missing thumbhash", key))
		}
	}
	if len(warnings) > 0 {
		fmt.Println()
		fmt.Printf("  Warnings (%d):\n", len(warnings))
		for _, w := range warnings {
			fmt.Printf("    ⚠ %s\n", w)
		}
	}
	fmt.Println()
}
