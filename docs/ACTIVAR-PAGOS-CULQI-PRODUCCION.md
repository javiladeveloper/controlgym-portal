# 💳 Activar pagos reales con Culqi (ya aprobados) — Checklist

> Culqi aprobó el comercio. El código ya está listo; solo falta cambiar las
> llaves TEST → LIVE, recrear los planes en modo producción y configurar el
> webhook. Estos pasos los ejecutas TÚ (involucran secretos de producción).

---

## Paso 1 — Consigue tus llaves LIVE de Culqi

Panel de Culqi → **Desarrollo → API Keys** → cambia el interruptor a
**"Producción"** (no "Pruebas"). Anota:
- Llave pública: empieza con `pk_live_...`
- Llave privada (secreta): empieza con `sk_live_...`

⚠️ La secreta (`sk_live_`) es sensible — no la pegues en chats ni la commitees.

---

## Paso 2 — Recrea los planes de suscripción en modo LIVE

Los planes que creaste en modo test **NO sirven en producción** (IDs distintos).
En el panel de Culqi (modo Producción) → **Recurrencia → Planes** → crea uno por
cada plan comercial. Necesitas estos 12 (6 planes × 2 variantes: solo panel / con app):

| Clave interna | Nombre sugerido | Precio/mes |
|---|---|---|
| `trainer` | FitCore Trainer | S/ 29 |
| `trainer_app` | FitCore Trainer + App | S/ 49 |
| `estudio` | FitCore Estudio | S/ 49 |
| `estudio_app` | FitCore Estudio + App | S/ 79 |
| `academia` | FitCore Academia | S/ 49 |
| `academia_app` | FitCore Academia + App | S/ 69 |
| `ninos` | FitCore Niños | S/ 69 |
| `ninos_app` | FitCore Niños + App | S/ 109 |
| `crecimiento` | FitCore Crecimiento | S/ 99 |
| `crecimiento_app` | FitCore Crecimiento + App | S/ 139 |
| `cadena` | FitCore Cadena | S/ 179 |
| `cadena_app` | FitCore Cadena + App | S/ 229 |

> Configura cada plan como **mensual**, moneda **PEN**. Si Culqi permite "primer
> ciclo gratis", actívalo (el código asume que el primer cobro real sale 1 mes
> después de activar la tarjeta — ver `suscribir.js`).

Copia el **ID de cada plan** que te da Culqi. Arma este JSON (una sola línea):

```json
{"trainer":"pln_live_xxx","trainer_app":"pln_live_xxx","estudio":"pln_live_xxx","estudio_app":"pln_live_xxx","academia":"pln_live_xxx","academia_app":"pln_live_xxx","ninos":"pln_live_xxx","ninos_app":"pln_live_xxx","crecimiento":"pln_live_xxx","crecimiento_app":"pln_live_xxx","cadena":"pln_live_xxx","cadena_app":"pln_live_xxx"}
```

> Nota: el checkout público `/planes` NO usa estos planes (hace un cargo único),
> así que empieza a cobrar apenas cambies las llaves. Los planes son solo para la
> suscripción recurrente automática del panel.

---

## Paso 3 — Actualiza las 3 variables en Vercel

Desde la terminal, en la carpeta del proyecto:

```bash
# Llave pública (pega tu pk_live_... cuando pregunte)
vercel env rm VITE_CULQI_PUBLIC_KEY production
vercel env add VITE_CULQI_PUBLIC_KEY production

# Llave secreta (pega tu sk_live_... cuando pregunte)
vercel env rm CULQI_SECRET_KEY production
vercel env add CULQI_SECRET_KEY production

# Planes recurrentes (pega el JSON de una línea del paso 2)
vercel env rm CULQI_PLANES production
vercel env add CULQI_PLANES production
```

Luego **redespliega** para que tomen efecto:
```bash
vercel --prod --yes
```

---

## Paso 4 — Configura el webhook de Culqi

Panel de Culqi (modo Producción) → **Desarrollo → Webhooks** → agrega:

- **URL:** `https://fitcorecenter.com/api/culqi/webhook`
- **Eventos:** los de cargo/suscripción — `charge.succeeded`, `charge.failed`,
  y los de suscripción si los ofrece (`subscription.charge.succeeded`, etc.).

El endpoint ya está construido: guarda cada pago en `pago_plataforma`, deduplica
por id de cargo, y actualiza el estado de la suscripción (activa / pendiente_pago).
Siempre responde 200 (no acumula reintentos).

---

## Paso 5 — Prueba con una tarjeta REAL (monto bajo)

En modo producción las tarjetas de test ya no sirven. Haz una prueba real:
1. Entra a `fitcorecenter.com/planes`.
2. Contrata el plan más barato (Trainer, S/29) con una tarjeta real tuya.
3. Verifica que el cargo aparezca en tu panel de Culqi (modo Producción).
4. (Opcional) Reembólsalo desde Culqi si fue solo prueba.

Para la suscripción recurrente: entra al panel de un gym → Config → Mi plan →
"Activar pago automático" con una tarjeta real y confirma que se crea la suscripción.

---

## ✅ Verificación final

- [ ] `pk_live_` y `sk_live_` en Vercel (no `pk_test`/`sk_test`)
- [ ] `CULQI_PLANES` con IDs `pln_live_...` (no de test)
- [ ] Redesplegado (`vercel --prod`)
- [ ] Webhook apuntando a `/api/culqi/webhook` en modo producción
- [ ] Un cargo real de prueba pasó y aparece en Culqi
- [ ] El pago quedó registrado en `pago_plataforma` de la BD

---

## ⚠️ Recordatorio de seguridad

Con pagos reales activos, **rota los secretos que estuvieron expuestos** (contraseña
de la BD, etc.) antes de escalar a muchos clientes. Es el pendiente crítico de siempre.
