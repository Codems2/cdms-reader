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
  const cover = pages[0]?.blob ?? null
  let size = 0
  for (const p of pages) size += p.blob?.size ?? 0

  const book = {
    id,
    title,
    format,
    pageCount: pages.length,
    cover,
    size,
    source: source ?? null,
    createdAt: Date.now(),
  }

  const tx = db.transaction(['books', 'pages'], 'readwrite')
  await tx.objectStore('books').put(book)
  const pagesStore = tx.objectStore('pages')
  for (let i = 0; i < pages.length; i++) {
    await pagesStore.put({
      bookId: id,
      index: i,
      name: pages[i].name ?? `page-${i}`,
      blob: pages[i].blob,
    })
  }
  await tx.done
  return book
}

export async function getBooks() {
  const db = await getDB()
  const all = await db.getAll('books')
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getBook(id) {
  const db = await getDB()
  return db.get('books', id)
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
  return db.get('pages', [bookId, index])
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
