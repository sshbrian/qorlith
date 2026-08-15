/**
 * Small filesystem helpers shared by train + gallery.
 */
import fs from 'fs'
import path from 'path'

export function safeStat(p) {
  try {
    return fs.statSync(p)
  } catch {
    return null
  }
}

export function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name))
  } catch {
    return []
  }
}

export function listFiles(dir, exts) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => path.join(dir, d.name))
      .filter((f) => !exts || exts.some((e) => f.toLowerCase().endsWith(e)))
  } catch {
    return []
  }
}

/** Walk files under dir up to maxDepth. Read-only; safe while training writes. */
export function walkFiles(dir, { maxDepth = 5, depth = 0 } = {}) {
  if (depth > maxDepth) return []
  const out = []
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        out.push(...walkFiles(p, { maxDepth, depth: depth + 1 }))
      } else if (ent.isFile()) {
        out.push(p)
      }
    }
  } catch {
    /* permission / race */
  }
  return out
}

export function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
