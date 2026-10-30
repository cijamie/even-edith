import { requestJson } from '../net/http'
import { distanceBearing, metres, type Fix } from '../geo/location'
import { clock } from '../util/time'

// ── Transit departures (Transitous: free, open, worldwide GTFS) ────

const TRANSIT = 'https://api.transitous.org/api/v1'

type Stop = { name: string; stopId: string; parentId?: string; lat: number; lon: number; modes?: string[] }

/** Next departures from the nearest stations (or one named nearby). */
export async function departures(fix: Fix, { stop, mode }: { stop?: string; mode?: string }) {
  // ~700 m box around the user.
  const dLat = 0.0065
  const dLon = dLat / Math.cos((fix.lat * Math.PI) / 180)
  const stops = await requestJson<Stop[]>(
    `${TRANSIT}/map/stops?min=${fix.lat - dLat},${fix.lon - dLon}&max=${fix.lat + dLat},${fix.lon + dLon}`,
    {},
    12000,
  )
  // One entry per station: platforms share a parent.
  const stations = new Map<string, Stop & { distance: number }>()
  for (const s of stops) {
    const id = s.parentId || s.stopId
    const distance = distanceBearing(fix.lat, fix.lon, s.lat, s.lon).distance
    const prev = stations.get(id)
    if (!prev || distance < prev.distance) stations.set(id, { ...s, stopId: id, distance })
  }
  let list = [...stations.values()].sort((a, b) => a.distance - b.distance)
  if (mode) list = list.filter((s) => !s.modes || s.modes.some((m) => m.toLowerCase().includes(mode.toLowerCase())))
  if (stop) {
    const q = stop.toLowerCase()
    const named = list.filter((s) => s.name.toLowerCase().includes(q))
    if (named.length) list = named
  }
  if (!list.length) return { error: 'No transit stops within about 700 metres.' }

  const now = Date.now()
  const results = await Promise.all(
    list.slice(0, 2).map(async (s) => {
      const r = await requestJson<any>(`${TRANSIT}/stoptimes?stopId=${encodeURIComponent(s.stopId)}&n=8`, {}, 12000)
      return {
        stop: s.name,
        distance: metres(s.distance),
        departures: (r.stopTimes ?? [])
          .map((t: any) => {
            const at = new Date(t.place?.departure ?? t.place?.scheduledDeparture).getTime()
            return {
              line: t.routeShortName || t.displayName || t.mode,
              mode: String(t.mode ?? '').toLowerCase(),
              to: t.headsign,
              at: clock(at),
              inMinutes: Math.round((at - now) / 60_000),
              live: !!t.realTime,
            }
          })
          .filter((d: any) => d.inMinutes >= 0)
          .slice(0, 6),
      }
    }),
  )
  return { stations: results, note: 'live=false means timetable, not real-time.' }
}

// ── Sports scores (ESPN's public scoreboard feed) ───────────────────

export const LEAGUES: Record<string, string> = {
  premier_league: 'soccer/eng.1',
  championship: 'soccer/eng.2',
  champions_league: 'soccer/uefa.champions',
  europa_league: 'soccer/uefa.europa',
  la_liga: 'soccer/esp.1',
  serie_a: 'soccer/ita.1',
  bundesliga: 'soccer/ger.1',
  ligue_1: 'soccer/fra.1',
  scottish_premiership: 'soccer/sco.1',
  mls: 'soccer/usa.1',
  fa_cup: 'soccer/eng.fa',
  nfl: 'football/nfl',
  college_football: 'football/college-football',
  nba: 'basketball/nba',
  wnba: 'basketball/wnba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  f1: 'racing/f1',
}

export async function scores({ league, team }: { league: string; team?: string }) {
  const path = LEAGUES[league]
  if (!path) return { error: `Unknown league. Known: ${Object.keys(LEAGUES).join(', ')}.` }
  const r = await requestJson<any>(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`, {}, 10000)
  let events: any[] = r.events ?? []
  if (team) {
    const q = team.toLowerCase()
    events = events.filter((e) => String(e.name ?? '').toLowerCase().includes(q) || String(e.shortName ?? '').toLowerCase().includes(q))
  }
  const games = events.slice(0, 8).map((e) => {
    const comp = e.competitions?.[0]
    // Scheduled games carry a 0 score; leave it off until they start.
    const started = e.status?.type?.state !== 'pre'
    const sides = (comp?.competitors ?? []).map((c: any) => `${c.team?.shortDisplayName ?? c.athlete?.displayName ?? '?'} ${started ? (c.score ?? '') : ''}`.trim())
    return {
      match: sides.join(' v ') || e.name,
      status: e.status?.type?.shortDetail ?? e.status?.type?.description,
      start: e.date,
    }
  })
  if (!games.length) return { error: team ? `No ${team} game on the current ${league} scoreboard. Try web_search.` : 'No games on the scoreboard.' }
  return { league, games }
}

// ── Crypto prices (CoinGecko public API) ───────────────────────────

const GECKO = 'https://api.coingecko.com/api/v3'

export async function cryptoPrice({ coin, currency = 'usd' }: { coin: string; currency?: string }) {
  const found = await requestJson<any>(`${GECKO}/search?query=${encodeURIComponent(coin)}`, {}, 10000)
  const id = found.coins?.[0]?.id
  if (!id) return { error: `No coin called ${coin}.` }
  const cur = currency.toLowerCase()
  const r = await requestJson<any>(`${GECKO}/simple/price?ids=${id}&vs_currencies=${cur}&include_24hr_change=true`, {}, 10000)
  const p = r[id]
  if (p?.[cur] == null) return { error: `No ${currency.toUpperCase()} price for ${coin}.` }
  return { coin: found.coins[0].name, symbol: found.coins[0].symbol, price: p[cur], currency: cur.toUpperCase(), change24hPct: Math.round(p[`${cur}_24h_change`] * 100) / 100 }
}
