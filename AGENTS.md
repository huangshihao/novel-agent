# AGENTS.md

给 AI 代理工具（Cursor / Aider / Codex / Gemini CLI / Copilot 等）的项目约定。
Claude Code 用户请看 `CLAUDE.md`——两份内容基本一致，但 CLAUDE.md 用了 Claude Code 术语。

## 快速上手

```bash
cp .env.example .env       # DEEPSEEK_API_KEY 必填
pnpm install
pnpm dev                   # server :3100 + web :5173
pnpm typecheck             # 提交前必跑
```

日常协作中默认用户已经启动本地服务并负责 UI 验证。AI 代理不要自行运行 `pnpm dev` 或重复占用端口；需要页面验证时，说明要用户在现有服务上检查哪些路径/操作即可。

## 架构一句话

Monorepo（pnpm workspace）。后端 Hono + SQLite (better-sqlite3) + DeepSeek，两趟分析（Pass 1 每章抽取 → Pass 2 跨章聚合+合成+refine）。前端 React + Vite + Tailwind v4 + React Query。

## 核心文件（90% 的工作在这些里）

- `packages/agent-server/src/analyzer.ts` — 所有 prompt + 两趟 pass
- `packages/agent-server/src/db.ts` — schema + 迁移
- `packages/agent-server/src/routes/novel.ts` — REST + SSE
- `packages/shared/src/types.ts` — 跨端类型
- `packages/web/src/pages/NovelDetailPage.tsx` — UI 主页面
- `packages/web/src/lib/api.ts` — 前端 API 封装

## 编码约定

- **TypeScript strict**。改类型牵一发动全身，要同步 shared/server/web
- **不写注释**，除非 WHY 非显然
- **不加防御性代码**，除 API 边界
- **不建新 .md 文件**，除非用户明确要求
- **函数命名中文合法**（prompt 有大量中文），但导出标识符保持英文
- **尊重现有 prompt 结构**（`─── 段标题 ───` / `═══ 大标题 ═══` / 正反例）

## 数据流约束

- `chapter_extract` 是 Pass 1 的原始产出，**只由 Pass 1 写入**。Pass 2 只读
- `character` / `subplot` / `hook` 是 Pass 2 的派生产出。**每次 Pass 2 开跑前全量 wipe + 重建**（见 `wipeAndRunPass2`）。不要尝试增量 insert
- `novel.analysis_from` / `analysis_to` 是"**最近一次 run** 的范围"
- `novel.analyzed_to` 是已分析过的最高章节号——UI 展示为"已分析章节"
- 加列要同时：CREATE TABLE 里加 + `addColumnIfMissing` 里加 + 必要时写数据修复 SQL

## Prompt 工程规范

- **示例通用化**：举例子要用抽象形态（"某具名配角的真实身份"），不要写"赵美玲的底牌"这类绑死具体书的
- **四步自检**（钩子判定）：具体性 / payoff 可视化 / 作者主动藏 / 非文体默认。再加第 5 步：不能是结构性钩子的症状章
- **数量校准**：随题材。中文网文类型的钩子密度 ~0.5-1.5 条/章；传统文学会更稀
- **JSON 输出**：调用 `client.chatJson<T>()`，配套 try/catch + fallback
- **改 prompt 后**：先用 `POST /api/novel/:id/reaggregate` 复验，不要立即跑 `continue`（贵且慢）

## 幂等/增量语义

- **Pass 1**：有 extract 的章节自动跳过 → `continue` 端点只会分析新章节
- **Pass 2**：每次全量 wipe + 重建 → 可以随时重跑（`reaggregate` 端点）
- **Upload**：创建 novel 时分配 `nv-{uuid8}` id
- **Continue**：`analysis_from` 变为 `analyzed_to + 1`，`analysis_to` 变为 `analyzed_to + N`

## 已知陷阱

1. 模板字面量里有 `` `[]` `` 会被 TS 解析成 element access——用纯 `[]` 或中文代替
2. 老库可能没新列——必须走 `addColumnIfMissing`
3. 结构性钩子（跨 3+ 章伞状悬念）**只**由 Pass 2c.1 的 `synthesizeStructuralHooksPrompt` 产生；Pass 1 和 refine 都无法从头造出
4. LLM 有时在 JSON 前后加文字或 markdown fence——`chatJson` 有容错，但不要依赖；prompt 里要写"严格 JSON 输出，无前后缀"

## 校验步骤

每次大改后：
1. `pnpm typecheck`
2. 不要自行启动 `pnpm dev`；让用户在已运行的本地服务上点一次"仅重聚合"复验 Pass 2 变化
3. 用 `sqlite3 ~/.novel-agent/data.db` 直接查表比对（不要只看 UI——UI 可能缓存）

## 下一步大任务

见 `README.md` 底部 Roadmap。主线三块按顺序：
1. 接入 **pi-coding-agent** 作为写作 agent（能读四张分析表作为知识库）
2. **改编生成大纲**（参考分析 + 用户改编指令 → 结构化分章大纲）
3. **根据大纲自动生成正文**（逐章生成，解决上下文窗口 / 连贯性 / 风格一致性）

目前只有 "参考分析" 这一半。
