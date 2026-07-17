import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Modal, { Campo, BotonesModal, inputCls } from '../Modal.jsx'
import { supabase } from '../../lib/supabaseClient.js'
import { toast } from '../../lib/toast.js'
import { limpiarDocumento } from '../../lib/dni.js'
import ObjetivoChips from './ObjetivoChips.jsx'
import { useObjetivos } from '../../hooks/usePlantillas.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { kgADisplay, mADisplay, displayAKg, displayAM, labelPeso, labelTalla } from '../../lib/unidades.js'

// Editar datos del socio + acciones de ciclo de vida:
//  · Dar de baja / reactivar (estado inactivo/activo — conserva historial)
//  · Eliminar (soft delete — desaparece de las listas, no se borra de la BD)
export default function EditarSocioModal({ socio, onClose, onSaved }) {
  const qc = useQueryClient()
  const { empresa } = useAuth()
  const objetivos = useObjetivos()
  const unidadPeso = empresa?.unidad_peso
  const unidadTalla = empresa?.unidad_talla
  const [f, setF] = useState({
    nombre: socio.nombre || '', telefono: socio.telefono || '', email: socio.email || '',
    documento: socio.documento || '', fecha_nacimiento: socio.fecha_nacimiento || '',
    // socio.talla_m / socio.peso_kg vienen SIEMPRE en métrico de la BD; se
    // convierten a la unidad de display del gym solo para mostrarlos en el input.
    talla_m: mADisplay(socio.talla_m, unidadTalla) ?? '',
    peso_kg: kgADisplay(socio.peso_kg, unidadPeso) ?? '',
    objetivo_id: socio.objetivo_id || '',
    objetivo_nota: socio.objetivo_nota || '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmar, setConfirmar] = useState(null) // 'baja' | 'eliminar'
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))
  const activo = socio.estado === 'activo'
  // Modelo "usuario = fuente de verdad": si el socio tiene cuenta en la app,
  // sus datos personales los edita él desde ahí; recepción los ve en solo
  // lectura y no los reenvía en el update (para no pisar lo que el usuario
  // ya haya cambiado).
  const tieneCuenta = Boolean(socio?.usuario_id)
  const hintCuenta = 'Estos datos son de la cuenta del socio; los edita él desde la app FitCore.'

  function invalidar() {
    qc.invalidateQueries({ queryKey: ['clientes'] })
    // La ficha del socio se registra como ['socio', socioId] (useSocioFicha),
    // no ['socio-ficha']; y los KPIs del dashboard como ['dashboard-kpis', sedeId].
    qc.invalidateQueries({ queryKey: ['socio', socio.id] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')

    // f.talla_m / f.peso_kg están en la unidad de display del gym (cm o ft para
    // talla). Convertimos a métrico (BD) ANTES de validar, así el rango de
    // sanidad (0.5–2.6 m, 10–400 kg) siempre se aplica sobre el valor real en
    // kg/m, sea cual sea la unidad tipeada. (Ya no hace falta el viejo heurístico
    // "escribieron cm" porque en métrico el input YA es cm y displayAM lo pasa a m.)
    let talla = f.talla_m === '' ? null : Number(f.talla_m)
    talla = displayAM(talla, unidadTalla)
    if (talla !== null && (talla < 0.5 || talla > 2.6)) {
      setBusy(false)
      setError(unidadTalla === 'ft'
        ? 'Revisa la talla: parece fuera de rango (ej. 5.7 ft).'
        : 'Revisa la talla: va en metros (ej. 1.75) — se aceptan también centímetros (175).')
      return
    }
    let peso = f.peso_kg === '' ? null : Number(f.peso_kg)
    peso = displayAKg(peso, unidadPeso)
    if (peso !== null && (peso < 10 || peso > 400)) {
      setBusy(false)
      setError(unidadPeso === 'lb' ? 'Revisa el peso: parece fuera de rango (ej. 154 lb).' : 'Revisa el peso: va en kilogramos (ej. 82.5).')
      return
    }

    // Con cuenta: los campos personales son del usuario, no se reenvían al
    // update (solo lo que siga siendo del gym). Sin cuenta: como antes.
    // El objetivo de CATÁLOGO sigue la misma regla (lo elige el socio en su
    // app si ya tiene cuenta); la NOTA la sigue escribiendo el trainer siempre.
    const cambios = tieneCuenta
      ? { objetivo_nota: f.objetivo_nota || null }
      : {
        nombre: f.nombre.trim(),
        telefono: f.telefono.trim() || null,
        email: f.email.trim() || null,
        documento: f.documento.trim() || null,
        fecha_nacimiento: f.fecha_nacimiento || null,
        talla_m: talla,
        peso_kg: peso,
        objetivo_id: f.objetivo_id || null,
        objetivo_nota: f.objetivo_nota || null,
      }

    if (Object.keys(cambios).length === 0) {
      setBusy(false)
      invalidar(); onSaved?.(); onClose()
      return
    }

    const { error } = await supabase.from('socio').update(cambios).eq('id', socio.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onSaved?.(); onClose()
  }

  async function cambiarEstado() {
    setBusy(true); setError('')
    const { error } = await supabase.from('socio')
      .update({ estado: activo ? 'inactivo' : 'activo' })
      .eq('id', socio.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onSaved?.(); onClose()
  }

  async function eliminar() {
    setBusy(true); setError('')
    const estadoPrevio = socio.estado
    const { error } = await supabase.from('socio')
      .update({ deleted_at: new Date().toISOString(), estado: 'inactivo' })
      .eq('id', socio.id)
    setBusy(false)
    if (error) { setError(error.message); return }
    invalidar(); onSaved?.(); onClose()
    // Ventana de arrepentimiento: restaura al socio tal como estaba
    toast.undo(`${socio.nombre} eliminado`, async () => {
      await supabase.from('socio')
        .update({ deleted_at: null, estado: estadoPrevio })
        .eq('id', socio.id)
      invalidar()
      toast.ok('Socio restaurado')
    })
  }

  return (
    <Modal title={`Editar socio · ${socio.codigo || ''}`} subtitle={socio.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre completo *" hint={tieneCuenta ? hintCuenta : undefined}>
          <input required readOnly={tieneCuenta} disabled={tieneCuenta} value={f.nombre} onChange={set('nombre')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} />
        </Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Teléfono" hint={tieneCuenta ? hintCuenta : undefined}>
            <input readOnly={tieneCuenta} disabled={tieneCuenta} value={f.telefono} onChange={set('telefono')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} />
          </Campo>
          <Campo label="DNI / CE" hint={tieneCuenta ? hintCuenta : undefined}>
            <input readOnly={tieneCuenta} disabled={tieneCuenta} value={f.documento} onChange={(e) => setF((s) => ({ ...s, documento: limpiarDocumento(e.target.value) }))} maxLength={12} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} />
          </Campo>
        </div>
        <Campo label="Correo" hint={tieneCuenta ? hintCuenta : undefined}><input type="email" readOnly={tieneCuenta} disabled={tieneCuenta} value={f.email} onChange={set('email')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} /></Campo>
        <div className="grid grid-cols-3 gap-3">
          <Campo label="Nacimiento" hint={tieneCuenta ? hintCuenta : undefined}>
            <input type="date" readOnly={tieneCuenta} disabled={tieneCuenta} max={new Date().toISOString().slice(0, 10)} value={f.fecha_nacimiento} onChange={set('fecha_nacimiento')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} />
          </Campo>
          <Campo label={`Talla (${labelTalla(unidadTalla)})`} hint={tieneCuenta ? hintCuenta : undefined}>
            <input type="number" readOnly={tieneCuenta} disabled={tieneCuenta} step={unidadTalla === 'ft' ? '0.1' : '1'} min="0" value={f.talla_m} onChange={set('talla_m')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} placeholder={unidadTalla === 'ft' ? '5.7' : '170'} />
          </Campo>
          <Campo label={`Peso (${labelPeso(unidadPeso)})`} hint={tieneCuenta ? hintCuenta : undefined}>
            <input type="number" readOnly={tieneCuenta} disabled={tieneCuenta} step="0.1" min="0" value={f.peso_kg} onChange={set('peso_kg')} className={inputCls + (tieneCuenta ? ' cursor-not-allowed bg-surface text-muted' : '')} placeholder={unidadPeso === 'lb' ? '154' : '70'} />
          </Campo>
        </div>
        {/* Objetivo de catálogo (genera plan automático): si el socio ya tiene
            cuenta en la app, lo elige él desde ahí — aquí queda en solo lectura. */}
        {tieneCuenta ? (
          <Campo label="Objetivo (con plan automático)" hint={hintCuenta}>
            <div className={inputCls + ' cursor-not-allowed bg-surface text-muted'}>
              {(objetivos.data || []).find((o) => o.id === f.objetivo_id)?.nombre || '—'}
            </div>
          </Campo>
        ) : (
          <Campo label="Objetivo (con plan automático)" hint="Si eliges uno de estos, con el peso y talla se genera rutina + dieta según su IMC.">
            <select value={f.objetivo_id} onChange={set('objetivo_id')} className={inputCls + ' cursor-pointer'}>
              <option value="">Sin objetivo</option>
              {(objetivos.data || []).map((o) => (
                <option key={o.id} value={o.id}>{o.nombre}</option>
              ))}
            </select>
          </Campo>
        )}
        {/* Nota descriptiva: la escribe siempre el trainer, tenga o no cuenta el socio */}
        <Campo label="Nota del objetivo (opcional)" hint="Descriptivo, no genera plan (ej. «Jiu-Jitsu · cinturón azul»). Se ve en su ficha y en su app.">
          <ObjetivoChips value={f.objetivo_nota} onChange={(v) => setF((s) => ({ ...s, objetivo_nota: v }))} />
        </Campo>

        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}

        {/* Zona de acciones de ciclo de vida */}
        {confirmar ? (
          <div className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3">
            <div className="text-[13px] font-extrabold text-red">
              {confirmar === 'baja'
                ? (activo ? '¿Dar de baja a este socio? No podrá hacer check-in, pero su historial se conserva.' : '¿Reactivar a este socio?')
                : '¿Eliminar a este socio? Desaparecerá de tus listas (sus pagos históricos se conservan en Finanzas).'}
            </div>
            <div className="mt-2.5 flex gap-2">
              <button type="button" disabled={busy}
                onClick={confirmar === 'baja' ? cambiarEstado : eliminar}
                className="cursor-pointer rounded-[9px] border-none bg-red px-4 py-2 text-[12.5px] font-extrabold text-white disabled:opacity-50">
                Sí, {confirmar === 'baja' ? (activo ? 'dar de baja' : 'reactivar') : 'eliminar'}
              </button>
              <button type="button" onClick={() => setConfirmar(null)}
                className="cursor-pointer rounded-[9px] border border-line bg-white px-4 py-2 text-[12.5px] font-extrabold text-muted">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-4 text-[12.5px] font-extrabold">
            <button type="button" onClick={() => setConfirmar('baja')} className="cursor-pointer border-none bg-transparent p-0 text-amber-600 hover:underline">
              {activo ? '⏸ Dar de baja' : '▶ Reactivar socio'}
            </button>
            <button type="button" onClick={() => setConfirmar('eliminar')} className="cursor-pointer border-none bg-transparent p-0 text-red hover:underline">
              🗑 Eliminar
            </button>
          </div>
        )}

        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Guardar cambios" />
      </form>
    </Modal>
  )
}
