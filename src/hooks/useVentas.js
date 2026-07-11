import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabaseClient.js'

// Dispara el worker de emisión al vuelo (best-effort, no bloquea la venta).
// Sin esto, la boleta de una venta de mostrador esperaría al cron diario:
// el disparo instantáneo solo existía para pagos in-app (webhook MP).
async function dispararEmision(data) {
  if (!data?.comprobante_id) return // gym no factura → no hay nada que emitir
  try {
    const jwt = (await supabase.auth.getSession()).data.session?.access_token
    fetch('/api/facturacion', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt}` },
    }).catch(() => {})
  } catch { /* la boleta igual sale con el cron de respaldo */ }
}

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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['kardex', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      dispararEmision(data)
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
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      dispararEmision(data)
    },
  })
}

// Cobro por pasarela en mostrador: crea la preferencia MP (cuenta del gym,
// -5% FitCore) y devuelve el link/QR. El webhook registra la venta al aprobarse.
export function useCrearPagoMostrador() {
  return useMutation({
    mutationFn: async ({ empresaId, tipo, items, refId, socioId, sedeId, cliente }) => {
      const body = {
        empresa_id: empresaId, tipo, sede_id: sedeId, canal: 'mostrador',
        ...(tipo === 'producto' ? { items } : { ref_id: refId, socio_id: socioId }),
        ...(cliente?.numDoc ? { nuevo: { nombre: cliente.nombre, documento: cliente.numDoc, email: cliente.email || null } } : {}),
      }
      const res = await fetch('/api/mp/crear-pago', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      const out = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(out.error || 'No se pudo crear el cobro')
      return out // { init_point, pago_id }
    },
  })
}

// Poll del estado mientras el modal QR está abierto (cada 4 s; se detiene al aprobar).
export function useEstadoPagoPos(pagoId) {
  return useQuery({
    queryKey: ['estado-pago-pos', pagoId],
    enabled: !!pagoId,
    refetchInterval: (q) => (q.state.data?.estado_pago === 'aprobado' ? false : 4000),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('estado_pago_pos', { p_pago_id: pagoId })
      if (error) throw error
      return data
    },
  })
}
