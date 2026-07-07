import { test, expect } from '@playwright/test'

// Flujos PÚBLICOS de FitCore: lo que ven prospectos y el revisor de Culqi.
// No requieren login. Cubren captación (landing, /planes, /demo), la landing
// de un gym real y las páginas legales.

test.describe('Landing de plataforma', () => {
  test('carga y muestra el hero + CTA de registro', async ({ page }) => {
    await page.goto('/')
    // El checkpoint de Vercel puede interponerse: esperamos al contenido real.
    await expect(page).toHaveTitle(/FitCore/i, { timeout: 20_000 })
    // CTA principal para crear gimnasio / prueba gratis
    await expect(page.getByRole('link', { name: /crear mi gimnasio|empieza gratis|prueba/i }).first()).toBeVisible()
  })

  test('la sección de precios muestra los planes', async ({ page }) => {
    await page.goto('/#precios')
    await expect(page.getByText(/S\/\s?\d/).first()).toBeVisible({ timeout: 20_000 })
  })

  test('menciona el asistente de IA (próximamente)', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // La sección nueva de IA — presente tras el deploy
    const ia = page.getByText(/responde tus redes|asistente de ia|una ia que/i)
    await expect(ia.first()).toBeVisible({ timeout: 20_000 })
  })
})

test.describe('Checkout público /planes (requisito Culqi)', () => {
  test('muestra al menos 5 planes con precio y botón de pago', async ({ page }) => {
    await page.goto('/planes')
    await expect(page.getByRole('heading', { name: /el plan justo/i })).toBeVisible({ timeout: 20_000 })
    // >= 5 botones "Contratar" (Culqi exige 5+ servicios con pago)
    const contratar = page.getByRole('button', { name: /contratar/i })
    await expect(async () => {
      expect(await contratar.count()).toBeGreaterThanOrEqual(5)
    }).toPass()
    // cada plan muestra un precio en soles
    await expect(page.getByText(/S\/\s?\d/).first()).toBeVisible()
  })

  test('el botón Contratar abre el modal de checkout', async ({ page }) => {
    await page.goto('/planes')
    await page.getByRole('button', { name: /contratar/i }).first().click()
    await expect(page.getByRole('heading', { name: /contratar/i })).toBeVisible()
    // pide datos mínimos y ofrece pagar con tarjeta
    await expect(page.getByPlaceholder(/correo/i)).toBeVisible()
    await expect(page.getByRole('button', { name: /pagar .* tarjeta/i })).toBeVisible()
  })

  test('el toggle solo-panel / con-app cambia los precios', async ({ page }) => {
    await page.goto('/planes')
    const primerPrecio = page.getByText(/S\/\s?\d+/).first()
    const antes = await primerPrecio.textContent()
    await page.getByRole('button', { name: /panel \+ app/i }).click()
    // el precio del primer plan sube al activar la app
    await expect(primerPrecio).not.toHaveText(antes || '', { timeout: 5_000 })
  })
})

test.describe('Demo de venta /demo', () => {
  test('carga el recorrido y el botón de gym de ejemplo', async ({ page }) => {
    await page.goto('/demo')
    await expect(page).toHaveTitle(/FitCore/i, { timeout: 20_000 })
    await expect(page.getByRole('link', { name: /gym de ejemplo|ver en vivo/i }).first()).toBeVisible()
  })
})

test.describe('Landing de un gym real (MaximusGym)', () => {
  test('carga con su marca y CTA de inscripción', async ({ page }) => {
    await page.goto('https://maximusgym.fitcorecenter.com')
    await expect(page).toHaveTitle(/maximus/i, { timeout: 20_000 })
    await expect(page.getByRole('button', { name: /inscr|entrenar|clase gratis/i }).first()).toBeVisible()
  })
})

test.describe('Páginas legales (confianza / Culqi)', () => {
  for (const ruta of ['/terminos', '/privacidad', '/reclamaciones']) {
    test(`${ruta} carga sin error`, async ({ page }) => {
      const resp = await page.goto(ruta)
      expect(resp?.status()).toBeLessThan(400)
      await expect(page.locator('body')).not.toBeEmpty()
    })
  }
})
