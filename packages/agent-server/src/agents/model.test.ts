import { afterEach, describe, expect, it } from 'vitest'
import { buildAgentModel } from './model.js'

describe('buildAgentModel', () => {
  const originalMaxTokens = process.env['AGENT_MAX_TOKENS']

  afterEach(() => {
    if (originalMaxTokens === undefined) {
      delete process.env['AGENT_MAX_TOKENS']
    } else {
      process.env['AGENT_MAX_TOKENS'] = originalMaxTokens
    }
  })

  it('uses a bounded default max output token count', () => {
    delete process.env['AGENT_MAX_TOKENS']

    expect(buildAgentModel().maxTokens).toBe(8192)
  })

  it('allows overriding max output token count from environment', () => {
    process.env['AGENT_MAX_TOKENS'] = '4096'

    expect(buildAgentModel().maxTokens).toBe(4096)
  })
})
