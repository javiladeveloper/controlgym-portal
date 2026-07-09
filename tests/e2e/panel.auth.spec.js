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

  // ── Features nuevas (2026-07-09): cobros app, check-in, tienda ──────────────

  test('Config → Cobros muestra el estado de conexión MercadoPago', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/configuracion?tab=cobros')
    await expect(page.getByText(/cobros por la app|conectar con mercadopago|conectado/i).first())
      .toBeVisible({ timeout: 20_000 })
  })

  test('Config → Control de acceso muestra el selector de método', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/configuracion?tab=acceso')
    await expect(page.getByText(/método de control de acceso|botón en la app|qr con app-kiosco/i).first())
      .toBeVisible({ timeout: 20_000 })
  })

  test('Config → Control de acceso ofrece la clave de conexión de equipos', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/configuracion?tab=acceso')
    await expect(page.getByText(/clave de conexión|molinete|lector físico/i).first())
      .toBeVisible({ timeout: 20_000 })
  })

  test('Kardex carga y el modal de producto permite vender en la app', async ({ page }) => {
    await page.goto('https://app.fitcorecenter.com/kardex')
    // La página de kardex carga (inventario / ventas)
    await expect(page.getByText(/inventario|productos|ventas del mes/i).first())
      .toBeVisible({ timeout: 20_000 })
    // Abrir el primer producto para editarlo (si hay productos) y ver el toggle de app
    const editar = page.getByTitle('Editar producto').first()
    if (await editar.isVisible().catch(() => false)) {
      await editar.click()
      await expect(page.getByText(/vender en la app/i).first()).toBeVisible({ timeout: 10_000 })
    }
  })
})
