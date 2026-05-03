import { describe, expect, it } from 'vitest'
import type { MapsRecord } from '../storage/target-writer.js'
import type { StateRecord } from '../storage/state.js'
import {
  validateAlive,
  validateChapterContent,
  validateSettingTerms,
  validateSourceNameLeak,
  type ValidationContext,
} from './validator.js'

function makeCtx(overrides: Partial<{ maps: MapsRecord; state: StateRecord }> = {}): ValidationContext {
  const maps: MapsRecord = overrides.maps ?? {
    character_map: [
      { source: '张三', target: '李四', source_meta: null, target_note: null },
      { source: '王五', target: '赵六', source_meta: null, target_note: null },
    ],
    setting_map: {
      original_industry: '程序员',
      target_industry: '修仙',
      key_term_replacements: { 代码: '法术', 服务器: '法宝' },
    },
  }
  const state: StateRecord = overrides.state ?? {
    alive_status: {
      李四: { alive: true, last_seen_chapter: 1 },
      赵六: { alive: true, last_seen_chapter: 1 },
    },
    hooks: {},
    new_hooks: [],
  }
  return { maps, state }
}

describe('validateChapterContent', () => {
  it('returns [] when known characters all alive and no setting residue', () => {
    const ctx = makeCtx()
    const content = '李四说："今天天气不错。"赵六笑着点头。'
    expect(validateChapterContent(content, ctx)).toEqual([])
  })

  it('flags dead character appearing in content', () => {
    const ctx = makeCtx({
      maps: {
        character_map: [{ source: '张三', target: '李四', source_meta: null, target_note: null }],
        setting_map: null,
      },
      state: {
        alive_status: {
          李四: { alive: false, last_seen_chapter: 3, death_chapter: 3 },
        },
        hooks: {},
        new_hooks: [],
      },
    })
    const content = '李四又出现在街头。'
    const issue = validateAlive(content, ctx)
    expect(issue).not.toBeNull()
    expect(issue!.level).toBe('error')
    expect(issue!.hits).toContain('李四')
  })

  it('flags source-name leak (forgot to replace original book name)', () => {
    const ctx = makeCtx()
    const content = '张三说："你们都错了。"'
    const issue = validateSourceNameLeak(content, ctx)
    expect(issue).not.toBeNull()
    expect(issue!.level).toBe('error')
    expect(issue!.hits).toContain('张三')
  })

  it('flags setting residue as warning', () => {
    const ctx = makeCtx({
      maps: {
        character_map: [{ source: '张三', target: '李四', source_meta: null, target_note: null }],
        setting_map: {
          original_industry: '程序员',
          target_industry: '修仙',
          key_term_replacements: { 代码: '法术' },
        },
      },
    })
    const content = '李四正在写代码。'
    const issue = validateSettingTerms(content, ctx)
    expect(issue).not.toBeNull()
    expect(issue!.level).toBe('warning')
    expect(issue!.hits).toEqual(['代码'])
  })

  it('does not produce setting warning when setting_map is null', () => {
    const ctx = makeCtx({
      maps: {
        character_map: [{ source: '张三', target: '李四', source_meta: null, target_note: null }],
        setting_map: null,
      },
    })
    const content = '李四正在写代码，调试服务器。'
    expect(validateSettingTerms(content, ctx)).toBeNull()
    const all = validateChapterContent(content, ctx)
    expect(all.find((i) => i.level === 'warning')).toBeUndefined()
  })

  it('combo: known characters all alive + all setting terms replaced returns []', () => {
    const ctx = makeCtx()
    const content = '李四施展法术，赵六持着法宝守在一旁。'
    expect(validateChapterContent(content, ctx)).toEqual([])
  })

  it('does not flag when content uses only target names', () => {
    const ctx = makeCtx()
    const content = '李四低头看着脚下的石阶，赵六小声开口说话。'
    expect(validateSourceNameLeak(content, ctx)).toBeNull()
  })
})
