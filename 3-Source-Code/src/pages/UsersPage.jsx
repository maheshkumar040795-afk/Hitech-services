import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Eye, EyeOff, KeyRound, Smartphone } from 'lucide-react'
import { supabase, adminAction } from '../lib/supabase'
import { fmtDate } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import Modal, { Field } from '../components/Modal'

const ROLE_STYLE = { ADMIN: 'bg-purple-50 text-purple-700', STAFF: 'bg-blue-50 text-blue-700', TECHNICIAN: 'bg-emerald-50 text-emerald-700' }
const ROLE_LABEL = { ADMIN: 'Admin', STAFF: 'Office Staff', TECHNICIAN: 'Technician' }

export default function UsersPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user: me } = useAuth()
  const [tab, setTab] = useState('office')
  const [showCreate, setShowCreate] = useState(false)
  const [pwFor, setPwFor] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF' })
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('*').order('role').order('name')
      if (error) throw error
      return data
    },
  })
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['technicians'] }) }
  const run = async (fn, ok) => {
    setBusy(true)
    try { await fn(); toast(ok, 'success'); refresh(); return true } catch (e) { toast(e.message, 'error'); return false } finally { setBusy(false) }
  }

  const create = async (e) => {
    e.preventDefault()
    if (await run(() => adminAction('create_staff', form), `${form.name} can now log in`)) {
      setShowCreate(false); setForm({ name: '', email: '', password: '', role: 'STAFF' })
    }
  }
  const resetPw = async (e) => {
    e.preventDefault()
    if (await run(() => adminAction('set_password', { user_id: pwFor.id, password: pw }), 'Password changed')) { setPwFor(null); setPw('') }
  }

  const list = users.filter((u) => (tab === 'office' ? u.role !== 'TECHNICIAN' : u.role === 'TECHNICIAN'))

  return (
    <div className="space-y-4">
      {showCreate && (
        <Modal title="Add office user" subtitle="For admins and office staff. Technician logins are set up from the Technicians page." onClose={() => setShowCreate(false)}>
          <form onSubmit={create} className="space-y-4">
            <Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required /></Field>
            <Field label="Email (login)"><input type="email" className="input" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} required /></Field>
            <Field label="Password">
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} className="input pr-10" placeholder="Min 6 characters" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} required minLength={6} />
                <button type="button" onClick={() => setShowPw((p) => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">{showPw ? <EyeOff size={14} /> : <Eye size={14} />}</button>
              </div>
            </Field>
            <Field label="Role" hint="Office Staff: orders, upload, assign, technicians, billing. Admin: also reports, audit log, users, settings.">
              <select className="input" value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
                <option value="STAFF">Office Staff</option><option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setShowCreate(false)} className="btn-secondary text-xs">Cancel</button>
              <button disabled={busy} className="btn-primary text-xs">{busy ? 'Creating…' : 'Create user'}</button></div>
          </form>
        </Modal>
      )}
      {pwFor && (
        <Modal title="Change password" subtitle={pwFor.name} onClose={() => setPwFor(null)}>
          <form onSubmit={resetPw} className="space-y-4">
            <Field label={pwFor.role === 'TECHNICIAN' ? 'New PIN / password' : 'New password'}><input className="input font-mono" value={pw} onChange={(e) => setPw(e.target.value)} required minLength={6} placeholder="Min 6 characters" /></Field>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setPwFor(null)} className="btn-secondary text-xs">Cancel</button>
              <button disabled={busy} className="btn-primary text-xs">Save</button></div>
          </form>
        </Modal>
      )}

      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Users</h1><p className="text-sm text-slate-500 mt-0.5">Everyone who can log in</p></div>
        <button onClick={() => setShowCreate(true)} className="btn-primary text-xs"><Plus size={13} /> Add Office User</button>
      </div>

      <div className="flex gap-1">
        {[['office', 'Office (web)'], ['tech', 'Technicians (app)']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${tab === k ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>
            {l} ({users.filter((u) => (k === 'office' ? u.role !== 'TECHNICIAN' : u.role === 'TECHNICIAN')).length})
          </button>
        ))}
      </div>
      {tab === 'tech' && <p className="text-xs text-slate-500 flex items-center gap-1.5"><Smartphone size={12} /> To add a technician login, go to Technicians → open the technician → Enable app login.</p>}

      <div className="card p-0 overflow-hidden"><div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">{['Name', 'Login', 'Role', 'Status', 'Since', 'Actions'].map((h) => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide">{h}</th>)}</tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
              : list.map((u) => (
                <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50/80">
                  <td className="px-4 py-3"><div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full bg-brand-100 flex items-center justify-center text-xs font-bold text-brand-700">{u.name[0]?.toUpperCase()}</div>
                    <span className="text-sm font-semibold text-slate-800">{u.name}{u.id === me.id && <span className="text-xs text-slate-400 font-normal"> (you)</span>}</span></div></td>
                  <td className="px-4 py-3 text-xs text-slate-600 font-mono">{u.login}</td>
                  <td className="px-4 py-3">
                    {u.role === 'TECHNICIAN' || u.id === me.id
                      ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${ROLE_STYLE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                      : <select disabled={busy} value={u.role} className={`text-[11px] font-semibold px-2 py-1 rounded-lg border-0 ${ROLE_STYLE[u.role]}`}
                          onChange={(e) => run(() => adminAction('update_staff', { user_id: u.id, role: e.target.value }), 'Role updated')}>
                          <option value="STAFF">Office Staff</option><option value="ADMIN">Admin</option></select>}
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{u.is_active ? 'Active' : 'Disabled'}</span></td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDate(u.created_at?.slice(0, 10))}</td>
                  <td className="px-4 py-3"><div className="flex gap-2">
                    <button onClick={() => { setPwFor(u); setPw('') }} className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"><KeyRound size={11} /> Password</button>
                    {u.id !== me.id && <button disabled={busy} onClick={() => run(() => adminAction('set_active', { user_id: u.id, active: !u.is_active }), u.is_active ? 'Login disabled' : 'Login enabled')}
                      className={`text-[11px] px-2.5 py-1 rounded-lg border ${u.is_active ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{u.is_active ? 'Disable' : 'Enable'}</button>}
                  </div></td>
                </tr>))}
            {!isLoading && !list.length && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">No users</td></tr>}
          </tbody>
        </table>
      </div></div>
    </div>
  )
}
