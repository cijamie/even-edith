import { ApiError, requestJson } from './http'
import { declarations, runTool, type ToolContext } from '../tools'
import { localIso } from '../util/time'

// Flash-Lite answers in ~1 s on the free tier; full Flash is the fallback.
const MODELS = ['gemini-flash-lite-latest', 'gemini-flash-latest']
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type Part = { text?: string; functionCall?: { name: string; args: any }; functionResponse?: any; [k: string]: unknown }
type Content = { role: 'user' | 'model'; parts: Part[] }

export type Reply = { text: string; actions: ToolContext['actions'] }

function systemPrompt() {
  const now = new Date()
  return [
    'You are E.D.I.T.H. ("Even Dead, I\'m The Hero"), a Stark Industries tactical AI:',
    'calm, precise, efficient, with a bone-dry sense of humour. You do not fawn and you do not use honorifics.',
    'You speak through smart glasses: replies appear on a tiny monochrome text display.',
    'Write plain text only. No markdown, no asterisks, no bullet or numbered lists, no emoji.',
    'Keep it to one to three short sentences, under 60 words, unless asked for more detail.',
    'Be accurate first, witty second. Answer the question before any quip.',
    'If something needs live data you have no tool for, say so briefly.',
    'Use your tools for timers, reminders, calendar events, notes, weather, currency and the dashboard.',
    'Never say you have set, saved, added or deleted something unless you called the tool and it succeeded.',
    'Write times and numbers as digits, e.g. 18:00, 3:30pm, £37.46.',
    'Work out exact local times yourself from relative phrases like "in 20 minutes" or "Tuesday at 3".',
    'The calendar is your own, kept on the phone; you cannot see Google or iCloud calendars.',
    `It is ${now.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' })}` +
      ` (local ISO ${localIso(now.getTime())}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}).`,
  ].join(' ')
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

    const ctx: ToolContext = { ...this.context, actions: new Set() }
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

  private remember(question: string, answer: string) {
    // Text-only history keeps requests small and avoids replaying stale tool data.
    this.history.push({ role: 'user', parts: [{ text: question }] }, { role: 'model', parts: [{ text: answer }] })
    this.history = this.history.slice(-8)
  }

  private async generate(key: string, contents: Content[]): Promise<Content> {
    let lastError: unknown
    for (const model of MODELS) {
      try {
        const body = await requestJson<any>(
          `${BASE}/${model}:generateContent`,
          {
            method: 'POST',
            headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: systemPrompt() }] },
              contents,
              tools: [{ functionDeclarations: declarations }],
              generationConfig: { maxOutputTokens: 1024 },
            }),
          },
          12000,
        )
        const content = body?.candidates?.[0]?.content
        if (content?.parts?.length) return { role: 'model', parts: content.parts }
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
