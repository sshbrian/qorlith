import { memo, useEffect, useMemo, useState } from 'react'
import { api, type BrainReport, type BrainTiming } from '../lib/api'
import { useStudioLive } from './StudioSession'
import {
  decorateGraph,
  formatSeconds,
  GRAPH_LAYOUT,
  graphHeadline,
  graphWidth,
  liveOp,
  liveSeconds,
  liveVia,
  markForVia,
  NODE_MARK,
  nodeThumbs,
  nodeX,
  resolveOps,
  resumeTarget,
  spliceTicks,
  timeLabelWidth,
  viaInk,
  viaLabel,
  type GraphEdgeView,
  type GraphNodeView,
  type NodeMarkId,
  type OpVia,
} from '../lib/brainGraph'
import { GraphMark } from './GraphMark'

const OPEN_KEY = 'qorlith.make.graphOpen'
const { nodeW: NODE_W, nodeH: NODE_H, padY: PAD_Y } = GRAPH_LAYOUT

function nodeCenter(id: string, videoMode?: string) {
  return { x: nodeX(id, videoMode) + NODE_W / 2, y: PAD_Y + NODE_H / 2 }
}

function readOpen(running: boolean) {
  try {
    const raw = localStorage.getItem(OPEN_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
  } catch {
    /* ignore */
  }
  return running
}

function edgeColor(edge: GraphEdgeView, from?: GraphNodeView) {
  if (edge.live) return '#0a84ff'
  if (from?.state === 'fail' && edge.kind === 'stop') return '#ff453a'
  if (from?.state === 'done' && edge.kind === 'flow') return 'rgba(255,255,255,0.42)'
  if (edge.kind === 'resume') return 'rgba(64,156,255,0.45)'
  return 'rgba(255,255,255,0.14)'
}

function FlowTime({
  edge,
  row,
  running,
  x,
  y,
}: {
  edge: GraphEdgeView
  row: BrainTiming | undefined
  running: boolean
  x: number
  y: number
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!edge.live || !running) return
    const t = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(t)
  }, [edge.live, running])
  const label = formatSeconds(liveSeconds(row, now, running && edge.live))
  if (!label) return null
  return (
    <g>
      <rect
        x={x - timeLabelWidth(label) / 2}
        y={y - 28}
        width={timeLabelWidth(label)}
        height="16"
        rx="8"
        fill="#000"
      />
      <text
        x={x}
        y={y - 16.5}
        textAnchor="middle"
        fill={edge.live ? '#409cff' : 'rgba(235,235,245,0.6)'}
        fontSize="10"
        fontFamily="inherit"
      >
        {label}
      </text>
    </g>
  )
}

function MachinePercent({
  nodeId,
  step,
  running,
}: {
  nodeId: string
  step?: string
  running: boolean
}) {
  const { comfy } = useStudioLive()
  const on =
    running &&
    comfy?.active &&
    comfy.percent != null &&
    ((nodeId === 'stills' && step === 'stills') || (nodeId === 'video' && step === 'video'))
  if (!on) return null
  return (
    <div className="text-[22px] font-semibold tabular-nums tracking-tight">
      {Math.round(comfy.percent || 0)}%
    </div>
  )
}

function LiveMeter({
  nodeId,
  step,
  running,
}: {
  nodeId: string
  step?: string
  running: boolean
}) {
  const { comfy } = useStudioLive()
  const on =
    running &&
    comfy?.active &&
    ((nodeId === 'stills' && step === 'stills') || (nodeId === 'video' && step === 'video'))
  if (!on && !running) return null
  if (!on) return null
  const pct = comfy?.percent
  return (
    <span className="graph-meter">
      <span style={{ width: pct != null ? `${Math.max(8, Math.min(100, pct))}%` : '28%' }} />
    </span>
  )
}

function GraphHead({
  brain,
  open,
  onToggle,
}: {
  brain: BrainReport
  open: boolean
  onToggle: () => void
}) {
  const { comfy } = useStudioLive()
  const running = Boolean(brain.running)
  const headline = graphHeadline({ ...brain, comfy: comfy?.active ? comfy : brain.comfy })
  const headOp = liveOp(brain)
  const headVia: OpVia = headOp?.via || NODE_MARK[brain.step || '']?.via || 'router'
  const headMark = markForVia(headVia, brain.step || undefined)
  return (
    <button
      type="button"
      className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left"
      aria-expanded={open}
      onClick={onToggle}
    >
      <span className="flex items-center gap-3 min-w-0">
        <GraphMark mark={headMark} via={headVia} live={running} size={28} />
        <span className="min-w-0">
          <span className="block text-[15px] font-medium">Graph</span>
          <span className="block text-[13px] text-ghost truncate mt-0.5">{headline}</span>
        </span>
      </span>
      <span className="text-[13px] text-cyan shrink-0">{open ? 'Hide' : 'Show'}</span>
    </button>
  )
}

function Tile({
  node,
  brain,
  selected,
  onPick,
}: {
  node: GraphNodeView
  brain: BrainReport
  selected: boolean
  onPick: () => void
}) {
  const via = liveVia(node.id, brain, node.state)
  const mark = (node.state === 'active' ? markForVia(via, node.id) : NODE_MARK[node.id]?.mark) as NodeMarkId
  const thumbs = nodeThumbs(node.id, brain)
  const ticks = node.id === 'finish' ? spliceTicks(brain) : []
  const live = node.state === 'active'
  return (
    <button
      type="button"
      className={['graph-tile', `is-${node.state}`, selected ? 'is-picked' : ''].join(' ')}
      style={{ left: nodeX(node.id, brain.videoMode), top: PAD_Y, width: NODE_W, height: NODE_H }}
      title={
        node.id === 'plan'
          ? 'Open the storyboard'
          : node.id === 'stills'
            ? brain.videoMode === 't2v'
              ? 'Straight to video — no stills'
              : 'Open still workflows in Comfy'
            : node.id === 'video'
              ? brain.videoMode === 't2v'
                ? 'Open the MiniMax workflow'
                : 'Open video workflows in Comfy'
              : node.blurb
      }
      onClick={onPick}
    >
      <GraphMark mark={mark} via={via} live={live} size={26} />
      <span className="graph-tile-name">{node.label}</span>
      <span className="graph-chip" style={{ color: viaInk(via), borderColor: `${viaInk(via)}55` }}>
        {viaLabel(via)}
      </span>
      {thumbs.length ? (
        <span className="graph-thumbs">
          {thumbs.slice(0, 4).map((thumb) => (
            <span key={thumb.id} className={thumb.live ? 'is-live' : undefined}>
              <img
                src={api.mediaUrl(thumb.src)}
                alt=""
                width={24}
                height={16}
                decoding="async"
              />
              {thumb.kind === 'video' ? <span className="graph-thumb-play" /> : null}
            </span>
          ))}
          {thumbs.length > 4 ? <span className="graph-thumb-more">+{thumbs.length - 4}</span> : null}
        </span>
      ) : null}
      {ticks.length ? (
        <span className="graph-splices" aria-hidden>
          {ticks.map((tick) => (
            <i key={tick.id} className={tick.ready ? 'is-ready' : tick.live ? 'is-live' : undefined} />
          ))}
        </span>
      ) : null}
      <LiveMeter nodeId={node.id} step={brain.step} running={Boolean(brain.running) && live} />
    </button>
  )
}

function MachineStrip({
  node,
  brain,
}: {
  node: GraphNodeView
  brain: BrainReport
}) {
  const ops = resolveOps(node.id, brain, node.state)
  const via = liveVia(node.id, brain, node.state)
  const op = node.state === 'active' ? liveOp(brain) : null
  return (
    <div className="machine">
      <div className="machine-head">
        <GraphMark
          mark={markForVia(via, node.id)}
          via={via}
          live={node.state === 'active'}
          size={34}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-medium tracking-tight">{node.label}</div>
          <div className="text-[12px] text-ghost truncate mt-0.5">
            {viaLabel(via)}
            {op ? ` · ${op.label}` : ` · ${node.blurb}`}
            {brain.currentClip && node.state === 'active' ? ` · ${brain.currentClip}` : ''}
          </div>
        </div>
        <MachinePercent nodeId={node.id} step={brain.step} running={Boolean(brain.running)} />
      </div>
      <ol className="machine-ops">
        {ops.map((row) => (
          <li key={row.id} className={`machine-op is-${row.state}`}>
            <GraphMark mark={markForVia(row.via, node.id)} via={row.via} live={row.state === 'active'} size={20} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">{row.label}</div>
              <div className="font-mono text-[11px] text-ghost/80 truncate">{row.call}</div>
            </div>
            <span className="text-[11px] shrink-0" style={{ color: viaInk(row.via) }}>
              {viaLabel(row.via)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export const BrainGraph = memo(function BrainGraph({
  brain,
  onOpenNode,
}: {
  brain: BrainReport
  onOpenNode?: (id: string) => void
}) {
  const running = Boolean(brain.running)
  const [open, setOpen] = useState(() => readOpen(running))
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [open])

  const { nodes, edges } = useMemo(() => decorateGraph(brain), [brain])
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  const selected =
    nodes.find((n) => n.id === picked) ||
    nodes.find((n) => n.state === 'active') ||
    nodes.find((n) => n.id === 'finish' && n.state === 'done') ||
    [...nodes].reverse().find((n) => n.state === 'done') ||
    nodes[0]
  const mode = brain.videoMode
  const at = (id: string) => nodeCenter(id, mode)
  const width = graphWidth(mode)
  const height = PAD_Y + NODE_H + 72
  const flowEdges = edges.filter((e) => e.kind === 'flow')
  const stopEdges = edges.filter((e) => e.kind === 'stop')
  const resumeTo = resumeTarget(brain.timings)
  const stageInk = viaInk(liveVia(brain.step || '', brain, 'active'))

  return (
    <section className="card p-0 overflow-hidden graph-shell">
      <GraphHead brain={brain} open={open} onToggle={() => setOpen((v) => !v)} />

      {open ? (
        <div className="border-t border-white/[0.05] px-3 pb-4 pt-2">
          <div className="graph-scroll">
            <div className="graph-stage" style={{ width, height, ['--graph-ink' as string]: stageInk }}>
              <svg
                viewBox={`0 0 ${width} ${height}`}
                width={width}
                height={height}
                className="graph-wires"
                role="img"
                aria-label="LangGraph of this film"
              >
                <defs>
                  <filter id="graph-glow" x="-40%" y="-80%" width="180%" height="260%">
                    <feGaussianBlur stdDeviation="2.4" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {stopEdges.map((edge) => {
                  const a = at(edge.from)
                  const b = at(edge.to)
                  const mid = (a.x + b.x) / 2
                  const d = `M ${a.x} ${a.y + NODE_H / 2 - 8} C ${mid} ${height - 16}, ${mid} ${height - 16}, ${b.x} ${b.y + NODE_H / 2 - 8}`
                  return (
                    <path
                      key={edge.id}
                      d={d}
                      fill="none"
                      stroke={edgeColor(edge, byId.get(edge.from))}
                      strokeWidth="1.25"
                      strokeDasharray="4 4"
                      opacity={byId.get(edge.from)?.state === 'fail' ? 1 : 0.32}
                    />
                  )
                })}
                {resumeTo ? (
                  <path
                    d={`M ${at('start').x} ${PAD_Y + 8} C ${
                      (at('start').x + at(resumeTo).x) / 2
                    } 14, ${(at('start').x + at(resumeTo).x) / 2} 14, ${
                      at(resumeTo).x
                    } ${PAD_Y + 8}`}
                    fill="none"
                    stroke="#409cff"
                    strokeWidth="1.5"
                    strokeDasharray="5 4"
                  />
                ) : null}
                {flowEdges.map((edge) => {
                  const a = at(edge.from)
                  const b = at(edge.to)
                  const color = edgeColor(edge, byId.get(edge.from))
                  return (
                    <g key={edge.id}>
                      <line
                        x1={a.x + NODE_W / 2 - 6}
                        y1={a.y}
                        x2={b.x - NODE_W / 2 + 6}
                        y2={b.y}
                        stroke={color}
                        strokeWidth={edge.live ? 2.8 : fromDone(byId.get(edge.from)) ? 2 : 1.4}
                        className={edge.live ? 'graph-wire-live' : undefined}
                        filter={edge.live ? 'url(#graph-glow)' : undefined}
                      />
                      <FlowTime
                        edge={edge}
                        row={brain.timings?.[edge.from]}
                        running={running}
                        x={(a.x + b.x) / 2}
                        y={PAD_Y - 4}
                      />
                    </g>
                  )
                })}
              </svg>
              {nodes.map((node) => (
                <Tile
                  key={node.id}
                  node={node}
                  brain={brain}
                  selected={selected?.id === node.id}
                  onPick={() => {
                    setPicked(node.id)
                    onOpenNode?.(node.id)
                  }}
                />
              ))}
            </div>
          </div>
          {selected ? <MachineStrip node={selected} brain={brain} /> : null}
        </div>
      ) : null}
    </section>
  )
})

function fromDone(node?: GraphNodeView) {
  return node?.state === 'done'
}
