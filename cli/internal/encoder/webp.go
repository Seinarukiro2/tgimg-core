package encoder

import (
	"fmt"
	"image"
	"image/png"
	"os"
	"os/exec"
	"sync"
	"sync/atomic"
)

// Atomic counter for unique temp file names across goroutines.
var tempCounter atomic.Int64

// WebPEncoder encodes images to WebP by shelling out to cwebp.
// This approach avoids CGO while still producing optimized WebP.
// Install: brew install webp / apt install webp
type WebPEncoder struct {
	once      sync.Once
	available bool
	cwebpPath string
}

func (e *WebPEncoder) Format() string    { return "webp" }
func (e *WebPEncoder) Extension() string { return "webp" }

func (e *WebPEncoder) Available() bool {
	e.once.Do(func() {
		path, err := exec.LookPath("cwebp")
		if err == nil {
			e.available = true
			e.cwebpPath = path
		}
	})
	return e.available
}

func (e *WebPEncoder) Encode(img image.Image, quality int) ([]byte, error) {
	if !e.Available() {
		return nil, fmt.Errorf("cwebp not found in PATH; install with: brew install webp")
	}
	if quality <= 0 || quality > 100 {
		quality = 82
	}

	// Write source as PNG to temp file (cwebp reads files).
	// Use atomic counter to ensure unique filenames across goroutines.
	id := tempCounter.Add(1)
	srcFile, err := os.CreateTemp("", fmt.Sprintf("tgimg_src_%d_*.png", id))
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	srcPath := srcFile.Name()
	dstFile, err := os.CreateTemp("", fmt.Sprintf("tgimg_dst_%d_*.webp", id))
	if err != nil {
		srcFile.Close()
		os.Remove(srcPath)
		return nil, fmt.Errorf("create temp: %w", err)
	}
	dstPath := dstFile.Name()
	dstFile.Close()
	defer os.Remove(srcPath)
	defer os.Remove(dstPath)

	f := srcFile
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return nil, fmt.Errorf("encode temp png: %w", err)
	}
	f.Close()

	// Run cwebp.
	cmd := exec.Command(e.cwebpPath,
		"-q", fmt.Sprintf("%d", quality),
		"-m", "6", // compression method (0=fast, 6=best)
		"-mt",     // multi-threaded
		"-quiet",
		srcPath,
		"-o", dstPath,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("cwebp: %w: %s", err, string(out))
	}

	return os.ReadFile(dstPath)
}

// AVIFEncoder encodes images to AVIF by shelling out to avifenc.
// Install: brew install libavif / apt install libavif-bin
type AVIFEncoder struct {
	once        sync.Once
	available   bool
	avifencPath string
}

func (e *AVIFEncoder) Format() string    { return "avif" }
func (e *AVIFEncoder) Extension() string { return "avif" }

func (e *AVIFEncoder) Available() bool {
	e.once.Do(func() {
		path, err := exec.LookPath("avifenc")
		if err == nil {
			e.available = true
			e.avifencPath = path
		}
	})
	return e.available
}

func (e *AVIFEncoder) Encode(img image.Image, quality int) ([]byte, error) {
	if !e.Available() {
		return nil, fmt.Errorf("avifenc not found in PATH; install with: brew install libavif")
	}
	if quality <= 0 || quality > 100 {
		quality = 82
	}

	// avifenc uses a different quality scale: lower = better, 0-63.
	// Map our 1-100 to avifenc's scale.
	avifQ := 63 - (quality * 63 / 100)
	speed := 6 // 0=slowest, 10=fastest

	id := tempCounter.Add(1)
	srcFile, err := os.CreateTemp("", fmt.Sprintf("tgimg_avif_src_%d_*.png", id))
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	srcPath := srcFile.Name()
	dstFile, err := os.CreateTemp("", fmt.Sprintf("tgimg_avif_dst_%d_*.avif", id))
	if err != nil {
		srcFile.Close()
		os.Remove(srcPath)
		return nil, fmt.Errorf("create temp: %w", err)
	}
	dstPath := dstFile.Name()
	dstFile.Close()
	defer os.Remove(srcPath)
	defer os.Remove(dstPath)

	f := srcFile
	if err != nil {
		return nil, fmt.Errorf("create temp: %w", err)
	}
	if err := png.Encode(f, img); err != nil {
		f.Close()
		return nil, fmt.Errorf("encode temp png: %w", err)
	}
	f.Close()

	cmd := exec.Command(e.avifencPath,
		"--min", fmt.Sprintf("%d", avifQ),
		"--max", fmt.Sprintf("%d", avifQ),
		"--speed", fmt.Sprintf("%d", speed),
		"-j", "all",
		srcPath,
		dstPath,
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("avifenc: %w: %s", err, string(out))
	}

	return os.ReadFile(dstPath)
}
