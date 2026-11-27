import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Phone, MapPin, MessageCircle, ChevronRight, X, CheckCircle2, XCircle, Clock, RefreshCw, LogOut,
  User, Lock, Send, Search, RotateCcw, Pencil, KeyRound, Wifi, WifiOff, CalendarDays, ClipboardList, CalendarClock, Banknote, BellRing, ShoppingBag, Wrench,
  Hammer, CloudOff, UploadCloud, AlertCircle,
} from 'lucide-react'
import { supabase, rpc, errMsg } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useOrdersRealtime } from '../hooks/useRealtime'
import { addDays, todayIST, isTodayIST, fmtDate, fmtDayIST, fmtDateTime, fmtMoney, mapsUrl, telUrl, waUrl } from '../lib/format'
import Logo from '../components/Logo'
import WelcomeModal from '../components/WelcomeModal'
import { usePushAlerts } from './usePushAlerts'
import { useTechPresence } from '../hooks/usePresence'
import IOSInstallSheet from '../components/ui/IOSInstallSheet'
import PhotoPicker, { photoItems, photoUrls, offlinePhotos } from './PhotoPicker'
import { readCache, writeCache, isNetworkError, enqueue, sendItem, applyQueue, syncQueue, useOfflineQueue } from './offline'
import DoneCalendar from './DoneCalendar'
import { PHOTOS_ENABLED, PHOTOS_REQUIRED, photoThumb } from '../lib/photos'
import { tr as t, useLang, LangSwitch, locale } from './i18n'

const REASONS = [
  'Customer not available',
  'Customer not answering phone',
  'Wrong / incomplete address',
  'Customer cancelled',
  'Product not delivered yet',
  'Parts / material needed',
  'Site not ready',
]
// Only what the phone shows (keeps mobile data and the free-plan download quota low)
const JOB_FIELDS_V2 = 'id, order_id, order_date, rescheduled_date, customer_name, phone_no, service, brand, location, address, pin_code, location_url, status, comments, cod_amount, payment_mode, closed_at, assigned_at'
const JOB_FIELDS_V3 = JOB_FIELDS_V2 + ', product_type'
const JOB_FIELDS_V4 = JOB_FIELDS_V3 + ', installed_item'
const JOB_FIELDS_V5 = JOB_FIELDS_V4 + ', collect_amount'
const JOB_FIELDS_V6 = JOB_FIELDS_V5 + ', photos'
const JOB_FIELDS = JOB_FIELDS_V6 + ', job_type'
const JOB_FIELDS_OLD = 'id, order_id, order_date, customer_name, phone_no, service, brand, location, address, pin_code, status, comments, cod_amount, closed_at, assigned_at'
const HISTORY_SHORT = 3, HISTORY_LONG = 30   // days of Done / Not done jobs to download

/** Pending or Rescheduled = still to visit */
const isOpen = (j) => j.status === 'PENDING' || j.status === 'RESCHEDULED'
/** The day the visit is due: reschedule date if any, else order date */
const visitDate = (j) => j.rescheduled_date || j.order_date
const isLocked = (j) => !isOpen(j) && !isTodayIST(j.closed_at)

// ── Bottom sheet ──────────────────────────────────────────────────────────────
function Sheet({ title, onClose, children, tall = false }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className={`relative bg-white rounded-t-3xl shadow-2xl flex flex-col ${tall ? 'h-[94dvh]' : 'max-h-[92dvh]'}`}
           style={{ animation: 'sheetUp .22s ease-out', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <style>{'@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}'}</style>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900 truncate pr-3">{title}</h3>
          <button onClick={onClose} className="w-9 h-9 -mr-2 rounded-full flex items-center justify-center text-slate-500 active:bg-slate-100"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>
  )
}

/** "What did you install / repair?" list from Rate Config — saved on the phone so it works without internet */
const itemsQuery = (fn) => ({
  queryKey: ['install-items', fn], staleTime: 10 * 60_000,
  initialData: () => readCache(`items:${fn}`), initialDataUpdatedAt: 0,
  queryFn: async () => {
    const { data, error } = await supabase.rpc(fn)
    if (error) { if (isNetworkError(error)) return readCache(`items:${fn}`) || []; return [] }   // server not updated yet → no picker
    const list = (data || []).map((r) => (typeof r === 'string' ? r : r[fn])).filter(Boolean)
    writeCache(`items:${fn}`, list)
    return list
  },
})

// ── Complete / not-complete forms ─────────────────────────────────────────────
function CompleteSheet({ job, onClose, onDone }) {
  const { toast } = useToast()
  const { technician } = useAuth()
  const done = job.status === 'COMPLETED'
  const [photos, setPhotos] = useState(() => photoItems(job.photos))
  // what was installed / repaired — list comes from Rate Config (names only)
  const repair = job.job_type === 'REPAIR'
  const fn = repair ? 'tech_repair_items' : 'tech_install_items'
  const { data: items = [], isLoading: itemsLoading } = useQuery(itemsQuery(fn))
  const norm = (x) => (x || '').trim().toLowerCase()
  const [item, setItem] = useState(job.installed_item || '')
  useEffect(() => {
    if (!item && items.length) { const m = items.find((i) => norm(i) === norm(job.service)); if (m) setItem(m) }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  // Office set a Cash Collect amount → technician must collect it; "Paid on Amazon" is not offered
  const toCollect = Number(job.collect_amount) || 0
  const [pay, setPay] = useState(toCollect > 0 ? 'COLLECT' : job.payment_mode === 'AMAZON' ? 'AMAZON' : (job.payment_mode ? 'COLLECT' : ''))   // COLLECT | AMAZON
  const [amount, setAmount] = useState(done && job.payment_mode !== 'AMAZON' && Number(job.cod_amount) > 0 ? String(Number(job.cod_amount)) : toCollect > 0 ? String(toCollect) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  // validation message shown inside the form (next to the field and above Submit), not only as a toast
  const [err, setErr] = useState({ field: '', msg: '' })
  const itemRef = useRef(null), payRef = useRef(null), photoRef = useRef(null)
  const fail = (field, msg, ref) => {
    setErr({ field, msg })
    navigator.vibrate?.([40, 60, 40])
    ref?.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  useEffect(() => { setErr({ field: '', msg: '' }) }, [item, pay, amount, photos])
  const submit = async (e) => {
    e.preventDefault()
    if (items.length && !item) return fail('item', t(repair ? 'Select what you repaired' : 'Select what you installed'), itemRef)
    if (!pay) return fail('pay', t('Select Collect from customer or Paid on Amazon'), payRef)
    const amazon = pay === 'AMAZON' && !(toCollect > 0)
    // amount fixed by the office cannot be changed by the technician
    const v = amazon ? 0 : toCollect > 0 ? toCollect : parseFloat(amount)
    if (!amazon && !(toCollect > 0) && (amount === '' || isNaN(v) || v <= 0)) return fail('pay', t('Enter the amount collected from the customer'), payRef)
    const urls = photoUrls(photos)
    const waiting = offlinePhotos(photos)   // taken without internet, upload later
    if (PHOTOS_ENABLED) {
      if (photos.some((p) => p.status === 'uploading')) return fail('photo', t('Please wait, photos are still uploading'), photoRef)
      if (photos.some((p) => p.status === 'error')) return fail('photo', t('A photo did not upload. Tap it to retry, or remove it (✕).'), photoRef)
      if (PHOTOS_REQUIRED && !urls.length && !waiting.length) return fail('photo', t('Add at least 1 photo of the installation'), photoRef)
    }
    const mode = amazon ? 'AMAZON' : 'CASH'   // CASH = collected from customer
    const update = {
      kind: 'complete', techId: technician?.id, jobId: job.id, orderId: job.order_id,
      args: { p_order: job.id, p_status: 'COMPLETED', p_amount: v, p_note: note || null, p_payment_mode: mode, ...(item ? { p_installed_item: item } : {}) },
      photoUrls: urls, savedPhotos: job.photos || [], blobs: waiting,
      patch: { status: 'COMPLETED', payment_mode: mode, cod_amount: v, ...(item ? { installed_item: item } : {}) },
    }
    const doneMsg = amazon ? t('Job completed · paid on Amazon') : t('Job completed · {amt} collected from customer', { amt: fmtMoney(v) })
    const saveOnPhone = async () => {
      await enqueue(update)
      navigator.vibrate?.(60)
      toast(`${doneMsg} · ${t('Saved on phone · will send when internet is back')}`, 'success')
      onDone()
    }
    setBusy(true)
    try {
      if (navigator.onLine === false || waiting.length) return await saveOnPhone()   // no internet → the phone keeps it
      await sendItem(update, { techCode: technician?.tech_code })   // photos first, then the job: never completed without its photos
      navigator.vibrate?.(60)
      toast(doneMsg, 'success')
      onDone()
    } catch (err) {
      if (isNetworkError(err)) await saveOnPhone()
      else if (/tech_save_photos|schema cache|Could not find the function/i.test(err?.message || '')) toast(t('Photos are not set up on the server yet. Please call the office.'), 'error')
      else toast(errMsg(err), 'error')
    } finally { setBusy(false) }
  }
  const choice = (on, active) => `rounded-2xl border-2 font-bold transition ${active ? on : 'border-slate-200 text-slate-600 active:bg-slate-50'}`
  const FieldErr = ({ f }) => err.field === f ? <p role="alert" className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-red-600"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {err.msg}</p> : null
  const box = (f) => err.field === f ? 'rounded-2xl ring-2 ring-red-400 ring-offset-4' : ''
  return (
    <Sheet title={t(repair ? 'Mark repair completed' : 'Mark job completed')} onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-5">
        <div className="text-sm text-slate-600"><b className="text-slate-900">{job.customer_name}</b> · {job.service}</div>

        {toCollect > 0 && (
          <div className="rounded-2xl border-2 border-red-300 bg-red-50 p-4 flex items-start gap-3">
            <Banknote size={28} className="text-red-600 flex-shrink-0" />
            <div>
              <p className="text-base font-bold text-red-800">{t('collect.before')} <span className="text-2xl">{fmtMoney(toCollect)}</span> {t('collect.after')}</p>
              <p className="text-xs text-red-700 mt-0.5">{t('This order is not paid on Amazon. Collect the amount (cash or UPI) before you leave.')}</p>
            </div>
          </div>
        )}

        {(itemsLoading || items.length > 0) && (
          <div ref={itemRef} className={box('item')}>
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 mb-2"><Wrench size={15} /> {t(repair ? '1. What did you repair?' : '1. What did you install?')} <span className="text-red-500">*</span></label>
            {itemsLoading ? <div className="h-12 rounded-2xl bg-slate-100 animate-pulse" /> : (
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                {items.map((i) => (
                  <button key={i} type="button" onClick={() => setItem(i)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm ${choice('border-brand-500 bg-brand-50 text-brand-800', item === i)}`}>
                    <span className={`w-5 h-5 shrink-0 rounded-full border-2 flex items-center justify-center ${item === i ? 'border-brand-600' : 'border-slate-300'}`}>
                      {item === i && <span className="w-2.5 h-2.5 rounded-full bg-brand-600" />}</span>
                    {i}
                  </button>
                ))}
              </div>
            )}
            <FieldErr f="item" />
          </div>
        )}

        <div ref={payRef} className={box('pay')}>
          <label className="block text-sm font-semibold text-slate-700 mb-2">{t(items.length ? '2. Payment' : 'Payment')} <span className="text-red-500">*</span></label>
          <div className={`grid gap-2 ${toCollect > 0 ? 'grid-cols-1' : 'grid-cols-2'}`}>
            <button type="button" onClick={() => setPay('COLLECT')}
              className={`py-3.5 px-2 flex flex-col items-center gap-1 text-sm ${choice('border-emerald-500 bg-emerald-50 text-emerald-700', pay === 'COLLECT')}`}>
              <Banknote size={22} /> {t('Collect from customer')}</button>
            {!(toCollect > 0) && <button type="button" onClick={() => setPay('AMAZON')}
              className={`py-3.5 px-2 flex flex-col items-center gap-1 text-sm ${choice('border-amber-500 bg-amber-50 text-amber-800', pay === 'AMAZON')}`}>
              <ShoppingBag size={22} /> {t('Paid on Amazon')}</button>}
          </div>
          {pay === 'AMAZON' && <p className="text-xs text-amber-700 mt-1.5">{t('Customer already paid on Amazon — nothing to collect (₹0).')}</p>}
          {pay === 'COLLECT' && (
            <div className="mt-3 space-y-3 rounded-2xl bg-slate-50 p-3">
              <p className="text-xs text-slate-600">{t('Amount you received from the customer (cash or UPI). It is deducted from your pay for this job.')}</p>
              {toCollect > 0 ? (
                <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-slate-100 overflow-hidden" aria-readonly="true">
                  <span className="pl-4 text-2xl font-bold text-slate-400">₹</span>
                  <input type="text" readOnly tabIndex={-1} value={String(toCollect)} aria-label={t('Amount collected')}
                    className="flex-1 min-w-0 py-3.5 px-3 text-2xl font-bold outline-none bg-transparent text-slate-700 pointer-events-none select-none" />
                  <Lock size={18} className="mr-4 text-slate-400 flex-shrink-0" />
                </div>
              ) : (
                <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-white focus-within:border-emerald-500 overflow-hidden">
                  <span className="pl-4 text-2xl font-bold text-slate-400">₹</span>
                  <input type="number" inputMode="decimal" min="0" step="0.01" placeholder={t('Amount collected')} autoFocus
                    className="flex-1 min-w-0 py-3.5 px-3 text-2xl font-bold outline-none bg-transparent placeholder:text-base placeholder:font-medium" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </div>
              )}
              {toCollect > 0 && <p className="text-xs text-slate-500 flex items-center gap-1"><Lock size={12} /> {t('Amount fixed by office · cannot be changed')}</p>}
            </div>
          )}
          <FieldErr f="pay" />
        </div>
        {PHOTOS_ENABLED && <div ref={photoRef} className={box('photo')}>
          <PhotoPicker items={photos} setItems={setPhotos} orderId={job.order_id} techCode={technician?.tech_code} />
          <FieldErr f="photo" />
        </div>}

        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">{t('Note')} <span className="font-normal text-slate-400">{t('(optional)')}</span></label>
          <textarea rows={2} className="w-full rounded-2xl border-2 border-slate-200 focus:border-emerald-500 outline-none p-3 text-base"
            placeholder={t('e.g. Installed with extra pipe 2 m')} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err.msg && <div role="alert" className="rounded-2xl bg-red-50 border-2 border-red-300 p-3 flex items-start gap-2 text-sm font-bold text-red-700">
          <AlertCircle size={18} className="flex-shrink-0 mt-0.5" /> {err.msg}</div>}
        <button disabled={busy || photos.some((p) => p.status === 'uploading')} className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
          <CheckCircle2 size={22} /> {busy ? t('Saving…') : photos.some((p) => p.status === 'uploading') ? t('Uploading photos…') : t('Submit — Job Completed')}
        </button>
      </form>
    </Sheet>
  )
}

function NotDoneSheet({ job, onClose, onDone }) {
  const { toast } = useToast()
  const { technician } = useAuth()
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const text = reason === 'Other' ? other.trim() : reason
  const submit = async () => {
    if (!text) return toast(t('Select or type a reason'), 'error')
    const update = { kind: 'notdone', techId: technician?.id, jobId: job.id, orderId: job.order_id,
      args: { p_order: job.id, p_status: 'REJECTED', p_amount: null, p_note: text }, patch: { status: 'REJECTED', comments: text } }
    const saveOnPhone = async () => { await enqueue(update); toast(`${t('Reported to office')} · ${t('Saved on phone · will send when internet is back')}`, 'success'); onDone() }
    setBusy(true)
    try {
      if (navigator.onLine === false) return await saveOnPhone()
      await sendItem(update)
      toast(t('Reported to office'), 'success')
      onDone()
    } catch (err) { if (isNetworkError(err)) await saveOnPhone(); else toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet title={t("Can't complete this job")} onClose={onClose}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-slate-500">{t('Why? The office will see this reason.')}</p>
        <div className="space-y-2">
          {[...REASONS, 'Other'].map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 text-[15px] font-medium ${reason === r ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700 active:bg-slate-50'}`}>{t(r)}</button>
          ))}
        </div>
        {reason === 'Other' && (
          <textarea autoFocus rows={2} className="w-full rounded-2xl border-2 border-slate-200 focus:border-red-500 outline-none p-3 text-base" placeholder={t('Type the reason')} value={other} onChange={(e) => setOther(e.target.value)} />
        )}
        <button onClick={submit} disabled={busy || !text} className="w-full py-4 rounded-2xl bg-red-600 active:bg-red-700 text-white text-lg font-bold disabled:opacity-40">
          {busy ? t('Sending…') : t('Submit reason')}
        </button>
      </div>
    </Sheet>
  )
}

// ── Job detail ────────────────────────────────────────────────────────────────
function JobDetail({ job, onClose, refresh }) {
  const { user } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [action, setAction] = useState(null) // 'complete' | 'notdone'
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const { data: notes = [] } = useQuery({
    queryKey: ['tech-notes', job.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('comment_logs').select('id, comment, created_at, user:profiles(name, role)')
        .eq('order_id', job.id).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const addNote = async () => {
    if (!note.trim()) return
    if (navigator.onLine === false) return toast(t('Notes need internet'), 'error')
    setBusy(true)
    const { error } = await supabase.from('comment_logs').insert({ order_id: job.id, user_id: user.id, comment: note.trim() })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setNote(''); qc.invalidateQueries({ queryKey: ['tech-notes', job.id] }); refresh()
  }
  const reopen = async () => {
    if (navigator.onLine === false) return toast(t('This needs internet'), 'error')
    if (!confirm(job.rescheduled_date ? t('Re-open this job? It goes back to Rescheduled ({d}).', { d: fmtDate(job.rescheduled_date) }) : t('Re-open this job as Pending?'))) return
    try { await rpc('tech_update_job', { p_order: job.id, p_status: 'PENDING' }); toast(t('Job re-opened'), 'success'); refresh() }
    catch (e) { toast(errMsg(e), 'error') }
  }
  const done = () => { setAction(null); refresh(); onClose() }

  const tel = telUrl(job.phone_no)
  const wa = waUrl(job.phone_no, `Hello ${job.customer_name}, this is your Hitech Services technician for ${job.service || 'installation'} (Order ${job.order_id}).`)
  const locked = isLocked(job)

  return (
    <>
      <Sheet title={job.customer_name} onClose={onClose} tall>
        <div className="p-5 space-y-5">
          <div className="flex items-center justify-between">
            <StatusPill status={job.status} />
            <span className="text-xs text-slate-400 font-mono">{job.order_id}</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <a href={tel || undefined} className={`flex flex-col items-center gap-1 py-3 rounded-2xl ${tel ? 'bg-brand-50 text-brand-700 active:bg-brand-100' : 'bg-slate-50 text-slate-300 pointer-events-none'}`}>
              <Phone size={22} /><span className="text-xs font-semibold">{t('Call')}</span></a>
            <a href={mapsUrl(job)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-emerald-50 text-emerald-700 active:bg-emerald-100">
              <MapPin size={22} /><span className="text-xs font-semibold">{t(job.location_url ? 'Location' : 'Map')}</span></a>
            <a href={wa || undefined} target="_blank" rel="noreferrer" className={`flex flex-col items-center gap-1 py-3 rounded-2xl ${wa ? 'bg-green-50 text-green-700 active:bg-green-100' : 'bg-slate-50 text-slate-300 pointer-events-none'}`}>
              <MessageCircle size={22} /><span className="text-xs font-semibold">WhatsApp</span></a>
          </div>

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {[
              ...(job.job_type === 'REPAIR' ? [[t('Job'), t('Repair')]] : []),
              [t('Service'), [job.service, job.brand].filter(Boolean).join(' · ') || '—'],
              ...(job.product_type ? [[t('Product type'), job.product_type]] : []),
              ...(job.installed_item ? [[t('Installed'), job.installed_item]] : []),
              ...(isOpen(job) && Number(job.collect_amount) > 0 ? [[t('Cash collect'), <b key="c" className="text-red-700">{t('{amt} from customer', { amt: fmtMoney(job.collect_amount) })}</b>]] : []),
              [t('Phone'), job.phone_no || '—'],
              [t('Address'), [job.address, job.location].filter(Boolean).join(', ') || '—'],
              [t('Pin code'), job.pin_code || '—'],
              [t('Order date'), fmtDate(job.order_date, { day: 'numeric', month: 'short', year: 'numeric' })],
              ...(job.rescheduled_date ? [[t('Rescheduled to'), fmtDate(job.rescheduled_date, { day: 'numeric', month: 'short', year: 'numeric' })]] : []),
              ...(!isOpen(job) ? [[t(job.status === 'COMPLETED' ? 'Completed on' : 'Closed'), fmtDateTime(job.closed_at)]] : []),
              ...(job.status === 'COMPLETED' ? [[t('Payment'), (job.payment_mode === 'AMAZON' ? t('Paid on Amazon') : t('{amt} collected from customer', { amt: fmtMoney(job.cod_amount) }))]] : []),
            ].map(([l, v]) => (
              <div key={l} className="flex gap-3 px-4 py-3"><span className="text-xs text-slate-400 w-24 flex-shrink-0 pt-0.5">{l}</span><span className="text-[15px] text-slate-800 font-medium break-words">{v}</span></div>
            ))}
          </div>

          {job.photos?.length > 0 && (
            <div className="grid grid-cols-4 gap-2">
              {job.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="aspect-square rounded-xl overflow-hidden bg-slate-100"><img src={photoThumb(u)} alt="Installation photo" loading="lazy" className="w-full h-full object-cover" /></a>)}
            </div>
          )}

          {isOpen(job) ? (
            <div className="space-y-2">
              <button onClick={() => setAction('complete')} className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                <CheckCircle2 size={22} /> {t('Mark Completed')}</button>
              <button onClick={() => setAction('notdone')} className="w-full py-3.5 rounded-2xl border-2 border-red-200 text-red-600 active:bg-red-50 text-base font-semibold flex items-center justify-center gap-2">
                <XCircle size={20} /> {t("Can't Complete")}</button>
            </div>
          ) : locked ? (
            <div className="flex items-center gap-2 p-4 rounded-2xl bg-slate-50 text-sm text-slate-500"><Lock size={16} /> {t('Closed on an earlier day. Call the office to change it.')}</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {job.status === 'COMPLETED' && <button onClick={() => setAction('complete')} className="py-3 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50"><Pencil size={16} /> {t('Edit details')}</button>}
              <button onClick={reopen} className={`py-3 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50 ${job.status !== 'COMPLETED' ? 'col-span-2' : ''}`}><RotateCcw size={16} /> {t('Re-open')}</button>
            </div>
          )}

          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">{t('Notes')}</p>
            <div className="flex gap-2 mb-3">
              <input className="flex-1 rounded-2xl border-2 border-slate-200 focus:border-brand-500 outline-none px-4 py-3 text-base" placeholder={t('Add a note for the office…')}
                value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button onClick={addNote} disabled={busy || !note.trim()} className="w-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center disabled:opacity-40"><Send size={18} /></button>
            </div>
            <div className="space-y-2">
              {notes.map((n) => (
                <div key={n.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[15px] text-slate-800">{n.comment}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{n.user?.role === 'TECHNICIAN' ? t('You') : `${n.user?.name || t('Office')} ${t('(office)')}`} · {fmtDateTime(n.created_at)}</p>
                </div>
              ))}
              {!notes.length && <p className="text-sm text-slate-400">{t('No notes yet')}</p>}
            </div>
          </div>
        </div>
      </Sheet>
      {action === 'complete' && <CompleteSheet job={job} onClose={() => setAction(null)} onDone={done} />}
      {action === 'notdone' && <NotDoneSheet job={job} onClose={() => setAction(null)} onDone={done} />}
    </>
  )
}

function StatusPill({ status }) {
  const m = {
    PENDING: ['Pending', 'bg-amber-100 text-amber-800', Clock],
    RESCHEDULED: ['Rescheduled', 'bg-sky-100 text-sky-800', CalendarClock],
    COMPLETED: ['Completed', 'bg-emerald-100 text-emerald-800', CheckCircle2],
    REJECTED: ['Not done', 'bg-red-100 text-red-700', XCircle],
  }[status]
  const Icon = m[2]
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${m[1]}`}><Icon size={13} /> {t(m[0])}</span>
}

/** Done tab: job is closed — no customer details, cannot be opened. Only date, installed item and cash collected. */
function DoneCard({ job }) {
  const amazon = job.payment_mode === 'AMAZON'
  return (
    <div className="bg-white rounded-3xl border border-slate-200/70 shadow-soft px-4 py-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><CheckCircle2 size={16} /> {t(job.job_type === 'REPAIR' ? 'Repair completed' : 'Completed')}</span>
        {job._queued ? <span className="text-[11px] font-bold text-sky-700 flex items-center gap-1"><UploadCloud size={13} /> {t('Waiting to send')}</span>
          : <span className="text-xs font-semibold text-slate-500">{fmtDayIST(job.closed_at, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
      </div>
      <div className="flex items-start gap-2 text-[15px] text-slate-800"><Wrench size={15} className="text-slate-400 mt-1 flex-shrink-0" /><span className="font-semibold">{job.installed_item || job.service || '—'}</span></div>
      <div className="flex items-center gap-2 text-sm"><Banknote size={15} className="text-slate-400 flex-shrink-0" />
        {amazon ? <span className="font-semibold text-amber-700">{t('Paid on Amazon')}</span>
          : <span><b className="text-slate-900">{fmtMoney(job.cod_amount)}</b> <span className="text-slate-500">{t('cash collected')}</span></span>}</div>
      {job.photos?.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pt-0.5">
          {job.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100"><img src={photoThumb(u)} alt="" loading="lazy" className="w-full h-full object-cover" /></a>)}
        </div>
      )}
    </div>
  )
}

function JobCard({ job, onOpen, isNew }) {
  const tel = telUrl(job.phone_no)
  const overdue = isOpen(job) && visitDate(job) < todayIST()
  return (
    <div className={`bg-white rounded-3xl border shadow-soft overflow-hidden transition-transform active:scale-[.985] ${isNew ? 'border-brand-400 ring-4 ring-brand-500/15' : 'border-slate-200/70'}`}>
      <button onClick={onOpen} className="w-full text-left px-4 pt-4 pb-3 active:bg-slate-50">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            {isNew && <span className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold shadow-glow" style={{ background: 'var(--grad-brand)' }}>{t('NEW')}</span>}
            {job.job_type === 'REPAIR' && <span className="px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center gap-0.5"><Hammer size={10} /> {t('REPAIR')}</span>}
            {isOpen(job)
              ? <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : job.status === 'RESCHEDULED' ? 'text-sky-700' : 'text-slate-400'}`}>{job.status === 'RESCHEDULED' ? <CalendarClock size={12} className="inline -mt-0.5" /> : <CalendarDays size={12} className="inline -mt-0.5" />} {job.status === 'RESCHEDULED' ? t('Rescheduled · ') : ''}{fmtDate(visitDate(job), { day: 'numeric', month: 'short' })}{overdue ? t(' · overdue') : ''}</span>
              : <StatusPill status={job.status} />}
            {job._queued && <span className="text-[10px] font-bold text-sky-700 flex items-center gap-0.5"><UploadCloud size={11} /> {t('Waiting to send')}</span>}
          </div>
          <span className="text-[10px] text-slate-400 font-mono truncate">{job.order_id}</span>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold text-slate-900 truncate">{job.customer_name}</p>
            <p className="text-sm text-slate-600 truncate">{[job.service, job.brand].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-slate-500 truncate mt-0.5"><MapPin size={12} className="inline -mt-0.5" /> {[job.location, job.pin_code].filter(Boolean).join(' · ') || '—'}</p>
            {isOpen(job) && Number(job.collect_amount) > 0 && <p className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-bold"><Banknote size={12} /> {t('Collect {amt}', { amt: fmtMoney(job.collect_amount) })}</p>}
            {job.status === 'COMPLETED' && <p className="text-sm font-bold text-emerald-700 mt-1">{job.payment_mode === 'AMAZON' ? t('Paid on Amazon') : t('{amt} collected from customer', { amt: fmtMoney(job.cod_amount) })} <span className="font-medium text-slate-400">· {fmtDayIST(job.closed_at, { day: 'numeric', month: 'short' })}</span></p>}
            {job.status === 'COMPLETED' && job.installed_item && <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1"><Wrench size={11} /> {job.installed_item}</p>}
          </div>
          <ChevronRight size={20} className="text-slate-300 mt-2 flex-shrink-0" />
        </div>
      </button>
      {isOpen(job) && (
        <div className="grid grid-cols-2 border-t border-slate-100">
          <a href={tel || undefined} className={`py-3 flex items-center justify-center gap-2 text-sm font-semibold border-r border-slate-100 ${tel ? 'text-brand-700 active:bg-brand-50' : 'text-slate-300 pointer-events-none'}`}><Phone size={16} /> {t('Call')}</a>
          <a href={mapsUrl(job)} target="_blank" rel="noreferrer" className="py-3 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 active:bg-emerald-50"><MapPin size={16} /> {t('Map')}</a>
        </div>
      )}
    </div>
  )
}

function AccountSheet({ onClose }) {
  const { user, technician, logout } = useAuth()
  const { toast } = useToast()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const changePin = async (e) => {
    e.preventDefault()
    if (pin.length < 6) return toast(t('PIN must be at least 6 digits'), 'error')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pin })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setPin(''); toast(t('PIN changed'), 'success')
  }
  return (
    <Sheet title={t('My account')} onClose={onClose}>
      <div className="p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 font-bold text-xl flex items-center justify-center">{user?.name?.[0]}</div>
          <div><p className="font-bold text-slate-900 text-lg">{user?.name}</p><p className="text-sm text-slate-500">+91 {user?.login}{technician?.city ? ` · ${technician.city}` : ''}</p>{technician?.tech_code && <p className="text-xs font-mono font-semibold text-brand-700 mt-0.5">{t('Technician ID: {c}', { c: technician.tech_code })}</p>}</div>
        </div>
        <div className="flex items-center justify-between rounded-2xl border-2 border-slate-200 px-4 py-3">
          <span className="text-sm font-semibold text-slate-700">{t('Language')} / Language</span><LangSwitch />
        </div>
        <form onSubmit={changePin} className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">{t('Change PIN')}</label>
          <div className="flex gap-2">
            <input type="password" inputMode="numeric" placeholder={t('New PIN (6+ digits)')} className="flex-1 rounded-2xl border-2 border-slate-200 focus:border-brand-500 outline-none px-4 py-3 text-base tracking-widest"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            <button disabled={busy} className="px-4 rounded-2xl bg-brand-600 text-white font-semibold disabled:opacity-50"><KeyRound size={18} /></button>
          </div>
        </form>
        <button onClick={logout} className="w-full py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50"><LogOut size={18} /> {t('Logout')}</button>
      </div>
    </Sheet>
  )
}

// ── Salary card (header) ──────────────────────────────────────────────────────
function SalaryCard({ label, m, current, onOpen }) {
  const month = m?.month ? new Date(`${m.month}T00:00:00Z`).toLocaleDateString(locale(), { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
  const day = Number(todayIST().slice(8, 10))
  const paid = m && m.paid !== null && m.paid !== undefined
  const net = m ? (paid ? Number(m.balance) : Number(m.net)) : 0
  return (
    <button type="button" onClick={m ? onOpen : undefined} className="bg-white/[.06] border border-white/10 rounded-2xl px-3 py-2.5 text-left w-full flex flex-col justify-start active:scale-[.98] transition-transform">
      <p className="text-[10px] font-semibold text-slate-300/90 uppercase tracking-wide flex items-center justify-between">{label} {m && <ChevronRight size={12} className="opacity-60" />}</p>
      <p className="text-[11px] text-slate-400 -mt-0.5">{month}{month && (current ? ` · 1 – ${day}` : '')}</p>
      {!m ? <div className="h-12 mt-1 rounded-lg bg-white/10 animate-pulse" /> : <>
        <div className="mt-1 space-y-0.5 text-[11px] tabular-nums">
          {m.repairs === undefined
            ? <div className="flex justify-between"><span className="text-slate-300">{t('Earned')}</span><span className="font-semibold text-white">{fmtMoney(m.earned)}</span></div>
            : <>
              <div className="flex justify-between gap-1"><span className="text-slate-300 truncate">{t('Install')} <span className="text-slate-400">×{m.installs}</span></span><span className="font-semibold text-white">{fmtMoney(m.install_earned)}</span></div>
              <div className="flex justify-between gap-1"><span className="text-slate-300 truncate">{t('Repair')} <span className="text-slate-400">×{m.repairs}</span></span><span className="font-semibold text-orange-200">{fmtMoney(m.repair_earned)}</span></div>
            </>}
          <div className="flex justify-between"><span className="text-slate-300">{t('Collected')}</span><span className="font-semibold text-amber-300">− {fmtMoney(m.collected)}</span></div>
          {Number(m.petrol) > 0 && <div className="flex justify-between"><span className="text-slate-300">{t('Petrol')}</span><span className="font-semibold text-sky-300">+ {fmtMoney(m.petrol)}</span></div>}
          {Number(m.advance) > 0 && <div className="flex justify-between"><span className="text-slate-300">{t('Advance')}</span><span className="font-semibold text-rose-300">− {fmtMoney(m.advance)}</span></div>}
          {paid && <div className="flex justify-between"><span className="text-slate-300">{t('Paid')}</span><span className="font-semibold text-emerald-300">− {fmtMoney(m.paid)}</span></div>}
        </div>
        <div className="mt-1.5 pt-1.5 border-t border-white/10">
          <p className={`text-lg font-heading font-extrabold tabular-nums leading-none ${net < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{net < 0 ? `− ${fmtMoney(-net)}` : fmtMoney(net)}</p>
          <p className="text-[10px] text-slate-300/90 mt-0.5">{paid && net === 0 ? t('Salary paid ✓ {d}', { d: fmtDayIST(m.paid_at, { day: 'numeric', month: 'short' }) }) : t(net < 0 ? 'You owe office' : 'Net salary')}</p>
        </div>
      </>}
    </button>
  )
}

// ── Salary details (tap a month card) ─────────────────────────────────────────
function SalarySheet({ label, m, onClose }) {
  const month = new Date(`${m.month}T00:00:00Z`).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const paid = m.paid !== null && m.paid !== undefined
  const Row = ({ l, v, c = 'text-slate-900', sub }) => (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div><p className="text-[15px] text-slate-700">{l}</p>{sub && <p className="text-xs text-slate-400">{sub}</p>}</div>
      <p className={`text-[15px] font-bold tabular-nums whitespace-nowrap ${c}`}>{v}</p>
    </div>
  )
  const entries = m.entries || []
  const jobsTxt = (n) => (n === 1 ? t('1 job') : t('{n} jobs', { n }))
  return (
    <Sheet title={`${label} · ${month}`} onClose={onClose}>
      <div className="px-5 pt-2 pb-8">
        <div className="divide-y divide-slate-100">
          {m.repairs === undefined ? <Row l={t('Earned')} v={fmtMoney(m.earned)} sub={m.jobs === 1 ? t('1 job completed') : t('{n} jobs completed', { n: m.jobs })} /> : <>
            <Row l={t('Installations')} sub={jobsTxt(m.installs)} v={fmtMoney(m.install_earned)} />
            <Row l={t('Repairs')} sub={jobsTxt(m.repairs)} v={fmtMoney(m.repair_earned)} />
          </>}
          <Row l={t('Collected from customers')} sub={t('Cash / UPI you received')} v={`− ${fmtMoney(m.collected)}`} c="text-amber-600" />
          {m.petrol !== undefined && <Row l={t('Petrol allowance')} v={`+ ${fmtMoney(m.petrol)}`} c="text-sky-700" />}
          {m.advance !== undefined && <Row l={t('Salary advance')} v={`− ${fmtMoney(m.advance)}`} c="text-rose-600" />}
          <div className="flex items-center justify-between py-3">
            <p className="text-base font-bold text-slate-900">{t('Net salary')}</p>
            <p className={`text-2xl font-heading font-extrabold tabular-nums ${Number(m.net) < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{Number(m.net) < 0 ? `− ${fmtMoney(-m.net)}` : fmtMoney(m.net)}</p>
          </div>
          {paid && <Row l={t('Salary paid')} sub={fmtDayIST(m.paid_at, { day: 'numeric', month: 'short', year: 'numeric' })} v={`− ${fmtMoney(m.paid)}`} c="text-emerald-700" />}
          {paid && <Row l={t('Balance')} v={fmtMoney(m.balance)} c={Number(m.balance) === 0 ? 'text-emerald-700' : 'text-slate-900'} />}
        </div>
        {entries.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{t('Petrol allowance & advance')}</p>
            <div className="space-y-2">
              {entries.map((e, i) => (
                <div key={i} className={`flex items-center gap-3 rounded-2xl px-4 py-3 ${e.kind === 'PETROL' ? 'bg-sky-50' : 'bg-rose-50'}`}>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${e.kind === 'PETROL' ? 'text-sky-800' : 'text-rose-800'}`}>{t(e.kind === 'PETROL' ? 'Petrol allowance' : 'Salary advance')}</p>
                    <p className="text-xs text-slate-500 truncate">{fmtDate(e.date, { day: 'numeric', month: 'short', year: 'numeric' })}{e.note ? ` · ${e.note}` : ''}</p>
                  </div>
                  <p className={`text-base font-extrabold tabular-nums ${e.kind === 'PETROL' ? 'text-sky-700' : 'text-rose-600'}`}>{e.kind === 'PETROL' ? '+' : '−'} {fmtMoney(e.amount)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-slate-400 mt-4">{t(m.petrol !== undefined ? 'Net salary = Earned − Collected + Petrol − Advance. Questions? Call the office.' : 'Net salary = Earned − Collected. Questions? Call the office.')}</p>
      </div>
    </Sheet>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TechApp() {
  const { user, technician } = useAuth()
  const { toast } = useToast()
  useLang()   // re-render the whole app when the language changes
  useEffect(() => {   // jobs screen: only the job list scrolls, never the page (see return below)
    document.documentElement.classList.add('tech-lock')
    return () => document.documentElement.classList.remove('tech-lock')
  }, [])
  const qc = useQueryClient()
  const [tab, setTab] = useState('PENDING')
  const [openId, setOpenId] = useState(null)
  const [showAccount, setShowAccount] = useState(false)
  const [salaryOpen, setSalaryOpen] = useState(null)   // 'prev' | 'cur' → salary details sheet
  const [search, setSearch] = useState('')
  const [newIds, setNewIds] = useState(() => new Set())
  const knownIds = useRef(null)
  const liveRef = useRef(false)
  const [historyDays, setHistoryDays] = useState(HISTORY_SHORT)

  const jobsKey = `jobs:${technician?.id}:${historyDays}`
  const { data: serverJobs = [], isLoading, isFetching, isSuccess, refetch, error } = useQuery({
    queryKey: ['my-jobs', technician?.id, historyDays],
    enabled: !!technician,
    initialData: () => readCache(jobsKey),   // last loaded list → the app works without internet
    initialDataUpdatedAt: 0,
    // Live updates push changes instantly; the timer is only a safety net (faster if live updates are down)
    refetchInterval: () => (liveRef.current ? 5 * 60_000 : 60_000),
    refetchOnWindowFocus: true,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      // open jobs (any date) + jobs closed in the last few days
      const since = new Date(`${addDays(todayIST(), -(historyDays - 1))}T00:00:00+05:30`).toISOString()
      const run = (fields) => supabase.from('orders').select(fields)
        .eq('technician_id', technician.id).eq('is_deleted', false)
        .or(`status.not.in.(COMPLETED,REJECTED),closed_at.gte."${since}"`)
        .order('order_date', { ascending: true })
      let { data, error } = await run(JOB_FIELDS)
      // a newer column missing = database update not run yet → fall back to older field lists
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_V6))
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_V5))
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_V4))
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_V3))
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_V2))
      if (error?.code === '42703') ({ data, error } = await run(JOB_FIELDS_OLD))
      if (error) throw error
      writeCache(jobsKey, data)
      return data
    },
  })
  // updates waiting on the phone (no internet) are shown as already done
  const queue = useOfflineQueue()
  const myQueue = queue.filter((q) => q.techId === technician?.id)
  const jobs = useMemo(() => applyQueue(serverJobs, technician?.id), [serverJobs, queue, technician?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  const [sending, setSending] = useState(false)
  const offlineNow = !online || (error && isNetworkError(error))

  // Detect newly assigned jobs → highlight + vibrate
  useEffect(() => {
    if (!isSuccess) return // wait for the first real load, so existing jobs are not shown as "new"
    const ids = new Set(jobs.map((j) => j.id))
    if (knownIds.current) {
      const fresh = jobs.filter((j) => !knownIds.current.has(j.id) && isOpen(j))
      if (fresh.length) {
        setNewIds((prev) => new Set([...prev, ...fresh.map((j) => j.id)]))
        setTab('PENDING')
        // Ring only for jobs assigned just now (not for old jobs seen when the app is opened later)
        // The phone notification (web push) is the alert; here new jobs are just highlighted as NEW
      }
    }
    knownIds.current = ids
  }, [jobs, isSuccess, toast])

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['my-jobs'] }), [qc])
  const push = usePushAlerts(technician, user)
  useTechPresence(technician)   // office sees this technician as Online while the app is open
  const [iosHelp, setIosHelp] = useState(false)
  // A notification arriving while the app is open → refresh the list
  useEffect(() => {
    const onMsg = (e) => e.data?.type === 'NEW_JOBS' && refresh()
    navigator.serviceWorker?.addEventListener('message', onMsg)
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg)
  }, [refresh])
  const live = useOrdersRealtime({ enabled: !!technician, filter: technician ? `technician_id=eq.${technician.id}` : undefined, channelName: 'tech', onChange: refresh })
  liveRef.current = live

  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  const pending = jobs.filter(isOpen)

  // Salary: previous month + current month (Earned − Collected = Net), worked out on the server
  const { data: salary, error: salaryError } = useQuery({
    queryKey: ['my-salary', technician?.id], enabled: !!technician, staleTime: 30_000, retry: false,
    initialData: () => readCache(`salary:${technician?.id}`), initialDataUpdatedAt: 0,
    queryFn: async () => { const { data, error } = await supabase.rpc('tech_salary_summary'); if (error) throw error; writeCache(`salary:${technician?.id}`, data); return data },
  })
  const salaryMissing = !!salaryError && !isNetworkError(salaryError) && !salary

  // Send the waiting updates: when the internet comes back, when the app is opened, and every 20 s while some wait
  const sync = useCallback(async (manual = false) => {
    if (!technician) return
    if (navigator.onLine === false) { if (manual) toast(t('No internet'), 'error'); return }
    setSending(true)
    const r = await syncQueue({ techId: technician.id, techCode: technician.tech_code })
    setSending(false)
    r.failed.forEach((f) => toast(t('Could not update {o}: {e}', { o: f.orderId, e: f.error }), 'error'))
    if (r.sent) {
      if (!r.left) toast(t('All updates sent to office'), 'success')
      qc.invalidateQueries({ queryKey: ['my-jobs'] }); qc.invalidateQueries({ queryKey: ['my-salary'] }); qc.invalidateQueries({ queryKey: ['done-month'] })
    }
  }, [technician, toast, qc])
  useEffect(() => {
    const on = () => { setOnline(true); sync(); refresh() }
    const off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [sync, refresh])
  const waitingCount = myQueue.length
  // download both item lists while online, so "Mark Completed" works offline even the first time
  useEffect(() => {
    if (!technician || navigator.onLine === false) return
    ;['tech_install_items', 'tech_repair_items'].forEach((fn) => qc.prefetchQuery(itemsQuery(fn)))
  }, [technician, qc])
  useEffect(() => {
    if (!waitingCount) return
    sync()
    const id = setInterval(() => sync(), 20_000)
    return () => clearInterval(id)
  }, [waitingCount, sync])
  useEffect(() => { qc.invalidateQueries({ queryKey: ['my-salary'] }); qc.invalidateQueries({ queryKey: ['done-month'] }) }, [jobs, qc])   // job completed → totals update

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let l = jobs.filter((j) => (tab === 'PENDING' ? isOpen(j) : j.status === tab))
    if (tab !== 'PENDING') l = [...l].sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))
    else l = [...l].sort((a, b) => (newIds.has(b.id) - newIds.has(a.id)) || visitDate(a).localeCompare(visitDate(b)))
    if (q) l = l.filter((j) => (j.status === 'COMPLETED' ? [j.installed_item, j.service] : [j.customer_name, j.order_id, j.location, j.pin_code, j.phone_no]).some((v) => v?.toLowerCase().includes(q)))
    return l
  }, [jobs, tab, search, newIds])

  const open = jobs.find((j) => j.id === openId && j.status !== 'COMPLETED')   // completed jobs cannot be reopened
  const openJob = (id) => { setOpenId(id); setNewIds((p) => { const s = new Set(p); s.delete(id); return s }) }

  if (!technician) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 text-center">
        <div><p className="font-semibold text-slate-800">{t('Your login is not linked to a technician profile.')}</p><p className="text-sm text-slate-500 mt-1">{t('Please contact the office.')}</p></div>
      </div>
    )
  }

  const TABS = [['PENDING', t('Pending'), pending.length], ['COMPLETED', t('Done'), jobs.filter((j) => j.status === 'COMPLETED').length], ['REJECTED', t('Not done'), jobs.filter((j) => j.status === 'REJECTED').length]]

  const oldList = (<>
        {isLoading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 rounded-3xl bg-white animate-pulse" />)
          : list.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="w-16 h-16 mx-auto rounded-full bg-white flex items-center justify-center mb-3">{tab === 'PENDING' ? <CheckCircle2 size={30} className="text-emerald-500" /> : <Clock size={28} className="text-slate-300" />}</div>
              <p className="font-semibold text-slate-700">{search ? t('No matching jobs') : tab === 'PENDING' ? t('No pending jobs') : t('Nothing here in the last {n} days', { n: historyDays })}</p>
              {tab === 'PENDING' && !search && <p className="text-sm text-slate-500 mt-1">{t('New jobs appear here automatically when the office assigns them.')}</p>}
            </div>
          ) : list.map((j) => j.status === 'COMPLETED' ? <DoneCard key={j.id} job={j} /> : <JobCard key={j.id} job={j} isNew={newIds.has(j.id)} onOpen={() => openJob(j.id)} />)}
        {tab !== 'PENDING' && !isLoading && historyDays === HISTORY_SHORT && (
          <button onClick={() => setHistoryDays(HISTORY_LONG)} className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-300 text-sm font-semibold text-slate-600 active:bg-white">
            {t('Showing last {a} days · Show last {b} days', { a: HISTORY_SHORT, b: HISTORY_LONG })}
          </button>
        )}
  </>)

  return (
    // (html.tech-lock is set in the effect above)
    // Fixed-height app: the header never scrolls, only the job list below it scrolls.
    // iPhone (iOS 26) blurs/fades whatever page content scrolls under its status bar —
    // when the whole page scrolled, the header itself got that blur.
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#f1f3fa]">
      {/* one solid colour from the status bar down: iPhone darkens the top edge of the page, a gradient or glow there looked faded */}
      <header className="bg-[#0b1122] text-white relative flex-shrink-0 z-30 overflow-hidden shadow-[0_6px_16px_-12px_rgba(11,17,34,.5)]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="relative flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Logo size={42} className="flex-shrink-0" />
            <div className="min-w-0"><p className="text-[11px] text-slate-300 leading-none">HT Jobs</p><p className="font-bold leading-tight truncate">{user?.name}{technician?.tech_code && <span className="ml-1.5 text-[11px] font-mono font-semibold text-sky-300">{technician.tech_code}</span>}</p></div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <LangSwitch dark className="mr-1" />
            <span className={`mr-1 ${offlineNow ? 'text-amber-400' : live ? 'text-emerald-400' : 'text-slate-500'}`} title={offlineNow ? t('No internet') : t(live ? 'Live' : 'Reconnecting')}>{!offlineNow && live ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
            <button onClick={() => refetch()} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/10"><RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} /></button>
            <button onClick={() => setShowAccount(true)} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/10"><User size={20} /></button>
          </div>
        </div>
        {!salaryMissing && (
          <div className="relative grid grid-cols-2 gap-2 px-4 pb-3.5">
            {[['prev', 'Previous month'], ['cur', 'Current month']].map(([k, label]) => <SalaryCard key={k} label={t(label)} m={salary?.[k]} current={k === 'cur'} onOpen={() => setSalaryOpen(k)} />)}
          </div>
        )}
        <div className="relative flex bg-white text-slate-500 rounded-t-3xl">
          {TABS.map(([k, l, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-3.5 text-sm font-semibold border-b-[3px] transition-colors ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent'}`}>
              {l} <span className={`ml-0.5 text-xs px-1.5 rounded-full ${tab === k ? 'bg-brand-100' : 'bg-slate-100'}`}>{n}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="stagger flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
        {['ask', 'install-first', 'blocked'].includes(push.state) && (
          <div className="rounded-3xl bg-gradient-to-br from-brand-600 to-ink-900 text-white p-4 flex items-start gap-3 shadow-soft">
            <BellRing size={22} className="flex-shrink-0 mt-0.5 text-sky-300" />
            <div className="flex-1 min-w-0">
              <p className="font-bold">{t('Turn on job notifications')}</p>
              <p className="text-sm text-sky-100/90 mt-0.5">
                {t(push.state === 'ask' ? 'Get a phone notification every time the office assigns you a job, even when this app is closed.'
                  : push.state === 'install-first' ? 'On iPhone, add HT Jobs to your Home Screen first, then open it from there to turn on alerts.'
                  : 'Alerts are blocked. Allow notifications for HT Jobs in your phone Settings.')}
              </p>
              {push.state === 'ask' && <button onClick={push.enable} disabled={push.busy} className="mt-3 px-4 py-2.5 rounded-xl bg-white text-brand-700 font-bold text-sm active:scale-[.98]">{push.busy ? t('Turning on…') : t('Turn on notifications')}</button>}
              {push.state === 'install-first' && <button onClick={() => setIosHelp(true)} className="mt-3 px-4 py-2.5 rounded-xl bg-white text-brand-700 font-bold text-sm">{t('How to add to Home Screen')}</button>}
            </div>
          </div>
        )}
        {(jobs.length > 6 || tab === 'COMPLETED') && (
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="w-full rounded-2xl bg-white border border-slate-200 pl-11 pr-4 py-3 text-base outline-none focus:border-brand-500" placeholder={t(tab === 'COMPLETED' ? 'Search item, area, pincode…' : 'Search name, area, pincode…')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {offlineNow && <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm font-semibold text-amber-800 flex items-center gap-2"><CloudOff size={16} className="flex-shrink-0" /> {t('Offline · showing saved jobs')}</div>}
        {waitingCount > 0 && (
          <div className="rounded-2xl bg-sky-50 border border-sky-200 px-4 py-3 flex items-center gap-3">
            <UploadCloud size={20} className={`text-sky-700 flex-shrink-0 ${sending ? 'animate-pulse' : ''}`} />
            <p className="flex-1 text-sm font-semibold text-sky-900">{sending ? t('Sending saved updates…') : waitingCount === 1 ? t('1 update waiting to send') : t('{n} updates waiting to send', { n: waitingCount })}</p>
            <button onClick={() => sync(true)} disabled={sending} className="px-3 py-2 rounded-xl bg-sky-600 text-white text-xs font-bold active:scale-[.98] disabled:opacity-50">{t('Send now')}</button>
          </div>
        )}
        {error && !offlineNow && <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{errMsg(error)} <button onClick={() => refetch()} className="underline font-semibold ml-1">{t('Retry')}</button></div>}
        {tab === 'COMPLETED' && myQueue.some((q) => q.patch?.status === 'COMPLETED') && (
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wide text-sky-700 px-1 flex items-center gap-1"><UploadCloud size={13} /> {t('Waiting to send')}</p>
            {jobs.filter((j) => j._queued && j.status === 'COMPLETED').map((j) => <DoneCard key={j.id} job={j} />)}
          </div>
        )}
        {tab === 'COMPLETED' ? <DoneCalendar technicianId={technician?.id} search={search}>{oldList}</DoneCalendar> : oldList}
      </main>

      <WelcomeModal mobile greeting={t('Welcome,')} name={user?.name} badge={technician?.tech_code ? t('Technician ID · {c}', { c: technician.tech_code }) : t('Technician')}
        lines={[
          <><ClipboardList size={16} className="text-brand-600 flex-shrink-0" /> {isLoading ? t('Loading your jobs…') : pending.length ? (pending.length === 1 ? t('You have 1 pending job') : t('You have {n} pending jobs', { n: pending.length })) : t('No pending jobs right now')}</>,
          <><CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" /> {t('Mark each job Completed with the amount collected')}</>,
        ]} closeLabel={t('View my jobs')} />
      {open && <JobDetail job={open} onClose={() => setOpenId(null)} refresh={refresh} />}
      {showAccount && <AccountSheet onClose={() => setShowAccount(false)} />}
      {salaryOpen && salary?.[salaryOpen] && <SalarySheet label={t(salaryOpen === 'prev' ? 'Previous month' : 'Current month')} m={salary[salaryOpen]} onClose={() => setSalaryOpen(null)} />}
      {iosHelp && <IOSInstallSheet appName="HT Jobs" onClose={() => setIosHelp(false)} />}
    </div>
  )
}
