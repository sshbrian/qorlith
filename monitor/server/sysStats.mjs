/**
 * Local system stats for Qorlith "System" tab (btop-like).
 * Windows-first; pure Node + optional nvidia-smi / PowerShell.
 */
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

/** @type {{ idle: number, total: number }[] | null} */
let prevCpu = null
/** @type {number | null} */
let prevSampleAt = null

function cpuTimes() {
  return os.cpus().map((c) => {
    const t = c.times
    const total = t.user + t.nice + t.sys + t.idle + t.irq + (t.steal || 0)
    return { idle: t.idle, total, model: c.model, speed: c.speed }
  })
}

/**
 * Percent busy per core since last sample (and overall).
 * First call seeds; second+ returns useful deltas.
 */
function sampleCpu() {
  const now = cpuTimes()
  const at = Date.now()
  let cores = now.map((c, i) => ({
    index: i,
    model: c.model,
    speedMhz: c.speed,
    usage: 0,
  }))
  let overall = 0

  if (prevCpu && prevCpu.length === now.length) {
    let busySum = 0
    let totalSum = 0
    cores = now.map((c, i) => {
      const p = prevCpu[i]
      const dTotal = Math.max(1, c.total - p.total)
      const dIdle = Math.max(0, c.idle - p.idle)
      const busy = Math.max(0, dTotal - dIdle)
      const usage = Math.min(100, Math.max(0, (busy / dTotal) * 100))
      busySum += busy
      totalSum += dTotal
      return { index: i, model: c.model, speedMhz: c.speed, usage: Math.round(usage * 10) / 10 }
    })
    overall = totalSum > 0 ? Math.round((busySum / totalSum) * 1000) / 10 : 0
  }

  prevCpu = now.map((c) => ({ idle: c.idle, total: c.total }))
  prevSampleAt = at
  return {
    overall,
    cores,
    count: cores.length,
    model: cores[0]?.model || 'CPU',
    sampleMs: prevSampleAt,
  }
}

function memStats() {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  return {
    total,
    free,
    used,
    usedPercent: total > 0 ? Math.round((used / total) * 1000) / 10 : 0,
    totalHuman: humanBytes(total),
    usedHuman: humanBytes(used),
    freeHuman: humanBytes(free),
  }
}

export function humanBytes(n) {
  const v = Number(n) || 0
  if (v < 1024) return `${v} B`
  const u = ['KB', 'MB', 'GB', 'TB']
  let x = v
  let i = -1
  do {
    x /= 1024
    i++
  } while (x >= 1024 && i < u.length - 1)
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function formatUptime(sec) {
  const s = Math.floor(Number(sec) || 0)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m ${r}s`
  return `${m}m ${r}s`
}

async function runCmd(cmd, args, { timeout = 4000 } = {}) {
  try {
    const { stdout } = await execFileAsync(cmd, args, {
      timeout,
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    })
    return String(stdout || '')
  } catch {
    return ''
  }
}

/** nvidia-smi multi-GPU CSV */
async function gpuStats() {
  const out = await runCmd('nvidia-smi', [
    '--query-gpu=index,name,memory.used,memory.total,utilization.gpu,utilization.memory,temperature.gpu,power.draw,power.limit,fan.speed',
    '--format=csv,noheader,nounits',
  ])
  if (!out.trim()) return []
  return out
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const p = line.split(',').map((s) => s.trim())
      if (p.length < 7) return null
      const memUsed = Number(p[2]) * 1024 * 1024
      const memTotal = Number(p[3]) * 1024 * 1024
      return {
        index: Number(p[0]) || 0,
        name: p[1],
        memUsed,
        memTotal,
        memUsedHuman: humanBytes(memUsed),
        memTotalHuman: humanBytes(memTotal),
        memPercent: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
        utilGpu: Number(p[4]) || 0,
        utilMem: Number(p[5]) || 0,
        tempC: Number(p[6]) || 0,
        powerW: Number(p[7]) || 0,
        powerLimitW: Number(p[8]) || 0,
        fanPercent: p[9] === '[N/A]' || p[9] === '' ? null : Number(p[9]),
      }
    })
    .filter(Boolean)
}

/** PowerShell -EncodedCommand (UTF-16LE) avoids shell quote hell on Windows */
async function psEncoded(script, { timeout = 8000 } = {}) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64')
  return runCmd('powershell.exe', ['-NoProfile', '-EncodedCommand', b64], { timeout })
}

/** Disk volumes: Node fs.statfs (preferred) + PS fallback */
async function diskStats() {
  if (process.platform === 'win32' && typeof fs.promises?.statfs === 'function') {
    const out = []
    for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const root = `${letter}:\\`
      try {
        const s = await fs.promises.statfs(root)
        const bsize = Number(s.bsize) || 4096
        const total = bsize * Number(s.blocks)
        const free = bsize * Number(s.bavail ?? s.bfree)
        if (!total) continue
        const used = Math.max(0, total - free)
        out.push({
          device: `${letter}:`,
          label: '',
          fs: '',
          total,
          free,
          used,
          usedPercent: Math.round((used / total) * 1000) / 10,
          totalHuman: humanBytes(total),
          usedHuman: humanBytes(used),
          freeHuman: humanBytes(free),
        })
      } catch {
        /* drive missing */
      }
    }
    if (out.length) return out
  }

  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object {
  [PSCustomObject]@{
    device=$_.DeviceID; label=$_.VolumeName; fs=$_.FileSystem;
    total=[int64]$_.Size; free=[int64]$_.FreeSpace
  }
} | ConvertTo-Json -Compress
`.trim()
    const out = await psEncoded(script, { timeout: 8000 })
    if (!out.trim()) return []
    try {
      const raw = JSON.parse(out)
      const list = Array.isArray(raw) ? raw : [raw]
      return list
        .filter((d) => d && Number(d.total) > 0)
        .map((d) => {
          const total = Number(d.total)
          const free = Number(d.free)
          const used = Math.max(0, total - free)
          return {
            device: String(d.device || ''),
            label: String(d.label || ''),
            fs: String(d.fs || ''),
            total,
            free,
            used,
            usedPercent: Math.round((used / total) * 1000) / 10,
            totalHuman: humanBytes(total),
            usedHuman: humanBytes(used),
            freeHuman: humanBytes(free),
          }
        })
    } catch {
      return []
    }
  }

  // Unix: parse df -kP
  const out = await runCmd('df', ['-kP'])
  if (!out) return []
  return out
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const parts = line.split(/\s+/)
      if (parts.length < 6) return null
      const total = Number(parts[1]) * 1024
      const used = Number(parts[2]) * 1024
      const free = Number(parts[3]) * 1024
      if (!total) return null
      return {
        device: parts[0],
        label: parts[5],
        fs: '',
        total,
        free,
        used,
        usedPercent: Math.round((used / total) * 1000) / 10,
        totalHuman: humanBytes(total),
        usedHuman: humanBytes(used),
        freeHuman: humanBytes(free),
      }
    })
    .filter(Boolean)
}

/** Top processes by working set (Windows) / RSS */
async function processStats(limit = 18) {
  const n = Math.min(40, Math.max(5, limit))
  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference='SilentlyContinue'
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ${n} Name,Id,CPU,@{n='ws';e={$_.WorkingSet64}} | ConvertTo-Json -Compress
`.trim()
    const out = await psEncoded(script, { timeout: 10000 })
    if (!out.trim()) return []
    try {
      const raw = JSON.parse(out)
      const list = Array.isArray(raw) ? raw : [raw]
      return list.map((p, i) => ({
        rank: i + 1,
        name: String(p.Name || '?'),
        pid: Number(p.Id) || 0,
        cpu: p.CPU != null ? Math.round(Number(p.CPU) * 10) / 10 : null,
        mem: Number(p.ws) || 0,
        memHuman: humanBytes(Number(p.ws) || 0),
      }))
    } catch {
      return []
    }
  }
  // Linux: ps
  const out = await runCmd('ps', ['-eo', 'pid,pcpu,pmem,rss,comm', '--sort=-rss'])
  if (!out) return []
  return out
    .trim()
    .split(/\r?\n/)
    .slice(1, limit + 1)
    .map((line, i) => {
      const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
      if (!m) return null
      const mem = Number(m[4]) * 1024
      return {
        rank: i + 1,
        name: m[5].trim(),
        pid: Number(m[1]),
        cpu: Number(m[2]),
        mem,
        memHuman: humanBytes(mem),
      }
    })
    .filter(Boolean)
}

function netIfaces() {
  const ifs = os.networkInterfaces()
  const out = []
  for (const [name, addrs] of Object.entries(ifs || {})) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.internal) continue
      out.push({
        name,
        family: a.family,
        address: a.address,
        mac: a.mac,
      })
    }
  }
  return out
}

/**
 * Full snapshot for GET /api/system/stats
 */
export async function collectSystemStats() {
  // Prime CPU then brief wait on first call is handled by client double-poll;
  // still sample once here (second sample will be better after prevCpu set).
  const cpu1 = sampleCpu()
  // Small sleep for better first-paint delta when prev was set from prior request
  await new Promise((r) => setTimeout(r, 120))
  const cpu = sampleCpu()
  // Prefer second sample if we had a baseline
  const cpuOut = cpu1.overall === 0 && cpu.overall > 0 ? cpu : cpu.overall > 0 || prevCpu ? cpu : cpu1

  const [gpus, disks, processes] = await Promise.all([
    gpuStats(),
    diskStats(),
    processStats(18),
  ])

  const mem = memStats()
  const load = os.loadavg()

  return {
    ok: true,
    at: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      uptimeSec: os.uptime(),
      uptimeHuman: formatUptime(os.uptime()),
      node: process.version,
    },
    cpu: {
      ...cpuOut,
      loadAvg: load, // often [0,0,0] on Windows
    },
    memory: mem,
    gpus,
    disks,
    processes,
    network: netIfaces(),
  }
}

/** Warm CPU baseline so first UI poll is useful */
export function warmCpuBaseline() {
  sampleCpu()
}
