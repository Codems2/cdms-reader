import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// La app se sirve bajo /cdms-reader/ en GitHub Pages, y bajo / en local.
// Usa BASE_PATH para sobreescribir si hace falta.
const base = process.env.BASE_PATH ?? '/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precarga todo el bundle para que la app funcione 100% sin conexión.
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2,wasm}'],
        // Los archivos de manga pueden ser grandes; el SW solo cachea la app,
        // no el contenido (que vive en IndexedDB).
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: `${base}index.html`,
      },
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'CDMS Reader — Lector de manga offline',
        short_name: 'CDMS Reader',
        description:
          'Lee tus mangas locales (CBZ, ZIP, PDF, imágenes) sin conexión. Multiplataforma e instalable.',
        theme_color: '#0f1115',
        background_color: '#0f1115',
        display: 'standalone',
        orientation: 'any',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
  // pdf.js usa un worker; Vite lo maneja bien con el import ?url en el código.
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
})
