import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui.jsx'
import { CrudCardGrid, AccionesCard } from '../components/CrudCardGrid.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { toast } from '../lib/toast.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePromociones } from '../hooks/useOperaciones.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

// Crea una campaña o edita la existente si llega `promocion`
function CampanaModal({ empresaId, promocion, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({
    nombre: promocion?.nombre || '', descripcion: promocion?.descripcion || '',
    canal: promocion?.canal || 'Recepción y redes', tipo: promocion?.tipo || '2x1',
    valor: promocion?.valor != null ? String(promocion.valor) : '',
    duracion_meses: promocion?.duracion_meses != null ? String(promocion.duracion_meses) : '',
    grupo_personas: promocion?.grupo_personas != null ? String(promocion.grupo_personas) : '3',
    grupo_pagan: promocion?.grupo_pagan != null ? String(promocion.grupo_pagan) : '2',
    fecha_inicio: promocion?.fecha_inicio || '', fecha_fin: promocion?.fecha_fin || '',
    estado: promocion?.estado || 'activa',
    vigencia_beneficio: promocion?.vigencia_beneficio || 'primera',
    vigencia_meses: promocion?.vigencia_meses != null ? String(promocion.vigencia_meses) : '12',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  // Qué pide cada tipo: % / monto / precio total + meses
  const pideValor = ['descuento_pct', 'descuento_monto', 'precio_especial'].includes(f.tipo)
  const labelValor = f.tipo === 'descuento_pct' ? 'Descuento (%)' : f.tipo === 'descuento_monto' ? 'Descuento (S/)' : 'Precio total (S/)'

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const valores = {
      nombre: f.nombre.trim(), descripcion: f.descripcion || null,
      canal: f.canal, tipo: f.tipo, estado: f.estado,
      valor: pideValor && f.valor !== '' ? Number(f.valor) : null,
      duracion_meses: f.tipo === 'precio_especial' && f.duracion_meses !== '' ? Number(f.duracion_meses) : null,
      grupo_personas: f.tipo === 'grupal' ? Number(f.grupo_personas) || 3 : null,
      grupo_pagan: f.tipo === 'grupal' ? Number(f.grupo_pagan) || 2 : null,
      fecha_inicio: f.fecha_inicio || null, fecha_fin: f.fecha_fin || null,
      vigencia_beneficio: f.vigencia_beneficio,
      vigencia_meses: f.vigencia_beneficio === 'meses' ? Number(f.vigencia_meses) || 12 : null,
    }
    if (f.tipo === 'grupal' && valores.grupo_pagan >= valores.grupo_personas) {
      setBusy(false); setError('En una promo grupal deben pagar MENOS personas de las que vienen (ej. vienen 3, pagan 2).'); return
    }
    const { error } = promocion
      ? await supabase.from('promocion').update(valores).eq('id', promocion.id)
      : await supabase.from('promocion').insert({ empresa_id: empresaId, ...valores })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['promociones'] })
    if (promocion) toast.ok('Campaña actualizada')
    onClose()
  }

  return (
    <Modal title={promocion ? 'Editar campaña' : 'Nueva campaña'} subtitle="Si está activa, aparece también en tu página web" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="2×1 en matrícula" /></Campo>
        <Campo label="Descripción"><textarea rows={2} value={f.descripcion} onChange={set('descripcion')} className={inputCls + ' resize-none'} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="2x1">2×1 (dos personas, paga una)</option>
              <option value="grupal">Grupal (3×2, 4×3…)</option>
              <option value="descuento_pct">Descuento %</option>
              <option value="descuento_monto">Descuento fijo</option><option value="semana_gratis">Semana gratis</option>
              <option value="precio_especial">Precio especial (paquete)</option>
              <option value="otro">Otro</option>
            </select>
          </Campo>
          <Campo label="Canal"><input value={f.canal} onChange={set('canal')} className={inputCls} /></Campo>
        </div>
        {pideValor && (
          <div className="grid grid-cols-2 gap-3">
            <Campo label={labelValor + ' *'}>
              <input required type="number" step="0.01" min="0" value={f.valor} onChange={set('valor')} className={inputCls}
                placeholder={f.tipo === 'descuento_pct' ? '20' : '500'} />
            </Campo>
            {f.tipo === 'precio_especial' && (
              <Campo label="Duración (meses) *">
                <input required type="number" min="1" max="36" value={f.duracion_meses} onChange={set('duracion_meses')} className={inputCls} placeholder="12" />
              </Campo>
            )}
          </div>
        )}
        {f.tipo === 'precio_especial' && (
          <p className="-mt-1 text-[11.5px] font-semibold text-faint">
            Ej.: "Paga S/500 y entrena todo el año" → precio 500, duración 12. Al inscribir con esta promo, la membresía usa este precio y duración (pisa al plan).
          </p>
        )}
        {f.tipo === 'grupal' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Vienen (personas) *">
                <input required type="number" min="2" max="10" value={f.grupo_personas} onChange={set('grupo_personas')} className={inputCls} />
              </Campo>
              <Campo label="Pagan *">
                <input required type="number" min="1" max="9" value={f.grupo_pagan} onChange={set('grupo_pagan')} className={inputCls} />
              </Campo>
            </div>
            <p className="-mt-1 text-[11.5px] font-semibold text-faint">
              Ej. 3×2: vienen 3 y pagan 2. Al inscribir, el modal pedirá los datos de las {Math.max(0, (Number(f.grupo_personas) || 3) - 1)} personas adicionales y en caja entra un solo pago de {Number(f.grupo_pagan) || 2} membresías.
            </p>
          </>
        )}
        {/* ¿El beneficio se repite al RENOVAR? (reglas acordadas: "de por vida
            mientras paguen" se rompe si el grupo no renueva junto; "por N
            meses" cuenta desde la inscripción) */}
        <Campo label="Duración del beneficio" hint={f.vigencia_beneficio === 'primera' ? 'Solo al inscribirse; las renovaciones van a precio normal.' : f.vigencia_beneficio === 'permanente' ? 'Se respeta en cada renovación MIENTRAS paguen sin cortarse (grupos: todos juntos). Si se corta, se pierde para siempre.' : 'Las renovaciones dentro de la ventana mantienen el beneficio; después, precio normal.'}>
          <div className="flex gap-2">
            <select value={f.vigencia_beneficio} onChange={set('vigencia_beneficio')} className={inputCls + ' cursor-pointer'}>
              <option value="primera">Solo la primera vez</option>
              <option value="permanente">De por vida (mientras paguen)</option>
              <option value="meses">Por meses desde la inscripción</option>
            </select>
            {f.vigencia_beneficio === 'meses' && (
              <input type="number" min="1" max="60" value={f.vigencia_meses} onChange={set('vigencia_meses')}
                className={inputCls + ' w-24'} placeholder="12" />
            )}
          </div>
        </Campo>
        <div className="grid grid-cols-3 gap-3">
          <Campo label="Inicio"><input type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} className={inputCls} /></Campo>
          <Campo label="Fin"><input type="date" value={f.fecha_fin} onChange={set('fecha_fin')} className={inputCls} /></Campo>
          <Campo label="Estado">
            <select value={f.estado} onChange={set('estado')} className={inputCls + ' cursor-pointer'}>
              <option value="activa">Activa</option><option value="programada">Programada</option><option value="pausada">Pausada</option>
            </select>
          </Campo>
        </div>
        {error && <div className="rounded-[10px] bg-red-50 px-3.5 py-2.5 text-[13px] font-bold text-red">{error}</div>}
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel={promocion ? 'Guardar cambios' : 'Crear campaña'} />
      </form>
    </Modal>
  )
}

const ESTADO = {
  activa: { bg: T.successBg, color: T.success, label: 'Activa' },
  programada: { bg: T.chipNavy, color: T.navy, label: 'Programada' },
  finalizada: { bg: T.line2, color: T.muted, label: 'Finalizada' },
  pausada: { bg: T.primaryBg, color: T.primary, label: 'Pausada' },
}

export default function Promociones() {
  const { empresa, rol } = useAuth()
  // El comunicador entra a CONSULTAR (qué ofrecer a un prospecto);
  // crear/pausar/editar campañas sigue siendo de admin/recepción.
  const soloConsulta = rol === 'comunicador'
  const qc = useQueryClient()
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const [editar, setEditar] = useState(null) // campaña en edición
  const { data, isLoading, error, refetch } = usePromociones()

  async function cambiarEstado(pr, estado) {
    const { error } = await supabase.from('promocion').update({ estado }).eq('id', pr.id)
    if (error) toast.error('No se pudo actualizar: ' + error.message)
    else qc.invalidateQueries({ queryKey: ['promociones'] })
  }
  async function eliminar(pr) {
    const { error } = await supabase.from('promocion')
      .update({ deleted_at: new Date().toISOString(), estado: 'finalizada' }).eq('id', pr.id)
    if (error) toast.error('No se pudo eliminar: ' + error.message)
    else qc.invalidateQueries({ queryKey: ['promociones'] })
  }

  return (
    <CrudCardGrid
      title="Promociones"
      subtitle={`Campañas para captar y retener socios · ${empresa?.nombre || ''}`}
      nuevoLabel="Nueva campaña"
      onNuevo={soloConsulta ? null : () => setNuevaOpen(true)}
      isLoading={isLoading} error={error} onRetry={refetch}
      emptyMessage="Sin campañas registradas."
      items={data}
      renderCard={(pr) => {
        const est = ESTADO[pr.estado] || ESTADO.activa
        return (
          <Card key={pr.id}
            onClick={(e) => { if (soloConsulta || e.target.closest('button,a')) return; setEditar(pr) }}
            className={soloConsulta ? 'p-[19px]' : 'cursor-pointer p-[19px] transition hover:border-orange'}>
            <div className="flex items-center justify-between gap-2.5">
              <span className="rounded-full px-[11px] py-[5px] text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
              <span className="text-[11.5px] font-bold text-faint">{pr.canal}</span>
            </div>
            <div className="mt-3 text-[16px] font-extrabold">{pr.nombre}</div>
            <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">{pr.descripcion}</div>
            <div className="mt-3.5 flex items-center justify-between border-t border-line2 pt-[13px]">
              <div className="text-[12px] font-bold text-muted">
                {pr.fecha_inicio ? new Date(pr.fecha_inicio).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : 'Vigente'}
                {pr.canjes ? <span className="ml-2 font-extrabold text-orange">{pr.canjes} canjes</span> : null}
              </div>
              {!soloConsulta && <AccionesCard
                puedePausar={pr.estado === 'activa'}
                puedeActivar={pr.estado !== 'activa' && pr.estado !== 'finalizada'}
                onPausar={() => cambiarEstado(pr, 'pausada')}
                onActivar={() => cambiarEstado(pr, 'activa')}
                onEditar={() => setEditar(pr)}
                onEliminar={() => eliminar(pr)}
              />}
            </div>
          </Card>
        )
      }}
    >
      {nuevaOpen && <CampanaModal empresaId={empresa?.id} onClose={() => setNuevaOpen(false)} />}
      {editar && <CampanaModal empresaId={empresa?.id} promocion={editar} onClose={() => setEditar(null)} />}
    </CrudCardGrid>
  )
}
