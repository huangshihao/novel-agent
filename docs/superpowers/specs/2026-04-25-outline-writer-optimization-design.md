# 大纲 / 正文改写 agent 交互优化

设计日期：2026-04-25
分支：`feat/outline-writer-optimization`

## 背景与问题

当前实现下，outline session 与 writer session 可独立、并发启动且互不感知：
- 没有"先大纲、后正文"的依赖检查；可以对没大纲的章直接启动 writer
- session 启动 = 创建空 session；用户必须再点"开始改写本批"才真正跑（system prompt 固定 1..N 全跑）
- 单章修改没有专门入口；session 绑死在初始 batch 范围
- writer 把整个 batch 跑在一个长 session 里，100 章会让 conversation history 爆炸

## 目标

1. 写正文必须依赖大纲已生成
2. 启动时让用户写"对本批的需求"（而不是空启动后再聊）
3. 对**已生成**的单章，提供"提修改意见"入口
4. writer 大批次不再共享一个超长 conversation

## 核心交互模型

### 两种触发模式

| 模式 | 入口 | 范围 |
|---|---|---|
| 生成 | 各 tab 顶部 `<GenerateForm>`：from-to 区间 + 需求文本 + 启动 | 连续区间 |
| 修改 | 左侧产物列表每行 `<ReviseButton>`：修改意见 + 提交 | 单章 |

### 同 novel 全局单活跃 session

- 任何新操作（启动批量 / 改某章）发起时，若已有活跃 session → 弹 confirm「关闭当前 session 并启动新任务」
- 不区分 role：outline session 活着时，启动 writer 也要先关；反之亦然
- 批量 writer job 跑期间所有按钮禁用（除 BatchJobPanel 上的 abort/retry/skip）

### 大纲 vs 正文的不同执行模式

| 场景 | 实现 | 是否有 chat |
|---|---|---|
| 大纲批量生成 | 一个 long session 顺序 generate N 章；跑完常驻 | ✓ 跑完可以接着聊 |
| 大纲单章修改 | 一个 short session（scope=`[n,n]`），跑完常驻 | ✓ 可继续追问 |
| 正文批量生成 | BatchJob：串行 spawn N 个 short worker session，每章一个 | ✗ 只显示进度 |
| 正文单章修改 | 一个 short session（scope=`[n,n]`），跑完常驻 | ✓ 可继续追问 |

### Session 销毁规则

- 不持久化对话历史，server 重启即丢
- 跑完 agent_end **不**自动 dispose
- 销毁触发：(a) 用户点 chat 顶部"结束 session"，(b) 用户启动下一个 novel 级操作
- BatchJob 内部 worker session 例外：每个 worker agent_end 后立即 dispose（用户不感知）

### Writer 依赖检查

启动 writer 时校验区间内每章 outline 文件存在；缺则按钮禁用 + tooltip 列出缺失章号。后端 `/writer/start` 也校验，缺则 400 + `{ error: 'missing_outlines', missing: number[] }`。

## 后端改动

### Session registry

```ts
// 全局单活跃，不分 role
type ActiveSlot =
  | { kind: 'session'; entry: SessionEntry }
  | { kind: 'batch'; job: BatchJob }
  | null

const active = new Map<novelId, ActiveSlot>()
```

`registerSession` / `createBatchJob` 检查同 novel 是否已有 active；有 → 抛错（API 层翻译为 400）。

### SessionEntry 扩展

```ts
interface SessionEntry {
  novelId: string
  role: 'outline' | 'writer'
  mode: 'generate' | 'revise'
  scope: { from: number; to: number }
  session: AgentSession
  createdAt: number
}
```

### BatchJob（writer 批量专用）

```ts
interface BatchJob {
  id: string
  novelId: string
  requirement: string
  chapters: number[]
  cursor: number          // 下一个待处理章在 chapters 里的下标
  completed: number[]
  failed: number[]
  current: number | null
  currentSession: AgentSession | null
  status: 'running' | 'paused' | 'done' | 'aborted'
  error?: string
  createdAt: number
  // SSE 事件总线（供 stream endpoint 订阅）
  emit(event: AgentEvent): void
  subscribe(listener: (event: AgentEvent) => void): () => void
}
```

worker 循环（用游标 + 队列，支持 paused 后 retry/skip 恢复）：

```ts
async function runBatchJob(job: BatchJob) {
  while (job.cursor < job.chapters.length) {
    if (job.status === 'aborted') break
    if (job.status === 'paused') return  // 等用户 retry/skip 推进 cursor 后再次调用 runBatchJob
    const n = job.chapters[job.cursor]
    job.current = n
    job.emit({ type: 'batch.worker_start', chapter: n })
    const session = await createWriterAgent({
      novelId: job.novelId,
      chapterNumber: n,
      mode: 'generate',
      requirement: job.requirement,
    })
    job.currentSession = session
    pipeAgentEventsToJob(session, job)  // 复用 subscribeAndPipe
    try {
      await session.sendUserMessage(`开始写第 ${n} 章。`)
      await waitForAgentEnd(session)
      job.completed.push(n)
      job.cursor += 1
      job.emit({ type: 'batch.worker_end', chapter: n, ok: true })
    } catch (err) {
      job.error = String(err)
      job.status = 'paused'
      job.emit({ type: 'batch.worker_end', chapter: n, ok: false, error: String(err) })
      // 不推进 cursor；等用户决定 retry（重跑同 cursor）/ skip（cursor++ 推进）/ abort
    } finally {
      session.dispose()
      job.currentSession = null
    }
    job.emit({ type: 'batch.progress', completed: job.completed.length, total: job.chapters.length, current: job.current })
  }
  if (job.status === 'running') {
    job.status = 'done'
    job.emit({ type: 'batch.done' })
  }
}

// retry / skip 端点的实现：
// retry: job.error = undefined; job.status = 'running'; runBatchJob(job)  // 不动 cursor
// skip:  job.failed.push(job.chapters[job.cursor]); job.cursor += 1; job.error = undefined;
//        job.status = 'running'; runBatchJob(job)
```

### API 改动

```
POST /api/agent/:id/outline/start
  body: { from, to, requirement }
  返回: AgentSessionInfo
  错误: 400 has_active_session / range_invalid

POST /api/agent/:id/writer/start
  body: { from, to, requirement }
  返回: BatchJobInfo
  错误: 400 has_active_session / missing_outlines / range_invalid

POST /api/agent/:id/outline/revise
  body: { number, feedback }
  返回: AgentSessionInfo
  错误: 400 has_active_session / no_existing_outline

POST /api/agent/:id/writer/revise
  body: { number, feedback }
  返回: AgentSessionInfo
  错误: 400 has_active_session / no_existing_draft

GET /api/agent/:id/active
  返回: { session?: AgentSessionInfo, batchJob?: BatchJobInfo } | null

POST /api/agent/session/:sid/message     # 长 session 追加消息（无变化）
DELETE /api/agent/session/:sid           # 显式关闭
POST /api/agent/session/:sid/run         # 删除（启动时已带 requirement）

GET /api/agent/job/:jid                  # BatchJob 详情
GET /api/agent/job/:jid/stream           # SSE：进度 + 当前 worker stream
POST /api/agent/job/:jid/abort
POST /api/agent/job/:jid/retry           # 重试当前 paused 的章
POST /api/agent/job/:jid/skip            # 跳过 paused 的章继续下一个
DELETE /api/agent/job/:jid               # 清理 done/aborted 的 job
```

### shared types 新增

```ts
type AgentSessionInfo = {
  id: string
  role: 'outline' | 'writer'
  mode: 'generate' | 'revise'
  scope: { from: number; to: number }
  created_at: number
}

type BatchJobInfo = {
  id: string
  novelId: string
  requirement: string
  chapters: number[]
  completed: number[]
  failed: number[]
  current: number | null
  status: 'running' | 'paused' | 'done' | 'aborted'
  error?: string
  created_at: number
}

type ActiveTask =
  | { kind: 'session'; session: AgentSessionInfo }
  | { kind: 'batch'; batch: BatchJobInfo }
  | null

type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; name: string; params: unknown }
  | { type: 'tool.result'; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'batch.progress'; completed: number; total: number; current: number | null }
  | { type: 'batch.worker_start'; chapter: number; sessionId?: string }
  | { type: 'batch.worker_end'; chapter: number; ok: boolean; error?: string }
  | { type: 'batch.done' }
  | { type: 'batch.aborted' }
```

## System prompt 改动

### outline

```
═══ 任务模式 ═══
{{mode}}

[generate]
- 区间：第 {from} - {to} 章
- 用户对本批整体需求：{requirement || '无'}
- 工作流：
  1. read source/meta.md / source/characters/
  2. 处理 maps（updateMaps）
  3. ls target/outlines/ 看已存在
  4. 对未生成的每个 number ∈ [from..to]：read source/chapters/<n>.md → 决定字段 → writeChapterOutline

═══ 用户对话改章（generate 模式跑完后仍可用） ═══
- 若用户后续在 chat 里说"第 N 章 X 处改成 Y"（N 必须在 [from..to] 内）：
  1. read 现有 target/outlines/<N>.md
  2. 仅改用户提到的字段，**保持未涉及的字段字面相同**
  3. writeChapterOutline upsert
  4. 简洁回复改了什么

[revise]
- 仅处理第 {number} 章（scope 严格 = [number,number]，不要触碰其他章）
- 用户修改意见：{feedback}
- 工作流：
  1. read target/outlines/<number>.md 拿现有版本
  2. 仅按用户意见调整对应字段
  3. **保持未涉及的字段字面相同**
  4. writeChapterOutline upsert
```

> **设计说明**：generate 模式保留"对话改章"分支，让 long session 跑完后的 chat 继续有意义；
> 用户也可以走 `<ReviseButton>` 显式触发——那会 dispose 当前 long session 新开 revise 短 session，
> 适用于"已经关了 session、第二天回来改某章"的冷启动场景。两条路径殊途同归。

### writer（每个 worker 一章）

```
═══ 任务 ═══
你只负责写第 {n} 章一章，写完即结束。
{{mode === 'generate' ? `用户对本批的整体需求：${requirement || '无'}` : ''}}

[generate]
工作流：
  1. getChapterContext({number: n})
  2. 写正文（按约束）
  3. writeChapter({number: n, ...})
  4. 验证失败按 issues 修正后重调
  5. 完成

[revise]
- 用户修改意见：{feedback}
- 工作流：
  1. read target/chapters/{n}.md 拿现有版本
  2. 仅按意见局部修改，**保持未涉及的段落字面相同**——不要全部重写
  3. writeChapter upsert
```

## UI 改动

### `RewritePage.tsx`
- header：返回链接 + 小说标题 + 当前活跃任务徽章 + 全局"结束 session"按钮
- 移除原 from-to 输入与启动按钮（下沉到各 tab）
- 右侧 aside：state panel 上半 + 活跃任务 panel 下半（chat 或 BatchJobPanel）

### 新组件
- `<GenerateForm role>`：from-to + requirement + 启动按钮（带 writer 缺大纲检查）
- `<ReviseButton novelId role number>`：行内"改"按钮 + 弹 inline 面板
- `<BatchJobPanel jobId>`：进度 + 当前 worker 实时 stream + abort/retry/skip 按钮

### 各 tab 变化
- `OutlinePanel`：顶部插 `<GenerateForm role='outline'>`；列表行末加 `<ReviseButton>`
- `DraftsPanel`：同上 + 表头状态徽章
- `MapsPanel`：不变（maps 已经只在 outline session 里间接更新）

### `AgentChat.tsx`
- 顶部加"结束 session" + mode 标签
- 当 active 是 batch 时整个面板替换为 `<BatchJobPanel>`

### Hooks
- `useActiveTask(novelId)`：轮询 `/api/agent/:id/active`，返回 `ActiveTask`
- `useAgentStream(sessionId)`：无变化（继续给 chat 用）
- `useBatchStream(jobId)`：新 hook，消费 `/job/:jid/stream`，暴露 progress / current / 当前 worker stream

## 出错策略

### 单 worker 失败
- BatchJob `status='paused'`，currentSession dispose
- UI 显示 error + 三个按钮：重试 / 跳过 / 中止
- 重试：重 spawn worker 跑同一章
- 跳过：把章塞 `failed[]`，跑下一章
- 中止：dispose 整个 job

### 长 session 报错
- 写到 chat 流里 `{ type: 'error' }`
- session 不自动 dispose（用户可看错误后决定继续聊还是关闭）

## 不做的事（YAGNI）

- 不持久化 session 对话
- 不在大纲批量里做 fan-out（typical 体量在 100K tokens 内 OK）
- 不做"对一段文字提意见"的细粒度修改（用整章 revise 兜底）
- 不做 idle timeout 自动 dispose
- 不做 session 历史回看（关了就没了）
