import { useState } from 'react'
import { Card } from './ui.jsx'
import Modal from './Modal.jsx'
import { useRutinasPendientes, useResolverRutina } from '../hooks/useRutinasComunidad.js'
import { toast } from '../lib/toast.js'

/**
 * Bandeja para aprobar o rechazar las rutinas que los usuarios comparten con la
 * comunidad desde la app.
 *
 * OJO — HOY NO SE USA, Y ES A PROPÓSITO. Desde que el clasificador automático
 * pone el nivel (`clasificar_nivel_rutina`), `publicar_mi_rutina` deja la rutina
 * en estado 'aprobada' directamente: ya no hay cola de revisión y esta bandeja
 * sale siempre vacía. NO la borres pensando que es código muerto — el owner
 * decidió conservarla para cuando una rutina reportada 3 veces se retire sola y
 * haga falta un sitio donde revisarla antes de reactivarla.
 *
 * Vive en el Dashboard global (`Plataforma.jsx`), NO en la página de Rutinas:
 * moderar la biblioteca pública es una tarea del dueño de la plataforma, no de
 * los gimnasios. En Rutinas.jsx estaba mezclada con el trabajo diario del staff
 * de cada gym, que no tiene nada que ver con esto.
 *
 * Sin pendientes no pinta nada: una card vacía sería ruido permanente en una
 * pantalla que se mira todos los días.
 */
export default function RutinasComunidadPendientes() {
  const { data: pendientes = [], isLoading } = useRutinasPendientes()
  const resolver = useResolverRutina()
  const [rechazando, setRechazando] = useState(null) // rutina a la que se le pide el motivo

  if (isLoading || pendientes.length === 0) return null

  return (
    <Card className="mt-[18px] p-[19px]" style={{ borderLeft: '4px solid #FF6B35' }}>
      <div className="text-[14.5px] font-extrabold">
        🧩 Rutinas de la comunidad · {pendientes.length} por revisar
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-muted">
        Publicadas por usuarios de la app. Revísalas antes de que aparezcan en la biblioteca pública.
      </div>
      <div className="mt-3 flex flex-col gap-3">
        {pendientes.map((r) => (
          <div key={r.id} className="rounded-[10px] bg-surface px-3.5 py-3">
            <p className="text-[13.5px] font-extrabold text-ink">{r.nombre}</p>
            {r.descripcion && (
              <p className="mt-0.5 text-[12.5px] font-semibold text-muted">{r.descripcion}</p>
            )}
            <p className="mt-1 text-[11px] font-bold text-faint">
              por {r.autor} · {r.objetivo} · {r.dias_por_semana} días · {r.equipo}
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => resolver.mutate(
                  { id: r.id, aprobar: true },
                  { onError: (er) => toast.error(er.message) },
                )}
                disabled={resolver.isPending}
                className="cursor-pointer rounded-[9px] border-none bg-green px-3.5 py-2 text-[11.5px] font-extrabold text-white hover:bg-green-600 disabled:opacity-50">
                ✓ Aprobar
              </button>
              <button
                onClick={() => setRechazando(r)}
                disabled={resolver.isPending}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[11.5px] font-extrabold text-muted hover:border-red disabled:opacity-50">
                Rechazar
              </button>
            </div>
          </div>
        ))}
      </div>

      {rechazando && (
        <RechazarRutinaModal
          rutina={rechazando}
          busy={resolver.isPending}
          onClose={() => setRechazando(null)}
          onConfirmar={(motivo) => resolver.mutate(
            { id: rechazando.id, aprobar: false, motivo },
            {
              onSuccess: () => setRechazando(null),
              onError: (er) => toast.error(er.message),
            },
          )}
        />
      )}
    </Card>
  )
}

/** Pide el motivo del rechazo. Es obligatorio: sin él el autor no sabe qué corregir. */
function RechazarRutinaModal({ rutina, onClose, onConfirmar, busy }) {
  const [motivo, setMotivo] = useState('')
  return (
    <Modal title="Rechazar rutina" subtitle={`"${rutina.nombre}" — el autor verá este motivo`} onClose={onClose}>
      <textarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        placeholder="Ej.: los ejercicios no corresponden al objetivo indicado"
        className="w-full rounded-[10px] border border-line px-3 py-2 text-[13px] font-semibold outline-none focus:border-orange"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="cursor-pointer rounded-[9px] border border-line bg-white px-3.5 py-2 text-[12px] font-extrabold text-muted">
          Cancelar
        </button>
        <button
          onClick={() => onConfirmar(motivo.trim())}
          disabled={busy || motivo.trim().length < 5}
          className="cursor-pointer rounded-[9px] border-none bg-red px-3.5 py-2 text-[12px] font-extrabold text-white disabled:opacity-50">
          Rechazar
        </button>
      </div>
    </Modal>
  )
}
