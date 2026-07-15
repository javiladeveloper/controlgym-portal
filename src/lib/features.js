// Flags de funcionalidades que se pueden activar/desactivar sin desplegar código
// disperso. Un solo lugar para prender/apagar features que están construidas pero
// aún no se ofrecen al cliente.

// IA Leadia (bot que responde redes): construida e integrada, PERO oculta hasta
// resolver la conexión con Meta/WhatsApp (sin eso el gym no la puede activar de
// verdad). Poner en `true` cuando la conexión con Meta esté lista para reactivar
// el tab de Configuración, las vistas del CRM y la sección de la landing.
export const LEADIA_VISIBLE = false
