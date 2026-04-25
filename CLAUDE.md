# CLAUDE.md

给 Claude Code 的项目约定。先读 `README.md` 拿整体架构，本文件只列 Claude 每次改动都该知道的约束。

## 仓库结构速查

| 路径 | 说明 |
|---|---|
| `packages/shared/src/types.ts` | 跨端 TS 类型（`Novel` / `Chapter` / `Hook` / `HookCategory` / SSE 事件）。改类型后 server + web 都要跟 |
| `packages/agent-server/src/analyzer.ts` | **核心**：Pass 1 抽取 + Pass 2 聚合 + 结构性钩子合成 + refine。所有 prompt 在这里 |
| `packages/agent-server/src/storage/` | MD + front matter 读写工具：paths / markdown / novel-index / source-writer / source-reader |
| `data/<novel-id>/source/**.md` | 分析产物（替代原 SQLite）。`source/raw/<n>.txt` 存原文，`source/chapters/<n>.md` 存抽取，`source/{characters,subplots.md,hooks.md,meta.md}` 是聚合产物 |
| `packages/agent-server/src/routes/novel.ts` | REST + SSE 路由 |
| `packages/agent-server/src/deepseek-client.ts` | `chatJson<T>()` — JSON 模式包装 |
| `packages/agent-server/src/chapter-splitter.ts` | 中文章节切分（"第X章" 格式） |
| `packages/web/src/pages/NovelDetailPage.tsx` | 详情页 + tab（章节 / 人物 / 支线 / 钩子）+ 继续分析 / 仅重聚合 |
| `packages/web/src/pages/NovelListPage.tsx` | 上传 + 列表 |
| `packages/web/src/lib/api.ts` | 前端 API 封装，与 `routes/novel.ts` 一一对应 |
| `packages/agent-server/src/agents/` | Pi-coding-agent runtime：model 配置、tool 工厂、outline/writer session 工厂、validator、注册表、system prompts |
| `packages/agent-server/src/agents/tools/` | 4 个自定义 tool（`updateMaps` / `writeChapterOutline` / `getChapterContext` / `writeChapter`） |
| `packages/agent-server/src/storage/target-*.ts` | `data/<id>/target/{maps,state,outlines,chapters}/**` 的读写 |
| `packages/agent-server/src/storage/state.ts` | runtime `state.md`（角色 alive/dead + hook open/paid_off） |
| `packages/agent-server/src/routes/agent.ts` | REST + SSE：start outline/writer / send message / autonomous run / list / delete |
| `data/<novel-id>/target/**` | 改写产物（与 `source/` 对称）：`maps.md` / `state.md` / `outlines/<n>.md` / `chapters/<n>.md` |
| `packages/web/src/pages/RewritePage.tsx` | 改写主页（左 tabs：置换表 / 大纲 / 正文；右侧：state 摘要 + AgentChat） |
| `packages/web/src/components/AgentChat.tsx` | agent 对话面板（消息气泡 + "开始改写本批" 按钮） |
| `packages/web/src/components/{MapsPanel,OutlinePanel,DraftsPanel,StatePanel}.tsx` | 4 个产物面板 |
| `packages/web/src/lib/use-agent-stream.ts` | SSE 消费 hook（fetch + ReadableStream） |
| `packages/web/src/lib/agent-api.ts` | agent session lifecycle API client |

## 改动流程

**加新字段**：`shared/types.ts` → `storage/source-writer.ts`（写入 + 类型）→ `storage/source-reader.ts`（读出 + body 解析）→ `analyzer.ts` 填值 → `routes/novel.ts` 透传 → `lib/api.ts` 类型透传 → UI 展示。Front matter 新字段不需要迁移脚本（旧 MD 文件读到时是 undefined，按 default 处理）。

**改 prompt**：只改 `analyzer.ts` 里的 prompt 函数。改完用"仅重聚合"端点复验（不消耗 Pass 1 的 token）——见 `analyzer.ts#reaggregate` / `POST /api/novel/:id/reaggregate`。

**改 Pass 1 / 加聚合步**：记得保持**幂等**。Pass 1 跳过已有 extract 的章节，Pass 2 每次运行前 wipe `character` / `subplot` / `hook` 再重建。不要在 Pass 2 里增量 insert。

**加新 agent tool**：在 `packages/agent-server/src/agents/tools/` 下加 `<tool>.ts`（用 `@sinclair/typebox` 写 parameters schema + `execute` 返回 `{ content: [{ type: 'text', text: JSON }], details }`），然后在 `tools/index.ts` 的相应 factory（outline/writer）里注册。Web 端 SSE 经 `useAgentStream` 自动转发 `tool.call` / `tool.result`，无需改前端。

**每次结束前必做**：`pnpm typecheck` 全绿。

## 约定

- **不写注释**：除非 WHY 非显然（隐藏约束、反直觉决定、外部 bug workaround）
- **不加防御性代码**：内部函数信任内部调用者；只在 API 边界校验
- **不创建 `.md` / 文档文件**，除非用户明确要求
- **Prompt 通用优先**：示例用抽象形态描述（"某具名配角的真实身份"），**不要**绑死到具体小说的人名/物名——换书就失效
- **提示词大改前先人工校验**：用 `cat ~/.novel-agent/data/<id>/source/hooks.md`（或 `source/chapters/0001.md`）直接看 LLM 实际输出，别凭感觉

## 已解决的典型陷阱

1. **模板字面量里写 `` `[]` ``**：TypeScript 会把 `[]` 当 element access 解析。prompt 里要提"空数组"用中文或纯 `[]`，不要反引号包
2. **人物关系幻觉**：Pass 2a 旧版只喂 2 条切片事件当上下文，LLM 会把晚辈脑补成子女。解决：喂代表性章节摘要（`sampleEvenly`），prompt 里强制"关系必须有明文证据"
3. **钩子数量被数字校准压死**：旧 refine prompt 给了"50 章 5-10 条"硬上限；高武/系统流实际密度是 50 章 30-80 条。基准要**随题材**，不要一刀切
4. **跨章伞状钩子抓不到**：单章/单 batch 的 LLM 视角决定了它只能看到症状级钩子（"某某也成代言人"），永远看不到"某某真实身份"。解决：`synthesizeStructuralHooksPrompt` 跨章合成 pass
5. **SSE 进度语义**：`analysis_from` / `analysis_to` 表示**最近一次 run** 的范围，不是累计范围。累计看 `analyzed_to`（高水位列）
6. **pi-coding-agent SDK shape 不直觉**：`createAgentSession({...})` 不接受 `systemPrompt` —— system prompt 要塞给 `DefaultResourceLoader` 构造器（`new DefaultResourceLoader({ systemPrompt, ... })`）。`tools` 不是字符串数组而是 `Tool[]`（`readTool` / `grepTool` / `lsTool` 从 root 导入）。session 用 `session.subscribe(fn)` 拿事件、`session.sendUserMessage(text)` 发用户消息——`sendUserMessage` 在消息入队时就 resolve，turn 实际结束要监听 `agent_end` 事件
7. **SSE 事件命名映射**：SDK 原生事件是 `message_update.assistantMessageEvent.text_delta` 等，需要在 `routes/agent.ts` 的 `subscribeAndPipe` 里翻译成 `useAgentStream` 期望的 `message.delta` / `message.complete` / `tool.call` / `tool.result` / `done`
8. **shared types 跨包**：`MapsRecord` / `OutlineRecord` / `ChapterDraftRecord` / `StateRecord` / `AgentSessionInfo` / `AgentEvent` 都在 `packages/shared/src/types.ts`；后端 `target-writer.ts` 和 `state.ts` 用 `export type { ... } from '@novel-agent/shared'` 透传，避免双定义漂移

## Tab 滚动与 UX

详情页的布局用 **single scroll + sticky tab nav**（`sticky top-0 z-10 bg-neutral-50/95 backdrop-blur`）。不要回退到嵌套滚动条。

## 改写页布局

改写页（`RewritePage`）用 **顶部 header（batch 范围 + 启动按钮）+ 左 main（tabs + 选中产物）+ 右 aside（state 摘要顶 / AgentChat 底）**。React Query 用 `refetchInterval: 3_000` 拉 maps / outlines / drafts / state（agent 写入侧 → UI 拉取侧的简单同步）。

## 不要做的事

- ❌ 在 `runPass2` 里增量写 `source/characters/`/`source/subplots.md`/`source/hooks.md` — 重跑前必须先 `wipeSourceAggregates`，否则旧文件会和新文件混杂
- ❌ 给 prompt 举例时用具体人名 — 换书立刻废
- ❌ 改 prompt 后直接跑 `continue`（贵）— 先用 `reaggregate`（几乎免费）验证
- ❌ 悄悄改 `analysis_from/to` 的语义 — UI 多处依赖它是"当前 run 的范围"
- ❌ **不要并行启动同一 novel 的两个 outline session 或两个 writer session** — 它们都写 `target/state.md`，并发会互相覆盖
- ❌ 直接 `fetch` 后端 API 不走 React Query — UI 多处需要轮询同步 agent 写入；统一走 `useQuery` + `refetchInterval`
- ❌ 给 `useAgentStream` 加额外 buffer / 重连逻辑 — SSE event 已经按 `\n\n` 切；逻辑简单不要叠层。断流就刷新
- ❌ 在 agent prompt 里举例时用具体人名（同 source 分析 prompt 的规则）
- ❌ 改 agent system prompt 后直接跑全量 batch — 先用 1-3 章 batch 试 cost
- ❌ 假设 agent session 在 server 重启后还在 — 内存存活，重启即丢；前端要处理 404

## 参考的外部约定

- **DeepSeek JSON 模式**：`response_format: { type: 'json_object' }` + `chatJson<T>()` 包装。JSON 必须严格、LLM 容易加前缀/后缀，失败要 try/catch 并给 fallback
- **React Query key 约定**：`['novel', id]` / `['chapters', id]` / `['characters', id]` / `['subplots', id]` / `['hooks', id]`。分析完成后手动 invalidate 这几个（见 `NovelDetailPage` 里的 `useEffect`）
