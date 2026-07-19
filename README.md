# 📖 CDMS Reader

Lector de manga **offline-first** y **multiplataforma**. Es una web (PWA) que lee
tus propios archivos de manga desde el dispositivo, sin necesidad de conexión a
internet. Nacido como port web de una app de Android de lectura de manga.

> Todo el contenido se guarda en tu dispositivo (IndexedDB). La app no sube nada a
> ningún servidor ni necesita cuenta. Una vez cargada, funciona 100% sin conexión.

## Características

- **Formatos**: `.cbz` / `.zip`, `.cbr` / `.rar`, `.pdf` y carpetas de imágenes (JPG, PNG, WebP, GIF, AVIF…).
- **Biblioteca local** con portadas, número de páginas y barra de progreso.
- **Lector** con tres modos:
  - Página, derecha→izquierda (manga) — por defecto
  - Página, izquierda→derecha
  - Vertical continuo (webtoon)
- **Ajuste** de página: contener o ancho completo.
- **Navegación** por teclado (←/→/espacio), zonas de toque en móvil y slider.
- **Progreso guardado** automáticamente: retomas por donde ibas.
- **PWA instalable** en Android, iOS, Windows, macOS y Linux. Funciona offline
  gracias a un Service Worker que precarga la app.
- **Arrastrar y soltar** archivos sobre la ventana para importar.

## Cómo se usa

1. Abre la web (o instálala como app desde el menú del navegador).
2. Pulsa **Importar** y elige uno o varios `.cbz` / `.zip` / `.pdf`, o pulsa
   **Carpeta** para importar una carpeta de imágenes como un solo manga.
3. Toca una portada para leer. Cambia el modo de lectura desde la barra superior.

Todo el proceso funciona sin conexión una vez la app está cargada por primera vez.

## Desarrollo

Requiere Node 18+.

```bash
npm install
npm run dev       # servidor de desarrollo
npm run build     # build de producción en dist/
npm run preview   # sirve el build de producción
npm run icons     # regenera los iconos PWA (public/icons)
```

### Estructura

```
src/
  App.jsx                 orquestador: biblioteca, importación, lector
  db/storage.js           capa IndexedDB (libros, páginas, progreso, ajustes)
  import/parsers.js        parseo de CBZ/ZIP (JSZip), CBR/RAR (node-unrar-js),
                           PDF (pdf.js) e imágenes
  components/
    Library.jsx           rejilla de portadas
    Reader.jsx            lector paginado y vertical, con cache de páginas
  hooks/useOnline.js       estado de conexión (informativo)
scripts/generate-icons.mjs generador de iconos PNG sin dependencias
```

## Despliegue

El workflow `.github/workflows/deploy.yml` publica la app en **GitHub Pages** en
cada push a `main`. Activa Pages en *Settings → Pages → Source: GitHub Actions*.
La `base` se ajusta automáticamente a `/<nombre-del-repo>/`.

## Stack

React + Vite · vite-plugin-pwa (Workbox) · IndexedDB (`idb`) · JSZip · node-unrar-js · pdf.js.

## Notas y limitaciones

- El **CBR/RAR** se descomprime en el navegador con `node-unrar-js` (WASM). Funciona
  offline, pero los archivos muy grandes consumen memoria al extraerse.
- El espacio disponible depende de la cuota de almacenamiento del navegador. Para
  bibliotecas grandes, considera aceptar el almacenamiento persistente cuando el
  navegador lo ofrezca.
