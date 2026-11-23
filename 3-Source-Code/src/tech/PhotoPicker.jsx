import { useEffect, useRef } from 'react'
import { Camera, ImagePlus, X, Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { compressImage, uploadPhoto, photoThumb, MAX_PHOTOS, PHOTOS_REQUIRED } from '../lib/photos'

let seq = 0
/** Saved links → picker items */
export const photoItems = (urls) => (urls || []).map((url) => ({ key: `p${++seq}`, url, status: 'done' }))
export const photoUrls = (items) => items.filter((p) => p.status === 'done').map((p) => p.url)

/**
 * Installation photos for HT Jobs: take with the camera or pick from the gallery (max 10).
 * Each photo is compressed on the phone and uploaded to Cloudinary right away,
 * so "Submit" only has to save the links.
 * items: [{ key, status: 'uploading' | 'done' | 'error', url?, preview?, blob?, error? }]
 */
export default function PhotoPicker({ items, setItems, orderId, techCode }) {
  const camRef = useRef(null)
  const galRef = useRef(null)
  const previews = useRef(new Set())
  useEffect(() => () => previews.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const patch = (key, p) => setItems((list) => list.map((x) => (x.key === key ? { ...x, ...p } : x)))
  const send = async (key, blob) => {
    patch(key, { status: 'uploading', error: '' })
    try { patch(key, { status: 'done', url: await uploadPhoto(blob, { orderId, techCode }) }) }
    catch (e) { patch(key, { status: 'error', error: navigator.onLine === false ? 'No internet' : e.message }) }
  }
  const add = async (e) => {
    const files = [...(e.target.files || [])]; e.target.value = ''
    const room = MAX_PHOTOS - items.length
    if (!files.length || room <= 0) return
    for (const file of files.slice(0, room)) {
      const key = `p${++seq}`
      const preview = URL.createObjectURL(file)
      previews.current.add(preview)
      setItems((list) => [...list, { key, status: 'uploading', preview }])
      try { const blob = await compressImage(file); patch(key, { blob }); send(key, blob) }   // blob kept for Retry
      catch { patch(key, { status: 'error', error: 'Could not read this photo' }) }
    }
  }
  const remove = (key) => setItems((list) => list.filter((x) => x.key !== key))
  const retry = (p) => (p.blob ? send(p.key, p.blob) : null)

  const full = items.length >= MAX_PHOTOS
  const uploading = items.filter((p) => p.status === 'uploading').length
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2">
        <Camera size={15} /> Installation photos {PHOTOS_REQUIRED ? <span className="text-red-600">*</span> : <span className="font-normal text-slate-400">(optional)</span>}
        <span className="ml-auto text-xs font-medium text-slate-400">{items.length}/{MAX_PHOTOS}</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={full} onClick={() => camRef.current?.click()}
          className="py-3.5 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white font-bold text-sm flex flex-col items-center gap-1 disabled:opacity-40">
          <Camera size={22} /> Take photo</button>
        <button type="button" disabled={full} onClick={() => galRef.current?.click()}
          className="py-3.5 rounded-2xl border-2 border-emerald-500 bg-emerald-50 text-emerald-700 font-bold text-sm flex flex-col items-center gap-1 active:bg-emerald-100 disabled:opacity-40">
          <ImagePlus size={22} /> Upload from gallery</button>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={add} />
      <input ref={galRef} type="file" accept="image/*" multiple className="hidden" onChange={add} />

      {items.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mt-3">
          {items.map((p) => (
            <div key={p.key} className={`relative aspect-square rounded-xl overflow-hidden bg-slate-100 border-2 ${p.status === 'error' ? 'border-red-400' : 'border-transparent'}`}>
              <img src={p.preview || photoThumb(p.url)} alt="" className="w-full h-full object-cover" />
              {p.status === 'uploading' && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Loader2 size={22} className="text-white animate-spin" /></div>}
              {p.status === 'error' && (
                <button type="button" onClick={() => retry(p)} title={p.error} className="absolute inset-0 bg-red-900/50 flex flex-col items-center justify-center text-white text-[10px] font-bold gap-0.5">
                  {p.blob ? <><RotateCcw size={18} /> Retry</> : <><AlertTriangle size={18} /> Failed</>}</button>
              )}
              <button type="button" onClick={() => remove(p.key)} aria-label="Remove photo"
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"><X size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-500 mt-2">
        {uploading ? `Uploading ${uploading} photo${uploading > 1 ? 's' : ''}…` : full ? 'Maximum 10 photos.' : 'Take photos of the installed product (photos are made smaller before upload).'}
      </p>
    </div>
  )
}
