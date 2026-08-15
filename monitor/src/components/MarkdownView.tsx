import { inlineHtml, parseMarkdown } from '../lib/markdown'

export function MarkdownView({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown)
  return (
    <div className="md-doc">
      {blocks.map((b, i) => {
        if (b.type === 'h') {
          const Tag = b.level === 1 ? 'h1' : b.level === 2 ? 'h2' : 'h3'
          return <Tag key={i} dangerouslySetInnerHTML={{ __html: inlineHtml(b.text) }} />
        }
        if (b.type === 'quote') {
          return <blockquote key={i} dangerouslySetInnerHTML={{ __html: inlineHtml(b.text) }} />
        }
        if (b.type === 'ul') {
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j} dangerouslySetInnerHTML={{ __html: inlineHtml(item) }} />
              ))}
            </ul>
          )
        }
        if (b.type === 'code') {
          return (
            <pre key={i}>
              <code>{b.text}</code>
            </pre>
          )
        }
        if (b.type === 'hr') return <hr key={i} />
        return <p key={i} dangerouslySetInnerHTML={{ __html: inlineHtml(b.text) }} />
      })}
    </div>
  )
}
