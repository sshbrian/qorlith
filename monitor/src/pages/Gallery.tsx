import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api, type GalleryImage, type GalleryItem, type GalleryRelated } from '../lib/api'
import { FailNote } from '../components/FailNote'
import { useStudioProjects } from '../components/StudioSession'
import { buildSmartStacks, type GalleryStack } from '../lib/galleryStack'
import { mediaStudioCta, mediaStudioPath, readLastProject } from '../lib/studio'

const STACK_LS_KEY = 'qorlith.gallery.smartStack'
const ARCHIVE_VIEW_KEY = 'qorlith.gallery.showArchived'

function MetaBlock({ item }: { item: GalleryItem }) {
  const m = item.meta
  if (!m) {
    return (
      <p className="text-sm text-ghost">
        No extra details for this file. New stills save a small notes file next to the picture.
      </p>
    )
  }

  const lora = (m.lora as Record<string, unknown> | undefined) || {}
  const sampler = (m.sampler as Record<string, unknown> | undefined) || {}
  const sizeObj =
    m.size && typeof m.size === 'object' && !Array.isArray(m.size)
      ? (m.size as Record<string, unknown>)
      : {}

  // Prefer explicit resolution string, then nested size, top-level w/h, API pixelSize, aspect
  const resW =
    sizeObj.width ??
    sizeObj.w ??
    m.width ??
    m.W ??
    (item as GalleryItem & { pixelSize?: { width?: number; height?: number } }).pixelSize?.width
  const resH =
    sizeObj.height ??
    sizeObj.h ??
    m.height ??
    m.H ??
    (item as GalleryItem & { pixelSize?: { width?: number; height?: number } }).pixelSize?.height
  let resolution = '—'
  if (typeof m.resolution === 'string' && m.resolution.trim()) {
    resolution = m.resolution.trim()
  } else if (resW != null && resH != null) {
    resolution = `${resW}×${resH}`
  } else if (typeof m.size === 'string' && m.size.trim()) {
    resolution = m.size.trim()
  }
  const aspect =
    resW != null && resH != null && Number(resH) > 0
      ? (Number(resW) / Number(resH)).toFixed(3).replace(/\.?0+$/, '')
      : null

  const rows: { label: string; value: string }[] = [
    { label: 'Checkpoint', value: String(m.checkpoint ?? '—') },
    {
      label: 'LoRA',
      value:
        lora.name != null
          ? `${lora.name} @ ${lora.strength_model ?? lora.strength ?? '—'}`
          : String(m.lora_name ?? '—'),
    },
    { label: 'Trigger', value: String(lora.trigger ?? m.trigger ?? '—') },
    {
      label: 'Resolution',
      value: aspect && resolution !== '—' ? `${resolution} (${aspect}:1)` : resolution,
    },
    {
      label: 'Sampler',
      value:
        sampler.name != null
          ? `${sampler.name} / ${sampler.scheduler ?? '?'} · ${sampler.steps ?? '?'} steps · CFG ${sampler.cfg ?? '?'}`
          : typeof m.sampler === 'string'
            ? `${m.sampler} · ${m.steps ?? '?'} steps · CFG ${m.cfg ?? '?'}`
            : '—',
    },
    { label: 'Seed', value: String(sampler.seed ?? m.seed ?? '—') },
    { label: 'CLIP skip', value: String(m.clip_skip ?? '—') },
    { label: 'Generated', value: String(m.generatedAt ?? item.mtimeIso ?? '—') },
  ]

  const workflowPath =
    typeof m.workflowPath === 'string'
      ? m.workflowPath
      : typeof m.workflowApiPath === 'string'
        ? m.workflowApiPath
        : null
  const comfyWfName = typeof m.comfyWorkflowName === 'string' ? m.comfyWorkflowName : null
  const workflowUrl = workflowPath ? api.mediaUrl(workflowPath) : null
  const comfyUi = 'http://127.0.0.1:8188/'

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {rows.map((r) => (
          <div key={r.label} className="min-w-0">
            <div className="text-[9px] uppercase tracking-[0.2em] text-ghost mb-0.5">{r.label}</div>
            <div className="text-sm text-ink break-all font-mono text-xs">{r.value}</div>
          </div>
        ))}
      </div>
      {workflowPath ? (
        <div className="rounded-lg border border-cyan/30 bg-cyan/5 px-3 py-2 space-y-1.5">
          <div className="text-[9px] uppercase tracking-[0.2em] text-cyan">Comfy workflow snapshot</div>
          <div className="flex flex-wrap gap-3 text-xs">
            <a
              href={workflowUrl || '#'}
              target="_blank"
              rel="noreferrer"
              className="text-cyan underline underline-offset-2 hover:text-ink"
            >
              Open / download workflow JSON
            </a>
            <a
              href={comfyUi}
              target="_blank"
              rel="noreferrer"
              className="text-ghost underline underline-offset-2 hover:text-cyan"
              title="Open ComfyUI, then drag the JSON onto the canvas or use Workflows → qorlith"
            >
              Open ComfyUI
            </a>
          </div>
          {comfyWfName ? (
            <div className="text-[10px] text-ghost">
              Also installed for Load:{' '}
              <span className="font-mono text-ink">Workflows → {comfyWfName}</span>
            </div>
          ) : null}
          <div className="text-[10px] font-mono text-ghost/80 break-all">{workflowPath}</div>
        </div>
      ) : null}
      <div>
        <div className="text-[9px] uppercase tracking-[0.2em] text-ghost mb-1">Prompt</div>
        <div className="terminal rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap max-h-40 overflow-auto">
          {String(m.prompt ?? '—')}
        </div>
      </div>
      <div>
        <div className="text-[9px] uppercase tracking-[0.2em] text-ghost mb-1">Negative</div>
        <div className="terminal rounded-lg p-3 text-[11px] leading-relaxed whitespace-pre-wrap max-h-28 overflow-auto text-ghost">
          {String(m.negative ?? '—')}
        </div>
      </div>
      {item.metaPath ? (
        <div className="text-[10px] font-mono text-ghost break-all">meta: {item.metaPath}</div>
      ) : null}
    </div>
  )
}

function StackBadge({ count, reason }: { count: number; reason?: string }) {
  if (count <= 1) return null
  return (
    <span
      className="absolute top-2 left-2 text-[9px] uppercase tracking-wider bg-magenta/25 text-magenta border border-magenta/50 rounded px-1.5 py-0.5"
      title={reason ? `Stacked by ${reason}` : 'Stack'}
    >
      ×{count}
    </span>
  )
}

function KindBadge({ kind }: { kind?: string }) {
  if (kind !== 'video') return null
  return (
    <span className="absolute bottom-2 left-2 h-6 w-6 rounded-full bg-black/55 text-white text-[11px] flex items-center justify-center">
      ▶
    </span>
  )
}

function PickBadge({ name, isPick }: { name?: string; isPick?: boolean }) {
  if (!isPick && !/_PICK/i.test(name || '')) return null
  return (
    <span className="absolute top-2 right-2 text-[9px] uppercase tracking-wider bg-cyan/25 text-cyan border border-cyan/50 rounded px-1.5 py-0.5">
      pick
    </span>
  )
}

function ClipIdBadge({ clipId }: { clipId?: string | null }) {
  if (!clipId) return null
  return (
    <span className="absolute bottom-2 right-2 text-[9px] font-mono tracking-wider bg-void/80 text-ink border border-line/50 rounded px-1.5 py-0.5">
      {clipId}
    </span>
  )
}

function MediaPreview({
  url,
  kind,
  alt,
  className,
}: {
  url: string
  kind?: string
  alt: string
  className?: string
}) {
  if (kind === 'video') {
    return (
      <video
        src={url}
        className={className}
        controls
        muted
        playsInline
        preload="metadata"
      />
    )
  }
  return <img src={url} alt={alt} className={className} loading="lazy" />
}

function RelatedStrip({
  related,
  onOpen,
}: {
  related: GalleryRelated[]
  onOpen: (path: string) => void
}) {
  if (!related?.length) return null
  return (
    <div className="px-4 pt-3 border-b border-line/40">
      <div className="text-[9px] uppercase tracking-[0.25em] text-ghost mb-2">
        Related gens · {related.length}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-3">
        {related.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onOpen(r.path)}
            className="shrink-0 w-20 group text-left"
            title={`${r.role}: ${r.name}`}
          >
            <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-line/50 group-hover:border-cyan/50 bg-void">
              {r.kind === 'video' ? (
                <video
                  src={r.thumbUrl}
                  className="w-full h-full object-cover pointer-events-none"
                  muted
                  preload="metadata"
                />
              ) : (
                <img
                  src={r.thumbUrl}
                  alt={r.name}
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}
              <span className="absolute bottom-0 inset-x-0 text-[8px] uppercase tracking-wider bg-void/80 text-cyan text-center py-0.5">
                {r.role}
                {r.kind === 'video' ? ' · vid' : ''}
              </span>
            </div>
            <div className="text-[9px] font-mono text-ghost truncate mt-0.5">{r.name}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

export function Gallery() {
  const navigate = useNavigate()
  const { projects } = useStudioProjects()
  const [searchParams, setSearchParams] = useSearchParams()
  const [images, setImages] = useState<GalleryImage[]>([])
  const [selected, setSelected] = useState<GalleryItem | null>(null)
  const [stackFocus, setStackFocus] = useState<GalleryStack | null>(null)
  const [opening, setOpening] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [archivedTotal, setArchivedTotal] = useState(0)
  const [totalMatched, setTotalMatched] = useState(0)
  const [facets, setFacets] = useState<{
    projects: { id: string; count: number }[]
    clips: { id: string; count: number }[]
  }>({ projects: [], clips: [] })
  const [qInput, setQInput] = useState(() => searchParams.get('q') || '')
  const [q, setQ] = useState(() => searchParams.get('q') || '')
  const [kind, setKind] = useState(() => searchParams.get('kind') || '')
  const [project, setProject] = useState(() => searchParams.get('project') || '')
  const [clip, setClip] = useState(() => searchParams.get('clip') || '')
  const [smartStack, setSmartStack] = useState(() => {
    try {
      return localStorage.getItem(STACK_LS_KEY) === '1'
    } catch {
      return false
    }
  })
  /** When true, gallery shows only archived media (restore view). URL ?archived=only wins. */
  const [showArchived, setShowArchived] = useState(() => {
    const fromUrl = searchParams.get('archived')
    if (fromUrl === 'only') return true
    if (fromUrl === 'hide' || fromUrl === '0') return false
    try {
      return localStorage.getItem(ARCHIVE_VIEW_KEY) === '1'
    } catch {
      return false
    }
  })

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setQ(qInput.trim()), 200)
    return () => clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (kind) next.set('kind', kind)
    if (project) next.set('project', project)
    if (clip) next.set('clip', clip)
    if (showArchived) next.set('archived', 'only')
    setSearchParams(next, { replace: true })
  }, [q, kind, project, clip, showArchived, setSearchParams])

  useEffect(() => {
    const fromUrl = searchParams.get('archived')
    if (fromUrl === 'only') setShowArchived(true)
    else if (fromUrl === 'hide' || fromUrl === '0') setShowArchived(false)
  }, [searchParams])

  const refresh = useCallback(async () => {
    try {
      const r = await api.gallery({
        limit: 500,
        archiveMode: showArchived ? 'only' : 'hide',
        q,
        kind,
        project,
        clip,
      })
      setImages(r.images)
      setArchivedTotal(r.archivedTotal ?? 0)
      setTotalMatched(r.totalMatched ?? r.count)
      setFacets(r.facets || { projects: [], clips: [] })
      setErr(null)
    } catch (e) {
      setErr(e)
    } finally {
      setLoading(false)
    }
  }, [showArchived, q, kind, project, clip])

  useEffect(() => {
    setLoading(true)
    refresh()
    // Pause auto-refresh while tab is hidden (saves FS scans)
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      refresh()
    }
    const t = setInterval(tick, 8000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(STACK_LS_KEY, smartStack ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [smartStack])

  useEffect(() => {
    try {
      localStorage.setItem(ARCHIVE_VIEW_KEY, showArchived ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [showArchived])

  const openInStudio = useCallback(
    (item: GalleryItem) => {
      navigate(mediaStudioPath(item, projects, readLastProject()))
    },
    [navigate, projects],
  )

  const studioButton = (item: GalleryItem, className: string) => {
    const cta = mediaStudioCta(item, projects, readLastProject())
    return (
      <button type="button" className={className} title={cta.title} onClick={() => openInStudio(item)}>
        {cta.label}
      </button>
    )
  }

  useEffect(() => {
    if (!selected && !stackFocus) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelected(null)
        setStackFocus(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, stackFocus])

  const stacks = useMemo(() => buildSmartStacks(images), [images])
  const multiStackCount = useMemo(() => stacks.filter((s) => s.count > 1).length, [stacks])

  const openPath = async (filePath: string, stack: GalleryStack | null = null) => {
    setOpening(true)
    setErr(null)
    if (stack && stack.count > 1) setStackFocus(stack)
    else if (!stack) setStackFocus(null)
    try {
      const item = await api.galleryItem(filePath)
      setSelected(item)
    } catch (e) {
      setErr(e)
      setSelected(null)
    } finally {
      setOpening(false)
    }
  }

  const openItem = async (img: GalleryImage, stack: GalleryStack | null = null) => {
    await openPath(img.path, stack)
  }

  const closeModal = () => {
    setSelected(null)
    setStackFocus(null)
  }

  const toggleSmartStack = () => {
    setSmartStack((v) => !v)
    setStackFocus(null)
  }

  const archivePaths = async (paths: string[]) => {
    if (!paths.length) return
    setBusy(true)
    setErr(null)
    try {
      await api.galleryArchive(paths)
      setSelected(null)
      setStackFocus(null)
      setLoading(true)
      await refresh()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const unarchivePaths = async (paths: string[]) => {
    if (!paths.length) return
    setBusy(true)
    setErr(null)
    try {
      await api.galleryUnarchive(paths)
      setSelected(null)
      setStackFocus(null)
      setLoading(true)
      await refresh()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[15px] text-ghost">
            {showArchived
              ? `Archived view · ${images.length} hidden files · restore anytime (files stay on disk)`
              : smartStack
                ? `Smart stack on · ${stacks.length} stacks (${multiStackCount} multi) from ${images.length} files`
                : `Flat view · ${images.length}${totalMatched > images.length ? ` of ${totalMatched}` : ''} files`}
            {archivedTotal > 0 && !showArchived ? (
              <span className="text-ghost/80"> · {archivedTotal} archived</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowArchived((v) => !v)
              setSelected(null)
              setStackFocus(null)
            }}
            className={`btn ${showArchived ? 'btn-secondary text-amber' : 'btn-secondary'}`}
            title={
              showArchived
                ? 'Back to active gallery'
                : 'Show media you archived (hidden from main gallery)'
            }
          >
            {showArchived
              ? `Archived · ON${archivedTotal ? ` (${archivedTotal})` : ''}`
              : `Archived${archivedTotal ? ` (${archivedTotal})` : ''}`}
          </button>
          <button
            type="button"
            onClick={toggleSmartStack}
            className={`btn ${smartStack ? 'btn-primary' : 'btn-secondary'}`}
            title={
              smartStack
                ? 'Flatten to one card per file'
                : 'Group by filename family / batch / seed+prompt'
            }
          >
            {smartStack ? 'Smart stack · ON' : 'Smart stack'}
          </button>
          <button
            type="button"
            onClick={() => {
              setLoading(true)
              refresh()
            }}
            className="btn btn-secondary"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search pictures and clips"
            className="field flex-1 min-w-[200px] text-[15px]"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="field w-auto text-[13px] py-2"
          >
            <option value="">All kinds</option>
            <option value="image">Images</option>
            <option value="video">Videos</option>
          </select>
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="field w-auto max-w-[160px] text-[13px] py-2"
          >
            <option value="">All projects</option>
            {facets.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} ({p.count})
              </option>
            ))}
          </select>
          <select
            value={clip}
            onChange={(e) => setClip(e.target.value)}
            className="field w-auto max-w-[120px] text-[13px] py-2"
          >
            <option value="">All clips</option>
            {facets.clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} ({c.count})
              </option>
            ))}
          </select>
          {(q || kind || project || clip) && (
            <button
              type="button"
              className="text-xs text-ghost uppercase tracking-widest border border-line/50 rounded px-2 py-2 hover:text-cyan"
              onClick={() => {
                setQInput('')
                setQ('')
                setKind('')
                setProject('')
                setClip('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <FailNote error={err} />

      {opening ? (
        <div className="text-xs text-cyan tracking-widest uppercase">Loading details…</div>
      ) : null}

      {loading && !images.length ? (
        <p className="text-sm text-ghost">Scanning output roots…</p>
      ) : null}

      {!loading && !images.length ? (
        <div className="card text-[15px] text-ghost">
          {showArchived ? (
            <>No archived media. Archive items from the detail modal to hide them from the main gallery.</>
          ) : (
            <>
              No pictures yet.
              {archivedTotal > 0 ? (
                <>
                  {' '}
                  Some are hidden — open{' '}
                  <button
                    type="button"
                    className="text-amber underline"
                    onClick={() => setShowArchived(true)}
                  >
                    Archived
                  </button>
                  .
                </>
              ) : (
                ' Make a film first.'
              )}
            </>
          )}
        </div>
      ) : null}

      {/* Flat grid */}
      {!smartStack ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {images.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => openItem(img)}
              className={`group text-left rounded-[14px] overflow-hidden bg-panel cursor-pointer ${
                selected?.path === img.path ? 'ring-2 ring-cyan' : 'ring-0'
              }`}
            >
              <div className="aspect-square bg-void relative overflow-hidden">
                {img.kind === 'video' ? (
                  <video
                    src={img.thumbUrl}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300 pointer-events-none"
                    muted
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={img.thumbUrl}
                    alt={img.name}
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition duration-300 pointer-events-none"
                    loading="lazy"
                  />
                )}
                <KindBadge kind={img.kind} />
                {img.archived || showArchived ? (
                  <span className="absolute top-2 left-2 text-[11px] bg-black/55 text-ink rounded-full px-2 py-0.5 pointer-events-none">
                    Archived
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {stacks.map((stack) => (
            <button
              key={stack.id}
              type="button"
              onClick={() => openItem(stack.cover, stack)}
              className={`group text-left rounded-[14px] overflow-hidden bg-panel cursor-pointer ${
                selected?.path === stack.cover.path ? 'ring-2 ring-cyan' : 'ring-0'
              }`}
            >
              <div className="aspect-square bg-void relative overflow-hidden">
                {stack.count > 1 ? (
                  <>
                    <div className="absolute inset-2 translate-x-1 translate-y-1 rounded-lg border border-line/40 bg-panel-2/80" />
                    <div className="absolute inset-2 translate-x-0.5 translate-y-0.5 rounded-lg border border-line/50 bg-panel/90" />
                  </>
                ) : null}
                {stack.cover.kind === 'video' ? (
                  <video
                    src={stack.cover.thumbUrl}
                    className="relative w-full h-full object-cover group-hover:scale-[1.03] transition duration-300 pointer-events-none"
                    muted
                    preload="metadata"
                  />
                ) : (
                  <img
                    src={stack.cover.thumbUrl}
                    alt={stack.cover.name}
                    className="relative w-full h-full object-cover group-hover:scale-[1.03] transition duration-300 pointer-events-none"
                    loading="lazy"
                  />
                )}
                <StackBadge count={stack.count} reason={stack.reason} />
                <KindBadge kind={stack.cover.kind} />
                <PickBadge name={stack.cover.name} isPick={stack.cover.isPick} />
                <ClipIdBadge clipId={stack.cover.clipId} />
                {stack.cover.hasMeta ? (
                  <span className="absolute top-2 right-2 text-[9px] uppercase tracking-wider bg-cyan/25 text-cyan border border-cyan/50 rounded px-1.5 py-0.5 pointer-events-none">
                    meta
                  </span>
                ) : null}
              </div>
              <div className="p-2 space-y-0.5">
                <div className="text-[11px] font-mono text-ink truncate">
                  {stack.count > 1 ? `${stack.cover.name.replace(/_\d{3,5}_?\./, '…')}` : stack.cover.name}
                </div>
                <div className="text-[10px] text-ghost truncate">
                  {stack.count > 1
                    ? `${stack.count} frames · ${stack.reason}`
                    : stack.cover.rel}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {selected ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Image details"
        >
          <button
            type="button"
            className="absolute inset-0 bg-void/85 backdrop-blur-sm cursor-default"
            aria-label="Close"
            onClick={closeModal}
          />
          <div className="relative z-10 w-full max-w-5xl max-h-[92vh] overflow-y-auto glass rounded-2xl border border-white/[0.08]">
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-line/60 bg-panel/95 backdrop-blur">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.3em] text-cyan">
                  Frame detail
                  {selected.archived ? (
                    <span className="ml-2 text-amber normal-case tracking-normal">· archived</span>
                  ) : null}
                </div>
                <div className="text-sm font-mono text-ink truncate">{selected.name}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2 flex-wrap justify-end">
                {studioButton(
                  selected,
                  'text-[10px] uppercase tracking-widest text-void bg-cyan border border-cyan rounded px-3 py-1.5 hover:bg-cyan/90 font-semibold',
                )}
                {selected.archived || showArchived ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[10px] uppercase tracking-widest text-cyan border border-cyan/40 rounded px-3 py-1.5 hover:bg-cyan/10 disabled:opacity-50"
                    title="Show this file in the main gallery again"
                    onClick={() => unarchivePaths([selected.path])}
                  >
                    {busy ? '…' : 'Restore'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[10px] uppercase tracking-widest text-amber border border-amber/40 rounded px-3 py-1.5 hover:bg-amber/10 disabled:opacity-50"
                    title="Hide from gallery (does not delete the file)"
                    onClick={() => archivePaths([selected.path])}
                  >
                    {busy ? '…' : 'Archive'}
                  </button>
                )}
                {stackFocus && stackFocus.count > 1 && !showArchived ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[10px] uppercase tracking-widest text-amber border border-amber/40 rounded px-3 py-1.5 hover:bg-amber/10 disabled:opacity-50"
                    title="Archive every frame in this smart stack"
                    onClick={() => archivePaths(stackFocus.items.map((i) => i.path))}
                  >
                    {busy ? '…' : `Archive stack (${stackFocus.count})`}
                  </button>
                ) : null}
                {stackFocus && stackFocus.count > 1 && showArchived ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-[10px] uppercase tracking-widest text-cyan border border-cyan/40 rounded px-3 py-1.5 hover:bg-cyan/10 disabled:opacity-50"
                    title="Restore every frame in this stack"
                    onClick={() => unarchivePaths(stackFocus.items.map((i) => i.path))}
                  >
                    {busy ? '…' : `Restore stack (${stackFocus.count})`}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="text-[10px] uppercase tracking-widest text-ghost hover:text-cyan border border-line rounded px-3 py-1.5"
                  onClick={closeModal}
                >
                  Close · Esc
                </button>
              </div>
            </div>

            {stackFocus && stackFocus.count > 1 ? (
              <div className="px-4 pt-3 border-b border-line/40">
                <div className="text-[9px] uppercase tracking-[0.25em] text-ghost mb-2">
                  Stack · {stackFocus.count} · {stackFocus.reason}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-3">
                  {stackFocus.items.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => openItem(img, stackFocus)}
                      className={`shrink-0 w-16 h-16 rounded-lg overflow-hidden border transition ${
                        selected.path === img.path
                          ? 'border-cyan ring-1 ring-cyan/40'
                          : 'border-line/50 hover:border-cyan/40'
                      }`}
                    >
                      <img
                        src={img.thumbUrl}
                        alt={img.name}
                        className="w-full h-full object-cover pointer-events-none"
                      />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <RelatedStrip
              related={selected.related || []}
              onOpen={(p) => openPath(p)}
            />

            <div className="p-4 lg:p-5 grid lg:grid-cols-2 gap-5">
              <div>
                <div className="rounded-lg overflow-hidden border border-line/50 bg-void">
                  <MediaPreview
                    url={selected.thumbUrl}
                    kind={selected.kind}
                    alt={selected.name}
                    className="w-full h-auto max-h-[60vh] object-contain mx-auto"
                  />
                </div>
                <div className="mt-2 text-[10px] font-mono text-ghost break-all">{selected.path}</div>
                {studioButton(
                  selected,
                  'mt-3 w-full sm:w-auto text-[10px] uppercase tracking-widest text-void bg-cyan border border-cyan rounded-lg px-4 py-2 hover:bg-cyan/90 font-semibold',
                )}
              </div>
              <div>
                <h2 className="text-xs uppercase tracking-[0.3em] text-ghost mb-3">
                  Prompt &amp; settings
                  {selected.hasMeta ? (
                    <span className="ml-2 text-cyan normal-case tracking-normal">· sidecar</span>
                  ) : (
                    <span className="ml-2 text-magenta normal-case tracking-normal">· no meta</span>
                  )}
                  {(selected.relatedCount ?? 0) > 0 ? (
                    <span className="ml-2 text-amber normal-case tracking-normal">
                      · {selected.relatedCount} related
                    </span>
                  ) : null}
                </h2>
                <MetaBlock item={selected} />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
