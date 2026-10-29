// 10-second "new job" ringtone, generated in the phone (nothing to download).
// Two players for reliability:
//   1) an <audio> element playing a generated WAV — once "unlocked" by any tap, phones let it play later
//      even after the screen was locked (the most reliable path, especially on iPhone);
//   2) Web Audio as a fallback.
// Every tap re-unlocks, because phones suspend sound after the app has been in the background.

const SECONDS = 10
let el = null           // <audio>
let elUnlocked = false
let ctx = null          // Web Audio fallback
let master = null
let timer = null
let ringing = false

function wavUrl() {
  const rate = 22050
  const n = rate * SECONDS
  const data = new Int16Array(n)
  // doorbell: two bright notes every 0.9 s
  for (let start = 0; start < SECONDS - 0.4; start += 0.9) {
    ;[[988, 0], [1319, 0.16]].forEach(([f, off]) => {
      const s0 = Math.floor((start + off) * rate), len = Math.floor(0.32 * rate)
      for (let i = 0; i < len && s0 + i < n; i++) {
        const t = i / rate
        const env = Math.min(1, t / 0.02) * Math.exp(-t * 9)
        const tri = (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * f * t))
        data[s0 + i] = Math.max(-32767, Math.min(32767, data[s0 + i] + tri * env * 0.6 * 32767))
      }
    })
  }
  const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
  new Int16Array(buf, 44).set(data)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

function player() {
  if (!el && typeof Audio !== 'undefined') {
    el = new Audio(wavUrl())
    el.preload = 'auto'
    el.setAttribute('playsinline', '')
  }
  return el
}
function audioCtx() {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) ctx = new AC() }
  return ctx
}

function unlock() {
  const a = player()
  if (a && !ringing) {
    a.muted = true
    const p = a.play()
    if (p?.then) p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; elUnlocked = true }).catch(() => { a.muted = false })
  }
  const c = audioCtx()
  if (c && c.state !== 'running') c.resume().catch(() => {})
}

/** Call once at app start: every touch keeps sound unlocked (phones re-lock it after sleep) */
export function primeAlertSound() {
  player()
  ;['pointerdown', 'touchend', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { passive: true }))
}

function webAudioRing(seconds) {
  const a = audioCtx()
  if (!a) return false
  if (a.state !== 'running') a.resume().catch(() => {})
  master = a.createGain(); master.connect(a.destination)
  const out = master, stopAt = a.currentTime + seconds
  let t = a.currentTime + 0.05
  const note = (f, at) => {
    const o = a.createOscillator(), g = a.createGain()
    o.type = 'triangle'; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.5, at + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.32)
    o.connect(g).connect(out); o.start(at); o.stop(at + 0.35)
  }
  const schedule = () => {
    const until = Math.min(a.currentTime + 1.5, stopAt)
    while (t < until) { note(988, t); note(1319, t + 0.16); t += 0.9 }
    if (t < stopAt) timer = setTimeout(schedule, 700)
  }
  schedule()
  return a.state === 'running'
}

/** Ring for 10 seconds + vibrate. Resolves true if sound started (false = phone blocked it until next tap). */
export async function playNewJobAlert() {
  stopNewJobAlert()
  ringing = true
  navigator.vibrate?.(Array.from({ length: 8 }, () => [700, 500]).flat())
  const a = player()
  if (a) {
    try { a.muted = false; a.currentTime = 0; a.volume = 1; await a.play(); return true }
    catch { /* blocked → try Web Audio */ }
  }
  return webAudioRing(SECONDS)
}

export function stopNewJobAlert() {
  ringing = false
  clearTimeout(timer); timer = null
  navigator.vibrate?.(0)
  if (el) { try { el.pause(); el.currentTime = 0 } catch { /* ignore */ } }
  if (master) { try { master.gain.value = 0; master.disconnect() } catch { /* ignore */ } master = null }
}

export const soundUnlocked = () => elUnlocked
