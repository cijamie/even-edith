import { requestJson } from './http'

/** Speech to text with Groq's hosted Whisper. */
export async function transcribe(wav: Blob, key: string): Promise<string> {
  const form = new FormData()
  form.append('file', wav, 'speech.wav')
  form.append('model', 'whisper-large-v3-turbo')
  form.append('response_format', 'json')
  form.append('temperature', '0')
  const body = await requestJson<{ text?: string }>(
    'https://api.groq.com/openai/v1/audio/transcriptions',
    { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
    20000,
  )
  return (body.text ?? '').trim()
}

// Whisper's stock output for near-silence or noise.
const HALLUCINATIONS = new Set(['', 'you', 'thank you', 'thanks for watching', 'bye', '.'])

export const isNoise = (text: string) => HALLUCINATIONS.has(text.toLowerCase().replace(/[.!?,\s]+$/g, ''))
