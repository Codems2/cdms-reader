import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Library from './components/Library.jsx'
import Reader from './components/Reader.jsx'
import { useOnline } from './hooks/useOnline.js'
import { importFile, importImages, detectFormat } from './import/parsers.js'
import {
  addBook,
  deleteBook,
  getBooks,
  getProgress,
  getSetting,
  saveProgress,
  setSetting,
} from './db/storage.js'

const DEFAULT_SETTINGS = { mode: 'paged-rtl', fit: 'contain' }

// Agrupa imágenes en "mangas": una carpeta = un manga. Si vienen de una
// selección de archivos sueltos (sin rutas), todas forman un único manga.
function groupImages(images, asFolder) {
  const hasPaths = images.some((f) => f.webkitRelativePath)
  if (!asFolder && !hasPaths) {
    const title =
      images.length > 1 ? 'Manga importado' : images[0].name.replace(/\.[^.]+$/, '')
    return [{ title, files: images }]
  }
  const map = new Map()
  for (const f of images) {
    const rel = f.webkitRelativePath || f.name
    const parts = rel.split('/')
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.'
    if (!map.has(dir)) map.set(dir, [])
    map.get(dir).push(f)
  }
  return [...map.entries()]
    .map(([dir, files]) => ({
      title: dir === '.' ? 'Manga importado' : dir.split('/').pop(),
      files,
    }))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }))
}

export default function App() {
  const online = useOnline()
  const [books, setBooks] = useState([])
  const [progressMap, setProgressMap] = useState({})
  const [reading, setReading] = useState(null) // { book, startPage }
  const [importing, setImporting] = useState(null) // { label, progress }
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)

  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)

  // iOS/iPadOS: Safari tiene un bug con la selección de CARPETAS
  // (webkitdirectory) que devuelve archivos ilegibles ("The I/O read operation
  // failed"). En esos dispositivos usamos un selector de imágenes múltiple.
  const isIOS = useMemo(() => {
    if (typeof navigator === 'undefined') return false
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    )
  }, [])

  const refresh = useCallback(async () => {
    const list = await getBooks()
    setBooks(list)
    const entries = await Promise.all(
      list.map(async (b) => [b.id, await getProgress(b.id)]),
    )
    const map = {}
    for (const [id, prog] of entries) if (prog) map[id] = prog
    setProgressMap(map)
  }, [])

  useEffect(() => {
    refresh()
    getSetting('reader', DEFAULT_SETTINGS).then((s) => setSettings({ ...DEFAULT_SETTINGS, ...s }))
  }, [refresh])

  // --- Importación --------------------------------------------------------
  const handleFiles = useCallback(
    async (fileList, { asFolder = false } = {}) => {
      const files = Array.from(fileList)
      if (files.length === 0) return

      // Clasifica: contenedores (cada uno es un manga) e imágenes (se agrupan).
      const containers = files.filter((f) =>
        ['zip', 'pdf', 'rar'].includes(detectFormat(f)),
      )
      const images = files.filter((f) => detectFormat(f) === 'image')

      try {
        let totalFailedPages = 0

        // 1) Cada CBZ/ZIP/CBR/PDF -> su propio manga.
        for (const file of containers) {
          setImporting({ label: `Leyendo ${file.name}…`, progress: 0 })
          const result = await importFile(file)
          const book = await addBook(result, (p) =>
            setImporting({ label: `Importando ${file.name}… (${Math.round(p * 100)}%)`, progress: p }),
          )
          totalFailedPages += book.failed || 0
        }

        // 2) Imágenes agrupadas por carpeta (un manga por carpeta).
        if (images.length > 0) {
          const groups = groupImages(images, asFolder)
          for (const g of groups) {
            setImporting({ label: `Importando ${g.title}…`, progress: 0 })
            const result = importImages(g.files, g.title)
            const book = await addBook(result, (p) =>
              setImporting({ label: `Importando ${g.title}… (${Math.round(p * 100)}%)`, progress: p }),
            )
            totalFailedPages += book.failed || 0
          }
        }

        if (containers.length === 0 && images.length === 0) {
          throw new Error(
            'No se encontraron archivos compatibles (CBZ, ZIP, CBR, PDF o imágenes).',
          )
        }
        await refresh()
        if (totalFailedPages > 0) {
          alert(
            `Importado, pero ${totalFailedPages} página(s) no se pudieron leer y se omitieron. ` +
              `Si están en iCloud, descárgalas antes en la app Archivos.`,
          )
        }
      } catch (err) {
        const ioError =
          err?.name === 'NotReadableError' || /I\/O read|operation failed/i.test(err?.message || '')
        alert(
          ioError
            ? 'Error al importar: no se pudo leer el archivo. Si está en iCloud, ábrelo primero en la app Archivos para descargarlo (o cópialo al dispositivo) y vuelve a intentarlo.'
            : `Error al importar: ${err.message}`,
        )
      } finally {
        setImporting(null)
      }
    },
    [refresh],
  )

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  // --- Lectura ------------------------------------------------------------
  const openBook = useCallback(async (book) => {
    const prog = await getProgress(book.id)
    setReading({ book, startPage: prog?.page ?? 0 })
  }, [])

  const onSaveProgress = useCallback(
    (page) => {
      if (!reading) return
      saveProgress(reading.book.id, page)
      setProgressMap((m) => ({ ...m, [reading.book.id]: { page } }))
    },
    [reading],
  )

  const changeSettings = useCallback((patch) => {
    setSettings((s) => {
      const next = { ...s, ...patch }
      setSetting('reader', next)
      return next
    })
  }, [])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    await deleteBook(confirmDelete.id)
    setConfirmDelete(null)
    await refresh()
  }, [confirmDelete, refresh])

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <header className="header">
        <h1>📖 CDMS Reader</h1>
        <div className="grow" />
        <span className={`badge-offline ${online ? 'online' : ''}`}>
          {online ? 'En línea' : 'Sin conexión'}
        </span>
        <button
          className="btn"
          onClick={() => folderInputRef.current?.click()}
          title={isIOS ? 'Selecciona varias imágenes' : 'Importar una carpeta de imágenes'}
        >
          {isIOS ? '🖼️ Imágenes' : '📁 Carpeta'}
        </button>
        <button className="btn primary" onClick={() => fileInputRef.current?.click()}>
          ＋ Importar
        </button>
      </header>

      <main className="content">
        <Library
          books={books}
          progressMap={progressMap}
          onOpen={openBook}
          onDelete={(book) => setConfirmDelete(book)}
        />
      </main>

      {/* Inputs ocultos */}
      {/* Sin atributo accept: en Android/iOS los .cbz/.cbr no tienen tipo MIME
          registrado y el selector los bloquea. Validamos el formato en código. */}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {/* En iOS: selector de imágenes múltiple (evita el webkitdirectory roto).
          En el resto: selección de carpeta real. */}
      <input
        ref={folderInputRef}
        className="visually-hidden"
        type="file"
        multiple
        {...(isIOS ? { accept: 'image/*' } : { webkitdirectory: '', directory: '' })}
        onChange={(e) => {
          handleFiles(e.target.files, { asFolder: !isIOS })
          e.target.value = ''
        }}
      />

      {/* Estado de importación */}
      {importing && (
        <div className="import-status">
          <div>{importing.label}</div>
          <div className="track">
            <div className="fill" style={{ width: `${Math.round(importing.progress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Confirmación de borrado */}
      {confirmDelete && (
        <div className="sheet-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h3>¿Eliminar «{confirmDelete.title}»?</h3>
            <p className="hint">
              Se borrará de tu dispositivo, incluyendo su progreso de lectura. Esta acción no se
              puede deshacer.
            </p>
            <div className="actions">
              <button className="btn" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button className="btn danger" onClick={doDelete}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lector a pantalla completa */}
      {reading && (
        <Reader
          book={reading.book}
          startPage={reading.startPage}
          settings={settings}
          onChangeSettings={changeSettings}
          onSaveProgress={onSaveProgress}
          onClose={() => {
            setReading(null)
            refresh()
          }}
        />
      )}
    </div>
  )
}
