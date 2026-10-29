// 10-second "new job" ringtone, made in the browser (no sound file to download).
// Phones only allow sound after the person has touched the app once, so we unlock audio on the first tap.
let ctx = null
let stopAt = 0
let timer = null
let master = null   // all notes of one alert go through this, so Stop can silence them at once

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

/** Call once at app start: unlocks sound on the first touch / click / key press */
export function primeAlertSound() {
  const unlock = () => {
    const a = audio()
    if (a && a.state === 'suspended') a.resume().catch(() => {})
    // a silent blip makes iOS treat the context as user-started
    if (a) { const o = a.createOscillator(); const g = a.createGain(); g.gain.value = 0; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.01) }
  }
  ;['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }))
}

function chime(a, at, out) {
  // two quick bright notes, like a doorbell
  ;[[988, 0], [1319, 0.16]].forEach(([freq, off]) => {
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'triangle'
    o.frequency.value = freq
    g.gain.setValueAtTime(0.0001, at + off)
    g.gain.exponentialRampToValueAtTime(0.5, at + off + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, at + off + 0.32)
    o.connect(g).connect(out)
    o.start(at + off)
    o.stop(at + off + 0.35)
  })
}

/** Ring for `seconds` (default 10). Returns true if sound could start. */
export function playNewJobAlert(seconds = 10) {
  stopNewJobAlert()
  navigator.vibrate?.(Array.from({ length: Math.ceil(seconds / 1.2) }, () => [700, 500]).flat())
  const a = audio()
  if (!a) return false
  if (a.state === 'suspended') a.resume().catch(() => {})
  master = a.createGain()
  master.connect(a.destination)
  const out = master
  const start = a.currentTime + 0.05
  stopAt = start + seconds
  let t = start
  // schedule in small batches so "stop" takes effect quickly
  const schedule = () => {
    const until = Math.min(a.currentTime + 1.5, stopAt)
    while (t < until) { chime(a, t, out); t += 0.9 }
    if (t < stopAt) timer = setTimeout(schedule, 700)
  }
  schedule()
  return a.state === 'running'
}

export function stopNewJobAlert() {
  clearTimeout(timer)
  timer = null
  stopAt = 0
  navigator.vibrate?.(0)
  if (master) { try { master.gain.value = 0; master.disconnect() } catch { /* ignore */ } master = null }
}
