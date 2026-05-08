import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekClient } from './deepseek-client.js'

describe('DeepSeekClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports truncated model responses before JSON parsing', async () => {
    vi.stubGlobal('fetch', vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({
      choices: [{
        finish_reason: 'length',
        message: { content: '{"items":[' },
      }],
    }))))

    const client = new DeepSeekClient({
      apiKey: 'key',
      model: 'deepseek-chat',
      baseUrl: 'https://api.example.com',
    })

    await expect(client.chatJson('严格 JSON 输出'))
      .rejects.toThrow('truncated response')
  })
})
