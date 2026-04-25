import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { agentApi } from '../lib/agent-api.js'
import { MapsPanel } from '../components/MapsPanel.js'
import { OutlinePanel } from '../components/OutlinePanel.js'
import { DraftsPanel } from '../components/DraftsPanel.js'
import { StatePanel } from '../components/StatePanel.js'
import { AgentChat } from '../components/AgentChat.js'
import clsx from 'clsx'

type Tab = 'maps' | 'outlines' | 'drafts'

export function RewritePage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: novel } = useQuery({
    queryKey: ['novel', id],
    queryFn: () => api.getNovel(id),
  })
  const [tab, setTab] = useState<Tab>('maps')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [batch, setBatch] = useState<{ from: number; to: number }>({ from: 1, to: 100 })

  const startSession = async (role: 'outline' | 'writer') => {
    const resp = role === 'outline'
      ? await agentApi.startOutline(id, batch.from, batch.to)
      : await agentApi.startWriter(id, batch.from, batch.to)
    setSessionId(resp.session_id)
  }

  if (!novel) return <p className="text-sm text-neutral-400">加载中...</p>

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-neutral-200 px-6 py-3 flex items-center gap-4">
        <Link to={`/novel/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← {novel.title}
        </Link>
        <div className="flex-1" />

        <div className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">本批章节范围</span>
          <input
            type="number"
            value={batch.from}
            min={1}
            max={novel.chapter_count}
            onChange={(e) => setBatch((b) => ({ ...b, from: Number(e.target.value) }))}
            className="w-16 px-2 py-1 border border-neutral-300 rounded"
          />
          <span>—</span>
          <input
            type="number"
            value={batch.to}
            min={1}
            max={novel.chapter_count}
            onChange={(e) => setBatch((b) => ({ ...b, to: Number(e.target.value) }))}
            className="w-16 px-2 py-1 border border-neutral-300 rounded"
          />
          <button
            onClick={() => startSession('outline')}
            className="px-3 py-1 rounded bg-amber-500 text-white text-xs"
          >
            启动大纲 agent
          </button>
          <button
            onClick={() => startSession('writer')}
            className="px-3 py-1 rounded bg-emerald-500 text-white text-xs"
          >
            启动写作 agent
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 flex flex-col overflow-hidden">
          <nav className="flex gap-1 border-b border-neutral-200 bg-neutral-50 px-2">
            {(
              [
                ['maps', '置换表'],
                ['outlines', '大纲'],
                ['drafts', '正文'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  'px-4 py-2 text-sm border-b-2 -mb-px',
                  tab === key
                    ? 'border-amber-500 text-amber-700'
                    : 'border-transparent text-neutral-500',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="flex-1 overflow-hidden">
            {tab === 'maps' && <MapsPanel novelId={id} />}
            {tab === 'outlines' && <OutlinePanel novelId={id} />}
            {tab === 'drafts' && <DraftsPanel novelId={id} />}
          </div>
        </main>

        <aside className="w-[400px] border-l border-neutral-200 flex flex-col">
          <div className="border-b border-neutral-200">
            <StatePanel novelId={id} />
          </div>
          <div className="flex-1 overflow-hidden">
            <AgentChat sessionId={sessionId} onClosed={() => setSessionId(null)} />
          </div>
        </aside>
      </div>
    </div>
  )
}
