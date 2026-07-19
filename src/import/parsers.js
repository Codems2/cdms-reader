import JSZip from 'jszip'

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i

// Ordena de forma "natural": page2 antes que page10.
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '')
}

// --- CBZ / ZIP ------------------------------------------------------------

export async function parseZip(file, onProgress) {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files)
    .filter((e) => !e.dir && IMAGE_EXT.test(e.name))
    // Ignora recursos de macOS y ficheros ocultos.
    .filter((e) => !e.name.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX'))
    .sort((a, b) => naturalCompare(a.name, b.name))

  if (entries.length === 0) {
    throw new Error('El archivo no contiene imágenes.')
  }

  const pages = []
  for (let i = 0; i < entries.length; i++) {
    const blob = await entries[i].async('blob')
    pages.push({ name: entries[i].name.split('/').pop(), blob })
    onProgress?.((i + 1) / entries.length)
  }
  return pages
}

// --- PDF (renderiza cada página a imagen con pdf.js) ----------------------

let pdfjsLib = null
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  const lib = await import('pdfjs-dist')
  // El worker se resuelve como URL empaquetada por Vite (funciona offline).
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = worker.default
  pdfjsLib = lib
  return lib
}

export async function parsePdf(file, onProgress, { scale = 2 } = {}) {
  const lib = await loadPdfJs()
  const data = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data }).promise
  const pages = []

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    await page.render({ canvasContext: ctx, viewport }).promise
    const blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b), 'image/webp', 0.85),
    )
    pages.push({ name: `page-${String(n).padStart(4, '0')}.webp`, blob })
    // Libera memoria del canvas.
    canvas.width = canvas.height = 0
    onProgress?.(n / pdf.numPages)
  }
  return pages
}

// --- Imágenes sueltas o carpeta -------------------------------------------

export async function parseImages(files, onProgress) {
  const imgs = Array.from(files)
    .filter((f) => IMAGE_EXT.test(f.name) || f.type.startsWith('image/'))
    .sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name))

  if (imgs.length === 0) throw new Error('No se seleccionaron imágenes válidas.')

  const pages = imgs.map((f) => ({ name: f.name, blob: f }))
  onProgress?.(1)
  return pages
}

// --- Dispatcher -----------------------------------------------------------

export function detectFormat(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.cbz') || name.endsWith('.zip')) return 'zip'
  if (name.endsWith('.pdf')) return 'pdf'
  if (name.endsWith('.cbr') || name.endsWith('.rar')) return 'rar'
  if (IMAGE_EXT.test(name) || file.type?.startsWith('image/')) return 'image'
  return 'unknown'
}

// Procesa un único archivo contenedor (CBZ/ZIP o PDF) y devuelve {title, format, pages}.
export async function importFile(file, onProgress) {
  const format = detectFormat(file)
  const title = stripExt(file.name)

  if (format === 'zip') {
    return { title, format: 'cbz', pages: await parseZip(file, onProgress) }
  }
  if (format === 'pdf') {
    return { title, format: 'pdf', pages: await parsePdf(file, onProgress) }
  }
  if (format === 'rar') {
    throw new Error(
      'Los archivos CBR/RAR aún no están soportados. Convierte a CBZ/ZIP para leerlos.',
    )
  }
  throw new Error(`Formato no soportado: ${file.name}`)
}

// Procesa una selección de imágenes sueltas (o una carpeta) como un solo manga.
export async function importImages(files, title, onProgress) {
  const pages = await parseImages(files, onProgress)
  return { title, format: 'images', pages }
}
