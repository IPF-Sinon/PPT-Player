import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Renderer build for the Tauri shell.
 *
 * Tauri loads the built page from out/renderer (see src-tauri/tauri.conf.json
 * frontendDist), so this is a plain static build: no main process, no preload.
 *
 * base is './' because the page is served from the tauri://localhost (and
 * http://tauri.localhost) origin under an arbitrary path; absolute asset URLs
 * would escape the bundle.
 *
 * The pdf.js worker and its cmaps/fonts are real files in src/renderer/public,
 * copied there by scripts/copy-pdfjs-assets.mjs before this build runs. Vite copies
 * publicDir into outDir verbatim, and lib/pdf.ts resolves them relative to
 * document.baseURI, so they land at out/renderer/pdf.worker.min.mjs, out/renderer/
 * cmaps/ and out/renderer/standard_fonts/ — the same relative paths the worker
 * resolves from.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  publicDir: resolve(__dirname, 'src/renderer/public'),
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
    // The webview is WebView2 (Chromium), so a modern target is safe and keeps the
    // bundle small. Matching the tsconfig target avoids downleveling surprises.
    target: 'es2022',
    rollupOptions: {
      input: { index: resolve(__dirname, 'src/renderer/index.html') }
    }
  }
})
