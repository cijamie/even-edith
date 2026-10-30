import { TextContainerUpgrade, type EvenAppBridge } from '@evenrealities/even_hub_sdk'

type Pending = { content: string; textColor?: number; waiters: (() => void)[] }

/**
 * Serialises text updates over the Bluetooth bridge.
 *
 * Only one textContainerUpgrade is in flight at a time, and if a container is
 * updated again before its previous update was sent, the newer content wins.
 * That keeps fast animations (typewriter, waveform) from flooding the link.
 */
export class Display {
  private pending = new Map<number, Pending>()
  private running = false

  constructor(
    private bridge: EvenAppBridge,
    private names: Record<number, string>,
  ) {}

  /** Queue new content; resolves once this (or newer) content has been sent. */
  set(containerID: number, content: string, textColor?: number): Promise<void> {
    return new Promise((resolve) => {
      const prev = this.pending.get(containerID)
      this.pending.set(containerID, {
        content,
        textColor: textColor ?? prev?.textColor,
        waiters: [...(prev?.waiters ?? []), resolve],
      })
      void this.pump()
    })
  }

  private async pump() {
    if (this.running) return
    this.running = true
    try {
      while (this.pending.size) {
        const [containerID, job] = this.pending.entries().next().value!
        this.pending.delete(containerID)
        try {
          await this.bridge.textContainerUpgrade(
            new TextContainerUpgrade({
              containerID,
              containerName: this.names[containerID],
              content: job.content,
              textColor: job.textColor,
            }),
          )
        } catch (err) {
          console.error('textContainerUpgrade failed', containerID, err)
        }
        job.waiters.forEach((w) => w())
      }
    } finally {
      this.running = false
    }
  }
}
