// Edge Middleware: los crawlers de redes sociales (WhatsApp, Facebook…) no
// ejecutan JS, así que se les enruta a /api/og, que responde los meta Open
// Graph del GYM del subdominio (su nombre, eslogan y foto) en vez de la marca
// FitCore. Los usuarios reales siguen recibiendo la SPA sin tocar.
import { rewrite, next } from '@vercel/edge'

const BOTS = /facebookexternalhit|whatsapp|twitterbot|linkedinbot|telegrambot|slackbot|discordbot|pinterestbot|skypeuripreview/i

export const config = {
  // Solo páginas: nada de assets, api ni archivos estáticos
  matcher: ['/((?!api/|assets/|landing/|favicon|robots).*)'],
}

export default function middleware(request) {
  const ua = request.headers.get('user-agent') || ''
  if (BOTS.test(ua)) {
    return rewrite(new URL('/api/og', request.url))
  }
  return next()
}
