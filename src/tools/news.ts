import { requestJson } from '../net/http'

export type Headline = { title: string; detail?: string; source: string }
export type Story = { date: string; category: string; topic: string; text: string; source?: string }

/** Optional live web search (Gemini with Google Search grounding), wired in by the Brain. */
export type WebSearch = (query: string) => Promise<{ summary: string; sources: string[] } | null>

/**
 * Free, keyless news: Wikipedia's "In the news" and daily "Current events"
 * pages for world events, and Hacker News for tech. All send CORS headers,
 * so the phone reads them directly. A query also goes to Google Search through
 * Gemini when that's available, for anything the free feeds don't cover.
 */
export async function getNews({ topic = 'world', query }: { topic?: string; query?: string }, webSearch?: WebSearch) {
  if (query) return searchNews(query, webSearch)
  try {
    const headlines = topic === 'tech' ? await techFront() : await worldNews()
    return headlines.length ? { topic, headlines } : { error: 'No headlines right now.' }
  } catch {
    return { error: 'The news feeds are not answering.' }
  }
}

/** For the HUD: a few short headlines, one per line. */
export async function newsText(topic: 'world' | 'tech', count = 6) {
  const headlines = await (topic === 'tech' ? techFront() : worldNews()).catch(() => [])
  if (!headlines.length) return 'The news feeds are not answering.'
  return headlines
    .slice(0, count)
    .map((h) => `· ${shorten(h.title, 120)}`)
    .join('\n')
}

/** Searches every source at once; whatever answers goes back to Gemini to summarise. */
export async function searchNews(query: string, webSearch?: WebSearch) {
  const [web, wiki, hn] = await Promise.allSettled([
    webSearch ? webSearch(query) : Promise.resolve(null),
    searchCurrentEvents(query),
    searchTech(query),
  ])
  const result = {
    query,
    today: new Date().toDateString(),
    webSearch: web.status === 'fulfilled' && web.value ? web.value : undefined,
    wikipediaCurrentEvents: wiki.status === 'fulfilled' ? wiki.value : [],
    hackerNews: hn.status === 'fulfilled' ? hn.value.slice(0, 4) : [],
    note:
      'Lead with the most recent facts and say when they happened. Wikipedia Current events lists notable world events by day; ' +
      'it may miss local or very fresh stories.',
  }
  if (!result.webSearch && !result.wikipediaCurrentEvents.length && !result.hackerNews.length) {
    return { query, error: 'Nothing found in the news sources for that in the past week.' }
  }
  return result
}

// ── World ──────────────────────────────────────────────────────────

export async function worldNews(): Promise<Headline[]> {
  const [itn, latest] = await Promise.allSettled([inTheNews(), currentEvents()])
  // "In the news" is the handful of major stories; Current events fills in the last day or two.
  const major = itn.status === 'fulfilled' ? itn.value : []
  const recent = (latest.status === 'fulfilled' ? latest.value : [])
    .filter((s) => !major.some((m) => overlap(m.title, s.text)))
    .slice(0, 6)
    .map((s) => ({ title: s.text, detail: `${s.date} · ${s.category}`, source: s.source ?? 'Wikipedia: Current events' }))
  return [...major, ...recent]
}

async function inTheNews(): Promise<Headline[]> {
  // Today's feed appears a little after midnight UTC, so fall back to yesterday.
  for (const daysAgo of [0, 1]) {
    const d = new Date(Date.now() - daysAgo * 86400_000)
    const path = `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
    try {
      const r = await requestJson<any>(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`, {}, 8000)
      const news: any[] = r?.news ?? []
      if (news.length) return news.map((n) => ({ title: plain(n.story), source: 'Wikipedia: In the news' }))
    } catch {}
  }
  return []
}

let cache: { at: number; stories: Story[] } | null = null
const CACHE_MS = 10 * 60_000

/** The last week of Wikipedia's Current events portal, newest first, in one request. */
export async function currentEvents(days = 7): Promise<Story[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.stories
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.now() - i * 86400_000))
  const titles = dates.map((d) => `Portal:Current events/${d.getUTCFullYear()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })} ${d.getUTCDate()}`)
  const r = await requestJson<any>(
    'https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&formatversion=2&origin=*&titles=' +
      encodeURIComponent(titles.join('|')),
    {},
    10000,
  )
  const pages: any[] = r?.query?.pages ?? []
  const stories = titles.flatMap((title) => {
    const page = pages.find((p) => p.title === title)
    const text = page?.revisions?.[0]?.slots?.main?.content
    return text ? parseDay(text, title.replace('Portal:Current events/', '')) : []
  })
  cache = { at: Date.now(), stories }
  return stories
}

/**
 * Turns a Current events day page into stories. The page nests bullets:
 * '''Category''' → *Topic → **Subtopic → ***Event. Each event keeps its
 * topic chain so a search for "Ukraine" finds events filed under the war.
 */
export function parseDay(wikitext: string, date: string): Story[] {
  const stories: Story[] = []
  let category = ''
  const chain: string[] = []
  for (const raw of wikitext.split('\n')) {
    const line = raw.trim()
    const heading = /^'''([^']+)'''$/.exec(line)
    if (heading) {
      category = heading[1]
      chain.length = 0
      continue
    }
    const bullet = /^(\*+)\s*(.*)$/.exec(line)
    if (!bullet) continue
    const depth = bullet[1].length
    const body = bullet[2]
    const source = /\[https?:\/\/\S+\s+\(([^)]+)\)\]/.exec(body)?.[1]?.replace(/''/g, '')
    const text = wikiPlain(body)
    if (!text) continue
    chain.length = depth - 1
    // An event is a sentence with a cited source; anything else is a topic heading.
    if (source || /[.!?]$/.test(text)) {
      stories.push({ date, category, topic: chain.filter(Boolean).join(' › '), text, source })
    }
    chain[depth - 1] = text
  }
  return stories
}

const CATEGORY_WORDS: Record<string, string[]> = {
  sport: ['sports'],
  sports: ['sports'],
  football: ['sports'],
  business: ['business and economy'],
  economy: ['business and economy'],
  markets: ['business and economy'],
  science: ['science and technology'],
  tech: ['science and technology'],
  technology: ['science and technology'],
  politics: ['politics and elections'],
  election: ['politics and elections'],
  elections: ['politics and elections'],
  war: ['armed conflicts and attacks'],
  conflict: ['armed conflicts and attacks'],
  crime: ['law and crime'],
  disaster: ['disasters and accidents'],
  weather: ['disasters and accidents'],
  health: ['health and environment'],
  environment: ['health and environment'],
  climate: ['health and environment'],
  culture: ['arts and culture'],
  arts: ['arts and culture'],
}
const STOP = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'to', 'for', 'news', 'latest', 'about', 'what', 's', 'is', 'happening', 'with', 'today', 'this', 'week', 'any', 'new', 'recent'])

/** Keyword search over the last week, best matches first, ties broken by recency. */
export async function searchCurrentEvents(query: string, limit = 8) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w))
  if (!words.length) return []
  const stories = await currentEvents()
  return stories
    .map((s, i) => {
      const hay = `${s.topic} ${s.text}`.toLowerCase()
      const cat = s.category.toLowerCase()
      let score = 0
      for (const w of words) {
        if (new RegExp(`\\b${escapeRe(w)}`, 'u').test(hay)) score += 2
        else if (CATEGORY_WORDS[w]?.includes(cat)) score += 1
      }
      return { s, score, i }
    })
    // Most words must match ("world series" needs both), unless the query is only a category ("sports").
    .filter((x) => x.score >= Math.ceil(words.length * 2 * 0.6) || (x.score > 0 && words.every((w) => CATEGORY_WORDS[w])))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ s }) => ({ date: s.date, topic: s.topic || s.category, text: s.text, source: s.source }))
}

// ── Tech ───────────────────────────────────────────────────────────

async function techFront(): Promise<Headline[]> {
  const r = await requestJson<any>('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=10', {}, 8000)
  return (r?.hits ?? [])
    .sort((a: any, b: any) => (b.points ?? 0) - (a.points ?? 0))
    .map((h: any) => ({ title: String(h.title), detail: `${h.points ?? 0} points`, source: 'Hacker News' }))
}

async function searchTech(query: string): Promise<Headline[]> {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400
  const r = await requestJson<any>(
    `https://hn.algolia.com/api/v1/search?tags=story&hitsPerPage=8&numericFilters=${encodeURIComponent(`created_at_i>${since},points>10`)}` +
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

// ── Text helpers ───────────────────────────────────────────────────

/** Wikipedia's feed stories are HTML with comments; the HUD wants plain text. */
function plain(html: string) {
  const text = new DOMParser().parseFromString(String(html).replace(/<!--[\s\S]*?-->/g, ''), 'text/html').body.textContent ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

/** [[Link|label]] → label, drops citations, templates, refs and bold/italics. */
export function wikiPlain(s: string) {
  return s
    .replace(/<ref[^>]*\/>|<ref[^>]*>[\s\S]*?<\/ref>|<!--[\s\S]*?-->/g, '')
    .replace(/\[https?:\/\/\S+(?:\s+[^\]]*)?\]/g, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Rough "same story" check: most of the longer words in common. */
function overlap(a: string, b: string) {
  const words = (s: string) => new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 4))
  const x = words(a)
  const y = words(b)
  let common = 0
  x.forEach((w) => y.has(w) && common++)
  return common >= Math.min(3, x.size)
}

const pad = (n: number) => String(n).padStart(2, '0')
const shorten = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
