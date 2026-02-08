package cmd

import (
	"fmt"
	"os"
	"runtime"

	"github.com/spf13/cobra"
)

var (
	version = "0.1.0"
	verbose bool
)

var rootCmd = &cobra.Command{
	Use:   "tgimg",
	Short: "Ultra-fast image pipeline for Telegram Mini Apps",
	Long: `tgimg — turns megabyte banners/buttons into fast, cache-friendly assets
with instant thumbhash placeholders and zero layout shift.

Generates optimized AVIF/WebP variants, content-addressed filenames,
and a manifest for the @tgimg/react runtime component.`,
	Version: version,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.PersistentFlags().BoolVarP(&verbose, "verbose", "v", false, "verbose output")
	rootCmd.SetVersionTemplate(fmt.Sprintf(
		"tgimg %s (%s/%s, %s)\n",
		version, runtime.GOOS, runtime.GOARCH, runtime.Version(),
	))
}

// logVerbose prints a message only when --verbose is set.
func logVerbose(format string, args ...any) {
	if verbose {
		fmt.Fprintf(os.Stderr, "[tgimg] "+format+"\n", args...)
	}
}
