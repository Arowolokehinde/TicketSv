import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: '**/signed-auth.browser.test.ts',
  webServer: [
    { command: 'node scripts/test-backend.mjs node --experimental-strip-types scripts/serve-test-api.ts', port: 5197, reuseExistingServer: false, timeout: 60_000 },
    { command: 'npm run build && npm run preview', url: 'http://127.0.0.1:4175', env: { TICKETSV_API_TARGET: 'http://127.0.0.1:5197' }, reuseExistingServer: false, timeout: 60_000 },
  ],
})
