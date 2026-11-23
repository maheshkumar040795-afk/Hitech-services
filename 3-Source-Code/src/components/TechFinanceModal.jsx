import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Fuel, HandCoins, Plus, Trash2, ChevronLeft, ChevronRight, AlertTriangle, Loader2 } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtMoney, todayIST } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import Modal, { Field } from './Modal'
import { usePasswordConfirm } from './PasswordConfirm'

export const FINANCE = {
  PETROL:  { label: 'Petrol allowance', short: 'Petrol', sign: '+', icon: Fuel, chip: 'bg-sky-50 text-sky-700 ring-sky-600/20', text: 'text-sky-700' },
  ADVANCE: { label: 'Salary advance', short: 'Advance', sign: '−', icon: HandCoins, chip: 'bg-rose-50 text-rose-700 ring-rose-600/20', text: 'text-rose-700' },
}
const monthStart = (d) => d.slice(0, 8) + '01'
const shiftMonth = (m, n) => { const d = new Date(`${m}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10) }

/**
 * Technicians → ₹ Finance: petrol allowance (added to net salary) and salary advance
 * (taken from net salary) for one technician, month by month. Admin only.
 */
export default function TechFinanceModal({ tech, onClose }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const qc = useQueryClient()
  const askPassword = usePasswordConfirm()
  const [month, setMonth] = useState(monthStart(todayIST()))
  const [f, setF] = useState({ kind: 'PETROL', amount: '', entry_date: todayIST(), note: '' })
  const [busy, setBusy] = useState(false)
  const next = shiftMonth(month, 1)

  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: ['tech-finance', tech.id, month],
    queryFn: async () => {
      const { data, error } = await supabase.from('tech_finance').select('*, creator:profiles!tech_finance_created_by_fkey(name)')
        .eq('technician_id', tech.id).gte('entry_date', month).lt('entry_date', next)
        .order('entry_date', { ascending: false }).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
  const refresh = () => ['tech-finance', 'payout'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))
  const sum = (k) => rows.filter((r) => r.kind === k).reduce((s, r) => s + Number(r.amount), 0)
  const petrol = sum('PETROL'), advance = sum('ADVANCE')

  const add = async (e) => {
    e.preventDefault()
    const amount = Math.round((parseFloat(f.amount) || 0) * 100) / 100
    if (amount <= 0) return toast('Enter the amount', 'error')
    if (!f.entry_date) return toast('Pick the date', 'error')
    setBusy(true)
    const { error } = await supabase.from('tech_finance').insert({ technician_id: tech.id, kind: f.kind, amount, entry_date: f.entry_date, note: f.note.trim() || null, created_by: user?.id || null })
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast(`${FINANCE[f.kind].label} ${fmtMoney(amount)} added for ${tech.name}`, 'success')
    if (monthStart(f.entry_date) !== month) setMonth(monthStart(f.entry_date))
    setF((p) => ({ ...p, amount: '', note: '' })); refresh()
  }
  const remove = async (r) => {
    if (!(await askPassword({ title: `Delete ${FINANCE[r.kind].label.toLowerCase()}?`, message: `${FINANCE[r.kind].label} ${fmtMoney(r.amount)} of ${fmtDate(r.entry_date)} for ${tech.name} will be deleted and taken out of the net salary.` }))) return
    const { error } = await supabase.from('tech_finance').delete().eq('id', r.id)
    if (error) return toast(errMsg(error), 'error')
    toast('Deleted', 'success'); refresh()
  }

  const notReady = error && /tech_finance|relation|schema cache|42P01|PGRST/.test(`${error.code} ${error.message}`)
  return (
    <Modal title={`Finance · ${tech.name}`} subtitle={`${tech.tech_code || ''} · Petrol allowance is added to net salary, salary advance is taken from it`} onClose={onClose} width="max-w-xl">
      {notReady ? (
        <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2"><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /> Run <b>update-2026-11-tech-finance.sql</b> in Supabase → SQL Editor, then reopen.</p>
      ) : (
        <div className="space-y-4">
          <form onSubmit={add} className="rounded-2xl border border-slate-200 p-3 space-y-3 bg-slate-50/60">
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(FINANCE).map(([k, m]) => (
                <button key={k} type="button" onClick={() => setF((p) => ({ ...p, kind: k }))}
                  className={`flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition ${f.kind === k ? (k === 'PETROL' ? 'border-sky-500 bg-sky-50 text-sky-700' : 'border-rose-500 bg-rose-50 text-rose-700') : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                  <m.icon size={16} /> {m.label} <span className="font-medium opacity-70">({m.sign})</span>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount ₹ *"><input type="number" min="1" step="1" className="input" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} placeholder="500" autoFocus /></Field>
              <Field label="Date *" hint="Counted in this date's month"><input type="date" className="input" value={f.entry_date} max={todayIST()} onChange={(e) => setF((p) => ({ ...p, entry_date: e.target.value }))} /></Field>
            </div>
            <Field label="Note"><input className="input" value={f.note} onChange={(e) => setF((p) => ({ ...p, note: e.target.value }))} placeholder={f.kind === 'PETROL' ? 'e.g. Week 1 travel, Kanchipuram jobs' : 'e.g. Advance paid by GPay'} /></Field>
            <button disabled={busy} className={`w-full justify-center text-sm ${f.kind === 'PETROL' ? 'btn-primary' : 'inline-flex items-center gap-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2.5 disabled:opacity-60'}`}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add {FINANCE[f.kind].label.toLowerCase()}</button>
          </form>

          <div className="flex items-center justify-between">
            <button onClick={() => setMonth(shiftMonth(month, -1))} className="p-2 rounded-lg hover:bg-slate-100"><ChevronLeft size={16} /></button>
            <p className="text-sm font-heading font-bold text-slate-800">{fmtDate(month, { month: 'long', year: 'numeric' })}</p>
            <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={next > todayIST()} className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-sky-50 p-2.5"><p className="text-[10px] font-bold uppercase text-sky-700/80">Petrol allowance</p><p className="text-lg font-heading font-extrabold text-sky-700">+ {fmtMoney(petrol)}</p></div>
            <div className="rounded-xl bg-rose-50 p-2.5"><p className="text-[10px] font-bold uppercase text-rose-700/80">Salary advance</p><p className="text-lg font-heading font-extrabold text-rose-700">− {fmtMoney(advance)}</p></div>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl">
            {isLoading ? <p className="p-4 text-center text-sm text-slate-400">Loading…</p>
              : error ? <p className="p-4 text-center text-sm text-red-600">{errMsg(error)}</p>
              : !rows.length ? <p className="p-4 text-center text-sm text-slate-400">No entries this month</p>
              : rows.map((r) => { const m = FINANCE[r.kind]; return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ring-1 ring-inset flex items-center gap-1 ${m.chip}`}><m.icon size={11} /> {m.short}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-800"><b className={m.text}>{m.sign} {fmtMoney(r.amount)}</b> <span className="text-slate-400 text-xs">· {fmtDate(r.entry_date)}</span></p>
                    {(r.note || r.creator?.name) && <p className="text-xs text-slate-500 truncate">{r.note}{r.note && r.creator?.name ? ' · ' : ''}{r.creator?.name && <span className="text-slate-400">by {r.creator.name}</span>}</p>}
                  </div>
                  <button onClick={() => remove(r)} title="Delete" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button>
                </div>) })}
          </div>
          <p className="text-xs text-slate-500">The technician sees these in HT Jobs. Net salary = Earned − Collected from customer <b className="text-sky-700">+ Petrol</b> <b className="text-rose-700">− Advance</b>.</p>
        </div>
      )}
    </Modal>
  )
}
