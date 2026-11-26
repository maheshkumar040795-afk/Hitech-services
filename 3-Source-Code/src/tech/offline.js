// HT Jobs offline mode
//  • readCache / writeCache: last loaded jobs, salary, item lists… kept on the phone (localStorage)
//  • queue: "Mark Completed" / "Can't complete" done without internet wait on the phone
//    (IndexedDB, so photos can wait too) and are sent automatically when the internet is back.
import { useSyncExternalStore } from 'react'
import { rpc } from '../lib/supabase'
import { uploadPhoto, PHOTOS_ENABLED } from '../lib/photos'

// ── Small saved copies ────────────────────────────────────────────────────────
const C = 'htc:'
export function readCache(key) {
  try { const v = localStorage.getItem(C + key); return v ? JSON.parse(v) : undefined } catch { return undefined }
}
export function writeCache(key, data) {
  try { localStorage.setItem(C + key, JSON.stringify(data)) } catch { /* phone storage full: skip */ }
}

/** true when the request failed because there is no internet (not a server "no") */
export function isNetworkError(e) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const m = `${e?.message || ''} ${e?.details || ''} ${e?.name || ''}`
  return /Failed to fetch|NetworkError|Network request failed|Load failed|fetch failed|ERR_INTERNET|ERR_NETWORK|timed? ?out|AbortError/i.test(m)
}

// ── Queue (IndexedDB) ─────────────────────────────────────────────────────────
const DB = 'ht-offline', STORE = 'queue'
let dbp = null
function db() {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1)
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
  }
  return dbp
}
async function tx(mode, fn) {
  const d = await db()
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => res(out?.result ?? out)
    t.onerror = () => rej(t.error)
  })
}

let items = []          // in-memory copy for the screen
const subs = new Set()
const emit = () => subs.forEach((f) => f())
async function reload() {
  try { items = (await tx('readonly', (s) => s.getAll())) || [] } catch { items = [] }
  emit()
}
if (typeof indexedDB !== 'undefined') reload()

export function useOfflineQueue() {
  return useSyncExternalStore((cb) => { subs.add(cb); return () => subs.delete(cb) }, () => items, () => items)
}

/**
 * Put an update in the queue.
 * item = { kind: 'complete' | 'notdone', techId, jobId, orderId, args (tech_update_job), photoUrls, savedPhotos, blobs, patch }
 */
export async function enqueue(item) {
  // one waiting update per job: a newer one replaces the older
  const old = items.filter((q) => q.jobId === item.jobId)
  await tx('readwrite', (s) => { old.forEach((q) => s.delete(q.id)); s.add({ ...item, createdAt: new Date().toISOString() }) })
  await reload()
}

/** Queued changes shown on top of the saved job list (so the phone shows the job as done) */
export function applyQueue(jobs, techId) {
  const mine = items.filter((q) => q.techId === techId)
  if (!mine.length) return jobs
  const byJob = new Map(mine.map((q) => [q.jobId, q]))
  return jobs.map((j) => {
    const q = byJob.get(j.id)
    return q ? { ...j, ...q.patch, closed_at: q.createdAt, _queued: true } : j
  })
}

// ── Sending ───────────────────────────────────────────────────────────────────
const oldServer = (err) => /p_installed_item|p_payment_mode|schema cache|Could not find the function/i.test(err?.message || '')

/**
 * Send one update to the server: photos (upload + save links) first, then the job status.
 * onProgress(item) is called after each uploaded photo, so a retry does not upload it twice.
 */
export async function sendItem(item, { techCode, onProgress } = {}) {
  let urls = [...(item.photoUrls || [])]
  const blobs = [...(item.blobs || [])]
  while (blobs.length) {
    const url = await uploadPhoto(blobs[0], { orderId: item.orderId, techCode })
    urls.push(url); blobs.shift()
    item = { ...item, photoUrls: urls, blobs }
    await onProgress?.(item)
  }
  if (item.kind === 'complete' && PHOTOS_ENABLED) {
    const saved = item.savedPhotos || []
    if (urls.length !== saved.length || urls.some((u, i) => u !== saved[i])) await rpc('tech_save_photos', { p_order: item.jobId, p_urls: urls })
  }
  const a = item.args
  try { await rpc('tech_update_job', a) }
  catch (err) {   // server not updated yet → send what it understands
    if (!oldServer(err)) throw err
    const { p_installed_item, ...withMode } = a   // eslint-disable-line no-unused-vars
    try { await rpc('tech_update_job', withMode) }
    catch (err2) {
      if (!oldServer(err2)) throw err2
      const { p_payment_mode, ...base } = withMode   // eslint-disable-line no-unused-vars
      await rpc('tech_update_job', base)
    }
  }
}

let syncing = false
/**
 * Send everything waiting. Stops at the first "no internet" (tries again later).
 * Returns { sent, failed: [{ orderId, error }], left }.
 */
export async function syncQueue({ techId, techCode } = {}) {
  if (syncing || (typeof navigator !== 'undefined' && navigator.onLine === false)) return { sent: 0, failed: [], left: items.length }
  syncing = true
  let sent = 0
  const failed = []
  try {
    await reload()
    for (const q of items.filter((x) => !techId || x.techId === techId)) {
      try {
        await sendItem(q, { techCode, onProgress: (it) => tx('readwrite', (s) => s.put(it)) })
        await tx('readwrite', (s) => s.delete(q.id)); sent++
      } catch (e) {
        if (isNetworkError(e)) break                      // still offline → keep, try later
        await tx('readwrite', (s) => s.delete(q.id))      // the server said no (job reassigned, cancelled…) → drop, tell the technician
        failed.push({ orderId: q.orderId, error: e?.message || String(e) })
      }
    }
  } finally {
    syncing = false
    await reload()
  }
  return { sent, failed, left: items.length }
}
