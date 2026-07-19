import { useCallback, useEffect, useRef, useState } from 'react'
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
    async (fileList) => {
      const files = Array.from(fileList)
      if (files.length === 0) return

      // Si todo son imágenes sueltas, se tratan como un solo manga.
      const allImages = files.every((f) => detectFormat(f) === 'image')
      try {
        if (allImages) {
          const guessTitle =
            files[0].webkitRelativePath?.split('/')[0] ||
            (files.length > 1 ? 'Manga importado' : files[0].name.replace(/\.[^.]+$/, ''))
          setImporting({ label: `Importando ${files.length} imágenes…`, progress: 0 })
          const result = await importImages(files, guessTitle, (p) =>
            setImporting({ label: `Importando imágenes…`, progress: p }),
          )
          await addBook(result)
        } else {
          // Cada CBZ/ZIP/PDF es un manga independiente.
          for (const file of files) {
            setImporting({ label: `Importando ${file.name}…`, progress: 0 })
            const result = await importFile(file, (p) =>
              setImporting({ label: `Importando ${file.name}…`, progress: p }),
            )
            await addBook(result)
          }
        }
        await refresh()
      } catch (err) {
        alert(`Error al importar: ${err.message}`)
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
        <button className="btn" onClick={() => folderInputRef.current?.click()}>
          📁 Carpeta
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
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept=".cbz,.zip,.pdf,image/*"
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={folderInputRef}
        className="visually-hidden"
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        onChange={(e) => {
          handleFiles(e.target.files)
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
