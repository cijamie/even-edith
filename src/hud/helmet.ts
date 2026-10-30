import { MAP_SIZE } from './layout'

// An armoured helmet for the "I am Iron Man" easter egg, drawn on the 288x288
// map canvas. The glasses show 4-bit greyscale and black is transparent, so
// the shell is mid grey with bright edges and the eyes are pure white.

export const HELMET_FRAMES = 6

const W = MAP_SIZE
const mx = (x: number) => W - x
const grey = (level: number) => {
  const v = Math.round((level / 15) * 255)
  return `rgb(${v},${v},${v})`
}

type Pt = [number, number]

/** A closed shape from its left half, mirrored onto the right. */
function symmetric(g: CanvasRenderingContext2D, left: Pt[], dy = 0) {
  const pts = [...left, ...[...left].reverse().map(([x, y]) => [mx(x), y] as Pt)]
  g.beginPath()
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)))
  g.closePath()
}

// Outer shell, left half from the crown down to the chin.
// Wide at the temples, with an angular jaw.
const SHELL: Pt[] = [
  [144, 28],
  [108, 32],
  [80, 48],
  [66, 76],
  [62, 112],
  [62, 150],
  [70, 186],
  [86, 220],
  [116, 250],
  [144, 258],
]

// The faceplate: flat brow, pinched temples, cheek flare, tapered chin.
const FACE: Pt[] = [
  [144, 60],
  [110, 64],
  [90, 78],
  [88, 108],
  [92, 128],
  [84, 156],
  [90, 192],
  [108, 224],
  [128, 242],
  [144, 246],
]

// Narrow slits, slanting down towards the nose.
const EYE: Pt[] = [
  [98, 124],
  [136, 134],
  [134, 142],
  [102, 138],
]

/**
 * Frame n of the suit-up:
 * 0 wireframe shell, 1 shell plated, 2-3 faceplate sliding down,
 * 4 faceplate sealed, 5 eyes lit.
 */
export function helmetFrame(n: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = W
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, W, W)
  g.lineJoin = 'round'

  // Shell: wireframe first, then plated.
  symmetric(g, SHELL)
  if (n >= 1) {
    g.fillStyle = grey(5)
    g.fill()
  }
  g.lineWidth = 3
  g.strokeStyle = grey(n === 0 ? 9 : 13)
  g.stroke()
  if (n === 0) {
    // Scan lines across the empty shell.
    g.strokeStyle = grey(4)
    g.lineWidth = 1
    for (let y = 50; y < 260; y += 14) {
      g.beginPath()
      g.moveTo(70, y)
      g.lineTo(218, y)
      g.stroke()
    }
    return canvas
  }

  // Ear plates on the shell.
  for (const x of [80, mx(80)]) {
    g.beginPath()
    g.arc(x, 140, 12, 0, Math.PI * 2)
    g.strokeStyle = grey(10)
    g.lineWidth = 2
    g.stroke()
  }

  // Faceplate drops into place from above.
  const dy = [0, -170, -100, -40, 0, 0][n]
  symmetric(g, FACE, dy)
  g.fillStyle = grey(9)
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = grey(15)
  g.stroke()

  // Faceplate details: frowning brow, cheek seams, mouth slit, chin.
  g.strokeStyle = grey(4)
  g.lineWidth = 3
  const line = (...pts: Pt[]) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)))
    g.stroke()
  }
  line([96, 110], [144, 122], [mx(96), 110])
  line([100, 150], [112, 196], [124, 212])
  line([mx(100), 150], [mx(112), 196], [mx(124), 212])
  line([122, 220], [mx(122), 220])
  line([144, 230], [144, 244])

  // Eye slits: dark until the suit powers up.
  for (const side of [EYE, EYE.map(([x, y]) => [mx(x), y] as Pt)]) {
    g.beginPath()
    side.forEach(([x, y], i) => (i ? g.lineTo(x, y + dy) : g.moveTo(x, y + dy)))
    g.closePath()
    if (n === 5) {
      g.shadowColor = '#fff'
      g.shadowBlur = 18
      g.fillStyle = '#fff'
    } else {
      g.shadowBlur = 0
      g.fillStyle = '#000'
    }
    g.fill()
  }
  g.shadowBlur = 0
  return canvas
}
