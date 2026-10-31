import { ApiError, requestJson } from './http'
import { declarations, runTool, type ToolContext } from '../tools'
import { localIso } from '../util/time'

// Flash-Lite answers in ~1 s on the free tier; full Flash is the fallback.
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type Part = { text?: string; functionCall?: { name: string; args: any }; functionResponse?: any; [k: string]: unknown }
type Content = { role: 'user' | 'model'; parts: Part[] }

export type Reply = { text: string; actions: ToolContext['actions'] }

function systemPrompt(memory: string) {
  const now = new Date()
  return [
    'You are E.D.I.T.H. ("Even Dead, I\'m The Hero"), a Stark Industries tactical AI:',
    'calm, precise, efficient, with a bone-dry sense of humour. You do not fawn and you do not use honorifics.',
    'You speak through smart glasses: replies appear on a tiny monochrome text display.',
    'Write plain text only. No markdown, no asterisks, no bullet or numbered lists, no emoji.',
    'Keep it to one to three short sentences, under 60 words, unless asked for more detail.',
    'Be accurate first, witty second. Answer the question before any quip.',
    'If something needs live data you have no tool for, say so briefly.',
    'Use your tools for timers, reminders (timed, repeating and place-based), calendar events, notes, lists, flashcards,',
    'weather (with sun, moon, UV and air quality), currency, sums, news, memory, lookups, relayed phone notifications and the HUD views',
    '(dashboard, map, radar, walking directions, captions, translation, meeting recording, teleprompter, flashcards, briefing, protocols).',
    'Use calculate for arithmetic rather than doing it in your head.',
    'Use web_lookup rather than guessing about facts you are unsure of.',
    'For anything recent (news, results, scores, announcements, prices, anything after your training) call get_news with a query',
    'before answering, and say when it happened. Never claim you cannot see current news: get_news searches the live web.',
    'When the user tells you something worth keeping about themselves or asks you to remember something, call remember,',
    'with an expiry for anything short-lived.',
    'Shopping and to-do items go on lists, not notes.',
    'Never say you have set, saved, added or deleted something unless you called the tool and it succeeded.',
    'Write times and numbers as digits, e.g. 18:00, 3:30pm, £37.46.',
    'Work out exact local times yourself from relative phrases like "in 20 minutes" or "Tuesday at 3".',
    'The calendar is your own, kept on the phone; you cannot see Google or iCloud calendars.',
    `It is ${now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}` +
      ` (local ISO ${localIso(now.getTime())}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    memory,
  ].filter(Boolean).join(' ')
}

/** Holds a short conversation so follow-ups ("and tomorrow?") make sense. */
export class Brain {
  private history: Content[] = []

  constructor(
    private getKey: () => Promise<string>,
    private context: Omit<ToolContext, 'actions'>,
  ) {}

  reset() {
    this.history = []
  }

  async ask(question: string): Promise<Reply> {
    const key = await this.getKey()
    if (!key) throw new ApiError('key', 'no Gemini key')

    const ctx: ToolContext = { ...this.context, actions: [], webSearch: (q) => this.search(q) }
    const turn: Content[] = [{ role: 'user', parts: [{ text: question }] }]
    // Tool calls loop: model asks for a function, we run it and send the result back.
    for (let step = 0; step < 4; step++) {
      const content = await this.generate(key, [...this.history, ...turn])
      // Keep the model's parts verbatim (newer models attach thought signatures).
      turn.push(content)
      const calls = content.parts.filter((p) => p.functionCall)
      if (!calls.length) {
        const answer = clean(content.parts.map((p) => p.text ?? '').join(''))
        this.remember(question, answer)
        return { text: answer, actions: ctx.actions }
      }
      const responses = await Promise.all(
        calls.map(async ({ functionCall }) => {
          console.log(`[tool] ${functionCall!.name}`, functionCall!.args)
          const response = await runTool(functionCall!.name, functionCall!.args, ctx)
          return { functionResponse: { name: functionCall!.name, response: { result: response } } }
        }),
      )
      turn.push({ role: 'user', parts: responses })
    }
    throw new ApiError('http', 'too many tool calls')
  }

  /** One-off text task with its own instructions: no tools, no history (e.g. meeting summaries). */
  async complete(instructions: string, input: string): Promise<string> {
    const key = await this.getKey()
    if (!key) throw new ApiError('key', 'no Gemini key')
    const content = await this.generate(key, [{ role: 'user', parts: [{ text: input }] }], instructions)
    return clean(content.parts.map((p) => p.text ?? '').join(''))
  }

  /**
   * Live web search through Gemini's built-in Google Search grounding: same key,
   * no other service. It can't share a request with our own function tools, so
   * it runs as a separate call. Returns null if the key's search quota is used up.
   */
  async search(query: string): Promise<{ summary: string; sources: string[] } | null> {
    const key = await this.getKey()
    if (!key) return null
    const instructions =
      `Today is ${new Date().toDateString()}. Search the web for the latest news on the user's topic. ` +
      'Reply in plain text with up to 5 short factual lines, newest first, each with its date. No markdown.'
    try {
      const body = await this.request(key, {
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts: [{ text: query }] }],
        tools: [{ google_search: {} }],
        generationConfig: { maxOutputTokens: 1024 },
      })
      const candidate = body?.candidates?.[0]
      const summary = clean((candidate?.content?.parts ?? []).map((p: Part) => p.text ?? '').join(''))
      if (!summary) return null
      const sources = (candidate?.groundingMetadata?.groundingChunks ?? [])
        .map((c: any) => c.web?.title)
        .filter(Boolean)
        .slice(0, 5)
      return { summary, sources }
    } catch (err) {
      console.warn('[search]', err)
      return null
    }
  }

  private remember(question: string, answer: string) {
    // Text-only history keeps requests small and avoids replaying stale tool data.
    this.history.push({ role: 'user', parts: [{ text: question }] }, { role: 'model', parts: [{ text: answer }] })
    this.history = this.history.slice(-8)
  }

  private async generate(key: string, contents: Content[], system?: string): Promise<Content> {
    const body = await this.request(
      key,
      {
        systemInstruction: { parts: [{ text: system ?? systemPrompt(this.context.memory.promptBlock()) }] },
        contents,
        ...(system ? {} : { tools: [{ functionDeclarations: declarations }] }),
        generationConfig: { maxOutputTokens: 1024 },
      },
      true,
    )
    return { role: 'model', parts: body.candidates[0].content.parts }
  }

  /** POSTs to each model in turn until one answers. */
  private async request(key: string, payload: object, needParts = false): Promise<any> {
    let lastError: unknown
    for (const model of MODELS) {
      try {
        const body = await requestJson<any>(
          `${BASE}/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          12000,
        )
        if (!needParts || body?.candidates?.[0]?.content?.parts?.length) return body
        lastError = new ApiError('server', `empty reply (${body?.candidates?.[0]?.finishReason ?? 'no candidate'})`)
      } catch (err) {
        lastError = err
        // A bad key or blocked request fails the same way on every model.
        if (err instanceof ApiError && (err.kind === 'key' || err.kind === 'blocked')) throw err
      }
    }
    throw lastError
  }
}

/** Strips any markdown the model slips in; the HUD can't render it. */
function clean(text: string) {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
