import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'

// Importador de socios desde Excel/CSV: sube el archivo, mapea las columnas
// y migramos a sus socios en un clic. El gancho de venta: "te paso tu Excel
// al sistema en 5 minutos". La librería xlsx se carga bajo demanda para no
// engordar el bundle del panel.

const CAMPOS = [
  ['nombre', 'Nombre *'],
  ['telefono', 'Teléfono'],
  ['email', 'Correo'],
  ['documento', 'DNI / documento'],
  ['plan', 'Plan (nombre)'],
  ['vence', 'Vence (fecha)'],
]

// Adivina el mapeo por el nombre de la cabecera
function adivinar(cabeceras) {
  const buscar = (patrones) => {
    const i = cabeceras.findIndex((c) => patrones.some((p) => String(c || '').toLowerCase().includes(p)))
    return i >= 0 ? String(i) : ''
  }
  return {
    nombre: buscar(['nombre', 'socio', 'cliente', 'name']),
    telefono: buscar(['tel', 'cel', 'phone', 'whats']),
    email: buscar(['mail', 'correo']),
    documento: buscar(['dni', 'doc', 'ruc', 'ident']),
    plan: buscar(['plan', 'membres', 'paquete']),
    vence: buscar(['venc', 'fin', 'hasta', 'expira']),
  }
}

// Normaliza fechas de Excel (número serial), dd/mm/yyyy o yyyy-mm-dd → 'YYYY-MM-DD'
function normalizarFecha(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') { // serial de Excel
    const d = new Date(Math.round((v - 25569) * 86400 * 1000))
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }
  const s = String(v).trim()
  const ddmm = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s)
  if (ddmm) {
    const anio = ddmm[3].length === 2 ? '20' + ddmm[3] : ddmm[3]
    return `${anio}-${ddmm[2].padStart(2, '0')}-${ddmm[1].padStart(2, '0')}`
  }
  const d = new Date(s)
  return isNaN(d) ? null : d.toISOString().slice(0, 10)
}

export default function ImportarSociosModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const [filas, setFilas] = useState(null)      // matriz cruda del archivo
  const [cabeceras, setCabeceras] = useState([])
  const [mapa, setMapa] = useState({})           // campo -> índice de columna
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resultado, setResultado] = useState(null)

  async function leerArchivo(file) {
    if (!file) return
    setError('')
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const hoja = wb.Sheets[wb.SheetNames[0]]
      const matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '' })
      const noVacias = matriz.filter((f) => f.some((c) => String(c).trim() !== ''))
      if (noVacias.length < 2) throw new Error('El archivo no tiene filas de datos (se espera cabecera + socios)')
      setCabeceras(noVacias[0].map((c) => String(c)))
      setFilas(noVacias.slice(1))
      setMapa(adivinar(noVacias[0]))
    } catch (e) {
      setError('No se pudo leer el archivo: ' + e.message)
    }
  }

  async function importar() {
    if (mapa.nombre === '') { setError('Indica cuál columna es el Nombre'); return }
    setBusy(true); setError('')
    const socios = filas.map((f) => ({
      nombre: String(f[Number(mapa.nombre)] ?? '').trim(),
      telefono: mapa.telefono !== '' ? String(f[Number(mapa.telefono)] ?? '').trim() : null,
      email: mapa.email !== '' ? String(f[Number(mapa.email)] ?? '').trim() : null,
      documento: mapa.documento !== '' ? String(f[Number(mapa.documento)] ?? '').trim() : null,
      plan: mapa.plan !== '' ? String(f[Number(mapa.plan)] ?? '').trim() : null,
      vence: mapa.vence !== '' ? normalizarFecha(f[Number(mapa.vence)]) : null,
    })).filter((s) => s.nombre)

    const { data, error } = await supabase.rpc('importar_socios', { p_sede_id: sedeId, p_socios: socios })
    setBusy(false)
    if (error) { setError(error.message); return }
    setResultado(data)
    qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
    toast.ok(`${data.importados} socios importados`)
  }

  if (resultado) {
    return (
      <Modal title="Importación completada ✓" onClose={onClose} width={440}>
        <div className="rounded-[10px] bg-green-50 p-4 text-center">
          <div className="text-[26px] font-extrabold text-green-600">{resultado.importados}</div>
          <div className="text-[13px] font-bold text-green-700">socios importados</div>
          <div className="mt-2 text-[12px] font-semibold text-muted">
            {resultado.saltados > 0 && <>{resultado.saltados} saltados (duplicados o sin nombre) · </>}
            {resultado.sin_plan > 0 && <>{resultado.sin_plan} sin membresía (plan no reconocido — asígnala desde su ficha)</>}
          </div>
        </div>
        {(resultado.errores || []).length > 0 && (
          <div className="mt-3 max-h-[140px] overflow-y-auto rounded-[10px] bg-red-50 p-3 text-[11.5px] font-bold text-red">
            {resultado.errores.map((e, i) => <div key={i}>• {e}</div>)}
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">Listo</button>
      </Modal>
    )
  }

  return (
    <Modal title="Importar socios desde Excel" subtitle="Sube tu archivo .xlsx o .csv — la primera fila deben ser los títulos" onClose={onClose} width={520}>
      <div className="flex flex-col gap-3.5">
        {!filas ? (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border-2 border-dashed border-line bg-surface px-4 py-10 text-center transition-colors hover:border-orange">
            <span className="text-[30px]">📄</span>
            <span className="text-[13.5px] font-extrabold">Elegir archivo (.xlsx, .xls o .csv)</span>
            <span className="text-[11.5px] font-semibold text-muted">Ejemplo de columnas: Nombre, Teléfono, DNI, Plan, Vence</span>
            <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
              onChange={(e) => { leerArchivo(e.target.files?.[0]); e.target.value = '' }} />
          </label>
        ) : (
          <>
            <p className="text-[12.5px] font-bold">
              {filas.length} filas detectadas. Indica qué columna corresponde a cada dato:
            </p>
            <div className="grid grid-cols-2 gap-3">
              {CAMPOS.map(([campo, label]) => (
                <Campo key={campo} label={label}>
                  <select value={mapa[campo] ?? ''} onChange={(e) => setMapa((m) => ({ ...m, [campo]: e.target.value }))}
                    className={inputCls + ' cursor-pointer'}>
                    <option value="">— no importar —</option>
                    {cabeceras.map((c, i) => <option key={i} value={String(i)}>{c || `Columna ${i + 1}`}</option>)}
                  </select>
                </Campo>
              ))}
            </div>
            {/* Vista previa de las primeras filas con el mapeo elegido */}
            <div className="overflow-x-auto rounded-[10px] border border-line">
              <div className="min-w-[440px]">
                <div className="grid grid-cols-4 gap-2 bg-surface px-3 py-2 text-[10.5px] font-extrabold uppercase text-muted">
                  <div>Nombre</div><div>Teléfono</div><div>Plan</div><div>Vence</div>
                </div>
                {filas.slice(0, 4).map((f, i) => (
                  <div key={i} className="grid grid-cols-4 gap-2 border-t border-line2 px-3 py-1.5 text-[12px] font-semibold">
                    <div className="truncate">{mapa.nombre !== '' ? f[Number(mapa.nombre)] : '—'}</div>
                    <div className="truncate">{mapa.telefono !== '' ? f[Number(mapa.telefono)] : '—'}</div>
                    <div className="truncate">{mapa.plan !== '' ? f[Number(mapa.plan)] : '—'}</div>
                    <div className="truncate">{mapa.vence !== '' ? (normalizarFecha(f[Number(mapa.vence)]) || '¿?') : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
            <p className="rounded-[10px] bg-surface px-3.5 py-2.5 text-[11.5px] font-semibold text-muted">
              El plan se asigna si el nombre coincide con uno de tus planes. Los pagos históricos NO entran a tu caja.
              Duplicados se saltan solos. Máximo 500 por archivo.
            </p>
            {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
            <div className="flex items-center justify-end gap-2.5">
              <button onClick={() => { setFilas(null); setError('') }}
                className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted">Otro archivo</button>
              <button onClick={importar} disabled={busy || mapa.nombre === ''}
                className="cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
                {busy ? 'Importando…' : `Importar ${filas.length} socios`}
              </button>
            </div>
          </>
        )}
        {error && !filas && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
      </div>
    </Modal>
  )
}
