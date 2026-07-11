import { useState, useMemo } from 'react'
import { Card, PrimaryButton } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { inputCls } from '../components/Modal.jsx'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useProductos } from '../hooks/useOperaciones.js'
import { useMembresias } from '../hooks/useMembresias.js'
import { useVenderCarrito, useCobrarMembresiaPos } from '../hooks/useVentas.js'
import { money } from '../lib/uiHelpers.js'
import { toast } from '../lib/toast.js'
import { METODOS_PAGO } from '../lib/pagos.js'

// ── Buscador + grilla de productos: filtra por nombre, clic agrega al carrito ──
function BuscadorProductos({ sedeId, onAgregar }) {
  const productos = useProductos(sedeId)
  const [busca, setBusca] = useState('')

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const lista = productos.data || []
    if (!q) return lista
    return lista.filter((p) => p.nombre?.toLowerCase().includes(q))
  }, [productos.data, busca])

  return (
    <div>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="🔍 Buscar producto por nombre…"
        className={inputCls}
        autoFocus
      />
      <div className="mt-3">
        {productos.isLoading && <LoadingState variant="table" rows={4} />}
        {productos.error && <ErrorState error={productos.error} onRetry={productos.refetch} />}
        {!productos.isLoading && !productos.error && filtrados.length === 0 && (
          <EmptyState icon="📦" message={busca ? `Sin resultados para "${busca}".` : 'No hay productos en el inventario de esta sede.'} />
        )}
        {filtrados.length > 0 && (
          <div className="mt-1 grid max-h-[420px] grid-cols-1 gap-2 overflow-y-auto pr-0.5 sm:grid-cols-2">
            {filtrados.map((p) => {
              const sinStock = Number(p.stock) <= 0
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={sinStock}
                  onClick={() => onAgregar(p)}
                  className="flex items-center gap-2.5 rounded-[10px] border border-line bg-white px-3 py-2.5 text-left transition-colors hover:border-orange disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-line bg-surface">
                    {p.imagen_url
                      ? <img src={p.imagen_url} alt="" className="h-full w-full object-cover" />
                      : <span className="text-[8px] font-bold text-faint">—</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-extrabold">{p.nombre}</div>
                    <div className="text-[11.5px] font-semibold text-muted">
                      {sinStock ? 'Sin stock' : `Stock: ${p.stock}`}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-[13px] font-extrabold text-orange">{money(p.precio, 'PEN')}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Carrito: lista de {producto, cantidad}, con +/− y quitar ──
function Carrito({ items, onCambiarCantidad, onQuitar, moneda }) {
  if (items.length === 0) {
    return (
      <div className="rounded-[10px] border border-dashed border-line px-4 py-8 text-center text-[12.5px] font-semibold text-muted">
        El carrito está vacío. Busca un producto y agrégalo.
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((it) => (
        <div key={it.producto.id} className="flex items-center gap-2.5 rounded-[10px] border border-line bg-white px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-extrabold">{it.producto.nombre}</div>
            <div className="text-[11.5px] font-semibold text-muted">{money(it.producto.precio, moneda)} c/u</div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1.5">
            <button type="button" onClick={() => onCambiarCantidad(it.producto.id, it.cantidad - 1)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-white text-[13px] font-extrabold text-muted hover:border-orange hover:text-orange">−</button>
            <span className="w-6 text-center text-[13px] font-extrabold">{it.cantidad}</span>
            <button type="button" onClick={() => onCambiarCantidad(it.producto.id, it.cantidad + 1)}
              disabled={it.cantidad >= Number(it.producto.stock)}
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] border border-line bg-white text-[13px] font-extrabold text-muted hover:border-orange hover:text-orange disabled:cursor-not-allowed disabled:opacity-40">+</button>
          </div>
          <div className="w-20 flex-shrink-0 text-right text-[13px] font-extrabold">{money(it.producto.precio * it.cantidad, moneda)}</div>
          <button type="button" onClick={() => onQuitar(it.producto.id)} title="Quitar del carrito"
            className="flex-shrink-0 cursor-pointer rounded-lg border-none bg-transparent px-1 text-[13px] text-faint hover:text-red">✕</button>
        </div>
      ))}
    </div>
  )
}

// ── Buscador de socio + su membresía, con monto editable (abono/renovación) ──
function BuscadorMembresia({ sedeId, socioSel, onSeleccionar, monto, onMonto, moneda }) {
  const membresias = useMembresias(sedeId)
  const [busca, setBusca] = useState('')

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const lista = membresias.data || []
    if (!q) return []
    return lista.filter((m) =>
      m.socio?.nombre?.toLowerCase().includes(q) || m.socio?.codigo?.toLowerCase?.().includes(q) || m.socio?.codigo?.includes(busca)
    ).slice(0, 8)
  }, [membresias.data, busca])

  if (socioSel) {
    return (
      <div>
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-3.5 py-3">
          <div className="min-w-0">
            <div className="text-[13.5px] font-extrabold">{socioSel.socio?.nombre}</div>
            <div className="text-[11.5px] font-semibold text-muted">
              Socio N.º {socioSel.socio?.codigo} · {socioSel.plan?.nombre || 'sin plan'}
            </div>
          </div>
          <button type="button" onClick={() => onSeleccionar(null)}
            className="flex-shrink-0 cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1.5 text-[11.5px] font-extrabold text-muted hover:border-orange hover:text-orange">
            Cambiar
          </button>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Monto a cobrar ({moneda})</span>
          <input type="number" min="0" step="0.01" value={monto} onChange={(e) => onMonto(e.target.value)} className={inputCls} />
          <span className="mt-1 block text-[11px] font-semibold text-faint">
            Por defecto el precio del plan. Cámbialo si el socio abona una parte.
          </span>
        </label>
      </div>
    )
  }

  return (
    <div>
      <input
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="🔍 Buscar socio por nombre o N.º…"
        className={inputCls}
        autoFocus
      />
      <div className="mt-2">
        {membresias.isLoading && <LoadingState variant="table" rows={3} />}
        {membresias.error && <ErrorState error={membresias.error} onRetry={membresias.refetch} />}
        {busca && !membresias.isLoading && filtradas.length === 0 && (
          <div className="rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-[12.5px] font-semibold text-muted">
            Sin resultados para "{busca}".
          </div>
        )}
        {filtradas.length > 0 && (
          <div className="mt-1 flex flex-col gap-1.5">
            {filtradas.map((m) => (
              <button key={m.id} type="button" onClick={() => onSeleccionar(m)}
                className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-left transition-colors hover:border-orange">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-extrabold">{m.socio?.nombre}</div>
                  <div className="text-[11.5px] font-semibold text-muted">Socio N.º {m.socio?.codigo} · {m.plan?.nombre}</div>
                </div>
                <div className="flex-shrink-0 text-[12.5px] font-extrabold text-orange">{money(m.plan?.precio, moneda)}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Ventas() {
  const { sedeId, sedeNombre } = usePanel()
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'

  const [modo, setModo] = useState('producto') // 'producto' | 'membresia'
  const [carrito, setCarrito] = useState([]) // [{producto, cantidad}]
  const [membresiaSel, setMembresiaSel] = useState(null)
  const [montoMembresia, setMontoMembresia] = useState('')
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [tipoDoc, setTipoDoc] = useState('0') // '0' boleta simple, '1' DNI, '6' RUC
  const [numDoc, setNumDoc] = useState('')
  const [nombreCliente, setNombreCliente] = useState('')
  const [emailCliente, setEmailCliente] = useState('')

  const venderCarrito = useVenderCarrito(sedeId)
  const cobrarMembresia = useCobrarMembresiaPos(sedeId)

  function agregarProducto(p) {
    setCarrito((prev) => {
      const existe = prev.find((it) => it.producto.id === p.id)
      if (existe) {
        if (existe.cantidad >= Number(p.stock)) return prev
        return prev.map((it) => it.producto.id === p.id ? { ...it, cantidad: it.cantidad + 1 } : it)
      }
      return [...prev, { producto: p, cantidad: 1 }]
    })
  }
  function cambiarCantidad(productoId, cantidad) {
    setCarrito((prev) => {
      if (cantidad <= 0) return prev.filter((it) => it.producto.id !== productoId)
      return prev.map((it) => it.producto.id === productoId
        ? { ...it, cantidad: Math.min(cantidad, Number(it.producto.stock)) }
        : it)
    })
  }
  function quitarDelCarrito(productoId) {
    setCarrito((prev) => prev.filter((it) => it.producto.id !== productoId))
  }
  function seleccionarMembresia(m) {
    setMembresiaSel(m)
    setMontoMembresia(m ? String(Number(m.precio_pagado) > 0 ? m.precio_pagado : (m.plan?.precio || 0)) : '')
  }
  function cambiarModo(nuevo) {
    setModo(nuevo)
  }

  const total = modo === 'producto'
    ? carrito.reduce((n, it) => n + Number(it.producto.precio) * it.cantidad, 0)
    : Math.max(0, Number(montoMembresia) || 0)
  const igv = total - total / 1.18

  const puedeCobrar = modo === 'producto' ? carrito.length > 0 : (!!membresiaSel && total > 0)
  const busy = venderCarrito.isPending || cobrarMembresia.isPending

  function limpiar() {
    setCarrito([])
    setMembresiaSel(null)
    setMontoMembresia('')
    setMetodoPago('efectivo')
    setComprobanteOpen(false)
    setTipoDoc('0')
    setNumDoc('')
    setNombreCliente('')
    setEmailCliente('')
  }

  function armarCliente() {
    if (tipoDoc === '0') return { tipoDoc: '0', nombre: 'CLIENTE VARIOS' }
    return { tipoDoc, numDoc: numDoc.trim(), nombre: nombreCliente.trim() || 'CLIENTE VARIOS', email: emailCliente.trim() || undefined }
  }

  function cobrar() {
    const cliente = armarCliente()
    if (modo === 'producto') {
      const items = carrito.map((it) => ({ producto_id: it.producto.id, cantidad: it.cantidad }))
      venderCarrito.mutate({ items, metodoPago, cliente }, {
        onSuccess: (data) => {
          toast.ok(`Cobrado ${money(data?.total ?? total, moneda)}${data?.comprobante_id ? ' — boleta generada' : ''}`)
          limpiar()
        },
        onError: (e) => toast.error('No se pudo cobrar: ' + e.message),
      })
    } else {
      cobrarMembresia.mutate({ membresiaId: membresiaSel.id, metodoPago, monto: total, cliente }, {
        onSuccess: (data) => {
          toast.ok(`Cobrado ${money(data?.total ?? total, moneda)}${data?.comprobante_id ? ' — boleta generada' : ''}`)
          limpiar()
        },
        onError: (e) => toast.error('No se pudo cobrar: ' + e.message),
      })
    }
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Ventas</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Punto de venta · {sedeNombre}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* ── Columna izquierda: cobro ───────────────────────────────── */}
        <Card className="p-5">
          {/* Toggle Producto | Membresía */}
          <div className="flex gap-2">
            <button type="button" onClick={() => cambiarModo('producto')}
              className={`flex-1 cursor-pointer rounded-[10px] border-none py-2.5 text-[13px] font-extrabold transition-colors ${modo === 'producto' ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
              Producto
            </button>
            <button type="button" onClick={() => cambiarModo('membresia')}
              className={`flex-1 cursor-pointer rounded-[10px] border-none py-2.5 text-[13px] font-extrabold transition-colors ${modo === 'membresia' ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
              Membresía
            </button>
          </div>

          <div className="mt-4">
            {modo === 'producto' ? (
              <>
                <BuscadorProductos sedeId={sedeId} onAgregar={agregarProducto} />
                <div className="mt-4 border-t border-line2 pt-4">
                  <div className="mb-2 text-[12.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Carrito</div>
                  <Carrito items={carrito} onCambiarCantidad={cambiarCantidad} onQuitar={quitarDelCarrito} moneda={moneda} />
                </div>
              </>
            ) : (
              <BuscadorMembresia
                sedeId={sedeId}
                socioSel={membresiaSel}
                onSeleccionar={seleccionarMembresia}
                monto={montoMembresia}
                onMonto={setMontoMembresia}
                moneda={moneda}
              />
            )}
          </div>
        </Card>

        {/* ── Columna derecha: resumen (sticky) ─────────────────────── */}
        <div className="lg:sticky lg:top-5 lg:self-start">
          <Card className="p-5">
            <div className="text-[14.5px] font-extrabold">Resumen</div>

            <div className="mt-3 flex flex-col gap-2">
              {modo === 'producto' ? (
                carrito.length === 0 ? (
                  <p className="text-[12px] font-semibold text-muted">Sin ítems todavía.</p>
                ) : carrito.map((it) => (
                  <div key={it.producto.id} className="flex items-center justify-between gap-2 text-[12.5px] font-bold">
                    <span className="min-w-0 truncate">{it.producto.nombre} ×{it.cantidad}</span>
                    <span className="flex-shrink-0">{money(it.producto.precio * it.cantidad, moneda)}</span>
                  </div>
                ))
              ) : membresiaSel ? (
                <div className="flex items-center justify-between gap-2 text-[12.5px] font-bold">
                  <span className="min-w-0 truncate">{membresiaSel.socio?.nombre} · {membresiaSel.plan?.nombre}</span>
                  <span className="flex-shrink-0">{money(total, moneda)}</span>
                </div>
              ) : (
                <p className="text-[12px] font-semibold text-muted">Selecciona un socio.</p>
              )}
            </div>

            <div className="mt-4 border-t border-line2 pt-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-extrabold">Total</span>
                <span className="text-[20px] font-extrabold text-orange">{money(total, moneda)}</span>
              </div>
              <div className="mt-0.5 text-right text-[11px] font-semibold text-faint">
                IGV incluido {money(igv, moneda)}
              </div>
            </div>

            {/* Método de pago */}
            <div className="mt-4">
              <div className="mb-1.5 text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Método de pago</div>
              <div className="flex flex-wrap gap-1.5">
                {METODOS_PAGO.map(([v, l]) => (
                  <button key={v} type="button" onClick={() => setMetodoPago(v)}
                    className={`cursor-pointer rounded-full border-none px-3 py-1.5 text-[11.5px] font-extrabold transition-colors ${metodoPago === v ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            {/* Bloque colapsable: boleta con datos / factura */}
            <div className="mt-4">
              <button type="button" onClick={() => setComprobanteOpen((v) => !v)}
                className="flex w-full cursor-pointer items-center justify-between rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[12.5px] font-extrabold text-muted hover:border-orange hover:text-orange">
                <span>¿Boleta con datos o factura?</span>
                <span>{comprobanteOpen ? '▲' : '▼'}</span>
              </button>
              {comprobanteOpen && (
                <div className="mt-2.5 flex flex-col gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-3">
                  <div className="flex gap-3">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold">
                      <input type="radio" name="tipoDoc" checked={tipoDoc === '1'} onChange={() => setTipoDoc('1')} />
                      Boleta con DNI
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] font-bold">
                      <input type="radio" name="tipoDoc" checked={tipoDoc === '6'} onChange={() => setTipoDoc('6')} />
                      Factura RUC
                    </label>
                  </div>
                  <input value={numDoc} onChange={(e) => setNumDoc(e.target.value)}
                    placeholder={tipoDoc === '6' ? 'RUC' : 'DNI'} className={inputCls} />
                  <input value={nombreCliente} onChange={(e) => setNombreCliente(e.target.value)}
                    placeholder={tipoDoc === '6' ? 'Razón social' : 'Nombre completo'} className={inputCls} />
                  <input value={emailCliente} onChange={(e) => setEmailCliente(e.target.value)} type="email"
                    placeholder="Email (opcional)" className={inputCls} />
                </div>
              )}
            </div>

            <PrimaryButton
              className="mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!puedeCobrar || busy}
              onClick={cobrar}
            >
              {busy ? 'Cobrando…' : `Cobrar ${money(total, moneda)}`}
            </PrimaryButton>
          </Card>
        </div>
      </div>
    </div>
  )
}
