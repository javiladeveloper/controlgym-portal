# Auditoría completa — FitCore · 12-jul-2026

Auditoría de cierre antes de la entrega al cliente final. Cubre seguridad
(advisors de Supabase), rendimiento, calidad del frontend (barrido de las 15
pantallas) y el balance funcional del producto.

## 1. Seguridad — hallazgos y arreglos (migración `20260712000006`)

| Hallazgo | Nivel | Estado |
|---|---|---|
| `v_dashboard_sede` era SECURITY DEFINER: cualquier usuario autenticado de cualquier gym podía leer los KPIs de TODAS las sedes de TODOS los gyms | ERROR | ✅ Corregido (`security_invoker`) |
| 4 tablas de dedup de crons (`*_avisado`) sin RLS, expuestas a la API | ERROR | ✅ RLS activado (negadas a la API; los crons siguen) |
| 134 funciones ejecutables por `anon` (grant implícito de Postgres vía PUBLIC) | WARN | ✅ Revocado en masa; solo quedan las 6 públicas intencionales* |
| 7 funciones sin `search_path` fijo | WARN | ✅ Fijado |
| Privilegios por defecto: funciones futuras nacían ejecutables por anon | — | ✅ `ALTER DEFAULT PRIVILEGES` |

\* Lista blanca anon: `crear_lead_publico`, `get_landing_by_slug`,
`registrar_visita_landing`, `enviar_sugerencia`, `crear_reclamacion`,
`leadia_ingresar_lead` (protegida por secreto propio). El hook
`custom_access_token_hook` conserva el grant a `supabase_auth_admin` (logins
verificados después del cambio).

**Verificación post-hardening:** login OK · RPC autenticado 200 · anon a RPC
interno **401** · landing pública 200 · 15/15 pantallas sin errores de consola.

### Pendientes de seguridad (acción del OWNER, no de código)
1. **Activar "Leaked password protection"** en Supabase Dashboard → Auth →
   Providers (un toggle; rechaza contraseñas filtradas conocidas).
2. Opcional: quitar el listado público del bucket `branding`.
3. Informativos aceptados: `authenticated` puede ejecutar los RPCs (cada uno
   valida empresa/uid adentro — es el diseño); 9 tablas con RLS sin policies
   son deny-all a propósito (secretos, colas, dedup).

## 2. Rendimiento (advisors)

- ✅ Índices creados para las FKs de tablas calientes (migración
  `20260712000007`): lead (asignado_a/sede/socio), membresía
  (promoción/plan/sede), movimientos (sede+fecha, caja), checkin
  (sede+ocurrido), turnos y tareas.
- 📋 Backlog (no urgente a escala gym): ~50 FKs frías sin índice (catálogos),
  20 policies con `auth_*()` evaluado por fila (`auth_rls_initplan` — se
  optimiza envolviendo en `(select …)`), 28 tablas con policies permisivas
  múltiples, 9 índices sin uso aún (recién creados o de features nuevas).

## 3. Calidad del frontend

- Barrido Playwright de las 15 rutas con sesión admin: **0 errores de consola**
  (único ruido: `/api/dni/verificar` 404 en dev local — no existe fuera de Vercel).
- `npm test`: 23/23 · `npm run build`: limpio.
- Sin TODO/FIXME reales en el código; los únicos "en construcción" son
  deliberados: **Campañas** (decisión correo vs WhatsApp API con el cliente) y
  **Sugerencia IA** (Leadia).

## 4. Estado funcional (qué está listo para el cliente)

**Completo y verificado:** dashboard accionable (aforo real + cierre nocturno,
metas de comunicadores día/mes, check-ins en vivo), socios (alta con padrón
DNI, plan automático de rutina/dieta por IMC, plantillas manuales, ficha
completa), CRM (reparto automático de leads, rotación 7 días, perdidos con
motivo, agenda única, cohortes por campaña, qué ofrecer), promociones (6 tipos
+ duración del beneficio + renovación grupal en un clic + canjes), POS
(productos + renovaciones + boleta/factura NORAC + QR MercadoPago), caja
(apertura/arqueo/cierre congelado/historial/caja zombie), finanzas y reportes
con filtros de fecha completos, personal (horarios, asistencia vs horario,
permisos/vacaciones con calendario del equipo, planilla), facturación
electrónica (SEE propio, IGV 6 decimales validado con 200k casos fuzz).

**En pausa por decisión de negocio:** campañas masivas (correo vs WhatsApp
API), integración Leadia (conector listo y probado, sin UI), reservas con
posición en sala (diseño confirmado, talla L).

**Deuda menor conocida:** renovación grupal vía QR MercadoPago solo renueva al
titular; cuenta `noraclabspe` duplica el nombre "Jonathan Avila" en rankings.
