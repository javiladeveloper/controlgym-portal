import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  const [f, setF] = useState({ producto_id: productos[0]?.id || '__nuevo__', tipo: 'compra', cantidad: 1, monto: '', np_nombre: '', np_categoria: 'Suplementos', np_precio: '', np_stockmin: 5 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  // Un producto nuevo nace con stock 0: su primer movimiento natural es una compra
  const setProducto = (e) => {
    const v = e.target.value
    setF((s) => ({ ...s, producto_id: v, tipo: v === '__nuevo__' ? 'compra' : s.tipo }))
  }

  const prod = productos.find((p) => p.id === f.producto_id)

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
      // Un total explícito en compra debe ser positivo: un monto 0 o
      // negativo ensuciaría la caja.
      if (f.tipo === 'compra' && f.monto !== '' && Number(f.monto) <= 0) {
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
    <Modal title="Registrar movimiento" subtitle="Compra o ajuste: actualiza stock y caja" onClose={onClose}>
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
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="compra">Compra (entra stock, sale de caja)</option>
              <option value="ajuste">Ajuste de inventario (+)</option>
            </select>
          </Campo>
          <Campo label="Cantidad (unidades)"
            hint={`En unidades sueltas, no paquetes: 4 paquetes de 12 = 48.${prod ? ` El stock quedará en ${Number(prod.stock) + (Number(f.cantidad) || 0)} uds.` : ''}`}>
            <input type="number" min="1" value={f.cantidad} onChange={set('cantidad')} className={inputCls} />
          </Campo>
        </div>
        <Campo label={`Total de la operación (${moneda})`}
          hint={f.tipo === 'compra' ? 'Lo que le pagas al proveedor por esta compra (costo total, no el precio de venta).'
            : 'El ajuste no mueve caja; puedes dejarlo vacío.'}>
          <input type="number" step="0.1" min="0" value={f.monto} onChange={set('monto')} className={inputCls} placeholder="0" />
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
    descripcion: producto.descripcion || '', beneficio: producto.beneficio || '', imagen_url: producto.imagen_url || '',
    visible_en_app: producto.visible_en_app ?? false,
    descuento_tipo: producto.descuento_tipo || '', descuento_valor: String(producto.descuento_valor ?? ''),
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
    const tieneOferta = f.descuento_tipo === 'porcentaje' || f.descuento_tipo === 'monto'
    const { error } = await supabase.from('producto').update({
      nombre: f.nombre.trim(), categoria: f.categoria,
      precio: Number(f.precio) || 0, stock_minimo: Number(f.stock_minimo) || 0,
      descripcion: f.descripcion.trim() || null, beneficio: f.beneficio.trim() || null, imagen_url: f.imagen_url || null,
      visible_en_app: f.visible_en_app,
      descuento_tipo: tieneOferta ? f.descuento_tipo : null,
      descuento_valor: tieneOferta ? (Number(f.descuento_valor) || 0) : null,
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

        {/* ── Oferta permanente: % o monto fijo, con preview del precio final ── */}
        <div className="rounded-[12px] border border-line bg-[#FAFBFC] p-3.5">
          <div className="text-[13px] font-extrabold">Oferta permanente 🏷️</div>
          <div className="mt-0.5 text-[11.5px] font-semibold leading-[1.4] text-muted">
            Aplica un descuento fijo a este producto. Se ve así en el kardex, la tienda y el cobro (el precio con
            descuento lo calcula el servidor).
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Campo label="Tipo de oferta">
              <select value={f.descuento_tipo} onChange={set('descuento_tipo')} className={inputCls + ' cursor-pointer'}>
                <option value="">Sin oferta</option>
                <option value="porcentaje">Descuento %</option>
                <option value="monto">Descuento monto fijo</option>
              </select>
            </Campo>
            {(f.descuento_tipo === 'porcentaje' || f.descuento_tipo === 'monto') && (
              <Campo label={f.descuento_tipo === 'porcentaje' ? 'Valor (%)' : `Valor (${moneda})`}>
                <input type="number" step="0.1" min="0" value={f.descuento_valor} onChange={set('descuento_valor')} className={inputCls} />
              </Campo>
            )}
          </div>
          {(f.descuento_tipo === 'porcentaje' || f.descuento_tipo === 'monto') && Number(f.descuento_valor) > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[12.5px] font-extrabold">
              <span className="text-faint line-through">{money(Number(f.precio) || 0, moneda)}</span>
              <span className="text-orange">
                {money(
                  f.descuento_tipo === 'porcentaje'
                    ? Math.max(0, (Number(f.precio) || 0) * (1 - (Number(f.descuento_valor) || 0) / 100))
                    : Math.max(0, (Number(f.precio) || 0) - (Number(f.descuento_valor) || 0)),
                  moneda
                )}
              </span>
              <span className="font-semibold text-muted">precio final</span>
            </div>
          )}
        </div>

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
          {/* Beneficio: para suplementos, lo que el socio gana con el producto */}
          <label className="mt-3 block">
            <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Beneficio <span className="font-semibold normal-case text-faint">(ideal para suplementos)</span></span>
            <input value={f.beneficio} onChange={set('beneficio')} className={inputCls}
              placeholder="Ej: 24g de proteína · recuperación muscular · pre-entreno" />
          </label>
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
  const navigate = useNavigate()
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
    if (!window.confirm(`¿Entregar esta orden a ${p.socio_nombre || 'el socio'}?`)) return
    entregar.mutate(p.id, {
      onSuccess: () => toast.ok('Orden entregada'),
      onError: (e) => toast.error(e.message),
    })
  }
  function onCancelarCompra(p) {
    if (!window.confirm(`¿Cancelar esta orden? Se repone el stock de todos los productos y se marca para reembolso. El dinero se devuelve por MercadoPago aparte.`)) return
    cancelar.mutate({ pagoId: p.id, motivo: 'cancelado en mostrador' }, {
      onSuccess: () => toast.ok('Orden cancelada · stock repuesto'),
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
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Inventario de productos · {sedeNombre}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/ventas')}
            className="cursor-pointer border-none bg-transparent p-0 text-[12.5px] font-extrabold text-orange hover:underline">
            ¿Vas a vender? Usa la sección Ventas →
          </button>
          <button onClick={() => setMovOpen(true)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Registrar movimiento</button>
        </div>
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

      {/* Órdenes compradas por app, pendientes de que el socio las recoja */}
      {(porEntregar.data?.length > 0) && (
        <Card className="mt-[15px] p-5">
          <div className="flex items-center gap-2">
            <div className="text-[14.5px] font-extrabold">Órdenes por entregar 📦</div>
            <Badge bg="#FEF3E2" color="#B7791F">{porEntregar.data.length}</Badge>
          </div>
          <p className="mt-0.5 text-[12px] font-semibold text-muted">
            Compradas desde la app. El stock ya se descontó al pagar. Entrégalas cuando el socio venga.
          </p>
          <div className="mt-4 flex flex-col gap-2.5">
            {porEntregar.data.map((p) => (
              <div key={p.id} className="rounded-[12px] border border-line bg-white px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-extrabold">
                      {p.socio_nombre ? `${p.socio_nombre}${p.socio_codigo ? ` · N.º ${p.socio_codigo}` : ''}` : 'Socio'}
                    </div>
                    <div className="text-[11.5px] font-semibold text-muted">
                      {p.moneda === 'PEN' ? 'S/' : ''}{Number(p.monto).toFixed(2)}
                      {p.pagado_at ? ` · ${new Date(p.pagado_at).toLocaleDateString('es-PE')}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => onEntregar(p)} disabled={entregar.isPending}
                      className="cursor-pointer rounded-[9px] border-none bg-orange px-3.5 py-2 text-[12.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">Entregar orden</button>
                    <button onClick={() => onCancelarCompra(p)} disabled={cancelar.isPending}
                      className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12.5px] font-extrabold text-muted hover:border-red hover:text-red disabled:opacity-50">Cancelar</button>
                  </div>
                </div>
                {/* Items de la orden */}
                <div className="mt-2.5 flex flex-col gap-1.5 border-t border-line2 pt-2.5">
                  {(p.items || []).map((it, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[7px] border border-line bg-surface">
                        {it.imagen_url ? <img src={it.imagen_url} alt="" className="h-full w-full object-cover" /> : <span className="text-[8px] font-bold text-faint">—</span>}
                      </div>
                      <span className="flex-1 text-[12.5px] font-bold">{it.nombre}</span>
                      <span className="text-[12px] font-extrabold text-muted">×{it.cantidad}</span>
                      <span className="w-16 text-right text-[12px] font-bold text-muted">{p.moneda === 'PEN' ? 'S/' : ''}{Number(it.subtotal).toFixed(2)}</span>
                    </div>
                  ))}
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
          <div className="grid min-w-[760px] grid-cols-[2.4fr_1fr_0.9fr_0.7fr_0.8fr_1fr_60px] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Producto</div><div>Categoría</div><div>En app</div><div>Stock</div><div>Precio</div><div>Estado</div><div />
          </div>
          {productos.data.map((k) => (
            <div key={k.id}
              onClick={(e) => { if (e.target.closest('button,a')) return; setEditarProd(k) }}
              className="grid min-w-[760px] cursor-pointer grid-cols-[2.4fr_1fr_0.9fr_0.7fr_0.8fr_1fr_60px] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              {/* Nombre con miniatura de la foto (si tiene) */}
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-line bg-surface">
                  {k.imagen_url
                    ? <img src={k.imagen_url} alt="" className="h-full w-full object-cover" />
                    : <span className="text-[8px] font-bold text-faint">—</span>}
                </div>
                <span className="text-[13.5px] font-extrabold">{k.nombre}</span>
              </div>
              <div className="text-[12.5px] font-bold text-muted">{k.categoria}</div>
              {/* Indicador de venta por app */}
              <div>
                {k.visible_en_app
                  ? <Badge bg={T.successBg} color={T.success}>📱 En app</Badge>
                  : <span className="text-[12px] font-bold text-faint">No</span>}
              </div>
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
