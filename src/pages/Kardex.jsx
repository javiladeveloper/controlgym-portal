import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useProductos, useMovimientosInventario } from '../hooks/useOperaciones.js'
import { money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function MovimientoModal({ sedeId, empresaId, productos, moneda, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ producto_id: productos[0]?.id || '__nuevo__', tipo: 'venta', cantidad: 1, monto: '', np_nombre: '', np_categoria: 'Suplementos', np_precio: '', np_stockmin: 5 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const prod = productos.find((p) => p.id === f.producto_id)
  const montoSugerido = prod ? Number(prod.precio) * (Number(f.cantidad) || 0) : 0

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
          <select value={f.producto_id} onChange={set('producto_id')} className={inputCls + ' cursor-pointer'}>
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
              <Campo label={`Precio de venta (${moneda})`}><input type="number" step="0.1" value={f.np_precio} onChange={set('np_precio')} className={inputCls} /></Campo>
              <Campo label="Alerta de stock bajo"><input type="number" value={f.np_stockmin} onChange={set('np_stockmin')} className={inputCls} /></Campo>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="venta">Venta (sale stock, entra a caja)</option>
              <option value="compra">Compra (entra stock, sale de caja)</option>
              <option value="ajuste">Ajuste de inventario (+)</option>
            </select>
          </Campo>
          <Campo label="Cantidad"><input type="number" min="1" value={f.cantidad} onChange={set('cantidad')} className={inputCls} /></Campo>
        </div>
        <Campo label={`Monto (${moneda})`} hint={f.tipo === 'venta' && montoSugerido ? `Sugerido: ${money(montoSugerido, moneda)} (precio × cantidad). Déjalo vacío para usarlo.` : f.tipo === 'compra' ? 'Costo total de la compra.' : undefined}>
          <input type="number" step="0.1" value={f.monto} onChange={set('monto')} className={inputCls} placeholder={montoSugerido ? String(montoSugerido) : '0'} />
        </Campo>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} submitLabel="Registrar" />
      </form>
    </Modal>
  )
}

export default function Kardex() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const [movOpen, setMovOpen] = useState(false)
  const productos = useProductos(sedeId)
  const movs = useMovimientosInventario(sedeId)

  const bajos = (productos.data || []).filter((p) => p.bajo).length
  const ventasHoy = (movs.data || []).filter((m) => m.tipo === 'venta' && new Date(m.fecha).toDateString() === new Date().toDateString())
    .reduce((n, m) => n + Number(m.monto || 0), 0)

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
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

      <div className="mt-5 grid grid-cols-3 gap-[15px]">
        <StatCard label="Productos en inventario" value={productos.data?.length ?? 0} />
        <StatCard label="Con stock bajo" value={bajos} variant={bajos ? 'danger' : 'default'} />
        <StatCard label="Ventas de hoy" value={money(ventasHoy, moneda)} />
      </div>

      {productos.isLoading && <LoadingState variant="table" rows={5} />}
      {productos.error && <ErrorState error={productos.error} onRetry={productos.refetch} />}
      {!productos.isLoading && (productos.data || []).length === 0 && <EmptyState message="Sin productos en esta sede." />}

      {(productos.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-hidden">
          <div className="grid grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1.1fr] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Producto</div><div>Categoría</div><div>Stock</div><div>Precio</div><div>Estado</div>
          </div>
          {productos.data.map((k) => (
            <div key={k.id} className="grid grid-cols-[2.2fr_1.2fr_0.8fr_0.8fr_1.1fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="text-[13.5px] font-extrabold">{k.nombre}</div>
              <div className="text-[12.5px] font-bold text-muted">{k.categoria}</div>
              <div className="text-[13px] font-extrabold" style={{ color: k.bajo ? T.danger : T.navy }}>{k.stock} uds.</div>
              <div className="text-[13px] font-bold">{money(k.precio, moneda)}</div>
              <div><Badge bg={k.bajo ? T.dangerBg : T.successBg} color={k.bajo ? T.danger : T.success}>{k.bajo ? 'Stock bajo' : 'OK'}</Badge></div>
            </div>
          ))}
        </Card>
      )}

      {(movs.data || []).length > 0 && (
        <Card className="mt-[15px] overflow-hidden">
          <div className="px-5 py-4"><div className="text-[14.5px] font-extrabold">Movimientos recientes</div></div>
          <div className="grid grid-cols-[0.9fr_2fr_1.1fr_0.9fr] items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Fecha</div><div>Producto</div><div>Movimiento</div><div>Monto</div>
          </div>
          {movs.data.map((m) => (
            <div key={m.id} className="grid grid-cols-[0.9fr_2fr_1.1fr_0.9fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="text-[12.5px] font-bold text-muted">{new Date(m.fecha).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' })}</div>
              <div className="text-[13.5px] font-extrabold">{m.producto?.nombre}</div>
              <div><Badge bg={m.tipo === 'venta' ? T.successBg : T.chipNavy} color={m.tipo === 'venta' ? T.success : T.navy} className="capitalize">{m.tipo}</Badge></div>
              <div className="text-[13px] font-extrabold" style={{ color: m.tipo === 'venta' ? T.success : T.danger }}>{money(m.monto, moneda)}</div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
