/** Project ids: lowercase snake, letter-first. */

export function slugifyProjectId(raw) {
  let s = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
  if (!s || !/^[a-z]/.test(s)) s = `film_${s || Date.now().toString(36)}`
  return s
}
