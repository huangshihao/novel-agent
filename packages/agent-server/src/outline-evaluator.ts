import type {
  OutlineEvaluationResponse,
  OutlineRecord,
} from '@novel-agent/shared'
import type { ChatJsonClient } from './deepseek-client.js'
import { buildOutlineEvaluatorLlmClient } from './lib/llm-client.js'

export const DEFAULT_OUTLINE_EVALUATION_SPAN = 10
export const MAX_OUTLINE_EVALUATION_CHAPTERS = 20

export interface OutlineEvaluationPromptInput {
  novelTitle: string
  from: number
  to: number
  outlines: OutlineRecord[]
}

export function chooseDefaultOutlineEvaluationRange(
  outlines: OutlineRecord[],
): { from: number; to: number } | null {
  if (outlines.length === 0) return null
  const sorted = [...outlines].sort((a, b) => a.number - b.number)
  const from = sorted[0]!.number
  const last = sorted[sorted.length - 1]!.number
  return { from, to: Math.min(from + DEFAULT_OUTLINE_EVALUATION_SPAN - 1, last) }
}

export function validateOutlineEvaluationRange(
  from: number,
  to: number,
  outlines: OutlineRecord[],
): { ok: true; selected: OutlineRecord[] } | { ok: false; message: string } {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
    return { ok: false, message: '评估章节范围无效' }
  }
  if (to - from + 1 > MAX_OUTLINE_EVALUATION_CHAPTERS) {
    return { ok: false, message: `单次最多评估 ${MAX_OUTLINE_EVALUATION_CHAPTERS} 章` }
  }
  const byNumber = new Map(outlines.map((outline) => [outline.number, outline]))
  const selected: OutlineRecord[] = []
  const missing: number[] = []
  for (let number = from; number <= to; number++) {
    const outline = byNumber.get(number)
    if (outline) selected.push(outline)
    else missing.push(number)
  }
  if (missing.length > 0) {
    return { ok: false, message: `缺少第 ${missing.join(', ')} 章大纲` }
  }
  return { ok: true, selected }
}

export function buildOutlineEvaluationPrompt(input: OutlineEvaluationPromptInput): string {
  const outlineText = input.outlines
    .map((outline) => formatOutlineForPrompt(outline))
    .join('\n\n')

  return `你是番茄小说资深网文编辑，按番茄小说商业连载标准评估用户生成的新书大纲。

评估对象：《${input.novelTitle}》第 ${input.from}-${input.to} 章大纲。

评估标准：
1. 黄金三章：主角出场速度、强处境、首个小爽点、主线锁定和长线追读理由。
2. 留存节奏：开头承接、章内目标、新阻碍、中段转折、小兑现、章末具体钩子。
3. 爽点密度：每章是否有可视化 payoff，是否 3-5 章形成一次中型情绪兑现。
4. 主线与升级：阶段目标是否明确，资源、身份、关系、能力或认知升级是否有成本。
5. 人物驱动力：主角欲望是否具体，反派/阻力是否持续施压，配角是否有故事功能。
6. 矛盾设计：冲突是否外化、连续、能推动下一章，避免只靠误会、巧合和作者解释。
7. 番茄读感：开篇快、句意直接、情绪明确、期待清楚，适合移动端连载追读。
8. 原创改写：不只做名词替换，避免事件链、人物关系、解决方式和章末钩子成套复刻。

输出要求：
- 用中文输出 Markdown。
- 先给 0-100 总分和一句话结论。
- 再按“关键问题”“逐章修改意见”“优先级最高的 5 条改法”组织。
- 修改意见必须具体到章节和动作，避免空泛词。
- 最后输出一段“可直接发给写作 agent 的修改指令”，用引用块包裹，要求 agent 只修改第 ${input.from}-${input.to} 章大纲，不改无关章节，并保留已成立的角色/设定映射。

待评估大纲：
${outlineText}`
}

export async function evaluateOutlinesWithClient(
  input: OutlineEvaluationPromptInput,
  client: ChatJsonClient,
  model: string,
): Promise<OutlineEvaluationResponse> {
  const report = await client.chat(buildOutlineEvaluationPrompt(input), { temperature: 0.2 })
  return {
    from: input.from,
    to: input.to,
    model,
    report: report.trim(),
    suggestionMessage: buildSuggestionMessage(input.from, input.to, report),
    evaluatedAt: new Date().toISOString(),
  }
}

export async function evaluateOutlines(
  input: OutlineEvaluationPromptInput,
): Promise<OutlineEvaluationResponse> {
  const { client, model } = buildOutlineEvaluatorLlmClient()
  return evaluateOutlinesWithClient(input, client, model)
}

function buildSuggestionMessage(from: number, to: number, report: string): string {
  return `请根据下面这份番茄小说网文标准评估报告，修改第 ${from}-${to} 章已生成的大纲。

要求：
1. 只修改第 ${from}-${to} 章大纲，不改无关章节。
2. 保留已有角色/设定映射，除非报告明确指出必须补充 maps。
3. 每章修改前先调用 getOutlineContext({number}) 查看现有大纲和上下文，再用 writeChapterOutline 覆盖对应章节。
4. 优先解决报告中“优先级最高的 5 条改法”，同时保持 plot_functions 不丢失。

评估报告：
${report.trim()}`
}

function formatOutlineForPrompt(outline: OutlineRecord): string {
  return `─── 第 ${outline.number} 章 ───
参考原书第 ${outline.source_chapter_ref} 章
剧情功能：${outline.plot_functions.join('；') || '无'}
新大纲剧情：
${outline.plot}
关键事件：
${outline.key_events
  .map((event, index) => `${index + 1}. ${event.function} => ${event.new_carrier}`)
  .join('\n') || '无'}
留存计划：
${formatJson(outline.retention_plan)}
读者体验计划：
${formatJson(outline.reader_experience_plan)}
新埋伏笔：${outline.hooks_to_plant.join('；') || '无'}
兑现伏笔：${outline.hooks_to_payoff.join('；') || '无'}`
}

function formatJson(value: unknown): string {
  if (!value) return '无'
  return JSON.stringify(value, null, 2)
}
