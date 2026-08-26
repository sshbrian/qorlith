import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { api, type EpisodePlanDetail, type EpisodeScene, type EpisodeStill } from '../lib/api'
import { FailNote } from '../components/FailNote'
import { useStudioSession } from '../components/StudioSession'

export function EpisodePlan() {
  const { projectId } = useParams()
  const { brain } = useStudioSession()
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

  if (brain?.videoMode === 't2v' && projectId) {
    return <Navigate to={`/studio/${encodeURIComponent(projectId)}/make`} replace />
  }

  if (loading && !data) {
    return (
      <div className="table table-hold">
        <div className="table-glass" aria-hidden>
          <div className="table-glow" />
        </div>
      </div>
    )
  }
  if (err && !data) {
    return (
      <div className="table">
        <FailNote error={err} />
        <p className="set-call">
          Make a plan first. The board fills in after pictures are painted.
        </p>
      </div>
    )
  }
  if (!data || !scene) {
    return (
      <div className="table">
        <div className="table-glass table-glass-empty">
          <div className="table-glow" />
          <p className="set-call">The glass is empty. Write the story, then come back for the cut.</p>
          {projectId ? (
            <Link to={`/studio/${encodeURIComponent(projectId)}/plan`} className="btn btn-primary btn-xl mt-6">
              Open Plan
            </Link>
          ) : null}
        </div>
      </div>
    )
  }

  const picked = data.scenes.filter((s) => s.pickRel).length
  void data.markdown
  const pinned = scene.pickRel === viewing?.rel

  return (
    <div className="table">
      <div className="set-slate">
        <p className="set-call">
          Choose the frame for the cut. {picked} of {data.scenes.length} pinned.
        </p>
        {projectId ? (
          <Link to={`/studio/${encodeURIComponent(projectId)}/make`} className="theater-save">
            Back to the set
          </Link>
        ) : null}
      </div>
      <FailNote error={err} />

      <ol className="workprint table-clips" aria-label="Clips">
        {data.scenes.map((s) => {
          const thumb = s.pick?.url || s.stills[0]?.url
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSceneId(s.id)}
                className={['table-clip', s.id === scene.id ? 'is-on' : '', s.pickRel ? 'is-pinned' : ''].join(' ')}
                title={s.title || s.id}
              >
                {thumb ? <img src={thumb} alt="" /> : <span className="workprint-empty" />}
                <span className="workprint-mark">{s.id}</span>
              </button>
            </li>
          )
        })}
      </ol>

      <section className="table-glass">
        <div className="table-glow" />
        <div className="table-glass-head">
          <h2 className="script-title">{scene.title || scene.id}</h2>
          <span className="text-[13px] text-ghost">
            {scene.stills.length ? `${scene.stills.length} takes` : 'No pictures yet'}
          </span>
        </div>

        {viewing ? (
          <button
            type="button"
            className="table-hero"
            onDoubleClick={() => void pickStill(viewing.rel)}
            title="Double-click to pin this frame"
          >
            <img src={viewing.url} alt="" />
          </button>
        ) : (
          <div className="table-hero is-empty">
            <p className="set-call">No pictures for this clip yet. Press Make movie.</p>
          </div>
        )}

        {viewing ? (
          <button
            type="button"
            className="btn btn-primary btn-xl title-card-go"
            disabled={busy || pinned}
            onClick={() => void pickStill(viewing.rel)}
          >
            {pinned ? 'This one' : 'Use this one'}
          </button>
        ) : null}

        {scene.stills.length ? (
          <div className="table-contact">
            {scene.stills.map((s, i) => {
              const on = viewing?.rel === s.rel
              const pick = scene.pickRel === s.rel
              return (
                <button
                  key={s.rel}
                  type="button"
                  onClick={() => setViewByScene((prev) => ({ ...prev, [scene.id]: s.rel }))}
                  onDoubleClick={() => void pickStill(s.rel)}
                  className={['table-print', on ? 'is-viewing' : '', pick ? 'is-pinned' : ''].join(' ')}
                  style={{ ['--tilt' as string]: `${((i % 3) - 1) * 1.1}deg` }}
                >
                  <img src={s.url} alt="" />
                </button>
              )
            })}
          </div>
        ) : null}
      </section>
    </div>
  )
}
