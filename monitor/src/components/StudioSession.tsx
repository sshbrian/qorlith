import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useParams } from 'react-router-dom'
import { api, type BrainReport, type ComfyProgressView, type StudioProject } from '../lib/api'
import { heldBrain, preferHeld } from '../lib/brainHold'
import { brainFingerprint, comfyFingerprint, projectsFingerprint } from '../lib/studioSession'

export type StudioSessionValue = {
  projectId: string
  projects: StudioProject[]
  projectsReady: boolean
  current: StudioProject | null
  brain: BrainReport | null
  err: unknown
  loading: boolean
  busy: boolean
  openNew: () => void
  refreshProjects: () => Promise<void>
  start: (stopAfter?: 'plan' | 'stills' | 'film') => Promise<void>
  resume: () => Promise<void>
  stop: () => Promise<void>
}

const Ctx = createContext<StudioSessionValue | null>(null)

type ProjectsValue = {
  projectId: string
  projects: StudioProject[]
  projectsReady: boolean
  current: StudioProject | null
  refreshProjects: () => Promise<void>
  openNew: () => void
}

const ProjectsCtx = createContext<ProjectsValue | null>(null)

type LiveValue = {
  comfy: ComfyProgressView | null
  comfyOk: boolean | null
}

const LiveCtx = createContext<LiveValue>({ comfy: null, comfyOk: null })

function hidden() {
  return typeof document !== 'undefined' && document.hidden
}

export function StudioSessionProvider({
  openNew,
  children,
}: {
  openNew: () => void
  children: ReactNode
}) {
  const params = useParams()
  const projectId = params.projectId || ''

  const [projects, setProjects] = useState<StudioProject[]>([])
  const [projectsReady, setProjectsReady] = useState(false)
  const [brain, setBrain] = useState<BrainReport | null>(() => heldBrain(projectId))
  const [comfy, setComfy] = useState<ComfyProgressView | null>(null)
  const [comfyOk, setComfyOk] = useState<boolean | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [loading, setLoading] = useState(Boolean(projectId))
  const [busy, setBusy] = useState(false)

  const brainFp = useRef('')
  const comfyFp = useRef('')
  const projectsFp = useRef('')

  const applyBrain = useCallback((next: BrainReport | null, id = projectId) => {
    const held = preferHeld(id, next)
    const fp = brainFingerprint(held)
    if (fp === brainFp.current) return
    brainFp.current = fp
    setBrain(held)
  }, [projectId])

  const applyComfy = useCallback((next: ComfyProgressView | null, ok: boolean) => {
    const fp = `${ok ? '1' : '0'}|${comfyFingerprint(next)}`
    if (fp === comfyFp.current) return
    comfyFp.current = fp
    setComfy(next)
    setComfyOk(ok)
  }, [])

  const refreshProjects = useCallback(async () => {
    try {
      const r = await api.studioProjects()
      const list = r.projects || []
      const fp = projectsFingerprint(list)
      if (fp !== projectsFp.current) {
        projectsFp.current = fp
        setProjects(list)
      }
    } catch {
      /* rail can stay stale */
    } finally {
      setProjectsReady(true)
    }
  }, [])

  useEffect(() => {
    void refreshProjects()
    const t = window.setInterval(() => {
      if (hidden()) return
      void refreshProjects()
    }, 8000)
    return () => window.clearInterval(t)
  }, [refreshProjects])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (hidden()) return
      try {
        const p = await api.comfyProgress()
        if (!alive) return
        applyComfy(p, Boolean(p.connected))
      } catch {
        if (alive) applyComfy(null, false)
      }
    }
    void tick()
    const id = window.setInterval(tick, 700)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [applyComfy])

  useEffect(() => {
    const cached = heldBrain(projectId)
    if (cached) {
      brainFp.current = brainFingerprint(cached)
      setBrain(cached)
      setLoading(false)
    } else if (!projectId) {
      setBrain(null)
      setLoading(false)
      return
    } else {
      setLoading(true)
    }
    setErr(null)
    if (!projectId) return
    let alive = true
    const tick = async () => {
      if (hidden()) return
      try {
        const r = await api.brain(projectId)
        if (!alive) return
        applyBrain(r.brain, projectId)
        setErr(null)
      } catch (e) {
        if (alive) setErr(e)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void tick()
    const t = window.setInterval(tick, 1000)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [projectId, applyBrain])

  const start = useCallback(
    async (stopAfter: 'plan' | 'stills' | 'film' = 'stills') => {
      if (!projectId) return
      setBusy(true)
      setErr(null)
      try {
        const r = await api.brainStart(projectId, {
          stopAfter,
          oneClick: stopAfter === 'film',
        })
        applyBrain(r.brain)
        await refreshProjects()
      } catch (e) {
        setErr(e)
      } finally {
        setBusy(false)
      }
    },
    [projectId, applyBrain, refreshProjects],
  )

  const resume = useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.brainResume(projectId)
      applyBrain(r.brain)
      await refreshProjects()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }, [projectId, applyBrain, refreshProjects])

  const stop = useCallback(async () => {
    if (!projectId) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.brainStop(projectId)
      applyBrain(r.brain)
      await refreshProjects()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }, [projectId, applyBrain, refreshProjects])

  const current = useMemo(
    () => projects.find((p) => p.id === projectId) || null,
    [projects, projectId],
  )

  const value = useMemo<StudioSessionValue>(
    () => ({
      projectId,
      projects,
      projectsReady,
      current,
      brain,
      err,
      loading,
      busy,
      openNew,
      refreshProjects,
      start,
      resume,
      stop,
    }),
    [
      projectId,
      projects,
      projectsReady,
      current,
      brain,
      err,
      loading,
      busy,
      openNew,
      refreshProjects,
      start,
      resume,
      stop,
    ],
  )

  const live = useMemo<LiveValue>(() => ({ comfy, comfyOk }), [comfy, comfyOk])

  const projectsValue = useMemo<ProjectsValue>(
    () => ({
      projectId,
      projects,
      projectsReady,
      current,
      refreshProjects,
      openNew,
    }),
    [projectId, projects, projectsReady, current, refreshProjects, openNew],
  )

  return (
    <ProjectsCtx.Provider value={projectsValue}>
      <Ctx.Provider value={value}>
        <LiveCtx.Provider value={live}>{children}</LiveCtx.Provider>
      </Ctx.Provider>
    </ProjectsCtx.Provider>
  )
}

export function useStudioSession(): StudioSessionValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useStudioSession requires StudioSessionProvider')
  }
  return ctx
}

/** Rail / header project list — does not re-render on every brain poll. */
export function useStudioProjects(): ProjectsValue {
  const ctx = useContext(ProjectsCtx)
  if (!ctx) {
    throw new Error('useStudioProjects requires StudioSessionProvider')
  }
  return ctx
}

export function useStudioLive() {
  return useContext(LiveCtx)
}

export function useStudioChrome() {
  const { openNew } = useStudioSession()
  const { comfy } = useStudioLive()
  return { openNew, comfy }
}
