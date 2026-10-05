import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  // Each page runs software WebGL (multi-threaded SwiftShader) plus SGP4 workers: on the 4-vCPU CI runner two
  // parallel pages starve each other (timeouts in random tests), so CI runs one at a time.
  workers: process.env['CI'] ? 1 : 2,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/Perigee/`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /mobile.spec.ts/,
      use: {
        ...devices['Desktop Chrome'],
        // Software WebGL for headless runs without a GPU.
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
    {
      // Phone layout (portrait, touch).
      name: 'mobile',
      testMatch: /mobile.spec.ts/,
      use: {
        ...devices['Pixel 7'],
        launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
      },
    },
  ],
  webServer: {
    // Serves the production build (run `npm run build` first) with deterministic fixture data.
    command: `npx tsx tests/e2e/prepare-data.ts && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/Perigee/`,
    reuseExistingServer: !process.env['CI'],
  },
});
