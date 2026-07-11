// Modal de cobro con MercadoPago desde el POS (mostrador): muestra el QR de
// la preferencia y hace poll del estado hasta que el webhook confirme el
// pago. El webhook es quien registra venta+stock+caja+comprobante — este
// modal solo observa y avisa al padre cuando ya está aprobado.
import { useEffect, useRef } from 'react'
import QRCode from 'react-qr-code'
import Modal from './Modal.jsx'
import { useEstadoPagoPos } from '../hooks/useVentas.js'
import { money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

export default function CobroQrModal({ pagoId, initPoint, monto, moneda, telefono, gymNombre, onPagado, onClose }) {
  const estado = useEstadoPagoPos(pagoId)
  const aprobado = estado.data?.estado_pago === 'aprobado'
  const avisado = useRef(false)

  useEffect(() => {
    if (aprobado && !avisado.current) {
      avisado.current = true
      onPagado(estado.data)
    }
  }, [aprobado, estado.data, onPagado])

  function enviarPorWhatsapp() {
    const mensaje = `Paga tu compra aquí${gymNombre ? ` en ${gymNombre}` : ''}: ${initPoint}`
    const numero = telefono ? `51${telefono}` : ''
    window.open(`https://wa.me/${numero}?text=${encodeURIComponent(mensaje)}`, '_blank')
  }

  return (
    <Modal title="Cobro con MercadoPago" subtitle="El cliente escanea con su celular y paga con tarjeta o Yape" onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        <div className="text-[24px] font-extrabold text-orange">{money(monto, moneda)}</div>

        <div className="rounded-[14px] border border-line bg-white p-4">
          <QRCode value={initPoint || ''} size={210} />
        </div>

        <p className="text-center text-[12.5px] font-semibold text-muted">
          El cliente escanea con su celular y paga con tarjeta o Yape.
        </p>

        <button
          type="button"
          onClick={enviarPorWhatsapp}
          className="w-full cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-ink transition-colors hover:border-orange hover:text-orange"
        >
          📲 Enviar link por WhatsApp
        </button>

        <div
          className="w-full rounded-[10px] px-3.5 py-2.5 text-center text-[13px] font-extrabold"
          style={aprobado
            ? { background: T.successBg, color: T.successDark }
            : { background: T.warningBg, color: T.warning }}
        >
          {aprobado ? '✓ Pagado' : '⏳ Esperando el pago…'}
        </div>

        {!aprobado && (
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-[10px] border-none bg-transparent px-3 py-1.5 text-[12.5px] font-extrabold text-muted hover:text-ink"
          >
            Cancelar cobro
          </button>
        )}
      </div>
    </Modal>
  )
}
