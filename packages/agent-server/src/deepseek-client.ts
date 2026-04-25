// DeepSeek (OpenAI 兼容) 客户端。JSON 模式 + 指数退避重试。
// M1 只用于分析阶段（摘要 + 人物 + 事件 + 钩子），Kimi/Agent 走另一套封装。

export interface DeepSeekConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeoutMs?: number
  maxRetries?: number
}

export class DeepSeekError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message)
    this.name = 'DeepSeekError'
  }
}

interface ChatOptions {
  temperature?: number
  top_p?: number
  jsonMode?: boolean
}

/** Low-level chat/completions 调用，成功返回 message.content 字符串。 */
export class DeepSeekClient {
  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly maxRetries: number

  constructor(cfg: DeepSeekConfig) {
    if (!cfg.apiKey) throw new Error('DeepSeekClient: apiKey is required')
    this.apiKey = cfg.apiKey
    this.model = cfg.model
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '')
    this.timeoutMs = cfg.timeoutMs ?? 120_000
    this.maxRetries = cfg.maxRetries ?? 3
  }

  async chat(prompt: string, opts: ChatOptions = {}): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: opts.temperature ?? 0.3,
      stream: false,
    }
    if (opts.top_p !== undefined) body['top_p'] = opts.top_p
    if (opts.jsonMode) body['response_format'] = { type: 'json_object' }

    let lastErr: unknown = null

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const resp = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        clearTimeout(t)

        if (resp.ok) {
          const json = (await resp.json()) as {
            choices?: { message?: { content?: string } }[]
          }
          const content = json.choices?.[0]?.message?.content
          if (typeof content !== 'string') {
            throw new DeepSeekError(
              'malformed response (no message.content)',
              200,
              JSON.stringify(json).slice(0, 500),
            )
          }
          return content
        }

        const text = await resp.text()
        // 4xx non-429: 立即抛，不重试
        if (resp.status !== 429 && resp.status >= 400 && resp.status < 500) {
          throw new DeepSeekError(
            `HTTP ${resp.status}`,
            resp.status,
            text.slice(0, 500),
          )
        }

        lastErr = new DeepSeekError(
          `HTTP ${resp.status}`,
          resp.status,
          text.slice(0, 500),
        )
        // Retry-After (可能是秒数)
        let retryAfterMs: number | null = null
        if (resp.status === 429) {
          const ra = resp.headers.get('retry-after')
          if (ra) {
            const asNum = Number(ra)
            if (!Number.isNaN(asNum)) retryAfterMs = asNum * 1000
          }
        }
        if (attempt < this.maxRetries - 1) {
          await sleep(
            jitter(retryAfterMs ?? backoff(attempt)),
          )
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

  /** 调用 chat + 解析 JSON，失败直接抛。 */
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

function backoff(attempt: number): number {
  // 1s, 2s, 4s ...
  return 1000 * 2 ** attempt
}

function jitter(ms: number): number {
  // 0.5x - 1.5x，避免并发 worker 抱团重试
  return ms * (0.5 + Math.random())
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

/** 并发限制 map：至多 `concurrency` 个任务同时跑。保序返回结果。 */
export async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i]!, i)
    }
  })
  await Promise.all(workers)
  return results
}
