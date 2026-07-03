// Descarga de datos como CSV compatible con Excel (BOM UTF-8, separador ';').

export function descargarCSV(nombreArchivo, filas) {
  if (!filas || filas.length === 0) {
    alert('No hay datos para exportar en este periodo.')
    return false
  }
  const cols = Object.keys(filas[0])
  const esc = (v) => {
    if (v == null) return ''
    const s = String(v)
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const csv = '﻿' + [cols.join(';'), ...filas.map((f) => cols.map((c) => esc(f[c])).join(';'))].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${nombreArchivo}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
  return true
}
