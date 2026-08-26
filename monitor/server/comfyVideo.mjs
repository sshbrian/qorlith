/**
 * Queue MiniMax H3 from the API graph named in qorlith.yaml (video.workflow).
 * Does not invent model or LoRA names. Fails if the workflow path is empty.
 */
import fs from 'fs'
import path from 'path'
import { saveWorkflowSnapshot } from './comfyWorkflow.mjs'
import { getVideoWorkflowPath, loadStudio, normalizeVideoMode } from './studioConfig.mjs'
import { fail } from './errors.mjs'
import { info as logInfo } from './log.mjs'
import { comfyApi, comfyFreeMemory, comfyHealth } from './comfyClient.mjs'
import { COMFY_CLIENT_ID, rememberPromptGraph } from './comfyProgress.mjs'

const DEFAULT_COMFY = 'http://127.0.0.1:8188'
const SING_RE = /\b(sings?|singing|chorus|lyrics?)\b/i
const SHOT_LABEL_RE = /^\[Shot\s+\d+\]\s*/i

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

export function normalizeLookTrack(look) {
  const raw = String(look || '').toLowerCase()
  if (raw === 'live') return 'live'
  if (raw === 'anime') return 'anime'
  return ''
}

export function stripShotLabel(text) {
  return String(text || '').replace(SHOT_LABEL_RE, '').trim()
}

function stripStyleTail(text) {
  return String(text || '')
    .replace(/[.]+$/g, '')
    .trim()
}

/** Official H3 Shot 1 style token. motionPrefix is house flavor and never applied to live. */
export function h3ShotStyle(job = {}) {
  const look = normalizeLookTrack(job.lookTrack || job.look)
  const explicit = stripStyleTail(job.style)
  if (explicit) return explicit
  if (look === 'live') return 'Live-action, cinematic'
  const prefix = stripStyleTail(job.motionPrefix)
  if (prefix) return prefix
  return '2D-animated'
}

export function wantsSinging(job = {}) {
  if (job.allowSinging === true || job.singing === true) return true
  return SING_RE.test(`${job.motion || ''} ${job.dialogue || ''} ${job.instruction || ''}`)
}

export function subjectLock(job = {}) {
  const chars = Array.isArray(job.characters) ? job.characters : []
  const names = chars.map((c) => String(c?.name || '').trim()).filter(Boolean)
  const plural = names.length > 1 || Number(job.subjectCount) > 1
  let who
  if (names.length === 1) who = `${names[0]} shown in <Picture 1>`
  else if (names.length === 2) who = `${names[0]} and ${names[1]} shown in <Picture 1>`
  else if (names.length > 2 || plural) who = 'The people shown in <Picture 1>'
  else who = 'The subject shown in <Picture 1>'
  const verb = names.length > 1 || plural ? 'remain' : 'remains'
  if (job.continueFromPrior) {
    return (
      `${who} ${verb} in this pose, preserving appearance, clothing, body, colors, lighting, and spatial layout. ` +
      'This take is a seamless continuation of the previous shot. Hold that exact closing arrangement. ' +
      'For the first couple of seconds only a breath and a slight weight shift, lips closed, no speech.'
    )
  }
  return `${who} ${verb} in this framing, preserving appearance, clothing, and spatial layout.`
}

export function hasAirlockLanguage(text) {
  return /\b(first couple of seconds|about two seconds|opening hold|airlock|slight weight shift)\b/i.test(
    String(text || ''),
  )
}

export const AIRLOCK_LANDING =
  'End in a stable arrangement with about two seconds spare after any speech. Keep the same location unless the motion names a new one.'

export const STILL_ONSET =
  'Hold <Picture 1> for about one second with no new motion.'

function capSoundscapeSentences(text) {
  const bits = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (bits.length <= 4) return text
  return bits.slice(0, 4).join(' ')
}

/** Official overall_soundscape is 1–4 sentences. Tag lists become one sentence. Empty → N/A. */
export function expandSoundscape(raw) {
  const s = String(raw || '').trim()
  if (!s || /^n\/a$/i.test(s)) return 'N/A'
  if (/[.!?]$/.test(s) || s.split(/\s+/).length >= 12) return capSoundscapeSentences(s)
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length) return 'N/A'
  if (parts.length === 1) return /[.!?]$/.test(parts[0]) ? parts[0] : `${parts[0]}.`
  if (parts.length === 2) return `${parts[0]}, and ${parts[1]}.`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}.`
}

const STYLE_HEAD_RE =
  /^(?:2d-animated|live-action(?:\s*,\s*cinematic)?|cinematic|3d cg|claymation|watercolor|vintage film)\s*,\s*/i
const T2V_SHOT_OPEN_RE =
  /^(?:a\s+)?(?:medium-wide|wide|medium close-up|medium|close-up)\s+shot frames[^.!?]*[.!?]\s*/i

function appendMotion(body, motion, alreadyAirlock) {
  const m = stripShotLabel(String(motion || '')).trim()
  if (!m) return body
  if (alreadyAirlock || /^(then\b|the camera\b)/i.test(m)) return `${body} ${m}`
  return `${body} Then ${m}`
}

/** Continue takes are I2VA from the last frame. Drop T2VA shot/identity reopeners. */
export function continueMotionBody(motion) {
  let m = stripShotLabel(String(motion || '')).replace(STYLE_HEAD_RE, '').trim()
  m = m.replace(T2V_SHOT_OPEN_RE, '').trim()
  const cam = m.match(/\bThe camera\b/i)
  if (cam && cam.index > 0) m = m.slice(cam.index).trim()
  return m
}

function t2vWho(job = {}) {
  const chars = Array.isArray(job.characters) ? job.characters : []
  const lead = chars[0]
  if (!lead || typeof lead !== 'object') return ''
  const name = String(lead.name || '').trim()
  const look = String(lead.look || '').trim()
  return [name, look].filter(Boolean).join(', ')
}

function t2vShotBody(style, motion, who = '') {
  const scene = stripShotLabel(String(motion || '')).replace(STYLE_HEAD_RE, '').trim()
  const ident = String(who || '').trim()
  const hay = scene.toLowerCase()
  const need =
    ident &&
    !hay.includes(ident.toLowerCase()) &&
    !hay.includes(ident.toLowerCase().slice(0, Math.min(24, ident.length)))
  const identBit = need ? ident : ''
  const parts = [style, identBit, scene].filter(Boolean)
  return `[Shot 1] ${parts.join(', ')}`
}

export function isT2vJob(job = {}) {
  if (job.t2v === true) return true
  return normalizeVideoMode(job.videoMode || job.mode) === 't2v'
}

export function stripFrameImages(graph) {
  const g = deepClone(graph || {})
  const drop = new Set()
  for (const [id, node] of Object.entries(g)) {
    if (!/minimaxh3/i.test(String(node?.class_type || ''))) continue
    const inputs = node.inputs || {}
    for (const key of ['first_frame', 'last_frame']) {
      const ref = inputs[key]
      if (Array.isArray(ref) && ref[0] != null) drop.add(String(ref[0]))
      delete inputs[key]
    }
  }
  for (const id of drop) {
    const used = Object.entries(g).some(([oid, node]) => {
      if (oid === id || !node?.inputs) return false
      return JSON.stringify(node.inputs).includes(`"${id}"`)
    })
    if (!used) delete g[id]
  }
  return g
}

export function composeH3Prompt(job = {}) {
  const motion = stripShotLabel(String(job.motion || '').trim())
  const dialogue = String(job.dialogue || '').trim()
  const music = String(job.music || '').trim()
  if (!motion && !dialogue) return ''

  const t2v = isT2vJob(job) && !job.continueFromPrior
  const style = h3ShotStyle(job)
  const lock = t2v ? '' : subjectLock(job)
  const motionBody = job.continueFromPrior ? continueMotionBody(motion) : motion
  const alreadyAirlock = hasAirlockLanguage(motionBody)
  let body = t2v
    ? t2vShotBody(style, motion, t2vWho(job))
    : `[Shot 1] ${style}${lock ? `, ${lock}` : ''}`
  if (!t2v && !job.continueFromPrior && !alreadyAirlock) {
    body += ` ${STILL_ONSET}`
  }
  if (!t2v) body = appendMotion(body, motionBody, alreadyAirlock)
  if (job.continueFromPrior && !alreadyAirlock) {
    body += ` ${AIRLOCK_LANDING}`
  }
  if (dialogue) {
    body += job.continueFromPrior ? ` After the opening hold, ${dialogue}` : ` ${dialogue}`
  } else if (!/lips remain/i.test(body)) {
    body += ' On-screen lips remain completely closed. No spoken words.'
    if (!wantsSinging(job)) body += ' No singing.'
  }

  const parts = []
  if (!t2v) {
    parts.push(
      'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    )
  }
  parts.push(
    `integrated_multimodal_description: ${body}`,
    `overall_soundscape: ${expandSoundscape(job.soundscape)}`,
  )
  if (music && music.toUpperCase() !== 'N/A') {
    parts.push(`non_diegetic_music: ${music}`)
  } else {
    parts.push('non_diegetic_music: N/A')
  }
  return parts.join('\n\n')
}

function requireComfyRoot(root) {
  const r = String(root || loadStudio().comfy.root || '').trim()
  if (!r) {
    fail(400, 'missing_comfy_root', 'Set comfy.root in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  return r
}

/**
 * Fill existing string/number inputs by name. Never add nodes or filenames.
 */
export function applyMinimaxJob(prompt, job, report = []) {
  const p = deepClone(prompt)
  const motion = job.continueFromPrior
    ? continueMotionBody(job.motion)
    : String(job.motion || '')
  const dialogue = String(job.dialogue || '')
  const music = String(job.music || '')
  const negative = String(job.negative || '')
  const duration = Number(job.durationSec)
  const mp = Number(job.megapixels)
  const prefix = String(job.filenamePrefix || 'qorlith/video/clip')
  const imageName = job.inputImageName
  const fps = Number(job.fps) > 0 ? Number(job.fps) : 24
  const h3Prompt = composeH3Prompt(job)

  for (const [id, node] of Object.entries(p)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue
    const inputs = node.inputs
    const keys = Object.keys(inputs)
    const classType = String(node.class_type || '').toLowerCase()
    const isMinimax = classType.includes('minimax')
    for (const key of keys) {
      const lk = key.toLowerCase()
      const cur = inputs[key]
      if (imageName && lk === 'image' && typeof cur === 'string') {
        inputs[key] = imageName
        report.push({ nodeId: id, set: key, value: imageName })
      } else if (typeof cur === 'string') {
        if (lk === 'prompt' && isMinimax && h3Prompt) {
          inputs[key] = h3Prompt
          report.push({ nodeId: id, set: key, field: 'prompt' })
        } else if (lk.includes('motion') || lk === 'positive' || (lk === 'text' && !inputs.dialogue)) {
          if (motion) {
            inputs[key] = motion
            report.push({ nodeId: id, set: key, field: 'motion' })
          }
        } else if (lk.includes('dialogue') || lk.includes('speech') || lk.includes('line')) {
          inputs[key] = dialogue
          report.push({ nodeId: id, set: key, field: 'dialogue' })
        } else if (lk.includes('music') || lk.includes('score')) {
          inputs[key] = music
          report.push({ nodeId: id, set: key, field: 'music' })
        } else if (lk.includes('negative')) {
          if (negative) {
            inputs[key] = negative
            report.push({ nodeId: id, set: key, field: 'negative' })
          }
        } else if (lk === 'filename_prefix' || lk.endsWith('prefix')) {
          inputs[key] = prefix
          report.push({ nodeId: id, set: key, value: prefix })
        }
      } else if (typeof cur === 'number') {
        if (Number.isFinite(duration) && (lk === 'length' && (isMinimax || cur >= 24))) {
          const frames = Math.max(24, Math.round(duration * fps))
          inputs[key] = frames
          report.push({ nodeId: id, set: key, value: frames, field: 'length_frames' })
        } else if (Number.isFinite(duration) && (lk.includes('duration') || lk === 'seconds')) {
          inputs[key] = duration
          report.push({ nodeId: id, set: key, value: duration })
        }
        if (Number.isFinite(mp) && (lk.includes('megapixel') || lk === 'mp')) {
          inputs[key] = mp
          report.push({ nodeId: id, set: key, value: mp })
        }
        if (lk.includes('seed') && Number.isFinite(Number(job.seed)) && Number(job.seed) >= 0) {
          inputs[key] = Math.trunc(Number(job.seed))
        }
      }
    }
  }
  return { prompt: p, report, h3Prompt }
}

export const KITCHEN_ATTENTION = 'comfy kitchen attention'

/**
 * MiniMax H3 must run Comfy Kitchen Attention (not Sage). Inserts the node
 * when a graph still wires the UNET straight into the guider/sampler.
 */
export function ensureKitchenAttention(graph) {
  const g = deepClone(graph || {})
  for (const node of Object.values(g)) {
    if (node?.class_type === 'ModelAttentionBackend' && node.inputs) {
      node.inputs.attention = KITCHEN_ATTENTION
    }
  }
  if (Object.values(g).some((n) => n?.class_type === 'ModelAttentionBackend')) return g
  const unetId = Object.keys(g).find((id) => {
    const ct = String(g[id]?.class_type || '')
    const name = String(g[id]?.inputs?.unet_name || g[id]?.inputs?.ckpt_name || '')
    return ct === 'UNETLoader' && /minimax/i.test(name)
  })
  if (!unetId) return g
  let nid = '138'
  while (g[nid]) nid = String(Number(nid) + 1)
  g[nid] = {
    class_type: 'ModelAttentionBackend',
    inputs: { model: [unetId, 0], attention: KITCHEN_ATTENTION },
  }
  for (const [id, node] of Object.entries(g)) {
    if (id === nid || !node?.inputs) continue
    for (const [key, val] of Object.entries(node.inputs)) {
      if (Array.isArray(val) && String(val[0]) === unetId && val[1] === 0) {
        node.inputs[key] = [nid, 0]
      }
    }
  }
  return g
}

export function loadVideoTemplate(explicit, { t2v = false } = {}) {
  const studio = loadStudio()
  const t2vPath = String(studio.video?.t2v_workflow || '').trim()
  const resolved =
    explicit && fs.existsSync(explicit)
      ? path.resolve(explicit)
      : t2v && t2vPath && fs.existsSync(t2vPath)
        ? path.resolve(t2vPath)
        : getVideoWorkflowPath()
  if (!resolved || !fs.existsSync(resolved)) {
    fail(400, 'missing_video_workflow', 'Set video.workflow in qorlith.yaml to your MiniMax H3 API graph', {
      hint: 'Point video.workflow at an exported Comfy API JSON, then retry.',
    })
  }
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const prompt = data.prompt && typeof data.prompt === 'object' ? data.prompt : data
  const kitchen = ensureKitchenAttention(prompt)
  return { template: t2v ? stripFrameImages(kitchen) : kitchen, templatePath: resolved }
}

export function stageInputImage(sourceAbs, comfyRoot) {
  const root = requireComfyRoot(comfyRoot)
  const src = path.resolve(sourceAbs)
  if (!fs.existsSync(src)) {
    fail(400, 'missing_source_still', `Source still not found: ${src}`, {
      hint: 'Generate a still in Make, or paste an existing image path.',
    })
  }
  const inputDir = path.join(root, 'input')
  fs.mkdirSync(inputDir, { recursive: true })
  const ext = path.extname(src) || '.png'
  const base = path.basename(src, ext).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)
  const name = `director_h3_${Date.now().toString(36)}_${base}${ext}`
  const dest = path.join(inputDir, name)
  fs.copyFileSync(src, dest)
  return { inputImageName: name, stagedPath: dest, sourceAbs: src }
}

export function findMp4(outputRoot, prefix, { sinceMs = 0 } = {}) {
  const prefixName = path.basename(prefix)
  const prefixDir = path.join(outputRoot, path.dirname(String(prefix).replace(/\//g, path.sep)))
  const hits = []
  const walk = (dir, depth = 0) => {
    if (depth > 4) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      if (!e.isFile() || !e.name.endsWith('.mp4')) continue
      if (!e.name.startsWith(prefixName)) continue
      const st = fs.statSync(full)
      if (sinceMs && st.mtimeMs + 2000 < sinceMs) continue
      hits.push(full)
    }
  }
  if (fs.existsSync(prefixDir)) walk(prefixDir, 0)
  hits.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
  return hits[0] || null
}

function patchStillRelated(stillAbs, videoAbs) {
  const stillJson = stillAbs.replace(/\.[^.]+$/, '') + '.json'
  if (!fs.existsSync(stillJson)) return false
  try {
    const meta = JSON.parse(fs.readFileSync(stillJson, 'utf8'))
    const rels = Array.isArray(meta.related) ? meta.related : []
    const filtered = rels.filter((r) => !(r && r.path === videoAbs && r.role === 'video'))
    filtered.unshift({ path: videoAbs, role: 'video' })
    meta.related = filtered
    fs.writeFileSync(stillJson, JSON.stringify(meta, null, 2), 'utf8')
    return true
  } catch {
    return false
  }
}

export async function queueVideoAndWait(opts) {
  const onProgress = opts.onProgress || (() => {})
  const studio = loadStudio()
  const comfyBase = opts.comfyBase || studio.comfy.url || DEFAULT_COMFY
  const comfyRoot = requireComfyRoot(opts.comfyRoot || studio.comfy.root)
  const outputRoot = opts.comfyOutputRoot || studio.comfy.output || path.join(comfyRoot, 'output')
  const waitMs = opts.waitMs ?? 45 * 60 * 1000
  const pollMs = opts.pollMs ?? 5000
  const durationSec = Number(opts.durationSec ?? studio.video.duration_sec ?? 12)
  const megapixels = Number(opts.megapixels ?? studio.video.megapixels ?? 0.6)
  const fps = 24
  const negative = String(opts.negative || studio.video.prompts?.negative || '')

  onProgress({ stage: 'comfy_health' })
  const health = await comfyHealth(comfyBase)
  if (!health.ok) {
    fail(502, 'comfy_offline', `ComfyUI offline: ${health.error}`, {
      hint: 'Start ComfyUI on the URL in qorlith.yaml, then retry.',
    })
  }

  const t2v = Boolean(opts.t2v) && !opts.sourceImage
  let staged = null
  if (opts.sourceImage) {
    onProgress({ stage: 'stage_input', detail: opts.sourceImage })
    staged = stageInputImage(opts.sourceImage, comfyRoot)
  }

  const prefix = opts.filenamePrefix || `qorlith/video/dir_${Date.now().toString(36)}`
  const startedAt = Date.now()
  onProgress({ stage: 'load_template' })
  const { template, templatePath } = loadVideoTemplate(opts.templatePath, { t2v })
  const diskBefore = fs.readFileSync(templatePath)

  const lookTrack = normalizeLookTrack(opts.lookTrack)
  const yamlPrefix = String(opts.motionPrefix ?? studio.video.prompts?.motion_prefix ?? '').trim()
  const motionPrefix = lookTrack === 'live' ? '' : yamlPrefix
  const job = {
    inputImageName: staged?.inputImageName,
    t2v,
    videoMode: t2v ? 't2v' : 'stills',
    motion: opts.motion,
    dialogue: opts.dialogue,
    music: opts.music,
    soundscape: opts.soundscape,
    negative,
    durationSec,
    megapixels,
    filenamePrefix: prefix,
    seed: opts.seed,
    continueFromPrior: Boolean(opts.continueFromPrior),
    lookTrack,
    motionPrefix,
    characters: opts.characters,
    allowSinging: Boolean(opts.allowSinging),
    instruction: opts.instruction,
  }
  const { prompt, report: patchReport, h3Prompt } = applyMinimaxJob(template, job)

  const diskAfter = fs.readFileSync(templatePath)
  if (!diskBefore.equals(diskAfter)) {
    fail(500, 'workflow_mutated', 'SAFETY: workflow file on disk was modified — aborting', {
      hint: 'Qorlith only patches a copy. Restore video.workflow from git if the file changed.',
    })
  }

  onProgress({ stage: 'comfy_queue', detail: path.basename(templatePath) })
  const queued = await comfyApi(comfyBase, 'POST', '/prompt', {
    prompt,
    client_id: COMFY_CLIENT_ID,
  })
  const promptId = queued.prompt_id
  if (!promptId) {
    fail(502, 'comfy_queue', 'Comfy queue returned no prompt_id', {
      hint: 'Check the Comfy console for a rejected MiniMax graph.',
    })
  }
  rememberPromptGraph(promptId, prompt)
  logInfo('comfy.queue', { promptId, kind: 'video' })

  const deadline = Date.now() + waitMs
  let historyEntry = null
  let mp4Path = null
  let lastSize = 0
  let stablePolls = 0

  while (Date.now() < deadline) {
    onProgress({ stage: 'comfy_wait', detail: promptId })
    try {
      const hist = await comfyApi(comfyBase, 'GET', `/history/${promptId}`)
      if (hist && hist[promptId]) {
        historyEntry = hist[promptId]
        const st = historyEntry?.status?.status_str
        if (st === 'error') {
          fail(
            502,
            'comfy_job',
            `Comfy video error: ${JSON.stringify(historyEntry?.status?.messages || []).slice(0, 400)}`,
            { hint: 'Open the Comfy queue for the MiniMax node error.' },
          )
        }
      }
    } catch (e) {
      if (e?.status === 502) throw e
    }

    mp4Path = findMp4(outputRoot, prefix, { sinceMs: startedAt })
    if (mp4Path && fs.existsSync(mp4Path)) {
      const sz = fs.statSync(mp4Path).size
      if (sz > 50_000 && sz === lastSize) stablePolls++
      else stablePolls = 0
      lastSize = sz
      const done =
        historyEntry?.status?.status_str === 'success' ||
        historyEntry?.status?.completed ||
        (historyEntry?.outputs && Object.keys(historyEntry.outputs).length > 0)
      if (done && sz > 50_000) break
      if (stablePolls >= 2 && sz > 100_000) break
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }

  if (!mp4Path) mp4Path = findMp4(outputRoot, prefix, { sinceMs: startedAt })
  if (!mp4Path || !fs.existsSync(mp4Path)) {
    fail(504, 'comfy_timeout', `Video timed out or mp4 missing for ${promptId}`, {
      hint: 'Check VRAM and the Comfy queue, then retry.',
    })
  }
  logInfo('comfy.done', { promptId, kind: 'video' })

  if (!opts.keepModels) {
    onProgress({ stage: 'comfy_free' })
    try {
      await comfyFreeMemory(comfyBase)
    } catch {
      /* next gen can still retry; VRAM may stay held */
    }
  }

  const rel = path.relative(outputRoot, mp4Path).replace(/\\/g, '/')
  const durationSeconds = durationSec

  onProgress({ stage: 'save_workflow', detail: mp4Path })
  const wf = saveWorkflowSnapshot({
    prompt,
    mediaPath: mp4Path,
    outputRoot,
    comfyRoot,
    promptId,
    seed: opts.seed,
    templatePath,
    kind: 'video',
    extra: { durationSec, megapixels, fps, engine: 'minimax_h3', lookTrack, h3Prompt, t2v },
  })

  const sidecar = {
    schema: 'qorlith.gen.v1',
    kind: 'video',
    mediaType: 'video/mp4',
    generatedAt: new Date().toISOString(),
    promptId,
    image: rel,
    imagePath: mp4Path,
    engine: 'ComfyUI',
    workflow: path.basename(templatePath),
    templatePath,
    workflowPath: wf.workflowPath,
    sourceImage: staged?.sourceAbs || null,
    related: staged?.sourceAbs ? [{ path: staged.sourceAbs, role: 'source' }] : [],
    durationSeconds,
    fps,
    sampler: { pipeline: t2v ? 'minimax_h3_t2v' : 'minimax_h3', durationSec, megapixels, seed: opts.seed },
    prompt: opts.motion,
    h3Prompt,
    lookTrack: lookTrack || undefined,
    dialogue: opts.dialogue,
    music: opts.music,
    soundscape: opts.soundscape || '',
    negative,
    tags: ['minimax-h3', 'director', 'video', ...(t2v ? ['t2v'] : ['i2va'])],
    director: true,
  }
  const jsonPath = mp4Path.replace(/\.[^.]+$/, '') + '.json'
  fs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), 'utf8')
  sidecar.metaPath = jsonPath
  if (staged?.sourceAbs) patchStillRelated(staged.sourceAbs, mp4Path)
  onProgress({ stage: 'comfy_done', detail: mp4Path })

  return {
    promptId,
    seed: opts.seed,
    videoPath: mp4Path,
    videoRel: rel,
    length: Math.round(durationSec * fps),
    fps,
    durationSeconds,
    sourceImage: staged.sourceAbs,
    sidecar,
    templatePath,
    patchReport,
    workflowPath: wf.workflowPath,
    h3Prompt,
    lookTrack,
  }
}


