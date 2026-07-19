import { openDB } from 'idb'

const DB_NAME = 'cdms-reader'
const DB_VERSION = 1

// Estructura de la base de datos local (todo vive en el navegador, sin servidor):
//  - books:    metadatos de cada manga { id, title, format, pageCount, cover, size, createdAt }
//  - pages:    cada página como Blob     { key:[bookId,index], bookId, index, name, blob }
//  - progress: última página leída       { bookId, page, updatedAt }
//  - settings: preferencias globales      { key, value }

let dbPromise = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('pages')) {
          const pages = db.createObjectStore('pages', { keyPath: ['bookId', 'index'] })
          pages.createIndex('bookId', 'bookId')
        }
        if (!db.objectStoreNames.contains('progress')) {
          db.createObjectStore('progress', { keyPath: 'bookId' })
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' })
        }
      },
    })
  }
  return dbPromise
}

function makeId() {
  // Identificador único sin dependencias externas.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

// --- Libros ---------------------------------------------------------------

export async function addBook({ title, format, pages, source }, onProgress) {
  const db = await getDB()
  const id = makeId()

  // Guardamos PÁGINA A PÁGINA en transacciones pequeñas e independientes:
  //  - Materializamos un blob (getBlob), lo pasamos a ArrayBuffer, lo guardamos
  //    y liberamos la referencia antes de la siguiente. Así el pico de memoria
  //    es ~1 página, no el manga entero (evita que Safari/iOS mate la pestaña).
  //  - Guardamos como ArrayBuffer porque Safari/iOS no admite File/Blob en
  //    IndexedDB ("Error preparing Blob/File data to be stored in object store").
  //  - El registro del libro se escribe al FINAL: si algo falla a mitad, no
  //    queda un libro roto en la biblioteca.
  let size = 0
  let cover = null
  let stored = 0 // índice contiguo de páginas realmente guardadas
  let failed = 0
  let firstError = null

  for (let i = 0; i < pages.length; i++) {
    let data
    let type
    try {
      // Reintenta: en iOS, leer un archivo de iCloud puede fallar hasta que
      // termina de descargarse; un par de reintentos con pausa suele bastar.
      let lastErr
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const blob = await pages[i].getBlob()
          data = await blob.arrayBuffer()
          type = blob.type || ''
          lastErr = null
          break
        } catch (e) {
          lastErr = e
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        }
      }
      if (lastErr) throw lastErr
    } catch (err) {
      // Un archivo puede ser ilegible (p. ej. está en iCloud sin descargar).
      // No abortamos: saltamos esa página y seguimos con el resto.
      failed++
      if (!firstError) firstError = err
      pages[i].getBlob = null
      continue
    }
    size += data.byteLength
    await db.put('pages', {
      bookId: id,
      index: stored,
      name: pages[i].name ?? `page-${stored}`,
      type,
      data,
    })
    if (stored === 0) cover = { data, type }
    stored++
    pages[i].getBlob = null // permite liberar memoria de la fuente
    onProgress?.((i + 1) / pages.length)
  }

  if (stored === 0) {
    const reason = firstError?.name === 'NotReadableError' || /I\/O/i.test(firstError?.message || '')
      ? 'No se pudo leer el archivo. Si está en iCloud, ábrelo antes en la app Archivos para descargarlo, o copia el manga al almacenamiento del dispositivo.'
      : `No se pudo leer ninguna página${firstError ? ` (${firstError.message})` : ''}.`
    throw new Error(reason)
  }

  const book = {
    id,
    title,
    format,
    pageCount: stored,
    cover,
    size,
    source: source ?? null,
    createdAt: Date.now(),
    incomplete: failed > 0 ? failed : undefined,
  }
  await db.put('books', book)
  return { ...book, cover: recToBlob(cover), failed }
}

// Reconstruye un Blob a partir de lo guardado. Soporta el formato nuevo
// ({ data: ArrayBuffer, type }) y filas antiguas que guardaban un Blob directo.
function recToBlob(rec) {
  if (!rec) return null
  if (rec instanceof Blob) return rec
  if (rec.data) return new Blob([rec.data], { type: rec.type || 'application/octet-stream' })
  return null
}

export async function getBooks() {
  const db = await getDB()
  const all = await db.getAll('books')
  return all
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((b) => ({ ...b, cover: recToBlob(b.cover) }))
}

export async function getBook(id) {
  const db = await getDB()
  const b = await db.get('books', id)
  return b ? { ...b, cover: recToBlob(b.cover) } : b
}

export async function deleteBook(id) {
  const db = await getDB()
  const tx = db.transaction(['books', 'pages', 'progress'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('progress').delete(id)
  // Borra todas las páginas del libro.
  const idx = tx.objectStore('pages').index('bookId')
  let cursor = await idx.openCursor(IDBKeyRange.only(id))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

// --- Páginas --------------------------------------------------------------

export async function getPage(bookId, index) {
  const db = await getDB()
  const row = await db.get('pages', [bookId, index])
  if (!row) return null
  // Fila nueva: { data, type }. Fila antigua: { blob }.
  const blob = row.blob ? recToBlob(row.blob) : recToBlob(row)
  return { name: row.name, blob }
}

// --- Progreso -------------------------------------------------------------

export async function saveProgress(bookId, page) {
  const db = await getDB()
  await db.put('progress', { bookId, page, updatedAt: Date.now() })
}

export async function getProgress(bookId) {
  const db = await getDB()
  return db.get('progress', bookId)
}

// --- Preferencias ---------------------------------------------------------

export async function getSetting(key, fallback = null) {
  const db = await getDB()
  const row = await db.get('settings', key)
  return row ? row.value : fallback
}

export async function setSetting(key, value) {
  const db = await getDB()
  await db.put('settings', { key, value })
}

// --- Utilidades -----------------------------------------------------------

export async function estimateUsage() {
  if (navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate()
    return { usage: usage ?? 0, quota: quota ?? 0 }
  }
  return { usage: 0, quota: 0 }
}
