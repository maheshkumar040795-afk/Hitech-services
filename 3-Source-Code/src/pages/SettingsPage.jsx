import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Shield, Building2, Database, AlertCircle } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAppSettings } from '../hooks/useData'

function Section({ title, icon: Icon, children }) {
  return (
    <div className="card p-6">
      <div className="flex items-center gap-2 mb-5 pb-4 border-b border-slate-100">
        <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center"><Icon size={14} className="text-brand-600" /></div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      {children}
    </div>
  )
}

export default function SettingsPage() {
  const { user, session, isAdmin } = useAuth()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [show, setShow] = useState(false)
  const [pwErr, setPwErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: settings } = useAppSettings()
  const [co, setCo] = useState(null)
  useEffect(() => { if (settings && !co) setCo(settings) }, [settings, co])

  const { data: counts } = useQuery({
    queryKey: ['db-counts'],
    enabled: isAdmin,
    queryFn: async () => {
      const c = async (t, f) => { let q = supabase.from(t).select('id', { count: 'exact', head: true }); if (f) q = f(q); const { count } = await q; return count || 0 }
      const [orders, technicians, users, audit, bills] = await Promise.all([
        c('orders', (q) => q.eq('is_deleted', false)), c('technicians', (q) => q.eq('is_active', true)), c('profiles', (q) => q.eq('is_active', true)), c('audit_logs'), c('bills'),
      ])
      return { orders, technicians, users, audit, bills }
    },
  })

  const changePassword = async (e) => {
    e.preventDefault(); setPwErr('')
    if (pw.next !== pw.confirm) return setPwErr('New passwords do not match')
    if (pw.next.length < 6) return setPwErr('Password must be at least 6 characters')
    setBusy(true)
    // confirm the current password first
    const { error: e1 } = await supabase.auth.signInWithPassword({ email: session.user.email, password: pw.current })
    if (e1) { setBusy(false); return setPwErr('Current password is incorrect') }
    const { error } = await supabase.auth.updateUser({ password: pw.next })
    setBusy(false)
    if (error) return setPwErr(errMsg(error))
    setPw({ current: '', next: '', confirm: '' }); toast('Password updated', 'success')
  }

  const saveCompany = async (e) => {
    e.preventDefault(); setBusy(true)
    const { error } = await supabase.from('app_settings').update({
      company_name: co.company_name.trim(), company_address: co.company_address.trim(),
      company_phone: co.company_phone?.trim() || null, company_gstin: co.company_gstin?.trim() || null, updated_at: new Date().toISOString(),
    }).eq('id', 1)
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    qc.invalidateQueries({ queryKey: ['app-settings'] }); toast('Company details saved', 'success')
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div><h1 className="text-xl font-bold text-slate-900">Settings</h1><p className="text-sm text-slate-500 mt-0.5">Your account and company details</p></div>

      <div className="card p-5 flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-brand-600 flex items-center justify-center text-white font-bold text-xl">{user?.name?.[0]?.toUpperCase()}</div>
        <div><p className="font-bold text-slate-900">{user?.name}</p><p className="text-sm text-slate-500">{user?.login}</p>
          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-100 text-brand-700">{user?.role === 'ADMIN' ? 'Admin' : 'Office Staff'}</span></div>
      </div>

      <Section title="Change my password" icon={Shield}>
        <form onSubmit={changePassword} className="space-y-4 max-w-sm">
          {pwErr && <div className="flex items-center gap-2 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm"><AlertCircle size={14} /> {pwErr}</div>}
          {[['current', 'Current password'], ['next', 'New password'], ['confirm', 'Confirm new password']].map(([k, l]) => (
            <div key={k}><label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">{l}</label>
              <div className="relative"><input type={show ? 'text' : 'password'} className="input pr-10" value={pw[k]} onChange={(e) => setPw((p) => ({ ...p, [k]: e.target.value }))} required />
                <button type="button" onClick={() => setShow((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button></div></div>
          ))}
          <button className="btn-primary" disabled={busy}>Update password</button>
        </form>
      </Section>

      {isAdmin && co && (
        <Section title="Company details (printed on bills)" icon={Building2}>
          <form onSubmit={saveCompany} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Company name</label><input className="input" value={co.company_name} onChange={(e) => setCo((p) => ({ ...p, company_name: e.target.value }))} required /></div>
            <div className="sm:col-span-2"><label className="block text-xs font-medium text-slate-600 mb-1">Address</label><input className="input" value={co.company_address} onChange={(e) => setCo((p) => ({ ...p, company_address: e.target.value }))} required /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">Phone</label><input className="input" value={co.company_phone || ''} onChange={(e) => setCo((p) => ({ ...p, company_phone: e.target.value }))} /></div>
            <div><label className="block text-xs font-medium text-slate-600 mb-1">GSTIN</label><input className="input" value={co.company_gstin || ''} onChange={(e) => setCo((p) => ({ ...p, company_gstin: e.target.value }))} /></div>
            <div><button className="btn-primary" disabled={busy}>Save company details</button></div>
          </form>
        </Section>
      )}

      {isAdmin && counts && (
        <Section title="Data overview" icon={Database}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[['Orders', counts.orders], ['Technicians', counts.technicians], ['Logins', counts.users], ['Bills', counts.bills], ['Audit rows', counts.audit]].map(([l, v]) => (
              <div key={l} className="text-center p-3 bg-slate-50 rounded-xl border border-slate-200"><p className="text-lg font-bold text-slate-900">{v.toLocaleString('en-IN')}</p><p className="text-[10px] text-slate-400">{l}</p></div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-4">Free plan has no automatic backups. Once a week, export all orders from <b>Reports</b> (wide date range → Export Excel) and keep the file safe. Check database size in Supabase → Project → Usage.</p>
        </Section>
      )}
    </div>
  )
}
