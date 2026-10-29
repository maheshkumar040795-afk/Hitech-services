import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Shield, Building2, Database, AlertCircle, Download, Loader2 } from 'lucide-react'
import { supabase, errMsg, fetchAll } from '../lib/supabase'
import { downloadXlsx } from '../lib/excel'
import { fmtDate, fmtDateTime, fmtDayIST, todayIST, STATUS, PAYMENT } from '../lib/format'
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

  // One Excel file with everything needed to rebuild the system (keep a copy every week)
  const [backingUp, setBackingUp] = useState(false)
  const fullBackup = async () => {
    setBackingUp(true)
    try {
      const all = (t, sel, order = 'created_at') => fetchAll(() => supabase.from(t).select(sel).order(order, { ascending: true }))
      const [orders, comments, techs, bills, users, company] = await Promise.all([
        all('orders', '*, technician:technicians(tech_code, name)'),
        all('comment_logs', 'comment, created_at, order:orders(order_id), user:profiles(name)'),
        all('technicians', '*'),
        all('bills', '*'),
        all('profiles', 'name, login, role, is_active, created_at'),
        supabase.from('app_settings').select('*').maybeSingle().then((r) => r.data),
      ])
      const yes = (b) => (b ? 'Yes' : 'No')
      downloadXlsx(`hitech-backup-${todayIST()}.xlsx`, [
        { name: 'Orders', rows: orders.map((o) => ({
          'Order ID': o.order_id, 'Order Date': fmtDate(o.order_date), 'Rescheduled To': o.rescheduled_date ? fmtDate(o.rescheduled_date) : '',
          'Customer Name': o.customer_name, 'Phone No': o.phone_no || '', Service: o.service || '', Brand: o.brand || '', Location: o.location || '',
          Address: o.address || '', 'Pin Code': o.pin_code || '', 'Google Location': o.location_url || '',
          'Technician ID': o.technician?.tech_code || '', Technician: o.technician?.name || '', Status: STATUS[o.status]?.label || o.status,
          'Completed / Closed On': o.closed_at ? fmtDateTime(o.closed_at, { dateStyle: 'medium', timeStyle: 'short' }) : '',
          Amount: Number(o.cod_amount || 0), Payment: PAYMENT[o.payment_mode] || '', 'Latest Comment': o.comments || '', Deleted: yes(o.is_deleted),
        })) },
        { name: 'Comments', rows: comments.map((c) => ({ 'Order ID': c.order?.order_id || '', Comment: c.comment, By: c.user?.name || '', 'Date/Time': fmtDateTime(c.created_at, { dateStyle: 'medium', timeStyle: 'short' }) })) },
        { name: 'Technicians', rows: techs.map((t) => ({
          'Technician ID': t.tech_code || '', Name: t.name, Mobile: t.mobile || '', Aadhaar: t.aadhar || '', City: t.city || '', District: t.district || '',
          Pincode: t.pincode || '', State: t.state || '', Active: yes(t.is_active), 'App Login': yes(t.user_id), 'Added On': fmtDayIST(t.created_at),
        })) },
        { name: 'Bills', rows: bills.map((b) => ({
          'Bill No': b.bill_number, Date: fmtDate(b.bill_date), Customer: b.customer_name, Address: b.address || '', Total: Number(b.total_amount || 0),
          Items: (b.items || []).map((i) => `${i.particulars || ''} × ${i.quantity ?? ''} @ ${i.rate ?? ''} = ${i.amount ?? ''}`).join(' | '),
        })) },
        { name: 'Users', rows: users.map((u) => ({ Name: u.name, Login: u.login, Role: u.role, Active: yes(u.is_active), 'Created On': fmtDayIST(u.created_at) })) },
        { name: 'Company', rows: company ? [{ Name: company.company_name, Address: company.company_address, Phone: company.company_phone || '', GSTIN: company.company_gstin || '' }] : [] },
      ])
      toast(`Backup downloaded · ${orders.length} orders, ${techs.length} technicians`, 'success')
    } catch (e) { toast(errMsg(e), 'error') } finally { setBackingUp(false) }
  }

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
      <div><h1 className="text-2xl font-heading font-extrabold text-slate-900">Settings</h1><p className="text-sm text-slate-500 mt-0.5">Your account and company details</p></div>

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
          <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-brand-50/60 border border-brand-100">
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-800">Weekly backup</p>
              <p className="text-xs text-slate-500 mt-0.5">The free plan has no automatic backups. Once a week, download this file and keep it in Google Drive. It has every order, comment, technician, bill and user.</p>
            </div>
            <button onClick={fullBackup} disabled={backingUp} className="btn-primary text-xs whitespace-nowrap">
              {backingUp ? <><Loader2 size={13} className="animate-spin" /> Preparing…</> : <><Download size={13} /> Download full backup</>}
            </button>
          </div>
        </Section>
      )}
    </div>
  )
}
