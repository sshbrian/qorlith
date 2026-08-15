import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { ProgressPanel } from '../components/ProgressPanel'
import { StatCard } from '../components/StatCard'
import { TrainMetaPanel } from '../components/TrainMetaPanel'
import { api, type Run, type Status } from '../lib/api'

export function Training() {
  const [status, setStatus] = useState<Status | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const [s, r] = await Promise.all([api.status(), api.runs()])
        if (!alive) return
        setStatus(s)
        setRuns(r.runs)
        setErr(null)
      } catch (e) {
        if (alive) setErr(e)
      }
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const active = status?.trainingActive
  const p = status?.progress

  return (
    <div className="page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="page-lead">Live training progress and past runs. Local only.</p>
        <div
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-[13px] ${
            active ? 'bg-cyan/15 text-cyan' : 'bg-panel text-ghost'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${active ? 'bg-cyan pulse-dot' : 'bg-ghost/40'}`} />
          {active ? 'Training active' : 'Idle'}
        </div>
      </div>

      <FailNote error={err} />

      <ProgressPanel progress={p ?? null} active={Boolean(active)} />
      <TrainMetaPanel meta={status?.trainMeta} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Epoch"
          value={
            p?.epoch
              ? `${p.epoch.current} / ${p.epoch.total}`
              : status?.latestRun?.latestEpoch != null
                ? `≤ ${status.latestRun.latestEpoch}`
                : '—'
          }
          hint="From log or latest ckpt"
        />
        <StatCard
          label="Step"
          value={
            p?.step != null && p?.maxSteps != null
              ? `${p.step} / ${p.maxSteps}`
              : p?.step != null
                ? String(p.step)
                : '—'
          }
          accent="magenta"
        />
        <StatCard
          label="Speed"
          value={p?.itPerSec != null ? `${p.itPerSec.toFixed(2)} it/s` : '—'}
          hint={p?.secPerIt != null ? `${p.secPerIt.toFixed(2)} s/it` : undefined}
          accent="amber"
        />
        <StatCard
          label="Runs tracked"
          value={status ? String(status.runCount) : '—'}
          hint={status?.latestRun ? status.latestRun.name : 'no checkpoints yet'}
        />
      </div>
      <div className="grid lg:grid-cols-5 gap-4">
        <section className="lg:col-span-3 card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs uppercase tracking-[0.3em] text-ghost">Latest run</h2>
            {status?.latestRun ? (
              <Link
                to={`/train/runs/${status.latestRun.id}`}
                className="text-xs text-cyan hover:underline tracking-wider"
              >
                Open detail →
              </Link>
            ) : null}
          </div>
          {status?.latestRun ? (
            <div className="space-y-2 text-sm">
              <div className="text-lg text-ink font-medium">{status.latestRun.name}</div>
              <div className="text-ghost font-mono text-xs break-all">{status.latestRun.dir}</div>
            </div>
          ) : (
            <p className="text-sm text-ghost">No run folder activity yet.</p>
          )}
        </section>
        <section className="lg:col-span-2 card">
          <h2 className="text-xs uppercase tracking-[0.3em] text-ghost mb-2">Log tail</h2>
          {status?.latestLog ? (
            <p className="text-[10px] font-mono text-ghost mb-2 break-all">{status.latestLog.name}</p>
          ) : null}
          <div className="terminal rounded-lg p-3 text-[11px] max-h-48 overflow-auto whitespace-pre-wrap">
            {(p?.recentLines || []).slice(-12).join('\n') || '—'}
          </div>
        </section>
      </div>

      <div className="space-y-3">
        <h2 className="text-xs uppercase tracking-[0.3em] text-ghost">History</h2>
        {runs.length === 0 ? (
          <div className="glass rounded-xl p-6 text-sm text-ghost">No runs discovered yet.</div>
        ) : (
          runs.map((run) => (
            <Link
              key={run.id}
              to={`/train/runs/${run.id}`}
              className="glass rounded-xl p-4 block hover:border-cyan/40 transition border border-transparent"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{run.name}</span>
                    {run.active ? (
                      <span className="text-[10px] uppercase tracking-widest text-cyan border border-cyan/40 px-2 py-0.5 rounded-full">
                        live
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-ghost font-mono mt-1 break-all">{run.dir}</div>
                </div>
                <div className="text-right text-xs text-ghost shrink-0">
                  <div className="text-cyan tabular-nums">{run.checkpointCount} ckpts</div>
                  <div>epoch {run.latestEpoch ?? '—'}</div>
                  <div>{run.totalSizeHuman}</div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
