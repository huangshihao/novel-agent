# Outline / Writer 改写 agent 交互优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add writer-depends-on-outline gating, requirement-at-start UX, per-chapter revise affordance, and per-chapter writer worker sessions to avoid context explosion on large batches.

**Architecture:** Single active task per novel (session OR batch job). Outline batch keeps a long session for chat continuation. Writer batch fans out to N short worker sessions with progress UI (no chat). Per-chapter revise = short long-lived chat session for one chapter. Each new operation auto-disposes the previous session.

**Tech Stack:** Hono + pi-coding-agent on backend (vitest tests). React + react-query + Tailwind + SSE on frontend (no UI tests in this codebase).

---

## File Structure

### Backend (`packages/agent-server/src/`)

| File | Status | Purpose |
|---|---|---|
| `agents/registry.ts` | rewrite | Single active task (session OR batch job) per novel |
| `agents/batch-job.ts` | new | BatchJob class + runBatchJob loop + retry/skip helpers |
| `agents/outline-session.ts` | modify | Accept mode/scope/requirement; pass to system prompt |
| `agents/writer-session.ts` | modify | Take single chapter + mode + requirement |
| `agents/system-prompts.ts` | rewrite | Mode-branched outline/writer prompts |
| `routes/agent.ts` | rewrite | New endpoints: /active, /revise, /job/* ; remove /sessions, /run |
| `storage/target-reader.ts` | modify | Add `outlineExists` helper |

### Shared (`packages/shared/src/`)

| File | Status | Purpose |
|---|---|---|
| `types.ts` | modify | Extend AgentSessionInfo (mode/scope), add BatchJobInfo, ActiveTask, batch events |

### Frontend (`packages/web/src/`)

| File | Status | Purpose |
|---|---|---|
| `lib/agent-api.ts` | rewrite | New endpoints client |
| `lib/use-agent-stream.ts` | modify | Keep as-is for chat session SSE consumption |
| `lib/use-batch-stream.ts` | new | Hook for /job/:jid/stream consumption |
| `lib/use-active-task.ts` | new | Hook polling /active |
| `components/GenerateForm.tsx` | new | from-to + requirement + start button (per role) |
| `components/ReviseButton.tsx` | new | Inline "改" button per chapter row |
| `components/BatchJobPanel.tsx` | new | Progress + worker stream + abort/retry/skip |
| `components/AgentChat.tsx` | modify | Add 结束 session + mode badge; remove 开始改写本批 button |
| `components/OutlinePanel.tsx` | modify | Embed GenerateForm + ReviseButton per row |
| `components/DraftsPanel.tsx` | modify | Same + status badge |
| `pages/RewritePage.tsx` | rewrite | Active-task-aware layout |

---

## Phase 1: Shared types

### Task 1: Update shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Update `AgentSessionInfo` and add new types**

Replace the `AgentSessionInfo` block (current file lines 105-110) and append new types after it. Final shape:

```ts
export type AgentRole = 'outline' | 'writer'
export type AgentMode = 'generate' | 'revise'

export interface AgentSessionInfo {
  id: string
  novel_id: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  created_at: number
}

export type BatchJobStatus = 'running' | 'paused' | 'done' | 'aborted'

export interface BatchJobInfo {
  id: string
  novel_id: string
  requirement: string
  chapters: number[]
  cursor: number
  completed: number[]
  failed: number[]
  current: number | null
  status: BatchJobStatus
  error?: string
  created_at: number
}

export type ActiveTask =
  | { kind: 'session'; session: AgentSessionInfo }
  | { kind: 'batch'; batch: BatchJobInfo }
```

- [ ] **Step 2: Extend `AgentEvent` with batch events**

Replace the `AgentEvent` block (current file lines 112-118) with:

```ts
export type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; name: string; params: unknown }
  | { type: 'tool.result'; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'batch.progress'; completed: number; total: number; current: number | null }
  | { type: 'batch.worker_start'; chapter: number }
  | { type: 'batch.worker_end'; chapter: number; ok: boolean; error?: string }
  | { type: 'batch.done' }
  | { type: 'batch.aborted' }
  | { type: 'batch.paused'; chapter: number; error: string }
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm -w typecheck`
Expected: PASS (downstream usages will fail in later tasks; we'll fix them as we go. But shared package alone should pass.)

If typecheck fails *only* in agent-server / web due to old shape — that's expected. Proceed.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "shared: add AgentMode/BatchJob/ActiveTask types and batch events"
```

---

## Phase 2: Backend session & batch infra

### Task 2: Refactor session registry to single-active-per-novel

**Files:**
- Rewrite: `packages/agent-server/src/agents/registry.ts`
- Test: `packages/agent-server/src/agents/registry.test.ts` (new)

Note: registry currently allows N sessions per novel. New rule: at most ONE active task per novel — either a session OR a batch job. We provide getters/setters that enforce this.

- [ ] **Step 1: Write failing tests**

Create `packages/agent-server/src/agents/registry.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  setActiveSession,
  setActiveBatch,
  getActiveTask,
  clearActiveTask,
  getSessionEntry,
  getBatchEntry,
  __clearAll,
} from './registry.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

const fakeSession = { dispose() {} } as unknown as AgentSession
const fakeBatch = { dispose() {} } as { dispose(): void }

beforeEach(() => __clearAll())

describe('registry single-active', () => {
  it('sets and gets active session', () => {
    const id = setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    const active = getActiveTask('n1')
    expect(active?.kind).toBe('session')
    expect(active?.kind === 'session' && active.entry.role).toBe('outline')
    expect(getSessionEntry(id)?.novelId).toBe('n1')
  })

  it('rejects new active when one exists', () => {
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    expect(() =>
      setActiveSession({
        novelId: 'n1',
        role: 'writer',
        mode: 'generate',
        scope: { from: 1, to: 1 },
        session: fakeSession,
      }),
    ).toThrow(/already_active/)
    expect(() =>
      setActiveBatch({ novelId: 'n1', batchId: 'b1', batch: fakeBatch }),
    ).toThrow(/already_active/)
  })

  it('different novels are independent', () => {
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    setActiveSession({
      novelId: 'n2',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session: fakeSession,
    })
    expect(getActiveTask('n1')).toBeTruthy()
    expect(getActiveTask('n2')).toBeTruthy()
  })

  it('clearActiveTask disposes session', () => {
    let disposed = false
    const session = { dispose() { disposed = true } } as unknown as AgentSession
    setActiveSession({
      novelId: 'n1',
      role: 'outline',
      mode: 'generate',
      scope: { from: 1, to: 10 },
      session,
    })
    clearActiveTask('n1')
    expect(disposed).toBe(true)
    expect(getActiveTask('n1')).toBeNull()
  })

  it('clearActiveTask disposes batch', () => {
    let disposed = false
    const batch = { dispose() { disposed = true } }
    setActiveBatch({ novelId: 'n2', batchId: 'b1', batch })
    clearActiveTask('n2')
    expect(disposed).toBe(true)
    expect(getActiveTask('n2')).toBeNull()
    expect(getBatchEntry('b1')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @novel-agent/agent-server test registry`
Expected: FAIL (registry doesn't have these exports yet)

- [ ] **Step 3: Rewrite registry.ts**

Replace `packages/agent-server/src/agents/registry.ts` entirely with:

```ts
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { AgentRole, AgentMode } from '@novel-agent/shared'

export interface SessionEntry {
  id: string
  novelId: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  session: AgentSession
  createdAt: number
}

interface BatchOwner {
  dispose(): void
}

export interface BatchEntry {
  id: string
  novelId: string
  batch: BatchOwner
  createdAt: number
}

type Active =
  | { kind: 'session'; entry: SessionEntry }
  | { kind: 'batch'; entry: BatchEntry }
  | null

const activeByNovel = new Map<string, Exclude<Active, null>>()
const sessionsById = new Map<string, SessionEntry>()
const batchesById = new Map<string, BatchEntry>()

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface SetActiveSessionInput {
  novelId: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  session: AgentSession
}

export function setActiveSession(input: SetActiveSessionInput): string {
  if (activeByNovel.has(input.novelId)) {
    throw new Error('already_active')
  }
  const id = genId('sess')
  const entry: SessionEntry = {
    id,
    novelId: input.novelId,
    role: input.role,
    mode: input.mode,
    scope: input.scope,
    session: input.session,
    createdAt: Date.now(),
  }
  activeByNovel.set(input.novelId, { kind: 'session', entry })
  sessionsById.set(id, entry)
  return id
}

export interface SetActiveBatchInput {
  novelId: string
  batchId?: string
  batch: BatchOwner
}

export function setActiveBatch(input: SetActiveBatchInput): string {
  if (activeByNovel.has(input.novelId)) {
    throw new Error('already_active')
  }
  const id = input.batchId ?? genId('batch')
  const entry: BatchEntry = {
    id,
    novelId: input.novelId,
    batch: input.batch,
    createdAt: Date.now(),
  }
  activeByNovel.set(input.novelId, { kind: 'batch', entry })
  batchesById.set(id, entry)
  return id
}

export function getActiveTask(novelId: string): Active {
  return activeByNovel.get(novelId) ?? null
}

export function getSessionEntry(sessionId: string): SessionEntry | undefined {
  return sessionsById.get(sessionId)
}

export function getBatchEntry(batchId: string): BatchEntry | undefined {
  return batchesById.get(batchId)
}

export function clearActiveTask(novelId: string): void {
  const a = activeByNovel.get(novelId)
  if (!a) return
  try {
    if (a.kind === 'session') a.entry.session.dispose()
    else a.entry.batch.dispose()
  } catch {
    /* ignore */
  }
  activeByNovel.delete(novelId)
  if (a.kind === 'session') sessionsById.delete(a.entry.id)
  else batchesById.delete(a.entry.id)
}

// test-only
export function __clearAll(): void {
  activeByNovel.clear()
  sessionsById.clear()
  batchesById.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @novel-agent/agent-server test registry`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-server/src/agents/registry.ts packages/agent-server/src/agents/registry.test.ts
git commit -m "agent-server: registry enforces single active task per novel"
```

---

### Task 3: Add BatchJob with event buffer

**Files:**
- Create: `packages/agent-server/src/agents/batch-job.ts`
- Test: `packages/agent-server/src/agents/batch-job.test.ts`

The BatchJob is a pub/sub primitive with event buffering. The actual worker loop calls `createWriterAgent` per chapter — for unit tests we inject a fake worker factory.

- [ ] **Step 1: Write failing tests**

Create `packages/agent-server/src/agents/batch-job.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createBatchJob, runBatchJob, type BatchJob, type WorkerFactory } from './batch-job.js'
import type { AgentEvent } from '@novel-agent/shared'

function fakeFactory(opts: {
  failOn?: number[]
  delayMs?: number
}): WorkerFactory {
  return async ({ chapter }) => {
    if (opts.failOn?.includes(chapter)) {
      throw new Error(`fake fail on ${chapter}`)
    }
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
    return { dispose() {} }
  }
}

describe('BatchJob', () => {
  it('runs all chapters when no failures', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: 'X',
      chapters: [1, 2, 3],
    })
    const events: AgentEvent[] = []
    job.subscribe((e) => events.push(e))

    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 2, 3])
    expect(job.failed).toEqual([])
    expect(events.some((e) => e.type === 'batch.done')).toBe(true)
  })

  it('pauses on worker error and exposes which chapter', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    expect(job.cursor).toBe(1)
    expect(job.completed).toEqual([1])
    expect(job.error).toMatch(/fake fail/)
  })

  it('retry resumes from same cursor', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    job.error = undefined
    job.status = 'running'
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 2, 3])
  })

  it('skip advances cursor and records failed', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    await runBatchJob(job, fakeFactory({ failOn: [2] }))
    expect(job.status).toBe('paused')
    // simulate skip
    job.failed.push(job.chapters[job.cursor]!)
    job.cursor += 1
    job.error = undefined
    job.status = 'running'
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('done')
    expect(job.completed).toEqual([1, 3])
    expect(job.failed).toEqual([2])
  })

  it('abort stops loop', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1, 2, 3],
    })
    job.subscribe((e) => {
      if (e.type === 'batch.worker_end' && e.chapter === 1) {
        job.status = 'aborted'
      }
    })
    await runBatchJob(job, fakeFactory({}))
    expect(job.status).toBe('aborted')
    expect(job.completed).toEqual([1])
  })

  it('subscribe replays buffered events to late subscriber', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: '',
      chapters: [1],
    })
    await runBatchJob(job, fakeFactory({}))
    const replay: AgentEvent[] = []
    job.subscribe((e) => replay.push(e))
    expect(replay.some((e) => e.type === 'batch.done')).toBe(true)
    expect(replay.some((e) => e.type === 'batch.worker_start' && e.chapter === 1)).toBe(true)
  })

  it('toInfo returns serializable snapshot', async () => {
    const job = createBatchJob({
      novelId: 'n1',
      requirement: 'X',
      chapters: [1, 2],
    })
    await runBatchJob(job, fakeFactory({}))
    const info = job.toInfo()
    expect(info.id).toBe(job.id)
    expect(info.novel_id).toBe('n1')
    expect(info.status).toBe('done')
    expect(info.completed).toEqual([1, 2])
    expect(info.requirement).toBe('X')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @novel-agent/agent-server test batch-job`
Expected: FAIL (file doesn't exist)

- [ ] **Step 3: Create batch-job.ts**

Create `packages/agent-server/src/agents/batch-job.ts`:

```ts
import type { AgentEvent, BatchJobInfo, BatchJobStatus } from '@novel-agent/shared'

export interface WorkerHandle {
  dispose(): void
}

export interface WorkerFactoryArgs {
  novelId: string
  chapter: number
  requirement: string
  emit: (event: AgentEvent) => void
}

export type WorkerFactory = (args: WorkerFactoryArgs) => Promise<WorkerHandle>

export interface CreateBatchJobInput {
  novelId: string
  requirement: string
  chapters: number[]
}

export interface BatchJob {
  id: string
  novelId: string
  requirement: string
  chapters: number[]
  cursor: number
  completed: number[]
  failed: number[]
  current: number | null
  status: BatchJobStatus
  error?: string
  createdAt: number
  emit(event: AgentEvent): void
  subscribe(listener: (event: AgentEvent) => void): () => void
  toInfo(): BatchJobInfo
  dispose(): void
}

function genId(): string {
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function createBatchJob(input: CreateBatchJobInput): BatchJob {
  const buffer: AgentEvent[] = []
  const listeners = new Set<(event: AgentEvent) => void>()
  const job: BatchJob = {
    id: genId(),
    novelId: input.novelId,
    requirement: input.requirement,
    chapters: [...input.chapters],
    cursor: 0,
    completed: [],
    failed: [],
    current: null,
    status: 'running',
    createdAt: Date.now(),
    emit(event) {
      buffer.push(event)
      for (const fn of listeners) {
        try { fn(event) } catch { /* ignore */ }
      }
    },
    subscribe(listener) {
      for (const e of buffer) {
        try { listener(e) } catch { /* ignore */ }
      }
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    toInfo() {
      return {
        id: job.id,
        novel_id: job.novelId,
        requirement: job.requirement,
        chapters: job.chapters,
        cursor: job.cursor,
        completed: job.completed,
        failed: job.failed,
        current: job.current,
        status: job.status,
        error: job.error,
        created_at: job.createdAt,
      }
    },
    dispose() {
      // emit aborted only if not already terminal
      if (job.status === 'running' || job.status === 'paused') {
        job.status = 'aborted'
        job.emit({ type: 'batch.aborted' })
      }
      listeners.clear()
    },
  }
  return job
}

export async function runBatchJob(
  job: BatchJob,
  factory: WorkerFactory,
): Promise<void> {
  while (job.cursor < job.chapters.length) {
    if (job.status === 'aborted') break
    if (job.status === 'paused') return
    const n = job.chapters[job.cursor]!
    job.current = n
    job.emit({ type: 'batch.worker_start', chapter: n })
    try {
      const handle = await factory({
        novelId: job.novelId,
        chapter: n,
        requirement: job.requirement,
        emit: job.emit,
      })
      try {
        // factory is responsible for sending message + waiting for agent_end + emitting forwarded events
        // by the time we reach here, the worker turn is complete
      } finally {
        try { handle.dispose() } catch { /* ignore */ }
      }
      job.completed.push(n)
      job.cursor += 1
      job.emit({ type: 'batch.worker_end', chapter: n, ok: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      job.error = msg
      job.status = 'paused'
      job.emit({ type: 'batch.worker_end', chapter: n, ok: false, error: msg })
      job.emit({ type: 'batch.paused', chapter: n, error: msg })
      job.current = null
      return
    }
    job.emit({
      type: 'batch.progress',
      completed: job.completed.length,
      total: job.chapters.length,
      current: job.current,
    })
  }
  if (job.status === 'running') {
    job.status = 'done'
    job.current = null
    job.emit({ type: 'batch.done' })
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @novel-agent/agent-server test batch-job`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/agent-server/src/agents/batch-job.ts packages/agent-server/src/agents/batch-job.test.ts
git commit -m "agent-server: add BatchJob with event buffer + retry/skip/abort semantics"
```

---

### Task 4: Add `outlineExists` storage helper

**Files:**
- Modify: `packages/agent-server/src/storage/target-reader.ts`
- Test: `packages/agent-server/src/storage/target-reader.test.ts` (existing — extend)

- [ ] **Step 1: Read existing test file structure**

Read `packages/agent-server/src/storage/target-reader.test.ts` to see the existing test setup style. Use the same harness (tmp dir + writeOutline) for the new test.

- [ ] **Step 2: Add failing test**

Append to `packages/agent-server/src/storage/target-reader.test.ts` (inside the existing top-level describe or add a new one):

```ts
import { outlineExists, missingOutlines } from './target-reader.js'

describe('outlineExists / missingOutlines', () => {
  it('returns true when outline file exists', async () => {
    const novelId = 'oe-test'
    // setup: create outline 1 + 3
    await writeOutline(novelId, sampleOutline(1))
    await writeOutline(novelId, sampleOutline(3))
    expect(await outlineExists(novelId, 1)).toBe(true)
    expect(await outlineExists(novelId, 2)).toBe(false)
    expect(await outlineExists(novelId, 3)).toBe(true)
  })

  it('missingOutlines returns empty when range fully covered', async () => {
    const novelId = 'mo-1'
    for (const n of [1, 2, 3, 4, 5]) await writeOutline(novelId, sampleOutline(n))
    expect(await missingOutlines(novelId, 1, 5)).toEqual([])
  })

  it('missingOutlines lists gaps', async () => {
    const novelId = 'mo-2'
    await writeOutline(novelId, sampleOutline(1))
    await writeOutline(novelId, sampleOutline(3))
    expect(await missingOutlines(novelId, 1, 5)).toEqual([2, 4, 5])
  })
})

function sampleOutline(n: number) {
  return {
    number: n,
    source_chapter_ref: n,
    plot: 'p',
    key_events: ['e'],
    hooks_to_plant: [],
    hooks_to_payoff: [],
    planned_state_changes: { character_deaths: [], new_settings: [] },
  }
}
```

If the existing test file already imports `writeOutline` and uses a temp dir, reuse that pattern verbatim (check `paths.ts` or test setup helpers). If not, mirror the setup from `target-writer.test.ts`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @novel-agent/agent-server test target-reader`
Expected: FAIL (functions don't exist)

- [ ] **Step 4: Implement helpers in target-reader.ts**

Append to `packages/agent-server/src/storage/target-reader.ts`:

```ts
import { existsSync } from 'node:fs'

export async function outlineExists(novelId: string, n: number): Promise<boolean> {
  return existsSync(paths.targetOutline(novelId, n))
}

export async function missingOutlines(
  novelId: string,
  from: number,
  to: number,
): Promise<number[]> {
  const out: number[] = []
  for (let n = from; n <= to; n++) {
    if (!(await outlineExists(novelId, n))) out.push(n)
  }
  return out
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @novel-agent/agent-server test target-reader`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/agent-server/src/storage/target-reader.ts packages/agent-server/src/storage/target-reader.test.ts
git commit -m "agent-server: add outlineExists/missingOutlines helpers for writer dependency check"
```

---

### Task 5: Update outline-session factory

**Files:**
- Modify: `packages/agent-server/src/agents/outline-session.ts`
- Modify: `packages/agent-server/src/agents/system-prompts.ts` (signature change only — full rewrite in Task 7)
- Modify: `packages/agent-server/src/agents/tools/index.ts` (no signature change but verify)

- [ ] **Step 1: Read current outline-session.ts**

Make sure you understand the existing shape. The `BatchRange` type from `tools/write-chapter-outline.ts` represents the scope.

- [ ] **Step 2: Rewrite outline-session.ts**

Replace the file content:

```ts
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  DefaultResourceLoader,
  readTool,
  grepTool,
  lsTool,
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { AgentMode } from '@novel-agent/shared'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildOutlineAgentTools } from './tools/index.js'
import { outlineAgentSystemPrompt } from './system-prompts.js'

export interface OutlineAgentInit {
  novelId: string
  scope: { from: number; to: number }
  mode: AgentMode
  requirement?: string  // generate mode
  reviseChapter?: number  // revise mode
  feedback?: string  // revise mode
}

export async function createOutlineAgent(init: OutlineAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: outlineAgentSystemPrompt({
      novelId: init.novelId,
      scope: init.scope,
      mode: init.mode,
      requirement: init.requirement,
      reviseChapter: init.reviseChapter,
      feedback: init.feedback,
    }),
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildOutlineAgentTools(init.novelId, init.scope),
    sessionManager: SessionManager.inMemory(process.cwd()),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
```

- [ ] **Step 3: Update system-prompts.ts signature stub**

Open `packages/agent-server/src/agents/system-prompts.ts` and replace the `outlineAgentSystemPrompt` signature with:

```ts
export interface OutlineSystemPromptInput {
  novelId: string
  scope: { from: number; to: number }
  mode: 'generate' | 'revise'
  requirement?: string
  reviseChapter?: number
  feedback?: string
}

export function outlineAgentSystemPrompt(input: OutlineSystemPromptInput): string {
  // FULL CONTENT IN TASK 7 — temporary stub for compile
  return `placeholder for ${input.novelId} ${input.mode}`
}
```

(We rewrite the body in Task 7. Keeping a stub now lets TypeScript compile.)

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: routes/agent.ts will fail because it still uses old API (next tasks fix). Other files: PASS.

If errors are limited to `routes/agent.ts`: proceed. Otherwise fix wider issues now.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-server/src/agents/outline-session.ts packages/agent-server/src/agents/system-prompts.ts
git commit -m "agent-server: outline session factory accepts mode/scope/requirement/feedback"
```

---

### Task 6: Update writer-session factory (single chapter)

**Files:**
- Modify: `packages/agent-server/src/agents/writer-session.ts`
- Modify: `packages/agent-server/src/agents/system-prompts.ts` (signature stub for writer too)

- [ ] **Step 1: Rewrite writer-session.ts**

```ts
import {
  createAgentSession,
  SessionManager,
  AuthStorage,
  DefaultResourceLoader,
  readTool,
  grepTool,
  lsTool,
} from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { AgentMode } from '@novel-agent/shared'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildWriterAgentTools } from './tools/index.js'
import { writerAgentSystemPrompt } from './system-prompts.js'

export interface WriterAgentInit {
  novelId: string
  chapterNumber: number
  mode: AgentMode
  requirement?: string  // generate mode (per-batch global)
  feedback?: string  // revise mode
}

export async function createWriterAgent(init: WriterAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: writerAgentSystemPrompt({
      novelId: init.novelId,
      chapterNumber: init.chapterNumber,
      mode: init.mode,
      requirement: init.requirement,
      feedback: init.feedback,
    }),
  })
  await resourceLoader.reload()
  // Tool scope is single-chapter [n,n] so writeChapter validates correctly
  const scope = { from: init.chapterNumber, to: init.chapterNumber }
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildWriterAgentTools(init.novelId, scope),
    sessionManager: SessionManager.inMemory(process.cwd()),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
```

- [ ] **Step 2: Add writer prompt signature stub to system-prompts.ts**

Replace the `writerAgentSystemPrompt` definition in `packages/agent-server/src/agents/system-prompts.ts` with:

```ts
export interface WriterSystemPromptInput {
  novelId: string
  chapterNumber: number
  mode: 'generate' | 'revise'
  requirement?: string
  feedback?: string
}

export function writerAgentSystemPrompt(input: WriterSystemPromptInput): string {
  // FULL CONTENT IN TASK 7 — stub
  return `placeholder writer ${input.novelId} ${input.chapterNumber} ${input.mode}`
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: routes/agent.ts still failing (next tasks fix). Other files: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-server/src/agents/writer-session.ts packages/agent-server/src/agents/system-prompts.ts
git commit -m "agent-server: writer session factory takes single chapter + mode"
```

---

## Phase 3: System prompts (full rewrite)

### Task 7: Rewrite outline + writer system prompts

**Files:**
- Modify: `packages/agent-server/src/agents/system-prompts.ts`

- [ ] **Step 1: Rewrite the entire file**

Replace `packages/agent-server/src/agents/system-prompts.ts` entirely:

```ts
export interface OutlineSystemPromptInput {
  novelId: string
  scope: { from: number; to: number }
  mode: 'generate' | 'revise'
  requirement?: string
  reviseChapter?: number
  feedback?: string
}

export function outlineAgentSystemPrompt(input: OutlineSystemPromptInput): string {
  const { novelId, scope, mode } = input
  const generateBlock = `
═══ generate 模式 ═══

本批范围：第 ${scope.from} - ${scope.to} 章。每个 writeChapterOutline 的 number 必须在此范围内。

用户对本批整体需求（请贯穿生成时遵循）：
${input.requirement?.trim() ? input.requirement : '（用户未提供具体需求，按默认工作流处理）'}

工作流：
1. 第一次进入：read source/meta.md / source/characters/（看主要角色）
2. read target/maps.md（不存在或字段缺失则 updateMaps 生成草案）
   - character_entries：所有 source/characters 里 role !== 'tool' 的角色都要给一个 target 名
   - setting：original_industry 抄自 source/meta，target_industry 你决定
3. ls target/outlines/ 看本批已写过哪些章
4. 对未写的每个 number ∈ [${scope.from}..${scope.to}]：
   - read source/chapters/<n>.md 看原书该章
   - 决定 plot（已应用置换表的中文段落）+ key_events
   - 决定 hooks_to_plant / hooks_to_payoff（id 引用 source/hooks.md 或新埋 nhk-NNN）
   - 决定 planned_state_changes（character_deaths / new_settings）
   - 调 writeChapterOutline 写入

═══ generate 跑完后的 chat 改章（可选） ═══

如果用户后续说"第 N 章 X 处改成 Y"（N 必须在 [${scope.from}..${scope.to}] 内）：
1. read 现有 target/outlines/<N>.md
2. 仅按用户意见调整对应字段，**保持未涉及的字段字面相同**
3. writeChapterOutline upsert
4. 简洁回复改了什么
`.trim()

  const reviseBlock = `
═══ revise 模式 ═══

仅处理第 ${input.reviseChapter ?? scope.from} 章。scope 严格 = [${scope.from}..${scope.to}]，不要触碰其他章。

用户修改意见：
${input.feedback?.trim() ? input.feedback : '（用户未给出意见，问用户后再操作）'}

工作流：
1. read target/outlines/${String(input.reviseChapter ?? scope.from).padStart(4, '0')}.md 拿现有版本
2. read source/chapters/${String(input.reviseChapter ?? scope.from).padStart(4, '0')}.md 对照原书
3. 仅按用户意见调整对应字段，**保持未涉及的字段字面相同**
4. writeChapterOutline upsert
5. 简洁回复改了什么
`.trim()

  return `你是中文网文改写大纲 agent。基于参考小说的分析数据生成 / 修订新书章级大纲。

═══ 数据布局 ═══

- 参考小说：data/${novelId}/source/**.md（只读）
  - source/meta.md / source/characters/*.md / source/subplots.md / source/hooks.md / source/chapters/*.md
- 改写产物：data/${novelId}/target/**（你写）
  - target/maps.md / target/outlines/*.md / target/state.md（写章时自动派生）

${mode === 'generate' ? generateBlock : reviseBlock}

═══ 通用约束 ═══

- 永远不要让 LLM 自己创造剧情骨架——大纲应当锚定 source_chapter_ref
- 改写允许：人名 / 行业 / 支线分支事件细节 / 同等强度的事件顺序
- 主线节拍 / 长线伏笔的"形状"必须保留
- 番茄爽文章节体量约一对一映射
`
}

export interface WriterSystemPromptInput {
  novelId: string
  chapterNumber: number
  mode: 'generate' | 'revise'
  requirement?: string
  feedback?: string
}

export function writerAgentSystemPrompt(input: WriterSystemPromptInput): string {
  const { novelId, chapterNumber, mode } = input
  const padded = String(chapterNumber).padStart(4, '0')

  const generateBlock = `
═══ generate 模式（每个 worker 只写一章） ═══

你只负责写第 ${chapterNumber} 章一章，写完即结束。不要试图写其他章。

用户对本批整体需求（请遵循）：
${input.requirement?.trim() ? input.requirement : '（无特殊要求，按默认工作流写）'}

工作流：
1. 调 getChapterContext({number: ${chapterNumber}}) 拿齐 context（大纲 + 置换表 + 最近 3 章 + 角色状态 + 涉及伏笔）
2. 写正文（中文，3000-5000 字一章为目标）：
   - 严格按 outline.plot 推进剧情
   - 严格按 outline.key_events 包含所有关键事件
   - 涉及人物**只用** maps.character_map.target 列表里的名字
   - **禁止**让 alive===false 的角色出现
   - 替换 setting_map.key_term_replacements 里的所有 key
   - 文风模仿 style_samples / style_tags（第一章靠它，之后靠 recent_chapters 自身延续）
3. 调 writeChapter({number: ${chapterNumber}, title, content})
4. 如返回 ok:false：按 issues 修正后重调 writeChapter
5. 如返回 ok:true：完成
`.trim()

  const reviseBlock = `
═══ revise 模式 ═══

仅修改第 ${chapterNumber} 章一章。

用户修改意见：
${input.feedback?.trim() ? input.feedback : '（用户未给出意见，问用户后再操作）'}

工作流：
1. read target/chapters/${padded}.md 拿现有正文版本
2. read target/outlines/${padded}.md 看大纲（修改不能违反大纲）
3. 调 getChapterContext({number: ${chapterNumber}}) 拿齐校验所需 context
4. 仅按用户意见局部修改，**保持未涉及的段落字面相同**——不要全部重写
5. 调 writeChapter 提交
6. ok:false 按 issues 修正
`.trim()

  return `你是中文网文写作 agent。基于大纲生成 / 修订新书第 ${chapterNumber} 章正文。**不创造剧情，只填充文字**。

═══ 数据布局 ═══

- data/${novelId}/source/**.md（参考，只读）
- data/${novelId}/target/maps.md / outlines/*.md / chapters/*.md / state.md

${mode === 'generate' ? generateBlock : reviseBlock}

═══ 通用约束 ═══

- 不要追求"文采"超出原书风格——番茄爽文流畅 + 节奏 > 文采
- 不要扩写超出大纲的事件
- 长线伏笔的兑现 / 埋点用大纲 hooks_to_plant/payoff 声明驱动；正文里只需要写出对应戏份
`
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: routes/agent.ts errors only.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-server/src/agents/system-prompts.ts
git commit -m "agent-server: rewrite outline + writer prompts with mode branches"
```

---

## Phase 4: Routes

### Task 8: Rewrite agent routes — start, revise, active

**Files:**
- Rewrite: `packages/agent-server/src/routes/agent.ts`

This is the largest backend task. Splitting into multiple commits for clarity inside one task is OK if the file is rewritten in one shot.

- [ ] **Step 1: Rewrite routes/agent.ts**

Replace `packages/agent-server/src/routes/agent.ts` entirely:

```ts
import { Hono } from 'hono'
import type {
  ActiveTask,
  AgentEvent,
  AgentSessionInfo,
  BatchJobInfo,
} from '@novel-agent/shared'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { createOutlineAgent } from '../agents/outline-session.js'
import { createWriterAgent } from '../agents/writer-session.js'
import {
  setActiveSession,
  setActiveBatch,
  getActiveTask,
  getSessionEntry,
  getBatchEntry,
  clearActiveTask,
  type SessionEntry,
} from '../agents/registry.js'
import {
  createBatchJob,
  runBatchJob,
  type BatchJob,
  type WorkerFactory,
} from '../agents/batch-job.js'
import { readNovelIndex } from '../storage/novel-index.js'
import {
  missingOutlines,
  outlineExists,
  readChapterDraft,
  readOutline,
} from '../storage/target-reader.js'

const app = new Hono()

// ─── Helpers ─────────────────────────────────────────────────────────────

function sessionToInfo(entry: SessionEntry): AgentSessionInfo {
  return {
    id: entry.id,
    novel_id: entry.novelId,
    role: entry.role,
    mode: entry.mode,
    scope: entry.scope,
    created_at: entry.createdAt,
  }
}

function activeTaskPayload(novelId: string): ActiveTask | null {
  const a = getActiveTask(novelId)
  if (!a) return null
  if (a.kind === 'session') {
    return { kind: 'session', session: sessionToInfo(a.entry) }
  }
  // a.kind === 'batch' — get full info from BatchJob via batchesById
  const job = (a.entry.batch as unknown as BatchJob).toInfo
    ? (a.entry.batch as unknown as BatchJob).toInfo()
    : null
  if (!job) return null
  return { kind: 'batch', batch: job }
}

async function validateRange(
  novelId: string,
  from: unknown,
  to: unknown,
): Promise<
  | { ok: true; from: number; to: number }
  | { ok: false; status: 400 | 404; error: string; details?: unknown }
> {
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    (from as number) < 1 ||
    (to as number) < (from as number)
  ) {
    return { ok: false, status: 400, error: 'invalid_range' }
  }
  const novel = await readNovelIndex(novelId)
  if (!novel) return { ok: false, status: 404, error: 'novel_not_found' }
  if (novel.analyzed_to < 1) {
    return { ok: false, status: 400, error: 'no_analyzed_chapters' }
  }
  if ((to as number) > novel.analyzed_to) {
    return {
      ok: false,
      status: 400,
      error: 'range_exceeds_analyzed',
      details: { analyzed_to: novel.analyzed_to },
    }
  }
  return { ok: true, from: from as number, to: to as number }
}

function ensureNoActive(novelId: string):
  | { ok: true }
  | { ok: false; payload: { error: string; active: ActiveTask | null } } {
  if (getActiveTask(novelId)) {
    return {
      ok: false,
      payload: { error: 'has_active_session', active: activeTaskPayload(novelId) },
    }
  }
  return { ok: true }
}

// ─── Active task introspection ───────────────────────────────────────────

app.get('/:id/active', (c) => {
  const novelId = c.req.param('id')
  return c.json(activeTaskPayload(novelId))
})

// ─── Outline: start (generate) ───────────────────────────────────────────

app.post('/:id/outline/start', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ from: number; to: number; requirement?: string }>()
  const v = await validateRange(novelId, body.from, body.to)
  if (!v.ok) return c.json({ error: v.error, ...((v.details as object) ?? {}) }, v.status)
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createOutlineAgent({
    novelId,
    scope: { from: v.from, to: v.to },
    mode: 'generate',
    requirement: body.requirement,
  })
  const id = setActiveSession({
    novelId,
    role: 'outline',
    mode: 'generate',
    scope: { from: v.from, to: v.to },
    session,
  })
  const info = sessionToInfo(getSessionEntry(id)!)
  return c.json(info)
})

// ─── Outline: revise single chapter ──────────────────────────────────────

app.post('/:id/outline/revise', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ number: number; feedback: string }>()
  if (!Number.isFinite(body.number) || body.number < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  if (!body.feedback?.trim()) {
    return c.json({ error: 'empty_feedback' }, 400)
  }
  if (!(await outlineExists(novelId, body.number))) {
    return c.json({ error: 'no_existing_outline' }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createOutlineAgent({
    novelId,
    scope: { from: body.number, to: body.number },
    mode: 'revise',
    reviseChapter: body.number,
    feedback: body.feedback,
  })
  const id = setActiveSession({
    novelId,
    role: 'outline',
    mode: 'revise',
    scope: { from: body.number, to: body.number },
    session,
  })
  return c.json(sessionToInfo(getSessionEntry(id)!))
})

// ─── Writer: start (batch fan-out) ───────────────────────────────────────

app.post('/:id/writer/start', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ from: number; to: number; requirement?: string }>()
  const v = await validateRange(novelId, body.from, body.to)
  if (!v.ok) return c.json({ error: v.error, ...((v.details as object) ?? {}) }, v.status)
  const missing = await missingOutlines(novelId, v.from, v.to)
  if (missing.length > 0) {
    return c.json({ error: 'missing_outlines', missing }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const chapters: number[] = []
  for (let n = v.from; n <= v.to; n++) chapters.push(n)
  const job = createBatchJob({
    novelId,
    requirement: body.requirement ?? '',
    chapters,
  })
  setActiveBatch({ novelId, batchId: job.id, batch: job })

  // fire-and-forget
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })

  return c.json(job.toInfo())
})

// ─── Writer: revise single chapter ───────────────────────────────────────

app.post('/:id/writer/revise', async (c) => {
  const novelId = c.req.param('id')
  const body = await c.req.json<{ number: number; feedback: string }>()
  if (!Number.isFinite(body.number) || body.number < 1) {
    return c.json({ error: 'invalid_chapter' }, 400)
  }
  if (!body.feedback?.trim()) {
    return c.json({ error: 'empty_feedback' }, 400)
  }
  if (!(await readChapterDraft(novelId, body.number))) {
    return c.json({ error: 'no_existing_draft' }, 400)
  }
  if (!(await readOutline(novelId, body.number))) {
    return c.json({ error: 'no_existing_outline' }, 400)
  }
  const noActive = ensureNoActive(novelId)
  if (!noActive.ok) return c.json(noActive.payload, 400)

  const session = await createWriterAgent({
    novelId,
    chapterNumber: body.number,
    mode: 'revise',
    feedback: body.feedback,
  })
  const id = setActiveSession({
    novelId,
    role: 'writer',
    mode: 'revise',
    scope: { from: body.number, to: body.number },
    session,
  })
  return c.json(sessionToInfo(getSessionEntry(id)!))
})

// ─── Session: send message (chat) — SSE ──────────────────────────────────

app.post('/session/:sid/message', async (c) => {
  const sid = c.req.param('sid')
  const entry = getSessionEntry(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const { content } = await c.req.json<{ content: string }>()
  if (!content?.trim()) return c.json({ error: 'empty_content' }, 400)
  return runWithStream(c.req.raw.signal, entry.session, content)
})

// ─── Session: explicit close ─────────────────────────────────────────────

app.delete('/session/:sid', (c) => {
  const sid = c.req.param('sid')
  const entry = getSessionEntry(sid)
  if (!entry) return c.body(null, 204)
  clearActiveTask(entry.novelId)
  return c.body(null, 204)
})

// ─── Batch: introspect ───────────────────────────────────────────────────

app.get('/job/:jid', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  return c.json((entry.batch as unknown as BatchJob).toInfo())
})

app.delete('/job/:jid', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.body(null, 204)
  clearActiveTask(entry.novelId)
  return c.body(null, 204)
})

app.post('/job/:jid/abort', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  job.status = 'aborted'
  job.emit({ type: 'batch.aborted' })
  return c.json(job.toInfo())
})

app.post('/job/:jid/retry', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  if (job.status !== 'paused') return c.json({ error: 'not_paused' }, 400)
  job.error = undefined
  job.status = 'running'
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })
  return c.json(job.toInfo())
})

app.post('/job/:jid/skip', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob
  if (job.status !== 'paused') return c.json({ error: 'not_paused' }, 400)
  const ch = job.chapters[job.cursor]
  if (ch !== undefined) job.failed.push(ch)
  job.cursor += 1
  job.error = undefined
  job.status = 'running'
  void runBatchJob(job, makeWriterWorkerFactory()).catch((err: unknown) => {
    job.error = err instanceof Error ? err.message : String(err)
    job.status = 'paused'
    job.emit({ type: 'batch.paused', chapter: job.chapters[job.cursor] ?? -1, error: job.error })
  })
  return c.json(job.toInfo())
})

// ─── Batch: stream SSE ────────────────────────────────────────────────────

app.get('/job/:jid/stream', (c) => {
  const jid = c.req.param('jid')
  const entry = getBatchEntry(jid)
  if (!entry) return c.json({ error: 'job_not_found' }, 404)
  const job = entry.batch as unknown as BatchJob

  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsub() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
      }
      const unsub = job.subscribe((e) => {
        write(e)
        if (e.type === 'batch.done' || e.type === 'batch.aborted') {
          close()
        }
      })
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      c.req.raw.signal.addEventListener('abort', close)
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

// ─── Worker factory: spawn writer per chapter, forward events to job ──────

function makeWriterWorkerFactory(): WorkerFactory {
  return async ({ novelId, chapter, requirement, emit }) => {
    const session = await createWriterAgent({
      novelId,
      chapterNumber: chapter,
      mode: 'generate',
      requirement,
    })
    const unsub = pipeWorkerEventsToJob(session, emit)
    try {
      await session.sendUserMessage(`开始写第 ${chapter} 章。`)
      await waitForAgentEnd(session)
    } finally {
      unsub()
    }
    return { dispose: () => session.dispose() }
  }
}

function pipeWorkerEventsToJob(
  session: AgentSession,
  emit: (e: AgentEvent) => void,
): () => void {
  return session.subscribe((evt) => {
    switch (evt.type) {
      case 'message_update': {
        const inner = evt.assistantMessageEvent
        if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
          emit({ type: 'message.delta', content: inner.delta })
        }
        return
      }
      case 'message_end': {
        const msg = evt.message
        if (msg && msg.role === 'assistant') {
          const textParts: string[] = []
          for (const block of msg.content ?? []) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
              const t = (block as { text?: unknown }).text
              if (typeof t === 'string') textParts.push(t)
            }
          }
          const full = textParts.join('')
          if (full.length > 0) emit({ type: 'message.complete', content: full })
        }
        return
      }
      case 'tool_execution_start': {
        emit({ type: 'tool.call', name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        emit({ type: 'tool.result', name: evt.toolName, result: evt.result })
        return
      }
      default:
        return
    }
  })
}

function waitForAgentEnd(session: AgentSession): Promise<void> {
  return new Promise((resolve) => {
    const unsub = session.subscribe((evt) => {
      if (evt.type === 'agent_end') {
        unsub()
        resolve()
      }
    })
  })
}

// ─── SSE: chat session run ───────────────────────────────────────────────

function runWithStream(
  abortSignal: AbortSignal,
  session: AgentSession,
  userText: string,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch {
          /* closed */
        }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsubscribe() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
      }
      const unsubscribe = subscribeChatSession(session, write, close)
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      abortSignal.addEventListener('abort', close)
      session.sendUserMessage(userText).catch((err: unknown) => {
        write({ type: 'error', message: (err as Error).message ?? String(err) })
        close()
      })
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

function subscribeChatSession(
  session: AgentSession,
  write: (event: AgentEvent) => void,
  close: () => void,
): () => void {
  return session.subscribe((evt) => {
    switch (evt.type) {
      case 'message_update': {
        const inner = evt.assistantMessageEvent
        if (inner.type === 'text_delta' && typeof inner.delta === 'string' && inner.delta.length > 0) {
          write({ type: 'message.delta', content: inner.delta })
        }
        return
      }
      case 'message_end': {
        const msg = evt.message
        if (msg && msg.role === 'assistant') {
          const textParts: string[] = []
          for (const block of msg.content ?? []) {
            if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
              const t = (block as { text?: unknown }).text
              if (typeof t === 'string') textParts.push(t)
            }
          }
          const full = textParts.join('')
          if (full.length > 0) write({ type: 'message.complete', content: full })
        }
        return
      }
      case 'tool_execution_start': {
        write({ type: 'tool.call', name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        write({ type: 'tool.result', name: evt.toolName, result: evt.result })
        return
      }
      case 'agent_end': {
        write({ type: 'done' })
        close()
        return
      }
      default:
        return
    }
  })
}

export { app as agentRoutes }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: PASS for backend.

- [ ] **Step 3: Verify all tests still pass**

Run: `pnpm --filter @novel-agent/agent-server test`
Expected: PASS (all existing tests + new registry/batch-job/target-reader tests)

- [ ] **Step 4: Commit**

```bash
git add packages/agent-server/src/routes/agent.ts
git commit -m "agent-server: rewrite agent routes — start/revise/active + batch job endpoints"
```

---

## Phase 5: Frontend

### Task 9: Update agent-api.ts client

**Files:**
- Rewrite: `packages/web/src/lib/agent-api.ts`

- [ ] **Step 1: Replace file**

Replace `packages/web/src/lib/agent-api.ts`:

```ts
import type { ActiveTask, AgentSessionInfo, BatchJobInfo } from '@novel-agent/shared'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    let extra: unknown = null
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      extra = body
      msg = body.message || body.error || msg
    } catch {
      /* noop */
    }
    const err = new Error(msg) as Error & { details?: unknown; status?: number }
    err.details = extra
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}

export const agentApi = {
  getActive: (novelId: string) =>
    fetch(`/api/agent/${novelId}/active`).then(j<ActiveTask | null>),

  startOutline: (novelId: string, from: number, to: number, requirement: string) =>
    fetch(`/api/agent/${novelId}/outline/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, requirement }),
    }).then(j<AgentSessionInfo>),

  reviseOutline: (novelId: string, number: number, feedback: string) =>
    fetch(`/api/agent/${novelId}/outline/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, feedback }),
    }).then(j<AgentSessionInfo>),

  startWriter: (novelId: string, from: number, to: number, requirement: string) =>
    fetch(`/api/agent/${novelId}/writer/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, requirement }),
    }).then(j<BatchJobInfo>),

  reviseWriter: (novelId: string, number: number, feedback: string) =>
    fetch(`/api/agent/${novelId}/writer/revise`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number, feedback }),
    }).then(j<AgentSessionInfo>),

  getJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}`).then(j<BatchJobInfo>),

  abortJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/abort`, { method: 'POST' }).then(j<BatchJobInfo>),

  retryJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/retry`, { method: 'POST' }).then(j<BatchJobInfo>),

  skipJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}/skip`, { method: 'POST' }).then(j<BatchJobInfo>),

  closeJob: (jobId: string) =>
    fetch(`/api/agent/job/${jobId}`, { method: 'DELETE' }),

  closeSession: (sessionId: string) =>
    fetch(`/api/agent/session/${sessionId}`, { method: 'DELETE' }),

  jobStreamUrl: (jobId: string) => `/api/agent/job/${jobId}/stream`,
  messageUrl: (sessionId: string) => `/api/agent/session/${sessionId}/message`,
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: existing components using old API will fail. Proceed — they're fixed in later tasks.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/agent-api.ts
git commit -m "web: rewrite agent-api client for new endpoints"
```

---

### Task 10: Add useActiveTask hook

**Files:**
- Create: `packages/web/src/lib/use-active-task.ts`

- [ ] **Step 1: Create file**

```ts
import { useQuery } from '@tanstack/react-query'
import type { ActiveTask } from '@novel-agent/shared'
import { agentApi } from './agent-api.js'

export function useActiveTask(novelId: string) {
  return useQuery<ActiveTask | null>({
    queryKey: ['agent-active', novelId],
    queryFn: () => agentApi.getActive(novelId),
    refetchInterval: 3_000,
  })
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `pnpm --filter @novel-agent/web typecheck` (errors from old components OK)

```bash
git add packages/web/src/lib/use-active-task.ts
git commit -m "web: add useActiveTask hook (polls /agent/:id/active)"
```

---

### Task 11: Add useBatchStream hook

**Files:**
- Create: `packages/web/src/lib/use-batch-stream.ts`

- [ ] **Step 1: Create file**

```ts
import { useEffect, useRef, useState } from 'react'
import type { AgentEvent, BatchJobInfo } from '@novel-agent/shared'
import { agentApi } from './agent-api.js'

interface BatchStreamState {
  job: BatchJobInfo | null
  currentDelta: string  // current worker's accumulated text
  toolEvents: { name: string; ok?: boolean }[]
  done: boolean
}

export function useBatchStream(jobId: string | null) {
  const [state, setState] = useState<BatchStreamState>({
    job: null,
    currentDelta: '',
    toolEvents: [],
    done: false,
  })
  const ref = useRef<EventSource | null>(null)

  useEffect(() => {
    if (!jobId) {
      ref.current?.close()
      ref.current = null
      setState({ job: null, currentDelta: '', toolEvents: [], done: false })
      return
    }
    const es = new EventSource(agentApi.jobStreamUrl(jobId))
    ref.current = es
    const handle = (raw: MessageEvent) => {
      let payload: AgentEvent
      try {
        payload = JSON.parse(raw.data)
      } catch {
        return
      }
      setState((prev) => applyEvent(prev, payload))
    }
    const events = [
      'message.delta',
      'message.complete',
      'tool.call',
      'tool.result',
      'batch.progress',
      'batch.worker_start',
      'batch.worker_end',
      'batch.done',
      'batch.aborted',
      'batch.paused',
      'error',
      'done',
    ]
    for (const ev of events) es.addEventListener(ev, handle as EventListener)
    es.onerror = () => { /* let UI poll re-pick state */ }

    // also fetch initial job state (events already replayed via subscribe but useful for race)
    agentApi.getJob(jobId).then((job) => {
      setState((prev) => ({ ...prev, job }))
    }).catch(() => { /* ignore */ })

    return () => {
      for (const ev of events) es.removeEventListener(ev, handle as EventListener)
      es.close()
      ref.current = null
    }
  }, [jobId])

  // poll for periodic refresh of authoritative job state
  useEffect(() => {
    if (!jobId) return
    const t = setInterval(() => {
      agentApi.getJob(jobId).then((job) => setState((prev) => ({ ...prev, job }))).catch(() => {})
    }, 3_000)
    return () => clearInterval(t)
  }, [jobId])

  return state
}

function applyEvent(prev: BatchStreamState, evt: AgentEvent): BatchStreamState {
  switch (evt.type) {
    case 'batch.worker_start':
      return { ...prev, currentDelta: '', toolEvents: [] }
    case 'batch.worker_end':
      return prev
    case 'message.delta':
      return { ...prev, currentDelta: prev.currentDelta + evt.content }
    case 'message.complete':
      return { ...prev, currentDelta: evt.content }
    case 'tool.call':
      return { ...prev, toolEvents: [...prev.toolEvents, { name: evt.name }] }
    case 'tool.result': {
      const next = [...prev.toolEvents]
      const last = next[next.length - 1]
      if (last && last.name === evt.name) {
        const r = evt.result as { ok?: boolean } | undefined
        last.ok = r?.ok !== false
      }
      return { ...prev, toolEvents: next }
    }
    case 'batch.done':
    case 'batch.aborted':
      return { ...prev, done: true }
    default:
      return prev
  }
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add packages/web/src/lib/use-batch-stream.ts
git commit -m "web: add useBatchStream hook for /job/:jid/stream SSE"
```

---

### Task 12: Add GenerateForm component

**Files:**
- Create: `packages/web/src/components/GenerateForm.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { agentApi } from '../lib/agent-api.js'
import { api } from '../lib/api.js'
import { useActiveTask } from '../lib/use-active-task.js'

interface Props {
  novelId: string
  role: 'outline' | 'writer'
  maxChapter: number
  onStarted: () => void
}

export function GenerateForm({ novelId, role, maxChapter, onStarted }: Props) {
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(Math.min(maxChapter, 10))
  const [requirement, setRequirement] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    enabled: role === 'writer',
  })
  const { data: active } = useActiveTask(novelId)

  const rangeValid = from >= 1 && to >= from && to <= maxChapter
  const missingForWriter: number[] =
    role === 'writer' && rangeValid && outlines
      ? (() => {
          const have = new Set(outlines.map((o) => o.number))
          const miss: number[] = []
          for (let n = from; n <= to; n++) if (!have.has(n)) miss.push(n)
          return miss
        })()
      : []
  const writerBlocked = role === 'writer' && missingForWriter.length > 0
  const activeBlocked = !!active

  const canSubmit = rangeValid && !writerBlocked && !activeBlocked && !submitting

  const onSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (role === 'outline') {
        await agentApi.startOutline(novelId, from, to, requirement)
      } else {
        await agentApi.startWriter(novelId, from, to, requirement)
      }
      onStarted()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="border border-neutral-200 rounded p-4 m-3 space-y-3 bg-neutral-50">
      <header className="flex items-center gap-2 text-sm">
        <span className="font-medium">{role === 'outline' ? '生成大纲' : '生成正文'}</span>
        <span className="text-neutral-500">| 范围 1-{maxChapter}</span>
      </header>
      <div className="flex items-center gap-2 text-sm">
        <span>第</span>
        <input
          type="number"
          min={1}
          max={maxChapter}
          value={from}
          onChange={(e) => setFrom(Number(e.target.value))}
          className="w-20 px-2 py-1 border border-neutral-300 rounded"
        />
        <span>—</span>
        <input
          type="number"
          min={1}
          max={maxChapter}
          value={to}
          onChange={(e) => setTo(Number(e.target.value))}
          className="w-20 px-2 py-1 border border-neutral-300 rounded"
        />
        <span>章</span>
      </div>
      <textarea
        value={requirement}
        onChange={(e) => setRequirement(e.target.value)}
        placeholder="对本批的整体需求（可选），例如：文风更口语化 / 加快节奏 / 强化悬念"
        rows={3}
        className="w-full px-3 py-2 border border-neutral-300 rounded text-sm resize-none"
      />
      {writerBlocked && (
        <p className="text-xs text-rose-600">
          区间内缺第 {missingForWriter.join('、')} 章大纲，请先去大纲 tab 生成
        </p>
      )}
      {activeBlocked && (
        <p className="text-xs text-amber-700">
          已有活跃任务，请先在右侧结束当前 session
        </p>
      )}
      {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
      <button
        onClick={onSubmit}
        disabled={!canSubmit}
        className="px-4 py-1.5 rounded bg-amber-500 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? '启动中...' : `启动 ${role === 'outline' ? '大纲' : '正文'} agent`}
      </button>
    </section>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add packages/web/src/components/GenerateForm.tsx
git commit -m "web: add GenerateForm component with writer dependency check"
```

---

### Task 13: Add ReviseButton component

**Files:**
- Create: `packages/web/src/components/ReviseButton.tsx`

- [ ] **Step 1: Create component**

```tsx
import { useState } from 'react'
import { agentApi } from '../lib/agent-api.js'
import { useActiveTask } from '../lib/use-active-task.js'
import clsx from 'clsx'

interface Props {
  novelId: string
  role: 'outline' | 'writer'
  number: number
  onStarted: () => void
}

export function ReviseButton({ novelId, role, number, onStarted }: Props) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const { data: active } = useActiveTask(novelId)

  const isBatchActive = active?.kind === 'batch'
  const disabled = isBatchActive

  const onSubmit = async () => {
    if (!feedback.trim()) return
    if (active) {
      const ok = window.confirm('将关闭当前活跃 session 并启动单章修改，是否继续？')
      if (!ok) return
      // backend rejects, so close first
      if (active.kind === 'session') {
        await agentApi.closeSession(active.session.id)
      } else {
        await agentApi.closeJob(active.batch.id)
      }
    }
    setSubmitting(true)
    setErrorMsg(null)
    try {
      if (role === 'outline') {
        await agentApi.reviseOutline(novelId, number, feedback)
      } else {
        await agentApi.reviseWriter(novelId, number, feedback)
      }
      setOpen(false)
      setFeedback('')
      onStarted()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}
        disabled={disabled}
        title={disabled ? '批量正文跑中，无法启动单章修改' : '提修改意见'}
        className={clsx(
          'text-xs px-2 py-0.5 rounded border',
          disabled
            ? 'border-neutral-200 text-neutral-300 cursor-not-allowed'
            : 'border-neutral-300 text-neutral-600 hover:bg-amber-50 hover:border-amber-400',
        )}
      >
        ✎ 改
      </button>
    )
  }

  return (
    <div className="space-y-2 mt-2 p-2 border border-amber-200 rounded bg-amber-50/40" onClick={(e) => e.stopPropagation()}>
      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={`第 ${number} 章修改意见...`}
        rows={3}
        autoFocus
        className="w-full px-2 py-1 border border-neutral-300 rounded text-xs resize-none"
      />
      {errorMsg && <p className="text-xs text-rose-600">{errorMsg}</p>}
      <div className="flex gap-2">
        <button
          onClick={onSubmit}
          disabled={!feedback.trim() || submitting}
          className="px-3 py-1 rounded bg-amber-500 text-white text-xs disabled:opacity-40"
        >
          {submitting ? '启动中...' : '提交'}
        </button>
        <button
          onClick={() => { setOpen(false); setFeedback(''); setErrorMsg(null) }}
          className="px-3 py-1 rounded border border-neutral-300 text-xs"
        >
          取消
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add packages/web/src/components/ReviseButton.tsx
git commit -m "web: add ReviseButton with active-session conflict handling"
```

---

### Task 14: Add BatchJobPanel component

**Files:**
- Create: `packages/web/src/components/BatchJobPanel.tsx`

- [ ] **Step 1: Create component**

```tsx
import { agentApi } from '../lib/agent-api.js'
import { useBatchStream } from '../lib/use-batch-stream.js'

interface Props {
  jobId: string
  onClosed: () => void
}

export function BatchJobPanel({ jobId, onClosed }: Props) {
  const { job, currentDelta, toolEvents, done } = useBatchStream(jobId)

  if (!job) {
    return <div className="p-4 text-sm text-neutral-500">加载 batch 状态...</div>
  }

  const total = job.chapters.length
  const completed = job.completed.length
  const pct = Math.round((completed / total) * 100)

  const onAbort = async () => {
    await agentApi.abortJob(jobId)
  }
  const onRetry = async () => {
    await agentApi.retryJob(jobId)
  }
  const onSkip = async () => {
    await agentApi.skipJob(jobId)
  }
  const onClose = async () => {
    await agentApi.closeJob(jobId)
    onClosed()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="p-3 border-b border-neutral-200 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">正文批量任务</span>
          <span className={`text-xs px-2 py-0.5 rounded ${badgeColor(job.status)}`}>
            {statusLabel(job.status)}
          </span>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-neutral-600">
            <span>{completed}/{total} 章</span>
            <span>{job.current ? `当前：第 ${job.current} 章` : ''}</span>
          </div>
          <div className="h-1.5 bg-neutral-200 rounded overflow-hidden">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="flex gap-2 text-xs">
          {job.status === 'running' && (
            <button onClick={onAbort} className="px-2 py-1 rounded border border-rose-300 text-rose-700">中止</button>
          )}
          {job.status === 'paused' && (
            <>
              <button onClick={onRetry} className="px-2 py-1 rounded bg-amber-500 text-white">重试该章</button>
              <button onClick={onSkip} className="px-2 py-1 rounded border border-neutral-300">跳过该章</button>
              <button onClick={onAbort} className="px-2 py-1 rounded border border-rose-300 text-rose-700">中止整个 job</button>
            </>
          )}
          {(job.status === 'done' || job.status === 'aborted') && (
            <button onClick={onClose} className="px-2 py-1 rounded border border-neutral-300">关闭</button>
          )}
        </div>
        {job.error && <p className="text-xs text-rose-600">⚠ {job.error}</p>}
      </header>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-sm">
        {job.requirement && (
          <section className="text-xs bg-neutral-50 border border-neutral-200 rounded p-2">
            <div className="text-neutral-500 mb-1">本批需求：</div>
            <div className="whitespace-pre-wrap">{job.requirement}</div>
          </section>
        )}
        {job.completed.length > 0 && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">已完成：</div>
            <div className="flex flex-wrap gap-1">
              {job.completed.map((n) => (
                <span key={n} className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">第 {n} 章</span>
              ))}
            </div>
          </section>
        )}
        {job.failed.length > 0 && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">已跳过：</div>
            <div className="flex flex-wrap gap-1">
              {job.failed.map((n) => (
                <span key={n} className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800 border border-rose-200">第 {n} 章</span>
              ))}
            </div>
          </section>
        )}
        {job.current && !done && (
          <section className="text-xs">
            <div className="text-neutral-500 mb-1">第 {job.current} 章 worker 实时：</div>
            {toolEvents.length > 0 && (
              <div className="space-y-0.5 mb-2">
                {toolEvents.map((t, i) => (
                  <div key={i} className={t.ok === false ? 'text-rose-700' : 'text-emerald-700'}>
                    <span className="font-mono">{t.name}</span>{' '}
                    <span>{t.ok === undefined ? '调用中...' : t.ok ? '完成' : '校验失败'}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="whitespace-pre-wrap text-neutral-600 max-h-40 overflow-y-auto">
              {currentDelta || '...'}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

function badgeColor(s: string): string {
  if (s === 'running') return 'bg-emerald-100 text-emerald-800'
  if (s === 'paused') return 'bg-amber-100 text-amber-800'
  if (s === 'done') return 'bg-neutral-100 text-neutral-700'
  if (s === 'aborted') return 'bg-rose-100 text-rose-700'
  return 'bg-neutral-100 text-neutral-600'
}

function statusLabel(s: string): string {
  return ({
    running: '运行中',
    paused: '已暂停（出错）',
    done: '已完成',
    aborted: '已中止',
  } as Record<string, string>)[s] ?? s
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add packages/web/src/components/BatchJobPanel.tsx
git commit -m "web: add BatchJobPanel for writer batch progress + abort/retry/skip"
```

---

### Task 15: Update AgentChat — close button + mode badge

**Files:**
- Modify: `packages/web/src/components/AgentChat.tsx`

- [ ] **Step 1: Replace AgentChat.tsx**

```tsx
import { useEffect, useState } from 'react'
import type { AgentSessionInfo } from '@novel-agent/shared'
import { agentApi } from '../lib/agent-api.js'
import { useAgentStream, type AgentMessage } from '../lib/use-agent-stream.js'
import clsx from 'clsx'

interface Props {
  session: AgentSessionInfo
  onClosed: () => void
}

export function AgentChat({ session, onClosed }: Props) {
  const sessionId = session.id
  const { messages, streaming, send, setMessages } = useAgentStream({ sessionId })
  const [draft, setDraft] = useState('')
  const [autoStarted, setAutoStarted] = useState(false)

  // For freshly-created session: auto-send the initial kickoff to start agent's first turn.
  useEffect(() => {
    if (autoStarted) return
    setAutoStarted(true)
    const kickoff = buildKickoff(session)
    setMessages([])
    send(agentApi.messageUrl(sessionId), kickoff).catch(console.error)
  }, [autoStarted, sessionId, session, send, setMessages])

  const onSend = async () => {
    if (!draft.trim() || streaming) return
    const content = draft
    setDraft('')
    await send(agentApi.messageUrl(sessionId), content).catch(console.error)
  }

  const onClose = async () => {
    await agentApi.closeSession(sessionId)
    onClosed()
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between p-3 border-b border-neutral-200 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">{labelFor(session)}</span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 text-xs rounded border border-neutral-300 hover:bg-neutral-50"
        >
          结束 session
        </button>
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
            placeholder={streaming ? '生成中...' : '继续追加意见（Enter 发送）'}
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

function labelFor(s: AgentSessionInfo): string {
  const role = s.role === 'outline' ? '大纲' : '正文'
  const mode = s.mode === 'generate' ? '生成' : '修改'
  if (s.scope.from === s.scope.to) return `${mode}${role} 第 ${s.scope.from} 章`
  return `${mode}${role} ${s.scope.from}-${s.scope.to}`
}

function buildKickoff(s: AgentSessionInfo): string {
  if (s.mode === 'generate') {
    return `请按 system prompt 中的工作流开始为第 ${s.scope.from}-${s.scope.to} 章生成${s.role === 'outline' ? '大纲' : '正文'}。`
  }
  return `请按 system prompt 中的修改流程开始处理第 ${s.scope.from} 章。`
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

- [ ] **Step 2: Typecheck and commit**

```bash
git add packages/web/src/components/AgentChat.tsx
git commit -m "web: AgentChat — auto-kickoff first turn, mode label, no run button"
```

---

### Task 16: Update OutlinePanel + DraftsPanel

**Files:**
- Modify: `packages/web/src/components/OutlinePanel.tsx`
- Modify: `packages/web/src/components/DraftsPanel.tsx`

- [ ] **Step 1: Update OutlinePanel.tsx**

Replace `packages/web/src/components/OutlinePanel.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { GenerateForm } from './GenerateForm.js'
import { ReviseButton } from './ReviseButton.js'
import clsx from 'clsx'

interface Props {
  novelId: string
  maxChapter: number
}

export function OutlinePanel({ novelId, maxChapter }: Props) {
  const qc = useQueryClient()
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-72 border-r border-neutral-200 overflow-y-auto">
        <GenerateForm
          novelId={novelId}
          role="outline"
          maxChapter={maxChapter}
          onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', novelId] })}
        />
        <ul>
          {!outlines?.length && (
            <li className="text-xs text-neutral-400 p-3">还没有大纲</li>
          )}
          {outlines?.map((o) => (
            <li
              key={o.number}
              className={clsx(
                'border-b border-neutral-100',
                selected === o.number ? 'bg-amber-50' : 'hover:bg-neutral-50',
              )}
            >
              <button
                onClick={() => setSelected(o.number)}
                className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
              >
                <span>第 {o.number} 章</span>
                <ReviseButton
                  novelId={novelId}
                  role="outline"
                  number={o.number}
                  onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', novelId] })}
                />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-4">
        {selected == null && <p className="text-sm text-neutral-400">选一章查看大纲</p>}
        {selected != null && <OutlineDetail novelId={novelId} number={selected} />}
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
          {o.hooks_to_plant.length === 0 ? <p className="text-neutral-400">—</p> : (
            <ul>{o.hooks_to_plant.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-500 mb-1">本章兑现伏笔</h4>
          {o.hooks_to_payoff.length === 0 ? <p className="text-neutral-400">—</p> : (
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

- [ ] **Step 2: Update DraftsPanel.tsx**

Replace `packages/web/src/components/DraftsPanel.tsx`:

```tsx
import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { GenerateForm } from './GenerateForm.js'
import { ReviseButton } from './ReviseButton.js'
import clsx from 'clsx'

interface Props {
  novelId: string
  maxChapter: number
}

export function DraftsPanel({ novelId, maxChapter }: Props) {
  const qc = useQueryClient()
  const { data: drafts } = useQuery({
    queryKey: ['drafts', novelId],
    queryFn: () => api.listDrafts(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)

  return (
    <div className="flex h-full">
      <aside className="w-72 border-r border-neutral-200 overflow-y-auto">
        <GenerateForm
          novelId={novelId}
          role="writer"
          maxChapter={maxChapter}
          onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', novelId] })}
        />
        <ul>
          {!drafts?.length && (
            <li className="text-xs text-neutral-400 p-3">还没有正文</li>
          )}
          {drafts?.map((d) => (
            <li
              key={d.number}
              className={clsx(
                'border-b border-neutral-100',
                selected === d.number ? 'bg-amber-50' : 'hover:bg-neutral-50',
              )}
            >
              <button
                onClick={() => setSelected(d.number)}
                className="w-full text-left px-3 py-2 text-sm flex items-center justify-between"
              >
                <span>第 {d.number} 章 <span className="text-xs text-neutral-500">{d.word_count} 字</span></span>
                <ReviseButton
                  novelId={novelId}
                  role="writer"
                  number={d.number}
                  onStarted={() => qc.invalidateQueries({ queryKey: ['agent-active', novelId] })}
                />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-6">
        {selected == null && <p className="text-sm text-neutral-400">选一章阅读</p>}
        {selected != null && <DraftDetail novelId={novelId} number={selected} />}
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

- [ ] **Step 3: Typecheck and commit**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: only RewritePage.tsx errors remain (next task fixes).

```bash
git add packages/web/src/components/OutlinePanel.tsx packages/web/src/components/DraftsPanel.tsx
git commit -m "web: OutlinePanel + DraftsPanel embed GenerateForm + ReviseButton"
```

---

### Task 17: Rewrite RewritePage layout

**Files:**
- Rewrite: `packages/web/src/pages/RewritePage.tsx`

- [ ] **Step 1: Replace RewritePage.tsx**

```tsx
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
            {tab === 'outlines' && <OutlinePanel novelId={id} maxChapter={maxChapter} />}
            {tab === 'drafts' && <DraftsPanel novelId={id} maxChapter={maxChapter} />}
          </div>
        </main>

        <aside className="w-[400px] border-l border-neutral-200 flex flex-col">
          <div className="border-b border-neutral-200">
            <StatePanel novelId={id} />
          </div>
          <div className="flex-1 overflow-hidden">
            {!active && (
              <div className="flex items-center justify-center h-full text-sm text-neutral-400 p-4 text-center">
                无活跃任务。在大纲 / 正文 tab 启动批量生成或单章修改。
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/RewritePage.tsx
git commit -m "web: rewrite RewritePage with active-task aware aside"
```

---

## Phase 6: Final verification

### Task 18: Full workspace typecheck + manual smoke

**Files:**
- None (verification only)

- [ ] **Step 1: Run full workspace typecheck**

Run: `pnpm -w typecheck`
Expected: PASS for all packages.

- [ ] **Step 2: Run all tests**

Run: `pnpm -w test`
Expected: PASS.

- [ ] **Step 3: Boot dev server**

Run (background): `pnpm -w dev`

Wait for both server and web to be ready (check server logs for "agent-server listening" and web "Local: http://localhost:5173").

- [ ] **Step 4: Manual smoke checklist**

In a browser at the rewrite page for any analyzed novel, verify:
- 大纲 tab: GenerateForm visible at top of left aside
- 启动按钮在没活跃任务时可点；点击启动一个 1-3 章 outline batch；右侧 AgentChat 出现，自动 kickoff；header 出现"生成大纲 1-3"徽章
- 跑完后 chat 可以追加消息
- 点 header "结束" → chat 消失，徽章消失
- 大纲产物列表行末有 "✎ 改" 按钮；点击展开 textarea
- 正文 tab: 没大纲时 GenerateForm 显示"区间内缺第 X 章大纲"；按钮禁用
- 启动正文批量后右侧切换为 BatchJobPanel；显示进度
- BatchJob 中途人为造个错（停 server 一秒？）→ 走 paused 流程；试 retry / skip / 中止

Document findings in commit message; if any UX issue found, file follow-up tasks.

- [ ] **Step 5: Commit any tweaks discovered**

If smoke surfaced issues (typo, missing wire-up), fix inline and commit:

```bash
git add -p
git commit -m "fix(rewrite): <description>"
```

If no issues:

```bash
git commit --allow-empty -m "verify: outline-writer-optimization smoke passes"
```

---

## Summary

This plan delivers (in order):
1. Shared types (Task 1) — ground truth contract
2. Backend single-active registry + BatchJob primitive (Tasks 2-3) — core execution layer
3. Storage helper for missing-outlines check (Task 4)
4. Session factory updates (Tasks 5-6) — pass mode/scope/requirement/feedback
5. System prompts rewrite (Task 7) — mode-branched
6. Routes overhaul (Task 8) — new endpoints, batch SSE, dependency check
7. Frontend client + hooks (Tasks 9-11) — agent-api, useActiveTask, useBatchStream
8. New components (Tasks 12-14) — GenerateForm, ReviseButton, BatchJobPanel
9. Existing components updated (Tasks 15-16) — AgentChat, OutlinePanel, DraftsPanel
10. Layout (Task 17) — RewritePage active-task aware
11. Verify (Task 18) — typecheck + smoke

Total: 18 tasks. Backend tasks are TDD; UI tasks are direct-write (no UI test infra in repo).
