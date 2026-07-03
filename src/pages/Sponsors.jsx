import { Card, Avatar } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useSponsors } from '../hooks/useOperaciones.js'
import { iniciales, money } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const ESTADO = {
  activo: { bg: T.successBg, color: T.success, label: 'Activo' },
  por_renovar: { bg: T.primaryBg, color: T.primary, label: 'Renovar' },
  inactivo: { bg: T.line2, color: T.muted, label: 'Inactivo' },
}

export default function Sponsors() {
  const { empresa } = useAuth()
  const moneda = empresa?.moneda || 'PEN'
  const { data, isLoading, error, refetch } = useSponsors()

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Sponsors</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Convenios y auspicios de {empresa?.nombre}</p>
        </div>
        <button className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nuevo convenio</button>
      </div>

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && (data || []).length === 0 && <EmptyState message="Sin convenios registrados." />}

      {(data || []).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-[15px]">
          {data.map((s) => {
            const est = ESTADO[s.estado] || ESTADO.activo
            return (
              <Card key={s.id} className="p-[19px]">
                <div className="flex items-center gap-3">
                  <Avatar ini={iniciales(s.nombre)} bg={T.chipNavy} color={T.navy} size={44} fontSize={15} />
                  <div className="flex-1">
                    <div className="text-[15px] font-extrabold">{s.nombre}</div>
                    <div className="text-[12px] font-semibold text-muted">{s.descripcion}</div>
                  </div>
                  <span className="rounded-full px-[11px] py-[5px] text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
                </div>
                <div className="mt-3.5 flex justify-between border-t border-line2 pt-[13px]">
                  <div className="text-[12.5px] font-bold text-muted">
                    Aporte: <span className="font-extrabold text-ink">{s.aporte_detalle || (s.aporte_monto ? money(s.aporte_monto, moneda) : '—')}</span>
                  </div>
                  <div className="text-[12.5px] font-bold text-muted">
                    {s.fecha_vencimiento ? `Vence: ${new Date(s.fecha_vencimiento).toLocaleDateString('es-PE', { month: 'short', year: 'numeric' })}` : ''}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
