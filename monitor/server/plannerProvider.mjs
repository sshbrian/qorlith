/**
 * Planner backends. Local LM Studio is one option, not a hard requirement.
 * Grok / xAI, any OpenAI-compatible URL, or a prewritten plan JSON all work.
 */
export const PLANNER_PROVIDERS = ['local', 'openai', 'xai', 'none']

export function normalizePlannerProvider(raw) {
  const p = String(raw || 'local').toLowerCase().trim()
  if (p === 'lms' || p === 'lmstudio' || p === 'local') return 'local'
  if (p === 'grok' || p === 'xai' || p === 'x-ai' || p === 'xai.com') return 'xai'
  if (p === 'openai' || p === 'open-ai' || p === 'compatible' || p === 'remote') return 'openai'
  if (p === 'none' || p === 'external' || p === 'import' || p === 'off' || p === 'bot') return 'none'
  return 'local'
}

export function plannerNeedsLms(provider) {
  return normalizePlannerProvider(provider) === 'local'
}

export function defaultPlannerUrl(provider) {
  const p = normalizePlannerProvider(provider)
  if (p === 'xai') return 'https://api.x.ai/v1'
  if (p === 'openai') return 'https://api.openai.com/v1'
  return 'http://127.0.0.1:1234/v1'
}

export function defaultPlannerModel(provider) {
  const p = normalizePlannerProvider(provider)
  if (p === 'xai') return 'grok-4'
  if (p === 'openai') return 'gpt-4o'
  return ''
}

export function plannerApiKey(cfg = {}) {
  return String(
    cfg.apiKey ||
      cfg.api_key ||
      process.env.QORLITH_PLANNER_KEY ||
      process.env.XAI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '',
  ).trim()
}

export function resolvePlanner(raw = {}) {
  const provider = normalizePlannerProvider(raw.provider)
  const url = String(raw.url || defaultPlannerUrl(provider)).replace(/\/$/, '')
  const model = String(raw.model || defaultPlannerModel(provider)).trim()
  const apiKey = plannerApiKey(raw)
  return {
    provider,
    url,
    model,
    apiKey,
    local: provider === 'local',
    needsKey: provider === 'xai' || (provider === 'openai' && !/127\.0\.0\.1|localhost/i.test(url)),
  }
}

/**
 * OpenAI-compatible chat/completions. Auth header only when a key is set.
 */
export async function chatCompletions({
  baseUrl,
  apiKey,
  model,
  system,
  user,
  temperature,
  maxTokens,
  timeoutMs,
  extraBody,
}) {
  const url = `${String(baseUrl || '').replace(/\/$/, '')}/chat/completions`
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  const body = {
    model,
    temperature: temperature ?? 0.2,
    max_tokens: maxTokens || 8192,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...(extraBody && typeof extraBody === 'object' ? extraBody : {}),
  }
  const ctrl = new AbortController()
  const budget = timeoutMs || 180_000
  const t = setTimeout(() => ctrl.abort(), budget)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw new Error(`PLANNER ${r.status} ${errText.slice(0, 300)}`)
    }
    const data = await r.json()
    const msg = data?.choices?.[0]?.message || {}
    return String(msg.content || msg.text || msg.reasoning_content || '')
  } finally {
    clearTimeout(t)
  }
}
