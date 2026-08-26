import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { useStudioLive, useStudioProjects, useStudioSession } from '../components/StudioSession'
import { api, type BrainClip } from '../lib/api'
import { clipJoinNote, clipPoster } from '../lib/studio'
import { runIsLive } from '../lib/studioSession'

function formatRuntime(clips: BrainClip[]) {
  const sec = clips.reduce((n, c) => n + (Number(c.durationSec) || 0), 0)
  if (!sec) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const r = Math.round(sec % 60)
  return r ? `${m}m ${r}s` : `${m}m`
}

function SceneCard({
  clip,
  projectId,
  t2v,
  live,
  index,
}: {
  clip: BrainClip
  projectId: string
  t2v: boolean
  live?: boolean
  index: number
}) {
  const poster = clipPoster(clip, t2v ? 't2v' : 'stills')
  const beat = (t2v ? clip.motionBrief : clip.stillBrief) || clip.motionBrief || ''
  const join = clipJoinNote(index, clip.cut)
  return (
    <li className={['scene-card', live ? 'is-live' : ''].join(' ')}>
      <div className="scene-card-still">
        {poster?.kind === 'image' ? (
          <img src={api.mediaUrl(poster.src)} alt="" />
        ) : poster?.kind === 'video' ? (
          <video src={api.mediaUrl(poster.src)} muted playsInline preload="metadata" className="w-full h-full object-cover" />
        ) : (
          <div className="scene-card-empty">{live ? 'Making now' : 'Not made yet'}</div>
        )}
      </div>
      <div className="scene-card-body">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[15px] truncate">{clip.title || clip.id}</div>
            <div className="text-[12px] text-ghost shrink-0">
              {clip.durationSec != null ? `${clip.durationSec}s` : clip.id}
              {join ? ` · ${join}` : ''}
            </div>
          </div>
          {beat ? <div className="text-[12px] text-ghost truncate mt-0.5">{beat}</div> : null}
        </div>
        {t2v ? null : (
          <Link to={`/studio/${encodeURIComponent(projectId)}/board`} className="text-[13px] text-cyan shrink-0">
            Board
          </Link>
        )}
      </div>
    </li>
  )
}

function TheaterPlayer({
  projectId,
  title,
  runtime,
}: {
  projectId: string
  title: string
  runtime: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [needSound, setNeedSound] = useState(true)

  useEffect(() => {
    setNeedSound(true)
    const el = videoRef.current
    if (!el) return
    el.muted = true
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => {})
  }, [projectId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      const el = videoRef.current
      if (!el) return
      if (el.muted) {
        el.muted = false
        setNeedSound(false)
      }
      if (el.paused) void el.play()
      else el.pause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const unmute = (e: MouseEvent) => {
    e.stopPropagation()
    const el = videoRef.current
    if (!el) return
    el.muted = false
    el.volume = 1
    setNeedSound(false)
    void el.play()
  }

  return (
    <div className="theater">
      <div className="theater-player">
        <video
          ref={videoRef}
          src={api.brainMasterUrl(projectId)}
          controls
          playsInline
          preload="auto"
          className="theater-video"
        />
        {needSound ? (
          <button type="button" className="theater-unmute" onClick={unmute}>
            Tap for sound
          </button>
        ) : null}
      </div>
      <div className="theater-meta">
        <div className="min-w-0">
          <h1 className="theater-title">{title}</h1>
          {runtime ? <p className="theater-runtime">{runtime}</p> : null}
        </div>
        <a href={api.brainMasterUrl(projectId)} download className="btn btn-secondary">
          Save film
        </a>
      </div>
    </div>
  )
}

export function Watch() {
  const { projectId } = useParams()
  const { brain, err } = useStudioSession()
  const { current } = useStudioProjects()
  const { comfy } = useStudioLive()
  const clips = brain?.clips || []
  const t2v = brain?.videoMode === 't2v' || current?.videoMode === 't2v'
  const makingPoster = clips.map((c) => clipPoster(c, t2v ? 't2v' : 'stills')).find(Boolean) || null
  const sceneClips = clips.filter((c) => c.id)

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to watch the film.</p>
  }

  const running = runIsLive(brain)
  const title = brain?.title || current?.title || projectId
  const runtime = formatRuntime(clips)
  const makeHref = `/studio/${encodeURIComponent(projectId)}/make`
  const percent = comfy?.percent
  const makingLine = (comfy?.active && comfy.title) || brain?.label || 'Making your movie'

  return (
    <div className="page">
      <FailNote error={err} />

      {brain?.master ? (
        <TheaterPlayer projectId={projectId} title={title} runtime={runtime} />
      ) : running ? (
        <div className="theater">
          <div className="theater-player theater-making">
            {makingPoster?.kind === 'image' ? (
              <img src={api.mediaUrl(makingPoster.src)} alt="" className="theater-poster" />
            ) : makingPoster?.kind === 'video' ? (
              <video src={api.mediaUrl(makingPoster.src)} muted playsInline loop className="theater-poster" />
            ) : null}
            <div className="theater-making-scrim" />
            <div className="theater-making-copy">
              <p className="theater-making-kicker">{t2v ? 'Straight to video' : 'Making your movie'}</p>
              <p className="theater-title">{makingLine}</p>
              {percent != null ? (
                <p className="theater-runtime tabular-nums">{Math.round(percent)}%</p>
              ) : (
                <p className="theater-runtime">You can leave this page.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="theater">
          <div className="theater-player theater-empty">
            <div className="play-mark" aria-hidden>
              ▶
            </div>
            <p className="page-lead mt-5 text-center">
              {sceneClips.length ? 'The film is not made yet.' : 'Nothing to watch yet.'}
            </p>
            {sceneClips.length && runtime ? (
              <p className="theater-runtime mt-2">{runtime} planned</p>
            ) : null}
            <Link to={makeHref} className="btn btn-primary btn-xl mt-6">
              Make movie
            </Link>
          </div>
        </div>
      )}

      {sceneClips.length ? (
        <div>
          <h2 className="text-[15px] text-ghost mb-3">Scenes</h2>
          <ul className="scene-grid">
            {sceneClips.map((c, i) => (
              <SceneCard
                key={c.id}
                clip={c}
                projectId={projectId}
                t2v={t2v}
                index={i}
                live={running && brain?.currentClip === c.id}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
