import type { BrainReport, ComfyProgressView, StudioProject } from './api'

/** True for the whole stills/video run, even if the pid file or a Comfy prompt dips. */
export function runIsLive(
  brain: Pick<BrainReport, 'running' | 'status'> | null | undefined,
): boolean {
  if (!brain) return false
  if (brain.running) return true
  const st = String(brain.status || '')
  return st === 'stills' || st === 'video' || st === 'pending' || st === 'recut'
}

/**
 * Structural + chrome only. Percent / line / updatedAt change every poll and
 * must not rebuild the Make page (that is the white flash).
 */
export function brainFingerprint(brain: BrainReport | null | undefined): string {
  if (!brain) return ''
  const clips = (brain.clips || [])
    .map((c) => `${c.id}:${c.still || ''}:${c.video || ''}:${c.pick || ''}:${c.durationSec ?? ''}`)
    .join(',')
  const steps = (brain.steps || []).map((s) => `${s.id}:${s.state}`).join(',')
  return [
    brain.runId || '',
    brain.status,
    brain.step,
    brain.phase || '',
    brain.running ? '1' : '0',
    brain.started ? '1' : '0',
    brain.reviewOk ? '1' : '0',
    brain.currentClip || '',
    brain.label || '',
    brain.master || '',
    brain.lastError || '',
    brain.comfy?.active ? '1' : '0',
    brain.comfy?.kind || '',
    brain.comfy?.title || '',
    clips,
    steps,
  ].join('|')
}

export function comfyFingerprint(view: ComfyProgressView | null | undefined): string {
  if (!view) return ''
  return [
    view.connected ? '1' : '0',
    view.active ? '1' : '0',
    view.kind,
    view.percent ?? '',
    view.line,
    view.title,
    view.queueRemaining,
    view.promptId || '',
  ].join('|')
}

export function projectsFingerprint(list: StudioProject[] | null | undefined): string {
  return (list || [])
    .map(
      (p) =>
        `${p.id}:${p.title}:${p.active ? '1' : '0'}:${p.clipCount}:${p.sceneCount}:${p.stage}:${p.status}:${p.updatedAt || ''}:${p.coverUrl || ''}`,
    )
    .join(';')
}

export function idleBrainReport(projectId: string): BrainReport {
  return {
    projectId,
    status: 'idle',
    step: 'health',
    steps: [],
    clips: [],
    started: false,
    running: false,
  }
}
