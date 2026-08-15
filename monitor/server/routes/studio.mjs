/**
 * Studio projects, plans, episode board.
 */
import fs from 'fs'
import path from 'path'
import { loadConfig, ROOT } from '../appConfig.mjs'
import { fail, wrap } from '../errors.mjs'
import {
  addArchivedPaths,
  allowedUnderRoots,
  isMediaFile,
  loadArchiveStore,
} from '../gallery.mjs'
import { safeStat } from '../fsutil.mjs'
import { listBrains } from '../brainStatus.mjs'
import { listPipelines, markPipelineArchivedInRegistry } from '../produce.mjs'
import { approvePlan, archivePlanProject, generateMoviePlan } from '../studioPlanner.mjs'
import { listProjectWorkflows, writeStoryboard } from '../storyboard.mjs'
import { createStudioProject, listStudioProjects, syncBoardFromPlan } from '../project.mjs'
import { slugifyProjectId } from '../ids.mjs'
import { loadProjectRecord, saveProjectRecord, listProjectRecords } from '../project.mjs'
import {
  addComment,
  deleteComment,
  getRegistry,
  listEpisodePlans,
  loadEpisodePlan,
  resolveBoardFile,
  setPick,
} from '../episodePlan.mjs'
import { directorConfigFromApp, lmstudioHealth } from '../director.mjs'

export function mountStudio(app) {
  app.get(
    '/api/episode-plans',
    wrap(async (_req, res) => {
      res.json({ plans: listEpisodePlans(), polledAt: new Date().toISOString() })
    }),
  )

  app.get(
    '/api/episode-plans/:id',
    wrap(async (req, res) => {
      res.json(loadEpisodePlan(req.params.id))
    }),
  )

  app.get(
    '/api/episode-plans/:id/file',
    wrap(async (req, res) => {
      const reg = getRegistry(req.params.id)
      const rel = req.query.rel
      if (!rel || typeof rel !== 'string') {
        fail(400, 'missing_rel', 'rel query required', {
          hint: 'Pass ?rel=scene/file.png for a still under this project board.',
        })
      }
      const abs = resolveBoardFile(reg, rel)
      const ext = path.extname(abs).toLowerCase()
      const types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
      }
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'private, max-age=60')
      fs.createReadStream(abs).pipe(res)
    }),
  )

  app.post(
    '/api/episode-plans/:id/comments',
    wrap(async (req, res) => {
      getRegistry(req.params.id)
      const rec = addComment(req.params.id, req.body || {})
      res.json({ ok: true, comment: rec })
    }),
  )

  app.delete(
    '/api/episode-plans/:id/comments/:commentId',
    wrap(async (req, res) => {
      getRegistry(req.params.id)
      res.json(deleteComment(req.params.id, req.params.commentId))
    }),
  )

  app.put(
    '/api/episode-plans/:id/picks',
    wrap(async (req, res) => {
      getRegistry(req.params.id)
      const sceneId = String((req.body || {}).sceneId || '')
      const imageRel = String((req.body || {}).imageRel || '')
      if (!sceneId || !imageRel) {
        fail(400, 'missing_pick', 'sceneId and imageRel required', {
          hint: 'Choose a still on the board, then set pick.',
        })
      }
      const picks = setPick(req.params.id, sceneId, imageRel)
      res.json({ ok: true, picks })
    }),
  )

  app.get(
    '/api/studio/health',
    wrap(async (_req, res) => {
      const cfg = loadConfig()
      const d = directorConfigFromApp()
      const health = await lmstudioHealth(d)
      res.json({
        ok: health.ok,
        lmstudio: health,
        planner: {
          url: d.lmstudioBaseUrl,
          model: d.planModelKey || null,
          prefer: d.planModelPrefer,
          temperature: d.temperature,
          maxTokens: d.maxTokens,
          style: d.plannerStyle || '',
        },
        guidePath: path.join(ROOT, '..', 'docs', 'README.md'),
        projectsDir: path.join(ROOT, 'data', 'projects'),
      })
    }),
  )

  app.get(
    '/api/studio/projects',
    wrap(async (_req, res) => {
      const cfg = loadConfig()
      const produce = listPipelines(cfg)
      res.json({
        projects: listStudioProjects(produce, listBrains()),
        polledAt: new Date().toISOString(),
      })
    }),
  )

  app.post(
    '/api/studio/projects',
    wrap(async (req, res) => {
      const title = String(req.body?.title || '').trim()
      const prompt = String(req.body?.prompt || '').trim()
      const created = createStudioProject({ title, prompt })
      res.status(201).json({ ok: true, ...created })
    }),
  )

  app.get(
    '/api/studio/plans',
    wrap(async (_req, res) => {
      res.json({ plans: listProjectRecords(), polledAt: new Date().toISOString() })
    }),
  )

  app.get(
    '/api/studio/plans/:id',
    wrap(async (req, res) => {
      const rec = loadProjectRecord(req.params.id)
      if (!rec) {
        fail(404, 'plan_not_found', 'plan not found', {
          hint: 'Pick a project from the left rail, or generate a plan first.',
        })
      }
      res.json({ ok: true, record: rec })
    }),
  )

  app.get(
    '/api/studio/plans/:id/storyboard',
    wrap(async (req, res) => {
      const rec = loadProjectRecord(req.params.id)
      if (!rec) {
        fail(404, 'plan_not_found', 'plan not found', {
          hint: 'Generate a plan first.',
        })
      }
      const written = writeStoryboard(rec)
      res.json({
        ok: true,
        projectId: rec.projectId,
        title: rec.plan?.title || rec.projectId,
        model: rec.model || null,
        updatedAt: rec.updatedAt || rec.createdAt || null,
        markdown: written?.markdown || '',
      })
    }),
  )

  app.get(
    '/api/studio/plans/:id/workflows',
    wrap(async (req, res) => {
      const rec = loadProjectRecord(req.params.id)
      if (!rec) {
        fail(404, 'plan_not_found', 'plan not found', {
          hint: 'Generate a plan first.',
        })
      }
      res.json({ ok: true, ...listProjectWorkflows(req.params.id) })
    }),
  )

  app.post(
    '/api/studio/plan',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const prompt = req.body?.prompt || req.body?.instruction || ''
      const dryRun = Boolean(req.body?.dryRun)
      const pinnedId = String(req.body?.projectId || '').trim()
      const result = await generateMoviePlan({ userPrompt: prompt, dryRun, appConfig: cfg })
      const now = new Date().toISOString()
      let projectId = result.plan.projectId
      let existing = null
      if (pinnedId) {
        existing = loadProjectRecord(pinnedId)
        if (!existing) {
          fail(404, 'project_not_found', 'project not found', {
            hint: 'Create the project from the left rail +, then generate again.',
          })
        }
        projectId = existing.projectId
        result.plan.projectId = projectId
      } else {
        existing = loadProjectRecord(projectId)
        if (existing?.approved && existing?.produceRegistered) {
          projectId = slugifyProjectId(`${projectId}_${Date.now().toString(36).slice(-4)}`)
          result.plan.projectId = projectId
          existing = null
        }
      }
      const record = {
        ...(existing || {}),
        projectId,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        status: existing?.approved ? existing.status || 'draft' : 'draft',
        approved: Boolean(existing?.approved),
        produceRegistered: Boolean(existing?.produceRegistered),
        archived: false,
        userPrompt: String(prompt).slice(0, 4000),
        dryRun: result.dryRun,
        model: result.model,
        plan: result.plan,
        rawModelText: result.rawModelText,
      }
      saveProjectRecord(record)
      try {
        writeStoryboard(record)
      } catch {
        /* storyboard is additive */
      }
      try {
        syncBoardFromPlan(result.plan)
      } catch {
        /* board optional */
      }
      res.json({ ok: true, record, plan: result.plan, dryRun: result.dryRun, model: result.model })
    }),
  )

  app.post(
    '/api/studio/plans/:id/approve',
    wrap(async (req, res) => {
      const startProduction = req.body?.startProduction !== false
      const result = approvePlan(req.params.id, { startProduction })
      res.json({ ok: true, ...result })
    }),
  )

  app.post(
    '/api/studio/plans/:id/archive',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const roots = cfg.comfyOutputRoots || []
      const result = archivePlanProject(req.params.id)
      const safePaths = (result.mediaPaths || []).filter((p) => {
        try {
          const resolved = path.resolve(p)
          if (!allowedUnderRoots(resolved, roots)) return false
          const st = safeStat(resolved)
          return Boolean(st && st.isFile() && isMediaFile(resolved))
        } catch {
          return false
        }
      })
      let added = []
      let addedCount = 0
      let archivedTotal = loadArchiveStore().paths.length
      if (safePaths.length) {
        const arch = addArchivedPaths(safePaths, { roots })
        added = arch.added
        addedCount = arch.added.length
        archivedTotal = arch.store.count
      }
      try {
        markPipelineArchivedInRegistry(result.projectId, {
          name: result.title,
          addedCount,
          mediaCount: result.mediaCount,
          source: 'studio_planner',
        })
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        projectId: result.projectId,
        title: result.title,
        mediaCount: result.mediaCount,
        scannedMediaCount: result.mediaCount,
        addedCount,
        sampleAdded: added.slice(0, 5),
        roots: result.roots,
        archivedTotal,
        removedFromProduce: true,
        message:
          addedCount > 0
            ? `Archived ${addedCount} media file(s) for ${result.projectId}. Hidden from All media.`
            : result.message,
        record: result.record,
      })
    }),
  )
}
