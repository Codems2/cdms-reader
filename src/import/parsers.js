import JSZip from 'jszip'
import { createExtractorFromData } from 'node-unrar-js'
// El .wasm se empaqueta como asset y se precachea para funcionar offline.
import unrarWasmUrl from 'node-unrar-js/esm/js/unrar.wasm?url'

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i

// Ordena de forma "natural": page2 antes que page10.
function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '')
}

function isJunk(path) {
  return path.split('/').some((seg) => seg.startsWith('.') || seg === '__MACOSX')
}

// Cada "página" es perezosa: { name, getBlob() }. El blob se materializa solo
// cuando se va a guardar, y se libera enseguida. Así no cargamos todo el manga
// en memoria a la vez (clave en iOS/Safari, que mata la pestaña por memoria).

// --- CBZ / ZIP ------------------------------------------------------------

export async function parseZip(file) {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files)
    .filter((e) => !e.dir && IMAGE_EXT.test(e.name) && !isJunk(e.name))
    .sort((a, b) => naturalCompare(a.name, b.name))

  if (entries.length === 0) throw new Error('El archivo no contiene imágenes.')

  return entries.map((e) => ({
    name: e.name.split('/').pop(),
    getBlob: () => e.async('blob'),
  }))
}

// --- CBR / RAR con node-unrar-js (WASM puro, sin worker, offline) ---------

let unrarWasm = null
async function getUnrarWasm() {
  if (!unrarWasm) {
    const res = await fetch(unrarWasmUrl)
    unrarWasm = await res.arrayBuffer()
  }
  return unrarWasm
}

export async function parseRar(file) {
  const wasmBinary = await getUnrarWasm()
  const data = await file.arrayBuffer()
  const extractor = await createExtractorFromData({ wasmBinary, data })

  const headers = [...extractor.getFileList().fileHeaders]
    .filter((h) => !h.flags.directory && IMAGE_EXT.test(h.name) && !isJunk(h.name))
    .sort((a, b) => naturalCompare(a.name, b.name))

  if (headers.length === 0) throw new Error('El archivo no contiene imágenes.')

  // Extraemos todo una vez (el RAR ya está en memoria) y vamos liberando cada
  // imagen conforme se guarda.
  const extracted = extractor.extract({ files: headers.map((h) => h.name) })
  const bytesByName = new Map()
  for (const f of extracted.files) {
    if (f.extraction) bytesByName.set(f.fileHeader.name, f.extraction)
  }

  return headers
    .filter((h) => bytesByName.has(h.name))
    .map((h) => ({
      name: h.name.split('/').pop(),
      getBlob: async () => {
        const bytes = bytesByName.get(h.name)
        bytesByName.delete(h.name) // libera memoria tras usarla
        return new Blob([bytes])
      },
    }))
}

// --- PDF (renderiza cada página a imagen, bajo demanda) -------------------

let pdfjsLib = null
async function loadPdfJs() {
  if (pdfjsLib) return pdfjsLib
  const lib = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  lib.GlobalWorkerOptions.workerSrc = worker.default
  pdfjsLib = lib
  return lib
}

export async function parsePdf(file, { scale = 2 } = {}) {
  const lib = await loadPdfJs()
  const data = await file.arrayBuffer()
  const pdf = await lib.getDocument({ data }).promise

  const pages = []
  for (let n = 1; n <= pdf.numPages; n++) {
    pages.push({
      name: `page-${String(n).padStart(4, '0')}.webp`,
      // Renderiza la página solo cuando se va a guardar (memoria mínima).
      getBlob: async () => {
        const page = await pdf.getPage(n)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        await page.render({ canvasContext: ctx, viewport }).promise
        const blob = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/webp', 0.85))
        canvas.width = canvas.height = 0
        page.cleanup?.()
        return blob
      },
    })
  }
  return pages
}

// --- Imágenes sueltas o carpeta -------------------------------------------

export function parseImages(files) {
  const imgs = Array.from(files)
    .filter((f) => IMAGE_EXT.test(f.name) || f.type?.startsWith('image/'))
    .sort((a, b) => naturalCompare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name))

  if (imgs.length === 0) throw new Error('No se seleccionaron imágenes válidas.')

  // Los File ya son perezosos: no ocupan memoria hasta que se leen.
  return imgs.map((f) => ({ name: f.name, getBlob: async () => f }))
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

// Devuelve { title, format, pages:[{name, getBlob}] } sin materializar los blobs.
export async function importFile(file) {
  const format = detectFormat(file)
  const title = stripExt(file.name)

  if (format === 'zip') return { title, format: 'cbz', pages: await parseZip(file) }
  if (format === 'pdf') return { title, format: 'pdf', pages: await parsePdf(file) }
  if (format === 'rar') return { title, format: 'cbr', pages: await parseRar(file) }
  throw new Error(`Formato no soportado: ${file.name}`)
}

export function importImages(files, title) {
  return { title, format: 'images', pages: parseImages(files) }
}
