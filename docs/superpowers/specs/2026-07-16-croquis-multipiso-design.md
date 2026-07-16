# Croquis multi-piso con máquinas ubicadas — Diseño

**Fecha:** 2026-07-16
**Estado:** Aprobado (brainstorming), pendiente plan de implementación

## Problema / objetivo

Hoy el "croquis" es una sola IMAGEN por sede (`sede.croquis_url`) que la app
muestra estática. El owner quiere que el socio vea **dónde está cada máquina** en
el gym, y que esto soporte **gimnasios de varios pisos**: cada piso con su propio
plano y sus máquinas ubicadas. Además, al **pedir ayuda** a un entrenador, el
socio debe poder indicar en qué piso está (para que lo encuentren rápido); si el
gym no tiene croquis, que pueda escribir el piso/ubicación a mano (ya soportado).

## Decisiones (con el owner)

1. **Jerarquía**: sede → varios PISOS; cada piso tiene su imagen de plano y sus
   máquinas ubicadas. El socio elige piso y ve ese plano.
2. **Posición**: el gym ARRASTRA cada máquina sobre la imagen del plano; se guarda
   su coordenada x/y (en %). Editor visual, sin librería de canvas (HTML/CSS).
3. **Qué se ubica**: las MÁQUINAS EXISTENTES (tabla `maquina`) — se les agrega a
   qué piso pertenecen y su x/y. Una sola fuente de verdad, sin duplicar.
4. **Alcance de esta entrega**: BD + editor en el panel + PEDIDO para la app.
5. **Pedir ayuda**: el socio elige el piso donde está (si hay croquis); si no,
   `solicitud_ayuda.ubicacion_texto` (ya existe) como fallback.

## Estado actual (verificado)

- `sede.croquis_url` (text) — imagen única del croquis por sede. Se sube en la
  config de sede (TabSedes) al bucket `branding`; la app la recibe en el bootstrap
  del socio (`get_mi_app_bootstrap` expone `empresa.croquis_url`).
- Tabla `maquina(id, empresa_id, sede_id, nombre, detalle, zona, unidades, estado,
  ...)` — gestionada en `Maquinas.jsx`. Hoy: 6 máquinas en 2 sedes, sin posición.
- `solicitud_ayuda(id, empresa_id, sede_id, socio_id, motivo, ejercicio_nombre,
  ubicacion_texto, mensaje_socio, estado, atendida_por, ...)` — el socio pide
  ayuda; YA tiene `ubicacion_texto` (fallback de "escribir dónde estoy").

## Modelo de datos

### Tabla nueva `sede_piso`

```sql
create table public.sede_piso (
  id         uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa(id) on delete cascade,
  sede_id    uuid not null references public.sede(id) on delete cascade,
  nombre     text not null,            -- "Planta baja", "Piso 2", "Sótano"
  orden      int not null default 0,   -- para ordenarlos en la UI
  plano_url  text,                     -- imagen del plano de ESTE piso
  created_at timestamptz not null default now()
);
```
RLS: gestión por el admin de la empresa (empresa_id = auth_empresa_id());
lectura para el socio de esa sede (vía es_socio_de / auth). Índice por sede_id.

### Columnas nuevas en `maquina` (aditivo, retrocompatible)

```sql
alter table public.maquina add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
alter table public.maquina add column if not exists pos_x numeric;  -- % horizontal (0-100)
alter table public.maquina add column if not exists pos_y numeric;  -- % vertical (0-100)
```
Una máquina sin `piso_id`/`pos_x`/`pos_y` = aún no ubicada (las 6 actuales siguen
válidas). Coordenadas en % (no px) → el plano escala en cualquier pantalla.

### Columna nueva en `solicitud_ayuda`

```sql
alter table public.solicitud_ayuda add column if not exists piso_id uuid references public.sede_piso(id) on delete set null;
```
Opcional: el socio elige su piso al pedir ayuda. `ubicacion_texto` sigue como
fallback cuando no hay croquis.

### Sobre `sede.croquis_url`

Se CONSERVA por compatibilidad (la app actual lo consume). El modelo nuevo son los
pisos; una sede de un solo piso es un `sede_piso` "Planta baja" con su plano. No
se migra automáticamente en esta entrega (el gym recrea sus pisos); si se decide
migrar el croquis viejo → un piso por defecto, es un paso opcional del plan.

## RPCs

- `pisos_de_sede(p_sede_id) → jsonb` — [{id, nombre, orden, plano_url}] ordenado.
  Para el editor del panel y la app. Grant authenticated (socio/staff de la sede).
- `maquinas_del_piso(p_piso_id) → jsonb` — [{id, nombre, zona, estado, pos_x,
  pos_y}] de las máquinas ubicadas en ese piso. Para pintar los pines.
- Gestión (admin): guardar piso (upsert nombre/orden/plano), borrar piso, y
  posicionar máquina (`ubicar_maquina(p_maquina_id, p_piso_id, p_pos_x, p_pos_y)`
  o simplemente `supabase.from('maquina').update({piso_id,pos_x,pos_y})` bajo RLS).
- Bootstrap del socio: exponer los pisos de su sede (extender get_mi_app_bootstrap
  o que la app llame `pisos_de_sede`).

## Editor en el panel

En la configuración de sede (o una sección "Croquis / Mapa"):
- **Pisos**: agregar/renombrar/ordenar; por cada piso subir su plano (bucket
  branding, como el croquis actual con `subirImagen(empresa.id, 'croquis', file)`).
- **Ubicar**: elegido un piso, mostrar su plano + lista de máquinas de la sede sin
  ubicar. Arrastrar una máquina sobre el plano → calcular x/y en % (clientX/Y
  relativo al rect del contenedor) → guardar. Pines ya puestos: reposicionar/quitar.
- HTML/CSS puro: cada pin es un botón `position:absolute; left:{x}%; top:{y}%`.
  Reutiliza la tabla `maquina` (fuente única); aquí solo se asigna piso + posición.

## PEDIDO app (documentado, no se construye aquí)

- Sección "Mapa del gym": elegir piso → ver el plano (`plano_url`) con los pines
  de máquinas (`maquinas_del_piso`) → tocar un pin muestra la máquina. Vía las RPCs.
- En "pedir ayuda": selector de piso (de `pisos_de_sede`) que llena
  `solicitud_ayuda.piso_id`; si la sede no tiene pisos/croquis, cae al campo de
  texto `ubicacion_texto` (ya existe). Así el entrenador ve dónde está el socio.

## Verificación

- BD (rollback): crear 2 pisos en una sede; ubicar una máquina (piso_id + x/y);
  `maquinas_del_piso` la devuelve con su posición; `pisos_de_sede` lista los 2.
  RLS: un gym no ve pisos de otra empresa; las 6 máquinas actuales sin piso siguen
  válidas (no rompe Maquinas.jsx).
- Panel (Playwright): agregar un piso, subir su plano, arrastrar una máquina,
  recargar → el pin queda donde se dejó (x/y persistió).
- `npm test` + `npm run build` limpios; ≤12 funciones serverless.

## Alcance / lo que NO entra ahora (YAGNI)

- Vista de la app (es del agente de la app; se deja el PEDIDO).
- Puntos de interés genéricos (baños, recepción) — solo máquinas del inventario
  por ahora; se puede extender después con un `tipo` en un modelo de puntos.
- Migración automática del `croquis_url` viejo a un piso (opcional; el gym recrea).
- Zoom/pan avanzado del plano — el plano escala con la pantalla, sin gestos de zoom.

## Riesgos

- **Retrocompatibilidad**: las columnas de `maquina` son aditivas y nullable; el
  `croquis_url` viejo se conserva. Verificar que `Maquinas.jsx` y el bootstrap
  actual no se rompen.
- **Precisión del drag**: calcular x/y relativo al rect del plano (no a la
  ventana) y clampar 0-100; probar en el navegador que el pin cae donde se soltó.
