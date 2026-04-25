# Chat-first 改写页 redesign 实施 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把改写页（`RewritePage`）重做成 chat-first 形态，单一 agent，多 chat 历史可切换可恢复，UI 全屏 3 栏，system prompt 改成"洗稿"导向。

**Architecture:** Backend 把 outline-session + writer-session + batch-job 合并成一个 `chat-session.ts` 工厂，每个 chat 用 pi-coding-agent 的 `SessionManager` 落到 `data/<novel-id>/chats/<chat-id>.jsonl`，`chats/index.md` 用 front matter 列表当人类可读索引。Routes 重写成 chat CRUD + SSE message。Frontend 装 `@assistant-ui/react`，用 ExternalStoreRuntime 包我们自己的 store + SSE adapter；`RewritePage` 改成 3 栏全屏（chat 历史 / chat 窗口 / artifact 预览）。

**Tech Stack:** TypeScript / pnpm workspaces / Hono (backend) / React + Vite + Tailwind / `@mariozechner/pi-coding-agent` (SDK) / `@assistant-ui/react` (chat UI) / `@radix-ui/react-popover` (@-mention) / `gray-matter` (front matter)。

**Spec:** `docs/superpowers/specs/2026-04-25-chat-first-rewrite-redesign-design.md`

---

## File Structure

**Backend - 新增**
- `packages/agent-server/src/storage/chat-index.ts` — 读写 `chats/index.md` 的 front matter
- `packages/agent-server/src/storage/chat-store.ts` — chat CRUD + SessionManager 包装
- `packages/agent-server/src/storage/chat-store.test.ts` — chat-store 单测
- `packages/agent-server/src/agents/chat-session.ts` — 统一 agent 工厂

**Backend - 改写**
- `packages/agent-server/src/agents/system-prompts.ts` — 删 outline + writer prompt，改成单一 `chatSystemPrompt`（含洗稿原则）
- `packages/agent-server/src/agents/tools/update-maps.ts` — 加强 prompt 子段（全员 char_map + 扩容 setting_map）
- `packages/agent-server/src/agents/tools/write-chapter-outline.ts` — 加强 prompt 子段（功能-场景替换）
- `packages/agent-server/src/agents/tools/index.ts` — 合并 outline/writer tool factory 成 `buildChatAgentTools`
- `packages/agent-server/src/agents/registry.ts` — 重写为 chat-keyed
- `packages/agent-server/src/agents/registry.test.ts` — 同步重写
- `packages/agent-server/src/routes/agent.ts` — 重写 routes
- `packages/shared/src/types.ts` — 删 batch / session 旧 types，加 `ChatInfo`，简化 `ActiveTask`

**Backend - 删除**
- `packages/agent-server/src/agents/outline-session.ts`
- `packages/agent-server/src/agents/writer-session.ts`
- `packages/agent-server/src/agents/batch-job.ts`
- `packages/agent-server/src/agents/batch-job.test.ts`

**Frontend - 新增**
- `packages/web/src/lib/chat-api.ts` — chat lifecycle API client
- `packages/web/src/lib/chat-runtime.ts` — assistant-ui ExternalStoreRuntime adapter
- `packages/web/src/components/ChatPanel.tsx` — assistant-ui Thread + Composer 包装
- `packages/web/src/components/ChatSidebar.tsx` — chat 历史侧栏
- `packages/web/src/components/MentionPopover.tsx` — Composer 内 @ 弹窗
- `packages/web/src/components/ArtifactTabs.tsx` — 包 4 个现有 panel 的 tab 切换器
- `packages/web/src/components/tool-cards/index.tsx` — `makeAssistantToolUI` 注册 7 个 tool 的折叠卡片

**Frontend - 改写**
- `packages/web/src/pages/RewritePage.tsx` — 3 栏全屏布局
- `packages/web/src/lib/use-active-task.ts` — 改成 `useActiveChat`

**Frontend - 删除**
- `packages/web/src/components/AgentChat.tsx`
- `packages/web/src/components/BatchJobPanel.tsx`
- `packages/web/src/components/GenerateForm.tsx`
- `packages/web/src/lib/use-agent-stream.ts`
- `packages/web/src/lib/agent-api.ts`

**保持不动**
- 4 个 custom tool 的 schema + execute 逻辑（只改 promptGuidelines）
- `target-reader.ts` / `target-writer.ts` / `state.ts`
- `MapsPanel.tsx` / `OutlinePanel.tsx` / `DraftsPanel.tsx` / `StatePanel.tsx`
- `NovelListPage.tsx` / `NovelDetailPage.tsx`
- 所有 `/api/novel/*` 非 agent 路由

---

## Phase A — Shared types

### Task 1: 更新 shared types

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: 修改 types.ts，删旧 type / 加 ChatInfo / 简化 ActiveTask**

打开 `packages/shared/src/types.ts`：

**删除以下行**（按当前文件内容）：

```typescript
export type AgentRole = 'outline' | 'writer'
export type AgentMode = 'generate' | 'revise'

export interface AgentSessionInfo {
  id: string
  novel_id: string
  role: AgentRole
  mode: AgentMode
  scope: { from: number; to: number }
  requirement?: string
  feedback?: string
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

**替换为**：

```typescript
export interface ChatInfo {
  id: string
  novel_id: string
  title: string
  created_at: string
  last_msg_at: string
  last_user_text: string
}

export type ActiveTask = { chatId: string } | null
```

**也要删除 AgentEvent union 里只 batch 相关的 variant**（保留 message / tool / done / error）。删除以下行：

```typescript
  | { type: 'batch.progress'; completed: number; total: number; current: number | null }
  | { type: 'batch.worker_start'; chapter: number }
  | { type: 'batch.worker_end'; chapter: number; ok: boolean; error?: string }
  | { type: 'batch.done' }
  | { type: 'batch.aborted' }
  | { type: 'batch.paused'; chapter: number; error: string }
```

最终 `AgentEvent` 应为：

```typescript
export type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; id: string; name: string; params: unknown }
  | { type: 'tool.result'; id: string; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

- [ ] **Step 2: typecheck**

Run: `pnpm typecheck`
Expected: 大量报错（消费者还没改）— 暂时忽略，后续 task 修。

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add ChatInfo type, simplify ActiveTask, drop batch/session types"
```

---

## Phase B — Backend storage

### Task 2: chat-index.ts（读写 chats/index.md）

**Files:**
- Create: `packages/agent-server/src/storage/chat-index.ts`
- Modify: `packages/agent-server/src/storage/paths.ts`

- [ ] **Step 1: 加 paths**

在 `packages/agent-server/src/storage/paths.ts` 的 paths object 里加：

```typescript
chatsDir: (id: string) => join(root(), id, 'chats'),
chatsIndex: (id: string) => join(root(), id, 'chats', 'index.md'),
chatSession: (novelId: string, chatId: string) =>
  join(root(), novelId, 'chats', `${chatId}.jsonl`),
```

- [ ] **Step 2: 创建 chat-index.ts**

```typescript
import type { ChatInfo } from '@novel-agent/shared'
import { paths } from './paths.js'
import { readMdIfExists, writeMd } from './markdown.js'

interface ChatsIndex {
  chats: ChatInfo[]
}

export async function readChatsIndex(novelId: string): Promise<ChatInfo[]> {
  const f = await readMdIfExists<ChatsIndex>(paths.chatsIndex(novelId))
  return f?.frontMatter.chats ?? []
}

export async function writeChatsIndex(
  novelId: string,
  chats: ChatInfo[],
): Promise<void> {
  await writeMd(
    paths.chatsIndex(novelId),
    { chats } as unknown as Record<string, unknown>,
    '',
  )
}

export async function appendChat(novelId: string, chat: ChatInfo): Promise<void> {
  const chats = await readChatsIndex(novelId)
  chats.push(chat)
  await writeChatsIndex(novelId, chats)
}

export async function updateChat(
  novelId: string,
  chatId: string,
  patch: Partial<ChatInfo>,
): Promise<ChatInfo | null> {
  const chats = await readChatsIndex(novelId)
  const idx = chats.findIndex((c) => c.id === chatId)
  if (idx < 0) return null
  const updated: ChatInfo = { ...chats[idx]!, ...patch }
  chats[idx] = updated
  await writeChatsIndex(novelId, chats)
  return updated
}

export async function removeChat(novelId: string, chatId: string): Promise<boolean> {
  const chats = await readChatsIndex(novelId)
  const next = chats.filter((c) => c.id !== chatId)
  if (next.length === chats.length) return false
  await writeChatsIndex(novelId, next)
  return true
}

export async function findChat(
  novelId: string,
  chatId: string,
): Promise<ChatInfo | null> {
  const chats = await readChatsIndex(novelId)
  return chats.find((c) => c.id === chatId) ?? null
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: PASS（chat-index 自身没问题；shared types 改了，agent-server 旧代码会报错但本任务不修）。

可能还有 shared types 引发的错误；不在本任务范围。

- [ ] **Step 4: Commit**

```bash
git add packages/agent-server/src/storage/chat-index.ts packages/agent-server/src/storage/paths.ts
git commit -m "feat(storage): add chat-index for chats/index.md front matter list"
```

---

### Task 3: chat-store.ts（CRUD + SessionManager 包装）

**Files:**
- Create: `packages/agent-server/src/storage/chat-store.ts`
- Test: `packages/agent-server/src/storage/chat-store.test.ts`

- [ ] **Step 1: 写失败测试**

Create `packages/agent-server/src/storage/chat-store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createChat, listChats, deleteChat, getChat, updateChatTitle, touchChatLastMsg } from './chat-store.js'

const NOVEL_ID = 'nv-test-1'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'chat-store-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})

describe('chat-store', () => {
  it('createChat appends to index and returns metadata with id starting with cht-', async () => {
    const chat = await createChat(NOVEL_ID, '前 10 章大纲')
    expect(chat.id).toMatch(/^cht-/)
    expect(chat.title).toBe('前 10 章大纲')
    expect(chat.novel_id).toBe(NOVEL_ID)
    const list = await listChats(NOVEL_ID)
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe(chat.id)
  })

  it('createChat with no title defaults to "新对话"', async () => {
    const chat = await createChat(NOVEL_ID)
    expect(chat.title).toBe('新对话')
  })

  it('listChats returns empty array when index missing', async () => {
    const list = await listChats(NOVEL_ID)
    expect(list).toEqual([])
  })

  it('getChat returns null for unknown id', async () => {
    const chat = await getChat(NOVEL_ID, 'cht-nonexistent')
    expect(chat).toBeNull()
  })

  it('updateChatTitle changes title and persists', async () => {
    const chat = await createChat(NOVEL_ID, 'old')
    const updated = await updateChatTitle(NOVEL_ID, chat.id, 'new')
    expect(updated?.title).toBe('new')
    const reread = await getChat(NOVEL_ID, chat.id)
    expect(reread?.title).toBe('new')
  })

  it('touchChatLastMsg updates last_msg_at and last_user_text', async () => {
    const chat = await createChat(NOVEL_ID, 't')
    const before = chat.last_msg_at
    await new Promise((r) => setTimeout(r, 10))
    const updated = await touchChatLastMsg(NOVEL_ID, chat.id, 'hello world')
    expect(updated?.last_user_text).toBe('hello world')
    expect(updated!.last_msg_at).not.toBe(before)
  })

  it('deleteChat removes from index and removes jsonl file if exists', async () => {
    const chat = await createChat(NOVEL_ID, 't')
    // simulate jsonl creation
    const { writeFileSync } = await import('node:fs')
    const { paths } = await import('./paths.js')
    writeFileSync(paths.chatSession(NOVEL_ID, chat.id), '')
    expect(existsSync(paths.chatSession(NOVEL_ID, chat.id))).toBe(true)
    await deleteChat(NOVEL_ID, chat.id)
    expect(existsSync(paths.chatSession(NOVEL_ID, chat.id))).toBe(false)
    expect(await getChat(NOVEL_ID, chat.id)).toBeNull()
  })

  it('listChats sorts by last_msg_at desc', async () => {
    const a = await createChat(NOVEL_ID, 'a')
    await new Promise((r) => setTimeout(r, 10))
    const b = await createChat(NOVEL_ID, 'b')
    await new Promise((r) => setTimeout(r, 10))
    await touchChatLastMsg(NOVEL_ID, a.id, 'newer touch on a')
    const list = await listChats(NOVEL_ID)
    expect(list[0]!.id).toBe(a.id) // a now has newer last_msg_at
    expect(list[1]!.id).toBe(b.id)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @novel-agent/agent-server vitest run src/storage/chat-store.test.ts`
Expected: FAIL — `chat-store` 不存在。

- [ ] **Step 3: 实现 chat-store.ts**

Create `packages/agent-server/src/storage/chat-store.ts`:

```typescript
import { rm, mkdir } from 'node:fs/promises'
import type { ChatInfo } from '@novel-agent/shared'
import { paths } from './paths.js'
import {
  appendChat,
  readChatsIndex,
  removeChat,
  updateChat,
  findChat,
} from './chat-index.js'

function genChatId(): string {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 8)
  return `cht-${ts}-${rand}`
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function createChat(novelId: string, title?: string): Promise<ChatInfo> {
  await mkdir(paths.chatsDir(novelId), { recursive: true })
  const now = nowIso()
  const chat: ChatInfo = {
    id: genChatId(),
    novel_id: novelId,
    title: title?.trim() || '新对话',
    created_at: now,
    last_msg_at: now,
    last_user_text: '',
  }
  await appendChat(novelId, chat)
  return chat
}

export async function listChats(novelId: string): Promise<ChatInfo[]> {
  const chats = await readChatsIndex(novelId)
  return [...chats].sort((a, b) =>
    b.last_msg_at.localeCompare(a.last_msg_at),
  )
}

export async function getChat(novelId: string, chatId: string): Promise<ChatInfo | null> {
  return findChat(novelId, chatId)
}

export async function updateChatTitle(
  novelId: string,
  chatId: string,
  title: string,
): Promise<ChatInfo | null> {
  return updateChat(novelId, chatId, { title })
}

export async function touchChatLastMsg(
  novelId: string,
  chatId: string,
  lastUserText: string,
): Promise<ChatInfo | null> {
  return updateChat(novelId, chatId, {
    last_msg_at: nowIso(),
    last_user_text: lastUserText.slice(0, 80),
  })
}

export async function deleteChat(novelId: string, chatId: string): Promise<boolean> {
  const removed = await removeChat(novelId, chatId)
  try {
    await rm(paths.chatSession(novelId, chatId))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return removed
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @novel-agent/agent-server vitest run src/storage/chat-store.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-server/src/storage/chat-store.ts packages/agent-server/src/storage/chat-store.test.ts
git commit -m "feat(storage): add chat-store with create/list/get/update/delete + jsonl cleanup"
```

---

## Phase C — Backend agent

### Task 4: 重写 system-prompts.ts → 单一 chatSystemPrompt（洗稿 mindset）

**Files:**
- Modify: `packages/agent-server/src/agents/system-prompts.ts`

- [ ] **Step 1: 整文件替换**

把 `packages/agent-server/src/agents/system-prompts.ts` 整个内容替换为：

```typescript
import { paths } from '../storage/paths.js'

export interface ChatSystemPromptInput {
  novelId: string
  analyzedTo: number  // novel.analyzed_to，决定 agent 可以操作哪些章
}

export function chatSystemPrompt(input: ChatSystemPromptInput): string {
  const { novelId, analyzedTo } = input
  const novelDir = paths.novel(novelId)

  return `你是中文网文改写 agent，工作目标是把一本已分析的原书"洗稿"成新书。**核心心态：你不是在翻译或抄写，你是在洗稿。**

═══ 数据布局（绝对路径，read/ls/grep 直接用） ═══

- 参考小说根目录：${novelDir}/source（只读）
  - ${novelDir}/source/meta.md
  - ${novelDir}/source/characters/*.md
  - ${novelDir}/source/subplots.md
  - ${novelDir}/source/hooks.md
  - ${novelDir}/source/chapters/*.md（每章原书摘要 + 关键事件）
- 改写产物根目录：${novelDir}/target（你写）
  - ${novelDir}/target/maps.md
  - ${novelDir}/target/outlines/*.md（4 位 zero-pad，第 5 章 = 0005.md）
  - ${novelDir}/target/chapters/*.md
  - ${novelDir}/target/state.md（自动派生，你不直接写）

可操作章节范围：1-${analyzedTo}（已分析过的范围）。

═══ 洗稿核心原则（最重要！） ═══

**1. 主线大剧情节点保留**
原书的关键节点（A 救了 B、B 死了、主角晋级）保留——这是节奏吸引力来源。

**2. 人名全改**（这是当前最容易踩坑的地方）
- 调 updateMaps 时，character_entries 必须覆盖 source/characters/ 下**所有 role !== 'tool' 的角色**，不只主角
- 改名规则：保留性别 + 大致年龄段 + 角色功能（mentor / family / antagonist），换姓和名字风格

**3. 设定表面替换**
- updateMaps 的 setting.key_term_replacements 不只是 industry 那一行
- 还要覆盖：关键场景类型（药厂 → 灵药园 / 宗门试炼场）、武道术语（铜皮铁骨 → 锻体淬骨）、关键道具类型
- 出现频次高的具体术语都要落进 map（5-15 条起步，多多益善）

**4. 分支事件换形态**
- 原文「去药厂试药 + 跟父亲对打」剧情功能 = 「外部资源获取」+「家庭冲突」
- 改写要保留这两个**功能**，但换具体载体：「潜入秘境采灵药 + 跟师叔切磋」
- 写每一章 outline 时，先复述原章功能，再设计替代场景，最后写 plot

**5. 支线顺序可调**
- 不影响主线因果的支线允许调换出现顺序
- 规则：支线 A 和 B 之间无因果依赖（B 不引用 A 的结果）→ 允许调换在改写大纲里的发生顺序

**6. 避免雷同自检**
- 每章 outline / 正文写完，自查场景、道具、术语、人名是否还跟原文撞
- 撞就再改一遍

═══ 用户 @ token ═══

用户消息里可能含以下 token，每个指向某个 artifact / 行为：

- \`@生成大纲\` / \`@生成正文\` / \`@生成置换表\` — 动作类，按字面执行
- \`@大纲\` — 整篇大纲（指向 ${novelDir}/target/outlines/）
- \`@大纲第N章\` — 第 N 章大纲（${novelDir}/target/outlines/<padded>.md）
- \`@正文第N章\` — 第 N 章正文（${novelDir}/target/chapters/<padded>.md）
- \`@置换表\` — ${novelDir}/target/maps.md
- \`@人物X\` — char_map.target = "X" 的角色

token 指向的 artifact 即本轮操作或参考目标。读到 token 后先 read 对应文件再决定下一步。

═══ 通用工作流 ═══

**写大纲前**：read source/meta + ls source/characters/ + read maps.md（不存在或缺字段时调 updateMaps 生成草案）+ read 对应 source/chapters/<n>.md
**写正文前**：调 getChapterContext({number}) 拿齐 outline + maps + state + 最近 3 章
**写多章**：串行循环调 writeChapter，写完一章再下一章；中途用户喊停就 stop
**用户没指定章节范围**：主动问，不要瞎写

═══ 工具行为约束 ═══

- writeChapterOutline 校验 hooks 引用是否存在、character_deaths 是否未死，失败按 issues 修正后重调
- writeChapter 校验类似，按 issues 修正
- 修改已存在 outline / 正文：先 read 拿现有版本，**只改用户指定字段**，保持其他字段字面相同——不要全部重写

═══ 用户首条消息处理 ═══

如果用户首条 message 是开放性问题（"先确定主角金手指"、"反派怎么改"），先讨论再调写工具。
如果是具体执行指令（"@生成大纲 1-10" / "帮我把第 3 章节奏拉紧"），按工作流执行。
不确定时宁可先问，也不要凭猜测开始批量写。

═══ 通用约束 ═══

- 永远不要让 LLM 自己创造剧情骨架——大纲应当锚定 source_chapter_ref
- 番茄爽文章节体量约一对一映射，正文 3000-5000 字一章为目标
- 不要追求"文采"超出原书风格——番茄爽文流畅 + 节奏 > 文采
`
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: 仍有大量错误（消费者 outline-session / writer-session 还引用旧函数）— 暂忽略。

- [ ] **Step 3: Commit**

```bash
git add packages/agent-server/src/agents/system-prompts.ts
git commit -m "feat(agent): rewrite system prompt as unified chatSystemPrompt with 洗稿 mindset"
```

---

### Task 5: 加强 update-maps + write-chapter-outline 的 prompt 子段

**Files:**
- Modify: `packages/agent-server/src/agents/tools/update-maps.ts`
- Modify: `packages/agent-server/src/agents/tools/write-chapter-outline.ts`

- [ ] **Step 1: 加强 update-maps promptGuidelines**

打开 `packages/agent-server/src/agents/tools/update-maps.ts`，把 `promptGuidelines` 数组替换为：

```typescript
    promptGuidelines: [
      '**首次运行时**先 read target/maps.md 看当前状态（如果存在）',
      '**character_entries 必须覆盖 source/characters/ 下所有 role !== \'tool\' 的角色**——主角 / 配角 / 家人 / 反派 / 师傅都要给 target 名，不能漏。漏了就违反洗稿原则',
      'character_entries 的 source 必须是原书角色 canonical_name（read source/characters/ 找）',
      'character_entries 的 target 是改写后的名字：保留性别、大致年龄段、角色功能（mentor/family/antagonist），换姓和名字风格',
      'setting.original_industry 来自 source/meta.md 的 industry 字段；target_industry 由你决定（如果用户没指定）',
      'setting.key_term_replacements 是核心字段：列出原书所有高频出现的具体术语到改写后术语的对应映射，**至少 8-15 条**——包括但不限于：关键场景类型（药厂 → 灵药园）、武道/修炼术语（铜皮铁骨 → 锻体淬骨）、关键道具类型、组织名、地名、特殊物品。条目越多，正文/大纲改写时撞原文的概率越低',
    ],
```

- [ ] **Step 2: 加强 write-chapter-outline promptGuidelines**

打开 `packages/agent-server/src/agents/tools/write-chapter-outline.ts`，把 `promptGuidelines` 数组替换为：

```typescript
    promptGuidelines: [
      `本批范围：${batch.from}-${batch.to}。number 必须在此范围内`,
      '**洗稿要求**：plot 不能照抄原书剧情。原书该章发生 X，改写要保留 X 的剧情功能（外部资源获取 / 家庭冲突 / 突破瓶颈 / 等等），但换不同的具体载体（场景、道具、对手）',
      '写 plot 前先在思考里复述原章 key_events 的剧情功能，再设计同功能的替代场景，最后落字',
      'plot 是 200-400 字大纲（中文，已应用置换表 maps.setting_map.key_term_replacements）',
      'key_events 列出本章关键事件，每条用替代场景的具体描述（不能与原章 key_events 字面相同）',
      'hooks_to_plant 列本章要新埋的长线伏笔（id 是你自定义的，nhk-001 风格）；hooks_to_payoff 列本章兑现的伏笔 id（必须已在 source/hooks 或 state.new_hooks）',
      'planned_state_changes.character_deaths 里的角色名必须用 character_map.target 形式',
      '本批已写过的章节大纲可通过 read target/outlines/<n>.md 查看',
      '**支线顺序优化**：如果本章涉及的支线和已写章节的支线无因果依赖（B 不引用 A 的结果），允许调换发生顺序——使改写顺序与原书不同',
    ],
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: 不引入新错误。

- [ ] **Step 4: Commit**

```bash
git add packages/agent-server/src/agents/tools/update-maps.ts packages/agent-server/src/agents/tools/write-chapter-outline.ts
git commit -m "feat(tools): tighten prompts for full-cast char_map and scene replacement"
```

---

### Task 6: 合并 tool factories（buildChatAgentTools）

**Files:**
- Modify: `packages/agent-server/src/agents/tools/index.ts`

- [ ] **Step 1: 替换 tool factory**

把 `packages/agent-server/src/agents/tools/index.ts` 整个替换为：

```typescript
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildUpdateMapsTool } from './update-maps.js'
import { buildWriteChapterOutlineTool, type BatchRange } from './write-chapter-outline.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'
import { buildWriteChapterTool } from './write-chapter.js'

/**
 * Chat agent 一次拿所有 4 个 tool。
 * scope 给 [1, analyzedTo]，表示 agent 可写任意已分析过的章节。
 */
export function buildChatAgentTools(
  novelId: string,
  scope: BatchRange,
): ToolDefinition[] {
  return [
    buildUpdateMapsTool(novelId),
    buildWriteChapterOutlineTool(novelId, scope),
    buildGetChapterContextTool(novelId),
    buildWriteChapterTool(novelId, scope),
  ]
}

export type { BatchRange } from './write-chapter-outline.js'
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: outline-session / writer-session 仍报错（用旧 builder），下一 task 修。

- [ ] **Step 3: Commit**

```bash
git add packages/agent-server/src/agents/tools/index.ts
git commit -m "feat(tools): merge outline/writer tool factories into buildChatAgentTools"
```

---

### Task 7: chat-session.ts 工厂

**Files:**
- Create: `packages/agent-server/src/agents/chat-session.ts`

- [ ] **Step 1: 创建 chat-session.ts**

```typescript
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
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildChatAgentTools } from './tools/index.js'
import { chatSystemPrompt } from './system-prompts.js'
import { paths } from '../storage/paths.js'
import { readNovelIndex } from '../storage/novel-index.js'

export interface ChatAgentInit {
  novelId: string
  chatId: string
}

export async function createChatAgent(init: ChatAgentInit): Promise<AgentSession> {
  const novel = await readNovelIndex(init.novelId)
  if (!novel) throw new Error(`novel ${init.novelId} not found`)
  const analyzedTo = novel.analyzed_to
  if (analyzedTo < 1) {
    throw new Error(`novel ${init.novelId} has no analyzed chapters yet`)
  }

  const sessionFile = paths.chatSession(init.novelId, init.chatId)
  const sessionDir = dirname(sessionFile)
  await mkdir(sessionDir, { recursive: true })

  // 用 SessionManager 管理 chat 的 jsonl 文件：
  // - 已存在 → open（恢复消息历史）
  // - 不存在 → create（新建一个 jsonl）
  // SDK 自己 append 到 sessionFile。
  const sessionManager = existsSync(sessionFile)
    ? SessionManager.open(sessionFile, sessionDir)
    : SessionManager.create(process.cwd(), sessionDir)
  // 如果是 create 路径，sessionFile 是 SDK 生成的；我们要让它写到我们指定的文件。
  // SessionManager 暴露 setSessionFile 来切实际文件路径。
  sessionManager.setSessionFile(sessionFile)

  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    systemPrompt: chatSystemPrompt({ novelId: init.novelId, analyzedTo }),
  })
  await resourceLoader.reload()

  const scope = { from: 1, to: analyzedTo }
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: [readTool, grepTool, lsTool],
    customTools: buildChatAgentTools(init.novelId, scope),
    sessionManager,
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
```

- [ ] **Step 2: typecheck（仅本文件）**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: 本文件无错；其他文件错误是历史问题。

如果 `setSessionFile` 报"private"，把那行注释掉并改为靠 `SessionManager.create(cwd, sessionDir)` 自动生成的路径——同时把 chatId 改成读 `sessionManager.getSessionFile()` 的 basename。这是 fallback 方案，subagent 实施时按实际 SDK API 调整。

- [ ] **Step 3: Commit**

```bash
git add packages/agent-server/src/agents/chat-session.ts
git commit -m "feat(agent): add unified createChatAgent backed by per-chat jsonl SessionManager"
```

---

### Task 8: 重写 registry.ts（chat-keyed）

**Files:**
- Modify: `packages/agent-server/src/agents/registry.ts`
- Modify: `packages/agent-server/src/agents/registry.test.ts`

- [ ] **Step 1: 重写 registry.test.ts**

整文件替换为：

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { __clearAll, claimChat, releaseChat, getActiveChat, getChatEntry } from './registry.js'
import type { AgentSession } from '@mariozechner/pi-coding-agent'

const fakeSession = (): AgentSession => ({
  dispose: () => {},
  subscribe: () => () => {},
  sendUserMessage: async () => {},
} as unknown as AgentSession)

beforeEach(() => __clearAll())

describe('registry (chat-keyed)', () => {
  it('claimChat sets active and getActiveChat reads it', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    expect(getActiveChat('n1')).toEqual({ chatId: 'c1' })
  })

  it('claimChat throws when another chat is active for same novel', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    expect(() => claimChat({ novelId: 'n1', chatId: 'c2', session: fakeSession() })).toThrow(/active/)
  })

  it('claimChat for same chatId is idempotent', () => {
    const s = fakeSession()
    claimChat({ novelId: 'n1', chatId: 'c1', session: s })
    expect(() => claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })).not.toThrow()
  })

  it('releaseChat removes active', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    releaseChat('n1')
    expect(getActiveChat('n1')).toBeNull()
  })

  it('different novels can each have an active chat simultaneously', () => {
    claimChat({ novelId: 'n1', chatId: 'c1', session: fakeSession() })
    claimChat({ novelId: 'n2', chatId: 'c2', session: fakeSession() })
    expect(getActiveChat('n1')).toEqual({ chatId: 'c1' })
    expect(getActiveChat('n2')).toEqual({ chatId: 'c2' })
  })

  it('getChatEntry returns null for unknown', () => {
    expect(getChatEntry('n1', 'c1')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @novel-agent/agent-server vitest run src/agents/registry.test.ts`
Expected: FAIL — 函数不存在。

- [ ] **Step 3: 重写 registry.ts**

整文件替换为：

```typescript
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import type { ActiveTask } from '@novel-agent/shared'

export interface ChatEntry {
  novelId: string
  chatId: string
  session: AgentSession
  isStreaming: boolean
}

const activeByNovel = new Map<string, ChatEntry>()

export interface ClaimChatInput {
  novelId: string
  chatId: string
  session: AgentSession
}

/**
 * 占用某 novel 的 active chat。同一 chatId 可重复 claim（幂等，session 替换为新的）；
 * 不同 chatId 抛 'another_chat_active'（API 层捕获后返回 409）。
 */
export function claimChat(input: ClaimChatInput): ChatEntry {
  const existing = activeByNovel.get(input.novelId)
  if (existing && existing.chatId !== input.chatId) {
    throw new Error(`another_chat_active:${existing.chatId}`)
  }
  const entry: ChatEntry = {
    novelId: input.novelId,
    chatId: input.chatId,
    session: input.session,
    isStreaming: false,
  }
  if (existing) {
    try { existing.session.dispose() } catch { /* ignore */ }
  }
  activeByNovel.set(input.novelId, entry)
  return entry
}

export function getActiveChat(novelId: string): ActiveTask {
  const e = activeByNovel.get(novelId)
  return e ? { chatId: e.chatId } : null
}

export function getChatEntry(novelId: string, chatId: string): ChatEntry | null {
  const e = activeByNovel.get(novelId)
  if (!e || e.chatId !== chatId) return null
  return e
}

export function setStreaming(novelId: string, chatId: string, value: boolean): void {
  const e = activeByNovel.get(novelId)
  if (e && e.chatId === chatId) e.isStreaming = value
}

export function releaseChat(novelId: string): void {
  const e = activeByNovel.get(novelId)
  if (!e) return
  try { e.session.dispose() } catch { /* ignore */ }
  activeByNovel.delete(novelId)
}

// test-only
export function __clearAll(): void {
  for (const e of activeByNovel.values()) {
    try { e.session.dispose() } catch { /* ignore */ }
  }
  activeByNovel.clear()
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @novel-agent/agent-server vitest run src/agents/registry.test.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
git add packages/agent-server/src/agents/registry.ts packages/agent-server/src/agents/registry.test.ts
git commit -m "feat(agent): rewrite registry as chat-keyed lock with claim/release/setStreaming"
```

---

## Phase D — Backend routes

### Task 9: 重写 routes/agent.ts

**Files:**
- Modify: `packages/agent-server/src/routes/agent.ts`

- [ ] **Step 1: 整文件替换**

把 `packages/agent-server/src/routes/agent.ts` 整个内容替换为：

```typescript
import { Hono } from 'hono'
import type { AgentEvent, ChatInfo } from '@novel-agent/shared'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { createChatAgent } from '../agents/chat-session.js'
import {
  claimChat,
  releaseChat,
  getActiveChat,
  getChatEntry,
  setStreaming,
  type ChatEntry,
} from '../agents/registry.js'
import {
  createChat,
  listChats,
  getChat,
  updateChatTitle,
  touchChatLastMsg,
  deleteChat as deleteChatStorage,
} from '../storage/chat-store.js'
import { readNovelIndex } from '../storage/novel-index.js'

const app = new Hono()

// ───── Active chat ─────────────────────────────────────────────────────────

app.get('/:id/active', (c) => {
  const novelId = c.req.param('id')
  return c.json(getActiveChat(novelId))
})

// ───── Chat CRUD ───────────────────────────────────────────────────────────

app.get('/:id/chats', async (c) => {
  const novelId = c.req.param('id')
  const novel = await readNovelIndex(novelId)
  if (!novel) return c.json({ error: 'novel_not_found' }, 404)
  return c.json(await listChats(novelId))
})

app.post('/:id/chats', async (c) => {
  const novelId = c.req.param('id')
  const novel = await readNovelIndex(novelId)
  if (!novel) return c.json({ error: 'novel_not_found' }, 404)
  let title: string | undefined
  try {
    const body = await c.req.json<{ title?: string }>()
    title = body.title
  } catch { /* empty body OK */ }
  const chat = await createChat(novelId, title)
  return c.json(chat, 201)
})

app.get('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const chat = await getChat(novelId, chatId)
  if (!chat) return c.json({ error: 'chat_not_found' }, 404)
  // TODO: 加载消息历史返回（暂只回 metadata，前端先用 ExternalStoreRuntime 自己空跑；
  // history 通过新建 SDK session 时 SessionManager 自动 replay 给 LLM，UI 上的旧消息需要
  // 走单独的"读 jsonl 转成 UI message[]"逻辑——预留 endpoint，下一 task 加）
  return c.json({ chat, messages: [] })
})

app.patch('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const body = await c.req.json<{ title?: string }>()
  if (!body.title?.trim()) return c.json({ error: 'invalid_title' }, 400)
  const updated = await updateChatTitle(novelId, chatId, body.title.trim())
  if (!updated) return c.json({ error: 'chat_not_found' }, 404)
  return c.json(updated)
})

app.delete('/:id/chats/:cid', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const active = getActiveChat(novelId)
  if (active?.chatId === chatId) releaseChat(novelId)
  await deleteChatStorage(novelId, chatId)
  return c.body(null, 204)
})

// ───── Send message (SSE) ──────────────────────────────────────────────────

app.post('/:id/chats/:cid/message', async (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')

  const chat = await getChat(novelId, chatId)
  if (!chat) return c.json({ error: 'chat_not_found' }, 404)

  // active 锁判断
  const active = getActiveChat(novelId)
  if (active && active.chatId !== chatId) {
    return c.json({ error: 'another_chat_running', activeChatId: active.chatId }, 409)
  }
  const existing = active ? getChatEntry(novelId, chatId) : null
  if (existing?.isStreaming) {
    return c.json({ error: 'chat_busy' }, 409)
  }

  let content = ''
  try {
    const body = await c.req.json<{ content?: string }>()
    content = body.content ?? ''
  } catch { /* empty OK */ }

  // 懒加载 session
  let entry: ChatEntry
  if (existing) {
    entry = existing
  } else {
    const session = await createChatAgent({ novelId, chatId })
    entry = claimChat({ novelId, chatId, session })
  }

  if (content.trim()) {
    await touchChatLastMsg(novelId, chatId, content.trim())
  }

  return runWithStream(
    c.req.raw.signal,
    entry,
    content.trim() || null,
  )
})

app.post('/:id/chats/:cid/stop', (c) => {
  const novelId = c.req.param('id')
  const chatId = c.req.param('cid')
  const entry = getChatEntry(novelId, chatId)
  if (!entry) return c.json({ error: 'chat_not_active' }, 404)
  releaseChat(novelId)
  return c.body(null, 204)
})

// ───── SSE plumbing ────────────────────────────────────────────────────────

function runWithStream(
  abortSignal: AbortSignal,
  entry: ChatEntry,
  userText: string | null,
): Response {
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      let closed = false
      const write = (event: AgentEvent) => {
        if (closed) return
        try {
          controller.enqueue(enc.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
        } catch { /* closed */ }
      }
      const close = () => {
        if (closed) return
        closed = true
        clearInterval(ka)
        try { unsubscribe() } catch { /* ignore */ }
        try { controller.close() } catch { /* ignore */ }
        setStreaming(entry.novelId, entry.chatId, false)
      }
      const unsubscribe = subscribeChatSession(entry.session, write, close)
      const ka = setInterval(() => {
        if (closed) return
        try { controller.enqueue(enc.encode(`: keepalive\n\n`)) } catch { /* closed */ }
      }, 15_000)
      abortSignal.addEventListener('abort', close)
      setStreaming(entry.novelId, entry.chatId, true)
      if (userText !== null) {
        entry.session.sendUserMessage(userText).catch((err: unknown) => {
          write({ type: 'error', message: (err as Error).message ?? String(err) })
          close()
        })
      }
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
        write({ type: 'tool.call', id: evt.toolCallId, name: evt.toolName, params: evt.args })
        return
      }
      case 'tool_execution_end': {
        write({ type: 'tool.result', id: evt.toolCallId, name: evt.toolName, result: evt.result })
        return
      }
      case 'agent_end': {
        write({ type: 'done' })
        close()
        return
      }
      default: {
        const t = (evt as { type?: string }).type
        if (t === 'error' || t === 'agent_error') {
          const msg =
            (evt as { error?: { message?: string }; message?: string }).error?.message ??
            (evt as { message?: string }).message ??
            `agent error: ${t}`
          write({ type: 'error', message: msg })
          close()
        }
        return
      }
    }
  })
}

export { app as agentRoutes }
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/agent-server typecheck`
Expected: 大量错误（旧文件还在）— 下一 task 删旧文件。

- [ ] **Step 3: Commit**

```bash
git add packages/agent-server/src/routes/agent.ts
git commit -m "feat(routes): rewrite agent routes as chat CRUD + SSE message endpoint"
```

---

### Task 10: 删除废弃后端文件

**Files:**
- Delete: `packages/agent-server/src/agents/outline-session.ts`
- Delete: `packages/agent-server/src/agents/writer-session.ts`
- Delete: `packages/agent-server/src/agents/batch-job.ts`
- Delete: `packages/agent-server/src/agents/batch-job.test.ts`

- [ ] **Step 1: 删除文件**

```bash
rm packages/agent-server/src/agents/outline-session.ts
rm packages/agent-server/src/agents/writer-session.ts
rm packages/agent-server/src/agents/batch-job.ts
rm packages/agent-server/src/agents/batch-job.test.ts
```

- [ ] **Step 2: 检查是否还有引用**

```bash
grep -rn "outline-session\|writer-session\|batch-job\|createOutlineAgent\|createWriterAgent\|runBatchJob\|createBatchJob" packages/agent-server/src/ packages/web/src/ 2>/dev/null
```
Expected: 无输出（如有，说明遗漏，按引用位置删除/重写）。

- [ ] **Step 3: typecheck + 跑所有 backend 测试**

Run:
```bash
pnpm --filter @novel-agent/agent-server typecheck
pnpm --filter @novel-agent/agent-server test
```
Expected: typecheck PASS（如不通过说明有遗留引用）。test PASS（registry + chat-store + 现有 validator 测试）。

- [ ] **Step 4: Commit**

```bash
git add -A packages/agent-server/
git commit -m "chore(agent): drop outline-session, writer-session, batch-job (replaced by chat-session)"
```

---

## Phase E — Frontend deps + adapter

### Task 11: 装 assistant-ui 依赖

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: 安装**

```bash
pnpm --filter @novel-agent/web add @assistant-ui/react @assistant-ui/react-markdown @radix-ui/react-popover
```

- [ ] **Step 2: 校验 package.json 写入**

```bash
grep -E '@assistant-ui|@radix-ui/react-popover' packages/web/package.json
```
Expected: 三个包都列出来。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: 现存代码有错（旧 useAgentStream 引用旧 type）— 后续 task 修。装包本身无影响。

- [ ] **Step 4: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add @assistant-ui/react + @radix-ui/react-popover"
```

---

### Task 12: chat-api.ts（前端 chat lifecycle 客户端）

**Files:**
- Create: `packages/web/src/lib/chat-api.ts`

- [ ] **Step 1: 创建 chat-api.ts**

```typescript
import type { ChatInfo, ActiveTask } from '@novel-agent/shared'

async function j<T>(r: Response): Promise<T> {
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    let extra: unknown = null
    try {
      const body = (await r.json()) as { message?: string; error?: string }
      extra = body
      msg = body.message || body.error || msg
    } catch { /* noop */ }
    const err = new Error(msg) as Error & { details?: unknown; status?: number }
    err.details = extra
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}

export const chatApi = {
  getActive: (novelId: string) =>
    fetch(`/api/agent/${novelId}/active`).then(j<ActiveTask>),

  list: (novelId: string) =>
    fetch(`/api/agent/${novelId}/chats`).then(j<ChatInfo[]>),

  create: (novelId: string, title?: string) =>
    fetch(`/api/agent/${novelId}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(title ? { title } : {}),
    }).then(j<ChatInfo>),

  rename: (novelId: string, chatId: string, title: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).then(j<ChatInfo>),

  delete: (novelId: string, chatId: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}`, { method: 'DELETE' }),

  stop: (novelId: string, chatId: string) =>
    fetch(`/api/agent/${novelId}/chats/${chatId}/stop`, { method: 'POST' }),

  messageUrl: (novelId: string, chatId: string) =>
    `/api/agent/${novelId}/chats/${chatId}/message`,
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: 本文件无错。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/chat-api.ts
git commit -m "feat(web): add chat-api lifecycle client (list/create/rename/delete/stop)"
```

---

### Task 13: chat-runtime.ts（assistant-ui ExternalStoreRuntime adapter）

**Files:**
- Create: `packages/web/src/lib/chat-runtime.ts`

- [ ] **Step 1: 创建 chat-runtime.ts**

```typescript
import { useState, useRef, useCallback, useEffect } from 'react'
import {
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type AppendMessage,
} from '@assistant-ui/react'
import { chatApi } from './chat-api.js'

export interface ChatRuntimeOptions {
  novelId: string
  chatId: string | null
}

interface ToolCallState {
  id: string
  name: string
  ok: boolean | null
  summary: string
  params?: unknown
  result?: unknown
}

interface AssistantTurn {
  id: string
  text: string
  toolCalls: ToolCallState[]
}

/**
 * Returns an AssistantRuntime that drives an assistant-ui Thread.
 * Backend SSE -> ThreadMessageLike[] mapping.
 */
export function useChatRuntime(opts: ChatRuntimeOptions) {
  const { novelId, chatId } = opts
  const [messages, setMessages] = useState<ThreadMessageLike[]>([])
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Reset thread when chat changes
  useEffect(() => {
    setMessages([])
    abortRef.current?.abort()
    abortRef.current = null
    setIsRunning(false)
  }, [chatId])

  const send = useCallback(
    async (text: string) => {
      if (!chatId) return
      // push user message
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', content: [{ type: 'text', text }] },
      ])
      const assistantId = `a-${Date.now()}`
      const turn: AssistantTurn = { id: assistantId, text: '', toolCalls: [] }
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: [{ type: 'text', text: '' }] },
      ])
      const ac = new AbortController()
      abortRef.current = ac
      setIsRunning(true)
      try {
        const resp = await fetch(chatApi.messageUrl(novelId, chatId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: text }),
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
            handleEvent(m[1]!, JSON.parse(m[2]!) as Record<string, unknown>)
          }
        }
      } finally {
        setIsRunning(false)
        abortRef.current = null
      }

      function handleEvent(type: string, payload: Record<string, unknown>) {
        if (type === 'message.delta') {
          turn.text += String(payload['content'] ?? '')
          rerender()
        } else if (type === 'message.complete') {
          turn.text = String(payload['content'] ?? turn.text)
          rerender()
        } else if (type === 'tool.call') {
          turn.toolCalls.push({
            id: String(payload['id'] ?? '?'),
            name: String(payload['name'] ?? '?'),
            ok: null,
            summary: '调用中...',
            params: payload['params'],
          })
          rerender()
        } else if (type === 'tool.result') {
          const id = String(payload['id'] ?? '')
          const tc = turn.toolCalls.find((t) => t.id === id)
          if (tc) {
            const result = payload['result'] as { ok?: boolean } | undefined
            tc.ok = result?.ok !== false
            tc.summary = result?.ok === false ? '校验失败' : '完成'
            tc.result = payload['result']
          }
          rerender()
        } else if (type === 'done') {
          // stream end
        } else if (type === 'error') {
          turn.text += `\n\n[错误] ${String(payload['message'] ?? 'unknown')}`
          rerender()
        }
      }

      function rerender() {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== turn.id) return m
            const content: ThreadMessageLike['content'] = []
            if (turn.text) content.push({ type: 'text', text: turn.text })
            for (const tc of turn.toolCalls) {
              content.push({
                type: 'tool-call',
                toolCallId: tc.id,
                toolName: tc.name,
                args: tc.params ?? {},
                result: tc.result,
              })
            }
            return { ...m, content }
          }),
        )
      }
    },
    [novelId, chatId],
  )

  const onCancel = useCallback(() => {
    abortRef.current?.abort()
    if (chatId) chatApi.stop(novelId, chatId).catch(() => {})
  }, [novelId, chatId])

  const onNew = useCallback(async (msg: AppendMessage) => {
    if (msg.role !== 'user') return
    const text = msg.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim()
    if (!text) return
    await send(text)
  }, [send])

  const runtime = useExternalStoreRuntime({
    isRunning,
    messages,
    onNew,
    onCancel,
  })

  return runtime
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: 本文件无错（assistant-ui 类型来自包）。如果 `useExternalStoreRuntime` 的 API 形态与代码不同（assistant-ui 版本差异），按当前安装版本的 d.ts 调整 — 关键概念是"我们提供 messages + isRunning + onNew + onCancel，runtime 渲染"。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/lib/chat-runtime.ts
git commit -m "feat(web): add useChatRuntime adapter for assistant-ui ExternalStoreRuntime over SSE"
```

---

## Phase F — Frontend components

### Task 14: tool-cards 组件

**Files:**
- Create: `packages/web/src/components/tool-cards/index.tsx`

- [ ] **Step 1: 创建 tool-cards/index.tsx**

```typescript
import { makeAssistantToolUI } from '@assistant-ui/react'

interface CallProps<P, R> {
  status?: { type: 'running' | 'complete' | 'incomplete' }
  args: P
  result?: R
}

function shortJson(v: unknown, max = 80): string {
  const s = JSON.stringify(v)
  if (!s) return ''
  return s.length > max ? s.slice(0, max) + '…' : s
}

function CardShell({
  name,
  args,
  result,
  status,
}: {
  name: string
  args: unknown
  result?: unknown
  status?: { type: string }
}) {
  const running = status?.type === 'running' || result === undefined
  return (
    <div className="my-1 px-3 py-2 rounded border border-neutral-200 bg-neutral-50 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-mono text-neutral-700">{name}</span>
        <span className="text-neutral-400">·</span>
        <span className={running ? 'text-amber-600' : 'text-emerald-700'}>
          {running ? '调用中...' : '完成'}
        </span>
      </div>
      <div className="mt-1 text-neutral-500 truncate">args: {shortJson(args, 120)}</div>
      {!running && (
        <div className="text-neutral-500 truncate">result: {shortJson(result, 120)}</div>
      )}
    </div>
  )
}

export const ReadToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'read',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="read" args={p.args} result={p.result} status={p.status} />
  ),
})

export const LsToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'ls',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="ls" args={p.args} result={p.result} status={p.status} />
  ),
})

export const GrepToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'grep',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="grep" args={p.args} result={p.result} status={p.status} />
  ),
})

export const UpdateMapsToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'updateMaps',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="updateMaps" args={p.args} result={p.result} status={p.status} />
  ),
})

export const WriteChapterOutlineToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'writeChapterOutline',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="writeChapterOutline" args={p.args} result={p.result} status={p.status} />
  ),
})

export const GetChapterContextToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'getChapterContext',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="getChapterContext" args={p.args} result={p.result} status={p.status} />
  ),
})

export const WriteChapterToolUI = makeAssistantToolUI<unknown, unknown>({
  toolName: 'writeChapter',
  render: (p: CallProps<unknown, unknown>) => (
    <CardShell name="writeChapter" args={p.args} result={p.result} status={p.status} />
  ),
})
```

如果 `makeAssistantToolUI` 的 prop shape 与代码不一致（API 版本差异），按 `node_modules/@assistant-ui/react` 的当前 d.ts 调整 render 签名。关键是：每个 tool name 一个 UI，给一个折叠卡。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/tool-cards/
git commit -m "feat(web): add tool-cards for 7 tools (read/ls/grep + 4 custom)"
```

---

### Task 15: MentionPopover 组件

**Files:**
- Create: `packages/web/src/components/MentionPopover.tsx`

- [ ] **Step 1: 创建 MentionPopover.tsx**

```typescript
import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api.js'

export interface MentionItem {
  label: string  // 显示文本
  token: string  // 插入到 textarea 的文本（带 @ 前缀）
  group: 'action' | 'artifact'
}

interface Props {
  novelId: string
  open: boolean
  query: string  // 用户在 @ 后面输入的过滤文字
  anchorEl: HTMLElement | null
  onSelect: (item: MentionItem) => void
  onClose: () => void
}

const STATIC_ACTIONS: MentionItem[] = [
  { label: '生成大纲', token: '@生成大纲', group: 'action' },
  { label: '生成正文', token: '@生成正文', group: 'action' },
  { label: '生成置换表', token: '@生成置换表', group: 'action' },
]

export function MentionPopover({ novelId, open, query, anchorEl, onSelect, onClose }: Props) {
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

  const items: MentionItem[] = [
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
    ...((maps?.character_map ?? []).map<MentionItem>((c) => ({
      label: `人物 ${c.target}`,
      token: `@人物${c.target}`,
      group: 'artifact',
    }))),
  ]

  const filtered = query.trim()
    ? items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : items

  const [activeIdx, setActiveIdx] = useState(0)
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
        e.preventDefault()
        const item = filtered[activeIdx]
        if (item) onSelect(item)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, activeIdx, onSelect, onClose])

  useEffect(() => setActiveIdx(0), [query])

  return (
    <Popover.Root open={open && !!anchorEl} onOpenChange={(o) => !o && onClose()}>
      <Popover.Anchor virtualRef={anchorEl ? { current: anchorEl } : undefined} />
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          className="bg-white border border-neutral-200 rounded shadow-lg min-w-[280px] max-h-[320px] overflow-y-auto p-1 text-sm"
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
```

注意：`api.listOutlines / api.listDrafts / api.getMaps` 是现有 web/src/lib/api.ts 里的方法名。如果实际方法名不同（`api.outlines / api.drafts / api.maps`），按实际改。本任务前 subagent 应先扫一眼 `packages/web/src/lib/api.ts` 确认。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/MentionPopover.tsx
git commit -m "feat(web): add MentionPopover for @ token autocomplete"
```

---

### Task 16: ChatPanel 组件（assistant-ui Thread 容器）

**Files:**
- Create: `packages/web/src/components/ChatPanel.tsx`

- [ ] **Step 1: 创建 ChatPanel.tsx**

```typescript
import { useState, useRef } from 'react'
import {
  AssistantRuntimeProvider,
  Thread,
  Composer,
  type ComposerPrimitive,
} from '@assistant-ui/react'
import { useChatRuntime } from '../lib/chat-runtime.js'
import { MentionPopover, type MentionItem } from './MentionPopover.js'
import {
  ReadToolUI, LsToolUI, GrepToolUI,
  UpdateMapsToolUI, WriteChapterOutlineToolUI,
  GetChapterContextToolUI, WriteChapterToolUI,
} from './tool-cards/index.js'

interface Props {
  novelId: string
  chatId: string | null
}

export function ChatPanel({ novelId, chatId }: Props) {
  const runtime = useChatRuntime({ novelId, chatId })
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')

  const onTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    const caret = e.target.selectionStart
    // detect @ at caret-1 (and the substring since the last @ is the query)
    const before = v.slice(0, caret)
    const lastAt = before.lastIndexOf('@')
    if (lastAt >= 0 && /^[^@\s]*$/.test(before.slice(lastAt + 1))) {
      setMentionOpen(true)
      setMentionQuery(before.slice(lastAt + 1))
    } else {
      setMentionOpen(false)
    }
  }

  const insertToken = (item: MentionItem) => {
    const ta = textareaRef.current
    if (!ta) return
    const v = ta.value
    const caret = ta.selectionStart
    const before = v.slice(0, caret)
    const after = v.slice(caret)
    const lastAt = before.lastIndexOf('@')
    const next = before.slice(0, lastAt) + item.token + ' ' + after
    // assistant-ui Composer keeps its own state; setting value programmatically requires
    // reaching into its internals. For the first cut, we just dispatch an input event.
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(ta, next)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
    ta.focus()
    const newCaret = lastAt + item.token.length + 1
    ta.setSelectionRange(newCaret, newCaret)
    setMentionOpen(false)
  }

  if (!chatId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-neutral-400">
        左侧选择或新建一个 chat
      </div>
    )
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex flex-col h-full">
        <Thread
          assistantMessage={{
            components: {
              // 各 tool 的渲染
              ToolFallback: () => null,
            },
          }}
        >
          <ReadToolUI />
          <LsToolUI />
          <GrepToolUI />
          <UpdateMapsToolUI />
          <WriteChapterOutlineToolUI />
          <GetChapterContextToolUI />
          <WriteChapterToolUI />
        </Thread>
        <Composer>
          <ComposerPrimitive.Input
            ref={textareaRef}
            onChange={onTextareaChange}
            placeholder="按 @ 引用产物或动作；Enter 发送"
            className="flex-1 px-3 py-2 border border-neutral-300 rounded text-sm resize-none"
          />
          <ComposerPrimitive.Send className="px-4 py-2 rounded bg-neutral-900 text-white text-sm" />
        </Composer>
        <MentionPopover
          novelId={novelId}
          open={mentionOpen}
          query={mentionQuery}
          anchorEl={textareaRef.current}
          onSelect={insertToken}
          onClose={() => setMentionOpen(false)}
        />
      </div>
    </AssistantRuntimeProvider>
  )
}
```

`Thread`、`Composer`、`ComposerPrimitive.Input/Send`、`AssistantRuntimeProvider` 是 assistant-ui 的标准导出。如果实际 API 形态不一致（取决于版本），看 `node_modules/@assistant-ui/react/dist/index.d.ts` 找最近的等价物。本组件目标是渲染：消息列表（用 Thread）+ 输入框（Composer）+ @ 弹窗。

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ChatPanel.tsx
git commit -m "feat(web): add ChatPanel wrapping assistant-ui Thread + Composer + MentionPopover"
```

---

### Task 17: ChatSidebar 组件

**Files:**
- Create: `packages/web/src/components/ChatSidebar.tsx`

- [ ] **Step 1: 创建 ChatSidebar.tsx**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '../lib/chat-api.js'
import clsx from 'clsx'

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
                <div className="mt-0.5 text-xs text-neutral-500 truncate">{c.last_user_text}</div>
              )}
            </div>
          )
        })}
        {(chats ?? []).length === 0 && (
          <div className="p-4 text-xs text-neutral-400 text-center">还没有 chat</div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ChatSidebar.tsx
git commit -m "feat(web): add ChatSidebar with new/select/delete + active spinner"
```

---

### Task 18: ArtifactTabs 组件

**Files:**
- Create: `packages/web/src/components/ArtifactTabs.tsx`

- [ ] **Step 1: 创建 ArtifactTabs.tsx**

```typescript
import { useState } from 'react'
import clsx from 'clsx'
import { MapsPanel } from './MapsPanel.js'
import { OutlinePanel } from './OutlinePanel.js'
import { DraftsPanel } from './DraftsPanel.js'
import { StatePanel } from './StatePanel.js'

type Tab = 'maps' | 'outlines' | 'drafts' | 'state'

interface Props {
  novelId: string
}

const TABS: [Tab, string][] = [
  ['maps', '置换表'],
  ['outlines', '大纲'],
  ['drafts', '正文'],
  ['state', 'state'],
]

export function ArtifactTabs({ novelId }: Props) {
  const [tab, setTab] = useState<Tab>('maps')
  return (
    <div className="flex flex-col h-full">
      <nav className="flex gap-1 border-b border-neutral-200 bg-neutral-50 px-2">
        {TABS.map(([key, label]) => (
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
        {tab === 'maps' && <MapsPanel novelId={novelId} />}
        {tab === 'outlines' && <OutlinePanel novelId={novelId} />}
        {tab === 'drafts' && <DraftsPanel novelId={novelId} />}
        {tab === 'state' && <StatePanel novelId={novelId} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ArtifactTabs.tsx
git commit -m "feat(web): add ArtifactTabs wrapping 4 existing panels"
```

---

### Task 19: 重写 RewritePage（3 栏全屏布局）

**Files:**
- Modify: `packages/web/src/pages/RewritePage.tsx`

- [ ] **Step 1: 整文件替换**

```typescript
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

  // 默认选中最新一个 chat
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
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: 现在主要错误来自旧文件（AgentChat / agent-api / use-agent-stream / GenerateForm / BatchJobPanel）— 下一 task 删。

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/pages/RewritePage.tsx
git commit -m "feat(web): rewrite RewritePage as full-screen 3-column layout (sidebar/chat/artifacts)"
```

---

### Task 20: 删除废弃前端文件 + 简化 use-active-task

**Files:**
- Delete: `packages/web/src/components/AgentChat.tsx`
- Delete: `packages/web/src/components/BatchJobPanel.tsx`
- Delete: `packages/web/src/components/GenerateForm.tsx`
- Delete: `packages/web/src/lib/use-agent-stream.ts`
- Delete: `packages/web/src/lib/agent-api.ts`
- Modify: `packages/web/src/lib/use-active-task.ts`

- [ ] **Step 1: 删除文件**

```bash
rm packages/web/src/components/AgentChat.tsx
rm packages/web/src/components/BatchJobPanel.tsx
rm packages/web/src/components/GenerateForm.tsx
rm packages/web/src/lib/use-agent-stream.ts
rm packages/web/src/lib/agent-api.ts
```

- [ ] **Step 2: 把 use-active-task.ts 改成走 chatApi**

```typescript
import { useQuery } from '@tanstack/react-query'
import type { ActiveTask } from '@novel-agent/shared'
import { chatApi } from './chat-api.js'

export function useActiveTask(novelId: string) {
  return useQuery<ActiveTask>({
    queryKey: ['agent-active', novelId],
    queryFn: () => chatApi.getActive(novelId),
    refetchInterval: 3_000,
  })
}
```

如果 useActiveTask 在其它文件没人引用了，可以直接整个删掉本文件——subagent 实施时先 grep 确认。

- [ ] **Step 3: 检查残留引用**

```bash
grep -rn "AgentChat\|BatchJobPanel\|GenerateForm\|use-agent-stream\|agent-api" packages/web/src/ 2>/dev/null
```
Expected: 无输出。

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @novel-agent/web typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A packages/web/
git commit -m "chore(web): drop AgentChat, BatchJobPanel, GenerateForm, agent-api, use-agent-stream"
```

---

## Phase G — 收尾

### Task 21: 全工作区 typecheck + test

**Files:**
- (verification only)

- [ ] **Step 1: pnpm typecheck**

Run: `pnpm typecheck`
Expected: 三个 package 全 PASS。

- [ ] **Step 2: pnpm test**

Run: `pnpm -r test 2>&1 | tail -40`
Expected: 所有现存单测 PASS。新加的 chat-store / registry 测试都过。

- [ ] **Step 3: 启动 dev 跑一个手动验证**

```bash
pnpm -w dev
```

预期 ✓ 项：
1. 浏览器进 `/novels/<id>/rewrite` → 看到 3 栏全屏布局
2. 左侧"+新建 chat" → 列表里出现新 chat
3. 中间发消息"@生成置换表" → assistant 回复 + tool call 卡片
4. 切到右侧"置换表" tab → 看到 maps.md 内容
5. 切到另一个 chat → chat 历史正确切换
6. 同 novel 不要试图同时跑两个 chat（前一个还在 streaming 时切其它 chat 应被 409 拦回来）

如果出现问题，记录错误信息回 plan 里，不要硬改往下。

- [ ] **Step 4: Commit final**

```bash
git status
# 如有 tsbuildinfo 等改动，加上
git add -A && git commit -m "chore: chat-first redesign complete (typecheck + tests pass)"
```

---

## Manual Verification Checklist (用户测试)

- [ ] 进改写页是 3 栏全屏，没有 max-width 居中
- [ ] 左侧能新建 chat、切换 chat、删除 chat（确认弹窗）
- [ ] 中间 chat 窗口能发消息、看到 streaming 文字、tool call 渲染成卡片
- [ ] @ 键弹出 mention popover，列出动作 + 已有大纲/正文/置换表/人物
- [ ] 选中 mention 后插入 `@大纲第N章` 格式 token
- [ ] 同 novel 同时只有一个 chat 在跑；切到别的 chat 时如有 streaming 提示先停
- [ ] 右侧 4 个 tab 能正确切置换表 / 大纲 / 正文 / state
- [ ] agent 调 updateMaps 时把所有原书角色都填进 char_map（不只主角）
- [ ] 写大纲时 plot 跟原文不撞场景（药厂 → 灵药园这种）
- [ ] 服务重启后，chat 列表和单个 chat 历史仍然在
- [ ] 删除 chat 后 `data/<id>/chats/` 下对应 jsonl 文件被清掉
