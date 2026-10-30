import {
  CreateStartUpPageContainer,
  ImageRawDataUpdate,
  RebuildPageContainer,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { buildPage, LAYOUTS, specOf, type LayoutName, type TextSpec } from './layout'

export type Theme = { night: boolean; stealth: boolean }

type TextOp = { kind: 'text'; id: number; waiters: (() => void)[] }
type ImageOp = { kind: 'image'; id: number; png: Uint8Array; done: (ok: boolean) => void }
type PageOp = { kind: 'page'; layout: LayoutName; create: boolean; done: (ok: boolean) => void }
type Op = TextOp | ImageOp | PageOp

export type Snapshot = {
  layout: LayoutName
  theme: Theme
  text: Map<number, string>
  images: Map<number, Uint8Array>
  color: (spec: TextSpec) => number
  visible: (spec: TextSpec, content: string) => string
}

/**
 * Everything drawn on the glasses goes through here.
 *
 * - Keeps a model of what's on screen (for the phone mirror and page rebuilds).
 * - Sends one Bluetooth operation at a time. A text update that's still queued
 *   is replaced by newer content, so fast animations don't flood the link.
 * - Applies protocols: night dims everything, stealth blanks the chrome.
 */
export class Display {
  layout: LayoutName = 'boot'
  theme: Theme = { night: false, stealth: false }
  private text = new Map<number, string>()
  private images = new Map<number, Uint8Array>()
  private ops: Op[] = []
  private running = false
  private listeners: ((s: Snapshot) => void)[] = []

  constructor(private bridge: EvenAppBridge) {}

  onChange(fn: (s: Snapshot) => void) {
    this.listeners.push(fn)
    fn(this.snapshot())
  }

  snapshot(): Snapshot {
    return {
      layout: this.layout,
      theme: { ...this.theme },
      text: new Map(this.text),
      images: new Map(this.images),
      color: (s) => this.color(s),
      visible: (s, c) => this.visible(s, c),
    }
  }

  get(id: number) {
    return this.text.get(id) ?? ''
  }

  /** Queue new text; resolves once this (or newer) content has been sent. */
  set(id: number, content: string): Promise<void> {
    this.text.set(id, content)
    this.changed()
    if (!specOf(this.layout, id)) return Promise.resolve()
    return new Promise((resolve) => {
      const queued = this.ops.find((o): o is TextOp => o.kind === 'text' && o.id === id)
      if (queued) queued.waiters.push(resolve)
      else this.ops.push({ kind: 'text', id, waiters: [resolve] })
      void this.pump()
    })
  }

  /** Sends PNG bytes to an image container. Resolves false if the glasses rejected it. */
  image(id: number, png: Uint8Array): Promise<boolean> {
    this.images.set(id, png)
    this.changed()
    return new Promise((done) => {
      this.ops.push({ kind: 'image', id, png, done })
      void this.pump()
    })
  }

  /**
   * Switches layout by rebuilding the page. `content` sets text that should be
   * there straight away; anything else starts blank. The first call creates the page.
   */
  setLayout(layout: LayoutName, content: Record<number, string> = {}, create = false): Promise<boolean> {
    // Anything still queued belongs to the old page.
    for (const op of this.ops.splice(0)) {
      if (op.kind === 'text') op.waiters.forEach((w) => w())
      else op.done(false)
    }
    this.layout = layout
    this.text = new Map(Object.entries(content).map(([k, v]) => [Number(k), v]))
    this.images = new Map()
    this.changed()
    return new Promise((done) => {
      this.ops.push({ kind: 'page', layout, create, done })
      void this.pump()
    })
  }

  setTheme(theme: Partial<Theme>) {
    this.theme = { ...this.theme, ...theme }
    // Re-send every text container so colours and visibility update.
    for (const spec of LAYOUTS[this.layout]) {
      if (spec.kind === 'text') void this.set(spec.id, this.get(spec.id))
    }
  }

  private color(spec: TextSpec) {
    if (spec.role === 'body') return this.theme.night ? 2 : 4
    return this.theme.night ? 1 : 2
  }

  private visible(spec: TextSpec, content: string) {
    return this.theme.stealth && spec.role === 'chrome' ? ' ' : content || ' '
  }

  private changed() {
    if (!this.listeners.length) return
    const s = this.snapshot()
    this.listeners.forEach((fn) => fn(s))
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.ops.length) {
        const op = this.ops.shift()!
        if (op.kind === 'text') await this.sendText(op)
        else if (op.kind === 'image') op.done(await this.sendImage(op))
        else op.done(await this.sendPage(op))
      }
    } finally {
      this.running = false
    }
  }

  private async sendText(op: TextOp) {
    const spec = specOf(this.layout, op.id)
    if (spec?.kind === 'text') {
      try {
        await this.bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: spec.id,
            containerName: spec.name,
            content: this.visible(spec, this.get(spec.id)),
            textColor: this.color(spec),
          }),
        )
      } catch (err) {
        console.error('textContainerUpgrade failed', op.id, err)
      }
    }
    op.waiters.forEach((w) => w())
  }

  private async sendImage(op: ImageOp) {
    const spec = specOf(this.layout, op.id)
    if (spec?.kind !== 'image') return false
    try {
      const result = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: spec.id, containerName: spec.name, imageData: op.png }),
      )
      if (String(result) === 'success') return true
      console.warn('image rejected:', spec.name, result)
    } catch (err) {
      console.warn('image failed:', spec.name, err)
    }
    return false
  }

  private async sendPage(op: PageOp) {
    const page = buildPage(op.layout, (id) => this.visibleById(op.layout, id), (s) => this.color(s))
    try {
      if (op.create) {
        const result = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
        if (result === 0) return true
        // The startup page can only be created once per launch. After a WebView
        // reload (or a dev hot-reload) it already exists, so rebuild instead.
      }
      return await this.bridge.rebuildPageContainer(new RebuildPageContainer(page))
    } catch (err) {
      console.error('page build failed', op.layout, err)
      return false
    }
  }

  private visibleById(layout: LayoutName, id: number) {
    const spec = specOf(layout, id)
    return spec?.kind === 'text' ? this.visible(spec, this.get(id)) : ''
  }
}
