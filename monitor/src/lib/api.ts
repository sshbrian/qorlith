export type Checkpoint = {
  name: string
  path: string
  epoch: number | null
  size: number
  sizeHuman: string
  mtime: number
  mtimeIso: string
}

export type Run = {
  id: string
  name: string
  dir: string
  root: string
  checkpointCount: number
  latestEpoch: number | null
  latestName: string
  latestMtime: number
  latestMtimeIso: string
  totalSize: number
  totalSizeHuman: string
  checkpoints?: Checkpoint[]
  active?: boolean
}

export type Progress = {
  epoch: { current: number; total: number } | null
  step: number | null
  maxSteps: number | null
  loss: number | null
  avgLoss: number | null
  lr: number | null
  percent: number | null
  overallPercent: number | null
  itPerSec: number | null
  secPerIt: number | null
  samplesPerSec: number | null
  batchSize: number | null
  etaSeconds: number | null
  etaTotalSeconds: number | null
  elapsedSeconds: number | null
  phase: string | null
  etaHuman: string | null
  etaTotalHuman: string | null
  elapsedHuman: string | null
  recentLines: string[]
}

/** Model + hyperparams from Kohya log head and/or train.meta.json */
export type TrainMeta = {
  method: string | null
  networkModule: string | null
  networkDim: number | null
  networkAlpha: number | null
  baseModel: string | null
  baseModelPath: string | null
  outputName: string | null
  outputDir: string | null
  datasetDir: string | null
  classTokens: string | null
  imageCount: number | null
  trainImagesWithRepeats: number | null
  regImages: number | null
  batchSize: number | null
  resolution: string | null
  enableBucket: boolean | null
  minBucketReso: number | null
  maxBucketReso: number | null
  bucketResoSteps: number | null
  epochs: number | null
  stepsPerEpoch: number | null
  totalSteps: number | null
  optimizer: string | null
  learningRate: number | null
  unetLr: number | null
  textEncoderLr: number | null
  lrScheduler: string | null
  lrWarmupSteps: number | null
  mixedPrecision: string | null
  savePrecision: string | null
  attention: string | null
  unetDtype: string | null
  clipSkip: number | null
  gradientCheckpointing: boolean | null
  minSnrGamma: number | null
  noiseOffset: number | null
  seed: number | null
  captionDropout: number | null
  keepTokens: number | null
  maxTokenLength: number | null
  cacheLatents: boolean | null
  source: string | null
  fields?: Record<string, unknown>
}

export type Status = {
  trainingActive: boolean
  latestRun: Run | null
  latestLog: { path: string; name: string; mtime: number; mtimeIso: string; size?: number } | null
  progress: Progress | null
  trainMeta?: TrainMeta | null
  runCount: number
  logCount: number
  activitySource?: string | null
  polledAt: string
}

export type Config = {
  outputRoots: string[]
  logRoots: string[]
  trainLogGlobs: string[]
  comfyOutputRoots: string[]
  pollSeconds: number
  activeWindowMinutes: number
  yamlOwned?: {
    outputRoots?: boolean
    logRoots?: boolean
    comfyOutputRoots?: boolean
    activeWindowMinutes?: boolean
  }
}

export type StudioWriterHealth = {
  ok: boolean
  baseUrl?: string
  models?: string[]
  loadedHint?: string | null
  error?: string
  serverRunning?: boolean
  diskModels?: string[]
  lmsPath?: string
  autoManage?: boolean
  comfy?: { ok: boolean; device?: string | null; error?: string }
}

export type JobStage = { stage: string; detail?: string; at?: string }

export type ComfyProgressView = {
  connected: boolean
  active: boolean
  kind: string
  title: string
  line: string
  hint?: string
  percent: number | null
  value: number
  max: number
  queueRemaining: number
  promptId?: string | null
  nodeClass?: string | null
  updatedAt?: string | null
}

export type StackHints = {
  seed?: number | string | null
  promptHash?: string | null
  promptId?: string | null
  batchId?: string | null
  stackId?: string | null
  parentPath?: string | null
  sourceImage?: string | null
}

export type GalleryRelated = {
  id: string
  path: string
  name: string
  kind: 'image' | 'video' | 'file' | string
  role: string
  via: string
  thumbUrl: string
  hasMeta: boolean
  mtimeIso: string
}

export type GalleryImage = {
  id: string
  path: string
  name: string
  rel: string
  root: string
  kind?: 'image' | 'video' | 'file' | string
  size: number
  sizeHuman: string
  mtime: number
  mtimeIso: string
  hasMeta: boolean
  metaPath: string | null
  thumbUrl: string
  stackHints?: StackHints | null
  relatedCount?: number
  related?: GalleryRelated[]
  /** Hidden from default gallery when true */
  archived?: boolean
  clipId?: string | null
  project?: string | null
  isPick?: boolean
}

export type GalleryFacet = { id: string; count: number }

export type StudioPlanClip = {
  id: string
  title: string
  section?: string
  mood?: string
  t_start: number
  t_end: number
  durationSec: number
  cut?: boolean
  gun_risk?: boolean
  sexy?: boolean
  stillBrief?: string
  motionBrief?: string
  dialogue?: string
  soundscape?: string
  musicNote?: string
}

export type StudioMoviePlan = {
  projectId: string
  title: string
  logline: string
  rating: string
  durationTargetSec: number
  lookTrack: string
  videoMode?: 'stills' | 't2v' | string
  song?: string
  musicPalette?: string
  characters?: { id: string; name: string; look?: string; voice?: string }[]
  clips: StudioPlanClip[]
  markdown?: string
  warnings?: string[]
}

export type StudioPlanRecord = {
  projectId: string
  createdAt?: string
  updatedAt?: string
  status?: string
  approved?: boolean
  produceRegistered?: boolean
  archived?: boolean
  archivedAt?: string | null
  userPrompt?: string
  dryRun?: boolean
  model?: string | null
  plan: StudioMoviePlan
  paths?: Record<string, string>
  archive?: {
    mediaCount?: number
    roots?: string[]
    at?: string
  }
}

export type EpisodeStill = {
  name: string
  rel: string
  abs: string
  bytes: number
  mtime: string
  url: string
}

export type EpisodeComment = {
  id: string
  createdAt: string
  author: string
  anchor: string
  imageRel: string | null
  body: string
}

export type EpisodeScene = {
  id: string
  title: string
  heading: string
  stills: EpisodeStill[]
  pickRel: string | null
  pick: EpisodeStill | null
  comments: EpisodeComment[]
}

export type EpisodePlanDetail = {
  ok: boolean
  id: string
  title: string
  markdownPath: string
  boardDir: string
  markdown: string
  scenes: EpisodeScene[]
  comments: EpisodeComment[]
  picks: Record<string, string>
  styleNote?: string
}

export type StudioPlanSummary = {
  projectId: string
  title: string
  status?: string
  createdAt?: string
  updatedAt?: string
  clipCount?: number
  durationTargetSec?: number
  rating?: string
  lookTrack?: string
  approved?: boolean
  produceRegistered?: boolean
  archived?: boolean
  archivedAt?: string | null
}

export type StudioProject = {
  id: string
  title: string
  status: string
  clipCount: number
  sceneCount: number
  okCount: number
  clipTotal: number | null
  active: boolean
  approved: boolean
  produceRegistered: boolean
  archived: boolean
  archivedAt?: string | null
  coverUrl?: string | null
  coverKind?: 'image' | 'video' | string | null
  hasPlan: boolean
  hasBoard: boolean
  hasProduce: boolean
  updatedAt: string | null
  lookTrack?: string | null
  videoMode?: 'stills' | 't2v' | string
  stage: 'plan' | 'make' | 'board' | 'watch' | string
}

export type BrainStep = {
  id: string
  label: string
  state: 'idle' | 'active' | 'done' | 'fail' | string
}

export type BrainTiming = {
  startedAt?: string | null
  endedAt?: string | null
  seconds?: number | null
}

export type BrainGraphNode = {
  id: string
  label: string
  blurb?: string
  state: string
}

export type BrainGraphEdge = {
  id: string
  from: string
  to: string
  kind: string
  seconds?: number | null
  live?: boolean
}

export type BrainClip = {
  id: string
  title?: string
  durationSec?: number | null
  cut?: boolean
  stillBrief?: string | null
  motionBrief?: string | null
  still?: string | null
  video?: string | null
  pick?: string | null
}

export type BrainReport = {
  schema?: string
  projectId: string
  title?: string
  lookTrack?: string
  videoMode?: string
  status: string
  step: string
  stopAfter?: string | null
  reviewOk?: boolean
  lastError?: string | null
  currentClip?: string | null
  updatedAt?: string | null
  steps: BrainStep[]
  clips: BrainClip[]
  jobIds?: string[]
  master?: string | null
  started?: boolean
  running?: boolean
  label?: string
  comfy?: ComfyProgressView | null
  runId?: string | null
  phase?: string | null
  timings?: Record<string, BrainTiming>
  graph?: { nodes: BrainGraphNode[]; edges: BrainGraphEdge[] } | null
}

export type GalleryItem = {
  path: string
  name: string
  kind?: 'image' | 'video' | 'file' | string
  size: number
  sizeHuman: string
  mtimeIso: string
  thumbUrl: string
  hasMeta: boolean
  meta: Record<string, unknown> | null
  metaFormat: string | null
  metaPath: string | null
  metaRaw: string | null
  related?: GalleryRelated[]
  relatedCount?: number
  /** Pixel dimensions when known (sidecar or file probe) */
  pixelSize?: { width: number; height: number } | null
  archived?: boolean
  clipId?: string | null
  project?: string | null
}

export type GalleryListResponse = {
  images: GalleryImage[]
  count: number
  totalMatched?: number
  offset?: number
  limit?: number
  archivedTotal?: number
  archiveMode?: 'hide' | 'only' | 'all' | string
  facets?: { projects: GalleryFacet[]; clips: GalleryFacet[] }
  query?: { q?: string; kind?: string; project?: string; clip?: string }
  polledAt: string
}

export type GalleryQuery = {
  limit?: number
  offset?: number
  archiveMode?: 'hide' | 'only' | 'all'
  q?: string
  kind?: string
  project?: string
  clip?: string
}

export class ApiError extends Error {
  status: number
  code: string | null
  hint: string | null
  stages?: JobStage[]
  plan?: unknown
  constructor(
    status: number,
    message: string,
    extra: {
      code?: string | null
      hint?: string | null
      stages?: JobStage[]
      plan?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = extra.code || null
    this.hint = extra.hint ?? null
    if (extra.stages) this.stages = extra.stages
    if (extra.plan) this.plan = extra.plan
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function errorHint(e: unknown): string | null {
  if (e instanceof ApiError && e.hint) return e.hint
  if (e && typeof e === 'object' && 'hint' in e && (e as { hint?: unknown }).hint) {
    return String((e as { hint: unknown }).hint)
  }
  return null
}

async function readFail(r: Response): Promise<never> {
  const t = await r.text()
  try {
    const j = JSON.parse(t) as {
      error?: string
      code?: string
      hint?: string | null
      stages?: JobStage[]
      plan?: unknown
    }
    throw new ApiError(r.status, j.error || `${r.status} ${r.statusText}`, {
      code: j.code,
      hint: j.hint,
      stages: j.stages,
      plan: j.plan,
    })
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(r.status, t || `${r.status} ${r.statusText}`)
  }
}

async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) await readFail(r)
  const text = await r.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) await readFail(r)
  return r.json() as Promise<T>
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return sendJson<T>(url, 'POST', body)
}

function put<T>(url: string, body?: unknown): Promise<T> {
  return sendJson<T>(url, 'PUT', body)
}

function del<T>(url: string): Promise<T> {
  return sendJson<T>(url, 'DELETE')
}

export const api = {
  status: () => get<Status>('/api/status'),
  runs: () => get<{ runs: Run[] }>('/api/runs'),
  run: (id: string) =>
    get<{
      run: Run
      log: { text: string; path: string } | null
      progress: Progress | null
      trainMeta?: TrainMeta | null
    }>(`/api/runs/${encodeURIComponent(id)}`),
  config: () => get<Config>('/api/config'),
  saveConfig: (cfg: Partial<Config>) => put<Config>('/api/config', cfg),
  /** archiveMode: hide (default) | only (archived) | all — or full GalleryQuery */
  gallery: (
    limitOrQuery: number | GalleryQuery = 400,
    archiveMode: 'hide' | 'only' | 'all' = 'hide',
  ) => {
    const opts: GalleryQuery =
      typeof limitOrQuery === 'object' && limitOrQuery !== null
        ? limitOrQuery
        : { limit: limitOrQuery as number, archiveMode }
    const limit = opts.limit ?? 400
    const offset = opts.offset ?? 0
    const arch = opts.archiveMode ?? archiveMode
    const params = new URLSearchParams()
    params.set('limit', String(limit))
    if (offset) params.set('offset', String(offset))
    if (arch === 'only') params.set('archived', 'only')
    else if (arch === 'all') params.set('archived', 'all')
    if (opts.q) params.set('q', opts.q)
    if (opts.kind) params.set('kind', opts.kind)
    if (opts.project) params.set('project', opts.project)
    if (opts.clip) params.set('clip', opts.clip)
    return get<GalleryListResponse>(`/api/gallery?${params.toString()}`)
  },
  studioHealth: () =>
    get<{
      ok: boolean
      lmstudio?: StudioWriterHealth
      planner?: {
        provider?: string
        url?: string
        model?: string | null
        local?: boolean
        needsKey?: boolean
        hasKey?: boolean
        style?: string
      }
      guidePath?: string
      projectsDir?: string
      error?: string
    }>('/api/studio/health'),
  studioProjects: () =>
    get<{ projects: StudioProject[]; polledAt: string }>('/api/studio/projects'),
  studioArchiveList: () =>
    get<{ ok: boolean; projects: StudioProject[]; polledAt: string }>('/api/studio/archive'),
  brain: (id: string) =>
    get<{ ok: boolean; brain: BrainReport; polledAt: string }>(
      `/api/brain/${encodeURIComponent(id)}`,
    ),
  brains: () => get<{ brains: BrainReport[]; polledAt: string }>('/api/brain'),
  brainStart: (
    id: string,
    body?: {
      stopAfter?: 'plan' | 'stills' | 'film'
      oneClick?: boolean
      autoPick?: boolean
      videoMode?: 'stills' | 't2v'
    },
  ) =>
    post<{ ok: boolean; pid: number; stopAfter?: string; autoPick?: boolean; brain: BrainReport }>(
      `/api/brain/${encodeURIComponent(id)}/start`,
      body || {},
    ),
  brainResume: (id: string, body?: { reviewOk?: boolean }) =>
    post<{ ok: boolean; pid: number; brain: BrainReport }>(
      `/api/brain/${encodeURIComponent(id)}/resume`,
      body || { reviewOk: true },
    ),
  brainStop: (id: string) =>
    post<{ ok: boolean; pid?: number; killed?: boolean; brain: BrainReport }>(
      `/api/brain/${encodeURIComponent(id)}/stop`,
      {},
    ),
  brainMasterUrl: (id: string) => `/api/brain/${encodeURIComponent(id)}/master`,
  studioProjectCreate: (body: { title?: string; prompt?: string; videoMode?: 'stills' | 't2v' }) =>
    post<{
      ok: boolean
      project: StudioProject
      record?: StudioPlanRecord
    }>('/api/studio/projects', body || {}),
  studioPlanGet: (id: string) =>
    get<{ ok: boolean; record: StudioPlanRecord }>(
      `/api/studio/plans/${encodeURIComponent(id)}`,
    ),
  studioStoryboard: (id: string) =>
    get<{
      ok: boolean
      projectId: string
      title: string
      model: string | null
      updatedAt: string | null
      markdown: string
    }>(`/api/studio/plans/${encodeURIComponent(id)}/storyboard`),
  studioWorkflows: (id: string) =>
    get<{
      ok: boolean
      projectId: string
      title: string
      comfyUrl: string
      clips: {
        id: string
        title: string
        durationSec: number | null
        still: string | null
        video: string | null
        stillWorkflow: { workflowPath: string | null; apiPath: string | null }
        videoWorkflow: { workflowPath: string | null; apiPath: string | null }
      }[]
    }>(`/api/studio/plans/${encodeURIComponent(id)}/workflows`),
  studioPlan: (body: {
    prompt?: string
    dryRun?: boolean
    projectId?: string
    plan?: StudioMoviePlan
    videoMode?: 'stills' | 't2v'
  }) =>
    post<{
      ok: boolean
      record: StudioPlanRecord
      plan: StudioMoviePlan
      dryRun: boolean
      model: string | null
      provider?: string | null
    }>('/api/studio/plan', body),
  studioFilm: (body: {
    prompt?: string
    title?: string
    projectId?: string
    dryRun?: boolean
    plan?: StudioMoviePlan
    videoMode?: 'stills' | 't2v'
  }) =>
    post<{
      ok: boolean
      oneClick?: boolean
      dryRun?: boolean
      projectId: string
      pid?: number
      record: StudioPlanRecord
      plan: StudioMoviePlan
      model?: string | null
      provider?: string | null
    }>('/api/studio/film', body),
  studioPlanApprove: (id: string, body?: { startProduction?: boolean }) =>
    post<{
      ok: boolean
      projectId: string
      producePipelineId: string
      message: string
      paths: Record<string, string>
    }>(`/api/studio/plans/${encodeURIComponent(id)}/approve`, body || {}),
  studioPlanArchive: (id: string) =>
    post<{
      ok: boolean
      projectId: string
      title?: string
      mediaCount: number
      addedCount: number
      added: string[]
      roots?: string[]
      archivedTotal: number
      message: string
      record?: StudioPlanRecord
    }>(`/api/studio/plans/${encodeURIComponent(id)}/archive`, {}),
  studioPlanUnarchive: (id: string) =>
    post<{
      ok: boolean
      projectId: string
      title?: string
      mediaCount: number
      removedCount: number
      archivedTotal: number
      message: string
      record?: StudioPlanRecord
    }>(`/api/studio/plans/${encodeURIComponent(id)}/unarchive`, {}),
  galleryItem: (filePath: string) =>
    get<GalleryItem>(`/api/gallery/item?path=${encodeURIComponent(filePath)}`),
  galleryArchive: (paths: string | string[]) =>
    post<{
      ok: boolean
      added: string[]
      addedCount: number
      archivedTotal: number
    }>('/api/gallery/archive', { paths: Array.isArray(paths) ? paths : [paths] }),
  galleryUnarchive: (paths: string | string[]) =>
    post<{
      ok: boolean
      removedCount: number
      archivedTotal: number
    }>('/api/gallery/unarchive', { paths: Array.isArray(paths) ? paths : [paths] }),
  comfyProgress: () =>
    get<ComfyProgressView & { ok: boolean; polledAt?: string }>('/api/comfy/progress'),

  episodePlan: (id: string) =>
    get<EpisodePlanDetail>(`/api/episode-plans/${encodeURIComponent(id)}`),
  episodeComment: (
    id: string,
    body: { body: string; anchor?: string; imageRel?: string | null; author?: string },
  ) =>
    post<{ ok: boolean; comment: EpisodeComment }>(
      `/api/episode-plans/${encodeURIComponent(id)}/comments`,
      body,
    ),
  episodeCommentDelete: (id: string, commentId: string) =>
    del<{ ok: boolean; id: string }>(
      `/api/episode-plans/${encodeURIComponent(id)}/comments/${encodeURIComponent(commentId)}`,
    ),
  episodePick: (id: string, sceneId: string, imageRel: string) =>
    put<{ ok: boolean; picks: Record<string, string> }>(
      `/api/episode-plans/${encodeURIComponent(id)}/picks`,
      { sceneId, imageRel },
    ),

  mediaUrl: (absPath: string) => `/api/gallery/file?path=${encodeURIComponent(absPath)}`,

  systemStats: () => get<SystemStats>('/api/system/stats'),

  floorStatus: () => get<{ ok: boolean; status: FloorStatus }>('/api/floor/status'),
}

export type FloorUpdate = {
  id: string
  at: string
  mood?: string
  text: string
  kind?: string
  imageUrl?: string | null
}

export type FloorPhoto = {
  id: string
  at: string
  url: string
  caption: string
  kind?: string
}

export type FloorStatus = {
  schema?: string
  displayName?: string
  handle?: string
  title?: string
  mood?: string
  statusLine?: string
  song?: string
  songPlaying?: boolean
  employeePhotoUrl?: string
  friends?: { name: string; blurb: string }[]
  about?: string[]
  photos?: FloorPhoto[]
  progress?: {
    project?: string | null
    runId?: string | null
    phase?: string
    done?: number
    total?: number
    failed?: number
    percent?: number
    currentShot?: string | null
    detail?: string | null
    masterPath?: string | null
    workDir?: string | null
  }
  updates?: FloorUpdate[]
  updatedAt?: string
}

export type SystemStats = {
  ok?: boolean
  error?: string
  at: string
  host: {
    hostname: string
    platform: string
    release: string
    arch: string
    uptimeSec: number
    uptimeHuman: string
    node: string
  }
  cpu: {
    overall: number
    count: number
    model: string
    cores: { index: number; model: string; speedMhz: number; usage: number }[]
    loadAvg: number[]
  }
  memory: {
    total: number
    free: number
    used: number
    usedPercent: number
    totalHuman: string
    usedHuman: string
    freeHuman: string
  }
  gpus: {
    index: number
    name: string
    memUsed: number
    memTotal: number
    memUsedHuman: string
    memTotalHuman: string
    memPercent: number
    utilGpu: number
    utilMem: number
    tempC: number
    powerW: number
    powerLimitW: number
    fanPercent: number | null
  }[]
  disks: {
    device: string
    label: string
    fs: string
    total: number
    free: number
    used: number
    usedPercent: number
    totalHuman: string
    usedHuman: string
    freeHuman: string
  }[]
  processes: {
    rank: number
    name: string
    pid: number
    cpu: number | null
    mem: number
    memHuman: string
  }[]
  network: { name: string; family: string; address: string; mac: string }[]
}
