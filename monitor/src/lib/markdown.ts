export type MdBlock =
  | { type: 'h'; level: 1 | 2 | 3; text: string }
  | { type: 'p'; text: string }
  | { type: 'quote'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'hr' }

export function parseMarkdown(src: string): MdBlock[] {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n')
  const out: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const raw = lines[i]
    const t = raw.trim()
    if (!t) {
      i += 1
      continue
    }
    if (t === '---' || t === '***') {
      out.push({ type: 'hr' })
      i += 1
      continue
    }
    if (t.startsWith('```')) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      out.push({ type: 'code', text: buf.join('\n') })
      continue
    }
    const h = t.match(/^(#{1,3})\s+(.+)$/)
    if (h) {
      out.push({ type: 'h', level: h[1].length as 1 | 2 | 3, text: h[2] })
      i += 1
      continue
    }
    if (t.startsWith('> ')) {
      const buf: string[] = [t.slice(2)]
      i += 1
      while (i < lines.length && lines[i].trim().startsWith('> ')) {
        buf.push(lines[i].trim().slice(2))
        i += 1
      }
      out.push({ type: 'quote', text: buf.join(' ') })
      continue
    }
    if (/^[-*]\s+/.test(t)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ''))
        i += 1
      }
      out.push({ type: 'ul', items })
      continue
    }
    const buf: string[] = [t]
    i += 1
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      lines[i].trim() !== '---'
    ) {
      buf.push(lines[i].trim())
      i += 1
    }
    out.push({ type: 'p', text: buf.join(' ') })
  }
  return out
}

export function inlineHtml(text: string): string {
  const esc = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return esc
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}
