import type { Settings } from '../settings'

export type Notice = { id: string; title: string; message: string; at: number }

const POLL_MS = 20_000
const KEEP = 20

/**
 * Notifications relayed through ntfy.sh, a free hosted push service: a phone
 * automation (Shortcuts, MacroDroid, Tasker...) posts to your private topic and
 * EDITH polls it. No server of your own. The topic name is the only secret, so
 * it should be long and random.
 */
export class Relay {
  private since = ''
  private topic = ''
  private polling = false
  private lastPoll = 0
  readonly recent: Notice[] = []

  constructor(
    private settings: Settings,
    private onNotice: (n: Notice) => void,
  ) {}

  /** Called once a second; polls every 20 s while a topic is set. */
  async tick() {
    if (this.polling || Date.now() - this.lastPoll < POLL_MS) return
    this.polling = true
    this.lastPoll = Date.now()
    try {
      const topic = await this.settings.relayTopic()
      if (topic !== this.topic) {
        // Resume after the last message seen; for a new topic, catch only the last couple of minutes.
        this.topic = topic
        this.since = (topic && (await this.settings.getState(`relay.${topic}`))) || '2m'
      }
      if (!topic) return
      for (const n of await fetchSince(topic, this.since)) {
        this.since = n.id
        void this.settings.setState(`relay.${topic}`, n.id)
        this.recent.unshift(n)
        this.recent.length = Math.min(this.recent.length, KEEP)
        this.onNotice(n)
      }
    } catch (err) {
      console.warn('[relay]', err)
    } finally {
      this.polling = false
    }
  }
}

/** ntfy's poll endpoint returns one JSON object per line. */
async function fetchSince(topic: string, since: string): Promise<Notice[]> {
  const res = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}/json?poll=1&since=${encodeURIComponent(since)}`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`)
  return (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((m) => m.event === 'message')
    .map((m) => ({ id: String(m.id), title: String(m.title ?? ''), message: String(m.message ?? ''), at: m.time * 1000 }))
}

/** A topic name nobody will guess. */
export const randomTopic = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return 'edith-' + [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 18)
}

export const topicUrl = (topic: string) => `https://ntfy.sh/${topic}`
