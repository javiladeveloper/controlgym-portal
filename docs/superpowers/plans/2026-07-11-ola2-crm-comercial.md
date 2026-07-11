# Ola 2 — CRM comercial Pro (asesores, metas, rankings, SLA, agenda) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El bloque comercial del wishlist del cliente Pro: conversión y ventas por asesor, meta diaria por vendedor (dashboard), ranking de vendedores, alertas SLA de seguimiento, agenda comercial, reactivación de ex-socios, registro de llamadas y cumpleaños automáticos.

**Architecture:** Atribución de venta = `movimiento_financiero.registrado_por` (quién cobró — cero cambios en RPCs de dinero). Conversión = `lead.asignado_a` → `lead.socio_id` (ya existen). Metas en tabla nueva `meta_vendedor`. Alertas SLA y cumpleaños como **pg_cron jobs** (patrón de los 7 existentes `fitcontrol-*`, usan `encolar_push` + `llamar_push_worker`). UI: nueva pestaña "Comercial 🎯" en Reportes (agrupación ya existente), agenda y reactivación dentro de CRM, tarjeta de metas en Dashboard.

## Nota de integración futura (owner, 2026-07-11)

El CRM se integrará con **LeadAI** (producto propio del owner, en desarrollo). Implicación
HOY: mantener contratos limpios y desacoplados — `lead.fuente` ya existe (LeadAI entrará
como fuente 'leadai' inyectando leads vía API/RPC), las RPCs de reporte comercial no deben
asumir origen de los leads, y nada de lógica hardcodeada que estorbe esa integración.
No construir la integración ahora.

## Global Constraints

- Migraciones `.sql` UTF-8 psql `-f`, siguiente libre `20260711000010`. `DBURL=$(cat /tmp/.dburl)`, no imprimirlo. Commits locales; el controller mergea/pushea al final de la ola.
- RPCs `security definer` + `auth_empresa_id()` no nulo + todo filtrado por empresa. Read-only salvo las de metas (upsert) y las funciones de cron.
- Timezone empresa (nunca current_date a secas).
- pg_cron: seguir el patrón de los jobs existentes (leer uno con `select command from cron.job where jobname='fitcontrol-vencimientos-socios'` antes de crear los nuevos). Nombres: `fitcontrol-sla-leads` (cada hora), `fitcontrol-cumpleanos` (diario ~13:00 UTC = 8am Perú). Idempotentes (no duplicar push del mismo día/lead).
- UI: tokens del tema, patrones existentes (tabs de Reportes, cards de CRM, StatCard), responsive, español. Directiva del owner: agrupado y claro, no confuso.
- Dashboard: la tarjeta de metas es accionable de HOY (venta del día vs meta) — cumple la directiva.

---

## Task 1: Migración — metas, RPCs comerciales y crons (SLA + cumpleaños)

**Files:** Create `supabase/migrations/20260711000010_crm_comercial.sql`

**Interfaces (produce):**
- Tabla `meta_vendedor` (empresa_id, usuario_id, monto_diario numeric, activo bool, unique(empresa_id, usuario_id)). RLS: select para authenticated de la empresa; escritura vía RPC admin.
- `guardar_meta_vendedor(p_usuario_id, p_monto_diario) → void` (solo admin).
- `reporte_comercial(p_desde date default null, p_hasta date default null) → jsonb` — `{vendedores:[{usuario_id, nombre, ventas_total, n_ventas, meta_diaria, leads_asignados, leads_convertidos, conversion}], por_dia_hoy:[{usuario_id, nombre, hoy, meta_diaria}]}`. Ventas = movimiento_financiero ingresos agrupados por registrado_por (default: mes actual); conversión = leads asignados vs con socio_id (etapa inscrito).
- `agenda_comercial() → jsonb` — tareas de leads de la empresa: `{vencidas:[...], hoy:[...], proximas:[...]}` con `{id, lead_id, lead_nombre, lead_telefono, tipo, detalle, vence_at, asignado_a, asignado_nombre}` (límite 50 c/u).
- `ex_socios(p_meses int default 6) → jsonb` — socios cuya última membresía venció hace ≤ p_meses y no tienen activa: `[{socio_id, nombre, telefono, ultimo_plan, vencio_hace_dias}]`.
- Función cron `sla_leads_sin_seguimiento()`: leads en etapa nuevo/contactado SIN tarea creada en las últimas 24h y sin push de SLA hoy → `encolar_push` al `asignado_a` (o admins si null) "⏰ Lead <nombre> lleva 24h sin seguimiento". Idempotencia: tabla liviana `sla_lead_avisado(lead_id, fecha)` o data->fecha en push_cola — elegir lo simple y documentar.
- Función cron `push_cumpleanos()`: socios activos con cumpleaños HOY (hora empresa) → push al socio ("🎂 ¡Feliz cumpleaños <nombre>!...") si tiene usuario con token + `encolar_push` a recepción/admin con la lista del día. Idempotente por día.
- Registrar ambos en `cron.job` (SLA cada hora, cumpleaños 13:00 UTC) + `llamar_push_worker()` al final de cada función.

Steps: verificar patrón de cron existente → escribir → aplicar → probar RPCs con sesión simulada (karina `6f7c075c-...`, Maximus) y las funciones cron ejecutándolas directo en transacción+rollback → commit.

---

## Task 2: Reportes — pestaña "Comercial 🎯"

**Files:** Create `src/components/reportes/ReporteComercial.jsx`; Modify `src/pages/Reportes.jsx` (+tab), `src/hooks/useReportes.js` (+useReporteComercial).

- Ranking de vendedores: tabla ordenada por ventas del período (nombre · ventas S/ · nº cobros · conversión% · meta diaria) con medallas 🥇🥈🥉 para el top 3. Selector de período (este mes / mes pasado / 30 días).
- Conversión por asesor visible como % con badge (verde ≥30%, ámbar 15-30%, rojo <15%).
- Nota al pie: "Las ventas se atribuyen a quien registró el cobro". Build + commit.

---

## Task 3: CRM — agenda comercial + reactivación de ex-socios + llamadas

**Files:** Modify `src/pages/CRM.jsx` (leerlo entero primero), `src/hooks/` según patrón del CRM existente.

- **Agenda:** card/section "📅 Agenda" arriba del pipeline: 3 columnas (Vencidas — rojo · Hoy — ámbar · Próximas) con `agenda_comercial()`; cada tarea muestra lead, tipo, detalle, hora y asignado; clic lleva al lead. Colapsable si el CRM ya está denso.
- **Reactivación:** tab o card "↩️ Ex-socios" con `ex_socios()`: nombre · último plan · venció hace X días · botón WhatsApp (mensaje de reactivación) · botón "Crear lead" (inserta lead etapa nuevo con nota "ex-socio, reactivación" — reusar el insert de leads existente).
- **Llamadas:** al crear una tarea de lead, el `tipo` debe ofrecer 'llamada' (verificar el selector existente de lead_tarea.tipo; si ya es texto libre/select, añadir la opción y un icono 📞 en la lista). Build + commit.

---

## Task 4: Dashboard — meta diaria por vendedor

**Files:** Modify `src/pages/Dashboard.jsx`, hook en `useDashboard.js` o `useReportes.js`.

- Card "🎯 Metas de hoy" (solo si hay metas configuradas — si `reporte_comercial().por_dia_hoy` viene vacío/sin metas → no se muestra): por vendedor, barra logrado-vs-meta (verde al 100%+). Admin ve todos; recepción se ve a sí misma (filtrar por usuario actual si rol recepcion).
- **Config de metas:** en Personal (página de staff, leerla), en la fila/ficha de cada empleado con rol recepcion/admin: input "Meta diaria S/" → `guardar_meta_vendedor`. Ubicar donde no ensucie (modal de edición existente del empleado si lo hay). Build + commit.

## Self-Review
Cubre: conversión por asesor ✅(T1+T2) · venta por asesor ✅(registrado_por) · meta diaria dashboard ✅(T4) · ranking vendedores ✅(T2) · ranking entrenadores ✅(ya existía en ReporteAtenciones) · SLA alerta ✅(T1 cron) · agenda ✅(T1+T3) · ex-socios ✅(T1+T3) · llamadas ✅(T3) · cumpleaños auto ✅(T1 cron). Frágiles marcados: patrón cron real (T1 lo lee), estructura CRM.jsx y selector de tipo de tarea (T3 lee), dónde configurar metas en Personal (T4 lee).
