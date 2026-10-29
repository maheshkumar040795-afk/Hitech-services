import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Download, Share } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePWA } from '../hooks/usePWA'
import Logo from '../components/Logo'

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export default function TechLogin() {
  const { login, authError } = useAuth()
  const { installPrompt, isInstalled, promptInstall } = usePWA()
  const [mobile, setMobile] = useState(() => { try { return localStorage.getItem('ht_last_mobile') || '' } catch { return '' } })
  const [pin, setPin] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^[6-9]\d{9}$/.test(mobile)) return setError('Enter your 10-digit mobile number')
    setBusy(true)
    try {
      await login(mobile, pin)
      try { localStorage.setItem('ht_last_mobile', mobile) } catch { /* ignore */ }
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div className="noise relative min-h-[100dvh] flex flex-col overflow-hidden bg-gradient-to-b from-ink-900 via-ink-950 to-[#071433]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="aurora-blob animate-aurora w-80 h-80 -top-24 -left-24 bg-brand-500/60" />
      <div className="aurora-blob animate-aurora-2 w-72 h-72 top-1/3 -right-32 bg-sky-500/40" />
      <div className="aurora-blob animate-aurora w-56 h-56 bottom-0 left-10 bg-sky-400/20" />
      <div className="relative flex-1 flex flex-col justify-center px-6 py-10">
        <div className="text-center mb-8 animate-slide-up">
          <Logo size={112} className="mx-auto shadow-[0_20px_50px_-12px_rgba(26,163,240,.55)]" />
          <h1 className="text-gradient font-heading text-3xl font-extrabold mt-5 tracking-tight">HT Jobs</h1>
          <p className="text-slate-300/80 text-sm mt-1">Hitech Services · Technician App</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-[28px] p-6 shadow-[0_40px_80px_-24px_rgba(0,0,0,.6)] ring-1 ring-white/40 space-y-4 max-w-sm w-full mx-auto animate-scale-in" style={{ animationDelay: '.08s' }}>
          {(error || authError) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error || authError}</div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Mobile number</label>
            <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-slate-50/60 focus-within:bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 transition overflow-hidden">
              <span className="pl-4 pr-2 text-slate-500 font-semibold">+91</span>
              <input type="tel" inputMode="numeric" autoComplete="username" maxLength={10} placeholder="98XXXXXXXX"
                className="flex-1 min-w-0 py-3.5 pr-4 text-lg font-semibold tracking-wider outline-none bg-transparent"
                value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">PIN</label>
            <div className="flex items-center rounded-2xl border-2 border-slate-200 bg-slate-50/60 focus-within:bg-white focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 transition overflow-hidden">
              <input type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" placeholder="••••••"
                className="flex-1 min-w-0 py-3.5 px-4 text-lg font-semibold tracking-[0.3em] outline-none bg-transparent"
                value={pin} onChange={(e) => setPin(e.target.value.trim())} required />
              <button type="button" onClick={() => setShow((p) => !p)} className="px-4 text-slate-400">{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </div>
          </div>
          <button disabled={busy} className="btn-primary w-full justify-center py-4 rounded-2xl text-base font-bold">
            {busy ? 'Logging in…' : 'Login'}
          </button>
          <p className="text-xs text-slate-400 text-center">Forgot PIN? Call the office to reset it.</p>
        </form>

        {!isInstalled && (
          <div className="max-w-sm w-full mx-auto mt-5">
            {installPrompt ? (
              <button onClick={promptInstall} className="glass-dark w-full py-3 rounded-2xl text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-[.98] transition">
                <Download size={16} /> Install app on this phone
              </button>
            ) : isIOS() ? (
              <p className="text-slate-300 text-xs text-center flex items-center justify-center gap-1 flex-wrap">
                To install: tap <Share size={13} className="inline" /> Share → <b>Add to Home Screen</b>
              </p>
            ) : (
              <p className="text-slate-400 text-xs text-center">To install: Chrome menu ⋮ → <b>Add to Home screen</b></p>
            )}
          </div>
        )}
      </div>
      <Link to="/login" className="relative text-center text-xs text-slate-500 pb-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>Office login</Link>
    </div>
  )
}
