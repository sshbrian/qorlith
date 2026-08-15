import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ProgressPanel } from '../components/ProgressPanel'
import { TrainMetaPanel } from '../components/TrainMetaPanel'
import { FailNote } from '../components/FailNote'
import { api, type Progress, type Run, type TrainMeta } from '../lib/api'

export function RunDetail() {
  const { id } = useParams()
  const [run, setRun] = useState<Run | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [trainMeta, setTrainMeta] = useState<TrainMeta | null>(null)
  const [logText, setLogText] = useState<string>('')
  const [logPath, setLogPath] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    if (!id) return
    let alive = true
    const load = async () => {
      try {
        const data = await api.run(id)
        if (!alive) return
        setRun(data.run)
        setProgress(data.progress)
        setTrainMeta(data.trainMeta ?? null)
        setLogText(data.log?.text || '')
        setLogPath(data.log?.path || null)
        setErr(null)
      } catch (e) {
        if (alive) setErr(e)
      }
    }
    load()
    const t = setInterval(load, 2500)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [id])

  if (err) {
    return (
      <div className="space-y-4">
        <Link to="/train" className="text-xs text-cyan">
          ← Train
        </Link>
        <FailNote error={err} />
      </div>
    )
  }

  if (!run) {
    return <div className="text-ghost text-sm">Loading…</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/train" className="text-xs text-cyan tracking-wider">
          ← Train
        </Link>
        <h1 className="text-2xl font-semibold text-ink mt-2">{run.name}</h1>
        <p className="text-xs font-mono text-ghost break-all mt-1">{run.dir}</p>
      </div>

      <ProgressPanel progress={progress} active={Boolean(run.active)} />

      <TrainMetaPanel meta={trainMeta} />

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="glass rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-ghost">Latest epoch</div>
          <div className="text-2xl text-cyan tabular-nums">{run.latestEpoch ?? '—'}</div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-ghost">Loss</div>
          <div className="text-2xl text-amber tabular-nums">
            {progress?.avgLoss?.toFixed(5) ?? progress?.loss?.toFixed(5) ?? '—'}
          </div>
        </div>
        <div className="glass rounded-xl p-4">
          <div className="text-[10px] uppercase tracking-widest text-ghost">Checkpoints</div>
          <div className="text-2xl text-magenta tabular-nums">{run.checkpointCount}</div>
        </div>
      </div>

      <section className="glass rounded-xl p-4">
        <h2 className="text-xs uppercase tracking-[0.3em] text-ghost mb-3">Checkpoints</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-ghost border-b border-line">
              <tr>
                <th className="py-2 pr-3">Epoch</th>
                <th className="py-2 pr-3">File</th>
                <th className="py-2 pr-3">Size</th>
                <th className="py-2">Modified</th>
              </tr>
            </thead>
            <tbody>
              {[...(run.checkpoints || [])].reverse().map((c) => (
                <tr key={c.path} className="border-b border-line/40">
                  <td className="py-2 pr-3 text-cyan tabular-nums">{c.epoch ?? 'final'}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{c.name}</td>
                  <td className="py-2 pr-3 text-ghost">{c.sizeHuman}</td>
                  <td className="py-2 text-ghost text-xs">
                    {new Date(c.mtimeIso).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass rounded-xl p-4">
        <h2 className="text-xs uppercase tracking-[0.3em] text-ghost mb-1">Log tail</h2>
        {logPath ? (
          <p className="text-[10px] font-mono text-ghost mb-3 break-all">{logPath}</p>
        ) : (
          <div className="mb-3" />
        )}
        <div className="terminal rounded-lg p-3 text-[11px] max-h-80 overflow-auto whitespace-pre-wrap">
          {logText || 'No .log files in this run folder yet.'}
        </div>
      </section>
    </div>
  )
}
