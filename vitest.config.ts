import { defineConfig } from 'vitest/config'
import {fileURLToPath} from 'node:url'

export default defineConfig({
  test: {
    alias: {'brotli-wasm':fileURLToPath(new URL('./node_modules/brotli-wasm/index.node.js',import.meta.url))},
    include: ['tests/**/*.test.ts'],
    // Browser-launching suites run separately: npm run test:ui (Vitest + Chromium)
    // and npm run test:browser (Playwright).
    exclude: ['tests/**/*.browser.test.ts', 'tests/**/*.ui.test.ts'],
  },
})
