import { DeepSeekError, type ChatJsonClient, type ChatOptions } from './deepseek-client.js'

export interface OpenAIResponsesConfig {
  apiKey?: string
  model: string
  url: string
  timeoutMs?: number
  maxRetries?: number
}

export class OpenAIResponsesClient implements ChatJsonClient {
  private readonly apiKey?: string
  private readonly model: string
  private readonly url: string
  private readonly timeoutMs: number
  private readonly maxRetries: number

  constructor(cfg: OpenAIResponsesConfig) {
    if (!cfg.model) throw new Error('OpenAIResponsesClient: model is required')
    if (!cfg.url) throw new Error('OpenAIResponsesClient: url is required')
    this.apiKey = cfg.apiKey
    this.model = cfg.model
    this.url = cfg.url
    this.timeoutMs = cfg.timeoutMs ?? 120_000
    this.maxRetries = cfg.maxRetries ?? 3
  }

  async chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      input: prompt,
      temperature: opts.temperature ?? 0.3,
      stream: false,
    }
    if (opts.top_p !== undefined) body['top_p'] = opts.top_p
    if (opts.jsonMode) body['text'] = { format: { type: 'json_object' } }

    let lastErr: unknown = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`

        const resp = await fetch(this.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        clearTimeout(t)

        if (resp.ok) {
          const json = await resp.json()
          return extractResponsesText(json)
        }

        const text = await resp.text()
        if (resp.status !== 429 && resp.status >= 400 && resp.status < 500) {
          throw new DeepSeekError(`HTTP ${resp.status}`, resp.status, text.slice(0, 500))
        }

        lastErr = new DeepSeekError(`HTTP ${resp.status}`, resp.status, text.slice(0, 500))
        let retryAfterMs: number | null = null
        if (resp.status === 429) {
          const ra = resp.headers.get('retry-after')
          if (ra) {
            const asNum = Number(ra)
            if (!Number.isNaN(asNum)) retryAfterMs = asNum * 1000
          }
        }
        if (attempt < this.maxRetries - 1) {
          await sleep(jitter(retryAfterMs ?? backoff(attempt)))
        }
      } catch (err) {
        clearTimeout(t)
        if (err instanceof DeepSeekError && err.status && err.status < 500 && err.status !== 429) {
          throw err
        }
        lastErr = err
        if (attempt < this.maxRetries - 1) {
          await sleep(jitter(backoff(attempt)))
        }
      }
    }

    if (lastErr instanceof Error) {
      throw new DeepSeekError(`exhausted retries: ${lastErr.message}`)
    }
    throw new DeepSeekError('exhausted retries')
  }

  async chatJson<T = unknown>(prompt: string, opts: Omit<ChatOptions, 'jsonMode'> = {}): Promise<T> {
    const raw = await this.chat(prompt, { ...opts, jsonMode: true })
    try {
      return JSON.parse(raw) as T
    } catch (err) {
      throw new DeepSeekError(
        `invalid JSON: ${(err as Error).message}`,
        200,
        raw.slice(0, 500),
      )
    }
  }
}

function extractResponsesText(json: unknown): string {
  const response = json as {
    output_text?: unknown
    status?: unknown
    error?: { message?: unknown }
    incomplete_details?: { reason?: unknown }
    output?: {
      type?: unknown
      content?: { type?: unknown; text?: unknown }[]
    }[]
  }

  if (response.status === 'incomplete') {
    const reason = String(response.incomplete_details?.reason ?? 'unknown')
    throw new DeepSeekError(`incomplete response (${reason})`, 200, JSON.stringify(json).slice(0, 500))
  }

  if (response.status === 'failed') {
    const message = String(response.error?.message ?? 'unknown')
    throw new DeepSeekError(`response failed: ${message}`, 200, JSON.stringify(json).slice(0, 500))
  }

  if (typeof response.output_text === 'string') return response.output_text

  const parts: string[] = []
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        parts.push(content.text)
      }
    }
  }
  if (parts.length > 0) return parts.join('')

  throw new DeepSeekError(
    'malformed response (no output_text)',
    200,
    JSON.stringify(json).slice(0, 500),
  )
}

function backoff(attempt: number): number {
  return 1000 * 2 ** attempt
}

function jitter(ms: number): number {
  return ms * (0.5 + Math.random())
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}
