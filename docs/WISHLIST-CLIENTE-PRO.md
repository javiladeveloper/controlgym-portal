# Wishlist de cliente potencial (gym grande con equipo comercial) — análisis de factibilidad

> Fuente: conversación del owner con un posible cliente (2026-07-11). ~33 pedidos.
> Clasificación verificada contra el código y la BD real de FitCore, no de memoria.
> Perfil del cliente: gym grande, multi-tier (elite/vip/básico), con asesores de
> venta → encaja en el plan Pro. Muchos pedidos ya existen o son reportes sobre
> datos que ya capturamos.

## Resumen ejecutivo

| Categoría | Cuántos | % del pedido |
|---|---|---|
| ✅ Ya existe hoy (mostrar en demo) | 9 | ~27% |
| 📊 Reporte rápido (datos ya existen, falta la vista) | 10 | ~30% |
| 🔨 Construcción real (feature nueva, factible) | 11 | ~33% |
| ⛔ No prometer / tercero | 3 | ~10% |

---

## ✅ YA EXISTE — mostrar en la demo tal cual

| Pedido | Dónde está |
|---|---|
| Mostrar la foto del socio | Ficha del socio (foto + validación). **Alcance real del cliente:** verla AL CHECK-IN para corroborar identidad (anti-suplantación) cuando el gym NO tiene huellero — eso falta y es talla S: RPCs de check-in devuelven foto aprobada + modal la muestra grande + EN VIVO con miniatura. Con biométrico el hardware ya verifica. |
| Reporte de deudas / socios que incumplen | Membresías → saldos + botón 🔔 Recordar (`socios_por_cobrar`) |
| Clientes por vencer | Dashboard + alertas automáticas (1-2 días antes + push) |
| Recordatorio de vencidas | `recordar_vencimientos_socios` (email/push automático) |
| Hora de mayor afluencia | Dashboard (asistencia por hora, con datos de check-in) |
| Membresías congeladas | Feature de congelamiento existe (falta solo la vista-reporte → ver 📊) |
| Importar molinetes | Estándar de integración + API de hardware (`checkin_hardware`, doc ESTANDAR-INTEGRACION-MOLINETES) |
| Encuestas/voz del cliente (base) | Buzón de sugerencias en la web del gym |
| Integración WhatsApp (nivel 1) | Links wa.me en todo el panel (recibos, recordatorios, cobranza) |

## 📊 REPORTE RÁPIDO — los datos ya se capturan, falta la pantalla (días, no semanas)

| Pedido | Base de datos que ya existe |
|---|---|
| Historial de pagos y membresías del cliente | `movimiento_financiero` + `membresia` por socio → pestaña en la ficha |
| Control de aforo (en vivo) POR SEDE | `sede.aforo_max` + check-ins → contador en dashboard. AMPLIADO (2026-07-11): (a) alerta push/email al admin al pasar umbral (80%/100%); (b) aforo visible PARA EL SOCIO en la app ("34/80 — moderado") para decidir si ir → handoff al agente de la app. MATIZ: gyms sin marca de salida → expiración automática (~2h) como estima el rubro. |
| Reporte de membresías congeladas | tabla `congelamiento` |
| Reporte de ausentes (no vienen hace X días) | `checkin` (última visita ya se muestra en Clientes) |
| Venta por día / semana / mes | `movimiento_financiero` (Finanzas ya agrupa por mes) |
| Tasa de cancelación (churn) | membresías vencidas no renovadas |
| Proyección de ingresos | renovaciones esperadas del mes (membresías activas × precio) |
| Nuevos socios por día | `socio.created_at` |
| Asistencia del personal por sede y general | `asistencia_staff` + check-in staff (Reportes ya tiene la base) |
| KPIs en tiempo real | Dashboard ya es vivo; se amplían las tarjetas |

## 🔨 CONSTRUCCIÓN REAL — factible, requiere diseño + desarrollo

### Bloque COMERCIAL/MARKETING (el CRM ya asigna asesor: `lead.asignado_a`)
| Pedido | Qué falta | Tamaño |
|---|---|---|
| Agenda comercial | vista calendario de tareas de leads (lead_tarea existe) | S |
| Seguimiento a ex-socios ("alguna vez estuvieron") | ex-socios → pipeline de reactivación en CRM | S |
| Registro de llamadas de asesores | tipo "llamada" en seguimientos + notas | S |
| Alerta de tiempo de seguimiento por asesor | SLA: lead sin tocar X horas → push al admin (infra push existe) | M |
| Conversión individual por asesor | reporte leads asignados → inscritos por asesor | S |
| Venta por asesor / prospectos vs nuevos vs que regresan | atribuir venta al vendedor (agregar vendedor a inscripción/renovación) + clasificación de origen | M |
| Meta diaria por vendedor (dashboard) | config de metas + tracking vs ventas del día | M |
| Ranking de vendedores | deriva de lo anterior | S |
| Ranking de entrenadores | atenciones de ayuda + clases dictadas + socios asignados | S |
| Recomendaciones de pago por comportamiento | análisis histórico: qué promo pagó cada cliente años pasados, patrón de pago → sugerencia (reglas, no ML) | M |
| Automatizar cumpleaños | cron + push/email/WhatsApp-link (fecha_nacimiento existe) | S |
| Encuestas de satisfacción (NPS post-visita) | push con encuesta corta + reporte | M |

### Bloque OPERACIÓN DEL GYM
| Pedido | Qué falta | Tamaño |
|---|---|---|
| Reservas grupales con posición en sala | `reserva_clase` existe (básica); falta: mapa de posiciones de la sala, y ventanas de reserva por tier (elite 60min antes, vip 45, básico 30) | **L** (la más grande) |
| Comisiones del personal | planilla existe (sueldo, pago por clase); falta: comisiones de venta por asesor, control de vacaciones | M |
| **Horarios/turnos del personal** | NO existe: definir turnos por empleado/sede y cruzar con asistencia real (tardanzas/faltas). Detectado en re-auditoría — iba dentro de "comisiones (asistencia, horario personal, vacaciones)" | M |
| Alertas preventivas de mantenimiento | `mantenimiento.fecha_programada` existe → cron + push al admin cuando se acerca | S |
| WhatsApp nivel 2 (envío automático) | WhatsApp Business API de Meta: plantillas aprobadas + costo por conversación (~$0.05-0.07). Factible pero con costo recurrente del gym | M-L |
| Firma digital de contratos (nivel aceptación) | contrato PDF + aceptación en la app (OTP/firma dibujada + timestamp). Válido como consentimiento comercial | M |

## ⛔ NO PROMETER (o derivar a tercero)

| Pedido | Por qué |
|---|---|
| **Grabación de llamadas de asesores** | Requiere telefonía/central VoIP (no es del panel web). Solo viable si el gym usa una central con API (ej. Zadarma/CloudTalk) y se integra — y tiene implicancias legales de consentimiento en Perú. Recomendación: registrar la llamada como seguimiento con notas (sí factible); la grabación, con su central telefónica. |
| **Firma digital CERTIFICADA (valor legal pleno)** | Firma electrónica certificada Perú = proveedor acreditado (Llama.pe, Keynua, etc.) — integración de tercero con costo por firma. La "aceptación digital" simple sí la hacemos nosotros (arriba). Prometer la certificada solo si el cliente paga el tercero. |
| **"KPI en tiempo real" nivel bolsa de valores** | Lo razonable (dashboard vivo con refresco) sí; streaming por-segundo no aporta y cuesta. Ajustar expectativa. |

---

## Plan propuesto (olas)

1. **Ola 0 — Demo con lo que ya hay** (0 desarrollo): foto, deudas, vencimientos, afluencia, molinetes, WhatsApp links. Vender lo existente primero.
2. **Ola 1 — Paquete de reportes** (los 10 📊): una sección Reportes ampliada. Es el mayor "wow por sol invertido" — todos los datos ya están.
3. **Ola 2 — CRM comercial Pro** (asesores: conversión, metas, rankings, alertas SLA, agenda, ex-socios, cumpleaños). Este bloque ES el diferenciador para gyms con equipo de ventas → justifica plan Pro.
4. **Ola 3 — Reservas con posición + tiers** (la feature L) + comisiones/vacaciones + mantenimiento preventivo.
5. **Ola 4 — Integraciones con costo** (WhatsApp Business API, firma certificada) — solo si el cliente las paga.

## Marketing + IA (add-on Leadia)

El "tema marketing" completo son 3 capas: (1) CRM comercial = Ola 2; (2) campañas
segmentadas automáticas (cumpleaños, reactivación, promos dirigidas por segmento:
ausentes/por vencer/morosos — canales push+email+WhatsApp); (3) **IA de
recomendaciones de precio/plan por cliente**.

**Arquitectura de la IA (decidida):** híbrida — SQL calcula el perfil de pago por
cliente (sensibilidad al precio: ¿renueva a precio lleno o solo con promo?, promos
pagadas años pasados, patrón/atrasos de pago, tendencia de asistencia = riesgo de
fuga) → un LLM (Claude, modelo económico, batch mensual ≈ centavos) convierte ese
perfil en recomendación explicada + redacta el mensaje de la promo + responde
preguntas del admin en lenguaje natural. NO ML entrenado (gyms chicos no tienen
datos para eso; reglas + LLM funcionan desde el día 1 y escalan con historial).

**Negocio:** esto se empaqueta como **Leadia para gimnasios** — el owner ya definió
que Leadia es paquete aparte que suma al costo (no feature del Pro). Nueva línea de
ingreso: "análisis inteligente de promociones y precios = Leadia, +S/XX/mes".

## Corte de planes decidido por el owner (2026-07-11)

- **Base (Estudio/Crecimiento):** operar el gym — socios, membresías, check-in,
  POS + boleta SUNAT, caja, kardex, clases, rutinas, CRM básico, reportes
  esenciales (ventas del mes, deudas, por vencer).
- **PRO = "gestión avanzada y KPIs"** (justifica los +S/80): KPIs/analítica
  (churn, proyección, aforo vivo, afluencia, historial de pagos por cliente),
  gestión comercial (conversión/metas/rankings por asesor, SLA, agenda,
  ex-socios), operación avanzada (reservas con posición + tiers, turnos del
  personal, comisiones/vacaciones, mantenimiento preventivo, foto al check-in),
  campañas (cumpleaños, NPS, promos por segmento). Molinete/huella ya era Pro.
- **Add-ons que suman al costo:** App del socio (ya existe), **Leadia IA**
  (recomendaciones de precio/plan), WhatsApp Business API, firma certificada.
- **Canales de campañas:** email (Resend, YA existe, sin costo extra) como canal base; push de la app; WhatsApp API solo como premium opcional con costo. El owner prefirió email sobre WhatsApp para las alertas.
- **IA ya anunciada al cliente** como herramienta a futuro: venderla como
  "roadmap, se contrata aparte cuando salga" — SIN fecha comprometida.
- Pendiente: reflejar este corte en la página de precios del landing (esperando
  OK del owner para tocar lo público).

## Notas de venta
- El pedido confirma el pricing por sede/Pro: equipo comercial + multi-tier = cliente Pro.
- Varios pedidos ya son fortalezas nuestras vs Fitco (facturación SUNAT integrada, POS, molinetes estándar).
- NO prometer grabación de llamadas ni firma certificada sin tercero — decirlo claro evita un cliente decepcionado.
