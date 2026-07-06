-- PowerGym: la landing se veia pobre (diseno "brutal" = rojo plano con texto
-- negro y fuente sin caracter). Es el gym que enlaza la landing PRINCIPAL de
-- FitCore ("ver un gym de ejemplo"), asi que debe lucir. Lo pasamos al mismo
-- nivel que MaximusGym: diseno NEON (oscuro con resplandor del color de marca),
-- fuente de poster (Anton), titulos en mayuscula, hero completo y WhatsApp
-- flotante. Mantiene su rojo de marca (#d13e1a) sobre un fondo casi negro.
update empresa
set landing = landing
  || jsonb_build_object(
       'estilo', (landing->'estilo')
         || jsonb_build_object(
              'diseno', 'neon',
              'fuente', 'Anton',
              'botones', 'recto',
              'tarjetas', 'recta',
              'titulo_mayus', true,
              'hero_altura', 'completo',
              'cta_texto', 'QUIERO ENTRENAR',
              'whatsapp_flotante', true
            ),
       -- Fondo casi negro con un toque del rojo de marca; el primary rojo
       -- resplandece encima (el diseno neon usa color_primary para el glow).
       'colores', jsonb_build_object(
            'primary', '#E8461E',
            'oscuro', '#0B0708'
          ),
       'hero_overlay', 0.5,
       'whatsapp_flotante', true
     )
where slug = 'powergym';
