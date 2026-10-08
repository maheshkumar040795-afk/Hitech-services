import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, Eye, EyeOff, Download, Share } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { usePWA } from '../hooks/usePWA'

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
    <div className="min-h-[100dvh] flex flex-col bg-gradient-to-b from-[#0f1c2e] via-[#14304f] to-[#1a3a5c]" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex-1 flex flex-col justify-center px-6 py-10">
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-brand-500 flex items-center justify-center text-white font-black text-3xl shadow-xl shadow-brand-500/30">HT</div>
          <h1 className="text-white text-2xl font-bold mt-5">HT Jobs</h1>
          <p className="text-slate-300 text-sm mt-1">Hitech Services · Technician App</p>
        </div>

        <form onSubmit={submit} className="bg-white rounded-3xl p-6 shadow-2xl space-y-4 max-w-sm w-full mx-auto">
          {(error || authError) && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={16} className="flex-shrink-0 mt-0.5" /> {error || authError}</div>
          )}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Mobile number</label>
            <div className="flex items-center rounded-2xl border-2 border-slate-200 focus-within:border-brand-500 overflow-hidden">
              <span className="pl-4 pr-2 text-slate-500 font-semibold">+91</span>
              <input type="tel" inputMode="numeric" autoComplete="username" maxLength={10} placeholder="98XXXXXXXX"
                className="flex-1 py-3.5 pr-4 text-lg font-semibold tracking-wider outline-none bg-transparent"
                value={mobile} onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} required />
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">PIN</label>
            <div className="flex items-center rounded-2xl border-2 border-slate-200 focus-within:border-brand-500 overflow-hidden">
              <input type={show ? 'text' : 'password'} inputMode="numeric" autoComplete="current-password" placeholder="••••••"
                className="flex-1 py-3.5 px-4 text-lg font-semibold tracking-[0.3em] outline-none bg-transparent"
                value={pin} onChange={(e) => setPin(e.target.value.trim())} required />
              <button type="button" onClick={() => setShow((p) => !p)} className="px-4 text-slate-400">{show ? <EyeOff size={20} /> : <Eye size={20} />}</button>
            </div>
          </div>
          <button disabled={busy} className="w-full py-4 rounded-2xl bg-brand-600 active:bg-brand-700 text-white text-base font-bold shadow-lg shadow-brand-600/30 disabled:opacity-60">
            {busy ? 'Logging in…' : 'Login'}
          </button>
          <p className="text-xs text-slate-400 text-center">Forgot PIN? Call the office to reset it.</p>
        </form>

        {!isInstalled && (
          <div className="max-w-sm w-full mx-auto mt-5">
            {installPrompt ? (
              <button onClick={promptInstall} className="w-full py-3 rounded-2xl bg-white/10 text-white text-sm font-semibold flex items-center justify-center gap-2 border border-white/20">
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
      <Link to="/login" className="text-center text-xs text-slate-500 pb-6" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 1.5rem)' }}>Office login</Link>
    </div>
  )
}
