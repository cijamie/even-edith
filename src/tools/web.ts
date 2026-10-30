import { requestJson } from '../net/http'

/**
 * Free, keyless lookups: DuckDuckGo instant answers plus Wikipedia search
 * with intro extracts. Good for facts and anything Wikipedia covers; not live news.
 */
export async function webLookup({ query }: { query: string }) {
  const [ddg, wiki] = await Promise.allSettled([duckDuckGo(query), wikipedia(query)])
  const results = {
    instantAnswer: ddg.status === 'fulfilled' ? ddg.value : undefined,
    wikipedia: wiki.status === 'fulfilled' ? wiki.value : [],
  }
  if (!results.instantAnswer && !results.wikipedia.length) return { error: 'Nothing found.' }
  return results
}

async function duckDuckGo(query: string) {
  const r = await requestJson<any>(
    `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=${encodeURIComponent(query)}`,
    {},
    8000,
  )
  const text = r.Answer || r.AbstractText || r.Definition || r.RelatedTopics?.[0]?.Text
  return text ? { text: String(text).slice(0, 600), source: r.AbstractSource || r.AnswerType || 'DuckDuckGo' } : undefined
}

async function wikipedia(query: string) {
  const r = await requestJson<any>(
    'https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=3' +
      '&prop=extracts&exintro=1&explaintext=1&exsentences=4&gsrsearch=' +
      encodeURIComponent(query),
    {},
    8000,
  )
  const pages = Object.values<any>(r.query?.pages ?? {}).sort((a, b) => a.index - b.index)
  return pages.map((p) => ({ title: p.title, extract: String(p.extract ?? '').slice(0, 700) }))
}
