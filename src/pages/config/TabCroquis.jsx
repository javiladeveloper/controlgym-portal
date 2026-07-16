import { useState, useEffect } from 'react'
import { Card } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { toast } from '../../lib/toast.js'
import { usePisos, useGuardarPiso, useBorrarPiso, useSetGrilla, useCasillasPiso, useEditarFormaPiso, useMaquinasSede, useMaquinasColocadas, useElementosPiso, useElementos } from '../../hooks/useCroquis.js'

// Puntos de referencia que se pueden colocar en el croquis (además de máquinas),
// para que el socio se ubique. 'otro' pide una etiqueta libre.
const REFERENCIAS = [
  { tipo: 'entrada', label: 'Entrada', emoji: '🚪' },
  { tipo: 'salida', label: 'Salida', emoji: '🚶' },
  { tipo: 'escalera', label: 'Escalera', emoji: '🪜' },
  { tipo: 'ascensor', label: 'Ascensor', emoji: '🛗' },
  { tipo: 'bano', label: 'Baño', emoji: '🚻' },
  { tipo: 'vestuario', label: 'Vestuario', emoji: '🚿' },
  { tipo: 'recepcion', label: 'Recepción', emoji: '🛎️' },
  { tipo: 'otro', label: 'Otro…', emoji: '📍' },
]
const emojiRef = (tipo) => REFERENCIAS.find((r) => r.tipo === tipo)?.emoji || '📍'

// Editor de croquis. Cada piso es una cuadrícula: el gym DIBUJA la forma del piso
// y luego COLOCA sus máquinas (cada unidad en su casilla) y puntos de referencia.
export default function TabCroquis() {
  const { empresa } = useAuth()
  const { sedeId, sedeNombre } = usePanel()
  const pisos = usePisos(sedeId)
  const guardarPiso = useGuardarPiso(sedeId)
  const borrarPiso = useBorrarPiso(sedeId)
  const setGrilla = useSetGrilla(sedeId)
  const maquinas = useMaquinasSede(sedeId)
  const colocadas = useMaquinasColocadas(sedeId)
  const [pisoSel, setPisoSel] = useState(null)
  const [nuevoNombre, setNuevoNombre] = useState('')
  const [modo, setModo] = useState('piso')   // 'piso' | 'colocar'
  const [arrastrando, setArrastrando] = useState(null) // {tipo, maquinaId?}
  const [pintando, setPintando] = useState(null)

  useEffect(() => { setPisoSel(null) }, [sedeId])

  const lista = pisos.data || []
  const piso = lista.find((p) => p.id === pisoSel) || null
  const casillas = useCasillasPiso(pisoSel)
  const forma = useEditarFormaPiso(pisoSel)
  const elementos = useElementosPiso(pisoSel)
  const elem = useElementos(sedeId, pisoSel)

  const filas = piso?.filas || 8
  const columnas = piso?.columnas || 8
  const casillasData = casillas.data || []
  const sinFormaAun = casillasData.length === 0
  const esPiso = (f, c) => sinFormaAun || casillasData.some((k) => k.fila === f && k.columna === c)
  const elementosData = elementos.data || []
  const enCasilla = (f, c) => elementosData.find((e) => e.fila === f && e.columna === c) || null
  const colocadasMap = colocadas.data || {}

  async function agregarPiso() {
    if (!nuevoNombre.trim()) return
    try {
      await guardarPiso.mutateAsync({ empresa_id: empresa.id, nombre: nuevoNombre.trim(), orden: lista.length })
      setNuevoNombre('')
    } catch (e) { toast.error(e.message) }
  }

  async function togglePiso(f, c, forzar) {
    const nuevo = forzar != null ? forzar : !esPiso(f, c)
    try { await forma.marcarCasilla.mutateAsync({ fila: f, columna: c, esPiso: nuevo }) }
    catch (e) { toast.error(e.message) }
  }

  // Soltar el elemento arrastrado (máquina o referencia) en una casilla.
  async function soltarEn(f, c) {
    if (!arrastrando || !piso) return
    if (!esPiso(f, c)) { toast.error('Esa casilla no es parte del piso. Márcala en "Dibujar piso".'); return }
    let etiqueta = null
    if (arrastrando.tipo === 'otro') {
      etiqueta = prompt('¿Qué es este punto? (ej. "Zona de estiramiento")')
      if (!etiqueta) { setArrastrando(null); return }
    }
    try {
      await elem.colocar.mutateAsync({ fila: f, columna: c, tipo: arrastrando.tipo, maquinaId: arrastrando.maquinaId || null, etiqueta })
    } catch (e) { toast.error(e.message) } finally { setArrastrando(null) }
  }

  async function quitar(f, c) {
    try { await elem.quitar.mutateAsync({ fila: f, columna: c }) }
    catch (e) { toast.error(e.message) }
  }

  async function cambiarGrilla(df, dc) {
    if (!piso) return
    try { await setGrilla.mutateAsync({ pisoId: piso.id, filas: filas + df, columnas: columnas + dc }) }
    catch (e) { toast.error(e.message) }
  }

  return (
    <div className="max-w-[940px]">
      <Card className="p-[19px]">
        <div className="text-[15px] font-extrabold">🗺️ Croquis de {sedeNombre}</div>
        <p className="mt-1 text-[13px] font-semibold text-muted">
          Crea los pisos de tu sede. En cada uno, <b>dibuja la forma del piso</b> y luego <b>coloca tus máquinas</b>
          (cada unidad en su casilla) y <b>puntos de referencia</b> (entrada, escaleras, baños…) para que el socio se ubique.
        </p>
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
            <button onClick={() => { if (confirm(`¿Borrar el piso "${piso.nombre}"?`)) { borrarPiso.mutate(piso.id); setPisoSel(null) } }}
              className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-red hover:underline">Borrar piso</button>
          </div>

          <div className="mt-3 inline-flex rounded-[10px] border border-line p-0.5">
            <button onClick={() => setModo('piso')}
              className={`cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12px] font-extrabold transition-colors ${modo === 'piso' ? 'bg-orange text-white' : 'text-muted'}`}>1 · Dibujar piso</button>
            <button onClick={() => setModo('colocar')}
              className={`cursor-pointer rounded-[8px] px-3.5 py-1.5 text-[12px] font-extrabold transition-colors ${modo === 'colocar' ? 'bg-orange text-white' : 'text-muted'}`}>2 · Colocar</button>
          </div>

          {modo === 'piso' && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] font-bold text-muted">
              <div className="flex items-center gap-1.5">
                <span>Filas</span>
                <button onClick={() => cambiarGrilla(-1, 0)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">−</button>
                <span className="w-5 text-center tabular-nums">{filas}</span>
                <button onClick={() => cambiarGrilla(1, 0)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">+</button>
                <span className="ml-2">Columnas</span>
                <button onClick={() => cambiarGrilla(0, -1)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">−</button>
                <span className="w-5 text-center tabular-nums">{columnas}</span>
                <button onClick={() => cambiarGrilla(0, 1)} className="h-6 w-6 cursor-pointer rounded-md border border-line font-extrabold hover:border-orange">+</button>
              </div>
              <div className="flex items-center gap-1.5">
                <button onClick={() => forma.llenar.mutate()} className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[11.5px] font-extrabold text-muted hover:border-orange">Llenar todo</button>
                <button onClick={() => { if (confirm('¿Vaciar el piso? Se quitan casillas y lo colocado.')) forma.vaciar.mutate() }}
                  className="cursor-pointer rounded-[8px] border border-line bg-white px-2.5 py-1 text-[11.5px] font-extrabold text-muted hover:border-red hover:text-red">Vaciar</button>
              </div>
              <span className="text-[11px] font-semibold text-faint">Clic o arrastra para marcar/quitar piso.</span>
            </div>
          )}

          {/* La cuadrícula */}
          <div className="mt-4 inline-grid gap-1 overflow-x-auto rounded-[12px] border border-line bg-surface p-3"
            style={{ gridTemplateColumns: `repeat(${columnas}, minmax(50px, 1fr))` }}
            onMouseUp={() => setPintando(null)} onMouseLeave={() => setPintando(null)}>
            {Array.from({ length: filas }).map((_, f) =>
              Array.from({ length: columnas }).map((__, c) => {
                const hayPiso = esPiso(f, c)
                const el = enCasilla(f, c)
                if (modo === 'piso') {
                  return (
                    <div key={`${f}-${c}`}
                      onMouseDown={() => { const nuevo = !hayPiso; setPintando(nuevo); togglePiso(f, c, nuevo) }}
                      onMouseEnter={() => { if (pintando != null) togglePiso(f, c, pintando) }}
                      className={`h-[50px] cursor-pointer rounded-[6px] border transition-colors ${hayPiso ? 'border-orange bg-orange-50' : 'border-dashed border-line bg-white hover:bg-orange-50/40'}`} />
                  )
                }
                return (
                  <div key={`${f}-${c}`}
                    onDragOver={(e) => hayPiso && e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); soltarEn(f, c) }}
                    className={`flex h-[50px] items-center justify-center rounded-[6px] border p-1 text-center text-[9px] font-extrabold leading-tight ${
                      !hayPiso ? 'border-transparent bg-transparent'
                      : el ? (el.tipo === 'maquina' ? 'border-orange bg-orange-50 text-orange' : 'border-navy bg-navy/10 text-navy')
                      : 'border-dashed border-line bg-white text-faint'}`}>
                    {hayPiso && el ? (
                      <button onClick={() => quitar(f, c)} title="Clic para quitar" className="cursor-pointer border-none bg-transparent p-0 leading-tight">
                        {el.tipo === 'maquina' ? el.nombre : `${emojiRef(el.tipo)} ${el.nombre || ''}`}
                      </button>
                    ) : ''}
                  </div>
                )
              })
            )}
          </div>

          {/* Paletas: máquinas (con "quedan N") + referencias */}
          {modo === 'colocar' && (
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <div className="mb-2 text-[12px] font-extrabold text-muted">Máquinas (arrastra cada unidad a su casilla):</div>
                <div className="flex flex-wrap gap-2">
                  {(maquinas.data || []).map((m) => {
                    const total = m.unidades || 1
                    const puestas = Number(colocadasMap[m.id] || 0)
                    const quedan = Math.max(0, total - puestas)
                    return (
                      <div key={m.id} draggable={quedan > 0}
                        onDragStart={() => setArrastrando({ tipo: 'maquina', maquinaId: m.id })} onDragEnd={() => setArrastrando(null)}
                        className={`rounded-full border px-3 py-1.5 text-[12px] font-extrabold ${quedan > 0 ? 'cursor-grab border-line bg-white text-muted hover:border-orange active:cursor-grabbing' : 'border-line bg-surface text-faint opacity-60'}`}>
                        {m.nombre}{total > 1 ? ` · quedan ${quedan}/${total}` : quedan === 0 ? ' ✓' : ''}
                      </div>
                    )
                  })}
                  {(maquinas.data || []).length === 0 && <span className="text-[12px] font-semibold text-faint">Sin máquinas registradas. Agrégalas en la página Máquinas.</span>}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[12px] font-extrabold text-muted">Puntos de referencia (arrastra al plano):</div>
                <div className="flex flex-wrap gap-2">
                  {REFERENCIAS.map((r) => (
                    <div key={r.tipo} draggable onDragStart={() => setArrastrando({ tipo: r.tipo })} onDragEnd={() => setArrastrando(null)}
                      className="cursor-grab rounded-full border border-navy/30 bg-navy/5 px-3 py-1.5 text-[12px] font-extrabold text-navy active:cursor-grabbing hover:border-navy">
                      {r.emoji} {r.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
