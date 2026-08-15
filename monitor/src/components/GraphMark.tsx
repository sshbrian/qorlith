import { viaInk, type NodeMarkId, type OpVia } from '../lib/brainGraph'

const STROKE = {
  fill: 'none',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Glyph({ mark, ink }: { mark: NodeMarkId; ink: string }) {
  if (mark === 'q') {
    return (
      <>
        <circle cx="12" cy="12" r="6.4" stroke={ink} strokeWidth="1.7" {...STROKE} />
        <path d="M14.6 14.6 L17.2 17.2" stroke={ink} strokeWidth="1.7" {...STROKE} />
      </>
    )
  }
  if (mark === 'pulse') {
    return (
      <>
        <circle cx="12" cy="12" r="2.1" fill={ink} />
        <path d="M7.2 12 A4.8 4.8 0 0 1 16.8 12" stroke={ink} strokeWidth="1.55" {...STROKE} />
        <path d="M5 12 A7 7 0 0 1 19 12" stroke={ink} strokeWidth="1.35" opacity="0.7" {...STROKE} />
      </>
    )
  }
  if (mark === 'cursor') {
    return (
      <>
        <path d="M9 6.5 V17.5" stroke={ink} strokeWidth="1.7" {...STROKE} />
        <path d="M7.2 6.5 H10.8" stroke={ink} strokeWidth="1.7" {...STROKE} />
        <path d="M7.2 17.5 H10.8" stroke={ink} strokeWidth="1.7" {...STROKE} />
        <path d="M13.2 10.5 H18.2" stroke={ink} strokeWidth="1.5" {...STROKE} />
      </>
    )
  }
  if (mark === 'frame') {
    return (
      <>
        <rect x="5.4" y="6.6" width="13.2" height="10.8" rx="2.2" stroke={ink} strokeWidth="1.6" {...STROKE} />
        <path d="M16.4 6.2 L18.6 4.4 L19.2 6.8 L17.1 7.4 Z" fill={ink} />
      </>
    )
  }
  if (mark === 'print') {
    return (
      <>
        <path d="M12 7.2 C9.6 7.2 8.2 9.2 8.2 11.4 V15" stroke={ink} strokeWidth="1.5" {...STROKE} />
        <path d="M12 7.2 C14.4 7.2 15.8 9.2 15.8 11.4 V15.4" stroke={ink} strokeWidth="1.5" {...STROKE} />
        <path d="M10 10.4 C10 13.6 9.1 16.6 7.6 18.2" stroke={ink} strokeWidth="1.35" {...STROKE} />
        <path d="M14 10.6 C14 13.4 15.2 16.4 16.6 18" stroke={ink} strokeWidth="1.35" {...STROKE} />
        <path d="M12 11.2 V18.4" stroke={ink} strokeWidth="1.45" {...STROKE} />
      </>
    )
  }
  if (mark === 'sprocket') {
    return (
      <>
        <rect x="7.2" y="6.2" width="9.6" height="11.6" rx="1.4" stroke={ink} strokeWidth="1.55" {...STROKE} />
        <path d="M4.8 8.2 H7.2 M4.8 12 H7.2 M4.8 15.8 H7.2" stroke={ink} strokeWidth="1.5" {...STROKE} />
        <path d="M16.8 8.2 H19.2 M16.8 12 H19.2 M16.8 15.8 H19.2" stroke={ink} strokeWidth="1.5" {...STROKE} />
      </>
    )
  }
  if (mark === 'splice') {
    return (
      <>
        <path d="M4.8 8.5 H11.2 L12.6 12 L11.2 15.5 H4.8" stroke={ink} strokeWidth="1.55" {...STROKE} />
        <path d="M19.2 8.5 H12.8 L11.4 12 L12.8 15.5 H19.2" stroke={ink} strokeWidth="1.55" {...STROKE} />
        <path d="M12 8.2 V15.8" stroke={ink} strokeWidth="1.4" {...STROKE} />
      </>
    )
  }
  if (mark === 'flag') {
    return (
      <>
        <path d="M7.4 5.8 V18.4" stroke={ink} strokeWidth="1.65" {...STROKE} />
        <path d="M7.4 6.2 H16.6 L14.8 9.4 L16.6 12.6 H7.4" stroke={ink} strokeWidth="1.55" {...STROKE} />
      </>
    )
  }
  return (
    <>
      <ellipse cx="12" cy="9.4" rx="5.4" ry="2.2" stroke={ink} strokeWidth="1.5" {...STROKE} />
      <path d="M6.6 9.4 V14.6 C6.6 15.8 9 16.8 12 16.8 C15 16.8 17.4 15.8 17.4 14.6 V9.4" stroke={ink} strokeWidth="1.5" {...STROKE} />
    </>
  )
}

export function GraphMark({
  mark,
  via,
  live = false,
  size = 22,
}: {
  mark: NodeMarkId
  via?: OpVia
  live?: boolean
  size?: number
}) {
  const ink = via ? viaInk(via) : 'rgba(235, 235, 245, 0.82)'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={live ? 'graph-mark is-live' : 'graph-mark'}
      aria-hidden
    >
      <circle className="graph-mark-ring" cx="12" cy="12" r="11" fill="rgba(0,0,0,0.35)" stroke={ink} strokeOpacity="0.28" />
      <Glyph mark={mark} ink={ink} />
    </svg>
  )
}
