# novel-agent

Web 应用：上传参考网文 → DeepSeek 分析出章节摘要 / 人物 / 支线 / 钩子 → 基于分析结果生成改编大纲 → 根据大纲自动生成正文。

**当前进度**：参考分析已完成；**大纲生成 + 正文生成 + pi-coding-agent 接入**三块还没做（见文末 Roadmap）。

## 架构

```
packages/
  agent-server/   # Hono + SSE + better-sqlite3 + DeepSeek client
  web/            # React + Vite + Tailwind v4 + React Query + React Router
  shared/         # 跨端 TS 类型（Novel / Chapter / Hook / ...）
```

数据库：`~/.novel-agent/data.db`（SQLite，WAL 模式，幂等迁移）。

## 开发

```bash
cp .env.example .env                    # 填 DEEPSEEK_API_KEY（必填）、KIMI_*（agent 写作留用）
pnpm install
pnpm dev                                # server :3100 + web :5173
pnpm typecheck                          # 全工作区 tsc --noEmit
```

## 分析管线（当前状态）

### Pass 1 · 每章结构化抽取
- 位置：`analyzer.ts#extractPrompt`
- 以 5 章一批喂给 DeepSeek，每章最多 1500 字（clip 头 70% + 尾）
- 产出：summary / characters_present / key_events / hooks_planted（候选，带 4 步自检） / hooks_paid
- 结果存 `chapter_extract` 表（幂等，重跑时已有 extract 的章节跳过）

### Pass 2a · 人物聚合
- 合并别名；喂摘要而非切片事件当上下文；严禁凭空推测亲属关系；过滤一次性工具人
- 产出 `character` 表

### Pass 2b · 支线识别
- 喂全章摘要+事件，识别 3-10 条主/支线

### Pass 2c.1 · 结构性钩子合成（**新**）
- 位置：`analyzer.ts#synthesizeStructuralHooksPrompt`
- 输入：全章候选钩子 + 全章摘要 + 人物清单
- 任务：识别跨 3+ 章的**伞状悬念**（例：某配角真实身份、某组织真实目的、某道具来历）
- 解决的问题：Pass 1 每次只能看 5 章，永远抓不到贯穿多章的结构性谜。这一步把碎线索合成为 umbrella hook

### Pass 2c.2 · refine（过滤+去重+payoff 匹配）
- 位置：`analyzer.ts#refineHooksPrompt`
- 对单章候选跑 **5 步自检**：
  1. 具体性（候选答案有边界）
  2. payoff 可视化（能写出兑现场景）
  3. 作者在主动藏（不是读者脑补）
  4. 非文体默认走向
  5. 不是某个结构性钩子的症状章（避免重复）
- **结构性钩子无条件保留**，只做 payoff 匹配
- 数量校准：每章 0.5-1.5 条，50 章期望 25-50 条

### 钩子分类（9 类 `HookCategory`）
`suspense / crisis / payoff / goal / secret / relation / rule / contrast / emotion`

## 核心端点

```
POST   /api/novel              上传 .txt；body: file + title + chapter_count
POST   /api/novel/:id/continue {more: N}         继续分析接下来 N 章（增量）
POST   /api/novel/:id/reaggregate                仅重跑 Pass 2（不重抽 Pass 1，省 token）
DELETE /api/novel/:id/hooks/:hookId              删除单条钩子
GET    /api/novel/:id/hooks                       含 evidence_chapters（伞状钩子的证据章节链）
GET    /api/novel/:id/events                      SSE：analyze.progress / analyze.chapter / status / done
```

## 已知运行参数

- `BATCH_SIZE = 5`（Pass 1 每批章数）
- `MAX_CHAPTER_CHARS = 1500`（Pass 1 每章截断）
- `DEFAULT_CONCURRENCY = 3`（Pass 1 并发）
- 可用 `ANALYZE_CONCURRENCY` env 覆盖

---

## 下一步任务（Roadmap）

### 主线：从参考分析 → 改编大纲 → 自动成文

这三块是目前整个产品的**核心未完成部分**，按顺序做：

- [ ] **1. 接入 pi-coding-agent**
  - agent-server 目前只有分析管线和 DeepSeek 客户端；需要把 pi-coding-agent 作为"写作 agent"挂进来
  - 关键决策：agent 进程模型（同进程调用 vs 子进程 RPC vs HTTP）、工具集合（读章节/读分析结果/写大纲/写正文）、状态流（长任务 SSE / 断点续跑 / 失败重试）
  - 接入后第一步是让 agent 能读到 `chapter` / `character` / `subplot` / `hook` 四张表的数据，相当于给它一个 "参考小说知识库"

- [ ] **2. 改编生成大纲**
  - 输入：参考小说的分析结果（人物卡 + 支线 + 钩子——尤其是伞状钩子）+ 用户给的改编指令（换题材 / 改主角设定 / 换背景 / 新增支线等）
  - 输出：结构化大纲（分章节、每章目标事件、埋哪些钩子、推进哪条支线、动用哪些人物）
  - 要想清楚：大纲的**粒度**（每章一段 vs 每章一个事件列表）、**钩子映射**（参考小说的钩子怎么对应到改编后的钩子）、**存储**（新增 `outline` 表 + `outline_chapter` 子表）
  - UI：新 tab "大纲" 或独立页面；能让用户手动编辑/调整后再进入下一步

- [ ] **3. 根据大纲自动生成正文**
  - 输入：大纲中的一章（或多章）+ 上下文（前几章已生成正文 / 全局人物卡 / 需要兑现的钩子 / 当前支线状态）
  - 输出：该章正文（~2000-3000 字）
  - 要解决的：**上下文窗口**（不可能把之前所有正文都塞进去——需要摘要 + 关键钩子的 "活页"）、**连贯性检查**（人物名字、已兑现/未兑现钩子、支线状态不能穿帮）、**风格一致性**（可选：用参考小说原文做 few-shot）、**并发/长任务** UX（流式输出？一次一章？可断点续跑？）
  - 新增：`generated_chapter` 表（或复用 `chapter` + 标记字段）

### 次线（随主线并行推进）

- [ ] **验证新的结构性钩子合成**：对现有小说点"仅重聚合"，确认能识别伞状钩子（如"某配角的真实身份"）。这是大纲生成的重要输入，合成不准大纲就废
- [ ] **Pass 1 质量 vs 成本调优**：`BATCH_SIZE=5 + 1500 字 clip` 稀释伏笔。加 env 可调 + 实验不同配置的召回率
- [ ] **钩子 payoff 时间线视图**：UI 展示 planted→payoff 跨度，伞状钩子展开证据章节链——方便写大纲时查阅
- [ ] **LLM token/cost 可观测性**：统计每 pass / 每 agent 步骤的 token，前端汇总

### 维护 / 低优

- [ ] **评测基准**：固定 2-3 本不同题材参考小说，人工标注 ground-truth 钩子，跑回归测试
- [ ] **refine 数量校准按题材自适应**：高武/系统流密度高、传统文学低
- [ ] **Pass 1 失败容错**：per-batch 重试 + 持久化失败章节列表
- [ ] **单元测试**：至少 `chapter-splitter.ts` + 纯函数
- [ ] **多租户 / 多用户**

## 常见操作

```bash
# 直接看 DB 里的钩子（调试用）
sqlite3 ~/.novel-agent/data.db \
  "SELECT planted_chapter, category, evidence_chapters_json, description FROM hook WHERE novel_id='<id>' ORDER BY planted_chapter;"

# 列出所有小说
sqlite3 ~/.novel-agent/data.db "SELECT id, title, chapter_count, analyzed_to, status FROM novel;"

# 清 DB 重来（开发期）
rm ~/.novel-agent/data.db*
```
