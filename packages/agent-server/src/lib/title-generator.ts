import { buildSharedLlmClient } from './llm-client.js'

const TITLE_PROMPT = (userMessage: string) =>
  `用 6-14 个汉字给下面这条用户消息所开启的对话取一个简短标题。直接返回标题文本，不要引号、不要解释、不要标点收尾。

用户消息：
${userMessage.slice(0, 500)}`

/**
 * Generate a short Chinese title for a new chat from the user's first message.
 * Returns null on any failure (caller should keep '新对话').
 */
export async function generateChatTitle(userMessage: string): Promise<string | null> {
  try {
    const client = buildSharedLlmClient()
    const raw = await client.chat(TITLE_PROMPT(userMessage), { temperature: 0.5 })
    const cleaned = raw
      .trim()
      .replace(/^["'""「『]+|["'""」』]+$/g, '')
      .replace(/[。！？.!?,，；;]+$/g, '')
      .trim()
    if (!cleaned) return null
    if (cleaned.length > 30) return cleaned.slice(0, 30)
    return cleaned
  } catch (err) {
    console.error('[title-generator] failed:', err)
    return null
  }
}
