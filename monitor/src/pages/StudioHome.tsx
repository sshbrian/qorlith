import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BrandMark } from '../components/BrandMark'
import { FailNote } from '../components/FailNote'
import { CoverThumb, PosterCard } from '../components/PosterCard'
import { VideoModeToggle, type VideoMode } from '../components/VideoModeToggle'
import { useStudioSession } from '../components/StudioSession'
import { api } from '../lib/api'
import { houseLights, houseWhoosh, toggleHouseMute } from '../lib/houseSound'
import {
  canonicalStage,
  filmsJustCanned,
  projectPath,
  PROMPT_PLACEHOLDER,
  PROMPT_STARTERS,
  VIDEO_MODE_HINT,
  readTonightId,
  tonightFilm,
  writeTonightId,
} from '../lib/studio'

export function StudioHome() {
  const { projects, projectsReady, refreshProjects } = useStudioSession()
  const navigate = useNavigate()
  const tonight = tonightFilm(projects, readTonightId())
  const recents = projects.filter((p) => p.id !== tonight?.id).slice(0, 8)
  const [prompt, setPrompt] = useState('')
  const [videoMode, setVideoMode] = useState<VideoMode>('stills')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [cannedId, setCannedId] = useState<string | null>(null)
  const prevProjects = useRef(projects)
  const emptyHouse = recents.length === 0 && !tonight

  useEffect(() => {
    const prev = prevProjects.current
    prevProjects.current = projects
    if (!prev.length || !projects.length) return
    const landed = filmsJustCanned(prev, projects)
    if (!landed.length) return
    const film = landed[0]
    writeTonightId(film.id)
    setCannedId(film.id)
    houseLights()
    const t = window.setTimeout(() => setCannedId(null), 2400)
    return () => window.clearTimeout(t)
  }, [projects])

  const makeMovie = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.studioFilm({ prompt: text, videoMode })
      await refreshProjects()
      houseWhoosh()
      navigate(`/studio/${encodeURIComponent(r.projectId)}/make`, { viewTransition: true })
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  if (!projectsReady) {
    return (
      <div className="lobby is-empty lobby-hold">
        <header className="lobby-hero">
          <div className="lobby-mark is-waking" aria-hidden>
            <BrandMark className="h-11 w-11" title="Qorlith" />
          </div>
          <h1 className="lobby-word">Make a movie</h1>
          <p className="lobby-kicker">The lights are coming up.</p>
        </header>
      </div>
    )
  }

  const openWatch = (id: string) =>
    navigate(projectPath(id, 'watch'), { viewTransition: true })

  return (
    <div className={['lobby', emptyHouse ? 'is-empty' : '', tonight ? 'has-night' : '', cannedId ? 'is-canned' : ''].join(' ')}>
      {tonight?.coverUrl ? (
        <div className="lobby-night" aria-hidden>
          <CoverThumb url={tonight.coverUrl} kind={tonight.coverKind} />
        </div>
      ) : null}
      <header className="lobby-hero">
        <button type="button" className="lobby-mark" onClick={() => toggleHouseMute()} title="The house">
          <BrandMark className="h-11 w-11" title="Qorlith" />
        </button>
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

      {tonight ? (
        <section className={['tonight', cannedId === tonight.id ? 'is-canned' : ''].join(' ')} aria-label="Tonight">
          <h2 className="poster-wall-kicker">Tonight</h2>
          <div className="tonight-reel">
            <PosterCard
              overlay
              featured
              canned={cannedId === tonight.id}
              title={tonight.title || tonight.id}
              coverUrl={tonight.coverUrl}
              coverKind={tonight.coverKind}
              meta={tonight.clipCount ? `${tonight.clipCount} clips` : 'Ready'}
              onClick={() => openWatch(tonight.id)}
            />
            <button type="button" className="theater-save" onClick={() => openWatch(tonight.id)}>
              Watch again
            </button>
          </div>
        </section>
      ) : null}

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
                  onClick={() =>
                    navigate(projectPath(p.id, canonicalStage(p.stage) || 'watch'), { viewTransition: true })
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
