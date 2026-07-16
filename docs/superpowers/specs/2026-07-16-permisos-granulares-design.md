# Permisos granulares (rol base + extras por persona) — Diseño

**Fecha:** 2026-07-16
**Estado:** Aprobado (brainstorming), pendiente plan de implementación

## Problema

Un usuario tiene UN solo rol (`usuario_empresa.rol_id`, singular) y los permisos
están hardcodeados por rol en RLS/RPCs (vía `auth_rol()` / `auth_is_admin()`).
En gimnasios chicos, la misma persona hace varias funciones — el caso que motiva
esto: **el recepcionista también atiende leads (comunicador)**. Hoy tiene que
elegir un rol y pierde las capacidades del otro:
- rol `recepcion` → puede cobrar/inscribir, pero el reparto de leads lo ignora
  (solo mira rol `comunicador`).
- rol `comunicador` → recibe leads, pero no tiene lo de recepción.

## Decisiones (con el owner)

1. **Rol base + extras que SUMAN**: el rol da un piso garantizado de permisos; a
   cada persona se le pueden SUMAR permisos extra. Nunca se quitan los del rol
   (solo-sumar, no override).
2. **4 permisos** en esta primera etapa: `leads`, `caja`, `reportes`, `rutinas`.
3. **El código pregunta por capacidad**, no por rol: `auth_tiene_permiso('X')`
   reemplaza el patrón `auth_rol() = 'comunicador'`.
4. **Mapa rol→permisos base FIJO en el sistema** (no editable por el gym). El gym
   solo suma extras por persona.
5. **Implementación por capas**: el framework se diseña para los 4 permisos, pero
   se implementa primero `leads` (el caso que duele). Los demás migran después.

## Catálogo de permisos (fijo)

| Permiso | Qué habilita |
|---|---|
| `leads` | Recibir/atender leads del CRM (entra al reparto y rotación) |
| `caja` | Cobrar e inscribir socios |
| `reportes` | Ver reportes y finanzas |
| `rutinas` | Armar rutinas y editar socios |

## Mapa rol → permisos base (fijo)

| Rol | Permisos base |
|---|---|
| `admin` | *todos* (admin siempre tiene todo) |
| `recepcion` | `caja` |
| `comunicador` | `leads` |
| `entrenador` | `rutinas` |
| `nutricionista` | `rutinas` |
| `mantenimiento` | *(ninguno de estos 4)* |

Este mapa vive en la función `auth_tiene_permiso` (código), no en una tabla
editable. Preserva el comportamiento actual: un comunicador tiene `leads` por
base, así que nada cambia para él.

## Modelo de datos

### Tabla `usuario_permiso` (nueva) — solo los EXTRAS

```sql
create table public.usuario_permiso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  usuario_id uuid not null references public.usuario(id) on delete cascade,
  permiso    text not null check (permiso in ('leads','caja','reportes','rutinas')),
  created_at timestamptz not null default now(),
  created_by uuid references public.usuario(id),
  unique (empresa_id, usuario_id, permiso)
);
```
RLS: solo el admin de la empresa (auth_is_admin + empresa_id = auth_empresa_id())
inserta/borra; el propio usuario lee los suyos. Guarda SOLO extras; los base
salen del mapa fijo.

## Función central: `auth_tiene_permiso`

```sql
auth_tiene_permiso(p_permiso text) returns boolean
```
`true` si (en orden):
1. `auth_is_admin()` → admin tiene todo, o
2. el rol base del usuario (via `auth_rol()`) incluye `p_permiso` según el mapa fijo, o
3. existe fila en `usuario_permiso` para (auth.uid, empresa activa, p_permiso).

`security definer`, `stable`, resuelve empresa del JWT igual que `auth_rol()`.
Es el ÚNICO punto de verdad de permisos.

## Bootstrap del panel

`get_bootstrap` (o el que arma el contexto del panel) ya devuelve `rol`. Se le
agrega `permisos: [...]` = lista efectiva del usuario (base del rol + extras),
para que el frontend muestre/oculte funciones sin recalcular.

## Migración de la lógica actual (por capas)

Hoy 14 funciones/policies tocan `auth_rol`/`comunicador`. Estrategia ADITIVA:
NINGÚN cambio quita capacidades a nadie.

**Capa 1 — leads (esta entrega):** las RPCs de reparto y rotación de leads
(`asignacion_automatica_leads`, `rotacion_leads_sin_contacto`,
`lead_del_comunicador_que_lo_trae`, y la agenda "solo mis tareas") cambian
"usuarios con rol = 'comunicador'" por "usuarios con permiso `leads`". Como el
comunicador tiene `leads` por base, el comportamiento se preserva; y recepción
con el extra `leads` ahora también entra al reparto.

**Capas siguientes (futuro, NO en esta entrega):** migrar `caja`, `reportes`,
`rutinas` a `auth_tiene_permiso` en sus RLS/RPCs respectivas. El framework queda
listo; se prioriza `leads`.

## UI (página Personal)

En la ficha de cada empleado, bajo su rol: checklist de **permisos extra** (los
4). El admin marca "este recepcionista también atiende leads". Se muestran los
permisos que vienen del rol (informativo, no editable, con etiqueta "por su rol")
y los extra (editables). Escribe/borra en `usuario_permiso`.

## Verificación

- BD (rollback): `auth_tiene_permiso('leads')` = true para un comunicador (base)
  y para un recepcionista con el extra; false para recepción sin extra. Admin da
  true en los 4. RLS: un no-admin no puede escribir `usuario_permiso`.
- Reparto de leads: con un recepcionista + extra `leads`, el reparto lo incluye
  (recibe leads); sin el extra, no.
- Panel: el admin suma "leads" a un recepcionista desde Personal → empieza a
  recibir leads.
- `npm test` + `npm run build` limpios; ≤12 funciones serverless.

## Alcance / lo que NO entra ahora (YAGNI)

- Migrar caja/reportes/rutinas (capas futuras).
- Quitar permisos del rol base (solo-sumar por decisión del owner).
- Permisos editables por el gym a nivel rol (el mapa base es fijo).
- Permisos por sede (son por empresa; si un caso lo pide, futuro).

## Riesgos

- **Tocar RLS/reparto de leads** (mueve datos comerciales): probar en rollback
  que el comportamiento del comunicador se preserva EXACTO antes de aplicar.
- **Consistencia mapa fijo**: el mapa rol→permisos vive en una función; si se
  agrega un rol nuevo, hay que actualizarlo (documentado en la función).
