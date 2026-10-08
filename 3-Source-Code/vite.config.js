import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Output is a plain static site:
//  • relative paths  → works on GitHub Pages (custom domain or /repo-name/) and opened as a file
//  • one classic script (no ES modules) → Chrome can run it from file:// when index.html is double-clicked
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'classic-script',
      enforce: 'post',
      transformIndexHtml: (html) =>
        html.replace(/<!-- source-only -->[\s\S]*?<!-- \/source-only -->\s*/, '')
            .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>')
            .replace(/ crossorigin/g, ''),
    },
  ],
  build: {
    outDir: '../1-Website',
    emptyOutDir: true,
    sourcemap: false,
    modulePreload: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: 'assets/app.[ext]',
      },
    },
  },
})
