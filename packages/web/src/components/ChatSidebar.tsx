import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { chatApi } from '../lib/chat-api.js'

interface Props {
  novelId: string
  selectedChatId: string | null
  onSelect: (chatId: string) => void
}

export function ChatSidebar({ novelId, selectedChatId, onSelect }: Props) {
  const qc = useQueryClient()
  const { data: chats } = useQuery({
    queryKey: ['chats', novelId],
    queryFn: () => chatApi.list(novelId),
    refetchInterval: 3_000,
  })
  const { data: active } = useQuery({
    queryKey: ['agent-active', novelId],
    queryFn: () => chatApi.getActive(novelId),
    refetchInterval: 3_000,
  })

  const createMut = useMutation({
    mutationFn: () => chatApi.create(novelId),
    onSuccess: (chat) => {
      qc.invalidateQueries({ queryKey: ['chats', novelId] })
      onSelect(chat.id)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (chatId: string) => chatApi.delete(novelId, chatId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats', novelId] }),
  })

  const onDelete = async (chatId: string) => {
    if (!confirm('删除这个 chat？历史会一起删掉')) return
    await deleteMut.mutateAsync(chatId)
    if (selectedChatId === chatId) onSelect('')
  }

  return (
    <div className="flex flex-col h-full border-r border-neutral-200 bg-neutral-50">
      <div className="p-2 border-b border-neutral-200">
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="w-full px-2 py-1.5 text-sm rounded bg-neutral-900 text-white disabled:opacity-50"
        >
          + 新建 chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {(chats ?? []).map((c) => {
          const isActive = active?.chatId === c.id
          const isSelected = selectedChatId === c.id
          return (
            <div
              key={c.id}
              className={clsx(
                'group px-3 py-2 border-b border-neutral-200 cursor-pointer text-sm',
                isSelected ? 'bg-white' : 'hover:bg-neutral-100',
              )}
              onClick={() => onSelect(c.id)}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate font-medium">{c.title}</span>
                {isActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(c.id)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-xs text-neutral-400 hover:text-rose-600"
                >
                  ✕
                </button>
              </div>
              {c.last_user_text && (
                <div className="mt-0.5 text-xs text-neutral-500 truncate">
                  {c.last_user_text}
                </div>
              )}
            </div>
          )
        })}
        {(chats ?? []).length === 0 && (
          <div className="p-4 text-xs text-neutral-400 text-center">
            还没有 chat
          </div>
        )}
      </div>
    </div>
  )
}
