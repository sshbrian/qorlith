/**
 * Optional house character lock from qorlith.yaml / qorlith.local.yaml.
 * The app never hardcodes a franchise. When/deny regexes and the look string
 * live in yaml stills.locks[].
 */
import { loadStudio } from './studioConfig.mjs'

const SCENE_RE =
  /\b(medium close-up|medium shot|close-up|closeup|wider medium|wider shot|portrait|head and shoulders|compact smg|\bsmg\b|holding |rain-wet|neon |rooftop|alley|street|city|hotel|kitchen|bedroom|office)\b/i
const TWO_SUBJECT_RE =
  /\b(two girls|second |another (?:adult |woman|girl|android)|and an? (?:adult|second|other))\b/i

function compile(raw) {
  try {
    return raw ? new RegExp(String(raw), 'gi') : null
  } catch {
    return null
  }
}

export function loadCharacterLocks() {
  const raw = loadStudio().stills?.locks
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const when = compile(item.when)
      if (!when) return null
      return {
        when,
        deny: compile(item.deny),
        name: String(item.name || '').trim(),
        look: String(item.look || '').trim(),
        role: String(item.role || 'gits').trim().toLowerCase(),
      }
    })
    .filter(Boolean)
}

export function matchCharacterLock(text) {
  const t = String(text || '')
  for (const lock of loadCharacterLocks()) {
    const stripped = lock.deny ? t.replace(lock.deny, ' ') : t
    if (lock.when.test(stripped)) return lock
  }
  return null
}

export function textWantsGits(text) {
  return Boolean(matchCharacterLock(text))
}

export function isGitsLora(lora) {
  if (!lora || typeof lora !== 'object') return false
  const role = String(lora.role || '').toLowerCase()
  return role === 'gits' || role === 'lock'
}

function girlCount(brief) {
  if (TWO_SUBJECT_RE.test(brief)) return 2
  return 1
}

function countTag(n) {
  return n > 1 ? `${n}girls` : '1girl, solo'
}

export function applyHouseLockToStillBrief(brief, lockLook = '') {
  let s = String(brief || '').trim()
  if (!s) return s
  s = s.replace(/\b1girl\s+lead\b/i, '1girl')
  const n = girlCount(s)
  const look = String(lockLook || '').trim()
  if (!look) return s.slice(0, 800)
  if (s.toLowerCase().includes(look.toLowerCase())) {
    if (n > 1 && /\b1girl\b/i.test(s)) s = s.replace(/\b1girl\b/i, countTag(2))
    return s.slice(0, 800)
  }
  const sceneHit = s.match(SCENE_RE)
  const scene = sceneHit ? s.slice(sceneHit.index).trim() : s
  return `${countTag(n)}, ${look}, ${scene}`.replace(/\s+/g, ' ').trim().slice(0, 800)
}

export function applyHouseLockToPlan(plan, userPrompt, warnings = []) {
  const lock = matchCharacterLock(userPrompt)
  if (!plan || !lock || !lock.look) return plan
  const chars = Array.isArray(plan.characters) ? plan.characters : []
  const lead = chars[0]
  if (lead) {
    if (!String(lead.look || '').toLowerCase().includes(lock.look.slice(0, 24).toLowerCase())) {
      lead.look = lock.look
      warnings.push(`${lead.id || 'S1'}: applied house visual lock`)
    }
    if (lock.name && !new RegExp(lock.name, 'i').test(String(lead.name || ''))) {
      lead.name = lock.name
      warnings.push(`${lead.id || 'S1'}: renamed lead to house lock`)
    }
  }
  for (const c of plan.clips || []) {
    const before = String(c.stillBrief || '')
    if (!before.trim()) continue
    const next = applyHouseLockToStillBrief(before, lock.look)
    if (next !== before) {
      c.stillBrief = next
      warnings.push(`${c.id || 'clip'}: repaired stillBrief for house lock`)
    }
  }
  return plan
}
