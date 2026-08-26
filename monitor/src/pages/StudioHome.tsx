import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { FailNote } from '../components/FailNote'
import { PosterCard } from '../components/PosterCard'
import { useStudioSession } from '../components/StudioSession'
import { api } from '../lib/api'
import { canonicalStage, projectPath } from '../lib/studio'

const HOME_PLACEHOLDER = 'Example: 20 second rooftop fight, rain, no talking.'

const STARTERS = [
  { label: '12 seconds', text: '12 second rooftop fight in the rain, silent, no talking.' },
  { label: '20 second chase', text: '20 second neon alley chase, rain, no talking.' },
  { label: '32 second raid', text: '32 second night raid through a server floor, gunfire, no talking.' },
]

export function StudioHome() {
  const { projects, projectsReady, refreshProjects } = useStudioSession()
  const navigate = useNavigate()
  const recents = projects.slice(0, 6)
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  const makeMovie = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.studioFilm({ prompt: text })
      await refreshProjects()
      navigate(`/studio/${encodeURIComponent(r.projectId)}/make`)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  if (!projectsReady) {
    return <div className="min-h-[68vh]" />
  }

  return (
    <div className="page">
      <div className="flex flex-col items-center text-center pt-4">
        <div className="h-16 w-16 rounded-[18px] overflow-hidden bg-void ring-1 ring-white/[0.1] shadow-[0_0_40px_rgba(10,132,255,0.18)]">
          <BrandMark className="h-16 w-16" title="Qorlith" />
        </div>
        <h1 className="mt-6 text-[40px] font-semibold tracking-tight leading-none">Make a movie</h1>
        <p className="page-lead mt-3 max-w-xl">
          Type what happens. Press the blue button. Come back when it is done.
        </p>
      </div>

      <div className="card space-y-4 max-w-2xl mx-auto w-full">
        <label className="block text-[13px] text-ghost text-left">What happens in the film?</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void makeMovie()
          }}
          rows={5}
          autoFocus
          placeholder={HOME_PLACEHOLDER}
          className="field resize-y min-h-[128px]"
        />
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <button
              key={s.label}
              type="button"
              className="chip"
              onClick={() => setPrompt(s.text)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <FailNote error={err} />
        <button
          type="button"
          disabled={busy || !prompt.trim()}
          onClick={() => void makeMovie()}
          className="btn btn-primary btn-xl w-full"
        >
          {busy ? 'Starting…' : 'Make movie'}
        </button>
        <p className="text-[12px] text-ghost text-center">Ctrl+Enter also starts it.</p>
      </div>

      {recents.length ? (
        <div>
          <h2 className="text-[15px] text-ghost mb-3">Recent</h2>
          <ul className="grid sm:grid-cols-2 gap-3">
            {recents.map((p) => (
              <li key={p.id}>
                <PosterCard
                  title={p.title}
                  coverUrl={p.coverUrl}
                  live={p.active}
                  meta={p.active ? 'Making now' : p.clipCount ? `${p.clipCount} clips` : 'Draft'}
                  onClick={() => navigate(projectPath(p.id, canonicalStage(p.stage) || 'watch'))}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
