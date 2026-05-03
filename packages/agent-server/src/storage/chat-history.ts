import type { ThreadUiMessage } from '@novel-agent/shared'
import { loadHistoryForUi } from './chat-db.js'

export async function loadChatHistoryForUi(
  novelId: string,
  chatId: string,
): Promise<ThreadUiMessage[]> {
  return loadHistoryForUi(novelId, chatId)
}
