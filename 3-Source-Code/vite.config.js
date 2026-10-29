import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const here = path.dirname(fileURLToPath(import.meta.url))
// Keep the live site's settings: the build empties 1-Website, so remember config.js and put it back afterwards
const liveConfigPath = path.resolve(here, '../1-Website/config.js')
const liveConfig = fs.existsSync(liveConfigPath) ? fs.readFileSync(liveConfigPath, 'utf8') : null

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
    {
      // Technician app lives in its own folder (…/tech/) so iPhone Home Screen icons open HT Jobs, not the office login
      name: 'tech-entry',
      apply: 'build',
      closeBundle() {
        const out = path.resolve(here, '../1-Website')
        const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
          .replace(/(src|href)="\.\//g, '$1="../')
          .replace('href="../manifest.json"', 'href="../manifest-tech.json"')
          .replace('href="../icons/apple-touch-icon.png"', 'href="../icons/tech-apple-touch-icon.png"')
          .replace('content="Hitech Ops"', 'content="HT Jobs"')
          .replace(/<title>[^<]*<\/title>/, '<title>HT Jobs — Hitech Services</title>')
          .replace('<script src="../config.js">', '<script>window.HT_TECH_ENTRY = true</script>\n    <script src="../config.js">')
        fs.mkdirSync(path.join(out, 'tech'), { recursive: true })
        fs.writeFileSync(path.join(out, 'tech', 'index.html'), html)
        if (liveConfig && !liveConfig.includes('YOUR-PROJECT-ID')) fs.writeFileSync(liveConfigPath, liveConfig)
      },
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
