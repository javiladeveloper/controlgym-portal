import { defineConfig } from 'vitest/config'

// Suite de unit tests (lógica pura: cuadre NORAC, helpers de fecha, pagos).
// No confundir con tests/e2e (Playwright, ver playwright.config.js): vitest
// solo mira archivos *.test.js bajo tests/, excluyendo tests/e2e.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
  },
})
