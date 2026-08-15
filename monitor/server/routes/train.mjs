/**
 * Config + Kohya status / runs / log tail.
 */
import path from 'path'
import { loadConfig, saveConfig } from '../appConfig.mjs'
import { fail, wrap } from '../errors.mjs'
import { parseProgress } from '../progress.mjs'
import {
  collectTrainMeta,
  discoverRuns,
  findLatestActivityMtime,
  findLogsForRunDir,
  findTrainLogs,
  isActive,
  pickBestLog,
  tailFile,
} from '../train.mjs'

export function mountTrain(app) {
  app.get('/api/config', (_req, res) => {
    res.json(loadConfig())
  })

  app.put(
    '/api/config',
    wrap(async (req, res) => {
      const next = saveConfig(req.body || {})
      res.json(next)
    }),
  )

  app.get(
    '/api/status',
    wrap(async (_req, res) => {
      const cfg = loadConfig()
      const runs = discoverRuns(cfg)
      const logs = findTrainLogs(cfg)
      const latestRun = runs[0] || null
      const latestLog = pickBestLog(logs)

      let progress = null
      if (latestLog) {
        const logTail = tailFile(latestLog.path)
        progress = parseProgress(logTail.text)
      }

      const trainMeta = collectTrainMeta(latestLog, latestRun?.dir || null)
      const activity = findLatestActivityMtime(cfg)
      const activeFromRun = latestRun && isActive(latestRun.latestMtime, cfg)
      const activeFromLog = latestLog && isActive(latestLog.mtime, cfg)
      const activeFromFs = activity.mtime > 0 && isActive(activity.mtime, cfg)

      res.json({
        trainingActive: Boolean(activeFromRun || activeFromLog || activeFromFs),
        latestRun,
        latestLog,
        progress,
        trainMeta,
        runCount: runs.length,
        logCount: logs.length,
        activitySource: activity.path,
        polledAt: new Date().toISOString(),
      })
    }),
  )

  app.get(
    '/api/runs',
    wrap(async (_req, res) => {
      const cfg = loadConfig()
      const runs = discoverRuns(cfg).map(({ checkpoints, ...rest }) => ({
        ...rest,
        active: isActive(rest.latestMtime, cfg),
      }))
      res.json({ runs })
    }),
  )

  app.get(
    '/api/runs/:id',
    wrap(async (req, res) => {
      const cfg = loadConfig()
      const runs = discoverRuns(cfg)
      const run = runs.find((r) => r.id === req.params.id)
      if (!run) {
        fail(404, 'run_not_found', 'Run not found', {
          hint: 'Open Train and pick a run from the list.',
        })
      }

      const runLogs = findLogsForRunDir(run.dir)
      const best = pickBestLog(runLogs)
      let log = null
      let progress = null
      if (best) {
        const t = tailFile(best.path)
        log = { path: best.path, name: best.name, ...t }
        progress = parseProgress(t.text)
      }
      const trainMeta = collectTrainMeta(best, run.dir)

      res.json({
        run: {
          ...run,
          active: isActive(run.latestMtime, cfg),
          logFiles: runLogs.map((l) => ({
            path: l.path,
            name: l.name,
            size: l.size,
            mtimeIso: l.mtimeIso,
          })),
        },
        log,
        progress,
        trainMeta,
      })
    }),
  )

  app.get(
    '/api/logs/tail',
    wrap(async (req, res) => {
      const file = req.query.path
      if (!file || typeof file !== 'string') {
        fail(400, 'missing_path', 'path query required', {
          hint: 'Pass ?path= to a train log under the watch roots.',
        })
      }
      const cfg = loadConfig()
      const allowed = [...(cfg.outputRoots || []), ...(cfg.logRoots || [])]
      const resolved = path.resolve(file)
      const ok = allowed.some((root) =>
        resolved.toLowerCase().startsWith(path.resolve(root).toLowerCase()),
      )
      if (!ok) {
        fail(403, 'path_forbidden', 'path not allowed', {
          hint: 'Log tails must live under train.output_roots or train.log_roots in qorlith.yaml.',
        })
      }

      const t = tailFile(resolved)
      res.json({
        path: resolved,
        ...t,
        progress: parseProgress(t.text),
      })
    }),
  )
}
