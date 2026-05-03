import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { chatApi } from '../lib/chat-api.js'
import { ChatSidebar } from '../components/ChatSidebar.js'
import { ChatPanel } from '../components/ChatPanel.js'
import { ArtifactTabs } from '../components/ArtifactTabs.js'

export function RewritePage() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
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
    <div className="flex h-screen flex-col text-[var(--ink)]">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b ink-rule bg-[rgba(250,249,244,0.9)] px-4 backdrop-blur">
        <Link to={`/novels/${id}`} className="text-sm text-[var(--muted)] hover:text-[var(--ink)]">
          ← {novel.title}
        </Link>
        {currentChat && (
          <span className="truncate text-sm font-medium">/ {currentChat.title}</span>
        )}
      </header>
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[260px] shrink-0">
          <ChatSidebar
            novelId={id}
            selectedChatId={chatId}
            onSelect={(cid) => setChatId(cid || null)}
          />
        </div>
        <div className="min-w-[500px] flex-1 border-r ink-rule bg-[rgba(255,255,252,0.56)]">
          <ChatPanel
            novelId={id}
            chatId={chatId}
            onChatCreated={(newId) => {
              setChatId(newId)
              qc.invalidateQueries({ queryKey: ['chats', id] })
            }}
          />
        </div>
        <div className="min-w-[600px] flex-1 bg-[rgba(244,246,242,0.62)]">
          <ArtifactTabs novelId={id} />
        </div>
      </div>
    </div>
  )
}
