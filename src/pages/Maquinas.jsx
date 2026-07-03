import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { usePanel } from '../store.jsx'
import { useMaquinas, useMantenimientos } from '../hooks/useOperaciones.js'
import { maquinaEstado } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

export default function Maquinas() {
  const { sedeId, sedeNombre } = usePanel()
  const maquinas = useMaquinas(sedeId)
  const mant = useMantenimientos(sedeId)

  const data = maquinas.data || []
  const operativas = data.filter((m) => m.estado === 'operativa').length
  const enMant = data.filter((m) => m.estado === 'mantenimiento').length
  const fuera = data.filter((m) => m.estado === 'fuera_servicio').length

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Máquinas</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Equipos, estado y mantenimientos · {sedeNombre}</p>
        </div>
        <button className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Programar mantenimiento</button>
      </div>

      <div className="mt-5 grid grid-cols-4 gap-[15px]">
        <StatCard label="Total de equipos" value={data.length} />
        <StatCard label="Operativas" value={operativas} delta=" " deltaColor={T.success} />
        <StatCard label="En mantenimiento" value={enMant} variant={enMant ? 'accent' : 'default'} />
        <StatCard label="Fuera de servicio" value={fuera} variant={fuera ? 'danger' : 'default'} />
      </div>

      {maquinas.isLoading && <LoadingState variant="table" rows={5} />}
      {maquinas.error && <ErrorState error={maquinas.error} onRetry={maquinas.refetch} />}
      {!maquinas.isLoading && data.length === 0 && <EmptyState message="Sin equipos registrados en esta sede." />}

      {data.length > 0 && (
        <div className="mt-[15px] grid grid-cols-[1.7fr_1fr] items-start gap-[15px]">
          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1.9fr_0.9fr_1.2fr] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
              <div>Equipo</div><div>Zona</div><div>Estado</div>
            </div>
            {data.map((mq) => {
              const est = maquinaEstado(mq.estado)
              return (
                <div key={mq.id} className="grid grid-cols-[1.9fr_0.9fr_1.2fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                  <div>
                    <div className="text-[13.5px] font-extrabold">{mq.nombre}</div>
                    <div className="text-[11.5px] font-semibold text-muted">{mq.detalle}</div>
                  </div>
                  <div className="text-[12.5px] font-bold text-muted">{mq.zona}</div>
                  <div><Badge bg={est.bg} color={est.color}>{est.label}</Badge></div>
                </div>
              )
            })}
          </Card>

          <Card className="p-[19px]">
            <div className="mb-1.5 text-[14.5px] font-extrabold">Próximos mantenimientos</div>
            {(mant.data || []).length === 0 && <div className="py-3 text-[12.5px] font-semibold text-muted">Nada programado.</div>}
            {(mant.data || []).map((pm) => (
              <div key={pm.id} className="flex items-center gap-3 border-b border-line2 py-[11px]">
                <div className="flex h-[44px] w-[44px] flex-shrink-0 flex-col items-center justify-center rounded-[11px] bg-orange-50 text-orange">
                  <div className="text-[15px] font-extrabold leading-none">
                    {pm.fecha_programada ? new Date(pm.fecha_programada).getDate() : '—'}
                  </div>
                  <div className="mt-0.5 text-[9px] font-extrabold uppercase">
                    {pm.fecha_programada ? new Date(pm.fecha_programada).toLocaleDateString('es-PE', { month: 'short' }) : ''}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[13px] font-extrabold">{pm.maquina?.nombre || 'General'}</div>
                  <div className="text-[11.5px] font-semibold text-muted capitalize">{pm.tipo} · {pm.detalle}</div>
                </div>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}
