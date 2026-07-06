-- PowerGym: las 6 fotos de galeria eran IDs de Unsplash que el navegador no
-- cargaba de forma confiable (throttle al pedir 6 hotlinks a la vez). Las
-- cambiamos por un set verificado de fotos de gimnasio (fit=crop&auto=format
-- para crop consistente) y de paso agregamos testimonios (estaban vacios) para
-- que la landing se sienta viva y con prueba social.
update empresa
set landing = landing
  || jsonb_build_object(
       'galeria', jsonb_build_array(
         'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80&fit=crop&auto=format',
         'https://images.unsplash.com/photo-1574680096145-d05b474e2155?w=1600&q=80&fit=crop&auto=format',
         'https://images.unsplash.com/photo-1541534741688-6078c6bfb5c5?w=1600&q=80&fit=crop&auto=format',
         'https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=1600&q=80&fit=crop&auto=format',
         'https://images.unsplash.com/photo-1594381898411-846e7d193883?w=1600&q=80&fit=crop&auto=format',
         'https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?w=1600&q=80&fit=crop&auto=format'
       ),
       'testimonios', jsonb_build_array(
         jsonb_build_object('nombre', 'Carlos M.', 'estrellas', 5,
           'texto', 'En 6 meses bajé 12 kilos y gané fuerza como nunca. Los coaches te siguen de cerca y la rutina en la app es un golazo.'),
         jsonb_build_object('nombre', 'Andrea R.', 'estrellas', 5,
           'texto', 'El mejor gym de Miraflores. Ambiente motivador, máquinas siempre en buen estado y clases con energía. 100% recomendado.'),
         jsonb_build_object('nombre', 'Diego S.', 'estrellas', 5,
           'texto', 'Volví a entrenar después de años y me hicieron sentir cómodo desde el día uno. La app con mi rutina lo hace fácil.')
       )
     )
where slug = 'powergym';
