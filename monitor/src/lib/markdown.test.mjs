import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { inlineHtml, parseMarkdown } from './markdown.ts'

describe('markdown', () => {
  it('parses headings quotes and lists', () => {
    const blocks = parseMarkdown('# Night Drop\n\n> A silent drop.\n\n## Cast\n\n- Major\n- Fighter\n')
    assert.equal(blocks[0].type, 'h')
    assert.equal(blocks[0].level, 1)
    assert.equal(blocks[1].type, 'quote')
    assert.equal(blocks[2].type, 'h')
    assert.equal(blocks[3].type, 'ul')
    assert.equal(blocks[3].items.length, 2)
  })

  it('escapes html in inline text', () => {
    assert.match(inlineHtml('a <b> & c'), /&lt;b&gt;/)
    assert.match(inlineHtml('**bold** and `code`'), /<strong>bold<\/strong>/)
  })
})
