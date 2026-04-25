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
      '**character_entries 必须覆盖 source/characters/ 下所有 role !== \'tool\' 的角色**——主角 / 配角 / 家人 / 反派 / 师傅都要给 target 名，不能漏。漏了就违反洗稿原则',
      'character_entries 的 source 必须是原书角色 canonical_name（read source/characters/ 找）',
      'character_entries 的 target 是改写后的名字：保留性别、大致年龄段、角色功能（mentor/family/antagonist），换姓和名字风格',
      'setting.original_industry 来自 source/meta.md 的 industry 字段；target_industry 由你决定（如果用户没指定）',
      'setting.key_term_replacements 是核心字段：列出原书所有高频出现的具体术语到改写后术语的对应映射，**至少 8-15 条**——包括但不限于：关键场景类型（药厂 → 灵药园）、武道/修炼术语（铜皮铁骨 → 锻体淬骨）、关键道具类型、组织名、地名、特殊物品。条目越多，正文/大纲改写时撞原文的概率越低',
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
