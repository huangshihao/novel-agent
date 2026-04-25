# 番茄爽文改写 Agent 设计

日期：2026-04-25

## 目标

把 novel-agent 从"小说分析工具"改造为"基于参考小说的批量改写 agent"，能完成番茄式爽文的：

- **改写**：拿原书的剧情骨架，替换人名/行业/部分支线分支事件/调整事件顺序，输出新书。
- **分批改写（用户口中的"续写"）**：原书 1000 章，每批改写 100 章，用户检查并通过对话调整后再启动下一批。**永远锚定在原书对应章段**，不创造新剧情。
- **用户介入**：通过和大纲 agent 对话来修改大纲，不做手动文件编辑。

主要改进点：

1. 分析管线产物从"给人看的总结"重构为"给 agent 查询的结构化文件"
2. 钩子只抽长线，去掉短线
3. 新增：题材/世界观、角色 role、角色死亡章节、风格样本
4. 存储从 SQLite 全面切到 Markdown
5. 引入两个 agent（大纲 / 写作），基于 `@mariozechner/pi-coding-agent`
6. 用 4 个自定义工具 + 3 个内置工具（`read`/`grep`/`ls`）实现，**不**走 schema 化路线
7. 通过工具内部强校验解决：人名漂移、死人复活、原行业词残留

## 工作流

```
[一次性] 上传参考小说 → 分析管线 → data/<id>/source/**.md
                                    │
                                    └─ meta / characters / hooks / subplots / chapters

[第 1 批] 用户启动改写 1-100 章
  ├─ 大纲 agent
  │   ├─ 首次：proposeCharacterMap （LLM 生成置换表草案）→ updateMaps
  │   ├─ 首次：setSettingMap（LLM 决定行业置换：工厂 → 餐饮）
  │   └─ 逐章：writeChapterOutline(1..100)
  ├─ 用户对话调整大纲（"把第 5 章反派换成女反派"）→ 大纲 agent 调 writeChapterOutline upsert
  └─ 写作 agent
      └─ 逐章：getChapterContext(n) → writeChapter(n) → 校验失败重试

[第 2 批] 用户启动改写 101-200 章
  ├─ 大纲 agent（新 session）
  │   └─ getOutline({range:[1,100]}) → 续 writeChapterOutline(101..200)
  └─ 写作 agent（新 session）
      └─ getChapterContext 自动包含前批结果 → writeChapter
```

跨批次状态（角色置换、setting、alive/dead、伏笔 open/paid_off）自然通过文件系统持久化。

## 数据存储：Markdown + Front Matter

放弃 SQLite，全用文件系统。Server 端 = filesystem → JSON 的薄适配层。

```
data/<novel-id>/
├── source/                       # 一次性分析产出，只读
│   ├── meta.md                   # 概览 + 行业/世界观 + 文风标签 + 风格样本
│   ├── characters/
│   │   ├── 张三.md
│   │   └── ...
│   ├── subplots.md               # 全部支线一个文件
│   ├── hooks.md                  # 全部长线伏笔一个文件
│   └── chapters/
│       ├── 001.md
│       └── ...
└── target/                       # 改写产出
    ├── maps.md                   # 角色置换 + 题材置换
    ├── state.md                  # alive/dead + hook open/paid_off
    ├── outlines/
    │   ├── 001.md
    │   └── ...
    └── chapters/
        ├── 001.md
        └── ...
```

### 通用约定

- 结构化字段进 YAML front matter，叙述/描述放正文
- 写文件用 `write-temp + rename` 保证原子性
- 同一 novel 的并发写在 server 进程内用 per-path mutex 串行
- Server 启动时把所有 front matter 扫进内存做索引（LRU 失效），列表 endpoint 直接走索引
- **`data/` 整体进 `.gitignore`**。不入 git 的理由：①原书版权风险 ②改写产物反复重写会让 history 成垃圾箱 ③多本小说累积会让 repo 无限膨胀。仅保留 `data/.gitkeep` 占位。如某本书需要独立版本历史，用户可单独在 `data/<id>/target/` 内 `git init`。

### Front Matter Schema

**`source/meta.md`**
```yaml
---
title: "都市修仙"
chapter_count: 1000
genre_tags: ["都市", "修仙", "爽文"]
industry: "茶艺馆经营"
era: "现代"
world_rules: ["灵气复苏", "境界划分：练气/筑基/金丹", "凡人不知有修士"]
key_terms: ["茶馆", "灵茶", "境界", "天劫"]
style_tags: ["快节奏", "对白多", "口语化", "战斗描写细致"]
---

## 概要
（一段总览）

## 风格样本
（5-10 段从原书均匀采样的代表性段落原文，每段 200-300 字，供写作 agent 写第 1 章前学习文风）
```

**`source/characters/<name>.md`**
```yaml
---
canonical_name: "张三"
aliases: ["老张", "张大哥"]
role: "protagonist"            # protagonist | female-lead | antagonist | mentor | family | side | tool
function_tags: ["主角", "茶馆老板"]
first_chapter: 1
last_chapter: 950
death_chapter: null            # 若原书内死亡，填章号
---

## 描述
（80 字以内，描述他在书中做了什么 + 性格 + 关键关系。关系仅在原文有明文证据时写）
```

**`source/subplots.md`**
```yaml
---
subplots:
  - id: sp-001
    name: "茶馆扩张"
    function: "establish-setting"   # create-crisis | deliver-payoff | establish-setting | romance | growth
    chapters: [3, 5, 8, 12, 15]
    description: "..."
  - id: sp-002
    ...
---
```

**`source/hooks.md`** （**只长线**，去掉 type 字段）
```yaml
---
hooks:
  - id: hk-001
    description: "张三体内异能的真实来源"
    category: "secret"             # suspense | crisis | payoff | goal | secret | relation | rule | contrast | emotion
    planted_chapter: 3
    payoff_chapter: 487            # 原书已收的章号；未收则 null
    evidence_chapters: [3, 27, 88, 145, 287]
    why: "多章反复提及但作者从未解释来源"
  - id: hk-002
    ...
---
```

**`source/chapters/<n>.md`**
```yaml
---
number: 5
title: "觉醒"
characters_present: ["张三", "李四"]
hooks_planted: ["hk-001"]
hooks_paid: []
subplots_touched: ["sp-001"]
---

## 摘要
（150-200 字详细摘要）

## 关键事件
- 张三激活体内异能
- 李四叛变
```

**`target/maps.md`**
```yaml
---
character_map:
  - source: "张三"
    target: "陈墨"
    note: "（用户备注，可空）"
  - source: "李四"
    target: "白浅"
setting_map:
  original_industry: "茶艺馆经营"
  target_industry: "私房菜餐厅"
  key_term_replacements:
    "茶馆": "餐厅"
    "灵茶": "灵食"
    "煮茶": "做菜"
---
```

**`target/state.md`**
```yaml
---
alive_status:
  陈墨: { alive: true, last_seen_chapter: 100 }
  白浅: { alive: false, death_chapter: 87 }
hooks:
  hk-001: { status: "open" }       # open | paid_off
  hk-002: { status: "paid_off", paid_chapter: 64 }
new_hooks:                          # 大纲 agent 在改写过程中新埋的长线伏笔
  - id: nhk-001
    description: "..."
    planted_chapter: 23
    expected_payoff_chapter: 180
    status: open
---
```

**`state.md` 生命周期：**

- **初始化时机**：第一次 `updateMaps` 后，server 检测 state.md 不存在则自动创建：`alive_status` 用 `character_map.target` 列表初始化（所有人 `alive: true, last_seen_chapter: 0`）；`hooks` 拷贝 `source/hooks.md` 全部条目，状态全为 `open`（target 还没改写到，未 payoff）；`new_hooks` 空数组。
- **更新方式**：仅由 `writeChapter` 写入成功后派生更新（见下文工具签名）。大纲 agent 不直接写 state.md。
- **第二批继承**：第二批启动时不重新初始化，沿用第一批末尾的状态。

**`target/outlines/<n>.md`**
```yaml
---
number: 5
source_chapter_ref: 5             # 对应原书第几章（不是 1:1 也行，agent 决定）
hooks_to_plant: ["nhk-001"]
hooks_to_payoff: []
planned_state_changes:
  character_deaths: []
  new_settings: []
---

## 剧情
（一段 200-400 字的本章大纲，已应用置换表）

## 关键事件
- ...
```

**`target/chapters/<n>.md`**
```yaml
---
number: 5
title: "觉醒"
word_count: 3200
written_at: "2026-04-25T..."
---

（正文）
```

## 分析管线变更

**核心：改造 `packages/agent-server/src/analyzer.ts`，输出从 SQLite 改成 `source/**.md`。**

### 删除

1. **短线伏笔**完全不抽
   - `extractPrompt`：移除"`type = 'short'`"分支，所有钩子按长线抽
   - `extractPrompt`：钩子定义里删除"10-20 章内回收"的 short 描述
   - `refineHooksPrompt`：相应去掉 type 维度的判定，统一按长线 4 步自检
2. **`type` 字段**从 hook 数据结构里完全删除（`shared/types.ts` / front matter / 所有 prompt）
3. **SQLite 存储**：`db.ts` 退役（保留代码做参考，分析管线不再写入；新管线直接写 MD）

### 新增

1. **题材/世界观抽取**（`Pass 2d`，新步骤）
   - 输入：所有章节摘要 + 角色清单
   - 输出：`source/meta.md` 的 `industry / era / world_rules / key_terms` 字段
   - Prompt 重点：抽"原书的核心题材标签"和"如果要换行业，下面这堆词必须替换"

2. **角色 `role` + `death_chapter`**（在 `Pass 2a` 字符聚合里加）
   - `role` 枚举：`protagonist | female-lead | antagonist | mentor | family | side | tool`
   - `function_tags`：自由文本数组，给改写 agent 决定置换映射时用
   - `death_chapter`：扫摘要找死亡描写（"X 死了"、"被 X 杀"、"葬礼" 等），找不到就 null
   - Prompt 增加判定示例

3. **支线 `function` 标签**（在 `Pass 2b` 子情节聚合里加）
   - 枚举：`create-crisis | deliver-payoff | establish-setting | romance | growth`
   - 让大纲 agent 在改写时按功能等价替换支线分支

4. **风格样本**（`Pass 2e`，新步骤，**无 LLM**）
   - 机械采样：每隔 N 章（默认 N = 总章数 / 8）取 1 章，从原文里抽 1-2 段 200-300 字代表性段落
   - 选段策略：跳过纯过渡段，优先包含对白 / 动作 / 心理描写的段落
   - 写入 `source/meta.md` 的 `## 风格样本` section

### 修改

1. **`Pass 1` 输出从 `chapter_extract` 表改成 `source/chapters/<n>.md`**
   - 文件包含完整 front matter + summary + key_events
   - 增量分析的"已 extract 跳过"语义改成"已存在 MD 文件跳过"
2. **`Pass 2` 重跑语义保持**
   - 仍然 wipe 派生产物再重建：删除 `source/characters/`、`source/subplots.md`、`source/hooks.md`、`source/meta.md` 后重建
   - `chapter_extract`（即 `source/chapters/<n>.md`）保留，不重抽
3. **结构性钩子合成（synth）保留**
   - 这本来就是长线机制，不动
4. **人物聚合 prompt 增强**
   - 加 `role` 判定示例
   - 加 `death_chapter` 判定示例与硬约束（无明文死亡描写禁止填）

### 分析管线最终步骤

```
Pass 1 (per chapter, batched):
  → source/chapters/<n>.md

Pass 2 (aggregate):
  2a. 角色聚合         → source/characters/<name>.md
  2b. 支线识别         → source/subplots.md
  2c. 钩子（仅长线）：
      i.  结构性合成   → 候选
      ii. refine + dedup + payoff 匹配
                       → source/hooks.md
  2d. 题材/世界观      → source/meta.md (industry/era/world_rules/key_terms)
  2e. 风格样本（无 LLM）→ source/meta.md (## 风格样本)
```

## Agent 架构

基于 `@mariozechner/pi-coding-agent` 的两个 `AgentSession`，跑在同一个 server 进程：

| Agent | 启动时机 | 工具白名单 | System Prompt 关键点 |
|---|---|---|---|
| **大纲 agent** | 用户开新批次 / 进入"改大纲"对话 | `read`、`grep`、`ls`、`updateMaps`、`writeChapterOutline` | 本批范围（如 101-200）；告知关键文件路径：`target/maps.md`、`target/outlines/`、`source/`；"先 `read target/maps.md`、`ls target/outlines/` 看现状，再逐章 `writeChapterOutline`" |
| **写作 agent** | 大纲完成后用户启动 / 单章重写 | `read`、`grep`、`ls`、`getChapterContext`、`writeChapter` | 本批范围；"逐章 `getChapterContext(n)` → `writeChapter(n, content)`，校验失败按返回的 issues 修正后重调" |

两个 agent 都打开 pi-coding-agent 的内置 `read` / `grep` / `ls`，禁掉 `write` / `edit` / `bash`（让自定义 write 工具是唯一写入路径，便于校验）。

## 自定义工具签名（共 4 个）

读 `target/maps.md` / `target/outlines/<n>.md` / `source/**.md` 走内置 `read` + `grep` + `ls`，**不再造自定义读工具**。System prompt 里告诉 agent 这些路径。

### `updateMaps({ character_entries?, setting? })`

Upsert 写入 `target/maps.md`。
- `character_entries`：批量 upsert 角色映射（按 source 主键）
- `setting`：完整覆盖 setting_map

### `writeChapterOutline({ number, source_chapter_ref, plot, hooks_to_plant, hooks_to_payoff, planned_state_changes })`

Upsert 写入 `target/outlines/<n>.md`。

校验：
- `number` 必须在 server 进程启动时定义的本批范围内
- `hooks_to_plant` / `hooks_to_payoff` 必须存在于 `source/hooks.md` 或 `target/state.md.new_hooks`，否则返回 `{ ok: false, issues: ["unknown hook id"] }`
- `planned_state_changes.character_deaths` 提到的角色必须当前 `alive`

### `getChapterContext({ number })`

打包返回写本章正文所需的全部 context：
```typescript
{
  outline: <target/outlines/<n>.md>,
  maps: <target/maps.md>,
  recent_chapters: <target/chapters/<n-3..n-1>.md 正文>,
  // 写作 agent 写第 1 章时，recent_chapters 为空，转而附带 source/meta.md 的风格样本
  involved_characters: [
    { name, alive, last_seen_chapter, original_role }
  ],
  involved_hooks: [
    { id, description, status, action }   // action: "plant" | "payoff" | "background"
  ],
  // 第 1 章特殊：附带风格样本
  style_samples?: string[]
}
```

### `writeChapter({ number, content })`

Upsert 写入 `target/chapters/<n>.md`。

**内部强校验（混合策略）：**

| 校验项 | 等级 |
|---|---|
| 提到的人名必须在 `character_map.target` 列表里 | 硬拒，列出未注册的名字 |
| 提到的角色不能是 `alive_status[name].alive == false` | 硬拒，列出已死亡角色 |
| 出现 `setting_map.original_industry` 的关键词（白名单外） | 软警告，列出残留词，但保存 |
| 字数偏离大纲合理范围（< 1000 或 > 8000） | 软警告 |

返回结构：
```typescript
{
  ok: boolean,
  issues: { level: "error" | "warning", message: string, hits?: string[] }[],
  saved_path?: string  // 仅 ok=true 时
}
```

LLM 看到 `ok: false` 时按 issues 修正后重调同一个 `writeChapter`。

写入成功后，**自动派生 state 变更并写回 `target/state.md`**：
- `alive_status[char].last_seen_chapter` 更新为 `number`
- `outline.planned_state_changes.character_deaths` 里的角色 → `alive: false, death_chapter: number`
- `outline.hooks_to_plant` 里的 hook → status `open`，新条目入 `new_hooks`
- `outline.hooks_to_payoff` 里的 hook → status `paid_off, paid_chapter: number`

## 工具数量与暴露面

| | 大纲 agent | 写作 agent |
|---|:-:|:-:|
| 内置（pi-coding-agent） | `read` `grep` `ls` | `read` `grep` `ls` |
| 自定义读 | — | `getChapterContext` |
| 自定义写 | `updateMaps` `writeChapterOutline` | `writeChapter` |
| **总计可见** | **5** | **5** |

**自定义共 4 个**：`updateMaps`、`writeChapterOutline`、`getChapterContext`、`writeChapter`。

`getChapterContext` 留下的理由：写作 agent 写一章要拿齐"大纲 + 置换表 + 最近 3 章正文 + 涉及角色生死 + 涉及伏笔状态 + (第 1 章) 风格样本"——5 个 `read` 调用 vs 1 个打包工具，token 与稳定性都更优。

## Server 端职责

- REST 端点（仅读为主）：list novels、show novel meta、list chapters / characters / hooks / subplots、show outline progress、show chapter draft
- 全部从 MD 文件读 + front matter 解析 + JSON 化返回
- SSE：分析 / 大纲 / 写作 job 的进度事件
- 后台 job 触发：`POST /api/novel/:id/analyze`、`POST /api/novel/:id/outline?range=...`、`POST /api/novel/:id/write?range=...`
- 启动时扫所有 `data/**` front matter 进内存索引；文件变更时增量刷新

## 迁移路径（一刀切）

1. 新建 `packages/agent-server/src/storage/markdown.ts` 封装 MD + front matter 读写（用 `gray-matter`）
2. 重写 `analyzer.ts` 输出端：删除所有 `db.prepare` 调用，换成 MD 写入
3. 删除 `packages/agent-server/src/db.ts`、SQLite 依赖（`better-sqlite3`）
4. 重写 `routes/novel.ts` 为 MD 读取
5. 前端 `packages/web/src/lib/api.ts` 字段大致兼容（前端类型已有 character/subplot/hook，新增 role / death_chapter / industry 等字段补回）
6. 前端 UI 增加 / 改造的页面：
   - 角色置换表编辑页（实际上不让用户手动编辑——改成"打开和大纲 agent 的对话"按钮）
   - 大纲页面（按章列表 + 单章详情）
   - 写作进度页面 + 单章原文查看
   - 两个 agent 对话页面（仿 BIM desktop 的对话窗口）
7. 引入 `@mariozechner/pi-coding-agent` 等依赖；新建 `packages/agent-server/src/agents/outline.ts` 和 `agents/writer.ts`
8. 数据迁移脚本（可选）：现有 SQLite 数据导出为新版 MD 结构，方便已分析的小说不重跑

## 未决 / V2

- 续写（脱离原书自创剧情）：本 spec 不覆盖；先把锚定原书的批量改写跑通
- 多用户：当前假设单用户本地工具，多用户隔离 = `data/<user-id>/<novel-id>/`，路由层加上即可
- 写作 agent 的细颗粒度（场景级 / 节拍级）：本 spec 选章级；后续如果出现"章太长 LLM 写不动"再拆
- 风格样本是否需要 LLM 提取（让 LLM 选"最有代表性"的段落）：先做无 LLM 的机械采样，跑出来不够好再升级
