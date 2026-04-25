import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { agentApi } from '../lib/agent-api.js'
import { useActiveTask } from '../lib/use-active-task.js'
import { MapsPanel } from '../components/MapsPanel.js'
import { OutlinePanel } from '../components/OutlinePanel.js'
import { DraftsPanel } from '../components/DraftsPanel.js'
import { StatePanel } from '../components/StatePanel.js'
import { AgentChat } from '../components/AgentChat.js'
import { BatchJobPanel } from '../components/BatchJobPanel.js'
import { GenerateForm } from '../components/GenerateForm.js'
import clsx from 'clsx'

type Tab = 'maps' | 'outlines' | 'drafts'

export function RewritePage() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const { data: novel } = useQuery({
    queryKey: ['novel', id],
    queryFn: () => api.getNovel(id),
  })
  const { data: active } = useActiveTask(id)
  const [tab, setTab] = useState<Tab>('maps')

  if (!novel) return <p className="text-sm text-neutral-400">加载中...</p>

  const maxChapter = novel.analyzed_to

  const closeActive = async () => {
    if (!active) return
    if (active.kind === 'session') await agentApi.closeSession(active.session.id)
    else await agentApi.closeJob(active.batch.id)
    qc.invalidateQueries({ queryKey: ['agent-active', id] })
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-neutral-200 px-6 py-3 flex items-center gap-4">
        <Link to={`/novels/${id}`} className="text-sm text-neutral-500 hover:underline">
          ← {novel.title}
        </Link>
        <div className="flex-1" />
        {active && (
          <div className="flex items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">
              {active.kind === 'session' ? sessionLabel(active.session) : batchLabel(active.batch)}
            </span>
            <button
              onClick={closeActive}
              className="px-2 py-0.5 rounded border border-neutral-300 hover:bg-neutral-50"
            >
              结束
            </button>
          </div>
        )}
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
            {!active && tab === 'maps' && (
              <div className="flex items-center justify-center h-full text-sm text-neutral-400 p-4 text-center">
                切到大纲 / 正文 tab 启动 agent
              </div>
            )}
            {!active && tab === 'outlines' && (
              <div className="overflow-y-auto h-full">
                <GenerateForm
                  novelId={id}
                  role="outline"
                  maxChapter={maxChapter}
                  onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', id] })}
                />
              </div>
            )}
            {!active && tab === 'drafts' && (
              <div className="overflow-y-auto h-full">
                <GenerateForm
                  novelId={id}
                  role="writer"
                  maxChapter={maxChapter}
                  onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', id] })}
                />
              </div>
            )}
            {active?.kind === 'session' && (
              <AgentChat
                session={active.session}
                onClosed={() => qc.invalidateQueries({ queryKey: ['agent-active', id] })}
              />
            )}
            {active?.kind === 'batch' && (
              <BatchJobPanel
                jobId={active.batch.id}
                onClosed={() => qc.invalidateQueries({ queryKey: ['agent-active', id] })}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

function sessionLabel(s: { role: string; mode: string; scope: { from: number; to: number } }): string {
  const role = s.role === 'outline' ? '大纲' : '正文'
  const mode = s.mode === 'generate' ? '生成' : '修改'
  if (s.scope.from === s.scope.to) return `${mode}${role} 第 ${s.scope.from} 章`
  return `${mode}${role} ${s.scope.from}-${s.scope.to}`
}

function batchLabel(b: { chapters: number[]; completed: number[]; status: string }): string {
  return `批量正文 ${b.completed.length}/${b.chapters.length}（${b.status}）`
}
