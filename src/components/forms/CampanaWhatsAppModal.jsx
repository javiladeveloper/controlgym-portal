import { useMemo, useState } from 'react'
import Modal, { Campo, inputCls } from '../Modal.jsx'
import { useClientes } from '../../hooks/useClientes.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { waLink } from '../../lib/whatsapp.js'
import { WhatsAppIcon } from '../icons.jsx'

// Campaña de WhatsApp semi-automática: eliges el segmento, personalizas el
// mensaje ({nombre} y {gym} se reemplazan solos) y vas abriendo chat por chat
// con un clic. Sin API de pago ni riesgo de baneo: cada envío lo confirmas tú.
// (La versión con API oficial de Meta — envío masivo real pagado por el gym —
// se montará sobre estos mismos segmentos.)

const SEGMENTOS = [
  ['vencidos', '🔴 Vencidos (recuperarlos)', (c, m) => m && m.estado === 'vencida' && c.estado === 'activo'],
  ['por_vencer', '🟠 Por vencer en 7 días', (c, m) => m && m.estado === 'activa' && m.fecha_fin && (new Date(m.fecha_fin) - Date.now()) / 86400000 <= 7 && new Date(m.fecha_fin) >= new Date()],
  ['activos', '🟢 Todos los activos', (c, m) => c.estado === 'activo'],
  ['de_baja', '⚪ Dados de baja (reactivar)', (c) => c.estado === 'inactivo'],
]

const PLANTILLAS = {
  vencidos: 'Hola {nombre}! 👋 Te extrañamos en {gym} 💪 Tu membresía venció y queremos verte de vuelta: este mes tenemos promos para ti. ¿Te contamos?',
  por_vencer: 'Hola {nombre}! Te escribimos de {gym} 🗓 Tu membresía está por vencer — renuévala esta semana y sigue sin cortes 💪',
  activos: 'Hola {nombre}! 📣 Novedades en {gym}: [escribe aquí tu anuncio]',
  de_baja: 'Hola {nombre}! Somos {gym} 🙌 Hace tiempo no te vemos y queremos que vuelvas: tenemos una promo especial de regreso. ¿Te interesa?',
}

export default function CampanaWhatsAppModal({ sedeId, onClose }) {
  const { empresa } = useAuth()
  const clientes = useClientes(sedeId)
  const [segmento, setSegmento] = useState('vencidos')
  const [mensaje, setMensaje] = useState(PLANTILLAS.vencidos)
  const [enviados, setEnviados] = useState(new Set())

  const lista = useMemo(() => {
    const regla = SEGMENTOS.find(([k]) => k === segmento)?.[2]
    return (clientes.data || [])
      .filter((c) => c.telefono && regla?.(c, c.membresia?.[0]))
  }, [clientes.data, segmento])

  const armar = (c) =>
    mensaje.replaceAll('{nombre}', (c.nombre || '').split(' ')[0]).replaceAll('{gym}', empresa?.nombre || 'tu gym')

  const pendiente = lista.find((c) => !enviados.has(c.id))

  return (
    <Modal title="📣 Campaña por WhatsApp" subtitle="Un clic por persona: tú confirmas cada envío (sin riesgo de baneo)" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3.5">
        <Campo label="¿A quiénes?">
          <select value={segmento}
            onChange={(e) => { setSegmento(e.target.value); setMensaje(PLANTILLAS[e.target.value]); setEnviados(new Set()) }}
            className={inputCls + ' cursor-pointer'}>
            {SEGMENTOS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Campo>
        <Campo label="Mensaje" hint="{nombre} y {gym} se reemplazan solos para cada persona.">
          <textarea rows={3} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className={inputCls + ' resize-none'} />
        </Campo>

        <div className="flex items-center justify-between rounded-[10px] bg-surface px-3.5 py-2.5">
          <span className="text-[13px] font-extrabold">{lista.length} personas con teléfono</span>
          <span className="text-[12.5px] font-bold text-muted">enviados: {enviados.size}/{lista.length}</span>
        </div>

        {/* El grande: abre el chat del siguiente pendiente y lo marca */}
        {pendiente ? (
          <a href={waLink(pendiente.telefono, armar(pendiente))} target="_blank" rel="noreferrer"
            onClick={() => setEnviados((s) => new Set([...s, pendiente.id]))}
            className="flex items-center justify-center gap-2 rounded-[11px] border-none py-3 text-[14px] font-extrabold text-white"
            style={{ background: '#1DA851' }}>
            <WhatsAppIcon size={17} /> Enviar a {pendiente.nombre.split(' ')[0]} → ({enviados.size + 1} de {lista.length})
          </a>
        ) : lista.length > 0 ? (
          <div className="rounded-[11px] bg-green-50 py-3 text-center text-[14px] font-extrabold text-green-600">
            🎉 Campaña completada — {lista.length} mensajes
          </div>
        ) : (
          <div className="rounded-[11px] bg-surface py-3 text-center text-[13px] font-bold text-muted">
            No hay nadie en este segmento con teléfono registrado.
          </div>
        )}

        {/* Lista con estado, por si quiere saltar o repetir alguno */}
        {lista.length > 0 && (
          <div className="max-h-[180px] overflow-y-auto rounded-[10px] border border-line">
            {lista.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-line2 px-3 py-1.5 last:border-0">
                <span className={`text-[12.5px] font-bold ${enviados.has(c.id) ? 'text-faint line-through' : ''}`}>{c.nombre}</span>
                <a href={waLink(c.telefono, armar(c))} target="_blank" rel="noreferrer"
                  onClick={() => setEnviados((s) => new Set([...s, c.id]))}
                  className="text-[11.5px] font-extrabold" style={{ color: '#1DA851' }}>
                  {enviados.has(c.id) ? '✓ enviado · repetir' : 'abrir chat'}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
