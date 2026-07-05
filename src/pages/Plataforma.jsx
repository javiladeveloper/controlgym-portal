import { useQuery } from '@tanstack/react-query'
import { Card, StatCard, Badge } from '../components/ui.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { money } from '../lib/uiHelpers.js'
import { urlPublica } from '../lib/tenant.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// Dashboard global de FitCore: solo para el dueño de la plataforma.
function usePlataforma() {
  return useQuery({
    queryKey: ['plataforma-dashboard'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_plataforma_dashboard')
      if (error) throw error
      return data
    },
  })
}

const CAT_COLOR = {
  'Fitness / Adultos': { bg: T.primaryBg, color: T.primary },
  'Niños': { bg: T.chipNavy, color: T.navy },
  'Solo clases': { bg: T.successBg, color: T.success },
}

export default function Plataforma() {
  const { usuario } = useAuth()
  const { data, isLoading, error, refetch } = usePlataforma()
  const k = data?.kpis || {}
  const empresas = data?.empresas || []

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy text-[16px]">⚡</div>
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">FitCore · Dashboard global</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">
            Hola {usuario?.nombre?.split(' ')[0]} — así va tu plataforma hoy.
          </p>
        </div>
      </div>

      {isLoading && <LoadingState variant="kpis" />}
      {error && <ErrorState error={error} onRetry={refetch} />}

      {data && (
        <>
          {/* KPIs de la plataforma */}
          <div className="mt-[22px] grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
            <StatCard label="Gimnasios registrados" value={k.empresas ?? 0}
              delta={k.empresas_mes ? `+${k.empresas_mes} este mes` : 'sin nuevos este mes'}
              deltaColor={k.empresas_mes ? T.success : undefined} />
            <StatCard label="Sedes activas" value={k.sedes ?? 0} />
            <StatCard label="Socios en la plataforma" value={k.socios ?? 0}
              delta={k.socios_mes ? `+${k.socios_mes} este mes` : ' '} deltaColor={T.success} />
            <StatCard label="Check-ins hoy" value={k.checkins_hoy ?? 0} delta="en todos los gyms" variant="accent" />
          </div>
          {/* Facturación de FitCore */}
          <div className="mt-[15px] grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
            <div className="rounded-card border border-line bg-navy p-[17px]">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-faint">MRR (suscripciones activas)</div>
              <div className="mt-1.5 text-[27px] font-extrabold text-white">{money(k.mrr, 'PEN')}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-faint">
                {k.suscripciones_activas ?? 0} pagando · potencial {money(k.mrr_potencial, 'PEN')}
              </div>
            </div>
            <StatCard label="Cobrado este mes" value={money(k.cobrado_mes, 'PEN')} delta="vía Culqi" deltaColor={T.success} />
            <StatCard label="En prueba gratis" value={k.en_prueba ?? 0}
              delta={k.con_problemas ? `${k.con_problemas} con pago pendiente/vencido` : 'sin problemas de pago'}
              deltaColor={k.con_problemas ? T.danger : T.success} />
            <div className="rounded-card border border-line bg-white p-[17px]">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">Volumen de los gyms (mes)</div>
              <div className="mt-1.5 text-[27px] font-extrabold text-green">{money(k.ingresos_gyms_mes, 'PEN')}</div>
              <div className="mt-0.5 text-[12px] font-semibold text-muted">base para comisión online futura</div>
            </div>
          </div>

          {/* Tabla de gimnasios */}
          <Card className="mt-[15px] overflow-x-auto">
            <div className="px-5 py-4">
              <div className="text-[14.5px] font-extrabold">Gimnasios</div>
              <div className="mt-0.5 text-[12px] font-semibold text-muted">Todos los clientes de la plataforma, del más reciente al más antiguo.</div>
            </div>
            <div className="grid min-w-[660px] grid-cols-[1.8fr_1fr_1.1fr_0.7fr_0.8fr_1fr_1fr] items-center gap-3 bg-surface px-5 py-[11px] text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">
              <div>Gimnasio</div><div>Categoría</div><div>Plan / Estado</div><div>Socios</div><div>Leads mes</div><div>Ingresos mes</div><div>Página</div>
            </div>
            {empresas.map((e) => {
              const cat = CAT_COLOR[e.categoria] || { bg: T.surface, color: T.muted }
              return (
                <div key={e.id} className="grid min-w-[660px] grid-cols-[1.8fr_1fr_1.1fr_0.7fr_0.8fr_1fr_1fr] items-center gap-3 border-t border-line2 px-5 py-3 hover:bg-[#FAFBFC]">
                  <div>
                    <div className="text-[13.5px] font-extrabold">{e.nombre}</div>
                    <div className="text-[11px] font-semibold text-muted">
                      {e.slug}.fitcorecenter.com · {e.sedes} {e.sedes === 1 ? 'sede' : 'sedes'} · desde {new Date(e.created_at).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </div>
                  </div>
                  <div><Badge bg={cat.bg} color={cat.color}>{e.categoria}</Badge></div>
                  <div>
                    <div className="text-[12.5px] font-extrabold capitalize">{e.plan || '—'}{e.plan_con_app ? ' 📱' : ''}</div>
                    <div className="text-[10.5px] font-bold" style={{
                      color: e.suscripcion_estado === 'activa' ? T.success
                        : e.suscripcion_estado === 'prueba' ? T.muted : T.danger,
                    }}>
                      {e.suscripcion_estado === 'activa' ? `✓ paga ${money(e.suscripcion_monto, 'PEN')}`
                        : e.suscripcion_estado === 'prueba' ? `prueba hasta ${e.trial_hasta ? new Date(e.trial_hasta).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : '—'}`
                        : e.suscripcion_estado || 'sin suscripción'}
                    </div>
                  </div>
                  <div className="text-[13px] font-extrabold">{e.socios}</div>
                  <div className="text-[13px] font-bold" style={{ color: e.leads_mes > 0 ? T.success : T.faint }}>{e.leads_mes}</div>
                  <div className="text-[13px] font-extrabold">{money(e.ingresos_mes, 'PEN')}</div>
                  <div>
                    {e.landing_activa ? (
                      <a href={urlPublica(e.slug)} target="_blank" rel="noreferrer"
                        className="text-[12px] font-extrabold text-orange hover:underline">Ver página →</a>
                    ) : (
                      <span className="text-[11.5px] font-bold text-faint">desactivada</span>
                    )}
                  </div>
                </div>
              )
            })}
            {empresas.length === 0 && (
              <div className="border-t border-line2 px-5 py-8 text-center text-[13px] font-semibold text-muted">Aún no hay gimnasios registrados.</div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
