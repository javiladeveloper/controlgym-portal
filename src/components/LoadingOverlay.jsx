// Overlay de carga a pantalla completa para acciones que tardan
// (abrir el checkout, activar la suscripción, generar reportes…).
export default function LoadingOverlay({ texto = 'Cargando…', sub }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-navy/60 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-4 rounded-2xl bg-white px-10 py-8 shadow-2xl">
        <div className="h-11 w-11 animate-spin rounded-full border-4 border-orange-100 border-t-orange" />
        <div className="text-center">
          <div className="text-[15px] font-extrabold">{texto}</div>
          {sub && <div className="mt-1 text-[12px] font-semibold text-muted">{sub}</div>}
        </div>
      </div>
    </div>
  )
}
