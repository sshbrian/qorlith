import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { useStudioProjects } from '../components/StudioSession'
import { api, type StudioProject } from '../lib/api'
import { projectPath } from '../lib/studio'

function formatWhen(raw?: string | null) {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ArchiveCard({
  project,
  busy,
  onRestore,
}: {
  project: StudioProject
  busy: boolean
  onRestore: (id: string) => void
}) {
  const meta = [
    project.clipCount ? `${project.clipCount} clips` : null,
    project.lookTrack,
    formatWhen(project.archivedAt || project.updatedAt),
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="archive-card group">
      <div className="archive-card-still">
        {project.coverUrl ? (
          <img src={project.coverUrl} alt="" />
        ) : (
          <div className="archive-card-empty">{(project.title || project.id).slice(0, 1).toUpperCase()}</div>
        )}
        <div className="archive-card-shade" />
      </div>
      <div className="archive-card-body">
        <h2 className="text-[18px] font-semibold tracking-tight truncate">{project.title}</h2>
        <p className="text-[12px] text-ghost/90 mt-1 truncate">{meta || 'Archived'}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRestore(project.id)}
          className="btn btn-primary mt-4 min-h-8 px-3.5 text-[13px]"
        >
          {busy ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </article>
  )
}

export function Archive() {
  const navigate = useNavigate()
  const { refreshProjects } = useStudioProjects()
  const [projects, setProjects] = useState<StudioProject[] | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await api.studioArchiveList()
      setProjects(r.projects || [])
      setErr(null)
    } catch (e) {
      setErr(e)
      setProjects([])
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const restore = async (id: string) => {
    setBusyId(id)
    setErr(null)
    try {
      await api.studioPlanUnarchive(id)
      await refreshProjects()
      navigate(projectPath(id, 'plan'))
    } catch (e) {
      setErr(e)
      await load()
    } finally {
      setBusyId(null)
    }
  }

  const list = projects || []

  return (
    <div className="page">
      <div>
        <h1 className="text-[28px] font-semibold tracking-tight">Archive</h1>
        <p className="page-lead mt-1">Projects you put away. Restore one to bring it back to the rail.</p>
      </div>

      <FailNote error={err} />

      {projects == null ? <div className="min-h-[40vh]" /> : null}

      {projects && list.length === 0 ? (
        <div className="min-h-[48vh] flex flex-col items-center justify-center text-center">
          <div className="text-[13px] uppercase tracking-[0.18em] text-ghost/70">Empty</div>
          <p className="page-lead mt-3">Nothing archived. The rail is the whole studio.</p>
        </div>
      ) : null}

      {list.length ? (
        <ul className="archive-grid">
          {list.map((p) => (
            <li key={p.id}>
              <ArchiveCard project={p} busy={busyId === p.id} onRestore={(id) => void restore(id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
