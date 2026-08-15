import type { BrainReport } from './api'

const hold = new Map<string, BrainReport>()

export function isEmptyBrain(brain: BrainReport | null | undefined): boolean {
  if (!brain) return true
  if (brain.started || brain.running) return false
  if (brain.clips && brain.clips.length) return false
  const st = String(brain.status || 'idle')
  return st === 'idle' || st === ''
}

export function rememberBrain(id: string, brain: BrainReport | null | undefined): void {
  if (!id || !brain || isEmptyBrain(brain)) return
  hold.set(id, brain)
}

export function heldBrain(id: string): BrainReport | null {
  return (id && hold.get(id)) || null
}

/** Never replace a live Make view with a parse-fail / idle flash. */
export function preferHeld(id: string, next: BrainReport | null | undefined): BrainReport | null {
  const prev = heldBrain(id)
  if (isEmptyBrain(next)) return prev
  rememberBrain(id, next)
  return next || null
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
