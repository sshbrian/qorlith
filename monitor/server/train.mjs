/**
 * Kohya run discovery, log tails, and train.meta merge.
 */
import fs from 'fs'
import path from 'path'
import { decodeLogBuffer, mergeTrainMeta, parseTrainMeta } from './progress.mjs'
import { humanSize, listDirs, listFiles, safeStat, walkFiles } from './fsutil.mjs'

export function isTextTrainLog(filePath) {
  const base = path.basename(filePath).toLowerCase()
  if (base.endsWith('.log') || base.endsWith('.txt')) return true
  // Kohya sometimes leaves plain stdout captures without extension
  if (/^train/i.test(base) && !base.includes('tfevents')) return true
  return false
}

export function isTfEvents(filePath) {
  const base = path.basename(filePath).toLowerCase()
  return base.includes('tfevents') || base.endsWith('.tfevents')
}

export function parseEpochFromName(name) {
  // epoch suffix: name-000008.safetensors
  const m = name.match(/-(\d{6})\.safetensors$/i) || name.match(/-(\d+)\.safetensors$/i)
  if (m) return Number(m[1])
  if (/\.safetensors$/i.test(name) && !/-\d+\.safetensors$/i.test(name)) return null // final
  return null
}

export function fileMeta(filePath, displayName) {
  const s = safeStat(filePath)
  if (!s || !s.isFile()) return null
  return {
    path: filePath,
    name: displayName || path.basename(filePath),
    size: s.size,
    mtime: s.mtimeMs,
    mtimeIso: s.mtime.toISOString(),
  }
}

export function runDirActivityMtime(runDir) {
  let latest = 0
  try {
    for (const f of walkFiles(runDir, { maxDepth: 2 })) {
      const s = safeStat(f)
      if (s && s.mtimeMs > latest) latest = s.mtimeMs
    }
  } catch {
    /* ignore */
  }
  const st = safeStat(runDir)
  if (st && st.mtimeMs > latest) latest = st.mtimeMs
  return latest
}

export function discoverRuns(cfg) {
  const runs = []
  for (const root of cfg.outputRoots || []) {
    const st = safeStat(root)
    if (!st) continue

    // Root may contain run subdirs OR flat safetensors / logs
    const subdirs = listDirs(root)
    const candidates = subdirs.length ? subdirs : [root]

    for (const runDir of candidates) {
      const ckptFiles = listFiles(runDir, ['.safetensors'])
      const logFiles = listFiles(runDir, ['.log', '.txt']).filter((f) => isTextTrainLog(f))
      // Also accept run dirs that only have activity (e.g. mid-train before first save)
      const activityMtime = runDirActivityMtime(runDir)
      const hasSignal = ckptFiles.length > 0 || logFiles.length > 0 || activityMtime > 0

      if (!hasSignal) continue
      // Skip bare empty root when we expected subdirs
      if (runDir === root && subdirs.length && !ckptFiles.length && !logFiles.length) continue

      const checkpoints = ckptFiles
        .map((f) => {
          const s = safeStat(f)
          if (!s) return null
          const base = path.basename(f)
          return {
            name: base,
            path: f,
            epoch: parseEpochFromName(base),
            size: s.size,
            sizeHuman: humanSize(s.size),
            mtime: s.mtimeMs,
            mtimeIso: s.mtime.toISOString(),
          }
        })
        .filter(Boolean)
        .sort((a, b) => a.mtime - b.mtime)

      const latestCkpt = checkpoints.length ? checkpoints[checkpoints.length - 1] : null
      const epochs = checkpoints.map((c) => c.epoch).filter((e) => e != null)
      const maxEpoch = epochs.length ? Math.max(...epochs) : null

      // Prefer checkpoint mtime; else newest log / any file in run dir
      let latestMtime = latestCkpt?.mtime || 0
      let latestName = latestCkpt?.name || null
      if (!latestCkpt) {
        const logsMeta = logFiles.map((f) => fileMeta(f)).filter(Boolean)
        logsMeta.sort((a, b) => b.mtime - a.mtime)
        if (logsMeta[0]) {
          latestMtime = Math.max(latestMtime, logsMeta[0].mtime)
          latestName = logsMeta[0].name
        }
        if (activityMtime > latestMtime) latestMtime = activityMtime
        if (!latestName) latestName = '(no checkpoints yet)'
      }

      const totalSize = checkpoints.reduce((s, c) => s + c.size, 0)
      const id = Buffer.from(runDir).toString('base64url')

      runs.push({
        id,
        name: path.basename(runDir),
        dir: runDir,
        root,
        checkpointCount: checkpoints.length,
        latestEpoch: maxEpoch,
        latestName,
        latestMtime,
        latestMtimeIso: latestMtime ? new Date(latestMtime).toISOString() : new Date(0).toISOString(),
        totalSize,
        totalSizeHuman: humanSize(totalSize),
        checkpoints,
        logs: logFiles.map((f) => path.basename(f)),
      })
    }
  }

  runs.sort((a, b) => b.latestMtime - a.latestMtime)
  return runs
}

export function findTrainLogs(cfg) {
  const logs = []
  const seen = new Set()

  function addLog(filePath, displayName) {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) return
    if (!isTextTrainLog(resolved)) return
    const meta = fileMeta(resolved, displayName)
    if (!meta) return
    // Skip empty noise
    if (meta.size === 0) return
    seen.add(resolved)
    logs.push(meta)
  }

  // Configured log roots (recursive — TensorBoard trees + stray .log)
  for (const root of cfg.logRoots || []) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 5 })) {
      if (isTextTrainLog(f)) {
        addLog(f, path.relative(root, f) || path.basename(f))
      }
    }
  }

  // All text logs under each output root / run folder (train.log, train_direct.log, …)
  for (const root of cfg.outputRoots || []) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 3 })) {
      if (isTextTrainLog(f)) {
        addLog(f, path.relative(root, f) || path.basename(f))
      }
    }
  }

  // Explicit globs are simple suffix patterns we already cover; keep mtime sort for listing
  logs.sort((a, b) => b.mtime - a.mtime || b.size - a.size)
  return logs
}

/** Newest TensorBoard / activity file mtime under logRoots (binary; not tailed). */
export function findLatestActivityMtime(cfg) {
  let latest = 0
  let source = null
  for (const root of cfg.logRoots || []) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 6 })) {
      if (!isTfEvents(f) && !isTextTrainLog(f)) continue
      const s = safeStat(f)
      if (s && s.mtimeMs > latest) {
        latest = s.mtimeMs
        source = f
      }
    }
  }
  for (const root of cfg.outputRoots || []) {
    if (!safeStat(root)) continue
    for (const f of walkFiles(root, { maxDepth: 3 })) {
      const s = safeStat(f)
      if (s && s.mtimeMs > latest) {
        latest = s.mtimeMs
        source = f
      }
    }
  }
  return { mtime: latest, path: source }
}

/**
 * Prefer a substantial training stdout log over a tiny banner-only train.log.
 * Read-only scoring; does not touch training writers.
 */
export function pickBestLog(logs) {
  if (!logs.length) return null
  let best = null
  let bestScore = -Infinity
  for (const log of logs) {
    const base = path.basename(log.path).toLowerCase()
    let score = log.mtime
    // Prefer content-rich logs (banner-only train.log is often ~200B)
    if (log.size >= 1024) score += 5 * 60_000
    if (log.size >= 10_000) score += 5 * 60_000
    if (/train/i.test(base)) score += 30_000
    // Penalize near-empty primary train.log so train_direct.log / train.err.log win mid-run
    if (base === 'train.log' && log.size < 512) score -= 15 * 60_000
    // Prefer names the train scripts actually use (tqdm lives on stderr → train.err.log)
    if (/train_direct|train\.err|train\.log|stdout|stderr/i.test(base)) score += 15_000
    if (/\.err\.log$/i.test(base) && log.size >= 1024) score += 20_000
    if (score > bestScore) {
      bestScore = score
      best = log
    }
  }
  return best
}

export function findLogsForRunDir(runDir) {
  const logs = []
  const seen = new Set()
  for (const f of listFiles(runDir, ['.log', '.txt'])) {
    if (!isTextTrainLog(f) || seen.has(f)) continue
    const meta = fileMeta(f, path.basename(f))
    if (!meta || meta.size === 0) continue
    seen.add(f)
    logs.push(meta)
  }
  logs.sort((a, b) => b.mtime - a.mtime || b.size - a.size)
  return logs
}

export function readFileSlice(filePath, start, length) {
  const s = safeStat(filePath)
  if (!s || !s.isFile()) return { text: '', size: 0, mtime: 0 }
  const fd = fs.openSync(filePath, 'r')
  try {
    const buf = Buffer.alloc(length)
    const n = fs.readSync(fd, buf, 0, length, start)
    return {
      text: decodeLogBuffer(buf.subarray(0, n)),
      size: s.size,
      mtime: s.mtimeMs,
    }
  } finally {
    fs.closeSync(fd)
  }
}

export function tailFile(filePath, maxBytes = 64_000) {
  const s = safeStat(filePath)
  if (!s) return { text: '', size: 0 }
  // For UTF-16, read a bit more and keep even length for cleaner decode
  let start = Math.max(0, s.size - maxBytes)
  if (start % 2 === 1) start -= 1
  return readFileSlice(filePath, start, s.size - start)
}

/** Config dump lives at the start of Kohya logs — head, not tail. */
export function headFile(filePath, maxBytes = 120_000) {
  const s = safeStat(filePath)
  if (!s) return { text: '', size: 0 }
  let len = Math.min(s.size, maxBytes)
  if (len % 2 === 1) len -= 1
  return readFileSlice(filePath, 0, Math.max(0, len))
}

export function readJsonMeta(runDir) {
  const p = path.join(runDir, 'train.meta.json')
  if (!safeStat(p)) return null
  try {
    let raw = fs.readFileSync(p, 'utf8')
    // PowerShell Set-Content -Encoding utf8 writes a UTF-8 BOM
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Build train meta from train.meta.json + heads of logs in the same folder / best log dir.
 */
export function collectTrainMeta(logMeta, runDirHint) {
  const chunks = []
  const dirs = new Set()
  if (logMeta?.path) {
    dirs.add(path.dirname(logMeta.path))
    chunks.push(headFile(logMeta.path, 140_000).text)
  }
  if (runDirHint) dirs.add(runDirHint)

  for (const dir of dirs) {
    for (const f of listFiles(dir, ['.log', '.txt'])) {
      if (logMeta?.path && path.resolve(f) === path.resolve(logMeta.path)) continue
      const base = path.basename(f).toLowerCase()
      if (!/train|stdout|stderr|err|direct/i.test(base)) continue
      chunks.push(headFile(f, 100_000).text)
    }
  }

  const fromLog = parseTrainMeta(chunks.filter(Boolean).join('\n\n'))
  let json = null
  for (const dir of dirs) {
    json = readJsonMeta(dir)
    if (json) break
  }
  return mergeTrainMeta(fromLog, json)
}

export function isActive(mtimeMs, cfg) {
  const windowMs = (cfg.activeWindowMinutes || 15) * 60 * 1000
  return Date.now() - mtimeMs < windowMs
}
