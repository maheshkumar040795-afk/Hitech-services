import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Phone, MapPin, MessageCircle, ChevronRight, X, CheckCircle2, XCircle, Clock, RefreshCw, LogOut,
  User, Lock, Send, Search, RotateCcw, Pencil, KeyRound, Wifi, WifiOff, CalendarDays,
} from 'lucide-react'
import { supabase, rpc, errMsg } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useOrdersRealtime } from '../hooks/useRealtime'
import { addDays, todayIST, isTodayIST, fmtDate, fmtDateTime, fmtMoney, mapsUrl, telUrl, waUrl } from '../lib/format'

const REASONS = [
  'Customer not available',
  'Customer not answering phone',
  'Wrong / incomplete address',
  'Customer cancelled',
  'Product not delivered yet',
  'Parts / material needed',
  'Site not ready',
]
const JOB_FIELDS = 'id, order_id, order_date, customer_name, phone_no, service, brand, location, address, pin_code, status, comments, cod_amount, closed_at, assigned_at'

const isLocked = (j) => j.status !== 'PENDING' && !isTodayIST(j.closed_at)

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

// ── Complete / not-complete forms ─────────────────────────────────────────────
function CompleteSheet({ job, onClose, onDone }) {
  const { toast } = useToast()
  const [amount, setAmount] = useState(job.status === 'COMPLETED' ? String(Number(job.cod_amount)) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    const v = parseFloat(amount)
    if (amount === '' || isNaN(v) || v < 0) return toast('Enter the amount collected (0 if none)', 'error')
    setBusy(true)
    try {
      await rpc('tech_update_job', { p_order: job.id, p_status: 'COMPLETED', p_amount: v, p_note: note || null })
      navigator.vibrate?.(60)
      toast(`Job completed · ${fmtMoney(v)} collected`, 'success')
      onDone()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet title="Mark job completed" onClose={onClose}>
      <form onSubmit={submit} className="p-5 space-y-5">
        <div className="text-sm text-slate-600"><b className="text-slate-900">{job.customer_name}</b> · {job.service}</div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Amount collected from customer</label>
          <div className="flex items-center rounded-2xl border-2 border-slate-200 focus-within:border-emerald-500 overflow-hidden">
            <span className="pl-4 text-2xl font-bold text-slate-400">₹</span>
            <input autoFocus type="number" inputMode="decimal" min="0" step="0.01" placeholder="0"
              className="flex-1 py-4 px-3 text-3xl font-bold outline-none bg-transparent" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex gap-2 mt-2">
            <button type="button" onClick={() => setAmount('0')} className="px-3 py-1.5 rounded-full bg-slate-100 text-xs font-semibold text-slate-600 active:bg-slate-200">No payment (₹0)</button>
          </div>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-2">Note <span className="font-normal text-slate-400">(optional)</span></label>
          <textarea rows={2} className="w-full rounded-2xl border-2 border-slate-200 focus:border-emerald-500 outline-none p-3 text-base"
            placeholder="e.g. Installed with extra pipe 2 m" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <button disabled={busy} className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-lg font-bold flex items-center justify-center gap-2 disabled:opacity-60">
          <CheckCircle2 size={22} /> {busy ? 'Saving…' : 'Submit — Job Completed'}
        </button>
      </form>
    </Sheet>
  )
}

function NotDoneSheet({ job, onClose, onDone }) {
  const { toast } = useToast()
  const [reason, setReason] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const text = reason === 'Other' ? other.trim() : reason
  const submit = async () => {
    if (!text) return toast('Select or type a reason', 'error')
    setBusy(true)
    try {
      await rpc('tech_update_job', { p_order: job.id, p_status: 'REJECTED', p_amount: null, p_note: text })
      toast('Reported to office', 'success')
      onDone()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet title="Can't complete this job" onClose={onClose}>
      <div className="p-5 space-y-3">
        <p className="text-sm text-slate-500">Why? The office will see this reason.</p>
        <div className="space-y-2">
          {[...REASONS, 'Other'].map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={`w-full text-left px-4 py-3.5 rounded-2xl border-2 text-[15px] font-medium ${reason === r ? 'border-red-500 bg-red-50 text-red-700' : 'border-slate-200 text-slate-700 active:bg-slate-50'}`}>{r}</button>
          ))}
        </div>
        {reason === 'Other' && (
          <textarea autoFocus rows={2} className="w-full rounded-2xl border-2 border-slate-200 focus:border-red-500 outline-none p-3 text-base" placeholder="Type the reason" value={other} onChange={(e) => setOther(e.target.value)} />
        )}
        <button onClick={submit} disabled={busy || !text} className="w-full py-4 rounded-2xl bg-red-600 active:bg-red-700 text-white text-lg font-bold disabled:opacity-40">
          {busy ? 'Sending…' : 'Submit reason'}
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
    setBusy(true)
    const { error } = await supabase.from('comment_logs').insert({ order_id: job.id, user_id: user.id, comment: note.trim() })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setNote(''); qc.invalidateQueries({ queryKey: ['tech-notes', job.id] }); refresh()
  }
  const reopen = async () => {
    if (!confirm('Re-open this job as Pending?')) return
    try { await rpc('tech_update_job', { p_order: job.id, p_status: 'PENDING' }); toast('Job re-opened', 'success'); refresh() }
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
              <Phone size={22} /><span className="text-xs font-semibold">Call</span></a>
            <a href={mapsUrl(job)} target="_blank" rel="noreferrer" className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-emerald-50 text-emerald-700 active:bg-emerald-100">
              <MapPin size={22} /><span className="text-xs font-semibold">Map</span></a>
            <a href={wa || undefined} target="_blank" rel="noreferrer" className={`flex flex-col items-center gap-1 py-3 rounded-2xl ${wa ? 'bg-green-50 text-green-700 active:bg-green-100' : 'bg-slate-50 text-slate-300 pointer-events-none'}`}>
              <MessageCircle size={22} /><span className="text-xs font-semibold">WhatsApp</span></a>
          </div>

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {[
              ['Service', [job.service, job.brand].filter(Boolean).join(' · ') || '—'],
              ['Phone', job.phone_no || '—'],
              ['Address', [job.address, job.location].filter(Boolean).join(', ') || '—'],
              ['Pin code', job.pin_code || '—'],
              ['Order date', fmtDate(job.order_date, { day: 'numeric', month: 'short', year: 'numeric' })],
              ...(job.status !== 'PENDING' ? [['Closed', fmtDateTime(job.closed_at)]] : []),
              ...(job.status === 'COMPLETED' ? [['Amount collected', fmtMoney(job.cod_amount)]] : []),
            ].map(([l, v]) => (
              <div key={l} className="flex gap-3 px-4 py-3"><span className="text-xs text-slate-400 w-24 flex-shrink-0 pt-0.5">{l}</span><span className="text-[15px] text-slate-800 font-medium break-words">{v}</span></div>
            ))}
          </div>

          {job.status === 'PENDING' ? (
            <div className="space-y-2">
              <button onClick={() => setAction('complete')} className="w-full py-4 rounded-2xl bg-emerald-600 active:bg-emerald-700 text-white text-lg font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                <CheckCircle2 size={22} /> Mark Completed</button>
              <button onClick={() => setAction('notdone')} className="w-full py-3.5 rounded-2xl border-2 border-red-200 text-red-600 active:bg-red-50 text-base font-semibold flex items-center justify-center gap-2">
                <XCircle size={20} /> Can't Complete</button>
            </div>
          ) : locked ? (
            <div className="flex items-center gap-2 p-4 rounded-2xl bg-slate-50 text-sm text-slate-500"><Lock size={16} /> Closed on an earlier day. Call the office to change it.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {job.status === 'COMPLETED' && <button onClick={() => setAction('complete')} className="py-3 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50"><Pencil size={16} /> Edit amount</button>}
              <button onClick={reopen} className={`py-3 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50 ${job.status !== 'COMPLETED' ? 'col-span-2' : ''}`}><RotateCcw size={16} /> Re-open</button>
            </div>
          )}

          <div>
            <p className="text-sm font-bold text-slate-700 mb-2">Notes</p>
            <div className="flex gap-2 mb-3">
              <input className="flex-1 rounded-2xl border-2 border-slate-200 focus:border-brand-500 outline-none px-4 py-3 text-base" placeholder="Add a note for the office…"
                value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addNote()} />
              <button onClick={addNote} disabled={busy || !note.trim()} className="w-12 rounded-2xl bg-brand-600 text-white flex items-center justify-center disabled:opacity-40"><Send size={18} /></button>
            </div>
            <div className="space-y-2">
              {notes.map((n) => (
                <div key={n.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                  <p className="text-[15px] text-slate-800">{n.comment}</p>
                  <p className="text-[11px] text-slate-400 mt-1">{n.user?.role === 'TECHNICIAN' ? 'You' : `${n.user?.name || 'Office'} (office)`} · {fmtDateTime(n.created_at)}</p>
                </div>
              ))}
              {!notes.length && <p className="text-sm text-slate-400">No notes yet</p>}
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
    COMPLETED: ['Completed', 'bg-emerald-100 text-emerald-800', CheckCircle2],
    REJECTED: ['Not done', 'bg-red-100 text-red-700', XCircle],
  }[status]
  const Icon = m[2]
  return <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${m[1]}`}><Icon size={13} /> {m[0]}</span>
}

function JobCard({ job, onOpen, isNew }) {
  const tel = telUrl(job.phone_no)
  const overdue = job.status === 'PENDING' && job.order_date < todayIST()
  return (
    <div className={`bg-white rounded-3xl border shadow-sm overflow-hidden ${isNew ? 'border-brand-400 ring-2 ring-brand-200' : 'border-slate-200'}`}>
      <button onClick={onOpen} className="w-full text-left px-4 pt-4 pb-3 active:bg-slate-50">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            {isNew && <span className="px-2 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-bold">NEW</span>}
            {job.status === 'PENDING'
              ? <span className={`text-xs font-semibold ${overdue ? 'text-red-600' : 'text-slate-400'}`}><CalendarDays size={12} className="inline -mt-0.5" /> {fmtDate(job.order_date, { day: 'numeric', month: 'short' })}{overdue ? ' · overdue' : ''}</span>
              : <StatusPill status={job.status} />}
          </div>
          <span className="text-[10px] text-slate-400 font-mono truncate">{job.order_id}</span>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-bold text-slate-900 truncate">{job.customer_name}</p>
            <p className="text-sm text-slate-600 truncate">{[job.service, job.brand].filter(Boolean).join(' · ')}</p>
            <p className="text-sm text-slate-500 truncate mt-0.5"><MapPin size={12} className="inline -mt-0.5" /> {[job.location, job.pin_code].filter(Boolean).join(' · ') || '—'}</p>
            {job.status === 'COMPLETED' && <p className="text-sm font-bold text-emerald-700 mt-1">{fmtMoney(job.cod_amount)} collected</p>}
          </div>
          <ChevronRight size={20} className="text-slate-300 mt-2 flex-shrink-0" />
        </div>
      </button>
      {job.status === 'PENDING' && (
        <div className="grid grid-cols-2 border-t border-slate-100">
          <a href={tel || undefined} className={`py-3 flex items-center justify-center gap-2 text-sm font-semibold border-r border-slate-100 ${tel ? 'text-brand-700 active:bg-brand-50' : 'text-slate-300 pointer-events-none'}`}><Phone size={16} /> Call</a>
          <a href={mapsUrl(job)} target="_blank" rel="noreferrer" className="py-3 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700 active:bg-emerald-50"><MapPin size={16} /> Map</a>
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
    if (pin.length < 6) return toast('PIN must be at least 6 digits', 'error')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pin })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setPin(''); toast('PIN changed', 'success')
  }
  return (
    <Sheet title="My account" onClose={onClose}>
      <div className="p-5 space-y-5">
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 text-brand-700 font-bold text-xl flex items-center justify-center">{user?.name?.[0]}</div>
          <div><p className="font-bold text-slate-900 text-lg">{user?.name}</p><p className="text-sm text-slate-500">+91 {user?.login}{technician?.city ? ` · ${technician.city}` : ''}</p></div>
        </div>
        <form onSubmit={changePin} className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">Change PIN</label>
          <div className="flex gap-2">
            <input type="password" inputMode="numeric" placeholder="New PIN (6+ digits)" className="flex-1 rounded-2xl border-2 border-slate-200 focus:border-brand-500 outline-none px-4 py-3 text-base tracking-widest"
              value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
            <button disabled={busy} className="px-4 rounded-2xl bg-brand-600 text-white font-semibold disabled:opacity-50"><KeyRound size={18} /></button>
          </div>
        </form>
        <button onClick={logout} className="w-full py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50"><LogOut size={18} /> Logout</button>
      </div>
    </Sheet>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function TechApp() {
  const { user, technician } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [tab, setTab] = useState('PENDING')
  const [openId, setOpenId] = useState(null)
  const [showAccount, setShowAccount] = useState(false)
  const [search, setSearch] = useState('')
  const [newIds, setNewIds] = useState(() => new Set())
  const knownIds = useRef(null)

  const { data: jobs = [], isLoading, isFetching, isSuccess, refetch, error } = useQuery({
    queryKey: ['my-jobs', technician?.id],
    enabled: !!technician,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const since = addDays(todayIST(), -30)
      const { data, error } = await supabase.from('orders').select(JOB_FIELDS)
        .eq('technician_id', technician.id).eq('is_deleted', false)
        .or(`status.eq.PENDING,order_date.gte.${since}`)
        .order('order_date', { ascending: true })
      if (error) throw error
      return data
    },
  })

  // Detect newly assigned jobs → highlight + vibrate
  useEffect(() => {
    if (!isSuccess) return // wait for the first real load, so existing jobs are not shown as "new"
    const ids = new Set(jobs.map((j) => j.id))
    if (knownIds.current) {
      const fresh = jobs.filter((j) => !knownIds.current.has(j.id) && j.status === 'PENDING')
      if (fresh.length) {
        setNewIds((prev) => new Set([...prev, ...fresh.map((j) => j.id)]))
        navigator.vibrate?.([200, 100, 200])
        toast(fresh.length === 1 ? `New job: ${fresh[0].customer_name}, ${fresh[0].location || ''}` : `${fresh.length} new jobs assigned`, 'info', 6000)
        setTab('PENDING')
      }
    }
    knownIds.current = ids
  }, [jobs, isSuccess, toast])

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['my-jobs'] }), [qc])
  const live = useOrdersRealtime({ enabled: !!technician, filter: technician ? `technician_id=eq.${technician.id}` : undefined, channelName: 'tech', onChange: refresh })

  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [refresh])

  const pending = jobs.filter((j) => j.status === 'PENDING')
  const doneToday = jobs.filter((j) => j.status === 'COMPLETED' && isTodayIST(j.closed_at))
  const collectedToday = doneToday.reduce((s, j) => s + Number(j.cod_amount || 0), 0)

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    let l = jobs.filter((j) => j.status === tab)
    if (tab !== 'PENDING') l = [...l].sort((a, b) => String(b.closed_at).localeCompare(String(a.closed_at)))
    else l = [...l].sort((a, b) => (newIds.has(b.id) - newIds.has(a.id)) || a.order_date.localeCompare(b.order_date))
    if (q) l = l.filter((j) => [j.customer_name, j.order_id, j.location, j.pin_code, j.phone_no].some((v) => v?.toLowerCase().includes(q)))
    return l
  }, [jobs, tab, search, newIds])

  const open = jobs.find((j) => j.id === openId)
  const openJob = (id) => { setOpenId(id); setNewIds((p) => { const s = new Set(p); s.delete(id); return s }) }

  if (!technician) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-6 text-center">
        <div><p className="font-semibold text-slate-800">Your login is not linked to a technician profile.</p><p className="text-sm text-slate-500 mt-1">Please contact the office.</p></div>
      </div>
    )
  }

  const TABS = [['PENDING', 'Pending', pending.length], ['COMPLETED', 'Done', jobs.filter((j) => j.status === 'COMPLETED').length], ['REJECTED', 'Not done', jobs.filter((j) => j.status === 'REJECTED').length]]

  return (
    <div className="min-h-[100dvh] bg-[#eef2f7]">
      <header className="bg-[#0f1c2e] text-white sticky top-0 z-30" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center font-black text-sm">HT</div>
            <div><p className="text-[11px] text-slate-400 leading-none">HT Jobs</p><p className="font-bold leading-tight">{user?.name}</p></div>
          </div>
          <div className="flex items-center gap-1">
            <span className={`mr-1 ${live ? 'text-emerald-400' : 'text-slate-500'}`} title={live ? 'Live' : 'Reconnecting'}>{live ? <Wifi size={16} /> : <WifiOff size={16} />}</span>
            <button onClick={() => refetch()} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/10"><RefreshCw size={18} className={isFetching ? 'animate-spin' : ''} /></button>
            <button onClick={() => setShowAccount(true)} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-white/10"><User size={20} /></button>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 px-4 pb-3">
          {[['Pending', pending.length, 'text-amber-300'], ['Done today', doneToday.length, 'text-emerald-300'], ['Collected today', fmtMoney(collectedToday), 'text-white']].map(([l, v, c]) => (
            <div key={l} className="bg-white/10 rounded-2xl px-3 py-2"><p className={`text-lg font-bold ${c}`}>{v}</p><p className="text-[10px] text-slate-300">{l}</p></div>
          ))}
        </div>
        <div className="flex bg-white text-slate-500">
          {TABS.map(([k, l, n]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-3 text-sm font-semibold border-b-[3px] ${tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent'}`}>
              {l} <span className={`ml-0.5 text-xs px-1.5 rounded-full ${tab === k ? 'bg-brand-100' : 'bg-slate-100'}`}>{n}</span>
            </button>
          ))}
        </div>
      </header>

      <main className="p-3 space-y-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>
        {jobs.length > 6 && (
          <div className="relative">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="w-full rounded-2xl bg-white border border-slate-200 pl-11 pr-4 py-3 text-base outline-none focus:border-brand-500" placeholder="Search name, area, pincode…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        )}
        {error && <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{errMsg(error)} <button onClick={() => refetch()} className="underline font-semibold ml-1">Retry</button></div>}
        {isLoading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-36 rounded-3xl bg-white animate-pulse" />)
          : list.length === 0 ? (
            <div className="text-center py-16 px-6">
              <div className="w-16 h-16 mx-auto rounded-full bg-white flex items-center justify-center mb-3">{tab === 'PENDING' ? <CheckCircle2 size={30} className="text-emerald-500" /> : <Clock size={28} className="text-slate-300" />}</div>
              <p className="font-semibold text-slate-700">{search ? 'No matching jobs' : tab === 'PENDING' ? 'No pending jobs' : 'Nothing here in the last 30 days'}</p>
              {tab === 'PENDING' && !search && <p className="text-sm text-slate-500 mt-1">New jobs appear here automatically when the office assigns them.</p>}
            </div>
          ) : list.map((j) => <JobCard key={j.id} job={j} isNew={newIds.has(j.id)} onOpen={() => openJob(j.id)} />)}
      </main>

      {open && <JobDetail job={open} onClose={() => setOpenId(null)} refresh={refresh} />}
      {showAccount && <AccountSheet onClose={() => setShowAccount(false)} />}
    </div>
  )
}
