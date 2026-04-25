# Plan 3：改写 UI（前端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 2 的 agent 后端基础上，建一套用户界面：通过对话与大纲 agent / 写作 agent 协作产出新书。**完成后**：用户在浏览器里能上传参考小说 → 看分析 → 进入"改写"模式 → 让 agent 生成置换表 → 生成大纲 → 改大纲 → 写正文 → 阅读正文。

**Architecture:**
- 在已有 `/novel/:id` 详情页加 "去改写"入口，跳到新页 `/novel/:id/rewrite`
- 改写页一个 layout，左侧 tabs（置换表 / 大纲 / 正文），右侧 agent 对话面板
- 三个 panel 分别用 React Query 拉取后端 MD 数据；一个 `<AgentChat>` 组件统一处理与 agent 的对话流
- SSE 消费用一个 `useAgentStream` hook 封装，把流式 token / tool call / tool result 展示到聊天气泡

**Tech Stack:**
- React 18 + Vite + Tailwind v4（已有）
- React Query v5（已有）
- React Router v7（已有）
- 不新增主要依赖

**约定：**
- Commit message 不要 `Co-Authored-By: Claude`
- 每 commit 前 `pnpm typecheck`（root）全绿
- UI 新组件全部 TypeScript + 函数组件 + Tailwind class
- 禁止 emoji，除非已有 UI 风格保持

**前置参考：**
- 设计 spec：`docs/superpowers/specs/2026-04-25-novel-rewrite-agent-design.md`
- Plan 2 后端 API：`docs/superpowers/plans/2026-04-25-agent-tools-backend.md`（Task 16/17）
- 参考 chat UI 风格：`/Users/horace/playground/play-agent/packages/desktop/src/renderer/`（BIM 桌面 chat 实现）

**前置条件：**
- Plan 1 跑通（分析数据可读）
- Plan 2 跑通（4 工具 + 2 agent + REST/SSE 后端可用）

---

## Task 1：API 客户端 + 类型扩展

**Files:**
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/lib/agent-api.ts`

- [ ] **Step 1：扩展 api.ts**

加：

```typescript
import type { AgentSessionInfo } from '@novel-agent/shared'

export const api = {
  // ... 已有
  // ── target / 改写产物 ──
  getMaps: (id: string) =>
    fetch(`/api/novel/${id}/maps`).then(j<MapsRecord | null>),  // Plan 2 加端点
  listOutlines: (id: string) =>
    fetch(`/api/novel/${id}/outlines`).then(j<OutlineRecord[]>),
  getOutline: (id: string, n: number) =>
    fetch(`/api/novel/${id}/outlines/${n}`).then(j<OutlineRecord>),
  listDrafts: (id: string) =>
    fetch(`/api/novel/${id}/drafts`).then(j<ChapterDraftSummary[]>),
  getDraft: (id: string, n: number) =>
    fetch(`/api/novel/${id}/drafts/${n}`).then(j<ChapterDraftFull>),
  getState: (id: string) =>
    fetch(`/api/novel/${id}/state`).then(j<StateRecord | null>),
}
```

注意：Plan 2 Task 16 主要写了 agent 路由；**这个 task 同时需要 Plan 2 后端补 GET `/api/novel/:id/{maps,outlines,drafts,state}` 端点**——如果 Plan 2 没补，先在 Plan 2 范围内追加这些 GET 端点（薄包装 storage/target-reader 即可）。建议在 Plan 2 实施时一并加进 routes/novel.ts。

- [ ] **Step 2：写 agent-api.ts**

```typescript
import type { AgentSessionInfo } from '@novel-agent/shared'

interface StartSessionResponse {
  session_id: string
  novel_id: string
  role: 'outline' | 'writer'
  batch: { from: number; to: number }
}

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { message?: string; error?: string }
    throw new Error(body.message || body.error || `HTTP ${r.status}`)
  }
  return r.json() as Promise<T>
}

export const agentApi = {
  startOutline: (novelId: string, from: number, to: number) =>
    fetch(`/api/agent/${novelId}/outline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then(j<StartSessionResponse>),

  startWriter: (novelId: string, from: number, to: number) =>
    fetch(`/api/agent/${novelId}/writer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    }).then(j<StartSessionResponse>),

  listSessions: (novelId: string) =>
    fetch(`/api/agent/${novelId}/sessions`).then(j<AgentSessionInfo[]>),

  closeSession: (sessionId: string) =>
    fetch(`/api/agent/session/${sessionId}`, { method: 'DELETE' }),

  /** 给 SSE 消费用：返回 EventSource 已开就好 */
  messageUrl: (sessionId: string) =>
    `/api/agent/session/${sessionId}/message`,
  runUrl: (sessionId: string) =>
    `/api/agent/session/${sessionId}/run`,
}
```

- [ ] **Step 3：commit**

```bash
git add packages/web/src/lib/api.ts packages/web/src/lib/agent-api.ts
git commit -m "feat(web): add agent + target API client"
```

---

## Task 2：useAgentStream hook（SSE 消费 + 流式状态）

**Files:**
- Create: `packages/web/src/lib/use-agent-stream.ts`

- [ ] **Step 1：实现**

`fetch + ReadableStream` 因为 EventSource 不支持 POST。

```typescript
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentEvent } from '@novel-agent/shared'

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 在 assistant 消息生成过程中累计 tool call 摘要 */
  tool_calls?: { name: string; ok: boolean; summary: string }[]
}

interface UseAgentStreamOpts {
  sessionId: string | null
}

export function useAgentStream({ sessionId }: UseAgentStreamOpts) {
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const send = useCallback(
    async (url: string, content: string | null) => {
      if (!sessionId) throw new Error('no active session')
      const ac = new AbortController()
      abortRef.current = ac
      setStreaming(true)

      // 推 user 消息（如果有）
      if (content) {
        const userMsg: AgentMessage = {
          id: `u-${Date.now()}`,
          role: 'user',
          content,
        }
        setMessages((prev) => [...prev, userMsg])
      }
      const assistantId = `a-${Date.now()}`
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', tool_calls: [] }])

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(content ? { content } : {}),
          signal: ac.signal,
        })
        if (!resp.body) throw new Error('no stream body')
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''
          for (const raw of events) {
            const m = raw.match(/^event: (\S+)\ndata: ([\s\S]+)$/)
            if (!m) continue
            const eventName = m[1]!
            let payload: unknown = {}
            try {
              payload = JSON.parse(m[2]!)
            } catch {
              /* skip */
            }
            handleEvent(eventName, payload, assistantId, setMessages)
          }
        }
      } finally {
        setStreaming(false)
        abortRef.current = null
      }
    },
    [sessionId],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  return { messages, streaming, send, stop, setMessages }
}

function handleEvent(
  type: string,
  payload: unknown,
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<AgentMessage[]>>,
): void {
  setMessages((prev) =>
    prev.map((m) => {
      if (m.id !== assistantId) return m
      if (type === 'message.delta') {
        const delta = (payload as { content?: string }).content ?? ''
        return { ...m, content: m.content + delta }
      }
      if (type === 'message.complete') {
        return { ...m, content: (payload as { content?: string }).content ?? m.content }
      }
      if (type === 'tool.call') {
        const p = payload as { name?: string }
        return {
          ...m,
          tool_calls: [
            ...(m.tool_calls ?? []),
            { name: p.name ?? '?', ok: false, summary: '调用中...' },
          ],
        }
      }
      if (type === 'tool.result') {
        const p = payload as { name?: string; result?: { ok?: boolean } }
        const tcs = m.tool_calls ?? []
        const last = tcs[tcs.length - 1]
        if (last && last.name === p.name) {
          last.ok = p.result?.ok !== false
          last.summary = p.result?.ok === false ? '校验失败' : '完成'
        }
        return { ...m, tool_calls: [...tcs] }
      }
      return m
    }),
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/lib/use-agent-stream.ts
git commit -m "feat(web): add useAgentStream hook for SSE consumption"
```

---

## Task 3：AgentChat 组件

**Files:**
- Create: `packages/web/src/components/AgentChat.tsx`

通用 chat 面板：消息列表 + 输入框 + "开始改写本批"按钮。

- [ ] **Step 1：实现**

```typescript
import { useState } from 'react'
import { agentApi } from '../lib/agent-api.js'
import { useAgentStream, type AgentMessage } from '../lib/use-agent-stream.js'
import clsx from 'clsx'

interface Props {
  sessionId: string | null
  onClosed?: () => void
}

export function AgentChat({ sessionId, onClosed }: Props) {
  const { messages, streaming, send } = useAgentStream({ sessionId })
  const [draft, setDraft] = useState('')

  if (!sessionId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-400">
        无活动 agent session
      </div>
    )
  }

  const onSend = async () => {
    if (!draft.trim() || streaming) return
    const content = draft
    setDraft('')
    await send(agentApi.messageUrl(sessionId), content).catch(console.error)
  }

  const onRun = async () => {
    if (streaming) return
    await send(agentApi.runUrl(sessionId), null).catch(console.error)
  }

  const onClose = async () => {
    await agentApi.closeSession(sessionId)
    onClosed?.()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-3 border-b border-neutral-200 text-sm">
        <span className="font-medium">Agent 对话</span>
        <div className="flex gap-2">
          <button
            onClick={onRun}
            disabled={streaming}
            className="px-3 py-1 text-xs rounded bg-amber-500 text-white disabled:opacity-50"
          >
            开始改写本批
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded border border-neutral-300"
          >
            关闭 session
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {streaming && messages.length === 0 && (
          <div className="text-neutral-400">等待 agent 开始...</div>
        )}
      </div>

      <footer className="p-3 border-t border-neutral-200">
        <div className="flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend()
              }
            }}
            placeholder={streaming ? '生成中...' : '输入消息（Enter 发送）'}
            disabled={streaming}
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none disabled:opacity-50"
            rows={2}
          />
          <button
            onClick={onSend}
            disabled={streaming || !draft.trim()}
            className="px-4 py-2 rounded bg-neutral-900 text-white text-sm disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </footer>
    </div>
  )
}

function MessageBubble({ m }: { m: AgentMessage }) {
  return (
    <div
      className={clsx(
        'rounded-lg p-3 max-w-[85%]',
        m.role === 'user'
          ? 'bg-neutral-900 text-white ml-auto'
          : 'bg-neutral-100 text-neutral-900',
      )}
    >
      {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
      {m.tool_calls && m.tool_calls.length > 0 && (
        <div className="mt-2 pt-2 border-t border-current/10 space-y-1">
          {m.tool_calls.map((t, i) => (
            <div
              key={i}
              className={clsx(
                'text-xs flex items-center gap-2',
                t.ok ? 'text-emerald-700' : 'text-rose-700',
              )}
            >
              <span className="font-mono">{t.name}</span>
              <span>—</span>
              <span>{t.summary}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/components/AgentChat.tsx
git commit -m "feat(web): add AgentChat component (chat bubbles + run button)"
```

---

## Task 4：MapsPanel（置换表展示）

**Files:**
- Create: `packages/web/src/components/MapsPanel.tsx`

只读展示——所有修改通过 agent 对话进行（用户跟 agent 说"主角改叫 X"）。

- [ ] **Step 1：实现**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export function MapsPanel({ novelId }: { novelId: string }) {
  const { data: maps } = useQuery({
    queryKey: ['maps', novelId],
    queryFn: () => api.getMaps(novelId),
    refetchInterval: 3_000,  // 简单轮询：agent 改完后能看到
  })

  if (!maps) {
    return (
      <div className="text-sm text-neutral-400 p-4">
        还没有置换表。在右侧对话里让 agent 生成草案（如"生成置换表"）。
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="font-medium mb-3 text-sm text-neutral-700">角色置换</h3>
        <table className="w-full text-sm border border-neutral-200 rounded">
          <thead className="bg-neutral-50">
            <tr>
              <th className="text-left p-2 border-b border-neutral-200">原名</th>
              <th className="text-left p-2 border-b border-neutral-200">新名</th>
              <th className="text-left p-2 border-b border-neutral-200">备注</th>
            </tr>
          </thead>
          <tbody>
            {maps.character_map.map((e) => (
              <tr key={e.source} className="border-b border-neutral-100 last:border-b-0">
                <td className="p-2 font-mono text-xs">{e.source}</td>
                <td className="p-2">{e.target}</td>
                <td className="p-2 text-neutral-500 text-xs">{e.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h3 className="font-medium mb-3 text-sm text-neutral-700">题材置换</h3>
        {maps.setting_map ? (
          <div className="rounded border border-neutral-200 p-3 space-y-2 text-sm">
            <div>
              <span className="text-neutral-500 text-xs mr-2">原行业</span>
              <span>{maps.setting_map.original_industry}</span>
              <span className="text-neutral-400 mx-2">→</span>
              <span>{maps.setting_map.target_industry}</span>
            </div>
            <div>
              <div className="text-neutral-500 text-xs mb-1">关键词替换</div>
              <ul className="text-xs space-y-0.5">
                {Object.entries(maps.setting_map.key_term_replacements).map(([k, v]) => (
                  <li key={k}>
                    <code>{k}</code> → <code>{v}</code>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-sm text-neutral-400">未设置</p>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/components/MapsPanel.tsx
git commit -m "feat(web): add MapsPanel showing character + setting maps"
```

---

## Task 5：OutlinePanel（大纲列表 + 单章查看）

**Files:**
- Create: `packages/web/src/components/OutlinePanel.tsx`

- [ ] **Step 1：实现**

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'

export function OutlinePanel({ novelId }: { novelId: string }) {
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-48 border-r border-neutral-200 overflow-y-auto">
        {!outlines?.length && (
          <p className="text-xs text-neutral-400 p-3">
            还没有大纲。让 agent 跑"开始改写本批"。
          </p>
        )}
        {outlines?.map((o) => (
          <button
            key={o.number}
            onClick={() => setSelected(o.number)}
            className={clsx(
              'w-full text-left px-3 py-2 text-sm border-b border-neutral-100',
              selected === o.number ? 'bg-amber-50 text-amber-900' : 'hover:bg-neutral-50',
            )}
          >
            第 {o.number} 章
          </button>
        ))}
      </aside>

      <section className="flex-1 overflow-y-auto p-4">
        {selected == null && (
          <p className="text-sm text-neutral-400">选一章查看大纲</p>
        )}
        {selected != null && (
          <OutlineDetail novelId={novelId} number={selected} />
        )}
      </section>
    </div>
  )
}

function OutlineDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data: o } = useQuery({
    queryKey: ['outline', novelId, number],
    queryFn: () => api.getOutline(novelId, number),
  })
  if (!o) return <p className="text-sm text-neutral-400">加载中...</p>

  return (
    <article className="space-y-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-medium">第 {o.number} 章大纲</h2>
        <span className="text-xs text-neutral-500">参考原书第 {o.source_chapter_ref} 章</span>
      </header>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">剧情</h3>
        <p className="whitespace-pre-wrap leading-relaxed">{o.plot}</p>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">关键事件</h3>
        <ul className="list-disc list-inside space-y-0.5">
          {o.key_events.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </section>

      <section className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <h4 className="text-neutral-500 mb-1">本章新埋伏笔</h4>
          {o.hooks_to_plant.length === 0 ? (
            <p className="text-neutral-400">—</p>
          ) : (
            <ul>{o.hooks_to_plant.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-500 mb-1">本章兑现伏笔</h4>
          {o.hooks_to_payoff.length === 0 ? (
            <p className="text-neutral-400">—</p>
          ) : (
            <ul>{o.hooks_to_payoff.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
      </section>

      {o.planned_state_changes.character_deaths.length > 0 && (
        <section className="text-xs">
          <h4 className="text-neutral-500 mb-1">本章死亡声明</h4>
          <ul>{o.planned_state_changes.character_deaths.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
    </article>
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/components/OutlinePanel.tsx
git commit -m "feat(web): add OutlinePanel (chapter list + detail view)"
```

---

## Task 6：DraftsPanel（正文列表 + 阅读）

**Files:**
- Create: `packages/web/src/components/DraftsPanel.tsx`

- [ ] **Step 1：实现**

```typescript
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'

export function DraftsPanel({ novelId }: { novelId: string }) {
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-48 border-r border-neutral-200 overflow-y-auto">
        {!drafts?.length && (
          <p className="text-xs text-neutral-400 p-3">
            还没有正文。先生成大纲，再启动 writer agent。
          </p>
        )}
        {drafts?.map((d) => (
          <button
            key={d.number}
            onClick={() => setSelected(d.number)}
            className={clsx(
              'w-full text-left px-3 py-2 text-sm border-b border-neutral-100',
              selected === d.number ? 'bg-amber-50 text-amber-900' : 'hover:bg-neutral-50',
            )}
          >
            <div>第 {d.number} 章</div>
            <div className="text-xs text-neutral-500">{d.word_count} 字</div>
          </button>
        ))}
      </aside>

      <section className="flex-1 overflow-y-auto p-6">
        {selected == null && (
          <p className="text-sm text-neutral-400">选一章阅读</p>
        )}
        {selected != null && (
          <DraftDetail novelId={novelId} number={selected} />
        )}
      </section>
    </div>
  )
}

function DraftDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data: d } = useQuery({
    queryKey: ['draft', novelId, number],
    queryFn: () => api.getDraft(novelId, number),
  })
  if (!d) return <p className="text-sm text-neutral-400">加载中...</p>

  return (
    <article className="prose prose-neutral max-w-none">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold mb-1">{d.title}</h1>
        <div className="text-xs text-neutral-500">
          第 {d.number} 章 · {d.word_count} 字 · {new Date(d.written_at).toLocaleString('zh-CN')}
        </div>
      </header>
      <div className="whitespace-pre-wrap leading-loose text-base">{d.content}</div>
    </article>
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/components/DraftsPanel.tsx
git commit -m "feat(web): add DraftsPanel (chapter list + reader view)"
```

---

## Task 7：StatePanel（侧边栏：alive/dead + open hooks）

**Files:**
- Create: `packages/web/src/components/StatePanel.tsx`

显示当前 state.md 内容，让用户知道改写进度（哪些角色活/死、哪些伏笔已收）。

- [ ] **Step 1：实现**

```typescript
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export function StatePanel({ novelId }: { novelId: string }) {
  const { data: state } = useQuery({
    queryKey: ['state', novelId],
    queryFn: () => api.getState(novelId),
    refetchInterval: 3_000,
  })

  if (!state) {
    return <p className="text-xs text-neutral-400 p-3">state 未初始化（先 updateMaps）</p>
  }

  const aliveEntries = Object.entries(state.alive_status)
  const dead = aliveEntries.filter(([, s]) => !s.alive)
  const alive = aliveEntries.filter(([, s]) => s.alive)
  const openHooks = Object.entries(state.hooks).filter(([, h]) => h.status === 'open')
  const paidHooks = Object.entries(state.hooks).filter(([, h]) => h.status === 'paid_off')

  return (
    <div className="space-y-4 text-xs p-3">
      <section>
        <h4 className="text-neutral-500 mb-1">角色状态</h4>
        <div className="text-emerald-700">活 {alive.length}</div>
        <div className="text-rose-700">死 {dead.length}{dead.length > 0 && `：${dead.map(([n]) => n).join(' / ')}`}</div>
      </section>
      <section>
        <h4 className="text-neutral-500 mb-1">长线伏笔</h4>
        <div>open {openHooks.length}</div>
        <div>paid {paidHooks.length}</div>
      </section>
      {state.new_hooks.length > 0 && (
        <section>
          <h4 className="text-neutral-500 mb-1">新埋伏笔（{state.new_hooks.length}）</h4>
          <ul className="font-mono">
            {state.new_hooks.map((h) => (
              <li key={h.id} className={h.status === 'open' ? '' : 'text-emerald-700'}>
                {h.id} · 第 {h.planted_chapter} 章 · {h.status}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/components/StatePanel.tsx
git commit -m "feat(web): add StatePanel for alive/dead + hook status"
```

---

## Task 8：RewritePage（容器：tabs + agent 对话）

**Files:**
- Create: `packages/web/src/pages/RewritePage.tsx`

- [ ] **Step 1：实现**

```typescript
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
        {/* 左：tabs */}
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

        {/* 右：state + agent chat */}
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
```

- [ ] **Step 2：commit**

```bash
git add packages/web/src/pages/RewritePage.tsx
git commit -m "feat(web): add RewritePage with tabs + state + agent chat layout"
```

---

## Task 9：路由 + 入口按钮

**Files:**
- Modify: `packages/web/src/main.tsx`（或 `App.tsx` 看路由声明位置）
- Modify: `packages/web/src/pages/NovelDetailPage.tsx`

- [ ] **Step 1：grep 找当前路由**

```bash
grep -rn "createBrowserRouter\|BrowserRouter\|Route" packages/web/src/
```

- [ ] **Step 2：加 `/novel/:id/rewrite` 路由指向 `RewritePage`**

具体改法看现有代码。例：
```typescript
import { RewritePage } from './pages/RewritePage'
// ... 路由表加：
{ path: '/novel/:id/rewrite', element: <RewritePage /> }
```

- [ ] **Step 3：在 NovelDetailPage 加"去改写"按钮**

详情页 header 区域加：
```tsx
<Link
  to={`/novel/${id}/rewrite`}
  className="px-3 py-1 text-xs rounded bg-amber-500 text-white"
>
  去改写 →
</Link>
```

按钮只在 `novel.status === 'ready'` 时可点（小说已分析完才能改写）。

- [ ] **Step 4：typecheck + commit**

```bash
pnpm typecheck
git add packages/web/src
git commit -m "feat(web): wire /novel/:id/rewrite route and entry button"
```

---

## Task 10：Plan 2 后端补 GET 端点（如果遗漏）

**Files:**
- Modify: `packages/agent-server/src/routes/novel.ts`

如果 Plan 2 没补 `GET /api/novel/:id/{maps,outlines,drafts,state}`，本 task 补上。

- [ ] **Step 1：grep 检查**

```bash
grep -n "/maps\|/outlines\|/drafts\|/state" packages/agent-server/src/routes/novel.ts
```

如全无匹配，加：

```typescript
import { readMaps, listOutlines, readOutline, listChapterDrafts, readChapterDraft } from '../storage/target-reader.js'
import { readState } from '../storage/state.js'

app.get('/:id/maps', async (c) => c.json(await readMaps(c.req.param('id'))))
app.get('/:id/state', async (c) => c.json(await readState(c.req.param('id'))))
app.get('/:id/outlines', async (c) => c.json(await listOutlines(c.req.param('id'))))
app.get('/:id/outlines/:n', async (c) => {
  const o = await readOutline(c.req.param('id'), Number(c.req.param('n')))
  return o ? c.json(o) : c.json({ error: 'not_found' }, 404)
})
app.get('/:id/drafts', async (c) => {
  const list = await listChapterDrafts(c.req.param('id'))
  return c.json(list.map(({ content: _content, ...rest }) => rest))  // list 不返回正文
})
app.get('/:id/drafts/:n', async (c) => {
  const d = await readChapterDraft(c.req.param('id'), Number(c.req.param('n')))
  return d ? c.json(d) : c.json({ error: 'not_found' }, 404)
})
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/routes/novel.ts
git commit -m "feat(server): add GET endpoints for maps/outlines/drafts/state"
```

---

## Task 11：手动 smoke test（用户）

不派 subagent。

- [ ] 用 Plan 1 + Plan 2 跑通的 novel-id
- [ ] `pnpm dev`
- [ ] 浏览器：
  1. 详情页点 "去改写" → 跳到 RewritePage
  2. 设置 batch 为 1-5（小测）
  3. 点 "启动大纲 agent" → 右下出现对话框
  4. 点 "开始改写本批" → agent 开始干活，对话流陆续显示 tool call
  5. 切到 "置换表" tab → 应该看到 character_map（agent 生成的）
  6. 切到 "大纲" tab → 第 1-5 章大纲陆续出现
  7. 输入 "把主角名字改成 X" → agent 回应并 updateMaps
  8. 启动 writer agent → 切 "正文" tab 看章节出现
  9. 状态侧边栏：alive 数 / open hooks 数应随写章变化
- [ ] 任何崩点贴控制台错误 + 网络面板 SSE 流

---

## Task 12：CLAUDE.md 更新（仓库结构 + UI 路径）

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1：加新页面到仓库速查**

加：
```
| `packages/web/src/pages/RewritePage.tsx` | 改写主页（置换表 / 大纲 / 正文 tabs + 右侧 agent 对话） |
| `packages/web/src/components/AgentChat.tsx` | Agent 对话面板（消息气泡 + 触发改写按钮） |
| `packages/web/src/lib/use-agent-stream.ts` | SSE 消费 hook |
```

- [ ] **Step 2：加"不要做的事"**

```
- ❌ 直接 fetch 后端 API 不走 React Query — UI 多处需要轮询同步 agent 写入；统一走 useQuery + refetchInterval
- ❌ 给 useAgentStream 加额外 buffer 逻辑 — SSE event 已经按 \n\n 切；逻辑简单不要叠层
```

- [ ] **Step 3：commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for rewrite UI"
```

---

## Self-Review

**Spec coverage：**

| spec 点 | 实现 task |
|---|---|
| 用户改大纲走和 agent 同一个 writeChapterOutline | T3 (AgentChat) + Plan 2 工具支持 |
| 置换表展示 | T4 |
| 大纲展示 + 单章查看 | T5 |
| 正文阅读 | T6 |
| state（alive/dead/hooks）侧边栏 | T7 |
| 改写页布局 | T8 |
| 路由 + 入口 | T9 |
| 后端 GET 端点 | T10 |
| 验证流程 | T11 |

**未在 Plan 3 覆盖：**
- 用户在 UI 里**手动编辑**置换表（spec 决定走 agent 对话改，不直接编辑）
- 单条 outline / chapter 重写按钮（V2 加；V1 用户用对话表达"重写第 X 章"即可）
- 多 batch 的 batch 历史侧边栏（V2 加）
- 富文本编辑器（V1 仅阅读 / 通过 agent 改）

**已知 trade-off：**
- 用 polling refetch 而非 SSE 同步置换表 / 大纲 / 正文（agent 写入侧→UI 拉取侧）。3 秒一次延迟可接受。
- AgentChat 没做消息持久化——刷新页面对话历史会丢（agent session 在后端内存里也丢）。V2 加 chat history 持久化
- `useAgentStream` 没处理网络断流自动重连——刷新即可

**Placeholder 扫描：** 无 TBD。每个 task 含完整代码 / 路径 / 命令。

**类型一致性：** `MapsRecord` / `OutlineRecord` / `ChapterDraftRecord` / `StateRecord` 全部从 Plan 2 后端 storage 模块导出共享，前端 fetch 后假设服务端按这个 shape 返回。如果 Plan 2 实施时实际 shape 有差异，T1 实施时把前端类型对齐。
