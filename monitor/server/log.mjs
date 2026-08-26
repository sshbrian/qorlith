/**
 * Tiny JSON-line logger. No packages.
 * Silent under `node --test` unless QORLITH_LOG_LEVEL is set.
 * Optional file: QORLITH_LOG=/path/to/qorlith.log
 */
import fs from 'fs'

const RANK = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

function levelName() {
  const forced = String(process.env.QORLITH_LOG_LEVEL || process.env.LOG_LEVEL || '').toLowerCase()
  if (forced && RANK[forced] != null) return forced
  if (process.env.NODE_TEST_CONTEXT) return 'silent'
  return 'info'
}

export function formatLine(level, event, fields = {}) {
  return JSON.stringify({
    t: new Date().toISOString(),
    level,
    event: String(event),
    ...fields,
  })
}

export function log(level, event, fields = {}) {
  const want = RANK[level] ?? 0
  const have = RANK[levelName()] ?? 0
  if (want === 0 || want > have) return
  const line = formatLine(level, event, fields)
  process.stderr.write(`${line}\n`)
  const file = process.env.QORLITH_LOG
  if (file) {
    try {
      fs.appendFileSync(file, `${line}\n`)
    } catch {
      /* never crash the app for a log write */
    }
  }
}

export const debug = (event, fields) => log('debug', event, fields)
export const info = (event, fields) => log('info', event, fields)
export const warn = (event, fields) => log('warn', event, fields)
export const error = (event, fields) => log('error', event, fields)
