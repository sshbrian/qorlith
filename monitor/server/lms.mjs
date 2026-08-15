/**
 * LM Studio automation via `lms` CLI (load / unload / server).
 * Requires LM Studio installed; CLI typically at %USERPROFILE%\.lmstudio\bin\lms.exe
 */
import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const DEFAULT_LMS = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms')

/**
 * @param {object} [opts]
 * @param {string} [opts.lmsPath]
 */
export function resolveLmsPath(opts = {}) {
  if (opts.lmsPath && fs.existsSync(opts.lmsPath)) return opts.lmsPath
  if (fs.existsSync(DEFAULT_LMS)) return DEFAULT_LMS
  // PATH fallback
  return process.platform === 'win32' ? 'lms.exe' : 'lms'
}

/**
 * @param {string} lmsPath
 * @param {string[]} args
 * @param {{ timeoutMs?: number, input?: string }} [opts]
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runLms(lmsPath, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 600_000
  return new Promise((resolve, reject) => {
    const child = spawn(lmsPath, args, {
      windowsHide: true,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      reject(Object.assign(new Error(`lms ${args[0]} timed out after ${timeoutMs}ms`), { status: 504 }))
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(
        Object.assign(
          new Error(
            `Failed to run lms (${lmsPath}): ${err.message}. Is LM Studio installed? CLI: ${DEFAULT_LMS}`,
          ),
          { status: 500 },
        ),
      )
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    if (opts.input) {
      child.stdin.write(opts.input)
    }
    child.stdin.end()
  })
}

/**
 * @param {string} lmsPath
 */
export async function serverStatus(lmsPath) {
  const { code, stdout, stderr } = await runLms(lmsPath, ['server', 'status', '--json'], {
    timeoutMs: 15_000,
  })
  if (code !== 0) {
    return { running: false, port: null, error: stderr || stdout || `exit ${code}` }
  }
  try {
    const j = JSON.parse(stdout.trim() || '{}')
    return {
      running: Boolean(j.running),
      port: j.port ?? null,
      raw: j,
    }
  } catch {
    return { running: false, port: null, error: 'bad status json', stdout }
  }
}

/**
 * Ensure local API server is up (default port 1234).
 * @param {string} lmsPath
 * @param {{ port?: number, cors?: boolean }} [opts]
 */
export async function ensureServer(lmsPath, opts = {}) {
  const st = await serverStatus(lmsPath)
  if (st.running) {
    return { started: false, ...st }
  }
  const args = ['server', 'start']
  if (opts.port) {
    args.push('--port', String(opts.port))
  }
  // CORS helps browser tools; Qorlith API is server-side so optional
  if (opts.cors !== false) args.push('--cors')
  const { code, stdout, stderr } = await runLms(lmsPath, args, { timeoutMs: 60_000 })
  // server start may return non-zero if already starting; re-check
  const after = await serverStatus(lmsPath)
  if (!after.running) {
    throw Object.assign(
      new Error(
        `Could not start LM Studio server (exit ${code}): ${(stderr || stdout || '').slice(0, 400)}`,
      ),
      { status: 502 },
    )
  }
  return { started: true, ...after }
}

/**
 * @param {string} lmsPath
 */
export async function listDiskModels(lmsPath) {
  const { code, stdout, stderr } = await runLms(lmsPath, ['ls', '--json', '--llm'], {
    timeoutMs: 30_000,
  })
  if (code !== 0) {
    throw Object.assign(new Error(`lms ls failed: ${stderr || stdout}`), { status: 500 })
  }
  try {
    const data = JSON.parse(stdout || '[]')
    return Array.isArray(data) ? data : []
  } catch (e) {
    throw Object.assign(new Error(`lms ls JSON parse: ${e}`), { status: 500 })
  }
}

/**
 * Pick best model key from disk list using preference keywords / exact key.
 * @param {Array<{ modelKey?: string, path?: string, displayName?: string }>} models
 * @param {{ modelKey?: string, prefer?: string[] }} selector
 */
export function resolveModelKey(models, selector = {}) {
  if (!models?.length) return null
  const exact = String(selector.modelKey || '').trim()
  if (exact) {
    const hit = models.find(
      (m) =>
        m.modelKey === exact ||
        m.path === exact ||
        String(m.path || '').includes(exact) ||
        String(m.modelKey || '').includes(exact),
    )
    if (hit) return hit.modelKey || hit.path
    // still try loading by exact key (lms may resolve)
    return exact
  }
  const prefer = Array.isArray(selector.prefer) ? selector.prefer : []
  const scored = models.map((m) => {
    const blob = `${m.modelKey || ''} ${m.path || ''} ${m.displayName || ''}`.toLowerCase()
    let score = 0
    prefer.forEach((kw, i) => {
      const k = String(kw).toLowerCase()
      if (!k) return
      if (blob.includes(k)) score += 100 - i
    })
    // prefer higher quants slightly? skip
    // deprioritize vision-only noise
    return { m, score, blob }
  })
  scored.sort((a, b) => b.score - a.score)
  if (scored[0].score > 0) return scored[0].m.modelKey
  // fallback first model
  return models[0].modelKey
}

/**
 * @param {string} lmsPath
 * @param {string} modelKey
 * @param {{ gpu?: string, contextLength?: number, identifier?: string, ttlSeconds?: number }} [opts]
 */
export async function loadModel(lmsPath, modelKey, opts = {}) {
  const args = ['load', modelKey, '-y']
  if (opts.gpu) {
    args.push('--gpu', String(opts.gpu))
  }
  if (opts.contextLength) {
    args.push('--context-length', String(opts.contextLength))
  }
  if (opts.identifier) {
    args.push('--identifier', opts.identifier)
  }
  if (opts.ttlSeconds) {
    args.push('--ttl', String(opts.ttlSeconds))
  }
  const { code, stdout, stderr } = await runLms(lmsPath, args, { timeoutMs: 600_000 })
  if (code !== 0) {
    throw Object.assign(
      new Error(`lms load failed for ${modelKey}: ${(stderr || stdout).slice(0, 500)}`),
      { status: 502 },
    )
  }
  return { modelKey, stdout: stdout.trim(), stderr: stderr.trim() }
}

/**
 * @param {string} lmsPath
 * @param {{ all?: boolean, identifier?: string }} [opts]
 */
export async function unloadModels(lmsPath, opts = {}) {
  const args = opts.all !== false && !opts.identifier ? ['unload', '--all'] : ['unload']
  if (opts.identifier) args.push(opts.identifier)
  const { code, stdout, stderr } = await runLms(lmsPath, args, { timeoutMs: 120_000 })
  // unload with nothing loaded may fail — treat as soft success
  return {
    ok: code === 0,
    code,
    stdout: stdout.trim(),
    stderr: stderr.trim(),
  }
}

/**
 * Full ensure: server up, optional unload, load preferred model.
 * @param {object} cfg director config
 * @param {(ev: { stage: string, detail?: string }) => void} [onProgress]
 */
export async function preparePlanModel(cfg, onProgress = () => {}) {
  const lmsPath = resolveLmsPath(cfg)
  onProgress({ stage: 'lms_cli', detail: lmsPath })

  const port = cfg.serverPort || 1234
  onProgress({ stage: 'ensure_server', detail: `port ${port}` })
  const server = await ensureServer(lmsPath, { port, cors: true })

  onProgress({ stage: 'list_models' })
  const disk = await listDiskModels(lmsPath)
  const selector = {
    modelKey: cfg.planModelKey || cfg.model || '',
    prefer: Array.isArray(cfg.planModelPrefer) ? cfg.planModelPrefer : [],
  }
  const modelKey = resolveModelKey(disk, selector)
  if (!modelKey) {
    throw Object.assign(
      new Error(
        'No LLM models found in LM Studio. Download a chat model, then set planner.prefer in qorlith.yaml if you want a preferred match.',
      ),
      { status: 400 },
    )
  }
  onProgress({ stage: 'resolved_model', detail: modelKey })

  if (cfg.unloadBeforeLoad !== false) {
    onProgress({ stage: 'unload_existing' })
    await unloadModels(lmsPath, { all: true })
  }

  onProgress({ stage: 'load_model', detail: modelKey })
  await loadModel(lmsPath, modelKey, {
    gpu: cfg.gpu || 'max',
    contextLength: cfg.contextLength || 8192,
    identifier: cfg.planIdentifier || 'qorlith-director',
    ttlSeconds: cfg.modelTtlSeconds || undefined,
  })

  // API model id after load — prefer identifier for chat completions
  const apiModel = cfg.planIdentifier || 'qorlith-director'

  return {
    lmsPath,
    modelKey,
    apiModel,
    server,
    diskCount: disk.length,
  }
}

/**
 * Unload director models to free VRAM for Comfy.
 */
export async function releasePlanModel(cfg, onProgress = () => {}) {
  if (cfg.unloadAfterPlan === false) {
    onProgress({ stage: 'unload_skipped', detail: 'unloadAfterPlan=false' })
    return { skipped: true }
  }
  const lmsPath = resolveLmsPath(cfg)
  onProgress({ stage: 'unload_after_plan' })
  const r = await unloadModels(lmsPath, { all: true })
  return { skipped: false, ...r }
}
