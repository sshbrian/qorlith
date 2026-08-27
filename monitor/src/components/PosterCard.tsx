export function CoverThumb({
  url,
  kind,
  className,
}: {
  url?: string | null
  kind?: string | null
  className?: string
}) {
  if (!url) return null
  if (kind === 'video') {
    return <video src={url} muted playsInline loop preload="metadata" className={className} />
  }
  return <img src={url} alt="" className={className} />
}

export function PosterCard({
  title,
  meta,
  coverUrl,
  coverKind,
  live,
  overlay,
  featured,
  onClick,
}: {
  title: string
  meta?: string
  coverUrl?: string | null
  coverKind?: string | null
  live?: boolean
  overlay?: boolean
  featured?: boolean
  onClick: () => void
}) {
  const letter = (title || '?').slice(0, 1).toUpperCase()
  const wake = (el: HTMLButtonElement, on: boolean) => {
    if (!overlay) return
    const v = el.querySelector('video')
    if (!v) return
    if (on && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      void v.play()
      return
    }
    v.pause()
    try {
      v.currentTime = 0
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={(e) => wake(e.currentTarget, true)}
      onMouseLeave={(e) => wake(e.currentTarget, false)}
      className={['poster-card', overlay ? 'is-overlay' : '', featured ? 'is-featured' : ''].join(' ')}
    >
      <div className="poster-still">
        {coverUrl ? (
          <CoverThumb url={coverUrl} kind={coverKind} />
        ) : (
          <div className="poster-empty">{letter}</div>
        )}
        <div className="poster-shade" />
        {live ? <span className="poster-live">Making now</span> : null}
        {overlay ? (
          <div className="poster-overlay">
            <div className="poster-overlay-title">{title}</div>
            {meta ? <div className="poster-overlay-meta">{meta}</div> : null}
          </div>
        ) : null}
      </div>
      {overlay ? null : (
        <div className="poster-body">
          <div className="text-[16px] font-semibold tracking-tight truncate">{title}</div>
          {meta ? <div className="text-[12px] text-ghost mt-1 truncate">{meta}</div> : null}
        </div>
      )}
    </button>
  )
}
