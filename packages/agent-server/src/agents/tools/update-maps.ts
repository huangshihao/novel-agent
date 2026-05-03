import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps } from '../../storage/target-reader.js'
import {
  writeMaps,
  type CharacterMapEntry,
  type CharacterSourceMeta,
  type MapsRecord,
  type SettingMap,
} from '../../storage/target-writer.js'
import { listSourceCharacters } from '../../storage/source-reader.js'
import { initStateIfMissing } from '../../storage/state.js'

interface ProposedEntry {
  source: string | null
  target: string
  target_note?: string
}

export function buildUpdateMapsTool(novelId: string): ToolDefinition {
  return {
    name: 'updateMaps',
    label: '更新置换表',
    description:
      '写入或更新角色置换表（原名 → 新名）和同题材表层置换。**source 必须是 source/characters/ 实际存在的 canonical_name**——工具会校验并自动从源端派生 source_meta（role / story_function / first_chapter / last_chapter / description）。如果是 target 自创角色（源端不存在），把 source 设为 null 并必填 target_note 说明用途。Upsert 语义：character_entries 按 target 主键合并；setting 给值则整体替换。',
    promptSnippet:
      'updateMaps({character_entries?, setting?}) - 写置换表（source_meta 自动派生，禁止手写身份）',
    promptGuidelines: [
      '**首次运行时**先 read target/maps.md 看当前状态（如果存在）',
      '**character_entries 必须覆盖 source/characters/ 下所有 role !== \'tool\' 的角色**——主角 / 配角 / 家人 / 反派 / 师傅都要给 target 名',
      '**source 必须是真实存在的源端 canonical_name**（read source/characters/ 确认），编错或不存在直接 reject',
      '**source_meta 由工具自动从源端派生**（role / story_function / first_chapter / last_chapter / description），不要在调用参数里手写——你写了也会被覆盖',
      '**target 自创角色**（如"主角的某邻居"原书没有但 target 需要）：source 设为 null，target_note 必填说明这个人在 target 故事里干什么',
      'character_entries 的 target 是改写后的名字：保留性别、大致年龄段、角色功能（mentor/family/antagonist），换姓和名字风格',
      'setting.original_industry 来自 source/meta.md 的 industry 字段',
      '**setting.target_industry 默认必须等于 setting.original_industry**（同题材洗稿）',
      '**风格黑名单**：异能 / 修仙 / 灵气 / 系统流 / 末日废土 / 星际科幻 等——除非源端 genre_tags 已含',
      'setting.key_term_replacements 至少 8-15 条，同年代/同行业/同写实度',
    ],
    parameters: Type.Object({
      character_entries: Type.Optional(
        Type.Array(
          Type.Object({
            source: Type.Union([Type.String(), Type.Null()]),
            target: Type.String(),
            target_note: Type.Optional(Type.String()),
          }),
        ),
      ),
      setting: Type.Optional(
        Type.Object({
          original_industry: Type.String(),
          target_industry: Type.String(),
          key_term_replacements: Type.Record(Type.String(), Type.String()),
        }),
      ),
    }),
    async execute(_id, params) {
      const { character_entries, setting } = params as {
        character_entries?: ProposedEntry[]
        setting?: SettingMap
      }

      const issues: { level: 'error'; message: string; hits?: string[] }[] = []
      const sourceChars = await listSourceCharacters(novelId)
      const sourceByName = new Map(sourceChars.map((c) => [c.canonical_name, c]))

      const validatedEntries: CharacterMapEntry[] = []
      if (character_entries?.length) {
        const phantom: string[] = []
        const missingNotes: string[] = []
        for (const e of character_entries) {
          const source = e.source && e.source.length > 0 ? e.source : null
          if (source !== null && !sourceByName.has(source)) {
            phantom.push(source)
            continue
          }
          if (source === null && (!e.target_note || e.target_note.trim().length === 0)) {
            missingNotes.push(e.target)
            continue
          }
          const sc = source ? sourceByName.get(source)! : null
          const source_meta: CharacterSourceMeta | null = sc
            ? {
                role: sc.role,
                story_function: sc.story_function,
                replaceability: sc.replaceability,
                first_chapter: sc.first_chapter ?? null,
                last_chapter: sc.last_chapter ?? null,
                description: sc.description,
              }
            : null
          validatedEntries.push({
            source,
            target: e.target,
            source_meta,
            target_note: e.target_note?.trim() || null,
          })
        }
        if (phantom.length > 0) {
          issues.push({
            level: 'error',
            message: `${phantom.length} 个 source 名在 source/characters/ 下不存在（phantom mapping），请改为真实 canonical_name 或将 source 设为 null（target 自创角色）`,
            hits: phantom,
          })
        }
        if (missingNotes.length > 0) {
          issues.push({
            level: 'error',
            message: `${missingNotes.length} 个 source=null 的 target 自创角色缺 target_note（必填，说明用途）`,
            hits: missingNotes,
          })
        }
      }

      if (issues.length > 0) {
        const r = { ok: false, issues }
        return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], details: r }
      }

      const existing: MapsRecord = (await readMaps(novelId)) ?? {
        character_map: [],
        setting_map: null,
      }
      if (validatedEntries.length > 0) {
        // upsert key：source 非 null 时按 source 去重（同一原书角色 → 唯一 target）
        // source=null 时按 target 去重（target 自创角色按改写名唯一）
        const keyOf = (e: CharacterMapEntry): string =>
          e.source !== null ? `s:${e.source}` : `t:${e.target}`
        const map = new Map(existing.character_map.map((e) => [keyOf(e), e]))
        for (const e of validatedEntries) map.set(keyOf(e), e)
        existing.character_map = [...map.values()]
      }
      if (setting !== undefined) {
        existing.setting_map = setting
      }
      await writeMaps(novelId, existing)
      await initStateIfMissing(novelId)

      const result = {
        ok: true,
        character_map_size: existing.character_map.length,
        setting_set: existing.setting_map !== null,
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        details: result,
      }
    },
  }
}
