import { useState, useMemo, useEffect } from 'react'
import { Card, PrimaryButton, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useProductos, usePromociones } from '../hooks/useOperaciones.js'
import { useMembresias } from '../hooks/useMembresias.js'
import { useClientes } from '../hooks/useClientes.js'
import { useVenderCarrito, useCobrarMembresiaPos, useCrearPagoMostrador } from '../hooks/useVentas.js'
import CobroQrModal from '../components/CobroQrModal.jsx'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { money } from '../lib/uiHelpers.js'
import { toast } from '../lib/toast.js'
import { METODOS_PAGO } from '../lib/pagos.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// ── Buscador + grilla de productos: filtra por nombre, clic agrega al carrito ──
function BuscadorProductos({ sedeId, onAgregar, moneda }) {
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
                  <div className="flex-shrink-0 text-[13px] font-extrabold text-orange">{money(p.precio, moneda)}</div>
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

// ── Buscador de socio para la boleta: ya tenemos su DNI, nombre y correo ──
// (el correo llega solo si el socio entró con Google o lo dio al inscribirse).
// Un clic llena los datos del comprobante sin re-escribir nada.
function BuscadorSocioBoleta({ sedeId, onElegir }) {
  const clientes = useClientes(sedeId)
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return (clientes.data || [])
      .filter((s) => s.documento && (s.nombre?.toLowerCase().includes(q) || s.documento.includes(q)))
      .slice(0, 6)
  }, [clientes.data, busca])
  return (
    <div>
      <input value={busca} onChange={(e) => setBusca(e.target.value)}
        placeholder="🔍 ¿Es socio? Búscalo y sus datos se llenan solos" className={inputCls} />
      {filtrados.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {filtrados.map((s) => (
            <button key={s.id} type="button" onClick={() => { onElegir(s); setBusca('') }}
              className="flex cursor-pointer items-center justify-between rounded-[8px] border border-line bg-white px-3 py-2 text-left text-[12.5px] font-bold hover:border-orange">
              <span className="truncate">{s.nombre}</span>
              <span className="ml-2 flex-shrink-0 text-[11.5px] font-semibold text-muted">DNI {s.documento}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Buscador de socio + su membresía, con monto editable (abono/renovación) ──
function BuscadorMembresia({ sedeId, socioSel, onSeleccionar, monto, onMonto, moneda, onContextoPromo }) {
  const membresias = useMembresias(sedeId)
  const [busca, setBusca] = useState('')

  // ¿La promo con la que ENTRÓ sigue dando beneficio al renovar? (2×1 de por
  // vida, descuento por N meses, etc.) El motor decide según las reglas del
  // negocio; aquí solo proponemos el precio y explicamos por qué.
  const beneficio = useQuery({
    queryKey: ['promo-beneficio', socioSel?.id],
    enabled: !!socioSel?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('promo_beneficio_renovacion', { p_membresia_id: socioSel.id })
      if (error) throw error
      return data
    },
  })
  // Si el beneficio de origen ya no corre, se puede renovar con OTRA promo
  // vigente (individual: descuentos / precio especial).
  const promos = usePromociones()
  const promosRenovacion = (promos.data || []).filter((pr) =>
    pr.estado === 'activa' && ['descuento_pct', 'descuento_monto', 'precio_especial'].includes(pr.tipo))
  const [promoAlt, setPromoAlt] = useState('')
  const [renovarGrupo, setRenovarGrupo] = useState(true)

  // El botón "Cobrar" vive en el padre: le reportamos qué promo interviene
  // para que el cobro renueve al grupo y cuente el canje.
  useEffect(() => {
    if (!socioSel) { onContextoPromo?.(null); return }
    const b = beneficio.data
    onContextoPromo?.({
      conBeneficio: !!b?.aplica,
      renovarGrupo: !!b?.aplica && (b.grupo || []).length > 0 && renovarGrupo,
      promocionAlt: !b?.aplica && promoAlt ? promoAlt : null,
      grupoNombres: b?.aplica ? (b.grupo || []).map((g) => g.nombre) : [],
    })
  }, [socioSel, beneficio.data, promoAlt, renovarGrupo]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill del monto cuando el beneficio aplica (solo si el usuario no lo tocó)
  useEffect(() => {
    const b = beneficio.data
    if (b?.aplica && b.precio_sugerido != null) onMonto(String(b.precio_sugerido))
  }, [beneficio.data]) // eslint-disable-line react-hooks/exhaustive-deps

  function aplicarPromoAlt(id) {
    setPromoAlt(id)
    const pr = promosRenovacion.find((x) => x.id === id)
    const base = Number(socioSel?.plan?.precio || 0)
    if (!pr) { onMonto(String(base)); return }
    let precio = base
    if (pr.tipo === 'descuento_pct') precio = Math.round(base * (1 - Number(pr.valor || 0) / 100) * 100) / 100
    else if (pr.tipo === 'descuento_monto') precio = Math.max(0, base - Number(pr.valor || 0))
    else if (pr.tipo === 'precio_especial') precio = Number(pr.valor || base)
    onMonto(String(precio))
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    const lista = membresias.data || []
    // Sin busqueda NO se queda en blanco ("no sale nada"): muestra los que
    // vencen primero — los que con mas probabilidad vienen a renovar.
    if (!q) {
      return [...lista]
        .sort((a, b) => new Date(a.fecha_fin || 8e15) - new Date(b.fecha_fin || 8e15))
        .slice(0, 8)
    }
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
        {beneficio.data?.aplica && (
          <div className="mt-3 rounded-[10px] border border-green-200 bg-green-50 px-3.5 py-2.5">
            <div className="text-[12.5px] font-extrabold text-green-700">
              🎁 {beneficio.data.promo} sigue vigente ({beneficio.data.vigencia === 'permanente' ? 'de por vida mientras paguen' : 'dentro de la ventana'}) — cobra {money(beneficio.data.precio_sugerido, moneda)}
            </div>
            {beneficio.data.nota && <div className="mt-0.5 text-[11.5px] font-semibold text-green-700/80">{beneficio.data.nota}</div>}
            {(beneficio.data.grupo || []).length > 0 && (
              <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12px] font-extrabold text-green-700">
                <input type="checkbox" checked={renovarGrupo} onChange={(e) => setRenovarGrupo(e.target.checked)} className="accent-green-600" />
                Renovar también a {(beneficio.data.grupo || []).map((g) => g.nombre).join(' y ')} con este cobro (monto 0)
              </label>
            )}
          </div>
        )}
        {beneficio.data && !beneficio.data.aplica && ['beneficio_vencido', 'beneficio_roto'].includes(beneficio.data.motivo) && (
          <div className="mt-3 rounded-[10px] bg-amber-50 px-3.5 py-2 text-[11.5px] font-bold text-amber-800">
            {beneficio.data.motivo === 'beneficio_roto'
              ? `La promo "${beneficio.data.promo}" se perdió (dejaron de pagar juntos) — renueva a precio normal o con una promo vigente.`
              : `El beneficio de "${beneficio.data.promo}" ya venció — renueva a precio normal o con una promo vigente.`}
          </div>
        )}
        {!beneficio.data?.aplica && promosRenovacion.length > 0 && (
          <label className="mt-3 block">
            <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Aplicar promo vigente (opcional)</span>
            <select value={promoAlt} onChange={(e) => aplicarPromoAlt(e.target.value)} className={inputCls + ' cursor-pointer'}>
              <option value="">Sin promoción — precio normal</option>
              {promosRenovacion.map((pr) => <option key={pr.id} value={pr.id}>{pr.nombre}</option>)}
            </select>
          </label>
        )}
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
        {!busca && filtradas.length > 0 && (
          <div className="mt-2 mb-1 text-[11px] font-extrabold uppercase tracking-[0.5px] text-muted">Vencen pronto — clic para cobrar su renovación</div>
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
  const [promoCtx, setPromoCtx] = useState(null) // qué promo interviene en esta renovación
  const [montoMembresia, setMontoMembresia] = useState('')
  const [metodoPago, setMetodoPago] = useState('efectivo')
  const [comprobanteOpen, setComprobanteOpen] = useState(false)
  const [tipoDoc, setTipoDoc] = useState('0') // '0' boleta simple, '1' DNI, '6' RUC
  const [numDoc, setNumDoc] = useState('')
  const [nombreCliente, setNombreCliente] = useState('')
  const [emailCliente, setEmailCliente] = useState('')
  const [resultado, setResultado] = useState(null) // {total, comprobanteId} tras un cobro exitoso
  const [cobroMp, setCobroMp] = useState(null) // {pagoId, initPoint, monto} mientras el modal QR está abierto

  const qc = useQueryClient()
  const venderCarrito = useVenderCarrito(sedeId)
  const cobrarMembresia = useCobrarMembresiaPos(sedeId)
  const crearPagoMostrador = useCrearPagoMostrador()

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
  const busy = venderCarrito.isPending || cobrarMembresia.isPending || crearPagoMostrador.isPending

  // MercadoPago cobra el monto que decide el backend (precio del plan, server-side).
  // Si el usuario editó el monto de la membresía (abono parcial), ese monto
  // custom no viaja al backend de MP hoy — se deshabilita el chip y se avisa.
  const precioPlanMembresia = Number(membresiaSel?.plan?.precio ?? 0)
  const montoMembresiaEditado = modo === 'membresia' && Number(montoMembresia || 0) !== precioPlanMembresia
  // Factura (RUC) tampoco viaja por MP hoy: se emite cobrando en el POS.
  const esFactura = tipoDoc === '6'
  const mpDisponible = (modo === 'producto' || !montoMembresiaEditado) && !esFactura

  // Si el usuario edita el monto de la membresía (o cambia de socio) mientras
  // MercadoPago está seleccionado, el chip deja de estar disponible: se
  // regresa a efectivo para no dejar un método inválido elegido en silencio.
  useEffect(() => {
    if (!mpDisponible && metodoPago === 'mercadopago') setMetodoPago('efectivo')
  }, [mpDisponible, metodoPago])

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

  function onCobroExitoso(data) {
    // vender_carrito devuelve `total`; cobrar_membresia_pos devuelve `cobrado`.
    // Se lee el monto real de la RPC (cualquiera de los dos) antes del fallback.
    const cobrado = data?.total ?? data?.cobrado ?? total
    toast.ok(`Cobrado ${money(cobrado, moneda)}`)
    setResultado({ total: cobrado, comprobanteId: data?.comprobante_id ?? null })
    limpiar()
  }

  function cobrar() {
    const cliente = armarCliente()
    if (metodoPago === 'mercadopago') {
      cobrarConMercadoPago(cliente)
      return
    }
    if (modo === 'producto') {
      const items = carrito.map((it) => ({ producto_id: it.producto.id, cantidad: it.cantidad }))
      venderCarrito.mutate({ items, metodoPago, cliente }, {
        onSuccess: onCobroExitoso,
        onError: (e) => toast.error('No se pudo cobrar: ' + e.message),
      })
    } else {
      cobrarMembresia.mutate({ membresiaId: membresiaSel.id, metodoPago, monto: total, cliente, promo: promoCtx }, {
        onSuccess: onCobroExitoso,
        onError: (e) => toast.error('No se pudo cobrar: ' + e.message),
      })
    }
  }

  // Cobro con MercadoPago: crea la preferencia (mostrador) y abre el modal QR.
  // El webhook es quien registra la venta al aprobarse el pago — este flujo
  // NUNCA llama a vender_carrito/cobrar_membresia_pos (sería doble venta).
  function cobrarConMercadoPago(cliente) {
    const payload = modo === 'producto'
      ? {
          empresaId: empresa.id, tipo: 'producto', sedeId, cliente,
          items: carrito.map((it) => ({ producto_id: it.producto.id, cantidad: it.cantidad })),
        }
      : {
          empresaId: empresa.id, tipo: 'membresia', sedeId, cliente,
          refId: membresiaSel.id, socioId: membresiaSel.socio?.id,
        }
    crearPagoMostrador.mutate(payload, {
      onSuccess: (data) => setCobroMp({ pagoId: data.pago_id, initPoint: data.init_point, monto: total }),
      onError: (e) => toast.error('No se pudo generar el cobro: ' + e.message),
    })
  }

  function onPagadoMp() {
    const cobrado = cobroMp?.monto ?? total
    qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    toast.ok(`Cobrado ${money(cobrado, moneda)}`)
    setResultado({ total: cobrado, comprobanteId: null, pagadoConMp: true })
    setCobroMp(null)
    limpiar()
  }

  function nuevaVenta() {
    setResultado(null)
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Ventas</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Punto de venta · {sedeNombre}</p>
        </div>
      </div>

      {resultado && (
        <Card className="mt-5 p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="text-[15px] font-extrabold text-green">✓ Cobrado {money(resultado.total, moneda)}</div>
            {resultado.comprobanteId ? (
              <div className="flex flex-col items-center gap-1.5">
                <Badge bg={T.warningBg} color={T.warning}>Boleta pendiente</Badge>
                <p className="text-[12.5px] font-semibold text-muted">Boleta en proceso — llegará por correo.</p>
              </div>
            ) : null}
            {resultado.pagadoConMp ? (
              <div className="flex flex-col items-center gap-1.5">
                <Badge bg={T.warningBg} color={T.warning}>Boleta en proceso</Badge>
                <p className="text-[12.5px] font-semibold text-muted">Pago confirmado por MercadoPago — la boleta llegará por correo.</p>
              </div>
            ) : null}
            <button type="button" onClick={nuevaVenta}
              className="mt-2 cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">
              Nueva venta
            </button>
          </div>
        </Card>
      )}

      {!resultado && (
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
        {/* ── Columna izquierda: cobro ───────────────────────────────── */}
        <Card className="p-5">
          {/* Toggle Producto | Renovación de membresía (el POS cobra, no gestiona) */}
          <div className="flex gap-2">
            <button type="button" onClick={() => cambiarModo('producto')}
              className={`flex-1 cursor-pointer rounded-[10px] border-none py-2.5 text-[13px] font-extrabold transition-colors ${modo === 'producto' ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
              Producto
            </button>
            <button type="button" onClick={() => cambiarModo('membresia')}
              className={`flex-1 cursor-pointer rounded-[10px] border-none py-2.5 text-[13px] font-extrabold transition-colors ${modo === 'membresia' ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
              Renovación de membresía
            </button>
          </div>

          <div className="mt-4">
            {modo === 'producto' ? (
              <>
                <BuscadorProductos sedeId={sedeId} onAgregar={agregarProducto} moneda={moneda} />
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
                onContextoPromo={setPromoCtx}
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
                <button type="button" disabled={!mpDisponible}
                  onClick={() => mpDisponible && setMetodoPago('mercadopago')}
                  title={esFactura ? 'Las facturas se emiten cobrando en el POS (efectivo/tarjeta); por MercadoPago solo boleta.' : (!mpDisponible ? 'Por MercadoPago se cobra el precio del plan completo' : undefined)}
                  className={`cursor-pointer rounded-full border-none px-3 py-1.5 text-[11.5px] font-extrabold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${metodoPago === 'mercadopago' ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
                  📲 MercadoPago
                </button>
              </div>
              {!mpDisponible && (
                <p className="mt-1.5 text-[11px] font-semibold text-faint">
                  {esFactura
                    ? 'Las facturas se emiten cobrando en el POS (efectivo/tarjeta); por MercadoPago solo boleta.'
                    : `Por MercadoPago se cobra el precio del plan completo (${money(precioPlanMembresia, moneda)}).`}
                </p>
              )}
            </div>

            {/* Bloque colapsable: boleta con datos / factura */}
            <div className="mt-4">
              <button type="button" onClick={() => {
                const abre = !comprobanteOpen
                // Si se está cobrando la membresía de un socio, sus datos ya los
                // tenemos (DNI/nombre/correo del padrón): se precargan al abrir.
                // El usuario puede cambiarlos (p. ej. si la boleta va a otro nombre).
                if (abre && modo === 'membresia' && membresiaSel?.socio?.documento && !numDoc) {
                  setTipoDoc('1')
                  setNumDoc(membresiaSel.socio.documento)
                  setNombreCliente(membresiaSel.socio.nombre || '')
                  setEmailCliente(membresiaSel.socio.email || '')
                }
                setComprobanteOpen(abre)
              }}
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
                  {tipoDoc === '1' && (
                    <BuscadorSocioBoleta sedeId={sedeId} onElegir={(s) => {
                      setNumDoc(s.documento || '')
                      setNombreCliente(s.nombre || '')
                      setEmailCliente(s.email || '')
                    }} />
                  )}
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
              {busy
                ? (metodoPago === 'mercadopago' ? 'Generando cobro…' : 'Cobrando…')
                : (metodoPago === 'mercadopago' ? `Generar QR ${money(total, moneda)}` : `Cobrar ${money(total, moneda)}`)}
            </PrimaryButton>
          </Card>
        </div>
      </div>
      )}

      {cobroMp && (
        <CobroQrModal
          pagoId={cobroMp.pagoId}
          initPoint={cobroMp.initPoint}
          monto={cobroMp.monto}
          moneda={moneda}
          telefono={modo === 'membresia' ? membresiaSel?.socio?.telefono : undefined}
          gymNombre={empresa?.nombre}
          onPagado={onPagadoMp}
          onClose={() => setCobroMp(null)}
        />
      )}
    </div>
  )
}
