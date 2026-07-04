# 🤝 Handoff: Panel FitControl → App del Socio (Flutter)

> Escrito por la sesión del PANEL (2026-07-04) para el agente que construye la app móvil.
> El panel web + la base de datos son responsabilidad de la sesión del panel; la app Flutter es tuya.
> Este documento es tu mapa del backend que vas a consumir.

## Qué es la app (alcance v1, decidido por el cliente)

App móvil que los gimnasios suscritos a FitControl les dan a SUS miembros. Una sola app en las
tiendas, pero **white-label**: al vincularse, el socio ve el logo/colores/nombre de SU gym.

**Modo Socio:** su membresía (estado, vencimiento, días restantes, SALDO pendiente si paga en
partes), carnet QR de check-in, reservar clases (cupos en vivo), su rutina y dieta asignadas,
push (vence en 3 días, cumpleaños, retención "te quedan N días y no vienes").

**Modo Apoderado** (negocios de niños): sus hijos, asistencia de hoy, estado de la mensualidad.
Cámaras en vivo = v2 (solo modelado).

**Modo Staff** (entrenador/nutricionista): ve SUS alumnos, asigna rutinas/dietas desde el celular.

**FUERA de v1 (no construir):** marketplace/directorio de gyms (aplazado por el cliente),
pagos dentro de la app, cámaras, tienda de suplementos.
**Regla de oro:** el espacio pagado de un gym JAMÁS muestra a otros gimnasios/competidores.

## Backend (Supabase — el MISMO del panel, cero backend nuevo)

- URL: `https://zlmqdubrjzmagslcsqvb.supabase.co`
- Anon key: en `.env` del repo del panel (`VITE_SUPABASE_ANON_KEY`) — es pública, protegida por RLS.
- Auth: Google OAuth (igual que el panel). El mismo `auth.users` sirve para socios y staff.
- Idioma/formatos: es-PE, moneda `S/` (campo `empresa.moneda`, casi siempre PEN).

### Tablas que vas a consumir (todas con `empresa_id` y RLS)

| Tabla | Para qué | Columnas clave |
|---|---|---|
| `empresa` | datos del gym | nombre, slug, eslogan, horario (jsonb 7 días), horario_atencion (texto), redes (jsonb), landing (jsonb) |
| `empresa_tema` | white-label | logo_url, color_primary, color_navy, font_family… |
| `socio` | el miembro | **usuario_id (la vinculación con auth)**, nombre, codigo, estado ('activo'/'inactivo'), es_menor |
| `membresia` | su plan | estado (activa/congelada/vencida/cancelada), fecha_fin, precio_pagado + matricula_pagada = total del trato, **monto_pagado** (saldo = total − monto_pagado), plan_id, promocion_id |
| `plan` | catálogo | nombre, precio, unidad, incluye_clases, incluye_rutina, dias_congelamiento_anio |
| `clase` | horario semanal | dia_semana (1=lun), hora, cupo_max, instructor_id / instructor_nombre (externo), tipo_clase_id |
| `reserva_clase` | reservas | (cupo ocupado = count de reservas de esa clase/fecha) |
| `checkin` | asistencia | direccion entrada/salida, resultado, ocurrido_en |
| `rutina`, `rutina_dia`, `rutina_ejercicio`, `dieta`, `comida` | plan del socio | rutina.notas, rutina_ejercicio.carga/notas (tu migración 20260704000001 — YA APLICADA) |
| `apoderado`, `apoderado_socio` | modo apoderado | apoderado.usuario_id (login del papá) |
| `credencial_acceso`, `dispositivo_acceso` | QR/acceso | RPC `verificar_acceso` valida y registra el check-in |

### RPCs que ya existen y te sirven

- `get_landing_by_slug(slug)` — datos públicos del gym (anon).
- `verificar_acceso(...)` — valida credencial → permitido/denegado + registra checkin (membresía vencida = denegado).
- `checkin_manual(socio, sede, direccion)` — el que usa recepción.

## ⚠️ Lo que AÚN NO existe (pídelo, no lo construyas tú)

**RLS para el rol SOCIO.** Hoy todas las políticas asumen STAFF del panel (vía `usuario_empresa`).
Un socio logueado en la app **no puede leer nada todavía**. La sesión del panel tiene comprometido
el "paquete backend socio" (se construye el mismo día que lo pidas):

1. Vinculación: al primer login, matchear `auth.users.email/teléfono` → `socio.usuario_id` (RPC `vincular_socio`).
2. Policies: el socio lee SU socio/membresía/rutina/dieta, las clases y tema de SU gym; crea/cancela SUS reservas.
3. RPCs de conveniencia: `get_mi_app_bootstrap()` (gym + tema + membresía + saldo en 1 viaje), `reservar_clase`, `cancelar_reserva`, `mi_qr` (payload firmado del carnet).
4. Push: tokens FCM (tabla nueva) + triggers de vencimiento/cumpleaños/retención.

## Protocolo de trabajo (para no pisarnos)

1. **Migraciones**: déjalas en `supabase/migrations/` de ESTE repo, prefijo `20260704NNNNNN_*.sql`,
   idempotentes (`add column if not exists`). **NO las apliques**: las aplica la sesión del panel
   (ahí viven las credenciales). Tu `20260704000001_rutina_detalle_app.sql` ya está aplicada. ✔
2. **No toques** `src/` ni `api/` del panel — cualquier cambio de panel/backend se pide.
3. Necesidades de backend → lístalas en `docs/APP-BACKEND-REQUESTS.md` (créalo) y avisa al cliente;
   la sesión del panel las implementa y marca ✔ con la migración correspondiente.

## Datos de prueba

- **MaximusGym** (`maximusgym.fitcorecenter.com`) es el gym vitrina: 17+ socios, clases con
  instructor, cobros pendientes, rutinas, dorado/negro. Empresa id `ad7a640f-4a82-4643-a0ed-4f6f1508be29`.
- El staff demo (`*@maximusgym.pe`) NO puede loguearse (cuentas sembradas sin password) — para
  probar login usa cuentas Google reales del cliente.
- Culqi está en TEST y es solo del SaaS (cobro al gym) — la app v1 NO cobra nada.

## Diseño

- Fuente Manrope; navy #141B2E, naranja #FF6B35 (los del gym vienen de `empresa_tema` — úsalos).
- El panel ya es PWA-friendly y bottom-sheet en móvil; la app debe sentirse de la misma familia.
