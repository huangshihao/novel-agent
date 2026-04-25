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
      '正文目标 3000-5000 字（番茄爽文一章合理体量）；< 1000 或 > 8000 会软警告',
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

      const lengthWarn =
        content.length < 1000 || content.length > 8000
          ? [{ level: 'warning' as const, message: `字数偏离合理范围（${content.length}）` }]
          : []
      const allIssues = [...issues, ...lengthWarn]

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
