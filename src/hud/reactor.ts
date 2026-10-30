// Arc reactor frames for the boot animation, drawn on a canvas and sent to an
// image container. The glasses convert to 4-bit greyscale; black is transparent.

export const REACTOR_SIZE = 144 // image containers max out at 288x144
export const REACTOR_FRAMES = 6

const TAU = Math.PI * 2

/** Draws frame `n` (0..REACTOR_FRAMES-1) of the spin-up and returns PNG bytes. */
export async function reactorFrame(n: number): Promise<Uint8Array> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = REACTOR_SIZE
  const g = canvas.getContext('2d')!
  const c = REACTOR_SIZE / 2
  g.fillStyle = '#000'
  g.fillRect(0, 0, REACTOR_SIZE, REACTOR_SIZE)
  g.translate(c, c)

  const grey = (level: number) => {
    const v = Math.round((level / 15) * 255)
    return `rgb(${v},${v},${v})`
  }
  const ring = (r: number, width: number, level: number) => {
    g.beginPath()
    g.arc(0, 0, r, 0, TAU)
    g.lineWidth = width
    g.strokeStyle = grey(level)
    g.stroke()
  }

  // 0: core ignites
  const coreLevel = [6, 10, 12, 13, 14, 15][n]
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, 22 + n * 3)
  glow.addColorStop(0, grey(coreLevel))
  glow.addColorStop(0.45, grey(coreLevel * 0.6))
  glow.addColorStop(1, grey(0))
  g.fillStyle = glow
  g.beginPath()
  g.arc(0, 0, 22 + n * 3, 0, TAU)
  g.fill()

  // 1: inner housing ring
  if (n >= 1) ring(26, 3, 12)

  // 2-3: copper coil segments wind on, rotating as they spin up
  if (n >= 2) {
    const coils = 10
    const shown = n === 2 ? 5 : coils
    const spin = n * 0.22
    g.fillStyle = grey(n >= 4 ? 11 : 8)
    for (let i = 0; i < shown; i++) {
      const a = spin + (i / coils) * TAU
      g.save()
      g.rotate(a)
      // A trapezoid between the inner and outer rings.
      g.beginPath()
      g.moveTo(-5, -32)
      g.lineTo(5, -32)
      g.lineTo(8, -54)
      g.lineTo(-8, -54)
      g.closePath()
      g.fill()
      g.restore()
    }
  }

  // 3: outer casing
  if (n >= 3) {
    ring(60, 4, 13)
    // Bolt ticks on the casing.
    g.strokeStyle = grey(9)
    g.lineWidth = 2
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU
      g.beginPath()
      g.moveTo(Math.cos(a) * 64, Math.sin(a) * 64)
      g.lineTo(Math.cos(a) * 69, Math.sin(a) * 69)
      g.stroke()
    }
  }

  // 4-5: Mk VI triangle, then full brightness
  if (n >= 4) {
    g.beginPath()
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i / 3) * TAU
      const p = [Math.cos(a) * 21, Math.sin(a) * 21] as const
      if (i === 0) g.moveTo(...p)
      else g.lineTo(...p)
    }
    g.closePath()
    g.lineWidth = n === 5 ? 3 : 2
    g.strokeStyle = grey(15)
    g.stroke()
  }
  if (n === 5) ring(40, 1, 6)

  return pngBytes(canvas)
}

function pngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(async (blob) => {
      if (!blob) return reject(new Error('canvas.toBlob failed'))
      resolve(new Uint8Array(await blob.arrayBuffer()))
    }, 'image/png'),
  )
}
