import { defineConfig, devices } from '@playwright/test'

// Suite E2E de FitCore. Cubre los flujos PÚBLICOS (landing, /planes, /demo,
// landing de gym, legales) — que no requieren login y son los que ven los
// prospectos y el revisor de Culqi. Los flujos del panel (tras login Google)
// se dejan preparados para correr con storageState cuando haya sesión guardada.
//
// Uso:
//   npm run e2e            → contra producción (BASE_URL por defecto)
//   BASE_URL=http://localhost:4173 npm run e2e   → contra preview local
const BASE = process.env.BASE_URL || 'https://fitcorecenter.com'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
