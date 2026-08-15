import { useCallback, useLayoutEffect, useRef, type RefCallback } from 'react'

export const SCROLL_KEY_PREFIX = 'qorlith.scroll.v1:'

export function scrollKey(pathname: string): string {
  const path = pathname || '/'
  return `${SCROLL_KEY_PREFIX}${path}`
}

export function readScroll(pathname: string): number {
  try {
    const n = Number(sessionStorage.getItem(scrollKey(pathname)) || '0')
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}

export function writeScroll(pathname: string, value: number): void {
  try {
    const n = Math.max(0, Math.round(Number(value) || 0))
    if (n <= 0) sessionStorage.removeItem(scrollKey(pathname))
    else sessionStorage.setItem(scrollKey(pathname), String(n))
  } catch {
    /* ignore */
  }
}

/** Poll/re-render snapped the scroller to the top. Clicks are not a reason to keep that. */
export function shouldRestoreScroll(pinned: number, next: number, userScrolled: boolean): boolean {
  return pinned > 16 && next < 8 && !userScrolled
}

/** Only a real scroll gesture may forget a pin and adopt the top. */
export function shouldAdoptScroll(pinned: number, next: number, userScrolled: boolean): boolean {
  if (pinned > 16 && next < 8) return userScrolled
  return true
}

const SCROLL_KEYS = new Set(['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', ' '])

/** Keep the studio <main> scroller where the artist left it across polls and reloads. */
export function usePinnedScroll(pathname: string): RefCallback<HTMLElement> {
  const nodeRef = useRef<HTMLElement | null>(null)
  const pinned = useRef(0)
  const applying = useRef(false)
  const userScroll = useRef(false)
  const cleanRef = useRef<(() => void) | null>(null)
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  const apply = useCallback(() => {
    const el = nodeRef.current
    if (!el) return
    const want = pinned.current
    if (want > 0 && Math.abs(el.scrollTop - want) > 1) {
      applying.current = true
      el.scrollTop = want
      requestAnimationFrame(() => {
        applying.current = false
      })
    }
  }, [])

  const bind = useCallback(
    (el: HTMLElement | null) => {
      if (cleanRef.current) {
        cleanRef.current()
        cleanRef.current = null
      }
      nodeRef.current = el
      if (!el) return
      pinned.current = readScroll(pathRef.current) || pinned.current
      apply()

      const markUserScroll = () => {
        userScroll.current = true
      }
      const onScroll = () => {
        if (applying.current) return
        const top = el.scrollTop
        const gestured = userScroll.current
        userScroll.current = false
        if (shouldRestoreScroll(pinned.current, top, gestured)) {
          apply()
          return
        }
        if (!shouldAdoptScroll(pinned.current, top, gestured)) return
        pinned.current = top
        writeScroll(pathRef.current, top)
      }
      const onKey = (e: KeyboardEvent) => {
        if (SCROLL_KEYS.has(e.key)) markUserScroll()
      }
      const onPointer = (e: PointerEvent) => {
        if (e.offsetX >= el.clientWidth - 20) markUserScroll()
      }
      el.addEventListener('scroll', onScroll, { passive: true })
      el.addEventListener('wheel', markUserScroll, { passive: true })
      el.addEventListener('touchmove', markUserScroll, { passive: true })
      el.addEventListener('pointerdown', onPointer)
      el.addEventListener('keydown', onKey)
      const ro = new ResizeObserver(() => {
        if (shouldRestoreScroll(pinned.current, el.scrollTop, userScroll.current)) apply()
      })
      ro.observe(el)
      if (el.firstElementChild) ro.observe(el.firstElementChild)
      cleanRef.current = () => {
        el.removeEventListener('scroll', onScroll)
        el.removeEventListener('wheel', markUserScroll)
        el.removeEventListener('touchmove', markUserScroll)
        el.removeEventListener('pointerdown', onPointer)
        el.removeEventListener('keydown', onKey)
        ro.disconnect()
      }
    },
    [apply],
  )

  useLayoutEffect(() => {
    pinned.current = readScroll(pathname)
    apply()
  }, [pathname, apply])

  // After a poll re-render, put the scroller back if React/layout snapped it to 0.
  useLayoutEffect(() => {
    const el = nodeRef.current
    if (!el) return
    if (shouldRestoreScroll(pinned.current, el.scrollTop, userScroll.current)) apply()
  })

  return bind
}
