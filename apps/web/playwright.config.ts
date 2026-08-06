import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // The terrain protocol reads back from the GL framebuffer to detect when
    // analysis tiles have actually painted; without this the buffer is cleared
    // after each frame and the wait never resolves.
    // The sandbox ships Chromium 1194 but this Playwright expects a newer
    // build, so point at the pre-installed binary rather than downloading one
    // (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD is set in this environment).
    launchOptions: {
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
      // Software GL is slow; give the analysis worker room.
      timeout: 120_000,
    },
    deviceScaleFactor: 2,
  },
  webServer: {
    command: 'pnpm exec vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
