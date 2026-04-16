import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative } from 'path'

/**
 * Vite plugin: generate service worker with precache manifest.
 * After build, scans dist/ for all emitted files and injects them
 * into sw.js so they are precached on install.
 */
function swPrecachePlugin() {
  return {
    name: 'sw-precache',
    apply: 'build',
    closeBundle() {
      const distDir = resolve('dist')
      const allFiles = []

      // Recursively collect all files in dist/
      function walk(dir) {
        for (const entry of readdirSync(dir)) {
          const full = join(dir, entry)
          if (statSync(full).isDirectory()) {
            walk(full)
          } else {
            const rel = '/' + relative(distDir, full).replace(/\\/g, '/')
            // Skip the sw.js itself
            if (rel !== '/sw.js') allFiles.push(rel)
          }
        }
      }
      walk(distDir)

      // Read the sw.js template from public/ and replace the placeholder
      const swTemplate = readFileSync(resolve('public/sw.js'), 'utf-8')
      const cacheVersion = `vertex-agent-${Date.now()}`
      const swContent = swTemplate
        .replace(
          /const CACHE_NAME = '[^']*'/,
          `const CACHE_NAME = '${cacheVersion}'`
        )
        .replace(
          /const APP_SHELL = \[[^\]]*\]/s,
          `const APP_SHELL = ${JSON.stringify(allFiles, null, 2)}`
        )

      writeFileSync(join(distDir, 'sw.js'), swContent)
      console.log(`\n  SW precache: ${allFiles.length} files cached`)
    },
  }
}

// Shared proxy config for agent API
const agentProxy = {
  '/agent': {
    target: 'http://localhost:3099',
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swPrecachePlugin()],
  server: {
    port: 5173,
    proxy: agentProxy,
  },
  preview: {
    port: 5173,   // same port as dev so OPFS data is preserved across modes
    proxy: agentProxy,
  },
})
