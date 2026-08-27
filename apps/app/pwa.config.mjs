/** Shared PWA manifest fields for vite-plugin-pwa. */
/** Background for the Condui wordmark favicon and install tiles. */
export const PWA_THEME_COLOR = '#1f2937'
/** Splash / icon tile — matches generated PWA PNGs (wordmark on slate). */
export const PWA_BACKGROUND_COLOR = PWA_THEME_COLOR

/** Install / taskbar / start-menu branding (always Condui, not domain-based). */
export const PWA_APP_SHORT_NAME = 'Condui'
export const PWA_APP_NAME = 'Condui – Electrical Diagram Tool'

export const pwaManifest = {
  id: '/',
  name: PWA_APP_NAME,
  short_name: PWA_APP_SHORT_NAME,
  description:
    'Design one-line diagrams, situation plans, and panel layouts for Belgian electrical installations.',
  theme_color: PWA_THEME_COLOR,
  background_color: PWA_BACKGROUND_COLOR,
  display: 'standalone',
  start_url: '/',
  scope: '/',
  lang: 'en',
  icons: [
    {
      src: '/pwa/icon-192.png',
      sizes: '192x192',
      type: 'image/png',
    },
    {
      src: '/pwa/icon-512.png',
      sizes: '512x512',
      type: 'image/png',
    },
    {
      src: '/pwa/icon-512-maskable.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    },
  ],
}
