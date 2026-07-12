import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import Topbar from '../components/Topbar.jsx'
import ChecklistActivacion from '../components/ChecklistActivacion.jsx'
import { Card, StatCard, Avatar } from '../components/ui.jsx'
import { BoxIcon, DocIcon, ClockIcon, WhatsAppIcon } from '../components/icons.jsx'
import { LoadingState, ErrorState } from '../components/states.jsx'
import Modal, { inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { usePanel } from '../store.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useDashboardKpis, useCheckins, useAforo } from '../hooks/useDashboard.js'
import { useClientes } from '../hooks/useClientes.js'
import { useCamaras } from '../hooks/useCamaras.js'
import { useFotosPendientes, useModerarFoto } from '../hooks/useGaleria.js'
import { useReporteComercial } from '../hooks/useReportes.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'
import { iniciales, money } from '../lib/uiHelpers.js'
import { waLink, msgCumple } from '../lib/whatsapp.js'

// Check-in manual desde recepción: busca al socio y registra entrada/salida.
function CheckinModal({ sedeId, onClose }) {
  const qc = useQueryClient()
  const { data: clientes } = useClientes(sedeId)
  const [q, setQ] = useState('')
  const [qr, setQr] = useState('')
  const [resultado, setResultado] = useState(null) // { resultado, motivo, socio }
  const [busy, setBusy] = useState(false)

  // Valida el carnet QR de la app (firma + expiración) y registra la entrada.
  // Se procesa el resultado ANTES de limpiar el input y solo se vacía si hubo
  // respuesta; ante un fallo de red (throw) se muestra el error y se conserva
  // el código para reintentar sin re-escanear.
  async function validarQr() {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('validar_qr', { p_qr: qr.trim(), p_sede_id: sedeId })
      if (error) { setResultado({ resultado: 'error', motivo: error.message, socio: 'Carnet QR' }); return }
      setResultado(data)
      setQr('')
      qc.invalidateQueries({ queryKey: ['checkins', sedeId] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
      qc.invalidateQueries({ queryKey: ['aforo-actual', sedeId] })
    } catch (e) {
      setResultado({ resultado: 'error', motivo: e?.message || 'Error de red', socio: 'Carnet QR' })
    } finally {
      setBusy(false)
    }
  }

  // Busca por nombre, DNI o N.º de socio (nadie se acuerda de su código;
  // el DNI sí lo tienen a la mano)
  const matches = (clientes || []).filter(
    (c) => q.trim() && (
      c.nombre.toLowerCase().includes(q.toLowerCase())
      || c.documento?.includes(q.trim())
      || c.codigo?.includes(q.trim())
    ),
  ).slice(0, 6)

  async function registrar(socio, direccion) {
    setBusy(true)
    try {
      const { data, error } = await supabase.rpc('checkin_manual', {
        p_socio_id: socio.id, p_sede_id: sedeId, p_direccion: direccion,
      })
      if (error) { setResultado({ resultado: 'error', motivo: error.message, socio: socio.nombre }); return }
      setResultado({ ...data, socio_id: socio.id }) // guardamos el id para el cambio de sede
      qc.invalidateQueries({ queryKey: ['checkins', sedeId] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
      qc.invalidateQueries({ queryKey: ['asistencia-hora', sedeId] })
      // El aforo en vivo también cambia con cada entrada/salida registrada:
      // sin esto la tarjeta quedaba vieja hasta 30 s ("marqué y sigue en 0").
      qc.invalidateQueries({ queryKey: ['aforo-actual', sedeId] })
    } catch (e) {
      setResultado({ resultado: 'error', motivo: e?.message || 'Error de red', socio: socio.nombre })
    } finally {
      setBusy(false)
    }
  }

  // Cambiar al socio a ESTA sede (gratis) cuando fue denegado por 'otra_sede'.
  // Actualiza socio.sede_id y reintenta el check-in.
  async function cambiarSedeYReintentar() {
    if (!resultado?.socio_id) return
    setBusy(true)
    try {
      const { error } = await supabase.from('socio').update({ sede_id: sedeId }).eq('id', resultado.socio_id)
      if (error) throw error
      await registrar({ id: resultado.socio_id, nombre: resultado.socio }, 'entrada')
    } catch (e) {
      setResultado({ ...resultado, motivo: e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Check-in de recepción" subtitle="Busca al socio y registra su entrada o salida" onClose={onClose} width={440}>
      {resultado ? (
        <div>
          <div className={`rounded-[10px] p-4 text-center ${resultado.resultado === 'permitido' ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className={`text-[22px] font-extrabold ${resultado.resultado === 'permitido' ? 'text-green-600' : 'text-red'}`}>
              {resultado.resultado === 'permitido' ? '✓ Acceso permitido' : '✕ Acceso denegado'}
            </div>
            {/* Foto aprobada del socio: recepción corrobora que es la misma persona
                (anti-suplantación en gyms sin huellero). Sin foto → solo el nombre. */}
            {resultado.foto_url && (
              <img src={resultado.foto_url} alt="" className="mx-auto mt-2.5 h-24 w-24 rounded-[14px] border-2 border-white object-cover shadow" />
            )}
            <div className="mt-1 text-[14px] font-bold">{resultado.socio}</div>
            {resultado.foto_url && (
              <div className="text-[11px] font-semibold text-muted">¿Es la misma persona?</div>
            )}
            {resultado.motivo && (
              <div className="mt-1.5 text-[12.5px] font-bold text-red">
                {resultado.motivo === 'membresia_vencida' ? 'Membresía vencida — ofrécele renovar'
                  : resultado.motivo === 'otra_sede' ? 'Su membresía es de otra sede'
                  : resultado.motivo}
              </div>
            )}
          </div>
          {/* Denegado por sede: opción de moverlo a esta sede (gratis) */}
          {resultado.motivo === 'otra_sede' && resultado.socio_id && (
            <button onClick={cambiarSedeYReintentar} disabled={busy}
              className="mt-3 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-60">
              Cambiar a esta sede y dejar entrar (gratis)
            </button>
          )}
          <div className="mt-3 flex gap-2.5">
            <button onClick={() => { setResultado(null); setQ('') }}
              className="flex-1 cursor-pointer rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-extrabold text-muted hover:border-orange">Otro socio</button>
            <button onClick={onClose}
              className="flex-1 cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600">Listo</button>
          </div>
        </div>
      ) : (
        <div>
          {/* Carnet QR de la app: el lector USB "tipea" el código y da Enter */}
          <input value={qr} onChange={(e) => setQr(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && qr.trim()) validarQr() }}
            className={inputCls + ' border-dashed'}
            placeholder="📷 Escanea el carnet QR de la app aquí (o pega el código)…" />
          <div className="my-2.5 flex items-center gap-2 text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-faint">
            <span className="h-px flex-1 bg-line" />o busca manual<span className="h-px flex-1 bg-line" />
          </div>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={inputCls}
            placeholder="Nombre, DNI o N.º de socio…" />
          <div className="mt-2.5 flex flex-col gap-1.5">
            {matches.map((c) => {
              const mem = c.membresia?.[0]
              const activa = mem?.estado === 'activa'
              return (
                <div key={c.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-line bg-white px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-extrabold">{c.nombre}</div>
                    <div className="text-[11px] font-semibold text-muted">
                      N.º {c.codigo}{c.documento ? ` · DNI ${c.documento}` : ''} · {mem ? `${mem.plan?.nombre || 'Plan'} ${activa ? 'activa' : mem.estado}` : 'sin membresía'}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 gap-1.5">
                    <button disabled={busy} onClick={() => registrar(c, 'entrada')}
                      className="cursor-pointer rounded-lg border-none bg-green px-3 py-1.5 text-[11.5px] font-extrabold text-white disabled:opacity-50">Entrada</button>
                    <button disabled={busy} onClick={() => registrar(c, 'salida')}
                      className="cursor-pointer rounded-lg border border-line bg-white px-3 py-1.5 text-[11.5px] font-extrabold text-muted hover:border-orange disabled:opacity-50">Salida</button>
                  </div>
                </div>
              )
            })}
            {q.trim() && matches.length === 0 && (
              <div className="rounded-[10px] bg-surface px-3 py-4 text-center text-[12.5px] font-semibold text-muted">
                No se encontró. ¿Es nuevo? Inscríbelo desde Clientes.
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}

// Etiqueta legible del método de ingreso (antes se mostraba "Huella verificada"
// para TODO acceso permitido, aunque fuera QR, DNI manual, rostro, etc.).
function etiquetaMetodo(metodo) {
  switch (metodo) {
    case 'huella': return 'Huella verificada'
    case 'facial':
    case 'rostro': return 'Rostro verificado'
    case 'qr':
    case 'carnet': return 'Carnet QR'
    case 'dni':
    case 'documento': return 'DNI verificado'
    case 'manual': return 'Registro manual'
    case 'tarjeta': return 'Tarjeta'
    case 'pin': return 'PIN'
    default: return 'Acceso permitido'
  }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { sedeId, sedeNombre } = usePanel()
  const { usuario, empresa, rol } = useAuth()
  // Los especialistas (entrenador/nutricionista) no ven la plata del gym
  const veIngresos = rol === 'admin' || rol === 'recepcion'
  const [checkinOpen, setCheckinOpen] = useState(false)
  const kpis = useDashboardKpis(sedeId)
  const checkins = useCheckins(sedeId)
  const aforo = useAforo(sedeId)
  const clientes = useClientes(sedeId)

  // Cumpleaños del mes 🎂. Se saluda a todo socio "en el gym" (activo o moroso:
  // sigue siendo cliente y saludarlo retiene); se excluyen inactivo/suspendido.
  // Antes exigía estado === 'activo' exacto y omitía, p.ej., a un moroso o a un
  // reactivado cuyo estado no quedó exactamente en 'activo'.
  const ESTADOS_SALUDAR = new Set(['activo', 'moroso'])
  const mesActual = new Date().getMonth()
  const diaHoy = new Date().getDate()
  const cumpleanieros = (clientes.data || [])
    .filter((c) => ESTADOS_SALUDAR.has(c.estado) && c.fecha_nacimiento && new Date(c.fecha_nacimiento + 'T12:00:00').getMonth() === mesActual)
    .map((c) => ({ ...c, dia: new Date(c.fecha_nacimiento + 'T12:00:00').getDate() }))
    .sort((a, b) => a.dia - b.dia)

  const nombre = usuario?.nombre?.split(' ')[0] || ''
  const moneda = empresa?.moneda || 'PEN'

  // Delta de aforo: solo se muestra si el porcentaje es un número finito
  // (aforo_max nulo/0 o en_sede_hoy nulo darían NaN/Infinity → deja el hueco).
  const aforoPct = kpis.data && kpis.data.aforo_max
    ? (Number(kpis.data.en_sede_hoy) / Number(kpis.data.aforo_max)) * 100
    : NaN
  const aforoDelta = Number.isFinite(aforoPct) ? `aforo ${Math.round(aforoPct)}%` : ' '

  // Color de la barra de aforo en vivo según el % ocupado.
  const aforoBar = aforo.data && aforo.data.aforo_max
    ? (aforo.data.pct >= 90 ? 'bg-red' : aforo.data.pct >= 70 ? 'bg-amber-500' : 'bg-green')
    : null

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <Topbar title={`Buen día${nombre ? ', ' + nombre : ''}`} subtitle={sedeNombre} />

      {/* Primeros pasos del negocio (desaparece al completarse) */}
      <ChecklistActivacion />

      {/* KPIs */}
      {kpis.isLoading && <LoadingState variant="kpis" />}
      {kpis.error && <ErrorState error={kpis.error} onRetry={kpis.refetch} />}
      {kpis.data && (
        <div className="mt-[22px] grid grid-cols-2 gap-3 lg:grid-cols-4 sm:gap-[15px]">
          {/* Un solo slot de aforo: con aforo_max configurado se muestra la tarjeta
              en vivo (regla 2h + barra); sin configurar, el conteo simple del día.
              (Antes había DOS tarjetas para lo mismo — duplicado detectado en QA.) */}
          {/* Cada KPI navega a su detalle (pedido del owner: "clic en por vencer
              → quiénes son"). cursor-pointer + hover para que se note. */}
          {aforoBar ? (
            <div onClick={() => navigate('/reportes?tab=asistencia')} title="Ver asistencias en Reportes"
              className="cursor-pointer rounded-card border border-line bg-white p-[17px] transition-colors hover:border-orange">
              <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-muted">🏟️ Aforo ahora</div>
              <div className="mt-1.5 text-[27px] font-extrabold tabular-nums text-ink">
                {aforo.data.dentro}<span className="text-[15px] font-bold text-faint">/{aforo.data.aforo_max}</span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line2">
                <div className={`h-full rounded-full ${aforoBar}`} style={{ width: `${Math.min(100, Math.max(0, aforo.data.pct))}%` }} />
              </div>
            </div>
          ) : (
            <div onClick={() => navigate('/reportes?tab=asistencia')} title="Ver asistencias en Reportes" className="cursor-pointer transition-opacity hover:opacity-80">
              <StatCard label="En la sede ahora" value={kpis.data.en_sede_hoy ?? 0}
                delta={aforoDelta} />
            </div>
          )}
          <div onClick={() => navigate('/clientes')} title="Ver clientes" className="cursor-pointer transition-opacity hover:opacity-80">
            <StatCard label="Socios activos" value={kpis.data.socios_activos ?? 0} delta="con membresía vigente" />
          </div>
          {veIngresos && (
            <div onClick={() => navigate('/reportes?tab=ventas')} title="Ver reporte de ventas" className="cursor-pointer transition-opacity hover:opacity-80">
              <StatCard label="Ingresos del mes" value={money(kpis.data.ingresos_mes, moneda)} delta="membresías + ventas" />
            </div>
          )}
          <div onClick={() => navigate('/membresias')} title="Ver quiénes están por vencer"
            className="cursor-pointer rounded-card border border-orange-100 bg-orange-50 p-[17px] transition-colors hover:border-orange">
            <div className="text-[11px] font-extrabold uppercase tracking-[0.6px] text-orange">Por vencer (7 días)</div>
            <div className="mt-1.5 text-[27px] font-extrabold text-orange">{kpis.data.por_vencer_7d ?? 0}</div>
            <div className="mt-0.5 text-[12px] font-bold text-muted">membresías → ver quiénes</div>
          </div>
        </div>
      )}

      {/* Metas de hoy por vendedor: solo si el gym configuró alguna meta diaria */}
      {veIngresos && <MetasHoy usuario={usuario} rol={rol} moneda={moneda} />}

      {/* Live check-ins (el histórico de asistencia por hora/día vive en Reportes) */}
      <div className="mt-[15px] grid grid-cols-1 gap-[15px]">
        <Card className="flex flex-col p-[19px]">
          <div className="flex items-center justify-between">
            <div className="text-[14.5px] font-extrabold">Check-ins</div>
            <div className="flex items-center gap-2">
              <button onClick={() => setCheckinOpen(true)}
                className="cursor-pointer rounded-[9px] border-none bg-orange px-3 py-1.5 text-[11.5px] font-extrabold text-white hover:bg-orange-600">
                + Registrar
              </button>
              <div className="flex items-center gap-1.5 rounded-full bg-orange-50 px-[11px] py-1">
                <span className="h-[7px] w-[7px] animate-pulseDot rounded-full bg-orange" />
                <span className="text-[10.5px] font-extrabold tracking-[0.8px] text-orange">EN VIVO</span>
              </div>
            </div>
          </div>
          {checkinOpen && <CheckinModal sedeId={sedeId} onClose={() => setCheckinOpen(false)} />}
          <div className="mt-2 flex-1 overflow-hidden">
            {checkins.isLoading && <div className="py-4 text-[12.5px] font-semibold text-muted">Cargando…</div>}
            {checkins.error && (
              <div className="py-4 text-center text-[12.5px] font-semibold text-red">
                No se pudieron cargar los check-ins.{' '}
                <button onClick={() => checkins.refetch()} className="cursor-pointer font-extrabold underline">Reintentar</button>
              </div>
            )}
            {!checkins.error && checkins.data?.length === 0 && <div className="py-4 text-[12.5px] font-semibold text-muted">Sin check-ins hoy.</div>}
            {(checkins.data || []).map((c) => {
              const permit = c.resultado === 'permitido'
              return (
                <div key={c.id} className="flex animate-fadeSlide items-center gap-2.5 border-b border-line2 py-[9.5px]">
                  {/* Foto aprobada del socio = verificación visual de identidad (sin huellero) */}
                  {c.socio?.foto_estado === 'aprobada' && c.socio?.foto_url ? (
                    <img src={c.socio.foto_url} alt="" className={`h-[34px] w-[34px] flex-shrink-0 rounded-full object-cover ${permit ? '' : 'ring-2 ring-red'}`} />
                  ) : (
                    <Avatar ini={iniciales(c.socio?.nombre || '?')} bg={permit ? T.chipNavy : T.dangerBg} color={permit ? T.navy : T.danger} size={34} fontSize={12} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-extrabold text-ink">{c.socio?.nombre || 'Desconocido'}</div>
                    <div className="text-[11px] font-bold" style={{ color: permit ? T.faint : T.danger }}>
                      {permit ? etiquetaMetodo(c.metodo) : (c.motivo || 'Acceso denegado')}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-[12px] font-extrabold text-ink">
                      {new Date(c.ocurrido_en).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {/* Verde = entró · gris = salió · rojo = denegado (de un vistazo) */}
                    <div className="text-[10.5px] font-extrabold capitalize" style={{ color: !permit ? T.danger : c.direccion === 'salida' ? T.muted : T.success }}>
                      {c.direccion === 'salida' ? '↑ salida' : '↓ entrada'}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={() => navigate('/reportes?tab=asistencia')}
            className="mt-2 cursor-pointer self-start border-none bg-transparent p-0 text-[11.5px] font-extrabold text-orange hover:underline">
            Ver tendencias en Reportes →
          </button>
        </Card>
      </div>

      {/* Cumpleaños del mes: saludarlos retiene 🎂 */}
      {cumpleanieros.length > 0 && (
        <Card className="mt-[15px] p-[19px]">
          <div className="text-[14.5px] font-extrabold">🎂 Cumpleaños de {new Date().toLocaleDateString('es-PE', { month: 'long' })} ({cumpleanieros.length})</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">Un saludo por WhatsApp retiene más que cualquier promo.</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {cumpleanieros.map((c) => {
              const esHoy = c.dia === diaHoy
              const wa = c.telefono && waLink(c.telefono, msgCumple({ socio: c.nombre, gym: empresa?.nombre }))
              return (
                <div key={c.id}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${esHoy ? 'border-orange bg-orange-50' : 'border-line bg-white'}`}>
                  <span className="text-[12.5px] font-extrabold">{esHoy ? '🎉 ' : ''}{c.nombre}</span>
                  <span className="text-[11px] font-bold text-faint">{c.dia} {esHoy ? '· ¡HOY!' : ''}</span>
                  {wa && (
                    <a href={wa} target="_blank" rel="noreferrer" title="Saludarlo por WhatsApp"
                      className="flex h-6 w-6 items-center justify-center rounded-full"
                      style={{ background: '#25D366' }}><WhatsAppIcon size={13} /></a>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* La serie de ingresos por día (últimos 14 días) ya vive en Reportes → Ventas */}
      {veIngresos && (
        <button onClick={() => navigate('/reportes?tab=ventas')}
          className="mt-[15px] cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-orange hover:underline">
          Ver ingresos por día en Reportes →
        </button>
      )}

      {/* Accesos rápidos: cada tarjeta lleva al módulo correspondiente */}
      <div className="mt-[15px] grid grid-cols-1 gap-[15px] lg:grid-cols-3">
        <Card onClick={() => navigate('/kardex')}
          className="flex cursor-pointer items-center gap-3 p-[15px] transition-shadow hover:shadow-md">
          <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-orange-50"><BoxIcon stroke={T.primary} /></div>
          <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Revisa el <span className="font-extrabold">Kardex</span> para productos con stock bajo</div>
        </Card>
        <Card onClick={() => navigate('/rutinas')}
          className="flex cursor-pointer items-center gap-3 p-[15px] transition-shadow hover:shadow-md">
          <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-chipnavy"><DocIcon stroke={T.navy} /></div>
          <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Socios esperando <span className="font-extrabold">rutina nueva</span> esta semana</div>
        </Card>
        {veIngresos && (
          <Card onClick={() => navigate('/finanzas')}
            className="flex cursor-pointer items-center gap-3 p-[15px] transition-shadow hover:shadow-md">
            <div className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[10px] bg-green-50"><ClockIcon stroke={T.success} /></div>
            <div className="text-[12.5px] font-bold leading-[1.45] text-ink">Revisa la <span className="font-extrabold">caja del día</span> en Finanzas</div>
          </Card>
        )}
      </div>

      {/* Cámaras en vivo (solo admin/recepción, si el gym configuró alguna) */}
      {veIngresos && <CamarasEnVivo empresaId={empresa?.id} sedeId={sedeId} />}

      {/* Fotos de la galería social por aprobar (solo si hay pendientes) */}
      {veIngresos && <FotosPorAprobar empresaId={empresa?.id} />}
    </div>
  )
}

// Tarjeta compacta "Metas de hoy": venta de HOY vs meta diaria por vendedor.
// Solo se muestra si hay al menos una meta configurada (algún meta_diaria >
// 0 en por_dia_hoy) — si nadie tiene meta, la tarjeta no aporta nada y no se
// pinta (directiva: solo lo accionable de HOY). Admin ve a todo el equipo;
// recepción solo su propia fila (no es su lugar ver la meta de otros).
function MetasHoy({ usuario, rol, moneda }) {
  const q = useReporteComercial() // sin params = mes actual; por_dia_hoy es de HOY
  // Filtro Hoy | Mes (pedido del owner: la cuota real del equipo es mensual,
  // pero el pulso del día también importa).
  const [vista, setVista] = useState('hoy')

  // HOY viene de por_dia_hoy; MES de vendedores (periodo = mes actual).
  const filasHoy = (q.data?.por_dia_hoy || []).filter((v) => Number(v.meta_diaria) > 0 || Number(v.meta_leads) > 0)
  const filasMes = (q.data?.vendedores || []).filter((v) => Number(v.meta_mensual) > 0 || Number(v.meta_leads_mes) > 0)
  const filas = vista === 'hoy' ? filasHoy : filasMes
  const propias = rol === 'admin' ? filas : filas.filter((v) => v.usuario_id === usuario?.id)
  // La tarjeta existe si hay CUALQUIER meta (de hoy o del mes) configurada.
  if (q.isLoading || q.error || (filasHoy.length === 0 && filasMes.length === 0)) return null

  return (
    <Card className="mt-[15px] p-[19px]">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[14.5px] font-extrabold">🎯 Metas del equipo</div>
        <div className="flex gap-1">
          {[['hoy', 'Hoy'], ['mes', 'Este mes']].map(([k, l]) => (
            <button key={k} onClick={() => setVista(k)}
              className={`cursor-pointer rounded-full border-none px-2.5 py-1 text-[11px] font-extrabold transition-colors ${vista === k ? 'bg-orange text-white' : 'bg-surface text-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {propias.length === 0 && (
        <div className="mt-2.5 text-[12.5px] font-semibold text-muted">
          Sin metas {vista === 'hoy' ? 'diarias' : 'mensuales'} configuradas — se definen en Personal.
        </div>
      )}
      <div className="mt-2.5 flex flex-col gap-3">
        {propias.map((v) => {
          const barras = []
          if (vista === 'hoy') {
            if (Number(v.meta_leads) > 0) barras.push({ etiqueta: `${v.leads_hoy || 0} de ${v.meta_leads} leads`, logrado: Number(v.leads_hoy || 0), meta: Number(v.meta_leads) })
            if (Number(v.meta_diaria) > 0) barras.push({ etiqueta: `${money(v.hoy || 0, moneda)} de ${money(v.meta_diaria, moneda)}`, logrado: Number(v.hoy || 0), meta: Number(v.meta_diaria) })
          } else {
            if (Number(v.meta_leads_mes) > 0) barras.push({ etiqueta: `${v.leads_periodo || 0} de ${v.meta_leads_mes} leads`, logrado: Number(v.leads_periodo || 0), meta: Number(v.meta_leads_mes) })
            if (Number(v.meta_mensual) > 0) barras.push({ etiqueta: `${money(v.ventas_total || 0, moneda)} de ${money(v.meta_mensual, moneda)}`, logrado: Number(v.ventas_total || 0), meta: Number(v.meta_mensual) })
          }
          return (
            <div key={v.usuario_id}>
              <div className="text-[12.5px] font-extrabold text-ink">{v.nombre}</div>
              {barras.map((b, i) => {
                const pct = Math.min(100, (b.logrado / b.meta) * 100)
                const cumplida = b.logrado >= b.meta
                return (
                  <div key={i} className="mt-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line2">
                        <div className={`h-full rounded-full ${cumplida ? 'bg-green' : 'bg-orange'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`flex-shrink-0 text-[11.5px] font-extrabold ${cumplida ? 'text-green-600' : 'text-orange'}`}>
                        {b.etiqueta}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Bloque colapsable de cámaras en vivo del gym. Embebe el enlace de la nube del
// fabricante que el gym pegó en Config → Cámaras. Solo se muestra si hay cámaras.
function CamarasEnVivo({ empresaId, sedeId }) {
  const [abierto, setAbierto] = useState(false)
  const camaras = useCamaras(empresaId, sedeId)
  // Cámaras de la sede activa + las que aplican a "todas las sedes" (sede_id null)
  const lista = (camaras.data || []).filter((c) => c.activa)
  if (lista.length === 0) return null

  return (
    <Card className="mt-[15px] p-5">
      <button onClick={() => setAbierto((v) => !v)}
        className="flex w-full cursor-pointer items-center justify-between border-none bg-transparent p-0 text-left">
        <div>
          <div className="text-[14.5px] font-extrabold">Cámaras en vivo 📹</div>
          <div className="mt-0.5 text-[12px] font-semibold text-muted">{lista.length} {lista.length === 1 ? 'cámara' : 'cámaras'} · toca para {abierto ? 'ocultar' : 'ver en vivo'}</div>
        </div>
        <span className="text-[18px] text-muted">{abierto ? '▲' : '▼'}</span>
      </button>

      {abierto && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {lista.map((c) => (
            <div key={c.id} className="overflow-hidden rounded-[12px] border border-line bg-navy">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[12.5px] font-extrabold text-white">{c.nombre}</span>
                <span className="flex items-center gap-1 text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-red-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> en vivo
                </span>
              </div>
              <div className="aspect-video w-full bg-black">
                <iframe src={c.url_embed} title={c.nombre} allow="autoplay; fullscreen"
                  className="h-full w-full border-none" referrerPolicy="no-referrer" />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// Fotos de la galería social (días festivos) por aprobar. Solo aparece si hay
// pendientes; recepción/admin aprueba o rechaza antes de que se vean en la app.
function FotosPorAprobar({ empresaId }) {
  const fotos = useFotosPendientes(empresaId)
  const moderar = useModerarFoto(empresaId)
  const lista = fotos.data || []
  if (lista.length === 0) return null

  return (
    <Card className="mt-[15px] p-5">
      <div className="flex items-center gap-2">
        <div className="text-[14.5px] font-extrabold">Fotos por aprobar 📸</div>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-extrabold text-amber-700">{lista.length}</span>
      </div>
      <div className="mt-0.5 text-[12px] font-semibold text-muted">
        Fotos que tus socios subieron a la galería. Apruébalas para que se vean en la app.
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {lista.map((f) => (
          <div key={f.id} className="overflow-hidden rounded-[12px] border border-line bg-white">
            <img src={f.foto_url} alt="" className="aspect-square w-full object-cover" />
            <div className="p-2.5">
              <div className="text-[12.5px] font-extrabold">{f.autor || 'Socio'}</div>
              {f.evento && <div className="text-[11px] font-semibold text-muted">{f.evento}</div>}
              <div className="mt-2 flex gap-2">
                <button onClick={() => moderar.mutate({ fotoId: f.id, aprobar: true })} disabled={moderar.isPending}
                  className="flex-1 cursor-pointer rounded-[8px] border-none bg-green py-1.5 text-[12px] font-extrabold text-white hover:bg-green-600 disabled:opacity-50">Aprobar</button>
                <button onClick={() => moderar.mutate({ fotoId: f.id, aprobar: false })} disabled={moderar.isPending}
                  className="flex-1 cursor-pointer rounded-[8px] border border-line bg-white py-1.5 text-[12px] font-extrabold text-muted hover:border-red hover:text-red disabled:opacity-50">Rechazar</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
