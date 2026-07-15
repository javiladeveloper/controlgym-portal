import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '../../components/ui.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'

// Los 28 tipos de equipo del catálogo. `codigo` (en inglés) es lo que se guarda
// en BD y casa con ejercicio_catalogo.equipment; `es` + `emoji` son solo para la
// UI (el gym peruano no entiende "leverage machine"). Ordenados por lo más común.
const EQUIPOS = [
  { codigo: 'body weight', es: 'Peso corporal', emoji: '🤸' },
  { codigo: 'dumbbell', es: 'Mancuernas', emoji: '🏋️' },
  { codigo: 'barbell', es: 'Barra', emoji: '🏋️‍♂️' },
  { codigo: 'ez barbell', es: 'Barra Z (EZ)', emoji: '💪' },
  { codigo: 'olympic barbell', es: 'Barra olímpica', emoji: '🥇' },
  { codigo: 'trap bar', es: 'Barra hexagonal', emoji: '⬡' },
  { codigo: 'cable', es: 'Poleas / cables', emoji: '🔗' },
  { codigo: 'smith machine', es: 'Máquina Smith', emoji: '🏗️' },
  { codigo: 'leverage machine', es: 'Máquina de palanca', emoji: '⚙️' },
  { codigo: 'kettlebell', es: 'Pesa rusa (kettlebell)', emoji: '🔔' },
  { codigo: 'band', es: 'Banda elástica', emoji: '➰' },
  { codigo: 'resistance band', es: 'Banda de resistencia', emoji: '🎗️' },
  { codigo: 'medicine ball', es: 'Balón medicinal', emoji: '⚽' },
  { codigo: 'stability ball', es: 'Pelota de estabilidad', emoji: '🟠' },
  { codigo: 'bosu ball', es: 'Bosu', emoji: '🔵' },
  { codigo: 'hammer', es: 'Martillo (hammer)', emoji: '🔨' },
  { codigo: 'weighted', es: 'Con lastre / peso extra', emoji: '⚖️' },
  { codigo: 'assisted', es: 'Asistido', emoji: '🤝' },
  { codigo: 'rope', es: 'Cuerda', emoji: '🪢' },
  { codigo: 'roller', es: 'Rodillo', emoji: '🧻' },
  { codigo: 'wheel roller', es: 'Rueda abdominal', emoji: '☸️' },
  { codigo: 'tire', es: 'Neumático', emoji: '🛞' },
  { codigo: 'sled machine', es: 'Trineo (sled)', emoji: '🛷' },
  { codigo: 'stationary bike', es: 'Bicicleta estática', emoji: '🚴' },
  { codigo: 'elliptical machine', es: 'Elíptica', emoji: '🏃' },
  { codigo: 'stepmill machine', es: 'Escaladora', emoji: '🪜' },
  { codigo: 'skierg machine', es: 'SkiErg', emoji: '⛷️' },
  { codigo: 'upper body ergometer', es: 'Ergómetro de brazos', emoji: '💺' },
]

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
              const on = marcados.has(eq.codigo)
              return (
                <button key={eq.codigo} onClick={() => toggle(eq.codigo)} disabled={guardando === eq.codigo}
                  className={`flex cursor-pointer items-center gap-2 rounded-[10px] border px-3 py-2.5 text-left text-[12.5px] font-extrabold transition-colors disabled:opacity-50 ${on ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
                  <span className="flex-shrink-0 text-[16px] leading-none">{eq.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">{eq.es}</span>
                  {on && <span className="flex-shrink-0 text-orange">✓</span>}
                </button>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
