import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildStoryboardMarkdown } from './storyboard.mjs'

describe('storyboard markdown', () => {
  it('writes title, brief, cast, and clip beats', () => {
    const md = buildStoryboardMarkdown({
      projectId: 'night_drop',
      model: 'qorlith-planner',
      userPrompt: '24s GitS rooftop then alley.',
      plan: {
        title: 'Night Drop',
        logline: 'The Major watches, then drops.',
        rating: 'R',
        lookTrack: 'anime',
        durationTargetSec: 24,
        musicPalette: 'taiko and cello',
        characters: [{ id: 'S1', name: 'The Major', look: 'short dark hair', voice: 'alto' }],
        clips: [
          {
            id: 'S01',
            title: 'rooftop_overwatch',
            t_start: 0,
            t_end: 12,
            durationSec: 12,
            cut: false,
            stillBrief: 'frozen on a tower',
            motionBrief: 'suit flickers',
            dialogue: '',
            soundscape: 'wind',
            musicNote: 'taiko',
          },
        ],
        markdown: 'No radio.',
      },
    })
    assert.match(md, /^# Night Drop/m)
    assert.match(md, /The Major watches/)
    assert.match(md, /24s GitS/)
    assert.match(md, /### S1 — The Major/)
    assert.match(md, /### S01 · rooftop_overwatch/)
    assert.match(md, /\*\*Still\*\*/)
    assert.match(md, /No radio/)
  })

  it('T2V storyboard labels the MiniMax beat Scene, not Still', () => {
    const md = buildStoryboardMarkdown({
      projectId: 'roof',
      plan: {
        title: 'Rooftop',
        videoMode: 't2v',
        clips: [
          {
            id: 'S01',
            title: 'open',
            durationSec: 12,
            stillBrief: 'rain-wet rooftop',
            motionBrief: 'a medium-wide shot frames a rain-wet rooftop. The camera holds.',
          },
        ],
      },
    })
    assert.match(md, /\*\*Scene\*\*/)
    assert.doesNotMatch(md, /\*\*Still\*\*/)
    assert.doesNotMatch(md, /\*\*Motion\*\*/)
    assert.match(md, /medium-wide shot frames/)
  })
})
