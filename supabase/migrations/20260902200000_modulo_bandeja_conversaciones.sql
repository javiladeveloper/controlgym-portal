-- La bandeja de conversaciones de Finny entra como módulo del panel.
--
-- POR QUÉ (2026-09-02): Finny quedó atendiendo el WhatsApp del gimnasio y el
-- gym NO tenía dónde ver esas conversaciones. Un bot que le habla a tus
-- clientes sin que puedas leer lo que dice —ni meter mano cuando hace falta—
-- es una caja negra: el dueño se entera del problema cuando ya perdió la venta.
--
-- El menú del panel se arma desde `modulo` × `categoria_modulo` (qué módulos ve
-- cada TIPO de gimnasio). Sin fila acá, la pestaña existe en el código y no
-- aparece nunca.
--
-- Se le da el mismo alcance que a `crm`: es la misma gente y el mismo trabajo
-- —atender al que pregunta—, así que a los tipos de gym que tienen CRM les
-- corresponde también la bandeja. El acceso REAL igual está doblemente acotado:
--  - por rol: solo 'admin' (src/config/modules.js),
--  - por add-on: si la sede no tiene Finny contratado, la pantalla explica cómo
--    activarlo en vez de mostrar una lista vacía (el `activo:false` del proxy).

insert into public.modulo (slug, nombre, descripcion, orden, es_core)
values ('bandeja', 'Conversaciones',
        'Lo que Finny habla con tus interesados, y responder tú cuando haga falta',
        -- 2 lo usa 'crm'. El menú se ordena por el arreglo de src/config/modules.js,
        -- no por esta columna, pero repetirlo confundiría a quien lea la tabla.
        13, false)
on conflict (slug) do nothing;

-- Los mismos tipos de gimnasio que ya tienen CRM.
insert into public.categoria_modulo (categoria_id, modulo_id)
select cm.categoria_id, (select id from public.modulo where slug = 'bandeja')
from public.categoria_modulo cm
join public.modulo m on m.id = cm.modulo_id and m.slug = 'crm'
on conflict do nothing;
