import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, Smartphone } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

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
    <div className="min-h-screen flex bg-[#0f1c2e]">
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 bg-gradient-to-br from-[#0f1c2e] to-[#1a3a5c] relative overflow-hidden">
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.15) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-500 flex items-center justify-center font-bold text-xl text-white shadow-lg shadow-brand-500/40">H</div>
          <span className="text-white font-semibold text-lg">Hitech Services</span>
        </div>
        <div className="relative space-y-6">
          <h1 className="text-4xl font-bold text-white leading-tight">Operations<br />Dashboard</h1>
          <p className="text-slate-400 text-base leading-relaxed max-w-sm">
            Upload daily installation orders, assign technicians, and watch jobs get completed live across Tamil Nadu.
          </p>
        </div>
        <p className="relative text-slate-600 text-xs">© {new Date().getFullYear()} Hitech Services</p>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 sm:p-8 bg-[#f0f4f8]">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center font-bold text-white">H</div>
            <span className="font-semibold text-slate-800">Hitech Services</span>
          </div>
          <div className="card p-8 shadow-xl">
            <h2 className="text-2xl font-bold text-slate-900">Office login</h2>
            <p className="text-slate-500 text-sm mt-1 mb-6">Admin and office staff</p>
            {shownError && (
              <div className="mb-4 flex items-center gap-2.5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
                <AlertCircle size={16} className="flex-shrink-0" /> {shownError}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input type="text" className="input" placeholder="you@htservice.in" autoComplete="username"
                  value={form.id} onChange={(e) => setForm((p) => ({ ...p, id: e.target.value }))} required autoFocus />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="••••••••" autoComplete="current-password"
                    value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required />
                  <button type="button" onClick={() => setShowPw((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <button type="submit" className="btn-primary w-full justify-center py-3 mt-2" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
          <Link to="/tech/login" className="mt-5 flex items-center justify-center gap-2 text-sm text-slate-500 hover:text-brand-600">
            <Smartphone size={14} /> Technician? Open the HT Jobs app
          </Link>
        </div>
      </div>
    </div>
  )
}
