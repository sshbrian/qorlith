import type { Progress } from '../lib/api'

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits)
}

function ProgressBar({
  label,
  percent,
  detail,
  accent = 'cyan',
}: {
  label: string
  percent: number | null
  detail?: string
  accent?: 'cyan' | 'magenta' | 'amber'
}) {
  const p = percent == null ? 0 : Math.min(100, Math.max(0, percent))
  const known = percent != null
  const grad =
    accent === 'magenta'
      ? 'from-magenta via-cyan to-cyan'
      : accent === 'amber'
        ? 'from-amber via-cyan to-cyan'
        : 'from-cyan-dim via-cyan to-magenta'

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3 text-xs">
        <span className="uppercase tracking-[0.28em] text-ghost">{label}</span>
        <span className="tabular-nums text-ink font-medium">
          {known ? `${p.toFixed(1)}%` : '—'}
          {detail ? <span className="text-ghost font-normal"> · {detail}</span> : null}
        </span>
      </div>
      <div className="progress-track">
        <div
          className={`progress-fill bg-gradient-to-r ${grad} ${known ? '' : 'opacity-30'}`}
          style={{ width: known ? `${p}%` : '8%' }}
        />
        <div className="progress-sheen" />
      </div>
    </div>
  )
}

export function ProgressPanel({
  progress,
  active,
}: {
  progress: Progress | null
  active?: boolean
}) {
  const p = progress
  const epochDetail =
    p?.epoch != null
      ? `epoch ${p.epoch.current}/${p.epoch.total}`
      : p?.phase
        ? p.phase
        : undefined

  const stepDetail =
    p?.step != null && p?.maxSteps != null
      ? `${p.step.toLocaleString()} / ${p.maxSteps.toLocaleString()} steps`
      : p?.step != null
        ? `step ${p.step}`
        : undefined

  return (
    <section className="glass rounded-xl p-5 space-y-5 border border-cyan/20">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-xs uppercase tracking-[0.35em] text-ghost">Neural sync</h2>
          <p className="text-sm text-ink mt-1">
            {active ? (
              <span className="text-cyan">Live epoch progress</span>
            ) : (
              <span className="text-ghost">Waiting for train signal</span>
            )}
            {p?.phase ? (
              <span className="text-ghost"> · phase <span className="text-magenta">{p.phase}</span></span>
            ) : null}
          </p>
        </div>
        {active ? (
          <span className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-cyan border border-cyan/40 rounded-full px-3 py-1">
            <span className="h-2 w-2 rounded-full bg-cyan pulse-dot" />
            streaming
          </span>
        ) : null}
      </div>

      <ProgressBar
        label="Epoch progress"
        percent={p?.percent ?? null}
        detail={stepDetail || epochDetail}
        accent="cyan"
      />

      <ProgressBar
        label="Overall run"
        percent={p?.overallPercent ?? null}
        detail={epochDetail}
        accent="magenta"
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
        <Metric label="Speed" value={p?.itPerSec != null ? `${fmt(p.itPerSec, 2)} it/s` : '—'} glow />
        <Metric
          label="s / it"
          value={p?.secPerIt != null ? fmt(p.secPerIt, 2) : '—'}
        />
        <Metric
          label="Samples/s"
          value={
            p?.samplesPerSec != null
              ? fmt(p.samplesPerSec, 2)
              : p?.itPerSec != null && p?.batchSize != null
                ? fmt(p.itPerSec * p.batchSize, 2)
                : '—'
          }
        />
        <Metric label="Batch" value={p?.batchSize != null ? String(p.batchSize) : '—'} />
        <Metric
          label="ETA epoch"
          value={p?.etaHuman ?? (p?.etaSeconds != null ? `${Math.round(p.etaSeconds)}s` : '—')}
          accent="amber"
        />
        <Metric
          label="ETA total"
          value={
            p?.etaTotalHuman ??
            (p?.etaTotalSeconds != null ? `${Math.round(p.etaTotalSeconds)}s` : '—')
          }
          accent="amber"
        />
        <Metric
          label="Loss"
          value={
            p?.avgLoss != null
              ? fmt(p.avgLoss, 5)
              : p?.loss != null
                ? fmt(p.loss, 5)
                : '—'
          }
        />
        <Metric label="LR" value={p?.lr != null ? p.lr.toExponential(2) : '—'} />
        <Metric label="Elapsed" value={p?.elapsedHuman ?? '—'} />
        <Metric
          label="Epoch"
          value={p?.epoch ? `${p.epoch.current} / ${p.epoch.total}` : '—'}
          glow
        />
      </div>
    </section>
  )
}

function Metric({
  label,
  value,
  accent,
  glow,
}: {
  label: string
  value: string
  accent?: 'amber'
  glow?: boolean
}) {
  return (
    <div className="rounded-lg border border-line/60 bg-void/50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.22em] text-ghost mb-1">{label}</div>
      <div
        className={`text-sm tabular-nums font-semibold ${
          accent === 'amber' ? 'text-amber' : glow ? 'text-cyan' : 'text-ink'
        }`}
      >
        {value}
      </div>
    </div>
  )
}
