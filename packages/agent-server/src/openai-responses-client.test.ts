import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIResponsesClient } from './openai-responses-client.js'

describe('OpenAIResponsesClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports failed Responses envelopes with the upstream error message', async () => {
    vi.stubGlobal('fetch', vi.fn<[URL | RequestInfo, RequestInit?], Promise<Response>>(async () => new Response(JSON.stringify({
      status: 'failed',
      error: {
        code: 'server_error',
        message: '403 forbidden',
      },
      output: [],
    }))))

    const client = new OpenAIResponsesClient({
      model: 'gpt-5.5',
      url: 'http://localhost:23001/v1/responses',
      maxRetries: 1,
    })

    await expect(client.chatJson('严格 JSON 输出')).rejects.toThrow('response failed: 403 forbidden')
  })
})
