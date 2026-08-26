/**
 * Live Comfy render progress.
 * Subscribes to /ws with the same clientId we put on POST /prompt.
 */
import { getComfyUrl } from './studioConfig.mjs'
import { info as logInfo } from './log.mjs'

export const COMFY_CLIENT_ID = 'qorlith-monitor'

const NODE_KINDS = [
  { re: /minimax|wanvideo|i2v|image.?to.?video|video.?combine|vhs_/i, kind: 'video' },
  { re: /ksampler|sampler|unipc|dpmpp|euler/i, kind: 'still' },
  { re: /vae.?decode/i, kind: 'develop' },
  { re: /vae.?encode/i, kind: 'encode' },
  { re: /lora/i, kind: 'look' },
  { re: /checkpoint|unetloader|dualcliploader|cliploader/i, kind: 'load' },
  { re: /save.*video|videocombine/i, kind: 'save_video' },
  { re: /saveimage|previewimage/i, kind: 'save_still' },
  { re: /cliptext|text.?encode/i, kind: 'brief' },
  { re: /loadimage/i, kind: 'open' },
  { re: /emptylatent|empty.?image/i, kind: 'canvas' },
]

const COPY = {
  video: {
    title: 'Making the clip',
    hint: 'This clip takes a few minutes. You can leave this page — it keeps going.',
  },
  still: {
    title: 'Painting the still',
    hint: 'Each step sharpens the picture.',
  },
  develop: {
    title: 'Developing the still',
    hint: 'Turning the latent into pixels.',
  },
  encode: {
    title: 'Reading the first frame',
    hint: 'Preparing the first frame.',
  },
  look: {
    title: 'Applying the look',
    hint: 'Loading the style from your yaml.',
  },
  load: {
    title: 'Loading the model',
    hint: 'The first load is the slow one. Later jobs reuse it.',
  },
  save_video: {
    title: 'Writing the video',
    hint: 'Almost done — saving the file.',
  },
  save_still: {
    title: 'Saving the still',
    hint: 'Writing the image to disk.',
  },
  brief: {
    title: 'Reading the brief',
    hint: 'Turning your words into a condition.',
  },
  open: {
    title: 'Opening the first frame',
    hint: 'Feeding the first frame in.',
  },
  canvas: {
    title: 'Setting the canvas',
    hint: 'Allocating the image size.',
  },
  wait: {
    title: 'Waiting for the GPU',
    hint: 'A render is already on the card. Step numbers appear once this Monitor queued the job.',
  },
  work: {
    title: 'Working',
    hint: 'Comfy is busy on this job.',
  },
  idle: {
    title: 'Ready',
    hint: 'The GPU is free.',
  },
}

const graphs = new Map()
let socket = null
let reconnectTimer = null
let started = false
let backoffMs = 1000

const state = emptyState()

export function emptyState() {
  return {
    connected: false,
    promptId: null,
    node: null,
    nodeClass: null,
    value: 0,
    max: 0,
    queueRemaining: 0,
    startedAt: null,
    tickAt: null,
    tickValue: 0,
    updatedAt: 0,
    lastEvent: null,
    doneAt: 0,
  }
}

export function wsUrlFromHttp(base) {
  const raw = String(base || 'http://127.0.0.1:8188').replace(/\/$/, '')
  const u = new URL(raw)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.pathname = '/ws'
  u.search = `clientId=${encodeURIComponent(COMFY_CLIENT_ID)}`
  return u.toString()
}

export function rememberPromptGraph(promptId, prompt) {
  if (!promptId || !prompt || typeof prompt !== 'object') return
  const map = {}
  for (const [id, node] of Object.entries(prompt)) {
    if (node && typeof node === 'object' && node.class_type) map[id] = String(node.class_type)
  }
  graphs.set(String(promptId), map)
  if (graphs.size > 40) {
    const first = graphs.keys().next().value
    graphs.delete(first)
  }
}

export function classForNode(promptId, nodeId) {
  if (!promptId || !nodeId) return null
  return graphs.get(String(promptId))?.[String(nodeId)] || null
}

export function graphLooksLikeVideo(promptId) {
  const map = graphs.get(String(promptId || '')) || {}
  return Object.values(map).some((cls) => /minimax|wanvideo|i2v|image.?to.?video/i.test(String(cls)))
}

export function kindForClass(nodeClass, max) {
  if (nodeClass) {
    for (const row of NODE_KINDS) {
      if (row.re.test(nodeClass)) return row.kind
    }
  }
  if (Number(max) >= 80) return 'video'
  if (Number(max) > 0) return 'still'
  return 'work'
}

export function parseComfyWsMessage(raw) {
  if (raw == null) return null
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)) return null
  if (raw instanceof ArrayBuffer) return null
  if (typeof raw !== 'string') {
    if (typeof raw === 'object' && raw.type) return raw
    return null
  }
  try {
    const msg = JSON.parse(raw)
    return msg && typeof msg === 'object' && msg.type ? msg : null
  } catch {
    return null
  }
}

function pickRunningNode(nodes) {
  if (!nodes || typeof nodes !== 'object') return null
  let fallback = null
  for (const [id, n] of Object.entries(nodes)) {
    if (!n || typeof n !== 'object') continue
    const row = { id, value: Number(n.value) || 0, max: Number(n.max) || 0, state: n.state }
    if (n.state === 'running') return row
    if (row.max > 0 && row.value < row.max) fallback = row
  }
  return fallback
}

export function applyComfyEvent(prev, event) {
  if (!event || !event.type) return prev
  const next = { ...prev, lastEvent: event.type, updatedAt: Date.now() }
  const data = event.data && typeof event.data === 'object' ? event.data : {}

  if (event.type === 'status') {
    const remaining = data.status?.exec_info?.queue_remaining
    if (Number.isFinite(Number(remaining))) next.queueRemaining = Number(remaining)
    return next
  }

  if (event.type === 'execution_start') {
    next.promptId = data.prompt_id || next.promptId
    next.startedAt = Date.now()
    next.tickAt = null
    next.tickValue = 0
    next.value = 0
    next.max = 0
    next.node = null
    next.nodeClass = null
    next.doneAt = 0
    return next
  }

  if (event.type === 'executing') {
    next.promptId = data.prompt_id || next.promptId
    next.node = data.node == null ? null : String(data.node)
    next.nodeClass = classForNode(next.promptId, next.node)
    if (data.node == null) {
      next.doneAt = Date.now()
      if (next.max > 0) next.value = next.max
    } else if (!next.startedAt) {
      next.startedAt = Date.now()
    }
    return next
  }

  if (event.type === 'progress') {
    const value = Number(data.value)
    const max = Number(data.max)
    next.promptId = data.prompt_id || next.promptId
    next.node = data.node != null ? String(data.node) : next.node
    next.nodeClass = classForNode(next.promptId, next.node) || next.nodeClass
    if (Number.isFinite(value)) next.value = value
    if (Number.isFinite(max) && max > 0) next.max = max
    if (!next.startedAt) next.startedAt = Date.now()
    if (!next.tickAt && next.value > 0) {
      next.tickAt = Date.now()
      next.tickValue = next.value
    }
    next.doneAt = 0
    return next
  }

  if (event.type === 'progress_state') {
    next.promptId = data.prompt_id || next.promptId
    const running = pickRunningNode(data.nodes)
    if (running) {
      next.node = String(running.id)
      next.nodeClass = classForNode(next.promptId, running.id) || next.nodeClass
      next.value = running.value
      if (running.max > 0) next.max = running.max
      if (!next.startedAt) next.startedAt = Date.now()
      if (!next.tickAt && next.value > 0) {
        next.tickAt = Date.now()
        next.tickValue = next.value
      }
      next.doneAt = 0
    }
    return next
  }

  if (event.type === 'execution_success' || event.type === 'execution_interrupted') {
    next.doneAt = Date.now()
    next.node = null
    if (next.max > 0) next.value = next.max
    return next
  }

  if (event.type === 'execution_error') {
    next.doneAt = Date.now()
    next.node = null
    return next
  }

  return next
}

export function etaLabel(prev, now = Date.now()) {
  const max = Number(prev.max) || 0
  const value = Number(prev.value) || 0
  if (max <= 0 || value <= 0 || value >= max) return null
  const origin = prev.tickAt || prev.startedAt
  const originValue = prev.tickAt ? prev.tickValue : 0
  if (!origin) return null
  const elapsed = now - origin
  const done = value - originValue
  if (done <= 0 || elapsed < 400) return null
  const msLeft = ((max - value) * elapsed) / done
  const sec = Math.round(msLeft / 1000)
  if (sec < 8) return 'a few seconds left'
  if (sec < 55) return `about ${sec} seconds left`
  const min = Math.round(sec / 60)
  if (min <= 1) return 'about a minute left'
  return `about ${min} minutes left`
}

export function countLabel(value, max, kind, nodeClass = '') {
  if (!Number.isFinite(Number(max)) || max <= 0) return null
  const v = Math.max(0, Math.min(max, Number(value) || 0))
  const frames =
    Number(max) >= 80 || /minimax|i2v|image.?to.?video/i.test(String(nodeClass || ''))
  if (frames) return `Frame ${Math.round(v)} of ${Math.round(max)}`
  return `Step ${Math.round(v)} of ${Math.round(max)}`
}

export function decorateProgressForBrain(view, brain) {
  if (!view || !brain) return view
  const clips = Array.isArray(brain.clips) ? brain.clips : []
  const id = brain.currentClip
  const idx = clips.findIndex((c) => c.id === id)
  const clip = idx >= 0 ? clips[idx] : null
  const videoPhase = brain.step === 'video' || brain.status === 'video'
  const stillPhase = brain.step === 'stills' || brain.status === 'stills'
  if (!clip || (!videoPhase && !stillPhase)) return view
  const out = { ...view }
  const place = `${idx + 1} of ${clips.length}`
  if (videoPhase) {
    const t2v = brain.videoMode === 't2v'
    out.kind = view.kind === 'wait' ? 'wait' : 'video'
    out.title = t2v ? `Making ${clip.title || clip.id}` : `Animating ${clip.title || clip.id}`
    out.hint = 'This clip takes a few minutes. You can leave — it keeps going.'
  } else {
    out.kind = view.kind === 'wait' ? 'wait' : 'still'
    out.title = `Painting ${clip.title || clip.id}`
    out.hint = 'Each step sharpens the picture.'
  }
  const rest = view.line && !String(view.line).includes(place) ? view.line : ''
  out.line = rest ? `${place} · ${rest}` : place
  return out
}

export function viewComfyProgress(snap = state, now = Date.now()) {
  const queueRemaining = Number(snap.queueRemaining) || 0
  const hasBar = snap.max > 0
  const finished = Boolean(snap.doneAt) && (!hasBar || snap.value >= snap.max)
  const stale = snap.updatedAt && now - snap.updatedAt > 20_000
  const recentlyDone = snap.doneAt && now - snap.doneAt < 2500
  const working = Boolean(snap.node || (hasBar && snap.value < snap.max)) && !finished
  const queued = queueRemaining > 0 && !working && !recentlyDone
  const active = Boolean((working || queued || recentlyDone) && !stale)
  let kind = working || recentlyDone ? kindForClass(snap.nodeClass, snap.max) : queued ? 'wait' : 'work'
  if (graphLooksLikeVideo(snap.promptId) && (kind === 'still' || kind === 'develop' || kind === 'work')) {
    kind = 'video'
  }
  if (!active) {
    const idle = COPY.idle
    return {
      connected: Boolean(snap.connected),
      active: false,
      kind: 'idle',
      title: idle.title,
      line: idle.hint,
      hint: idle.hint,
      percent: null,
      value: 0,
      max: 0,
      queueRemaining,
      promptId: snap.promptId,
      nodeClass: snap.nodeClass,
      updatedAt: snap.updatedAt ? new Date(snap.updatedAt).toISOString() : null,
    }
  }
  const copy = COPY[kind] || COPY.work
  const percent = hasBar ? Math.max(0, Math.min(100, (snap.value / snap.max) * 100)) : recentlyDone ? 100 : null
  const count = hasBar ? countLabel(snap.value, snap.max, kind, snap.nodeClass) : null
  const eta = working ? etaLabel(snap, now) : null
  const waitingAhead = queueRemaining > 1
  const parts = []
  if (count) parts.push(count)
  if (eta) parts.push(eta)
  else if (queued) {
    parts.push(waitingAhead ? `${queueRemaining - 1} more after the current one` : 'a render is on the GPU')
  }
  if (recentlyDone && !working) parts.push('done')

  return {
    connected: Boolean(snap.connected),
    active,
    kind,
    title: recentlyDone && !working ? 'Render finished' : copy.title,
    line: parts.join(' · ') || copy.hint,
    hint: copy.hint,
    percent: percent == null ? null : Math.round(percent * 10) / 10,
    value: snap.value || 0,
    max: snap.max || 0,
    queueRemaining,
    promptId: snap.promptId,
    nodeClass: snap.nodeClass,
    updatedAt: snap.updatedAt ? new Date(snap.updatedAt).toISOString() : null,
  }
}

export function getComfyProgress() {
  return viewComfyProgress(state)
}

function ingest(raw) {
  const event = parseComfyWsMessage(raw)
  if (!event) return
  Object.assign(state, applyComfyEvent(state, event))
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, backoffMs)
  backoffMs = Math.min(15_000, backoffMs * 1.6)
}

function connect() {
  if (typeof WebSocket === 'undefined') return
  const url = wsUrlFromHttp(getComfyUrl())
  try {
    socket = new WebSocket(url)
  } catch (err) {
    state.connected = false
    logInfo('comfy.ws.error', { error: err instanceof Error ? err.message : String(err) })
    scheduleReconnect()
    return
  }
  socket.addEventListener('open', () => {
    state.connected = true
    backoffMs = 1000
    logInfo('comfy.ws.open', { clientId: COMFY_CLIENT_ID })
  })
  socket.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') ingest(ev.data)
  })
  socket.addEventListener('close', () => {
    state.connected = false
    socket = null
    if (started) scheduleReconnect()
  })
  socket.addEventListener('error', () => {
    try {
      socket?.close()
    } catch {
      /* ignore */
    }
  })
}

export function startComfyProgress() {
  if (started) return
  started = true
  connect()
}

export function _resetComfyProgressForTests() {
  Object.assign(state, emptyState())
  graphs.clear()
  started = false
  backoffMs = 1000
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (socket) {
    try {
      socket.close()
    } catch {
      /* ignore */
    }
    socket = null
  }
}
