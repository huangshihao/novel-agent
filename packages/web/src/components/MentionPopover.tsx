import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export interface MentionItem {
  label: string
  token: string
  group: 'action' | 'artifact'
}

interface Props {
  novelId: string
  open: boolean
  query: string
  anchorEl: HTMLElement | null
  onSelect: (item: MentionItem) => void
  onClose: () => void
}

const STATIC_ACTIONS: MentionItem[] = [
  { label: '生成大纲', token: '@生成大纲', group: 'action' },
  { label: '生成正文', token: '@生成正文', group: 'action' },
  { label: '生成置换表', token: '@生成置换表', group: 'action' },
]

export function MentionPopover({
  novelId,
  open,
  query,
  anchorEl,
  onSelect,
  onClose,
}: Props) {
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    enabled: open,
  })
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    enabled: open,
  })
  const { data: maps } = useQuery({
    queryKey: ['maps', novelId],
    queryFn: () => api.getMaps(novelId),
    enabled: open,
  })

  const items: MentionItem[] = useMemo(
    () => [
      ...STATIC_ACTIONS,
      { label: '大纲（整篇）', token: '@大纲', group: 'artifact' },
      ...(outlines ?? []).map<MentionItem>((o) => ({
        label: `大纲第 ${o.number} 章`,
        token: `@大纲第${o.number}章`,
        group: 'artifact',
      })),
      { label: '正文（整篇）', token: '@正文', group: 'artifact' },
      ...(drafts ?? []).map<MentionItem>((d) => ({
        label: `正文第 ${d.number} 章`,
        token: `@正文第${d.number}章`,
        group: 'artifact',
      })),
      { label: '置换表', token: '@置换表', group: 'artifact' },
      ...(maps?.character_map ?? []).map<MentionItem>((c) => ({
        label: `人物 ${c.target}`,
        token: `@人物${c.target}`,
        group: 'artifact',
      })),
    ],
    [outlines, drafts, maps],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.label.toLowerCase().includes(q))
  }, [items, query])

  const [activeIdx, setActiveIdx] = useState(0)
  useEffect(() => setActiveIdx(0), [query, open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        const item = filtered[activeIdx]
        if (item) {
          e.preventDefault()
          e.stopPropagation()
          onSelect(item)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, filtered, activeIdx, onSelect, onClose])

  const virtualRef = useMemo(
    () => (anchorEl ? { current: anchorEl } : undefined),
    [anchorEl],
  )

  return (
    <Popover.Root open={open && !!anchorEl} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor virtualRef={virtualRef} />
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          className="bg-white border border-neutral-200 rounded shadow-lg min-w-[280px] max-h-[320px] overflow-y-auto p-1 text-sm z-50"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-neutral-400">没有匹配项</div>
          )}
          {filtered.map((item, i) => (
            <button
              key={`${item.group}-${item.token}`}
              type="button"
              onClick={() => onSelect(item)}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-1.5 rounded ${
                i === activeIdx ? 'bg-neutral-100' : ''
              }`}
            >
              <span className="text-neutral-400 text-xs mr-2">
                {item.group === 'action' ? '动作' : '引用'}
              </span>
              {item.label}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
