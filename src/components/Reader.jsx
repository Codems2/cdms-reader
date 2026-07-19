import { useCallback, useEffect, useRef, useState } from 'react'
import { getPage } from '../db/storage.js'

// Cache simple de URLs de objeto por índice de página, con prefetch de vecinos.
function usePageCache(bookId) {
  const cache = useRef(new Map()) // index -> objectURL
  const loading = useRef(new Map()) // index -> Promise

  const load = useCallback(
    async (index) => {
      if (index < 0) return null
      if (cache.current.has(index)) return cache.current.get(index)
      if (loading.current.has(index)) return loading.current.get(index)
      const p = (async () => {
        const row = await getPage(bookId, index)
        if (!row?.blob) return null
        const url = URL.createObjectURL(row.blob)
        cache.current.set(index, url)
        loading.current.delete(index)
        return url
      })()
      loading.current.set(index, p)
      return p
    },
    [bookId],
  )

  useEffect(() => {
    const c = cache.current
    return () => {
      for (const url of c.values()) URL.revokeObjectURL(url)
      c.clear()
    }
  }, [bookId])

  return load
}

// --- Lector paginado (una página a la vez) --------------------------------
function PagedReader({ book, page, setPage, rtl, fit, load, onToggleBars }) {
  const [url, setUrl] = useState(null)
  const [loadingPage, setLoadingPage] = useState(true)

  useEffect(() => {
    let alive = true
    setLoadingPage(true)
    load(page).then((u) => {
      if (!alive) return
      setUrl(u)
      setLoadingPage(false)
    })
    // Prefetch de vecinos.
    load(page + 1)
    load(page + 2)
    load(page - 1)
    return () => {
      alive = false
    }
  }, [page, load])

  const prev = useCallback(() => setPage((p) => Math.max(0, p - 1)), [setPage])
  const next = useCallback(
    () => setPage((p) => Math.min(book.pageCount - 1, p + 1)),
    [setPage, book.pageCount],
  )

  // En RTL, la zona/lado izquierdo avanza y el derecho retrocede.
  const onLeft = rtl ? next : prev
  const onRight = rtl ? prev : next

  // Gestos: un mismo puntero sirve para tocar (tercios) y para deslizar (swipe).
  const start = useRef(null)
  const onPointerDown = (e) => {
    start.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e) => {
    const s = start.current
    start.current = null
    if (!s) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    const ax = Math.abs(dx)
    const ay = Math.abs(dy)

    // Deslizar horizontal → pasar página (coherente con los tercios: izq = onLeft).
    if (ax > 40 && ax > ay) {
      if (dx < 0) onLeft()
      else onRight()
      return
    }
    // Toque (sin apenas movimiento): por tercios de la pantalla.
    if (ax < 12 && ay < 12) {
      const r = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - r.left
      if (x < r.width / 3) onLeft()
      else if (x > (r.width * 2) / 3) onRight()
      else onToggleBars()
    }
  }

  return (
    <div
      className={`viewport ${fit === 'width' ? 'fit-width' : ''}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (start.current = null)}
    >
      {loadingPage && <div className="loading-page">Cargando…</div>}
      {url && <img className="page-img" src={url} alt={`Página ${page + 1}`} draggable={false} />}
    </div>
  )
}

// --- Lector vertical (webtoon, scroll continuo) ---------------------------
function VerticalPage({ index, bookId, load, onVisible }) {
  const ref = useRef(null)
  const [url, setUrl] = useState(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            if (!url) load(index).then(setUrl)
            onVisible(index)
          }
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [index, load, url, onVisible])

  return (
    <div ref={ref} style={{ minHeight: url ? undefined : '60vh' }}>
      {url ? (
        <img className="page-img" src={url} alt={`Página ${index + 1}`} loading="lazy" />
      ) : (
        <div className="loading-page" style={{ padding: 40, textAlign: 'center' }}>
          Página {index + 1}
        </div>
      )}
    </div>
  )
}

function VerticalReader({ book, page, setPage, load, onToggleBars, scrollRef }) {
  const items = Array.from({ length: book.pageCount }, (_, i) => i)
  const lastReported = useRef(page)

  const onVisible = useCallback(
    (index) => {
      if (index !== lastReported.current) {
        lastReported.current = index
        setPage(index)
      }
    },
    [setPage],
  )

  // Salta a la página inicial una sola vez.
  const jumped = useRef(false)
  useEffect(() => {
    if (jumped.current) return
    jumped.current = true
    if (page > 0 && scrollRef.current) {
      const target = scrollRef.current.children[page]
      target?.scrollIntoView({ block: 'start' })
    }
  }, [page, scrollRef])

  return (
    <div className="vertical-scroll" ref={scrollRef} onClick={onToggleBars}>
      {items.map((i) => (
        <VerticalPage key={i} index={i} bookId={book.id} load={load} onVisible={onVisible} />
      ))}
    </div>
  )
}

// --- Contenedor del lector ------------------------------------------------
export default function Reader({ book, startPage, settings, onChangeSettings, onSaveProgress, onClose }) {
  const [page, setPage] = useState(startPage ?? 0)
  const [barsVisible, setBarsVisible] = useState(true)
  const load = usePageCache(book.id)
  const scrollRef = useRef(null)

  const mode = settings.mode // 'paged-ltr' | 'paged-rtl' | 'vertical'
  const fit = settings.fit // 'contain' | 'width'
  const rtl = mode === 'paged-rtl'
  const vertical = mode === 'vertical'

  // Guarda el progreso (con debounce) cada vez que cambia la página.
  useEffect(() => {
    const t = setTimeout(() => onSaveProgress(page), 400)
    return () => clearTimeout(t)
  }, [page, onSaveProgress])

  // Navegación por teclado.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') return onClose()
      if (vertical) return
      const forward = () => setPage((p) => Math.min(book.pageCount - 1, p + 1))
      const back = () => setPage((p) => Math.max(0, p - 1))
      if (e.key === 'ArrowRight') rtl ? back() : forward()
      else if (e.key === 'ArrowLeft') rtl ? forward() : back()
      else if (e.key === ' ') {
        e.preventDefault()
        forward()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [book.pageCount, rtl, vertical, onClose])

  const toggleBars = useCallback(() => setBarsVisible((v) => !v), [])

  const barCls = (pos) => `reader-bar ${pos} ${barsVisible ? '' : 'hidden'}`

  return (
    <div className="reader">
      {/* Barra superior */}
      <div className={barCls('top')}>
        <button className="btn icon" onClick={onClose} title="Volver a la biblioteca">
          ←
        </button>
        <div className="title">{book.title}</div>
        <div className="grow" />
        <select
          value={mode}
          onChange={(e) => onChangeSettings({ mode: e.target.value })}
          title="Modo de lectura"
        >
          <option value="paged-rtl">↔ Página (manga, der→izq)</option>
          <option value="paged-ltr">↔ Página (izq→der)</option>
          <option value="vertical">↕ Vertical (webtoon)</option>
        </select>
        {!vertical && (
          <select
            value={fit}
            onChange={(e) => onChangeSettings({ fit: e.target.value })}
            title="Ajuste"
          >
            <option value="contain">Ajustar</option>
            <option value="width">Ancho</option>
          </select>
        )}
      </div>

      {/* Contenido */}
      {vertical ? (
        <VerticalReader
          book={book}
          page={page}
          setPage={setPage}
          load={load}
          onToggleBars={toggleBars}
          scrollRef={scrollRef}
        />
      ) : (
        <PagedReader
          book={book}
          page={page}
          setPage={setPage}
          rtl={rtl}
          fit={fit}
          load={load}
          onToggleBars={toggleBars}
        />
      )}

      {/* Barra inferior */}
      <div className={barCls('bottom')}>
        <span className="page-indicator">
          {page + 1} / {book.pageCount}
        </span>
        <input
          className="slider"
          type="range"
          min={0}
          max={book.pageCount - 1}
          value={page}
          // En RTL invertimos visualmente el sentido del slider.
          style={{ direction: rtl ? 'rtl' : 'ltr' }}
          onChange={(e) => {
            const p = Number(e.target.value)
            setPage(p)
            if (vertical) {
              scrollRef.current?.children[p]?.scrollIntoView({ block: 'start' })
            }
          }}
        />
      </div>
    </div>
  )
}
