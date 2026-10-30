export type ApiErrorKind = 'blocked' | 'timeout' | 'key' | 'rate' | 'server' | 'http'

export class ApiError extends Error {
  constructor(
    public kind: ApiErrorKind,
    message: string,
  ) {
    super(message)
  }
}

/** fetch + JSON with a timeout, turning failures into an ApiError with a usable kind. */
export async function requestJson<T = any>(url: string, init: RequestInit = {}, timeoutMs = 15000): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new ApiError('timeout', 'timed out')
    throw new ApiError('blocked', 'no readable response (CORS, whitelist or network)')
  }
  let body: any = null
  try {
    body = await res.json()
  } catch {}
  if (res.ok) return body as T
  const message = String(body?.error?.message ?? body?.error ?? res.statusText)
  const kind: ApiErrorKind =
    res.status === 401 || res.status === 403
      ? 'key'
      : res.status === 429
        ? 'rate'
        : res.status >= 500
          ? 'server'
          : 'http'
  throw new ApiError(kind, `HTTP ${res.status}: ${message}`)
}
