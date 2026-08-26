export type VideoMode = 'stills' | 't2v'

export function VideoModeToggle({
  value,
  onChange,
}: {
  value: VideoMode
  onChange: (mode: VideoMode) => void
}) {
  return (
    <div className="seg w-full justify-center" role="radiogroup" aria-label="How to make the film">
      <button
        type="button"
        role="radio"
        aria-checked={value === 'stills'}
        className="seg-item flex-1"
        onClick={() => onChange('stills')}
      >
        Pictures first
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={value === 't2v'}
        className="seg-item flex-1"
        onClick={() => onChange('t2v')}
      >
        Straight to video
      </button>
    </div>
  )
}
