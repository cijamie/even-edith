import { requestJson } from '../net/http'

export type Headline = { title: string; detail?: string; source: string }

/**
 * Free, keyless headlines: Wikipedia's "In the news" for world events and the
 * Hacker News front page for tech. Both send CORS headers, so the phone can
 * read them directly.
 */
export async function getNews({ topic = 'world', query }: { topic?: string; query?: string }) {
  try {
    if (query) return { topic: query, headlines: await searchTech(query), note: 'Search covers Hacker News (tech-leaning).' }
    const headlines = topic === 'tech' ? await techFront() : await worldNews()
    return headlines.length ? { topic, headlines } : { error: 'No headlines right now.' }
  } catch {
    return { error: 'The news feeds are not answering.' }
  }
}

/** For the HUD: a few short headlines, one per line. */
export async function newsText(topic: 'world' | 'tech', count = 5) {
  const r = await getNews({ topic })
  if ('error' in r) return String(r.error)
  return r.headlines
    .slice(0, count)
    .map((h) => `· ${h.title}`)
    .join('\n')
}

async function worldNews(): Promise<Headline[]> {
  // Today's feed appears a little after midnight UTC, so fall back to yesterday.
  for (const daysAgo of [0, 1]) {
    const d = new Date(Date.now() - daysAgo * 86400_000)
    const path = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`
    try {
      const r = await requestJson<any>(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`, {}, 8000)
      const news: any[] = r?.news ?? []
      if (news.length) return news.map((n) => ({ title: plain(n.story), source: 'Wikipedia: In the news' }))
    } catch {}
  }
  return []
}

async function techFront(): Promise<Headline[]> {
  const r = await requestJson<any>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10', {}, 8000)
  return (r?.hits ?? [])
    .sort((a: any, b: any) => (b.points ?? 0) - (a.points ?? 0))
    .map((h: any) => ({ title: String(h.title), detail: `${h.points ?? 0} points`, source: 'Hacker News' }))
}

async function searchTech(query: string): Promise<Headline[]> {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400
  const r = await requestJson<any>(
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=8&numericFilters=${encodeURIComponent(`created_at_i>${since}`)}` +
      `&query=${encodeURIComponent(query)}`,
    {},
    8000,
  )
  return (r?.hits ?? []).map((h: any) => ({
    title: String(h.title),
    detail: `${h.points ?? 0} points, ${new Date(h.created_at).toDateString()}`,
    source: 'Hacker News',
  }))
}

/** Wikipedia's stories are HTML with comments; the HUD wants plain text. */
function plain(html: string) {
  const text = new DOMParser().parseFromString(String(html).replace(/<!--[\s\S]*?-->/g, ''), 'text/html').body.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}
