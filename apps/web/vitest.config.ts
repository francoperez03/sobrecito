import { defineConfig } from 'vitest/config'

// Unit tests for pure browser-side logic (ext_data_hash, denomination builder).
// Kept separate from Playwright e2e: `test` stays `playwright test`, unit runs
// via `test:unit` (`vitest run`). Only *.unit.test.ts(x) files are picked up so
// Playwright specs under tests/ are never collected by vitest.
export default defineConfig({
  test: {
    include: ['src/**/*.unit.test.{ts,tsx,mts}', 'tests/unit/**/*.test.{ts,mts}'],
    environment: 'node',
    globals: false,
  },
})
