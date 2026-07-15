import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'

const EQUIPOS = ['assisted','band','barbell','body weight','bosu ball','cable','dumbbell','elliptical machine','ez barbell','hammer','kettlebell','leverage machine','medicine ball','olympic barbell','resistance band','roller','rope','skierg machine','sled machine','smith machine','stability ball','stationary bike','stepmill machine','tire','trap bar','upper body ergometer','weighted','wheel roller']

export default function TabEquipo() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const qc = useQueryClient()
  const [guardando, setGuardando] = useState(null)

  const disp = useQuery({
    queryKey: ['equipo-sede', sedeId],
    enabled: !!sedeId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('equipo_de_sede', { p_sede_id: sedeId })
      if (error) throw error
      return new Set(data || [])
    },
  })
  const marcados = disp.data || new Set()

  async function toggle(equipment) {
    setGuardando(equipment)
    const activo = marcados.has(equipment)
    try {
      if (activo) {
        await supabase.from('sede_equipo').delete().eq('empresa_id', empresa.id).eq('sede_id', sedeId).eq('equipment', equipment)
      } else {
        await supabase.from('sede_equipo').upsert({ sede_id: sedeId, empresa_id: empresa.id, equipment, disponible: true })
      }
      qc.invalidateQueries({ queryKey: ['equipo-sede', sedeId] })
    } catch (e) { toast.error(e.message) } finally { setGuardando(null) }
  }

  return (
    <div className="max-w-[760px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🏋️ Equipo de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">Marca el equipo que tiene esta sede. El catálogo de ejercicios y el generador de rutinas se limitarán a lo que puedes hacer aquí (los de peso corporal siempre están disponibles).</p>
        {disp.isLoading && <p className="mt-3 text-[13px] font-semibold text-faint">Cargando equipo…</p>}
        {!disp.isLoading && (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {EQUIPOS.map((eq) => {
              const on = marcados.has(eq)
              return (
                <button key={eq} onClick={() => toggle(eq)} disabled={guardando === eq}
                  className={`cursor-pointer rounded-[10px] border px-3 py-2 text-left text-[12.5px] font-extrabold transition-colors disabled:opacity-50 ${on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
                  {on ? '✓ ' : ''}{eq}
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
