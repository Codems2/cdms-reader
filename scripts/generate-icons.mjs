// Genera los iconos PWA (PNG) sin dependencias externas: dibuja en un buffer
// RGBA y lo codifica como PNG usando el zlib nativo de Node.
// Ejecuta:  npm run icons
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(__dirname, '../public/icons')
mkdirSync(OUT, { recursive: true })

// --- Codificador PNG mínimo -----------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // Añade byte de filtro (0) al inicio de cada scanline.
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --- Dibujo ---------------------------------------------------------------
function makeIcon(size, { padding = 0.16 } = {}) {
  const buf = Buffer.alloc(size * size * 4)
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    buf[i] = r
    buf[i + 1] = g
    buf[i + 2] = b
    buf[i + 3] = a
  }

  // Fondo con degradado vertical (azul acento -> azul oscuro).
  const top = [0x6c, 0x8c, 0xff]
  const bot = [0x2f, 0x3f, 0xb0]
  for (let y = 0; y < size; y++) {
    const t = y / size
    const col = [
      Math.round(top[0] + (bot[0] - top[0]) * t),
      Math.round(top[1] + (bot[1] - top[1]) * t),
      Math.round(top[2] + (bot[2] - top[2]) * t),
    ]
    for (let x = 0; x < size; x++) set(x, y, col)
  }

  // Página blanca centrada (documento / manga).
  const pad = Math.round(size * padding)
  const px0 = pad + Math.round(size * 0.06)
  const px1 = size - pad - Math.round(size * 0.06)
  const py0 = pad
  const py1 = size - pad
  const white = [245, 247, 252]
  for (let y = py0; y < py1; y++) {
    for (let x = px0; x < px1; x++) set(x, y, white)
  }

  // Lomo central (pliegue del libro).
  const cx = Math.round((px0 + px1) / 2)
  const spineW = Math.max(2, Math.round(size * 0.012))
  const spine = [0x6c, 0x8c, 0xff]
  for (let y = py0; y < py1; y++) {
    for (let x = cx - spineW; x <= cx + spineW; x++) set(x, y, spine)
  }

  // Líneas de "texto" a ambos lados.
  const lineCol = [0x9a, 0xa8, 0xd0]
  const lineH = Math.max(2, Math.round(size * 0.02))
  const gap = Math.round(size * 0.055)
  const marginX = Math.round(size * 0.05)
  for (let n = 1; n <= 4; n++) {
    const y = py0 + gap * n + Math.round(size * 0.04)
    for (let yy = y; yy < y + lineH; yy++) {
      for (let x = px0 + marginX; x < cx - spineW - marginX; x++) set(x, yy, lineCol)
      for (let x = cx + spineW + marginX; x < px1 - marginX; x++) set(x, yy, lineCol)
    }
  }

  return encodePNG(size, size, buf)
}

writeFileSync(resolve(OUT, 'icon-192.png'), makeIcon(192))
writeFileSync(resolve(OUT, 'icon-512.png'), makeIcon(512))
// Maskable: más margen para respetar la zona segura de recorte.
writeFileSync(resolve(OUT, 'icon-512-maskable.png'), makeIcon(512, { padding: 0.26 }))

console.log('Iconos generados en public/icons/')
