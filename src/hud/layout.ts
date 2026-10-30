import { ImageContainerProperty, TextContainerProperty } from '@evenrealities/even_hub_sdk'

// Canvas is 576x288. Text brightness is 0-4 (SDK limit).
// Measured in the simulator: ~27px per line, '─' ~20px, ' ' ~5px.
export const LINE_HEIGHT = 27
export const BODY_WIDTH = 544 // inner width of the full-width body
export const BODY_LINES = 7

// Corner glyphs. Single-line because stacked '│' leaves gaps between lines.
export const GLYPHS = {
  tl: '╭──',
  tr: '──╮',
  bl: '╰──',
  br: '──╯',
}

export const ID = {
  tl: 1,
  tr: 2,
  bl: 3,
  br: 4,
  header: 5,
  body: 6,
  footer: 7,
  reactor: 8,
  mapTop: 9,
  mapBottom: 10,
} as const

/** chrome = frame and status text (dimmed by night protocol, hidden by stealth); body = content. */
export type Role = 'chrome' | 'body'
export type TextSpec = { kind: 'text'; id: number; name: string; x: number; y: number; w: number; h: number; role: Role; capture?: boolean; padding?: number }
export type ImageSpec = { kind: 'image'; id: number; name: string; x: number; y: number; w: number; h: number }
export type Spec = TextSpec | ImageSpec
export type LayoutName = 'hud' | 'boot' | 'map'

// Corners need slack beyond the ~51px glyph run, or the text wraps and the
// firmware draws a scroll indicator. Text is left-aligned (leading spaces
// also wrap), so the right-hand boxes are narrower to sit near the edge.
const CORNER_W = 72
const CORNER_W_RIGHT = 64
const ROW_H = 32
const BOTTOM_Y = 288 - ROW_H

const text = (id: number, name: string, x: number, y: number, w: number, h: number, role: Role, extra: Partial<TextSpec> = {}): TextSpec => ({
  kind: 'text', id, name, x, y, w, h, role, ...extra,
})

const corners = [
  text(ID.tl, 'tl', 0, 0, CORNER_W, ROW_H, 'chrome'),
  text(ID.tr, 'tr', 576 - CORNER_W_RIGHT, 0, CORNER_W_RIGHT, ROW_H, 'chrome'),
  text(ID.bl, 'bl', 0, BOTTOM_Y, CORNER_W, ROW_H, 'chrome'),
  text(ID.br, 'br', 576 - CORNER_W_RIGHT, BOTTOM_Y, CORNER_W_RIGHT, ROW_H, 'chrome'),
]

const hud: Spec[] = [
  ...corners,
  text(ID.header, 'header', CORNER_W + 8, 0, 576 - 2 * (CORNER_W + 8), ROW_H, 'chrome'),
  text(ID.body, 'body', 12, ROW_H + 4, 552, BOTTOM_Y - ROW_H - 8, 'body', { capture: true, padding: 4 }),
  text(ID.footer, 'footer', CORNER_W + 8, BOTTOM_Y, 576 - 2 * (CORNER_W + 8), ROW_H, 'chrome'),
]

// Map size: two stacked 288x144 images (the per-image maximum) make a 288x288 square.
export const MAP_SIZE = 288
export const REACTOR_SIZE = 144
export const REACTOR_POS = { x: 216, y: 38 }
const SIDE_X = MAP_SIZE + 10
export const SIDE_WIDTH = 576 - SIDE_X - 8

export const LAYOUTS: Record<LayoutName, Spec[]> = {
  hud,
  // Boot adds the arc reactor canvas. It's dropped afterwards: even an
  // all-black image hides the text behind it.
  boot: [...hud, { kind: 'image', id: ID.reactor, name: 'reactor', x: REACTOR_POS.x, y: REACTOR_POS.y, w: REACTOR_SIZE, h: REACTOR_SIZE }],
  // Map and radar: square image on the left, info panel on the right.
  map: [
    { kind: 'image', id: ID.mapTop, name: 'mapTop', x: 0, y: 0, w: MAP_SIZE, h: 144 },
    { kind: 'image', id: ID.mapBottom, name: 'mapBottom', x: 0, y: 144, w: MAP_SIZE, h: 144 },
    corners[1],
    corners[3],
    text(ID.header, 'header', SIDE_X, 0, 576 - SIDE_X - CORNER_W_RIGHT, ROW_H, 'chrome'),
    text(ID.body, 'body', SIDE_X, ROW_H + 4, SIDE_WIDTH, BOTTOM_Y - ROW_H - 8, 'body', { capture: true, padding: 2 }),
    text(ID.footer, 'footer', SIDE_X, BOTTOM_Y, 576 - SIDE_X - CORNER_W_RIGHT, ROW_H, 'chrome'),
  ],
}

export const specOf = (layout: LayoutName, id: number) => LAYOUTS[layout].find((s) => s.id === id)

/** Builds the SDK page description for a layout. `content`/`color` give each text container's initial state. */
export function buildPage(layout: LayoutName, content: (id: number) => string, color: (spec: TextSpec) => number) {
  const specs = LAYOUTS[layout]
  return {
    containerTotalNum: specs.length,
    textObject: specs
      .filter((s): s is TextSpec => s.kind === 'text')
      .map(
        (s) =>
          new TextContainerProperty({
            containerID: s.id,
            containerName: s.name,
            xPosition: s.x,
            yPosition: s.y,
            width: s.w,
            height: s.h,
            content: content(s.id) || ' ',
            textColor: color(s),
            borderWidth: 0,
            paddingLength: s.padding ?? 0,
            isEventCapture: s.capture ? 1 : 0,
          }),
      ),
    imageObject: specs
      .filter((s): s is ImageSpec => s.kind === 'image')
      .map(
        (s) =>
          new ImageContainerProperty({
            containerID: s.id,
            containerName: s.name,
            xPosition: s.x,
            yPosition: s.y,
            width: s.w,
            height: s.h,
          }),
      ),
  }
}
