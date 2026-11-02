import { ApiError, requestJson } from './http'
import { declarations, runTool, type ToolContext } from '../tools'
import { persona } from '../persona'
import { localIso } from '../util/time'

// Flash-Lite answers in ~1 s on the free tier; full Flash is the fallback.
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type Part = { text?: string; functionCall?: { name: string; args: any }; functionResponse?: any; [k: string]: unknown }
type Content = { role: 'user' | 'model'; parts: Part[] }

export type Reply = { text: string; actions: ToolContext['actions'] }

const SEARCH_PROMPT =
  'Answer the question using Google Search. Plain text only, no markdown. Lead with the direct answer: ' +
  'the number, score, price, status or fact, with its date or time when it matters. Under 80 words. ' +
  'If the results do not answer it, say so.'

function systemPrompt(personaId: string, memory: string) {
  const now = new Date()
  return [
    persona(personaId).prompt,
    'You speak through smart glasses: replies appear on a tiny monochrome text display.',
    'Write plain text only. No markdown, no asterisks, no bullet or numbered lists, no emoji.',
    'Keep it to one to three short sentences, under 60 words, unless asked for more detail.',
    'Be accurate first, witty second. Answer the question before any quip.',
    'Use your tools for timers, reminders, calendar events, notes, lists, weather, currency, maths, units, memory,',
    'transit departures, sports scores, crypto prices, navigation, guides, activity tracking and the HUD views',
    '(dashboard, map, radar, captions, translation, meeting recording, teleprompter, briefing, protocols, diagnostics).',
    'Use web_search for anything current or that you are unsure of: news, prices, stock quotes, flight status, opening hours,',
    'results, people and events after your training. Never guess at live facts.',
    'For stock or crypto prices give the price and day change only; never give investment advice or opinions on buying or selling.',
    'Use calculate for arithmetic, tips and bill splits, and convert_units for conversions, rather than working them out yourself.',
    'If asked what someone just said or to summarise a conversation, call recall_conversation.',
    'When the user says they parked or wants to mark a spot, call drop_pin; for "take me back to..." call navigate_to_pin.',
    'When the user mentions money they spent, call log_expense. In an emergency or if they are hurt, call emergency at once.',
    'Also: plane_overhead, iss_pass, location reminders, flashcards, smart_home and the end-of-day debrief.',
    'When the user tells you something worth keeping about themselves or asks you to remember something, call remember.',
    'Never say you have set, saved, added or deleted something unless you called the tool and it succeeded.',
    'Write times and numbers as digits, e.g. 18:00, 3:30pm, £37.46.',
    'Work out exact local times yourself from relative phrases like "in 20 minutes" or "Tuesday at 3".',
    "The calendar is kept on the phone and includes the user's Google Calendar when they have linked it.",
    `It is ${now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}` +
      ` (local ISO ${localIso(now.getTime())}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
    memory,
  ].filter(Boolean).join(' ')
}

type Request = { system: string; contents: Content[]; tools?: object[] }

/** Holds a short conversation so follow-ups ("and tomorrow?") make sense. */
export class Brain {
  private history: Content[] = []

  constructor(
    private getKey: () => Promise<string>,
    private context: Omit<ToolContext, 'actions' | 'search' | 'complete'>,
  ) {}

  reset() {
    this.history = []
  }

  async ask(question: string): Promise<Reply> {
    const key = await this.requireKey()
    const ctx: ToolContext = { ...this.context, actions: [], search: (q) => this.search(q), complete: (i, t) => this.complete(i, t) }
    const system = systemPrompt(await this.context.settings.persona(), this.context.memory.promptBlock())
    const turn: Content[] = [{ role: 'user', parts: [{ text: question }] }]
    // Tool calls loop: model asks for a function, we run it and send the result back.
    for (let step = 0; step < 5; step++) {
      const content = await this.generate(key, { system, contents: [...this.history, ...turn], tools: [{ functionDeclarations: declarations }] })
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

  /**
   * Google Search grounding, in a request of its own: not every model accepts
   * the built-in search tool alongside function declarations.
   */
  async search(query: string): Promise<{ answer: string; sources: string[] }> {
    const key = await this.requireKey()
    const { content, raw } = await this.request(key, {
      system: `${SEARCH_PROMPT} Today is ${new Date().toDateString()}.`,
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ google_search: {} }],
    })
    const chunks: any[] = raw?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
    // Titles are the site's domain for grounded results; URIs are redirect links.
    const sources = [...new Set(chunks.map((c) => String(c.web?.title ?? '')).filter(Boolean))].slice(0, 3)
    return { answer: clean(content.parts.map((p) => p.text ?? '').join('')), sources }
  }

  /** One-off text task with its own instructions: no tools, no history (e.g. meeting summaries). */
  async complete(instructions: string, input: string): Promise<string> {
    const key = await this.requireKey()
    const content = await this.generate(key, { system: instructions, contents: [{ role: 'user', parts: [{ text: input }] }] })
    return clean(content.parts.map((p) => p.text ?? '').join(''))
  }

  private async requireKey() {
    const key = await this.getKey()
    if (!key) throw new ApiError('key', 'no Gemini key')
    return key
  }

  private remember(question: string, answer: string) {
    // Text-only history keeps requests small and avoids replaying stale tool data.
    this.history.push({ role: 'user', parts: [{ text: question }] }, { role: 'model', parts: [{ text: answer }] })
    this.history = this.history.slice(-8)
  }

  private async generate(key: string, req: Request): Promise<Content> {
    return (await this.request(key, req)).content
  }

  private async request(key: string, { system, contents, tools }: Request): Promise<{ content: Content; raw: any }> {
    let lastError: unknown
    for (const model of MODELS) {
      try {
        const body = await requestJson<any>(
          `${BASE}/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents,
              ...(tools ? { tools } : {}),
              generationConfig: { maxOutputTokens: 1024 },
            }),
          },
          15000,
        )
        const content = body?.candidates?.[0]?.content
        if (content?.parts?.length) return { content: { role: 'model', parts: content.parts }, raw: body }
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
    .replace(/\[(\d+(,\s*\d+)*)\]/g, '') // grounding citation markers
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
