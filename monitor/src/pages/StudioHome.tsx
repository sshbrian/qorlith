import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { FailNote } from '../components/FailNote'
import { PosterCard } from '../components/PosterCard'
import { VideoModeToggle, type VideoMode } from '../components/VideoModeToggle'
import { useStudioSession } from '../components/StudioSession'
import { api } from '../lib/api'
import { canonicalStage, projectPath, PROMPT_PLACEHOLDER, PROMPT_STARTERS, VIDEO_MODE_HINT } from '../lib/studio'

export function StudioHome() {
  const { projects, projectsReady, refreshProjects } = useStudioSession()
  const navigate = useNavigate()
  const recents = projects.slice(0, 9)
  const [prompt, setPrompt] = useState('')
  const [videoMode, setVideoMode] = useState<VideoMode>('stills')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const emptyHouse = recents.length === 0

  const makeMovie = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.studioFilm({ prompt: text, videoMode })
      await refreshProjects()
      navigate(`/studio/${encodeURIComponent(r.projectId)}/make`)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  if (!projectsReady) {
    return <div className="lobby lobby-hold" />
  }

  return (
    <div className={['lobby', emptyHouse ? 'is-empty' : ''].join(' ')}>
      <header className="lobby-hero">
        <div className="lobby-mark" aria-hidden>
          <BrandMark className="h-11 w-11" title="Qorlith" />
        </div>
        <h1 className="lobby-word">Make a movie</h1>
        <p className="lobby-kicker">
          {emptyHouse ? 'The house is dark. A sentence becomes a film.' : 'A sentence becomes a film.'}
        </p>
      </header>

      <div className="title-card">
        <label className="sr-live" htmlFor="lobby-prompt">
          What happens in the film?
        </label>
        <textarea
          id="lobby-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void makeMovie()
          }}
          rows={emptyHouse ? 4 : 3}
          autoFocus
          placeholder={PROMPT_PLACEHOLDER}
          className="title-card-field"
        />
        <div className="title-card-starters">
          {PROMPT_STARTERS.map((s) => (
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
        <VideoModeToggle value={videoMode} onChange={setVideoMode} />
        <p className="title-card-hint">{VIDEO_MODE_HINT[videoMode]}</p>
        <FailNote error={err} />
        <button
          type="button"
          disabled={busy || !prompt.trim()}
          onClick={() => void makeMovie()}
          className="btn btn-primary btn-xl title-card-go"
        >
          {busy ? 'Starting…' : 'Make movie'}
        </button>
        <p className="title-card-key">Ctrl+Enter also starts it.</p>
      </div>

      {recents.length ? (
        <section className="poster-wall" aria-label="Recent films">
          <h2 className="poster-wall-kicker">On the wall</h2>
          <ul className="poster-wall-grid">
            {recents.map((p) => (
              <li key={p.id}>
                <PosterCard
                  overlay
                  title={p.title}
                  coverUrl={p.coverUrl}
                  coverKind={p.coverKind}
                  live={p.active}
                  meta={p.active ? 'Making now' : p.clipCount ? `${p.clipCount} clips` : 'Draft'}
                  onClick={() => navigate(projectPath(p.id, canonicalStage(p.stage) || 'watch'))}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
