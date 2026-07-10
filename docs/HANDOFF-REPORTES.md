# Handoff — Reportes (asistencias + atenciones) · limpieza de configuración

Sesión del 2026-07-10. Todo el código está **en `master` y `main`** (Vercel ya
desplegó el frontend). Queda **UN** paso manual: aplicar una migración a Supabase.

---

## ⏳ PENDIENTE (lo único que falta): aplicar la migración a Supabase

Los dos reportes nuevos usan 2 funciones de base de datos que **aún no están
aplicadas**. Mientras tanto, cada reporte muestra un aviso ámbar ("necesita que
se aplique la migración") en vez de datos.

**Archivo:** `supabase/migrations/20260710000001_reportes_atenciones_asistencias.sql`
(crea `reporte_asistencias(sede, desde, hasta)` y `reporte_atenciones(desde, hasta)`).

> No se pudo aplicar desde la sesión de Claude Code porque el entorno bloquea las
> conexiones Postgres (TCP 5432/6543 cerrado; la conexión directa es IPv6-only y
> el contenedor no tiene IPv6). Solo permite HTTPS. Hay que aplicarla desde fuera.

### Opción A — SQL Editor (recomendada, ~30 s)
1. Supabase → proyecto → **SQL Editor → New query**.
2. Pega el contenido completo de `supabase/migrations/20260710000001_reportes_atenciones_asistencias.sql`.
3. **Run**. (Es idempotente: `create or replace`, se puede correr varias veces.)

### Opción B — psql desde una máquina con salida normal (IPv6 o pooler)
```bash
PGPASSWORD='<password-de-la-BD>' PGCLIENTENCODING=UTF8 \
psql "host=db.zlmqdubrjzmagslcsqvb.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" \
  -f supabase/migrations/20260710000001_reportes_atenciones_asistencias.sql
```
(La contraseña de la BD está en el flujo de despliegue habitual del proyecto; hay
un ejemplo del patrón `psql` en `docs/superpowers/plans/` y en `.claude/settings.json`.
Tildes/emojis SOLO vía `-f archivo`, nunca `-c` inline.)

### Verificar que quedó
Después de aplicarla, entra al panel → **Reportes**. Deben cargar:
- **Asistencias**: total, por hora, por día de semana, mapa de calor, serie por
  día, filtro por rango de horas.
- **Atenciones de entrenadores**: ranking por persona + tendencia diaria.

Si sale el aviso ámbar todavía, la migración no se aplicó o el usuario no tiene
`grant execute` (el SQL ya incluye los grants a `authenticated`).

---

## 🧩 Qué se construyó en Reportes

Fuentes de datos reales (hora local del gym vía `empresa.zona_horaria`):

- **Asistencias** ← tabla `checkin` (`ocurrido_en`, `direccion='entrada'`,
  `resultado='permitido'`). RPC `reporte_asistencias` devuelve `(fecha, hora, total)`
  granular; el frontend deriva todo cliente-side (`src/components/reportes/ReporteAsistencias.jsx`).
- **Atenciones** ← `solicitud_ayuda` (tomada) + `solicitud_carga` (respondida) +
  `rutina`/`dieta` enviadas. RPC `reporte_atenciones` devuelve `(fecha, usuario, rol, tipo, total)`;
  el frontend arma ranking + tendencia (`src/components/reportes/ReporteAtenciones.jsx`).
- Control de rango de fechas con presets (`src/components/reportes/RangoFechas.jsx`).
- Reemplaza el antiguo `DesempenoTrainers` (eliminado).

### Regla de las rutinas automáticas (importante)
La asignación automática por IMC/objetivo (`rpc_asignar_plan`) crea la rutina/dieta
**sin `entrenador_id`/`nutricionista_id`** → **NO cuenta** como atención. Solo cuenta
cuando alguien la **envía** desde el portal: ahí `useEnviarPlan` ahora guarda el
`entrenador_id`/`nutricionista_id` del que envía (`src/hooks/useRutinas.js`).

---

## 🔜 Seguimientos recomendados (no bloquean nada)

1. **App móvil** (`controlgym-app`, otro repo): al **enviar** una rutina/dieta,
   guardar también `entrenador_id`/`nutricionista_id` = trainer que la trabaja, igual
   que ahora hace el portal. Sin esto, las rutinas enviadas desde la app no se
   atribuyen y no cuentan en el reporte de atenciones.
2. **Datos históricos**: las rutinas/dietas enviadas ANTES de este cambio no tienen
   entrenador guardado; no aparecerán en el reporte. La atribución acumula desde ahora.
3. **Cabos sueltos ya detectados** (de la auditoría, opcionales):
   - Rutinas → pestaña "Plantillas": editor "en construcción".
   - Máquinas: mantenimientos sin costo, aunque Finanzas ya tiene la categoría lista.

---

## ✅ Resto de la sesión (ya desplegado, solo referencia)

- **Fix MercadoPago**: "Conectar cobros" ya no manda al logout roto; redirige directo
  a la authorization (`api/mp/oauth-start.js`) + `no-store`.
- **Configuración de 12 → 8 pestañas**:
  - "Textos" → dentro de **Página web**.
  - "Sitio web" + "Página web" → una sola **Página web** (`TabWeb.jsx`).
  - "Contacto" + "Regional" + "Redes" → **Datos del negocio** (`TabNegocio.jsx`).
- **Reportes**: se quitaron las 7 descargas CSV redundantes (repetían Finanzas/
  Clientes/Kardex/CRM/Membresías) y se reemplazaron por los reportes de arriba.
- **Refactors de dedup**: `lib/pagos.js` (métodos de pago), `CrudCardGrid`+`AccionesCard`
  (Promociones/Sponsors), `claseVence`/`fechaCorta` (semáforo de vencimiento en
  Clientes y Membresías).

Rama de deploy: **`master`** (Vercel). `main` se mantiene en el mismo commit.
