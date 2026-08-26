/**
 * Live Brain view. Reads monitor/data/projects/<id>/brain.json.
 */
import { spawn } from 'node:child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { fail } from './errors.mjs'
import { loadProjectRecord, projectDir, projectsRoot } from './project.mjs'
import { decorateProgressForBrain, getComfyProgress } from './comfyProgress.mjs'
import { loadStudio, normalizeVideoMode, preferT2v } from './studioConfig.mjs'

function stillQualityFromYaml() {
  const q = String(loadStudio().stills?.quality || 'standard').toLowerCase()
  return q === 'draft' || q === 'hero' || q === 'standard' ? q : 'standard'
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BRAIN_BIN = path.join(REPO, 'bin', 'brain')

export const BRAIN_STEPS = [
  { id: 'health', label: 'Ready' },
  { id: 'plan', label: 'Story' },
  { id: 'stills', label: 'Pictures' },
  { id: 'face_qa', label: 'Your picks' },
  { id: 'video', label: 'Motion' },
  { id: 'free', label: 'Clear' },
  { id: 'finish', label: 'Film' },
]
const T2V_SKIP_STEPS = new Set(['stills', 'face_qa'])

function pipelineSteps(videoMode) {
  if (normalizeVideoMode(videoMode) === 't2v') {
    return BRAIN_STEPS.filter((s) => !T2V_SKIP_STEPS.has(s.id)).map((s) =>
      s.id === 'video' ? { ...s, label: 'Clips' } : s,
    )
  }
  return BRAIN_STEPS
}

export function brainReportPath(id) {
  return path.join(projectDir(id), 'brain.json')
}

function stepStates(status, current, stopAfter = null, videoMode = null) {
  const steps = pipelineSteps(videoMode)
  const order = steps.map((s) => s.id)
  let cur = order.includes(current) ? current : 'health'
  if (stopAfter === 'plan' && cur === 'stills') cur = 'plan'
  if (!order.includes(cur)) cur = status === 'done' ? 'finish' : order[0]
  const idx = order.indexOf(cur)
  return steps.map((s, i) => {
    let state = 'idle'
    if (status === 'done') state = 'done'
    else if (status === 'fail' && i === idx) state = 'fail'
    else if (i < idx) state = 'done'
    else if (i === idx) {
      if (status === 'fail') state = 'fail'
      else if (stopAfter === cur) state = 'done'
      else state = 'active'
    }
    return { id: s.id, label: s.label, state }
  })
}

export function statusLabel(brain) {
  if (brain.running) return 'Running'
  if (!brain.started) return 'Idle'
  if (brain.status === 'fail') return 'Failed'
  if (brain.status === 'stopped') return 'Stopped'
  if (brain.status === 'done') return 'Ready to watch'
  if (brain.stopAfter === 'plan' && (brain.step === 'plan' || brain.step === 'stills')) {
    return 'Plan ready'
  }
  if (brain.status === 'face_qa') {
    return brain.videoMode === 't2v' ? 'Making clips' : 'Your turn — pick stills'
  }
  if (brain.status === 'stills') {
    return brain.videoMode === 't2v' ? 'Making clips' : 'Painting pictures'
  }
  if (brain.status === 'video') return brain.videoMode === 't2v' ? 'Making clips' : 'Animating clips'
  if (brain.status === 'recut') return 'Joining the film'
  if (brain.status === 'pending') return 'Starting'
  return brain.status || 'Idle'
}

export function brainPidPath(id) {
  return path.join(projectDir(id), 'brain.pid')
}

export function readBrainPid(id) {
  const file = brainPidPath(id)
  if (!fs.existsSync(file)) return null
  const pid = Number(String(fs.readFileSync(file, 'utf8')).trim())
  if (!Number.isInteger(pid) || pid <= 0) return null
  return pid
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
    const state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]
    if (state === 'Z') return false
  } catch {
    return false
  }
  return true
}

function sleep(ms) {
  const buf = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(buf, 0, 0, ms)
}

export function killBrainPid(pid, { waitMs = 2000 } = {}) {
  if (!pidAlive(pid)) return { pid, killed: false }
  const signal = (sig) => {
    try {
      process.kill(pid, sig)
    } catch {
      /* already gone */
    }
    try {
      process.kill(-pid, sig)
    } catch {
      /* not a process group */
    }
  }
  signal('SIGTERM')
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline && pidAlive(pid)) {
    sleep(50)
  }
  if (pidAlive(pid)) signal('SIGKILL')
  sleep(50)
  return { pid, killed: !pidAlive(pid) }
}

export function clearBrainPid(id) {
  try {
    fs.unlinkSync(brainPidPath(id))
  } catch {
    /* ignore */
  }
}

export function isBrainRunning(id) {
  const pid = readBrainPid(id)
  if (!pid) {
    clearBrainPid(id)
    return false
  }
  if (pidAlive(pid)) return true
  clearBrainPid(id)
  return false
}

export function markBrainStopped(id, { error = 'Stopped from the UI' } = {}) {
  const file = brainReportPath(id)
  let raw = {}
  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      raw = {}
    }
  }
  if (raw.status === 'done') return raw
  raw.schema = raw.schema || 'qorlith.brain.v1'
  raw.projectId = raw.projectId || id
  raw.status = 'stopped'
  raw.lastError = error
  raw.updatedAt = new Date().toISOString()
  if (Array.isArray(raw.steps)) {
    raw.steps = raw.steps.map((s) => (s.state === 'active' ? { ...s, state: 'idle' } : s))
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`)
  return raw
}

export function stopBrain(id) {
  const pid = readBrainPid(id)
  if (!pidAlive(pid)) {
    clearBrainPid(id)
    fail(409, 'brain_not_running', 'Brain is not running for this project', {
      hint: 'Nothing to stop.',
    })
  }
  const result = killBrainPid(pid)
  clearBrainPid(id)
  markBrainStopped(id)
  return { ok: true, pid, killed: result.killed, brain: loadBrain(id) }
}

export function resolveBrainStopAfter(stopAfter, videoMode) {
  if (stopAfter === 'plan') return 'plan'
  if (preferT2v(videoMode) === 't2v') return 'film'
  if (stopAfter === 'film' || stopAfter === '' || stopAfter === 'finish') return 'film'
  return stopAfter || 'stills'
}

export function spawnBrain(id, { resume = false, stopAfter = 'stills', reviewOk = false, autoPick = false, videoMode } = {}) {
  if (!fs.existsSync(BRAIN_BIN)) {
    fail(500, 'brain_missing', 'bin/brain is not installed', {
      hint: 'Run from the Qorlith repo so ./bin/brain exists.',
    })
  }
  if (isBrainRunning(id)) {
    fail(409, 'brain_running', 'Brain is already running for this project', {
      hint: 'Wait for the current run, or check the Brain page.',
    })
  }
  const rec = loadProjectRecord(id)
  const mode = preferT2v(videoMode, rec?.plan?.videoMode)
  const halt = resolveBrainStopAfter(stopAfter, mode)
  const film = halt === 'film'
  const args = resume
    ? ['resume', '--thread', id, ...(reviewOk ? ['--review-ok'] : [])]
    : [
        'start',
        '--project',
        id,
        '--stop-after',
        halt,
        '--quality',
        stillQualityFromYaml(),
        ...((autoPick || film || mode === 't2v') ? ['--auto-pick'] : []),
        ...(mode === 't2v' ? ['--video-mode', 't2v'] : []),
      ]
  const child = spawn(BRAIN_BIN, args, {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, QORLITH_ROOT: REPO },
  })
  child.unref()
  const dir = projectDir(id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(brainPidPath(id), String(child.pid))
  return { pid: child.pid, args }
}

export function planClipsForBrain(rec) {
  const clips = rec?.plan?.clips
  if (!Array.isArray(clips)) return []
  return clips
    .filter((c) => c && c.id)
    .map((c) => ({
      id: c.id,
      title: c.title || c.id,
      durationSec: c.durationSec ?? null,
      cut: Boolean(c.cut),
      stillBrief: c.stillBrief || null,
      motionBrief: c.motionBrief || null,
      still: null,
      video: null,
      pick: null,
    }))
}

export function attachPlanClips(view, rec) {
  const planned = planClipsForBrain(rec)
  if (!planned.length || !view) return view
  const live = Array.isArray(view.clips) ? view.clips : []
  const byLive = new Map(live.map((c) => [c.id, c]))
  const clips = planned.map((p) => {
    const c = byLive.get(p.id)
    if (!c) return p
    return {
      ...p,
      ...c,
      title: c.title || p.title,
      durationSec: c.durationSec ?? p.durationSec ?? null,
      cut: Boolean(c.cut) || Boolean(p.cut),
      stillBrief: c.stillBrief || p.stillBrief || null,
      motionBrief: c.motionBrief || p.motionBrief || null,
      still: c.still || null,
      video: c.video || null,
      pick: c.pick || null,
    }
  })
  for (const c of live) {
    if (!planned.some((p) => p.id === c.id)) clips.push(c)
  }
  return { ...view, clips }
}

export function idleBrain(projectId, extra = {}) {
  const videoMode = normalizeVideoMode(extra.videoMode)
  return {
    schema: 'qorlith.brain.v1',
    projectId,
    title: extra.title || projectId,
    lookTrack: extra.lookTrack || 'live',
    videoMode,
    status: 'idle',
    step: 'health',
    stopAfter: null,
    reviewOk: false,
    lastError: null,
    currentClip: null,
    updatedAt: extra.updatedAt || null,
    steps: pipelineSteps(videoMode).map((s) => ({ ...s, state: 'idle' })),
    clips: extra.clips || [],
    jobIds: [],
    master: extra.master || null,
    started: false,
    running: false,
    label: 'Idle',
    runId: null,
    phase: null,
    timings: {},
    graph: extra.graph || null,
  }
}

export function viewBrain(raw, fallbackId = '') {
  if (!raw || typeof raw !== 'object') return idleBrain(fallbackId)
  const status = String(raw.status || 'idle')
  const step = String(raw.step || (status === 'done' ? 'finish' : 'health'))
  const clips = Array.isArray(raw.clips)
    ? raw.clips.map((c) => ({
        id: c.id,
        title: c.title || c.id,
        durationSec: c.durationSec ?? null,
        cut: Boolean(c.cut),
        stillBrief: c.stillBrief || null,
        motionBrief: c.motionBrief || null,
        still: c.still || null,
        video: c.video || null,
        pick: c.pick || null,
      }))
    : []
  const videoMode = normalizeVideoMode(raw.videoMode)
  let steps =
    Array.isArray(raw.steps) && raw.steps.length
      ? raw.steps
      : stepStates(status, step, raw.stopAfter || null, videoMode)
  if (videoMode === 't2v') steps = steps.filter((s) => !T2V_SKIP_STEPS.has(s.id))
  const view = {
    schema: 'qorlith.brain.v1',
    projectId: raw.projectId || fallbackId,
    title: raw.title || raw.projectId || fallbackId,
    lookTrack: raw.lookTrack || 'live',
    videoMode,
    status,
    step,
    stopAfter: raw.stopAfter || null,
    reviewOk: Boolean(raw.reviewOk),
    lastError: raw.lastError || null,
    currentClip: raw.currentClip || null,
    updatedAt: raw.updatedAt || null,
    steps,
    clips,
    jobIds: Array.isArray(raw.jobIds) ? raw.jobIds : [],
    master: raw.master || null,
    started: true,
    running: false,
    label: '',
    runId: raw.runId || null,
    phase: raw.phase || null,
    timings: raw.timings && typeof raw.timings === 'object' ? raw.timings : {},
    graph: raw.graph && typeof raw.graph === 'object' ? raw.graph : null,
  }
  view.label = statusLabel(view)
  return view
}

const lastGoodBrain = new Map()

function readBrainFile(id) {
  const file = brainReportPath(id)
  if (!fs.existsSync(file)) return null
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }
}

export function loadBrain(id) {
  const rec = loadProjectRecord(id)
  const planMode = normalizeVideoMode(rec?.plan?.videoMode)
  const raw = readBrainFile(id)
  let view
  if (raw && typeof raw === 'object') view = viewBrain(raw, id)
  else {
    view =
      lastGoodBrain.get(id) ||
      idleBrain(id, {
        videoMode: planMode,
        title: rec?.plan?.title || rec?.title,
        clips: planClipsForBrain(rec),
      })
    if (planMode === 't2v') view.videoMode = 't2v'
  }
  view = attachPlanClips(view, rec)
  if (view.videoMode === 't2v' && Array.isArray(view.steps)) {
    view.steps = view.steps.filter((s) => !T2V_SKIP_STEPS.has(s.id))
  }
  if (view.started || (view.clips && view.clips.length)) lastGoodBrain.set(id, view)
  view.running = isBrainRunning(id)
  view.label = statusLabel(view)
  const live = getComfyProgress()
  view.comfy = view.running || live.active ? decorateProgressForBrain(live, view) : null
  return view
}

/** Live activity overlay from Brain — preferred over leftover produce packs. */
export function floorOverlayFromBrain(brain, baseFloor) {
  if (!brain || !brain.started) return baseFloor
  const clips = Array.isArray(brain.clips) ? brain.clips : []
  const total = clips.length
  const done = clips.filter((c) => c.video).length
  const failed = brain.status === 'fail' ? 1 : 0
  const running = Boolean(brain.running)
  const phase =
    brain.status === 'done'
      ? 'ready'
      : brain.status === 'video'
        ? 'motion'
        : brain.status === 'stills'
          ? 'pictures'
          : brain.status === 'face_qa'
            ? 'picks'
            : brain.status || (running ? 'making' : 'idle')
  const percent =
    brain.status === 'done'
      ? 100
      : total > 0
        ? Math.round((done / Math.max(total, 1)) * 1000) / 10
        : 0
  return {
    ...baseFloor,
    mood: running ? 'making' : brain.status === 'done' ? 'ready' : brain.status || baseFloor.mood,
    statusLine: brain.label || baseFloor.statusLine,
    friends: [
      { name: brain.title || brain.projectId, blurb: total ? `${done}/${total}` : 'story' },
      { name: 'Comfy', blurb: running ? 'busy' : 'ready' },
      ...(brain.videoMode === 't2v' ? [] : [{ name: 'Board', blurb: 'picks' }]),
      { name: 'Watch', blurb: brain.master ? 'film ready' : 'waiting' },
    ],
    progress: {
      ...baseFloor.progress,
      project: brain.projectId,
      runId: brain.projectId,
      phase,
      done,
      total,
      failed,
      percent,
      currentShot: brain.currentClip || null,
      detail: brain.label || null,
      masterPath: brain.master || null,
      workDir: null,
    },
  }
}

export function listBrains() {
  const root = projectsRoot()
  if (!fs.existsSync(root)) return []
  const out = []
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name, 'brain.json')
    if (!fs.existsSync(file)) continue
    out.push(loadBrain(name))
  }
  out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
  return out
}
