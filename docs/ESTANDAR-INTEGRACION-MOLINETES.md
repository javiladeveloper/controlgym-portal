# Estándar de integración de molinetes / lectores — FitCore

> Para la reunión con **Life Store / Life Servicios** y para el equipo técnico.
> Objetivo: conectar molinetes biométricos y lectores a FitCore **a nivel
> nacional, sin que nosotros configuremos cada equipo a mano**.

## El principio: nosotros no viajamos

Vender la integración en todo el país exige un **estándar único**. El gimnasio,
en cualquier ciudad, debe poder:

1. Comprar el molinete.
2. Instalarlo (lo hace el proveedor del hardware).
3. Conectarlo a FitCore en **3 pasos guiados** desde su panel.
4. Que funcione solo desde ahí.

Sin visitas técnicas nuestras. Esto se logra con la arquitectura del **Agente
Puente**.

## Arquitectura: el Agente Puente

El molinete **no habla directo con FitCore**. En medio va una pieza de software
liviana instalada en la PC del gimnasio:

```
┌─────────────┐  USB / red local  ┌──────────────┐   internet (HTTPS)   ┌─────────────┐
│  MOLINETE   │ ────────────────> │ AGENTE PUENTE│ ───────────────────> │  FITCORE    │
│ lector +    │  "huella #45      │ (app en la   │  Bearer <API key>    │  (nube)     │
│ biométrico  │   entró"          │  PC del gym) │  POST /checkin/hardware   │        │
└─────────────┘ <──────────────── └──────────────┘ <─────────────────── └─────────────┘
                 abre / no abre         traduce          permitido/denegado
```

- **El Agente Puente traduce** el "idioma" de cada marca (ZKTeco, Hikvision,
  Suprema…) al **único formato** de FitCore.
- FitCore siempre ve lo mismo, sin importar la marca → **un solo estándar**.
- Un molinete nuevo = se actualiza el agente, **no** el sistema.

## Lo que YA está construido y probado (lado nube)

Listo y verificado end-to-end contra la base de datos real:

- **API key por gimnasio** — el admin la genera de un clic en
  `Configuración → Control de acceso → Clave de conexión`. Se muestra una vez
  (`fk_live_…`), se guarda **hasheada** (nunca en claro), y se pega en el agente.
  Se puede **regenerar** o **revocar**.
- **Endpoint estándar** `POST /api/checkin/hardware`:
  ```
  Authorization: Bearer fk_live_...
  Body: { credencial: "<id que da el lector>", tipo: "huella"|"tarjeta"|"facial",
          dispositivo?: "<nombre/serie>", direccion?: "entrada"|"salida" }
  →  { resultado: "permitido"|"denegado", nombre, rol, tipo, motivo?, hora? }
  ```
  Identifica al socio/staff por su credencial enrolada, valida la membresía,
  registra el acceso, alterna entrada/salida y abre/cierra el turno del staff.
  El molinete abre la puerta solo si `resultado === "permitido"`.
- **Enrolamiento** — la huella/tarjeta se asocia al socio o colaborador desde el
  panel (`Enrolar huella / rostro / tarjeta`, ya existente).

## Lo que falta (necesita el hardware real)

- **El Agente Puente** en sí: el programa que lee la marca concreta del molinete
  y llama a nuestro endpoint. Es un desarrollo aparte (típicamente un servicio
  de Windows) y se construye **contra un endpoint que ya existe y funciona**.
- El **botón "Capturar huella"** que dialoga con el lector durante el
  enrolamiento (va dentro del agente / SDK del fabricante).

## Los dos flujos de enrolamiento (ambos ya soportados por el modelo)

1. **Socio que viene a la sede**: recepción abre su ficha → "Enrolar huella" →
   el lector captura → queda asociado. Desde ahí entra con su huella.
2. **Socio que se registró y pagó por la app**: al llegar la primera vez,
   recepción lo busca (ya existe como socio, vino por *Pagos por activar*) →
   "Enrolar huella" → asociado.

En ambos, la huella viaja como un **identificador** que da el lector; FitCore lo
guarda contra el socio. Cuando esa huella se lea en el molinete, el acceso se
resuelve solo.

## Preguntas clave para Life Store (definen el esfuerzo del Agente Puente)

1. **¿El molinete tiene API, SDK o webhook?** ¿Puede avisar a un software
   externo cuando alguien pasa, y recibir un "abre/no abre"?
2. **¿Qué marca y modelo exacto es?** (ZKTeco es lo más común e integrable en
   Perú; Hikvision y Suprema también tienen SDK).
3. **¿El SDK corre en Windows?** ¿Es gratuito o tiene licencia por equipo?
4. **¿La huella se captura en el molinete y expone un ID reutilizable**, o cada
   marca guarda la plantilla biométrica en su propia nube cerrada?
5. **¿Trabaja offline** (registra aunque se caiga el internet y sincroniza
   luego) o exige conexión permanente?

**Regla práctica:** si el equipo **tiene API/SDK de Windows con un ID de huella
reutilizable**, la integración del Agente Puente es de **1–2 días** y después el
flujo completo funciona (biométrico → valida membresía → abre turno de staff,
igual que ya probamos con el QR). Si es una **caja cerrada que solo habla con la
nube del fabricante**, hay que evaluarlo caso por caso.

---

Creado: 2026-07-09. Lado nube del estándar construido y probado (migración
`20260706000021_api_key_hardware.sql`, endpoint `api/checkin/hardware.js`,
panel `Clave de conexión`). Pendiente: el Agente Puente, con hardware real.
