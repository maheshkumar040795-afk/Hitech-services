import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Plus, Search, MapPin, Phone, X, Upload, Download, Smartphone, KeyRound, Ban, Pencil, Copy, MessageCircle, Power, ClipboardList } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase, rpc, errMsg, adminAction } from '../lib/supabase'
import { fmtMoney, todayIST, waUrl } from '../lib/format'
import { downloadXlsx, readSheetRows } from '../lib/excel'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useTechnicians, useTechStats } from '../hooks/useData'
import Modal, { Field } from '../components/Modal'

const EMPTY = { name: '', mobile: '', city: '', district: '', pincode: '', aadhar: '' }
const loginState = (t) => (!t.user_id ? 'off' : t.login?.is_active ? 'on' : 'disabled')
const appUrl = () => `${window.location.origin}${window.location.pathname}#/tech`

function TechForm({ tech, onClose, onSaved }) {
  const { toast } = useToast()
  const [f, setF] = useState(tech ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, tech[k] || ''])) } : EMPTY)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const save = async (e) => {
    e.preventDefault()
    const row = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || null]))
    if (row.mobile) row.mobile = row.mobile.replace(/\D/g, '').slice(-10)
    if (row.mobile && !/^[6-9]\d{9}$/.test(row.mobile)) return toast('Mobile must be a valid 10-digit number', 'error')
    setBusy(true)
    const { error } = tech
      ? await supabase.from('technicians').update(row).eq('id', tech.id)
      : await supabase.from('technicians').insert(row)
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast(tech ? 'Technician updated' : 'Technician added', 'success')
    if (tech?.user_id && tech.mobile !== row.mobile) toast('Mobile changed — use "Reset PIN" so the new number works for app login', 'info', 7000)
    onSaved(); onClose()
  }
  return (
    <Modal title={tech ? 'Edit technician' : 'Add technician'} onClose={onClose}>
      <form onSubmit={save} className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Field label="Name *"><input className="input" value={f.name} onChange={set('name')} required /></Field></div>
        <Field label="Mobile (app login)" hint="10 digits, used to log in"><input className="input" inputMode="numeric" value={f.mobile} onChange={set('mobile')} /></Field>
        <Field label="Aadhaar"><input className="input" value={f.aadhar} onChange={set('aadhar')} /></Field>
        <Field label="City / Area"><input className="input" value={f.city} onChange={set('city')} /></Field>
        <Field label="District"><input className="input" value={f.district} onChange={set('district')} /></Field>
        <Field label="Pincode"><input className="input" inputMode="numeric" value={f.pincode} onChange={set('pincode')} /></Field>
        <div className="col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button disabled={busy} className="btn-primary text-xs">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  )
}

function LoginModal({ tech, onClose, onSaved }) {
  const { toast } = useToast()
  const [pin, setPin] = useState(() => String(Math.floor(100000 + Math.random() * 900000)))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const message = `Hitech Services – HT Jobs app\n\n1. Open this link in Chrome: ${appUrl()}\n2. Tap "Install" / "Add to Home screen"\n3. Login\n   Mobile: ${tech.mobile}\n   PIN: ${pin}\n\nYour assigned jobs will appear there. Mark each job Completed with the amount collected.`
  const save = async (e) => {
    e.preventDefault()
    if (pin.length < 6) return toast('PIN must be at least 6 characters', 'error')
    setBusy(true)
    try { await adminAction('set_tech_login', { technician_id: tech.id, password: pin }); setDone(true); onSaved() }
    catch (err) { toast(err.message, 'error') } finally { setBusy(false) }
  }
  return (
    <Modal title={tech.user_id ? 'Reset app PIN' : 'Enable app login'} subtitle={tech.name} onClose={onClose}>
      {!tech.mobile ? <p className="text-sm text-red-600">Add a 10-digit mobile number to this technician first (Edit).</p> : !done ? (
        <form onSubmit={save} className="space-y-4">
          <Field label="Login mobile"><input className="input bg-slate-50" value={tech.mobile} disabled /></Field>
          <Field label="PIN / password" hint="6–8 digits (easy to type on the phone keypad).">
            <div className="flex gap-2">
              <input className="input font-mono tracking-widest" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} />
              <button type="button" className="btn-secondary text-xs" onClick={() => setPin(String(Math.floor(100000 + Math.random() * 900000)))}>New</button>
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            <button disabled={busy} className="btn-primary text-xs"><KeyRound size={13} /> {busy ? 'Saving…' : 'Save login'}</button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">Login ready. Send these details to {tech.name}:</div>
          <pre className="text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 whitespace-pre-wrap font-sans">{message}</pre>
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary text-xs" onClick={() => { navigator.clipboard?.writeText(message); toast('Copied', 'success') }}><Copy size={13} /> Copy</button>
            <a className="btn-primary text-xs bg-emerald-600 hover:bg-emerald-700" href={waUrl(tech.mobile, message)} target="_blank" rel="noreferrer"><MessageCircle size={13} /> Send on WhatsApp</a>
          </div>
        </div>
      )}
    </Modal>
  )
}

function TechProfile({ tech, stat, onClose, onEdit, onLogin, refresh }) {
  const { isAdmin } = useAuth()
  const { toast } = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const { data: monthly } = useQuery({ queryKey: ['tech-stats', 'monthly', tech.id], queryFn: () => rpc('technician_monthly', { p_tech: tech.id }) })
  const ls = loginState(tech)

  const setLoginActive = async (active) => {
    setBusy(true)
    try { await adminAction('set_active', { user_id: tech.user_id, active }); toast(active ? 'App login enabled' : 'App login disabled', 'success'); refresh() }
    catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const setTechActive = async (active) => {
    if (!active && !confirm(`Deactivate ${tech.name}? They will be hidden from assignment and their app login will be disabled.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('technicians').update({ is_active: active }).eq('id', tech.id)
      if (error) throw error
      if (!active && ls === 'on') await adminAction('set_active', { user_id: tech.user_id, active: false })
      toast(active ? 'Technician activated' : 'Technician deactivated', 'success'); refresh()
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const rate = stat?.total > 0 ? Math.round((stat.completed / stat.total) * 100) : 0
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose}>
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl z-50 flex flex-col overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 border-b border-slate-100 flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold text-xl flex-shrink-0">{tech.name[0]}</div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-slate-900">{tech.name}</h2>
            {tech.mobile && <p className="text-sm text-slate-500 flex items-center gap-1 mt-0.5"><Phone size={12} /> {tech.mobile}</p>}
            {(tech.city || tech.district) && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><MapPin size={11} /> {[tech.city, tech.district, tech.pincode].filter(Boolean).join(', ')}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        <div className="p-6 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5"><Smartphone size={13} /> HT Jobs app login</p>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${ls === 'on' ? 'bg-emerald-100 text-emerald-700' : ls === 'disabled' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
              {ls === 'on' ? 'Active' : ls === 'disabled' ? 'Disabled' : 'Not set up'}
            </span>
          </div>
          {isAdmin ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={onLogin} disabled={busy || !tech.is_active} className="btn-primary text-xs"><KeyRound size={13} /> {ls === 'off' ? 'Enable app login' : 'Reset PIN & share'}</button>
              {ls === 'on' && <button onClick={() => setLoginActive(false)} disabled={busy} className="btn-danger text-xs"><Ban size={13} /> Disable login</button>}
              {ls === 'disabled' && tech.is_active && <button onClick={() => setLoginActive(true)} disabled={busy} className="btn-secondary text-xs">Re-enable login</button>}
            </div>
          ) : <p className="text-xs text-slate-400">Only an admin can set up app logins.</p>}
          {ls !== 'off' && <p className="text-[11px] text-slate-400">Logs in at <b>{appUrl()}</b> with mobile <b>{tech.mobile}</b></p>}
        </div>

        <div className="p-6 border-b border-slate-100">
          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">All-time performance</p>
          <div className="grid grid-cols-4 gap-2">
            {[['Total', stat?.total, 'bg-slate-100 text-slate-700'], ['Done', stat?.completed, 'bg-emerald-100 text-emerald-700'],
              ['Pending', stat?.pending, 'bg-amber-100 text-amber-700'], ['Rate', `${rate}%`, 'bg-brand-100 text-brand-700']].map(([l, v, c]) => (
              <div key={l} className={`rounded-xl p-3 text-center ${c}`}><div className="text-lg font-bold">{v ?? 0}</div><div className="text-[10px] font-semibold uppercase opacity-70">{l}</div></div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">Collected: <b>{fmtMoney(stat?.amount)}</b> · Today: <b>{stat?.done_today ?? 0}</b> done, <b>{fmtMoney(stat?.amount_today)}</b></p>
          {monthly?.length > 0 && (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={monthly} barSize={10}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                  <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pending" name="Pending" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="rejected" name="Rejected" fill="#ef4444" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="p-6 flex flex-wrap gap-2">
          <button onClick={() => navigate(`/orders?tech=${tech.id}`)} className="btn-secondary text-xs"><ClipboardList size={13} /> View jobs</button>
          <button onClick={onEdit} className="btn-secondary text-xs"><Pencil size={13} /> Edit details</button>
          {isAdmin && (tech.is_active
            ? <button onClick={() => setTechActive(false)} disabled={busy} className="btn-danger text-xs"><Power size={13} /> Deactivate</button>
            : <button onClick={() => setTechActive(true)} disabled={busy} className="btn-secondary text-xs"><Power size={13} /> Activate</button>)}
        </div>
      </div>
    </div>
  )
}

export default function TechniciansPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isAdmin } = useAuth()
  const fileRef = useRef(null)
  const { data: techs = [], isLoading } = useTechnicians()
  const { data: stats = {} } = useTechStats()
  const [search, setSearch] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [profileId, setProfileId] = useState(null)
  const [form, setForm] = useState(null) // null | 'new' | tech
  const [loginFor, setLoginFor] = useState(null)
  const [busy, setBusy] = useState(false)

  const refresh = () => { qc.invalidateQueries({ queryKey: ['technicians'] }); qc.invalidateQueries({ queryKey: ['tech-stats'] }) }
  const q = search.toLowerCase()
  const list = techs.filter((t) => (showInactive || t.is_active) &&
    (!q || t.name.toLowerCase().includes(q) || t.city?.toLowerCase().includes(q) || t.mobile?.includes(q)))
  const profileTech = techs.find((t) => t.id === profileId)

  const importFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const rows = await readSheetRows(file)
      let added = 0, skipped = 0
      for (const r of rows) {
        const get = (k) => String(r[k] ?? r[k.toLowerCase()] ?? '').trim()
        const name = get('NAME'); if (!name) continue
        const mobile = get('MOBILE').replace(/\D/g, '').slice(-10) || null
        const { error } = await supabase.from('technicians').insert({
          name, mobile: mobile && /^[6-9]\d{9}$/.test(mobile) ? mobile : null,
          city: get('CITY') || null, district: get('DISTRICT') || null, pincode: get('PINCODE') || null, state: get('STATE') || 'Tamil Nadu',
        })
        error ? skipped++ : added++
      }
      toast(`Import done: ${added} added, ${skipped} skipped (already exist or invalid)`, 'success'); refresh()
    } catch (err) { toast(errMsg(err), 'error') } finally { setBusy(false) }
  }

  const exportAll = () => downloadXlsx(`technicians-${todayIST()}.xlsx`, [{ name: 'Technicians', rows: techs.map((t) => {
    const s = stats[t.id] || {}
    return { Name: t.name, Mobile: t.mobile || '', City: t.city || '', District: t.district || '', Pincode: t.pincode || '',
      Status: t.is_active ? 'Active' : 'Inactive', 'App Login': { on: 'Active', off: 'Not set up', disabled: 'Disabled' }[loginState(t)],
      'Total Orders': Number(s.total || 0), Completed: Number(s.completed || 0), Pending: Number(s.pending || 0), Rejected: Number(s.rejected || 0),
      'Amount Collected': Number(s.amount || 0) }
  }) }])

  return (
    <div className="space-y-4">
      {profileTech && <TechProfile tech={profileTech} stat={stats[profileTech.id]} onClose={() => setProfileId(null)}
        onEdit={() => setForm(profileTech)} onLogin={() => setLoginFor(profileTech)} refresh={refresh} />}
      {form && <TechForm tech={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={refresh} />}
      {loginFor && <LoginModal tech={techs.find((t) => t.id === loginFor.id) || loginFor} onClose={() => setLoginFor(null)} onSaved={refresh} />}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={importFile} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Technicians</h1>
          <p className="text-sm text-slate-500 mt-0.5">{techs.filter((t) => t.is_active).length} active · {techs.filter((t) => loginState(t) === 'on').length} using the app</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadXlsx('technicians-template.xlsx', [{ name: 'Technicians', rows: [{ NAME: 'Abinesh', MOBILE: '9841100001', CITY: 'Kanchipuram', DISTRICT: 'Kanchipuram', PINCODE: '631502', STATE: 'Tamil Nadu' }] }])} className="btn-secondary text-xs"><Download size={13} /> Template</button>
          <button onClick={() => fileRef.current?.click()} disabled={busy} className="btn-secondary text-xs"><Upload size={13} /> {busy ? 'Importing…' : 'Import'}</button>
          {isAdmin && <button onClick={exportAll} className="btn-secondary text-xs"><Download size={13} /> Export</button>}
          <button onClick={() => setForm('new')} className="btn-primary text-xs"><Plus size={13} /> Add Technician</button>
        </div>
      </div>

      <div className="flex gap-3 items-center flex-wrap">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 py-2" placeholder="Search name, city or mobile…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card p-5 h-36 animate-pulse bg-slate-50" />)}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {list.map((t) => {
            const s = stats[t.id] || {}
            const ls = loginState(t)
            const rate = s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0
            return (
              <div key={t.id} onClick={() => setProfileId(t.id)} className={`card p-5 cursor-pointer hover:shadow-md transition-all ${!t.is_active ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center text-brand-700 font-bold flex-shrink-0">{t.name[0]}</div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-900 truncate">{t.name}</p>
                      <p className="text-xs text-slate-400 flex items-center gap-1">{t.mobile ? <><Phone size={10} />{t.mobile}</> : <span className="text-amber-600">No mobile</span>}</p>
                    </div>
                  </div>
                  <span title="HT Jobs app login" className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 flex-shrink-0 ${ls === 'on' ? 'bg-emerald-100 text-emerald-700' : ls === 'disabled' ? 'bg-red-100 text-red-600' : 'bg-slate-100 text-slate-500'}`}>
                    <Smartphone size={10} /> {ls === 'on' ? 'App' : ls === 'disabled' ? 'Blocked' : 'No app'}
                  </span>
                </div>
                {t.city && <p className="text-xs text-slate-400 flex items-center gap-1 mb-3"><MapPin size={10} />{[t.city, t.district].filter(Boolean).join(', ')}</p>}
                <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                  {[['Pending', s.pending, 'text-amber-600'], ['Done', s.completed, 'text-emerald-600'], ['Today', s.done_today, 'text-brand-600'], ['Total', s.total, 'text-slate-600']].map(([l, v, c]) => (
                    <div key={l} className="bg-slate-50 rounded-lg p-2"><div className={`text-sm font-bold ${c}`}>{v || 0}</div><div className="text-[9px] text-slate-400 uppercase">{l}</div></div>
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-slate-400 mb-1"><span>Completion</span><span className="font-semibold">{rate}%</span></div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${rate}%`, background: rate >= 80 ? '#10b981' : rate >= 50 ? '#f59e0b' : '#ef4444' }} />
                </div>
              </div>
            )
          })}
          {list.length === 0 && <div className="col-span-full card p-12 text-center text-slate-400 text-sm">No technicians found</div>}
        </div>
      )}
    </div>
  )
}
