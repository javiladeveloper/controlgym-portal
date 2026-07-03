import { Card } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePromociones } from '../hooks/useOperaciones.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const ESTADO = {
  activa: { bg: T.successBg, color: T.success, label: 'Activa' },
  programada: { bg: T.chipNavy, color: T.navy, label: 'Programada' },
  finalizada: { bg: T.line2, color: T.muted, label: 'Finalizada' },
  pausada: { bg: T.primaryBg, color: T.primary, label: 'Pausada' },
}

export default function Promociones() {
  const { empresa } = useAuth()
  const { data, isLoading, error, refetch } = usePromociones()

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Promociones</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Campañas para captar y retener socios · {empresa?.nombre}</p>
        </div>
        <button className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nueva campaña</button>
      </div>

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && (data || []).length === 0 && <EmptyState message="Sin campañas registradas." />}

      {(data || []).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-[15px]">
          {data.map((pr) => {
            const est = ESTADO[pr.estado] || ESTADO.activa
            return (
              <Card key={pr.id} className="p-[19px] transition hover:border-orange">
                <div className="flex items-center justify-between gap-2.5">
                  <span className="rounded-full px-[11px] py-[5px] text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
                  <span className="text-[11.5px] font-bold text-faint">{pr.canal}</span>
                </div>
                <div className="mt-3 text-[16px] font-extrabold">{pr.nombre}</div>
                <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">{pr.descripcion}</div>
                <div className="mt-3.5 flex justify-between border-t border-line2 pt-[13px]">
                  <div className="text-[12px] font-bold text-muted">
                    {pr.fecha_inicio ? new Date(pr.fecha_inicio).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : 'Vigente'}
                  </div>
                  <div className="text-[12px] font-extrabold text-orange">{pr.canjes ? `${pr.canjes} canjes` : ''}</div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
