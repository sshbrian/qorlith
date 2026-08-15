/**
 * Pure-ish still graph builders. No Comfy HTTP.
 */
import fs from 'fs'
import path from 'path'
import {
  loadStudio,
  getCheckpoint,
  requireComfyRoot,
} from './studioConfig.mjs'
import { fail } from './errors.mjs'

function stillCfg() {
  return loadStudio().stills
}

function clipSkip() {
  const n = Number(stillCfg().clip_skip)
  return Number.isFinite(n) ? n : -2
}

function upscaleModel() {
  return String(stillCfg().upscale || '').trim()
}

export function resolveDetailerConfig(opts = {}, plan = {}) {
  const y = stillCfg().detailer || {}
  const o = opts.detailer || plan.detailer || {}
  const enabled = o.enabled != null ? Boolean(o.enabled) : Boolean(y.enabled)
  return {
    enabled,
    face: String(o.face ?? y.face ?? '').trim(),
    hand: String(o.hand ?? y.hand ?? '').trim(),
    denoise: Number(o.denoise ?? y.denoise ?? 0.32) || 0.32,
    handDenoise: Number(o.hand_denoise ?? y.hand_denoise ?? 0.38) || 0.38,
    guideSize: Number(o.guide_size ?? y.guide_size ?? 512) || 512,
    steps: Number(o.steps ?? y.steps ?? 16) || 16,
    wildcard: String(o.wildcard ?? y.wildcard ?? 'detailed face, detailed eyes, sharp pupils, adult'),
    handWildcard: String(
      o.hand_wildcard ?? y.hand_wildcard ?? 'detailed hands, five fingers, correct anatomy',
    ),
  }
}

export function resolveIpadapterConfig(opts = {}, plan = {}) {
  const y = stillCfg().ipadapter || {}
  const p = plan.ipadapter || {}
  const o = opts.ipadapter || {}
  const image = String(o.image || p.image || opts.ipadapterImage || '').trim()
  const yamlOn = o.enabled != null ? Boolean(o.enabled) : p.enabled != null ? Boolean(p.enabled) : Boolean(y.enabled)
  const model = String(o.model ?? y.model ?? '').trim()
  const clipVision = String(o.clip_vision ?? o.clipVision ?? y.clip_vision ?? '').trim()
  const weight = Number(o.weight ?? p.weight ?? y.weight ?? 0.72)
  return {
    enabled: Boolean(yamlOn && image && model && clipVision),
    image,
    model,
    clipVision,
    weight: Number.isFinite(weight) ? Math.min(1.2, Math.max(0.15, weight)) : 0.5,
    weightType: String(o.weight_type ?? p.weight_type ?? y.weight_type ?? 'linear'),
  }
}

function faceDetailerNode({
  imageRef,
  modelRef,
  clipRef,
  vaeRef,
  posRef,
  negRef,
  bboxRef,
  seed,
  steps,
  cfg,
  samplerName,
  scheduler,
  denoise,
  guideSize,
  wildcard,
  bboxThreshold = 0.45,
}) {
  return {
    class_type: 'FaceDetailer',
    inputs: {
      image: imageRef,
      model: modelRef,
      clip: clipRef,
      vae: vaeRef,
      guide_size: guideSize,
      guide_size_for: true,
      max_size: 768,
      seed,
      steps,
      cfg,
      sampler_name: samplerName,
      scheduler,
      positive: posRef,
      negative: negRef,
      denoise,
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: bboxThreshold,
      bbox_dilation: 8,
      bbox_crop_factor: 1.6,
      sam_detection_hint: 'center-1',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      bbox_detector: bboxRef,
      wildcard,
      cycle: 1,
    },
  }
}

/** @typedef {'draft'|'standard'|'hero'} QualityTier */

export const QUALITY_PRESETS = {
  draft: {
    id: 'draft',
    steps: 28,
    cfg: 5.5,
    styleStrength: 0.75,
    lightStrength: 0,
    useLighting: false,
    useRefiner: false,
    useHires: false,
    totalSteps: 28,
    switchStep: 28,
    polishSteps: 0,
    polishCfg: 5.5,
    polishDenoise: 0.32,
    hiresScaleFrom4x: 0.375,
  },
  standard: {
    id: 'standard',
    steps: 34,
    cfg: 6.0,
    styleStrength: 0.68,
    lightStrength: 0.55,
    useLighting: true,
    useRefiner: false,
    useHires: true,
    totalSteps: 34,
    switchStep: 34,
    polishSteps: 20,
    polishCfg: 5.5,
    polishDenoise: 0.32,
    hiresScaleFrom4x: 0.375,
  },
  hero: {
    id: 'hero',
    steps: 36,
    cfg: 6.0,
    styleStrength: 0.65,
    lightStrength: 0.55,
    useLighting: true,
    useRefiner: true,
    useHires: true,
    totalSteps: 36,
    switchStep: 29,
    polishSteps: 20,
    polishCfg: 5.5,
    polishDenoise: 0.32,
    hiresScaleFrom4x: 0.375,
  },
}

export function resolveQuality(q) {
  const key = String(q || 'standard').toLowerCase()
  return QUALITY_PRESETS[key] || QUALITY_PRESETS.standard
}

/**
 * Keep the user's yaml/plan LoRAs. Do not invent filenames.
 */
export function applyQualityLoras(plan, quality) {
  const q = resolveQuality(quality)
  const list = Array.isArray(plan.loras) ? [...plan.loras] : []
  const capped = list.filter((l) => l && l.name).slice(0, 8)
  const positive = String(plan.positive || '')

  const yamlSampler = stillCfg().sampler || {}
  const sampler = {
    ...(plan.sampler || {}),
    steps: Math.max(Number(plan.sampler?.steps) || 0, q.steps),
    cfg: Math.max(Number(plan.sampler?.cfg) || 0, q.cfg),
    sampler_name: plan.sampler?.sampler_name || yamlSampler.name || 'euler_ancestral',
    scheduler: plan.sampler?.scheduler || yamlSampler.scheduler || 'normal',
    seed: plan.sampler?.seed ?? -1,
  }

  return {
    ...plan,
    positive,
    loras: capped,
    sampler,
    quality: q.id,
  }
}
function chainLoras(graph, startModel, startClip, loras, idStart = 10) {
  let modelRef = startModel
  let clipRef = startClip
  let id = idStart
  for (const lora of loras) {
    const nid = String(id)
    graph[nid] = {
      class_type: 'LoraLoader',
      inputs: {
        model: modelRef,
        clip: clipRef,
        lora_name: lora.name,
        strength_model: lora.strength_model ?? 0.7,
        strength_clip: lora.strength_clip ?? 0.7,
      },
    }
    modelRef = [nid, 0]
    clipRef = [nid, 1]
    id += 2
  }
  return { modelRef, clipRef, nextId: id }
}

/**
 * Resolve ControlNet model filename for plan type.
 */
export function controlNetModelForType(type) {
  const cn = stillCfg().controlnet || {}
  const t = String(type || 'openpose').toLowerCase()
  if (t === 'canny' || t === 'edges') return String(cn.canny || '').trim()
  return String(cn.openpose || '').trim()
}

/**
 * Copy/stage a guide PNG into ComfyUI input/. Returns basename for LoadImage.
 * Accepts absolute path, already-in-input basename, or data URL (base64 png).
 */
export function stageGuideImage(guide, opts = {}) {
  const comfyRoot = opts.comfyRoot || requireComfyRoot()
  const inputDir = path.join(comfyRoot, 'input')
  fs.mkdirSync(inputDir, { recursive: true })

  if (!guide) return null

  // data:image/png;base64,...
  if (typeof guide === 'string' && guide.startsWith('data:')) {
    const m = guide.match(/^data:image\/\w+;base64,(.+)$/i)
    if (!m) {
      fail(400, 'bad_guide', 'Invalid guide data URL', {
        hint: 'Apply the pose board again so it exports a PNG.',
      })
    }
    const name = `qorlith_pose_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}.png`
    const dest = path.join(inputDir, name)
    fs.writeFileSync(dest, Buffer.from(m[1], 'base64'))
    return { filename: name, absPath: dest }
  }

  const raw = String(guide).trim()
  if (!raw) return null

  // Already a basename in input
  const asInput = path.join(inputDir, path.basename(raw))
  if (!path.isAbsolute(raw) && fs.existsSync(asInput)) {
    return { filename: path.basename(raw), absPath: asInput }
  }

  if (!fs.existsSync(raw)) {
    fail(400, 'missing_guide', `Guide image not found: ${raw}`, {
      hint: 'Apply the pose board again, or paste a still path that exists.',
    })
  }

  const name = `qorlith_pose_${Date.now().toString(36)}_${path.basename(raw)}`.replace(
    /[^a-zA-Z0-9._-]/g,
    '_',
  )
  const dest = path.join(inputDir, name)
  fs.copyFileSync(raw, dest)
  return { filename: name, absPath: dest }
}

/**
 * Inject LoadImage + ControlNetLoader + ControlNetApplyAdvanced.
 * Rewires positive/negative conditioning.
 * @returns {{ positiveRef, negativeRef, controlnet } | null}
 */
export function applyControlNetToGraph(graph, plan, opts = {}, size = {}) {
  const cn = plan?.controlnet
  if (!cn?.enabled) return null

  const guideSrc =
    opts.guideImage ||
    opts.guideImagePath ||
    cn.guidePath ||
    cn.guideImage ||
    null
  if (!guideSrc) return null

  let staged
  try {
    staged = stageGuideImage(guideSrc, { comfyRoot: opts.comfyRoot || requireComfyRoot() })
  } catch (e) {
    // If staging fails hard, skip CN rather than killing gen? Prefer fail loud.
    throw e
  }
  if (!staged?.filename) return null

  const type = String(cn.type || 'openpose').toLowerCase()
  const modelName = String(cn.model || controlNetModelForType(type) || '').trim()
  if (!modelName) {
    fail(400, 'missing_controlnet', 'Set stills.controlnet.openpose or stills.controlnet.canny in qorlith.yaml', {
      hint: 'Name the ControlNet files in qorlith.yaml, then retry.',
    })
  }
  const strength = Math.min(1, Math.max(0.1, Number(cn.strength) || 0.55))
  const startPercent = Math.min(1, Math.max(0, Number(cn.startPercent ?? cn.start ?? 0) || 0))
  const endPercent = Math.min(1, Math.max(0, Number(cn.endPercent ?? cn.end ?? 0.85) || 0.85))

  // Optional: scale guide to latent size if ImageScale exists — LoadImage is enough for CN
  graph['40'] = {
    class_type: 'LoadImage',
    inputs: { image: staged.filename },
  }
  // Match gen AR when possible
  if (size.width && size.height) {
    graph['41'] = {
      class_type: 'ImageScale',
      inputs: {
        image: ['40', 0],
        upscale_method: 'lanczos',
        width: size.width,
        height: size.height,
        crop: 'disabled',
      },
    }
  }
  const imageRef = size.width && size.height ? ['41', 0] : ['40', 0]

  graph['42'] = {
    class_type: 'ControlNetLoader',
    inputs: { control_net_name: modelName },
  }
  graph['43'] = {
    class_type: 'ControlNetApplyAdvanced',
    inputs: {
      positive: ['6', 0],
      negative: ['7', 0],
      control_net: ['42', 0],
      image: imageRef,
      strength,
      start_percent: startPercent,
      end_percent: endPercent,
    },
  }

  return {
    positiveRef: ['43', 0],
    negativeRef: ['43', 1],
    controlnet: {
      enabled: true,
      type: type === 'canny' || type === 'edges' ? 'canny' : 'openpose',
      model: modelName,
      strength,
      startPercent,
      endPercent,
      guideFilename: staged.filename,
      guidePath: staged.absPath,
    },
  }
}

/**
 * Build API-format still graph for the quality tier.
 */
export function buildStillGraph(plan, opts = {}) {
  const q = resolveQuality(opts.quality || plan.quality || 'standard')
  const enriched = applyQualityLoras(plan, q.id)
  const ckpt = String(opts.checkpoint || getCheckpoint() || '').trim()
  if (!ckpt) {
    fail(400, 'missing_checkpoint', 'Set stills.checkpoint in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  const upscaleName = String(opts.upscale || upscaleModel() || '').trim()
  const useHires = Boolean(q.useHires && upscaleName)
  const stopAt = clipSkip()
  const prefix =
    opts.filenamePrefix ||
    `qorlith/stills/director/dir_${Date.now().toString(36)}`
  const w = enriched.size?.width || 1024
  const h = enriched.size?.height || 1024
  const seed =
    enriched.sampler?.seed === -1 || enriched.sampler?.seed == null
      ? Math.floor(Math.random() * 2_147_483_647)
      : Math.abs(Number(enriched.sampler.seed)) % 2_147_483_647

  const steps = Math.max(enriched.sampler?.steps || q.steps, q.steps)
  const cfg = Math.max(Number(enriched.sampler?.cfg) || q.cfg, q.cfg)
  const samplerName = enriched.sampler?.sampler_name || 'euler_ancestral'
  const scheduler = enriched.sampler?.scheduler || 'normal'
  const loras = enriched.loras

  /** @type {Record<string, { class_type: string, inputs: Record<string, unknown> }>} */
  const graph = {
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
    '5': {
      class_type: 'EmptyLatentImage',
      inputs: { width: w, height: h, batch_size: 1 },
    },
  }

  let { modelRef, clipRef } = chainLoras(graph, ['4', 0], ['4', 1], loras, 10)

  const ipCfg = resolveIpadapterConfig(opts, enriched)
  let ipMeta = null
  if (ipCfg.enabled) {
    let staged
    try {
      staged = stageGuideImage(ipCfg.image, { comfyRoot: opts.comfyRoot || requireComfyRoot() })
    } catch {
      staged = null
    }
    if (staged?.filename) {
      graph['50'] = {
        class_type: 'LoadImage',
        inputs: { image: staged.filename },
      }
      graph['51'] = {
        class_type: 'CLIPVisionLoader',
        inputs: { clip_name: ipCfg.clipVision },
      }
      graph['52'] = {
        class_type: 'IPAdapterModelLoader',
        inputs: { ipadapter_file: ipCfg.model },
      }
      graph['53'] = {
        class_type: 'IPAdapterAdvanced',
        inputs: {
          model: modelRef,
          ipadapter: ['52', 0],
          image: ['50', 0],
          weight: ipCfg.weight,
          weight_type: ipCfg.weightType,
          combine_embeds: 'concat',
          start_at: 0.0,
          end_at: 1.0,
          embeds_scaling: 'V only',
          clip_vision: ['51', 0],
        },
      }
      modelRef = ['53', 0]
      ipMeta = {
        enabled: true,
        model: ipCfg.model,
        clipVision: ipCfg.clipVision,
        image: staged.absPath || staged.filename,
        weight: ipCfg.weight,
        weightType: ipCfg.weightType,
      }
    }
  }

  const clipSkipId = '11'
  graph[clipSkipId] = {
    class_type: 'CLIPSetLastLayer',
    inputs: { clip: clipRef, stop_at_clip_layer: stopAt },
  }

  graph['6'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: enriched.positive || '', clip: [clipSkipId, 0] },
  }
  graph['7'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: enriched.negative || '', clip: [clipSkipId, 0] },
  }

  // Conditioning refs (may be rewired through ControlNet)
  let positiveRef = ['6', 0]
  let negativeRef = ['7', 0]
  const cnMeta = applyControlNetToGraph(graph, enriched, opts, { width: w, height: h })
  if (cnMeta?.positiveRef) positiveRef = cnMeta.positiveRef
  if (cnMeta?.negativeRef) negativeRef = cnMeta.negativeRef

  let samplesRef
  if (q.useRefiner) {
    // Base pass 0 → switch
    graph['3'] = {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'enable',
        noise_seed: seed,
        steps: q.totalSteps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        start_at_step: 0,
        end_at_step: q.switchStep,
        return_with_leftover_noise: 'enable',
        model: modelRef,
        positive: positiveRef,
        negative: negativeRef,
        latent_image: ['5', 0],
      },
    }
    // Same-model refine switch → total (no new noise)
    graph['13'] = {
      class_type: 'KSamplerAdvanced',
      inputs: {
        add_noise: 'disable',
        noise_seed: seed,
        steps: q.totalSteps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        start_at_step: q.switchStep,
        end_at_step: q.totalSteps,
        return_with_leftover_noise: 'disable',
        model: modelRef,
        positive: positiveRef,
        negative: negativeRef,
        latent_image: ['3', 0],
      },
    }
    samplesRef = ['13', 0]
  } else {
    graph['3'] = {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: samplerName,
        scheduler,
        denoise: 1.0,
        model: modelRef,
        positive: positiveRef,
        negative: negativeRef,
        latent_image: ['5', 0],
      },
    }
    samplesRef = ['3', 0]
  }

  graph['8'] = {
    class_type: 'VAEDecode',
    inputs: { samples: samplesRef, vae: ['4', 2] },
  }

  // Base save (always) — rewired later if a detailer runs on the non-hires path
  graph['9'] = {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: useHires ? `${prefix}_base` : prefix,
      images: ['8', 0],
    },
  }

  let finalImageRef = ['8', 0]
  let hiresPrefix = null
  let detailerMeta = null

  if (useHires) {
    // 4× model upscale → scale_by 0.375 ≈ 1.5× → encode → polish → decode → save
    graph['20'] = {
      class_type: 'UpscaleModelLoader',
      inputs: { model_name: upscaleName },
    }
    graph['21'] = {
      class_type: 'ImageUpscaleWithModel',
      inputs: {
        upscale_model: ['20', 0],
        image: ['8', 0],
      },
    }
    graph['22'] = {
      class_type: 'ImageScaleBy',
      inputs: {
        image: ['21', 0],
        upscale_method: 'lanczos',
        scale_by: q.hiresScaleFrom4x,
      },
    }
    graph['23'] = {
      class_type: 'VAEEncode',
      inputs: {
        pixels: ['22', 0],
        vae: ['4', 2],
      },
    }
    graph['24'] = {
      class_type: 'KSampler',
      inputs: {
        seed: (seed + 7) % 2_147_483_647,
        steps: q.polishSteps,
        cfg: q.polishCfg,
        sampler_name: samplerName,
        scheduler,
        denoise: q.polishDenoise,
        model: modelRef,
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['23', 0],
      },
    }
    graph['25'] = {
      class_type: 'VAEDecode',
      inputs: { samples: ['24', 0], vae: ['4', 2] },
    }
    hiresPrefix = `${prefix}_hires`
    graph['26'] = {
      class_type: 'SaveImage',
      inputs: {
        filename_prefix: hiresPrefix,
        images: ['25', 0],
      },
    }
    finalImageRef = ['25', 0]
  }

  const dCfg = resolveDetailerConfig(opts, enriched)
  if (dCfg.enabled && dCfg.face) {
    const clipRefForDetail = [clipSkipId, 0]
    const vaeRef = ['4', 2]
    const posRef = ['6', 0]
    const negRef = ['7', 0]
    graph['60'] = {
      class_type: 'UltralyticsDetectorProvider',
      inputs: { model_name: dCfg.face },
    }
    graph['61'] = faceDetailerNode({
      imageRef: finalImageRef,
      modelRef,
      clipRef: clipRefForDetail,
      vaeRef,
      posRef,
      negRef,
      bboxRef: ['60', 0],
      seed: (seed + 17) % 2_147_483_647,
      steps: dCfg.steps,
      cfg,
      samplerName,
      scheduler,
      denoise: dCfg.denoise,
      guideSize: dCfg.guideSize,
      wildcard: dCfg.wildcard,
      bboxThreshold: 0.45,
    })
    finalImageRef = ['61', 0]
    const used = ['face']
    if (dCfg.hand) {
      graph['62'] = {
        class_type: 'UltralyticsDetectorProvider',
        inputs: { model_name: dCfg.hand },
      }
      graph['63'] = faceDetailerNode({
        imageRef: finalImageRef,
        modelRef,
        clipRef: clipRefForDetail,
        vaeRef,
        posRef,
        negRef,
        bboxRef: ['62', 0],
        seed: (seed + 23) % 2_147_483_647,
        steps: dCfg.steps,
        cfg,
        samplerName,
        scheduler,
        denoise: dCfg.handDenoise,
        guideSize: Math.min(384, dCfg.guideSize),
        wildcard: dCfg.handWildcard,
        bboxThreshold: 0.35,
      })
      finalImageRef = ['63', 0]
      used.push('hand')
    }
    const saveId = useHires ? '26' : '9'
    if (graph[saveId]) graph[saveId].inputs.images = finalImageRef
    detailerMeta = {
      enabled: true,
      face: dCfg.face,
      hand: dCfg.hand || '',
      denoise: dCfg.denoise,
      parts: used,
    }
  }

  return {
    graph,
    seed,
    prefix: useHires ? hiresPrefix : prefix,
    basePrefix: prefix,
    hiresPrefix,
    checkpoint: ckpt,
    size: { width: w, height: h },
    loras,
    quality: { ...q, useHires },
    enrichedPlan: enriched,
    steps,
    cfg,
    finalImageRef,
    controlnet: cnMeta?.controlnet || null,
    ipadapter: ipMeta,
    detailer: detailerMeta,
  }
}

/**
 * Polish an existing still image (LoadImage → upscale from yaml → denoise polish).
 * Uses plan conditioning + yaml LoRAs.
 */
export function buildPolishGraph(plan, opts = {}) {
  const q = resolveQuality(opts.quality || 'standard')
  const upscaleName = String(opts.upscale != null ? opts.upscale : upscaleModel() || '').trim()
  if (!upscaleName) {
    fail(400, 'missing_upscale', 'Set stills.upscale in qorlith.yaml to polish a still', {
      hint: 'Add an upscale model filename under stills.upscale, then retry.',
    })
  }
  const polishQ = {
    ...q,
    useHires: true,
    useLighting: true,
    styleStrength: q.styleStrength || 0.68,
    lightStrength: q.lightStrength || 0.55,
    polishSteps: q.polishSteps || 20,
    polishCfg: q.polishCfg || 5.5,
    polishDenoise: q.polishDenoise || 0.32,
    hiresScaleFrom4x: 0.375,
  }
  const enriched = applyQualityLoras(plan, polishQ.useLighting ? 'standard' : 'draft')
  const ckpt = String(opts.checkpoint || getCheckpoint() || '').trim()
  if (!ckpt) {
    fail(400, 'missing_checkpoint', 'Set stills.checkpoint in qorlith.yaml', {
      hint: 'Edit qorlith.yaml or qorlith.local.yaml, then retry.',
    })
  }
  const stopAt = clipSkip()
  const yamlSampler = stillCfg().sampler || {}
  const prefix =
    opts.filenamePrefix ||
    `qorlith/stills/director/polish_${Date.now().toString(36)}`
  const inputName = opts.inputImageName
  if (!inputName) throw new Error('inputImageName required for polish')

  const seed =
    enriched.sampler?.seed === -1 || enriched.sampler?.seed == null
      ? Math.floor(Math.random() * 2_147_483_647)
      : Math.abs(Number(enriched.sampler.seed)) % 2_147_483_647

  const graph = {
    '1': {
      class_type: 'LoadImage',
      inputs: { image: inputName },
    },
    '4': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: ckpt },
    },
  }
  const { modelRef, clipRef } = chainLoras(graph, ['4', 0], ['4', 1], enriched.loras, 10)
  graph['11'] = {
    class_type: 'CLIPSetLastLayer',
    inputs: { clip: clipRef, stop_at_clip_layer: stopAt },
  }
  graph['6'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: enriched.positive || '', clip: ['11', 0] },
  }
  graph['7'] = {
    class_type: 'CLIPTextEncode',
    inputs: { text: enriched.negative || '', clip: ['11', 0] },
  }
  graph['20'] = {
    class_type: 'UpscaleModelLoader',
    inputs: { model_name: upscaleName },
  }
  graph['21'] = {
    class_type: 'ImageUpscaleWithModel',
    inputs: { upscale_model: ['20', 0], image: ['1', 0] },
  }
  graph['22'] = {
    class_type: 'ImageScaleBy',
    inputs: {
      image: ['21', 0],
      upscale_method: 'lanczos',
      scale_by: polishQ.hiresScaleFrom4x,
    },
  }
  graph['23'] = {
    class_type: 'VAEEncode',
    inputs: { pixels: ['22', 0], vae: ['4', 2] },
  }
  graph['24'] = {
    class_type: 'KSampler',
    inputs: {
      seed,
      steps: polishQ.polishSteps,
      cfg: polishQ.polishCfg,
      sampler_name: enriched.sampler?.sampler_name || yamlSampler.name || 'euler_ancestral',
      scheduler: enriched.sampler?.scheduler || yamlSampler.scheduler || 'normal',
      denoise: polishQ.polishDenoise,
      model: modelRef,
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['23', 0],
    },
  }
  graph['25'] = {
    class_type: 'VAEDecode',
    inputs: { samples: ['24', 0], vae: ['4', 2] },
  }
  graph['26'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: `${prefix}_hires`, images: ['25', 0] },
  }

  return {
    graph,
    seed,
    prefix: `${prefix}_hires`,
    checkpoint: ckpt,
    quality: polishQ,
    enrichedPlan: enriched,
  }
}
