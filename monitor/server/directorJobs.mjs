/**
 * Director job progress. Kept in memory and on disk so a Monitor
 * restart does not lose a job Brain is waiting on.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { getComfyProgress } from './comfyProgress.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const JOB_DIR = process.env.QORLITH_JOBS || path.join(ROOT, 'data', 'director-jobs')
const jobs = new Map()
const TTL_MS = 2 * 60 * 60 * 1000

function jobPath(id) {
  return path.join(JOB_DIR, `${id}.json`)
}

function persist(job) {
  if (!job?.id) return
  try {
    fs.mkdirSync(JOB_DIR, { recursive: true })
    fs.writeFileSync(jobPath(job.id), `${JSON.stringify(job)}\n`)
  } catch {
    /* disk full or test env — memory still works */
  }
}

function loadFromDisk(id) {
  const file = jobPath(id)
  if (!fs.existsSync(file)) return null
  try {
    const job = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!job || typeof job !== 'object') return null
    jobs.set(id, job)
    return job
  } catch {
    return null
  }
}

function prune() {
  const now = Date.now()
  for (const [id, j] of jobs) {
    if (now - (j.updatedAt || j.createdAt) > TTL_MS) {
      jobs.delete(id)
      try {
        fs.unlinkSync(jobPath(id))
      } catch {
        /* ignore */
      }
    }
  }
}

export function createDirectorJob(kind = 'still') {
  prune()
  const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const job = {
    id,
    kind,
    status: 'running', // running | success | error
    stages: [],
    result: null,
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  jobs.set(id, job)
  persist(job)
  return job
}

export function pushJobStage(jobId, stageEvent) {
  const job = jobs.get(jobId) || loadFromDisk(jobId)
  if (!job) return
  job.stages.push({
    stage: stageEvent.stage,
    detail: stageEvent.detail,
    at: stageEvent.at || new Date().toISOString(),
  })
  job.updatedAt = Date.now()
  persist(job)
}

export function completeJob(jobId, result) {
  const job = jobs.get(jobId) || loadFromDisk(jobId)
  if (!job) return
  job.status = 'success'
  job.result = result
  job.updatedAt = Date.now()
  persist(job)
}

export function failJob(jobId, error, partial = {}) {
  const job = jobs.get(jobId) || loadFromDisk(jobId)
  if (!job) return
  job.status = 'error'
  job.error = typeof error === 'string' ? error : error?.message || String(error)
  if (partial.stages) job.stages = partial.stages
  if (partial.plan) job.plan = partial.plan
  if (partial.result) job.result = partial.result
  job.updatedAt = Date.now()
  persist(job)
}

export function getJob(jobId) {
  prune()
  return jobs.get(jobId) || loadFromDisk(jobId)
}

export function jobPublic(job) {
  if (!job) return null
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    stages: job.stages,
    error: job.error,
    result: job.result,
    plan: job.plan || job.result?.plan || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    comfy: job.status === 'running' ? getComfyProgress() : null,
  }
}
