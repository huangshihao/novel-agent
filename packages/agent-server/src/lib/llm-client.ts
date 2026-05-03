import { DeepSeekClient } from '../deepseek-client.js'

/**
 * Analyzer 用：必须支持严格 JSON mode（response_format: json_object）。
 * 实测百度千帆 qianfan-code-latest 的 JSON mode 不靠谱，会输出非严格 JSON 导致解析失败，
 * 所以 analyzer 强制走 DeepSeek。
 */
export function buildAnalyzerLlmClient(): DeepSeekClient {
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
