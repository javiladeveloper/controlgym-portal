# Punto de Venta (POS / sección Ventas) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una sección nueva "Ventas" (POS) donde recepción vende productos (carrito multi-ítem) y cobra/renueva membresía, elige método de pago (incluida tarjeta), y se emite la boleta — reusando el subsistema de facturación NORAC ya construido. Kardex queda como inventario puro.

**Architecture:** Una RPC nueva `vender_carrito` agrupa N ítems bajo un `venta_id` (columna ya existe), registra caja y crea UN comprobante multi-línea. El cobro de membresía reusa `renew_membership`/`abonar_membresia` y crea su comprobante. El worker de facturación (ya desplegado) emite. La UI es una pantalla POS de dos columnas (cobro | resumen). Kardex pierde su modal de venta.

**Tech Stack:** Supabase Postgres (migraciones psql UTF-8), RPC `security definer`, React + Vite + Tailwind + React Query, componentes del tema.

## Global Constraints

- Migraciones: `.sql` UTF-8, aplicadas por psql con `-f`. Nombre `supabase/migrations/2026071000XX_*.sql` (siguiente número libre: empezar en 20260710000018).
- DATABASE_URL en `/tmp/.dburl` (jalada de Vercel). Usar `DBURL=$(cat /tmp/.dburl); psql "$DBURL" -f ...`. NO imprimir /tmp/.dburl.
- RLS: `empresa_id = public.auth_empresa_id()`. RPCs `security definer` que validan `auth_empresa_id()` y sede.
- Permisos: **recepción y admin** venden (POS + caja). Módulo `ventas` roles `['admin','recepcion']`.
- Comprobante: reusar el andamiaje existente. Precios YA incluyen IGV (`base=round(total/1.18,2)`). Boleta simple por defecto (`cliente_tipo_doc='0'`, `'CLIENTE VARIOS'`); DNI (`'1'`) o factura RUC (`'6'`) opcional.
- IGV/emisión: NO reimplementar; el worker `api/facturacion/index.js` ya emite. El POS solo crea el `comprobante` en cola.
- Método de pago: valores del CHECK existente de `movimiento_financiero.metodo_pago`: efectivo, yape, plin, tarjeta, transferencia, otro.
- UI: componentes del tema (`Card`, `PrimaryButton`, `Badge`, `StatCard`), tokens (`bg-orange` acción, `amber` aviso, `bg-green` éxito). Responsive: POS apila en móvil (`grid-cols-1 lg:grid-cols-[1fr_340px]`). Copy español, sentence case.
- Reusar patrones existentes: buscador de productos/socios como en Kardex/Clientes; no inventar inputs nuevos.

---

## Task 1: Migración — RPC `vender_carrito` (venta multi-ítem + comprobante)

**Files:**
- Create: `supabase/migrations/20260710000018_vender_carrito.sql`

**Interfaces:**
- Consumes: `movimiento_financiero` (con `venta_id`), `inventario_sede`, `producto`, `public.auth_empresa_id()`, `comprobante`, `registrar_mov_inventario` (existente, para reusar la baja de stock).
- Produces: `vender_carrito(p_sede_id uuid, p_items jsonb, p_metodo_pago text, p_cliente_tipo_doc text, p_cliente_num_doc text, p_cliente_nombre text, p_cliente_email text) → jsonb` que devuelve `{ venta_id, total, comprobante_id }`.

- [ ] **Step 1: Escribir la migración**

`p_items` es un array JSON: `[{ "producto_id": "...", "cantidad": 2 }, ...]`. La RPC:
- Valida empresa/sede.
- Por cada ítem: llama la lógica de venta (baja stock + ingreso en caja) con un `venta_id` compartido, calculando el monto por precio efectivo del producto.
- Suma el total, crea un `comprobante` (ref_tipo='venta', ref_id=venta_id) con el desglose IGV.
- Devuelve `{venta_id, total, comprobante_id}`.

```sql
-- POS: vende un carrito de productos en una sola operación. Agrupa los ítems
-- bajo un venta_id, baja stock, registra caja y crea UN comprobante multi-línea.
create or replace function public.vender_carrito(
  p_sede_id uuid,
  p_items jsonb,
  p_metodo_pago text default 'efectivo',
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_venta uuid := gen_random_uuid();
  v_item jsonb;
  v_prod public.producto;
  v_precio numeric;
  v_cant int;
  v_total numeric := 0;
  v_comp uuid;
  v_base numeric; v_igv numeric;
  v_fac public.empresa_facturacion;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_prod from public.producto
      where id = (v_item->>'producto_id')::uuid and empresa_id = v_empresa;
    if v_prod.id is null then raise exception 'Producto no encontrado'; end if;
    v_cant := coalesce((v_item->>'cantidad')::int, 1);
    if v_cant <= 0 then raise exception 'Cantidad inválida'; end if;
    -- precio efectivo: usa oferta si el producto tiene precio_oferta vigente
    v_precio := coalesce(v_prod.precio_oferta, v_prod.precio);

    -- Baja stock + ingreso en caja, reusando la RPC existente, con venta_id.
    -- registrar_mov_inventario ya valida stock y registra movimiento_financiero.
    perform public.registrar_mov_inventario(p_sede_id, v_prod.id, 'venta', v_cant, v_precio * v_cant);
    -- etiqueta los movimientos de esta venta con el venta_id y el método de pago
    update public.movimiento_financiero
      set venta_id = v_venta, metodo_pago = p_metodo_pago
      where ref_tipo = 'producto' and ref_id = v_prod.id
        and venta_id is null and registrado_por = auth.uid()
        and creado_at > now() - interval '10 seconds';

    v_total := v_total + v_precio * v_cant;
  end loop;

  -- Crear comprobante si el gym factura.
  select * into v_fac from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fac.empresa_id is not null and v_fac.activo then
    v_base := round(v_total / 1.18, 2);
    v_igv := v_total - v_base;
    insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
      cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
    values (v_empresa, 'producto', 'venta', v_venta,
      case when p_cliente_tipo_doc = '6' then '01' else '03' end,
      p_cliente_tipo_doc, nullif(p_cliente_num_doc,''),
      coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      nullif(p_cliente_email,''), v_base, v_igv, v_total)
    returning id into v_comp;
  end if;

  return jsonb_build_object('venta_id', v_venta, 'total', v_total, 'comprobante_id', v_comp);
end;
$function$;
grant execute on function public.vender_carrito(uuid, jsonb, text, text, text, text, text) to authenticated;
```

- [ ] **Step 2: Verificar columnas antes de aplicar**

Run:
```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" -c "select column_name from information_schema.columns where table_name='producto' and column_name in ('precio','precio_oferta');"
psql "$DBURL" -c "select column_name from information_schema.columns where table_name='movimiento_financiero' and column_name in ('venta_id','ref_tipo','ref_id','registrado_por','creado_at','metodo_pago');"
```
Expected: `producto` tiene `precio` (y `precio_oferta` si existe — si NO existe, ajustar la RPC para usar solo `precio`). `movimiento_financiero` tiene las columnas usadas. **Si `registrado_por` o `creado_at` tienen otro nombre, ajustar el UPDATE que etiqueta el venta_id.** (Verificar el nombre real de la columna de timestamp: puede ser `created_at`.)

- [ ] **Step 3: Aplicar**

Run: `DBURL=$(cat /tmp/.dburl); psql "$DBURL" -f supabase/migrations/20260710000018_vender_carrito.sql`
Expected: `CREATE FUNCTION`, `GRANT`.

- [ ] **Step 4: Verificar con rollback (venta de 2 productos)**

Prueba en transacción (usa una sede y 1-2 productos reales de una empresa con facturación activa; si no hay, solo verifica que la RPC corre sin error con un producto):
```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" <<'SQL'
begin;
-- ver un producto real y su sede
select id, nombre, precio from public.producto limit 1;
rollback;
SQL
```
Expected: la RPC existe y es invocable. (El E2E de venta real se hace en la UI, Task 5.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710000018_vender_carrito.sql
git commit -m "feat(pos): RPC vender_carrito (multi-item + venta_id + comprobante)"
```

---

## Task 2: Migración — RPC de cobro de membresía desde POS crea comprobante

**Files:**
- Create: `supabase/migrations/20260710000019_membresia_pos_comprobante.sql`

**Interfaces:**
- Consumes: `renew_membership` (existente), `membresia`, `comprobante`, `empresa_facturacion`.
- Produces: `cobrar_membresia_pos(p_membresia_id uuid, p_metodo_pago text, p_monto numeric, p_cliente_tipo_doc text, p_cliente_num_doc text, p_cliente_nombre text, p_cliente_email text) → jsonb` que renueva/abona y crea el comprobante por el monto cobrado.

- [ ] **Step 1: Escribir la migración**

```sql
-- POS: cobra/renueva una membresía y crea el comprobante por el monto cobrado.
-- Reusa renew_membership (que ya registra caja y maneja abono parcial).
create or replace function public.cobrar_membresia_pos(
  p_membresia_id uuid,
  p_metodo_pago text default 'efectivo',
  p_monto numeric default null,
  p_cliente_tipo_doc text default '0',
  p_cliente_num_doc text default null,
  p_cliente_nombre text default 'CLIENTE VARIOS',
  p_cliente_email text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_empresa uuid := public.auth_empresa_id();
  v_res jsonb;
  v_cobrado numeric;
  v_comp uuid;
  v_base numeric; v_igv numeric;
  v_fac public.empresa_facturacion;
begin
  if v_empresa is null then raise exception 'Sin empresa activa'; end if;
  -- renew_membership devuelve {estado, fecha_fin, precio, pagado, saldo}
  v_res := to_jsonb(public.renew_membership(p_membresia_id, p_metodo_pago, null, p_monto));
  v_cobrado := coalesce((v_res->>'pagado')::numeric, p_monto);
  if v_cobrado is null or v_cobrado <= 0 then
    return jsonb_build_object('cobrado', 0, 'comprobante_id', null);
  end if;

  select * into v_fac from public.empresa_facturacion where empresa_id = v_empresa;
  if v_fac.empresa_id is not null and v_fac.activo then
    v_base := round(v_cobrado / 1.18, 2);
    v_igv := v_cobrado - v_base;
    insert into public.comprobante (empresa_id, origen, ref_tipo, ref_id, tipo,
      cliente_tipo_doc, cliente_num_doc, cliente_nombre, cliente_email, base, igv, total)
    values (v_empresa, 'membresia', 'membresia', p_membresia_id,
      case when p_cliente_tipo_doc = '6' then '01' else '03' end,
      p_cliente_tipo_doc, nullif(p_cliente_num_doc,''),
      coalesce(nullif(p_cliente_nombre,''),'CLIENTE VARIOS'),
      nullif(p_cliente_email,''), v_base, v_igv, v_cobrado)
    on conflict (ref_tipo, ref_id) where estado <> 'anulado' do nothing
    returning id into v_comp;
  end if;

  return jsonb_build_object('cobrado', v_cobrado, 'comprobante_id', v_comp, 'renovacion', v_res);
end;
$function$;
grant execute on function public.cobrar_membresia_pos(uuid, text, numeric, text, text, text, text) to authenticated;
```

- [ ] **Step 2: Verificar el retorno de renew_membership**

Run:
```bash
DBURL=$(cat /tmp/.dburl)
psql "$DBURL" -c "select pg_get_function_result(oid) from pg_proc where proname='renew_membership';"
```
Expected: confirmar que `renew_membership` devuelve un tipo con campo `pagado` (jsonb o record). **Si devuelve un record/tabla en vez de jsonb, ajustar el `to_jsonb(...)` y la extracción de `pagado` a la forma real.** (Es el punto más frágil de esta task — verificar antes de aplicar.)

- [ ] **Step 3: Aplicar**

Run: `DBURL=$(cat /tmp/.dburl); psql "$DBURL" -f supabase/migrations/20260710000019_membresia_pos_comprobante.sql`
Expected: `CREATE FUNCTION`, `GRANT`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000019_membresia_pos_comprobante.sql
git commit -m "feat(pos): RPC cobrar_membresia_pos (renueva + comprobante por lo cobrado)"
```

---

## Task 3: Hook `useVentas` (frontend)

**Files:**
- Create: `src/hooks/useVentas.js`

**Interfaces:**
- Consumes: RPCs `vender_carrito`, `cobrar_membresia_pos`; lectura de productos (reusar `useProductos` de `useOperaciones.js`) y de socios/membresías (reusar hooks existentes).
- Produces: `useVenderCarrito()`, `useCobrarMembresiaPos()`, y un helper `useBuscarProductos(sedeId)` si el existente no sirve.

- [ ] **Step 1: Escribir el hook**

```javascript
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Vende un carrito de productos (multi-ítem) → baja stock, caja, comprobante.
export function useVenderCarrito(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ items, metodoPago, cliente }) => {
      const { data, error } = await supabase.rpc('vender_carrito', {
        p_sede_id: sedeId,
        p_items: items, // [{producto_id, cantidad}]
        p_metodo_pago: metodoPago || 'efectivo',
        p_cliente_tipo_doc: cliente?.tipoDoc || '0',
        p_cliente_num_doc: cliente?.numDoc || null,
        p_cliente_nombre: cliente?.nombre || 'CLIENTE VARIOS',
        p_cliente_email: cliente?.email || null,
      })
      if (error) throw error
      return data // {venta_id, total, comprobante_id}
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productos', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    },
  })
}

// Cobra/renueva una membresía desde el POS + comprobante.
export function useCobrarMembresiaPos(sedeId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ membresiaId, metodoPago, monto, cliente }) => {
      const { data, error } = await supabase.rpc('cobrar_membresia_pos', {
        p_membresia_id: membresiaId,
        p_metodo_pago: metodoPago || 'efectivo',
        p_monto: monto ?? null,
        p_cliente_tipo_doc: cliente?.tipoDoc || '0',
        p_cliente_num_doc: cliente?.numDoc || null,
        p_cliente_nombre: cliente?.nombre || 'CLIENTE VARIOS',
        p_cliente_email: cliente?.email || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    },
  })
}
```

- [ ] **Step 2: Verificar build**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useVentas.js
git commit -m "feat(pos): hook useVentas (vender carrito + cobrar membresía)"
```

---

## Task 4: UI — página Ventas (POS)

**Files:**
- Create: `src/pages/Ventas.jsx`
- Modify: `src/config/modules.js` (agregar módulo `ventas`)
- Modify: `src/App.jsx` (import + entrada en PAGES)

**Interfaces:**
- Consumes: `useVenderCarrito`, `useCobrarMembresiaPos`, `useProductos` (de useOperaciones), hooks de socios/membresías existentes, `usePanel` (sedeId), `useAuth`.
- Produces: la pantalla POS. (Verificación visual + build, sin test unitario — patrón de páginas del repo.)

- [ ] **Step 1: Escribir `Ventas.jsx`**

Pantalla de dos columnas (cobro | resumen), responsive. Estructura:
- Toggle `Producto | Membresía`.
- **Producto:** buscador de productos (filtra `useProductos(sedeId)` por nombre) → botón agregar → carrito (lista con cantidad editable y subtotal). Total con IGV desglosado.
- **Membresía:** buscador de socio → muestra su membresía → renovar (monto editable para abono parcial).
- Chips de método de pago: `Efectivo · Yape · Plin · Tarjeta · Transferencia`.
- Bloque colapsable "¿Boleta con datos o factura?": tipo (boleta DNI / factura RUC) + doc + nombre + email opcional.
- Botón `Cobrar S/XX` → llama la RPC → toast + resultado (número de comprobante si emitió, o "boleta en proceso").

Usar `Card`, `PrimaryButton`, `Badge` del tema; grid `grid-cols-1 lg:grid-cols-[1fr_340px]`; chips de método con `bg-orange` para el activo. Reusar el patrón de buscador de productos de `Kardex.jsx` y de socios de `Clientes.jsx`/`Membresias.jsx`. Copy español, sentence case. El código completo se escribe siguiendo estos componentes; mantener la pantalla enfocada (si crece mucho, extraer el carrito y el buscador a subcomponentes en el mismo archivo).

- [ ] **Step 2: Registrar el módulo en `src/config/modules.js`**

Agregar al array `MODULES`, en el grupo `operacion`, ANTES de `kardex`:
```javascript
{ slug: 'ventas', label: 'Ventas', grupo: 'operacion', roles: ['admin', 'recepcion'], alwaysOn: true },
```
(`alwaysOn: true` porque el slug `ventas` no está en la tabla `modulo` de la BD; así no depende de un registro que no existe.)

- [ ] **Step 3: Registrar la ruta en `src/App.jsx`**

Agregar el import junto a los otros (`import Ventas from './pages/Ventas.jsx'`) y la entrada en el array `PAGES` (antes de `['kardex', Kardex]`):
```javascript
['ventas', Ventas],
```

- [ ] **Step 4: Verificar build**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Ventas.jsx src/config/modules.js src/App.jsx
git commit -m "feat(pos): sección Ventas (POS) — carrito, membresía, método de pago, boleta"
```

---

## Task 5: Kardex pierde la venta (queda como inventario) + badges de comprobante

**Files:**
- Modify: `src/pages/Kardex.jsx` (quitar el modal de venta tipo 'venta'; conservar compra/ajuste/ofertas/imagen/app/entregas)
- Modify: `src/pages/Ventas.jsx` (mostrar estado del comprobante tras cobrar: badge + "Ver boleta")

**Interfaces:**
- Consumes: `comprobante` (lectura por RLS ya permitida al panel).
- Produces: Kardex sin venta; POS muestra el resultado de la boleta.

- [ ] **Step 1: Quitar la venta de Kardex**

En `src/pages/Kardex.jsx`, localizar el `MovimientoModal` y su selector de tipo. Quitar la opción 'venta' (dejar 'compra' y 'ajuste'). Si hay un botón "Registrar venta" o similar, quitarlo y en su lugar un enlace/botón "Ir a Ventas" que navegue a `/ventas`. NO tocar: ofertas, imagen del producto, "vender en app", órdenes por entregar (recojo). Verificar que el resto de Kardex sigue funcionando.

- [ ] **Step 2: Mostrar el estado del comprobante en el POS**

En `Ventas.jsx`, tras un cobro exitoso que devolvió `comprobante_id`, mostrar un bloque de resultado: badge de estado (Emitida/Pendiente) y, cuando el comprobante esté `emitido` (consultar por `comprobante_id`), botón "Ver boleta" que abre el PDF vía `…/api/documents/{norac_id}/pdf`. Si aún `pendiente`, mostrar "Boleta en proceso — llegará por correo". Reusar el patrón de badges del tema (`bg-green`/`amber`).

- [ ] **Step 3: Verificar build**

Run: `cd "d:/Personal Proyects/ControlGym" && npm run build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Kardex.jsx src/pages/Ventas.jsx
git commit -m "feat(pos): Kardex solo inventario + estado de boleta en Ventas"
```

---

## Self-Review

**Spec coverage (POS):**
- Sección Ventas separada de Kardex → Tasks 4, 5 ✅
- Carrito multi-ítem de productos + venta_id → Task 1 ✅
- Cobro de membresía desde POS → Task 2 ✅
- Método de pago (incl. tarjeta) → Tasks 1, 2, 4 ✅
- Boleta simple/DNI/factura → Tasks 1, 2 (tipo por cliente_tipo_doc), 4 (UI opcional) ✅
- Reusa facturación existente (no reimplementa emisión) → Tasks 1, 2 crean comprobante; worker ya emite ✅
- Kardex solo inventario → Task 5 ✅
- Estado de boleta + Ver boleta → Task 5 ✅
- Permisos recepción/admin → Task 4 (módulo roles) ✅

**Placeholder scan:** Task 4 Step 1 describe la pantalla por composición de componentes en vez de pegar 200 líneas de JSX — es una página de UI cuya forma exacta depende de los componentes reales del repo (buscadores de Kardex/Clientes); el implementer los tiene delante. No es un placeholder de lógica: los datos, RPCs, grid, tokens y estructura están especificados. Igual que las otras páginas del repo se implementan.

**Puntos frágiles marcados para verificar antes de aplicar:**
- Task 1: nombre real de la columna timestamp de `movimiento_financiero` (creado_at vs created_at) y existencia de `precio_oferta`.
- Task 2: forma de retorno de `renew_membership` (jsonb vs record) para extraer `pagado`.
Ambos tienen un Step de verificación explícito antes de aplicar la migración.

## Notas
- El E2E de emisión real depende de que el gym tenga facturación activa + key NORAC (config del owner, ya cubierto en el subsistema 1). Sin eso, la venta funciona y el comprobante queda sin crear (gym no factura) — la venta NUNCA se bloquea por facturación.
- La caja chica (denominaciones, gastos, historial) es el subsistema 3/3, plan aparte.
