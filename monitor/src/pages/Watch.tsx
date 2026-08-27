import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { useStudioLive, useStudioProjects, useStudioSession } from '../components/StudioSession'
import { api, type BrainClip } from '../lib/api'
import { houseLights, housePin, houseWhoosh } from '../lib/houseSound'
import {
  clipBeat,
  clipFracAtTime,
  clipIndexAtTime,
  clipJoinNote,
  clipPoster,
  clipStartTime,
  clipsDuration,
  timeAtReel,
  watchFirstFrame,
  watchFrameHref,
  writeTonightId,
  type WatchFrame,
} from '../lib/studio'
import { preferBrainComfy, runIsLive } from '../lib/studioSession'

function formatRuntime(clips: BrainClip[]) {
  const sec = clips.reduce((n, c) => n + (Number(c.durationSec) || 0), 0)
  if (!sec) return ''
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const r = Math.round(sec % 60)
  return r ? `${m}m ${r}s` : `${m}m`
}

function frameHref(frame: WatchFrame | null) {
  return frame ? watchFrameHref(frame, api.mediaUrl) : ''
}

function FirstFrame({ frame }: { frame: WatchFrame }) {
  const ref = useRef<HTMLVideoElement>(null)
  const href = frameHref(frame)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const hold = () => {
      el.pause()
      try {
        if (el.currentTime < 0.05) el.currentTime = 0.05
      } catch {
        /* ignore */
      }
    }
    el.addEventListener('loadeddata', hold)
    if (el.readyState >= 2) hold()
    return () => el.removeEventListener('loadeddata', hold)
  }, [href])

  if (frame.kind === 'image') return <img src={href} alt="" className="theater-first-pic" />
  return <video ref={ref} src={href} muted playsInline preload="auto" className="theater-first-pic" />
}

function WorkprintFrame({
  clip,
  t2v,
  live,
  on,
  index,
  frac,
  cue,
  hung,
}: {
  clip: BrainClip
  t2v: boolean
  live?: boolean
  on?: boolean
  index: number
  frac?: number
  cue?: boolean
  hung?: boolean
}) {
  const poster = clipPoster(clip, t2v ? 't2v' : 'stills')
  const beat = clipBeat(clip)
  const join = clipJoinNote(index, clip.cut)
  const title = [clip.title || clip.id, beat, join].filter(Boolean).join(' · ')
  const hair = on && frac != null ? Math.min(100, Math.max(0, frac * 100)) : null
  return (
    <li
      className={[
        'workprint-frame',
        live ? 'is-live' : '',
        on ? 'is-on' : '',
        join === 'cut' ? 'is-cut' : '',
        cue ? 'is-cue' : '',
        hung ? 'is-hung' : '',
      ].join(' ')}
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
        {hair != null ? <i className="workprint-hair" style={{ left: `${hair}%` }} /> : null}
      </div>
      <span className="workprint-mark">{clip.id}</span>
    </li>
  )
}

function TheaterPlayer({
  projectId,
  title,
  runtime,
  firstFrame,
  clips,
  t2v,
  onOver,
}: {
  projectId: string
  title: string
  runtime: string
  firstFrame: WatchFrame | null
  clips: BrainClip[]
  t2v: boolean
  onOver?: (over: boolean) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const reelRef = useRef<HTMLOListElement>(null)
  const [needSound, setNeedSound] = useState(true)
  const [paused, setPaused] = useState(false)
  const [lit, setLit] = useState(false)
  const [ended, setEnded] = useState(false)
  const [print, setPrint] = useState(false)
  const [onIndex, setOnIndex] = useState(0)
  const [playhead, setPlayhead] = useState(0)
  const [hungId, setHungId] = useState<string | null>(null)
  const { refreshProjects } = useStudioProjects()
  const posterHref = firstFrame?.kind === 'image' ? frameHref(firstFrame) : undefined

  useEffect(() => {
    setNeedSound(true)
    setPaused(false)
    setLit(false)
    setEnded(false)
    setPrint(false)
    setOnIndex(0)
    setPlayhead(0)
    setHungId(null)
    onOver?.(false)
    const el = videoRef.current
    if (!el) return
    el.muted = true
    const play = el.play()
    if (play && typeof play.catch === 'function') play.catch(() => setPaused(true))
  }, [projectId, onOver])

  const replay = useCallback(() => {
    const el = videoRef.current
    setEnded(false)
    setLit(false)
    setPaused(false)
    setPrint(false)
    setOnIndex(0)
    setPlayhead(0)
    onOver?.(false)
    if (!el) return
    el.currentTime = 0
    void el.play()
  }, [onOver])

  const holdAt = useCallback(
    (t: number) => {
      const el = videoRef.current
      if (!el) return
      const total = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clipsDuration(clips)
      const x = Math.max(0, Math.min(t, Math.max(0, total - 0.05)))
      el.currentTime = x
      el.pause()
      setPlayhead(x)
      setOnIndex(clipIndexAtTime(clips, x))
      setLit(true)
      setEnded(false)
      setPrint(true)
      setPaused(true)
      onOver?.(false)
    },
    [clips, onOver],
  )

  const hangPrint = useCallback(async () => {
    const clip = clips[onIndex]
    if (!clip) return
    const still = String(clip.still || '')
    const src =
      !t2v && still && !/_from_prev\./i.test(still)
        ? still
        : clipPoster(clip, t2v ? 't2v' : 'stills')?.src
    if (!src) return
    try {
      await api.studioCoverHang(projectId, src)
      housePin()
      setHungId(clip.id)
      await refreshProjects()
    } catch {
      /* ignore */
    }
  }, [clips, onIndex, t2v, projectId, refreshProjects])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault()
        void hangPrint()
        return
      }
      if (e.key === 'j' || e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (!clips.length) return
        const i = Math.max(0, Math.min(clips.length - 1, onIndex + 1))
        holdAt(clipStartTime(clips, i) + 0.04)
        return
      }
      if (e.key === 'k' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (!clips.length) return
        const i = Math.max(0, Math.min(clips.length - 1, onIndex - 1))
        holdAt(clipStartTime(clips, i) + 0.04)
        return
      }
      if (e.code !== 'Space' && e.key !== ' ') return
      e.preventDefault()
      const el = videoRef.current
      if (!el) return
      if (el.muted) {
        el.muted = false
        setNeedSound(false)
      }
      if (ended || el.ended) {
        replay()
        return
      }
      if (el.paused) {
        setPrint(false)
        void el.play()
        setPaused(false)
      } else {
        el.pause()
        setPaused(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ended, replay, hangPrint, clips, onIndex, holdAt])

  const unmute = (e: MouseEvent) => {
    e.stopPropagation()
    const el = videoRef.current
    if (!el) return
    el.muted = false
    el.volume = 1
    setNeedSound(false)
    if (ended) {
      replay()
      return
    }
    void el.play()
    setPaused(false)
  }

  const scrubFromPointer = (clientX: number) => {
    const root = reelRef.current
    if (!root || !clips.length) return
    const frames = [...root.children]
    let index = 0
    let frac = 0
    for (let i = 0; i < frames.length; i++) {
      const r = frames[i].getBoundingClientRect()
      if (clientX < r.left) {
        index = i
        frac = 0
        break
      }
      if (clientX <= r.right || i === frames.length - 1) {
        index = i
        frac = r.width <= 0 ? 0 : (clientX - r.left) / r.width
        break
      }
    }
    holdAt(timeAtReel(clips, index, frac))
  }

  const onReelPointer = (e: ReactPointerEvent<HTMLOListElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    scrubFromPointer(e.clientX)
  }

  const onReelMove = (e: ReactPointerEvent<HTMLOListElement>) => {
    if ((e.buttons & 1) !== 1) return
    e.preventDefault()
    scrubFromPointer(e.clientX)
  }

  const togglePlay = () => {
    const el = videoRef.current
    if (!el) return
    if (ended) {
      replay()
      return
    }
    if (el.paused) {
      setPrint(false)
      void el.play()
      setPaused(false)
    } else {
      el.pause()
      setPaused(true)
    }
  }

  const onPlaying = () => {
    setLit(true)
    setPaused(false)
    setEnded(false)
    setPrint(false)
  }

  const onFilmEnded = () => {
    setEnded(true)
    setPaused(true)
    onOver?.(true)
    houseLights()
  }

  const onTime = () => {
    const el = videoRef.current
    if (!el || ended) return
    if (!lit && el.currentTime > 0.04) setLit(true)
    const t = el.currentTime
    setPlayhead(t)
    const i = clipIndexAtTime(clips, t)
    setOnIndex((prev) => (prev === i ? prev : i))
  }

  useEffect(() => {
    const on = !ended
    document.documentElement.classList.toggle('is-picture', on)
    return () => document.documentElement.classList.remove('is-picture')
  }, [ended, projectId])

  useEffect(() => {
    const root = reelRef.current
    if (!root || ended || onIndex < 0) return
    const el = root.children[onIndex]
    if (!(el instanceof HTMLElement)) return
    const left = el.offsetLeft - root.clientWidth / 2 + el.clientWidth / 2
    let reduce = false
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      /* ignore */
    }
    root.scrollTo({ left: Math.max(0, left), behavior: reduce ? 'auto' : 'smooth' })
  }, [onIndex, ended])

  const playing = lit && !paused && !ended
  const printing = print && paused && !ended
  const frac = clipFracAtTime(clips, playhead)

  return (
    <>
      <div className={['theater', ended ? 'is-over' : playing ? 'is-playing' : printing ? 'is-print' : ''].join(' ')}>
        <div
          className={['theater-player', ended ? 'is-over' : lit ? 'is-lit' : 'is-down'].join(' ')}
          onClick={togglePlay}
        >
          <video
            ref={videoRef}
            src={api.brainMasterUrl(projectId)}
            poster={posterHref}
            playsInline
            preload="auto"
            className="theater-video"
            onPlaying={onPlaying}
            onEnded={onFilmEnded}
            onTimeUpdate={onTime}
            onPause={() => setPaused(true)}
            onPlay={() => setPaused(false)}
          />
          {firstFrame && !ended ? (
            <div className={['theater-first', lit ? 'is-gone' : ''].join(' ')} aria-hidden>
              <FirstFrame frame={firstFrame} />
            </div>
          ) : null}
          {needSound && !ended ? (
            <button type="button" className="theater-unmute" onClick={unmute}>
              Tap for sound
            </button>
          ) : null}
          {paused && !needSound && !ended && lit && !print ? (
            <div className="play-mark theater-pause-mark" aria-hidden>
              ▶
            </div>
          ) : null}
          {ended ? (
            <div className="theater-credits">
              <p className="theater-credits-title">{title}</p>
              {runtime ? <p className="theater-credits-runtime">{runtime}</p> : null}
              <p className="theater-credits-house">Made with Qorlith</p>
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
      {clips.length ? (
        <ol
          ref={reelRef}
          className={['workprint', printing ? 'is-print' : ''].join(' ')}
          aria-label="Workprint"
          onPointerDown={onReelPointer}
          onPointerMove={onReelMove}
        >
          {clips.map((c, i) => (
            <WorkprintFrame
              key={c.id}
              clip={c}
              t2v={t2v}
              index={i}
              on={!ended && onIndex === i}
              frac={!ended && onIndex === i ? frac : undefined}
              cue
              hung={hungId === c.id}
            />
          ))}
        </ol>
      ) : null}
    </>
  )
}

export function Watch() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { brain, err } = useStudioSession()
  const { current } = useStudioProjects()
  const { comfy } = useStudioLive()
  const clips = brain?.clips || []
  const t2v = brain?.videoMode === 't2v' || current?.videoMode === 't2v'
  const makingPoster = clips.map((c) => clipPoster(c, t2v ? 't2v' : 'stills')).find(Boolean) || null
  const sceneClips = clips.filter((c) => c.id)
  const liveComfy = preferBrainComfy(brain, comfy)
  const firstFrame = watchFirstFrame(sceneClips, t2v ? 't2v' : 'stills', current)
  const [over, setOver] = useState(false)

  useEffect(() => {
    setOver(false)
  }, [projectId])

  useEffect(() => {
    if (projectId && brain?.master) writeTonightId(projectId)
  }, [projectId, brain?.master])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return
      if (e.key !== 'Escape') return
      e.preventDefault()
      houseWhoosh()
      navigate('/studio', { viewTransition: true })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

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
    <div className={['screening', over ? 'is-over' : ''].join(' ')}>
      <FailNote error={err} />

      {brain?.master ? (
        <TheaterPlayer
          projectId={projectId}
          title={title}
          runtime={runtime}
          firstFrame={firstFrame}
          clips={sceneClips}
          t2v={t2v}
          onOver={setOver}
        />
      ) : running ? (
        <div className="theater">
          <div className="theater-player theater-making">
            {makingPoster?.kind === 'image' ? (
              <img src={api.mediaUrl(makingPoster.src)} alt="" className="theater-poster" />
            ) : makingPoster?.kind === 'video' ? (
              <video src={api.mediaUrl(makingPoster.src)} muted playsInline loop className="theater-poster" />
            ) : firstFrame ? (
              firstFrame.kind === 'image' ? (
                <img src={frameHref(firstFrame)} alt="" className="theater-poster" />
              ) : (
                <video src={frameHref(firstFrame)} muted playsInline loop className="theater-poster" />
              )
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
            {firstFrame ? (
              firstFrame.kind === 'image' ? (
                <img src={frameHref(firstFrame)} alt="" className="theater-poster" />
              ) : (
                <video src={frameHref(firstFrame)} muted playsInline className="theater-poster" />
              )
            ) : null}
            {firstFrame ? <div className="theater-making-scrim" /> : null}
            <div className="play-mark" aria-hidden>
              ▶
            </div>
            <p className="page-lead mt-5 text-center">
              {sceneClips.length ? 'The film is not made yet.' : 'The house is dark. Sit down when there is a picture.'}
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

      {!brain?.master && sceneClips.length ? (
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
