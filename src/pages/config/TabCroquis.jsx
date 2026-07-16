import { useState, useEffect } from 'react'
import { Card } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'
import { usePisos, useGuardarPiso, useBorrarPiso, useSetGrilla, useMaquinasSede, useColocarMaquina } from '../../hooks/useCroquis.js'

// Editor de croquis por CUADRÍCULA: el gym crea los pisos y, en cada uno, arma la
// distribución colocando sus máquinas registradas en casillas de una grilla. No
// hace falta subir ninguna imagen — el plano se dibuja con las propias máquinas.
export default function TabCroquis() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const pisos = usePisos(sedeId)
  const guardarPiso = useGuardarPiso(sedeId)
  const borrarPiso = useBorrarPiso(sedeId)
  const setGrilla = useSetGrilla(sedeId)
  const maquinas = useMaquinasSede(sedeId)
  const colocar = useColocarMaquina(sedeId)
  const [pisoSel, setPisoSel] = useState(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [arrastrando, setArrastrando] = useState(null) // id de la máquina en drag

  // Al cambiar de sede, olvidar el piso seleccionado (los ids son por sede).
  useEffect(() => { setPisoSel(null) }, [sedeId])

  const lista = pisos.data || []
  const piso = lista.find((p) => p.id === pisoSel) || null
  const filas = piso?.filas || 8
  const columnas = piso?.columnas || 8
  const maqs = maquinas.data || []
  // Máquina que ocupa una casilla concreta de este piso (o null).
  const enCasilla = (f, c) => maqs.find((m) => m.piso_id === pisoSel && m.grid_fila === f && m.grid_columna === c) || null
  // Máquinas sin colocar en este piso (para el panel lateral, arrastrables).
  const sinColocar = maqs.filter((m) => m.piso_id !== pisoSel || m.grid_fila == null)

  async function agregarPiso() {
    if (!nuevoNombre.trim()) return
    try {
      await guardarPiso.mutateAsync({ empresa_id: empresa.id, nombre: nuevoNombre.trim(), orden: lista.length })
      setNuevoNombre('')
    } catch (e) { toast.error(e.message) }
  }

  // Soltar la máquina arrastrada en la casilla (f,c). Una casilla = una máquina.
  async function soltarEn(f, c) {
    if (!arrastrando || !piso) return
    const ocupada = enCasilla(f, c)
    if (ocupada && ocupada.id !== arrastrando) { toast.error(`Esa casilla ya tiene ${ocupada.nombre}`); return }
    try {
      await colocar.mutateAsync({ maquinaId: arrastrando, pisoId: piso.id, fila: f, columna: c })
    } catch (e) { toast.error(e.message) } finally { setArrastrando(null) }
  }

  async function quitar(maquinaId) {
    try { await colocar.mutateAsync({ maquinaId, pisoId: piso.id, fila: null, columna: null }) }
    catch (e) { toast.error(e.message) }
  }

  async function cambiarGrilla(df, dc) {
    if (!piso) return
    try { await setGrilla.mutateAsync({ pisoId: piso.id, filas: filas + df, columnas: columnas + dc }) }
    catch (e) { toast.error(e.message) }
  }

  return (
    <div className="max-w-[900px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🗺️ Croquis de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crea los pisos de tu sede y, en cada uno, arrastra tus máquinas a la casilla donde están.
          Así armas el mapa del gym — sin subir ninguna imagen. El socio lo verá en la app para ubicarse.
        </p>

        {/* Pisos */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {lista.map((p) => (
            <button key={p.id} onClick={() => setPisoSel(p.id)}
              className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[12.5px] font-extrabold transition-colors ${pisoSel === p.id ? 'border-orange bg-orange-50 text-orange' : 'border-line text-muted hover:border-orange'}`}>
              {p.nombre}
            </button>
          ))}
          <div className="flex items-center gap-1.5">
            <input value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} placeholder="Nuevo piso…"
              onKeyDown={(e) => e.key === 'Enter' && agregarPiso()}
              className="w-[130px] rounded-[9px] border border-line px-2.5 py-1.5 text-[12.5px] font-semibold outline-none focus:border-orange" />
            <button onClick={agregarPiso} className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-3 py-1.5 text-[12px] font-extrabold text-orange hover:bg-orange-50">+ Piso</button>
          </div>
        </div>
      </Card>

      {piso && (
        <Card className="mt-4 p-[19px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[14px] font-extrabold">{piso.nombre}</div>
            <div className="flex items-center gap-3">
              {/* Ajuste del tamaño de la grilla */}
              <div className="flex items-center gap-1.5 text-[12px] font-bold text-muted">
                <span>Filas</span>
                <button onClick={() => cambiarGrilla(-1, 0)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">−</button>
                <span className="w-5 text-center tabular-nums">{filas}</span>
                <button onClick={() => cambiarGrilla(1, 0)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">+</button>
                <span className="ml-2">Columnas</span>
                <button onClick={() => cambiarGrilla(0, -1)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">−</button>
                <span className="w-5 text-center tabular-nums">{columnas}</span>
                <button onClick={() => cambiarGrilla(0, 1)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">+</button>
              </div>
              <button onClick={() => { if (confirm(`¿Borrar el piso "${piso.nombre}"?`)) { borrarPiso.mutate(piso.id); setPisoSel(null) } }}
                className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-red hover:underline">Borrar piso</button>
            </div>
          </div>

          {/* La cuadrícula: cada casilla acepta una máquina arrastrada */}
          <div className="mt-4 inline-grid gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-3"
            style={{ gridTemplateColumns: `repeat(${columnas}, minmax(56px, 1fr))` }}>
            {Array.from({ length: filas }).map((_, f) =>
              Array.from({ length: columnas }).map((__, c) => {
                const m = enCasilla(f, c)
                return (
                  <div key={`${f}-${c}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); soltarEn(f, c) }}
                    className={`flex h-[56px] items-center justify-center rounded-[8px] border p-1 text-center text-[9.5px] font-extrabold leading-tight transition-colors ${m ? 'border-orange bg-orange-50 text-orange' : 'border-dashed border-line bg-white text-faint'}`}>
                    {m ? (
                      <button onClick={() => quitar(m.id)} title="Clic para quitar" className="cursor-pointer border-none bg-transparent p-0 leading-tight text-orange">
                        {m.nombre}{m.unidades > 1 ? ` ×${m.unidades}` : ''}
                      </button>
                    ) : ''}
                  </div>
                )
              })
            )}
          </div>

          {/* Máquinas por colocar (arrastrables) */}
          <div className="mt-4">
            <div className="mb-2 text-[12px] font-extrabold text-muted">Arrastra una máquina a su casilla:</div>
            <div className="flex flex-wrap gap-2">
              {sinColocar.map((m) => (
                <div key={m.id} draggable onDragStart={() => setArrastrando(m.id)} onDragEnd={() => setArrastrando(null)}
                  className="cursor-grab rounded-full border border-line bg-white px-3 py-1.5 text-[12px] font-extrabold text-muted active:cursor-grabbing hover:border-orange">
                  {m.nombre}{m.unidades > 1 ? ` ×${m.unidades}` : ''}
                </div>
              ))}
              {sinColocar.length === 0 && maqs.length > 0 && <span className="text-[12px] font-semibold text-faint">Todas las máquinas están colocadas en este piso.</span>}
            </div>
            {maqs.length === 0 && (
              <p className="mt-2 text-[12px] font-semibold text-faint">Aún no tienes máquinas registradas en esta sede. Agrégalas en la página de Máquinas para poder colocarlas.</p>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
