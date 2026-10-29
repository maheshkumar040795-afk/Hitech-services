import { useState } from 'react'
import { X, KeyRound, CheckCircle2, MessageCircle, Phone, AlertCircle, Loader2 } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { waUrl, telUrl } from '../lib/format'

/** "Forgot PIN?" — sends a reset request to the office (works the same on Android and iPhone) */
export default function ForgotPinSheet({ initialMobile = '', onClose }) {
  const [mobile, setMobile] = useState(initialMobile)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null) // { office_phone }

  const send = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError('Enter your 10-digit mobile number')
    setBusy(true)
    try { setDone((await rpc('request_pin_reset', { p_mobile: mobile })) || {}) }
    catch (err) {
      const m = err?.message || ''
      setError(m.includes('Failed to fetch') ? 'No internet connection. Please try again.'
        : m.includes('request_pin_reset') ? 'This feature is not switched on yet. Please call the office.' : m)
    } finally { setBusy(false) }
  }

  const office = done?.office_phone
  const msg = `Hi, I am a Hitech Services technician. I forgot my HT Jobs PIN. My mobile: ${mobile}. Please send me a new PIN.`

  return (
    <div className="fixed inset-0 z-[300] bg-ink-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white rounded-t-[28px] sm:rounded-[28px] p-6 shadow-2xl animate-slide-up"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.75rem)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-white" style={{ background: 'var(--grad-brand)' }}><KeyRound size={20} /></div>
          <div className="flex-1"><p className="font-heading font-extrabold text-lg text-slate-900 leading-tight">Forgot PIN?</p><p className="text-xs text-slate-500">The office will send you a new PIN</p></div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full text-slate-400 active:bg-slate-100"><X size={20} /></button>
        </div>

        {!done ? (
          <form onSubmit={send} className="space-y-4">
            {error && <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error}</div>}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Your registered mobile number</label>
              <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-slate-50/60 focus-within:bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 transition overflow-hidden">
                <span className="pl-4 pr-2 text-slate-500 font-semibold">+91</span>
                <input type="tel" inputMode="numeric" maxLength={10} placeholder="98XXXXXXXX" autoFocus
                  className="flex-1 min-w-0 py-3.5 pr-4 text-lg font-semibold tracking-wider outline-none bg-transparent"
                  value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} />
              </div>
            </div>
            <button disabled={busy} className="btn-primary w-full justify-center py-4 rounded-2xl text-base font-bold">
              {busy ? <><Loader2 size={18} className="animate-spin" /> Sending…</> : 'Send request to office'}
            </button>
          </form>
        ) : (
          <div className="space-y-4 text-center">
            <CheckCircle2 size={52} className="mx-auto text-emerald-500" />
            <div>
              <p className="font-heading font-bold text-slate-900 text-lg">Request sent</p>
              <p className="text-sm text-slate-500 mt-1">If <b>{mobile}</b> is registered, the office will send your new PIN on WhatsApp. Then log in with the new PIN.</p>
            </div>
            {office && (
              <div className="grid grid-cols-2 gap-2 pt-1">
                <a href={waUrl(office, msg)} target="_blank" rel="noreferrer" className="py-3.5 rounded-2xl bg-emerald-600 text-white font-semibold flex items-center justify-center gap-2 active:scale-[.98]"><MessageCircle size={18} /> WhatsApp</a>
                <a href={telUrl(office)} className="py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold flex items-center justify-center gap-2 active:bg-slate-50"><Phone size={18} /> Call office</a>
              </div>
            )}
            <button onClick={onClose} className="w-full py-3 text-sm font-semibold text-brand-700">Back to login</button>
          </div>
        )}
      </div>
    </div>
  )
}
