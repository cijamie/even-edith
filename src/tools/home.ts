import type { Settings } from '../settings'

export type Hook = { name: string; url: string }

// Fixed hosts so the Even app's network whitelist can allow them: Home Assistant
// Cloud webhooks and IFTTT. (A home server's own address can't be whitelisted.)
const HOSTS = ['https://hooks.nabu.casa/', 'https://maker.ifttt.com/']
export const allowedHook = (url: string) => HOSTS.some((h) => url.startsWith(h))

const key = (s: string) => s.toLowerCase().replace(/\b(the|my|turn|switch|on|off)\b/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** "Lights | https://hooks.nabu.casa/…" per line. */
export function parseHooks(text: string): Hook[] {
  return text
    .split('\n')
    .map((line) => line.split('|').map((s) => s.trim()))
    .filter(([name, url]) => name && url && /^https:\/\//.test(url))
    .map(([name, url]) => ({ name, url }))
}

/**
 * Fires the webhook whose name best matches, POSTing the spoken command as a
 * form field (command=lights off) so one Home Assistant automation can handle
 * several commands by reading trigger.data.command (IFTTT gets it as value1).
 */
export async function smartHome({ device, command }: { device: string; command: string }, settings: Settings) {
  const hooks = parseHooks(await settings.smartHome())
  if (!hooks.length) return { error: 'No smart home webhooks set up. Add them in the phone app under Smart home.' }
  const k = key(device)
  const hook =
    hooks.find((h) => key(h.name) === k) ??
    hooks.find((h) => key(h.name).includes(k) || k.includes(key(h.name))) ??
    (hooks.length === 1 ? hooks[0] : undefined)
  if (!hook) return { error: `No webhook called "${device}".`, available: hooks.map((h) => h.name) }
  if (!allowedHook(hook.url)) return { error: 'Only Home Assistant Cloud (hooks.nabu.casa) and IFTTT webhooks are allowed.' }
  try {
    // A form body keeps it a simple request (no CORS preflight); no-cors because
    // webhooks don't send CORS headers. The response can't be read, only sent.
    await fetch(hook.url, {
      method: 'POST',
      mode: 'no-cors',
      body: new URLSearchParams({ command, device: hook.name, value1: command }),
      signal: AbortSignal.timeout(10000),
    })
    return { sent: command, to: hook.name, note: 'Webhooks do not report back, so say it was sent, not that it worked.' }
  } catch {
    return { error: `Couldn't reach the ${hook.name} webhook.` }
  }
}
