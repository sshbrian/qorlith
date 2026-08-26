import type { BrainReport, BrainStep, ComfyProgressView } from './api'

export const GRAPH_NODE_META = [
  { id: 'start', label: 'Start', blurb: 'This run' },
  { id: 'health', label: 'Ready', blurb: 'Check Monitor and Comfy' },
  { id: 'plan', label: 'Story', blurb: 'Write the clip list' },
  { id: 'stills', label: 'Pictures', blurb: 'Paint each still' },
  { id: 'face_qa', label: 'Your picks', blurb: 'You choose the frames' },
  { id: 'video', label: 'Motion', blurb: 'Make each clip' },
  { id: 'free', label: 'Clear', blurb: 'Unload Comfy models' },
  { id: 'finish', label: 'Film', blurb: 'Join the clips' },
  { id: 'end', label: 'End', blurb: 'Stop or done' },
] as const

export type OpVia = 'router' | 'http' | 'llm' | 'comfy' | 'disk' | 'ffmpeg' | 'human'

export type NodeOp = {
  id: string
  label: string
  via: OpVia
  call: string
}

export const NODE_OPS: Record<string, NodeOp[]> = {
  start: [{ id: 'route', label: 'Choose the start node', via: 'router', call: 'route_start()' }],
  health: [
    { id: 'monitor_get', label: 'Ping Monitor', via: 'http', call: 'GET /api/studio/health' },
    { id: 'comfy_stats', label: 'Ping Comfy', via: 'comfy', call: 'GET /system_stats' },
  ],
  plan: [
    { id: 'plan_get', label: 'Load the saved plan', via: 'http', call: 'GET /api/studio/plans/:id' },
    { id: 'plan_reuse', label: 'Reuse existing clips', via: 'disk', call: 'plan.json clips[]' },
    { id: 'plan_llm', label: 'Local LLM writes the story', via: 'llm', call: 'POST /api/studio/plan → LM Studio' },
    { id: 'plan_save', label: 'Save plan and board', via: 'disk', call: 'plan.json + board/' },
  ],
  stills: [
    { id: 'comfy_idle', label: 'Wait until Comfy is idle', via: 'comfy', call: 'GET /queue' },
    { id: 'still_queue', label: 'Queue a still job', via: 'http', call: 'POST /api/director/queue' },
    { id: 'still_wait', label: 'Comfy paints the still', via: 'comfy', call: 'WS /ws + /history' },
    { id: 'still_copy', label: 'Copy still onto the board', via: 'disk', call: 'board/<clip>/' },
  ],
  face_qa: [
    { id: 'board_get', label: 'Read board picks', via: 'http', call: 'GET /api/episode-plans/:id' },
    { id: 'wait_picks', label: 'Wait for your picks', via: 'human', call: 'Board → Continue' },
  ],
  video: [
    { id: 'comfy_idle', label: 'Wait until Comfy is idle', via: 'comfy', call: 'GET /queue' },
    { id: 'video_queue', label: 'Queue MiniMax video', via: 'http', call: 'POST /api/director/video/run' },
    { id: 'video_wait', label: 'Comfy animates the clip', via: 'comfy', call: 'WS /ws + find .mp4' },
  ],
  free: [{ id: 'comfy_free', label: 'Unload Comfy models', via: 'comfy', call: 'POST /free' }],
  finish: [
    { id: 'ffmpeg', label: 'Join clip videos', via: 'ffmpeg', call: 'ffmpeg -f concat -c copy' },
    { id: 'master', label: 'Write master.mp4', via: 'disk', call: 'projects/<id>/master.mp4' },
  ],
  end: [{ id: 'halt', label: 'Graph halted', via: 'router', call: 'END' }],
}

export const GRAPH_EDGES = [
  { from: 'start', to: 'health', kind: 'flow' },
  { from: 'health', to: 'plan', kind: 'flow' },
  { from: 'plan', to: 'stills', kind: 'flow' },
  { from: 'plan', to: 'video', kind: 'flow' },
  { from: 'stills', to: 'face_qa', kind: 'flow' },
  { from: 'face_qa', to: 'video', kind: 'flow' },
  { from: 'video', to: 'free', kind: 'flow' },
  { from: 'free', to: 'finish', kind: 'flow' },
  { from: 'finish', to: 'end', kind: 'flow' },
  { from: 'health', to: 'end', kind: 'stop' },
  { from: 'plan', to: 'end', kind: 'stop' },
  { from: 'stills', to: 'end', kind: 'stop' },
  { from: 'face_qa', to: 'end', kind: 'stop' },
  { from: 'video', to: 'end', kind: 'stop' },
  { from: 'free', to: 'end', kind: 'stop' },
  { from: 'start', to: 'plan', kind: 'resume' },
  { from: 'start', to: 'stills', kind: 'resume' },
  { from: 'start', to: 'face_qa', kind: 'resume' },
  { from: 'start', to: 'video', kind: 'resume' },
  { from: 'start', to: 'free', kind: 'resume' },
  { from: 'start', to: 'finish', kind: 'resume' },
] as const

export type GraphKind = 'flow' | 'stop' | 'resume'

export type GraphNodeView = {
  id: string
  label: string
  blurb: string
  state: string
}

export type GraphEdgeView = {
  id: string
  from: string
  to: string
  kind: GraphKind | string
  seconds: number | null
  live: boolean
}

export type StepTiming = {
  startedAt?: string | null
  endedAt?: string | null
  seconds?: number | null
}

export const PIPELINE = ['health', 'plan', 'stills', 'face_qa', 'video', 'free', 'finish'] as const

export const GRAPH_LAYOUT = {
  order: ['start', 'health', 'plan', 'stills', 'face_qa', 'video', 'free', 'finish', 'end'] as const,
  nodeW: 88,
  nodeH: 122,
  gap: 8,
  padX: 10,
  padY: 40,
}

const T2V_SKIP = new Set(['stills', 'face_qa'])

export function graphOrder(videoMode?: string | null): readonly string[] {
  if (videoMode === 't2v') return GRAPH_LAYOUT.order.filter((id) => !T2V_SKIP.has(id))
  return GRAPH_LAYOUT.order
}

export type NodeMarkId = 'q' | 'pulse' | 'cursor' | 'frame' | 'print' | 'sprocket' | 'splice' | 'flag' | 'disk'

export const NODE_MARK: Record<string, { mark: NodeMarkId; via: OpVia }> = {
  start: { mark: 'q', via: 'router' },
  health: { mark: 'pulse', via: 'http' },
  plan: { mark: 'cursor', via: 'llm' },
  stills: { mark: 'frame', via: 'comfy' },
  face_qa: { mark: 'print', via: 'human' },
  video: { mark: 'sprocket', via: 'comfy' },
  free: { mark: 'pulse', via: 'comfy' },
  finish: { mark: 'splice', via: 'ffmpeg' },
  end: { mark: 'flag', via: 'router' },
}

export function markForVia(via: OpVia, nodeId?: string): NodeMarkId {
  if (via === 'llm') return 'cursor'
  if (via === 'comfy') return nodeId === 'video' ? 'sprocket' : 'frame'
  if (via === 'human') return 'print'
  if (via === 'ffmpeg') return 'splice'
  if (via === 'disk') return 'disk'
  if (via === 'http') return 'pulse'
  return nodeId && NODE_MARK[nodeId] ? NODE_MARK[nodeId].mark : 'q'
}

export function viaInk(via: OpVia): string {
  if (via === 'comfy') return '#0a84ff'
  if (via === 'llm') return '#bf5af2'
  if (via === 'human') return '#ff9f0a'
  if (via === 'ffmpeg') return '#30d158'
  if (via === 'disk') return '#64d2ff'
  if (via === 'http') return '#409cff'
  return 'rgba(235, 235, 245, 0.72)'
}

export function liveOp(
  report: Pick<BrainReport, 'phase' | 'step' | 'running'>,
): NodeOp | null {
  const ops = NODE_OPS[report.step || ''] || []
  return ops.find((o) => o.id === report.phase) || (report.running ? ops[0] || null : null)
}

export function liveVia(
  nodeId: string,
  report: Pick<BrainReport, 'step' | 'status' | 'phase' | 'running' | 'reviewOk' | 'clips'>,
  nodeState: string,
): OpVia {
  const ops = resolveOps(nodeId, report, nodeState)
  const hit = ops.find((o) => o.state === 'active') || ops.find((o) => o.state === 'fail')
  if (hit) return hit.via
  return NODE_MARK[nodeId]?.via || 'router'
}

export type GraphThumb = {
  id: string
  src: string
  kind: 'still' | 'video'
  live: boolean
}

export function nodeThumbs(
  nodeId: string,
  report: Pick<BrainReport, 'clips' | 'currentClip' | 'step'>,
): GraphThumb[] {
  if (nodeId !== 'stills' && nodeId !== 'video') return []
  const out: GraphThumb[] = []
  for (const clip of report.clips || []) {
    const src =
      nodeId === 'video' ? clip.video || clip.pick || clip.still : clip.pick || clip.still
    if (!src) continue
    out.push({
      id: clip.id,
      src,
      kind: nodeId === 'video' && clip.video ? 'video' : 'still',
      live: report.currentClip === clip.id && report.step === nodeId,
    })
  }
  return out
}

export type SpliceTick = { id: string; ready: boolean; live: boolean }

export function spliceTicks(
  report: Pick<BrainReport, 'clips' | 'currentClip' | 'step' | 'status'>,
): SpliceTick[] {
  return (report.clips || []).map((clip) => ({
    id: clip.id,
    ready: Boolean(clip.video),
    live: report.currentClip === clip.id && (report.step === 'video' || report.step === 'finish'),
  }))
}

export function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return ''
  const n = Math.max(0, value)
  if (n < 10) return `${n.toFixed(1)}s`
  return `${Math.round(n)}s`
}

export function liveSeconds(
  row: StepTiming | undefined,
  nowMs: number,
  running = false,
): number | null {
  if (!row) return null
  if (row.endedAt) {
    if (row.seconds != null && Number.isFinite(Number(row.seconds))) return Number(row.seconds)
    const start = row.startedAt ? Date.parse(row.startedAt) : NaN
    const end = Date.parse(String(row.endedAt))
    if (Number.isFinite(start) && Number.isFinite(end)) return Math.max(0, (end - start) / 1000)
    return null
  }
  if (!running) {
    return row.seconds != null && Number.isFinite(Number(row.seconds)) ? Number(row.seconds) : null
  }
  if (!row.startedAt) return row.seconds ?? null
  const t = Date.parse(row.startedAt)
  if (!Number.isFinite(t)) return row.seconds ?? null
  return Math.max(0, (nowMs - t) / 1000)
}

export function nodeX(id: string, videoMode?: string | null): number {
  const order = graphOrder(videoMode)
  const i = order.indexOf(id)
  const idx = i < 0 ? 0 : i
  return GRAPH_LAYOUT.padX + idx * (GRAPH_LAYOUT.nodeW + GRAPH_LAYOUT.gap)
}

export function graphWidth(videoMode?: string | null): number {
  const n = graphOrder(videoMode).length
  return GRAPH_LAYOUT.padX * 2 + n * GRAPH_LAYOUT.nodeW + (n - 1) * GRAPH_LAYOUT.gap
}

export function resumeTarget(timings?: Record<string, StepTiming> | null): string | null {
  if (!timings) return null
  const first = PIPELINE.find((id) => Boolean(timings[id]?.startedAt))
  return first && first !== 'health' ? first : null
}

export function timeLabelWidth(label: string): number {
  return Math.max(36, 8 + label.length * 6.2)
}

export function decorateGraph(
  report: Pick<BrainReport, 'steps' | 'status' | 'step' | 'timings' | 'graph' | 'running' | 'videoMode'>,
  nowMs = Date.now(),
): { nodes: GraphNodeView[]; edges: GraphEdgeView[] } {
  const timings = report.timings || {}
  const current = report.step
  const raw = report.graph
  const steps = report.steps || []
  const byStep = new Map(steps.map((s) => [s.id, s]))
  const begun = steps.some((s) => s.state === 'done' || s.state === 'active' || s.state === 'fail')
  const t2v = report.videoMode === 't2v'
  const metas = t2v ? GRAPH_NODE_META.filter((m) => !T2V_SKIP.has(m.id)) : GRAPH_NODE_META
  const edgeSpecs = t2v
    ? GRAPH_EDGES.filter((e) => !T2V_SKIP.has(e.from) && !T2V_SKIP.has(e.to))
    : GRAPH_EDGES

  const nodes: GraphNodeView[] = metas.map((meta) => {
    if (raw?.nodes?.length) {
      const hit = raw.nodes.find((n) => n.id === meta.id)
      if (hit) return { ...meta, state: hit.state || 'idle' }
    }
    if (meta.id === 'start') return { ...meta, state: begun ? 'done' : 'idle' }
    if (meta.id === 'end') {
      const st = report.status
      return {
        ...meta,
        state: st === 'done' ? 'done' : st === 'fail' || st === 'stopped' ? 'fail' : 'idle',
      }
    }
    return { ...meta, state: byStep.get(meta.id)?.state || 'idle' }
  })

  const edges: GraphEdgeView[] = edgeSpecs.map((spec) => {
    const id = `${spec.from}->${spec.to}:${spec.kind}`
    const rawEdge = raw?.edges?.find((e) => e.from === spec.from && e.to === spec.to && e.kind === spec.kind)
    const row = timings[spec.from]
    let secs: number | null = null
    if (spec.kind === 'flow') {
      secs = liveSeconds(row, nowMs, Boolean(report.running))
    } else if (
      spec.kind === 'stop' &&
      (report.status === 'fail' || report.status === 'stopped') &&
      spec.from === current
    ) {
      secs = liveSeconds(row, nowMs, false)
    } else if (rawEdge?.seconds != null) {
      secs = rawEdge.seconds
    }
    const live =
      spec.kind === 'flow' &&
      spec.from === current &&
      Boolean(report.running) &&
      Boolean(row?.startedAt) &&
      !row?.endedAt
    return {
      id,
      from: spec.from,
      to: spec.to,
      kind: spec.kind,
      seconds: secs,
      live,
    }
  })

  return { nodes, edges }
}

export function graphHeadline(
  report: Pick<BrainReport, 'label' | 'currentClip' | 'running' | 'comfy' | 'steps'>,
): string {
  const active = (report.steps || []).find((s) => s.state === 'active')
  const bits = [report.label || active?.label || 'Graph']
  if (report.currentClip) bits.push(report.currentClip)
  if (report.running && report.comfy?.percent != null) bits.push(`${Math.round(report.comfy.percent)}%`)
  return bits.join(' · ')
}

export function nodeProgress(
  id: string,
  report: Pick<BrainReport, 'step' | 'comfy' | 'running'>,
): ComfyProgressView | null {
  if (!report.running || !report.comfy?.active) return null
  if (id === 'stills' && report.step === 'stills') return report.comfy
  if (id === 'video' && report.step === 'video') return report.comfy
  return null
}

export type OpState = 'idle' | 'active' | 'done' | 'skip' | 'fail'

export type ResolvedOp = NodeOp & { state: OpState }

export function resolveOps(
  nodeId: string,
  report: Pick<BrainReport, 'step' | 'status' | 'phase' | 'running' | 'reviewOk' | 'clips'>,
  nodeState: string,
): ResolvedOp[] {
  const ops = NODE_OPS[nodeId] || []
  if (!ops.length) return []
  const phase = report.phase || ''
  const idx = ops.findIndex((op) => op.id === phase)
  const skipped = new Set<string>()
  if (nodeId === 'plan' && phase === 'plan_reuse') skipped.add('plan_llm')
  if (nodeId === 'plan' && (phase === 'plan_llm' || phase === 'plan_save')) skipped.add('plan_reuse')

  return ops.map((op, i) => {
    let state: OpState = 'idle'
    if (skipped.has(op.id)) state = 'skip'
    else if (nodeState === 'fail' && (idx === i || (idx < 0 && i === 0 && report.step === nodeId))) state = 'fail'
    else if (nodeState === 'done') state = skipped.has(op.id) ? 'skip' : 'done'
    else if (nodeState === 'active' || (report.step === nodeId && (report.running || report.status === 'face_qa'))) {
      if (idx < 0 && i === 0) state = 'active'
      else if (i < idx) state = 'done'
      else if (i === idx) state = 'active'
    }
    return { ...op, state }
  })
}

export function viaLabel(via: OpVia): string {
  if (via === 'llm') return 'Local LLM'
  if (via === 'comfy') return 'Comfy'
  if (via === 'http') return 'Monitor'
  if (via === 'disk') return 'Disk'
  if (via === 'ffmpeg') return 'ffmpeg'
  if (via === 'human') return 'You'
  return 'Graph'
}

export function liveOpLine(
  report: Pick<BrainReport, 'phase' | 'step' | 'currentClip' | 'comfy' | 'running' | 'label'>,
): string | null {
  const op = liveOp(report)
  if (!op) return null
  const bits = [viaLabel(op.via), op.label]
  if (report.currentClip) bits.push(report.currentClip)
  if (report.running && report.comfy?.percent != null && (op.via === 'comfy' || op.id.endsWith('_wait'))) {
    bits.push(`${Math.round(report.comfy.percent)}%`)
  }
  return bits.join(' · ')
}

export type { BrainStep }
