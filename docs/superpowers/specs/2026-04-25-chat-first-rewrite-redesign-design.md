# Chat-first 改写页 redesign 设计

## 背景

当前改写页（`RewritePage`）的形态：左侧 4 个 artifact tab、右侧 400px 宽的 sidebar 同时挂"state 摘要 + AgentChat"。问题：

1. 强行把 agent 拆成 outline-agent / writer-agent 两套，system prompt 各自维护，跟用户实际工作流（一会儿改人物、一会儿写大纲、一会儿改某章正文）不匹配。
2. 一个 novel 同一时刻只允许一个 active session/batch；session 内存存活，重启即丢，没有"聊天历史"概念。
3. AgentChat 组件粗糙：tool call 状态显示有 bug（已修但底子简陋）；@mention、markdown、滚动定位、stop 控件都没有。
4. 当前 system prompt 改写效果太弱——只换主角名，剧情几乎照抄、配角不改、场景设定（药厂试药、跟父亲对打）原样保留。用户要的是**洗稿**：保主线节点 + 全部表面替换 + 支线顺序调整。
5. 页面有 max-width 居中，浪费屏幕。需要 chat 历史 / chat 窗口 / artifact 预览同屏可见。

## 目标

把改写页重做成 chat-first 形态，单一 agent，多 chat 历史可切换，UI 全屏 3 栏，system prompt 重写成"洗稿"导向。

## 非目标

- 分析侧（NovelListPage / NovelDetailPage / 所有 `/api/novel/*` 非 agent 路由）不动。
- 4 个 custom tool（`updateMaps` / `writeChapterOutline` / `getChapterContext` / `writeChapter`）的 schema + execute 逻辑不动，只调整其 prompt 子段。
- `target/maps.md` / `target/state.md` / `target/outlines/<n>.md` / `target/chapters/<n>.md` 文件结构不动。

## 设计

### §1 数据模型

每本小说下增加 `chats/` 目录：

```
data/<novel-id>/
├── source/         不变
├── target/         不变
└── chats/
    ├── index.md           chat 元数据列表（front matter 数组）
    └── <chat-id>.jsonl    每个 chat 一个文件，pi-coding-agent SessionManager 直写
```

`chats/index.md` 的 front matter schema：

```yaml
---
chats:
  - id: cht-<timestamp>-<rand>
    title: "前 10 章大纲讨论"          # 默认取首条用户消息前 30 字，可改
    created_at: 2026-04-25T21:30:00Z
    last_msg_at: 2026-04-25T21:45:12Z
    last_user_text: "再帮我把第 3 章节奏拉紧一点"  # 侧栏 preview
---
```

**Session 生命周期**：
- 新建 chat：创建 `chats/<chat-id>.jsonl`（空 SDK session），追加一行进 index.md。**不**起 SDK in-memory session（懒加载）。
- 用户首次发消息：从 jsonl 起 `SessionManager.open()` → 包成 agent → 占用 active 锁 → 流式跑。
- 切换 chat（前一个空闲）：销毁前一个 agent 实例（dispose），新 chat 用 `SessionManager.open(filePath)` 加载历史，重建 agent。
- 切换 chat（前一个还在跑）：返回 `409`，UI 弹"先停掉当前 chat"，确认后调 stop 再切。
- 删除 chat：rm jsonl + 从 index.md 删该行；如果是 active chat，先 dispose + 释放锁。

**Active 锁**：现有 registry 的"一 novel 一 active"语义保留，key 从 novelId-only 变成 `(novelId, chatId)`，但同一 novelId 仍只允许一个 chatId 占用。

### §2 后端 agent

**统一一个 agent 工厂** `createChatAgent({ novelId, sessionPath })`：
- 工具：`read` / `ls` / `grep` + 4 个现有自定义工具
- 一份合并的 system prompt（见下）

**System prompt 核心：洗稿 mindset**

agent 的工作不是翻译/抄写，是洗稿。规则：

1. **主线大剧情节点保留**（A 救了 B、B 死了、主角晋级）——这是节奏吸引力来源。
2. **人名全改**（最关键的修复点）：
   - `updateMaps` 必须把 `source/characters/` 下所有出场过的角色都填进 `char_map`，不只主角。
   - 改名规则：保留性别、大致年龄段、角色功能（mentor/family/antagonist），换姓和名字风格。
3. **设定表面替换**（`setting_map.key_term_replacements` 扩容）：
   - 不只是 `industry`（"打药修炼" → "炼丹修真"）。
   - 覆盖：关键场景类型（药厂 → 灵药园 / 宗门试炼场）、武道术语（铜皮铁骨 → 锻体淬骨）、关键道具类型。
   - 出现频次高的具体术语都要落进 map。
4. **分支事件换形态**（写大纲时执行）：
   - 原文「去药厂试药 + 跟父亲对打」 = 「外部资源获取」+「家庭冲突」两个剧情功能。
   - 改写要保留这两个功能，但换具体载体：「潜入秘境采灵药 + 跟师叔切磋」。
   - 写每一章 outline 时，agent 先复述原章功能，再设计替代场景，最后写 plot。
5. **支线顺序可调**：
   - `source/subplots.md` 列了支线章节范围；不影响主线因果的支线允许在改写大纲里调换出现顺序。
   - 规则：支线 A 和 B 之间无因果依赖（B 不引用 A 的结果）→ 允许调换。
6. **避免雷同自检**：每章 outline / 正文写完，agent 自查场景、道具、术语、人名是否还跟原文撞，撞就再改一遍。

**System prompt 还要教 agent**：
- 工作区：`data/<novel-id>/{source,target}`；source 只读，target 是改写产物。
- 用户消息可能含 token：`@大纲` / `@大纲第N章` / `@正文第N章` / `@置换表` / `@人物X`，token 指向的 artifact 即本轮操作或参考目标。
- 写大纲前先 `read` 对应 source 章节摘要 + maps；写正文前 read 对应 outline + state.md。
- 写一批章节时**串行**循环 `writeChapter`，写完一章再下一章。
- 用户没指定范围时主动问，不要瞎写。

### §3 UI

**布局**（`RewritePage`，全屏，无 max-width）：

```
┌─────────────────────────────────────────────────────────────┐
│ ← 小说名 / chat 标题                  [stop] [⋮]            │ 顶栏 h-12
├──────────┬───────────────────────┬──────────────────────────┤
│          │                       │ [置换表][大纲][正文][state]│
│ Chat     │ Thread (assistant-ui) │                          │
│ History  │  ──messages list──    │  当前 artifact 预览       │
│  240px   │  ──Composer (＠)      │  (复用 4 个现有 panel)    │
│          │  min 500, flex        │  min 600, flex           │
│ + 新建   │                       │                          │
└──────────┴───────────────────────┴──────────────────────────┘
```

窄屏（< 1280px）chat 历史栏折叠成 icon-only。

**assistant-ui 集成**：
- 用 `@assistant-ui/react` 的 `ExternalStoreRuntime`：消息列表 + streaming 状态留在我们自己的 store，runtime 只负责渲染。
- 写 adapter（替代 `useAgentStream`）：拉 chat 消息 / 处理 SSE → 把 `messages + isRunning + onSend + onCancel` 喂给 ExternalStoreRuntime。
- 4 个自定义 tool + read/ls/grep 各注册一个 `makeAssistantToolUI`，把 tool call 渲染成可折叠卡片（"updateMaps · 完成 / 改了 N 条"）。

**@ 菜单**（不用 assistant-ui 自带 mention，自己用 Radix Popover 实现）：
- Composer 监听 `@` 键 → Popover 弹出。
- 选项分两组：
  - **动作类**（静态写死）：`生成大纲` / `生成正文` / `生成置换表`。
  - **产物引用**（打开时现拉接口）：
    - 大纲列表 `GET /api/novel/:id/outlines`（已有）
    - 正文列表 `GET /api/novel/:id/drafts`（已有）
    - `置换表`（恒有）
    - 角色（从 `target/maps.md` 的 char_map 拉，map 还没生成就这组为空）
- 选中后插入纯文本 token（如 `@大纲第10章`）；agent 通过 system prompt 学会解析。

**右侧 artifact 预览**：
- 顶部 4 个 tab：置换表 / 大纲 / 正文 / state。
- 复用现有 `MapsPanel` / `OutlinePanel` / `DraftsPanel` / `StatePanel`，react-query 3s 轮询不变。

**Chat 侧栏**：
- 拉 `GET /api/novel/:id/chats`（读 chats/index.md），按 last_msg_at 倒序。
- 当前 chat 高亮；正在跑的 chat 名字旁加 spinner。
- `+ 新建 chat` → POST 创建 → 自动切到新 chat。
- 切 chat 前如果当前 chat 在 streaming，弹「先停掉？」。
- hover 出 trash 删除（后端硬删 jsonl + index.md 删行）。

### §4 API

**新的 chat-scoped 路由**：

| Method | Path | 说明 |
|---|---|---|
| `GET` | `/api/novel/:id/chats` | 列 chats（读 chats/index.md） |
| `POST` | `/api/novel/:id/chats` | 新建空 chat，body `{title?: string}`，返回 metadata；不起 SDK session |
| `GET` | `/api/novel/:id/chats/:cid` | 读单个 chat 历史（jsonl → UI message[]） |
| `PATCH` | `/api/novel/:id/chats/:cid` | 改标题，body `{title}` |
| `DELETE` | `/api/novel/:id/chats/:cid` | rm jsonl + index 删行；active chat 先 dispose |
| `POST` | `/api/novel/:id/chats/:cid/message` | 发消息（SSE）；首次调用懒起 session |
| `POST` | `/api/novel/:id/chats/:cid/stop` | 停 streaming |

**简化 active 接口**：`GET /api/novel/:id/active` → `{ chatId } | null`，旧的 `kind: 'session' | 'batch'` 二选一概念取消。

**Active 锁判定**（在 `/message` 入口）：
- 空 → 占用 `(novelId, chatId)`，开 stream。
- 占用方是别的 chatId → `409 {error: 'another_chat_running', activeChatId}`。
- 占用方同 chatId 但已结束 → 重新占用，继续追加。
- 占用方同 chatId 仍在 stream → `409 {error: 'chat_busy'}`。

**SSE 事件 shape 不变**：复用 `message.delta` / `message.complete` / `tool.call` / `tool.result` / `done` / `error`（已有 `id` 字段）。前端 adapter 翻译成 assistant-ui message format。

**删除的旧路由**：
- `outline/start`、`outline/revise`、`writer/start`、`writer/revise`
- `job/:jid` 全套（GET / DELETE / abort / retry / skip / stream）
- `session/:sid/message`、`DELETE session/:sid`

**保留**：`/api/novel/*` 那一坨（list / upload / analyze SSE / chapters / characters / subplots / hooks / maps / outlines / drafts / state / source）全部不动。

### §5 删除/迁移清单

**Backend 删除**：
- `packages/agent-server/src/agents/outline-session.ts`
- `packages/agent-server/src/agents/writer-session.ts`
- `packages/agent-server/src/agents/batch-job.ts`
- `packages/agent-server/src/agents/batch-job.test.ts`

**Backend 新增**：
- `packages/agent-server/src/agents/chat-session.ts`（合并 outline/writer factory）
- `packages/agent-server/src/storage/chat-store.ts`（chat 文件 CRUD + SessionManager 包装）
- `packages/agent-server/src/storage/chat-index.ts`（chats/index.md front matter 解析，类似 novel-index.ts）

**Backend 改造**：
- `packages/agent-server/src/routes/agent.ts` 重写：删旧路由，加 chat 路由，保留 SSE 翻译。
- `packages/agent-server/src/agents/system-prompts.ts`：删 outline + writer 两段 prompt，写一段统一的 chat system prompt（含洗稿原则）。
- `packages/agent-server/src/agents/tools/update-maps.ts`：调整 prompt 子段强制全员 char_map + 扩容 setting_map。
- `packages/agent-server/src/agents/tools/write-chapter-outline.ts`：调整 prompt 强制功能-场景替换 + 支线顺序调整。
- `packages/agent-server/src/agents/registry.ts`：重写为 chat-keyed，删 SessionEntry/BatchEntry 二元结构，统一为 ChatEntry。

**Shared types**：
- 删 `AgentSessionInfo`、`BatchJobInfo`、`BatchJobStatus`、`AgentRole`、`AgentMode`、旧的 `ActiveTask` union。
- 改 `ActiveTask` 为 `{ chatId: string } | null`。
- 加 `ChatInfo`：`{ id, novel_id, title, created_at, last_msg_at, last_user_text }`。

**Web 删除**：
- `packages/web/src/components/AgentChat.tsx`
- `packages/web/src/components/BatchJobPanel.tsx`
- `packages/web/src/components/GenerateForm.tsx`
- `packages/web/src/lib/use-agent-stream.ts`

**Web 新增**：
- `packages/web/src/components/ChatPanel.tsx`（assistant-ui Thread + Composer）
- `packages/web/src/components/ChatSidebar.tsx`
- `packages/web/src/components/MentionPopover.tsx`（@ 弹窗）
- `packages/web/src/components/ArtifactTabs.tsx`（包 4 个现有 panel）
- `packages/web/src/components/tool-cards/`（每个 tool 一个 `makeAssistantToolUI` 组件）
- `packages/web/src/lib/chat-runtime.ts`（assistant-ui ExternalStoreRuntime adapter）
- `packages/web/src/lib/chat-api.ts`（chat lifecycle API client，替代 agent-api.ts）

**Web 改造**：
- `packages/web/src/pages/RewritePage.tsx`：整页重写为 3 栏布局。
- `packages/web/src/lib/use-active-task.ts`：简化为 `useActiveChat`。
- `packages/web/src/lib/agent-api.ts`：删除（被 chat-api.ts 替换）。
- 装新依赖：`@assistant-ui/react`、`@assistant-ui/react-markdown`、`@radix-ui/react-popover`（如未装）。

**保留不动**：
- `packages/web/src/components/{MapsPanel,OutlinePanel,DraftsPanel,StatePanel}.tsx`
- 所有 analysis 页面 (`NovelListPage`, `NovelDetailPage`)
- `target-reader.ts` / `target-writer.ts` / `state.ts`（被新 ChatPanel 间接使用）
- 4 个 custom tool 的 schema + execute 逻辑（只改其 prompt 子段）
- `validator.ts`（如果有 batch-only 部分则切除，主功能保留）

## 风险与权衡

1. **assistant-ui runtime 适配成本**：约 150-250 行 adapter 代码，第一次接入这个库可能踩坑。回退方案：用 shadcn primitives 自己撸，但 UI 质量上限低。
2. **chat history 用 jsonl 不可读**：违反项目"全 MD"约定。但 SDK 自带的 SessionManager 只支持 jsonl，自己写 MD 持久化要重做 tool_use/tool_result 序列化。`chats/index.md` 仍用 MD 当人类可读索引。
3. **洗稿 mindset 落地难**：system prompt 教得了原则，但 LLM 实际照不照做要看实跑。建议 spec 实施完后做一轮 1-3 章试跑，对比改写前后是否真的换了所有人名 / 替换了关键场景，不行就迭代 prompt。
4. **删除 batch 概念**：丢掉 abort/retry/skip 单独按钮。回退：在 chat 里用自然语言「停下」「重写第 N 章」。如果用户实际跑大批量发现 chat 端控制不够，再加 batch tool。
5. **Active 锁仍是单点**：多浏览器窗口操作同一 novel 会互相 409。可接受（用户单人项目）。

## 测试策略

- TypeScript：`pnpm typecheck` 全过。
- 后端：写新单测覆盖 chat-store CRUD（创建 / 列出 / 切换 / 删除）+ active 锁判定。删 batch-job.test.ts。
- 端到端：手动跑一遍流程：新建 chat → @生成置换表 → @生成大纲 1-3 → @正文第1章 → 切到新 chat 不丢历史 → 切回继续。
- 洗稿验证：实跑 1-3 章后用 `diff` 比对原文 / 改写文，确认所有人名都换了、关键场景换了形态。

## 实施顺序建议

1. Backend storage 层（chat-store + chat-index）
2. Backend chat-session 工厂 + system prompt 合并 + tool prompt 调整
3. Backend routes/agent.ts 重写 + registry 改造
4. Backend 删除 batch / outline / writer / 旧路由
5. Shared types 更新
6. Web 装 assistant-ui + 写 ExternalStoreRuntime adapter
7. Web 写 ChatSidebar / ChatPanel / MentionPopover / ArtifactTabs
8. Web RewritePage 整页重写
9. Web 删除旧组件
10. typecheck + 手动端到端

`writing-plans` skill 接手后会把这个顺序拆得更细，并标注哪些步骤可并行。
