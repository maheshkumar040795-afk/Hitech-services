import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, CheckCircle2, Wrench, Hammer, Banknote, MapPin, IndianRupee, CalendarDays, Loader2 } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { fmtMoney, fmtDate, fmtDayIST, todayIST } from '../lib/format'
import { photoThumb } from '../lib/photos'

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const monthStart = (d) => d.slice(0, 8) + '01'
const shiftMonth = (m, n) => { const d = new Date(`${m}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }
const monthEnd = (m) => { const d = new Date(`${shiftMonth(m, 1)}T00:00:00Z`); d.setUTCDate(0); return d.toISOString().slice(0, 10) }
const time = (ts) => new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/**
 * HT Jobs → Done: month calendar. Tap a day (or "Whole month") to see the completed jobs with
 * installed / repaired item, earned (Rate Config), cash collected, location and pin code.
 * children = the old Done list, shown if the server is not updated yet (tech_done_jobs missing).
 */
export default function DoneCalendar({ technicianId, search = '', children }) {
  const today = todayIST()
  const [month, setMonth] = useState(monthStart(today))
  const [day, setDay] = useState(null)   // null = whole month
  const end = monthEnd(month) < today ? monthEnd(month) : today

  const { data: jobs = [], isLoading, error } = useQuery({
    queryKey: ['done-month', technicianId, month],
    enabled: !!technicianId,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('tech_done_jobs', { p_from: month, p_to: end })
      if (error) throw error
      return data || []
    },
  })
  const missing = error && /tech_done_jobs|schema cache|Could not find the function/i.test(error.message || '')

  const byDay = useMemo(() => {
    const m = new Map()
    for (const j of jobs) { const d = m.get(j.closed_on) || { n: 0, earned: 0 }; d.n += 1; d.earned += Number(j.earned); m.set(j.closed_on, d) }
    return m
  }, [jobs])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return jobs.filter((j) => (!day || j.closed_on === day) &&
      (!q || [j.installed_item, j.service, j.location, j.pin_code, j.order_id, j.customer_name].some((v) => v?.toLowerCase().includes(q))))
  }, [jobs, day, search])
  const tot = shown.reduce((s, j) => ({ earned: s.earned + Number(j.earned), collected: s.collected + Number(j.collected) }), { earned: 0, collected: 0 })

  if (missing) return children

  // calendar cells: blanks before the 1st (weeks start Monday), then the days
  const first = new Date(`${month}T00:00:00Z`)
  const blanks = (first.getUTCDay() + 6) % 7
  const days = Number(monthEnd(month).slice(8, 10))
  const cells = [...Array(blanks).fill(null), ...Array.from({ length: days }, (_, i) => `${month.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)]
  const go = (n) => { setMonth(shiftMonth(month, n)); setDay(null) }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-3xl border border-slate-200/70 shadow-soft p-3">
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => go(-1)} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-slate-100" aria-label="Previous month"><ChevronLeft size={20} /></button>
          <button onClick={() => setDay(null)} className="text-base font-heading font-bold text-slate-900 flex items-center gap-1.5">
            <CalendarDays size={17} className="text-brand-600" /> {fmtDate(month, { month: 'long', year: 'numeric' })}
          </button>
          <button onClick={() => go(1)} disabled={shiftMonth(month, 1) > today} className="w-10 h-10 rounded-full flex items-center justify-center active:bg-slate-100 disabled:opacity-25" aria-label="Next month"><ChevronRight size={20} /></button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEK.map((w) => <div key={w} className="text-[10px] font-bold uppercase text-slate-400 py-1">{w}</div>)}
          {cells.map((d, i) => {
            if (!d) return <div key={`b${i}`} />
            const info = byDay.get(d), sel = day === d, future = d > today
            return (
              <button key={d} disabled={future} onClick={() => setDay(sel ? null : d)}
                className={`relative aspect-square rounded-xl flex flex-col items-center justify-center text-sm font-semibold transition
                  ${sel ? 'bg-brand-600 text-white shadow-glow' : info ? 'bg-emerald-50 text-emerald-800 active:bg-emerald-100' : 'text-slate-600 active:bg-slate-100'}
                  ${d === today && !sel ? 'ring-2 ring-brand-400' : ''} ${future ? 'opacity-30' : ''}`}>
                {Number(d.slice(8))}
                {info && <span className={`text-[9px] font-bold leading-none mt-0.5 ${sel ? 'text-white/90' : 'text-emerald-600'}`}>{info.n} job{info.n > 1 ? 's' : ''}</span>}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={() => setDay(null)} className={`flex-1 py-2 rounded-xl text-sm font-bold ${!day ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Whole month</button>
          <button onClick={() => { setMonth(monthStart(today)); setDay(today) }} className={`flex-1 py-2 rounded-xl text-sm font-bold ${day === today ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Today</button>
        </div>
      </div>

      <div className="rounded-3xl bg-gradient-to-br from-ink-900 to-[#0b1f4d] text-white p-4 shadow-soft">
        <p className="text-xs font-semibold text-slate-300 uppercase tracking-wide">{day ? fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' }) : fmtDate(month, { month: 'long', year: 'numeric' })}</p>
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div><p className="text-2xl font-heading font-extrabold tabular-nums">{shown.length}</p><p className="text-[11px] text-slate-300">{shown.length === 1 ? 'job' : 'jobs'} done</p></div>
          <div><p className="text-2xl font-heading font-extrabold tabular-nums text-emerald-300">{fmtMoney(tot.earned)}</p><p className="text-[11px] text-slate-300">earned</p></div>
          <div><p className="text-2xl font-heading font-extrabold tabular-nums text-amber-300">{fmtMoney(tot.collected)}</p><p className="text-[11px] text-slate-300">cash collected</p></div>
        </div>
      </div>

      {error && !missing && <div className="rounded-2xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">{errMsg(error)}</div>}
      {isLoading ? <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        : shown.length === 0 ? (
          <div className="text-center py-10 px-6"><CheckCircle2 size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="font-semibold text-slate-700">{search ? 'No matching jobs' : day ? 'No jobs completed on this day' : 'No jobs completed this month'}</p></div>
        ) : shown.map((j) => <DoneJob key={j.id} j={j} showDate={!day} />)}
    </div>
  )
}

function DoneJob({ j, showDate }) {
  const repair = j.job_type === 'REPAIR'
  const amazon = j.payment_mode === 'AMAZON'
  return (
    <div className="bg-white rounded-3xl border border-slate-200/70 shadow-soft px-4 py-3.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700 min-w-0">
          <CheckCircle2 size={16} className="flex-shrink-0" /> <span className="font-mono text-xs text-slate-500 truncate">{j.order_id}</span>
          {repair && <span className="px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[9px] font-bold flex items-center gap-0.5"><Hammer size={9} /> REPAIR</span>}
        </span>
        <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">{showDate ? fmtDayIST(j.closed_at, { day: 'numeric', month: 'short' }) + ' · ' : ''}{time(j.closed_at)}</span>
      </div>
      <div className="flex items-start gap-2 text-[15px] text-slate-800"><Wrench size={15} className="text-slate-400 mt-1 flex-shrink-0" />
        <div className="min-w-0"><p className="font-semibold">{j.installed_item || j.service || '—'}</p>{j.customer_name && <p className="text-xs text-slate-500">{j.customer_name}</p>}</div></div>
      <div className="flex items-start gap-2 text-sm text-slate-700"><MapPin size={15} className="text-slate-400 mt-0.5 flex-shrink-0" />
        <span>{j.location || '—'}{j.pin_code && <b className="ml-1.5 font-mono text-slate-900">{j.pin_code}</b>}{j.region && <span className="ml-1.5 text-[10px] font-bold uppercase text-slate-400">{j.region === 'OUTSIDE' ? 'Outside Chennai' : 'Chennai'}</span>}</span></div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        <div className="rounded-2xl bg-emerald-50 px-3 py-2"><p className="text-[10px] font-bold uppercase text-emerald-700/80 flex items-center gap-1"><IndianRupee size={10} /> Earned</p><p className="text-lg font-heading font-extrabold text-emerald-700 tabular-nums">{fmtMoney(j.earned)}</p></div>
        <div className={`rounded-2xl px-3 py-2 ${amazon ? 'bg-violet-50' : 'bg-amber-50'}`}><p className={`text-[10px] font-bold uppercase flex items-center gap-1 ${amazon ? 'text-violet-700/80' : 'text-amber-700/80'}`}><Banknote size={10} /> {amazon ? 'Paid on Amazon' : 'Cash collected'}</p>
          <p className={`text-lg font-heading font-extrabold tabular-nums ${amazon ? 'text-violet-700' : 'text-amber-700'}`}>{amazon ? '₹0' : fmtMoney(j.collected)}</p></div>
      </div>
      {j.photos?.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pt-0.5">
          {j.photos.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="w-12 h-12 flex-shrink-0 rounded-lg overflow-hidden bg-slate-100"><img src={photoThumb(u)} alt="" loading="lazy" className="w-full h-full object-cover" /></a>)}
        </div>
      )}
    </div>
  )
}
