/**
 * Playwright config for spike tests (run from sobrecito/tests/).
 * Points the dev server to apps/web and serves public/zk/ artifacts.
 */
import { defineConfig, devices } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webDir = path.resolve(__dirname, '../apps/web')

export default defineConfig({
  testDir: __dirname,
  testMatch: '*.mjs',
  timeout: 300_000,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'line',
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm -C ${webDir} dev -- --port 3001`,
    url: 'http://localhost:3001',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
