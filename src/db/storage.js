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

export async function addBook({ title, format, pages, source }) {
  const db = await getDB()
  const id = makeId()

  // IMPORTANTE: convertimos cada imagen a ArrayBuffer ANTES de abrir la
  // transacción. Safari/iOS no puede guardar objetos File/Blob directamente
  // en IndexedDB ("Error preparing Blob/File data to be stored in object
  // store"); los ArrayBuffer sí son compatibles en todos los navegadores.
  // Además, esperar un await no-IndexedDB dentro de la transacción la cerraría.
  const prepared = []
  let size = 0
  for (let i = 0; i < pages.length; i++) {
    const blob = pages[i].blob
    const data = await blob.arrayBuffer()
    size += data.byteLength
    prepared.push({ name: pages[i].name ?? `page-${i}`, type: blob.type || '', data })
  }
  const cover = prepared[0] ? { data: prepared[0].data, type: prepared[0].type } : null

  const book = {
    id,
    title,
    format,
    pageCount: prepared.length,
    cover,
    size,
    source: source ?? null,
    createdAt: Date.now(),
  }

  const tx = db.transaction(['books', 'pages'], 'readwrite')
  await tx.objectStore('books').put(book)
  const pagesStore = tx.objectStore('pages')
  for (let i = 0; i < prepared.length; i++) {
    await pagesStore.put({
      bookId: id,
      index: i,
      name: prepared[i].name,
      type: prepared[i].type,
      data: prepared[i].data,
    })
  }
  await tx.done
  return { ...book, cover: recToBlob(cover) }
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
