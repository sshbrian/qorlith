import { useRef } from 'react'
import type { ComfyProgressView } from '../lib/api'

function widthFor(percent: number | null, active: boolean) {
  if (percent != null) return `${Math.max(2, Math.min(100, percent))}%`
  return active ? '28%' : '0%'
}

function useHeld(progress: ComfyProgressView | null | undefined, hold: boolean) {
  const last = useRef<ComfyProgressView | null>(progress ?? null)
  if (progress?.active) last.current = progress
  if (progress?.active) return progress
  if (hold) return last.current || progress || null
  return progress ?? null
}

export function ComfyProgress({
  progress,
  compact = false,
  hold = false,
}: {
  progress: ComfyProgressView | null | undefined
  compact?: boolean
  /** Keep the slot painted for the whole Brain run, not one Comfy prompt. */
  hold?: boolean
}) {
  const held = useHeld(progress, hold)
  const show = Boolean(hold || held?.active)
  const active = Boolean(held?.active)
  const known = held?.percent != null
  const title = held?.title || 'Waiting for the GPU'
  const line = held?.line || 'The next step starts in a moment.'
  const hint = held?.hint && held.hint !== line ? held.hint : ''
  const percent = held?.percent ?? null
  if (!show && !hold) {
    if (compact) return <div className="hidden md:flex min-w-[9rem] max-w-[14rem] mr-1" aria-hidden />
    return null
  }
  if (compact) {
    return (
      <div
        className="hidden md:flex items-center gap-2 min-w-[9rem] max-w-[14rem] mr-1"
        title={hint || line}
        style={{ visibility: show ? 'visible' : 'hidden' }}
      >
        <div className="progress-track flex-1">
          <div className="progress-fill" style={{ width: widthFor(percent, active || hold) }} />
          <div className="progress-pulse" />
        </div>
        <span className="text-[12px] tabular-nums text-ghost shrink-0">
          {known && (percent || 0) >= 1 ? `${Math.round(percent || 0)}%` : '…'}
        </span>
      </div>
    )
  }

  return (
    <section className="card" aria-label={title} style={{ visibility: show ? 'visible' : 'hidden' }}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[20px] font-semibold tracking-tight">{title}</h3>
          <p className="text-[15px] text-ghost mt-1 min-h-[1.35em]">{line}</p>
        </div>
        <div className="text-[22px] tabular-nums font-semibold tracking-tight">
          {known ? `${Math.round(percent || 0)}%` : '—'}
        </div>
      </div>
      <div className="progress-track h-1 mt-4">
        <div className="progress-fill" style={{ width: widthFor(percent, active || hold) }} />
        <div className="progress-pulse" />
      </div>
      <p className="text-[13px] text-ghost mt-3 leading-relaxed min-h-[1.25em]">{hint || '\u00a0'}</p>
    </section>
  )
}
