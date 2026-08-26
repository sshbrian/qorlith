/**
 * Build the Monitor Express app. index.js listens.
 */
import cors from 'cors'
import express from 'express'
import { errorMiddleware } from './errors.mjs'
import { debug as logDebug, info as logInfo } from './log.mjs'

function isNoisyHttp(method, path) {
  if (method !== 'GET') return false
  if (path === '/api/comfy/progress') return true
  return /^\/api\/brain\/[^/]+$/.test(path)
}
import { mountDirector } from './routes/director.mjs'
import { mountFloor } from './routes/floor.mjs'
import { mountGallery } from './routes/gallery.mjs'
import { mountHealth } from './routes/health.mjs'
import { mountProduce } from './routes/produce.mjs'
import { mountStudio } from './routes/studio.mjs'
import { mountTrain } from './routes/train.mjs'
import { mountBrain } from './routes/brain.mjs'

export function createApp() {
  const app = express()
  app.use(cors())
  app.use(express.json({ limit: '2mb' }))
  app.use((req, res, next) => {
    const start = Date.now()
    res.on('finish', () => {
      const fields = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Date.now() - start,
      }
      if (isNoisyHttp(req.method, req.path)) logDebug('http', fields)
      else logInfo('http', fields)
    })
    next()
  })

  mountHealth(app)
  mountFloor(app)
  mountDirector(app)
  mountTrain(app)
  mountGallery(app)
  mountProduce(app)
  mountStudio(app)
  mountBrain(app)

  app.use(errorMiddleware)
  return app
}
