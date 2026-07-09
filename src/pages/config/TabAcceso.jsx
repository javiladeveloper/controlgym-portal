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
import { useEstadoApiKey, useGenerarApiKey, useRevocarApiKey } from '../../hooks/useApiKey.js'
import { toast } from '../../lib/toast.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

const TIPOS_DISP = [
  ['huella', 'Huella dactilar'], ['facial', 'Reconocimiento facial'],
  ['tarjeta', 'Tarjeta / RFID'], ['tactil', 'Táctil / teclado'], ['qr', 'Lector QR'],
]
const DIRECCIONES = [['entrada', 'Solo entrada'], ['salida', 'Solo salida'], ['ambos', 'Entrada y salida']]
const TIPOS_CRED = [['huella', 'Huella'], ['facial', 'Rostro'], ['tarjeta', 'Tarjeta'], ['pin', 'PIN']]
const EMPTY_DISP = { nombre: '', tipo: 'huella', direccion: 'entrada', identificador: '', activo: true, sede_id: '' }

// Métodos de control de acceso (uno por gimnasio). El valor va a
// empresa.metodo_checkin; usa_carnet_qr queda como columna derivada.
// muestra=true → la app enseña el carnet QR (kiosco/lector). requiereHw=true →
// necesita hardware que aún no tenemos: se muestra deshabilitado (fase 2).
const METODOS = [
  { v: 'boton_app',   titulo: 'Botón en la app',      desc: 'El socio marca su entrada desde su app. Sin hardware.',                 muestra: true },
  { v: 'qr_kiosco',   titulo: 'QR con app-kiosco',    desc: 'Una tablet/celular en recepción escanea el QR de la app del socio.',    muestra: true },
  { v: 'sin_control', titulo: 'Sin control de acceso', desc: 'No registras entradas. La app oculta carnet, racha y visitas.',         muestra: false },
  { v: 'qr_lector',   titulo: 'QR con lector físico',  desc: 'Torniquete/lector de QR en la puerta.',   requiereHw: true, muestra: true },
  { v: 'biometrico',  titulo: 'Molinete biométrico',  desc: 'Huella o rostro en un torniquete.',        requiereHw: true, muestra: true },
]

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

  // Método de control de acceso del gym (empresa.metodo_checkin). Reemplaza al
  // antiguo toggle booleano: ahora es una opción única entre 5 métodos.
  // usa_carnet_qr quedó como columna derivada (la recalcula un trigger), así que
  // la app y el resto del panel siguen viendo el booleano correcto.
  const guardarEmpresa = useGuardarEmpresa(empresa?.id)
  const [metodo, setMetodo] = useState(null) // null=cargando
  const [pin, setPin] = useState('')
  useEffect(() => {
    if (!empresa?.id) return
    setMetodo(null)
    supabase.from('empresa').select('metodo_checkin, pin_kiosco').eq('id', empresa.id).single()
      .then(({ data, error }) => {
        // Si falla la consulta, no bloqueamos la UI: asumimos el default seguro.
        if (error) { setMetodo('boton_app'); return }
        setMetodo(data?.metodo_checkin ?? 'boton_app')
        setPin(data?.pin_kiosco ?? '')
      })
  }, [empresa?.id])
  const cargando = metodo === null
  // La app muestra el carnet salvo en 'sin_control' (mantiene el gating de la app).
  const usaQr = metodo !== 'sin_control'

  function elegirMetodo(nuevo) {
    const anterior = metodo
    setMetodo(nuevo)
    guardarEmpresa.mutate({ metodo_checkin: nuevo }, {
      onSuccess: () => toast.ok('Método de acceso actualizado'),
      onError: (e) => { setMetodo(anterior); toast.error(e.message) },
    })
  }

  function guardarPin() {
    const limpio = pin.trim()
    if (limpio && !/^\d{4,8}$/.test(limpio)) { toast.error('El PIN debe tener entre 4 y 8 dígitos'); return }
    guardarEmpresa.mutate({ pin_kiosco: limpio || null }, {
      onSuccess: () => toast.ok(limpio ? 'PIN del kiosco guardado' : 'PIN del kiosco quitado'),
      onError: (e) => toast.error(e.message),
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
      {/* Selector de método de control de acceso (opción única por gimnasio) */}
      <Card className="p-5">
        <div className="text-[14.5px] font-extrabold">Método de control de acceso</div>
        <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
          Elige <b>cómo</b> tus socios registran su entrada. Aplica a socios y personal por igual.
          Si eliges <b>Sin control</b>, la app del socio ocultará su carnet QR, racha y visitas.
        </div>

        {cargando ? (
          <div className="mt-4"><LoadingState variant="table" rows={3} /></div>
        ) : (
          <div className="mt-4 flex flex-col gap-2.5">
            {METODOS.map((m) => {
              const activo = metodo === m.v
              const bloqueado = m.requiereHw
              return (
                <button key={m.v}
                  onClick={() => !bloqueado && !activo && elegirMetodo(m.v)}
                  disabled={bloqueado || guardarEmpresa.isPending}
                  className={`flex items-start gap-3 rounded-[12px] border px-4 py-3 text-left transition-colors ${
                    activo ? 'border-orange bg-orange-50'
                    : bloqueado ? 'cursor-not-allowed border-line bg-surface opacity-70'
                    : 'cursor-pointer border-line bg-white hover:border-orange'}`}>
                  {/* Radio */}
                  <span className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full border-2 ${activo ? 'border-orange' : 'border-line2'}`}>
                    {activo && <span className="h-2 w-2 rounded-full bg-orange" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-[13.5px] font-extrabold ${activo ? 'text-orange' : ''}`}>{m.titulo}</span>
                      {bloqueado && <Badge bg={T.line2} color={T.muted}>Requiere integración</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[12px] font-semibold text-muted">{m.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* PIN del kiosco: solo relevante cuando la app corre como escáner (qr_kiosco) */}
        {metodo === 'qr_kiosco' && (
          <div className="mt-4 rounded-[12px] border border-line bg-[#FAFBFC] p-4">
            <div className="text-[13px] font-extrabold">PIN para salir del modo kiosco</div>
            <div className="mt-0.5 text-[12px] font-semibold leading-[1.5] text-muted">
              La app en modo escáner ocupa toda la pantalla. Este PIN evita que un socio la cierre y husmee.
              Déjalo vacío para usar el predeterminado.
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-muted">PIN (4–8 dígitos)</span>
                <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  inputMode="numeric" className={inputCls + ' w-40'} placeholder="1234" />
              </label>
              <PrimaryButton onClick={guardarPin} disabled={guardarEmpresa.isPending}>Guardar PIN</PrimaryButton>
            </div>
          </div>
        )}
      </Card>

      {/* Lectores/credenciales: solo si el gym controla acceso (cualquier método
          salvo 'sin_control'). Mientras carga no se pinta para evitar el salto. */}
      {usaQr && !cargando && (
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

      {/* ── Clave de conexión de hardware (molinetes/lectores) ──────────── */}
      <ClaveConexion />

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

        {!sedeId && (
          <div className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12px] font-bold text-amber-700">
            Elige una sede específica (arriba a la izquierda) para ver sus socios y colaboradores y poder enrolarlos.
          </div>
        )}

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

// Clave de conexión: la API key que el "Agente Puente" (software en la PC del
// gym) usa para que su molinete/lector hable con FitCore. Se genera de un clic,
// se muestra UNA vez, y se pega en el agente. Esto es lo que permite conectar
// hardware en cualquier sede sin configuración manual de nuestra parte.
function ClaveConexion() {
  const { empresa } = useAuth()
  const estado = useEstadoApiKey(empresa?.id)
  const generar = useGenerarApiKey(empresa?.id)
  const revocar = useRevocarApiKey(empresa?.id)
  const [claveVisible, setClaveVisible] = useState(null) // la clave en claro, solo tras generar

  const soloAdmin = estado.data?.motivo === 'solo_admin'
  const existe = estado.data?.existe === true

  function onGenerar() {
    if (existe && !window.confirm('Ya tienes una clave. Generar una nueva invalidará la anterior: los equipos con la clave vieja dejarán de funcionar hasta actualizarla. ¿Continuar?')) return
    generar.mutate(undefined, {
      onSuccess: (r) => { setClaveVisible(r.api_key); toast.ok('Clave generada. Cópiala ahora: no se volverá a mostrar.') },
      onError: (e) => toast.error(e.message),
    })
  }

  function onCopiar() {
    navigator.clipboard?.writeText(claveVisible).then(
      () => toast.ok('Clave copiada'),
      () => toast.error('No se pudo copiar; selecciónala manualmente'),
    )
  }

  function onRevocar() {
    if (!window.confirm('¿Revocar la clave? Tus molinetes/lectores dejarán de registrar accesos hasta que generes una nueva.')) return
    revocar.mutate(undefined, {
      onSuccess: () => { setClaveVisible(null); toast.ok('Clave revocada.') },
      onError: (e) => toast.error(e.message),
    })
  }

  if (soloAdmin) return null // solo el admin gestiona el hardware

  return (
    <Card className="p-5">
      <div className="text-[14.5px] font-extrabold">Clave de conexión de equipos</div>
      <p className="mt-0.5 text-[12.5px] font-semibold leading-[1.5] text-muted">
        Si instalas un <b>molinete o lector físico</b>, esta clave conecta tu equipo con FitCore.
        Instala el <b>Agente FitCore</b> en la PC del gimnasio y pégale esta clave. No necesitas
        que vayamos: tú lo activas.
      </p>

      {/* Clave recién generada (solo se ve una vez) */}
      {claveVisible && (
        <div className="mt-4 rounded-[12px] border border-orange/40 bg-orange/5 p-4">
          <div className="text-[11.5px] font-extrabold uppercase tracking-[0.5px] text-orange">Tu clave (cópiala ahora, no se vuelve a mostrar)</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-[8px] border border-line bg-white px-3 py-2 font-mono text-[12.5px] font-bold">{claveVisible}</code>
            <button onClick={onCopiar} className="cursor-pointer rounded-[9px] border border-orange bg-white px-3 py-2 text-[12.5px] font-extrabold text-orange hover:bg-orange-50">Copiar</button>
          </div>
        </div>
      )}

      {estado.isLoading ? (
        <div className="mt-4"><LoadingState variant="table" rows={1} /></div>
      ) : existe ? (
        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-line bg-[#FAFBFC] px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-[13px] font-extrabold">
                <span className="text-success">✓</span> Clave activa
                <span className="font-mono text-[12px] font-bold text-muted">{estado.data.prefix}…</span>
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-muted">
                {estado.data.ultima_usada
                  ? `Último equipo conectado: ${new Date(estado.data.ultima_usada).toLocaleString('es-PE')}`
                  : 'Aún ningún equipo se ha conectado con esta clave.'}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={onGenerar} disabled={generar.isPending} className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12.5px] font-extrabold text-muted hover:border-orange hover:text-orange">Regenerar</button>
              <button onClick={onRevocar} disabled={revocar.isPending} className="cursor-pointer rounded-[9px] border border-line bg-white px-3 py-2 text-[12.5px] font-extrabold text-muted hover:border-red hover:text-red">Revocar</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <PrimaryButton onClick={onGenerar} disabled={generar.isPending}>
            {generar.isPending ? 'Generando…' : 'Generar clave de conexión'}
          </PrimaryButton>
          <p className="mt-2 text-[11.5px] font-semibold text-faint">
            Solo la necesitas si usas molinete o lector físico. Puedes generarla cuando instales tu equipo.
          </p>
        </div>
      )}
    </Card>
  )
}
