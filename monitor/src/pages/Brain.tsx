import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { BrainGraph } from '../components/BrainGraph'
import { ComfyProgress } from '../components/ComfyProgress'
import { StoryboardModal } from '../components/StoryboardModal'
import { WorkflowModal } from '../components/WorkflowModal'
import { useStudioLive, useStudioSession } from '../components/StudioSession'
import { api, type BrainClip, type BrainStep } from '../lib/api'
import { idleBrainReport, preferBrainComfy, runIsLive } from '../lib/studioSession'
import { clipJoinNote, clipPoster, watchFirstFrame, watchFrameHref } from '../lib/studio'

function StepNode({ step }: { step: BrainStep }) {
  const on = step.state === 'active'
  const done = step.state === 'done'
  const fail = step.state === 'fail'
  return (
    <div
      className={[
        'shrink-0 rounded-full px-3 py-1 text-[13px]',
        fail
          ? 'bg-magenta/15 text-magenta'
          : on
            ? 'bg-cyan text-white'
            : done
              ? 'text-ink bg-white/[0.08]'
              : 'text-ghost bg-white/[0.04]',
      ].join(' ')}
      aria-current={on ? 'step' : undefined}
    >
      {step.label}
    </div>
  )
}

function BrainProgress({ armed }: { armed: boolean }) {
  const { comfy } = useStudioLive()
  const { brain } = useStudioSession()
  if (!armed) return null
  return (
    <div className="progress-slot is-armed">
      <ComfyProgress progress={preferBrainComfy(brain, comfy)} hold />
    </div>
  )
}

const Filmstrip = memo(function Filmstrip({
  clips,
  currentClip,
  t2v,
}: {
  clips: BrainClip[]
  currentClip: string | null | undefined
  t2v: boolean
}) {
  return (
    <ul className="filmstrip">
      {clips.map((c, i) => {
        const poster = clipPoster(c, t2v ? 't2v' : 'stills')
        const join = clipJoinNote(i, c.cut)
        return (
          <li
            key={c.id}
            className={[currentClip === c.id ? 'is-live' : '', join === 'cut' ? 'is-cut' : ''].join(' ')}
            aria-current={currentClip === c.id ? 'true' : undefined}
          >
            {poster?.kind === 'image' ? (
              <img src={api.mediaUrl(poster.src)} alt="" decoding="async" />
            ) : poster?.kind === 'video' ? (
              <video src={api.mediaUrl(poster.src)} muted playsInline preload="metadata" />
            ) : (
              <span className="filmstrip-empty">{currentClip === c.id ? 'Now' : ''}</span>
            )}
            <span className="filmstrip-id">{c.title || c.id}</span>
          </li>
        )
      })}
    </ul>
  )
})

export function Brain() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { brain, current, loading, busy, err, start, resume, stop } = useStudioSession()
  const t2v = brain?.videoMode === 't2v' || current?.videoMode === 't2v'
  const fallback = useMemo(
    () => idleBrainReport(projectId || '', { videoMode: t2v ? 't2v' : 'stills' }),
    [projectId, t2v],
  )
  const [sheet, setSheet] = useState<null | 'story' | 'stills' | 'video'>(null)
  const [more, setMore] = useState(false)
  const sentWatch = useRef(false)
  const sawLive = useRef(false)
  const raw = brain && (brain.started || (brain.clips && brain.clips.length)) ? brain : fallback
  const report = t2v && raw.videoMode !== 't2v' ? { ...raw, videoMode: 't2v' } : raw
  const running = runIsLive(report)
  const hasMaster = Boolean(report.master)

  useEffect(() => {
    sentWatch.current = false
    sawLive.current = false
  }, [projectId])
  useEffect(() => {
    if (running) sawLive.current = true
  }, [running])
  useEffect(() => {
    if (!projectId || running || report.status !== 'done' || !report.master) return
    if (!sawLive.current || sentWatch.current) return
    sentWatch.current = true
    sawLive.current = false
    navigate(`/studio/${encodeURIComponent(projectId)}/watch`, { viewTransition: true })
  }, [projectId, running, report.status, report.master, navigate])

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to make the film.</p>
  }

  const clips = report.clips || []
  const printFrame = watchFirstFrame(clips, t2v ? 't2v' : 'stills', current)
  const printPoster = printFrame?.kind === 'image' ? watchFrameHref(printFrame, api.mediaUrl) : undefined
  const openNode = (id: string) => {
    if (id === 'plan') setSheet('story')
    else if (id === 'stills') {
      if (!t2v) setSheet('stills')
    } else if (id === 'video') setSheet('video')
    else if (id === 'face_qa') {
      if (!t2v) navigate(`/studio/${encodeURIComponent(projectId)}/board`, { viewTransition: true })
    } else if (id === 'finish') navigate(`/studio/${encodeURIComponent(projectId)}/watch`, { viewTransition: true })
  }
  const steps = t2v
    ? (report.steps || []).filter((s) => s.id !== 'stills' && s.id !== 'face_qa')
    : report.steps || []
  const canStart = !running && !busy
  const canStop = running && !busy
  const canResume =
    canStart && Boolean(report.started) && report.status !== 'done' && report.status !== 'idle'
  const primaryLabel = running || busy ? 'Working…' : report.started ? 'Make again' : 'Make movie'
  const statusTone =
    running
      ? 'text-amber'
      : report.status === 'fail' || report.status === 'stopped'
        ? 'text-magenta'
        : 'text-ghost'
  const idle = !report.started && !loading

  return (
    <div className="set">
      <div className="set-slate">
        <p className="set-call">
          {running
            ? 'Making your movie. You can leave this page.'
            : hasMaster
              ? 'The film is ready.'
              : t2v
                ? 'One button. Straight to video, then the film.'
                : 'One button. Stills, then the clips.'}
        </p>
        <div className={`set-status ${statusTone}`}>
          {running ? (
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber mr-2 align-middle pulse-dot" />
          ) : null}
          {report.label || (report.started ? report.status : 'Ready')}
        </div>
      </div>

      <div className="set-hands">
        {hasMaster && !running ? (
          <Link viewTransition to={`/studio/${encodeURIComponent(projectId)}/watch`} className="btn btn-primary">
            Watch
          </Link>
        ) : null}
        {canStart && !idle ? (
          <button type="button" onClick={() => void start('film')} className="btn btn-primary">
            {primaryLabel}
          </button>
        ) : null}
        {canResume ? (
          <button type="button" onClick={() => void resume()} className="btn btn-secondary">
            Continue
          </button>
        ) : null}
        {canStop ? (
          <button type="button" onClick={() => void stop()} className="btn btn-danger">
            Stop
          </button>
        ) : null}
        {t2v ? null : (
          <button type="button" onClick={() => setMore((v) => !v)} className="btn btn-secondary">
            {more ? 'Less' : 'More'}
          </button>
        )}
      </div>

      {more && !t2v ? (
        <div className="set-hands">
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start('stills')}
            className="btn btn-secondary"
          >
            Pictures only
          </button>
        </div>
      ) : null}

      <FailNote error={err} />
      {report.lastError ? <FailNote error={report.lastError} /> : null}

      {idle && !clips.length ? (
        <div className="theater-player theater-empty">
          <div className="play-mark" aria-hidden>
            ▶
          </div>
          <p className="page-lead mt-5 text-center">The set is quiet. Call action when you are ready.</p>
          <button
            type="button"
            disabled={!canStart}
            onClick={() => void start('film')}
            className="btn btn-primary btn-xl mt-6"
          >
            Make movie
          </button>
        </div>
      ) : idle ? (
        <p className="set-call">The film is not made yet.</p>
      ) : running ? (
        <div className="set-progress">
          <BrainProgress armed={running} />
        </div>
      ) : null}

      {report.status === 'face_qa' && !report.reviewOk && !t2v ? (
        <p className="set-board">
          Waiting on the board.{' '}
          <Link viewTransition to={`/studio/${encodeURIComponent(projectId)}/board`} className="text-cyan hover:underline">
            Set picks
          </Link>
          , then press Continue.
        </p>
      ) : null}

      {clips.length ? (
        <div className="set-strip">
          <Filmstrip clips={clips} currentClip={report.currentClip} t2v={t2v} />
          {idle ? (
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void start('film')}
              className="btn btn-primary btn-xl title-card-go mt-5"
            >
              Make movie
            </button>
          ) : null}
        </div>
      ) : null}

      {more && !t2v && (report.started || (report.steps || []).length) ? (
        <div className="set-steps" role="list">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-2" role="listitem">
              {i > 0 ? <span className="text-ghost/35 text-xs">→</span> : null}
              <StepNode step={step} />
            </div>
          ))}
        </div>
      ) : null}

      {hasMaster && !running ? (
        <Link
          viewTransition
          to={`/studio/${encodeURIComponent(projectId)}/watch`}
          className="set-print"
          title="Watch the film"
        >
          <video
            src={api.brainMasterUrl(projectId)}
            poster={printPoster}
            muted
            playsInline
            preload="metadata"
            className="theater-video"
          />
        </Link>
      ) : null}

      <details className="set-craft">
        <summary className="text-[15px] text-ghost cursor-pointer">How it is made</summary>
        <div className="mt-4">
          <BrainGraph brain={report} onOpenNode={openNode} />
        </div>
      </details>
      {sheet === 'story' ? <StoryboardModal projectId={projectId} onClose={() => setSheet(null)} /> : null}
      {sheet === 'stills' ? (
        <WorkflowModal projectId={projectId} kind="still" onClose={() => setSheet(null)} />
      ) : null}
      {sheet === 'video' ? (
        <WorkflowModal projectId={projectId} kind="video" onClose={() => setSheet(null)} />
      ) : null}
    </div>
  )
}
