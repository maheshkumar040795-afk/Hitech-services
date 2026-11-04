import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, IndianRupee, MapPin, RefreshCw, AlertTriangle, Search } from 'lucide-react'
import { supabase, rpc, errMsg } from '../lib/supabase'
import { todayIST, fmtMoney } from '../lib/format'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'

const TABS = [
  ['rate_chennai', 'Within Chennai', 'Pin code 600xxx (or no pin code)'],
  ['rate_outside', 'Outside Chennai', 'Any other pin code'],
]
const key = (s) => String(s || '').trim().toLowerCase()

/** Rate config: what the technician earns per job, by service, Within / Outside Chennai */
export default function RatesPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user } = useAuth()
  const [tab, setTab] = useState('rate_chennai')
  const [q, setQ] = useState('')
  const [newSvc, setNewSvc] = useState({ service: '', rate: '' })
  const [busy, setBusy] = useState(false)

  const { data: rates = [], isLoading, error } = useQuery({
    queryKey: ['service-rates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('service_rates').select('*').order('service')
      if (error) throw error
      return data
    },
  })
  // Services that appear in orders, to spot ones without a rate
  const { data: orderServices = [] } = useQuery({
    queryKey: ['order-services'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      // the latest 2000 orders are enough to find the services in use (keeps data use low)
      const { data: rows = [], error } = await supabase.from('orders').select('service').eq('is_deleted', false).not('service', 'is', null).order('created_at', { ascending: false }).limit(2000)
      if (error) throw error
      const m = new Map()
      for (const r of rows) { const k = key(r.service); if (k) m.set(k, { name: r.service.trim(), n: (m.get(k)?.n || 0) + 1 }) }
      return [...m.values()].sort((a, b) => b.n - a.n)
    },
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['service-rates'] })

  const missing = useMemo(() => {
    const have = new Set(rates.map((r) => key(r.service)))
    return orderServices.filter((s) => !have.has(key(s.name)))
  }, [rates, orderServices])
  const unset = rates.filter((r) => r[tab] === null || r[tab] === undefined).length
  const list = rates.filter((r) => !q || key(r.service).includes(key(q)))

  const saveRate = async (row, value) => {
    const v = value === '' ? null : Math.max(0, parseFloat(value))
    if (v !== null && isNaN(v)) return toast('Enter a number', 'error')
    if (v === (row[tab] === null ? null : Number(row[tab]))) return
    const { error } = await supabase.from('service_rates').update({ [tab]: v, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) return toast(errMsg(error), 'error')
    toast(`${row.service}: ${v === null ? 'rate cleared' : fmtMoney(v)} (${TABS.find((t) => t[0] === tab)[1]})`, 'success')
    refresh()
  }
  const rename = async (row, name) => {
    name = name.trim()
    if (!name || name === row.service) return
    const { error } = await supabase.from('service_rates').update({ service: name, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) return toast(error.code === '23505' ? 'This service already exists' : errMsg(error), 'error')
    refresh()
  }
  const add = async (service, rate) => {
    service = service.trim()
    if (!service) return toast('Type the service name exactly as in the orders', 'error')
    const v = rate === '' || rate === undefined ? null : Math.max(0, parseFloat(rate))
    const { error } = await supabase.from('service_rates').insert({ service, [tab]: isNaN(v) ? null : v, updated_by: user.id })
    if (error) return toast(error.code === '23505' ? 'This service already exists' : errMsg(error), 'error')
    setNewSvc({ service: '', rate: '' }); refresh()
  }
  const remove = async (row) => {
    if (!confirm(`Delete ${row.service}? Past payouts keep their saved rate.`)) return
    const { error } = await supabase.from('service_rates').delete().eq('id', row.id)
    if (error) return toast(errMsg(error), 'error')
    refresh()
  }
  const applyToCompleted = async () => {
    const from = todayIST().slice(0, 8) + '01'
    if (!confirm(`Apply the current rates to jobs completed this month (from ${from})? Use this after entering or correcting rates.`)) return
    setBusy(true)
    try { const n = await rpc('apply_rates_to_completed', { p_from: from, p_to: null }); toast(`${n} completed job${n === 1 ? '' : 's'} updated`, 'success') }
    catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  if (error) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto">
        <AlertTriangle className="mx-auto text-amber-500" />
        <p className="font-semibold text-slate-800 mt-2">Rate config is not set up on the server yet</p>
        <p className="text-sm text-slate-500 mt-1">Run <b>update-2026-11-status-rates-payout.sql</b> in Supabase → SQL Editor, then reload.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">Rate Config</h1>
          <p className="text-sm text-slate-500 mt-0.5">Technician rate per job, by service — used for Technician Payout</p>
        </div>
        <button onClick={applyToCompleted} disabled={busy} className="btn-secondary text-xs"><RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Apply rates to this month's completed jobs</button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(([k, l, hint]) => (
          <button key={k} onClick={() => setTab(k)} className={`chip px-4 py-2.5 text-sm text-left ${tab === k ? 'chip-on' : 'chip-off'}`}>
            <span className="flex items-center gap-1.5"><MapPin size={14} /> {l}</span>
            <span className={`block text-[10px] font-medium ${tab === k ? 'text-white/80' : 'text-slate-400'}`}>{hint}</span>
          </button>
        ))}
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <p className="text-sm font-heading font-bold text-slate-800 flex-1">{TABS.find((t) => t[0] === tab)[1]} rates <span className="text-slate-400 font-medium">· {rates.length} services{unset ? ` · ${unset} without a rate` : ''}</span></p>
          <div className="relative w-full sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9 py-2" placeholder="Search service…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <table className="w-full">
          <thead><tr>{['Service (exactly as in the orders)', 'Rate ₹', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
              : list.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="td"><input defaultValue={r.service} onBlur={(e) => rename(r, e.target.value)} className="w-full bg-transparent outline-none font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-brand-500/20 rounded-lg px-2 py-1 -mx-2" /></td>
                  <td className="td w-40">
                    <div className="relative">
                      <IndianRupee size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input key={`${r.id}-${tab}-${r[tab]}`} type="number" min="0" step="1" defaultValue={r[tab] ?? ''} placeholder="Not set"
                        onBlur={(e) => saveRate(r, e.target.value)} onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                        className={`w-full pl-7 pr-2 py-1.5 rounded-lg border text-sm text-right font-semibold ${r[tab] === null ? 'border-amber-300 bg-amber-50 placeholder:text-amber-500' : 'border-slate-200'}`} />
                    </div>
                  </td>
                  <td className="td w-12"><button onClick={() => remove(r)} title="Delete service" className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            {!isLoading && !list.length && <tr><td colSpan={3} className="px-4 py-8 text-center text-sm text-slate-400">{rates.length ? 'No service matches' : 'No services yet — add them below'}</td></tr>}
            <tr className="bg-slate-50/60">
              <td className="td"><input className="input py-2" placeholder="New service, e.g. TV Installation" value={newSvc.service} onChange={(e) => setNewSvc((p) => ({ ...p, service: e.target.value }))} /></td>
              <td className="td"><input type="number" min="0" className="input py-2 text-right" placeholder="₹" value={newSvc.rate} onChange={(e) => setNewSvc((p) => ({ ...p, rate: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && add(newSvc.service, newSvc.rate)} /></td>
              <td className="td"><button onClick={() => add(newSvc.service, newSvc.rate)} className="btn-primary text-xs px-2.5 py-2"><Plus size={14} /></button></td>
            </tr>
          </tbody>
        </table>
      </div>

      {missing.length > 0 && (
        <div className="card p-4 border-amber-300/70 bg-amber-50/70">
          <p className="text-sm font-heading font-bold text-amber-900 flex items-center gap-2"><AlertTriangle size={15} /> Services in your orders without a rate ({missing.length})</p>
          <p className="text-xs text-amber-800/80 mt-0.5 mb-3">Jobs with these services show "Rate not set" in Technician Payout. Click to add, then type the rate.</p>
          <div className="flex flex-wrap gap-2">
            {missing.slice(0, 40).map((m) => (
              <button key={m.name} onClick={() => add(m.name, '')} className="text-xs bg-white border border-amber-200 rounded-lg px-2.5 py-1.5 hover:border-brand-300 hover:text-brand-700">
                <Plus size={11} className="inline -mt-0.5" /> {m.name} <span className="text-slate-400">· {m.n} orders</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
