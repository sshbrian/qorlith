import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { useStudioLive, useStudioProjects, useStudioSession } from '../components/StudioSession'
import { api, type BrainClip } from '../lib/api'
import { clipBeat, clipJoinNote, clipPoster } from '../lib/studio'
import { preferBrainComfy, runIsLive } from '../lib/studioSession'

function formatRuntime(clips: BrainClip[]) {
  const sec = clips.reduce((n, c) => n + (Number(c.durationSec) || 0), 0)
  if (!sec) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const r = Math.round(sec % 60)
  return r ? `${m}m ${r}s` : `${m}m`
}

function WorkprintFrame({
  clip,
  t2v,
  live,
  index,
}: {
  clip: BrainClip
  t2v: boolean
  live?: boolean
  index: number
}) {
  const poster = clipPoster(clip, t2v ? 't2v' : 'stills')
  const beat = clipBeat(clip)
  const join = clipJoinNote(index, clip.cut)
  const title = [clip.title || clip.id, beat, join].filter(Boolean).join(' · ')
  return (
    <li
      className={['workprint-frame', live ? 'is-live' : '', join === 'cut' ? 'is-cut' : ''].join(' ')}
      title={title}
    >
      <div className="workprint-still">
        {poster?.kind === 'image' ? (
          <img src={api.mediaUrl(poster.src)} alt="" />
        ) : poster?.kind === 'video' ? (
          <video src={api.mediaUrl(poster.src)} muted playsInline preload="metadata" />
        ) : (
          <div className="workprint-empty">{live ? 'Making now' : ''}</div>
        )}
      </div>
      <span className="workprint-mark">{clip.id}</span>
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
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    setNeedSound(true)
    setPaused(false)
    const el = videoRef.current
    if (!el) return
    el.muted = true
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => setPaused(true))
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
      if (el.paused) {
        void el.play()
        setPaused(false)
      } else {
        el.pause()
        setPaused(true)
      }
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
    setPaused(false)
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (el.paused) {
      void el.play()
      setPaused(false)
    } else {
      el.pause()
      setPaused(true)
    }
  }

  return (
    <div className="theater">
      <div className="theater-player" onClick={togglePlay}>
        <video
          ref={videoRef}
          src={api.brainMasterUrl(projectId)}
          playsInline
          preload="auto"
          className="theater-video"
        />
        {needSound ? (
          <button type="button" className="theater-unmute" onClick={unmute}>
            Tap for sound
          </button>
        ) : null}
        {paused && !needSound ? (
          <div className="play-mark theater-pause-mark" aria-hidden>
            ▶
          </div>
        ) : null}
      </div>
      <div className="theater-meta">
        <div className="min-w-0">
          <h1 className="theater-title">{title}</h1>
          {runtime ? <p className="theater-runtime">{runtime}</p> : null}
        </div>
        <a href={api.brainMasterUrl(projectId)} download className="theater-save">
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
  const liveComfy = preferBrainComfy(brain, comfy)

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to watch the film.</p>
  }

  const running = runIsLive(brain)
  const title = brain?.title || current?.title || projectId
  const runtime = formatRuntime(clips)
  const makeHref = `/studio/${encodeURIComponent(projectId)}/make`
  const percent = liveComfy?.percent
  const makingLine = (liveComfy?.active && liveComfy.title) || brain?.label || 'Making your movie'

  return (
    <div className="screening">
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
            <Link viewTransition to={makeHref} className="btn btn-primary btn-xl mt-6">
              Make movie
            </Link>
          </div>
        </div>
      )}

      {sceneClips.length ? (
        <ol className="workprint" aria-label="Workprint">
          {sceneClips.map((c, i) => (
            <WorkprintFrame
              key={c.id}
              clip={c}
              t2v={t2v}
              index={i}
              live={running && brain?.currentClip === c.id}
            />
          ))}
        </ol>
      ) : null}
    </div>
  )
}
