// Arma el payload de /api/emit y llama a NORAC. Desglosa IGV y cuadra céntimos.
function hoyLima() {
  // fecha local Perú (UTC-5) YYYY-MM-DD
  const d = new Date(Date.now() - 5 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}

// Redondeo "normal" (half-up) a N decimales, evitando el sesgo de
// Number.prototype.toFixed en casos .xxx5 por representación binaria de floats.
function roundN(n, dec) {
  const f = 10 ** dec
  return Math.round((n + Number.EPSILON) * f) / f
}

// Precisión del valor_unitario en el payload de NORAC. SUNAT permite hasta 10
// decimales en el precio unitario precisamente para este problema: con solo 2
// decimales de precisión, cantidad·valor_unitario·1.18 NO SIEMPRE puede
// reconstruir el importe exacto de la línea. Ejemplo real (verificado abajo):
// con total de línea = S/100.00 y cantidad = 1, NINGÚN valor_unitario con 2
// decimales cumple round(valor_unitario·1.18, 2) === 100.00 — la secuencia salta
// de 99.99 (con vu=84.74) a 100.01 (con vu=84.75), sin pasar por 100.00. Por eso
// usamos más decimales: con vu = 100/1.18 sin redondear a 2dp, vu·1.18 vuelve a
// dar 100.00 exacto. 6 decimales da margen de sobra para que esto no vuelva a
// pasar con montos e IGV peruanos (18%).
const DECIMALES_VU = 6

// Convierte líneas {descripcion, cantidad, subtotal(con IGV)} a líneas NORAC
// (valor_unitario SIN IGV) y ajusta la última para que Σ == total exacto.
//
// Por qué el ajuste: cada línea se calcula por separado como
// valor_unitario = (subtotal/1.18)/cantidad. Si se redondeara a solo 2 decimales
// (como hace el cálculo "ingenuo"), la suma de las líneas con IGV aplicado puede
// quedar descuadrada del total por céntimos — o, peor, puede no existir NINGÚN
// valor de 2 decimales que reproduzca el total exacto de una línea aislada (ver
// nota de DECIMALES_VU arriba: p.ej. total 100.00 con cantidad 1 es irreproducible
// a 2dp). SUNAT valida que la suma de las líneas (con IGV aplicado y redondeado a
// 2dp para mostrar) cuadre EXACTO con el importe total del comprobante — un
// comprobante descuadrado por céntimos se rechaza (o queda observado). Por eso:
// 1) calculamos valor_unitario con más precisión (DECIMALES_VU) en vez de 2
//    decimales, para que cantidad·valor_unitario·1.18 pueda caer exacto;
// 2) igual verificamos el resultado FINAL tal como lo redondea SUNAT/NORAC
//    (Σ round(valor_unitario·cantidad·1.18, 2)) y si por algún combo de
//    cantidades/montos aún no cuadra, ajustamos el valor_unitario de la última
//    línea (con la misma precisión alta) hasta que la suma cuadre exacto. La
//    última línea es donde la práctica contable habitual absorbe el redondeo.
export function construirLineas(lineas, totalConIgv) {
  const out = lineas.map((l) => {
    const cant = Number(l.cantidad) || 1
    const baseLinea = Number(l.subtotal) / 1.18
    return {
      descripcion: l.descripcion,
      cantidad: String(cant),
      _cant: cant,
      valor_unitario: roundN(baseLinea / cant, DECIMALES_VU),
      afectacion_igv: '10',
      unidad: 'NIU',
    }
  })

  if (out.length > 0 && Number.isFinite(totalConIgv)) {
    const ultima = out[out.length - 1]
    // Centavos (importe con IGV, redondeado a 2dp como lo hace SUNAT/NORAC) que
    // aportan todas las líneas menos la última.
    let restoCentavos = 0
    for (let i = 0; i < out.length - 1; i++) {
      restoCentavos += Math.round(out[i].valor_unitario * out[i]._cant * 1.18 * 100)
    }
    const totalCentavos = Math.round(totalConIgv * 100)
    const objetivoUltimaCentavos = totalCentavos - restoCentavos
    // Despejamos el valor_unitario exacto (a alta precisión) que hace que la
    // última línea aporte exactamente esos céntimos: vu = objetivo / (cant·1.18).
    // Con DECIMALES_VU de margen esto reproduce el céntimo exacto en la inmensa
    // mayoría de casos; por robustez igual verificamos y, si el redondeo a
    // DECIMALES_VU dejó 1 unidad de la última cifra desviada, probamos vecinos.
    const objetivoSoles = objetivoUltimaCentavos / 100
    let vuExacto = roundN(objetivoSoles / (ultima._cant * 1.18), DECIMALES_VU)
    const centavosDe = (vu) => Math.round(vu * ultima._cant * 1.18 * 100)
    if (centavosDe(vuExacto) !== objetivoUltimaCentavos) {
      const paso = 10 ** -DECIMALES_VU
      let mejor = vuExacto
      let mejorDist = Math.abs(centavosDe(mejor) - objetivoUltimaCentavos)
      for (let pasos = 1; pasos <= 200 && mejorDist !== 0; pasos++) {
        for (const signo of [1, -1]) {
          const candidato = roundN(vuExacto + signo * pasos * paso, DECIMALES_VU)
          if (candidato <= 0) continue
          const dist = Math.abs(centavosDe(candidato) - objetivoUltimaCentavos)
          if (dist < mejorDist) {
            mejor = candidato
            mejorDist = dist
          }
        }
      }
      vuExacto = mejor
    }
    ultima.valor_unitario = vuExacto
  }

  // Guard: SUNAT rechaza precios unitarios negativos o cero. Esto puede pasar
  // si el total es menor que la suma de los subtotales de las líneas (p.ej.
  // líneas 80+5 con total=50): el ajuste de la última línea la empuja a un
  // valor_unitario <= 0. Mejor abortar aquí con un error claro que mandar un
  // payload inválido a NORAC.
  for (const l of out) {
    if (!(l.valor_unitario > 0)) {
      throw new Error('cuadre inválido: valor_unitario <= 0 (total menor que la suma de líneas)')
    }
  }

  // Limpia los campos auxiliares internos y formatea valor_unitario como string
  // de punto fijo (sin notación exponencial) antes de devolver el payload.
  return out.map(({ _cant, valor_unitario, ...l }) => ({
    ...l,
    valor_unitario: valor_unitario.toFixed(DECIMALES_VU),
  }))
}

export async function emitirEnNorac(cred, comp, lineas) {
  const esFactura = comp.tipo === '01'
  let lineasNorac
  try {
    lineasNorac = construirLineas(lineas, Number(comp.total))
  } catch (e) {
    return { estado: 'error', error: e.message }
  }
  const body = {
    tipo: comp.tipo,
    serie: esFactura ? cred.serie_factura : cred.serie_boleta,
    fecha_emision: hoyLima(),
    moneda: comp.moneda || 'PEN',
    receptor: {
      tipo_doc: comp.cliente_tipo_doc || '0',
      num_doc: comp.cliente_num_doc || '0',
      razon_social: comp.cliente_nombre || 'CLIENTE VARIOS',
      email: comp.cliente_email || '',
    },
    lineas: lineasNorac,
  }
  let r
  try {
    r = await fetch(`${cred.url}/api/emit`, {
      method: 'POST',
      headers: { 'X-API-Key': cred.api_key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    return { estado: 'pendiente', error: 'red: ' + e.message } // reintentar
  }
  const out = await r.json().catch(() => ({}))
  if (r.status === 401 || r.status === 403) return { estado: 'error', error: 'API key inválida' }
  if (!r.ok) return { estado: 'error', error: out.detail || `NORAC ${r.status}` }
  // queued = SUNAT caído, NORAC reintenta solo → seguimos pendiente
  if (out.estado === 'queued') return { estado: 'pendiente', norac_id: out.id }
  // aceptado por SUNAT
  if (['accepted', 'aceptado', 'emitido'].includes(out.estado))
    return { estado: 'emitido', norac_id: out.id, serie_numero: out.numero, response_code: out.response_code }
  // rechazado / observado por SUNAT
  if (['rejected', 'rechazado', 'observado', 'error'].includes(out.estado))
    return { estado: 'error', error: 'NORAC: ' + out.estado + (out.detail ? ' - ' + out.detail : ''), norac_id: out.id }
  // estado desconocido → pendiente (reintenta), no asumir éxito
  return { estado: 'pendiente', norac_id: out.id, error: 'estado NORAC desconocido: ' + out.estado }
}
