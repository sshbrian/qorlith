/**
 * Shared Comfy HTTP: request + health + wait for a prompt id.
 */
import { getComfyUrl } from './studioConfig.mjs'
import { fail } from './errors.mjs'
import { info as logInfo } from './log.mjs'
import { COMFY_CLIENT_ID } from './comfyProgress.mjs'

export { COMFY_CLIENT_ID }

export async function comfyApi(comfyBase, method, p, body) {
  const r = await fetch(`${String(comfyBase || getComfyUrl()).replace(/\/$/, '')}${p}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    fail(502, 'comfy_http', `Comfy ${method} ${p}: ${r.status} ${t.slice(0, 400)}`, {
      hint: 'Is ComfyUI running on the URL in qorlith.yaml?',
    })
  }
  if (r.status === 204) return null
  return r.json()
}

export async function comfyQueue(comfyBase) {
  return comfyApi(comfyBase, 'GET', '/queue')
}

export function queueIsBusy(queue) {
  const running = queue?.queue_running || []
  const pending = queue?.queue_pending || []
  return Boolean((Array.isArray(running) && running.length) || (Array.isArray(pending) && pending.length))
}

export async function comfyBusy(comfyBase) {
  return queueIsBusy(await comfyQueue(comfyBase))
}

export async function assertComfyIdle(comfyBase) {
  if (await comfyBusy(comfyBase)) {
    fail(409, 'comfy_busy', 'Comfy already has work in the queue', {
      hint: 'Wait for the current render, then retry. Make will not clear the queue.',
    })
  }
}

/** Unload loaded checkpoints / MiniMax and release VRAM. Soft enough to call after every film. */
export async function comfyFreeMemory(comfyBase) {
  const base = String(comfyBase || getComfyUrl()).replace(/\/$/, '')
  const r = await fetch(`${base}/free`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ unload_models: true, free_memory: true }),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    fail(502, 'comfy_free', `Comfy POST /free: ${r.status} ${t.slice(0, 400)}`, {
      hint: 'Is ComfyUI running on the URL in qorlith.yaml?',
    })
  }
  logInfo('comfy.free', { unload_models: true })
  return { ok: true }
}

export async function comfyHealth(comfyBase) {
  const base = comfyBase || getComfyUrl()
  try {
    const stats = await comfyApi(base, 'GET', '/system_stats')
    const dev = stats?.devices?.[0]
    return { ok: true, device: dev?.name || null, stats }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Poll /history/:id until outputs appear, success, or timeout.
 */
export async function waitForHistory(comfyBase, promptId, opts = {}) {
  const waitMs = opts.waitMs ?? 600_000
  const pollMs = opts.pollMs ?? 2000
  const onProgress = opts.onProgress || (() => {})
  const deadline = Date.now() + waitMs
  let historyEntry = null
  while (Date.now() < deadline) {
    onProgress({ stage: 'comfy_wait', detail: promptId })
    try {
      const hist = await comfyApi(comfyBase, 'GET', `/history/${promptId}`)
      if (hist && hist[promptId]) {
        historyEntry = hist[promptId]
        const st = historyEntry?.status?.status_str
        if (st === 'error') {
          const msgs = historyEntry?.status?.messages || []
          fail(502, 'comfy_job', `Comfy job error: ${JSON.stringify(msgs).slice(0, 400)}`, {
            hint: 'Open the Comfy queue for the full node error.',
          })
        }
        if (historyEntry.outputs && Object.keys(historyEntry.outputs).length) break
        if (st === 'success') break
      }
    } catch (e) {
      if (e?.status === 502) throw e
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  if (!historyEntry?.outputs) {
    fail(504, 'comfy_timeout', `Comfy job timed out: ${promptId}`, {
      hint: 'Check VRAM and the Comfy queue, then retry.',
    })
  }
  logInfo('comfy.done', { promptId })
  return historyEntry
}
