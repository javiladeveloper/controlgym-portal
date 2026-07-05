import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, Avatar } from './ui.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { iniciales } from '../lib/uiHelpers.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

const RANGOS = [
  ['7', 'Últimos 7 días'], ['30', 'Últimos 30 días'], ['90', 'Últimos 90 días'],
]

function useDesempeno(dias) {
  return useQuery({
    queryKey: ['desempeno-trainers', dias],
    queryFn: async () => {
      const hasta = new Date()
      const desde = new Date(); desde.setDate(desde.getDate() - Number(dias))
      const iso = (d) => d.toISOString().slice(0, 10)
      const { data, error } = await supabase.rpc('desempeno_trainers', {
        p_desde: iso(desde), p_hasta: iso(hasta),
      })
      if (error) throw error
      return data
    },
  })
}

const MEDALLA = ['🥇', '🥈', '🥉']

// Ranking de trainers por solicitudes atendidas (ayuda + subir carga) y
// rapidez — para que el admin reconozca/premie la eficiencia.
export default function DesempenoTrainers() {
  const [dias, setDias] = useState('30')
  const { data, isLoading } = useDesempeno(dias)

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14.5px] font-extrabold">🏅 Desempeño del equipo</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">
            Quién atendió las solicitudes de ayuda y de subir carga — para reconocer al más eficiente
          </div>
        </div>
        <select value={dias} onChange={(e) => setDias(e.target.value)}
          className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-1.5 text-[12.5px] font-bold outline-none focus:border-orange">
          {RANGOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      {isLoading && <div className="py-6 text-center text-[12.5px] font-semibold text-muted">Cargando…</div>}

      {!isLoading && (data || []).length === 0 && (
        <div className="mt-4 rounded-[10px] bg-surface px-4 py-6 text-center text-[12.5px] font-semibold text-muted">
          Aún no hay solicitudes atendidas en este período. Cuando tu equipo responda ayudas o pedidos de subir carga, el ranking aparece aquí.
        </div>
      )}

      {(data || []).length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">
                <th className="px-2 py-2 text-left">Trainer</th>
                <th className="px-2 py-2 text-center">Ayudas atendidas</th>
                <th className="px-2 py-2 text-center">Llegada prom.</th>
                <th className="px-2 py-2 text-center">Cargas respondidas</th>
                <th className="px-2 py-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t, i) => (
                <tr key={t.usuario_id} className="border-t border-line2">
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 text-center text-[13px]">{MEDALLA[i] || `${i + 1}.`}</span>
                      <Avatar ini={iniciales(t.nombre)} bg={T.chipNavy} color={T.navy} size={30} fontSize={11} />
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-extrabold">{t.nombre}</div>
                        <div className="text-[10.5px] font-bold capitalize text-faint">{t.rol}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-center text-[13px] font-extrabold">{t.ayudas_atendidas}</td>
                  <td className="px-2 py-2.5 text-center text-[12.5px] font-bold text-muted">
                    {t.ayuda_min_promedio != null ? `${t.ayuda_min_promedio} min` : '—'}
                  </td>
                  <td className="px-2 py-2.5 text-center text-[13px] font-bold">
                    {t.cargas_respondidas}
                    {t.cargas_aprobadas > 0 && <span className="ml-1 text-[10.5px] font-bold text-green-600">({t.cargas_aprobadas} ✓)</span>}
                  </td>
                  <td className="px-2 py-2.5 text-center">
                    <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-[12.5px] font-extrabold text-orange">{t.total_interacciones}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] font-semibold leading-[1.5] text-faint">
            "Llegada prom." = minutos promedio entre que el socio pide ayuda y el trainer la toma. Menos es mejor.
            Usa este ranking como base para tus bonos de productividad.
          </p>
        </div>
      )}
    </Card>
  )
}
