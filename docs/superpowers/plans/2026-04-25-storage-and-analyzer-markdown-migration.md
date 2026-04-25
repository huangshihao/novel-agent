# Plan 1：存储 + 分析管线 Markdown 迁移

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 novel-agent 的存储从 SQLite 切换到 Markdown 文件系统；改造分析管线（Pass 1 + Pass 2）输出 MD；伏笔仅长线；新增 role/death_chapter/setting/style；现有 Web UI 仍能查看分析结果。

**Architecture:**
- 新建 `packages/agent-server/src/storage/` 模块封装 MD + front matter 读写
- `analyzer.ts` 重写：每 Pass 直接产 MD 文件，无 DB 写入
- `routes/novel.ts` 重写：从 MD 读取
- 删除 `db.ts` 与 `better-sqlite3`，删除 `Hook.type` 字段

**Tech Stack:**
- gray-matter（YAML front matter 解析 + 序列化）
- vitest（单测，新增）
- 已有：DeepSeek 客户端、Hono、TypeScript strict

**约定（贯穿全 plan）：**
- 每个 task 末尾的 commit message 不要加 `Co-Authored-By: Claude`
- 每个 commit 前必须 `pnpm typecheck` 全绿
- 数据目录：默认 `~/.novel-agent/data/`（可通过 `NOVEL_AGENT_DATA_DIR` 覆盖）
- 文件原子写：先写临时文件 `*.tmp`，再 `rename`

**前置参考：**
- 设计 spec：`docs/superpowers/specs/2026-04-25-novel-rewrite-agent-design.md`
- 项目约定：`CLAUDE.md`

---

## Task 0: 初始化 git 仓库

**Files:**
- Create: `.gitignore`
- Create: `data/.gitkeep`

- [ ] **Step 1：在项目根目录初始化 git**

```bash
cd /Users/horace/playground/novel-agent
git init
git remote add origin https://github.com/huangshihao/novel-agent.git
```

- [ ] **Step 2：写 `.gitignore`**

创建 `/Users/horace/playground/novel-agent/.gitignore`：

```
node_modules/
dist/
*.log
.DS_Store
.env
.env.local

# 本地数据：分析产物 + 改写产物。理由见 spec 第 3 节。
data/
!data/.gitkeep
```

- [ ] **Step 3：占位 `.gitkeep`**

```bash
mkdir -p /Users/horace/playground/novel-agent/data
touch /Users/horace/playground/novel-agent/data/.gitkeep
```

- [ ] **Step 4：首次提交**

```bash
git add -A
git commit -m "chore: init repo, add .gitignore and data placeholder"
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `packages/agent-server/package.json`
- Modify: `package.json`（root，加 vitest 配置）

- [ ] **Step 1：在 agent-server 加 gray-matter 和 vitest**

```bash
cd /Users/horace/playground/novel-agent
pnpm --filter @novel-agent/agent-server add gray-matter
pnpm --filter @novel-agent/agent-server add -D vitest @vitest/coverage-v8
```

- [ ] **Step 2：在 agent-server `package.json` 加 test 脚本**

修改 `packages/agent-server/package.json` 的 `scripts` 区块：

```json
"scripts": {
  "dev": "tsx watch --env-file=../../.env src/index.ts",
  "build": "tsc -p tsconfig.json",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 3：建 `packages/agent-server/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 4：typecheck + commit**

```bash
pnpm --filter @novel-agent/agent-server typecheck
git add -A
git commit -m "chore(agent-server): add gray-matter and vitest"
```

---

## Task 2: 路径常量模块

**Files:**
- Create: `packages/agent-server/src/storage/paths.ts`
- Create: `packages/agent-server/src/storage/paths.test.ts`

- [ ] **Step 1：写测试**

`packages/agent-server/src/storage/paths.test.ts`：

```typescript
import { describe, expect, it } from 'vitest'
import { paths } from './paths.js'

describe('paths', () => {
  it('builds novel root from id', () => {
    expect(paths.novel('nv-abc')).toMatch(/data\/nv-abc$/)
  })

  it('builds source/chapters/<n>.md with zero-padded number', () => {
    const p = paths.sourceChapter('nv-abc', 5)
    expect(p).toMatch(/nv-abc\/source\/chapters\/0005\.md$/)
  })

  it('zero-pads to 4 digits', () => {
    expect(paths.sourceChapter('nv-x', 1)).toMatch(/0001\.md$/)
    expect(paths.sourceChapter('nv-x', 999)).toMatch(/0999\.md$/)
    expect(paths.sourceChapter('nv-x', 1234)).toMatch(/1234\.md$/)
  })

  it('builds source raw txt path', () => {
    expect(paths.sourceRaw('nv-x', 5)).toMatch(/nv-x\/source\/raw\/0005\.txt$/)
  })

  it('character path uses canonical name', () => {
    expect(paths.sourceCharacter('nv-x', '张三')).toMatch(/张三\.md$/)
  })

  it('honors NOVEL_AGENT_DATA_DIR env', () => {
    process.env['NOVEL_AGENT_DATA_DIR'] = '/tmp/novel-test'
    // 模块缓存——必须重新 import
    return import('./paths.js?reload=' + Date.now()).then((m) => {
      expect(m.paths.root()).toBe('/tmp/novel-test')
    })
  })
})
```

- [ ] **Step 2：运行测试，确认 fail**

```bash
pnpm --filter @novel-agent/agent-server test
```

预期：模块不存在的 import 错误。

- [ ] **Step 3：实现 `paths.ts`**

```typescript
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_ROOT = join(homedir(), '.novel-agent', 'data')

function root(): string {
  return process.env['NOVEL_AGENT_DATA_DIR'] ?? DEFAULT_ROOT
}

function pad4(n: number): string {
  return String(n).padStart(4, '0')
}

export const paths = {
  root,
  novel: (id: string) => join(root(), id),
  novelIndex: (id: string) => join(root(), id, 'index.md'),
  sourceDir: (id: string) => join(root(), id, 'source'),
  sourceMeta: (id: string) => join(root(), id, 'source', 'meta.md'),
  sourceCharactersDir: (id: string) => join(root(), id, 'source', 'characters'),
  sourceCharacter: (id: string, name: string) =>
    join(root(), id, 'source', 'characters', `${name}.md`),
  sourceSubplots: (id: string) => join(root(), id, 'source', 'subplots.md'),
  sourceHooks: (id: string) => join(root(), id, 'source', 'hooks.md'),
  sourceChaptersDir: (id: string) => join(root(), id, 'source', 'chapters'),
  sourceChapter: (id: string, n: number) =>
    join(root(), id, 'source', 'chapters', `${pad4(n)}.md`),
  sourceRawDir: (id: string) => join(root(), id, 'source', 'raw'),
  sourceRaw: (id: string, n: number) =>
    join(root(), id, 'source', 'raw', `${pad4(n)}.txt`),
}
```

- [ ] **Step 4：跑测试**

```bash
pnpm --filter @novel-agent/agent-server test
```

预期：所有 6 个 test pass。

- [ ] **Step 5：commit**

```bash
git add packages/agent-server/src/storage/paths.ts packages/agent-server/src/storage/paths.test.ts packages/agent-server/vitest.config.ts packages/agent-server/package.json
git commit -m "feat(storage): add path conventions module"
```

---

## Task 3: Markdown 读写工具（front matter + 原子写）

**Files:**
- Create: `packages/agent-server/src/storage/markdown.ts`
- Create: `packages/agent-server/src/storage/markdown.test.ts`

- [ ] **Step 1：写测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMd, writeMd, readMdIfExists, listFrontMatter } from './markdown.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'md-test-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('markdown', () => {
  it('writes and reads back front matter + body', async () => {
    const path = join(tmp, 'a.md')
    await writeMd(path, { number: 5, title: '测试' }, '## 摘要\n正文\n')
    const got = await readMd<{ number: number; title: string }>(path)
    expect(got.frontMatter.number).toBe(5)
    expect(got.frontMatter.title).toBe('测试')
    expect(got.body).toContain('## 摘要')
  })

  it('writeMd creates parent dir if missing', async () => {
    const path = join(tmp, 'nested/dir/a.md')
    await writeMd(path, { x: 1 }, 'body')
    expect(existsSync(path)).toBe(true)
  })

  it('writeMd is atomic (no .tmp leftover)', async () => {
    const path = join(tmp, 'a.md')
    await writeMd(path, { x: 1 }, 'body')
    expect(existsSync(path + '.tmp')).toBe(false)
  })

  it('readMdIfExists returns null when absent', async () => {
    const got = await readMdIfExists(join(tmp, 'missing.md'))
    expect(got).toBeNull()
  })

  it('listFrontMatter returns front matter for all *.md in a dir', async () => {
    await writeMd(join(tmp, 'a.md'), { id: 'a' }, '')
    await writeMd(join(tmp, 'b.md'), { id: 'b' }, '')
    // 非 .md 文件应被忽略
    const txtPath = join(tmp, 'note.txt')
    require('node:fs').writeFileSync(txtPath, 'ignore me')
    const list = await listFrontMatter<{ id: string }>(tmp)
    const ids = list.map((x) => x.frontMatter.id).sort()
    expect(ids).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2：实现 `markdown.ts`**

```typescript
import matter from 'gray-matter'
import { mkdir, readFile, rename, writeFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface MdFile<F> {
  frontMatter: F
  body: string
}

export async function writeMd(
  path: string,
  frontMatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const content = matter.stringify(body, frontMatter)
  const tmp = `${path}.tmp`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, path)
}

export async function readMd<F = Record<string, unknown>>(
  path: string,
): Promise<MdFile<F>> {
  const raw = await readFile(path, 'utf8')
  const parsed = matter(raw)
  return { frontMatter: parsed.data as F, body: parsed.content }
}

export async function readMdIfExists<F = Record<string, unknown>>(
  path: string,
): Promise<MdFile<F> | null> {
  try {
    return await readMd<F>(path)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function listFrontMatter<F = Record<string, unknown>>(
  dir: string,
): Promise<{ path: string; frontMatter: F }[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: { path: string; frontMatter: F }[] = []
  for (const e of entries) {
    if (!e.endsWith('.md')) continue
    const path = join(dir, e)
    const md = await readMd<F>(path)
    out.push({ path, frontMatter: md.frontMatter })
  }
  return out
}
```

- [ ] **Step 3：跑测试**

```bash
pnpm --filter @novel-agent/agent-server test
```

预期：所有 5 个 test pass。

- [ ] **Step 4：commit**

```bash
git add packages/agent-server/src/storage/markdown.ts packages/agent-server/src/storage/markdown.test.ts
git commit -m "feat(storage): add markdown read/write with atomic write and front matter"
```

---

## Task 4: novel index 文件读写工具

**Files:**
- Create: `packages/agent-server/src/storage/novel-index.ts`
- Create: `packages/agent-server/src/storage/novel-index.test.ts`

`index.md` 替代 SQLite `novel` 表：状态、章数、范围、错误。

- [ ] **Step 1：写测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readNovelIndex,
  writeNovelIndex,
  listNovelIndices,
  type NovelIndex,
} from './novel-index.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'nidx-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const sample: NovelIndex = {
  id: 'nv-1',
  title: '测试',
  status: 'uploaded',
  chapter_count: 100,
  analyzed_count: 0,
  analysis_from: 1,
  analysis_to: 100,
  analyzed_to: 0,
  error: null,
  created_at: 1000,
  updated_at: 1000,
}

describe('novel-index', () => {
  it('round-trips a novel index', async () => {
    await writeNovelIndex(sample)
    const got = await readNovelIndex('nv-1')
    expect(got).toEqual(sample)
  })

  it('readNovelIndex returns null for missing', async () => {
    expect(await readNovelIndex('missing')).toBeNull()
  })

  it('listNovelIndices returns all', async () => {
    await writeNovelIndex({ ...sample, id: 'nv-1' })
    await writeNovelIndex({ ...sample, id: 'nv-2', title: '二' })
    const list = await listNovelIndices()
    expect(list.map((n) => n.id).sort()).toEqual(['nv-1', 'nv-2'])
  })
})
```

- [ ] **Step 2：实现 `novel-index.ts`**

```typescript
import { readdir } from 'node:fs/promises'
import { paths } from './paths.js'
import { readMd, readMdIfExists, writeMd } from './markdown.js'

export type NovelStatus =
  | 'uploaded'
  | 'splitting'
  | 'analyzing'
  | 'ready'
  | 'failed'

export interface NovelIndex {
  id: string
  title: string
  status: NovelStatus
  chapter_count: number
  analyzed_count: number
  analysis_from: number
  analysis_to: number
  analyzed_to: number
  error: string | null
  created_at: number
  updated_at: number
}

export async function writeNovelIndex(idx: NovelIndex): Promise<void> {
  await writeMd(paths.novelIndex(idx.id), idx as unknown as Record<string, unknown>, '')
}

export async function readNovelIndex(id: string): Promise<NovelIndex | null> {
  const f = await readMdIfExists<NovelIndex>(paths.novelIndex(id))
  return f ? f.frontMatter : null
}

export async function listNovelIndices(): Promise<NovelIndex[]> {
  let dirs: string[]
  try {
    dirs = await readdir(paths.root())
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const out: NovelIndex[] = []
  for (const d of dirs) {
    if (d.startsWith('.')) continue
    const f = await readMdIfExists<NovelIndex>(paths.novelIndex(d))
    if (f) out.push(f.frontMatter)
  }
  return out
}

export async function updateNovelIndex(
  id: string,
  patch: Partial<NovelIndex>,
): Promise<NovelIndex> {
  const current = await readNovelIndex(id)
  if (!current) throw new Error(`novel ${id} not found`)
  const updated: NovelIndex = { ...current, ...patch, updated_at: Date.now() }
  await writeNovelIndex(updated)
  return updated
}
```

- [ ] **Step 3：跑测试 + commit**

```bash
pnpm --filter @novel-agent/agent-server test
git add packages/agent-server/src/storage/novel-index.ts packages/agent-server/src/storage/novel-index.test.ts
git commit -m "feat(storage): add novel index read/write (replaces novel SQLite table)"
```

---

## Task 5: source 写入器（chapters / characters / subplots / hooks / meta）

**Files:**
- Create: `packages/agent-server/src/storage/source-writer.ts`
- Create: `packages/agent-server/src/storage/source-writer.test.ts`

把"产物对象 → MD 文件"的转换集中到一处，analyzer 调用这里。

- [ ] **Step 1：写测试（覆盖 5 个 writer，省略部分以保持长度可控）**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMd } from './markdown.js'
import { paths } from './paths.js'
import {
  writeSourceChapter,
  writeSourceCharacter,
  writeSourceSubplots,
  writeSourceHooks,
  writeSourceMeta,
} from './source-writer.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sw-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('source-writer', () => {
  it('writeSourceChapter writes front matter + summary + events sections', async () => {
    await writeSourceChapter('nv-1', {
      number: 5,
      title: '觉醒',
      characters_present: ['张三'],
      hooks_planted: ['hk-1'],
      hooks_paid: [],
      summary: '张三激活异能。',
      key_events: ['张三激活异能', '李四逃走'],
    })
    const md = await readMd(paths.sourceChapter('nv-1', 5))
    expect(md.frontMatter['number']).toBe(5)
    expect(md.body).toContain('## 摘要')
    expect(md.body).toContain('张三激活异能。')
    expect(md.body).toContain('## 关键事件')
    expect(md.body).toContain('- 张三激活异能')
  })

  it('writeSourceCharacter writes role + death_chapter to front matter', async () => {
    await writeSourceCharacter('nv-1', {
      canonical_name: '张三',
      aliases: ['老张'],
      role: 'protagonist',
      function_tags: ['茶馆老板'],
      first_chapter: 1,
      last_chapter: 100,
      death_chapter: null,
      description: '主角。',
    })
    const md = await readMd(paths.sourceCharacter('nv-1', '张三'))
    expect(md.frontMatter['role']).toBe('protagonist')
    expect(md.frontMatter['death_chapter']).toBeNull()
  })

  it('writeSourceSubplots writes single file with array', async () => {
    await writeSourceSubplots('nv-1', [
      { id: 'sp-1', name: '茶馆扩张', function: 'establish-setting', chapters: [3, 5], description: '主角扩张茶馆。' },
    ])
    const md = await readMd(paths.sourceSubplots('nv-1'))
    const subs = md.frontMatter['subplots'] as { id: string }[]
    expect(subs[0].id).toBe('sp-1')
  })

  it('writeSourceHooks writes long-only hooks (no type field)', async () => {
    await writeSourceHooks('nv-1', [
      { id: 'hk-1', description: '主角异能来源', category: 'secret', planted_chapter: 3, payoff_chapter: 487, evidence_chapters: [3, 27, 88], why: '多章暗示' },
    ])
    const md = await readMd(paths.sourceHooks('nv-1'))
    const hooks = md.frontMatter['hooks'] as Record<string, unknown>[]
    expect(hooks[0]['type']).toBeUndefined()
    expect(hooks[0]['category']).toBe('secret')
  })

  it('writeSourceMeta writes industry / world_rules / style_tags', async () => {
    await writeSourceMeta('nv-1', {
      title: '都市修仙',
      chapter_count: 1000,
      genre_tags: ['都市', '修仙'],
      industry: '茶艺馆经营',
      era: '现代',
      world_rules: ['灵气复苏'],
      key_terms: ['茶馆', '灵茶'],
      style_tags: ['快节奏'],
      style_samples: [],
      summary: '一个普通茶馆老板的修仙故事。',
    })
    const md = await readMd(paths.sourceMeta('nv-1'))
    expect(md.frontMatter['industry']).toBe('茶艺馆经营')
    expect(md.frontMatter['world_rules']).toEqual(['灵气复苏'])
  })
})
```

- [ ] **Step 2：实现 `source-writer.ts`**

```typescript
import { writeMd } from './markdown.js'
import { paths } from './paths.js'

// ─── Types ─────────────────────────────────────────────────────────────────

export type CharacterRole =
  | 'protagonist'
  | 'female-lead'
  | 'antagonist'
  | 'mentor'
  | 'family'
  | 'side'
  | 'tool'

export type SubplotFunction =
  | 'create-crisis'
  | 'deliver-payoff'
  | 'establish-setting'
  | 'romance'
  | 'growth'

export type HookCategory =
  | 'suspense'
  | 'crisis'
  | 'payoff'
  | 'goal'
  | 'secret'
  | 'relation'
  | 'rule'
  | 'contrast'
  | 'emotion'

export interface SourceChapterRecord {
  number: number
  title: string
  characters_present: string[]
  hooks_planted: string[]
  hooks_paid: string[]
  summary: string
  key_events: string[]
}

export interface SourceCharacterRecord {
  canonical_name: string
  aliases: string[]
  role: CharacterRole | null
  function_tags: string[]
  first_chapter: number
  last_chapter: number
  death_chapter: number | null
  description: string
}

export interface SourceSubplotRecord {
  id: string
  name: string
  function: SubplotFunction | null
  chapters: number[]
  description: string
}

export interface SourceHookRecord {
  id: string
  description: string
  category: HookCategory | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
  why?: string
}

export interface SourceMetaRecord {
  title: string
  chapter_count: number
  genre_tags: string[]
  industry: string
  era: string
  world_rules: string[]
  key_terms: string[]
  style_tags: string[]
  style_samples: string[]
  summary: string
}

// ─── Writers ───────────────────────────────────────────────────────────────

export async function writeSourceChapter(
  novelId: string,
  rec: SourceChapterRecord,
): Promise<void> {
  const fm = {
    number: rec.number,
    title: rec.title,
    characters_present: rec.characters_present,
    hooks_planted: rec.hooks_planted,
    hooks_paid: rec.hooks_paid,
  }
  const body =
    `## 摘要\n${rec.summary.trim()}\n\n` +
    `## 关键事件\n${rec.key_events.map((e) => `- ${e}`).join('\n')}\n`
  await writeMd(paths.sourceChapter(novelId, rec.number), fm, body)
}

export async function writeSourceCharacter(
  novelId: string,
  rec: SourceCharacterRecord,
): Promise<void> {
  const fm = {
    canonical_name: rec.canonical_name,
    aliases: rec.aliases,
    role: rec.role,
    function_tags: rec.function_tags,
    first_chapter: rec.first_chapter,
    last_chapter: rec.last_chapter,
    death_chapter: rec.death_chapter,
  }
  const body = `## 描述\n${rec.description.trim()}\n`
  await writeMd(paths.sourceCharacter(novelId, rec.canonical_name), fm, body)
}

export async function writeSourceSubplots(
  novelId: string,
  subplots: SourceSubplotRecord[],
): Promise<void> {
  await writeMd(paths.sourceSubplots(novelId), { subplots }, '')
}

export async function writeSourceHooks(
  novelId: string,
  hooks: SourceHookRecord[],
): Promise<void> {
  await writeMd(paths.sourceHooks(novelId), { hooks }, '')
}

export async function writeSourceMeta(
  novelId: string,
  rec: SourceMetaRecord,
): Promise<void> {
  const fm = {
    title: rec.title,
    chapter_count: rec.chapter_count,
    genre_tags: rec.genre_tags,
    industry: rec.industry,
    era: rec.era,
    world_rules: rec.world_rules,
    key_terms: rec.key_terms,
    style_tags: rec.style_tags,
  }
  const body =
    `## 概要\n${rec.summary.trim()}\n\n` +
    `## 风格样本\n${rec.style_samples.map((s, i) => `### 样本 ${i + 1}\n${s}`).join('\n\n')}\n`
  await writeMd(paths.sourceMeta(novelId), fm, body)
}
```

- [ ] **Step 3：跑测试 + commit**

```bash
pnpm --filter @novel-agent/agent-server test
git add packages/agent-server/src/storage/source-writer.ts packages/agent-server/src/storage/source-writer.test.ts
git commit -m "feat(storage): add source writers for chapters/characters/subplots/hooks/meta"
```

---

## Task 6: source 读取器（routes 和 Pass 2 都用）

**Files:**
- Create: `packages/agent-server/src/storage/source-reader.ts`
- Create: `packages/agent-server/src/storage/source-reader.test.ts`

- [ ] **Step 1：写测试**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeSourceChapter, writeSourceCharacter, writeSourceHooks, writeSourceSubplots, writeSourceMeta } from './source-writer.js'
import {
  listSourceChapters,
  readSourceChapter,
  listSourceCharacters,
  readSourceSubplots,
  readSourceHooks,
  readSourceMeta,
  wipeSourceAggregates,
} from './source-reader.js'
import { existsSync } from 'node:fs'
import { paths } from './paths.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sr-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('source-reader', () => {
  it('lists chapters by number ascending', async () => {
    await writeSourceChapter('nv-1', { number: 2, title: 'B', characters_present: [], hooks_planted: [], hooks_paid: [], summary: 's2', key_events: [] })
    await writeSourceChapter('nv-1', { number: 1, title: 'A', characters_present: [], hooks_planted: [], hooks_paid: [], summary: 's1', key_events: [] })
    const list = await listSourceChapters('nv-1')
    expect(list.map((c) => c.number)).toEqual([1, 2])
  })

  it('readSourceChapter returns body sections parsed', async () => {
    await writeSourceChapter('nv-1', { number: 3, title: 'X', characters_present: ['张三'], hooks_planted: [], hooks_paid: [], summary: '摘要内容', key_events: ['e1', 'e2'] })
    const ch = await readSourceChapter('nv-1', 3)
    expect(ch?.summary).toBe('摘要内容')
    expect(ch?.key_events).toEqual(['e1', 'e2'])
    expect(ch?.characters_present).toEqual(['张三'])
  })

  it('wipeSourceAggregates removes characters/subplots/hooks/meta but keeps chapters', async () => {
    await writeSourceChapter('nv-1', { number: 1, title: 'A', characters_present: [], hooks_planted: [], hooks_paid: [], summary: 's', key_events: [] })
    await writeSourceCharacter('nv-1', { canonical_name: 'X', aliases: [], role: null, function_tags: [], first_chapter: 1, last_chapter: 1, death_chapter: null, description: '' })
    await writeSourceSubplots('nv-1', [])
    await writeSourceHooks('nv-1', [])
    await writeSourceMeta('nv-1', { title: 't', chapter_count: 1, genre_tags: [], industry: '', era: '', world_rules: [], key_terms: [], style_tags: [], style_samples: [], summary: '' })
    await wipeSourceAggregates('nv-1')
    expect(existsSync(paths.sourceCharactersDir('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceSubplots('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceHooks('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceMeta('nv-1'))).toBe(false)
    expect(existsSync(paths.sourceChapter('nv-1', 1))).toBe(true)
  })
})
```

- [ ] **Step 2：实现 `source-reader.ts`**

```typescript
import { rm } from 'node:fs/promises'
import { listFrontMatter, readMd, readMdIfExists } from './markdown.js'
import { paths } from './paths.js'
import type {
  SourceChapterRecord,
  SourceCharacterRecord,
  SourceHookRecord,
  SourceMetaRecord,
  SourceSubplotRecord,
} from './source-writer.js'

function parseChapterBody(body: string): { summary: string; key_events: string[] } {
  // 简单解析 ## 摘要 + ## 关键事件 两个 section
  const summaryMatch = body.match(/##\s*摘要\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const eventsMatch = body.match(/##\s*关键事件\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const summary = summaryMatch?.[1]?.trim() ?? ''
  const eventsBlock = eventsMatch?.[1] ?? ''
  const key_events = eventsBlock
    .split('\n')
    .map((l) => l.replace(/^\s*-\s*/, '').trim())
    .filter(Boolean)
  return { summary, key_events }
}

export async function readSourceChapter(
  novelId: string,
  number: number,
): Promise<SourceChapterRecord | null> {
  const md = await readMdIfExists<{
    number: number
    title: string
    characters_present: string[]
    hooks_planted: string[]
    hooks_paid: string[]
  }>(paths.sourceChapter(novelId, number))
  if (!md) return null
  const { summary, key_events } = parseChapterBody(md.body)
  return {
    number: md.frontMatter.number,
    title: md.frontMatter.title,
    characters_present: md.frontMatter.characters_present ?? [],
    hooks_planted: md.frontMatter.hooks_planted ?? [],
    hooks_paid: md.frontMatter.hooks_paid ?? [],
    summary,
    key_events,
  }
}

export async function listSourceChapters(
  novelId: string,
): Promise<SourceChapterRecord[]> {
  const list = await listFrontMatter<{
    number: number
    title: string
    characters_present: string[]
    hooks_planted: string[]
    hooks_paid: string[]
  }>(paths.sourceChaptersDir(novelId))
  const out: SourceChapterRecord[] = []
  for (const item of list) {
    const md = await readMd(item.path)
    const { summary, key_events } = parseChapterBody(md.body)
    out.push({
      number: item.frontMatter.number,
      title: item.frontMatter.title,
      characters_present: item.frontMatter.characters_present ?? [],
      hooks_planted: item.frontMatter.hooks_planted ?? [],
      hooks_paid: item.frontMatter.hooks_paid ?? [],
      summary,
      key_events,
    })
  }
  return out.sort((a, b) => a.number - b.number)
}

export async function listSourceCharacters(
  novelId: string,
): Promise<SourceCharacterRecord[]> {
  const list = await listFrontMatter<Omit<SourceCharacterRecord, 'description'>>(
    paths.sourceCharactersDir(novelId),
  )
  const out: SourceCharacterRecord[] = []
  for (const item of list) {
    const md = await readMd(item.path)
    const descMatch = md.body.match(/##\s*描述\s*\n([\s\S]*?)(?=\n##\s|$)/)
    out.push({
      canonical_name: item.frontMatter.canonical_name,
      aliases: item.frontMatter.aliases ?? [],
      role: item.frontMatter.role ?? null,
      function_tags: item.frontMatter.function_tags ?? [],
      first_chapter: item.frontMatter.first_chapter,
      last_chapter: item.frontMatter.last_chapter,
      death_chapter: item.frontMatter.death_chapter ?? null,
      description: descMatch?.[1]?.trim() ?? '',
    })
  }
  return out
}

export async function readSourceSubplots(
  novelId: string,
): Promise<SourceSubplotRecord[]> {
  const md = await readMdIfExists<{ subplots: SourceSubplotRecord[] }>(
    paths.sourceSubplots(novelId),
  )
  return md?.frontMatter.subplots ?? []
}

export async function readSourceHooks(
  novelId: string,
): Promise<SourceHookRecord[]> {
  const md = await readMdIfExists<{ hooks: SourceHookRecord[] }>(
    paths.sourceHooks(novelId),
  )
  return md?.frontMatter.hooks ?? []
}

export async function readSourceMeta(
  novelId: string,
): Promise<SourceMetaRecord | null> {
  const md = await readMdIfExists(paths.sourceMeta(novelId))
  if (!md) return null
  const fm = md.frontMatter as Partial<SourceMetaRecord>
  const summaryMatch = md.body.match(/##\s*概要\s*\n([\s\S]*?)(?=\n##\s|$)/)
  const samplesMatch = md.body.match(/##\s*风格样本\s*\n([\s\S]*?)$/)
  const samples = (samplesMatch?.[1] ?? '')
    .split(/###\s*样本\s*\d+\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return {
    title: fm.title ?? '',
    chapter_count: fm.chapter_count ?? 0,
    genre_tags: fm.genre_tags ?? [],
    industry: fm.industry ?? '',
    era: fm.era ?? '',
    world_rules: fm.world_rules ?? [],
    key_terms: fm.key_terms ?? [],
    style_tags: fm.style_tags ?? [],
    style_samples: samples,
    summary: summaryMatch?.[1]?.trim() ?? '',
  }
}

export async function wipeSourceAggregates(novelId: string): Promise<void> {
  await Promise.all([
    rm(paths.sourceCharactersDir(novelId), { recursive: true, force: true }),
    rm(paths.sourceSubplots(novelId), { force: true }),
    rm(paths.sourceHooks(novelId), { force: true }),
    rm(paths.sourceMeta(novelId), { force: true }),
  ])
}
```

- [ ] **Step 3：跑测试 + commit**

```bash
pnpm --filter @novel-agent/agent-server test
git add packages/agent-server/src/storage/source-reader.ts packages/agent-server/src/storage/source-reader.test.ts
git commit -m "feat(storage): add source readers and wipe-aggregates utility"
```

---

## Task 7: 更新 Pass 1 抽取 prompt（仅长线钩子）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts:73-175`

修改 `extractPrompt` 函数：
- 钩子定义里删除短线（"10-20 章内回收"）的描述
- 输出 schema 删除 `type` 字段
- 数量校准段更新

- [ ] **Step 1：找到并替换 extract prompt 的钩子段落**

定位 `analyzer.ts` 中 `extractPrompt` 函数。修改 hook 段落：

替换 "─── 钩子（hooks_planted）的严格定义 ───" 到 "─── 钩子的四步自检 ───" 之间的文本：

```typescript
─── 钩子（hooks_planted）的严格定义 ───

钩子是指**让读者"还想继续读下去"的长线欠账**：此时此刻读者还不知道答案、还不确定结局，且预计**几十章之后**才会回收。
**短线钩子（10-20 章内即回收）一律不抽**。本管线只关心长线/结构性钩子。

钩子必须属于以下 9 类之一（输出时 category 填英文 code）：

- suspense（悬念）：跨多章的"真相是什么 / 这个人是谁 / 为什么会这样"
- crisis（危机）：跨多章未化解的危险/惩罚/失败/暴露
- payoff（爽点兑现）：跨多章累积的压迫/羞辱/误解/轻视，等待远期打脸/反杀/逆袭
- goal（目标）：主角**长期**未完成的追求（赚钱/复仇/升级/夺宝/救人）
- secret（身份/秘密）：角色藏的身份/过去/能力/系统/血脉/关系
- relation（关系）：跨多章未解的感情/仇恨/误会/背叛/暧昧/利益绑定
- rule（规则/设定）：新系统/新世界规则/新副本/新限制
- contrast（反差）：表面身份 vs 真实能力、当下评价 vs 未来结果，等待反差被揭
- emotion（情绪欠账）：跨多章未释放的愤怒/委屈/期待/恐惧
```

修改输出 schema 段（删除 `type` 字段）：

```typescript
4. hooks_planted: **符合上述长线定义**、**本章首次或有增量**的钩子。每条 {desc, category}。
   - **只抽长线**：本章 10-20 章内会回收的小悬念**不要**抽
   - category = 上述 9 种之一的英文 code
   - **宁可少不要多**；本章若无真正的新长线钩子，就输出空数组 []
```

输出 JSON 段：

```typescript
{
  "chapters": [
    {
      "chapter_id": <章号>,
      "summary": "...",
      "characters_present": ["..."],
      "key_events": ["..."],
      "hooks_planted": [{"desc": "...", "category": "suspense"}],
      "hooks_paid": [{"ref_desc": "..."}]
    }
  ]
}
```

数量校准段：

```typescript
─── 数量校准 ───

- 每 10 章平均 **0-1 条**真长线钩子，典型一章**产生 0 条**
- 一章里**冒不出合格长线钩子是常态**——就输出空数组
- 如果你一章写出 2+ 条长线，基本可以判定是在凑数，请删掉
```

- [ ] **Step 2：去除 `ChapterExtract.hooks_planted[].type`**

定位 `ChapterExtract` 接口，把 `type: 'short' | 'long'` 字段删除：

```typescript
interface ChapterExtract {
  chapter_id: number
  summary: string
  characters_present: string[]
  key_events: string[]
  hooks_planted: { desc: string; category: HookCategoryCode | null }[]
  hooks_paid: { ref_desc: string }[]
}
```

- [ ] **Step 3：更新 `normalizeExtract`**

```typescript
hooks_planted: Array.isArray(raw.hooks_planted)
  ? raw.hooks_planted
      .map((h) => {
        const rawCat = String((h as { category?: unknown })?.category ?? '').trim()
        const category = (HOOK_CATEGORIES as string[]).includes(rawCat)
          ? (rawCat as HookCategoryCode)
          : null
        return {
          desc: String((h as { desc?: unknown })?.desc ?? '').trim(),
          category,
        }
      })
      .filter((h) => h.desc)
  : [],
```

- [ ] **Step 4：typecheck**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

会有报错（其他地方仍引用 `type`）—预期。下一个 task 修。

- [ ] **Step 5：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): drop short hooks, remove type field from chapter extract"
```

---

## Task 8: 移除 RefinedHook + 结构性 + refine prompt 中的 type 维度

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`（多处）

- [ ] **Step 1：`RefinedHook` 接口去掉 type**

```typescript
interface RefinedHook {
  desc: string
  category: HookCategoryCode | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
  why?: string
}
```

- [ ] **Step 2：更新 `synthesizeStructuralHooksPrompt`**

定位 `input.candidates` 类型签名：

```typescript
candidates: { desc: string; category: string | null; chapter: number }[]
```

输出 JSON schema 段把 `"type": "short|long"` 行删掉：

```typescript
{
  "structural_hooks": [
    {
      "desc": "...",
      "category": "suspense|crisis|payoff|goal|secret|relation|rule|contrast|emotion",
      "planted_chapter": <最早证据章号>,
      "evidence_chapters": [<章号数组>],
      "why": "20字内：列出几个关键证据"
    }
  ]
}
```

- [ ] **Step 3：更新 `refineHooksPrompt`**

`input.candidates` 类型同上。删除"`type`：'short'..."相关引导。删除"短线/长线判定"步骤。输出 JSON 也删掉 type。

- [ ] **Step 4：更新 `normalizeRefinedHooks`**

```typescript
function normalizeRefinedHooks(raw: unknown): RefinedHook[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((h) => {
      const rawCat = String((h as { category?: unknown })?.category ?? '').trim()
      const category = (HOOK_CATEGORIES as string[]).includes(rawCat)
        ? (rawCat as HookCategoryCode)
        : null
      const planted = Number((h as { planted_chapter?: unknown })?.planted_chapter)
      const payoffRaw = (h as { payoff_chapter?: unknown })?.payoff_chapter
      const payoff =
        payoffRaw === null || payoffRaw === undefined
          ? null
          : Number.isFinite(Number(payoffRaw))
            ? Number(payoffRaw)
            : null
      const evRaw = (h as { evidence_chapters?: unknown })?.evidence_chapters
      const evidence = Array.isArray(evRaw)
        ? [...new Set(evRaw.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort(
            (a, b) => a - b,
          )
        : []
      const plantedChapter = Number.isFinite(planted) && planted > 0 ? planted : evidence[0] ?? 0
      const finalEvidence = evidence.length > 0 ? evidence : plantedChapter > 0 ? [plantedChapter] : []
      const why = String((h as { why?: unknown })?.why ?? '').trim() || undefined
      return {
        desc: String((h as { desc?: unknown })?.desc ?? '').trim(),
        category,
        planted_chapter: plantedChapter,
        payoff_chapter: payoff,
        evidence_chapters: finalEvidence,
        why,
      }
    })
    .filter((h) => h.desc && h.planted_chapter > 0)
}
```

- [ ] **Step 5：更新 `runPass2` 中 candidates 收集**

定位 hooks 收集段（约 754 行）：

```typescript
for (const [num, ex] of extracts) {
  for (const h of ex.hooks_planted) {
    candidates.push({ desc: h.desc, category: h.category, chapter: num })
  }
  for (const p of ex.hooks_paid) {
    paid.push({ chapter: num, ref_desc: p.ref_desc })
  }
}
```

`candidates` 类型也调整：

```typescript
const candidates: {
  desc: string
  category: string | null
  chapter: number
}[] = []
```

fallback 块去掉 type：

```typescript
refined = [
  ...structural,
  ...candidates.map((c) => ({
    desc: c.desc,
    category: (HOOK_CATEGORIES as string[]).includes(c.category ?? '')
      ? (c.category as HookCategoryCode)
      : null,
    planted_chapter: c.chapter,
    payoff_chapter: null,
    evidence_chapters: [c.chapter],
  })),
]
```

- [ ] **Step 6：typecheck**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

仍会有 SQLite 相关引用错（`runPass2` 仍在写 hook 表），下一 task 修。

- [ ] **Step 7：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): remove type field from structural/refine hook prompts and normalizers"
```

---

## Task 9: 更新 character prompt（加 role + death_chapter）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`（`charactersPrompt` 函数）

- [ ] **Step 1：替换 `charactersPrompt`**

```typescript
function charactersPrompt(input: {
  characters: { name: string; chapters: number[]; summaries: { chapter: number; summary: string }[] }[]
}): string {
  return `下面是一部中文网文的候选人物名字，以及他们出现的章节摘要。请你做四件事：**合并别名** + **筛掉工具人** + **判定 role + function_tags + death_chapter** + **写描述**。

─── 规则 ───

1. **合并别名**：「老王/王老五/王哥」这类称呼等同一人时合并；canonical_name 取最正式的名字，其他放 aliases。

2. **跳过一次性工具人**：以下条件之一就**不要**为其建卡（不出现在输出里）：
   - 仅在 1 章出现 && 没有台词 && 没有明显推动剧情
   - 纯背景提及的泛指称呼（路人、村民、采购员）
   - 仅作为对白中被提及、本人并未真正登场

3. **判定 role**（必填，从下面 7 选 1）：
   - protagonist：主角
   - female-lead：女主角 / 男主角的核心伴侣
   - antagonist：反派 / 主要对手
   - mentor：师父 / 引导者
   - family：主角的家人
   - side：重要配角（朋友/同事/对手但非反派）
   - tool：工具人型配角（推动一次/几次剧情后退场）

4. **判定 function_tags**：自由文本数组，2-4 个标签描述这个角色在书里干了什么（如"茶馆老板"、"主角的青梅竹马"、"反派组织头目"）。

5. **判定 death_chapter**：
   - 必须在摘要里有**明文死亡描写**（"X 死了"、"被 X 杀死"、"葬礼"、"含恨而终"等）才能填章号
   - 没有明文死亡描写就填 null
   - 不要凭空推测

6. **描述严禁凭空推测亲属关系**：
   - 父/母/子/女/兄/弟等关系**必须**有摘要里的明文证据（称呼、直接陈述）才能写
   - 无证据就**只描述他们做了什么**，不要写关系
   - 例：摘要写"小孩们喊陈婉'姑姑'"→ 可以写"陈婉的侄辈"；若只写"小孩们围着陈婉"→ 只能写"和陈婉同家的小孩"

7. **description** 不超过 80 字，以"他在书中做了什么 + 性格"为主，关系只在有证据时点到为止。

─── 反面示例 ───

✗ 死亡：摘要写"X 受伤倒下"→ 不要填 death_chapter（受伤不等于死亡）
✗ 关系："陈婉的三个孩子"（陈婉未婚且摘要没说是她孩子）
✗ 工具人："采购员，提及卖野味"（仅被提及、没登场 → 根本不该出现在输出）
✓ 死亡：摘要明确"李三在第 87 章战死"→ death_chapter: 87
✓ 关系："陈婉的侄辈，在她晕倒时哭喊'姑姑'"（有明文证据）

─── 输出 ───

严格 JSON：

{
  "characters": [
    {
      "canonical_name": "...",
      "aliases": ["..."],
      "role": "protagonist|female-lead|antagonist|mentor|family|side|tool",
      "function_tags": ["...", "..."],
      "death_chapter": <章号或 null>,
      "description": "..."
    }
  ]
}

输入（每个角色出现章节 + 摘要片段）：
${JSON.stringify(input, null, 2)}
`
}
```

- [ ] **Step 2：扩展 `DedupedCharacter` 接口**

```typescript
interface DedupedCharacter {
  canonical_name: string
  aliases: string[]
  role: 'protagonist' | 'female-lead' | 'antagonist' | 'mentor' | 'family' | 'side' | 'tool' | null
  function_tags: string[]
  death_chapter: number | null
  description: string
}
```

- [ ] **Step 3：typecheck（仍预期有错，下一 task 修）**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

- [ ] **Step 4：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): extend characters prompt with role / function_tags / death_chapter"
```

---

## Task 10: 更新 subplots prompt（加 function 标签）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`

- [ ] **Step 1：替换 `subplotsPrompt`**

```typescript
function subplotsPrompt(chapters: { number: number; summary: string; events: string[] }[]): string {
  return `下面是一部中文网文的每章摘要和关键事件。请识别出 3-10 条主要支线/剧情线。一条支线是跨多章、围绕同一主题/冲突的一组相关事件。

要求：
1. 必须包含主线（最核心的冲突/追求）和若干条清晰的支线
2. 每条支线列出它明显推进的章节号
3. 每条支线必须判定一个 **function**（功能定位），从下面 5 选 1：
   - create-crisis：制造危机 / 主线威胁
   - deliver-payoff：兑现爽点 / 打脸 / 反杀
   - establish-setting：铺设定 / 建立世界观或主角的资源池
   - romance：感情线
   - growth：主角成长 / 升级线
4. description 不超过 100 字
5. id 必须是 'sp-NNN' 形式（sp-001, sp-002, ...）

严格 JSON 输出：

{
  "subplots": [
    { "id": "sp-001", "name": "...", "function": "establish-setting", "description": "...", "chapters": [1, 3, 5] }
  ]
}

输入：
${JSON.stringify(chapters, null, 2)}
`
}
```

- [ ] **Step 2：扩展 `IdentifiedSubplot`**

```typescript
interface IdentifiedSubplot {
  id?: string
  name: string
  function: 'create-crisis' | 'deliver-payoff' | 'establish-setting' | 'romance' | 'growth' | null
  description: string
  chapters: number[]
}
```

- [ ] **Step 3：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): add function tag to subplots prompt"
```

---

## Task 11: 新增 setting/world prompt（Pass 2d）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`（新增函数）

- [ ] **Step 1：新增 `metaPrompt` 函数**

在 `subplotsPrompt` 之后插入：

```typescript
function metaPrompt(input: {
  title: string
  chapter_count: number
  chapters: { number: number; summary: string }[]
  characters: { name: string; description: string }[]
}): string {
  return `下面是一部中文网文的每章摘要和主要角色。请抽取**改写者所需的题材/世界观元数据**。这些元数据决定改写时哪些可以被整体置换（如"机械工厂" → "私房菜餐厅"）。

要求：
1. **industry**（行业/职业领域）：主角在书中赖以谋生 / 进步的核心活动领域。一句话，越具体越好。
   - 例："开机械加工厂"、"经营茶艺馆"、"修仙练气"、"星际舰队学院学员"
2. **era**（时代/背景）：现代 / 古代 / 民国 / 未来 / 修真位面 / 仙侠玄幻 等
3. **world_rules**（世界观规则）：3-8 条这个世界**有别于现实**的硬规则。如果是纯现实题材就给空数组。
   - 例："灵气复苏（现代社会能修炼）"、"境界划分：练气/筑基/金丹/元婴"、"凡人不知有修士"
4. **key_terms**（关键名词）：5-15 个改写时**必须替换**的题材专有词（如果换行业的话）
   - 例：题材是"开机械工厂"时 = ["机床", "车间", "订单", "客户", "工艺图纸"]
5. **genre_tags**（题材标签）：2-5 个，从这些里选：都市 / 修仙 / 玄幻 / 穿越 / 重生 / 末世 / 星际 / 历史 / 系统 / 种田 / 言情 / 悬疑 / 武侠 / 仙侠 / 网游 / 科幻
6. **style_tags**（文风标签）：2-5 个自由文本，描述写作风格特点（"快节奏"、"对白多"、"口语化"、"战斗描写细致"、"幽默"、"严肃"等）
7. **summary**（一段总览）：100-200 字，主线一句话 + 主角一句话 + 题材定位一句话

严格 JSON 输出：

{
  "industry": "...",
  "era": "...",
  "world_rules": ["..."],
  "key_terms": ["...", "..."],
  "genre_tags": ["...", "..."],
  "style_tags": ["...", "..."],
  "summary": "..."
}

输入：
书名：${input.title}
总章数：${input.chapter_count}

主要角色（${input.characters.length} 人）：
${JSON.stringify(input.characters, null, 2)}

章节摘要（${input.chapters.length} 章）：
${JSON.stringify(input.chapters, null, 2)}
`
}

interface NovelMetaExtract {
  industry: string
  era: string
  world_rules: string[]
  key_terms: string[]
  genre_tags: string[]
  style_tags: string[]
  summary: string
}
```

- [ ] **Step 2：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): add metaPrompt for industry/era/world_rules/style extraction"
```

---

## Task 12: 重写 `runPass1` 输出到 MD

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`（替换 `runPass1`）

- [ ] **Step 1：在 analyzer.ts 顶部加 imports**

```typescript
import { writeSourceChapter } from './storage/source-writer.js'
import {
  listSourceChapters,
  readSourceChapter,
  wipeSourceAggregates,
} from './storage/source-reader.js'
import { paths } from './storage/paths.js'
import { readFile } from 'node:fs/promises'
```

- [ ] **Step 2：替换 `runPass1` 函数**

完全替换：

```typescript
async function runPass1(
  client: DeepSeekClient,
  novelId: string,
  chapters: { number: number; title: string; rawPath: string }[],
  concurrency: number,
  total: number,
): Promise<Map<number, ChapterExtract>> {
  const results = new Map<number, ChapterExtract>()

  // 加载内容
  const withContent = await Promise.all(
    chapters.map(async (c) => ({
      ...c,
      content: await readFile(c.rawPath, 'utf8'),
    })),
  )

  const batches = chunk(withContent, BATCH_SIZE)

  await pMap(batches, concurrency, async (batch) => {
    let extracts: ChapterExtract[] = []
    try {
      const parsed = await client.chatJson<{ chapters: ChapterExtract[] }>(
        extractPrompt(batch),
        { temperature: 0.3 },
      )
      extracts = Array.isArray(parsed.chapters) ? parsed.chapters : []
    } catch (err) {
      console.warn(`[analyzer] extract batch failed:`, (err as Error).message)
    }

    const byNum = new Map<number, ChapterExtract>()
    for (const e of extracts) {
      const cid = Number(e.chapter_id)
      if (cid) byNum.set(cid, normalizeExtract(e))
    }

    for (const c of batch) {
      const e = byNum.get(c.number)
      if (!e) continue
      await writeSourceChapter(novelId, {
        number: c.number,
        title: c.title,
        characters_present: e.characters_present,
        hooks_planted: [],   // hooks 要等 Pass 2 refine 后才有 ID，这里留空
        hooks_paid: e.hooks_paid.map((p) => p.ref_desc), // 先记 ref_desc 文本，refine 后再做匹配
        summary: e.summary,
        key_events: e.key_events,
      })
      results.set(c.number, e)
      emitAnalysisEvent(novelId, {
        type: 'analyze.chapter',
        number: c.number,
        title: c.title,
      })
    }

    incAnalyzed(novelId, batch.length, total)
  })

  return results
}
```

注意：`runPass1` 现在收 `rawPath` 而不是 `content`，因为 chapter 内容存在 `source/raw/<n>.txt`。

- [ ] **Step 3：commit**

会有 typecheck 错（`runAnalysis` 还在传旧参数），下一 task 修。

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): rewrite runPass1 to write source/chapters/<n>.md"
```

---

## Task 13: 重写 `runPass2`（characters / subplots / hooks 全 MD）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`

替换 `runPass2`，去掉 SQLite，写 MD。

- [ ] **Step 1：替换 `runPass2`**

```typescript
async function runPass2(
  client: DeepSeekClient,
  novelId: string,
  extracts: Map<number, ChapterExtract>,
): Promise<void> {
  // ── 2a. 人物聚合 ─────────────────────────────────────────────────────
  const nameOccurrences = new Map<string, Set<number>>()
  for (const [num, ex] of extracts) {
    for (const name of ex.characters_present) {
      let chs = nameOccurrences.get(name)
      if (!chs) {
        chs = new Set()
        nameOccurrences.set(name, chs)
      }
      chs.add(num)
    }
  }

  const rawNames = [...nameOccurrences.keys()]
  let deduped: DedupedCharacter[] = []
  if (rawNames.length > 0) {
    const MAX_PER_NAME = 6
    const charsForPrompt = rawNames.map((name) => {
      const chs = [...(nameOccurrences.get(name) ?? [])].sort((a, b) => a - b)
      const picked = sampleEvenly(chs, MAX_PER_NAME)
      const summaries: { chapter: number; summary: string }[] = []
      for (const n of picked) {
        const ex = extracts.get(n)
        if (ex && ex.summary) summaries.push({ chapter: n, summary: ex.summary })
      }
      return { name, chapters: chs, summaries }
    })

    try {
      const parsed = await client.chatJson<{ characters: DedupedCharacter[] }>(
        charactersPrompt({ characters: charsForPrompt }),
        { temperature: 0.2 },
      )
      deduped = Array.isArray(parsed.characters) ? parsed.characters : []
    } catch (err) {
      console.warn('[analyzer] character dedupe failed:', (err as Error).message)
      deduped = rawNames.map((n) => ({
        canonical_name: n,
        aliases: [],
        role: null,
        function_tags: [],
        death_chapter: null,
        description: '',
      }))
    }
  }

  for (const c of deduped) {
    const allNames = [c.canonical_name, ...c.aliases].filter(Boolean)
    const appearChapters = new Set<number>()
    for (const n of allNames) {
      const chs = nameOccurrences.get(n)
      if (chs) for (const ch of chs) appearChapters.add(ch)
    }
    if (appearChapters.size === 0) continue
    const sorted = [...appearChapters].sort((a, b) => a - b)
    await writeSourceCharacter(novelId, {
      canonical_name: c.canonical_name,
      aliases: c.aliases,
      role: c.role,
      function_tags: c.function_tags,
      first_chapter: sorted[0]!,
      last_chapter: sorted[sorted.length - 1]!,
      death_chapter: c.death_chapter,
      description: c.description,
    })
  }

  // ── 2b. 支线识别 ─────────────────────────────────────────────────────
  const chapterInputs = [...extracts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([num, ex]) => ({ number: num, summary: ex.summary, events: ex.key_events }))

  let subplots: IdentifiedSubplot[] = []
  if (chapterInputs.length > 0) {
    try {
      const parsed = await client.chatJson<{ subplots: IdentifiedSubplot[] }>(
        subplotsPrompt(chapterInputs),
        { temperature: 0.3 },
      )
      subplots = Array.isArray(parsed.subplots) ? parsed.subplots : []
    } catch (err) {
      console.warn('[analyzer] subplot identification failed:', (err as Error).message)
      subplots = []
    }
  }

  await writeSourceSubplots(
    novelId,
    subplots
      .map((sp, i) => ({
        id: sp.id ?? `sp-${String(i + 1).padStart(3, '0')}`,
        name: String(sp.name ?? '').trim() || '未命名支线',
        function: sp.function ?? null,
        description: String(sp.description ?? '').trim(),
        chapters: Array.isArray(sp.chapters)
          ? [...new Set(sp.chapters.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort((a, b) => a - b)
          : [],
      }))
      .filter((sp) => sp.chapters.length > 0),
  )

  // ── 2c. 钩子（仅长线）：合成 → refine ──────────────
  const candidates: { desc: string; category: string | null; chapter: number }[] = []
  const paid: { chapter: number; ref_desc: string }[] = []
  for (const [num, ex] of extracts) {
    for (const h of ex.hooks_planted) candidates.push({ desc: h.desc, category: h.category, chapter: num })
    for (const p of ex.hooks_paid) paid.push({ chapter: num, ref_desc: p.ref_desc })
  }

  let structural: RefinedHook[] = []
  if (candidates.length > 0) {
    const summaries = [...extracts.entries()]
      .sort(([a], [b]) => a - b)
      .map(([n, ex]) => ({ chapter: n, summary: ex.summary }))
      .filter((s) => s.summary)
    const charactersInfo = deduped.map((c) => ({ name: c.canonical_name, aliases: c.aliases, description: c.description }))
    try {
      const parsed = await client.chatJson<{ structural_hooks: unknown[] }>(
        synthesizeStructuralHooksPrompt({ candidates, summaries, characters: charactersInfo }),
        { temperature: 0.2 },
      )
      structural = normalizeRefinedHooks(parsed.structural_hooks)
    } catch (err) {
      console.warn('[analyzer] structural synth failed:', (err as Error).message)
      structural = []
    }
  }

  let refined: RefinedHook[] = []
  if (candidates.length > 0 || structural.length > 0) {
    try {
      const parsed = await client.chatJson<{ hooks: unknown[] }>(
        refineHooksPrompt({ candidates, paid, structural }),
        { temperature: 0.2 },
      )
      refined = normalizeRefinedHooks(parsed.hooks)
    } catch (err) {
      console.warn('[analyzer] hook refine failed:', (err as Error).message)
      refined = [...structural]
    }
  }

  await writeSourceHooks(
    novelId,
    refined.map((h, i) => ({
      id: `hk-${String(i + 1).padStart(3, '0')}`,
      description: h.desc,
      category: h.category,
      planted_chapter: h.planted_chapter,
      payoff_chapter: h.payoff_chapter,
      evidence_chapters: h.evidence_chapters,
      why: h.why,
    })),
  )

  // ── 2d. setting/world meta ───────────────────────────────────────────
  const novel = await readNovelIndex(novelId)
  const metaInput = {
    title: novel?.title ?? '',
    chapter_count: novel?.chapter_count ?? extracts.size,
    chapters: chapterInputs.map((c) => ({ number: c.number, summary: c.summary })),
    characters: deduped.map((c) => ({ name: c.canonical_name, description: c.description })),
  }

  let meta: NovelMetaExtract = {
    industry: '',
    era: '',
    world_rules: [],
    key_terms: [],
    genre_tags: [],
    style_tags: [],
    summary: '',
  }
  try {
    meta = await client.chatJson<NovelMetaExtract>(metaPrompt(metaInput), { temperature: 0.2 })
  } catch (err) {
    console.warn('[analyzer] meta extraction failed:', (err as Error).message)
  }

  // ── 2e. 风格样本（无 LLM）─────────────────────────────────────────────
  const styleSamples = await sampleStylePassages(novelId, novel?.chapter_count ?? extracts.size)

  await writeSourceMeta(novelId, {
    title: novel?.title ?? '',
    chapter_count: novel?.chapter_count ?? extracts.size,
    genre_tags: meta.genre_tags,
    industry: meta.industry,
    era: meta.era,
    world_rules: meta.world_rules,
    key_terms: meta.key_terms,
    style_tags: meta.style_tags,
    style_samples: styleSamples,
    summary: meta.summary,
  })
}
```

- [ ] **Step 2：在 analyzer.ts 加 `sampleStylePassages` 函数**

```typescript
async function sampleStylePassages(novelId: string, totalChapters: number): Promise<string[]> {
  if (totalChapters === 0) return []
  const k = Math.min(8, Math.max(3, Math.floor(totalChapters / 8)))
  const indices: number[] = []
  for (let i = 0; i < k; i++) {
    const n = Math.max(1, Math.round(((i + 1) * totalChapters) / (k + 1)))
    if (!indices.includes(n)) indices.push(n)
  }
  const samples: string[] = []
  for (const n of indices) {
    try {
      const text = await readFile(paths.sourceRaw(novelId, n), 'utf8')
      // 取首段非空 + 中间一段（约 200-300 字）
      const paras = text.split(/\n\n+/).map((p) => p.trim()).filter((p) => p.length >= 50 && p.length <= 600)
      if (paras.length === 0) continue
      const pick = paras[Math.floor(paras.length / 2)]!
      samples.push(pick.slice(0, 400))
    } catch {
      /* skip */
    }
  }
  return samples
}
```

- [ ] **Step 3：加 readNovelIndex import**

```typescript
import { readNovelIndex } from './storage/novel-index.js'
import { writeSourceCharacter, writeSourceSubplots, writeSourceHooks, writeSourceMeta } from './storage/source-writer.js'
```

- [ ] **Step 4：commit**

```bash
git add packages/agent-server/src/analyzer.ts
git commit -m "feat(analyzer): rewrite runPass2 to write all aggregates as Markdown, add meta+style passes"
```

---

## Task 14: 重写 analyzer 入口（runAnalysis / wipeAndRunPass2 / loadAllExtracts / reaggregate）

**Files:**
- Modify: `packages/agent-server/src/analyzer.ts`（顶层入口段）

- [ ] **Step 1：替换 `runAnalysis`**

```typescript
async function runAnalysis(novelId: string, opts: StartAnalysisOpts): Promise<void> {
  const client = buildClient()

  const novel = await readNovelIndex(novelId)
  if (!novel) {
    emitAnalysisEvent(novelId, { type: 'error', message: 'novel not found' })
    return
  }

  const from = opts.from ?? novel.analysis_from
  const to = Math.min(opts.to ?? novel.analysis_to, novel.chapter_count)

  if (from < 1 || to < from) {
    await updateNovelIndex(novelId, { status: 'failed', error: `无效的分析范围: ${from}-${to}` })
    emitAnalysisEvent(novelId, { type: 'error', message: `无效的分析范围: ${from}-${to}` })
    return
  }

  await updateNovelIndex(novelId, {
    analysis_from: from,
    analysis_to: to,
    analyzed_count: 0,
    error: null,
    status: 'analyzing',
  })
  emitAnalysisEvent(novelId, { type: 'status', status: 'analyzing' })

  // 本次 run 范围内的章节列表（从 source/raw/<n>.txt 读取）
  const chaptersInRange: { number: number; title: string; rawPath: string }[] = []
  for (let n = from; n <= to; n++) {
    chaptersInRange.push({
      number: n,
      title: `第${n}章`,  // title 由上传时写到 chapter MD 的 front matter；如果存在就用，否则简单生成
      rawPath: paths.sourceRaw(novelId, n),
    })
  }

  // 已有 chapter MD 的章节跳过
  const existing = new Set(
    (await listSourceChapters(novelId)).map((c) => c.number),
  )
  const chaptersToAnalyze = chaptersInRange.filter((c) => !existing.has(c.number))

  const total = chaptersToAnalyze.length
  emitAnalysisEvent(novelId, { type: 'analyze.progress', analyzed: 0, total })

  const concurrency = Number(process.env['ANALYZE_CONCURRENCY'] ?? DEFAULT_CONCURRENCY)

  try {
    if (chaptersToAnalyze.length > 0) {
      await runPass1(client, novelId, chaptersToAnalyze, concurrency, total)
    }
    await wipeAndRunPass2(client, novelId)

    await updateNovelIndex(novelId, {
      analyzed_to: Math.max(novel.analyzed_to, to),
      status: 'ready',
    })
    emitAnalysisEvent(novelId, { type: 'status', status: 'ready' })
    emitAnalysisEvent(novelId, { type: 'done' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await updateNovelIndex(novelId, { status: 'failed', error: msg })
    emitAnalysisEvent(novelId, { type: 'status', status: 'failed' })
    emitAnalysisEvent(novelId, { type: 'error', message: msg })
    if (err instanceof DeepSeekError) {
      console.error('[analyzer] DeepSeek error:', msg, err.body ?? '')
    } else {
      console.error('[analyzer] error:', msg)
    }
  }
}
```

- [ ] **Step 2：替换 `wipeAndRunPass2`**

```typescript
async function wipeAndRunPass2(client: DeepSeekClient, novelId: string): Promise<void> {
  const allExtracts = await loadAllExtracts(novelId)
  await wipeSourceAggregates(novelId)
  await runPass2(client, novelId, allExtracts)
}
```

- [ ] **Step 3：替换 `loadAllExtracts`**

```typescript
async function loadAllExtracts(novelId: string): Promise<Map<number, ChapterExtract>> {
  const list = await listSourceChapters(novelId)
  const out = new Map<number, ChapterExtract>()
  for (const ch of list) {
    out.set(ch.number, normalizeExtract({
      chapter_id: ch.number,
      summary: ch.summary,
      characters_present: ch.characters_present,
      key_events: ch.key_events,
      hooks_planted: [],
      hooks_paid: ch.hooks_paid.map((rd) => ({ ref_desc: rd })),
    } as never))
  }
  return out
}
```

注意：`hooks_planted` 留空——Pass 2 重跑时从原始候选无法恢复（因为 chapter MD 只存了 hook ID 引用，refine 完成后的产物）。这是个**已知 trade-off**：reaggregate 会少 candidate hooks 输入，结构性合成仍然能从 summary 抽出大部分。**如果 reaggregate 要保留全部 candidates，需要把 hooks_planted 候选保留在 chapter MD 的额外 section**——见"未决"段。

- [ ] **Step 4：换 `reaggregate`**

```typescript
import { updateNovelIndex } from './storage/novel-index.js'

export function reaggregate(novelId: string): void {
  void (async () => {
    const novel = await readNovelIndex(novelId)
    if (!novel) return
    const client = buildClient()
    await updateNovelIndex(novelId, { status: 'analyzing' })
    emitAnalysisEvent(novelId, { type: 'status', status: 'analyzing' })
    try {
      await wipeAndRunPass2(client, novelId)
      await updateNovelIndex(novelId, { status: 'ready' })
      emitAnalysisEvent(novelId, { type: 'status', status: 'ready' })
      emitAnalysisEvent(novelId, { type: 'done' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await updateNovelIndex(novelId, { status: 'failed', error: msg })
      emitAnalysisEvent(novelId, { type: 'status', status: 'failed' })
      emitAnalysisEvent(novelId, { type: 'error', message: msg })
      console.error('[analyzer] reaggregate error:', msg)
    }
  })().catch((err: unknown) => console.error('[analyzer] reaggregate fatal:', err))
}
```

- [ ] **Step 5：删除旧的 SQLite 函数**

删除：
- `setNovelStatus`
- `incAnalyzed`（保留新的版本，下面）

新版 `incAnalyzed`：

```typescript
async function incAnalyzed(novelId: string, inc: number, total: number): Promise<void> {
  const cur = await readNovelIndex(novelId)
  if (!cur) return
  const next = cur.analyzed_count + inc
  await updateNovelIndex(novelId, { analyzed_count: next })
  emitAnalysisEvent(novelId, { type: 'analyze.progress', analyzed: next, total })
}
```

注意：调用点要 await。

- [ ] **Step 6：调用点 await 修正**

在 `runPass1` 末尾：

```typescript
await incAnalyzed(novelId, batch.length, total)
```

- [ ] **Step 7：保留 candidate hooks（修复 Pass 2 wipe 后丢候选问题）**

修改 `writeSourceChapter` 的调用点和 `SourceChapterRecord` 接口，加一个 `hooks_planted_candidates` 字段（前缀 underscore 让 reader 知道是中间产物）：

修改 `source-writer.ts` 的 `SourceChapterRecord`：

```typescript
export interface SourceChapterRecord {
  number: number
  title: string
  characters_present: string[]
  hooks_planted: string[]
  hooks_paid: string[]
  hooks_planted_candidates: { desc: string; category: string | null }[]
  summary: string
  key_events: string[]
}
```

`writeSourceChapter` 把 candidates 也写入 front matter：

```typescript
const fm = {
  number: rec.number,
  title: rec.title,
  characters_present: rec.characters_present,
  hooks_planted: rec.hooks_planted,
  hooks_paid: rec.hooks_paid,
  _hooks_planted_candidates: rec.hooks_planted_candidates,
}
```

`source-reader.ts` 的 `readSourceChapter` 和 `listSourceChapters` 一并读取并附在返回对象上。`SourceChapterRecord` 已经包含。

更新 reader 的解析：

```typescript
return {
  ...,
  hooks_planted_candidates: md.frontMatter._hooks_planted_candidates ?? [],
}
```

并修改 reader 的 type 引用——加 `_hooks_planted_candidates?: { desc: string; category: string | null }[]` 到 readSourceChapter / listSourceChapters 的 front matter 类型。

- [ ] **Step 8：调整 `runPass1` 写入 candidates**

`runPass1` 调用 `writeSourceChapter` 时填上 candidates：

```typescript
await writeSourceChapter(novelId, {
  number: c.number,
  title: c.title,
  characters_present: e.characters_present,
  hooks_planted: [],
  hooks_paid: e.hooks_paid.map((p) => p.ref_desc),
  hooks_planted_candidates: e.hooks_planted.map((h) => ({ desc: h.desc, category: h.category })),
  summary: e.summary,
  key_events: e.key_events,
})
```

`loadAllExtracts` 用 candidates 还原：

```typescript
hooks_planted: ch.hooks_planted_candidates.map((c) => ({ desc: c.desc, category: c.category as HookCategoryCode | null })),
```

- [ ] **Step 9：typecheck**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

会有 `db.ts` 引用的报错（routes/novel.ts 还在用），下一 task 修。但 analyzer 自身应该全绿。

- [ ] **Step 10：commit**

```bash
git add packages/agent-server/src/analyzer.ts packages/agent-server/src/storage/source-writer.ts packages/agent-server/src/storage/source-reader.ts
git commit -m "feat(analyzer): rewrite entry/reaggregate/wipe to use Markdown storage"
```

---

## Task 15: 重写 routes/novel.ts（list / detail / chapters / characters / subplots / hooks）

**Files:**
- Modify: `packages/agent-server/src/routes/novel.ts`（完全重写）

- [ ] **Step 1：替换文件顶部 imports**

```typescript
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import type { AnalysisEvent } from '@novel-agent/shared'
import { splitChapters } from '../chapter-splitter.js'
import { startAnalysis, reaggregate } from '../analyzer.js'
import { getBus } from '../event-bus.js'
import {
  listNovelIndices,
  readNovelIndex,
  writeNovelIndex,
  updateNovelIndex,
} from '../storage/novel-index.js'
import {
  listSourceChapters,
  readSourceChapter,
  listSourceCharacters,
  readSourceSubplots,
  readSourceHooks,
} from '../storage/source-reader.js'
import { paths } from '../storage/paths.js'
import { rm } from 'node:fs/promises'
```

- [ ] **Step 2：替换 list / detail / delete**

```typescript
const app = new Hono()

app.get('/', async (c) => {
  const novels = await listNovelIndices()
  novels.sort((a, b) => b.created_at - a.created_at)
  return c.json(novels)
})

app.get('/:id', async (c) => {
  const novel = await readNovelIndex(c.req.param('id'))
  if (!novel) return c.json({ error: 'not_found' }, 404)
  return c.json(novel)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await rm(paths.novel(id), { recursive: true, force: true })
  return c.body(null, 204)
})
```

- [ ] **Step 3：替换 upload**

```typescript
app.post('/', async (c) => {
  const form = await c.req.parseBody()
  const file = form['file']
  const providedTitle = typeof form['title'] === 'string' ? form['title'].trim() : ''

  if (!(file instanceof File)) {
    return c.json({ error: 'file is required (multipart field "file")' }, 400)
  }

  const text = await file.text()
  const chapters = splitChapters(text)
  if (chapters.length === 0) {
    return c.json(
      { error: 'no_chapters_detected', message: '未能识别到任何章节。目前仅支持"第X章"格式的中文小说。' },
      400,
    )
  }

  const requestedCount = parseIntField(form['chapter_count'] ?? form['analysis_to'], 100)
  if (requestedCount < 1) {
    return c.json({ error: 'invalid_range', message: '分析章数必须 ≥ 1' }, 400)
  }
  const to = Math.min(requestedCount, chapters.length)
  const from = 1

  const id = `nv-${randomUUID().slice(0, 8)}`
  const title = providedTitle || file.name.replace(/\.(txt|TXT)$/, '').trim() || '未命名小说'
  const now = Date.now()

  // 写 raw chapter texts
  await mkdir(paths.sourceRawDir(id), { recursive: true })
  for (const ch of chapters) {
    await writeFile(paths.sourceRaw(id, ch.number), ch.content, 'utf8')
  }

  await writeNovelIndex({
    id,
    title,
    status: 'splitting',
    chapter_count: chapters.length,
    analyzed_count: 0,
    analysis_from: from,
    analysis_to: to,
    analyzed_to: 0,
    error: null,
    created_at: now,
    updated_at: now,
  })

  startAnalysis(id, { from, to })
  return c.json(await readNovelIndex(id))
})

function parseIntField(v: unknown, fallback: number): number {
  if (typeof v === 'string') {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : fallback
  }
  return fallback
}
```

- [ ] **Step 4：替换 chapters / characters / subplots / hooks 端点**

```typescript
app.get('/:id/chapters', async (c) => {
  const list = await listSourceChapters(c.req.param('id'))
  return c.json(
    list.map((ch) => ({
      id: ch.number,             // 兼容前端：id 用 number 代替
      novel_id: c.req.param('id'),
      number: ch.number,
      title: ch.title,
      summary: ch.summary,
    })),
  )
})

app.get('/:id/chapters/:n', async (c) => {
  const id = c.req.param('id')
  const n = Number(c.req.param('n'))
  const ch = await readSourceChapter(id, n)
  if (!ch) return c.json({ error: 'not_found' }, 404)
  // original_text 从 raw 读
  const raw = await import('node:fs/promises').then((m) =>
    m.readFile(paths.sourceRaw(id, n), 'utf8').catch(() => ''),
  )
  return c.json({
    id: n,
    novel_id: id,
    number: n,
    title: ch.title,
    original_text: raw,
    summary: ch.summary,
  })
})

app.get('/:id/characters', async (c) => {
  const id = c.req.param('id')
  const chars = await listSourceCharacters(id)
  return c.json(
    chars.map((ch, i) => ({
      id: i + 1,
      novel_id: id,
      name: ch.canonical_name,
      aliases: ch.aliases,
      role: ch.role,
      function_tags: ch.function_tags,
      death_chapter: ch.death_chapter,
      description: ch.description,
      first_chapter: ch.first_chapter,
      last_chapter: ch.last_chapter,
    })),
  )
})

app.get('/:id/subplots', async (c) => {
  const id = c.req.param('id')
  const subs = await readSourceSubplots(id)
  return c.json(
    subs.map((sp, i) => ({
      id: i + 1,
      novel_id: id,
      name: sp.name,
      function: sp.function,
      description: sp.description,
      start_chapter: sp.chapters[0] ?? 0,
      end_chapter: sp.chapters[sp.chapters.length - 1] ?? 0,
      chapters: sp.chapters,
    })),
  )
})

app.get('/:id/hooks', async (c) => {
  const id = c.req.param('id')
  const hooks = await readSourceHooks(id)
  return c.json(
    hooks.map((h, i) => ({
      id: i + 1,
      novel_id: id,
      description: h.description,
      category: h.category,
      planted_chapter: h.planted_chapter,
      payoff_chapter: h.payoff_chapter,
      evidence_chapters: h.evidence_chapters,
    })),
  )
})

app.delete('/:id/hooks/:hookId', async (c) => {
  // V1 不支持单条删除（要做就要给 hook 稳定 ID 并改写 hooks.md）
  return c.json({ error: 'not_implemented_v1', message: '当前不支持单条删除 hook' }, 501)
})
```

- [ ] **Step 5：替换 continue / reaggregate / SSE**

```typescript
app.post('/:id/continue', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json<{ more?: number }>().catch(() => ({}))
  const more = Number(body?.more ?? 0)
  if (!Number.isFinite(more) || more < 1) {
    return c.json({ error: 'invalid_more' }, 400)
  }
  const cur = await readNovelIndex(id)
  if (!cur) return c.json({ error: 'not_found' }, 404)
  const from = cur.analyzed_to + 1
  const to = Math.min(cur.analyzed_to + more, cur.chapter_count)
  if (from > cur.chapter_count) {
    return c.json({ error: 'already_complete' }, 400)
  }
  await updateNovelIndex(id, { analysis_from: from, analysis_to: to })
  startAnalysis(id, { from, to })
  return c.json({ id, analysis_from: from, analysis_to: to })
})

app.post('/:id/reaggregate', (c) => {
  const id = c.req.param('id')
  reaggregate(id)
  return c.json({ id })
})

app.get('/:id/events', (c) => {
  const id = c.req.param('id')
  const stream = new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      const send = (e: AnalysisEvent) => {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`))
      }
      const off = getBus().on(id, send)
      const ka = setInterval(() => {
        controller.enqueue(enc.encode(`: ka\n\n`))
      }, 15000)
      c.req.raw.signal.addEventListener('abort', () => {
        off()
        clearInterval(ka)
        controller.close()
      })
    },
  })
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
})

export default app
```

- [ ] **Step 6：typecheck**

```bash
pnpm --filter @novel-agent/agent-server typecheck
```

应该接近全绿（`db.ts` 没人引用了）。如果 `db.ts` 自己有错（schema 里引用了已删除的字段）—暂时忽略，下面 task 删整个文件。

- [ ] **Step 7：commit**

```bash
git add packages/agent-server/src/routes/novel.ts
git commit -m "feat(server): rewrite novel routes to read Markdown storage"
```

---

## Task 16: 删除 db.ts + better-sqlite3

**Files:**
- Delete: `packages/agent-server/src/db.ts`
- Modify: `packages/agent-server/package.json`
- Modify: `packages/agent-server/src/index.ts`（如果引用了 db.ts）

- [ ] **Step 1：检查所有 import**

```bash
grep -rn "from.*'\./db" packages/agent-server/src
grep -rn "better-sqlite3" packages/agent-server
```

预期没有引用（前面的 task 都换掉了）。如果还有，先修。

- [ ] **Step 2：删除文件 + 依赖**

```bash
rm packages/agent-server/src/db.ts
pnpm --filter @novel-agent/agent-server remove better-sqlite3 @types/better-sqlite3
```

- [ ] **Step 3：typecheck + commit**

```bash
pnpm --filter @novel-agent/agent-server typecheck
git add packages/agent-server/src/db.ts packages/agent-server/package.json /Users/horace/playground/novel-agent/pnpm-lock.yaml
git commit -m "chore(agent-server): remove SQLite (db.ts, better-sqlite3)"
```

---

## Task 17: 更新 shared/types.ts

**Files:**
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1：替换 types.ts**

完全替换：

```typescript
// 跨端共享类型。后端 MD 存储和前端组件都消费这些。

export type NovelStatus =
  | 'uploaded'
  | 'splitting'
  | 'analyzing'
  | 'ready'
  | 'failed'

export interface Novel {
  id: string
  title: string
  status: NovelStatus
  chapter_count: number
  analyzed_count: number
  analysis_from: number
  analysis_to: number
  analyzed_to: number
  error?: string | null
  created_at: number
  updated_at: number
}

export interface Chapter {
  id: number
  novel_id: string
  number: number
  title: string
  original_text: string
  summary: string | null
}

export type CharacterRole =
  | 'protagonist'
  | 'female-lead'
  | 'antagonist'
  | 'mentor'
  | 'family'
  | 'side'
  | 'tool'

export interface Character {
  id: number
  novel_id: string
  name: string
  aliases: string[]
  role: CharacterRole | null
  function_tags: string[]
  death_chapter: number | null
  description: string
  first_chapter: number
  last_chapter: number
}

export type SubplotFunction =
  | 'create-crisis'
  | 'deliver-payoff'
  | 'establish-setting'
  | 'romance'
  | 'growth'

export interface Subplot {
  id: number
  novel_id: string
  name: string
  function: SubplotFunction | null
  description: string
  start_chapter: number
  end_chapter: number
  chapters: number[]
}

export type HookCategory =
  | 'suspense'
  | 'crisis'
  | 'payoff'
  | 'goal'
  | 'secret'
  | 'relation'
  | 'rule'
  | 'contrast'
  | 'emotion'

export interface Hook {
  id: number
  novel_id: string
  description: string
  category: HookCategory | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
}

// SSE event payloads
export type AnalysisEvent =
  | { type: 'split.done'; chapter_count: number }
  | { type: 'analyze.progress'; analyzed: number; total: number }
  | { type: 'analyze.chapter'; number: number; title: string }
  | { type: 'status'; status: NovelStatus }
  | { type: 'done' }
  | { type: 'error'; message: string }
```

注意：`HookType` 已删除；`Hook` 不再有 `type` 字段。

- [ ] **Step 2：typecheck (root)**

```bash
cd /Users/horace/playground/novel-agent
pnpm typecheck
```

预期 web 包会有 typecheck 错（页面用了 `hook.type`），下一 task 修。

- [ ] **Step 3：commit**

```bash
git add packages/shared/src/types.ts
git commit -m "feat(shared): drop Hook.type (long-only); add Character.role/function_tags/death_chapter, Subplot.function"
```

---

## Task 18: 修复 web 类型与 UI 对新字段的引用

**Files:**
- Modify: `packages/web/src/lib/api.ts`（基本无改）
- Modify: `packages/web/src/pages/NovelDetailPage.tsx`（hook.type 引用）

- [ ] **Step 1：grep web 中的 hook.type / HookType 引用**

```bash
grep -rn "hook\.type\|HookType\|h\.type" packages/web/src
```

- [ ] **Step 2：把 hook.type 引用改为不显示 / 删除该列**

例如在 `NovelDetailPage.tsx`，hook 列表渲染处删除 type 列或类似 badge：

定位类似：
```typescript
<span className="...">{h.type === 'short' ? '短' : '长'}</span>
```

替换为空（或删除整段，因为现在全是长线）。如有"按 type 过滤"的下拉，删除。

- [ ] **Step 3：typecheck**

```bash
pnpm typecheck
```

- [ ] **Step 4：commit**

```bash
git add packages/web/src
git commit -m "feat(web): adapt to new types (drop hook.type, ignore short hooks)"
```

---

## Task 19: 端到端 smoke test（手动 + 一个小说）

**Files:**
- Create: `tests/fixtures/sample-novel.txt`（一个小的中文小说样本，约 5-10 章用于测试）
- 没有自动化测试，只 smoke run

- [ ] **Step 1：准备测试小说**

把任意 5-10 章的中文小说（"第X章" 格式）保存为 `tests/fixtures/sample-novel.txt`。可以用现有的任何爽文片段，或自己造个简短的。

- [ ] **Step 2：清空 dev data dir**

```bash
rm -rf ~/.novel-agent/data
```

- [ ] **Step 3：启动 dev server**

```bash
cd /Users/horace/playground/novel-agent
DEEPSEEK_API_KEY=<your-key> pnpm --filter @novel-agent/agent-server dev
```

- [ ] **Step 4：上传并分析**

另一个终端：

```bash
curl -F "file=@tests/fixtures/sample-novel.txt" -F "chapter_count=10" http://localhost:3100/api/novel
```

记下返回的 `id`。

- [ ] **Step 5：watch SSE**

```bash
curl -N "http://localhost:3100/api/novel/<id>/events"
```

应见到 `analyze.chapter` 进度 → `status: ready`。

- [ ] **Step 6：核对产物**

```bash
ls -la ~/.novel-agent/data/<id>/source/
ls -la ~/.novel-agent/data/<id>/source/chapters/
ls -la ~/.novel-agent/data/<id>/source/characters/
cat ~/.novel-agent/data/<id>/source/meta.md
cat ~/.novel-agent/data/<id>/source/hooks.md
cat ~/.novel-agent/data/<id>/source/subplots.md
```

预期看到：
- `index.md` + `source/raw/` + `source/chapters/` + `source/characters/` + `source/subplots.md` + `source/hooks.md` + `source/meta.md`
- `meta.md` 的 front matter 含 industry / era / world_rules / key_terms
- `meta.md` body 有"## 风格样本"
- 任意 character 的 front matter 有 `role` 字段
- `hooks.md` 里 hook 不含 `type` 字段
- 所有 hook 都"长线"（合理预期：5-10 章测试小说可能 0-2 条 hook，没有也正常）

- [ ] **Step 7：测试 reaggregate**

```bash
curl -X POST "http://localhost:3100/api/novel/<id>/reaggregate"
```

应见到再次走完 status → ready，character/subplot/hook/meta 文件都被覆写但 chapter MD 不变。

- [ ] **Step 8：测试 web UI**

```bash
pnpm --filter @novel-agent/web dev
# 浏览器打开 http://localhost:5173
```

确认列表/详情/章节/角色/支线/钩子页面都能加载。可能需要修复个别字段渲染（V1 接受新字段在 UI 里是"未渲染"——下面 Plan 3 处理 UI 重做）。

- [ ] **Step 9：commit fixture（如有）**

如果你创建了 fixture：

```bash
git add tests/fixtures/sample-novel.txt
git commit -m "test: add sample novel fixture for smoke test"
```

---

## Task 20: 文档与 CLAUDE.md 更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1：更新 CLAUDE.md 的"仓库结构速查"**

`packages/agent-server/src/db.ts` 一行删掉。加：

```
| `packages/agent-server/src/storage/` | MD + front matter 读写工具（paths / markdown / novel-index / source-writer / source-reader） |
| `data/<novel-id>/source/**.md` | 分析产物（替代原 SQLite） |
```

- [ ] **Step 2：更新"改动流程"**

把"加新字段"段的"db.ts" 改为"`storage/source-writer.ts` + `storage/source-reader.ts`"。

把"幂等迁移"段删除（不再有 SQLite）。

- [ ] **Step 3：commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Markdown storage migration"
```

---

## 未决 / 已知 trade-off

1. **`hooks_planted_candidates` 是中间产物**：放在 chapter MD 的 front matter 里用 `_` 前缀标记内部字段。如果以后想给用户 UI 显示，可以提升为正式字段。
2. **第一次 reaggregate 后 hooks.md 的 hook ID 会重新生成**（`hk-001..hk-NNN`），但 chapter MD 里 `hooks_planted` 字段在当前实现里**没有被填充**（仅用 candidates）。这意味着"哪一章埋了哪个 hook"的反查关系当前不持久。Plan 2 引入改写时如果需要这个关系，可以加一步"refine 完成后回写每章 hooks_planted 列表"。
3. **`character` 文件名安全性**：当前直接用 canonical_name 当文件名。中文 OK，但如果 LLM 输出含有 `/` `:` 等字符会出错。可以加一层 sanitize。Plan 2 实施前补一个 task。
4. **DELETE /hooks/:id 返回 501**：UI 不再支持单条删除。如果需要，要求把 hooks.md 解析-重写-保存。优先级低。
5. **`pnpm test` 只覆盖 storage 模块**：analyzer 没单测（依赖 LLM）。验证靠 Task 19 的 smoke run。

---

## Self-Review

**Spec coverage 检查：**

| spec section | 实现 task |
|---|---|
| §3 数据存储 / 目录结构 | T2 (paths) + T0 (.gitignore) |
| §4 Front Matter Schema · meta | T5 (writer) + T6 (reader) + T11 (prompt) + T13 (Pass 2d/2e) |
| §4 Front Matter Schema · characters | T5 + T6 + T9 (prompt) + T13 |
| §4 Front Matter Schema · subplots | T5 + T6 + T10 + T13 |
| §4 Front Matter Schema · hooks | T5 + T6 + T7/T8 + T13 |
| §4 Front Matter Schema · chapters | T5 + T6 + T7 (extract prompt) + T12 (Pass 1) |
| §4 Front Matter Schema · novel index | T4 |
| §5 分析管线 · 删除短线 hooks | T7 + T8 |
| §5 分析管线 · 删除 type 字段 | T7 + T8 + T17 |
| §5 分析管线 · 删除 SQLite | T16 |
| §5 分析管线 · 新增 setting/world | T11 + T13 |
| §5 分析管线 · 新增 role / death | T9 + T13 |
| §5 分析管线 · 新增 subplot function | T10 + T13 |
| §5 分析管线 · 新增风格样本 | T13 (sampleStylePassages) |
| §5 分析管线 · Pass 1 输出 MD | T12 |
| §5 分析管线 · Pass 2 wipe + 重建 | T6 (wipeSourceAggregates) + T13 + T14 |
| §10 Server 端 = filesystem→JSON | T15 |
| §11 迁移 1 (storage) | T2-T6 |
| §11 迁移 2 (analyzer 重写) | T7-T14 |
| §11 迁移 3 (db.ts 删除) | T16 |
| §11 迁移 4 (routes 重写) | T15 |
| §11 迁移 5 (前端字段) | T17 + T18 |

未在 Plan 1 覆盖的 spec 内容（在 Plan 2/3）：
- target/ 目录结构 + maps.md / state.md / outlines / chapters
- 4 个自定义工具
- pi-coding-agent 集成
- 大纲 agent / 写作 agent 的 system prompts
- writeChapter 校验逻辑
- agent 对话 UI
- maps 编辑页 / 大纲页

**Placeholder 扫描：** 无 TBD / TODO / "implement later"。每个 step 含有具体代码或命令。

**类型一致性检查：**
- `SourceChapterRecord` 在 T5 定义，T6 / T12 / T14 引用 → 一致（含后加的 `hooks_planted_candidates`）。
- `DedupedCharacter` / `IdentifiedSubplot` / `RefinedHook` / `NovelMetaExtract` 在 T7-T11 引入，T13 在 `runPass2` 内引用 → 一致。
- 所有 hook 数据结构都不再有 `type` 字段 → 一致（Hook、RefinedHook、ChapterExtract.hooks_planted、Hook 候选）。

**类型签名差异：** 无（已检查 normalize → write → read 三段的类型流转）。
