import { BellRing, MapPin, X, Volume2 } from 'lucide-react'

/** Full-screen alert the moment the office assigns jobs (sound + vibration are started by the caller) */
export default function NewJobsAlert({ jobs, onView, onClose, soundBlocked, onPlay }) {
  const n = jobs.length
  return (
    <div className="fixed inset-0 z-[260] bg-ink-950/70 backdrop-blur-md flex items-center justify-center p-5 animate-fade-in" role="alertdialog" aria-label={`${n} new jobs assigned`}>
      <div className="relative w-full max-w-sm bg-white rounded-[28px] overflow-hidden shadow-[0_40px_90px_-20px_rgba(0,0,0,.6)] animate-scale-in">
        <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 w-10 h-10 rounded-full flex items-center justify-center text-white/80 bg-white/10 active:bg-white/20"><X size={20} /></button>
        <div className="noise relative px-6 pt-8 pb-7 text-center overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-ink-900">
          <div className="aurora-blob animate-aurora w-56 h-56 -top-20 -left-16 bg-sky-400/50" />
          <div className="relative mx-auto w-20 h-20 rounded-full bg-white/15 flex items-center justify-center ring-8 ring-white/10 animate-pulse">
            <BellRing size={40} className="text-white" />
          </div>
          <p className="relative text-white text-[26px] font-heading font-extrabold leading-tight mt-4">{n} new job{n > 1 ? 's' : ''} assigned to you</p>
          <p className="relative text-sky-100/90 text-sm mt-1">Assigned just now by the office</p>
        </div>
        <ul className="px-5 pt-4 space-y-2 max-h-56 overflow-y-auto">
          {jobs.slice(0, 6).map((j) => (
            <li key={j.id} className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
              <p className="font-bold text-slate-900 truncate">{j.customer_name}</p>
              <p className="text-sm text-slate-500 truncate"><MapPin size={12} className="inline -mt-0.5" /> {[j.location, j.pin_code].filter(Boolean).join(' · ') || j.service || '—'}</p>
            </li>
          ))}
          {n > 6 && <li className="text-center text-xs text-slate-400">+{n - 6} more</li>}
        </ul>
        <div className="p-5 space-y-2">
          {soundBlocked && <button onClick={onPlay} className="w-full py-3 rounded-2xl border-2 border-brand-200 text-brand-700 font-bold flex items-center justify-center gap-2 active:bg-brand-50"><Volume2 size={18} /> Play alert sound</button>}
          <button onClick={onView} className="btn-primary w-full justify-center py-4 rounded-2xl text-base font-bold">View my jobs</button>
        </div>
      </div>
    </div>
  )
}
