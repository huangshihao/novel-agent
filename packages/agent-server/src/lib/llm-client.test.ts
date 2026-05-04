import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildAnalyzerLlmClient } from './llm-client.js'

describe('buildAnalyzerLlmClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('defaults analyzer to the local OpenAI Responses proxy with gpt-5.5', async () => {
    const fetchMock = vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({
      output_text: '{"ok":true}',
    })))
    vi.stubGlobal('fetch', fetchMock)

    const client = buildAnalyzerLlmClient()
    await expect(client.chatJson('严格 JSON 输出')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('http://localhost:23001/proxy/plugin:openai-codex-auth:openai-codex/v1/responses')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'gpt-5.5',
      input: '严格 JSON 输出',
      text: { format: { type: 'json_object' } },
    })
  })

  it('can switch analyzer back to the retained DeepSeek chat client', async () => {
    vi.stubEnv('ANALYZER_LLM_PROVIDER', 'deepseek')
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key')
    vi.stubEnv('DEEPSEEK_MODEL', 'deepseek-chat')
    vi.stubEnv('DEEPSEEK_BASE_URL', 'https://api.deepseek.example/v1')

    const fetchMock = vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { content: '{"ok":true}' },
      }],
    })))
    vi.stubGlobal('fetch', fetchMock)

    const client = buildAnalyzerLlmClient()
    await expect(client.chatJson('严格 JSON 输出')).resolves.toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe('https://api.deepseek.example/v1/chat/completions')
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '严格 JSON 输出' }],
      response_format: { type: 'json_object' },
    })
  })
})
