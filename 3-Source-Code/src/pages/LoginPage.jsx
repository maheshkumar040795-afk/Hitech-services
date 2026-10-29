import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, Smartphone, Mail, Lock, ArrowRight, Loader2, ShieldCheck, Zap, Users2, BarChart3 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import Logo from '../components/Logo'

export default function LoginPage() {
  const { login, authError } = useAuth()
  const [form, setForm] = useState({ id: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try { await login(form.id, form.password) } // routing redirects by role
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }
  const shownError = error || authError

  return (
    <div className="min-h-screen flex bg-ink-950">
      <div className="noise hidden lg:flex flex-col justify-between w-[52%] p-12 relative overflow-hidden bg-gradient-to-br from-ink-900 via-ink-950 to-[#071433]">
        <div className="aurora-blob animate-aurora w-[520px] h-[520px] -top-40 -left-32 bg-brand-500/60" />
        <div className="aurora-blob animate-aurora-2 w-[440px] h-[440px] top-1/3 -right-40 bg-sky-500/40" />
        <div className="aurora-blob animate-aurora w-[300px] h-[300px] -bottom-24 left-1/4 bg-sky-400/20" />
        <div className="absolute inset-0 opacity-[.07]"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)', backgroundSize: '44px 44px',
                   maskImage: 'radial-gradient(ellipse at 30% 40%, #000 30%, transparent 75%)', WebkitMaskImage: 'radial-gradient(ellipse at 30% 40%, #000 30%, transparent 75%)' }} />
        <div className="relative flex items-center gap-3 animate-slide-up">
          <Logo size={56} />
          <div>
            <span className="block text-white font-heading font-bold text-lg leading-tight">Hitech Services</span>
            <span className="block text-sky-300/90 text-[10px] font-semibold uppercase tracking-[.2em]">Operations Suite</span>
          </div>
        </div>
        <div className="relative space-y-7">
          <h1 className="font-heading text-[clamp(2.6rem,4.2vw,4.25rem)] font-extrabold leading-[1.02] tracking-tight">
            <span className="block text-white animate-slide-up" style={{ animationDelay: '.08s' }}>Every install,</span>
            <span className="block text-gradient animate-slide-up" style={{ animationDelay: '.16s' }}>tracked live.</span>
          </h1>
          <p className="text-slate-300/80 text-base leading-relaxed max-w-md animate-slide-up" style={{ animationDelay: '.24s' }}>
            Upload daily installation orders, assign technicians, and watch jobs get completed live across Tamil Nadu.
          </p>
          <div className="flex flex-wrap gap-2.5 animate-slide-up" style={{ animationDelay: '.32s' }}>
            {[[Zap, 'Real-time updates'], [Users2, 'Technician app'], [BarChart3, 'Reports & billing']].map(([I, t]) => (
              <span key={t} className="glass-dark inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-xs font-medium text-slate-200"><I size={13} className="text-sky-300" /> {t}</span>
            ))}
          </div>
        </div>
        <p className="relative text-slate-500 text-xs">© {new Date().getFullYear()} Hitech Services · Chennai</p>
      </div>

      <div className="relative flex-1 flex items-center justify-center p-6 sm:p-10 bg-[radial-gradient(900px_500px_at_80%_-10%,rgba(71,99,245,.14),transparent_60%),radial-gradient(700px_400px_at_0%_110%,rgba(26,163,240,.10),transparent_60%)] bg-[#f3f5fb]">
        <div className="w-full max-w-md animate-scale-in">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <Logo size={48} />
            <span className="font-heading font-bold text-slate-800 text-lg">Hitech Services</span>
          </div>
          <div className="relative bg-white/85 backdrop-blur-xl rounded-[28px] border border-white p-8 sm:p-9 shadow-[0_40px_90px_-30px_rgba(30,41,90,.35)]">
            <div className="absolute -inset-px rounded-[28px] pointer-events-none" style={{ background: 'linear-gradient(140deg, rgba(71,99,245,.35), transparent 35%, transparent 65%, rgba(26,163,240,.45))', WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)', WebkitMaskComposite: 'xor', maskComposite: 'exclude', padding: 1 }} />
            <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-600/15 px-2.5 py-1 text-[11px] font-semibold mb-4"><ShieldCheck size={12} /> Secure office access</div>
            <h2 className="text-[28px] font-heading font-extrabold text-slate-900 leading-tight">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1 mb-7">Sign in to the operations dashboard</p>
            {shownError && (
              <div className="mb-5 flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm animate-scale-in">
                <AlertCircle size={16} className="flex-shrink-0" /> {shownError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
                <div className="relative">
                  <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input type="text" className="input pl-10 py-3" placeholder="you@htservice.in" autoComplete="username"
                    value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} required autoFocus />
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input type={showPw ? 'text' : 'password'} className="input pl-10 pr-11 py-3" placeholder="••••••••" autoComplete="current-password"
                    value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required />
                  <button type="button" onClick={() => setShowPw((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3.5 mt-3 text-[15px] group" disabled={loading}>
                {loading ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></>}
              </button>
            </form>
          </div>
          <Link to="/tech/login" className="mt-6 flex items-center justify-center gap-2 text-sm font-medium text-slate-500 hover:text-brand-700 transition-colors">
            <Smartphone size={14} /> Technician? Open the HT Jobs app
          </Link>
        </div>
      </div>
    </div>
  )
}
