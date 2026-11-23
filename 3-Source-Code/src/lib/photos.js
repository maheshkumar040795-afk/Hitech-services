// Installation photos: compressed on the phone, uploaded straight to Cloudinary (unsigned preset).
// Only the photo links are saved in Supabase (orders.photos), so the free database stays small.
const cfg = (typeof window !== 'undefined' && window.HITECH_CONFIG) || {}
const isSet = (v) => v && !String(v).includes('YOUR-')
const CLOUD = isSet(cfg.CLOUDINARY_CLOUD_NAME) ? String(cfg.CLOUDINARY_CLOUD_NAME).trim() : ''
const PRESET = isSet(cfg.CLOUDINARY_UPLOAD_PRESET) ? String(cfg.CLOUDINARY_UPLOAD_PRESET).trim() : ''

export const MAX_PHOTOS = 10
/** Photo upload is on only when both Cloudinary settings are filled in config.js */
export const PHOTOS_ENABLED = !!(CLOUD && PRESET)
/** At least one photo needed to mark a job completed (config PHOTOS_REQUIRED, default on) */
export const PHOTOS_REQUIRED = PHOTOS_ENABLED && cfg.PHOTOS_REQUIRED !== false

const MAX_SIDE = 1600      // px — sharp enough to read a model number, ~150–400 KB as JPEG
const QUALITY = 0.72

async function decode(file) {
  // createImageBitmap applies the camera's EXIF rotation; fall back to <img> on older phones
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch { /* fall through */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally { URL.revokeObjectURL(url) }
}

/** Any phone photo (JPEG / PNG / HEIC where the browser can read it) → smaller JPEG Blob */
export async function compressImage(file) {
  const src = await decode(file)
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight
  if (!w0 || !h0) throw new Error('Could not read this photo')
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0))
  const w = Math.round(w0 * k), h = Math.round(h0 * k)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)   // transparent PNG → white, not black
  ctx.drawImage(src, 0, 0, w, h)
  src.close?.()
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('Could not compress this photo')
  // Keep the original if it was already smaller (e.g. a small screenshot)
  return file.size && file.size < blob.size && /jpe?g/i.test(file.type) ? file : blob
}

/** Upload one compressed photo → Cloudinary https link */
export async function uploadPhoto(blob, { orderId = '', techCode = '' } = {}) {
  if (!PHOTOS_ENABLED) throw new Error('Photo upload is not set up (Cloudinary settings in config.js)')
  const fd = new FormData()
  fd.append('file', blob, 'photo.jpg')
  fd.append('upload_preset', PRESET)
  const tags = ['ht-jobs', orderId && `order-${orderId}`, techCode && `tech-${techCode}`].filter(Boolean)
    .map((t) => t.replace(/[^A-Za-z0-9_-]/g, '-'))
  fd.append('tags', tags.join(','))
  if (orderId) fd.append('context', `order=${String(orderId).replace(/[|=]/g, '-')}`)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(CLOUD)}/image/upload`, { method: 'POST', body: fd })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.secure_url) throw new Error(data?.error?.message || `Upload failed (${res.status})`)
  return data.secure_url
}

/**
 * Link used for thumbnails. Photos are already compressed on the phone, so the original is shown as is:
 * a resized Cloudinary version would count as a "transformation" and use up the free-plan credits.
 */
export function photoThumb(url) {
  return String(url || '')
}
