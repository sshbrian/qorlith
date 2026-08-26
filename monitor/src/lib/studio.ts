export const LAST_PROJECT_KEY = 'qorlith.studio.lastProject'
export const RAIL_COLLAPSED_KEY = 'qorlith.studio.railCollapsed'

export const PROMPT_PLACEHOLDER = 'Example: 20 second rooftop fight, rain, no talking.'

export const PROMPT_STARTERS = [
  { label: '12 seconds', text: '12 second rooftop fight in the rain, silent, no talking.' },
  { label: '20 second chase', text: '20 second neon alley chase, rain, no talking.' },
  { label: '32 second raid', text: '32 second night raid through a server floor, gunfire, no talking.' },
] as const

export const STAGES = ['plan', 'make', 'board', 'watch'] as const
export type StudioStage = (typeof STAGES)[number]

export function isStudioStage(value: string | undefined): value is StudioStage {
  return value === 'plan' || value === 'make' || value === 'board' || value === 'watch'
}

/** Old bookmarks: Brain is Make, Run is Watch. */
export function canonicalStage(value: string | undefined): StudioStage | '' {
  if (value === 'brain') return 'make'
  if (value === 'run') return 'watch'
  return isStudioStage(value) ? value : ''
}

export function readLastProject(): string | null {
  try {
    const id = localStorage.getItem(LAST_PROJECT_KEY)
    return id && id.trim() ? id.trim() : null
  } catch {
    return null
  }
}

export function writeLastProject(id: string) {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch {
    /* ignore */
  }
}

export function clearLastProject(id?: string) {
  try {
    if (!id || localStorage.getItem(LAST_PROJECT_KEY) === id) {
      localStorage.removeItem(LAST_PROJECT_KEY)
    }
  } catch {
    /* ignore */
  }
}

export function readRailCollapsed(): boolean {
  try {
    return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeRailCollapsed(collapsed: boolean) {
  try {
    localStorage.setItem(RAIL_COLLAPSED_KEY, collapsed ? '1' : '0')
  } catch {
    /* ignore */
  }
}

/** S01 is an open take. Later clips either continue or hard-cut. */
export function clipJoinNote(index: number, cut?: boolean | null) {
  if (index <= 0) return ''
  return cut ? 'cut' : 'continues'
}

/** Straight to video shows the clip, not a continue last-frame stuffed into still. */
export function clipPoster(
  clip: { still?: string | null; video?: string | null },
  videoMode?: string | null,
): { src: string; kind: 'image' | 'video' } | null {
  const still = clip.still || null
  const video = clip.video || null
  if (videoMode === 't2v') {
    if (video) return { src: video, kind: 'video' }
    return still ? { src: still, kind: 'image' } : null
  }
  if (still) return { src: still, kind: 'image' }
  return video ? { src: video, kind: 'video' } : null
}

export function projectPath(id: string, stage?: StudioStage) {
  const base = `/studio/${encodeURIComponent(id)}`
  return stage ? `${base}/${stage}` : base
}

type MediaStudioItem = { project?: string | null; kind?: string | null }
type MediaStudioProject = { id: string; videoMode?: string | null }

function projectVideoMode(
  id: string,
  projects: MediaStudioProject[] = [],
): string {
  return projects.find((p) => p.id === id)?.videoMode === 't2v' ? 't2v' : 'stills'
}

/** All media → the owning film. T2V has no Board. Item project wins over the last-opened one. */
export function mediaStudioPath(
  item: MediaStudioItem,
  projects: MediaStudioProject[] = [],
  lastProject?: string | null,
): string {
  const id = String(item.project || lastProject || '').trim()
  if (!id) return '/studio'
  if (item.kind === 'video') return projectPath(id, 'watch')
  if (projectVideoMode(id, projects) === 't2v') return projectPath(id, 'make')
  return projectPath(id, 'board')
}

export function mediaStudioCta(
  item: MediaStudioItem,
  projects: MediaStudioProject[] = [],
  lastProject?: string | null,
): { label: string; title: string } {
  if (item.kind === 'video') return { label: 'Open Watch', title: 'Open Watch for this film' }
  const id = String(item.project || lastProject || '').trim()
  if (id && projectVideoMode(id, projects) === 't2v') {
    return { label: 'Open Make', title: 'Straight to video — no board' }
  }
  return { label: 'Open the board', title: 'Open the board so you can pick this still for a clip' }
}

export function stageFromPath(pathname: string): StudioStage | '' {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'studio') return ''
  return canonicalStage(parts[2])
}

export function areaFromPath(pathname: string): 'studio' | 'media' | 'train' | 'archive' {
  if (pathname === '/media' || pathname.startsWith('/media/')) return 'media'
  if (pathname === '/train' || pathname.startsWith('/train/')) return 'train'
  if (pathname === '/archive' || pathname.startsWith('/archive/')) return 'archive'
  return 'studio'
}
