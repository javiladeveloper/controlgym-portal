import { useState } from 'react'
import { Card } from '../components/ui.jsx'
import { DocIcon } from '../components/icons.jsx'
import { supabase } from '../lib/supabaseClient.js'
import { descargarCSV } from '../lib/csv.js'
import { usePanel } from '../store.jsx'
import { BASE_TOKENS as T } from '../theme/tokens.js'

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

export default function Reportes() {
  const { sedeId, sedeNombre } = usePanel()
  const [busy, setBusy] = useState('')

  async function generar(r) {
    setBusy(r.key)
    try {
      const filas = await r.fetch(sedeId)
      descargarCSV(`${r.key}-${sedeNombre.replace(/\s+/g, '-').toLowerCase()}`, filas)
    } catch (e) {
      alert('No se pudo generar: ' + e.message)
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="px-7 pb-9 pt-6">
      <h1 className="text-[22px] font-extrabold tracking-[-0.3px]">Reportes</h1>
      <p className="mt-0.5 text-[13px] font-semibold text-muted">
        Descarga los datos reales de {sedeNombre} en Excel (CSV).
      </p>

      <div className="mt-5 grid grid-cols-3 gap-[15px]">
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
