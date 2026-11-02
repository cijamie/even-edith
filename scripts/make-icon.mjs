// Generates public/icon.png: the 24x24 Even Hub icon. Even Hub reads it in 2x2
// blocks and allows one colour (opaque #F4F4F4) on transparent, so it's drawn
// on a 12x12 grid: the logo's glasses, with the arc reactor core in the left
// lens and HUD lines in the right (see assets/logo-mark.svg).
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

// # frame, @ reactor core, - HUD line, . transparent
const GRID = [
  '............',
  '............',
  '#..........#',
  '.####..####.',
  '#....##....#',
  '#.@@.##.--.#',
  '#.@@.##....#',
  '#....##.-..#',
  '.####..####.',
  '............',
  '............',
  '............',
]
const ON = [0xf4, 0xf4, 0xf4, 0xff]
const OFF = [0, 0, 0, 0]

const size = 24
const rows = []
for (let y = 0; y < size; y++) {
  const row = [0] // PNG filter byte: none
  for (let x = 0; x < size; x++) row.push(...(GRID[y >> 1][x >> 1] === '.' ? OFF : ON))
  rows.push(Buffer.from(row))
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0)
ihdr.writeUInt32BE(size, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
])

mkdirSync('public', { recursive: true })
writeFileSync('public/icon.png', png)
console.log('wrote public/icon.png')
