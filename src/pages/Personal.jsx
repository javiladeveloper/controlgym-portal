import { Card, Avatar, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import { usePanel } from '../store.jsx'
import { usePersonal } from '../hooks/useOperaciones.js'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

export default function Personal() {
  const { sedeId, sedeNombre } = usePanel()
  const { data, isLoading, error, refetch } = usePersonal(sedeId)

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Personal</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">{sedeNombre} · {data?.length ?? 0} colaboradores</p>
        </div>
        <button className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Agregar colaborador</button>
      </div>

      {isLoading && <LoadingState variant="table" rows={5} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && !error && (data || []).length === 0 && <EmptyState message="No hay colaboradores asignados a esta sede." />}

      {(data || []).length > 0 && (
        <Card className="mt-[18px] overflow-hidden">
          <div className="grid grid-cols-[2.5fr_1.5fr_1fr] items-center gap-3 bg-surface px-5 py-[13px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
            <div>Colaborador</div><div>Teléfono</div><div>Estado</div>
          </div>
          {data.map((st) => (
            <div key={st.id} className="grid grid-cols-[2.5fr_1.5fr_1fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
              <div className="flex items-center gap-2.5">
                <Avatar ini={st.avatar_iniciales || iniciales(st.nombre)} bg={T.chipNavy} color={T.navy} size={34} fontSize={12} />
                <div className="text-[13.5px] font-extrabold">{st.nombre}</div>
              </div>
              <div className="text-[12.5px] font-semibold text-muted">{st.telefono || '—'}</div>
              <div><Badge bg={st.activo ? T.successBg : T.line2} color={st.activo ? T.success : T.muted}>{st.activo ? 'Activo' : 'Inactivo'}</Badge></div>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
