// Flags de funcionalidades que se pueden activar/desactivar sin desplegar código
// disperso. Un solo lugar para prender/apagar features que están construidas pero
// aún no se ofrecen al cliente.

// Finny (el bot que atiende las redes del gimnasio). Estuvo oculto porque
// faltaba lo esencial: la pantalla para conectar Meta/WhatsApp. El panel
// prometía "atiende tu WhatsApp 24/7" y no había dónde conectarlo, así que el
// gym no podía activarlo de verdad.
//
// 2026-09-02: se construyó esa pantalla (config/ConectarRedes.jsx + el proxy
// `?action=canales`), con WhatsApp por Embedded Signup e Instagram/Messenger/
// TikTok por OAuth. Encendido.
//
// Requiere VITE_META_APP_ID y VITE_META_ES_CONFIG_ID en el entorno: sin ellas
// las otras redes funcionan, pero el botón de WhatsApp avisa que falta configurar.
export const LEADIA_VISIBLE = true

// Facturación electrónica (NORAC): el tab está construido pero NORAC aún no está
// en producción (sale en ~1 mes). Oculto para TODOS hasta entonces. Cuando salga:
// poner en `true` — el módulo 'facturacion' rank 3 la dejará solo para Pro.
export const FACTURACION_VISIBLE = false
