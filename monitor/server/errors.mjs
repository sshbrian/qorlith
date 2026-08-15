/**
 * One error shape for the whole API.
 * fail() throws. Catch with sendFail() or the Express error middleware.
 */
import { error as logError } from './log.mjs'

const CODE_FOR_STATUS = {
  400: 'bad_request',
  403: 'forbidden',
  404: 'not_found',
  502: 'upstream',
  503: 'unavailable',
  504: 'timeout',
}

export function fail(status, code, message, extra = {}) {
  const err = new Error(message)
  err.status = Number(status) || 500
  err.code = String(code || CODE_FOR_STATUS[err.status] || 'error')
  err.hint = extra.hint != null ? String(extra.hint) : null
  for (const [key, value] of Object.entries(extra)) {
    if (key === 'hint') continue
    err[key] = value
  }
  throw err
}

export function toErrorBody(err) {
  const status = Number.isInteger(err?.status) ? err.status : 500
  const body = {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
    code: err?.code || CODE_FOR_STATUS[status] || 'error',
    hint: err?.hint || null,
  }
  if (err?.stages) body.stages = err.stages
  if (err?.plan) body.plan = err.plan
  if (err?.warnings) body.warnings = err.warnings
  if (err?.raw) body.raw = err.raw
  if (err?.archived != null) body.archived = err.archived
  return body
}

export function sendFail(res, err, ctx = {}) {
  const status = Number.isInteger(err?.status) ? err.status : 500
  logError('http.error', {
    status,
    code: err?.code || undefined,
    error: err instanceof Error ? err.message : String(err),
    ...ctx,
  })
  return res.status(status).json(toErrorBody(err))
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) {
    next(err)
    return
  }
  sendFail(res, err, { method: req.method, path: req.path })
}

export function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next)
    } catch (err) {
      next(err)
    }
  }
}
