/**
 * Floor ops log.
 */
import { wrap } from '../errors.mjs'
import { loadFloorStatus, postFloorUpdate } from '../floorStatus.mjs'
import { loadConfig } from '../appConfig.mjs'
import { floorOverlayFromBrain, listBrains } from '../brainStatus.mjs'
import { floorOverlayFromProduce, getPipelineDetail, listPipelines } from '../produce.mjs'

function floorStatusPayload() {
  let status = loadFloorStatus()
  try {
    const brains = listBrains()
    const preferred =
      brains.find((b) => b.running) ||
      brains.find((b) => b.status === 'done') ||
      brains.find((b) => b.started)
    if (preferred?.started) return floorOverlayFromBrain(preferred, status)
  } catch {
    /* ignore brain overlay errors */
  }
  try {
    const cfg = loadConfig()
    const pipes = listPipelines(cfg)
    const preferred = pipes.find((p) => p.active) || pipes.find((p) => p.okCount > 0) || null
    if (preferred) {
      const detail = getPipelineDetail(preferred.id, cfg)
      if (detail && detail.total > 0) {
        status = floorOverlayFromProduce(detail, status)
      }
    }
  } catch {
    /* ignore produce overlay errors */
  }
  return status
}

export function mountFloor(app) {
  app.get(
    '/api/floor/status',
    wrap(async (_req, res) => {
      res.json({ ok: true, status: floorStatusPayload() })
    }),
  )

  app.post(
    '/api/floor/update',
    wrap(async (req, res) => {
      const body = req.body || {}
      const status = postFloorUpdate({
        text: body.text,
        mood: body.mood,
        kind: body.kind,
        statusLine: body.statusLine,
        song: body.song,
        songPlaying: body.songPlaying,
        progress: body.progress,
        imageUrl: body.imageUrl,
        imagePath: body.imagePath,
        addPhoto: Boolean(body.addPhoto || body.imagePath || body.imageUrl),
        photoCaption: body.photoCaption || body.text,
        employeePhotoUrl: body.employeePhotoUrl,
        photos: body.photos,
        about: body.about,
      })
      res.json({ ok: true, status })
    }),
  )
}
