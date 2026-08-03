import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { tokenDesdeRuta, diasOrdenados } from '../lib/compartir.js'

// Los mismos enlaces de tienda que usa el landing (PlataformaLanding.jsx).
const PLAY = 'https://play.google.com/store/apps/details?id=pe.fitcore.app'
const APPSTORE = 'https://apps.apple.com/pe/app/fitcore-gym/id6788892159'

/**
 * Página pública de una rutina compartida (`/r/<token>`). Se ve SIN sesión: es
 * el caso que la feature quiere captar — alguien recibe el enlace por WhatsApp,
 * no tiene la app, y aquí ve qué le compartieron y de dónde bajarla.
 */
export default function RutinaCompartida() {
  const [estado, setEstado] = useState({ cargando: true, error: null, datos: null })

  useEffect(() => {
    const token = tokenDesdeRuta(window.location.pathname)
    if (!token) {
      setEstado({ cargando: false, error: 'Este enlace no es válido.', datos: null })
      return
    }
    supabase.rpc('ver_rutina_compartida', { p_token: token }).then(({ data, error }) => {
      if (error) {
        setEstado({ cargando: false, error: 'Este enlace ya no está disponible.', datos: null })
      } else {
        setEstado({ cargando: false, error: null, datos: data })
      }
    })
  }, [])

  if (estado.cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0F1420] text-white">
        <p className="text-[14px] font-semibold opacity-70">Cargando rutina…</p>
      </div>
    )
  }

  if (estado.error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#0F1420] px-6 text-center text-white">
        <div className="text-[42px]">🔗</div>
        <h1 className="text-[20px] font-extrabold">{estado.error}</h1>
        <p className="max-w-[340px] text-[13.5px] font-semibold opacity-70">
          Puede que quien te lo compartió lo haya desactivado.
        </p>
        <a href="https://fitcorecenter.com"
          className="mt-2 rounded-xl bg-[#FF6B35] px-5 py-3 text-[14px] font-extrabold text-white">
          Conocer FitCore
        </a>
      </div>
    )
  }

  const { nombre, autor, contenido } = estado.datos
  const dias = diasOrdenados(contenido)

  return (
    <div className="min-h-screen bg-[#0F1420] px-5 py-8 text-white">
      <div className="mx-auto max-w-[560px]">
        <p className="text-[12px] font-bold uppercase tracking-wide opacity-60">
          Rutina compartida por {autor}
        </p>
        <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.5px]">{nombre}</h1>
        <p className="mt-1 text-[13px] font-semibold opacity-70">
          {dias.length} {dias.length === 1 ? 'día' : 'días'} de entrenamiento
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {dias.map((d) => (
            <div key={d.dia_semana}
              className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#FF6B35]">
                Día {d.dia_semana}
              </p>
              <p className="mt-0.5 text-[15px] font-extrabold">{d.foco || 'Entrenamiento'}</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {(d.ejercicios || []).map((e, i) => (
                  <li key={i} className="text-[13.5px] font-semibold opacity-85">
                    {e.nombre}
                    {e.series && e.reps && (
                      <span className="opacity-60"> · {e.series} series · {e.reps} reps</span>
                    )}
                  </li>
                ))}
                {(d.ejercicios || []).length === 0 && (
                  <li className="text-[13px] font-semibold opacity-50">Descanso</li>
                )}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 rounded-2xl border border-[#FF6B35]/30 bg-[#FF6B35]/10 p-5 text-center">
          <p className="text-[15px] font-extrabold">Entrena con esta rutina</p>
          <p className="mx-auto mt-1 max-w-[320px] text-[13px] font-semibold opacity-75">
            Descarga FitCore gratis, guarda esta rutina y lleva tu progreso.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <a href={PLAY} target="_blank" rel="noopener noreferrer"
              className="rounded-xl bg-black px-4 py-2.5 text-[13px] font-extrabold">
              Google Play
            </a>
            <a href={APPSTORE} target="_blank" rel="noopener noreferrer"
              className="rounded-xl bg-black px-4 py-2.5 text-[13px] font-extrabold">
              App Store
            </a>
          </div>
        </div>

        <p className="mt-6 text-center text-[11.5px] font-semibold opacity-45">
          Rutina creada por un usuario de FitCore, no revisada por un profesional.
          Consulta a tu médico antes de empezar.
        </p>
      </div>
    </div>
  )
}
