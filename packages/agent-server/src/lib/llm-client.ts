import { DeepSeekClient } from '../deepseek-client.js'

/**
 * OpenAI-compatible client used by analyzer + auto-title.
 * Prefers AGENT_* envs (the chat agent's provider); falls back to DEEPSEEK_*.
 * Keeps DeepSeekClient class as the implementation since it's just an
 * OpenAI-compatible wrapper.
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
