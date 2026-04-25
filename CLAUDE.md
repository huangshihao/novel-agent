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

## 改动流程

**加新字段**：`shared/types.ts` → `storage/source-writer.ts`（写入 + 类型）→ `storage/source-reader.ts`（读出 + body 解析）→ `analyzer.ts` 填值 → `routes/novel.ts` 透传 → `lib/api.ts` 类型透传 → UI 展示。Front matter 新字段不需要迁移脚本（旧 MD 文件读到时是 undefined，按 default 处理）。

**改 prompt**：只改 `analyzer.ts` 里的 prompt 函数。改完用"仅重聚合"端点复验（不消耗 Pass 1 的 token）——见 `analyzer.ts#reaggregate` / `POST /api/novel/:id/reaggregate`。

**改 Pass 1 / 加聚合步**：记得保持**幂等**。Pass 1 跳过已有 extract 的章节，Pass 2 每次运行前 wipe `character` / `subplot` / `hook` 再重建。不要在 Pass 2 里增量 insert。

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

## Tab 滚动与 UX

详情页的布局用 **single scroll + sticky tab nav**（`sticky top-0 z-10 bg-neutral-50/95 backdrop-blur`）。不要回退到嵌套滚动条。

## 不要做的事

- ❌ 在 `runPass2` 里增量写 `source/characters/`/`source/subplots.md`/`source/hooks.md` — 重跑前必须先 `wipeSourceAggregates`，否则旧文件会和新文件混杂
- ❌ 给 prompt 举例时用具体人名 — 换书立刻废
- ❌ 改 prompt 后直接跑 `continue`（贵）— 先用 `reaggregate`（几乎免费）验证
- ❌ 悄悄改 `analysis_from/to` 的语义 — UI 多处依赖它是"当前 run 的范围"

## 参考的外部约定

- **DeepSeek JSON 模式**：`response_format: { type: 'json_object' }` + `chatJson<T>()` 包装。JSON 必须严格、LLM 容易加前缀/后缀，失败要 try/catch 并给 fallback
- **React Query key 约定**：`['novel', id]` / `['chapters', id]` / `['characters', id]` / `['subplots', id]` / `['hooks', id]`。分析完成后手动 invalidate 这几个（见 `NovelDetailPage` 里的 `useEffect`）
