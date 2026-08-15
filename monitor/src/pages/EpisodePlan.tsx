import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type EpisodePlanDetail, type EpisodeScene, type EpisodeStill } from '../lib/api'
import { FailNote } from '../components/FailNote'

export function EpisodePlan() {
  const { projectId } = useParams()
  const [data, setData] = useState<EpisodePlanDetail | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [sceneId, setSceneId] = useState('')
  const [viewByScene, setViewByScene] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setErr(null)
      if (!projectId) {
        setData(null)
        return
      }
      const d = await api.episodePlan(projectId)
      setData((prev) => {
        const nextFp = (d.scenes || [])
          .map((s) => `${s.id}:${s.pickRel || ''}:${(s.stills || []).map((x) => x.rel).join(',')}`)
          .join('|')
        const prevFp = (prev?.scenes || [])
          .map((s) => `${s.id}:${s.pickRel || ''}:${(s.stills || []).map((x) => x.rel).join(',')}`)
          .join('|')
        return prev && nextFp === prevFp ? prev : d
      })
      setSceneId((prev) => (d.scenes.some((s) => s.id === prev) ? prev : d.scenes[0]?.id || ''))
    } catch (e) {
      setErr(e)
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    void load()
    const t = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(t)
  }, [load])

  const scene: EpisodeScene | null = useMemo(
    () => data?.scenes.find((s) => s.id === sceneId) || data?.scenes[0] || null,
    [data, sceneId],
  )

  const viewing: EpisodeStill | null = useMemo(() => {
    if (!scene) return null
    const wanted = viewByScene[scene.id]
    return (
      scene.stills.find((s) => s.rel === wanted) ||
      scene.stills.find((s) => s.rel === scene.pickRel) ||
      scene.stills[0] ||
      null
    )
  }, [scene, viewByScene])

  async function pickStill(rel: string) {
    if (!scene || !data?.id) return
    setViewByScene((prev) => ({ ...prev, [scene.id]: rel }))
    setData((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        picks: { ...prev.picks, [scene.id]: rel },
        scenes: prev.scenes.map((s) =>
          s.id === scene.id
            ? { ...s, pickRel: rel, pick: s.stills.find((x) => x.rel === rel) || s.pick }
            : s,
        ),
      }
    })
    setBusy(true)
    try {
      await api.episodePick(data.id, scene.id, rel)
    } catch (e) {
      setErr(e)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-[15px] text-ghost">Loading stills…</p>
  if (err && !data) {
    return (
      <div className="space-y-3">
        <FailNote error={err} />
        <p className="text-[15px] text-ghost">
          Make a plan first. The board fills in after pictures are painted.
        </p>
      </div>
    )
  }
  if (!data || !scene) {
    return (
      <div className="card">
        <p className="text-[17px] text-ghost">No clips yet. Write the story in Plan, then Make the film.</p>
      </div>
    )
  }

  const picked = data.scenes.filter((s) => s.pickRel).length
  void data.markdown

  return (
    <div className="page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <p className="page-lead">
          Choose the picture you want for each clip. {picked} of {data.scenes.length} chosen.
        </p>
        {projectId ? (
          <Link to={`/studio/${encodeURIComponent(projectId)}/make`} className="text-[15px] text-cyan">
            Back to Make
          </Link>
        ) : null}
      </div>
      <FailNote error={err} />

      <nav className="flex flex-wrap gap-1.5">
        {data.scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSceneId(s.id)}
            className={`rounded-full px-3 py-1.5 text-[13px] ${
              s.id === scene.id ? 'bg-cyan text-white' : 'bg-white/[0.08] text-ghost hover:text-ink'
            }`}
          >
            {s.title || s.id}
          </button>
        ))}
      </nav>

      <section className="card space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-semibold tracking-tight">{scene.title || scene.id}</h2>
          <span className="text-[13px] text-ghost">
            {scene.stills.length ? `${scene.stills.length} takes` : 'No pictures yet'}
          </span>
        </div>

        {viewing ? (
          <img
            src={viewing.url}
            alt=""
            className="w-full max-h-[62vh] object-contain rounded-[12px] bg-black"
          />
        ) : (
          <div className="h-56 flex items-center justify-center text-[15px] text-ghost">
            No pictures for this clip yet. Press Make the film.
          </div>
        )}

        {viewing ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || scene.pickRel === viewing.rel}
            onClick={() => void pickStill(viewing.rel)}
          >
            {scene.pickRel === viewing.rel ? 'This one' : 'Use this one'}
          </button>
        ) : null}

        {scene.stills.length ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
            {scene.stills.map((s) => {
              const on = viewing?.rel === s.rel
              const pick = scene.pickRel === s.rel
              return (
                <button
                  key={s.rel}
                  type="button"
                  onClick={() => setViewByScene((prev) => ({ ...prev, [scene.id]: s.rel }))}
                  onDoubleClick={() => void pickStill(s.rel)}
                  className={`relative rounded-[10px] overflow-hidden ring-2 ${
                    on ? 'ring-cyan' : pick ? 'ring-white/30' : 'ring-transparent'
                  }`}
                >
                  <img src={s.url} alt="" className="w-full aspect-video object-cover" />
                  {pick ? (
                    <span className="absolute top-1 right-1 rounded-full bg-cyan text-white text-[11px] px-1.5">
                      Pick
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}
