const pad = (n: number) => String(n).padStart(2, '0')

/** "14:05" */
export const clock = (ms: number) => {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "FRI 30 OCT" */
export const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }).toUpperCase().replace(',', '')

/** "4:07" or "1:02:03" */
export const countdown = (seconds: number) => {
  const s = Math.max(0, Math.ceil(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

/** "5 minutes", "1 hour 30 minutes", "45 seconds" */
export const spokenDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.round(seconds % 60)
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '')
  return [part(h, 'hour'), part(m, 'minute'), h ? '' : part(s, 'second')].filter(Boolean).join(' ') || '0 seconds'
}

/** Local time as ISO without zone, e.g. "2026-10-30T14:05:00", the format the tools ask Gemini for. */
export const localIso = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
}

export const isSameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString()
