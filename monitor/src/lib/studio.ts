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

export function projectPath(id: string, stage?: StudioStage) {
  const base = `/studio/${encodeURIComponent(id)}`
  return stage ? `${base}/${stage}` : base
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
