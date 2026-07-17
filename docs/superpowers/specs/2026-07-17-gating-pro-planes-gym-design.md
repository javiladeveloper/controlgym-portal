# Gating por plan de gimnasio: cerrar el nivel Pro — diseño

## Problema

El panel gatea bien **Estudio (rank 1)** vs **Crecimiento (rank 2)** por módulos,
pero **no existe ningún gate de nivel Pro (rank 3)**: el rank máximo de
`modulo_min_rank` es 2. Consecuencias verificadas contra la BD y el código:

1. **7 features vendidas como Pro son accesibles desde planes más baratos:**
   - Aforo en vivo + verificación por foto → viven en Dashboard (rank 1 = **Estudio**).
   - KPIs de ventas/cancelación/proyección, metas diarias, ranking de vendedores
     → en Reportes (rank 2 = **Crecimiento**).
   - Agenda de leads sin atender, reactivación de ex socios → en CRM (rank 2).
2. **Las pestañas de `Configuracion.jsx` no se filtran por plan:** Croquis,
   Acceso/cámaras y Facturación NORAC se muestran a **todos**, incluido el plan
   gratis.
3. **Bug:** `limite_sedes_empresa` cae en `else 1` para `pro` (el renombre
   `cadena→pro` lo dejó roto). Pro debe permitir multi-sede.
4. **Multi-marca/franquicias** se vende en Pro pero **no está construido**.

Los 7 gyms reales en Crecimiento son de prueba del owner: subir las features a
Pro no afecta a ningún cliente pagando. Decisión: **el gating queda exactamente
como lo vende la landing.**

## Mecanismo (dos capas)

El gating existente es sólido para lo que cubre; el diseño lo **extiende**, no lo
reemplaza. Dos tipos de feature Pro, dos mecanismos:

### A. Pantallas Pro completas → módulos rank 3

Una feature que ES una pantalla/ruta se gatea como módulo, reusando
`modulo_min_rank` (BD) + `modulos_de_sede` (RPC) + `modules.js` + `ProtectedRoute`
(guard de ruta). Esta es la capa que **protege de verdad**: sin ella, entrar por
URL basta.

- `acceso_fisico` (torniquetes/huella/cámaras) → **rank 3**.
- `croquis` → **rank 2** (Crecimiento, como vende la landing).
- `facturacion` → **rank 3**, pero además oculta por flag hasta que NORAC salga
  (ver más abajo).

### B. Pedazos dentro de una pantalla visible → `planRank` en el front

Aforo/foto viven dentro del Dashboard (visible en todos los planes); agenda/
reactivación dentro de CRM (Crecimiento+); KPIs/metas/ranking dentro de Reportes.
No son pantallas que ocultar: son secciones. Para eso el bootstrap expone el
**rank del plan de la sede** y el front oculta cada pieza con `if (planRank >= 3)`.

Por qué no módulos falsos para esto: los módulos representan entradas de
menú/rutas; meter "aforo" o "kpis" como módulos ensucia ese concepto y confunde
al sidebar. Un solo dato (`planRank`) es más limpio para lo que vive dentro de
una pantalla.

**Nota de seguridad:** `planRank` en el front es UX (ocultar), no seguridad. Las
piezas Pro que exponen datos sensibles vía RPC (KPIs, aforo) deben validar el
plan en el RPC también — se cablea donde el RPC devuelva datos que un plan
inferior no debe ver. Para las que son solo UI (mostrar/ocultar un widget), el
gate de front basta.

## Reparto final

| Feature | Dónde vive | Gating | Plan |
|---|---|---|---|
| Croquis del gym | pestaña Config | módulo `croquis` rank 2 | Crecimiento+ |
| Acceso físico (torniquetes/huella/cámaras) | pestaña Config | módulo `acceso_fisico` rank 3 | Pro |
| Facturación NORAC | pestaña Config | flag `FACTURACION_VISIBLE=false` | nadie aún |
| Aforo en vivo + alertas | Dashboard | `planRank >= 3` + RPC | Pro |
| Verificación por foto en check-in | Dashboard | `planRank >= 3` | Pro |
| KPIs ventas/cancelación/proyección | Reportes | `planRank >= 3` + RPC | Pro |
| Metas diarias + ranking vendedores | Reportes/Dashboard | `planRank >= 3` + RPC | Pro |
| Agenda de leads sin atender | CRM | `planRank >= 3` | Pro |
| Reactivación de ex socios | CRM | `planRank >= 3` | Pro |

## Cambios concretos

### BD

- `modulo_min_rank`: agregar `acceso_fisico → 3`, `facturacion → 3`,
  `croquis → 2`.
- **Registrar los módulos nuevos en las tablas `modulo` + `categoria_modulo`.**
  Ojo: `get_modulos_activos` NO lee una lista hardcodeada — saca los slugs de la
  tabla `modulo` cruzada con `categoria_modulo` (por categoría de la empresa) más
  los overrides de `empresa_modulo`. Por eso tocar solo `modulo_min_rank` no
  basta: `acceso_fisico`/`facturacion`/`croquis` deben existir como filas en
  `modulo` y estar asignados a la categoría fitness en `categoria_modulo`, o
  `modulos_de_sede` nunca los devolverá aunque el rank alcance. `modulos_de_sede`
  ya filtra el resultado de `get_modulos_activos` por `min_rank <= rank`, así que
  con las filas creadas el gating aplica solo.
- `plan_de_sede` ya existe y devuelve el slug; el bootstrap del panel expondrá
  `plan_rank(plan_de_sede)` como `planRank`.
- **`limite_sedes_empresa`**: `pro` (y `cadena`) → ilimitado; `crecimiento` → 3;
  resto → 1. Corrige el `else 1` que hoy limita Pro a 1 sede.
- **Gate en RPC** de las piezas Pro que devuelven datos sensibles: los RPC de
  aforo (`aforo_mi_sede`, `avisar_aforo_alto`), KPIs (`reporte_socios_kpis`) y
  metas/ranking (`mi_meta`, `guardar_meta_vendedor`) validan que la sede sea de
  plan Pro; si no, devuelven vacío/error. Es el backstop del gate de front.

### Front

- `AuthContext` / bootstrap: exponer `planRank` (rank del plan de la sede activa).
- `modules.js`: agregar los módulos `acceso_fisico` (grupo config, roles admin) y
  `facturacion` si aplica; el sidebar y `ProtectedRoute` los recogen solos.
- `Configuracion.jsx`: las pestañas `TABS` se filtran por módulo habilitado
  (croquis, acceso) y por flag (facturación) — no se pintan las 9 a todos.
- `Dashboard.jsx`: ocultar aforo, foto-verificación, metas/ranking con
  `planRank >= 3`.
- `Reportes.jsx`: ocultar KPIs con `planRank >= 3`.
- `CRM.jsx`: ocultar agenda de leads y reactivación con `planRank >= 3`.
- `PlataformaLanding.jsx`: quitar "Varias marcas / franquicias" de los beneficios
  de Pro (no existe; no vendemos lo que no damos).

### Flag de facturación

`src/lib/features.js`: `export const FACTURACION_VISIBLE = false`. La pestaña
Facturación no se muestra a nadie hasta que NORAC esté en producción. Cuando
salga: cambiar el flag a `true` y el módulo `facturacion` rank 3 la deja solo
para Pro.

## Multi-marca / franquicias

Vendido en Pro, no construido. **Fuera de alcance**: se quita de la landing por
ahora. Cuando se construya, es su propio spec (es un cambio de modelo de datos:
hoy `empresa` es single-tenant de marca, y multi-marca implica agrupar empresas
o un nivel superior).

## Verificación

- **BD (psql/rollback)**: una sede en cada plan (miembros/estudio/crecimiento/
  pro) → `modulos_de_sede` devuelve el set correcto; `acceso_fisico`/`facturacion`
  solo en Pro; `croquis` desde Crecimiento. `limite_sedes_empresa`: pro→null,
  crecimiento→3, estudio→1. Los RPC de aforo/KPIs/metas devuelven vacío para un
  plan no-Pro y datos para Pro.
- **Guard de ruta**: entrar por URL a `/configuracion?tab=acceso` con un plan no
  apto → bloqueado (no solo escondido del menú).
- **Front (Playwright)**: con un gym Crecimiento, el Dashboard no muestra aforo/
  foto/metas, Reportes no muestra KPIs, CRM no muestra agenda/reactivación; con
  un gym Pro sí. Las pestañas de Config aparecen según plan. `npm test` +
  `npm run build`.
- **Landing**: Pro ya no lista multi-marca.

## Fuera de alcance

- **Construir multi-marca/franquicias.**
- **Separar "reportes básicos" de "reportes avanzados"** más allá de ocultar los
  KPIs: Crecimiento conserva sus reportes actuales; solo los KPIs/proyección son
  Pro.
- **Migrar de plan a los gyms de prueba**: quedan donde están; el gating aplica
  al vuelo según su plan.
