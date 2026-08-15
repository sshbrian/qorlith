/**
 * Health + host stats.
 */
import { wrap } from '../errors.mjs'
import { collectSystemStats, warmCpuBaseline } from '../sysStats.mjs'

export function mountHealth(app) {
  warmCpuBaseline()

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, product: 'Qorlith', time: new Date().toISOString() })
  })

  app.get(
    '/api/system/stats',
    wrap(async (_req, res) => {
      const stats = await collectSystemStats()
      res.json(stats)
    }),
  )
}
