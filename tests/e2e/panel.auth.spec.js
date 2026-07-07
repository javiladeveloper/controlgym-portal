import { test, expect } from '@playwright/test'
import fs from 'node:fs'

// Tests E2E del PANEL (requieren sesión). El login es con Google, que no se
// automatiza headless. Para correr estos:
//   1) npx playwright codegen https://app.fitcorecenter.com  → loguéate a mano
//   2) guarda el estado:  await context.storageState({ path: 'tests/e2e/.auth/admin.json' })
//   3) BASE_URL=https://app.fitcorecenter.com npm run e2e -- panel.auth
//
// Si no existe el storageState, estos tests se SALTAN (no fallan la suite).
const AUTH = 'tests/e2e/.auth/admin.json'
const haySesion = fs.existsSync(AUTH)

test.describe('Panel (autenticado)', () => {
  test.skip(!haySesion, 'Sin sesión guardada — ver instrucciones en el archivo')
  test.use({ storageState: haySesion ? AUTH : undefined })

  test('el Dashboard carga con KPIs', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/')
    await expect(page.getByText(/socios activos|ingresos|asistencia/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('Clientes lista socios y permite buscar', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/clientes')
    await expect(page.getByPlaceholder(/buscar/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('Membresías muestra cobros pendientes', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/membresias')
    await expect(page.getByText(/vence|pendiente|renovar/i).first()).toBeVisible({ timeout: 20_000 })
  })

  test('Finanzas muestra caja del día', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/finanzas')
    await expect(page.getByText(/caja|ingreso|gasto/i).first()).toBeVisible({ timeout: 20_000 })
  })
})
