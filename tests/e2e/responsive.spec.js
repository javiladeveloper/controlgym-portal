import { test, expect } from '@playwright/test'

// Verifica que las páginas PÚBLICAS no tengan scroll horizontal en móvil
// (síntoma clásico de responsive roto). El panel requiere login Google; su
// responsive se cubre en panel.auth.spec.js cuando hay sesión guardada.
//
// Corre contra BASE_URL (producción por defecto). En móvil (375px).
test.use({ viewport: { width: 375, height: 812 } })

const PUBLICAS = ['/', '/planes', '/demo', '/legal/terminos', '/legal/privacidad']

for (const ruta of PUBLICAS) {
  test(`${ruta} no tiene scroll horizontal @375px`, async ({ page }) => {
    await page.goto(ruta, { waitUntil: 'networkidle' }).catch(() => {})
    // Tolerancia de 2px por bordes de subpíxel.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, `overflow horizontal en ${ruta}`).toBeLessThanOrEqual(2)
  })
}
