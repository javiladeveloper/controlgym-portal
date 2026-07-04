import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui.jsx'
import { LoadingState, ErrorState, EmptyState } from '../components/states.jsx'
import Modal, { Campo, BotonesModal, inputCls } from '../components/Modal.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { usePromociones } from '../hooks/useOperaciones.js'
import { BASE_TOKENS as T } from '../theme/tokens.js'

function NuevaCampanaModal({ empresaId, onClose }) {
  const qc = useQueryClient()
  const [f, setF] = useState({ nombre: '', descripcion: '', canal: 'Recepción y redes', tipo: '2x1', valor: '', duracion_meses: '', fecha_inicio: '', fecha_fin: '', estado: 'activa' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  // Qué pide cada tipo: % / monto / precio total + meses
  const pideValor = ['descuento_pct', 'descuento_monto', 'precio_especial'].includes(f.tipo)
  const labelValor = f.tipo === 'descuento_pct' ? 'Descuento (%)' : f.tipo === 'descuento_monto' ? 'Descuento (S/)' : 'Precio total (S/)'

  async function guardar(e) {
    e?.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.from('promocion').insert({
      empresa_id: empresaId, nombre: f.nombre.trim(), descripcion: f.descripcion || null,
      canal: f.canal, tipo: f.tipo, estado: f.estado,
      valor: pideValor && f.valor !== '' ? Number(f.valor) : null,
      duracion_meses: f.tipo === 'precio_especial' && f.duracion_meses !== '' ? Number(f.duracion_meses) : null,
      fecha_inicio: f.fecha_inicio || null, fecha_fin: f.fecha_fin || null,
    })
    setBusy(false)
    if (error) { setError(error.message); return }
    qc.invalidateQueries({ queryKey: ['promociones'] })
    onClose()
  }

  return (
    <Modal title="Nueva campaña" subtitle="Si está activa, aparece también en tu página web" onClose={onClose}>
      <form onSubmit={guardar} className="flex flex-col gap-3.5">
        <Campo label="Nombre *"><input required value={f.nombre} onChange={set('nombre')} className={inputCls} placeholder="2×1 en matrícula" /></Campo>
        <Campo label="Descripción"><textarea rows={2} value={f.descripcion} onChange={set('descripcion')} className={inputCls + ' resize-none'} /></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo label="Tipo">
            <select value={f.tipo} onChange={set('tipo')} className={inputCls + ' cursor-pointer'}>
              <option value="2x1">2×1 (matrícula gratis)</option><option value="descuento_pct">Descuento %</option>
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
        <BotonesModal onCancel={onClose} busy={busy} disabled={!f.nombre.trim()} submitLabel="Crear campaña" />
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
  const { empresa } = useAuth()
  const [nuevaOpen, setNuevaOpen] = useState(false)
  const { data, isLoading, error, refetch } = usePromociones()

  return (
    <div className="px-7 pb-9 pt-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Promociones</h1>
          <p className="mt-0.5 text-[13px] font-semibold text-muted">Campañas para captar y retener socios · {empresa?.nombre}</p>
        </div>
        <button onClick={() => setNuevaOpen(true)}
          className="cursor-pointer rounded-[10px] border-none bg-orange px-[18px] py-[11px] text-[13px] font-extrabold text-white transition-colors hover:bg-orange-600">Nueva campaña</button>
      </div>

      {nuevaOpen && <NuevaCampanaModal empresaId={empresa?.id} onClose={() => setNuevaOpen(false)} />}

      {isLoading && <LoadingState variant="cards" rows={4} />}
      {error && <ErrorState error={error} onRetry={refetch} />}
      {!isLoading && (data || []).length === 0 && <EmptyState message="Sin campañas registradas." />}

      {(data || []).length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-[15px]">
          {data.map((pr) => {
            const est = ESTADO[pr.estado] || ESTADO.activa
            return (
              <Card key={pr.id} className="p-[19px] transition hover:border-orange">
                <div className="flex items-center justify-between gap-2.5">
                  <span className="rounded-full px-[11px] py-[5px] text-[11px] font-extrabold" style={{ background: est.bg, color: est.color }}>{est.label}</span>
                  <span className="text-[11.5px] font-bold text-faint">{pr.canal}</span>
                </div>
                <div className="mt-3 text-[16px] font-extrabold">{pr.nombre}</div>
                <div className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">{pr.descripcion}</div>
                <div className="mt-3.5 flex justify-between border-t border-line2 pt-[13px]">
                  <div className="text-[12px] font-bold text-muted">
                    {pr.fecha_inicio ? new Date(pr.fecha_inicio).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : 'Vigente'}
                  </div>
                  <div className="text-[12px] font-extrabold text-orange">{pr.canjes ? `${pr.canjes} canjes` : ''}</div>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
