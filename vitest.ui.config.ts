import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Vitest suites that launch Chromium: run with npm run test:ui.
export default defineConfig({
  test: {
    alias: { 'brotli-wasm': fileURLToPath(new URL('./node_modules/brotli-wasm/index.node.js', import.meta.url)) },
    include: ['tests/**/*.ui.test.ts'],
  },
})
