# Plan 2：Agent 工具 + 大纲/写作 Agent（后端）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 的 MD 存储基础上，接入 `@mariozechner/pi-coding-agent` SDK，实现 4 个自定义工具 + 大纲 agent + 写作 agent。**完成后**：能通过 REST API 跑改写流程（CLI 调用），后端完整能力到位，UI 留 Plan 3 处理。

**Architecture:**
- 新建 `packages/agent-server/src/storage/target-*.ts`：管理 `data/<id>/target/{maps,state,outlines,chapters}/**` 的读写
- 新建 `packages/agent-server/src/agents/`：model 配置、4 个 tool 实现、两个 AgentSession 工厂、validator
- 新建 `packages/agent-server/src/routes/agent.ts`：REST + SSE 端点驱动 agent 运行 / 接收对话
- 反漂移核心：`writeChapter` 内部强校验（人名 / 死人硬拒，原行业词软警告）+ 写后自动派生 state 变更

**Tech Stack:**
- `@mariozechner/pi-coding-agent` ^0.64.0（agent runtime + 内置 read/grep/ls 工具）
- `@mariozechner/pi-ai` ^0.64.0（Model<> 类型）
- `@mariozechner/pi-agent-core` ^0.64.0（ToolDefinition）
- `@sinclair/typebox` ^0.34（工具参数 schema）
- 已有：gray-matter, hono, vitest

**约定：**
- 所有 commit 不要 `Co-Authored-By: Claude`
- 每 commit 前 `pnpm typecheck` 全绿
- 单测放 `*.test.ts` 与源同目录
- AGENT_API_KEY / AGENT_MODEL / AGENT_BASE_URL 已在 `.env`，provider 注册键 `'baiduqianfancodingplan'`

**前置参考：**
- 设计 spec：`docs/superpowers/specs/2026-04-25-novel-rewrite-agent-design.md`
- play-agent 实现样本：`/Users/horace/playground/play-agent/packages/agent-server/src/session.ts`、`bim-extension/src/index.ts`、`bim-extension/src/tools/{discover,call}.ts`

---

## Task 1：安装 pi-coding-agent + 相关依赖

**Files:**
- Modify: `packages/agent-server/package.json`

- [ ] **Step 1：安装**

```bash
cd /Users/horace/playground/novel-agent
pnpm --filter @novel-agent/agent-server add @mariozechner/pi-coding-agent@^0.64.0 @mariozechner/pi-ai@^0.64.0 @mariozechner/pi-agent-core@^0.64.0 @sinclair/typebox@^0.34
```

- [ ] **Step 2：typecheck**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/package.json /Users/horace/playground/novel-agent/pnpm-lock.yaml
git commit -m "chore(agent-server): add pi-coding-agent and typebox deps"
```

---

## Task 2：target paths 扩展 + maps.md / state.md 类型

**Files:**
- Modify: `packages/agent-server/src/storage/paths.ts`
- Modify: `packages/agent-server/src/storage/paths.test.ts`

- [ ] **Step 1：扩展 paths.ts，加 target 路径**

在现有 `paths` 对象里追加：

```typescript
export const paths = {
  // ... 已有 source 路径
  targetDir: (id: string) => join(root(), id, 'target'),
  targetMaps: (id: string) => join(root(), id, 'target', 'maps.md'),
  targetState: (id: string) => join(root(), id, 'target', 'state.md'),
  targetOutlinesDir: (id: string) => join(root(), id, 'target', 'outlines'),
  targetOutline: (id: string, n: number) =>
    join(root(), id, 'target', 'outlines', `${pad4(n)}.md`),
  targetChaptersDir: (id: string) => join(root(), id, 'target', 'chapters'),
  targetChapter: (id: string, n: number) =>
    join(root(), id, 'target', 'chapters', `${pad4(n)}.md`),
}
```

- [ ] **Step 2：扩展 paths.test.ts**

加 5 个新路径的格式断言（zero-pad、目录正确性）。

- [ ] **Step 3：测试 + commit**

```bash
pnpm --filter @novel-agent/agent-server test
git add packages/agent-server/src/storage/paths.ts packages/agent-server/src/storage/paths.test.ts
git commit -m "feat(storage): add target/* paths for rewrite output"
```

---

## Task 3：target-writer.ts（maps / outline / chapter draft）

**Files:**
- Create: `packages/agent-server/src/storage/target-writer.ts`
- Create: `packages/agent-server/src/storage/target-writer.test.ts`

- [ ] **Step 1：定义类型 + writer 函数**

```typescript
import { writeMd } from './markdown.js'
import { paths } from './paths.js'

export interface CharacterMapEntry {
  source: string
  target: string
  note?: string
}

export interface SettingMap {
  original_industry: string
  target_industry: string
  key_term_replacements: Record<string, string>
}

export interface MapsRecord {
  character_map: CharacterMapEntry[]
  setting_map: SettingMap | null
}

export interface OutlineRecord {
  number: number
  source_chapter_ref: number
  hooks_to_plant: string[]
  hooks_to_payoff: string[]
  planned_state_changes: {
    character_deaths: string[]
    new_settings: string[]
  }
  plot: string
  key_events: string[]
}

export interface ChapterDraftRecord {
  number: number
  title: string
  word_count: number
  written_at: string
  content: string
}

export async function writeMaps(novelId: string, rec: MapsRecord): Promise<void> {
  await writeMd(paths.targetMaps(novelId), { ...rec }, '')
}

export async function writeOutline(novelId: string, rec: OutlineRecord): Promise<void> {
  const fm = {
    number: rec.number,
    source_chapter_ref: rec.source_chapter_ref,
    hooks_to_plant: rec.hooks_to_plant,
    hooks_to_payoff: rec.hooks_to_payoff,
    planned_state_changes: rec.planned_state_changes,
  }
  const body =
    `## 剧情\n${rec.plot.trim()}\n\n` +
    `## 关键事件\n${rec.key_events.map((e) => `- ${e}`).join('\n')}\n`
  await writeMd(paths.targetOutline(novelId, rec.number), fm, body)
}

export async function writeChapterDraft(
  novelId: string,
  rec: ChapterDraftRecord,
): Promise<void> {
  const fm = {
    number: rec.number,
    title: rec.title,
    word_count: rec.word_count,
    written_at: rec.written_at,
  }
  await writeMd(paths.targetChapter(novelId, rec.number), fm, rec.content)
}
```

- [ ] **Step 2：测试覆盖**

最少 4 个测试：
- `writeMaps` round-trip（含 setting_map: null 情况）
- `writeOutline` body 含 ## 剧情 + ## 关键事件 sections
- `writeChapterDraft` body 是纯正文，front matter 含 word_count
- 写两次 outline 同一 number → 后写覆盖（upsert）

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/storage/target-writer.ts packages/agent-server/src/storage/target-writer.test.ts
git commit -m "feat(storage): add target writers for maps/outline/chapter-draft"
```

---

## Task 4：target-reader.ts

**Files:**
- Create: `packages/agent-server/src/storage/target-reader.ts`
- Create: `packages/agent-server/src/storage/target-reader.test.ts`

- [ ] **Step 1：实现 readers**

```typescript
import { readFile } from 'node:fs/promises'
import { listFrontMatter, readMdIfExists } from './markdown.js'
import { paths } from './paths.js'
import type {
  ChapterDraftRecord,
  MapsRecord,
  OutlineRecord,
} from './target-writer.js'

export async function readMaps(novelId: string): Promise<MapsRecord | null> {
  const md = await readMdIfExists<MapsRecord>(paths.targetMaps(novelId))
  return md ? md.frontMatter : null
}

export async function readOutline(
  novelId: string,
  number: number,
): Promise<OutlineRecord | null> {
  const md = await readMdIfExists(paths.targetOutline(novelId, number))
  if (!md) return null
  const fm = md.frontMatter as Partial<OutlineRecord>
  const plotMatch = md.body.match(/##\s*剧情\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const eventsMatch = md.body.match(/##\s*关键事件\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const events = (eventsMatch?.[1] ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return {
    number: fm.number ?? number,
    source_chapter_ref: fm.source_chapter_ref ?? number,
    hooks_to_plant: fm.hooks_to_plant ?? [],
    hooks_to_payoff: fm.hooks_to_payoff ?? [],
    planned_state_changes: fm.planned_state_changes ?? { character_deaths: [], new_settings: [] },
    plot: plotMatch?.[1]?.trim() ?? '',
    key_events: events,
  }
}

export async function listOutlines(
  novelId: string,
  range?: { from: number; to: number },
): Promise<OutlineRecord[]> {
  const items = await listFrontMatter<OutlineRecord>(paths.targetOutlinesDir(novelId))
  const nums = items
    .map((i) => i.frontMatter.number)
    .filter((n) => !range || (n >= range.from && n <= range.to))
    .sort((a, b) => a - b)
  const out: OutlineRecord[] = []
  for (const n of nums) {
    const o = await readOutline(novelId, n)
    if (o) out.push(o)
  }
  return out
}

export async function readChapterDraft(
  novelId: string,
  number: number,
): Promise<ChapterDraftRecord | null> {
  const md = await readMdIfExists(paths.targetChapter(novelId, number))
  if (!md) return null
  const fm = md.frontMatter as Partial<ChapterDraftRecord>
  return {
    number: fm.number ?? number,
    title: fm.title ?? '',
    word_count: fm.word_count ?? 0,
    written_at: fm.written_at ?? '',
    content: md.body.trim(),
  }
}

export async function listChapterDrafts(
  novelId: string,
): Promise<ChapterDraftRecord[]> {
  const items = await listFrontMatter<ChapterDraftRecord>(
    paths.targetChaptersDir(novelId),
  )
  const out: ChapterDraftRecord[] = []
  for (const item of items) {
    const r = await readChapterDraft(novelId, item.frontMatter.number)
    if (r) out.push(r)
  }
  return out.sort((a, b) => a.number - b.number)
}
```

- [ ] **Step 2：测试**

至少 4 个测试，覆盖 round-trip / range filter / null on missing。

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/storage/target-reader.ts packages/agent-server/src/storage/target-reader.test.ts
git commit -m "feat(storage): add target readers for maps/outline/chapter-draft"
```

---

## Task 5：state.ts（state.md 读写 + 初始化 + diff 派生）

**Files:**
- Create: `packages/agent-server/src/storage/state.ts`
- Create: `packages/agent-server/src/storage/state.test.ts`

`state.md` 跟踪改写过程的两件事：角色 alive/dead + 长线 hook open/paid_off。**首次** `updateMaps` 后初始化；`writeChapter` 写完后由 `applyChapterStateDiff` 派生更新。

- [ ] **Step 1：定义 + 实现**

```typescript
import { readMdIfExists, writeMd } from './markdown.js'
import { paths } from './paths.js'
import { readSourceHooks, listSourceCharacters } from './source-reader.js'
import { readMaps } from './target-reader.js'
import type { OutlineRecord } from './target-writer.js'

export interface AliveStatus {
  alive: boolean
  last_seen_chapter: number
  death_chapter?: number
}

export interface NewHook {
  id: string
  description: string
  planted_chapter: number
  expected_payoff_chapter: number | null
  status: 'open' | 'paid_off'
  paid_chapter?: number
}

export interface StateRecord {
  alive_status: Record<string, AliveStatus>
  hooks: Record<string, { status: 'open' | 'paid_off'; paid_chapter?: number }>
  new_hooks: NewHook[]
}

export async function readState(novelId: string): Promise<StateRecord | null> {
  const md = await readMdIfExists<StateRecord>(paths.targetState(novelId))
  return md ? md.frontMatter : null
}

export async function writeState(novelId: string, rec: StateRecord): Promise<void> {
  await writeMd(paths.targetState(novelId), rec as unknown as Record<string, unknown>, '')
}

/**
 * 第一次 updateMaps 后调用：从 maps.md.character_map 初始化 alive_status，
 * 从 source/hooks.md 拷贝所有 hook 为 open。
 */
export async function initStateIfMissing(novelId: string): Promise<StateRecord> {
  const existing = await readState(novelId)
  if (existing) return existing
  const maps = await readMaps(novelId)
  const sourceHooks = await readSourceHooks(novelId)
  const alive_status: Record<string, AliveStatus> = {}
  for (const e of maps?.character_map ?? []) {
    alive_status[e.target] = { alive: true, last_seen_chapter: 0 }
  }
  const hooks: StateRecord['hooks'] = {}
  for (const h of sourceHooks) {
    hooks[h.id] = { status: 'open' }
  }
  const init: StateRecord = { alive_status, hooks, new_hooks: [] }
  await writeState(novelId, init)
  return init
}

/**
 * writeChapter 写入成功后调用：根据 outline.planned_state_changes 派生更新。
 */
export async function applyChapterStateDiff(
  novelId: string,
  chapterNumber: number,
  outline: OutlineRecord,
  characters_appeared: string[],
): Promise<void> {
  const cur = (await readState(novelId)) ?? (await initStateIfMissing(novelId))

  // 角色 last_seen 更新
  for (const name of characters_appeared) {
    const s = cur.alive_status[name]
    if (s) s.last_seen_chapter = chapterNumber
  }

  // 死亡声明
  for (const dead of outline.planned_state_changes.character_deaths) {
    cur.alive_status[dead] = {
      alive: false,
      last_seen_chapter: chapterNumber,
      death_chapter: chapterNumber,
    }
  }

  // 钩子兑现
  for (const id of outline.hooks_to_payoff) {
    if (cur.hooks[id]) {
      cur.hooks[id] = { status: 'paid_off', paid_chapter: chapterNumber }
    } else {
      const nh = cur.new_hooks.find((x) => x.id === id)
      if (nh) {
        nh.status = 'paid_off'
        nh.paid_chapter = chapterNumber
      }
    }
  }

  // 新钩子开埋（hooks_to_plant 引用的 id 不在 source/hooks 也不在 new_hooks 时——本章新埋）
  for (const id of outline.hooks_to_plant) {
    if (cur.hooks[id]) continue
    if (cur.new_hooks.some((x) => x.id === id)) continue
    cur.new_hooks.push({
      id,
      description: '',
      planted_chapter: chapterNumber,
      expected_payoff_chapter: null,
      status: 'open',
    })
  }

  await writeState(novelId, cur)
}
```

- [ ] **Step 2：测试覆盖**

至少 5 个测试：
- `initStateIfMissing` 从空开始：alive_status 用 character_map.target 初始化、hooks 拷贝 source/hooks 全为 open
- `initStateIfMissing` 已有 state 则返回现有不覆盖
- `applyChapterStateDiff` 死亡声明：角色变 dead + death_chapter
- `applyChapterStateDiff` 兑现 source hook：state.hooks[id].status 变 paid_off
- `applyChapterStateDiff` 兑现 new hook：new_hooks 数组里对应条目变 paid_off

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/storage/state.ts packages/agent-server/src/storage/state.test.ts
git commit -m "feat(storage): add state.md (alive/dead + hook open/paid_off) with init and diff"
```

---

## Task 6：validator.ts（writeChapter 校验逻辑）

**Files:**
- Create: `packages/agent-server/src/agents/validator.ts`
- Create: `packages/agent-server/src/agents/validator.test.ts`

- [ ] **Step 1：实现 3 类校验**

```typescript
import type { MapsRecord } from '../storage/target-writer.js'
import type { StateRecord } from '../storage/state.js'

export type IssueLevel = 'error' | 'warning'

export interface ValidationIssue {
  level: IssueLevel
  message: string
  hits?: string[]
}

export interface ValidationContext {
  maps: MapsRecord
  state: StateRecord
}

/** 扫人名：所有出现的人名必须在 character_map.target 列表里。漏注册 → error。 */
export function validateNames(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  const known = new Set(ctx.maps.character_map.map((e) => e.target))
  // 简单中文人名匹配：连续 2-4 个汉字后跟动作/情感词。改进版可用更精的 NER。
  // V1：对每个 known.target，检查 content 里出现频次。同时找未注册的 2-4 字"姓名状"。
  // 此处实现一个保守版：检查显式提到的所有 known 名字 OK；
  // 找不到的"潜在人名"用启发式扫描，但只抛 hits 让 LLM 决策。
  const unregistered: Set<string> = new Set()
  // 启发式：匹配 [一-龥]{2,4}(说|笑|看|走|站|坐|回头|拿|抬头) 这类组合的开头部分
  const re = /([一-龥]{2,4})(?=说|笑|看|走|站|坐|回头|拿|抬头|皱眉|开口)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const name = m[1]!
    if (!known.has(name) && name.length >= 2) unregistered.add(name)
  }
  if (unregistered.size === 0) return null
  return {
    level: 'error',
    message: `检测到 ${unregistered.size} 个未在 character_map 注册的疑似人名`,
    hits: [...unregistered],
  }
}

/** 扫死人：state.alive_status[name].alive === false 的角色不应在正文里有动作。 */
export function validateAlive(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  const dead: string[] = []
  for (const [name, s] of Object.entries(ctx.state.alive_status)) {
    if (s.alive) continue
    if (content.includes(name)) dead.push(name)
  }
  if (dead.length === 0) return null
  return {
    level: 'error',
    message: `${dead.length} 个已死亡角色在正文中出现`,
    hits: dead,
  }
}

/** 扫原行业词：setting_map.key_term_replacements 的 key（白名单外）出现 → warning。 */
export function validateSettingTerms(
  content: string,
  ctx: ValidationContext,
): ValidationIssue | null {
  if (!ctx.maps.setting_map) return null
  const residue: string[] = []
  for (const original of Object.keys(ctx.maps.setting_map.key_term_replacements)) {
    if (content.includes(original)) residue.push(original)
  }
  if (residue.length === 0) return null
  return {
    level: 'warning',
    message: `检测到 ${residue.length} 个原行业关键词残留`,
    hits: residue,
  }
}

export function validateChapterContent(
  content: string,
  ctx: ValidationContext,
): ValidationIssue[] {
  return [
    validateNames(content, ctx),
    validateAlive(content, ctx),
    validateSettingTerms(content, ctx),
  ].filter((x): x is ValidationIssue => x !== null)
}
```

- [ ] **Step 2：测试覆盖**

至少 6 个测试：
- 全 OK 场景：返回空数组
- 死人复活：error
- 未注册人名：error + hits
- 原行业词残留：warning + hits
- setting_map 为 null 时不抛 setting warning
- 全人名都 known + 全 alive + setting 已替换 → 空

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/agents/validator.ts packages/agent-server/src/agents/validator.test.ts
git commit -m "feat(agents): add chapter content validators (names/alive/setting)"
```

---

## Task 7：agent model 配置

**Files:**
- Create: `packages/agent-server/src/agents/model.ts`

- [ ] **Step 1：实现**

```typescript
import type { Model } from '@mariozechner/pi-ai'

export const AGENT_PROVIDER = 'baiduqianfancodingplan'

export function buildAgentModel(): Model<'openai-completions'> {
  return {
    id: process.env['AGENT_MODEL'] ?? 'qianfan-code-latest',
    name: 'Qianfan Code Latest',
    api: 'openai-completions',
    provider: AGENT_PROVIDER,
    baseUrl: process.env['AGENT_BASE_URL'] ?? 'https://qianfan.baidubce.com/v2/coding',
    reasoning: false,
    input: ['text'],
    cost: { input: 0.0025, output: 0.01, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 98304,
    maxTokens: 65536,
    compat: {
      supportsDeveloperRole: false,
      supportsStore: false,
      supportsReasoningEffort: false,
      maxTokensField: 'max_tokens',
    },
  }
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/model.ts
git commit -m "feat(agents): add Qianfan model config (env-driven, swap provider via .env)"
```

---

## Task 8：Tool: updateMaps

**Files:**
- Create: `packages/agent-server/src/agents/tools/update-maps.ts`

- [ ] **Step 1：实现**

```typescript
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps } from '../../storage/target-reader.js'
import { writeMaps, type MapsRecord, type CharacterMapEntry, type SettingMap } from '../../storage/target-writer.js'
import { initStateIfMissing } from '../../storage/state.js'

export function buildUpdateMapsTool(novelId: string): ToolDefinition {
  return {
    name: 'updateMaps',
    label: '更新置换表',
    description:
      '写入或更新角色置换表（原名 → 新名）和题材置换（原行业 → 新行业 + 关键词替换映射）。Upsert 语义：character_entries 按 source 主键合并；setting 给值则整体替换，给 null 则保留现状。',
    promptSnippet:
      'updateMaps({character_entries?, setting?}) - 写置换表（角色映射 + 题材替换）',
    promptGuidelines: [
      '**首次运行时**先 read target/maps.md 看当前状态（如果存在）',
      'character_entries 的 source 必须是原书角色 canonical_name（read source/characters/ 找）',
      'character_entries 的 target 是改写后的名字，由你根据 source role / 行业风格生成；用户后续可改',
      'setting 的 original_industry 来自 source/meta.md 的 industry 字段；target_industry 由你决定（如果用户没指定）',
      'setting.key_term_replacements 列出原行业关键名词到新行业的对应映射，5-15 条',
    ],
    parameters: Type.Object({
      character_entries: Type.Optional(
        Type.Array(
          Type.Object({
            source: Type.String(),
            target: Type.String(),
            note: Type.Optional(Type.String()),
          }),
        ),
      ),
      setting: Type.Optional(
        Type.Object({
          original_industry: Type.String(),
          target_industry: Type.String(),
          key_term_replacements: Type.Record(Type.String(), Type.String()),
        }),
      ),
    }),
    async execute(_id, params) {
      const { character_entries, setting } = params as {
        character_entries?: CharacterMapEntry[]
        setting?: SettingMap
      }
      const existing: MapsRecord = (await readMaps(novelId)) ?? {
        character_map: [],
        setting_map: null,
      }
      if (character_entries?.length) {
        const map = new Map(existing.character_map.map((e) => [e.source, e]))
        for (const e of character_entries) map.set(e.source, e)
        existing.character_map = [...map.values()]
      }
      if (setting !== undefined) {
        existing.setting_map = setting
      }
      await writeMaps(novelId, existing)
      await initStateIfMissing(novelId)
      const result = {
        ok: true,
        character_map_size: existing.character_map.length,
        setting_set: existing.setting_map !== null,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/tools/update-maps.ts
git commit -m "feat(agents): add updateMaps tool"
```

---

## Task 9：Tool: writeChapterOutline

**Files:**
- Create: `packages/agent-server/src/agents/tools/write-chapter-outline.ts`

`writeChapterOutline` 接受 number / source_chapter_ref / plot / hooks_to_plant / hooks_to_payoff / planned_state_changes，校验 hook id 存在性，upsert 写文件。

- [ ] **Step 1：实现（含 precondition 校验）**

```typescript
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readSourceHooks } from '../../storage/source-reader.js'
import { writeOutline, type OutlineRecord } from '../../storage/target-writer.js'
import { readState } from '../../storage/state.js'

export interface BatchRange {
  from: number
  to: number
}

export function buildWriteChapterOutlineTool(
  novelId: string,
  batch: BatchRange,
): ToolDefinition {
  return {
    name: 'writeChapterOutline',
    label: '写章节大纲',
    description:
      '写入或覆盖某章的大纲（章级）。precondition：number 必须在本批范围内；hooks_to_plant / hooks_to_payoff 引用的 id 必须存在于 source/hooks.md 或 state.new_hooks（hooks_to_plant 允许新 id，自动登记）；planned_state_changes.character_deaths 提到的角色当前必须 alive。',
    promptSnippet: 'writeChapterOutline({number, ...}) - 写章级大纲（upsert）',
    promptGuidelines: [
      `本批范围：${batch.from}-${batch.to}。number 必须在此范围内`,
      'plot 是 200-400 字大纲（中文，已应用置换表）',
      'hooks_to_plant 列本章要新埋的长线伏笔（id 是你自定义的，nhk-001 风格）；hooks_to_payoff 列本章兑现的伏笔 id（必须已在 source/hooks 或 state.new_hooks）',
      'planned_state_changes.character_deaths 里的角色名必须用 character_map.target 形式',
      '本批已写过的章节大纲可通过 read target/outlines/<n>.md 查看',
    ],
    parameters: Type.Object({
      number: Type.Number(),
      source_chapter_ref: Type.Number(),
      plot: Type.String(),
      key_events: Type.Array(Type.String()),
      hooks_to_plant: Type.Array(Type.String()),
      hooks_to_payoff: Type.Array(Type.String()),
      planned_state_changes: Type.Object({
        character_deaths: Type.Array(Type.String()),
        new_settings: Type.Array(Type.String()),
      }),
    }),
    async execute(_id, params) {
      const p = params as OutlineRecord
      const issues: string[] = []
      if (p.number < batch.from || p.number > batch.to) {
        issues.push(`number ${p.number} 超出本批范围 ${batch.from}-${batch.to}`)
      }
      const sourceHooks = await readSourceHooks(novelId)
      const state = await readState(novelId)
      const knownHookIds = new Set([
        ...sourceHooks.map((h) => h.id),
        ...(state?.new_hooks.map((h) => h.id) ?? []),
      ])
      for (const id of p.hooks_to_payoff) {
        if (!knownHookIds.has(id)) issues.push(`hooks_to_payoff: 未知 hook id "${id}"`)
      }
      for (const dead of p.planned_state_changes.character_deaths) {
        if (state && state.alive_status[dead]?.alive === false) {
          issues.push(`character_deaths: ${dead} 已经死亡，不能再次声明`)
        }
      }
      if (issues.length > 0) {
        const result = { ok: false, issues }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        }
      }
      await writeOutline(novelId, p)
      const result = { ok: true, saved_path: `target/outlines/${String(p.number).padStart(4, '0')}.md` }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/tools/write-chapter-outline.ts
git commit -m "feat(agents): add writeChapterOutline tool with hook/death preconditions"
```

---

## Task 10：Tool: getChapterContext

**Files:**
- Create: `packages/agent-server/src/agents/tools/get-chapter-context.ts`

打包返回写本章正文所需的全部 context：本章 outline + 置换表 + 最近 3 章 target chapter 正文 + 涉及角色 alive/dead + 涉及伏笔状态 + 第 1 章特殊：风格样本。

- [ ] **Step 1：实现**

```typescript
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps } from '../../storage/target-reader.js'
import {
  readChapterDraft,
  readOutline,
} from '../../storage/target-reader.js'
import { readState } from '../../storage/state.js'
import { readSourceHooks, readSourceMeta } from '../../storage/source-reader.js'

export function buildGetChapterContextTool(novelId: string): ToolDefinition {
  return {
    name: 'getChapterContext',
    label: '获取写章 context 包',
    description:
      '一次性返回写本章正文需要的全部信息：大纲 + 置换表 + 最近 3 章 target 正文 + 涉及角色当前状态（alive/dead）+ 涉及伏笔状态。第 1 章特殊：附带 source/meta.md 的风格样本（学习文风用）。',
    promptSnippet: 'getChapterContext({number}) - 一次拿全写章所需 context',
    promptGuidelines: [
      '写每一章正文前**必须**先调用一次',
      '返回的 maps.character_map 是写正文时人名的唯一来源',
      '返回的 alive_status 里 alive===false 的角色不能在正文里有动作（writeChapter 会硬拒）',
    ],
    parameters: Type.Object({
      number: Type.Number(),
    }),
    async execute(_id, params) {
      const { number } = params as { number: number }
      const outline = await readOutline(novelId, number)
      if (!outline) {
        const result = { ok: false, error: `outline for chapter ${number} not found` }
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          details: result,
        }
      }
      const maps = await readMaps(novelId)
      const state = await readState(novelId)
      const sourceHooks = await readSourceHooks(novelId)

      const recent: { number: number; content: string }[] = []
      for (const n of [number - 3, number - 2, number - 1].filter((n) => n >= 1)) {
        const d = await readChapterDraft(novelId, n)
        if (d) recent.push({ number: n, content: d.content })
      }

      const involved_characters = Object.entries(state?.alive_status ?? {}).map(
        ([name, s]) => ({ name, alive: s.alive, last_seen_chapter: s.last_seen_chapter }),
      )

      const hooksMap = new Map([
        ...sourceHooks.map((h) => [h.id, { id: h.id, description: h.description }] as const),
        ...(state?.new_hooks ?? []).map((h) => [h.id, { id: h.id, description: h.description }] as const),
      ])
      const involved_hooks = [
        ...outline.hooks_to_plant.map((id) => ({ ...(hooksMap.get(id) ?? { id, description: '' }), action: 'plant' as const })),
        ...outline.hooks_to_payoff.map((id) => ({ ...(hooksMap.get(id) ?? { id, description: '' }), action: 'payoff' as const })),
      ]

      const result: Record<string, unknown> = {
        outline,
        maps,
        recent_chapters: recent,
        involved_characters,
        involved_hooks,
      }

      if (number === 1 || recent.length === 0) {
        const meta = await readSourceMeta(novelId)
        result['style_samples'] = meta?.style_samples ?? []
        result['style_tags'] = meta?.style_tags ?? []
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/tools/get-chapter-context.ts
git commit -m "feat(agents): add getChapterContext packed-read tool"
```

---

## Task 11：Tool: writeChapter（含校验 + state 派生）

**Files:**
- Create: `packages/agent-server/src/agents/tools/write-chapter.ts`

- [ ] **Step 1：实现**

```typescript
import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps, readOutline } from '../../storage/target-reader.js'
import { writeChapterDraft } from '../../storage/target-writer.js'
import {
  applyChapterStateDiff,
  initStateIfMissing,
  readState,
} from '../../storage/state.js'
import { validateChapterContent } from '../validator.js'
import type { BatchRange } from './write-chapter-outline.js'

export function buildWriteChapterTool(
  novelId: string,
  batch: BatchRange,
): ToolDefinition {
  return {
    name: 'writeChapter',
    label: '写章节正文',
    description:
      '写入或覆盖某章正文。**内部强校验**：(a) 提到的人名必须在 character_map.target；(b) 提到的角色不能 alive===false；(c) 出现 setting_map 原行业关键词→软警告。校验失败返回 {ok:false, issues:[...]} 让你按 issues 修正后重调。校验成功后写入并自动派生 state.md（更新 last_seen_chapter / 死亡声明 / hook 兑现 / 新埋 hook）。',
    promptSnippet: 'writeChapter({number, content}) - 写正文（内部硬校验）',
    promptGuidelines: [
      '调用前先 getChapterContext 拿齐 context',
      '校验失败时按返回的 issues.hits 改正——通常是人名漏注册或者把死了的人写出来了',
      '正文目标 3000-5000 字（番茄爽文一章合理体量）；< 1000 或 > 8000 会软警告',
    ],
    parameters: Type.Object({
      number: Type.Number(),
      title: Type.String(),
      content: Type.String(),
    }),
    async execute(_id, params) {
      const { number, title, content } = params as {
        number: number
        title: string
        content: string
      }
      if (number < batch.from || number > batch.to) {
        const r = {
          ok: false,
          issues: [{ level: 'error', message: `number ${number} 超出本批范围 ${batch.from}-${batch.to}` }],
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], details: r }
      }
      const outline = await readOutline(novelId, number)
      if (!outline) {
        const r = {
          ok: false,
          issues: [{ level: 'error', message: `outline for chapter ${number} 不存在，先调 writeChapterOutline` }],
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], details: r }
      }
      const maps = (await readMaps(novelId)) ?? { character_map: [], setting_map: null }
      const state = (await readState(novelId)) ?? (await initStateIfMissing(novelId))
      const issues = validateChapterContent(content, { maps, state })

      const lengthWarn =
        content.length < 1000 || content.length > 8000
          ? [{ level: 'warning' as const, message: `字数偏离合理范围（${content.length}）` }]
          : []
      const allIssues = [...issues, ...lengthWarn]

      if (allIssues.some((i) => i.level === 'error')) {
        const r = { ok: false, issues: allIssues }
        return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], details: r }
      }

      await writeChapterDraft(novelId, {
        number,
        title,
        word_count: content.length,
        written_at: new Date().toISOString(),
        content,
      })

      const characters_appeared = maps.character_map
        .map((e) => e.target)
        .filter((name) => content.includes(name))
      await applyChapterStateDiff(novelId, number, outline, characters_appeared)

      const r = {
        ok: true,
        saved_path: `target/chapters/${String(number).padStart(4, '0')}.md`,
        warnings: allIssues.filter((i) => i.level === 'warning'),
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], details: r }
    },
  }
}
```

- [ ] **Step 2：单测**

`packages/agent-server/src/agents/tools/write-chapter.test.ts`：mock 一个 maps + state 场景，调 tool execute，断言 hard-reject 路径 / 软警告路径 / 成功路径。

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/agents/tools/write-chapter.ts packages/agent-server/src/agents/tools/write-chapter.test.ts
git commit -m "feat(agents): add writeChapter tool with hard validation and state diff"
```

---

## Task 12：Tool factory + 工具集合

**Files:**
- Create: `packages/agent-server/src/agents/tools/index.ts`

- [ ] **Step 1：实现**

```typescript
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { buildUpdateMapsTool } from './update-maps.js'
import { buildWriteChapterOutlineTool, type BatchRange } from './write-chapter-outline.js'
import { buildGetChapterContextTool } from './get-chapter-context.js'
import { buildWriteChapterTool } from './write-chapter.js'

export function buildOutlineAgentTools(novelId: string, batch: BatchRange): ToolDefinition[] {
  return [
    buildUpdateMapsTool(novelId),
    buildWriteChapterOutlineTool(novelId, batch),
  ]
}

export function buildWriterAgentTools(novelId: string, batch: BatchRange): ToolDefinition[] {
  return [
    buildGetChapterContextTool(novelId),
    buildWriteChapterTool(novelId, batch),
  ]
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/tools/index.ts
git commit -m "feat(agents): add tool factories per agent role"
```

---

## Task 13：大纲 agent session 工厂 + system prompt

**Files:**
- Create: `packages/agent-server/src/agents/outline-session.ts`
- Create: `packages/agent-server/src/agents/system-prompts.ts`

- [ ] **Step 1：写 system-prompts.ts**

```typescript
export function outlineAgentSystemPrompt(novelId: string, batch: { from: number; to: number }): string {
  return `你是中文网文改写大纲 agent。你的任务是基于参考小说的分析数据，生成新书的章级大纲。

═══ 本批范围 ═══

第 ${batch.from} - ${batch.to} 章。每个 writeChapterOutline 调用的 number 必须在此范围内。

═══ 数据布局 ═══

- 参考小说分析：data/${novelId}/source/**.md（只读）
  - source/meta.md：原书概览 / industry / world_rules / style_tags
  - source/characters/*.md：每个原书角色一个文件
  - source/subplots.md：原书支线（含 function 标签）
  - source/hooks.md：原书长线伏笔（含 id 如 hk-001）
  - source/chapters/*.md：每章摘要 + 关键事件
- 改写产物：data/${novelId}/target/**（你写）
  - target/maps.md：角色置换 + 题材置换
  - target/outlines/*.md：你逐章产出的大纲
  - target/state.md：runtime 状态（你不直接写，写章时自动派生）

═══ 工作流 ═══

1. 第一次进入：read source/meta.md 看原书题材；read source/characters/ 看主要角色
2. read target/maps.md（如果存在）；如果不存在或要补充，调 updateMaps **生成置换表草案**
   - character_entries：所有 source/characters 里 role !== 'tool' 的角色都要给一个 target 名（用户后续可改）
   - setting：original_industry 抄自 source/meta，target_industry 你决定（与新名字风格一致）
3. ls target/outlines/ 看本批已写过哪些章
4. 对未写的每个 number（${batch.from}..${batch.to}）：
   - read source/chapters/<n>.md 看原书该章干了啥
   - 决定 plot（已应用置换表的中文段落）+ key_events
   - 决定 hooks_to_plant / hooks_to_payoff（id 引用 source/hooks.md 或新埋 nhk-NNN）
   - 决定 planned_state_changes（character_deaths / new_settings）
   - 调 writeChapterOutline 写入

═══ 用户对话改大纲 ═══

如果用户在对话里说"把第 5 章反派换成女反派" / "第 23 章节奏太慢拆分"，你的处理：
1. read 现有的 target/outlines/<n>.md 看当前大纲
2. 按用户要求修改 plot / key_events / 其他字段
3. 调 writeChapterOutline 重新写入（upsert 覆盖）
4. 简洁回复用户改了什么

═══ 注意 ═══

- 永远不要让 LLM 自己创造剧情骨架——大纲应当锚定在原书 source_chapter_ref
- 改写允许：人名替换（用 character_map）/ 行业替换（用 setting_map）/ 支线分支事件细节调整 / 同等强度的事件顺序调整
- 主线节拍 / 长线伏笔的"形状"必须保留
- 番茄爽文章节体量约一对一映射（原书 100 章 ≈ 新书 100 章）`
}

export function writerAgentSystemPrompt(novelId: string, batch: { from: number; to: number }): string {
  return `你是中文网文写作 agent。你的任务是基于大纲生成新书正文，**不创造剧情，只填充文字**。

═══ 本批范围 ═══

第 ${batch.from} - ${batch.to} 章。number 必须在此范围内。

═══ 工作流（每章固定流程） ═══

1. 调 getChapterContext({number}) 拿齐 context（大纲 + 置换表 + 最近 3 章正文 + 角色状态 + 涉及伏笔 + 第 1 章额外含风格样本）
2. 写正文（中文，3000-5000 字一章为目标）：
   - 严格按 outline.plot 推进剧情
   - 严格按 outline.key_events 包含所有关键事件
   - 涉及人物**只用** maps.character_map.target 列表里的名字
   - **禁止**让 alive===false 的角色出现（连提名都不行）
   - 替换 setting_map.key_term_replacements 里的所有 key（用 value 替换）
   - 文风模仿 style_samples / style_tags（第一章靠它，之后靠 recent_chapters 自身延续）
3. 调 writeChapter({number, title, content})
4. 如返回 ok:false：按 issues 修正
   - 漏注册人名（hits 列出）→ 删掉/换成 character_map 里的名字
   - 死人复活（hits 列出）→ 删掉这些角色的戏份
   - 原行业词残留只是 warning，可保存可改
   重新调 writeChapter
5. 如返回 ok:true：进入下一章

═══ 注意 ═══

- 不要追求"文采"超出原书风格——番茄爽文流畅 + 节奏 > 文采
- 不要扩写超出大纲的事件
- 长线伏笔的兑现 / 埋点用大纲 hooks_to_plant/payoff 声明驱动；正文里只需要写出对应戏份`
}
```

- [ ] **Step 2：写 outline-session.ts**

```typescript
import path from 'node:path'
import { createAgentSession, SessionManager, AuthStorage, DefaultResourceLoader } from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildOutlineAgentTools } from './tools/index.js'
import { outlineAgentSystemPrompt } from './system-prompts.js'
import type { BatchRange } from './tools/write-chapter-outline.js'

export interface OutlineAgentInit {
  novelId: string
  batch: BatchRange
}

export async function createOutlineAgent(init: OutlineAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: ['read', 'grep', 'ls'],   // 内置；禁掉 write/edit/bash
    customTools: buildOutlineAgentTools(init.novelId, init.batch),
    systemPrompt: outlineAgentSystemPrompt(init.novelId, init.batch),
    sessionManager: SessionManager.inMemory(),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
```

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/agents/system-prompts.ts packages/agent-server/src/agents/outline-session.ts
git commit -m "feat(agents): add outline agent session factory and system prompt"
```

---

## Task 14：写作 agent session 工厂

**Files:**
- Create: `packages/agent-server/src/agents/writer-session.ts`

- [ ] **Step 1：实现（结构同 outline-session）**

```typescript
import { createAgentSession, SessionManager, AuthStorage, DefaultResourceLoader } from '@mariozechner/pi-coding-agent'
import type { AgentSession } from '@mariozechner/pi-coding-agent'
import { buildAgentModel, AGENT_PROVIDER } from './model.js'
import { buildWriterAgentTools } from './tools/index.js'
import { writerAgentSystemPrompt } from './system-prompts.js'
import type { BatchRange } from './tools/write-chapter-outline.js'

export interface WriterAgentInit {
  novelId: string
  batch: BatchRange
}

export async function createWriterAgent(init: WriterAgentInit): Promise<AgentSession> {
  const authStorage = AuthStorage.inMemory()
  authStorage.setRuntimeApiKey(AGENT_PROVIDER, process.env['AGENT_API_KEY'] ?? '')
  const resourceLoader = new DefaultResourceLoader({
    cwd: process.cwd(),
    noSkills: true,
  })
  await resourceLoader.reload()
  const { session } = await createAgentSession({
    model: buildAgentModel(),
    thinkingLevel: 'medium',
    tools: ['read', 'grep', 'ls'],
    customTools: buildWriterAgentTools(init.novelId, init.batch),
    systemPrompt: writerAgentSystemPrompt(init.novelId, init.batch),
    sessionManager: SessionManager.inMemory(),
    authStorage,
    resourceLoader,
    cwd: process.cwd(),
  })
  return session
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/writer-session.ts
git commit -m "feat(agents): add writer agent session factory"
```

---

## Task 15：agent session 注册表（多对话隔离）

**Files:**
- Create: `packages/agent-server/src/agents/registry.ts`

记录每个对话 ID → AgentSession 实例的映射，方便 REST 通过 conversation_id 寻址。

- [ ] **Step 1：实现**

```typescript
import type { AgentSession } from '@mariozechner/pi-coding-agent'

interface SessionEntry {
  novelId: string
  role: 'outline' | 'writer'
  batch: { from: number; to: number }
  session: AgentSession
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

function genId(): string {
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function registerSession(entry: Omit<SessionEntry, 'createdAt'>): string {
  const id = genId()
  sessions.set(id, { ...entry, createdAt: Date.now() })
  return id
}

export function getSession(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId)
}

export function listSessionsByNovel(novelId: string): { id: string; entry: SessionEntry }[] {
  const out: { id: string; entry: SessionEntry }[] = []
  for (const [id, entry] of sessions) {
    if (entry.novelId === novelId) out.push({ id, entry })
  }
  return out
}

export function removeSession(sessionId: string): void {
  sessions.delete(sessionId)
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/agents/registry.ts
git commit -m "feat(agents): add in-memory session registry for chat addressing"
```

---

## Task 16：REST 路由 + SSE（启动 agent / 发消息 / 接 stream）

**Files:**
- Create: `packages/agent-server/src/routes/agent.ts`
- Modify: `packages/agent-server/src/server.ts`（挂 `/api/agent`）

端点：
- `POST /api/agent/:novelId/outline/start` body `{from, to}` → 创建 outline session，返回 `{session_id}`
- `POST /api/agent/:novelId/writer/start` body `{from, to}` → 创建 writer session，返回 `{session_id}`
- `POST /api/agent/session/:sessionId/message` body `{content}` → 给 session 发用户消息，返回 SSE 流
- `POST /api/agent/session/:sessionId/run` body `{}` → 触发 agent 自驱跑（"开始改写本批"），返回 SSE 流
- `GET /api/agent/:novelId/sessions` → 列当前 novel 的活跃 session
- `DELETE /api/agent/session/:sessionId` → 关闭

- [ ] **Step 1：实现路由**（完整代码见 spec 第 6 节 + pi-coding-agent 文档；要点：用 `session.sendMessage(content)` 触发，订阅 stream 转 SSE）

主要骨架：

```typescript
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { createOutlineAgent } from '../agents/outline-session.js'
import { createWriterAgent } from '../agents/writer-session.js'
import { registerSession, getSession, removeSession, listSessionsByNovel } from '../agents/registry.js'

const app = new Hono()

app.post('/:id/outline/start', async (c) => {
  const novelId = c.req.param('id')
  const { from, to } = await c.req.json<{ from: number; to: number }>()
  const session = await createOutlineAgent({ novelId, batch: { from, to } })
  const sessionId = registerSession({ novelId, role: 'outline', batch: { from, to }, session })
  return c.json({ session_id: sessionId, novel_id: novelId, role: 'outline', batch: { from, to } })
})

app.post('/:id/writer/start', async (c) => {
  const novelId = c.req.param('id')
  const { from, to } = await c.req.json<{ from: number; to: number }>()
  const session = await createWriterAgent({ novelId, batch: { from, to } })
  const sessionId = registerSession({ novelId, role: 'writer', batch: { from, to }, session })
  return c.json({ session_id: sessionId, novel_id: novelId, role: 'writer', batch: { from, to } })
})

app.post('/session/:sid/message', async (c) => {
  const sid = c.req.param('sid')
  const entry = getSession(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const { content } = await c.req.json<{ content: string }>()
  return stream(c, async (s) => {
    s.onAbort(() => { /* noop */ })
    const subscription = entry.session.events.subscribe((evt) => {
      const json = JSON.stringify(evt)
      void s.write(`event: ${evt.type}\ndata: ${json}\n\n`)
    })
    try {
      await entry.session.sendMessage({ role: 'user', content })
      await s.write(`event: done\ndata: {}\n\n`)
    } catch (err) {
      await s.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`)
    } finally {
      subscription.unsubscribe()
    }
  })
})

app.post('/session/:sid/run', async (c) => {
  // 触发 agent 自驱：发一条"按工作流执行本批"的 prompt
  const sid = c.req.param('sid')
  const entry = getSession(sid)
  if (!entry) return c.json({ error: 'session_not_found' }, 404)
  const promptText = entry.role === 'outline'
    ? `开始为本批（第 ${entry.batch.from}-${entry.batch.to} 章）生成大纲。先按 system prompt 中的工作流执行。`
    : `开始为本批（第 ${entry.batch.from}-${entry.batch.to} 章）写正文。逐章 getChapterContext → writeChapter。`
  return stream(c, async (s) => {
    const subscription = entry.session.events.subscribe((evt) => {
      void s.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`)
    })
    try {
      await entry.session.sendMessage({ role: 'user', content: promptText })
      await s.write(`event: done\ndata: {}\n\n`)
    } catch (err) {
      await s.write(`event: error\ndata: ${JSON.stringify({ message: (err as Error).message })}\n\n`)
    } finally {
      subscription.unsubscribe()
    }
  })
})

app.get('/:id/sessions', (c) => {
  const novelId = c.req.param('id')
  const list = listSessionsByNovel(novelId).map(({ id, entry }) => ({
    id,
    role: entry.role,
    batch: entry.batch,
    created_at: entry.createdAt,
  }))
  return c.json(list)
})

app.delete('/session/:sid', (c) => {
  removeSession(c.req.param('sid'))
  return c.body(null, 204)
})

export { app as agentRoutes }
```

**注意：** `session.events.subscribe` / `sendMessage` 的具体 API 名称在 pi-coding-agent 0.64 上需要按实际类型签名调整（实施者参考 `node_modules/@mariozechner/pi-coding-agent/dist/*.d.ts`）。如果 SDK API 与上面不一致，按实际签名改写——核心是"接 user message → 订阅事件流 → 写到 SSE"。

- [ ] **Step 2：挂载到 server**

修改 `packages/agent-server/src/server.ts`：
```typescript
import { agentRoutes } from './routes/agent.js'
// ...
app.route('/api/agent', agentRoutes)
```

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/routes/agent.ts packages/agent-server/src/server.ts
git commit -m "feat(server): add /api/agent routes for outline/writer sessions and SSE"
```

---

## Task 17：API 客户端类型（shared）

**Files:**
- Modify: `packages/shared/src/types.ts`

加 agent 相关类型用于 web 端将来调用：

- [ ] **Step 1：追加类型**

```typescript
export type AgentRole = 'outline' | 'writer'

export interface AgentSessionInfo {
  id: string
  role: AgentRole
  batch: { from: number; to: number }
  created_at: number
}

export type AgentEvent =
  | { type: 'message.delta'; content: string }
  | { type: 'message.complete'; content: string }
  | { type: 'tool.call'; name: string; params: unknown }
  | { type: 'tool.result'; name: string; result: unknown }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

- [ ] **Step 2：commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): add agent session and event types"
```

---

## Task 18：CLI smoke test 脚本（可选辅助）

**Files:**
- Create: `scripts/smoke-agent.sh`

便于不依赖 UI 测试 agent 流。

- [ ] **Step 1：写脚本**

```bash
#!/usr/bin/env bash
set -euo pipefail

NOVEL_ID="${1:-?}"
[ "$NOVEL_ID" = "?" ] && { echo "用法: $0 <novel-id>"; exit 1; }

echo "=== 启动 outline agent (1-10 章) ==="
SESSION=$(curl -s -X POST "http://localhost:3100/api/agent/$NOVEL_ID/outline/start" \
  -H "Content-Type: application/json" -d '{"from":1,"to":10}' | jq -r .session_id)
echo "session: $SESSION"

echo "=== 触发 outline 自驱（流式） ==="
curl -N -X POST "http://localhost:3100/api/agent/session/$SESSION/run" \
  -H "Content-Type: application/json" -d '{}'

echo
echo "=== 查看产物 ==="
ls -la ~/.novel-agent/data/$NOVEL_ID/target/outlines/ 2>/dev/null || true
cat ~/.novel-agent/data/$NOVEL_ID/target/maps.md 2>/dev/null || true

echo
echo "=== 启动 writer agent ==="
WSESSION=$(curl -s -X POST "http://localhost:3100/api/agent/$NOVEL_ID/writer/start" \
  -H "Content-Type: application/json" -d '{"from":1,"to":10}' | jq -r .session_id)
echo "writer session: $WSESSION"

echo "=== 触发 writer 自驱 ==="
curl -N -X POST "http://localhost:3100/api/agent/session/$WSESSION/run" \
  -H "Content-Type: application/json" -d '{}'

echo
ls -la ~/.novel-agent/data/$NOVEL_ID/target/chapters/ 2>/dev/null || true
```

- [ ] **Step 2：chmod + commit**

```bash
chmod +x scripts/smoke-agent.sh
git add scripts/smoke-agent.sh
git commit -m "chore: add smoke-agent.sh CLI script for end-to-end agent testing"
```

---

## Task 19：手动 smoke test（用户）

不派 subagent。用户：

- [ ] 用 Plan 1 跑过分析的某 novel-id
- [ ] `pnpm dev`
- [ ] 终端跑 `./scripts/smoke-agent.sh nv-xxxxxxxx`
- [ ] 观察：
  - outline agent 是否生成了 target/maps.md（character_map + setting_map）
  - target/outlines/ 是否有 0001.md - 0010.md
  - writer agent 是否在每章前调 getChapterContext，校验失败时是否会重写
  - 最终 target/chapters/ 是否有 10 章正文
  - target/state.md 是否随写章推进更新

---

## Task 20：CLAUDE.md 更新

**Files:**
- Modify: `CLAUDE.md`

加 agent 相关条目：

- 仓库结构速查加 `packages/agent-server/src/agents/` / `data/<id>/target/**`
- 改动流程加"新增 agent tool"段
- 不要做的事加"⚠ 不要并行启动同 novel 的两个 outline agent，state.md 会冲突"

- [ ] **Step 1：编辑 + commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for agent / target / tools"
```

---

## Self-Review

**Spec coverage：**

| spec 点 | 实现 task |
|---|---|
| target 目录 + front matter | T2-T4 |
| state.md 生命周期 | T5 |
| 校验逻辑（人名/死人/行业词） | T6 |
| Qianfan 模型配置 | T7 |
| 4 自定义工具 | T8-T11 |
| 大纲 / 写作 agent session | T13-T14 |
| 多 session 隔离 | T15 |
| REST + SSE | T16 |
| shared types for web | T17 |
| 验证流程 | T19 |

**未在 Plan 2 覆盖：**
- 用户对话改大纲的 UI（Plan 3）
- 单条 outline / chapter 重写按钮（Plan 3 触发对应 agent）
- agent 对话气泡 UI（Plan 3）

**已知 trade-off：**
- `validateNames` 是启发式（中文 NER 难做精确）；初期可能假阳/假阴。校准时观察 issues.hits 调正则
- session 在内存里，server 重启全丢——Plan 2 不做持久化（V2 加 SQLite session 持久化或转用 pi-coding-agent 的 SessionManager.persistent）
- 单 novel 同时只允许一个 outline session 跑（state.md 会被并发写）—— 这条用社交合约保证（CLAUDE.md 警告），不强制
- pi-coding-agent 的 events API 在 0.64 文档可能与本 plan 假设不完全一致，T16 实施时按实际 SDK 类型调整

**Placeholder 扫描：** 无 TBD / TODO。每个 task 含完整代码或精确改动指引。

**类型一致性：** `BatchRange` 在 T9 定义，T10/T11/T13/T14 引用；`MapsRecord` / `OutlineRecord` / `StateRecord` 在 T3/T5 定义，工具 + agent 一致使用。
