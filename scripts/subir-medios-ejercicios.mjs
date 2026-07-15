// Sube imágenes y GIF de ejercicios a Supabase Storage (bucket 'ejercicios') y
// guarda las URLs públicas en ejercicio_catalogo. Idempotente (upsert en Storage
// y update por ext_id). Usa las rutas relativas que ya trae el dataset (image,
// gif_url) para localizar cada archivo.
//
// Uso (env vars):
//   DATABASE_URL              — conexión Postgres (de /tmp/.dburl)
//   SUPABASE_SERVICE_ROLE_KEY — key secreta (salta RLS) para escribir en Storage
//   SUPABASE_URL              — opcional (default el proyecto de FitCore)
//   MEDIA_DIR                 — carpeta que contiene images/ y videos/ (el repo
//                               del dataset clonado). Default:
//                               scripts/datos-ejercicios/exercises-dataset
//   node scripts/subir-medios-ejercicios.mjs
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const URL = process.env.SUPABASE_URL || 'https://zlmqdubrjzmagslcsqvb.supabase.co'
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DB = process.env.DATABASE_URL
const MEDIA_DIR = process.env.MEDIA_DIR ||
  path.join(process.cwd(), 'scripts', 'datos-ejercicios', 'exercises-dataset')

if (!KEY || !DB) { console.error('Falta SUPABASE_SERVICE_ROLE_KEY o DATABASE_URL'); process.exit(1) }
if (!fs.existsSync(path.join(MEDIA_DIR, 'images'))) {
  console.error(`No encuentro ${MEDIA_DIR}/images — pasa MEDIA_DIR con la carpeta del dataset (con images/ y videos/)`)
  process.exit(1)
}

const sb = createClient(URL, KEY, { auth: { persistSession: false } })
// Supabase usa un cert de cadena auto-firmada; para este script one-shot de
// servidor desactivamos la verificación TLS y quitamos el sslmode de la URL
// (con pg reciente, sslmode=require en la URL pisa el objeto ssl).
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
const DB_CLEAN = DB.replace(/[?&]sslmode=[^&]*/i, '')
const pool = new pg.Pool({ connectionString: DB_CLEAN, ssl: { rejectUnauthorized: false }, max: 1 })

const CT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif' }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Sube un archivo con reintentos ante fallos de red transitorios (timeouts).
async function subir(localRel, destPath) {
  const local = path.join(MEDIA_DIR, localRel)
  if (!fs.existsSync(local)) return null
  const buf = fs.readFileSync(local)
  const ct = CT[path.extname(local).toLowerCase()] || 'application/octet-stream'
  let ultimoError
  for (let intento = 1; intento <= 5; intento++) {
    try {
      const { error } = await sb.storage.from('ejercicios').upload(destPath, buf, { contentType: ct, upsert: true })
      if (error) throw error
      return sb.storage.from('ejercicios').getPublicUrl(destPath).data.publicUrl
    } catch (e) {
      ultimoError = e
      await sleep(1000 * intento) // backoff creciente
    }
  }
  throw ultimoError
}

// Trae los ejercicios del dataset (los del maestro viejo, ext_id 'maestro-*',
// ya tienen su media propia y no se tocan). Se apoya en image/gif_url del JSON
// para el nombre real del archivo; media_id como respaldo.
const dataset = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'scripts', 'datos-ejercicios', 'exercises.json'), 'utf8'))
const porExt = Object.fromEntries(dataset.map((e) => [e.id, e]))

// Resumible: los que ya tienen gif_url (ya subidos en una corrida previa) se
// saltan, así re-correr continúa donde quedó tras un corte de red.
const { rows } = await pool.query(`select id, ext_id, media_id from public.ejercicio_catalogo where ext_id not like 'maestro-%' and gif_url is null order by ext_id`)
console.log(`Pendientes por subir: ${rows.length}`)
let ok = 0, sinArchivo = 0, fallidos = 0
for (const row of rows) {
  const meta = porExt[row.ext_id]
  // ruta relativa: preferir la del JSON; si falta, reconstruir con ext_id-media_id
  const imgRel = meta?.image || `images/${row.ext_id}-${row.media_id}.jpg`
  const gifRel = meta?.gif_url || `videos/${row.ext_id}-${row.media_id}.gif`
  try {
    const fotoUrl = await subir(imgRel, `img/${row.ext_id}.jpg`)
    const gifUrl = await subir(gifRel, `gif/${row.ext_id}.gif`)
    if (!fotoUrl && !gifUrl) { sinArchivo++; continue }
    await pool.query(`update public.ejercicio_catalogo set foto_url=$1, gif_url=$2, updated_at=now() where id=$3`,
      [fotoUrl, gifUrl, row.id])
    ok++
    if (ok % 100 === 0) console.log(`  ${ok}/${rows.length}`)
  } catch (e) {
    fallidos++
    console.error(`  fallo ext_id ${row.ext_id}: ${e.message} (se reintentará en la próxima corrida)`)
  }
}
console.log(`Medios subidos: ${ok}. Sin archivo local: ${sinArchivo}. Fallidos (re-correr): ${fallidos}.`)
await pool.end()
