/** Qorlith mark — lithic octagon, cyan core, struck flake. */

type Props = {
  className?: string
  title?: string
}

export function BrandMark({ className = 'h-8 w-8', title }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <MarkGeometry />
    </svg>
  )
}

function MarkGeometry() {
  return (
    <g>
      <path
        fill="#3a3a3e"
        d="M16 2.6 25.6 6.55 29.4 16 25.6 25.45 16 29.4 6.4 25.45 2.6 16 6.4 6.55Z"
      />
      <path
        fill="#55555c"
        d="M16 4.55 24.2 7.95 27.45 16 24.2 24.05 16 27.45 7.8 24.05 4.55 16 7.8 7.95Z"
      />
      <path
        fill="none"
        stroke="#d1d1d6"
        strokeWidth="0.9"
        strokeLinejoin="round"
        d="M16 2.6 25.6 6.55 29.4 16 25.6 25.45 16 29.4 6.4 25.45 2.6 16 6.4 6.55Z"
      />
      <path fill="#8e8e96" d="M16 2.6 25.6 6.55 24.2 7.95 16 4.55 7.8 7.95 6.4 6.55Z" />
      <circle cx="16" cy="16" r="6.35" fill="#0b0b0d" />
      <circle cx="16" cy="16" r="4.7" fill="#0a84ff" />
      <ellipse cx="14.55" cy="14.4" rx="1.75" ry="1.2" fill="#7ec3ff" />
      <path fill="#1c1c1e" d="M21.6 20.15 29.15 29.4 19.7 24.15Z" />
      <path fill="#f5f5f7" d="M21.6 20.15 29.15 29.4 25.7 25.55Z" />
      <path fill="#2c2c30" d="M19.55 22.85 24.4 28.85 18.15 25.45Z" />
      <path fill="#e5e5ea" d="M19.55 22.85 24.4 28.85 22.45 26.45Z" />
    </g>
  )
}
