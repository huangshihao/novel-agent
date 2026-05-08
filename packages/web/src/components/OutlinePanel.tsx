import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import clsx from 'clsx'
import { useConfirm } from '../lib/use-confirm.js'

interface Props {
  novelId: string
  onSendToAgent?: (message: string) => void
}

const DEFAULT_EVALUATION_SPAN = 10
const MAX_EVALUATION_SPAN = 20

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  )
}

export function OutlinePanel({ novelId, onSendToAgent }: Props) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const { data: outlines } = useQuery({
    queryKey: ['outlines', novelId],
    queryFn: () => api.listOutlines(novelId),
    refetchInterval: 3_000,
  })

  const [selected, setSelected] = useState<number | null>(null)
  const outlineNumbers = useMemo(
    () => (outlines ?? []).map((outline) => outline.number).sort((a, b) => a - b),
    [outlines],
  )
  const outlineNumbersKey = outlineNumbers.join(',')
  const [selectedEvaluationNumbers, setSelectedEvaluationNumbers] = useState<number[]>([])
  const [sentMessageId, setSentMessageId] = useState<string | null>(null)
  const [editableReport, setEditableReport] = useState('')

  useEffect(() => {
    if (outlineNumbers.length === 0) return
    setSelectedEvaluationNumbers(outlineNumbers.slice(0, DEFAULT_EVALUATION_SPAN))
  }, [outlineNumbersKey])

  const deleteMut = useMutation({
    mutationFn: (number: number) => api.deleteOutlinesFrom(novelId, number),
    onSuccess: async (_result, number) => {
      if (selected != null && selected >= number) setSelected(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['outlines', novelId] }),
        queryClient.invalidateQueries({ queryKey: ['drafts', novelId] }),
        queryClient.invalidateQueries({ queryKey: ['state', novelId] }),
      ])
    },
  })
  const evaluateMut = useMutation({
    mutationFn: () => api.evaluateOutlines(novelId, selectedEvaluationNumbers),
    onSuccess: (data) => {
      setEditableReport(data.report)
      setSentMessageId(null)
    },
  })

  const selectedEvaluationSet = useMemo(
    () => new Set(selectedEvaluationNumbers),
    [selectedEvaluationNumbers],
  )
  const evaluationSelectionInvalid =
    selectedEvaluationNumbers.length === 0 ||
    selectedEvaluationNumbers.length > MAX_EVALUATION_SPAN

  const toggleEvaluationNumber = (number: number) => {
    setSelectedEvaluationNumbers((prev) => {
      if (prev.includes(number)) return prev.filter((item) => item !== number)
      if (prev.length >= MAX_EVALUATION_SPAN) return prev
      return [...prev, number].sort((a, b) => a - b)
    })
    setSentMessageId(null)
  }

  const onDelete = async (number: number) => {
    const ok = await confirm({
      title: '删除大纲',
      message: `删除第 ${number} 章及之后所有大纲？对应正文也会一起删除。`,
      confirmLabel: '删除',
      tone: 'danger',
    })
    if (ok) await deleteMut.mutateAsync(number)
  }

  return (
    <div className="flex h-full">
      <aside className="w-64 overflow-y-auto border-r ink-rule bg-[rgba(250,249,244,0.52)]">
        <div className="border-b border-[var(--line)] p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-[var(--ink)]">大纲评估</h3>
            <span className="text-[11px] text-neutral-500">
              {selectedEvaluationNumbers.length}/{MAX_EVALUATION_SPAN} 章
            </span>
          </div>
          <button
            type="button"
            onClick={() => evaluateMut.mutate()}
            disabled={evaluationSelectionInvalid || evaluateMut.isPending}
            className="btn-secondary mt-3 h-8 w-full text-sm disabled:opacity-50"
          >
            {evaluateMut.isPending ? '评估中...' : '按番茄标准评估'}
          </button>
          {evaluationSelectionInvalid && outlineNumbers.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-700">
              请选择 1-{MAX_EVALUATION_SPAN} 章进行评估。
            </p>
          )}
          {evaluateMut.error && (
            <p className="mt-2 text-[11px] leading-relaxed text-red-700">
              {(evaluateMut.error as Error).message}
            </p>
          )}
        </div>
        <ul>
          {!outlines?.length && (
            <li className="text-xs text-neutral-400 p-4">
              还没有大纲。在右侧启动大纲 agent 生成。
            </li>
          )}
          {outlines?.map((o) => {
            const checked = selectedEvaluationSet.has(o.number)
            const disabled = !checked && selectedEvaluationNumbers.length >= MAX_EVALUATION_SPAN
            return (
              <li
                key={o.number}
                className={clsx(
                  'group border-b border-[var(--line)]',
                  selected === o.number
                    ? 'bg-[rgba(242,223,201,0.68)] shadow-[inset_3px_0_0_var(--accent)]'
                    : 'hover:bg-[rgba(255,255,252,0.62)]',
                )}
              >
                <div className="flex items-center gap-1 pr-2">
                  <label className="grid h-9 w-9 shrink-0 place-items-center pl-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleEvaluationNumber(o.number)}
                      aria-label={`选择第 ${o.number} 章参与评估`}
                      className="h-4 w-4 accent-[var(--accent)] disabled:opacity-40"
                    />
                  </label>
                  <button
                    onClick={() => setSelected(o.number)}
                    className="min-w-0 flex-1 px-3 py-2 text-left text-sm"
                  >
                    第 {o.number} 章
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDelete(o.number)}
                    disabled={deleteMut.isPending}
                    title="删除"
                    aria-label={`删除第 ${o.number} 章及之后大纲`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-neutral-400 opacity-0 transition-[opacity,color,background-color] hover:bg-red-50 hover:text-red-700 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 group-hover:opacity-100 disabled:opacity-40"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      </aside>

      <section className="flex-1 overflow-y-auto p-5">
        {evaluateMut.data && (
          <article className="surface-tight mb-5 space-y-4 p-5 text-sm">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{formatChapterSelection(evaluateMut.data.numbers)}评估报告</h2>
                <p className="mt-1 text-xs text-neutral-500">模型：{evaluateMut.data.model}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onSendToAgent?.(
                    buildOutlineRevisionMessage(
                      evaluateMut.data.numbers,
                      editableReport,
                    ),
                  )
                  setSentMessageId(evaluateMut.data.evaluatedAt)
                }}
                disabled={!onSendToAgent || !editableReport.trim()}
                className="btn-primary h-9 px-3 text-sm disabled:opacity-50"
              >
                {sentMessageId === evaluateMut.data.evaluatedAt ? '已发送' : '发送给 agent 修改'}
              </button>
            </header>
            <label className="block">
              <span className="mb-2 block text-xs text-neutral-500">可编辑评估意见</span>
              <textarea
                value={editableReport}
                onChange={(e) => {
                  setEditableReport(e.target.value)
                  setSentMessageId(null)
                }}
                rows={16}
                className="min-h-[360px] w-full resize-y rounded-md border border-[var(--line)] bg-[rgba(255,255,252,0.72)] p-4 text-sm leading-7 text-neutral-800 outline-none focus:border-[var(--ink)]"
              />
            </label>
          </article>
        )}
        {selected == null && !evaluateMut.data && <p className="text-sm text-neutral-400">选一章查看大纲</p>}
        {selected != null && <OutlineDetail novelId={novelId} number={selected} />}
      </section>
    </div>
  )
}

function OutlineDetail({ novelId, number }: { novelId: string; number: number }) {
  const { data: o } = useQuery({
    queryKey: ['outline', novelId, number],
    queryFn: () => api.getOutline(novelId, number),
  })
  const { data: chapters } = useQuery({
    queryKey: ['chapters', novelId],
    queryFn: () => api.listChapters(novelId),
    enabled: o != null,
  })
  if (!o) return <p className="text-sm text-neutral-400">加载中...</p>

  const sourceChapter = chapters?.find((ch) => ch.number === o.source_chapter_ref)
  const sourceSummary = sourceChapter?.summary?.trim()

  return (
    <article className="surface-tight space-y-4 p-5 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">第 {o.number} 章大纲</h2>
        <span className="text-xs text-neutral-500">参考原书第 {o.source_chapter_ref} 章</span>
      </header>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">剧情功能</h3>
        {o.plot_functions.length === 0 ? (
          <p className="text-neutral-400 text-xs">—</p>
        ) : (
          <ul className="list-disc list-inside space-y-0.5 text-xs text-neutral-700">
            {o.plot_functions.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">新大纲剧情</h3>
        <p className="whitespace-pre-wrap leading-relaxed">{o.plot}</p>
        <details className="mt-3 rounded-md border border-[var(--line)] bg-[rgba(250,249,244,0.62)] p-3">
          <summary className="w-fit cursor-pointer select-none text-xs text-neutral-500 hover:text-neutral-800">
            参考原书剧情概括
          </summary>
          {sourceSummary ? (
            <p className="mt-2 whitespace-pre-wrap leading-relaxed text-neutral-700">
              {sourceSummary}
            </p>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">暂无概括</p>
          )}
        </details>
      </section>
      <section>
        <h3 className="text-xs uppercase tracking-wide text-neutral-500 mb-1">关键事件（function → 新载体）</h3>
        <ul className="space-y-1">
          {o.key_events.map((e, i) => (
            <li key={i} className="border-l-2 border-[var(--accent-soft)] pl-2">
              <div className="text-xs text-neutral-500">{e.function || '—'}</div>
              <div>{e.new_carrier}</div>
            </li>
          ))}
        </ul>
      </section>
      <section className="grid grid-cols-2 gap-4 text-xs">
        <div>
          <h4 className="text-neutral-500 mb-1">本章新埋伏笔</h4>
          {o.hooks_to_plant.length === 0 ? <p className="text-neutral-400">—</p> : (
            <ul>{o.hooks_to_plant.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-500 mb-1">本章兑现伏笔</h4>
          {o.hooks_to_payoff.length === 0 ? <p className="text-neutral-400">—</p> : (
            <ul>{o.hooks_to_payoff.map((id) => <li key={id} className="font-mono">{id}</li>)}</ul>
          )}
        </div>
      </section>
      {o.planned_state_changes.character_deaths.length > 0 && (
        <section className="text-xs">
          <h4 className="text-neutral-500 mb-1">本章死亡声明</h4>
          <ul>{o.planned_state_changes.character_deaths.map((n) => <li key={n}>{n}</li>)}</ul>
        </section>
      )}
    </article>
  )
}

function buildOutlineRevisionMessage(numbers: number[], report: string): string {
  const chapterLabel = formatChapterSelection(numbers)
  return `请根据下面这份我已经 review 和修改过的评估意见，修改${chapterLabel}已生成的大纲。

要求：
1. 只修改${chapterLabel}大纲，不改无关章节。
2. 保留已有角色/设定映射，除非评估意见明确指出必须补充 maps。
3. 每章修改前先调用 getOutlineContext({number}) 查看现有大纲和上下文，再用 writeChapterOutline 覆盖对应章节。
4. 优先落实评估意见里的具体修改建议，同时保持 plot_functions 不丢失。

评估意见：
${report.trim()}`
}

function formatChapterSelection(numbers: number[]): string {
  return `第 ${numbers.join('、')} 章`
}
