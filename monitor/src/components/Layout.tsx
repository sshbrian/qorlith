import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Floor } from '../pages/Floor'
import { Settings } from '../pages/Settings'
import { System } from '../pages/System'
import { FailNote } from './FailNote'
import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { StudioSessionProvider, useStudioLive, useStudioProjects, useStudioSession } from './StudioSession'
import { ComfyProgress } from './ComfyProgress'
import { api } from '../lib/api'
import { runIsLive } from '../lib/studioSession'
import {
  areaFromPath,
  canonicalStage,
  projectPath,
  clearLastProject,
  readLastProject,
  readRailCollapsed,
  stageFromPath,
  type StudioStage,
  writeLastProject,
  writeRailCollapsed,
} from '../lib/studio'
import { usePinnedScroll } from '../lib/studioScroll'
import { BrandMark } from './BrandMark'
import { CoverThumb } from './PosterCard'
import { VideoModeToggle, type VideoMode } from './VideoModeToggle'

const STAGES: { id: StudioStage; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'make', label: 'Make' },
  { id: 'board', label: 'Board' },
  { id: 'watch', label: 'Watch' },
]

type Overlay = 'new' | 'floor' | 'system' | 'settings' | null

function HeaderMeters() {
  const { brain } = useStudioSession()
  const { comfy, comfyOk } = useStudioLive()
  return (
    <>
      <ComfyProgress progress={comfy} compact hold={Boolean(comfy?.active) || runIsLive(brain)} />
      <span className="hidden sm:flex items-center">
        <PulseDot ok={comfyOk} title={comfyOk ? 'Renderer online' : 'Renderer offline'} />
      </span>
    </>
  )
}

function PulseDot({ ok, title }: { ok: boolean | null; title: string }) {
  return (
    <span className="inline-flex items-center" title={title}>
      <span
        className={[
          'h-1.5 w-1.5 rounded-full',
          ok == null ? 'bg-ghost/50' : ok ? 'bg-cyan' : 'bg-magenta',
        ].join(' ')}
      />
    </span>
  )
}

export function Layout() {
  const location = useLocation()
  const searchPanel = new URLSearchParams(location.search).get('panel') as Overlay
  const [overlay, setOverlay] = useState<Overlay>(
    location.pathname === '/settings' ? 'settings' : searchPanel,
  )
  const [createErr, setCreateErr] = useState<unknown>(null)

  const openNew = useCallback(() => {
    setCreateErr(null)
    setOverlay('new')
  }, [])

  return (
    <StudioSessionProvider openNew={openNew}>
      <LayoutBody overlay={overlay} setOverlay={setOverlay} createErr={createErr} setCreateErr={setCreateErr} />
    </StudioSessionProvider>
  )
}

function LayoutBody({
  overlay,
  setOverlay,
  createErr,
  setCreateErr,
}: {
  overlay: Overlay
  setOverlay: (v: Overlay) => void
  createErr: unknown
  setCreateErr: (v: unknown) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const area = areaFromPath(location.pathname)
  const projectId = params.projectId || ''
  const stage = stageFromPath(location.pathname)
  const scroller = usePinnedScroll(location.pathname)
  const searchPanel = new URLSearchParams(location.search).get('panel') as Overlay
  const [railCollapsed, setRailCollapsed] = useState(readRailCollapsed)
  const [railMobileOpen, setRailMobileOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPrompt, setNewPrompt] = useState('')
  const [newVideoMode, setNewVideoMode] = useState<VideoMode>('stills')
  const [creating, setCreating] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [archiveErr, setArchiveErr] = useState<unknown>(null)
  const { projects, current, refreshProjects, openNew } = useStudioProjects()
  const { brain } = useStudioSession()
  const t2v = brain?.videoMode === 't2v' || current?.videoMode === 't2v'
  const stages = t2v ? STAGES.filter((s) => s.id !== 'board') : STAGES

  useEffect(() => {
    if (projectId) writeLastProject(projectId)
  }, [projectId])

  useEffect(() => {
    setRailMobileOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!t2v || stage !== 'board' || !projectId) return
    navigate(projectPath(projectId, 'make'), { replace: true })
  }, [t2v, stage, projectId, navigate])

  useEffect(() => {
    if (!railMobileOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRailMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [railMobileOpen])

  useEffect(() => {
    if (location.pathname === '/settings') setOverlay('settings')
    else if (searchPanel) setOverlay(searchPanel)
  }, [location.pathname, searchPanel, setOverlay])

  useEffect(() => {
    if (area !== 'studio' || !projectId || stage) return
    navigate(projectPath(projectId, canonicalStage(current?.stage) || 'plan'), { replace: true })
  }, [area, projectId, stage, current?.stage, navigate])

  const openProject = (id: string, nextStage?: StudioStage) => {
    writeLastProject(id)
    const hit = projects.find((p) => p.id === id)
    navigate(projectPath(id, nextStage || canonicalStage(hit?.stage) || 'plan'))
  }

  const toggleRail = () => {
    setRailCollapsed((v) => {
      writeRailCollapsed(!v)
      return !v
    })
  }

  const closeOverlay = () => {
    setOverlay(null)
    const next = new URLSearchParams(location.search)
    const hadPanel = next.has('panel')
    if (hadPanel) next.delete('panel')
    if (location.pathname === '/settings') {
      const last = projectId || readLastProject()
      navigate(last ? projectPath(last) : '/studio', { replace: true })
      return
    }
    if (hadPanel) {
      const search = next.toString()
      navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true })
    }
  }

  const createProject = async () => {
    setCreating(true)
    setCreateErr(null)
    try {
      const r = await api.studioProjectCreate({
        title: newTitle.trim() || 'Untitled project',
        prompt: newPrompt.trim(),
        videoMode: newVideoMode,
      })
      setNewTitle('')
      setNewPrompt('')
      setNewVideoMode('stills')
      setOverlay(null)
      setCreateErr(null)
      await refreshProjects()
      navigate(projectPath(r.project.id, 'plan'))
    } catch (e) {
      setCreateErr(e)
    } finally {
      setCreating(false)
    }
  }

  const makeMovieFromOverlay = async () => {
    const text = newPrompt.trim()
    if (!text) {
      await createProject()
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      const r = await api.studioFilm({
        title: newTitle.trim() || undefined,
        prompt: text,
        videoMode: newVideoMode,
      })
      setNewTitle('')
      setNewPrompt('')
      setNewVideoMode('stills')
      setOverlay(null)
      await refreshProjects()
      navigate(projectPath(r.projectId, 'make'))
    } catch (e) {
      setCreateErr(e)
    } finally {
      setCreating(false)
    }
  }

  const confirmArchiveProject = async () => {
    if (!current?.id) return
    setArchiveBusy(true)
    setArchiveErr(null)
    try {
      await api.studioPlanArchive(current.id)
      setArchiveOpen(false)
      clearLastProject(current.id)
      await refreshProjects()
      navigate('/archive')
    } catch (e) {
      setArchiveErr(e)
    } finally {
      setArchiveBusy(false)
    }
  }

  const showStages = area === 'studio' && Boolean(projectId)

  return (
      <div className={['relative z-10 h-full min-h-full flex bg-void text-ink', railMobileOpen ? 'rail-open' : ''].join(' ')}>
        {railMobileOpen ? (
          <button
            type="button"
            className="studio-rail-backdrop"
            aria-label="Close projects"
            onClick={() => setRailMobileOpen(false)}
          />
        ) : null}
        <aside
          className={[
            'studio-rail shrink-0 flex flex-col border-r border-white/[0.06]',
            railCollapsed ? 'w-[72px]' : 'w-[252px]',
          ].join(' ')}
        >
          <div className={['flex items-center gap-2.5 px-3 pt-4 pb-3', railCollapsed ? 'justify-center' : ''].join(' ')}>
            <button
              type="button"
              onClick={() => navigate('/studio')}
              className="h-8 w-8 shrink-0 rounded-[9px] overflow-hidden bg-void ring-1 ring-white/[0.08] hover:ring-white/[0.16]"
              title="Qorlith"
            >
              <BrandMark className="h-8 w-8 block" title="Qorlith" />
            </button>
            {!railCollapsed ? (
              <div className="min-w-0 flex-1">
                <div className="text-[17px] font-semibold tracking-tight">Qorlith</div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={openNew}
              className="h-7 w-7 shrink-0 rounded-full bg-white/[0.08] text-[20px] leading-none text-ink hover:bg-white/[0.14]"
              title="New project"
              aria-label="New project"
            >
              +
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2 pb-3">
            {!railCollapsed ? (
              <div className="px-2 pt-1 pb-2 text-[11px] font-medium text-ghost/70 tracking-[0.04em]">
                Projects
              </div>
            ) : null}
            {projects.length === 0 && !railCollapsed ? (
              <p className="px-2 py-5 text-[13px] text-ghost leading-relaxed">
                No projects yet. Press + to start one.
              </p>
            ) : null}
            <div className="space-y-0.5">
              {projects.map((p) => {
                const active = p.id === projectId
                const meta = p.active
                  ? 'Making now'
                  : p.clipCount
                    ? `${p.clipCount} clips`
                    : p.sceneCount
                      ? `${p.sceneCount} scenes`
                      : 'Draft'
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => openProject(p.id)}
                    className={[
                      'w-full flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left',
                      active ? 'bg-white/[0.12] text-ink' : 'text-ghost hover:bg-white/[0.06] hover:text-ink',
                    ].join(' ')}
                    title={p.title}
                  >
                    {p.coverUrl ? (
                      <CoverThumb
                        url={p.coverUrl}
                        kind={p.coverKind}
                        className="h-7 w-7 shrink-0 rounded-[8px] object-cover bg-black ring-1 ring-white/10"
                      />
                    ) : (
                      <span
                        className={[
                          'h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-[12px] font-medium',
                          active ? 'bg-cyan text-white' : 'bg-white/[0.08] text-ink',
                        ].join(' ')}
                      >
                        {(p.title || p.id).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    {!railCollapsed ? (
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-medium truncate">{p.title}</span>
                        <span className="block text-[11px] text-ghost/80 truncate">{meta}</span>
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </nav>

          {current && !railCollapsed ? (
            <div className="px-2 pb-1">
              <button
                type="button"
                onClick={() => {
                  setArchiveErr(null)
                  setArchiveOpen(true)
                }}
                className="w-full flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px] text-ghost hover:bg-white/[0.06] hover:text-magenta"
                title="Archive this whole project"
              >
                <span className="text-[13px] w-5 text-center opacity-80">▣</span>
                <span>Archive project</span>
              </button>
            </div>
          ) : null}

          <div className="border-t border-white/[0.06] p-2 space-y-0.5">
            <NavLink
              to="/archive"
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px]',
                  isActive ? 'bg-white/[0.12] text-ink' : 'text-ghost hover:bg-white/[0.06] hover:text-ink',
                  railCollapsed ? 'justify-center' : '',
                ].join(' ')
              }
              title="Archive"
            >
              <span className="text-[13px] w-5 text-center opacity-80">▤</span>
              {!railCollapsed ? <span>Archive</span> : null}
            </NavLink>
            <NavLink
              to="/media"
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px]',
                  isActive ? 'bg-white/[0.12] text-ink' : 'text-ghost hover:bg-white/[0.06] hover:text-ink',
                  railCollapsed ? 'justify-center' : '',
                ].join(' ')
              }
              title="All media"
            >
              <span className="text-[13px] w-5 text-center opacity-80">▦</span>
              {!railCollapsed ? <span>All media</span> : null}
            </NavLink>
            <NavLink
              to="/train"
              className={({ isActive }) =>
                [
                  'flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px]',
                  isActive ? 'bg-white/[0.12] text-ink' : 'text-ghost hover:bg-white/[0.06] hover:text-ink',
                  railCollapsed ? 'justify-center' : '',
                ].join(' ')
              }
              title="Train"
            >
              <span className="text-[13px] w-5 text-center opacity-80">◎</span>
              {!railCollapsed ? <span>Train</span> : null}
            </NavLink>
            <button
              type="button"
              onClick={toggleRail}
              className={[
                'w-full flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-[13px] text-ghost hover:bg-white/[0.06] hover:text-ink',
                railCollapsed ? 'justify-center' : '',
              ].join(' ')}
              title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <span className="text-[13px] w-5 text-center opacity-80">{railCollapsed ? '»' : '«'}</span>
              {!railCollapsed ? <span>Collapse</span> : null}
            </button>
          </div>
        </aside>

        <div className="min-w-0 flex-1 flex flex-col bg-void">
          <header className="studio-main-header h-[56px] shrink-0 flex items-center gap-4 px-6 border-b border-white/[0.06]">
            <button
              type="button"
              className="studio-menu"
              onClick={() => setRailMobileOpen(true)}
              aria-label="Projects"
              title="Projects"
            >
              ☰
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-semibold tracking-tight truncate">
                {area === 'media'
                  ? 'All media'
                  : area === 'train'
                    ? 'Training'
                    : area === 'archive'
                      ? 'Archive'
                      : current?.title || (projectId ? projectId : '')}
              </div>
            </div>
            {showStages ? (
              <div className="seg" role="tablist">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={stage === s.id}
                    onClick={() => projectId && navigate(projectPath(projectId, s.id))}
                    className="seg-item"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="flex items-center gap-1 text-[13px] text-ghost">
              <HeaderMeters />
              <button
                type="button"
                onClick={() => setOverlay('system')}
                className="hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-white/[0.08] hover:text-ink"
                title="System"
              >
                System
              </button>
              <button
                type="button"
                onClick={() => setOverlay('floor')}
                className="rounded-full px-2.5 py-1 hover:bg-white/[0.08] hover:text-ink"
                title="Activity"
              >
                Activity
              </button>
              <button
                type="button"
                onClick={() => setOverlay('settings')}
                className="h-7 w-7 rounded-full hover:bg-white/[0.08] text-[15px]"
                title="Settings"
                aria-label="Settings"
              >
                ⚙
              </button>
            </div>
          </header>

          <main ref={scroller} className="studio-scroll min-h-0 flex-1 overflow-auto">
            <div
              className={
                area === 'media'
                  ? 'studio-scroll-body w-full p-6 lg:p-8'
                  : stage === 'watch'
                    ? 'studio-scroll-body studio-theater mx-auto w-full max-w-[1180px] px-6 py-6 lg:px-10 lg:py-8'
                    : location.pathname === '/studio'
                      ? 'studio-scroll-body mx-auto w-full max-w-[820px] px-8 py-10 lg:px-10 lg:py-14'
                      : 'studio-scroll-body mx-auto w-full max-w-[980px] px-8 py-8 lg:px-10 lg:py-10'
              }
            >
              <Outlet />
            </div>
          </main>
        </div>

        {overlay === 'floor' ? (
          <Drawer title="Activity" onClose={closeOverlay}>
            <Floor />
          </Drawer>
        ) : null}
        {overlay === 'system' ? (
          <Drawer title="System" onClose={closeOverlay} wide>
            <System />
          </Drawer>
        ) : null}
        {overlay === 'settings' ? (
          <Modal title="Settings" onClose={closeOverlay}>
            <Settings />
          </Modal>
        ) : null}
        <ArchiveProjectDialog
          open={Boolean(archiveOpen && current?.id)}
          busy={archiveBusy}
          projectId={current?.id || ''}
          label={current?.title}
          onCancel={() => !archiveBusy && setArchiveOpen(false)}
          onConfirm={() => void confirmArchiveProject()}
        >
          {archiveErr ? <FailNote error={archiveErr} /> : null}
        </ArchiveProjectDialog>
        {overlay === 'new' ? (
          <Modal title="New project" onClose={closeOverlay}>
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className="text-[13px] text-ghost">What happens in the film?</span>
                <textarea
                  autoFocus
                  value={newPrompt}
                  onChange={(e) => setNewPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void makeMovieFromOverlay()
                  }}
                  rows={5}
                  placeholder="20 second rooftop fight, rain, no talking."
                  className="field resize-y min-h-[128px]"
                />
              </label>
              <VideoModeToggle value={newVideoMode} onChange={setNewVideoMode} />
              <p className="text-[12px] text-ghost">
                {newVideoMode === 't2v'
                  ? 'Goes straight to MiniMax. No painted still.'
                  : 'Paints a still, then animates it.'}
              </p>
              <label className="block space-y-1.5">
                <span className="text-[13px] text-ghost">Title (optional)</span>
                <input
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="Untitled project"
                  className="field"
                />
              </label>
              <FailNote error={createErr} />
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={closeOverlay} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={creating}
                  onClick={() => void createProject()}
                  className="btn btn-secondary"
                >
                  Draft only
                </button>
                <button
                  type="button"
                  disabled={creating || !newPrompt.trim()}
                  onClick={() => void makeMovieFromOverlay()}
                  className="btn btn-primary"
                >
                  {creating ? 'Starting…' : 'Make movie'}
                </button>
              </div>
            </div>
          </Modal>
        ) : null}
      </div>
  )
}

function Drawer({
  title,
  onClose,
  children,
  wide,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className={['h-full overflow-auto bg-panel border-l border-white/[0.06] p-6', wide ? 'w-full max-w-4xl' : 'w-full max-w-md'].join(
          ' ',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} className="text-[15px] text-cyan hover:text-cyan-dim">
            Done
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-[440px] rounded-[22px] bg-panel p-6 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 className="text-[20px] font-semibold tracking-tight">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  )
}
