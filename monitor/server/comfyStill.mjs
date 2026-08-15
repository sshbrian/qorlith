/**
 * Queue stills and polish. Graph builders live in stillGraph.mjs.
 */
import fs from 'fs'
import path from 'path'
import { saveWorkflowSnapshot } from './comfyWorkflow.mjs'
import { getComfyUrl, loadStudio, requireCheckpoint, requireComfyOutput, requireComfyRoot } from './studioConfig.mjs'
import { fail } from './errors.mjs'
import { comfyApi, comfyHealth, waitForHistory } from './comfyClient.mjs'
import { COMFY_CLIENT_ID, rememberPromptGraph } from './comfyProgress.mjs'
import { info as logInfo } from './log.mjs'
import { buildPolishGraph, buildStillGraph } from './stillGraph.mjs'

export { comfyHealth }
export {
  QUALITY_PRESETS,
  applyControlNetToGraph,
  applyQualityLoras,
  buildPolishGraph,
  buildStillGraph,
  controlNetModelForType,
  resolveDetailerConfig,
  resolveIpadapterConfig,
  resolveQuality,
  stageGuideImage,
} from './stillGraph.mjs'

function clipSkip() {
  const n = Number(loadStudio().stills?.clip_skip)
  return Number.isFinite(n) ? n : -2
}

function pickOutputImage(historyEntry, preferHires = true) {
  const images = []
  for (const nodeOut of Object.values(historyEntry.outputs || {})) {
    if (Array.isArray(nodeOut?.images)) {
      for (const im of nodeOut.images) images.push(im)
    }
  }
  if (!images.length) return null
  if (preferHires) {
    const hi = images.find((im) => /hires/i.test(im.filename || ''))
    if (hi) return hi
  }
  return images[images.length - 1]
}

export async function queueStillAndWait(plan, opts = {}) {
  const comfyBase = opts.comfyBase || getComfyUrl()
  const comfyRoot = opts.comfyRoot || requireComfyRoot()
  requireCheckpoint()
  const onProgress = opts.onProgress || (() => {})
  const waitMs = opts.waitMs ?? 600_000
  const pollMs = opts.pollMs ?? 2000
  const quality = opts.quality || plan.quality || 'standard'

  onProgress({ stage: 'comfy_health', detail: `quality=${quality}` })
  const health = await comfyHealth(comfyBase)
  if (!health.ok) {
    throw Object.assign(
      new Error(`ComfyUI not reachable at ${comfyBase}: ${health.error}`),
      { status: 502 },
    )
  }

  // Merge guide into plan.controlnet for graph builder
  const planForGraph = { ...plan }
  if (opts.guideImage || opts.guideImagePath) {
    const cn = { ...(plan.controlnet || {}), enabled: true }
    if (!cn.type || cn.type === 'none') cn.type = 'openpose'
    if (cn.strength == null) cn.strength = 0.55
    cn.guidePath = opts.guideImagePath || opts.guideImage || cn.guidePath
    planForGraph.controlnet = cn
  }

  const built = buildStillGraph(planForGraph, {
    checkpoint: opts.checkpoint,
    filenamePrefix: opts.filenamePrefix,
    quality,
    guideImage: opts.guideImage || opts.guideImagePath || planForGraph.controlnet?.guidePath,
    comfyRoot,
  })
  onProgress({
    stage: 'comfy_queue',
    detail: `${built.prefix} · ${built.quality.id} · steps=${built.steps} cfg=${built.cfg}${
      built.controlnet ? ` · CN ${built.controlnet.type}` : ''
    }`,
  })

  const queued = await comfyApi(comfyBase, 'POST', '/prompt', {
    prompt: built.graph,
    client_id: COMFY_CLIENT_ID,
  })
  const promptId = queued.prompt_id
  if (!promptId) {
    fail(502, 'comfy_queue', 'Comfy queue returned no prompt_id', {
      hint: 'Check the Comfy console for a rejected graph.',
    })
  }
  rememberPromptGraph(promptId, built.graph)
  logInfo('comfy.queue', { promptId, kind: 'still', quality })
  const historyEntry = await waitForHistory(comfyBase, promptId, { waitMs, pollMs, onProgress })

  const imageMeta = pickOutputImage(historyEntry, built.quality.useHires)
  if (!imageMeta?.filename) {
    fail(502, 'comfy_no_image', 'Comfy finished but no image in outputs', {
      hint: 'Open the Comfy queue — the graph may have saved nothing.',
    })
  }

  const subfolder = imageMeta.subfolder || ''
  const filename = imageMeta.filename
  const rel = [subfolder, filename].filter(Boolean).join('/').replace(/\\/g, '/')
  const outRoot = opts.comfyOutputRoot || requireComfyOutput()
  const abs = path.join(outRoot, subfolder, filename)

  onProgress({ stage: 'save_workflow', detail: abs })
  let wf = null
  try {
    wf = saveWorkflowSnapshot({
      prompt: built.graph,
      mediaPath: abs,
      outputRoot: outRoot,
      comfyRoot,
      promptId,
      seed: built.seed,
      kind: 'image',
      extra: {
        checkpoint: built.checkpoint,
        loras: built.loras,
        size: built.size,
        prefix: built.prefix,
        quality: built.quality.id,
        steps: built.steps,
        cfg: built.cfg,
        hires: built.quality.useHires,
        refiner: built.quality.useRefiner,
        detailer: built.detailer || null,
        ipadapter: built.ipadapter || null,
      },
    })
  } catch (e) {
    onProgress({
      stage: 'save_workflow',
      detail: `failed: ${e instanceof Error ? e.message : e}`,
    })
  }

  onProgress({ stage: 'sidecar', detail: abs })
  const sidecar = {
    schema: 'qorlith.gen.v1',
    kind: 'image',
    generatedAt: new Date().toISOString(),
    promptId,
    image: rel,
    imagePath: abs,
    engine: 'ComfyUI',
    workflow: `qorlith/director still · ${built.quality.id}`,
    quality: built.quality.id,
    checkpoint: built.checkpoint,
    lora: built.loras[0]
      ? {
          name: built.loras[0].name,
          strength_model: built.loras[0].strength_model,
          strength_clip: built.loras[0].strength_clip,
          trigger: 'style',
        }
      : null,
    loras: built.loras,
    clip_skip: clipSkip(),
    size: built.size,
    resolution: `${built.size.width}x${built.size.height}`,
    aspectRatio: built.enrichedPlan.size?.aspectRatio || plan.size?.aspectRatio || null,
    sampler: {
      name: built.enrichedPlan.sampler?.sampler_name || 'euler_ancestral',
      scheduler: built.enrichedPlan.sampler?.scheduler || 'normal',
      steps: built.steps,
      cfg: built.cfg,
      seed: built.seed,
      denoise: 1.0,
      refiner: built.quality.useRefiner,
      hires: built.quality.useHires,
      polishSteps: built.quality.useHires ? built.quality.polishSteps : null,
      polishDenoise: built.quality.useHires ? built.quality.polishDenoise : null,
    },
    prompt: built.enrichedPlan.positive,
    negative: built.enrichedPlan.negative,
    controlnet: built.controlnet || plan.controlnet || null,
    detailer: built.detailer || null,
    ipadapter: built.ipadapter || plan.ipadapter || null,
    notes: plan.notes || null,
    tags: ['style', 'director', 'sdxl', built.quality.id],
    related: [],
    sourceImage: null,
    derivedFrom: null,
    parentPath: null,
    batchId: opts.batchId || null,
    stackId: opts.stackId || opts.batchId || null,
    batchIndex: opts.batchIndex != null ? opts.batchIndex : null,
    director: true,
    workflowPath: wf?.workflowPath || null,
    workflowRel: wf?.workflowRel || null,
    workflowApiPath: wf?.workflowApiPath || wf?.bareApiPath || null,
    comfyWorkflowPath: wf?.comfyWorkflowPath || null,
    comfyWorkflowName: wf?.comfyWorkflowName || null,
  }
  if (opts.batchId != null || opts.batchIndex != null) {
    sidecar.tags = [
      ...new Set(
        [
          ...(sidecar.tags || []),
          'batch',
          opts.batchIndex != null ? `batch_${opts.batchIndex}` : null,
        ].filter(Boolean),
      ),
    ]
  }

  try {
    const jsonPath = abs.replace(/\.[^.]+$/, '') + '.json'
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), 'utf8')
    sidecar.metaPath = jsonPath
  } catch (e) {
    sidecar.sidecarError = e instanceof Error ? e.message : String(e)
  }

  onProgress({ stage: 'comfy_done', detail: abs })
  return {
    promptId,
    seed: built.seed,
    imagePath: abs,
    imageRel: rel,
    filename,
    subfolder,
    sidecar,
    quality: built.quality.id,
    workflowPath: wf?.workflowPath || null,
    workflowApiPath: wf?.workflowApiPath || null,
    comfyWorkflowPath: wf?.comfyWorkflowPath || null,
    comfyWorkflowName: wf?.comfyWorkflowName || null,
    device: health.device,
  }
}

/**
 * Polish an existing PNG with yaml upscale + denoise (uses plan for conditioning).
 */
export async function polishStillAndWait(opts = {}) {
  const {
    sourceImage,
    plan,
    quality = 'standard',
    comfyBase = getComfyUrl(),
    comfyRoot = requireComfyRoot(),
    comfyOutputRoot,
    checkpoint,
    filenamePrefix,
    onProgress = () => {},
    waitMs = 600_000,
    pollMs = 2000,
  } = opts

  if (!sourceImage) {
    fail(400, 'missing_source', 'sourceImage required', {
      hint: 'Select a still, then polish.',
    })
  }
  if (!plan) {
    fail(400, 'missing_plan', 'plan required for polish conditioning', {
      hint: 'Generate or plan a still brief first.',
    })
  }

  onProgress({ stage: 'comfy_health', detail: 'polish' })
  const health = await comfyHealth(comfyBase)
  if (!health.ok) {
    fail(502, 'comfy_offline', `ComfyUI offline: ${health.error}`, {
      hint: 'Start ComfyUI on the URL in qorlith.yaml, then retry.',
    })
  }

  // Stage source into Comfy input
  const src = path.resolve(sourceImage)
  if (!fs.existsSync(src)) {
    fail(400, 'missing_source_still', `source not found: ${src}`, {
      hint: 'Select a still that still exists on disk.',
    })
  }
  const inputDir = path.join(comfyRoot, 'input')
  fs.mkdirSync(inputDir, { recursive: true })
  const ext = path.extname(src) || '.png'
  const inputName = `director_polish_${Date.now().toString(36)}${ext}`
  fs.copyFileSync(src, path.join(inputDir, inputName))

  const built = buildPolishGraph(plan, {
    inputImageName: inputName,
    checkpoint,
    filenamePrefix:
      filenamePrefix ||
      `qorlith/stills/director/polish_${Date.now().toString(36)}`,
    quality,
  })

  onProgress({ stage: 'comfy_queue', detail: `polish ${built.prefix}` })
  const queued = await comfyApi(comfyBase, 'POST', '/prompt', {
    prompt: built.graph,
    client_id: COMFY_CLIENT_ID,
  })
  const promptId = queued.prompt_id
  if (!promptId) {
    fail(502, 'comfy_queue', 'Comfy queue returned no prompt_id', {
      hint: 'Check the Comfy console for a rejected graph.',
    })
  }
  rememberPromptGraph(promptId, built.graph)
  logInfo('comfy.queue', { promptId, kind: 'polish', quality })
  const historyEntry = await waitForHistory(comfyBase, promptId, { waitMs, pollMs, onProgress })

  const imageMeta = pickOutputImage(historyEntry, true)
  if (!imageMeta?.filename) {
    fail(502, 'comfy_no_image', 'polish produced no image', {
      hint: 'Check stills.upscale in qorlith.yaml and the Comfy queue.',
    })
  }
  const outRoot = comfyOutputRoot || requireComfyOutput()
  const abs = path.join(outRoot, imageMeta.subfolder || '', imageMeta.filename)
  const rel = [imageMeta.subfolder, imageMeta.filename].filter(Boolean).join('/').replace(/\\/g, '/')

  let wf = null
  try {
    wf = saveWorkflowSnapshot({
      prompt: built.graph,
      mediaPath: abs,
      outputRoot: outRoot,
      comfyRoot,
      promptId,
      seed: built.seed,
      kind: 'image',
      extra: { polish: true, quality, sourceImage: src },
    })
  } catch {
    /* ignore */
  }

  const sidecar = {
    schema: 'qorlith.gen.v1',
    kind: 'image',
    generatedAt: new Date().toISOString(),
    promptId,
    image: rel,
    imagePath: abs,
    engine: 'ComfyUI',
    workflow: 'qorlith/director still polish',
    quality: `polish-${quality}`,
    checkpoint: built.checkpoint,
    loras: built.enrichedPlan.loras,
    prompt: built.enrichedPlan.positive,
    negative: built.enrichedPlan.negative,
    sampler: {
      name: 'euler_ancestral',
      steps: built.quality.polishSteps,
      cfg: built.quality.polishCfg,
      denoise: built.quality.polishDenoise,
      seed: built.seed,
      polish: true,
    },
    sourceImage: src,
    derivedFrom: src,
    parentPath: src,
    related: [{ path: src, role: 'polish_source' }],
    tags: ['style', 'director', 'polish', quality],
    director: true,
    workflowPath: wf?.workflowPath || null,
    workflowApiPath: wf?.workflowApiPath || null,
    comfyWorkflowName: wf?.comfyWorkflowName || null,
  }
  try {
    const jsonPath = abs.replace(/\.[^.]+$/, '') + '.json'
    fs.writeFileSync(jsonPath, JSON.stringify(sidecar, null, 2), 'utf8')
    sidecar.metaPath = jsonPath
    // link reverse on source
    const srcJson = src.replace(/\.[^.]+$/, '') + '.json'
    if (fs.existsSync(srcJson)) {
      const sm = JSON.parse(fs.readFileSync(srcJson, 'utf8'))
      const rels = Array.isArray(sm.related) ? sm.related : []
      rels.unshift({ path: abs, role: 'polish' })
      sm.related = rels
      fs.writeFileSync(srcJson, JSON.stringify(sm, null, 2), 'utf8')
    }
  } catch {
    /* ignore */
  }

  onProgress({ stage: 'comfy_done', detail: abs })
  return {
    promptId,
    seed: built.seed,
    imagePath: abs,
    imageRel: rel,
    filename: imageMeta.filename,
    sidecar,
    quality: `polish-${quality}`,
    workflowPath: wf?.workflowPath || null,
    comfyWorkflowName: wf?.comfyWorkflowName || null,
    device: health.device,
  }
}

export async function queueStillBatch(plan, opts = {}) {
  const count = Math.min(12, Math.max(1, Number(opts.count) || 1))
  const batchId = opts.batchId || `dir_batch_${Date.now().toString(36)}`
  const quality = opts.quality || plan.quality || 'standard'
  const basePrefix =
    opts.filenamePrefix || `qorlith/stills/director/batch_${batchId}`
  const generations = []
  const onProgress = opts.onProgress || (() => {})

  for (let i = 0; i < count; i++) {
    onProgress({ stage: 'comfy_batch_item', detail: `${i + 1}/${count} · ${quality}` })
    const seed = Math.floor(Math.random() * 2_147_483_647)
    const planI = {
      ...plan,
      quality,
      sampler: {
        ...(plan.sampler || {}),
        seed,
      },
    }
    const gen = await queueStillAndWait(planI, {
      comfyBase: opts.comfyBase,
      comfyOutputRoot: opts.comfyOutputRoot,
      checkpoint: opts.checkpoint,
      filenamePrefix: `${basePrefix}/v${String(i + 1).padStart(2, '0')}`,
      batchId,
      stackId: batchId,
      batchIndex: i + 1,
      quality,
      waitMs: opts.waitMs,
      pollMs: opts.pollMs,
      onProgress,
      guideImage: opts.guideImage || opts.guideImagePath,
      comfyRoot: opts.comfyRoot,
    })
    generations.push(gen)
  }

  for (const gen of generations) {
    try {
      const metaPath = gen.sidecar?.metaPath || gen.imagePath.replace(/\.[^.]+$/, '') + '.json'
      if (!fs.existsSync(metaPath)) continue
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      meta.batchId = batchId
      meta.stackId = batchId
      meta.related = generations
        .filter((g) => g.imagePath !== gen.imagePath)
        .map((g) => ({ path: g.imagePath, role: 'batch_sibling' }))
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8')
      gen.sidecar = meta
    } catch {
      /* ignore */
    }
  }

  return {
    batchId,
    count: generations.length,
    quality,
    generations,
    generation: generations[0] || null,
  }
}
