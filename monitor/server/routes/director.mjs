/**
 * Director still + MiniMax video HTTP.
 */
import { loadConfig } from '../appConfig.mjs'
import {
  directorConfigFromApp,
  dryRunPlan,
  dryRunVideoPlan,
  generatePlan,
  generateVideoPlan,
  getLoraInventory,
  lmstudioHealth,
  runDirectorPipeline,
  runVideoPipeline,
  validatePlan,
  validateVideoPlan,
} from '../director.mjs'
import { assertComfyIdle, comfyFreeMemory } from '../comfyClient.mjs'
import { getComfyProgress, startComfyProgress } from '../comfyProgress.mjs'
import {
  comfyHealth,
  controlNetModelForType,
  polishStillAndWait,
  QUALITY_PRESETS,
  stageGuideImage,
} from '../comfyStill.mjs'
import { queueVideoAndWait } from '../comfyVideo.mjs'
import {
  completeJob,
  createDirectorJob,
  failJob,
  getJob,
  jobPublic,
  pushJobStage,
} from '../directorJobs.mjs'
import { fail, wrap } from '../errors.mjs'
import { preparePlanModel, releasePlanModel } from '../lms.mjs'
import { getCheckpoint, loadStudio } from '../studioConfig.mjs'

export function mountDirector(app) {
  startComfyProgress()

  app.get(
    '/api/comfy/progress',
    wrap(async (_req, res) => {
      res.json({ ok: true, ...getComfyProgress(), polledAt: new Date().toISOString() })
    }),
  )

  app.post(
    '/api/comfy/free',
    wrap(async (_req, res) => {
      const d = directorConfigFromApp()
      await comfyFreeMemory(d.comfyBase || 'http://127.0.0.1:8188')
      res.json({ ok: true, freed: true })
    }),
  )

  app.get(
    '/api/director/health',
    wrap(async (_req, res) => {
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const health = await lmstudioHealth(d)
      const comfy = await comfyHealth(d.comfyBase || 'http://127.0.0.1:8188')
      res.json({
        ...health,
        comfy,
        config: {
          lmstudioBaseUrl: d.lmstudioBaseUrl,
          planModelKey: d.planModelKey || d.model || null,
          planModelPrefer: d.planModelPrefer,
          autoManageModels: d.autoManageModels !== false,
          unloadAfterPlan: d.unloadAfterPlan !== false,
          temperature: d.temperature,
          comfyBase: d.comfyBase,
        },
      })
    }),
  )

  app.get('/api/director/inventory', (_req, res) => {
    const loras = getLoraInventory()
    res.json({
      loras,
      stillLoras: loras,
      qualityPresets: QUALITY_PRESETS,
      controlnet: {
        openposeModel: controlNetModelForType('openpose'),
        cannyModel: controlNetModelForType('canny'),
        defaultStrength: 0.55,
        maxCharacters: 2,
      },
      defaults: {
        checkpoint: getCheckpoint(),
        clip_skip: loadStudio().stills?.clip_skip ?? -2,
        trigger: '',
        stillQuality: loadStudio().stills?.quality || 'standard',
        stillLoraCap: 8,
        upscale: loadStudio().stills?.upscale || '',
        detailerEnabled: Boolean(loadStudio().stills?.detailer?.enabled),
        ipadapterEnabled: Boolean(loadStudio().stills?.ipadapter?.enabled),
        sizes: [
          { id: 'square', width: 1024, height: 1024, aspectRatio: '1:1' },
          { id: 'portrait_phone', width: 768, height: 1344, aspectRatio: '9:16' },
          { id: 'landscape_16x9', width: 1280, height: 720, aspectRatio: '16:9' },
        ],
      },
    })
  })

  app.post(
    '/api/director/guide/upload',
    wrap(async (req, res) => {
      const src = req.body?.imageDataUrl || req.body?.dataUrl || req.body?.path || req.body?.guideImage
      if (!src) {
        fail(400, 'missing_guide', 'imageDataUrl or path required', {
          hint: 'Apply a pose from the pose board, or paste a still path.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const staged = stageGuideImage(src, { comfyRoot: d.comfyRoot })
      if (!staged) {
        fail(400, 'guide_stage_failed', 'could not stage guide', {
          hint: 'Set comfy.root in qorlith.yaml and retry.',
        })
      }
      res.json({
        ok: true,
        filename: staged.filename,
        absPath: staged.absPath,
        guideImage: staged.absPath,
      })
    }),
  )

  app.post(
    '/api/director/polish',
    wrap(async (req, res) => {
      const sourceImage = req.body?.sourceImage
      const planIn = req.body?.plan
      if (!sourceImage) {
        fail(400, 'missing_source', 'sourceImage required', {
          hint: 'Select a still, then polish.',
        })
      }
      if (!planIn) {
        fail(400, 'missing_plan', 'plan required', {
          hint: 'Generate or plan a still brief first.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const { plan, warnings } = validatePlan(planIn, {
        userText: req.body?.instruction || 'polish',
        sizeHint: req.body?.sizeHint || '',
      })
      const quality = req.body?.quality || plan.quality || d.stillQuality || 'standard'
      const roots = cfg.comfyOutputRoots || []
      await assertComfyIdle(d.comfyBase)

      const run = async (onProgress) => {
        const generation = await polishStillAndWait({
          sourceImage: String(sourceImage),
          plan,
          quality: quality === 'draft' ? 'standard' : quality,
          comfyBase: d.comfyBase,
          comfyRoot: d.comfyRoot,
          comfyOutputRoot: roots[0],
          checkpoint: d.checkpoint,
          onProgress,
        })
        return {
          ok: true,
          plan,
          warnings,
          quality: generation.quality,
          generation,
          generations: [generation],
        }
      }

      if (req.body?.async) {
        const job = createDirectorJob('still-polish')
        res.json({ ok: true, async: true, jobId: job.id })
        run((ev) => pushJobStage(job.id, ev))
          .then((result) => completeJob(job.id, result))
          .catch((e) => failJob(job.id, e, { plan }))
        return
      }

      res.json(await run())
    }),
  )

  app.post(
    '/api/director/plan',
    wrap(async (req, res) => {
      const instruction = req.body?.instruction
      const sizeHint = req.body?.sizeHint || ''
      const preferControlNet = Boolean(req.body?.preferControlNet)
      const dryRun = Boolean(req.body?.dryRun)
      const cfg = loadConfig()
      const d = directorConfigFromApp()

      if (dryRun) {
        const { plan, warnings } = dryRunPlan(instruction || 'test still', sizeHint)
        return res.json({ ok: true, dryRun: true, plan, warnings, model: null })
      }

      const result = await generatePlan({
        instruction,
        sizeHint,
        preferControlNet,
        directorCfg: d,
      })
      res.json({
        ok: true,
        dryRun: false,
        plan: result.plan,
        warnings: result.warnings,
        model: result.model,
        ...(req.body?.includeRaw ? { rawModelText: result.rawModelText } : {}),
      })
    }),
  )

  app.post(
    '/api/director/validate',
    wrap(async (req, res) => {
      const result = validatePlan(req.body?.plan || {}, {
        userText: req.body?.instruction || '',
        sizeHint: req.body?.sizeHint || '',
      })
      res.json({ ok: true, plan: result.plan, warnings: result.warnings })
    }),
  )

  app.get(
    '/api/director/jobs/:id',
    wrap(async (req, res) => {
      const job = getJob(req.params.id)
      if (!job) {
        fail(404, 'job_not_found', 'job not found', {
          hint: 'The render job expired or never started. Press Continue.',
        })
      }
      res.json({ ok: true, job: jobPublic(job) })
    }),
  )

  app.post(
    '/api/director/run',
    wrap(async (req, res) => {
      const instruction = req.body?.instruction
      if (!instruction || !String(instruction).trim()) {
        fail(400, 'missing_instruction', 'instruction required', {
          hint: 'Describe the still, then generate.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const roots = cfg.comfyOutputRoots || []
      const args = {
        instruction: String(instruction),
        sizeHint: req.body?.sizeHint || '',
        preferControlNet: Boolean(req.body?.preferControlNet || req.body?.guideImage),
        generate: req.body?.generate !== false,
        planOnly: Boolean(req.body?.planOnly),
        count: req.body?.count,
        quality: req.body?.quality || d.stillQuality || 'standard',
        directorCfg: d,
        comfyOutputRoot: roots[0] || undefined,
        guideImage: req.body?.guideImage || req.body?.guidePath || null,
        controlnet: req.body?.controlnet || null,
        poseCharacterCount: req.body?.poseCharacterCount,
      }

      if (args.generate && !args.planOnly) {
        await assertComfyIdle(d.comfyBase)
      }

      if (req.body?.async) {
        const job = createDirectorJob('still')
        res.json({ ok: true, async: true, jobId: job.id })
        runDirectorPipeline({
          ...args,
          onProgress: (ev) => pushJobStage(job.id, ev),
        })
          .then((result) => completeJob(job.id, result))
          .catch((e) =>
            failJob(job.id, e, {
              stages: e?.stages,
              plan: e?.plan,
            }),
          )
        return
      }

      res.json(await runDirectorPipeline(args))
    }),
  )

  app.post(
    '/api/director/queue',
    wrap(async (req, res) => {
      const planIn = req.body?.plan
      if (!planIn) {
        fail(400, 'missing_plan', 'plan required', {
          hint: 'Generate or plan a still brief first.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const { plan, warnings } = validatePlan(planIn, {
        userText: req.body?.instruction || 'manual queue',
        sizeHint: req.body?.sizeHint || '',
      })
      const roots = cfg.comfyOutputRoots || []
      const count = req.body?.count
      const args = {
        skipLlm: true,
        plan,
        instruction: req.body?.instruction || 'regenerate',
        sizeHint: req.body?.sizeHint || '',
        generate: true,
        planOnly: false,
        count,
        quality: req.body?.quality || plan.quality || d.stillQuality || 'standard',
        directorCfg: d,
        guideImage: req.body?.guideImage || req.body?.guidePath || plan.controlnet?.guidePath || null,
        controlnet: req.body?.controlnet || plan.controlnet || null,
        poseCharacterCount: req.body?.poseCharacterCount,
        comfyOutputRoot: roots[0],
        filenamePrefix: req.body?.filenamePrefix || null,
      }

      await assertComfyIdle(d.comfyBase)

      if (req.body?.async) {
        const job = createDirectorJob('still-regen')
        res.json({ ok: true, async: true, jobId: job.id, warnings })
        runDirectorPipeline({
          ...args,
          onProgress: (ev) => pushJobStage(job.id, ev),
        })
          .then((result) => completeJob(job.id, { ...result, warnings: result.warnings || warnings }))
          .catch((e) =>
            failJob(job.id, e, {
              stages: e?.stages,
              plan: e?.plan || plan,
            }),
          )
        return
      }

      const result = await runDirectorPipeline(args)
      res.json({
        ok: true,
        plan: result.plan,
        warnings: [...warnings, ...(result.warnings || [])],
        generation: result.generation,
        generations: result.generations,
        batchId: result.batchId,
        count: result.count,
        stages: result.stages,
      })
    }),
  )

  app.post(
    '/api/director/video/plan',
    wrap(async (req, res) => {
      const instruction = req.body?.instruction
      const dryRun = Boolean(req.body?.dryRun)
      const cfg = loadConfig()
      const d = directorConfigFromApp()

      if (dryRun) {
        const { plan, warnings } = dryRunVideoPlan(instruction || 'subtle motion')
        return res.json({ ok: true, dryRun: true, kind: 'video', plan, warnings, model: null })
      }

      let prepared = null
      try {
        if (d.autoManageModels !== false) {
          prepared = await preparePlanModel(d)
          d.apiModel = prepared.apiModel
        }
        const result = await generateVideoPlan({ instruction, directorCfg: d })
        res.json({
          ok: true,
          dryRun: false,
          kind: 'video',
          plan: result.plan,
          warnings: result.warnings,
          model: prepared?.modelKey || null,
          ...(req.body?.includeRaw ? { rawModelText: result.rawModelText } : {}),
        })
      } finally {
        if (prepared && d.unloadAfterPlan !== false) {
          await releasePlanModel({ ...d, unloadAfterPlan: true })
        }
      }
    }),
  )

  app.post(
    '/api/director/video/run',
    wrap(async (req, res) => {
      const instruction = req.body?.instruction
      const sourceImage = req.body?.sourceImage
      if (!sourceImage) {
        fail(400, 'missing_source', 'sourceImage required', {
          hint: 'Generate a still first, or paste a start-still path.',
        })
      }
      if (!instruction && !req.body?.plan && !req.body?.dryRun) {
        fail(400, 'missing_instruction', 'instruction or plan required', {
          hint: 'Describe the motion, or queue an edited video brief.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const roots = cfg.comfyOutputRoots || []
      const args = {
        instruction: instruction || '',
        sourceImage: String(sourceImage),
        plan: req.body?.plan,
        dryRun: Boolean(req.body?.dryRun),
        generate: req.body?.generate !== false,
        planOnly: Boolean(req.body?.planOnly),
        width: req.body?.width,
        height: req.body?.height,
        filenamePrefix: req.body?.filenamePrefix,
        directorCfg: d,
        comfyOutputRoot: roots[0],
        continueFromPrior: Boolean(req.body?.continueFromPrior || req.body?.plan?.continueFromPrior),
        lookTrack: req.body?.lookTrack || req.body?.plan?.lookTrack,
        keepModels: Boolean(req.body?.keepModels),
      }

      if (args.generate && !args.planOnly && !args.dryRun) {
        await assertComfyIdle(d.comfyBase)
      }

      if (req.body?.async) {
        const job = createDirectorJob('video')
        res.json({ ok: true, async: true, jobId: job.id, kind: 'video' })
        runVideoPipeline({
          ...args,
          onProgress: (ev) => pushJobStage(job.id, ev),
        })
          .then((result) => completeJob(job.id, result))
          .catch((e) =>
            failJob(job.id, e, {
              stages: e?.stages,
              plan: e?.plan,
            }),
          )
        return
      }

      res.json(await runVideoPipeline(args))
    }),
  )

  app.post(
    '/api/director/video/queue',
    wrap(async (req, res) => {
      const sourceImage = req.body?.sourceImage
      if (!sourceImage) {
        fail(400, 'missing_source', 'sourceImage required', {
          hint: 'Generate a still first, or paste a start-still path.',
        })
      }
      if (!req.body?.plan) {
        fail(400, 'missing_plan', 'plan required', {
          hint: 'Generate or plan a motion brief first.',
        })
      }
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const roots = cfg.comfyOutputRoots || []
      const { plan, warnings } = validateVideoPlan(req.body.plan, {
        userText: req.body?.instruction || '',
      })
      await assertComfyIdle(d.comfyBase)
      const generation = await queueVideoAndWait({
        sourceImage: String(sourceImage),
        motion: plan.motion,
        dialogue: plan.dialogue,
        music: plan.music,
        soundscape: plan.soundscape,
        lookTrack: plan.lookTrack,
        characters: plan.characters,
        allowSinging: plan.allowSinging,
        instruction: req.body?.instruction || '',
        durationSec: plan.durationSec,
        megapixels: plan.megapixels,
        negative: plan.negative,
        seed: plan.seed,
        continueFromPrior: Boolean(req.body?.continueFromPrior || req.body?.plan?.continueFromPrior),
        comfyBase: d.comfyBase,
        comfyRoot: d.comfyRoot,
        comfyOutputRoot: roots[0],
        templatePath: d.videoWorkflow,
        filenamePrefix: req.body?.filenamePrefix,
        keepModels: Boolean(req.body?.keepModels),
      })
      res.json({ ok: true, kind: 'video', plan, warnings, generation })
    }),
  )
}
