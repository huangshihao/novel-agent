import { DeepSeekClient } from '../deepseek-client.js'
import { OpenAIResponsesClient } from '../openai-responses-client.js'

const DEFAULT_ANALYZER_RESPONSES_URL = 'http://localhost:23001/proxy/plugin:openai-codex-auth:openai-codex/v1/responses'

/**
 * Analyzer 默认走本地 OpenAI Responses 代理；设置 ANALYZER_LLM_PROVIDER=deepseek 可切回原 DeepSeek。
 */
export function buildAnalyzerLlmClient(): DeepSeekClient | OpenAIResponsesClient {
  const provider = (process.env['ANALYZER_LLM_PROVIDER'] ?? 'responses').toLowerCase()
  if (provider === 'deepseek') return buildAnalyzerDeepSeekClient()
  if (provider !== 'responses') {
    throw new Error(`unsupported ANALYZER_LLM_PROVIDER: ${provider}`)
  }
  return new OpenAIResponsesClient({
    apiKey: process.env['ANALYZER_API_KEY'] || process.env['OPENAI_API_KEY'],
    model: process.env['ANALYZER_MODEL'] ?? 'gpt-5.5',
    url: process.env['ANALYZER_RESPONSES_URL'] ?? DEFAULT_ANALYZER_RESPONSES_URL,
  })
}

function buildAnalyzerDeepSeekClient(): DeepSeekClient {
  const apiKey = process.env['DEEPSEEK_API_KEY']
  if (!apiKey) {
    throw new Error('DEEPSEEK_API_KEY is required for analyzer (needs strict JSON mode)')
  }
  return new DeepSeekClient({
    apiKey,
    model: process.env['DEEPSEEK_MODEL'] ?? 'deepseek-chat',
    baseUrl: process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com/v1',
  })
}

/**
 * 通用文本生成客户端（auto-title 等不需要 JSON mode 的轻量场景）。
 * 优先走 AGENT_*（用户配置的 agent endpoint，方便共享配额），fallback DEEPSEEK_*。
 */
export function buildSharedLlmClient(): DeepSeekClient {
  const apiKey = process.env['AGENT_API_KEY'] || process.env['DEEPSEEK_API_KEY']
  if (!apiKey) {
    throw new Error('AGENT_API_KEY or DEEPSEEK_API_KEY is required')
  }
  return new DeepSeekClient({
    apiKey,
    model: process.env['AGENT_MODEL'] || process.env['DEEPSEEK_MODEL'] || 'qianfan-code-latest',
    baseUrl: process.env['AGENT_BASE_URL'] || process.env['DEEPSEEK_BASE_URL'] || 'https://qianfan.baidubce.com/v2/coding',
  })
}

export function buildOutlineEvaluatorLlmClient(): { client: DeepSeekClient; model: string } {
  const apiKey =
    process.env['OUTLINE_EVAL_API_KEY'] ||
    process.env['AGENT_API_KEY'] ||
    process.env['DEEPSEEK_API_KEY']
  if (!apiKey) {
    throw new Error('OUTLINE_EVAL_API_KEY, AGENT_API_KEY or DEEPSEEK_API_KEY is required')
  }
  const model = process.env['OUTLINE_EVAL_MODEL'] || 'gpt-5.5-high'
  return {
    model,
    client: new DeepSeekClient({
      apiKey,
      model,
      baseUrl:
        process.env['OUTLINE_EVAL_BASE_URL'] ||
        process.env['AGENT_BASE_URL'] ||
        process.env['DEEPSEEK_BASE_URL'] ||
        'https://qianfan.baidubce.com/v2/coding',
    }),
  }
}
