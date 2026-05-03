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
      '正文目标 2200-2500 字；> 2800 字直接 reject 必须重写更短版本，< 2000 字会软警告',
      '**节奏匹配**：按 source.writing_rhythm.chapter_writing_pattern.beat_sequence 走章内节拍；按 emotional_curve 走情绪曲线；按 text_composition 控制动作/对话/心理/解释配比；按 reader_attention_design 设计开头抓人和章末钩子',
      '**避雷**：source.originality_risks 列的标志性桥段载体绝不能复刻',
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

      const lengthIssues =
        content.length > 2800
          ? [{ level: 'error' as const, message: `字数 ${content.length} 超过硬上限 2800（目标 2200-2500），必须收束场景重写更短的版本` }]
          : content.length < 2000
            ? [{ level: 'warning' as const, message: `字数 ${content.length} 偏短（< 2000，目标 2200-2500）` }]
            : []
      const allIssues = [...issues, ...lengthIssues]

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
