import fs from 'fs'
import path from 'path'
import { fail, wrap } from '../errors.mjs'
import { loadBrain, listBrains, spawnBrain, stopBrain } from '../brainStatus.mjs'
import { loadProjectRecord, projectDir } from '../project.mjs'
import { approvePlan } from '../studioPlanner.mjs'

export function mountBrain(app) {
  app.get(
    '/api/brain',
    wrap(async (_req, res) => {
      res.json({ brains: listBrains(), polledAt: new Date().toISOString() })
    }),
  )

  app.get(
    '/api/brain/:id',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      if (!id) {
        fail(400, 'missing_id', 'project id required', { hint: 'Open a project, then open Make.' })
      }
      const rec = loadProjectRecord(id)
      const view = loadBrain(id)
      if (!rec && !view.started) {
        fail(404, 'brain_not_found', 'No brain run for this project', {
          hint: 'Press Make movie.',
        })
      }
      if (rec?.plan?.title && !view.started) {
        view.title = rec.plan.title
        view.lookTrack = rec.plan.lookTrack || view.lookTrack
        if (rec.plan.videoMode) view.videoMode = rec.plan.videoMode
        if (view.videoMode === 't2v' && Array.isArray(view.steps)) {
          view.steps = view.steps.filter((s) => s.id !== 'stills' && s.id !== 'face_qa')
        }
        view.clips = (rec.plan.clips || []).map((c) => ({
          id: c.id,
          title: c.title || c.id,
          durationSec: c.durationSec ?? null,
          stillBrief: c.stillBrief || null,
          motionBrief: c.motionBrief || null,
          still: null,
          video: null,
          pick: null,
        }))
      }
      res.json({ ok: true, brain: view, polledAt: new Date().toISOString() })
    }),
  )

  app.get(
    '/api/brain/:id/master',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      if (!id) {
        fail(400, 'missing_id', 'project id required', { hint: 'Open a project, then open Make.' })
      }
      const view = loadBrain(id)
      const dest = view.master
      if (!dest) {
        fail(404, 'no_master', 'No master video yet', { hint: 'Finish video first.' })
      }
      const resolved = path.resolve(dest)
      const root = path.resolve(projectDir(id))
      const inside = resolved === root || resolved.startsWith(root + path.sep)
      if (!inside) {
        fail(403, 'path_forbidden', 'master path is not in this project', {
          hint: 'Re-run finish so the master lands in the project folder.',
        })
      }
      if (!fs.existsSync(resolved)) {
        fail(404, 'no_master', 'Master file is missing', { hint: 'Resume finish.' })
      }
      res.sendFile(resolved)
    }),
  )

  app.post(
    '/api/brain/:id/start',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      const rec = loadProjectRecord(id)
      if (!rec) {
        fail(404, 'project_not_found', 'project not found', {
          hint: 'Create the project from the rail first.',
        })
      }
      if (rec?.plan?.clips?.length && !rec.approved) {
        try {
          approvePlan(id, { startProduction: false })
        } catch {
          /* board seed is optional — Brain can still paint */
        }
      }
      const oneClick = Boolean(req.body?.oneClick || req.body?.autoPick)
      const stopAfter = oneClick
        ? 'film'
        : req.body?.stopAfter === 'plan'
          ? 'plan'
          : req.body?.stopAfter === 'film'
            ? 'film'
            : 'stills'
      const spawned = spawnBrain(id, {
        stopAfter,
        autoPick: oneClick,
        videoMode: req.body?.videoMode || rec?.plan?.videoMode,
      })
      res.status(202).json({
        ok: true,
        pid: spawned.pid,
        stopAfter,
        autoPick: oneClick,
        brain: loadBrain(id),
      })
    }),
  )

  app.post(
    '/api/brain/:id/resume',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      const rec = loadProjectRecord(id)
      if (!rec) {
        fail(404, 'project_not_found', 'project not found', {
          hint: 'Create the project from the rail first.',
        })
      }
      const spawned = spawnBrain(id, { resume: true, reviewOk: req.body?.reviewOk !== false })
      res.status(202).json({
        ok: true,
        pid: spawned.pid,
        brain: loadBrain(id),
      })
    }),
  )

  app.post(
    '/api/brain/:id/stop',
    wrap(async (req, res) => {
      const id = String(req.params.id || '').trim()
      if (!id) {
        fail(400, 'missing_id', 'project id required', { hint: 'Open a project, then open Make.' })
      }
      const stopped = stopBrain(id)
      res.json(stopped)
    }),
  )
}
