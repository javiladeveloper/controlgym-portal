import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useProductos, useMovimientosInventario } from '../hooks/useOperaciones.js'
import { money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

export default function Kardex() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
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
        <button className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Registrar movimiento</button>
      </div>

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
