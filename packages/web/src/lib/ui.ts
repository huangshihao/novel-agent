import clsx from 'clsx'

export const cn = clsx

export const statusLabel = {
  uploaded: '已上传',
  splitting: '切分中',
  analyzing: '分析中',
  ready: '就绪',
  failed: '失败',
} as const

export const statusStyle = {
  uploaded: 'bg-neutral-100 text-neutral-700',
  splitting: 'bg-sky-100 text-sky-800',
  analyzing: 'bg-amber-100 text-amber-800',
  ready: 'bg-emerald-100 text-emerald-800',
  failed: 'bg-rose-100 text-rose-800',
} as const
