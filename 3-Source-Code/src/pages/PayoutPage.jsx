import { Fragment, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, ChevronDown, ChevronRight, AlertTriangle, Wallet, Search, Settings2 } from 'lucide-react'
import { supabase, errMsg, fetchAll } from '../lib/supabase'
import { todayIST, addDays, fmtDate, fmtMoney, fmtDayIST, techLabel, PAYMENT } from '../lib/format'
import { downloadXlsx } from '../lib/excel'
import { useTechnicians, useAppSettings } from '../hooks/useData'
import { useToast } from '../context/ToastContext'
import TechPicker from '../components/TechPicker'

const QUICK = [
  ['today', 'Today', () => [todayIST(), todayIST()]],
  ['yday', 'Yesterday', () => [addDays(todayIST(), -1), addDays(todayIST(), -1)]],
  ['week', 'Last 7 days', () => [addDays(todayIST(), -6), todayIST()]],
  ['month', 'This month', () => [todayIST().slice(0, 8) + '01', todayIST()]],
]
const key = (s) => String(s || '').trim().toLowerCase()
const regionOf = (o) => o.region || (!o.pin_code || String(o.pin_code).trim().startsWith('600') ? 'CHENNAI' : 'OUTSIDE')

/**
 * Technician payout for completed jobs (by completed date):
 *   Earned  = Σ rate of each job (Rate Config, Within / Outside Chennai; saved on the job when completed)
 *   Less    = cash the technician collected (+ online, if online payments reach the technician)
 *   Net pay = Earned − collected.  "Paid on Amazon" jobs: nothing collected, full rate is paid.
 */
export default function PayoutPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { data: techs = [] } = useTechnicians()
  const { data: settings } = useAppSettings()
  const onlineToTech = settings?.online_to_technician !== false
  const [quick, setQuick] = useState('today')
  const [range, setRange] = useState([todayIST(), todayIST()])
  const [from, to] = range
  const [tech, setTech] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(() => new Set())

  const { data, isLoading, error } = useQuery({
    queryKey: ['payout', from, to],
    queryFn: async () => {
      const fromIso = new Date(`${from}T00:00:00+05:30`).toISOString()
      const toIso = new Date(`${addDays(to, 1)}T00:00:00+05:30`).toISOString()
      const [jobs, ratesRes] = await Promise.all([
        fetchAll(() => supabase.from('orders')
          .select('id, order_id, customer_name, service, pin_code, region, payout_rate, cod_amount, payment_mode, closed_at, technician_id')
          .eq('status', 'COMPLETED').eq('is_deleted', false).not('technician_id', 'is', null)
          .gte('closed_at', fromIso).lt('closed_at', toIso).order('closed_at')),
        supabase.from('service_rates').select('service, rate_chennai, rate_outside'),
      ])
      if (ratesRes.error) throw ratesRes.error
      return { jobs, rates: ratesRes.data }
    },
  })

  const rows = useMemo(() => {
    if (!data) return []
    const rateMap = new Map(data.rates.map((r) => [key(r.service), r]))
    const byTech = new Map()
    for (const o of data.jobs) {
      const region = regionOf(o)
      const cfg = rateMap.get(key(o.service))
      const rate = o.payout_rate !== null && o.payout_rate !== undefined ? Number(o.payout_rate)
        : cfg ? (region === 'OUTSIDE' ? cfg.rate_outside : cfg.rate_chennai) : null
      const amt = Number(o.cod_amount || 0)
      const cash = o.payment_mode === 'CASH' || (!o.payment_mode && amt > 0) ? amt : 0
      const online = o.payment_mode === 'ONLINE' ? amt : 0
      const job = { ...o, region, rate: rate === null || rate === undefined ? null : Number(rate), cash, online }
      const t = byTech.get(o.technician_id) || { id: o.technician_id, jobs: [] }
      t.jobs.push(job); byTech.set(o.technician_id, t)
    }
    return [...byTech.values()].map((t) => {
      const info = techs.find((x) => x.id === t.id) || { name: 'Unknown technician' }
      const earned = t.jobs.reduce((s, j) => s + (j.rate || 0), 0)
      const cash = t.jobs.reduce((s, j) => s + j.cash, 0)
      const online = t.jobs.reduce((s, j) => s + j.online, 0)
      const deduct = cash + (onlineToTech ? online : 0)
      const svc = new Map()
      t.jobs.forEach((j) => { const k = j.service || '—'; svc.set(k, (svc.get(k) || 0) + 1) })
      return {
        ...t, info, earned, cash, online, deduct, net: earned - deduct,
        amazon: t.jobs.filter((j) => j.payment_mode === 'AMAZON').length,
        missing: t.jobs.filter((j) => j.rate === null).length,
        services: [...svc.entries()].map(([s, n]) => `${n} × ${s}`).join(', '),
      }
    }).sort((a, b) => b.jobs.length - a.jobs.length)
  }, [data, techs, onlineToTech])

  const shown = rows.filter((r) => (!tech || r.id === tech) &&
    (!q || [r.info.name, r.info.tech_code, r.info.city].some((v) => key(v).includes(key(q)))))
  const tot = shown.reduce((s, r) => ({ jobs: s.jobs + r.jobs.length, earned: s.earned + r.earned, cash: s.cash + r.cash, online: s.online + r.online, net: s.net + r.net, missing: s.missing + r.missing }),
    { jobs: 0, earned: 0, cash: 0, online: 0, net: 0, missing: 0 })

  const pick = ([k, , fn]) => { setQuick(k); setRange(fn()) }
  const toggle = (id) => setOpen((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })
  const setOnlineRule = async (v) => {
    const { error } = await supabase.from('app_settings').update({ online_to_technician: v }).eq('id', 1)
    if (error) return toast(errMsg(error), 'error')
    qc.invalidateQueries({ queryKey: ['app-settings'] }); qc.invalidateQueries({ queryKey: ['settings'] })
    toast(v ? 'Online payments are deducted from the technician' : 'Online payments go to the company (not deducted)', 'success')
  }
  const exportXlsx = () => {
    const label = from === to ? from : `${from}_to_${to}`
    downloadXlsx(`technician-payout-${label}.xlsx`, [
      { name: 'Payout', rows: shown.map((r) => ({
        'Technician ID': r.info.tech_code || '', Technician: r.info.name, Mobile: r.info.mobile || '', Jobs: r.jobs.length, Services: r.services,
        'Earned (rates)': r.earned, 'Cash collected': r.cash, 'Online collected': r.online, 'Paid on Amazon (jobs)': r.amazon,
        Deducted: r.deduct, 'Net pay': r.net, 'Jobs without rate': r.missing,
      })) },
      { name: 'Jobs', rows: shown.flatMap((r) => r.jobs.map((j) => ({
        Technician: techLabel(r.info), 'Completed On': fmtDayIST(j.closed_at), 'Order ID': j.order_id, Customer: j.customer_name, Service: j.service || '',
        Region: j.region === 'OUTSIDE' ? 'Outside Chennai' : 'Within Chennai', Rate: j.rate ?? 'Not set', Payment: PAYMENT[j.payment_mode] || '', Collected: Number(j.cod_amount || 0),
      }))) },
    ])
  }

  if (error) {
    return (
      <div className="card p-8 text-center max-w-lg mx-auto">
        <AlertTriangle className="mx-auto text-amber-500" />
        <p className="font-semibold text-slate-800 mt-2">Payout is not set up on the server yet</p>
        <p className="text-sm text-slate-500 mt-1">Run <b>update-2026-11-status-rates-payout.sql</b> in Supabase → SQL Editor, then reload. ({errMsg(error)})</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">Technician Payout</h1>
          <p className="text-sm text-slate-500 mt-0.5">Completed jobs {from === to ? `on ${fmtDate(from, { day: 'numeric', month: 'long', year: 'numeric' })}` : `from ${fmtDate(from)} to ${fmtDate(to)}`} · rates from <Link to="/rates" className="text-brand-600 font-semibold hover:underline">Rate Config</Link></p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {QUICK.map((x) => <button key={x[0]} onClick={() => pick(x)} className={`chip ${quick === x[0] ? 'chip-on' : 'chip-off'}`}>{x[1]}</button>)}
          <div className="flex items-center gap-2 bg-white/90 border border-slate-200 rounded-xl px-3 py-1.5">
            <input type="date" className="text-xs outline-none" value={from} max={to} onChange={(e) => { setQuick(''); setRange([e.target.value, to]) }} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" className="text-xs outline-none" value={to} min={from} onChange={(e) => { setQuick(''); setRange([from, e.target.value]) }} />
          </div>
          <button onClick={exportXlsx} disabled={!shown.length} className="btn-secondary text-xs"><Download size={13} /> Export</button>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Jobs completed', tot.jobs, 'text-slate-900'], ['Earned (rates)', fmtMoney(tot.earned), 'text-slate-900'],
          [`Collected by technicians${onlineToTech ? '' : ' (cash)'}`, fmtMoney(tot.cash + (onlineToTech ? tot.online : 0)), 'text-amber-700'], ['Net pay', fmtMoney(tot.net), tot.net < 0 ? 'text-red-600' : 'text-emerald-700']].map(([l, v, c]) => (
          <div key={l} className="card p-4"><p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[.08em]">{l}</p><p className={`text-[22px] font-heading font-extrabold mt-1 tabular-nums ${c}`}>{v}</p></div>
        ))}
      </div>

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 py-2" placeholder="Search technician…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <TechPicker techs={techs} value={tech} onChange={setTech} activeOnly={false} showLoad={false} placeholder="All technicians" className="w-auto min-w-[220px] py-2"
          extra={[{ value: '', label: 'All technicians' }]} />
        <label className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2" title="Where does money the customer pays Online/UPI go?">
          <Settings2 size={13} className="text-slate-400" /> Online payment goes to
          <select className="bg-transparent font-semibold text-slate-800 outline-none" value={onlineToTech ? 'tech' : 'company'} onChange={(e) => setOnlineRule(e.target.value === 'tech')}>
            <option value="tech">Technician (deduct)</option><option value="company">Company (don't deduct)</option>
          </select>
        </label>
      </div>

      {tot.missing > 0 && (
        <div className="card p-3 border-amber-300/70 bg-amber-50/70 text-sm text-amber-900 flex flex-wrap items-center gap-2">
          <AlertTriangle size={15} /> {tot.missing} job{tot.missing > 1 ? 's have' : ' has'} no rate (counted as ₹0).
          <Link to="/rates" className="font-semibold text-brand-700 hover:underline">Set the rate in Rate Config</Link>, then use "Apply rates to this month's completed jobs".
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr>{['', 'Technician', 'Jobs', 'Services', 'Earned', 'Cash', 'Online', 'Amazon', 'Net pay'].map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
                : !shown.length ? <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">No completed jobs in this period</td></tr>
                : shown.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="table-row cursor-pointer" onClick={() => toggle(r.id)}>
                      <td className="td w-8 text-slate-400">{open.has(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td className="td whitespace-nowrap"><span className="font-mono text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 rounded mr-1.5">{r.info.tech_code || '—'}</span><b className="text-slate-800">{r.info.name}</b></td>
                      <td className="td font-semibold tabular-nums">{r.jobs.length}</td>
                      <td className="td text-xs text-slate-600 max-w-[260px]"><span className="line-clamp-2">{r.services}</span></td>
                      <td className="td tabular-nums whitespace-nowrap">{fmtMoney(r.earned)}{r.missing > 0 && <span title="Jobs without a rate" className="ml-1 text-[10px] font-bold text-amber-600">+{r.missing}?</span>}</td>
                      <td className="td tabular-nums text-amber-700">{r.cash ? `− ${fmtMoney(r.cash)}` : '—'}</td>
                      <td className={`td tabular-nums ${onlineToTech ? 'text-amber-700' : 'text-slate-400'}`}>{r.online ? `${onlineToTech ? '− ' : ''}${fmtMoney(r.online)}` : '—'}</td>
                      <td className="td tabular-nums text-violet-700">{r.amazon || '—'}</td>
                      <td className="td whitespace-nowrap">
                        <span className={`text-[15px] font-heading font-extrabold tabular-nums ${r.net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtMoney(Math.abs(r.net))}</span>
                        <span className="block text-[10px] text-slate-400">{r.net < 0 ? 'technician owes office' : 'pay technician'}</span>
                      </td>
                    </tr>
                    {open.has(r.id) && (
                      <tr className="bg-slate-50/70">
                        <td />
                        <td colSpan={8} className="px-4 pb-4 pt-1">
                          <table className="w-full text-xs bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <thead><tr className="bg-slate-50 text-slate-500">{['Completed', 'Order ID', 'Customer', 'Service', 'Region', 'Rate', 'Payment', 'Collected'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                            <tbody>{r.jobs.map((j) => (
                              <tr key={j.id} className="border-t border-slate-100">
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDayIST(j.closed_at)}</td>
                                <td className="px-3 py-2 font-mono text-brand-600">{j.order_id}</td>
                                <td className="px-3 py-2">{j.customer_name}</td>
                                <td className="px-3 py-2">{j.service || '—'}</td>
                                <td className="px-3 py-2">{j.region === 'OUTSIDE' ? 'Outside Chennai' : 'Chennai'}</td>
                                <td className="px-3 py-2 font-semibold">{j.rate === null ? <span className="text-amber-600">Not set</span> : fmtMoney(j.rate)}</td>
                                <td className="px-3 py-2">{PAYMENT[j.payment_mode] || (Number(j.cod_amount) ? 'Cash' : '—')}</td>
                                <td className="px-3 py-2 font-semibold">{Number(j.cod_amount) ? fmtMoney(j.cod_amount) : '—'}</td>
                              </tr>))}
                            </tbody>
                          </table>
                          <p className="text-xs text-slate-600 mt-2 flex items-center gap-1.5"><Wallet size={13} className="text-brand-600" />
                            Earned {fmtMoney(r.earned)} − collected {fmtMoney(r.deduct)} = <b className={r.net < 0 ? 'text-red-600' : 'text-emerald-700'}>{r.net < 0 ? `technician owes ${fmtMoney(-r.net)}` : `net pay ${fmtMoney(r.net)}`}</b></p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              {shown.length > 1 && (
                <tr className="bg-brand-50/50 font-semibold">
                  <td /><td className="td">Total</td><td className="td tabular-nums">{tot.jobs}</td><td />
                  <td className="td tabular-nums">{fmtMoney(tot.earned)}</td><td className="td tabular-nums">{fmtMoney(tot.cash)}</td><td className="td tabular-nums">{fmtMoney(tot.online)}</td><td />
                  <td className="td tabular-nums">{fmtMoney(tot.net)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
