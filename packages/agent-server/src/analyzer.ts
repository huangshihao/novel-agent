// 两趟分析管线：
//  Pass 1: 批量每章结构化抽取（summary + characters + events + hooks）
//  Pass 2: 跨章聚合（人物去重、支线识别），hooks 直接落库
//
// 外部入口：startAnalysis(novelId) —— 异步起飞，通过 event-bus 广播进度。

import { readFile } from 'node:fs/promises'
import { DeepSeekClient, DeepSeekError, pMap } from './deepseek-client.js'
import { buildAnalyzerLlmClient } from './lib/llm-client.js'
import { emitAnalysisEvent } from './event-bus.js'
import { paths } from './storage/paths.js'
import { writeSourceChapter } from './storage/source-writer.js'
import { listSourceChapters, listSourceChaptersFull, wipeSourceAggregates } from './storage/source-reader.js'
import {
  writeSourceCharacter,
  writeSourceHooks,
  writeSourceMeta,
  writeSourceSubplots,
} from './storage/source-writer.js'
import { readNovelIndex, updateNovelIndex } from './storage/novel-index.js'
import type {
  CharacterStoryFunction,
  KeyEventEntry,
  Replaceability,
  WritingRhythm,
} from '@novel-agent/shared'

const BATCH_SIZE = 5
const RHYTHM_BATCH_SIZE = 3
const MAX_CHAPTER_CHARS = 1500
const DEFAULT_CONCURRENCY = 3

const STORY_FUNCTIONS: CharacterStoryFunction[] = [
  'pressure-source',
  'benefactor',
  'rival',
  'witness',
  'resource-gateway',
  'emotional-anchor',
  'antagonist-proxy',
  'foil',
  'information-source',
  'gatekeeper',
]
const REPLACEABILITY: Replaceability[] = ['high', 'medium', 'low']

// ─── 类型 ─────────────────────────────────────────────────────────────────

type HookCategoryCode =
  | 'suspense'
  | 'crisis'
  | 'payoff'
  | 'goal'
  | 'secret'
  | 'relation'
  | 'rule'
  | 'contrast'
  | 'emotion'

const HOOK_CATEGORIES: HookCategoryCode[] = [
  'suspense',
  'crisis',
  'payoff',
  'goal',
  'secret',
  'relation',
  'rule',
  'contrast',
  'emotion',
]

interface ChapterExtract {
  chapter_id: number // 章节 number（1-based，对 DeepSeek 而言）
  summary: string
  characters_present: string[]
  plot_functions: string[]
  key_events: KeyEventEntry[]
  originality_risks: string[]
  hooks_planted: { desc: string; category: HookCategoryCode | null }[]
  hooks_paid: { ref_desc: string }[]
}

interface RefinedHook {
  desc: string
  category: HookCategoryCode | null
  planted_chapter: number
  payoff_chapter: number | null
  evidence_chapters: number[]
  why?: string
}

interface DedupedCharacter {
  canonical_name: string
  aliases: string[]
  role: 'protagonist' | 'female-lead' | 'antagonist' | 'mentor' | 'family' | 'side' | 'tool' | null
  function_tags: string[]
  story_function: CharacterStoryFunction | null
  replaceability: Replaceability | null
  death_chapter: number | null
  description: string
}

interface IdentifiedSubplot {
  id?: string
  name: string
  function: 'create-crisis' | 'deliver-payoff' | 'establish-setting' | 'romance' | 'growth' | null
  delivers: string
  depends_on: string[]
  reorderable: boolean
  description: string
  chapters: number[]
}

// ─── Prompts ──────────────────────────────────────────────────────────────

function extractPrompt(
  chapters: { number: number; title: string; content: string }[],
): string {
  const block = chapters
    .map((c) => `【第${c.number}章】标题：${c.title}\n${clip(c.content, MAX_CHAPTER_CHARS)}`)
    .join('\n\n---\n\n')

  return `你是中文网络小说**功能分析师**。下面是若干章原文。

我们在做一件事：把这本网文"洗稿"成一本同类型新书。**洗稿的逻辑是抽掉具体载体、保留剧情功能** —— 改写时要在同一个功能槽里塞新事件，所以你这一步的核心是把每章每个事件**功能化标注**，方便下游改写器换载体。

请为每一章输出结构化分析。

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

─── 钩子的四步自检 ───

一条候选要写进 hooks_planted，**必须同时通过**以下 4 步。任何一步不过就不要写。

**1. 具体性**：问题有边界（候选答案能数出来）
  ✓ 「主角异能哪来的」→ 候选：系统/血脉/异物/机缘
  ✗ 「未来如何」「感情如何发展」「命运怎样」→ 无界开放

**2. payoff 场景能在脑里放**：你现在能用一句话写出兑现场景
  ✓ 「某章主角翻山捡到陨铁，和体内异能共鸣」
  ✗ 「将来大概会好起来」→ 写不出具体场景

**3. 作者在主动藏**：文本里能看到作者刻意留白、伏笔、暗示
  ✓ 作者写「那把刀的来历，他后来才知道」
  ✗ 作者平铺直叙，只是**读者自己脑补**"后面应该会讲"

**4. 不是文体默认走向**：在种田/甜宠/穿越/年代文框架下，本来就"默认会发生"的不算
  - 默认走向：男女主在一起、主角致富变强、黑五类平反、穿越者适应
  - 要算钩子，必须有**具体反常阻力**（具体反派、具体外部限制、具体时间窗口）

**额外硬规则**（直接删，不用跑四步）：
- 纯陈述/否定句（"主角没有金手指"）
- 立即兑现的计划/意图（下一章就做的事）
- 已完成事件（"人参卖了 5000 元"）
- 定价/数值/世界观
- 泛化情绪/状态
- 重复的老钩子（前面章节已埋过，本章无增量）
- 原文已明示答案的所谓"真实原因"

─── 数量校准 ───

- 每 10 章平均 **0-1 条**真长线钩子，典型一章**产生 0 条**
- 一章里**冒不出合格长线钩子是常态**——就输出空数组
- 如果你一章写出 2+ 条长线，基本可以判定是在凑数，请删掉

─── 正反例 ───

✓ 「主角展现异常体能与自愈，来源不明」—— 四步全过（具体/可视化/作者未解释/非默认）
✓ 「重刀是抗战老物，材质与来历未提」—— 四步全过
✓ 「陈博文盼望平反，但历史大势何时到来未知」—— goal 长线，具体变量（高考恢复）未到

✗ 「赵秀华退婚的真实原因未揭示」—— **第 3 步失败**：原文已明示她和男知青好了
✗ 「主角是否拥有金手指」—— **第 3 步失败**：作者反复否认，不是藏
✗ 「陈家未来将面临何种命运」—— **第 1、4 步失败**：无界 + 默认走向
✗ 「男女主感情将如何发展」—— **第 4 步失败**：甜文默认
✗ 「主角计划打听陈婉家情况」—— 立即兑现计划
✗ 「人参卖了 5000 元将改变家庭」—— 已完成事件

─── 功能化字段说明（核心） ───

**plot_functions**：本章在故事机器里干了什么 —— 1-3 个高度抽象的功能标签。**任何题材都通用**（都市/玄幻/重生/末世/系统/年代/科幻/言情）。改写时按这个找替代场景。
- 抽象层级要够高，**不要写成具体事件**，要让换题材也能复用。
- 通用示例（全题材适用）：
  「建立主角低谷状态」「施加外部压力」「展示主角优势机制」「制造短期目标」「兑现资源回报」「埋长线钩子」「兑现先前钩子」「打脸/反击释放爽感」「关系建立/破裂/转折」「升级/跨阶铺垫」「环境/规则交代」「群体反应放大」「过渡承接」
- 错（题材绑死或事件复述）：「在饭店和叔叔吵架」「砍了野猪」「突破练气期」「拿了 5000 块」

**key_events**：本章关键事件列表（3-7 条），每条是结构化对象 {desc, function, can_replace, can_reorder, depends_on}。
- desc：事件本身一句话（15-30 字，给人读理解用，可以含具体载体）
- function：**这件事的剧情功能**（给改写器用），**抽象到任何题材都能复用**。不要复读 desc，不要带题材专有名词。
  - 通用功能标签：「压迫源出场」「主角优势暴露」「关系破裂触发」「信息差兑现」「外部资源到手」「短期目标设立」「长线伏笔埋设」「群体反应放大爽感」「环境/规则交代」「主角主动选择」「内心动摇/坚定」「身份/秘密暴露」「决策代价显现」
  - 反面：「打野猪赚钱」「突破金丹期」「招标会反杀」 —— 题材绑死
- can_replace：改写时这件事的**具体载体能否换**（绝大多数 = true；只有锚定主线节奏的关键节点 = false）
- can_reorder：和**本章其他事件**之间能否调换顺序（无前后因果就 true）
- depends_on：依赖前文哪些事件功能（用 function 字符串引用，不是 desc）。无依赖填 []

**originality_risks**：改写时**绝对要避开**的标志性桥段 —— 0-3 条。这些是"一眼看出抄袭"的元凶。
- 抽象形态描述（**不要绑死人名/具名物名**），载体级即可：
  - 「<主角>在<某类场地>捡到<某类高阶物品>」
  - 「<某类聚会场合>被反派<某种当众羞辱方式>」
  - 「<指引者角色>留下<某类未完信息>后离场」
  - 「<规则系统>在主角危急时第一次显化奖励」
- 抽象层级：能识别"这是原作的标志性桥段"，但用占位符指代具体身份/物品
- 大多数章不需要填；本章无明显标志性桥段就输出 []

**characters_present**：本章有名有姓、有台词或行动的角色（路人不算）。

**summary**：100-200 字详细摘要，含主要事件与关键人物的具体行动（人读用，不参与功能化）。

─── 输出 JSON ───

严格 JSON 输出，不要任何额外文字：

{
  "chapters": [
    {
      "chapter_id": <章号>,
      "summary": "...",
      "characters_present": ["..."],
      "plot_functions": ["...", "..."],
      "key_events": [
        {
          "desc": "<本章具体事件一句话>",
          "function": "<通用功能标签>",
          "can_replace": true,
          "can_reorder": false,
          "depends_on": []
        }
      ],
      "originality_risks": [],
      "hooks_planted": [{"desc": "...", "category": "suspense"}],
      "hooks_paid": [{"ref_desc": "..."}]
    }
  ]
}

章节原文：

${block}
`
}

function writingRhythmPrompt(chapters: { number: number; title: string; content: string }[]): string {
  const block = chapters
    .map((c) => `【第${c.number}章】标题：${c.title}\n${clip(c.content, MAX_CHAPTER_CHARS)}`)
    .join('\n\n---\n\n')

  return `你是中文网络小说**文本结构分析师**。

下面是若干章原文。请**为每一章**只分析它在"写作节奏、叙事组织、信息释放、情绪推进、读者注意力控制"上的结构 —— **不分析剧情功能、不复述事件**。

输出会被改写器用来匹配新章正文的节奏（同样的开头快慢、同样的对话/心理/解释配比、同样的情绪曲线、同样的钩子密度）。所以你的描述要**可执行**：改写器看了能照着写。

─── 维度说明（精简版，只抽对正文生成最关键的 5 个） ───

1. **text_composition**：估算各类文本占比（百分比字符串，例如 "30%"）。conflict_ratio 与其他重叠不强求和 100。
2. **pacing_profile**：opening_speed/middle_speed/ending_speed（"快"/"中"/"慢"）；overall_rhythm 一句话描述整体节奏（"先慢后快"/"中段爆发"/"持续推进"等）。
3. **emotional_curve**：opening/middle/climax/ending_emotion 四个情绪标签（如"压抑"/"紧张"/"愤怒"/"爽感"/"期待"/"不安"）；emotion_shift_points 数组，每个 {position（"约30%"），from，to，trigger}。0-2 个转折点足够。
4. **reader_attention_design**：opening_hook（开头如何抓人，一句话）；micro_hooks（章内 2-4 条小悬念/反常）；chapter_end_hook（章末钩子内容，一句话）。
5. **chapter_writing_pattern**（最重要，正文生成直接照这个走）：
   - structure_type（"冲突开场型"/"任务推进型"/"爽点兑现型"/"信息铺垫型"/"关系变化型"/"过渡承接型"/"高潮爆发型"）
   - beat_sequence：4-7 个节拍，按章内推进顺序，每条一句话
   - core_rhythm：一句话总结（如"压迫蓄力 → 信息延迟 → 反击释放 → 新钩子"）

─── 输出 ───

严格 JSON，rhythms 数组按章节顺序：

{
  "rhythms": [
    {
      "chapter_id": <章号>,
      "writing_rhythm": {
        "text_composition": { "action_narration_ratio": "", "dialogue_ratio": "", "inner_monologue_ratio": "", "exposition_ratio": "", "description_ratio": "", "conflict_ratio": "", "summary_transition_ratio": "" },
        "pacing_profile": { "opening_speed": "", "middle_speed": "", "ending_speed": "", "overall_rhythm": "" },
        "emotional_curve": { "opening_emotion": "", "middle_emotion": "", "climax_emotion": "", "ending_emotion": "", "emotion_shift_points": [] },
        "reader_attention_design": { "opening_hook": "", "micro_hooks": [], "chapter_end_hook": "" },
        "chapter_writing_pattern": { "structure_type": "", "beat_sequence": [], "core_rhythm": "" }
      }
    }
  ]
}

章节原文：

${block}
`
}

function synthesizeStructuralHooksPrompt(input: {
  candidates: { desc: string; category: string | null; chapter: number }[]
  summaries: { chapter: number; summary: string }[]
  characters: { name: string; aliases: string[]; description: string }[]
}): string {
  return `你是中文网文结构分析师。下面是一部网文前若干章：各章的**候选钩子**、**摘要**、主要**人物清单**。

你的任务：识别**跨章结构性钩子（伞状悬念）**——即同一**实体**（某个角色 / 某个组织 / 某件道具 / 某条规则）在多章被反复暗示、留白、营造反差，但**作者始终没揭示答案**的长线大谜。

这类钩子的特征：
- **单看任何一章都不显眼**：每章只是一个小反常（欲言又止、异常行为、反差对照）
- **串起来才显形**：读者会因为跨章积累的碎线索而一直带着"这人/这东西到底是什么"往下看
- 单章 Pass 抓不到它（因为它不存在于任何单独一章中）——所以必须在这一步把它捞出来

─── 合成流程 ───

1. **按实体归类**候选钩子和摘要中的反常线索（同名角色、同一组织/药厂、同一道具）
2. **扫描 3+ 章累积**的实体：检查哪个实体在 ≥3 章都有暗示性线索但**从未被明文解释**
3. 为每个合格的实体写**一条**伞状钩子
4. 列出它的 **evidence_chapters**（所有支撑它的章号）

─── 必须满足 ───

- 至少 3 章有相关线索
- 实体明确（一个具名角色 / 一个具名组织 / 一个具体道具）
- 作者**主动留白**（反常行为、欲言又止、避谈、反差设定），不是读者凭空脑补
- 没有在这 50 章里已被明文揭示过答案

─── 什么算、什么不算（抽象说明） ───

**伞状钩子的典型形态**（任何题材都适用）：
- "<某具名配角>的真实身份 / 真实势力背景"
  → 当一个配角在多章都表现出**与其公开人设不符**的反常行为（超出能力范围的资源、刻意回避某话题、异常的反应、突然的越级接触），且作者从未解释
- "<某具名组织>的真实目的 / 内部派系斗争"
  → 同一个组织在多章以不同切面出现，每次都留有矛盾或未解，且作者借旁白或角色嘀咕暗示"还有内情"
- "<某具名道具>的来历 / 真实等级"
  → 一件关键物品在多章被提及，但作者**只写效果不讲出处**，或主角/配角对它反应超出"正常道具"
- "<某具名角色>对主角的隐藏信息差"
  → 角色 A 看着主角发愣/欲言又止/提起某事又转开——多章重复同一模式，作者从未揭开 A 到底知道什么

**不要归为伞状钩子**：
✗ "<主角>的目标/境界/成长路线" — 这是贯穿的情节驱动，不是"作者藏的真相"
✗ "<主角>能不能达成 X" — 这是情节张力，不是谜底
✗ "<单个章节>的某个具体事件" — 单章钩子应由 refine pass 处理，不走伞状
✗ 题材默认走向（爽文必变强、甜文必恋、穿越必适应）— 没有具体反常
✗ 作者已经给出答案、只是答案是否兑现需要情节推进 — 那是目标不是秘密

─── 输出要求 ───

- 典型长度：50 章可能有 1-5 条结构性钩子，甚至 0 条；宁缺毋滥
- 每条钩子必须**指名**实体（不要写"某人""某派系"这种）
- evidence_chapters 必须是支撑它的**具体**章号，不要凑数
- desc 简洁：**"<实体>的<被藏的东西>"** 风格

严格 JSON 输出（无前后缀）：

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

─── 输入 ───

人物清单（${input.characters.length} 人）：
${JSON.stringify(input.characters.map((c) => ({ name: c.name, aliases: c.aliases, desc: c.description })), null, 2)}

章节摘要（${input.summaries.length} 章）：
${JSON.stringify(input.summaries, null, 2)}

候选钩子（${input.candidates.length} 条）：
${JSON.stringify(input.candidates, null, 2)}
`
}

function refineHooksPrompt(input: {
  candidates: { desc: string; category: string | null; chapter: number }[]
  paid: { chapter: number; ref_desc: string }[]
  structural: RefinedHook[]
}): string {
  const inputCount = input.candidates.length
  const chapterSpan = input.candidates.length
    ? Math.max(...input.candidates.map((c) => c.chapter)) -
      Math.min(...input.candidates.map((c) => c.chapter)) +
      1
    : 0

  return `下面有两类钩子输入：
- **结构性钩子（structural）**：已经在上一步合成识别出来的、跨多章的伞状长线悬念。这些**必须保留**，你只要做 payoff 匹配即可。
- **候选钩子（candidates）**：每章 Pass 1 抽出来的单章级候选，大部分质量参差。你要**激进过滤**。

═══════════════════════════════════════
候选钩子的判定框架：四步自检
═══════════════════════════════════════

对每一条 **candidates**（不包括 structural），必须**全部**通过以下 4 步才能保留。任何一步失败就删除。

─── 第 1 步：具体性（Specificity） ───
悬念必须有**答案候选有边界**的具体问题。
✓ 「主角异能哪来的？」候选: 系统/血脉/异物/机缘 —— 有界
✗ 「主角未来如何？」「感情如何发展？」 —— 无界

─── 第 2 步：payoff 可视化（Payoff Visualization） ───
能不能用**一句话**写出"揭示/回收"的具体场景？
✓ 「某章主角翻山捡陨铁，异能共鸣」
✗ 「将来大概会好起来」——写不出具体场景就不是钩子

─── 第 3 步：作者主动藏（Author Suppression） ───
作者是不是**刻意留白**，留下"它在藏"的信号？
✓ 明确伏笔、反复却不解释的细节
✗ 作者平铺直叙，读者**自己脑补**"未来应该会讲"

─── 第 4 步：非文体默认（Non-Default） ───
不是类型文学的默认走向（甜文必恋、爽文必强、穿越必适应、黑五类必平反）——除非有**具体反常阻力**。

─── 第 5 步（新增）：不要与结构性钩子重复 ───
如果一条单章候选只是某个结构性钩子的**一个症状**（例：某章"赵美玲也成代言人"是「赵美玲身份」伞状钩子的一个证据章），就**丢弃**这条单章候选——它已经被伞状钩子囊括了。

═══════════════════════════════════════
任务步骤
═══════════════════════════════════════

1. **保留全部 structural**（它们已通过合成步骤的高门槛）
2. **candidates 过滤**：跑 5 步自检，失败就删；被结构性钩子囊括的也删
3. **去重**：剩下的 candidates 如果语义重复，合并为一条
4. **回收匹配**：对每条保留下来的钩子（structural + 单章幸存），检查 paid 列表或靠后章节是否回收——是则填 payoff_chapter
5. **分类校正**：9 种之一 — suspense / crisis / payoff / goal / secret / relation / rule / contrast / emotion
6. **evidence_chapters**：structural 保持其原 evidence；单章钩子填 [planted_chapter]

═══════════════════════════════════════
数量参考
═══════════════════════════════════════

输入 ${inputCount} 条候选 + ${input.structural.length} 条结构性钩子，覆盖约 ${chapterSpan} 章。
中文网文的真钩子密度大约 **每章 0.5-1.5 条**（结构性 + 单章 合计）。
本次合理输出 **${Math.max(1, Math.ceil(chapterSpan * 0.5))} 到 ${Math.max(3, chapterSpan)} 条**。
- structural 全部保留
- candidates 过滤后大概剩 50-70%
- 输出 0 条也可以，但如果 structural 非空，至少保留它们

═══════════════════════════════════════
输出
═══════════════════════════════════════

严格 JSON：

{
  "hooks": [
    {
      "desc": "...",
      "category": "suspense|crisis|payoff|goal|secret|relation|rule|contrast|emotion",
      "planted_chapter": <int>,
      "payoff_chapter": <int|null>,
      "evidence_chapters": [<int 数组>]
    }
  ]
}

结构性钩子（${input.structural.length} 条，全部保留，只做 payoff 匹配）：
${JSON.stringify(input.structural, null, 2)}

候选钩子（${inputCount} 条，按 4 步 + 第 5 步去重过滤）：
${JSON.stringify(input.candidates, null, 2)}

各章回收：
${JSON.stringify(input.paid, null, 2)}
`
}

function charactersPrompt(input: {
  characters: { name: string; chapters: number[]; summaries: { chapter: number; summary: string }[] }[]
}): string {
  return `下面是一部中文网文的候选人物名字，以及他们出现的章节摘要。请你做五件事：**合并别名** + **筛掉工具人** + **判定 role + function_tags + death_chapter** + **判定 story_function + replaceability**（改写器用）+ **写描述**。

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

7. **判定 story_function**（改写器用，从下面 10 选 1 或 null）：这个角色在故事机器里**给主角施加的作用**是什么？**任何题材都适用**：
   - pressure-source：压迫主角的来源（反派/有敌意的亲属/规则执行者/上位者）
   - benefactor：贵人（无偿提供资源/机会/信息/保护的人）
   - rival：竞争者（同一资源池里和主角抢的人，但不是反派）
   - witness：见证者（围观/震惊/改观的旁人，放大爽点）
   - resource-gateway：资源入口（持有主角需要的渠道/物资/职位/秘籍/系统的人）
   - emotional-anchor：情绪锚（家人/恋人/挚友，感情牵引）
   - antagonist-proxy：反派代理人（为反派办事的中层）
   - foil：反衬（轨迹与主角对比，照见主角变化）
   - information-source：信息源（提供关键情报/线索）
   - gatekeeper：守门人（决定主角能否进入下一阶段的关键人物）
   主角自己填 null（主角不是别人的功能）。

8. **判定 replaceability**（改写器用，"high"/"medium"/"low"）：改写时这个角色能不能换身份/背景？
   - high：纯功能角色，换完全不同的身份做同样事（题材内可任意调换载体）
   - medium：有特定关系/位置约束，身份可调但关系类型要保留
   - low：身份本身就是剧情核心（血亲、命定关系、不可替换的位面身份等），只能换名字不能换身份

9. **description** 不超过 80 字，以"他在书中做了什么 + 性格"为主，关系只在有证据时点到为止。

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
      "story_function": "pressure-source|benefactor|rival|witness|resource-gateway|emotional-anchor|antagonist-proxy|foil|information-source|gatekeeper|null",
      "replaceability": "high|medium|low",
      "death_chapter": <章号或 null>,
      "description": "..."
    }
  ]
}

输入（每个角色出现章节 + 摘要片段）：
${JSON.stringify(input, null, 2)}
`
}

function subplotsPrompt(chapters: { number: number; summary: string; events: string[] }[]): string {
  return `下面是一部中文网文的每章摘要和关键事件。请识别出 3-10 条主要支线/剧情线。一条支线是跨多章、围绕同一主题/冲突的一组相关事件。

我们在做洗稿改写。**关键在于把每条支线的"功能"和"依赖关系"标注清楚，下游改写器能在保留功能的前提下换具体载体、调发生顺序。**

要求：
1. 必须包含主线（最核心的冲突/追求）和若干条清晰的支线
2. 每条支线列出它明显推进的章节号
3. 每条支线必须判定一个 **function**（功能定位），从下面 5 选 1：
   - create-crisis：制造危机 / 主线威胁
   - deliver-payoff：兑现爽点 / 打脸 / 反杀
   - establish-setting：铺设定 / 建立世界观或主角的资源池
   - romance：感情线
   - growth：主角成长 / 升级线
4. **delivers**（一句话，**任何题材都通用**）：这条支线**给主线送了什么** —— 改写时必须保留的核心交付物。
   - 通用形态：「给主角带来第一份外部资源」「让主角和某个核心配角首次产生交集」「让主角理解世界/规则/系统的某条规律」「带出第一个直接对抗的压迫源」「为主角解锁下一阶段身份/位置」「制造第一次重大失败/受挫」
   - 反面：「给主角带来 5000 块」（题材绑死）/「让主角突破金丹」（题材绑死）
5. **depends_on**（数组）：这条支线**必须**在哪些其他支线推进到一定程度后才能发生（用支线 id 引用，例 ["sp-002"]）。无依赖填 []。
6. **reorderable**（布尔）：这条支线在改写大纲里**和其他无依赖支线的相对发生顺序能否调换**。
   - 大多数支线 = true（独立的资源获取、人脉积累、阶段性对抗都可以调换前后）
   - 关键节点支线 = false（开场介绍、最终对决、必须卡在某节奏点的支线）
7. description 不超过 100 字
8. id 必须是 'sp-NNN' 形式（sp-001, sp-002, ...）

严格 JSON 输出：

{
  "subplots": [
    {
      "id": "sp-001",
      "name": "...",
      "function": "establish-setting",
      "delivers": "给主角带来第一份外部资源",
      "depends_on": [],
      "reorderable": true,
      "description": "...",
      "chapters": [1, 3, 5]
    }
  ]
}

输入：
${JSON.stringify(chapters, null, 2)}
`
}

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

// ─── 工具 ─────────────────────────────────────────────────────────────────

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const head = Math.floor(maxChars * 0.7)
  const tail = maxChars - head - 8
  return text.slice(0, head) + '\n……\n' + text.slice(-tail)
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** 从有序数组里均匀抽最多 k 个（保留首尾）。用于给每个角色挑代表性章节。 */
function sampleEvenly<T>(arr: T[], k: number): T[] {
  if (arr.length <= k) return arr
  const out: T[] = []
  const step = (arr.length - 1) / (k - 1)
  for (let i = 0; i < k; i++) out.push(arr[Math.round(i * step)]!)
  return [...new Set(out)]
}

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

async function incAnalyzed(novelId: string, inc: number, total: number): Promise<void> {
  const cur = await readNovelIndex(novelId)
  if (!cur) return
  const next = cur.analyzed_count + inc
  await updateNovelIndex(novelId, { analyzed_count: next })
  emitAnalysisEvent(novelId, { type: 'analyze.progress', analyzed: next, total })
}

// ─── Pass 1: per-chapter batch extraction + batched writing rhythm ────────
// extract 和 rhythm 都按 batch 跑（受 concurrency 限制）。
// 章级任务等自己 batch 的 extract 和 rhythm 都到齐后立即写盘 + 增进度。
// 这样 UI 进度条在分析过程中均匀走动，而不是憋到最后一次跳到 100%。

function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
} {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

async function runPass1(
  client: DeepSeekClient,
  novelId: string,
  chapters: { number: number; title: string; rawPath: string }[],
  concurrency: number,
  total: number,
): Promise<Map<number, ChapterExtract>> {
  const results = new Map<number, ChapterExtract>()

  const withContent = await Promise.all(
    chapters.map(async (c) => ({
      ...c,
      content: await readFile(c.rawPath, 'utf8'),
    })),
  )

  // 给每章一对 deferred：extract / rhythm。各自的 batch 完成后 resolve。
  const extractDef = new Map<number, ReturnType<typeof deferred<ChapterExtract | null>>>()
  const rhythmDef = new Map<number, ReturnType<typeof deferred<WritingRhythm>>>()
  for (const c of withContent) {
    extractDef.set(c.number, deferred<ChapterExtract | null>())
    rhythmDef.set(c.number, deferred<WritingRhythm>())
  }

  const extractBatches = chunk(withContent, BATCH_SIZE)
  const rhythmBatches = chunk(withContent, RHYTHM_BATCH_SIZE)

  const extractsDone = pMap(extractBatches, concurrency, async (batch) => {
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
      extractDef.get(c.number)!.resolve(byNum.get(c.number) ?? null)
    }
  })

  const rhythmsDone = pMap(rhythmBatches, concurrency, async (batch) => {
    let parsed: { rhythms?: { chapter_id?: unknown; writing_rhythm?: unknown }[] } | null = null
    try {
      parsed = await client.chatJson<{ rhythms?: { chapter_id?: unknown; writing_rhythm?: unknown }[] }>(
        writingRhythmPrompt(batch),
        { temperature: 0.3 },
      )
    } catch (err) {
      console.warn(`[analyzer] rhythm batch failed:`, (err as Error).message)
    }
    const byNum = new Map<number, WritingRhythm>()
    if (parsed && Array.isArray(parsed.rhythms)) {
      for (const r of parsed.rhythms) {
        const cid = Number(r.chapter_id)
        if (cid) byNum.set(cid, normalizeWritingRhythm(r.writing_rhythm))
      }
    }
    for (const c of batch) {
      rhythmDef.get(c.number)!.resolve(byNum.get(c.number) ?? emptyWritingRhythm())
    }
  })

  // 章级任务：等自己的 extract + rhythm，就写盘 + 进度
  await pMap(withContent, concurrency, async (c) => {
    const [extract, rhythm] = await Promise.all([
      extractDef.get(c.number)!.promise,
      rhythmDef.get(c.number)!.promise,
    ])
    if (!extract) return
    results.set(c.number, extract)
    await writeSourceChapter(novelId, {
      number: c.number,
      title: c.title,
      characters_present: extract.characters_present,
      hooks_planted: [],
      hooks_paid: extract.hooks_paid.map((p) => p.ref_desc),
      hooks_planted_candidates: extract.hooks_planted.map((h) => ({
        desc: h.desc,
        category: h.category,
      })),
      summary: extract.summary,
      key_events: extract.key_events,
      plot_functions: extract.plot_functions,
      originality_risks: extract.originality_risks,
      writing_rhythm: rhythm,
    })
    emitAnalysisEvent(novelId, {
      type: 'analyze.chapter',
      number: c.number,
      title: c.title,
    })
    await incAnalyzed(novelId, 1, total)
  })

  await Promise.all([extractsDone, rhythmsDone])
  return results
}

function normalizeKeyEventEntry(raw: unknown): KeyEventEntry | null {
  if (!raw) return null
  if (typeof raw === 'string') {
    const desc = raw.trim()
    if (!desc) return null
    return { desc, function: '', can_replace: true, can_reorder: false, depends_on: [] }
  }
  if (typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const desc = String(r['desc'] ?? '').trim()
  if (!desc) return null
  return {
    desc,
    function: String(r['function'] ?? '').trim(),
    can_replace: r['can_replace'] === false ? false : true,
    can_reorder: r['can_reorder'] === true,
    depends_on: Array.isArray(r['depends_on'])
      ? (r['depends_on'] as unknown[]).map((d) => String(d).trim()).filter(Boolean)
      : [],
  }
}

function normalizeExtract(raw: Partial<ChapterExtract> & { chapter_id?: unknown }): ChapterExtract {
  return {
    chapter_id: Number(raw.chapter_id ?? 0),
    summary: String(raw.summary ?? '').trim(),
    characters_present: Array.isArray(raw.characters_present)
      ? raw.characters_present.map((s) => String(s).trim()).filter(Boolean)
      : [],
    plot_functions: Array.isArray(raw.plot_functions)
      ? raw.plot_functions.map((s) => String(s).trim()).filter(Boolean)
      : [],
    key_events: Array.isArray(raw.key_events)
      ? raw.key_events
          .map((e) => normalizeKeyEventEntry(e))
          .filter((e): e is KeyEventEntry => e !== null)
      : [],
    originality_risks: Array.isArray(raw.originality_risks)
      ? raw.originality_risks.map((s) => String(s).trim()).filter(Boolean)
      : [],
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
    hooks_paid: Array.isArray(raw.hooks_paid)
      ? raw.hooks_paid
          .map((h) => ({
            ref_desc: String((h as { ref_desc?: unknown })?.ref_desc ?? '').trim(),
          }))
          .filter((h) => h.ref_desc)
      : [],
  }
}

function emptyWritingRhythm(): WritingRhythm {
  return {
    text_composition: {
      action_narration_ratio: '',
      dialogue_ratio: '',
      inner_monologue_ratio: '',
      exposition_ratio: '',
      description_ratio: '',
      conflict_ratio: '',
      summary_transition_ratio: '',
    },
    pacing_profile: {
      opening_speed: '',
      middle_speed: '',
      ending_speed: '',
      overall_rhythm: '',
    },
    emotional_curve: {
      opening_emotion: '',
      middle_emotion: '',
      climax_emotion: '',
      ending_emotion: '',
      emotion_shift_points: [],
    },
    reader_attention_design: {
      opening_hook: '',
      micro_hooks: [],
      chapter_end_hook: '',
    },
    chapter_writing_pattern: {
      structure_type: '',
      beat_sequence: [],
      core_rhythm: '',
    },
  }
}

function normalizeWritingRhythm(raw: unknown): WritingRhythm {
  if (!raw || typeof raw !== 'object') return emptyWritingRhythm()
  const r = raw as Record<string, unknown>
  const empty = emptyWritingRhythm()
  const merge = <T extends object>(defaults: T, input: unknown): T => {
    if (!input || typeof input !== 'object') return defaults
    const out = { ...defaults } as Record<string, unknown>
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (v !== undefined) out[k] = v
    }
    return out as T
  }
  return {
    text_composition: merge(empty.text_composition, r['text_composition']),
    pacing_profile: merge(empty.pacing_profile, r['pacing_profile']),
    emotional_curve: {
      ...merge(empty.emotional_curve, r['emotional_curve']),
      emotion_shift_points: Array.isArray(
        (r['emotional_curve'] as Record<string, unknown> | undefined)?.['emotion_shift_points'],
      )
        ? ((r['emotional_curve'] as Record<string, unknown>)['emotion_shift_points'] as unknown[]).map(
            (p) => {
              const o = (p ?? {}) as Record<string, unknown>
              return {
                position: String(o['position'] ?? ''),
                from: String(o['from'] ?? ''),
                to: String(o['to'] ?? ''),
                trigger: String(o['trigger'] ?? ''),
              }
            },
          )
        : [],
    },
    reader_attention_design: {
      ...merge(empty.reader_attention_design, r['reader_attention_design']),
      micro_hooks: Array.isArray(
        (r['reader_attention_design'] as Record<string, unknown> | undefined)?.['micro_hooks'],
      )
        ? ((r['reader_attention_design'] as Record<string, unknown>)['micro_hooks'] as unknown[]).map(
            String,
          )
        : [],
    },
    chapter_writing_pattern: {
      ...merge(empty.chapter_writing_pattern, r['chapter_writing_pattern']),
      beat_sequence: Array.isArray(
        (r['chapter_writing_pattern'] as Record<string, unknown> | undefined)?.['beat_sequence'],
      )
        ? (
            (r['chapter_writing_pattern'] as Record<string, unknown>)['beat_sequence'] as unknown[]
          ).map(String)
        : [],
    },
  }
}

// ─── Pass 2: aggregate ────────────────────────────────────────────────────

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
        story_function: null,
        replaceability: null,
        death_chapter: null,
        description: '',
      }))
    }
    deduped = deduped.map((c) => ({
      ...c,
      story_function: STORY_FUNCTIONS.includes(c.story_function as CharacterStoryFunction)
        ? (c.story_function as CharacterStoryFunction)
        : null,
      replaceability: REPLACEABILITY.includes(c.replaceability as Replaceability)
        ? (c.replaceability as Replaceability)
        : null,
    }))
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
      story_function: c.story_function,
      replaceability: c.replaceability,
      first_chapter: sorted[0]!,
      last_chapter: sorted[sorted.length - 1]!,
      death_chapter: c.death_chapter,
      description: c.description,
    })
  }

  // ── 2b. 支线识别 ─────────────────────────────────────────────────────
  const chapterInputs = [...extracts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([num, ex]) => ({
      number: num,
      summary: ex.summary,
      events: ex.key_events.map((e) => e.desc),
    }))

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
        delivers: String(sp.delivers ?? '').trim(),
        depends_on: Array.isArray(sp.depends_on)
          ? sp.depends_on.map((d) => String(d).trim()).filter(Boolean)
          : [],
        reorderable: sp.reorderable === false ? false : true,
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

// ─── 入口 ─────────────────────────────────────────────────────────────────

export interface StartAnalysisOpts {
  /** 本次 run 的章号范围。不传则沿用 novel 表中的 analysis_from/to。 */
  from?: number
  to?: number
}

/** 启动分析。异步执行，调用方不需要 await。状态通过 event-bus + novel 表广播。 */
export function startAnalysis(novelId: string, opts?: StartAnalysisOpts): void {
  void runAnalysis(novelId, opts ?? {}).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[analyzer] fatal:', message)
  })
}

async function runAnalysis(novelId: string, opts: StartAnalysisOpts): Promise<void> {
  const client = buildAnalyzerLlmClient()

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

  const chaptersInRange: { number: number; title: string; rawPath: string }[] = []
  for (let n = from; n <= to; n++) {
    chaptersInRange.push({
      number: n,
      title: `第${n}章`,
      rawPath: paths.sourceRaw(novelId, n),
    })
  }

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

/** 清空派生文件（character/subplot/hook/meta）并基于全部 extract 重新跑 Pass 2。 */
async function wipeAndRunPass2(client: DeepSeekClient, novelId: string): Promise<void> {
  const allExtracts = await loadAllExtracts(novelId)
  await wipeSourceAggregates(novelId)
  await runPass2(client, novelId, allExtracts)
}

/**
 * 仅重跑 Pass 2（人物/支线/钩子聚合）。
 * 不消耗每章抽取的 LLM 调用 —— 用于调整 pass 2 prompt 后低成本重试。
 */
export function reaggregate(novelId: string): void {
  void (async () => {
    const novel = await readNovelIndex(novelId)
    if (!novel) return
    const client = buildAnalyzerLlmClient()
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

async function loadAllExtracts(novelId: string): Promise<Map<number, ChapterExtract>> {
  const list = await listSourceChaptersFull(novelId)
  const out = new Map<number, ChapterExtract>()
  for (const ch of list) {
    out.set(ch.number, normalizeExtract({
      chapter_id: ch.number,
      summary: ch.summary,
      characters_present: ch.characters_present,
      plot_functions: ch.plot_functions,
      key_events: ch.key_events,
      originality_risks: ch.originality_risks,
      hooks_planted: ch.hooks_planted_candidates.map((c) => ({
        desc: c.desc,
        category: c.category,
      })),
      hooks_paid: ch.hooks_paid.map((rd) => ({ ref_desc: rd })),
    } as never))
  }
  return out
}
