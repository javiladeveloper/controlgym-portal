# Ola 1 — Reportes agrupados + dashboard curado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Los 10 reportes del wishlist del cliente Pro, organizados según la directiva del owner: Reportes con pestañas por categoría (Ventas · Socios · Asistencia · Personal), Dashboard solo con lo accionable de HOY (+aforo en vivo), e historial de pagos en la ficha del socio. Entendible y manejable, no confuso.

**Architecture:** RPCs read-only `security definer` (validan `auth_empresa_id()`) para cada reporte; la página Reportes se reestructura con el patrón de tabs de Configuracion.jsx (array TABS {key,label,Comp}), integrando los 2 componentes existentes (ReporteAsistencias, ReporteAtenciones) en sus categorías; el Dashboard gana la tarjeta de aforo en vivo y se cura según la directiva; la ficha del socio gana su historial de pagos.

**Tech Stack:** Supabase (psql UTF-8), React Query, componentes del tema (Card, StatCard, Badge, LoadingState/EmptyState/ErrorState).

## Global Constraints

- Migraciones `.sql` UTF-8 psql `-f`; siguiente número libre `20260711000008`. `DBURL=$(cat /tmp/.dburl)`; NO imprimirlo. Commits locales; push solo al final de la ola (el controller lo hace).
- RPCs de reporte: READ-ONLY, `security definer set search_path to 'public'`, primera línea valida `v_empresa := public.auth_empresa_id()` no nulo (excepción si null), y TODO filtra por esa empresa. Sede como parámetro opcional (null = todas las sedes de la empresa).
- Zona horaria: fechas "de hoy/del día" con `(now() at time zone coalesce(empresa.zona_horaria,'America/Lima'))::date` — NUNCA current_date a secas (bug UTC ya mordió 2 veces).
- Aforo en vivo: entradas − salidas de HOY por sede, con **expiración automática**: una entrada de hace más de 2 horas sin salida cuenta como que ya salió (los gyms no siempre marcan salida). `aforo = count(entradas sin salida posterior y con menos de 2h)`.
- UI: directiva del owner — agrupado, claro, no confuso. Tabs como Configuracion.jsx. Tokens del tema. Responsive 375px. Copy español sentence case. Los reportes usan Card + StatCard + tablas con overflow-x-auto.
- Dashboard: SOLO accionable de hoy. Lo histórico vive en Reportes. No colgar bloques nuevos salvo el aforo (que ES de hoy).
- Churn mensual = membresías que vencieron en el mes y NO fueron renovadas (sin membresía activa posterior del mismo socio) ÷ activas al inicio del mes.
- Proyección del mes = suma de `plan.precio` de membresías activas que vencen en lo que resta del mes (renovación esperada) + ingresos ya registrados del mes.

---

## Task 1: Migración — RPCs de reportes (read-only)

**Files:**
- Create: `supabase/migrations/20260711000008_rpcs_reportes.sql`

**Interfaces (produce — consumidas por T2/T3/T4):**
- `reporte_ventas_serie(p_sede_id uuid default null, p_desde date default null, p_hasta date default null) → jsonb` — serie por día: `[{fecha, total, por_metodo:{efectivo:.., yape:..}}]` de `movimiento_financiero` tipo ingreso (default: últimos 30 días).
- `reporte_socios_kpis(p_sede_id uuid default null) → jsonb` — `{nuevos_30d:[{fecha,n}], churn_6m:[{mes, vencidas, no_renovadas, activas_inicio, tasa}], proyeccion_mes:{ingresado, por_renovar, total}, congeladas:[{socio, plan, desde, hasta}], total_activos}`.
- `reporte_ausentes(p_sede_id uuid default null, p_dias int default 15) → jsonb` — socios activos sin check-in hace ≥ p_dias: `[{socio_id, nombre, codigo, telefono, ultima_visita, dias_ausente}]` orden desc por días.
- `aforo_actual(p_sede_id uuid) → jsonb` — `{dentro, aforo_max, pct}` con la regla de expiración 2h.
- `historial_pagos_socio(p_socio_id uuid) → jsonb` — pagos del socio (ingresos de caja ligados a sus membresías + sus pago_app aprobados): `[{fecha, concepto, monto, metodo, origen}]` desc. Valida que el socio sea de la empresa del caller.

- [ ] **Step 1: Escribir la migración** con las 5 RPCs. Verificar ANTES los nombres de columnas que se usen (`movimiento_financiero`: tipo/categoria/monto/metodo_pago/fecha(timestamptz)/ref_tipo/ref_id/sede_id; `membresia`: estado/fecha_inicio/fecha_fin/socio_id/plan_id; `congelamiento`: existe — verificar columnas con information_schema; `checkin`: socio_id/direccion/resultado/ocurrido_en/sede_id; `pago_app`: socio_id/estado_pago/monto/concepto/pagado_at). Ajustar el SQL a las columnas REALES.
- [ ] **Step 2: Aplicar** con psql -f. Expected: 5× CREATE FUNCTION + GRANTs a authenticated.
- [ ] **Step 3: Probar cada RPC** en transacción con la sesión simulada del admin de Maximus (patrón `set_config('request.jwt.claims','{"sub":"<uid admin>"...')` — usar el uid de karinabizarroq o del owner de Maximus) y sede `77496573-c230-449a-b11e-55cab3e2f6ac`. Cada una debe devolver jsonb bien formado (no error), aunque con pocos datos. Pegar outputs en el reporte.
- [ ] **Step 4: Commit** `feat(reportes): RPCs read-only (ventas serie, KPIs socios, ausentes, aforo, historial pagos)`.

---

## Task 2: Reportes agrupado por categorías

**Files:**
- Modify: `src/pages/Reportes.jsx` (shell → tabs)
- Create: `src/components/reportes/ReporteVentas.jsx`, `src/components/reportes/ReporteSocios.jsx`
- Create: `src/hooks/useReportes.js`

**Interfaces:** consume las RPCs de T1 vía `useReportes.js` (`useVentasSerie(sedeId, desde, hasta)`, `useSociosKpis(sedeId)`, `useAusentes(sedeId, dias)`).

- [ ] **Step 1: Hook `useReportes.js`** — 3 useQuery envolviendo las RPCs (keys: ['rep-ventas',...], ['rep-socios',...], ['rep-ausentes',...]).
- [ ] **Step 2: `ReporteVentas.jsx`** — StatCards (hoy, semana, mes — derivados de la serie), gráfico/tabla de la serie diaria (usar el patrón visual de ReporteAsistencias: leerlo y seguir su estilo de barras/tabla), desglose por método, y bloque "Proyección del mes" (ingresado + por renovar = total, de reporte_socios_kpis).
- [ ] **Step 3: `ReporteSocios.jsx`** — StatCards (activos, nuevos 30d, congeladas), tabla churn 6 meses (mes · vencidas · no renovadas · tasa%), tabla de AUSENTES con selector de días (7/15/30) y botón por fila "WhatsApp" (wa.me con mensaje "te extrañamos"), lista de congeladas.
- [ ] **Step 4: `Reportes.jsx` con tabs** — patrón Configuracion.jsx: `TABS = [ventas: ReporteVentas, socios: ReporteSocios, asistencia: ReporteAsistencias (existente), personal: ReporteAtenciones (existente)]` con deep-link `?tab=`. Título + subtítulo actuales se conservan.
- [ ] **Step 5: build + commit** `feat(reportes): seccion agrupada — Ventas · Socios · Asistencia · Personal`.

---

## Task 3: Dashboard curado + aforo en vivo

**Files:**
- Modify: `src/pages/Dashboard.jsx`, `src/hooks/useDashboard.js`

- [ ] **Step 1: Tarjeta de aforo en vivo** — hook `useAforo(sedeId)` (RPC aforo_actual, refetchInterval 30s). Card compacta junto a los KPIs de arriba: "🏟️ Aforo ahora: 23/80 (29%)" con barra de progreso (verde <70%, amber 70-90%, rojo >90%). Si la sede no tiene aforo_max → no se muestra.
- [ ] **Step 2: Curaduría** — leer el Dashboard completo y aplicar la directiva: se QUEDA lo accionable de hoy (KPIs del día, check-ins EN VIVO, por vencer/deudas accionables, cámaras, fotos por aprobar, aforo). Lo HISTÓRICO (si hay gráficos de tendencia/mes que ya viven en Reportes) se reemplaza por un link "Ver en Reportes →". NO borrar funcionalidad: solo mover/linkear. Documentar en el reporte qué se movió y por qué.
- [ ] **Step 3: build + commit** `feat(dashboard): aforo en vivo + curaduria (solo lo accionable de hoy)`.

---

## Task 4: Historial de pagos en la ficha del socio

**Files:**
- Modify: `src/pages/Clientes.jsx` (ficha), `src/hooks/useClientes.js`

- [ ] **Step 1: Hook** `useHistorialPagos(socioId)` → RPC historial_pagos_socio.
- [ ] **Step 2: UI** — en la ficha del socio, card colapsable "💳 Historial de pagos" (colapsada por defecto, monta el hook solo al expandir — patrón del historial de caja en Finanzas.jsx): filas fecha · concepto · método · monto, con total acumulado arriba. Estados Loading/Empty/Error.
- [ ] **Step 3: build + commit** `feat(clientes): historial de pagos y membresias en la ficha`.

---

## Self-Review

Cobertura de los 10 reportes 📊 del wishlist: historial de pagos por cliente (T4) · aforo en vivo (T1+T3) · congeladas (T1+T2 socios) · ausentes (T1+T2) · venta día/semana/mes (T1+T2 ventas) · churn (T1+T2) · proyección (T1+T2) · nuevos por día (T1+T2) · asistencia staff (ya existía — ReporteAtenciones/Asistencias, ahora en su tab) · KPIs en vivo (T3 + StatCards). Directiva de organización aplicada (tabs por categoría, dashboard curado). Puntos frágiles marcados: columnas reales de congelamiento (T1 Step 1 verifica), patrón visual de ReporteAsistencias (T2 lo lee antes).
