package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/AnyUserName/tgimg-cli/internal/manifest"
	"github.com/AnyUserName/tgimg-cli/internal/pipeline"
	"github.com/AnyUserName/tgimg-cli/internal/profile"
	"github.com/spf13/cobra"
)

var (
	buildOutDir       string
	buildProfile      string
	buildWorkers      int
	buildWidths       []int
	buildQuality      int
	buildNoRegress    bool
)

var buildCmd = &cobra.Command{
	Use:   "build <input_dir>",
	Short: "Process images and generate optimized variants + manifest",
	Long: `Scans input directory for images (png, jpg, jpeg, webp, gif),
generates resized variants in multiple formats (AVIF, WebP, JPEG/PNG),
computes thumbhash placeholders, and writes a manifest file.

Output filenames are content-addressed: <key>.<w>.<h>.<hash>.ext`,
	Args: cobra.ExactArgs(1),
	RunE: runBuild,
}

func init() {
	buildCmd.Flags().StringVarP(&buildOutDir, "out", "o", "./tgimg_out", "output directory")
	buildCmd.Flags().StringVarP(&buildProfile, "profile", "p", "telegram-webview", "processing profile")
	buildCmd.Flags().IntVarP(&buildWorkers, "workers", "w", 0, "parallel workers (0 = NumCPU)")
	buildCmd.Flags().IntSliceVar(&buildWidths, "widths", nil, "custom widths (overrides profile)")
	buildCmd.Flags().IntVarP(&buildQuality, "quality", "q", 0, "quality 1-100 (0 = profile default)")
	buildCmd.Flags().BoolVar(&buildNoRegress, "no-regress-size", true, "skip variants larger than original file")
	rootCmd.AddCommand(buildCmd)
}

func runBuild(cmd *cobra.Command, args []string) error {
	inputDir := args[0]
	start := time.Now()

	// Resolve absolute paths.
	absInput, err := filepath.Abs(inputDir)
	if err != nil {
		return fmt.Errorf("resolve input path: %w", err)
	}
	absOutput, err := filepath.Abs(buildOutDir)
	if err != nil {
		return fmt.Errorf("resolve output path: %w", err)
	}

	// Load profile.
	prof := profile.Get(buildProfile)
	if buildWidths != nil {
		prof.Widths = buildWidths
	}
	if buildQuality > 0 {
		prof.Quality = buildQuality
	}

	logVerbose("input:   %s", absInput)
	logVerbose("output:  %s", absOutput)
	logVerbose("profile: %s (widths=%v, quality=%d)", prof.Name, prof.Widths, prof.Quality)

	// Create output dir.
	if err := os.MkdirAll(absOutput, 0o755); err != nil {
		return fmt.Errorf("create output dir: %w", err)
	}

	// Run pipeline.
	p := pipeline.New(pipeline.Config{
		InputDir:      absInput,
		OutputDir:     absOutput,
		Profile:       prof,
		Workers:       buildWorkers,
		Verbose:       verbose,
		NoRegressSize: buildNoRegress,
	})

	m, err := p.Run()
	if err != nil {
		return fmt.Errorf("pipeline: %w", err)
	}

	// Write manifest.
	manifestPath := filepath.Join(absOutput, "tgimg.manifest.json")
	if err := manifest.WriteJSON(m, manifestPath); err != nil {
		return fmt.Errorf("write manifest: %w", err)
	}

	elapsed := time.Since(start)

	// Print report.
	printBuildReport(m, elapsed)

	return nil
}

func printBuildReport(m *manifest.Manifest, elapsed time.Duration) {
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════╗")
	fmt.Println("║              tgimg build complete                ║")
	fmt.Println("╚══════════════════════════════════════════════════╝")
	fmt.Println()

	stats := m.Stats
	ratio := float64(0)
	if stats.TotalInputBytes > 0 {
		ratio = float64(stats.TotalOutputBytes) / float64(stats.TotalInputBytes) * 100
	}

	fmt.Printf("  Assets:      %d\n", stats.TotalAssets)
	fmt.Printf("  Variants:    %d\n", stats.TotalVariants)
	fmt.Printf("  Input size:  %s\n", formatBytes(stats.TotalInputBytes))
	fmt.Printf("  Output size: %s\n", formatBytes(stats.TotalOutputBytes))
	fmt.Printf("  Ratio:       %.1f%% of original\n", ratio)
	if stats.SkippedRegress > 0 {
		fmt.Printf("  Skipped:     %d variants (larger than original)\n", stats.SkippedRegress)
	}
	fmt.Printf("  Time:        %s\n", elapsed.Round(time.Millisecond))

	if m.BuildInfo != nil {
		poolMB := float64(m.BuildInfo.Workers*m.BuildInfo.PoolEntryKB) / 1024
		fmt.Printf("  Workers:     %d  (pool ≈ %.1f MB)\n", m.BuildInfo.Workers, poolMB)
	}
	fmt.Println()

	// Top 10 heaviest assets.
	if len(m.Assets) > 0 {
		type assetSize struct {
			key        string
			inputSize  int64
			outputSize int64
		}
		var items []assetSize
		for key, a := range m.Assets {
			var outSum int64
			for _, v := range a.Variants {
				outSum += v.Size
			}
			items = append(items, assetSize{key, a.Original.Size, outSum})
		}
		sort.Slice(items, func(i, j int) bool {
			return items[i].inputSize > items[j].inputSize
		})
		n := len(items)
		if n > 10 {
			n = 10
		}
		fmt.Printf("  Top %d heaviest (original → optimized):\n", n)
		for _, it := range items[:n] {
			saved := float64(0)
			if it.inputSize > 0 {
				saved = (1 - float64(it.outputSize)/float64(it.inputSize)) * 100
			}
			fmt.Printf("    %-40s %8s → %8s  (−%.0f%%)\n",
				truncKey(it.key, 40),
				formatBytes(it.inputSize),
				formatBytes(it.outputSize),
				saved,
			)
		}
		fmt.Println()
	}

	// Format support info.
	fmts := detectOutputFormats(m)
	fmt.Printf("  Formats:     %s\n", strings.Join(fmts, ", "))
	fmt.Println()

	// Manifest path.
	data, _ := json.Marshal(m)
	fmt.Printf("  Manifest:    tgimg.manifest.json (%s)\n", formatBytes(int64(len(data))))
	fmt.Println()
}

func detectOutputFormats(m *manifest.Manifest) []string {
	set := map[string]bool{}
	for _, a := range m.Assets {
		for _, v := range a.Variants {
			set[v.Format] = true
		}
	}
	var out []string
	for _, f := range []string{"avif", "webp", "jpeg", "png"} {
		if set[f] {
			out = append(out, f)
		}
	}
	return out
}

func formatBytes(b int64) string {
	switch {
	case b >= 1<<20:
		return fmt.Sprintf("%.1f MB", float64(b)/(1<<20))
	case b >= 1<<10:
		return fmt.Sprintf("%.1f KB", float64(b)/(1<<10))
	default:
		return fmt.Sprintf("%d B", b)
	}
}

func truncKey(s string, max int) string {
	if len(s) <= max {
		return s
	}
	return "..." + s[len(s)-max+3:]
}
