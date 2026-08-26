/**
 * Load user-owned qorlith.yaml. Code must not hardcode model or LoRA names.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { parse as parseYaml } from 'yaml'
import { fail } from './errors.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(__dirname, '..', '..')

export function studioYamlPath() {
  return process.env.QORLITH_YAML || path.join(REPO, 'qorlith.yaml')
}

function emptyStudio() {
  return {
    comfy: { url: 'http://127.0.0.1:8188', root: '', output: '' },
    monitor: { api_port: 3921, web_port: 5173 },
    planner: {
      provider: 'local',
      url: 'http://127.0.0.1:1234/v1',
      model: '',
      api_key: '',
      prefer: [],
      temperature: 0.35,
      max_tokens: 4096,
      context_length: 8192,
      timeout_ms: 180000,
      gpu: 'max',
      auto_manage: true,
      unload_before: true,
      unload_after: true,
      identifier: 'qorlith-planner',
      system: '',
      style: '',
    },
    stills: {
      engine: 'sdxl',
      checkpoint: '',
      clip_skip: -2,
      quality: 'standard',
      loras: [],
      locks: [],
      controlnet: { openpose: '', canny: '' },
      upscale: '',
      detailer: { enabled: false, face: '', hand: '', denoise: 0.32, guide_size: 512 },
      ipadapter: { enabled: false, model: '', clip_vision: '', weight: 0.5, weight_type: 'linear' },
      sampler: { name: 'euler_ancestral', scheduler: 'normal', steps: 30, cfg: 6.0 },
      prompts: { prefix: '', suffix: '', negative: '', protect_tokens: [] },
    },
    video: {
      engine: 'minimax_h3',
      workflow: '',
      t2v_workflow: '',
      megapixels: 0.6,
      duration_sec: 12,
      duration_min: 6,
      duration_max: 15,
      continue_min: 10,
      prompts: { motion_prefix: '', negative: '', music_default: 'N/A' },
    },
    train: {
      output_roots: [],
      log_roots: [],
      active_window_minutes: 15,
    },
  }
}

function asLora(raw) {
  if (!raw || typeof raw !== 'object') return null
  const file = String(raw.file || raw.name || '').trim()
  if (!file) return null
  const strength = Number(raw.strength ?? raw.strength_model ?? 0.75)
  return {
    name: file,
    file,
    role: String(raw.role || 'style'),
    default_strength: Number.isFinite(strength) ? strength : 0.75,
    triggers: raw.trigger ? [String(raw.trigger)] : Array.isArray(raw.triggers) ? raw.triggers.map(String) : [],
    notes: String(raw.notes || ''),
  }
}

function readYamlFile(file) {
  if (!fs.existsSync(file)) return {}
  try {
    return parseYaml(fs.readFileSync(file, 'utf8')) || {}
  } catch {
    return {}
  }
}

export function mergePlanner(base, pub = {}, loc = {}) {
  const prefer = loc.prefer ?? pub.prefer ?? base.prefer
  return {
    ...base,
    ...pub,
    ...loc,
    prefer: Array.isArray(prefer) ? prefer.map(String) : [],
    model: String(loc.model ?? pub.model ?? base.model ?? '').trim(),
    provider: String(loc.provider ?? pub.provider ?? base.provider ?? 'local').trim(),
    api_key: String(loc.api_key ?? pub.api_key ?? base.api_key ?? '').trim(),
  }
}

export function loadStudio() {
  const base = emptyStudio()
  const p = studioYamlPath()
  const pub = readYamlFile(p)
  const loc = readYamlFile(path.join(REPO, 'qorlith.local.yaml'))
  const raw = { ...pub, ...loc }
  try {
    if (!raw || typeof raw !== 'object') return base
    const stills = raw.stills || {}
    const cn = stills.controlnet || {}
    const video = raw.video || {}
    const train = raw.train || {}
    return {
      comfy: { ...base.comfy, ...(raw.comfy || {}) },
      monitor: { ...base.monitor, ...(raw.monitor || {}) },
      planner: mergePlanner(base.planner, pub.planner || {}, loc.planner || {}),
      train: { ...base.train, ...train },
      stills: {
        ...base.stills,
        ...stills,
        loras: Array.isArray(stills.loras) ? stills.loras.map(asLora).filter(Boolean) : [],
        locks: Array.isArray(stills.locks) ? stills.locks : [],
        controlnet: { ...base.stills.controlnet, ...cn },
        detailer: { ...base.stills.detailer, ...(stills.detailer || {}) },
        ipadapter: { ...base.stills.ipadapter, ...(stills.ipadapter || {}) },
        sampler: { ...base.stills.sampler, ...(stills.sampler || {}) },
        prompts: { ...base.stills.prompts, ...(stills.prompts || {}) },
      },
      video: {
        ...base.video,
        ...video,
        prompts: { ...base.video.prompts, ...(video.prompts || {}) },
      },
    }
  } catch {
    return base
  }
}

export function getLoraInventory() {
  return loadStudio().stills.loras
}

export function getCheckpoint() {
  return String(loadStudio().stills.checkpoint || '').trim()
}

export function normalizeVideoMode(raw) {
  const v = String(raw || '')
    .toLowerCase()
    .trim()
  if (v === 't2v' || v === 't2va' || v === 'text' || v === 'text-to-video' || v === 'straight') return 't2v'
  return 'stills'
}

/** t2v if any source is t2v. Used so a stills client default cannot demote a saved plan. */
export function preferT2v(...raw) {
  for (const r of raw) {
    if (normalizeVideoMode(r) === 't2v') return 't2v'
  }
  return 'stills'
}

export function clipDurationBounds() {
  const v = loadStudio().video || {}
  const fallback = Number(v.duration_sec)
  const min = Number(v.duration_min)
  const max = Number(v.duration_max)
  const continueMin = Number(v.continue_min)
  const hi = Number.isFinite(max) && max > 0 ? max : 15
  const floor = Number.isFinite(continueMin) && continueMin > 0 ? continueMin : 10
  return {
    fallback: Number.isFinite(fallback) && fallback > 0 ? fallback : 12,
    min: Number.isFinite(min) && min > 0 ? min : 6,
    max: hi,
    continueMin: Math.min(floor, hi),
  }
}

export function getVideoWorkflowPath() {
  const rel = String(loadStudio().video.workflow || '').trim()
  if (!rel) return ''
  return path.isAbsolute(rel) ? rel : path.resolve(REPO, rel)
}

export function getComfyUrl() {
  return String(loadStudio().comfy.url || 'http://127.0.0.1:8188').replace(/\/$/, '')
}

export function getComfyRoot() {
  return String(loadStudio().comfy.root || '').trim()
}

export function getComfyOutput() {
  const out = String(loadStudio().comfy.output || '').trim()
  if (out) return out
  const root = getComfyRoot()
  return root ? path.join(root, 'output') : ''
}

export function requireComfyRoot() {
  const r = getComfyRoot()
  if (!r) {
    fail(400, 'missing_comfy_root', 'Set comfy.root in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  return r
}

export function requireComfyOutput() {
  const o = getComfyOutput()
  if (!o) {
    fail(400, 'missing_comfy_output', 'Set comfy.output or comfy.root in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  return o
}

export function requireCheckpoint() {
  const c = getCheckpoint()
  if (!c) {
    fail(400, 'missing_checkpoint', 'Set stills.checkpoint in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  return c
}
