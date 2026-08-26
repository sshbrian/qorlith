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
  removeArchivedPaths,
} from '../gallery.mjs'
import { safeStat } from '../fsutil.mjs'
import { listBrains, spawnBrain } from '../brainStatus.mjs'
import { listPipelines, markPipelineArchivedInRegistry, unmarkPipelineArchivedInRegistry } from '../produce.mjs'
import { approvePlan, archivePlanProject, generateMoviePlan, plannerSpec, unarchivePlanProject } from '../studioPlanner.mjs'
import { plannerNeedsLms, resolvePlanner } from '../plannerProvider.mjs'
import { listProjectWorkflows, writeStoryboard } from '../storyboard.mjs'
import {
  createStudioProject,
  findProjectCover,
  listArchivedStudioProjects,
  listStudioProjects,
  projectDir,
  syncBoardFromPlan,
} from '../project.mjs'
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
      const d = directorConfigFromApp()
      const resolved = resolvePlanner({
        provider: d.plannerProvider,
        url: d.lmstudioBaseUrl,
        model: d.planModelKey || d.model,
        api_key: d.plannerApiKey,
      })
      const local = plannerNeedsLms(resolved.provider)
      const health = local ? await lmstudioHealth(d) : { ok: true, remote: true }
      let ready = true
      if (resolved.provider === 'none') ready = true
      else if (resolved.needsKey && !resolved.apiKey) ready = false
      else if (local) ready = Boolean(health.ok)
      res.json({
        ok: ready,
        lmstudio: local ? health : undefined,
        planner: {
          provider: resolved.provider,
          url: resolved.url,
          model: resolved.model || d.planModelKey || null,
          prefer: d.planModelPrefer,
          temperature: d.temperature,
          maxTokens: d.maxTokens,
          style: d.plannerStyle || '',
          local,
          needsKey: resolved.needsKey,
          hasKey: Boolean(resolved.apiKey),
        },
        guidePath: path.join(ROOT, '..', 'docs', 'README.md'),
        projectsDir: path.join(ROOT, 'data', 'projects'),
      })
    }),
  )

  app.get(
    '/api/studio/planner',
    wrap(async (req, res) => {
      res.json({ ok: true, ...plannerSpec({ videoMode: req.query?.videoMode }) })
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

  app.get(
    '/api/studio/archive',
    wrap(async (_req, res) => {
      const projects = listArchivedStudioProjects().map((p) => {
        const { coverPath, coverKind, ...rest } = p
        return {
          ...rest,
          coverKind: coverKind || null,
          coverUrl: coverPath
            ? `/api/studio/projects/${encodeURIComponent(p.id)}/cover`
            : null,
        }
      })
      res.json({ ok: true, projects, polledAt: new Date().toISOString() })
    }),
  )

  app.get(
    '/api/studio/projects/:id/cover',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      const abs = findProjectCover(id)
      if (!abs) {
        fail(404, 'no_cover', 'No cover on this project yet', {
          hint: 'Paint a still, or finish the film so master.mp4 is on disk.',
        })
      }
      const root = path.resolve(projectDir(id))
      const resolved = path.resolve(abs)
      if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        fail(403, 'path_forbidden', 'cover is not in this project', {
          hint: 'The cover must live under the project folder.',
        })
      }
      const ext = path.extname(resolved).toLowerCase()
      const types = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
      }
      res.setHeader('Content-Type', types[ext] || 'application/octet-stream')
      res.setHeader('Cache-Control', 'private, max-age=120')
      fs.createReadStream(resolved).pipe(res)
    }),
  )

  app.post(
    '/api/studio/projects',
    wrap(async (req, res) => {
      const title = String(req.body?.title || '').trim()
      const prompt = String(req.body?.prompt || '').trim()
      const created = createStudioProject({ title, prompt, videoMode: req.body?.videoMode })
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
      const imported = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : null
      let existing = pinnedId ? loadProjectRecord(pinnedId) : null
      if (pinnedId && !existing) {
        fail(404, 'project_not_found', 'project not found', {
          hint: 'Create the project from the left rail +, then generate again.',
        })
      }
      const videoMode = req.body?.videoMode || imported?.videoMode || existing?.plan?.videoMode
      const result = await generateMoviePlan({
        userPrompt: prompt,
        dryRun,
        appConfig: cfg,
        plan: imported,
        videoMode,
      })
      const now = new Date().toISOString()
      let projectId = result.plan.projectId
      if (pinnedId) {
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
      res.json({
        ok: true,
        record,
        plan: result.plan,
        dryRun: result.dryRun,
        model: result.model,
        provider: result.provider || null,
      })
    }),
  )

  app.post(
    '/api/studio/film',
    wrap(async (req, res) => {
      const prompt = String(req.body?.prompt || req.body?.instruction || '').trim()
      const imported = req.body?.plan && typeof req.body.plan === 'object' ? req.body.plan : null
      const dryRun = Boolean(req.body?.dryRun)
      if (!prompt && !imported) {
        fail(400, 'missing_prompt', 'prompt or plan required', {
          hint: 'Describe the film, or POST a plan JSON from Grok / another writer.',
        })
      }
      const cfg = loadConfig()
      const title = String(req.body?.title || imported?.title || '').trim()
      let pinnedId = String(req.body?.projectId || '').trim()
      let existing = pinnedId ? loadProjectRecord(pinnedId) : null
      if (pinnedId && !existing) {
        fail(404, 'project_not_found', 'project not found', {
          hint: 'Create the project from the rail +, then Make movie.',
        })
      }
      if (!existing) {
        const created = createStudioProject({
          title: title || 'Untitled project',
          prompt: prompt || String(imported?.logline || ''),
          videoMode: req.body?.videoMode || imported?.videoMode,
        })
        pinnedId = created.project.id
        existing = created.record
      }
      const result = await generateMoviePlan({
        userPrompt: prompt || String(imported?.logline || imported?.title || ''),
        dryRun,
        appConfig: cfg,
        plan: imported,
        videoMode: req.body?.videoMode || imported?.videoMode || existing?.plan?.videoMode,
      })
      const now = new Date().toISOString()
      const projectId = existing.projectId
      result.plan.projectId = projectId
      const record = {
        ...existing,
        projectId,
        createdAt: existing.createdAt || now,
        updatedAt: now,
        status: existing.approved ? existing.status || 'draft' : 'draft',
        approved: Boolean(existing.approved),
        produceRegistered: Boolean(existing.produceRegistered),
        archived: false,
        userPrompt: prompt.slice(0, 4000),
        dryRun: result.dryRun,
        model: result.model,
        plan: result.plan,
        rawModelText: result.rawModelText,
      }
      saveProjectRecord(record)
      try {
        writeStoryboard(record)
      } catch {
        /* additive */
      }
      try {
        syncBoardFromPlan(result.plan)
      } catch {
        /* optional */
      }
      if (dryRun) {
        return res.json({
          ok: true,
          oneClick: false,
          dryRun: true,
          projectId,
          record,
          plan: result.plan,
          model: result.model,
        })
      }
      if (!record.approved) {
        approvePlan(projectId, { startProduction: true })
      }
      const spawned = spawnBrain(projectId, { stopAfter: 'film', autoPick: true })
      res.status(202).json({
        ok: true,
        oneClick: true,
        projectId,
        pid: spawned.pid,
        plan: result.plan,
        record: loadProjectRecord(projectId),
        model: result.model,
        provider: result.provider || null,
      })
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

  app.post(
    '/api/studio/plans/:id/unarchive',
    wrap(async (req, res) => {
      const result = unarchivePlanProject(req.params.id)
      let removedCount = 0
      let archivedTotal = loadArchiveStore().paths.length
      if (result.mediaPaths?.length) {
        const un = removeArchivedPaths(result.mediaPaths)
        removedCount = un.removed
        archivedTotal = un.store.count
      }
      try {
        unmarkPipelineArchivedInRegistry(result.projectId)
      } catch {
        /* ignore */
      }
      res.json({
        ok: true,
        projectId: result.projectId,
        title: result.title,
        mediaCount: result.mediaCount,
        removedCount,
        archivedTotal,
        message: result.message,
        record: result.record,
      })
    }),
  )
}
