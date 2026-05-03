import type { Model } from '@mariozechner/pi-ai'

export const AGENT_PROVIDER = 'baiduqianfancodingplan'
const DEFAULT_AGENT_MAX_TOKENS = 8192

function readAgentMaxTokens(): number {
  const raw = process.env['AGENT_MAX_TOKENS']
  if (!raw) return DEFAULT_AGENT_MAX_TOKENS
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AGENT_MAX_TOKENS
  return Math.floor(value)
}

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
    maxTokens: readAgentMaxTokens(),
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
    },
  }
}
