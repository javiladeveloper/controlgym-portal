-- Marketing entra como módulo del panel: campañas hoy, publicar y anuncios después.
--
-- POR QUÉ (2026-09-02): el panel tenía un botón "Campañas" apagado desde julio
-- esperando una decisión del dueño — "correo gratis vs WhatsApp API (~S/0.25 el
-- mensaje)". La decisión resultó ser una falsa disyuntiva: el mensaje se lo
-- cobra META A LA TARJETA DEL GIMNASIO, no a FitCore. Ofrecerlo no nos cuesta
-- nada, y para un gym es la venta más barata que hay: escribirle al que ya fue
-- socio y dejó de venir.
--
-- Dimensión del asunto en MaximusGym el día de esta migración: 40 socios con la
-- membresía vencida contra 3 activos. Ese es exactamente el público de esto.
--
-- Mismo alcance que 'crm' y 'bandeja' (los mismos tipos de gimnasio). El acceso
-- real queda acotado además por rol (solo admin) y por el add-on de Finny: sin
-- WhatsApp conectado no hay por dónde enviar, y la pantalla lo explica.

insert into public.modulo (slug, nombre, descripcion, orden, es_core)
values ('marketing', 'Marketing',
        'Campañas por WhatsApp a tu base, publicar en redes y anuncios',
        14, false)
on conflict (slug) do nothing;

insert into public.categoria_modulo (categoria_id, modulo_id)
select cm.categoria_id, (select id from public.modulo where slug = 'marketing')
from public.categoria_modulo cm
join public.modulo m on m.id = cm.modulo_id and m.slug = 'crm'
on conflict do nothing;
