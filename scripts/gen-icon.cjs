// 生成 LiteEdit 应用图标:蓝色圆角底 + 白色页面 + 折角 + 文字行
// 2x 超采样抗锯齿,输出 1024x1024 PNG
const zlib = require('zlib')
const fs = require('fs')

const SIZE = 1024
const SS = 2 // 超采样倍数
const W = SIZE * SS

// ── PNG 编码 ────────────────────────────────────────────
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
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 形状判定(坐标以 SS 分辨率计)─────────────────────────
function inRoundedRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false
  const cx = Math.max(x0 + r, Math.min(px, x1 - r))
  const cy = Math.max(y0 + r, Math.min(py, y1 - r))
  const dx = px - cx, dy = py - cy
  return dx * dx + dy * dy <= r * r
}

const bgA = [0x1f, 0x6f, 0xeb], bgB = [0x09, 0x69, 0xda] // 顶部→底部微渐变
const pageC = [255, 255, 255]
const foldC = [0xcf, 0xdd, 0xf0]
const lineC = [0x3b, 0x82, 0xf6]

const s = (v) => v * SS // 设计坐标(1024)→ SS 坐标
const inPage = (x, y) => inRoundedRect(x, y, s(300), s(210), s(724), s(830), s(26))
const inFold = (x, y) => x >= s(644) && x <= s(724) && y >= s(210) && y <= s(290) && (x - s(644)) + (y - s(210)) >= s(80)
const inLine = (x, y, i) => {
  const ys = [s(360), s(470), s(580)]
  const ws = [s(300), s(250), s(200)]
  return inRoundedRect(x, y, s(380), ys[i], s(380) + ws[i], ys[i] + s(36), s(18))
}

// ── 逐像素渲染 + 2x 下采样 ──────────────────────────────
const out = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const px = x * SS + sx, py = y * SS + sy
        let cr = 0, cg = 0, cb = 0, ca = 0
        // 背景(圆角矩形,带纵向渐变)
        if (inRoundedRect(px, py, 0, 0, W - 1, W - 1, s(160))) {
          const t = Math.min(1, py / W)
          cr = bgA[0] + (bgB[0] - bgA[0]) * t
          cg = bgA[1] + (bgB[1] - bgA[1]) * t
          cb = bgA[2] + (bgB[2] - bgA[2]) * t
          ca = 255
          // 页面(右上角折角)
          if (inPage(px, py)) {
            if (inFold(px, py)) {
              cr = foldC[0]; cg = foldC[1]; cb = foldC[2]
            } else {
              cr = pageC[0]; cg = pageC[1]; cb = pageC[2]
              for (let i = 0; i < 3; i++) if (inLine(px, py, i)) { cr = lineC[0]; cg = lineC[1]; cb = lineC[2] }
            }
          }
        }
        const alpha = ca / 255
        r += cr * alpha; g += cg * alpha; b += cb * alpha; a += alpha
        n++
      }
    }
    const o = (y * SIZE + x) * 4
    out[o] = Math.round(r / n)
    out[o + 1] = Math.round(g / n)
    out[o + 2] = Math.round(b / n)
    out[o + 3] = Math.round((a / n) * 255)
  }
}

fs.writeFileSync('app-icon.png', encodePNG(SIZE, SIZE, out))
console.log('app-icon.png generated (' + SIZE + 'x' + SIZE + ')')
