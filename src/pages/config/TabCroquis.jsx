import { useState, useEffect, useRef } from 'react'
import { Card } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'
import { subirImagen } from '../../hooks/useConfiguracion.js'
import { usePisos, useGuardarPiso, useBorrarPiso, useMaquinasSede, useUbicarMaquina } from '../../hooks/useCroquis.js'

export default function TabCroquis() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const pisos = usePisos(sedeId)
  const guardarPiso = useGuardarPiso(sedeId)
  const borrarPiso = useBorrarPiso(sedeId)
  const maquinas = useMaquinasSede(sedeId)
  const ubicar = useUbicarMaquina(sedeId)
  const [pisoSel, setPisoSel] = useState(null)   // id del piso en edición
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [subiendo, setSubiendo] = useState(false)
  const [arrastrando, setArrastrando] = useState(null)
  const planoRef = useRef(null)
  const fileRef = useRef(null)

  // Reset piso cuando cambia la sede
  useEffect(() => { setPisoSel(null) }, [sedeId])

  const lista = pisos.data || []
  const piso = lista.find((p) => p.id === pisoSel) || null
  const maqsDelPiso = (maquinas.data || []).filter((m) => m.piso_id === pisoSel && m.pos_x != null)
  const maqsSinUbicar = (maquinas.data || []).filter((m) => m.piso_id !== pisoSel || m.pos_x == null)

  async function agregarPiso() {
    if (!nuevoNombre.trim()) return
    try {
      await guardarPiso.mutateAsync({ empresa_id: empresa.id, nombre: nuevoNombre.trim(), orden: lista.length })
      setNuevoNombre('')
    } catch (e) { toast.error(e.message) }
  }

  async function subirPlano(file) {
    if (!piso) return
    setSubiendo(true)
    try {
      const url = await subirImagen(empresa.id, 'croquis', file)
      await guardarPiso.mutateAsync({ id: piso.id, empresa_id: empresa.id, nombre: piso.nombre, orden: piso.orden, plano_url: url })
    } catch (e) { toast.error('No se pudo subir: ' + e.message) } finally { setSubiendo(false) }
  }

  // Soltar una máquina sobre el plano → calcular x/y en % del contenedor.
  async function soltar(e, maquinaId) {
    e.preventDefault()
    const rect = planoRef.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100))
    try {
      await ubicar.mutateAsync({ maquinaId, pisoId: piso.id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 })
    } catch (err) { toast.error(err.message) }
  }

  async function quitarUbicacion(maquinaId) {
    try { await ubicar.mutateAsync({ maquinaId, pisoId: null, x: null, y: null }) }
    catch (err) { toast.error(err.message) }
  }

  return (
    <div className="max-w-[820px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🗺️ Croquis de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crea los pisos de tu sede, sube el plano de cada uno y arrastra tus máquinas a su lugar.
          El socio lo verá en la app para ubicarse.
        </p>

        {/* Pisos */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {lista.map((p) => (
            <button key={p.id} onClick={() => setPisoSel(p.id)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${pisoSel === p.id ? 'border-orange bg-orange-50 text-orange' : 'border-line text-muted hover:border-orange'}`}>
              {p.nombre}{!p.plano_url && ' · sin plano'}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nuevo piso…"
              className="w-[130px] rounded-[9px] border border-line px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-orange" />
            <button onClick={agregarPiso} className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-3 py-1.5 text-[12px] font-extrabold text-orange hover:bg-orange-50">+ Piso</button>
          </div>
        </div>
      </Card>

      {piso && (
        <Card className="mt-4 p-[19px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[14px] font-extrabold">{piso.nombre}</div>
            <div className="flex items-center gap-2">
              <button onClick={() => fileRef.current?.click()} disabled={subiendo}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted hover:border-orange disabled:opacity-50">
                {subiendo ? 'Subiendo…' : piso.plano_url ? 'Cambiar plano' : 'Subir plano'}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) subirPlano(f); e.target.value = '' }} />
              <button onClick={() => { if (confirm(`¿Borrar el piso "${piso.nombre}"?`)) { borrarPiso.mutate(piso.id); setPisoSel(null) } }}
                className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-red hover:underline">Borrar piso</button>
            </div>
          </div>

          {/* Plano con pines */}
          {piso.plano_url ? (
            <div ref={planoRef} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (arrastrando) soltar(e, arrastrando); setArrastrando(null); }}
              className="relative mt-3 w-full overflow-hidden rounded-[12px] border border-line bg-[#0B0E14]">
              <img src={piso.plano_url} alt="" className="w-full select-none" draggable={false} />
              {maqsDelPiso.map((m) => (
                <button key={m.id} onClick={() => quitarUbicacion(m.id)} title={`${m.nombre} — clic para quitar`}
                  className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange px-2 py-1 text-[10px] font-extrabold text-white shadow-lg"
                  style={{ left: `${m.pos_x}%`, top: `${m.pos_y}%` }}>
                  📍 {m.nombre}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-3 rounded-[12px] border border-dashed border-line py-10 text-center text-[12.5px] font-semibold text-faint">
              Sube el plano de este piso para empezar a ubicar máquinas.
            </div>
          )}

          {/* Máquinas por ubicar (arrastrables) */}
          {piso.plano_url && (
            <div className="mt-4">
              <div className="mb-2 text-[12px] font-extrabold text-muted">Arrastra una máquina sobre el plano:</div>
              <div className="flex flex-wrap gap-2">
                {maqsSinUbicar.map((m) => (
                  <div key={m.id} draggable onDragStart={() => setArrastrando(m.id)} onDragEnd={(e) => soltar(e, m.id)}
                    className="cursor-grab rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted active:cursor-grabbing hover:border-orange">
                    {m.nombre}
                  </div>
                ))}
                {maqsSinUbicar.length === 0 && <span className="text-[12px] font-semibold text-faint">Todas las máquinas están ubicadas en este piso.</span>}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
