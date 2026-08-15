export const LAST_PROJECT_KEY = 'qorlith.studio.lastProject'
export const RAIL_COLLAPSED_KEY = 'qorlith.studio.railCollapsed'

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

export function projectPath(id: string, stage?: StudioStage) {
  const base = `/studio/${encodeURIComponent(id)}`
  return stage ? `${base}/${stage}` : base
}

export function stageFromPath(pathname: string): StudioStage | '' {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'studio') return ''
  return canonicalStage(parts[2])
}

export function areaFromPath(pathname: string): 'studio' | 'media' | 'train' {
  if (pathname === '/media' || pathname.startsWith('/media/')) return 'media'
  if (pathname === '/train' || pathname.startsWith('/train/')) return 'train'
  return 'studio'
}
