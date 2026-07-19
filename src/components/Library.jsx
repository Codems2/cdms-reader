import { useEffect, useMemo, useState } from 'react'

function BookCover({ book }) {
  const url = useMemo(() => (book.cover ? URL.createObjectURL(book.cover) : null), [book.cover])
  useEffect(() => () => url && URL.revokeObjectURL(url), [url])

  if (!url) {
    return <div className="cover placeholder">📖</div>
  }
  return <img className="cover" src={url} alt={book.title} loading="lazy" />
}

function formatSize(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return `${mb.toFixed(1)} MB`
}

export default function Library({ books, progressMap, onOpen, onDelete }) {
  if (books.length === 0) {
    return (
      <div className="empty">
        <div className="big">📚</div>
        <h2>Tu biblioteca está vacía</h2>
        <p>
          Importa tus mangas desde archivos <b>CBZ</b>, <b>ZIP</b>, <b>PDF</b> o una carpeta de
          imágenes. Todo se guarda en tu dispositivo y se lee sin conexión.
        </p>
      </div>
    )
  }

  return (
    <div className="grid">
      {books.map((book) => {
        const prog = progressMap[book.id]
        const pct = prog ? Math.round(((prog.page + 1) / book.pageCount) * 100) : 0
        return (
          <div className="card" key={book.id}>
            <button
              className="del"
              title="Eliminar"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(book)
              }}
            >
              🗑️
            </button>
            <div onClick={() => onOpen(book)} style={{ cursor: 'pointer' }}>
              <BookCover book={book} />
              <div className="meta">
                <div className="title">{book.title}</div>
                <div className="sub">
                  {book.pageCount} pág · {book.format.toUpperCase()}
                  {book.size ? ` · ${formatSize(book.size)}` : ''}
                </div>
              </div>
              {pct > 0 && <div className="progress-bar" style={{ width: `${pct}%` }} />}
            </div>
          </div>
        )
      })}
    </div>
  )
}
