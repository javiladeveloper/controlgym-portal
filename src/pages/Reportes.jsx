import { useState } from 'react'
import { Card } from '../components/ui.jsx'
import { DocIcon } from '../components/icons.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { descargarCSV } from '../lib/csv.js'
import { usePanel } from '../store.jsx'
import { BASE_TOKENS as T } from '../theme/tokens.js'
import DesempenoTrainers from '../components/DesempenoTrainers.jsx'

const fmtF = (d) => (d ? new Date(d).toLocaleDateString('es-PE') : '')
const fmtFH = (d) => (d ? new Date(d).toLocaleString('es-PE') : '')
const inicioMes = () => { const h = new Date(); return new Date(h.getFullYear(), h.getMonth(), 1).toISOString() }

// Cada reporte consulta datos REALES de la sede y los baja como CSV (Excel).
const REPORTES = [
  {
    key: 'asistencia', name: 'Asistencia del mes', desc: 'Check-ins registrados: fecha, socio, entrada/salida y resultado',
    iconBg: T.primaryBg, iconColor: T.primary,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('checkin')
        .select('ocurrido_en, direccion, metodo, resultado, motivo, socio:socio(nombre, codigo)')
        .eq('sede_id', sedeId).gte('ocurrido_en', inicioMes()).order('ocurrido_en', { ascending: false })
      if (error) throw error
      return data.map((c) => ({
        'Fecha y hora': fmtFH(c.ocurrido_en), Socio: c.socio?.nombre || '—', 'N.º': c.socio?.codigo || '',
        Tipo: c.direccion, 'Método': c.metodo, Resultado: c.resultado, Motivo: c.motivo || '',
      }))
    },
  },
  {
    key: 'ingresos', name: 'Ingresos y gastos del mes', desc: 'Movimientos de caja: membresías, ventas de kardex y gastos',
    iconBg: T.successBg, iconColor: T.success,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('movimiento_financiero')
        .select('fecha, tipo, categoria, descripcion, monto')
        .eq('sede_id', sedeId).gte('fecha', inicioMes()).order('fecha', { ascending: false })
      if (error) throw error
      return data.map((m) => ({
        Fecha: fmtFH(m.fecha), Tipo: m.tipo, 'Categoría': m.categoria || '', 'Descripción': m.descripcion || '', Monto: m.monto,
      }))
    },
  },
  {
    key: 'socios', name: 'Socios de la sede', desc: 'Padrón completo: código, contacto, estado y membresía vigente',
    iconBg: T.chipNavy, iconColor: T.navy,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('socio')
        .select('codigo, nombre, telefono, email, estado, created_at, membresia!membresia_socio_id_fkey(estado, fecha_fin, plan(nombre))')
        .eq('sede_id', sedeId).is('deleted_at', null).order('nombre')
      if (error) throw error
      return data.map((s) => {
        const m = s.membresia?.[0]
        return {
          'N.º': s.codigo, Nombre: s.nombre, 'Teléfono': s.telefono || '', Correo: s.email || '',
          Estado: s.estado, Plan: m?.plan?.nombre || '', 'Membresía': m?.estado || 'sin membresía',
          Vence: fmtF(m?.fecha_fin), 'Inscrito el': fmtF(s.created_at),
        }
      })
    },
  },
  {
    key: 'porvencer', name: 'Membresías por vencer', desc: 'Socios con vencimiento en los próximos 7 días, para campañas',
    iconBg: T.primaryBg, iconColor: T.primary,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('v_membresias_por_vencer')
        .select('*').eq('sede_id', sedeId)
      if (error) throw error
      return data.map((m) => ({
        Socio: m.socio_nombre, 'N.º': m.socio_codigo, Plan: m.plan_nombre,
        Vence: fmtF(m.fecha_fin), 'Días restantes': m.dias_restantes,
      }))
    },
  },
  {
    key: 'deudores', name: 'Deudores (pagos en partes)', desc: 'Socios con saldo pendiente: cuánto pagaron, cuánto deben y su contacto',
    iconBg: '#FEF3C7', iconColor: '#B45309',
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('membresia')
        .select('estado, fecha_fin, precio_pagado, matricula_pagada, monto_pagado, socio:socio!membresia_socio_id_fkey(nombre, codigo, telefono, estado), plan:plan(nombre)')
        .eq('sede_id', sedeId).is('deleted_at', null)
      if (error) throw error
      return data
        .map((m) => ({ ...m, total: Number(m.precio_pagado || 0) + Number(m.matricula_pagada || 0) }))
        .map((m) => ({ ...m, saldo: Math.max(0, m.total - Number(m.monto_pagado || 0)) }))
        .filter((m) => m.saldo > 0 && m.socio?.estado === 'activo')
        .sort((a, b) => b.saldo - a.saldo)
        .map((m) => ({
          Socio: m.socio?.nombre || '—', 'N.º': m.socio?.codigo || '', 'Teléfono': m.socio?.telefono || '',
          Plan: m.plan?.nombre || '', 'Total del trato': m.total, Pagado: Number(m.monto_pagado || 0),
          'SALDO PENDIENTE': m.saldo, 'Membresía': m.estado, Vence: fmtF(m.fecha_fin),
        }))
    },
  },
  {
    key: 'inventario', name: 'Inventario Kardex', desc: 'Stock actual por producto con alerta de quiebre',
    iconBg: T.chipNavy, iconColor: T.navy,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('inventario_sede')
        .select('stock, producto:producto(nombre, categoria, precio, stock_minimo)')
        .eq('sede_id', sedeId)
      if (error) throw error
      return data.map((r) => ({
        Producto: r.producto?.nombre, 'Categoría': r.producto?.categoria || '', Stock: r.stock,
        Precio: r.producto?.precio, 'Mínimo': r.producto?.stock_minimo,
        Alerta: r.stock <= (r.producto?.stock_minimo ?? 0) ? 'STOCK BAJO' : '',
      }))
    },
  },
  {
    key: 'leads', name: 'Prospectos (CRM)', desc: 'Embudo con fuente de origen — mide qué red te trae clientes',
    iconBg: T.successBg, iconColor: T.success,
    fetch: async (sedeId) => {
      const { data, error } = await supabase.from('lead')
        .select('nombre, telefono, email, fuente, etapa, nota, created_at')
        .eq('sede_id', sedeId).is('deleted_at', null).order('created_at', { ascending: false })
      if (error) throw error
      return data.map((l) => ({
        Nombre: l.nombre, 'Teléfono': l.telefono || '', Correo: l.email || '',
        Fuente: l.fuente || '', Etapa: l.etapa, Nota: l.nota || '', Fecha: fmtF(l.created_at),
      }))
    },
  },
]

// Vista previa del reporte antes de descargar: tabla con las primeras filas.
function PreviewModal({ reporte, filas, sedeNombre, onClose }) {
  const cols = filas.length ? Object.keys(filas[0]) : []
  const muestra = filas.slice(0, 50)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onClose}>
      <div className="flex max-h-[86vh] w-full max-w-[900px] flex-col rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[17px] font-extrabold">{reporte.name}</div>
            <div className="mt-0.5 text-[12.5px] font-semibold text-muted">
              {filas.length} {filas.length === 1 ? 'fila' : 'filas'}{filas.length > 50 ? ` · mostrando las primeras 50` : ''}
            </div>
          </div>
          <button onClick={onClose} className="cursor-pointer rounded-lg border-none bg-surface px-2.5 py-1 text-[13px] font-extrabold text-muted hover:text-ink">✕</button>
        </div>
        {filas.length === 0 ? (
          <div className="py-12 text-center text-[13.5px] font-semibold text-muted">Sin datos para este reporte en el período.</div>
        ) : (
          <div className="mt-4 flex-1 overflow-auto rounded-[10px] border border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="sticky top-0">
                <tr>
                  {cols.map((c) => (
                    <th key={c} className="whitespace-nowrap bg-surface px-3 py-2.5 text-left text-[10.5px] font-extrabold uppercase tracking-[0.5px] text-muted">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {muestra.map((f, i) => (
                  <tr key={i} className="border-t border-line2 hover:bg-[#FAFBFC]">
                    {cols.map((c) => <td key={c} className="whitespace-nowrap px-3 py-2 font-semibold">{String(f[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex items-center justify-end gap-2.5">
          <button onClick={onClose} className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-muted">Cerrar</button>
          <button disabled={!filas.length}
            onClick={() => descargarCSV(`${reporte.key}-${sedeNombre.replace(/\s+/g, '-').toLowerCase()}`, filas)}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-5 py-2.5 text-[13px] font-extrabold text-white shadow-[0_4px_14px_rgba(255,107,53,0.32)] disabled:opacity-50">
            ⬇ Descargar Excel (CSV)
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Reportes() {
  const { sedeId, sedeNombre } = usePanel()
  const [busy, setBusy] = useState('')
  const [preview, setPreview] = useState(null) // { reporte, filas }

  async function generar(r) {
    setBusy(r.key)
    try {
      const filas = await r.fetch(sedeId)
      setPreview({ reporte: r, filas })
    } catch (e) {
      alert('No se pudo generar: ' + e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="px-4 pb-9 pt-5 sm:px-7 sm:pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Descarga los datos reales de {sedeNombre} en Excel (CSV).
      </p>

      <div className="mt-5">
        <DesempenoTrainers />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-[15px] lg:grid-cols-3">
        {REPORTES.map((r) => (
          <Card key={r.key} className="flex flex-col gap-3 p-[19px] transition hover:border-orange">
            <div className="flex h-10 w-10 items-center justify-center rounded-[11px]" style={{ background: r.iconBg }}>
              <DocIcon stroke={r.iconColor} />
            </div>
            <div className="flex-1">
              <div className="text-[14.5px] font-extrabold">{r.name}</div>
              <div className="mt-[3px] text-[12px] font-semibold leading-[1.5] text-muted">{r.desc}</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-extrabold tracking-[0.5px] text-faint">EXCEL · CSV</div>
              <button onClick={() => generar(r)} disabled={busy === r.key}
                className="cursor-pointer rounded-[9px] border border-orange bg-transparent px-4 py-2 text-[12px] font-extrabold text-orange transition-colors hover:bg-orange-50 disabled:opacity-50">
                {busy === r.key ? 'Generando…' : 'Descargar'}
              </button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
