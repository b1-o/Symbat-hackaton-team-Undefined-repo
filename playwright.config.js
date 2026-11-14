import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://127.0.0.1:3000/api/health',
        reuseExistingServer: !process.env.CI,
        timeout: 30000,
        env: { DEMO_MODE: 'true', SEED_DEMO: 'true', DB_PATH: './data/e2e.db' },
      },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3000',
    headless: true,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--single-process',
            '--no-zygote',
          ],
        }
      : {},
  },
});
