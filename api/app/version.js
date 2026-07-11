// Última versión disponible de la app FitCore, para el aviso "nueva versión
// disponible" que muestra la app. El valor lo pone el CI (workflow android-release)
// en la env var APP_ANDROID_LATEST de Vercel al subir un AAB nuevo; aquí solo se
// sirve. La app compara `latest` con su propio versionCode y, si es mayor, ofrece
// actualizar abriendo `url` (la ficha de Play Store).
//
// Público (sin auth). Cache corto para que el aviso llegue rápido tras un release.

const PLAY_URL = 'https://play.google.com/store/apps/details?id=pe.fitcore.app'
const APP_STORE_URL = 'https://apps.apple.com/app/fitcore' // ajustar cuando iOS esté publicado

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'public, s-maxage=300, stale-while-revalidate=600')

  const android = parseInt(process.env.APP_ANDROID_LATEST || '0', 10) || 0
  const ios = parseInt(process.env.APP_IOS_LATEST || '0', 10) || 0

  return res.status(200).json({
    android: { latest: android, url: PLAY_URL },
    ios: { latest: ios, url: APP_STORE_URL },
  })
}
