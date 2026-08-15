/**
 * Overnight produce observe + archive.
 */
import fs from 'fs'
import path from 'path'
import { loadConfig } from '../appConfig.mjs'
import { fail, wrap } from '../errors.mjs'
import {
  addArchivedPaths,
  allowedUnderRoots,
  isMediaFile,
  loadArchiveStore,
} from '../gallery.mjs'
import { safeStat } from '../fsutil.mjs'
import {
  collectPipelineMediaPaths,
  getPipelineDetail,
  listPipelines,
  markPipelineArchivedInRegistry,
} from '../produce.mjs'
import { markStudioProjectArchived } from '../studioPlanner.mjs'

export function mountProduce(app) {
  app.get(
    '/api/produce/pipelines',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const includeArchived =
        req.query?.archived === '1' ||
        req.query?.archived === 'true' ||
        req.query?.includeArchived === '1'
      res.json({
        pipelines: listPipelines(cfg, { includeArchived }),
        polledAt: new Date().toISOString(),
      })
    }),
  )

  app.get(
    '/api/produce/:id',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const includeArchived =
        req.query?.archived === '1' || req.query?.includeArchived === '1'
      const detail = getPipelineDetail(req.params.id, cfg, { includeArchived })
      if (!detail) {
        fail(404, 'unknown_pipeline', 'unknown or archived pipeline', {
          hint: 'Approve the plan in Plan to register a run, or open Gallery → show archived.',
          archived: true,
        })
      }
      res.json({ ok: true, pipeline: detail, polledAt: new Date().toISOString() })
    }),
  )

  app.post(
    '/api/produce/:id/archive',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const roots = cfg.comfyOutputRoots || []
      const id = req.params.id
      const collected = collectPipelineMediaPaths(id, cfg)
      if (!collected) {
        fail(404, 'unknown_pipeline', 'unknown pipeline', {
          hint: 'This project is not registered. Approve the plan in Plan first.',
        })
      }

      const safePaths = (collected.media || []).filter((p) => {
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

      let studio = null
      try {
        studio = markStudioProjectArchived(id, {
          mediaCount: addedCount || collected.media.length,
          roots: collected.roots,
        })
      } catch {
        studio = null
      }

      try {
        if (collected.statusPath && fs.existsSync(collected.statusPath)) {
          const st = JSON.parse(fs.readFileSync(collected.statusPath, 'utf8'))
          st.archived = true
          st.archivedAt = new Date().toISOString()
          if (!st.updatedAt) st.updatedAt = st.archivedAt
          fs.writeFileSync(collected.statusPath, JSON.stringify(st, null, 2), 'utf8')
        }
      } catch {
        /* ignore */
      }

      markPipelineArchivedInRegistry(collected.pipelineId, {
        name: collected.name,
        addedCount,
        mediaCount: collected.media.length,
        roots: collected.roots,
      })

      try {
        if (collected.logPath) {
          const now = new Date().toISOString()
          fs.appendFileSync(
            collected.logPath,
            `[${now}] archived via Produce UI · added=${addedCount} scanned=${collected.media.length}\n`,
            'utf8',
          )
        }
      } catch {
        /* ignore */
      }

      res.json({
        ok: true,
        projectId: collected.pipelineId,
        name: collected.name,
        mediaCount: collected.media.length,
        addedCount,
        sampleAdded: added.slice(0, 5),
        roots: collected.roots,
        archivedTotal,
        studioUpdated: Boolean(studio?.updated),
        removedFromProduce: true,
        message:
          addedCount > 0
            ? `Archived ${addedCount} media file(s) for ${collected.name}. Hidden from All media (files kept on disk).`
            : collected.media.length > 0
              ? `Project ${collected.pipelineId} archived. Media already hidden in All media (${collected.media.length} files).`
              : `Project ${collected.pipelineId} archived. No media files found under stills/video roots.`,
      })
    }),
  )
}
