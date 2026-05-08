import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeNovelIndex,
  type NovelIndex,
} from '../../storage/novel-index.js'
import {
  writeSourceChapter,
  writeSourceCharacter,
  writeSourceHooks,
  writeSourceMeta,
  writeSourceSubplots,
} from '../../storage/source-writer.js'
import { writeMaps } from '../../storage/target-writer.js'
import { buildGetOutlineContextTool } from './get-outline-context.js'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'goc-'))
  process.env['NOVEL_AGENT_DATA_DIR'] = tmp
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

const novelId = 'nv-1'

async function writeIndex(patch: Partial<NovelIndex> = {}) {
  await writeNovelIndex({
    id: novelId,
    title: '原书',
    status: 'ready',
    chapter_count: 10,
    analyzed_count: 10,
    analysis_from: 1,
    analysis_to: 10,
    analyzed_to: 10,
    error: null,
    created_at: 1,
    updated_at: 1,
    ...patch,
  })
}

async function exec(number: number) {
  const tool = buildGetOutlineContextTool(novelId)
  return await (tool.execute as unknown as (
    id: string,
    p: { number: number },
  ) => Promise<{ details: Record<string, unknown> }>)('call-1', { number })
}

describe('buildGetOutlineContextTool', () => {
  it('returns safe source character names for map creation without descriptions', async () => {
    await writeSourceChapter(novelId, {
      number: 1,
      title: '第一章',
      characters_present: ['张三'],
      hooks_planted: [],
      hooks_paid: [],
      hooks_planted_candidates: [],
      summary: '张三偷看到了原书具体剧情。',
      key_events: [
        {
          desc: '张三偷看到账本。',
          function: '让主角获得线索',
          can_replace: true,
          can_reorder: false,
          depends_on: [],
        },
      ],
      plot_functions: ['让主角获得线索'],
      originality_risks: ['账本'],
      writing_rhythm: null,
      dramatic_beat_blueprint: {
        beat_function: '让主角第一次获得推进主线的线索',
        state_before: '主角信息不足且处境被动',
        state_after: '主角获得可行动的线索',
        pressure_pattern: '被动受压 -> 发现突破口 -> 新目标形成',
        conflict_engine: '信息',
        reader_expectation: '期待主角利用线索翻盘',
        payoff_type: ['识破'],
        reversal_point: '主角发现别人忽略的信息',
        resource_or_status_change: '获得线索资源',
        information_gap: '主角掌握线索，压迫方尚不知道',
        emotional_curve: '压抑 -> 清醒 -> 期待',
        hook_promise: '线索会牵出更高层压力',
        intensity: 3,
      },
    })
    await writeSourceCharacter(novelId, {
      canonical_name: '张三',
      aliases: [],
      role: 'protagonist',
      function_tags: [],
      story_function: 'information-source',
      replaceability: 'medium',
      first_chapter: 1,
      last_chapter: 10,
      death_chapter: null,
      description: '张三偷看到了原书具体剧情。',
    })
    await writeSourceMeta(novelId, {
      title: '原书',
      chapter_count: 1,
      genre_tags: ['现实'],
      industry: '乡村',
      era: '现代',
      world_rules: [],
      key_terms: [],
      style_tags: [],
      style_samples: [],
      summary: '全书剧情',
    })
    await writeSourceHooks(novelId, [])
    await writeSourceSubplots(novelId, [])
    await writeMaps(novelId, {
      character_map: [
        {
          source: '张三',
          target: '林青',
          source_meta: {
            role: 'protagonist',
            story_function: 'information-source',
            replaceability: 'medium',
            first_chapter: 1,
            last_chapter: 10,
            description: '张三偷看到了原书具体剧情。',
          },
          target_note: null,
        },
      ],
      setting_map: null,
    })

    const r = await exec(1)

    expect(r.details.source_characters).toEqual([
      {
        canonical_name: '张三',
        role: 'protagonist',
        story_function: 'information-source',
        replaceability: 'medium',
        first_chapter: 1,
        last_chapter: 10,
      },
    ])
    expect(JSON.stringify(r.details)).not.toContain('偷看到了原书具体剧情')
    expect(r.details.source).toMatchObject({
      dramatic_beat_blueprint: {
        beat_function: '让主角第一次获得推进主线的线索',
        payoff_type: ['识破'],
      },
      similarity_signals: ['账本'],
    })
    expect(JSON.stringify(r.details.source)).not.toContain('forbidden_signatures')
  })

  it('returns writing rhythm signals for outline planning without source event descriptions', async () => {
    await writeSourceChapter(novelId, {
      number: 2,
      title: '第二章',
      characters_present: ['张三'],
      hooks_planted: [],
      hooks_paid: [],
      hooks_planted_candidates: [],
      summary: '张三靠陷阱拿到第一份资源。',
      key_events: [
        {
          desc: '张三用绳套困住山鸡。',
          function: '兑现第一份资源回报',
          can_replace: true,
          can_reorder: false,
          depends_on: [],
        },
      ],
      plot_functions: ['兑现第一份资源回报'],
      originality_risks: ['绳套困住山鸡'],
      writing_rhythm: {
        text_composition: {
          action_narration_ratio: '45%',
          dialogue_ratio: '15%',
          inner_monologue_ratio: '15%',
          exposition_ratio: '10%',
          description_ratio: '10%',
          conflict_ratio: '35%',
          summary_transition_ratio: '5%',
        },
        pacing_profile: {
          opening_speed: '快',
          middle_speed: '中',
          ending_speed: '快',
          overall_rhythm: '压力开场后用动作兑现小胜',
        },
        emotional_curve: {
          opening_emotion: '紧张',
          middle_emotion: '专注',
          climax_emotion: '爽感',
          ending_emotion: '期待',
          emotion_shift_points: [
            { position: '约70%', from: '紧张', to: '爽感', trigger: '资源到手' },
          ],
        },
        reader_attention_design: {
          opening_hook: '主角必须立刻解决饥饿',
          micro_hooks: ['工具粗陋', '猎物可能逃走'],
          chapter_end_hook: '家人能否熬过寒夜',
        },
        chapter_writing_pattern: {
          structure_type: '爽点兑现型',
          beat_sequence: ['压力逼近', '工具受限', '动作尝试', '意外阻碍', '小胜兑现'],
          core_rhythm: '资源弱限制强，靠具体办法赢一小步',
        },
      },
    })
    await writeSourceMeta(novelId, {
      title: '原书',
      chapter_count: 2,
      genre_tags: ['年代', '打猎'],
      industry: '山村生存',
      era: '1950年代',
      world_rules: ['写实年代背景'],
      key_terms: [],
      style_tags: ['写实'],
      style_samples: [],
      summary: '全书剧情',
    })
    await writeSourceHooks(novelId, [])
    await writeSourceSubplots(novelId, [])
    await writeMaps(novelId, { character_map: [], setting_map: null })

    const r = await exec(2)

    expect(r.details.source).toMatchObject({
      writing_rhythm: {
        reader_attention_design: {
          opening_hook: '主角必须立刻解决饥饿',
          micro_hooks: ['工具粗陋', '猎物可能逃走'],
          chapter_end_hook: '家人能否熬过寒夜',
        },
        chapter_writing_pattern: {
          structure_type: '爽点兑现型',
          beat_sequence: ['压力逼近', '工具受限', '动作尝试', '意外阻碍', '小胜兑现'],
          core_rhythm: '资源弱限制强，靠具体办法赢一小步',
        },
      },
    })
    expect(JSON.stringify(r.details)).not.toContain('张三用绳套困住山鸡')
  })

  it('fills a conservative hunting-era meta fallback when stored meta is empty', async () => {
    await writeIndex({ title: '重生1958：从窝在深山打猎开始' })
    await writeSourceChapter(novelId, {
      number: 1,
      title: '第一章',
      characters_present: [],
      hooks_planted: [],
      hooks_paid: [],
      hooks_planted_candidates: [],
      summary: '',
      key_events: [],
      plot_functions: ['建立生存压力'],
      originality_risks: [],
      writing_rhythm: null,
    })
    await writeSourceMeta(novelId, {
      title: '重生1958：从窝在深山打猎开始',
      chapter_count: 10,
      genre_tags: [],
      industry: '',
      era: '',
      world_rules: [],
      key_terms: [],
      style_tags: [],
      style_samples: [],
      summary: '',
    })
    await writeSourceHooks(novelId, [])
    await writeSourceSubplots(novelId, [])
    await writeMaps(novelId, { character_map: [], setting_map: null })

    const r = await exec(1)

    expect(r.details.meta).toMatchObject({
      industry: '1950年代深山狩猎求生',
      era: '1950年代',
      genre_tags: ['重生', '种田'],
      world_rules: ['写实年代背景，不存在超自然能力或弹窗系统'],
    })
  })
})
