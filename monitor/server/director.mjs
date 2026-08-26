/**
 * Qorlith Director — local LLM harness for SDXL stills and MiniMax H3 video.
 * Model and LoRA names come from qorlith.yaml. Auto-manages LM Studio, then queues Comfy.
 */
import { preparePlanModel, releasePlanModel, resolveLmsPath, listDiskModels, serverStatus } from './lms.mjs'
import { queueStillBatch, comfyHealth } from './comfyStill.mjs'
import { assertComfyIdle } from './comfyClient.mjs'
import { queueVideoAndWait } from './comfyVideo.mjs'
import { clipDurationBounds, getCheckpoint, getLoraInventory, getVideoWorkflowPath, loadStudio } from './studioConfig.mjs'
import { isGitsLora, textWantsGits } from './gitsLock.mjs'
import { info as logInfo } from './log.mjs'
import { fail } from './errors.mjs'

/** @typedef {{ name: string, strength_model: number, strength_clip: number, reason?: string }} PlanLora */
/** @typedef {{
 *   positive: string,
 *   negative: string,
 *   size: { width: number, height: number, aspectRatio: string },
 *   loras: PlanLora[],
 *   controlnet: { enabled: boolean, type: string, strength: number },
 *   sampler: { steps: number, cfg: number, sampler_name: string, scheduler: string, seed: number },
 *   notes?: string
 * }} DirectorPlan */

export const DEFAULT_DIRECTOR_CFG = {
  lmstudioBaseUrl: 'http://127.0.0.1:1234/v1',
  serverPort: 1234,
  /** Exact model key if set; else first match from planModelPrefer against `lms ls` */
  planModelKey: '',
  /** Legacy alias — same as planModelKey when set */
  model: '',
  planModelPrefer: [],
  planIdentifier: 'qorlith-director',
  gpu: 'max',
  contextLength: 8192,
  unloadBeforeLoad: true,
  unloadAfterPlan: true,
  autoManageModels: true,
  temperature: 0.35,
  maxTokens: 2048,
  timeoutMs: 180000,
  comfyBase: 'http://127.0.0.1:8188',
  checkpoint: '',
  /** draft | standard | hero — still quality tier */
  stillQuality: 'standard',
  videoWorkflow: '',
  comfyRoot: '',
  videoFps: 24,
}

export { getLoraInventory }

export const SIZE_PRESETS = {
  square: { width: 1024, height: 1024, aspectRatio: '1:1' },
  portrait_phone: { width: 768, height: 1344, aspectRatio: '9:16' },
  landscape_16x9: { width: 1280, height: 720, aspectRatio: '16:9' },
  landscape_hero: { width: 1280, height: 720, aspectRatio: '16:9' },
}

function stillPrompts() {
  return loadStudio().stills.prompts || { prefix: '', suffix: '', negative: '', protect_tokens: [] }
}

function videoPrompts() {
  return loadStudio().video.prompts || { motion_prefix: '', negative: '', music_default: 'N/A' }
}

/** Meta tokens that belong in size/notes, not the image prompt */
const META_PROMPT_RE =
  /\b(?:iphone[_\s-]?portrait|portrait[_\s-]?phone|phone[_\s-]?portrait|aspect[_\s-]?ratio|9\s*:\s*16|16\s*:\s*9|1\s*:\s*1|1024x1024|768x1344|1280x720)\b/gi

function defaultSampler() {
  const s = loadStudio().stills?.sampler || {}
  return {
    steps: Number(s.steps) || 30,
    cfg: Number(s.cfg) || 6.0,
    sampler_name: String(s.name || 'euler_ancestral'),
    scheduler: String(s.scheduler || 'normal'),
    seed: -1,
  }
}

function loraByName() {
  return new Map(getLoraInventory().map((l) => [String(l.name || '').toLowerCase(), l]))
}
const STILL_LORA_CAP = 8

export function directorConfigFromApp() {
  const studio = loadStudio()
  const p = studio.planner || {}
  const preferYaml = Array.isArray(p.prefer) ? p.prefer.map(String) : []
  const model = String(p.model || p.model_key || '').trim()
  const temp = Number(p.temperature)
  const maxTokens = Number(p.max_tokens)
  const context = Number(p.context_length)
  const timeout = Number(p.timeout_ms)
  return {
    ...DEFAULT_DIRECTOR_CFG,
    lmstudioBaseUrl: String(p.url || DEFAULT_DIRECTOR_CFG.lmstudioBaseUrl).replace(/\/$/, ''),
    comfyBase: String(studio.comfy.url || DEFAULT_DIRECTOR_CFG.comfyBase),
    comfyRoot: String(studio.comfy.root || ''),
    checkpoint: String(getCheckpoint() || ''),
    videoWorkflow: String(getVideoWorkflowPath() || ''),
    planModelKey: model,
    model,
    planModelPrefer: preferYaml,
    temperature: Number.isFinite(temp) ? temp : DEFAULT_DIRECTOR_CFG.temperature,
    maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : 4096,
    contextLength: Number.isFinite(context) && context > 0 ? context : DEFAULT_DIRECTOR_CFG.contextLength,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_DIRECTOR_CFG.timeoutMs,
    gpu: String(p.gpu || DEFAULT_DIRECTOR_CFG.gpu),
    autoManageModels: p.auto_manage !== false,
    unloadBeforeLoad: p.unload_before !== false,
    unloadAfterPlan: p.unload_after !== false,
    planIdentifier: String(p.identifier || 'qorlith-planner'),
    plannerSystem: String(p.system || ''),
    plannerStyle: String(p.style || ''),
    plannerProvider: String(p.provider || 'local'),
    plannerApiKey: String(p.api_key || ''),
    stillQuality: (() => {
      const q = String(studio.stills?.quality || DEFAULT_DIRECTOR_CFG.stillQuality).toLowerCase()
      return q === 'draft' || q === 'hero' || q === 'standard' ? q : 'standard'
    })(),
  }
}

export function buildSystemPrompt() {
  const inv = getLoraInventory()
  const listed = inv.length
    ? inv
        .map(
          (l) =>
            `- ${l.name} | strength≈${l.default_strength} | triggers=[${(l.triggers || []).join(', ')}]`,
        )
        .join('\n')
    : '(none listed — do not name LoRA files; leave loras as [])'

  const pr = stillPrompts()
  return `You are Qorlith Director for SDXL stills.
Convert free-form user intent into a STRICT JSON generation plan for ComfyUI.

RULES:
1. Output ONLY a single JSON object. No markdown fences, no commentary outside JSON.
2. Adult characters only. Never minors / child-like characters.
3. Positive prompt describes the shot. Do not invent checkpoint or LoRA filenames.
4. Start positive with this prefix if set: ${pr.prefix || '(none)'}
5. Use this negative if you do not supply one: ${pr.negative || '(none)'}
6. LoRAs: only names from the whitelist. If the whitelist is empty, loras must be [].
7. ControlNet: leave enabled=false unless the user asks for a guide.
8. Do not put resolution in the prompt. Size belongs in the size object.
9. notes: short rationale.

LORA WHITELIST (from qorlith.yaml):
${listed}

JSON SCHEMA (all keys required):
{
  "positive": "string",
  "negative": "string",
  "size": { "width": number, "height": number, "aspectRatio": "1:1|9:16|16:9" },
  "loras": [ { "name": "whitelist name", "strength_model": 0.0-1.0, "strength_clip": 0.0-1.0, "reason": "string" } ],
  "controlnet": { "enabled": boolean, "type": "canny|none", "strength": number },
  "sampler": { "steps": number, "cfg": number, "sampler_name": "euler_ancestral", "scheduler": "normal", "seed": number },
  "notes": "string"
}`
}

function clamp(n, lo, hi, fallback) {
  const x = Number(n)
  if (!Number.isFinite(x)) return fallback
  return Math.min(hi, Math.max(lo, x))
}

/**
 * Convert Danbooru-style underscores to Pony/SDXL spaces, keep score_* + source_anime.
 * Strip meta resolution tags and over-aggressive weight syntax.
 */
export function sanitizePonyPositive(positive, extra = {}) {
  const cfg = stillPrompts()
  let p = String(positive || '').trim()
  if (!p) p = String(cfg.prefix || '').trim()

  // Strip meta size / device tags (resolution lives in size object)
  p = p.replace(META_PROMPT_RE, ' ')

  // Protect tokens that legitimately use underscores (placeholders must NOT contain _)
  const protectedMap = new Map()
  let pi = 0
  const triggerProtect = getLoraInventory().flatMap((l) =>
    (l.triggers || [])
      .map((tok) => String(tok).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .filter((tok) => tok.includes('_')),
  )
  const protect = [
    'score_\\d+(?:_up)?',
    'source_\\w+',
    'rating_\\w+',
    ...((cfg.protect_tokens || []).map((tok) => String(tok).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
    ...triggerProtect,
  ]
  const protectRe = new RegExp(`\\b(${protect.join('|')})\\b`, 'gi')
  p = p.replace(protectRe, (m) => {
    const key = `§PONY${pi++}§`
    protectedMap.set(key, m)
    return key
  })

  // Underscores → spaces for natural language tags
  p = p.replace(/_/g, ' ')

  for (const [key, val] of protectedMap) {
    p = p.split(key).join(val)
  }

  // Soften weight emphasis (tag:1.2) → tag  — Pony works better plain
  p = p.replace(/\(\s*([^():]+?)\s*:\s*[\d.]+\s*\)/g, '$1')
  p = p.replace(/\[\s*([^[\]]+?)\s*:\s*[\d.]+\s*\]/g, '$1')

  // Cleanup whitespace / commas
  p = p
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,(?:\s*,)+/g, ',')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim()

  const lower = p.toLowerCase()
  const wantGits = textWantsGits(`${p} ${extra.userText || ''}`)
  const need = []
  const prefix = String(cfg.prefix || '').trim()
  if (prefix && !lower.includes(prefix.toLowerCase().split(',')[0].trim())) {
    need.push(prefix)
  }
  for (const lora of getLoraInventory()) {
    if (isGitsLora(lora) && !wantGits) continue
    for (const trig of lora.triggers || []) {
      if (trig && !lower.includes(String(trig).toLowerCase())) need.push(String(trig))
    }
  }
  if (need.length) p = `${need.join(', ')}, ${p}`
  const suffix = String(cfg.suffix || '').trim()
  if (suffix && !p.toLowerCase().includes(suffix.toLowerCase())) p = `${p}, ${suffix}`
  if (/\b1girl\b/i.test(p) && !/\b(?:[2-9]girls|solo)\b/i.test(p)) {
    p = p.replace(/\b1girl\b/i, '1girl, solo')
  }

  return p
}

function ensurePositiveTags(positive, userText = '') {
  return sanitizePonyPositive(positive, { userText })
}

/** Always-on face/hand artifact block. Merged into every still negative. */
export const FACE_HAND_NEGATIVE =
  'deformed face, mutated face, poorly drawn face, extra eyes, extra eye, malformed eyes, cross-eyed, asymmetric eyes, cloned face, extra fingers, missing fingers, fused fingers, too many fingers, mutated hands, poorly drawn hands, bad anatomy, extra limbs, extra heads, disfigured'

function mergeNegativeTokens(base, extra) {
  const seen = new Set()
  const out = []
  for (const raw of `${base}, ${extra}`.split(',')) {
    const tok = raw.trim()
    if (!tok) continue
    const key = tok.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tok)
  }
  return out.join(', ')
}

function ensureNegative(negative, _userText = '') {
  const configured = String(stillPrompts().negative || '').trim()
  const n = String(negative || '').trim() || configured
  return mergeNegativeTokens(n, FACE_HAND_NEGATIVE)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,(?:\s*,)+/g, ',')
    .trim()
}

function normalizeIpadapter(raw) {
  if (!raw || typeof raw !== 'object') return { enabled: false, image: '', weight: 0.28 }
  const image = String(raw.image || raw.guidePath || '').trim()
  const enabled = Boolean((raw.enabled ?? Boolean(image)) && image)
  const weight = Number(raw.weight)
  const startAt = Number(raw.start_at)
  const endAt = Number(raw.end_at)
  return {
    enabled,
    image: enabled ? image : '',
    weight: Number.isFinite(weight) ? Math.min(1.2, Math.max(0.15, weight)) : 0.28,
    weight_type: String(raw.weight_type || 'ease out'),
    start_at: Number.isFinite(startAt) ? Math.min(1, Math.max(0, startAt)) : 0,
    end_at: Number.isFinite(endAt) ? Math.min(1, Math.max(0.2, endAt)) : 0.62,
  }
}

function normalizeSize(size, hint) {
  const h = String(hint || '').toLowerCase()
  if (h.includes('phone') || h.includes('9:16') || h.includes('portrait')) {
    return { ...SIZE_PRESETS.portrait_phone }
  }
  if (h.includes('16:9') || h.includes('landscape') || h.includes('wide')) {
    return { ...SIZE_PRESETS.landscape_16x9 }
  }
  const w = Number(size?.width)
  const ht = Number(size?.height)
  if (Number.isFinite(w) && Number.isFinite(ht) && w > 0 && ht > 0) {
    let aspectRatio = '1:1'
    if (Math.abs(w / ht - 9 / 16) < 0.08) aspectRatio = '9:16'
    else if (Math.abs(w / ht - 16 / 9) < 0.08) aspectRatio = '16:9'
    // Snap common sizes
    if (w === 768 && ht === 1344) return { ...SIZE_PRESETS.portrait_phone }
    if (w === 1280 && ht === 720) return { ...SIZE_PRESETS.landscape_16x9 }
    if (w === 1024 && ht === 1024) return { ...SIZE_PRESETS.square }
    return { width: Math.round(w), height: Math.round(ht), aspectRatio }
  }
  return { ...SIZE_PRESETS.square }
}

function normalizeLoras(rawLoras) {
  const out = []
  const seen = new Set()
  const list = Array.isArray(rawLoras) ? rawLoras : []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    let name = String(item.name || '').trim().replace(/\//g, '\\')
    if (!name) continue
    // Allow basename match
    const byName = loraByName()
    const inventory = getLoraInventory()
    let inv = byName.get(name.toLowerCase())
    if (!inv) {
      const base = name.split(/[/\\]/).pop()?.toLowerCase()
      inv = inventory.find((l) => String(l.name || '').toLowerCase().endsWith(base || ''))
      if (inv) name = inv.name
    }
    if (!inv) continue
    const key = inv.name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const def = inv.default_strength
    out.push({
      name: inv.name,
      strength_model: clamp(item.strength_model ?? item.strength, 0.05, 1.0, def),
      strength_clip: clamp(item.strength_clip ?? item.strength, 0.05, 1.0, def),
      reason: item.reason ? String(item.reason).slice(0, 200) : inv.notes,
    })
    if (out.length >= STILL_LORA_CAP) break
  }
  return out
}

function normalizeControlnet(cn, userText) {
  const text = String(userText || '').toLowerCase()
  const mentionsCn =
    text.includes('controlnet') ||
    text.includes('canny') ||
    text.includes('pose guide') ||
    text.includes('edge map') ||
    text.includes('use cn')
  let enabled = Boolean(cn?.enabled)
  if (!mentionsCn && enabled && !cn?.force) {
    // Model may enable freestyle — only keep if user asked
    enabled = false
  }
  if (mentionsCn && cn?.enabled === undefined) enabled = true
  const type = enabled ? (String(cn?.type || 'canny').toLowerCase() === 'none' ? 'canny' : String(cn?.type || 'canny')) : 'none'
  return {
    enabled,
    type: enabled ? type : 'none',
    strength: enabled ? clamp(cn?.strength, 0.35, 0.75, 0.55) : 0,
  }
}

/**
 * Strip Qwen / thinking-model <think> blocks before JSON extract.
 * Handles a closed block and a dangling unclosed <think>.
 */
export function stripThinkTags(text) {
  let s = String(text || '')
  s = s.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '')
  s = s.replace(/<think\b[^>]*>[\s\S]*$/i, '')
  return s.trim()
}

/**
 * Parse model output into JSON object (strips fences if present).
 */
export function parsePlanJson(text) {
  let s = stripThinkTags(text)
  if (!s) throw new Error('empty model output')
  // strip ```json ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) s = fence[1].trim()
  // grab first {...}
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return JSON.parse(s)
}

/**
 * Validate + normalize a raw plan object.
 * @returns {{ plan: DirectorPlan, warnings: string[] }}
 */
export function validatePlan(raw, { userText = '', sizeHint = '' } = {}) {
  const warnings = []
  if (!raw || typeof raw !== 'object') {
    throw new Error('plan must be an object')
  }

  const positive = ensurePositiveTags(raw.positive, userText)
  if (positive !== String(raw.positive || '').trim()) {
    warnings.push('Sanitized positive (spaces not underscores, stripped meta tags)')
  }

  const negative = ensureNegative(raw.negative, userText)
  if (!raw.negative) warnings.push('Applied default negative')
  else if (negative !== String(raw.negative || '').trim()) {
    warnings.push('Strengthened negative quality / artifact block')
  }

  const size = normalizeSize(raw.size, sizeHint || raw.size?.aspectRatio)
  const loras = normalizeLoras(raw.loras)
  if (!Array.isArray(raw.loras) || raw.loras.length === 0) {
    warnings.push('No LoRAs in plan (qorlith.yaml whitelist is the only source)')
  }

  const controlnet = normalizeControlnet(raw.controlnet, userText)
  const ipadapter = normalizeIpadapter(raw.ipadapter)
  const sIn = raw.sampler && typeof raw.sampler === 'object' ? raw.sampler : {}
  // Quality floors: never let LLM undercook standard/hero stills
  const qualityRaw = String(raw.quality || '').toLowerCase()
  const quality =
    qualityRaw === 'draft' || qualityRaw === 'hero' || qualityRaw === 'standard'
      ? qualityRaw
      : 'standard'
  const minSteps = quality === 'draft' ? 28 : quality === 'hero' ? 36 : 34
  const minCfg = quality === 'draft' ? 5.5 : 6.0
  const ds = defaultSampler()
  let steps = clamp(sIn.steps, 15, 50, Math.max(ds.steps, minSteps))
  let cfg = clamp(sIn.cfg, 3, 12, Math.max(ds.cfg, minCfg))
  if (steps < minSteps) {
    steps = minSteps
    warnings.push(`Raised steps to ${minSteps} for ${quality} quality`)
  }
  if (cfg < minCfg) {
    cfg = minCfg
    warnings.push(`Raised CFG to ${minCfg} for ${quality} quality`)
  }
  const sampler = {
    steps,
    cfg,
    sampler_name: String(sIn.sampler_name || ds.sampler_name),
    scheduler: String(sIn.scheduler || ds.scheduler),
    seed: Number.isFinite(Number(sIn.seed)) ? Math.trunc(Number(sIn.seed)) : -1,
  }

  /** @type {DirectorPlan} */
  const plan = {
    positive,
    negative,
    size,
    loras,
    controlnet,
    ipadapter,
    sampler,
    quality,
    notes: raw.notes ? String(raw.notes).slice(0, 500) : '',
  }

  return { plan, warnings }
}

export async function lmstudioHealth(directorCfg) {
  const base = directorCfg.lmstudioBaseUrl
  const lmsPath = resolveLmsPath(directorCfg)
  let server = { running: false, port: null }
  let diskModels = []
  let lmsError = null
  try {
    server = await serverStatus(lmsPath)
  } catch (e) {
    lmsError = e instanceof Error ? e.message : String(e)
  }
  try {
    diskModels = await listDiskModels(lmsPath)
  } catch (e) {
    if (!lmsError) lmsError = e instanceof Error ? e.message : String(e)
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`${base}/models`, { signal: ctrl.signal })
    if (!r.ok) {
      return {
        ok: false,
        error: server.running
          ? `LM Studio API ${r.status}`
          : `Server off — will auto-start on Generate. ${lmsError || ''}`.trim(),
        baseUrl: base,
        models: [],
        serverRunning: server.running,
        diskModels: diskModels.map((m) => m.modelKey).filter(Boolean),
        lmsPath,
        autoManage: directorCfg.autoManageModels !== false,
      }
    }
    const data = await r.json()
    const models = Array.isArray(data?.data)
      ? data.data.map((m) => m.id || m.name).filter(Boolean)
      : []
    return {
      ok: true,
      baseUrl: base,
      models,
      loadedHint: models[0] || null,
      serverRunning: true,
      diskModels: diskModels.map((m) => m.modelKey).filter(Boolean),
      lmsPath,
      autoManage: directorCfg.autoManageModels !== false,
    }
  } catch (e) {
    return {
      ok: false,
      baseUrl: base,
      models: [],
      serverRunning: server.running,
      diskModels: diskModels.map((m) => m.modelKey).filter(Boolean),
      lmsPath,
      autoManage: directorCfg.autoManageModels !== false,
      error: server.running
        ? e instanceof Error
          ? e.message
          : String(e)
        : 'LM Studio server not running (auto-starts when you Generate)',
    }
  } finally {
    clearTimeout(t)
  }
}

/**
 * Call LM Studio chat completions and return validated plan.
 */
export async function generatePlan({ instruction, sizeHint = '', directorCfg, preferControlNet = false }) {
  const cfg = directorCfg || DEFAULT_DIRECTOR_CFG
  const userText = String(instruction || '').trim()
  if (!userText) {
    fail(400, 'missing_instruction', 'instruction required', {
      hint: 'Describe the still, then generate.',
    })
  }

  const userContent = [
    `User intent:\n${userText}`,
    sizeHint ? `Preferred size/aspect: ${sizeHint}` : null,
    preferControlNet ? 'User wants ControlNet enabled if a guide is available.' : null,
    'Return the JSON plan now.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const body = {
    model: cfg.apiModel || cfg.planIdentifier || cfg.model || cfg.planModelKey || 'local-model',
    temperature: cfg.temperature ?? 0.35,
    max_tokens: cfg.maxTokens ?? 2048,
    messages: [
      { role: 'system', content: buildSystemPrompt() },
      { role: 'user', content: userContent },
    ],
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 120000)
  let rawText = ''
  try {
    const r = await fetch(`${cfg.lmstudioBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw Object.assign(
        new Error(`LM Studio chat failed: ${r.status} ${r.statusText} ${errText.slice(0, 300)}`),
        { status: 502 },
      )
    }
    const data = await r.json()
    rawText = data?.choices?.[0]?.message?.content ?? ''
    if (!rawText && data?.choices?.[0]?.text) rawText = data.choices[0].text
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw Object.assign(new Error('LM Studio request timed out'), { status: 504 })
    }
    throw e
  } finally {
    clearTimeout(t)
  }

  let parsed
  try {
    parsed = parsePlanJson(rawText)
  } catch (e) {
    throw Object.assign(
      new Error(`Model returned non-JSON plan: ${e instanceof Error ? e.message : e}`),
      { status: 502, raw: rawText.slice(0, 2000) },
    )
  }

  const mergedUser = preferControlNet ? `${userText}\nuse controlnet` : userText
  const { plan, warnings } = validatePlan(parsed, { userText: mergedUser, sizeHint })
  logInfo('director.plan', { kind: 'still', model: cfg.model || cfg.apiModel || null })

  return {
    plan,
    warnings,
    rawModelText: rawText,
    model: cfg.model || null,
  }
}

/** Offline dry-run plan (no LLM) for tests / UI preview. */
export function dryRunPlan(instruction, sizeHint = '') {
  const userText = String(instruction || 'test still').trim()
  const raw = {
    positive: userText,
    negative: stillPrompts().negative || '',
    size: normalizeSize(null, sizeHint),
    loras: getLoraInventory().slice(0, 1).map((l) => ({
      name: l.name,
      strength_model: l.default_strength,
      strength_clip: l.default_strength,
    })),
    controlnet: { enabled: false, type: 'none', strength: 0 },
    sampler: { ...defaultSampler() },
    notes: 'Dry-run plan (no LLM).',
  }
  return validatePlan(raw, { userText, sizeHint })
}

/**
 * Full auto pipeline:
 * 1) ensure LM Studio server
 * 2) unload any loaded LLM
 * 3) load preferred plan model (planner.prefer in qorlith.yaml)
 * 4) generate + validate plan
 * 5) unload LLM (free VRAM)
 * 6) queue Comfy still + sidecar (if generate=true)
 *
 * @param {{
 *   instruction: string,
 *   sizeHint?: string,
 *   preferControlNet?: boolean,
 *   generate?: boolean,
 *   planOnly?: boolean,
 *   count?: number,
 *   quality?: string,
 *   plan?: object,
 *   skipLlm?: boolean,
 *   directorCfg?: object,
 *   comfyOutputRoot?: string,
 *   onProgress?: (ev: { stage: string, detail?: string }) => void
 * }} args
 * plan / skipLlm: regenerate from sealed brief without LLM
 */
export async function runDirectorPipeline(args) {
  const onProgress = args.onProgress || (() => {})
  const cfg = { ...DEFAULT_DIRECTOR_CFG, ...(args.directorCfg || {}) }
  const count = Math.min(12, Math.max(1, Number(args.count) || 1))
  const quality = String(args.quality || cfg.stillQuality || 'standard').toLowerCase()
  const stages = []
  const track = (ev) => {
    stages.push({ ...ev, at: new Date().toISOString() })
    onProgress(ev)
  }

  let prepared = null
  let planResult = null
  let batchResult = null

  const skipLlm = Boolean(args.skipLlm || args.plan)

  try {
    if (skipLlm) {
      track({ stage: 'use_provided_plan', detail: `regenerate · ${quality}` })
      const { plan, warnings } = validatePlan(
        { ...(args.plan || {}), quality },
        {
          userText: args.instruction || 'regenerate',
          sizeHint: args.sizeHint || '',
        },
      )
      plan.quality = quality
      planResult = { plan, warnings, model: null }
      track({ stage: 'plan_ready', detail: plan?.size?.aspectRatio || 'reuse' })
    } else {
      if (cfg.autoManageModels !== false) {
        prepared = await preparePlanModel(cfg, track)
        cfg.apiModel = prepared.apiModel
        cfg.planModelKey = prepared.modelKey
      } else {
        track({ stage: 'auto_manage_off', detail: 'using currently loaded model' })
      }

      track({ stage: 'generate_plan' })
      planResult = await generatePlan({
        instruction: args.instruction,
        sizeHint: args.sizeHint || '',
        preferControlNet: Boolean(args.preferControlNet),
        directorCfg: cfg,
      })
      // Stamp quality tier onto plan
      planResult.plan.quality = quality
      if (planResult.plan.sampler) {
        const minSteps = quality === 'draft' ? 28 : quality === 'hero' ? 36 : 34
        const minCfg = quality === 'draft' ? 5.5 : 6.0
        if ((planResult.plan.sampler.steps || 0) < minSteps) planResult.plan.sampler.steps = minSteps
        if ((planResult.plan.sampler.cfg || 0) < minCfg) planResult.plan.sampler.cfg = minCfg
      }
      track({
        stage: 'plan_ready',
        detail: `${planResult.plan?.size?.aspectRatio || ''} · ${quality}`,
      })
    }
  } finally {
    // Always try to free VRAM before Comfy, even if plan failed mid-way after load
    if (!skipLlm && cfg.autoManageModels !== false && prepared) {
      try {
        await releasePlanModel(cfg, track)
      } catch (e) {
        track({
          stage: 'unload_error',
          detail: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  if (!planResult) {
    throw Object.assign(new Error('Plan generation failed'), { status: 502, stages })
  }

  // Attach ControlNet guide (OpenPose board / upload) if provided
  if (args.guideImage || args.controlnet?.enabled) {
    const cn = {
      ...(planResult.plan.controlnet || {}),
      ...(args.controlnet || {}),
      enabled: true,
      type: args.controlnet?.type || planResult.plan.controlnet?.type || 'openpose',
      strength:
        args.controlnet?.strength ?? planResult.plan.controlnet?.strength ?? 0.55,
    }
    if (args.guideImage) cn.guidePath = args.guideImage
    planResult.plan.controlnet = cn
    const nChars = Number(args.poseCharacterCount || cn.characters || 0)
    if (nChars >= 2) {
      const p = planResult.plan.positive || ''
      if (/\bsolo\b/i.test(p)) {
        planResult.plan.positive = p.replace(/\bsolo\b/gi, 'two people').replace(/,\s*,/g, ',')
      }
      planResult.warnings = [
        ...(planResult.warnings || []),
        'Pose board: 2 characters — check the brief names both people.',
      ]
    }
    track({
      stage: 'controlnet_guide',
      detail: `${cn.type} @ ${cn.strength}${nChars ? ` · ${nChars} chars` : ''}`,
    })
  }

  const shouldGenerate = args.generate !== false && !args.planOnly
  if (shouldGenerate) {
    await assertComfyIdle(cfg.comfyBase)
    track({
      stage: 'comfy_start',
      detail: `${count > 1 ? `${count} stills` : '1 still'} · ${quality}`,
    })
    const comfy = await comfyHealth(cfg.comfyBase)
    if (!comfy.ok) {
      throw Object.assign(
        new Error(
          `Plan OK but ComfyUI offline (${cfg.comfyBase}). Start Comfy, then Queue from plan or re-run Generate.`,
        ),
        { status: 502, stages, plan: planResult.plan, warnings: planResult.warnings },
      )
    }
    batchResult = await queueStillBatch(planResult.plan, {
      count,
      quality,
      comfyBase: cfg.comfyBase,
      comfyOutputRoot: args.comfyOutputRoot,
      checkpoint: cfg.checkpoint,
      onProgress: track,
      guideImage: args.guideImage || planResult.plan.controlnet?.guidePath,
      comfyRoot: cfg.comfyRoot,
      filenamePrefix: args.filenamePrefix || undefined,
    })
    track({
      stage: 'done',
      detail: `${batchResult.count} still(s) · ${quality} · ${batchResult.generation?.imagePath || ''}`,
    })
  } else {
    track({ stage: 'done_plan_only' })
  }

  return {
    ok: true,
    plan: planResult.plan,
    warnings: planResult.warnings,
    modelKey: prepared?.modelKey || cfg.planModelKey || null,
    quality,
    generation: batchResult?.generation || null,
    generations: batchResult?.generations || (batchResult?.generation ? [batchResult.generation] : []),
    batchId: batchResult?.batchId || null,
    count: batchResult?.count || 0,
    stages,
  }
}

// ---------------------------------------------------------------------------
// Video (MiniMax H3 I2VA) — motion / dialogue / music from free text + start still
// ---------------------------------------------------------------------------

/** @typedef {{
 *   motion: string,
 *   dialogue: string,
 *   music: string,
 *   soundscape?: string,
 *   lookTrack?: string,
 *   characters?: { id: string, name: string }[],
 *   allowSinging?: boolean,
 *   durationSec: number,
 *   megapixels: number,
 *   fps: number,
 *   seed: number,
 *   negative?: string,
 *   notes?: string
 * }} DirectorVideoPlan */

const VIDEO_SING_RE = /\b(sings?|singing|chorus|lyrics?)\b/i

function inferVideoLook(text, rawLook) {
  const explicit = String(rawLook || '').toLowerCase()
  if (explicit === 'live' || explicit === 'anime') return explicit
  const t = String(text || '')
  const liveHit =
    /\b(live|found-?footage|photoreal|real_movie|camcorder|hidden\s*cam|kitchen|office|hotel|handshake|documentary)\b/i.test(
      t,
    )
  const animeHit = /\b(anime|gits|ghost in the shell|2d|cel[- ]?shad)\b/i.test(t)
  if (liveHit && !animeHit) return 'live'
  if (animeHit) return 'anime'
  return ''
}

export function buildVideoSystemPrompt() {
  const studio = loadStudio()
  const dur = Number(studio.video.duration_sec) || 12
  return `You are Qorlith Video Director for MiniMax H3 image-to-video-audio.
Convert free-form intent into a STRICT JSON plan. The start still IS frame 0. The app wraps I2VA + style + identity lock. You write only what CHANGES.

RULES:
1. Output ONLY one JSON object. No markdown fences.
2. Adult characters only. Never minors.
3. motion is camera + body action only. Do not rename models or LoRAs. Do not write [Shot 1].
4. Camera as prose: push in / pull out / pan / truck / tilt / tracking / static / shake slightly, plus optional "with small amplitude" / "at slow speed".
5. dialogue is spoken lines with H3 markup, or empty:
   the adult with a dry mid voice (S1) says: <d>[English] Copy.</d>
   Inside <d>: [English] or [Japanese] then the exact words. No quotes.
   If the user did not ask for speech, dialogue is empty.
6. soundscape is 1–4 diegetic sentences (rain, footsteps, gunfire, breath). Never dialogue or score. N/A if truly silent.
7. music is non_diegetic_music: named instruments + tempo + dynamics, or "N/A". Never only "soft" / "loud" / "epic".
8. lookTrack is "anime" or "live". Honor the user. Kitchen / office / hotel / found-footage / photoreal → live.
9. Silent / no dialogue means no speech. Keep music if the user named instruments or a score.
10. durationSec should be ${dur} unless the user asks otherwise (keep 6–15; continue takes ≥10).
11. If this take continues the previous last frame: hold that pose ~2 s (breath / weight shift, no speech), then the action, then settle ~2 s. Do not start or end on a spoken line.
12. megapixels default 0.6.

JSON SCHEMA:
{
  "motion": "camera + body action only",
  "dialogue": "H3 spoken line or empty",
  "soundscape": "diegetic sentences or N/A",
  "music": "instruments + tempo + dynamics, or N/A",
  "lookTrack": "anime" | "live",
  "durationSec": ${dur},
  "megapixels": 0.6,
  "continueFromPrior": false,
  "notes": "string"
}`
}

export function validateVideoPlan(raw, { userText = '' } = {}) {
  const warnings = []
  if (!raw || typeof raw !== 'object') throw new Error('video plan must be an object')
  const studio = loadStudio()
  const vp = videoPrompts()
  let motion = String(raw.motion || raw.positive || userText || 'subtle idle motion').trim()
  const dialogue = String(raw.dialogue || '').trim()
  const music = String(raw.music || raw.non_diegetic_music || vp.music_default || 'N/A').trim() || 'N/A'
  const soundscape = String(raw.soundscape || raw.overall_soundscape || '').trim()
  const lookTrack = inferVideoLook(userText, raw.lookTrack || raw.look)
  const characters = Array.isArray(raw.characters)
    ? raw.characters
        .slice(0, 8)
        .map((c, i) => ({
          id: String(c?.id || `S${i + 1}`).slice(0, 16),
          name: String(c?.name || '').slice(0, 64),
        }))
        .filter((c) => c.name)
    : []
  const allowSinging =
    Boolean(raw.allowSinging || raw.singing) || VIDEO_SING_RE.test(`${motion} ${dialogue} ${userText}`)
  const bounds = clipDurationBounds()
  let durationSec = Number(raw.durationSec ?? raw.duration_sec ?? bounds.fallback)
  const continueFromPrior = Boolean(raw.continueFromPrior)
  if (!Number.isFinite(durationSec) || durationSec < 4) durationSec = bounds.fallback
  if (durationSec > bounds.max) {
    warnings.push(`durationSec capped at ${bounds.max}`)
    durationSec = bounds.max
  }
  const continueMin = Number(bounds.continueMin) > 0 ? Number(bounds.continueMin) : 10
  if (continueFromPrior && durationSec < continueMin) {
    warnings.push(`continue take raised to ${continueMin}s`)
    durationSec = Math.min(continueMin, bounds.max)
  }
  let megapixels = Number(raw.megapixels ?? studio.video.megapixels ?? 0.6)
  if (!Number.isFinite(megapixels) || megapixels <= 0) megapixels = 0.6
  const plan = {
    motion,
    dialogue,
    music,
    soundscape,
    lookTrack,
    characters,
    allowSinging,
    continueFromPrior,
    durationSec,
    megapixels,
    fps: 24,
    seed: Number.isFinite(Number(raw.seed)) ? Math.trunc(Number(raw.seed)) : -1,
    notes: raw.notes ? String(raw.notes).slice(0, 500) : '',
    negative: String(raw.negative || vp.negative || '').trim(),
  }
  return { plan, warnings }
}

export function dryRunVideoPlan(instruction = 'subtle idle motion') {
  const motion = String(instruction || 'subtle idle motion').trim()
  return validateVideoPlan(
    { motion, dialogue: '', music: 'N/A', notes: 'Dry-run MiniMax H3 plan (no LLM).' },
    { userText: motion },
  )
}

export async function generateVideoPlan({ instruction, directorCfg }) {
  const cfg = directorCfg || DEFAULT_DIRECTOR_CFG
  const userText = String(instruction || '').trim()
  if (!userText) {
    fail(400, 'missing_instruction', 'instruction required', {
      hint: 'Describe the motion, then generate.',
    })
  }

  const body = {
    model: cfg.apiModel || cfg.planIdentifier || cfg.model || cfg.planModelKey || 'local-model',
    temperature: cfg.temperature ?? 0.35,
    max_tokens: cfg.maxTokens ?? 2048,
    messages: [
      { role: 'system', content: buildVideoSystemPrompt() },
      {
        role: 'user',
        content: `Motion intent for I2VA (start image already set). Do not write [Shot 1].\n${userText}\n\nReturn the JSON video plan now.`,
      },
    ],
  }

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 180000)
  let rawText = ''
  try {
    const r = await fetch(`${cfg.lmstudioBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw Object.assign(
        new Error(`LM Studio chat failed: ${r.status} ${r.statusText} ${errText.slice(0, 300)}`),
        { status: 502 },
      )
    }
    const data = await r.json()
    rawText = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? ''
  } catch (e) {
    if (e?.name === 'AbortError') {
      throw Object.assign(new Error('LM Studio request timed out'), { status: 504 })
    }
    throw e
  } finally {
    clearTimeout(t)
  }

  let parsed
  try {
    parsed = parsePlanJson(rawText)
  } catch (e) {
    throw Object.assign(
      new Error(`Model returned non-JSON video plan: ${e instanceof Error ? e.message : e}`),
      { status: 502, raw: rawText.slice(0, 2000) },
    )
  }

  const { plan, warnings } = validateVideoPlan(parsed, { userText })
  logInfo('director.plan', { kind: 'video', model: cfg.model || cfg.apiModel || null })
  return { plan, warnings, rawModelText: rawText, model: cfg.model || null }
}

/**
 * Full video pipeline: load LLM → motion plan → unload → MiniMax H3 from source still.
 */
export async function runVideoPipeline(args) {
  const onProgress = args.onProgress || (() => {})
  const cfg = { ...DEFAULT_DIRECTOR_CFG, ...(args.directorCfg || {}) }
  const stages = []
  const track = (ev) => {
    stages.push({ ...ev, at: new Date().toISOString() })
    onProgress(ev)
  }

  const sourceImage = String(args.sourceImage || '').trim()
  if (!sourceImage) {
    fail(400, 'missing_source', 'sourceImage required (path to start still)', {
      hint: 'Generate a still first, or paste a start-still path.',
    })
  }

  let prepared = null
  let planResult = null
  let genResult = null

  try {
    if (args.plan && typeof args.plan === 'object') {
      track({ stage: 'use_provided_plan' })
      planResult = validateVideoPlan(args.plan, { userText: args.instruction || '' })
      planResult = { plan: planResult.plan, warnings: planResult.warnings, model: null }
    } else if (args.dryRun) {
      track({ stage: 'dry_run_video_plan' })
      const d = dryRunVideoPlan(args.instruction || 'subtle motion')
      planResult = { plan: d.plan, warnings: d.warnings, model: null }
    } else {
      if (cfg.autoManageModels !== false) {
        prepared = await preparePlanModel(cfg, track)
        cfg.apiModel = prepared.apiModel
        cfg.planModelKey = prepared.modelKey
      }
      track({ stage: 'generate_video_plan' })
      planResult = await generateVideoPlan({
        instruction: args.instruction,
        directorCfg: cfg,
      })
      track({ stage: 'plan_ready', detail: `${planResult.plan.durationSec}s` })
    }
  } finally {
    if (cfg.autoManageModels !== false && prepared) {
      try {
        await releasePlanModel(cfg, track)
      } catch (e) {
        track({ stage: 'unload_error', detail: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  if (!planResult?.plan) {
    throw Object.assign(new Error('Video plan failed'), { status: 502, stages })
  }

  const shouldGenerate = args.generate !== false && !args.planOnly && !args.dryRun
  if (shouldGenerate) {
    await assertComfyIdle(cfg.comfyBase)
    track({ stage: 'comfy_video_start' })
    genResult = await queueVideoAndWait({
      sourceImage,
      motion: planResult.plan.motion,
      dialogue: planResult.plan.dialogue,
      music: planResult.plan.music,
      soundscape: planResult.plan.soundscape,
      lookTrack: planResult.plan.lookTrack || args.lookTrack,
      characters: planResult.plan.characters,
      allowSinging: planResult.plan.allowSinging,
      instruction: args.instruction,
      durationSec: planResult.plan.durationSec,
      megapixels: planResult.plan.megapixels,
      seed: planResult.plan.seed,
      continueFromPrior: Boolean(args.continueFromPrior || planResult.plan.continueFromPrior),
      comfyBase: cfg.comfyBase,
      comfyRoot: cfg.comfyRoot,
      comfyOutputRoot: args.comfyOutputRoot,
      filenamePrefix: args.filenamePrefix || `qorlith/video/dir_${Date.now().toString(36)}`,
      keepModels: Boolean(args.keepModels),
      onProgress: track,
    })
    track({ stage: 'done', detail: genResult.videoPath })
  } else {
    track({ stage: 'done_plan_only' })
  }

  return {
    ok: true,
    kind: 'video',
    plan: planResult.plan,
    warnings: planResult.warnings || [],
    modelKey: prepared?.modelKey || cfg.planModelKey || null,
    generation: genResult,
    stages,
  }
}

