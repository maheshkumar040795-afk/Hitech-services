import { useEffect, useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import Logo from './Logo'

const KEY = 'ht_welcome'
/** Call right after a successful login: the next screen shows the welcome once */
export const markWelcome = () => { try { sessionStorage.setItem(KEY, '1') } catch { /* ignore */ } }

export function greetingIST() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
}

/** Shows once after login: greeting with the person's name, an X and a Close button */
export default function WelcomeModal({ name, badge, lines = [], closeLabel = 'Close', mobile = false }) {
  const [open, setOpen] = useState(() => { try { return sessionStorage.getItem(KEY) === '1' } catch { return false } })
  const close = () => { setOpen(false); try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open || !name) return null

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  return (
    <div className={`fixed inset-0 z-[250] bg-ink-950/55 backdrop-blur-md flex justify-center animate-fade-in ${mobile ? 'items-end sm:items-center' : 'items-center p-4'}`} onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={`Welcome ${name}`}
        className={`relative w-full max-w-sm bg-white overflow-hidden shadow-[0_40px_90px_-24px_rgba(11,17,34,.6)] ${mobile ? 'rounded-t-[28px] sm:rounded-[28px] animate-slide-up' : 'rounded-[28px] animate-scale-in'}`}
        style={mobile ? { paddingBottom: 'env(safe-area-inset-bottom)' } : undefined} onClick={(e) => e.stopPropagation()}>
        <div className="noise relative px-6 pt-7 pb-14 text-center overflow-hidden bg-gradient-to-br from-ink-900 via-ink-950 to-[#071433]">
          <div className="aurora-blob animate-aurora w-56 h-56 -top-20 -left-16 bg-brand-500/60" />
          <div className="aurora-blob animate-aurora-2 w-48 h-48 -top-10 -right-20 bg-sky-500/45" />
          <button onClick={close} aria-label="Close" className="absolute right-3 top-3 z-10 w-9 h-9 rounded-full flex items-center justify-center text-white/80 hover:text-white bg-white/10 hover:bg-white/20 transition"><X size={18} /></button>
          <p className="relative text-sky-300 text-[11px] font-bold uppercase tracking-[.2em] flex items-center justify-center gap-1.5"><Sparkles size={12} /> {greetingIST()}</p>
          <h2 className="relative text-white text-[28px] font-heading font-extrabold leading-tight mt-2">Welcome, <span className="text-gradient">{name}</span></h2>
          {badge && <span className="relative inline-block mt-3 px-3 py-1 rounded-full glass-dark text-xs font-semibold text-sky-200">{badge}</span>}
        </div>
        <div className="relative px-6 pb-6">
          <div className="-mt-9 mb-4 flex justify-center"><Logo size={72} className="ring-4 ring-white" /></div>
          <p className="text-center text-xs font-medium text-slate-400">{today}</p>
          {lines.length > 0 && (
            <div className="mt-4 space-y-2">
              {lines.map((l, i) => <div key={i} className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 text-sm text-slate-700">{l}</div>)}
            </div>
          )}
          <button onClick={close} className="btn-primary w-full justify-center py-3.5 mt-5 rounded-2xl text-[15px]">{closeLabel}</button>
        </div>
      </div>
    </div>
  )
}
