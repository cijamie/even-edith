import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { REACTOR_SIZE } from './reactor'

// Canvas is 576x288. Text brightness is 0-4 (SDK limit), so "dim chrome"
// uses CHROME and content uses BRIGHT.
export const CHROME = 2
export const BRIGHT = 4

// Measured in the simulator: ~27px per line, '─' ~20px, ' ' ~5px.
export const LINE_HEIGHT = 27
export const BODY_WIDTH = 544 // inner width after padding
export const BODY_LINES = 7

// Corner glyphs. Single-line because stacked '│' leaves gaps between lines.
// Swap here if hardware renders them differently.
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
} as const

export const REACTOR = { name: 'reactor', x: 216, y: 38 }

export const NAMES: Record<number, string> = {
  [ID.tl]: 'tl',
  [ID.tr]: 'tr',
  [ID.bl]: 'bl',
  [ID.br]: 'br',
  [ID.header]: 'header',
  [ID.body]: 'body',
  [ID.footer]: 'footer',
}

// Corners need slack beyond the ~51px glyph run, or the text wraps and the
// firmware draws a scroll indicator. Text is left-aligned (leading spaces
// also wrap), so the right-hand boxes are narrower to sit near the edge.
const CORNER_W = 72
const CORNER_W_RIGHT = 64
const ROW_H = 32
const BOTTOM_Y = 288 - ROW_H

function text(
  id: number,
  x: number,
  y: number,
  width: number,
  height: number,
  textColor: number,
  extra: Partial<TextContainerProperty> = {},
) {
  return new TextContainerProperty({
    containerID: id,
    containerName: NAMES[id],
    xPosition: x,
    yPosition: y,
    width,
    height,
    textColor,
    content: ' ',
    borderWidth: 0,
    paddingLength: 0,
    isEventCapture: 0,
    ...extra,
  })
}

/** Initial text per container, for rebuilding the page without losing what's on screen. */
export type HudContent = Partial<Record<number, string>>

function hudPage(withReactor: boolean, content: HudContent = {}) {
  const c = (id: number) => ({ content: content[id] || ' ' })
  return {
    containerTotalNum: withReactor ? 8 : 7,
    // Boot-animation canvas, centred over the body. Only present during boot:
    // even an all-black image hides the text behind it.
    imageObject: withReactor
      ? [
          new ImageContainerProperty({
            containerID: ID.reactor,
            containerName: REACTOR.name,
            xPosition: REACTOR.x,
            yPosition: REACTOR.y,
            width: REACTOR_SIZE,
            height: REACTOR_SIZE,
          }),
        ]
      : [],
    textObject: [
      text(ID.tl, 0, 0, CORNER_W, ROW_H, CHROME, c(ID.tl)),
      text(ID.tr, 576 - CORNER_W_RIGHT, 0, CORNER_W_RIGHT, ROW_H, CHROME, c(ID.tr)),
      text(ID.bl, 0, BOTTOM_Y, CORNER_W, ROW_H, CHROME, c(ID.bl)),
      text(ID.br, 576 - CORNER_W_RIGHT, BOTTOM_Y, CORNER_W_RIGHT, ROW_H, CHROME, c(ID.br)),
      text(ID.header, CORNER_W + 8, 0, 576 - 2 * (CORNER_W + 8), ROW_H, CHROME, c(ID.header)),
      text(ID.body, 12, ROW_H + 4, 552, BOTTOM_Y - ROW_H - 8, BRIGHT, {
        paddingLength: 4,
        isEventCapture: 1,
        ...c(ID.body),
      }),
      text(ID.footer, CORNER_W + 8, BOTTOM_Y, 576 - 2 * (CORNER_W + 8), ROW_H, CHROME, c(ID.footer)),
    ],
  }
}

/** Drops the reactor image once boot is done, keeping the given text on screen. */
export async function removeReactor(bridge: EvenAppBridge, content: HudContent) {
  return bridge.rebuildPageContainer(new RebuildPageContainer(hudPage(false, content)))
}

/** Creates the HUD page (with the boot reactor) and every container blank; the boot sequence fills it. */
export async function createHud(bridge: EvenAppBridge) {
  const page = hudPage(true)
  const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
  if (result === 0) return
  // The startup page can only be created once per launch. After a WebView
  // reload (or a dev hot-reload) it already exists, so rebuild it instead.
  if (!(await bridge.rebuildPageContainer(new RebuildPageContainer(page)))) {
    throw new Error(`createStartUpPageContainer failed: ${result}, rebuild failed too`)
  }
}
