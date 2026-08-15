import { Link, useParams } from 'react-router-dom'
import { FailNote } from '../components/FailNote'
import { useStudioSession } from '../components/StudioSession'
import { api, type BrainClip } from '../lib/api'

function ClipCard({ clip, projectId }: { clip: BrainClip; projectId: string }) {
  const src = clip.video ? api.mediaUrl(clip.video) : clip.still ? api.mediaUrl(clip.still) : null
  return (
    <li className="card p-0 overflow-hidden">
      <div className="aspect-video bg-black">
        {clip.video ? (
          <video src={src || undefined} controls className="w-full h-full object-cover" />
        ) : clip.still ? (
          <img src={src || undefined} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[13px] text-ghost">Not made yet</div>
        )}
      </div>
      <div className="px-3.5 py-3 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] truncate">{clip.title || clip.id}</div>
          <div className="text-[12px] text-ghost">
            {clip.id}
            {clip.durationSec != null ? ` · ${clip.durationSec}s` : ''}
          </div>
        </div>
        <Link
          to={`/studio/${encodeURIComponent(projectId)}/board`}
          className="text-[13px] text-cyan shrink-0"
        >
          Board
        </Link>
      </div>
    </li>
  )
}

export function Watch() {
  const { projectId } = useParams()
  const { brain, err } = useStudioSession()

  if (!projectId) {
    return <p className="text-[15px] text-ghost">Open a project to watch the film.</p>
  }

  const clips = brain?.clips || []
  const videos = clips.filter((c) => c.video).length
  const hasFilm = Boolean(brain?.master) || videos > 0

  return (
    <div className="page">
      <FailNote error={err} />

      {!hasFilm ? (
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <p className="page-lead">Nothing to watch yet.</p>
          <Link to={`/studio/${encodeURIComponent(projectId)}/make`} className="text-[15px] text-cyan">
            Make the film
          </Link>
        </div>
      ) : null}

      {brain?.master ? (
        <div className="overflow-hidden rounded-[18px] bg-black">
          <video src={api.brainMasterUrl(projectId)} controls className="w-full max-h-[34rem] bg-black" />
        </div>
      ) : null}

      {clips.length ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {clips.map((c) => (
            <ClipCard key={c.id} clip={c} projectId={projectId} />
          ))}
        </ul>
      ) : (
        <div className="card">
          <p className="text-[17px] text-ghost">
            Nothing to watch yet. Start on{' '}
            <Link to={`/studio/${encodeURIComponent(projectId)}/plan`} className="text-cyan">
              Plan
            </Link>
            , then press Make the film.
          </p>
        </div>
      )}
    </div>
  )
}
