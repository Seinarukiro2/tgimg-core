/**
 * vite-plugin-tgimg — Vite integration for tgimg image pipeline.
 *
 * What it does:
 * - Watches tgimg manifest for HMR during dev
 * - Copies tgimg output assets to Vite build output
 * - Provides a virtual module for type-safe manifest import
 */

import type { Plugin, ResolvedConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export interface TgImgPluginOptions {
  /**
   * Path to the tgimg output directory (where tgimg build wrote files).
   * Default: 'tgimg_out'
   */
  dir?: string;

  /**
   * Path to the manifest file relative to `dir`.
   * Default: 'tgimg.manifest.json'
   */
  manifest?: string;
}

const VIRTUAL_ID = 'virtual:tgimg-manifest';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

export default function tgimg(options: TgImgPluginOptions = {}): Plugin {
  const dir = options.dir ?? 'tgimg_out';
  const manifestName = options.manifest ?? 'tgimg.manifest.json';
  let config: ResolvedConfig;

  return {
    name: 'vite-plugin-tgimg',

    configResolved(resolved) {
      config = resolved;
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        const manifestPath = path.resolve(config.root, dir, manifestName);
        if (!fs.existsSync(manifestPath)) {
          this.warn(
            `[tgimg] Manifest not found at ${manifestPath}. Run \`tgimg build\` first.`,
          );
          return 'export default {}';
        }
        const content = fs.readFileSync(manifestPath, 'utf-8');
        return `export default ${content}`;
      }
    },

    configureServer(server) {
      // Watch manifest for HMR.
      const manifestPath = path.resolve(config.root, dir, manifestName);
      if (fs.existsSync(manifestPath)) {
        server.watcher.add(manifestPath);
        server.watcher.on('change', (changedPath) => {
          if (path.resolve(changedPath) === manifestPath) {
            // Invalidate the virtual module to trigger HMR.
            const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID);
            if (mod) {
              server.moduleGraph.invalidateModule(mod);
              server.ws.send({ type: 'full-reload' });
            }
          }
        });
      }
    },

    // Copy tgimg assets to build output.
    writeBundle() {
      const srcDir = path.resolve(config.root, dir);
      if (!fs.existsSync(srcDir)) return;

      const outDir = config.build.outDir;
      const destDir = path.resolve(config.root, outDir, dir);

      copyDirRecursive(srcDir, destDir, manifestName);
    },
  };
}

function copyDirRecursive(src: string, dest: string, skipFile?: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      // Skip manifest (it's embedded via virtual module).
      if (entry.name === skipFile) continue;
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
