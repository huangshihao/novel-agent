import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { chatApi } from '../lib/chat-api.js'
import { useConfirm } from '../lib/use-confirm.js'

interface Props {
  novelId: string
  selectedChatId: string | null
  onSelect: (chatId: string) => void
}

export function ChatSidebar({ novelId, selectedChatId, onSelect }: Props) {
  const qc = useQueryClient()
  const confirm = useConfirm()
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chats', novelId] })
      qc.invalidateQueries({ queryKey: ['agent-active', novelId] })
    },
  })

  const onDelete = async (chatId: string) => {
    const isRunning = active?.chatId === chatId
    const ok = await confirm({
      title: '删除 chat',
      message: isRunning
        ? '这个 chat 还在运行。删除会先停止后台任务，再删除历史。'
        : '删除这个 chat？历史会一起删掉。',
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (!ok) return
    await deleteMut.mutateAsync(chatId)
    if (selectedChatId === chatId) onSelect('')
  }

  const onSwitch = async (chatId: string) => {
    if (chatId === selectedChatId) return
    if (active && active.chatId !== chatId && active.chatId === selectedChatId) {
      const ok = await confirm({
        title: '切换 chat',
        message: '当前 chat 还在运行，要先停掉吗？',
        confirmLabel: '先停掉',
        tone: 'primary',
      })
      if (!ok) return
      try {
        await chatApi.stop(novelId, active.chatId)
      } catch { /* noop */ }
      qc.invalidateQueries({ queryKey: ['agent-active', novelId] })
    }
    onSelect(chatId)
  }

  return (
    <div className="flex h-full flex-col border-r ink-rule bg-[rgba(244,246,242,0.78)]">
      <div className="border-b ink-rule p-3">
        <button
          onClick={() => createMut.mutate()}
          disabled={createMut.isPending}
          className="btn-primary w-full px-2 py-2 text-sm disabled:opacity-50"
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
                'group cursor-pointer border-b ink-rule px-3 py-3 text-sm transition-colors',
                isSelected
                  ? 'bg-[rgba(255,255,252,0.82)] shadow-[inset_3px_0_0_var(--accent)]'
                  : 'hover:bg-[rgba(255,255,252,0.55)]',
              )}
              onClick={() => onSwitch(c.id)}
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
          <div className="p-4 text-center text-xs text-[var(--muted)]">
            还没有 chat
          </div>
        )}
      </div>
    </div>
  )
}
