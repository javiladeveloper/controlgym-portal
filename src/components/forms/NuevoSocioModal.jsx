import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, BotonesModal, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { usePlanes } from '../../hooks/useMembresias.js'
import { usePromociones } from '../../hooks/useOperaciones.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { money } from '../../lib/uiHelpers.js'
import { waLink, msgRecibo } from '../../lib/whatsapp.js'
import { verificarDni, textoVerificacion } from '../../lib/dni.js'
import ObjetivoChips from './ObjetivoChips.jsx'
import { useObjetivos } from '../../hooks/usePlantillas.js'
import { toast } from '../../lib/toast.js'
import { METODOS_PAGO } from '../../lib/pagos.js'

// Alta de socio (+ membresía y cobro con promoción y método de pago).
// Si viene de un lead (leadId), lo convierte.
export default function NuevoSocioModal({ sedeId, onClose, prefill = {}, leadId = null }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const planes = usePlanes()
  const promos = usePromociones()
  const objetivos = useObjetivos()
  const [f, setF] = useState({
    nombre: prefill.nombre || '', telefono: prefill.telefono || '', email: prefill.email || '',
    documento: prefill.documento || '', fecha_nacimiento: '', objetivo: '', objetivo_id: '', plan_id: '', promocion_id: '', metodo_pago: 'efectivo',
    peso_kg: '', talla_m: '',
  })
  const [verif, setVerif] = useState(null) // resultado de la verificación de DNI (MAXFIND)
  const [dupSocio, setDupSocio] = useState(null) // ya existe un socio con este documento
  const [paso, setPaso] = useState('dni') // el documento es el paso 1 obligatorio; el resto del form viene después

  const [modoExistente, setModoExistente] = useState(false) // agregar membresía a un socio que ya existe

  // Si el documento ya es de un socio del gym, lo detectamos para ofrecer
  // agregarle una membresía en vez de duplicarlo (ex-socio que retoma, etc.)
  useEffect(() => {
    const doc = f.documento.trim()
    // Antes solo con >=8 (DNI). Bajamos a 6 para cubrir CE / pasaporte cortos:
    // el alta de extranjero se permite desde 6 caracteres, así que el chequeo
    // de duplicado debe cubrir ese mismo rango.
    if (doc.length < 6) { setDupSocio(null); return }
    const t = setTimeout(async () => {
      // Traemos también la sede para avisar si el socio pertenece a OTRA sede:
      // agregar_membresia_socio crea la membresía en la sede original del socio,
      // no en la que opera recepción. RLS ya aísla por empresa.
      const { data } = await supabase.from('socio')
        .select('id, nombre, codigo, estado, sede_id, sede:sede(nombre)').eq('documento', doc).is('deleted_at', null).limit(1)
      setDupSocio(data?.[0] || null)
    }, 400)
    return () => clearTimeout(t)
  }, [f.documento])
  const [invitados, setInvitados] = useState([]) // acompañantes de promos 2x1/grupal
  const [enPartes, setEnPartes] = useState(false) // paga una parte hoy, el resto después
  const [precioAcordado, setPrecioAcordado] = useState('') // monto pactado distinto al plan (pana/ex-socio)
  const [montoInicial, setMontoInicial] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState(null) // { codigo, total, promo }
  const [planAuto, setPlanAuto] = useState(null) // { asignado, objetivo, imc, categoria, rutina_dias, dieta_kcal_dia }

  // Traduce el error crudo de Postgres a un mensaje entendible. El índice
  // único uq_socio_documento_empresa lanza 23505 si el DNI ya existe (carrera
  // entre el dup-check con debounce y el submit, o dos recepciones a la vez).
  const mensajeError = (err) => {
    const m = err?.message || ''
    if (err?.code === '23505' || /duplicate key|uq_socio_documento/i.test(m)) {
      return 'Ese documento ya pertenece a un socio. Vuelve al paso 1 y usa "Agregarle una membresía" en vez de duplicarlo.'
    }
    return m
  }

  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const setInv = (i, k) => (e) => setInvitados((arr) => {
    const copia = [...arr]
    copia[i] = { ...(copia[i] || {}), [k]: e.target.value }
    return copia
  })
  const plan = (planes.data || []).find((p) => p.id === f.plan_id)
  const promosActivas = (promos.data || []).filter((p) => p.estado === 'activa')
  const promo = promosActivas.find((p) => p.id === f.promocion_id)

  // Verificación de DNI contra el padrón (con debounce). Al verificar, el
  // nombre OFICIAL COMPLETO se escribe solo en el campo Nombre (recepción
  // solo tipea 8 dígitos). Si el usuario luego edita el nombre, se le avisa
  // si deja de coincidir.
  useEffect(() => {
    const dni = f.documento.replace(/\D/g, '')
    if (dni.length !== 8) { setVerif(null); return }
    // No re-consultar si el nombre ya ES el oficial de este mismo DNI
    if (verif?.encontrado && verif._dni === dni && f.nombre === verif.nombre_oficial) return
    setVerif({ buscando: true })
    const t = setTimeout(async () => {
      const v = await verificarDni({ dni, nombre: f.nombre })
      setVerif({ ...v, _dni: dni })
      if (v.encontrado && v.nombre_oficial && f.nombre !== v.nombre_oficial) {
        // Pisa lo tipeado con el nombre del padrón (es el dato legal)
        setF((s) => ({ ...s, nombre: v.nombre_oficial }))
        setVerif({ ...v, _dni: dni, coincide: true, similitud: 1 })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [f.documento, f.nombre]) // eslint-disable-line react-hooks/exhaustive-deps

  // Paso 1 → 2: en cuanto el padrón responde (encontrado o no), se abre el
  // resto del formulario con el nombre oficial ya puesto
  useEffect(() => {
    if (paso === 'dni' && verif && !verif.buscando && !dupSocio) setPaso('form')
  }, [verif, paso, dupSocio])

  function cambiarDocumento() {
    setF((s) => ({ ...s, documento: '' }))
    setVerif(null)
    setPaso('dni')
  }

  // Promos de grupo: cuántos vienen y cuántos pagan
  const esGrupo = plan && promo && ['2x1', 'grupal'].includes(promo.tipo)
  const nInvitados = !esGrupo ? 0 : promo.tipo === '2x1' ? 1 : Math.max(1, (Number(promo.grupo_personas) || 3) - 1)
  const pagan = !esGrupo ? 1 : promo.tipo === '2x1' ? 1 : Math.min(Number(promo.grupo_pagan) || 2, nInvitados + 1)

  // Cálculo del total con promoción (espejo de la lógica del RPC)
  let precio = plan ? Number(plan.precio) : 0
  let matricula = plan && plan.cobra_matricula ? Number(plan.precio_matricula || 0) : 0
  let promoNota = ''
  if (plan && promo) {
    if (promo.tipo === 'descuento_pct') { precio = Math.round(precio * (1 - Number(promo.valor || 0) / 100) * 100) / 100; promoNota = `−${promo.valor}% en la mensualidad` }
    else if (promo.tipo === 'descuento_monto') { precio = Math.max(0, precio - Number(promo.valor || 0)); promoNota = `−${money(promo.valor, empresa?.moneda)}` }
    else if (promo.tipo === 'semana_gratis') { promoNota = '+7 días de membresía' }
    else if (promo.tipo === '2x1') { promoNota = 'la segunda persona entra gratis' }
    else if (promo.tipo === 'grupal') { promoNota = `vienen ${nInvitados + 1}, pagan ${pagan}` }
    else if (promo.tipo === 'precio_especial') {
      precio = Number(promo.valor || precio)
      promoNota = promo.duracion_meses
        ? `${promo.duracion_meses} meses de membresía por ${money(promo.valor, empresa?.moneda)}`
        : `precio especial ${money(promo.valor, empresa?.moneda)}`
    }
  }
  // Precio acordado (pana / ex-socio / trato): pisa la mensualidad, salvo en
  // promos de grupo (ahí el precio es por persona). Espejo del RPC.
  const acordadoNum = precioAcordado === '' ? null : Math.max(0, Number(precioAcordado) || 0)
  const usaAcordado = acordadoNum !== null && !esGrupo
  if (usaAcordado) { precio = acordadoNum; promoNota = '' }
  const total = precio * pagan + matricula
  // Pago en partes: solo sin promo de grupo (un pago compartido no se disgrega)
  const puedePartes = plan && !esGrupo && total > 0
  const inicial = enPartes && puedePartes ? Math.max(0, Math.min(Number(montoInicial) || 0, total)) : total
  const saldo = total - inicial

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    // Modo "socio existente": agrega membresía sin recrear al socio.
    if (modoExistente) {
      if (!f.plan_id) { setBusy(false); setError('Elige un plan para agregarle la membresía'); return }
      const { data, error } = await supabase.rpc('agregar_membresia_socio', {
        p_socio_id: dupSocio.id, p_plan_id: f.plan_id, p_metodo_pago: f.metodo_pago,
        p_promocion_id: f.promocion_id || null,
        p_precio_acordado: usaAcordado ? acordadoNum : null,
        p_monto_inicial: enPartes && puedePartes ? inicial : null,
        p_motivo: usaAcordado ? 'Descuento por volver' : null,
      })
      setBusy(false)
      if (error) { setError(mensajeError(error)); return }
      setExito({ codigo: data.codigo, total: data.total_cobrado, saldo: Number(data.saldo || 0), promo: data.nota, codigosInvitados: [] })
      qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
      qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
      qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
      return
    }
    const { data, error } = await supabase.rpc('inscribir_socio', {
      p_sede_id: sedeId,
      p_nombre: f.nombre, p_telefono: f.telefono || null, p_email: f.email || null,
      p_documento: f.documento || null,
      p_fecha_nacimiento: f.fecha_nacimiento || null,
      p_objetivo: f.objetivo || null,
      p_plan_id: f.plan_id || null,
      p_lead_id: leadId,
      p_promocion_id: f.promocion_id || null,
      p_metodo_pago: f.metodo_pago,
      p_invitados: esGrupo
        ? invitados.slice(0, nInvitados)
            .filter((i) => i?.nombre?.trim())
            .map((i) => ({ nombre: i.nombre.trim(), telefono: i.telefono || null, documento: i.documento || null }))
        : null,
      p_monto_inicial: enPartes && puedePartes ? inicial : null,
      p_precio_acordado: usaAcordado ? acordadoNum : null,
      p_objetivo_id: f.objetivo_id || null,
    })
    setBusy(false)
    if (error) { setError(mensajeError(error)); return }
    // Retroalimentar MAXFIND (fire-and-forget): DNI nuevo aporta el nombre, y
    // los datos que el gym completó (teléfono, correo, nacimiento) enriquecen
    // el padrón aunque el DNI ya existiera
    const dniLimpio = f.documento.replace(/\D/g, '')
    if (/^\d{8}$/.test(dniLimpio) && f.nombre.trim()) {
      const extra = {}
      if (f.telefono.trim()) extra.telefono = f.telefono.trim()
      if (f.email.trim()) extra.email = f.email.trim()
      if (f.fecha_nacimiento) extra.fecha_nacimiento = f.fecha_nacimiento
      if (verif?.encontrado === false || Object.keys(extra).length) {
        verificarDni({ dni: dniLimpio, nombre: f.nombre, alimentar: true, extra })
      }
    }
    // inscribir_socio no recibe peso/talla como parámetros, así que si el form
    // los capturó, los guardamos aparte y RECIÉN entonces pedimos la asignación
    // automática del plan (rutina+dieta según objetivo+IMC) — con el peso/talla
    // ya persistidos, para que asignar_plan_automatico no falle por sin_peso_talla.
    let planResultado = data.plan || null
    const pesoNum = f.peso_kg ? Number(f.peso_kg) : null
    const tallaNum = f.talla_m ? Number(f.talla_m) : null
    if (data.socio_id && f.objetivo_id && pesoNum > 0 && tallaNum > 0) {
      const { error: errUpd } = await supabase.from('socio')
        .update({ peso_kg: pesoNum, talla_m: tallaNum }).eq('id', data.socio_id)
      if (!errUpd) {
        const { data: planData, error: errPlan } = await supabase.rpc('asignar_plan_automatico', { p_socio_id: data.socio_id })
        if (!errPlan) planResultado = planData
      }
    } else if (data.socio_id && (pesoNum > 0 || tallaNum > 0)) {
      // Aunque no haya objetivo (o el plan no se haya podido asignar), igual
      // guardamos el peso/talla capturados: no se pierden datos del socio.
      await supabase.from('socio').update({ peso_kg: pesoNum || null, talla_m: tallaNum || null }).eq('id', data.socio_id)
    }
    setPlanAuto(planResultado)
    if (planResultado?.asignado) {
      toast.ok(`Plan asignado: ${planResultado.objetivo} · ${planResultado.rutina_dias} días + dieta ${planResultado.dieta_kcal_dia} kcal (IMC ${planResultado.imc}, ${planResultado.categoria})`)
    }
    setExito({ codigo: data.codigo, total: data.total_cobrado, saldo: Number(data.saldo || 0), promo: data.promo_aplicada, codigosInvitados: data.codigos_invitados || [] })
    qc.invalidateQueries({ queryKey: ['clientes', sedeId] })
    qc.invalidateQueries({ queryKey: ['membresias', sedeId] })
    qc.invalidateQueries({ queryKey: ['socios-select', sedeId] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis', sedeId] })
    qc.invalidateQueries({ queryKey: ['finanzas', sedeId] })
    if (leadId) qc.invalidateQueries({ queryKey: ['leads', sedeId] })
  }

  if (exito) {
    return (
      <Modal title={modoExistente ? '¡Membresía agregada! 🎉' : exito.codigosInvitados?.length ? `¡${1 + exito.codigosInvitados.length} socios inscritos! 🎉` : '¡Socio inscrito! 🎉'} onClose={onClose} width={400}>
        <div className="rounded-[10px] bg-green-50 p-4 text-center">
          <div className="text-[15px] font-extrabold text-green-600">{f.nombre}</div>
          <div className="mt-1 text-[13px] font-bold text-muted">Socio N.º {exito.codigo}</div>
          {(exito.codigosInvitados || []).map((cod, i) => (
            <div key={cod} className="mt-2">
              <div className="text-[15px] font-extrabold text-green-600">{invitados[i]?.nombre}</div>
              <div className="mt-0.5 text-[13px] font-bold text-muted">Socio N.º {cod}{i + 1 >= pagan ? ' · entra gratis' : ''}</div>
            </div>
          ))}
          {Number(exito.total) > 0 && (
            <div className="mt-2 text-[14px] font-extrabold">Cobrado: {money(exito.total, empresa?.moneda)} <span className="text-[11px] font-semibold text-muted">({METODOS_PAGO.find(([m]) => m === f.metodo_pago)?.[1]} · registrado en caja)</span></div>
          )}
          {exito.promo && <div className="mt-1 text-[12px] font-extrabold text-orange">🎁 {exito.promo}</div>}
          {exito.saldo > 0 && (
            <div className="mt-2 rounded-[9px] bg-amber-50 px-3 py-2 text-[12px] font-extrabold text-amber-800">
              Queda debiendo {money(exito.saldo, empresa?.moneda)} — regístralo con "Abonar" en Membresías cuando pague.
            </div>
          )}
        </div>
        {planAuto?.asignado && (
          <div className="mt-2.5 rounded-[10px] bg-[#EEF1FF] px-3.5 py-2.5 text-[12px] font-bold text-[#4C5AA8]">
            🏋️ Plan asignado: <b>{planAuto.objetivo}</b> · {planAuto.rutina_dias} días de rutina + dieta {planAuto.dieta_kcal_dia} kcal
            <span className="block font-semibold text-[#6672B8]">IMC {planAuto.imc} ({planAuto.categoria}) — revísalo en Rutinas.</span>
          </div>
        )}
        {f.objetivo_id && planAuto && !planAuto.asignado && planAuto.motivo === 'sin_peso_talla' && (
          <div className="mt-2.5 rounded-[10px] bg-amber-50 px-3.5 py-2.5 text-[12px] font-bold text-amber-800">
            ⚖️ Falta peso/talla — el plan automático quedó pendiente. Complétalo en la ficha del socio para generarlo.
          </div>
        )}
        {f.telefono && Number(exito.total) > 0 && (
          <a href={waLink(f.telefono, msgRecibo({
              socio: f.nombre, gym: empresa?.nombre, concepto: `Inscripción${plan ? ' ' + plan.nombre : ''}`,
              monto: exito.total, metodo: METODOS_PAGO.find(([v]) => v === f.metodo_pago)?.[1], saldo: exito.saldo,
            }))}
            target="_blank" rel="noreferrer"
            className="mt-3 flex items-center justify-center gap-2 rounded-[10px] border-none py-2.5 text-[13px] font-extrabold text-white"
            style={{ background: '#1DA851' }}>
            📄 Enviar recibo por WhatsApp
          </a>
        )}
        <button onClick={onClose} className="mt-2.5 w-full cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">Listo</button>
      </Modal>
    )
  }

  // Paso 1: SOLO el documento. Con 8 dígitos se busca solo en el padrón y al
  // responder se abre el formulario; extranjeros continúan sin verificar.
  if (paso === 'dni') {
    const esDni = /^\d{8}$/.test(f.documento.replace(/\D/g, ''))
    return (
      <Modal title={leadId ? 'Convertir en socio' : 'Nuevo socio'} subtitle="Paso 1 · Documento de identidad" onClose={onClose} width={400}>
        <div className="flex flex-col gap-3.5">
          <Campo label="Documento (DNI / CE) *" hint="Con 8 dígitos (DNI) buscamos a la persona en el padrón; extranjeros: carné o pasaporte y Continuar.">
            <input autoFocus value={f.documento} onChange={set('documento')} maxLength={12} inputMode="numeric"
              placeholder="44247191" className={inputCls + ' text-center text-[18px] font-extrabold tracking-[3px]'} />
          </Campo>
          {dupSocio && (
            <div className="rounded-[10px] border border-orange/40 bg-orange/5 p-3.5">
              <div className="text-[12.5px] font-extrabold">
                {dupSocio.estado === 'activo' ? '👤 Ya es socio' : '↩️ Ex-socio que vuelve'}: {dupSocio.nombre}
              </div>
              <div className="mt-0.5 text-[11.5px] font-semibold text-muted">
                N.º {dupSocio.codigo}{dupSocio.estado !== 'activo' ? ' · estaba de baja' : ''} — no lo dupliques, agrégale una membresía nueva.
              </div>
              {dupSocio.sede_id && sedeId && dupSocio.sede_id !== sedeId && (
                <div className="mt-2 rounded-[8px] bg-amber-50 px-2.5 py-1.5 text-[11px] font-extrabold text-amber-800">
                  ⚠️ Pertenece a otra sede{dupSocio.sede?.nombre ? ` (${dupSocio.sede.nombre})` : ''}. Al agregarle una membresía, esta se registra en ESA sede, no en la actual.
                </div>
              )}
              <button onClick={() => { setModoExistente(true); setF((s) => ({ ...s, nombre: dupSocio.nombre })); setPaso('form') }}
                className="mt-2.5 w-full cursor-pointer rounded-[9px] border-none bg-orange py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600">
                {dupSocio.estado === 'activo' ? 'Agregarle una membresía →' : 'Reactivarlo y darle membresía →'}
              </button>
            </div>
          )}
          {verif?.buscando && (
            <div className="flex flex-col items-center gap-2.5 rounded-[10px] bg-surface px-4 py-6">
              <span className="h-7 w-7 animate-spin rounded-full border-[3px] border-line border-t-orange" />
              <span className="text-[12.5px] font-bold text-muted">Buscando en el padrón…</span>
            </div>
          )}
          {!verif?.buscando && !esDni && !dupSocio && f.documento.trim().length >= 6 && (
            <button onClick={() => setPaso('form')}
              className="cursor-pointer rounded-[10px] border-none bg-orange py-2.5 text-[13.5px] font-extrabold text-white hover:bg-orange-600">
              Continuar (documento extranjero) →
            </button>
          )}
          <button onClick={onClose}
            className="cursor-pointer rounded-[10px] border border-line bg-white py-2.5 text-[13px] font-extrabold text-muted">
            Cancelar
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title={leadId ? 'Convertir en socio' : 'Nuevo socio'} subtitle="Se inscribe en la sede actual" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        {/* Documento ya capturado en el paso 1 */}
        <div className="flex items-center justify-between rounded-[10px] bg-surface px-3.5 py-2.5">
          <span className="text-[13px] font-extrabold">🪪 {f.documento}</span>
          <button type="button" onClick={cambiarDocumento}
            className="cursor-pointer border-none bg-transparent p-0 text-[12px] font-extrabold text-orange hover:underline">
            ✏️ Cambiar
          </button>
        </div>
        {modoExistente ? (
          /* Socio existente: solo confirmamos quién es; los datos ya están */
          <div className="rounded-[10px] border border-orange/40 bg-orange/5 px-3.5 py-3">
            <div className="text-[13.5px] font-extrabold">
              {dupSocio?.estado === 'activo' ? '👤' : '↩️'} {dupSocio?.nombre} <span className="text-[11.5px] font-bold text-faint">N.º {dupSocio?.codigo}</span>
            </div>
            <div className="mt-0.5 text-[11.5px] font-semibold text-muted">
              {dupSocio?.estado === 'activo' ? 'Le agregas una membresía nueva.' : 'Vuelve al gimnasio — se reactivará al cobrar.'}
            </div>
          </div>
        ) : (
        <>
        {/* Resultado de la verificación de identidad (MAXFIND) */}
        {(() => {
          const t = textoVerificacion(verif)
          if (!t) return null
          const cls = t.tipo === 'ok' ? 'bg-green-50 text-green-700' : t.tipo === 'alerta' ? 'bg-red-50 text-red' : 'bg-amber-50 text-amber-800'
          return <p className={`-mt-1.5 rounded-[8px] px-3 py-1.5 text-[11.5px] font-extrabold ${cls}`}>{t.texto}</p>
        })()}
        <Campo label="Nombre completo *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="Carlos Mendoza" /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Teléfono"><input value={f.telefono} onChange={set('telefono')} className={inputCls} placeholder="999 888 777" /></Campo>
          <Campo label="Fecha de nacimiento"><input type="date" max={new Date().toISOString().slice(0, 10)} value={f.fecha_nacimiento} onChange={set('fecha_nacimiento')} className={inputCls} /></Campo>
        </div>
        <Campo label="Correo"><input type="email" value={f.email} onChange={set('email')} className={inputCls} /></Campo>
        <Campo label="Objetivo (con plan automático)" hint="Si eliges uno de estos, con el peso y talla te generamos rutina + dieta según su IMC.">
          <select value={f.objetivo_id} onChange={set('objetivo_id')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin objetivo</option>
            {(objetivos.data || []).map((o) => (
              <option key={o.id} value={o.id}>{o.nombre}</option>
            ))}
          </select>
        </Campo>
        {f.objetivo_id && (
          <div className="grid grid-cols-2 gap-3">
            <Campo label="Peso (kg)">
              <input type="number" step="0.1" min="0" value={f.peso_kg} onChange={set('peso_kg')} className={inputCls} placeholder="70" />
            </Campo>
            <Campo label="Talla (m)">
              <input type="number" step="0.01" min="0" value={f.talla_m} onChange={set('talla_m')} className={inputCls} placeholder="1.70" />
            </Campo>
          </div>
        )}
        {f.objetivo_id && (!f.peso_kg || !f.talla_m) && (
          <p className="-mt-1.5 text-[11px] font-semibold text-faint">Completa peso y talla para que el plan se asigne automáticamente ahora; si no, quedará pendiente.</p>
        )}
        <Campo label="Otro objetivo (texto libre, opcional)" hint="Solo descriptivo: se ve en su ficha y en su app, no genera plan. El plan automático sale del objetivo de arriba.">
          <ObjetivoChips value={f.objetivo} onChange={(v) => setF((s) => ({ ...s, objetivo: v }))} />
        </Campo>
        </>
        )}
        <Campo label="Plan de membresía" hint={!plan ? 'Opcional: puedes asignarlo después.' : undefined}>
          <select value={f.plan_id} onChange={set('plan_id')} className={inputCls + ' cursor-pointer'}>
            <option value="">Sin plan por ahora</option>
            {(planes.data || []).map((p) => (
              <option key={p.id} value={p.id}>{p.nombre} — {money(p.precio, empresa?.moneda)}/{p.unidad}</option>
            ))}
          </select>
        </Campo>

        {plan && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Promoción">
                <select value={f.promocion_id} onChange={set('promocion_id')} className={inputCls + ' cursor-pointer'}>
                  <option value="">Sin promoción</option>
                  {promosActivas.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </select>
              </Campo>
              <Campo label="Método de pago">
                <select value={f.metodo_pago} onChange={set('metodo_pago')} className={inputCls + ' cursor-pointer'}>
                  {METODOS_PAGO.map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </Campo>
            </div>
            {/* Precio acordado: monto pactado distinto al del plan (pana, ex-socio
                que retoma, acuerdo puntual). Solo aplica esta inscripción. */}
            {!esGrupo && (
              <Campo label="Precio acordado (opcional)"
                hint={`Déjalo vacío para cobrar el precio del plan (${money(plan.precio, empresa?.moneda)}). Ponlo si acordaste otro monto solo por esta vez.`}>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-muted">{empresa?.moneda === 'USD' ? '$' : 'S/'}</span>
                  <input type="number" step="0.01" min="0" value={precioAcordado}
                    onChange={(e) => setPrecioAcordado(e.target.value)}
                    className={inputCls} placeholder={`${plan.precio}`} />
                </div>
              </Campo>
            )}
            {esGrupo && (
              <div className="rounded-[10px] border border-orange/40 bg-orange/5 p-3">
                <div className="mb-2 text-[12px] font-extrabold text-orange">
                  🎁 {promo.tipo === '2x1'
                    ? '2×1 — la segunda persona (entra gratis con el mismo plan)'
                    : `${nInvitados + 1}×${pagan} — las otras ${nInvitados} personas del grupo (mismo plan; pagan ${pagan} en total)`}
                </div>
                {Array.from({ length: nInvitados }).map((_, i) => (
                  <div key={i} className={i > 0 ? 'mt-3 border-t border-orange/20 pt-3' : ''}>
                    <Campo label={`Persona ${i + 2} — Nombre completo *`}>
                      <input required value={invitados[i]?.nombre || ''} onChange={setInv(i, 'nombre')} className={inputCls} placeholder="Ana Torres" />
                    </Campo>
                    <div className="mt-2.5 grid grid-cols-2 gap-3">
                      <Campo label="Teléfono"><input value={invitados[i]?.telefono || ''} onChange={setInv(i, 'telefono')} className={inputCls} /></Campo>
                      <Campo label="Documento (DNI)"><input value={invitados[i]?.documento || ''} onChange={setInv(i, 'documento')} className={inputCls} /></Campo>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Resumen del cobro */}
            <div className="rounded-[10px] bg-surface px-3.5 py-3">
              <div className="flex justify-between text-[12.5px] font-bold text-muted">
                <span>Mensualidad {plan.nombre}{esGrupo && pagan > 1 ? ` × ${pagan}` : ''}</span>
                <span className="flex items-center gap-2">
                  {usaAcordado && Number(plan.precio) !== precio && (
                    <span className="text-[11px] font-semibold text-faint line-through">{money(plan.precio, empresa?.moneda)}</span>
                  )}
                  {money(precio * pagan, empresa?.moneda)}
                </span>
              </div>
              {usaAcordado && (
                <div className="mt-1 flex justify-between text-[12px] font-extrabold text-orange">
                  <span>🤝 Precio acordado</span><span>solo esta inscripción</span>
                </div>
              )}
              {matricula > 0 && (
                <div className="mt-1 flex justify-between text-[12.5px] font-bold text-muted">
                  <span>Matrícula</span><span>{money(matricula, empresa?.moneda)}</span>
                </div>
              )}
              {promoNota && (
                <div className="mt-1 flex justify-between text-[12px] font-extrabold text-orange">
                  <span>🎁 {promo?.nombre}</span><span>{promoNota}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-line pt-2 text-[14px] font-extrabold">
                <span>Total a cobrar</span><span>{money(total, empresa?.moneda)}</span>
              </div>

              {/* Pago en partes: cobra una parte hoy y el resto queda como saldo */}
              {puedePartes && (
                <div className="mt-2.5 border-t border-line pt-2.5">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={enPartes} onChange={(e) => { setEnPartes(e.target.checked); if (e.target.checked && !montoInicial) setMontoInicial(String(total)) }}
                      className="h-4 w-4 accent-orange-600" />
                    <span className="text-[12.5px] font-bold">Paga en partes <span className="font-semibold text-muted">(hoy una parte, el resto queda como saldo)</span></span>
                  </label>
                  {enPartes && (
                    <div className="mt-2 flex flex-wrap items-center gap-2.5">
                      <span className="text-[12.5px] font-bold">Paga hoy S/</span>
                      <input type="number" step="0.01" min="0" max={total} value={montoInicial}
                        onChange={(e) => setMontoInicial(e.target.value)} autoFocus
                        className="w-[100px] rounded-[8px] border border-line bg-white px-2 py-1.5 text-[13px] font-extrabold outline-none focus:border-orange" />
                      <span className={`text-[12px] font-extrabold ${saldo > 0 ? 'text-amber-600' : 'text-green-600'}`}>
                        {saldo > 0 ? `queda debiendo ${money(saldo, empresa?.moneda)}` : 'pagado completo ✓'}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy}
          disabled={modoExistente ? !f.plan_id : (!f.nombre.trim() || !!dupSocio)}
          submitLabel={modoExistente
            ? (f.plan_id ? `Cobrar ${money(inicial, empresa?.moneda)} y activar` : 'Elige un plan')
            : (dupSocio ? 'Documento duplicado' : f.plan_id ? `Inscribir y cobrar ${money(inicial, empresa?.moneda)}` : 'Inscribir')} />
      </form>
    </Modal>
  )
}
