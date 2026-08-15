/**
 * Queue MiniMax H3 from the API graph named in qorlith.yaml (video.workflow).
 * Does not invent model or LoRA names. Fails if the workflow path is empty.
 */
import fs from 'fs'
import path from 'path'
import { saveWorkflowSnapshot } from './comfyWorkflow.mjs'
import { getVideoWorkflowPath, loadStudio } from './studioConfig.mjs'
import { fail } from './errors.mjs'
import { info as logInfo } from './log.mjs'
import { comfyApi, comfyHealth } from './comfyClient.mjs'
import { COMFY_CLIENT_ID, rememberPromptGraph } from './comfyProgress.mjs'

const DEFAULT_COMFY = 'http://127.0.0.1:8188'

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj))
}

export function composeH3Prompt(job) {
  const motion = String(job.motion || '').trim()
  const dialogue = String(job.dialogue || '').trim()
  const music = String(job.music || '').trim()
  const soundscape = String(job.soundscape || '').trim()
  if (!motion && !dialogue) return ''

  const lock = job.continueFromPrior
    ? 'The person in <Picture 1> keeps the same identity, costume, body, colors, and space. Continue the action from this pose. Do not change location unless the motion says so.'
    : 'The person in <Picture 1> keeps the same identity, costume, and setting.'

  let body = `[Shot 1] 2D-animated cinematic anime. ${lock}`
  if (motion) body += ` ${motion}`
  if (dialogue) {
    body += ` ${dialogue}`
  } else {
    body += ' Her lips remain completely closed. No spoken words. No singing.'
  }

  const parts = [
    'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.',
    `integrated_multimodal_description: ${body}`,
    `overall_soundscape: ${soundscape || 'Distant wind and light debris. No voices.'}`,
  ]
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
  const motion = String(job.motion || '')
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
  return { prompt: p, report }
}

export function loadVideoTemplate(explicit) {
  const resolved = explicit && fs.existsSync(explicit) ? path.resolve(explicit) : getVideoWorkflowPath()
  if (!resolved || !fs.existsSync(resolved)) {
    fail(400, 'missing_video_workflow', 'Set video.workflow in qorlith.yaml to your MiniMax H3 API graph', {
      hint: 'Point video.workflow at an exported Comfy API JSON, then retry.',
    })
  }
  const data = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  const prompt = data.prompt && typeof data.prompt === 'object' ? data.prompt : data
  return { template: deepClone(prompt), templatePath: resolved }
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

  onProgress({ stage: 'stage_input', detail: opts.sourceImage })
  const staged = stageInputImage(opts.sourceImage, comfyRoot)

  const prefix = opts.filenamePrefix || `qorlith/video/dir_${Date.now().toString(36)}`
  const startedAt = Date.now()
  onProgress({ stage: 'load_template' })
  const { template, templatePath } = loadVideoTemplate(opts.templatePath)
  const diskBefore = fs.readFileSync(templatePath)

  const { prompt, report: patchReport } = applyMinimaxJob(template, {
    inputImageName: staged.inputImageName,
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
  })

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
    extra: { durationSec, megapixels, fps, engine: 'minimax_h3' },
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
    sourceImage: staged.sourceAbs,
    related: [{ path: staged.sourceAbs, role: 'source' }],
    durationSeconds,
    fps,
    sampler: { pipeline: 'minimax_h3', durationSec, megapixels, seed: opts.seed },
    prompt: opts.motion,
    dialogue: opts.dialogue,
    music: opts.music,
    negative,
    tags: ['minimax-h3', 'director', 'video'],
    director: true,
  }
  const jsonPath = mp4Path.replace(/\.[^.]+$/, '') + '.json'
  fs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), 'utf8')
  sidecar.metaPath = jsonPath
  patchStillRelated(staged.sourceAbs, mp4Path)
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
  }
}


