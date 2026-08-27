import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clipBeat,
  clipFracAtTime,
  clipIndexAtTime,
  clipJoinNote,
  clipPoster,
  clipStartTime,
  clipsDuration,
  mediaStudioCta,
  mediaStudioPath,
  timeAtReel,
  tonightFilm,
  filmsJustCanned,
  watchFirstFrame,
  watchFrameHref,
} from './studio.ts'

describe('clipJoinNote', () => {
  it('S01 is an open take; later clips continue or cut', () => {
    assert.equal(clipJoinNote(0, false), '')
    assert.equal(clipJoinNote(0, true), '')
    assert.equal(clipJoinNote(1, false), 'continues')
    assert.equal(clipJoinNote(1, true), 'cut')
    assert.equal(clipJoinNote(2, undefined), 'continues')
  })
})

describe('clipBeat', () => {
  it('uses the clip action, not the still prompt', () => {
    assert.equal(
      clipBeat({
        stillBrief: '1girl, solo, rooftop, rain, neon',
        motionBrief: 'The camera holds static as rain falls.',
      }),
      'The camera holds static as rain falls.',
    )
    assert.equal(clipBeat({ stillBrief: '1girl, rooftop' }), '')
    assert.equal(clipBeat({ motionBrief: '  pan left  ' }), 'pan left')
  })
})

describe('clipPoster', () => {
  it('prefers the made clip; T2V never uses a leftover still', () => {
    const clip = { still: '/board/S02.png', video: '/video/S02.mp4' }
    assert.deepEqual(clipPoster(clip, 't2v'), { src: '/video/S02.mp4', kind: 'video' })
    assert.deepEqual(clipPoster(clip, 'stills'), { src: '/video/S02.mp4', kind: 'video' })
    assert.deepEqual(clipPoster({ still: '/x.png' }, 'stills'), { src: '/x.png', kind: 'image' })
    assert.equal(clipPoster({ still: '/video/S02_from_prev.png' }, 't2v'), null)
    assert.equal(clipPoster({}, 't2v'), null)
  })
})

describe('watchFirstFrame', () => {
  it('holds the painted still as the lights go down; T2V never uses a leftover still', () => {
    const clip = { still: '/board/S01.png', video: '/video/S01.mp4' }
    assert.deepEqual(watchFirstFrame([clip], 'stills'), { src: '/board/S01.png', kind: 'image', via: 'media' })
    assert.deepEqual(watchFirstFrame([clip], 't2v'), { src: '/video/S01.mp4', kind: 'video', via: 'media' })
    assert.deepEqual(
      watchFirstFrame([], 't2v', { coverUrl: '/api/studio/projects/x/cover', coverKind: 'image' }),
      { src: '/api/studio/projects/x/cover', kind: 'image', via: 'cover' },
    )
    assert.equal(watchFirstFrame([{ still: '/video/S01_from_prev.png' }], 't2v'), null)
    assert.equal(
      watchFrameHref({ src: '/board/S01.png', kind: 'image', via: 'media' }, (s) => `/m?${s}`),
      '/m?/board/S01.png',
    )
    assert.equal(
      watchFrameHref({ src: '/api/cover', kind: 'image', via: 'cover' }, (s) => `/m?${s}`),
      '/api/cover',
    )
  })
})

describe('clipIndexAtTime', () => {
  it('maps the playhead onto the take reel', () => {
    const clips = [{ durationSec: 4 }, { durationSec: 6 }, { durationSec: 5 }]
    assert.equal(clipIndexAtTime(clips, 0), 0)
    assert.equal(clipIndexAtTime(clips, 3.9), 0)
    assert.equal(clipIndexAtTime(clips, 4), 1)
    assert.equal(clipIndexAtTime(clips, 10), 2)
    assert.equal(clipIndexAtTime(clips, 99), 2)
    assert.equal(clipIndexAtTime([], 1), -1)
    assert.equal(clipStartTime(clips, 0), 0)
    assert.equal(clipStartTime(clips, 2), 10)
    assert.equal(clipsDuration(clips), 15)
    assert.equal(clipFracAtTime(clips, 2), 0.5)
    assert.equal(timeAtReel(clips, 1, 0.5), 7)
  })
})

describe('tonightFilm', () => {
  it('picks the last finished film, never a live job', () => {
    assert.equal(tonightFilm([]), null)
    assert.equal(
      tonightFilm([
        { id: 'draft', stage: 'plan', active: false, updatedAt: '2026-08-26T12:00:00.000Z' },
        { id: 'live', stage: 'watch', active: true, updatedAt: '2026-08-26T13:00:00.000Z' },
      ]),
      null,
    )
    const night = tonightFilm([
      { id: 'old', stage: 'watch', active: false, updatedAt: '2026-08-20T12:00:00.000Z' },
      { id: 'new', stage: 'watch', active: false, updatedAt: '2026-08-26T12:00:00.000Z' },
      { id: 'making', stage: 'make', active: true, updatedAt: '2026-08-26T18:00:00.000Z' },
    ])
    assert.equal(night?.id, 'new')
  })

  it('remembers the film you sat with, if it is still ready', () => {
    const films = [
      { id: 'old', stage: 'watch', active: false, updatedAt: '2026-08-20T12:00:00.000Z' },
      { id: 'new', stage: 'watch', active: false, updatedAt: '2026-08-26T12:00:00.000Z' },
    ]
    assert.equal(tonightFilm(films, 'old')?.id, 'old')
    assert.equal(tonightFilm(films, 'missing')?.id, 'new')
    assert.equal(
      tonightFilm(
        [
          { id: 'old', stage: 'watch', active: true, updatedAt: '2026-08-26T18:00:00.000Z' },
          { id: 'new', stage: 'watch', active: false, updatedAt: '2026-08-26T12:00:00.000Z' },
        ],
        'old',
      )?.id,
      'new',
    )
  })
})

describe('filmsJustCanned', () => {
  it('only counts a live job that reached Watch', () => {
    const prev = [
      { id: 'live', stage: 'make', active: true },
      { id: 'old', stage: 'watch', active: false },
    ]
    const next = [
      { id: 'live', stage: 'watch', active: false },
      { id: 'old', stage: 'watch', active: false },
    ]
    assert.deepEqual(
      filmsJustCanned(prev, next).map((p) => p.id),
      ['live'],
    )
    assert.equal(filmsJustCanned(next, next).length, 0)
  })
})

describe('mediaStudioPath', () => {
  const stills = [{ id: 'alley', videoMode: 'stills' }]
  const t2v = [{ id: 'roof', videoMode: 't2v' }]

  it('opens the owning film, not the last-opened project', () => {
    assert.equal(mediaStudioPath({ project: 'alley', kind: 'image' }, stills, 'other'), '/studio/alley/board')
    assert.equal(mediaStudioPath({ kind: 'image' }, stills, 'alley'), '/studio/alley/board')
    assert.equal(mediaStudioPath({ kind: 'image' }, stills), '/studio')
  })

  it('Straight to video has no Board', () => {
    assert.equal(mediaStudioPath({ project: 'roof', kind: 'image' }, t2v), '/studio/roof/make')
    assert.equal(mediaStudioPath({ project: 'roof', kind: 'video' }, t2v), '/studio/roof/watch')
    assert.equal(mediaStudioCta({ project: 'roof', kind: 'image' }, t2v).label, 'Open Make')
    assert.equal(mediaStudioCta({ kind: 'video' }, t2v).label, 'Open Watch')
    assert.equal(mediaStudioCta({ project: 'alley', kind: 'image' }, stills).label, 'Open the board')
  })
})
