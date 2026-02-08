package pipeline

import (
	"fmt"
	"os"
	"runtime"
	"sync"

	"github.com/AnyUserName/tgimg-cli/internal/encoder"
	"github.com/AnyUserName/tgimg-cli/internal/manifest"
	"github.com/AnyUserName/tgimg-cli/internal/profile"
)

// PoolEntryKB is the approximate size of one thumbhash sync.Pool entry.
// float32 workBuf: rgba(160KB) + cos(6.4KB) + ac(0.5KB) ≈ 167 KB.
const PoolEntryKB = 167

// Config holds all parameters for a build pipeline run.
type Config struct {
	InputDir       string
	OutputDir      string
	Profile        profile.Profile
	Workers        int
	Verbose        bool
	NoRegressSize  bool // skip variants larger than original
}

// Pipeline orchestrates image processing.
type Pipeline struct {
	cfg      Config
	registry *encoder.Registry
}

// New creates a configured pipeline.
func New(cfg Config) *Pipeline {
	if cfg.Workers <= 0 {
		cfg.Workers = runtime.NumCPU()
	}
	return &Pipeline{
		cfg:      cfg,
		registry: encoder.NewRegistry(),
	}
}

// Run executes the full build pipeline and returns the manifest.
func (p *Pipeline) Run() (*manifest.Manifest, error) {
	// Log encoder availability.
	if p.cfg.Verbose {
		fmt.Fprintf(os.Stderr, "[tgimg] %s\n", p.registry.String())
	}

	// Step 1: Scan for images.
	sources, err := ScanImages(p.cfg.InputDir)
	if err != nil {
		return nil, fmt.Errorf("scan: %w", err)
	}
	if len(sources) == 0 {
		return nil, fmt.Errorf("no images found in %s", p.cfg.InputDir)
	}

	if p.cfg.Verbose {
		fmt.Fprintf(os.Stderr, "[tgimg] found %d images\n", len(sources))
	}

	// Step 2: Process images in parallel.
	results := make([]processResult, len(sources))
	var wg sync.WaitGroup
	sem := make(chan struct{}, p.cfg.Workers)

	for i, src := range sources {
		wg.Add(1)
		go func(idx int, s Source) {
			defer wg.Done()
			sem <- struct{}{} // acquire
			defer func() { <-sem }() // release

			if p.cfg.Verbose {
				fmt.Fprintf(os.Stderr, "[tgimg] processing: %s\n", s.Key)
			}

			results[idx] = processImage(s, p.cfg, p.registry)

			if p.cfg.Verbose && results[idx].err == nil {
				fmt.Fprintf(os.Stderr, "[tgimg] done: %s (%d variants)\n",
					s.Key, len(results[idx].asset.Variants))
			}
		}(i, src)
	}
	wg.Wait()

	// Step 3: Collect results into manifest.
	m := manifest.New(p.cfg.Profile.Name)

	var errs []error
	var totalSkipped int
	for _, r := range results {
		if r.err != nil {
			errs = append(errs, r.err)
			continue
		}
		m.Assets[r.key] = r.asset
		totalSkipped += r.skippedRegress
	}

	// Report errors but don't fail the entire build for partial failures.
	if len(errs) > 0 {
		for _, e := range errs {
			fmt.Fprintf(os.Stderr, "[tgimg] error: %v\n", e)
		}
		if len(errs) == len(sources) {
			return nil, fmt.Errorf("all %d images failed to process", len(errs))
		}
		fmt.Fprintf(os.Stderr, "[tgimg] warning: %d of %d images had errors\n",
			len(errs), len(sources))
	}

	m.BuildInfo = &manifest.BuildInfo{
		Workers:     p.cfg.Workers,
		PoolEntryKB: PoolEntryKB,
	}
	m.ComputeStats()
	m.Stats.SkippedRegress = totalSkipped
	return m, nil
}
