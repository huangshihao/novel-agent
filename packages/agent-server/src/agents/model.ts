import type { Model } from '@mariozechner/pi-ai'

export const AGENT_PROVIDER = 'baiduqianfancodingplan'

export function buildAgentModel(): Model<'openai-completions'> {
  return {
    id: process.env['AGENT_MODEL'] ?? 'qianfan-code-latest',
    name: 'Qianfan Code Latest',
    api: 'openai-completions',
    provider: AGENT_PROVIDER,
    baseUrl: process.env['AGENT_BASE_URL'] ?? 'https://qianfan.baidubce.com/v2/coding',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.0025, output: 0.01, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 98304,
    maxTokens: 65536,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
    },
  }
}
