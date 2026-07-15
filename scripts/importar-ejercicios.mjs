// Importa el dataset de ejercicios a ejercicio_catalogo (idempotente por ext_id).
// Uso: DATABASE_URL debe estar en el entorno (o pasar --dburl). Corre 1 vez.
//   node scripts/importar-ejercicios.mjs
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const DIR = path.join(process.cwd(), 'scripts', 'datos-ejercicios')
const ejercicios = JSON.parse(fs.readFileSync(path.join(DIR, 'exercises.json'), 'utf8'))

// mapa ext_id -> nombre_es (formato "0001\tabdominal 3/4")
const nombresEs = {}
for (const linea of fs.readFileSync(path.join(DIR, 'nombres_es.txt'), 'utf8').split(/\r?\n/)) {
  if (!linea.trim()) continue
  const t = linea.split('\t')
  if (t.length >= 2) nombresEs[t[0].trim()] = t.slice(1).join(' ').trim()
}

const dburl = process.env.DATABASE_URL
if (!dburl) { console.error('Falta DATABASE_URL en el entorno'); process.exit(1) }
const pool = new pg.Pool({ connectionString: dburl, ssl: true, rejectUnauthorized: false, max: 1 })

let ok = 0
for (const e of ejercicios) {
  await pool.query(
    `insert into public.ejercicio_catalogo
       (ext_id, nombre, nombre_es, body_part, grupo_muscular, target, secondary,
        equipment, instrucciones, pasos, media_id, attribution)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (ext_id) do update set
       nombre=excluded.nombre, nombre_es=excluded.nombre_es, body_part=excluded.body_part,
       grupo_muscular=excluded.grupo_muscular, target=excluded.target, secondary=excluded.secondary,
       equipment=excluded.equipment, instrucciones=excluded.instrucciones, pasos=excluded.pasos,
       media_id=excluded.media_id, attribution=excluded.attribution, updated_at=now()`,
    [e.id, e.name, nombresEs[e.id] || null, e.body_part, e.muscle_group || null,
     e.target || null, e.secondary_muscles || [], e.equipment || null,
     JSON.stringify(e.instructions || {}), JSON.stringify(e.instruction_steps || {}),
     e.media_id || null, e.attribution || null])
  ok++
  if (ok % 200 === 0) console.log(`  ${ok}/${ejercicios.length}`)
}
console.log(`Importados: ${ok}`)
await pool.end()
