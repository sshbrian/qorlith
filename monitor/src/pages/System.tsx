import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FailNote } from '../components/FailNote'
import { api, type SystemStats } from '../lib/api'

const POLL_MS = 1500
const HISTORY = 48

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.min(100, Math.max(0, n))
}

function heatColor(pct: number): string {
  const p = clampPct(pct)
  if (p < 40) return 'var(--color-cyan)'
  if (p < 70) return 'var(--color-amber)'
  return 'var(--color-magenta)'
}

function Meter({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: number
  sub?: string
  color?: string
}) {
  const pct = clampPct(value)
  const c = color || heatColor(pct)
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.2em] text-ghost">{label}</span>
        <span className="font-mono text-sm tabular-nums" style={{ color: c }}>
          {pct.toFixed(1)}%
          {sub ? <span className="text-ghost text-[10px] ml-2">{sub}</span> : null}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-void border border-line/60 overflow-hidden">
        <div
          className="h-full rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: `linear-gradient(90deg, ${c}88, ${c})`,
            boxShadow: 'none',
          }}
        />
      </div>
    </div>
  )
}

function Sparkline({
  values,
  color = 'var(--color-cyan)',
  height = 36,
}: {
  values: number[]
  color?: string
  height?: number
}) {
  const w = 160
  const h = height
  const pts = values.length
    ? values
        .map((v, i) => {
          const x = (i / Math.max(1, values.length - 1)) * w
          const y = h - (clampPct(v) / 100) * (h - 2) - 1
          return `${x},${y}`
        })
        .join(' ')
    : `0,${h} ${w},${h}`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} className="block opacity-90" preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts}
        style={{ filter: 'none' }}
      />
    </svg>
  )
}

function Panel({
  title,
  children,
  className = '',
  right,
}: {
  title: string
  children: ReactNode
  className?: string
  right?: ReactNode
}) {
  return (
    <section
      className={[
        'rounded-xl border border-white/[0.08] bg-panel p-3 sm:p-4',
        className,
      ].join(' ')}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-[10px] uppercase tracking-[0.3em] text-cyan">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

function CoreGrid({ cores }: { cores: SystemStats['cpu']['cores'] }) {
  return (
    <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5">
      {cores.map((c) => {
        const pct = clampPct(c.usage)
        const col = heatColor(pct)
        return (
          <div
            key={c.index}
            className="rounded border border-line/50 bg-void/80 px-1 py-1.5 flex flex-col items-center gap-1"
            title={`Core ${c.index} · ${pct.toFixed(0)}% · ${c.speedMhz} MHz`}
          >
            <div className="w-full h-10 flex items-end justify-center gap-px px-0.5">
              <div
                className="w-full max-w-[10px] rounded-sm transition-all duration-400"
                style={{
                  height: `${Math.max(4, pct)}%`,
                  background: col,
                }}
              />
            </div>
            <div className="text-[9px] font-mono text-ghost tabular-nums">{c.index}</div>
            <div className="text-[9px] font-mono tabular-nums" style={{ color: col }}>
              {pct.toFixed(0)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function System() {
  const [stats, setStats] = useState<SystemStats | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [paused, setPaused] = useState(false)
  const cpuHist = useRef<number[]>([])
  const memHist = useRef<number[]>([])
  const gpuHist = useRef<number[]>([])

  const tick = useCallback(async () => {
    try {
      const s = await api.systemStats()
      setStats(s)
      setErr(null)
      cpuHist.current = [...cpuHist.current, s.cpu.overall].slice(-HISTORY)
      memHist.current = [...memHist.current, s.memory.usedPercent].slice(-HISTORY)
      const g0 = s.gpus[0]?.utilGpu
      if (g0 != null) gpuHist.current = [...gpuHist.current, g0].slice(-HISTORY)
    } catch (e) {
      setErr(e)
    }
  }, [])

  useEffect(() => {
    if (paused) return
    void tick()
    const t = setInterval(() => void tick(), POLL_MS)
    return () => clearInterval(t)
  }, [tick, paused])

  const host = stats?.host
  const cpu = stats?.cpu
  const mem = stats?.memory
  const gpus = stats?.gpus || []
  const disks = stats?.disks || []
  const procs = stats?.processes || []
  const nets = stats?.network || []

  return (
    <div className="space-y-4 font-mono">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-ghost max-w-xl font-display">
            Live host telemetry. Local only · poll {POLL_MS}ms.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            className={[
              'px-3 py-1.5 rounded border text-[10px] uppercase tracking-widest',
              paused
                ? 'border-amber/50 text-amber bg-amber/10'
                : 'border-cyan/40 text-cyan bg-cyan/10',
            ].join(' ')}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => void tick()}
            className="px-3 py-1.5 rounded border border-line text-[10px] uppercase tracking-widest text-ghost hover:border-cyan/40 hover:text-cyan"
          >
            Refresh
          </button>
        </div>
      </div>

      <FailNote error={err} />

      {/* Header strip like btop */}
      <div className="rounded-xl border border-cyan/25 bg-void/70 px-3 py-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-ghost">
        <span>
          <span className="text-cyan">host</span>{' '}
          <span className="text-ink">{host?.hostname || '…'}</span>
        </span>
        <span>
          <span className="text-cyan">os</span>{' '}
          {host ? `${host.platform} ${host.release} · ${host.arch}` : '…'}
        </span>
        <span>
          <span className="text-cyan">up</span> {host?.uptimeHuman || '…'}
        </span>
        <span>
          <span className="text-cyan">node</span> {host?.node || '…'}
        </span>
        <span className="text-ghost/70 ml-auto">
          {stats?.at ? new Date(stats.at).toLocaleTimeString() : '—'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="CPU"
          right={
            <span className="text-[11px] text-ink tabular-nums">
              {cpu ? `${cpu.overall.toFixed(1)}% · ${cpu.count} thr` : '—'}
            </span>
          }
        >
          <div className="mb-2 text-[10px] text-ghost truncate">{cpu?.model || '…'}</div>
          <Meter label="Total" value={cpu?.overall ?? 0} />
          <div className="mt-3 h-9 rounded border border-line/40 bg-void/50 px-1">
            <Sparkline values={cpuHist.current} color="var(--color-cyan)" height={34} />
          </div>
          <div className="mt-3">
            <CoreGrid cores={cpu?.cores || []} />
          </div>
        </Panel>

        <Panel
          title="Memory"
          right={
            <span className="text-[11px] text-ink tabular-nums">
              {mem ? `${mem.usedHuman} / ${mem.totalHuman}` : '—'}
            </span>
          }
        >
          <Meter
            label="RAM"
            value={mem?.usedPercent ?? 0}
            sub={mem ? `${mem.freeHuman} free` : undefined}
          />
          <div className="mt-3 h-9 rounded border border-line/40 bg-void/50 px-1">
            <Sparkline values={memHist.current} color="var(--color-magenta)" height={34} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              { k: 'Used', v: mem?.usedHuman },
              { k: 'Free', v: mem?.freeHuman },
              { k: 'Total', v: mem?.totalHuman },
            ].map((x) => (
              <div key={x.k} className="rounded border border-line/40 bg-void/60 py-2 px-1">
                <div className="text-[9px] uppercase tracking-widest text-ghost">{x.k}</div>
                <div className="text-sm text-ink mt-0.5">{x.v || '—'}</div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* GPUs */}
      <div className="grid gap-4 lg:grid-cols-2">
        {gpus.length === 0 ? (
          <Panel title="GPU">
            <p className="text-sm text-ghost">No nvidia-smi data (GPU idle query failed or none).</p>
          </Panel>
        ) : (
          gpus.map((g) => (
            <Panel
              key={g.index}
              title={`GPU ${g.index}`}
              right={
                <span className="text-[11px] text-ink tabular-nums truncate max-w-[200px]">
                  {g.name}
                </span>
              }
            >
              <div className="space-y-3">
                <Meter label="Compute" value={g.utilGpu} />
                <Meter
                  label="VRAM"
                  value={g.memPercent}
                  sub={`${g.memUsedHuman} / ${g.memTotalHuman}`}
                  color="var(--color-magenta)"
                />
                <div className="h-8 rounded border border-line/40 bg-void/50 px-1">
                  <Sparkline values={gpuHist.current} color="var(--color-amber)" height={30} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded border border-line/40 bg-void/60 px-2 py-1.5">
                    <div className="text-ghost text-[9px] uppercase tracking-widest">Temp</div>
                    <div
                      className="text-ink"
                      style={{ color: g.tempC >= 75 ? 'var(--color-magenta)' : undefined }}
                    >
                      {g.tempC}°C
                    </div>
                  </div>
                  <div className="rounded border border-line/40 bg-void/60 px-2 py-1.5">
                    <div className="text-ghost text-[9px] uppercase tracking-widest">Power</div>
                    <div className="text-ink">
                      {g.powerW.toFixed(0)}
                      {g.powerLimitW ? (
                        <span className="text-ghost"> / {g.powerLimitW.toFixed(0)} W</span>
                      ) : (
                        ' W'
                      )}
                    </div>
                  </div>
                  <div className="rounded border border-line/40 bg-void/60 px-2 py-1.5">
                    <div className="text-ghost text-[9px] uppercase tracking-widest">Mem util</div>
                    <div className="text-ink">{g.utilMem}%</div>
                  </div>
                </div>
              </div>
            </Panel>
          ))
        )}
      </div>

      {/* Disks + network */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Disks">
          {disks.length === 0 ? (
            <p className="text-sm text-ghost">No volumes reported.</p>
          ) : (
            <div className="space-y-3">
              {disks.map((d) => (
                <div key={d.device + d.label}>
                  <Meter
                    label={`${d.device} ${d.label || ''}`.trim()}
                    value={d.usedPercent}
                    sub={`${d.usedHuman} / ${d.totalHuman}`}
                    color={d.usedPercent > 90 ? 'var(--color-magenta)' : undefined}
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Network">
          {nets.length === 0 ? (
            <p className="text-sm text-ghost">No external interfaces.</p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {nets.map((n) => (
                <div
                  key={`${n.name}-${n.address}`}
                  className="flex flex-wrap justify-between gap-2 rounded border border-line/40 bg-void/50 px-2 py-1.5 text-[11px]"
                >
                  <span className="text-cyan">{n.name}</span>
                  <span className="text-ink">{n.address}</span>
                  <span className="text-ghost w-full sm:w-auto">{n.family}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Processes */}
      <Panel
        title="Processes · by memory"
        right={<span className="text-[10px] text-ghost">top {procs.length}</span>}
      >
        <div className="overflow-x-auto -mx-1">
          <table className="w-full text-left text-[11px] border-collapse">
            <thead>
              <tr className="text-ghost border-b border-line/50">
                <th className="py-1.5 px-2 font-normal tracking-widest text-[9px] uppercase">#</th>
                <th className="py-1.5 px-2 font-normal tracking-widest text-[9px] uppercase">
                  Name
                </th>
                <th className="py-1.5 px-2 font-normal tracking-widest text-[9px] uppercase">
                  PID
                </th>
                <th className="py-1.5 px-2 font-normal tracking-widest text-[9px] uppercase text-right">
                  CPU*
                </th>
                <th className="py-1.5 px-2 font-normal tracking-widest text-[9px] uppercase text-right">
                  Mem
                </th>
              </tr>
            </thead>
            <tbody>
              {procs.map((p) => (
                <tr
                  key={`${p.pid}-${p.name}`}
                  className="border-b border-line/20 hover:bg-cyan/5 transition-colors"
                >
                  <td className="py-1 px-2 text-ghost tabular-nums">{p.rank}</td>
                  <td className="py-1 px-2 text-ink truncate max-w-[180px]">{p.name}</td>
                  <td className="py-1 px-2 text-ghost tabular-nums">{p.pid}</td>
                  <td className="py-1 px-2 text-right tabular-nums text-cyan">
                    {p.cpu != null ? p.cpu.toFixed(1) : '—'}
                  </td>
                  <td className="py-1 px-2 text-right tabular-nums text-amber">{p.memHuman}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[9px] text-ghost/70 mt-2 tracking-wide">
            * Windows CPU column is cumulative process time (seconds), not instantaneous %.
          </p>
        </div>
      </Panel>
    </div>
  )
}
