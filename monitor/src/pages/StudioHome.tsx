import { useNavigate } from 'react-router-dom'
import { useStudioSession } from '../components/StudioSession'
import { canonicalStage, projectPath } from '../lib/studio'

export function StudioHome() {
  const { openNew, projects, projectsReady } = useStudioSession()
  const navigate = useNavigate()

  const recents = projects.slice(0, 6)

  if (!projectsReady) {
    return <div className="min-h-[68vh]" />
  }

  if (recents.length) {
    return (
      <div className="page">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-semibold tracking-tight">Projects</h1>
            <p className="page-lead mt-1">Pick up a film, or start another.</p>
          </div>
          <button type="button" onClick={openNew} className="btn btn-primary">
            New project
          </button>
        </div>
        <ul className="grid sm:grid-cols-2 gap-3">
          {recents.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => navigate(projectPath(p.id, canonicalStage(p.stage) || 'plan'))}
                className="card w-full text-left min-h-[112px] hover:bg-[#2c2c2e] transition-colors"
              >
                <div className="text-[20px] font-semibold tracking-tight truncate">{p.title}</div>
                <div className="text-[13px] text-ghost mt-2">
                  {p.active ? 'Making now' : p.clipCount ? `${p.clipCount} clips` : 'Draft'}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="min-h-[68vh] flex flex-col items-center justify-center text-center">
      <div className="h-16 w-16 rounded-[18px] bg-ink text-void text-[26px] font-semibold flex items-center justify-center">
        Q
      </div>
      <h1 className="mt-7 text-[34px] font-semibold tracking-tight leading-none">Start a project</h1>
      <p className="page-lead mt-3 mx-auto">
        Write a plan, press Make, pick the stills you like, then watch the film.
      </p>
      <button type="button" onClick={openNew} className="btn btn-primary mt-8 min-h-9 px-5 text-[15px]">
        New project
      </button>
    </div>
  )
}
