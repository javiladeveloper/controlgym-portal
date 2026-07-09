import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useProductos, useMovimientosInventario } from '../hooks/useOperaciones.js'
import { subirImagen } from '../hooks/useConfiguracion.js'
import { useProductosPorEntregar, useEntregarProducto, useCancelarCompra } from '../hooks/useRecojo.js'
import { money } from '../lib/uiHelpers.js'
import { toast } from '../lib/toast.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function MovimientoModal({ sedeId, empresaId, productos, moneda, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ producto_id: productos[0]?.id || '__nuevo__', tipo: 'venta', cantidad: 1, monto: '', np_nombre: '', np_categoria: 'Suplementos', np_precio: '', np_stockmin: 5 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  // Un producto nuevo nace con stock 0: su primer movimiento natural es una compra
  const setProducto = (e) => {
    const v = e.target.value
    setF((s) => ({ ...s, producto_id: v, tipo: v === '__nuevo__' ? 'compra' : s.tipo }))
  }

  const prod = productos.find((p) => p.id === f.producto_id)
  // Sugerido = precio unitario × cantidad (también para producto nuevo, usando el precio recién escrito)
  const precioUnit = prod ? Number(prod.precio) : Number(f.np_precio) || 0
  const montoSugerido = precioUnit * (Number(f.cantidad) || 0)
  // En ventas el total viene lleno con el cálculo; si el usuario escribe, manda lo suyo
  const montoMostrado = f.tipo === 'venta' && f.monto === '' ? (montoSugerido || '') : f.monto

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    try {
      let productoId = f.producto_id
      // Producto nuevo al vuelo
      if (productoId === '__nuevo__') {
        if (!f.np_nombre.trim()) throw new Error('Escribe el nombre del producto nuevo')
        const { data, error } = await supabase.from('producto').insert({
          empresa_id: empresaId, nombre: f.np_nombre.trim(), categoria: f.np_categoria,
          precio: Number(f.np_precio) || 0, stock_minimo: Number(f.np_stockmin) || 0,
        }).select('id').single()
        if (error) throw error
        productoId = data.id
      }
      // Un total explícito en venta/compra debe ser positivo: un monto 0 o
      // negativo ensuciaría la caja (p. ej. una venta que RESTA de caja).
      if ((f.tipo === 'venta' || f.tipo === 'compra') && f.monto !== '' && Number(f.monto) <= 0) {
        throw new Error('El total de la operación debe ser mayor a 0')
      }
      const { error } = await supabase.rpc('registrar_mov_inventario', {
        p_sede_id: sedeId, p_producto_id: productoId, p_tipo: f.tipo,
        p_cantidad: Number(f.cantidad), p_monto: f.monto === '' ? null : Number(f.monto),
      })
      if (error) throw error
      qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
      qc.invalidateQueries({ queryKey: ['kardex-movs', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Registrar movimiento" subtitle="Venta o compra: actualiza stock y caja" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Producto">
          <select value={f.producto_id} onChange={setProducto} className={inputCls + ' cursor-pointer'}>
            {productos.map((p) => <option key={p.id} value={p.id}>{p.nombre} (stock {p.stock})</option>)}
            <option value="__nuevo__">+ Producto nuevo…</option>
          </select>
        </Campo>
        {f.producto_id === '__nuevo__' && (
          <div className="rounded-[10px] border border-line bg-[#FAFBFC] p-3">
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Nombre *"><input value={f.np_nombre} onChange={set('np_nombre')} className={inputCls} placeholder="Proteína 1 kg" /></Campo>
              <Campo label="Categoría">
                <select value={f.np_categoria} onChange={set('np_categoria')} className={inputCls + ' cursor-pointer'}>
                  {['Suplementos', 'Bebidas', 'Accesorios', 'Ropa', 'Otros'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Campo>
              <Campo label={`Precio de venta (${moneda})`} hint="A cuánto vendes 1 unidad. Queda guardado en el producto.">
                <input type="number" step="0.1" value={f.np_precio} onChange={set('np_precio')} className={inputCls} />
              </Campo>
              <Campo label="Alerta de stock bajo"><input type="number" value={f.np_stockmin} onChange={set('np_stockmin')} className={inputCls} /></Campo>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo" hint={f.producto_id === '__nuevo__' && f.tipo === 'venta' ? 'Un producto nuevo empieza con stock 0: primero regístrale una compra.' : undefined}>
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="venta">Venta (sale stock, entra a caja)</option>
              <option value="compra">Compra (entra stock, sale de caja)</option>
              <option value="ajuste">Ajuste de inventario (+)</option>
            </select>
          </Campo>
          <Campo label="Cantidad (unidades)"
            hint={f.tipo === 'venta'
              ? (prod ? `Disponible: ${prod.stock} uds.` : undefined)
              : `En unidades sueltas, no paquetes: 4 paquetes de 12 = 48.${prod ? ` El stock quedará en ${Number(prod.stock) + (Number(f.cantidad) || 0)} uds.` : ''}`}>
            <input type="number" min="1" value={f.cantidad} onChange={set('cantidad')} className={inputCls} />
          </Campo>
        </div>
        <Campo label={`Total de la operación (${moneda})`}
          hint={f.tipo === 'venta' ? 'Se calcula solo (precio × cantidad). Cámbialo únicamente si cobraste otro monto, p. ej. con descuento.'
            : f.tipo === 'compra' ? 'Lo que le pagas al proveedor por esta compra (costo total, no el precio de venta).'
            : 'El ajuste no mueve caja; puedes dejarlo vacío.'}>
          <input type="number" step="0.1" min="0" value={montoMostrado} onChange={set('monto')} className={inputCls} placeholder="0" />
        </Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel="Registrar" />
      </form>
    </Modal>
  )
}

// Editar producto (precio, categoría, alerta de stock) y eliminarlo (soft).
function ProductoModal({ producto, sedeId, moneda, onClose }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const [f, setF] = useState({
    nombre: producto.nombre || '', categoria: producto.categoria || 'Otros',
    precio: String(producto.precio ?? ''), stock_minimo: String(producto.stock_minimo ?? 0),
    descripcion: producto.descripcion || '', imagen_url: producto.imagen_url || '',
    visible_en_app: producto.visible_en_app ?? false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmarDel, setConfirmarDel] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function onFoto(file) {
    if (!file) return
    setSubiendo(true); setError('')
    try {
      const url = await subirImagen(empresa.id, 'producto', file)
      setF((s) => ({ ...s, imagen_url: url }))
    } catch (e) {
      setError('No se pudo subir la foto: ' + e.message)
    } finally {
      setSubiendo(false)
    }
  }

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
    qc.invalidateQueries({ queryKey: ['kardex-movs', sedeId] })
  }

  async function guardar(e) {
    e?.preventDefault()
    // Para vender por app: foto obligatoria (sin foto no se vende bien).
    if (f.visible_en_app && !f.imagen_url) {
      setError('Para vender este producto en la app, súbele una foto primero.')
      return
    }
    setBusy(true); setError('')
    const { error } = await supabase.from('producto').update({
      nombre: f.nombre.trim(), categoria: f.categoria,
      precio: Number(f.precio) || 0, stock_minimo: Number(f.stock_minimo) || 0,
      descripcion: f.descripcion.trim() || null, imagen_url: f.imagen_url || null,
      visible_en_app: f.visible_en_app,
    }).eq('id', producto.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onClose()
  }

  async function eliminar() {
    setBusy(true); setError('')
    const { error } = await supabase.from('producto')
      .update({ deleted_at: new Date().toISOString(), activo: false }).eq('id', producto.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onClose()
    toast.undo(`Producto ${producto.nombre} eliminado`, async () => {
      await supabase.from('producto').update({ deleted_at: null, activo: true }).eq('id', producto.id)
      invalidar()
      toast.ok('Producto restaurado')
    })
  }

  return (
    <Modal title="Editar producto" subtitle={producto.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Categoría">
            <select value={f.categoria} onChange={set('categoria')} className={inputCls + ' cursor-pointer'}>
              {['Suplementos', 'Bebidas', 'Accesorios', 'Ropa', 'Otros'].map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Campo>
          <Campo label={`Precio de venta (${moneda})`}><input type="number" step="0.1" min="0" value={f.precio} onChange={set('precio')} className={inputCls} /></Campo>
        </div>
        <Campo label="Alerta de stock bajo (unidades)"><input type="number" min="0" value={f.stock_minimo} onChange={set('stock_minimo')} className={inputCls} /></Campo>

        {/* ── Venta por app: foto, descripción y el interruptor ───────────── */}
        <div className="rounded-[12px] border border-line bg-[#FAFBFC] p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[13px] font-extrabold">Vender en la app 📱</div>
              <div className="mt-0.5 text-[11.5px] font-semibold leading-[1.4] text-muted">
                Si lo activas, tus socios podrán comprarlo desde la app y recogerlo en el gym.
                Necesita foto. Solo se muestran los productos que actives.
              </div>
            </div>
            <button type="button"
              onClick={() => setF((s) => ({ ...s, visible_en_app: !s.visible_en_app }))}
              className={`relative mt-0.5 h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-none transition-colors ${f.visible_en_app ? 'bg-orange' : 'bg-line2'}`}
              aria-label="Vender en la app">
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${f.visible_en_app ? 'left-6' : 'left-1'}`} />
            </button>
          </div>

          <div className="mt-3 flex items-start gap-3">
            {/* Foto */}
            <div className="flex-shrink-0">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-[10px] border border-line bg-white">
                {f.imagen_url
                  ? <img src={f.imagen_url} alt="" className="h-full w-full object-cover" />
                  : <span className="text-[10px] font-bold text-faint">sin foto</span>}
              </div>
              <label className="mt-1.5 block cursor-pointer text-center text-[11px] font-extrabold text-orange hover:underline">
                {subiendo ? 'Subiendo…' : (f.imagen_url ? 'Cambiar' : 'Subir foto')}
                <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                  onChange={(e) => { const file = e.target.files?.[0]; if (file) onFoto(file); e.target.value = '' }} />
              </label>
            </div>
            {/* Descripción */}
            <label className="flex-1">
              <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Descripción</span>
              <textarea value={f.descripcion} onChange={set('descripcion')} rows={3}
                className={inputCls + ' resize-none'} placeholder="Sabor, tamaño, para qué sirve… (lo verá el socio en la app)" />
            </label>
          </div>
        </div>

        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        {confirmarDel ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-red-200 bg-red-50 px-3.5 py-2.5">
            <span className="flex-1 text-[12.5px] font-extrabold text-red">¿Eliminar este producto? Su historial de movimientos se conserva.</span>
            <button type="button" disabled={busy} onClick={eliminar}
              className="cursor-pointer rounded-[8px] border-none bg-red px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Sí</button>
            <button type="button" onClick={() => setConfirmarDel(false)}
              className="cursor-pointer rounded-[8px] border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted">No</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmarDel(true)}
            className="cursor-pointer self-start border-none bg-transparent p-0 text-[12.5px] font-extrabold text-red hover:underline">
            🗑 Eliminar producto
          </button>
        )}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Guardar cambios" />
      </form>
    </Modal>
  )
}

export default function Kardex() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const qc = useQueryClient()
  const moneda = empresa?.moneda || 'PEN'
  const [movOpen, setMovOpen] = useState(false)
  const [editarProd, setEditarProd] = useState(null)
  const [anulando, setAnulando] = useState(null) // movimiento en confirmación
  const [busyAnular, setBusyAnular] = useState(false)
  const [verTodos, setVerTodos] = useState(false) // expandir la lista de movimientos del mes
  const productos = useProductos(sedeId)
  const movs = useMovimientosInventario(sedeId)
  const porEntregar = useProductosPorEntregar(sedeId)
  const entregar = useEntregarProducto(sedeId)
  const cancelar = useCancelarCompra(sedeId)

  function onEntregar(p) {
    if (!window.confirm(`¿Entregar ${p.producto_nombre} a ${p.socio_nombre || 'el socio'}?`)) return
    entregar.mutate(p.id, {
      onSuccess: () => toast.ok('Producto entregado'),
      onError: (e) => toast.error(e.message),
    })
  }
  function onCancelarCompra(p) {
    if (!window.confirm(`¿Cancelar la compra de ${p.producto_nombre}? Se repone el stock y se marca para reembolso. El dinero se devuelve por MercadoPago aparte.`)) return
    cancelar.mutate({ pagoId: p.id, motivo: 'cancelado en mostrador' }, {
      onSuccess: () => toast.ok('Compra cancelada · stock repuesto'),
      onError: (e) => toast.error(e.message),
    })
  }

  async function anularMov(m) {
    setBusyAnular(true)
    const { error } = await supabase.rpc('anular_mov_inventario', { p_id: m.id })
    setBusyAnular(false)
    setAnulando(null)
    if (error) { toast.error('No se pudo anular: ' + error.message); return }
    toast.ok('Movimiento anulado: stock y caja revertidos')
    qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
    qc.invalidateQueries({ queryKey: ['kardex-movs', sedeId] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
  }

  const bajos = (productos.data || []).filter((p) => p.bajo).length
  const ventasHoy = (movs.data || []).filter((m) => m.tipo === 'venta' && new Date(m.fecha).toDateString() === new Date().toDateString())
    .reduce((n, m) => n + Number(m.monto || 0), 0)
  const ventasMes = (movs.data || []).filter((m) => m.tipo === 'venta').reduce((n, m) => n + Number(m.monto || 0), 0)
  const comprasMes = (movs.data || []).filter((m) => m.tipo === 'compra').reduce((n, m) => n + Number(m.monto || 0), 0)

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Kardex</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Inventario y venta de productos · {sedeNombre}</p>
        </div>
        <button onClick={() => setMovOpen(true)}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Registrar movimiento</button>
      </div>

      {movOpen && (
        <MovimientoModal sedeId={sedeId} empresaId={empresa?.id} productos={productos.data || []} moneda={moneda} onClose={() => setMovOpen(false)} />
      )}
      {editarProd && (
        <ProductoModal producto={editarProd} sedeId={sedeId} moneda={moneda} onClose={() => setEditarProd(null)} />
      )}

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
        <StatCard label="Productos en inventario" value={productos.data?.length ?? 0} />
        <StatCard label="Con stock bajo" value={bajos} variant={bajos ? 'danger' : 'default'} />
        <StatCard label="Ventas del mes" value={money(ventasMes, moneda)} delta={`hoy: ${money(ventasHoy, moneda)}`} deltaColor={T.success} />
        <StatCard label="Compras del mes" value={money(comprasMes, moneda)} delta="inversión en mercadería" />
      </div>

      {/* Productos comprados por app, pendientes de que el socio los recoja */}
      {(porEntregar.data?.length > 0) && (
        <Card className="mt-[15px] p-5">
          <div className="flex items-center gap-2">
            <div className="text-[14.5px] font-extrabold">Productos por entregar 📦</div>
            <Badge bg="#FEF3E2" color="#B7791F">{porEntregar.data.length}</Badge>
          </div>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            Comprados desde la app. El stock ya se descontó al pagar. Entrégalos cuando el socio venga.
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            {porEntregar.data.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-[12px] border border-line bg-white px-3.5 py-3">
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-line bg-surface">
                  {p.imagen_url ? <img src={p.imagen_url} alt="" className="h-full w-full object-cover" /> : <span className="text-[9px] font-bold text-faint">sin foto</span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-extrabold">{p.producto_nombre}</div>
                  <div className="text-[11.5px] font-semibold text-muted">
                    {p.socio_nombre ? `${p.socio_nombre}${p.socio_codigo ? ` · N.º ${p.socio_codigo}` : ''}` : 'Socio'}
                    {' · '}{p.moneda === 'PEN' ? 'S/' : ''}{Number(p.monto).toFixed(2)}
                    {p.pagado_at ? ` · ${new Date(p.pagado_at).toLocaleDateString('es-PE')}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => onEntregar(p)} disabled={entregar.isPending}
                    className="cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[12.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">Entregar</button>
                  <button onClick={() => onCancelarCompra(p)} disabled={cancelar.isPending}
                    className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12.5px] font-extrabold text-muted hover:border-red hover:text-red disabled:opacity-50">Cancelar</button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {productos.isLoading && <LoadingState variant="table" rows={5} />}
      {productos.error && <ErrorState error={productos.error} onRetry={productos.refetch} />}
      {!productos.isLoading && (productos.data || []).length === 0 && (
        <EmptyState icon="📦" message="Tu inventario está vacío — registra tu primera compra y el stock se arma solo."
          actionLabel="+ Registrar movimiento" onAction={() => setMovOpen(true)} />
      )}

      {(productos.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-x-auto">
          <div className="grid min-w-[660px] grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1.1fr_60px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Producto</div><div>Categoría</div><div>Stock</div><div>Precio</div><div>Estado</div><div />
          </div>
          {productos.data.map((k) => (
            <div key={k.id}
              onClick={(e) => { if (e.target.closest('button,a')) return; setEditarProd(k) }}
              className="grid min-w-[660px] cursor-pointer grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1.1fr_60px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="text-[13.5px] font-extrabold">{k.nombre}</div>
              <div className="text-[12.5px] font-bold text-muted">{k.categoria}</div>
              <div className="text-[13px] font-extrabold" style={{ color: k.bajo ? T.danger : T.navy }}>{k.stock} uds.</div>
              <div className="text-[13px] font-bold">{money(k.precio, moneda)}</div>
              <div><Badge bg={k.bajo ? T.dangerBg : T.successBg} color={k.bajo ? T.danger : T.success}>{k.bajo ? 'Stock bajo' : 'OK'}</Badge></div>
              <button onClick={() => setEditarProd(k)} title="Editar producto"
                className="cursor-pointer rounded-lg border-none bg-transparent px-2 py-1 text-[13px] text-faint hover:text-orange">✏️</button>
            </div>
          ))}
        </Card>
      )}

      {(movs.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-x-auto">
          <div className="px-5 py-4">
            <div className="text-[14.5px] font-extrabold">Movimientos del mes</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">
              Compra = <b>entra stock, sale de caja</b> · Venta = <b>sale stock, entra a caja</b>
            </div>
          </div>
          <div className="grid min-w-[660px] grid-cols-[0.8fr_1.8fr_1fr_0.9fr_0.9fr_150px] items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Fecha</div><div>Producto</div><div>Movimiento</div><div>Stock</div><div>Caja</div><div />
          </div>
          {(verTodos ? movs.data : movs.data.slice(0, 12)).map((m) => {
            const venta = m.tipo === 'venta'
            const ajuste = m.tipo === 'ajuste'
            return (
              <div key={m.id} className="grid min-w-[660px] grid-cols-[0.8fr_1.8fr_1fr_0.9fr_0.9fr_150px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                <div className="text-[12.5px] font-bold text-muted">{new Date(m.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</div>
                <div className="text-[13.5px] font-extrabold">{m.producto?.nombre}</div>
                <div><Badge bg={venta ? T.successBg : ajuste ? T.line2 : T.chipNavy} color={venta ? T.success : ajuste ? T.muted : T.navy} className="capitalize">{m.tipo}</Badge></div>
                {/* Efecto en el stock */}
                <div className="text-[13px] font-extrabold" style={{ color: venta ? T.danger : T.success }}>
                  {venta ? '−' : '+'}{m.cantidad} uds.
                </div>
                {/* Efecto en la caja */}
                <div className="text-[13px] font-extrabold" style={{ color: ajuste ? T.faint : venta ? T.success : T.danger }}>
                  {ajuste ? '—' : (venta ? '+' : '−') + money(m.monto, moneda)}
                </div>
                {anulando === m.id ? (
                  <div className="flex items-center gap-1.5">
                    <button disabled={busyAnular} onClick={() => anularMov(m)}
                      className="cursor-pointer rounded-[8px] border-none bg-red px-2.5 py-1.5 text-[10.5px] font-extrabold text-white disabled:opacity-50">Anular</button>
                    <button onClick={() => setAnulando(null)}
                      className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[10.5px] font-extrabold text-muted">No</button>
                  </div>
                ) : (
                  <button onClick={() => setAnulando(m.id)} title="Anular: revierte stock y caja"
                    className="cursor-pointer justify-self-end rounded-lg border-none bg-transparent px-2 py-1 text-[11.5px] font-extrabold text-faint hover:text-red">
                    Anular
                  </button>
                )}
              </div>
            )
          })}
          {movs.data.length > 12 && (
            <div className="flex items-center justify-between gap-3 border-t border-line2 px-5 py-3">
              <span className="text-[12px] font-semibold text-muted">
                Mostrando {verTodos ? movs.data.length : 12} de {movs.data.length} movimientos del mes
              </span>
              <button onClick={() => setVerTodos((v) => !v)}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-1.5 text-[12px] font-extrabold text-muted hover:border-orange hover:text-orange">
                {verTodos ? 'Ver menos' : `Ver todos (${movs.data.length})`}
              </button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
