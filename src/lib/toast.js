// Sistema de toasts liviano (sin dependencias): bus de eventos del navegador.
// toast.ok('Guardado') · toast.error('No se pudo…') · toast.undo('Eliminado', fn)
function emitir(detalle) {
  window.dispatchEvent(new CustomEvent('fc-toast', { detail: { id: crypto.randomUUID(), ...detalle } }))
}

export const toast = {
  ok: (texto) => emitir({ tipo: 'ok', texto }),
  error: (texto) => emitir({ tipo: 'error', texto }),
  info: (texto) => emitir({ tipo: 'info', texto }),
  // Acción reversible: muestra "Deshacer" por unos segundos
  undo: (texto, onUndo) => emitir({ tipo: 'info', texto, onUndo, duracion: 6000 }),
}
