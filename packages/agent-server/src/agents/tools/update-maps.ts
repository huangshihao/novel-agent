import { Type } from '@sinclair/typebox'
import type { ToolDefinition } from '@mariozechner/pi-coding-agent'
import { readMaps } from '../../storage/target-reader.js'
import {
  writeMaps,
  type MapsRecord,
  type CharacterMapEntry,
  type SettingMap,
} from '../../storage/target-writer.js'
import { initStateIfMissing } from '../../storage/state.js'

export function buildUpdateMapsTool(novelId: string): ToolDefinition {
  return {
    name: 'updateMaps',
    label: '更新置换表',
    description:
      '写入或更新角色置换表（原名 → 新名）和题材置换（原行业 → 新行业 + 关键词替换映射）。Upsert 语义：character_entries 按 source 主键合并；setting 给值则整体替换，给 null 则保留现状。',
    promptSnippet:
      'updateMaps({character_entries?, setting?}) - 写置换表（角色映射 + 题材替换）',
    promptGuidelines: [
      '**首次运行时**先 read target/maps.md 看当前状态（如果存在）',
      'character_entries 的 source 必须是原书角色 canonical_name（read source/characters/ 找）',
      'character_entries 的 target 是改写后的名字，由你根据 source role / 行业风格生成；用户后续可改',
      'setting 的 original_industry 来自 source/meta.md 的 industry 字段；target_industry 由你决定（如果用户没指定）',
      'setting.key_term_replacements 列出原行业关键名词到新行业的对应映射，5-15 条',
    ],
    parameters: Type.Object({
      character_entries: Type.Optional(
        Type.Array(
          Type.Object({
            source: Type.String(),
            target: Type.String(),
            note: Type.Optional(Type.String()),
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
        character_entries?: CharacterMapEntry[]
        setting?: SettingMap
      }
      const existing: MapsRecord = (await readMaps(novelId)) ?? {
        character_map: [],
        setting_map: null,
      }
      if (character_entries?.length) {
        const map = new Map(existing.character_map.map((e) => [e.source, e]))
        for (const e of character_entries) map.set(e.source, e)
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
