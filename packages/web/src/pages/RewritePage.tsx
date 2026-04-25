import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { chatApi } from '../lib/chat-api.js'
import { ChatSidebar } from '../components/ChatSidebar.js'
import { ChatPanel } from '../components/ChatPanel.js'
import { ArtifactTabs } from '../components/ArtifactTabs.js'

export function RewritePage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: novel } = useQuery({ queryKey: ['novel', id], queryFn: () => api.getNovel(id) })
  const { data: chats } = useQuery({
    queryKey: ['chats', id],
    queryFn: () => chatApi.list(id),
  })

  const [chatId, setChatId] = useState<string | null>(null)

  useEffect(() => {
    if (chatId) return
    if (chats && chats.length > 0) {
      setChatId(chats[0]!.id)
    }
  }, [chats, chatId])

  if (!novel) return <p className="text-sm text-neutral-400 p-4">加载中...</p>

  const currentChat = chats?.find((c) => c.id === chatId)

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-neutral-200 px-4 h-12 flex items-center gap-3 shrink-0">
        <Link to={`/novels/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← {novel.title}
        </Link>
        {currentChat && (
          <span className="text-sm text-neutral-700">/ {currentChat.title}</span>
        )}
      </header>
      <div className="flex-1 flex overflow-hidden">
        <div className="w-[240px] shrink-0">
          <ChatSidebar
            novelId={id}
            selectedChatId={chatId}
            onSelect={(cid) => setChatId(cid || null)}
          />
        </div>
        <div className="min-w-[500px] flex-1 border-r border-neutral-200">
          <ChatPanel novelId={id} chatId={chatId} />
        </div>
        <div className="min-w-[600px] flex-1">
          <ArtifactTabs novelId={id} />
        </div>
      </div>
    </div>
  )
}
