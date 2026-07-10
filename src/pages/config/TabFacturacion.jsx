import { useState, useEffect } from 'react'
import { Card, PrimaryButton, Badge } from '../../components/ui.jsx'
import { LoadingState } from '../../components/states.jsx'
import { toast } from '../../lib/toast.js'
import {
  useEstadoFacturacion, useGuardarFacturacion, useGuardarFacturacionKey, useProbarNorac,
} from '../../hooks/useFacturacion.js'
import { BASE_TOKENS as T } from '../../theme/tokens.js'

export default function TabFacturacion() {
  const estado = useEstadoFacturacion()
  const guardar = useGuardarFacturacion()
  const guardarKey = useGuardarFacturacionKey()
  const probar = useProbarNorac()
  const [f, setF] = useState(null)
  const [key, setKey] = useState('')

  useEffect(() => {
    if (estado.data && f === null) {
      setF({
        activo: estado.data.activo || false,
        ruc: estado.data.ruc || '',
        razon_social: estado.data.razon_social || '',
        serie_boleta: estado.data.serie_boleta || 'B001',
        serie_factura: estado.data.serie_factura || 'F001',
        correlativo_inicial: estado.data.correlativo_inicial ?? '',
        proveedor_url: estado.data.proveedor_url || 'https://norac-facturacion.onrender.com',
      })
    }
  }, [estado.data, f])

  if (estado.isLoading || f === null) return <LoadingState variant="card" />
  if (estado.data?.motivo === 'solo_admin')
    return <Card className="mt-4 p-[19px] text-[13px] font-semibold text-muted">Solo el administrador configura la facturación.</Card>

  const tieneCred = estado.data?.tiene_credenciales

  function onGuardar() {
    guardar.mutate({ ...f, correlativo_inicial: f.correlativo_inicial === '' ? null : Number(f.correlativo_inicial) }, {
      onSuccess: () => toast.ok('Facturación guardada'),
      onError: (e) => toast.error(e.message),
    })
  }
  function onGuardarKey() {
    guardarKey.mutate(key, {
      onSuccess: () => { toast.ok('API key guardada'); setKey('') },
      onError: (e) => toast.error(e.message),
    })
  }
  function onProbar() {
    probar.mutate(undefined, {
      onSuccess: () => toast.ok('Conectado a NORAC ✓'),
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="max-w-[700px]">
      <Card className="mt-4 p-[19px]">
        <div className="flex items-center justify-between">
          <div className="text-[14.5px] font-extrabold">Facturación electrónica (SUNAT)</div>
          <Badge bg={f.activo ? T.successBg : T.line2} color={f.activo ? T.success : T.muted}>
            {f.activo ? 'Activa' : 'Inactiva'}
          </Badge>
        </div>
        <p className="mt-1 text-[12.5px] font-semibold leading-[1.5] text-muted">
          Emite boletas y facturas por cada venta con tu RUC vía NORAC. El cliente
          recibe su comprobante por correo automáticamente.
        </p>

        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })}
            className="h-4 w-4 accent-orange-600" />
          <span className="text-[13px] font-bold">Emitir boletas y facturas</span>
        </label>

        <div className="mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="RUC" value={f.ruc} onChange={(v) => setF({ ...f, ruc: v })} />
          <Field label="Razón social" value={f.razon_social} onChange={(v) => setF({ ...f, razon_social: v })} />
          <Field label="Serie boleta" value={f.serie_boleta} onChange={(v) => setF({ ...f, serie_boleta: v })} />
          <Field label="Serie factura" value={f.serie_factura} onChange={(v) => setF({ ...f, serie_factura: v })} />
          <Field label="Correlativo inicial (opcional)" type="number" value={f.correlativo_inicial}
            onChange={(v) => setF({ ...f, correlativo_inicial: v })} />
        </div>
        <p className="mt-2 text-[11.5px] font-semibold text-muted">
          Usa una serie que no hayas usado antes para no duplicar con tus boletas previas.
        </p>

        <div className="mt-4">
          <PrimaryButton onClick={onGuardar} disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </PrimaryButton>
        </div>
      </Card>

      <Card className="mt-4 p-[19px]">
        <div className="text-[14px] font-extrabold">Conexión con NORAC</div>
        <p className="mt-1 text-[12.5px] font-semibold text-muted">
          Pega la API key que obtuviste en NORAC (empieza con <code>nrk_</code>). Se guarda cifrada.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={tieneCred ? '•••••••• (ya configurada)' : 'nrk_live_…'}
            className="min-w-[240px] flex-1 rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
          <button onClick={onGuardarKey} disabled={guardarKey.isPending || key === ''}
            className="cursor-pointer rounded-[10px] border-none bg-orange px-4 py-2.5 text-[13px] font-extrabold text-white hover:bg-orange-600 disabled:opacity-50">
            Guardar key
          </button>
          <button onClick={onProbar} disabled={probar.isPending || !tieneCred}
            className="cursor-pointer rounded-[10px] border border-line bg-white px-4 py-2.5 text-[13px] font-extrabold text-ink hover:border-orange disabled:opacity-50">
            {probar.isPending ? 'Probando…' : 'Probar conexión'}
          </button>
        </div>
        {tieneCred && (
          <div className="mt-2 text-[12px] font-bold" style={{ color: T.success }}>✓ API key configurada</div>
        )}
      </Card>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] font-extrabold uppercase tracking-[0.5px] text-muted">{label}</span>
      <input type={type} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
        className="rounded-[10px] border border-line bg-white px-3.5 py-2.5 text-[14px] outline-none focus:border-orange" />
    </label>
  )
}
