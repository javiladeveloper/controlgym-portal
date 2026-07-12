# Integración Leadia (Hilo) → FitCore — ADD-ON FUTURO

> Estado: **en construcción / sin UI en el panel**. El conector del lado FitCore
> ya existe y está probado; falta el lado Hilo y la decisión comercial (es un
> paquete de pago aparte, no entra al plan Pro).

## La idea (validada con el owner, jul 2026)

El gym conecta **su** WhatsApp Business / Instagram / Messenger / TikTok en
Hilo (self-service OAuth que Hilo ya tiene). Los mensajes entrantes son GRATIS.
La IA de Hilo califica cada conversación (frío / tibio / caliente) y **solo los
que valen la pena** (decisión `handoff`) se empujan a FitCore como prospectos.
No todos los mensajes pasan a prospecto — ese filtro ES el valor de Leadia.

En FitCore el lead entra con fuente `"Whatsapp · Leadia"` (o el canal que sea),
el trigger existente lo **asigna solo al comunicador menos cargado** y le llega
push. Responder dentro de la ventana de 24 h es gratis (categoría Servicio).

## Contrato — lo que Hilo debe llamar

Sin función Vercel (FitCore está al tope de 12 en Hobby): se llama directo a
PostgREST de Supabase.

```
POST https://zlmqdubrjzmagslcsqvb.supabase.co/rest/v1/rpc/leadia_ingresar_lead
Headers:
  apikey: <ANON key pública de FitCore>
  Content-Type: application/json
Body:
{
  "p_secret":     "<lik_... — secreto compartido, ver abajo>",
  "p_empresa_id": "<uuid de la empresa FitCore (mapea 1:1 con el Tenant de Hilo)>",
  "p_nombre":     "María Pérez",
  "p_telefono":   "+51 999 777 111",        // opcional pero recomendado (dedup)
  "p_canal":      "whatsapp",               // whatsapp | instagram | messenger | tiktok
  "p_resumen":    "Preguntó por el plan mensual... (resumen IA de Hilo)",
  "p_sede_id":    null                      // opcional; default: primera sede activa
}
```

Respuestas (`200` siempre; el resultado va en el jsonb):
- `{ "ok": true, "lead_id": "...", "duplicado": false, "asignado_a": "<uuid comunicador>" }`
- `{ "ok": true, "duplicado": true, ... }` — la persona ya tenía un lead abierto
  (match por los ÚLTIMOS 9 DÍGITOS del teléfono); el resumen nuevo se anexa a la
  nota del lead existente, no se duplica.
- `{ "ok": false, "motivo": "no_autorizado" | "sin_nombre" | "empresa_o_sede_invalida" }`

Secreto compartido: `privado.secreto` clave `leadia_ingest_key` en la BD de
FitCore (rotable por SQL). Pasárselo a Hilo como config del tenant.

## Cuándo llama Hilo

En su `core/decision.ts`, cuando la decisión es **`handoff`** (lead caliente).
Frío/tibio se quedan en Hilo (descartar / nutrir) y NUNCA llegan a FitCore.
Falta construir en Hilo: un "destino de handoff" configurable por tenant
(tipo: webhook FitCore con estos campos). Es el único trabajo pendiente real.

## Verificado (2026-07-12, contra prod en transacción de prueba)

- Secreto inválido → `no_autorizado` ✓
- Ingreso → lead creado, fuente "Whatsapp · Leadia", asignado automático al
  comunicador menos cargado (trigger `asignar_lead_automatico`) ✓
- Mismo teléfono con/sin +51 → `duplicado: true`, nota anexada ✓

Migración: `supabase/migrations/20260712000001_leadia_ingresar_lead.sql` (aplicada).

## Pendientes para activarlo de verdad

1. Hilo: webhook saliente de handoff por tenant (payload de arriba).
2. Mapeo tenant Hilo ↔ empresa_id FitCore (config en Hilo).
3. Panel FitCore: sección "Leadia" en Configuración (conectar, estado, canal) —
   HOY NO EXISTE a propósito: primero la decisión comercial del add-on.
4. Pricing del add-on (owner) — referencia de costos en memoria
   `whatsapp-api-costos-estrategia`.
