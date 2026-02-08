package pipeline

import (
	"os"
	"path/filepath"
	"strings"
)

// Source represents a discovered image file.
type Source struct {
	// AbsPath is the absolute path to the file on disk.
	AbsPath string
	// RelPath is the path relative to the input directory.
	RelPath string
	// Key is the asset key (relpath without extension).
	Key string
	// Format is the source format (png, jpg, jpeg, webp, gif).
	Format string
	// Size is the file size in bytes.
	Size int64
}

// imageExtensions lists recognized image file extensions.
var imageExtensions = map[string]bool{
	".png":  true,
	".jpg":  true,
	".jpeg": true,
	".webp": true,
	".gif":  true,
	".bmp":  true,
	".tiff": true,
	".tif":  true,
}

// ScanImages walks the input directory and returns all image sources.
func ScanImages(inputDir string) ([]Source, error) {
	var sources []Source

	err := filepath.Walk(inputDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			// Skip hidden directories.
			if strings.HasPrefix(info.Name(), ".") && info.Name() != "." {
				return filepath.SkipDir
			}
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !imageExtensions[ext] {
			return nil
		}

		relPath, err := filepath.Rel(inputDir, path)
		if err != nil {
			return err
		}

		// Key: relative path without extension, using forward slashes.
		key := strings.TrimSuffix(relPath, ext)
		key = filepath.ToSlash(key)

		// Normalize format name.
		format := strings.TrimPrefix(ext, ".")
		if format == "jpg" {
			format = "jpeg"
		}
		if format == "tif" {
			format = "tiff"
		}

		sources = append(sources, Source{
			AbsPath: path,
			RelPath: filepath.ToSlash(relPath),
			Key:     key,
			Format:  format,
			Size:    info.Size(),
		})

		return nil
	})

	return sources, err
}
