let ctx: AudioContext | null = null

function silent() {
  if (typeof window === 'undefined') return true
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  } catch {
    /* ignore */
  }
  try {
    if (localStorage.getItem('qorlith.house.mute') === '1') return true
  } catch {
    /* ignore */
  }
  return false
}

function audio() {
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  if (!ctx) ctx = new AC()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

/** Soft room change. No-op under reduced motion or mute. */
export function houseWhoosh() {
  if (silent()) return
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime
  const seconds = 0.2
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length)
  }
  const src = ac.createBufferSource()
  src.buffer = buf
  const filter = ac.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 640
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.026, now + 0.035)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds)
  src.connect(filter)
  filter.connect(gain)
  gain.connect(ac.destination)
  src.start(now)
}

/** House lights after the picture. No-op under reduced motion or mute. */
export function houseLights() {
  if (silent()) return
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(98, now)
  osc.frequency.exponentialRampToValueAtTime(49, now + 0.82)
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.018, now + 0.22)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(now)
  osc.stop(now + 1.05)
}

/** Pin a print on the light table. */
export function housePin() {
  if (silent()) return
  const ac = audio()
  if (!ac) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(1760, now)
  osc.frequency.exponentialRampToValueAtTime(380, now + 0.08)
  const gain = ac.createGain()
  gain.gain.setValueAtTime(0.038, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(now)
  osc.stop(now + 0.1)
}
