import { useState, useEffect } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState, ErrorState } from '../../components/states.jsx'
import { inputCls } from '../../components/Modal.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { usePanel } from '../../store.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { useSedes, useGuardarEmpresa } from '../../hooks/useConfiguracion.js'
import { useClientes } from '../../hooks/useClientes.js'
import { usePersonal } from '../../hooks/useOperaciones.js'
import {
  useDispositivos, useGuardarDispositivo,
  useCredenciales, useEnrolarCredencial, useQuitarCredencial,
} from '../../hooks/useAcceso.js'
import { toast } from '../../lib/toast.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

const TIPOS_DISP = [
  ['huella', 'Huella dactilar'], ['facial', 'Reconocimiento facial'],
  ['tarjeta', 'Tarjeta / RFID'], ['tactil', 'Táctil / teclado'], ['qr', 'Lector QR'],
]
const DIRECCIONES = [['entrada', 'Solo entrada'], ['salida', 'Solo salida'], ['ambos', 'Entrada y salida']]
const TIPOS_CRED = [['huella', 'Huella'], ['facial', 'Rostro'], ['tarjeta', 'Tarjeta'], ['pin', 'PIN']]
const EMPTY_DISP = { nombre: '', tipo: 'huella', direccion: 'entrada', identificador: '', activo: true, sede_id: '' }

export default function TabAcceso() {
  const { empresa } = useAuth()
  const { sedeId } = usePanel()
  const sedes = useSedes(empresa?.id)
  const dispositivos = useDispositivos(empresa?.id)
  const guardarDisp = useGuardarDispositivo(empresa?.id)
  const credenciales = useCredenciales(empresa?.id)
  const enrolar = useEnrolarCredencial(empresa?.id)
  const quitar = useQuitarCredencial(empresa?.id)
  const { data: socios } = useClientes(sedeId)
  const { data: personal } = usePersonal(sedeId)

  const [disp, setDisp] = useState(null) // dispositivo en edición o EMPTY para nuevo
  // Enrolamiento
  const [titular, setTitular] = useState('socio') // 'socio' | 'personal'
  const [cred, setCred] = useState({ tipo: 'huella', valor: '', socioId: '', usuarioId: '' })

  // Flag: ¿este gym controla acceso (carnet QR / lector)? Si off, la app del
  // socio oculta el carnet, racha y visitas. Se lee directo (el bootstrap
  // puede no traer la columna nueva todavía).
  const guardarEmpresa = useGuardarEmpresa(empresa?.id)
  const [usaQr, setUsaQr] = useState(null) // null=cargando
  useEffect(() => {
    if (!empresa?.id) return
    supabase.from('empresa').select('usa_carnet_qr').eq('id', empresa.id).single()
      .then(({ data }) => setUsaQr(data?.usa_carnet_qr ?? true))
  }, [empresa?.id])

  function toggleQr(nuevo) {
    setUsaQr(nuevo)
    guardarEmpresa.mutate({ usa_carnet_qr: nuevo }, {
      onSuccess: () => toast.ok(nuevo ? 'Carnet QR activado' : 'Carnet QR desactivado'),
      onError: (e) => { setUsaQr(!nuevo); toast.error(e.message) },
    })
  }

  function onGuardarDisp() {
    if (!disp.nombre.trim()) { toast.error('Ponle un nombre al lector'); return }
    if (!disp.sede_id) { toast.error('Elige la sede'); return }
    guardarDisp.mutate(disp, {
      onSuccess: () => { toast.ok('Lector guardado'); setDisp(null) },
      onError: (e) => toast.error(e.message),
    })
  }

  function onEnrolar() {
    if (!cred.valor.trim()) { toast.error('Falta el identificador que da el lector (o el PIN/tarjeta)'); return }
    const titularId = titular === 'socio' ? cred.socioId : cred.usuarioId
    if (!titularId) { toast.error(`Elige al ${titular === 'socio' ? 'socio' : 'colaborador'}`); return }
    enrolar.mutate(
      { tipo: cred.tipo, valor: cred.valor.trim(), socioId: titular === 'socio' ? titularId : null, usuarioId: titular === 'personal' ? titularId : null },
      { onSuccess: () => { toast.ok('Credencial enrolada'); setCred({ tipo: cred.tipo, valor: '', socioId: '', usuarioId: '' }) }, onError: (e) => toast.error(e.message) }
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Interruptor maestro: ¿este gym usa control de acceso? */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14.5px] font-extrabold">¿Tu gimnasio controla el acceso?</div>
            <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
              Actívalo si registras la entrada de tus socios (por carnet QR de la app, lector o recepción).
              Si tu gimnasio <b>no controla acceso</b>, desactívalo: la app del socio ocultará su carnet QR,
              racha de asistencia y visitas.
            </div>
          </div>
          <button
            onClick={() => usaQr !== null && toggleQr(!usaQr)}
            disabled={usaQr === null || guardarEmpresa.isPending}
            className={`relative mt-1 h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-none transition-colors ${usaQr ? 'bg-orange' : 'bg-line2'} disabled:opacity-50`}
            aria-label="Activar control de acceso">
            <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${usaQr ? 'left-6' : 'left-1'}`} />
          </button>
        </div>
        {usaQr === false && (
          <p className="mt-3 rounded-[9px] bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-800">
            Control de acceso desactivado. Tus socios no verán el carnet QR en la app. Puedes reactivarlo cuando quieras.
          </p>
        )}
      </Card>

      {/* Todo lo de control de acceso solo si el gym lo usa */}
      {usaQr !== false && (
      <>
      {/* Explicación de los 2 métodos */}
      <div className="rounded-[12px] border border-line bg-[#FAFBFC] p-4">
        <div className="text-[14px] font-extrabold">Control de acceso · dos métodos</div>
        <div className="mt-1.5 text-[12.5px] font-semibold leading-[1.5] text-muted">
          <b>1) Biométrico</b> (huella o rostro): registra tus lectores abajo y enrola la huella/rostro
          de cada socio <b>y</b> colaborador. La misma huella marca la asistencia del socio (valida su
          membresía) o la entrada/salida del personal, según a quién reconozca.
          <br />
          <b>2) Manual</b> (siempre disponible, sin hardware): la recepción marca al socio por nombre/DNI
          en el Dashboard, y el personal ficha con su botón Entrada/Salida en Personal. El socio también
          entra con el QR de su app.
        </div>
      </div>

      {/* ── Lectores / dispositivos ─────────────────────────────────────── */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[14.5px] font-extrabold">Lectores de acceso</div>
            <div className="mt-0.5 text-[12px] font-semibold text-muted">Los equipos físicos instalados en tus puertas</div>
          </div>
          {!disp && <PrimaryButton onClick={() => setDisp({ ...EMPTY_DISP, sede_id: sedes.data?.[0]?.id || '' })}>+ Agregar lector</PrimaryButton>}
        </div>

        {disp && (
          <div className="mt-4 rounded-[12px] border border-orange/40 bg-orange/5 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Nombre del lector</span>
                <input value={disp.nombre} onChange={(e) => setDisp({ ...disp, nombre: e.target.value })} className={inputCls} placeholder="Torniquete entrada principal" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Sede</span>
                <select value={disp.sede_id} onChange={(e) => setDisp({ ...disp, sede_id: e.target.value })} className={inputCls + ' cursor-pointer'}>
                  {(sedes.data || []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Tipo</span>
                <select value={disp.tipo} onChange={(e) => setDisp({ ...disp, tipo: e.target.value })} className={inputCls + ' cursor-pointer'}>
                  {TIPOS_DISP.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Dirección</span>
                <select value={disp.direccion} onChange={(e) => setDisp({ ...disp, direccion: e.target.value })} className={inputCls + ' cursor-pointer'}>
                  {DIRECCIONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Identificador del equipo <span className="font-semibold normal-case text-faint">(opcional — nº de serie o IP, para el puente con el lector)</span></span>
                <input value={disp.identificador} onChange={(e) => setDisp({ ...disp, identificador: e.target.value })} className={inputCls} placeholder="ZKTeco SN / 192.168.1.50" />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <PrimaryButton onClick={onGuardarDisp} disabled={guardarDisp.isPending}>Guardar lector</PrimaryButton>
              <button onClick={() => setDisp(null)} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2 text-[13px] font-extrabold text-muted">Cancelar</button>
            </div>
          </div>
        )}

        {dispositivos.isLoading && <LoadingState variant="table" rows={2} />}
        {dispositivos.error && <ErrorState error={dispositivos.error} />}
        {dispositivos.data?.length === 0 && !disp && (
          <div className="mt-4 rounded-[10px] bg-surface px-4 py-5 text-center text-[12.5px] font-semibold text-muted">
            Aún no hay lectores. Mientras tanto, la asistencia funciona con el método manual y el QR de la app.
          </div>
        )}
        {(dispositivos.data || []).map((d) => (
          <div key={d.id} className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-line bg-white px-4 py-3">
            <div>
              <div className="text-[13.5px] font-extrabold">{d.nombre}</div>
              <div className="text-[11.5px] font-semibold text-muted">
                {TIPOS_DISP.find(([v]) => v === d.tipo)?.[1] || d.tipo} · {DIRECCIONES.find(([v]) => v === d.direccion)?.[1]}
                {d.ultimo_latido ? ` · último latido ${new Date(d.ultimo_latido).toLocaleString('es-PE')}` : ' · nunca conectado'}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge bg={d.activo ? T.successBg : T.line2} color={d.activo ? T.success : T.muted}>{d.activo ? 'Activo' : 'Inactivo'}</Badge>
              <button onClick={() => setDisp(d)} className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[12px] text-muted hover:border-orange hover:text-orange">✏️</button>
            </div>
          </div>
        ))}
      </Card>

      {/* ── Enrolar credenciales ────────────────────────────────────────── */}
      <Card className="p-5">
        <div className="text-[14.5px] font-extrabold">Enrolar huella / rostro / tarjeta</div>
        <div className="mt-0.5 text-[12px] font-semibold text-muted">
          Pega el identificador que genera el lector al capturar (o el nº de tarjeta / PIN) y asígnalo a un socio o colaborador.
        </div>

        <div className="mt-4 flex gap-2">
          {[['socio', '🧍 Socio'], ['personal', '👔 Colaborador']].map(([v, l]) => (
            <button key={v} onClick={() => setTitular(v)}
              className={`flex-1 cursor-pointer rounded-[10px] border px-3 py-2.5 text-[12.5px] font-extrabold transition-colors ${titular === v ? 'border-orange bg-orange-50 text-orange' : 'border-line bg-white text-muted hover:border-orange'}`}>
              {l}
            </button>
          ))}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">{titular === 'socio' ? 'Socio' : 'Colaborador'}</span>
            {titular === 'socio' ? (
              <select value={cred.socioId} onChange={(e) => setCred({ ...cred, socioId: e.target.value })} className={inputCls + ' cursor-pointer'}>
                <option value="">Elige un socio…</option>
                {(socios || []).map((s) => <option key={s.id} value={s.id}>{s.nombre} · N.º {s.codigo}</option>)}
              </select>
            ) : (
              <select value={cred.usuarioId} onChange={(e) => setCred({ ...cred, usuarioId: e.target.value })} className={inputCls + ' cursor-pointer'}>
                <option value="">Elige un colaborador…</option>
                {(personal || []).filter((p) => p.activo).map((p) => <option key={p.id} value={p.id}>{p.nombre} · {p.rol_nombre}</option>)}
              </select>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Tipo</span>
            <select value={cred.tipo} onChange={(e) => setCred({ ...cred, tipo: e.target.value })} className={inputCls + ' cursor-pointer'}>
              {TIPOS_CRED.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">Identificador / valor</span>
            <input value={cred.valor} onChange={(e) => setCred({ ...cred, valor: e.target.value })} className={inputCls} placeholder="El ID que da el lector, o el nº de tarjeta / PIN" />
          </label>
        </div>
        <div className="mt-3">
          <PrimaryButton onClick={onEnrolar} disabled={enrolar.isPending}>Enrolar credencial</PrimaryButton>
        </div>

        {/* Lista de credenciales activas */}
        {credenciales.data?.length > 0 && (
          <div className="mt-5">
            <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">Credenciales activas ({credenciales.data.length})</div>
            {credenciales.data.map((c) => (
              <div key={c.id} className="flex items-center justify-between border-t border-line2 py-2.5">
                <div>
                  <div className="text-[13px] font-extrabold">
                    {c.socio?.nombre || c.usuario?.nombre || '—'}
                    <span className="ml-2 text-[11px] font-bold text-faint">{c.socio ? `Socio N.º ${c.socio.codigo}` : 'Colaborador'}</span>
                  </div>
                  <div className="text-[11.5px] font-semibold text-muted">{TIPOS_CRED.find(([v]) => v === c.tipo)?.[1] || c.tipo}</div>
                </div>
                <button onClick={() => quitar.mutate(c.id)} title="Quitar credencial"
                  className="cursor-pointer rounded-[9px] border border-line bg-white px-2.5 py-1.5 text-[11px] font-extrabold text-muted hover:border-red hover:text-red">
                  Quitar
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>
      </>
      )}
    </div>
  )
}
