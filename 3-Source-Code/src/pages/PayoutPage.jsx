import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Download, ChevronDown, ChevronRight, AlertTriangle, Wallet, Search } from 'lucide-react'
import { supabase, errMsg, fetchAll } from '../lib/supabase'
import { todayIST, addDays, fmtDate, fmtMoney, fmtDayIST, payLabel } from '../lib/format'
import { downloadXlsx } from '../lib/excel'
import { useTechnicians } from '../hooks/useData'
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
 *   Less    = what the technician collected from the customer (cash or UPI — the customer always pays the technician)
 *   Net pay = Earned − collected.  "Paid on Amazon" jobs: nothing collected, full rate is paid.
 */
export default function PayoutPage() {
  const { data: techs = [] } = useTechnicians()
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
      const cols = 'id, order_id, customer_name, service, pin_code, region, payout_rate, cod_amount, payment_mode, closed_at, technician_id'
      const load = (c) => fetchAll(() => supabase.from('orders').select(c)
          .eq('status', 'COMPLETED').eq('is_deleted', false).not('technician_id', 'is', null)
          .gte('closed_at', fromIso).lt('closed_at', toIso).order('closed_at'))
      const [jobs, ratesRes] = await Promise.all([
        load(cols + ', installed_item').catch((e) => { if (e?.code === '42703') return load(cols); throw e }),
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
      const item = o.installed_item || o.service
      const cfg = rateMap.get(key(item))
      const rate = o.payout_rate !== null && o.payout_rate !== undefined ? Number(o.payout_rate)
        : cfg ? (region === 'OUTSIDE' ? cfg.rate_outside : cfg.rate_chennai) : null
      const amazon = o.payment_mode === 'AMAZON'
      const collected = amazon ? 0 : Number(o.cod_amount || 0)   // from the customer, cash or UPI
      const r = rate === null || rate === undefined ? null : Number(rate)
      const job = { ...o, item, region, rate: r, amazon, collected, net: (r || 0) - collected }
      const t = byTech.get(o.technician_id) || { id: o.technician_id, jobs: [] }
      t.jobs.push(job); byTech.set(o.technician_id, t)
    }
    return [...byTech.values()].map((t) => {
      const info = techs.find((x) => x.id === t.id) || { name: 'Unknown technician' }
      const earned = t.jobs.reduce((s, j) => s + (j.rate || 0), 0)
      const collected = t.jobs.reduce((s, j) => s + j.collected, 0)
      const svc = new Map()
      t.jobs.forEach((j) => { const k = j.item || '—'; svc.set(k, (svc.get(k) || 0) + 1) })
      return {
        ...t, info, earned, collected, net: earned - collected,
        amazon: t.jobs.filter((j) => j.amazon).length,
        collectedJobs: t.jobs.filter((j) => j.collected > 0).length,
        missing: t.jobs.filter((j) => j.rate === null).length,
        services: [...svc.entries()].map(([s, n]) => `${n} × ${s}`).join(', '),
      }
    }).sort((a, b) => b.jobs.length - a.jobs.length)
  }, [data, techs])

  const shown = rows.filter((r) => (!tech || r.id === tech) &&
    (!q || [r.info.name, r.info.tech_code, r.info.city].some((v) => key(v).includes(key(q)))))
  const tot = shown.reduce((s, r) => ({ jobs: s.jobs + r.jobs.length, earned: s.earned + r.earned, collected: s.collected + r.collected, amazon: s.amazon + r.amazon,
    collectedJobs: s.collectedJobs + r.collectedJobs, net: s.net + r.net, missing: s.missing + r.missing }),
    { jobs: 0, earned: 0, collected: 0, amazon: 0, collectedJobs: 0, net: 0, missing: 0 })

  const pick = ([k, , fn]) => { setQuick(k); setRange(fn()) }
  const toggle = (id) => setOpen((p) => { const s = new Set(p); s.has(id) ? s.delete(id) : s.add(id); return s })
  // Excel: "Summary" = one line per technician, "Job details" = every job with a total line under each technician
  const exportXlsx = () => {
    const label = from === to ? from : `${from}_to_${to}`
    const period = from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`
    const result = (net) => (net < 0 ? 'Technician owes office' : net > 0 ? 'Pay technician' : 'Settled')
    const summary = shown.map((r, i) => ({
      'S.No': i + 1, Period: period, 'Technician ID': r.info.tech_code || '', Technician: r.info.name, Mobile: r.info.mobile || '',
      'Jobs completed': r.jobs.length, 'Jobs: collected from customer': r.collectedJobs, 'Jobs: paid on Amazon': r.amazon, 'Jobs without rate': r.missing,
      'Earned (Rate Config) ₹': r.earned, 'Collected from customer ₹': r.collected, 'Net pay ₹': r.net, Result: result(r.net), Services: r.services,
    }))
    if (shown.length > 1) summary.push({
      'S.No': '', Period: period, 'Technician ID': '', Technician: 'TOTAL', Mobile: '',
      'Jobs completed': tot.jobs, 'Jobs: collected from customer': tot.collectedJobs, 'Jobs: paid on Amazon': tot.amazon, 'Jobs without rate': tot.missing,
      'Earned (Rate Config) ₹': tot.earned, 'Collected from customer ₹': tot.collected, 'Net pay ₹': tot.net, Result: result(tot.net), Services: '',
    })
    const details = shown.flatMap((r) => [
      ...r.jobs.map((j, i) => ({
        'Technician ID': r.info.tech_code || '', Technician: r.info.name, 'Job No': i + 1, 'Completed On': fmtDayIST(j.closed_at), 'Order ID': j.order_id, Customer: j.customer_name,
        'Service (order)': j.service || '', 'Installed Item': j.installed_item || '', Region: j.region === 'OUTSIDE' ? 'Outside Chennai' : 'Within Chennai',
        Payment: payLabel(j) || 'Nothing collected', 'Rate ₹': j.rate ?? 'Not set', 'Collected from customer ₹': j.collected, 'Net for this job ₹': j.net,
      })),
      { 'Technician ID': r.info.tech_code || '', Technician: `TOTAL: ${r.info.name}`, 'Job No': `${r.jobs.length} job${r.jobs.length > 1 ? 's' : ''}`, 'Completed On': '', 'Order ID': '', Customer: '',
        'Service (order)': '', 'Installed Item': '', Region: '', Payment: result(r.net), 'Rate ₹': r.earned, 'Collected from customer ₹': r.collected, 'Net for this job ₹': r.net },
    ])
    downloadXlsx(`technician-payout-${label}.xlsx`, [
      { name: 'Summary', rows: summary, widths: [6, 22, 14, 22, 13, 15, 27, 20, 17, 21, 25, 12, 22, 60] },
      { name: 'Job details', rows: details, widths: [14, 26, 9, 14, 24, 22, 32, 32, 16, 24, 10, 25, 19] },
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
          ['Collected from customer', fmtMoney(tot.collected), 'text-amber-700'], ['Net pay', fmtMoney(tot.net), tot.net < 0 ? 'text-red-600' : 'text-emerald-700']].map(([l, v, c]) => (
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
            <thead><tr>{['', 'Technician', 'Jobs', 'Services', 'Earned', 'Collected from customer', 'Paid on Amazon', 'Net pay'].map((h) => <th key={h} className="th whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
                : !shown.length ? <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">No completed jobs in this period</td></tr>
                : shown.map((r) => (
                  <Fragment key={r.id}>
                    <tr className="table-row cursor-pointer" onClick={() => toggle(r.id)}>
                      <td className="td w-8 text-slate-400">{open.has(r.id) ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td className="td whitespace-nowrap"><span className="font-mono text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 rounded mr-1.5">{r.info.tech_code || '—'}</span><b className="text-slate-800">{r.info.name}</b></td>
                      <td className="td font-semibold tabular-nums">{r.jobs.length}</td>
                      <td className="td text-xs text-slate-600 max-w-[260px]"><span className="line-clamp-2">{r.services}</span></td>
                      <td className="td tabular-nums whitespace-nowrap">{fmtMoney(r.earned)}{r.missing > 0 && <span title="Jobs without a rate" className="ml-1 text-[10px] font-bold text-amber-600">+{r.missing}?</span>}</td>
                      <td className="td tabular-nums text-amber-700 whitespace-nowrap">{r.collected ? `− ${fmtMoney(r.collected)}` : '—'}{r.collectedJobs > 0 && <span className="ml-1 text-[10px] text-slate-400">{r.collectedJobs} job{r.collectedJobs > 1 ? 's' : ''}</span>}</td>
                      <td className="td tabular-nums text-violet-700 whitespace-nowrap">{r.amazon ? `${r.amazon} job${r.amazon > 1 ? 's' : ''}` : '—'}</td>
                      <td className="td whitespace-nowrap">
                        <span className={`text-[15px] font-heading font-extrabold tabular-nums ${r.net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{fmtMoney(Math.abs(r.net))}</span>
                        <span className="block text-[10px] text-slate-400">{r.net < 0 ? 'technician owes office' : r.net === 0 ? 'settled, nothing to pay' : 'pay technician'}</span>
                      </td>
                    </tr>
                    {open.has(r.id) && (
                      <tr className="bg-slate-50/70">
                        <td />
                        <td colSpan={7} className="px-4 pb-4 pt-1">
                          <table className="w-full text-xs bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <thead><tr className="bg-slate-50 text-slate-500">{['Completed', 'Order ID', 'Customer', 'Installed / Service', 'Region', 'Payment', 'Rate', 'Collected', 'Net'].map((h) => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
                            <tbody>{r.jobs.map((j) => (
                              <tr key={j.id} className="border-t border-slate-100">
                                <td className="px-3 py-2 whitespace-nowrap">{fmtDayIST(j.closed_at)}</td>
                                <td className="px-3 py-2 font-mono text-brand-600">{j.order_id}</td>
                                <td className="px-3 py-2">{j.customer_name}</td>
                                <td className="px-3 py-2">{j.item || '—'}{j.installed_item && j.service && j.installed_item !== j.service && <div className="text-[10px] text-slate-400">Order: {j.service}</div>}</td>
                                <td className="px-3 py-2">{j.region === 'OUTSIDE' ? 'Outside Chennai' : 'Chennai'}</td>
                                <td className="px-3 py-2 whitespace-nowrap">{payLabel(j) || '—'}</td>
                                <td className="px-3 py-2 font-semibold tabular-nums">{j.rate === null ? <span className="text-amber-600">Not set</span> : fmtMoney(j.rate)}</td>
                                <td className="px-3 py-2 tabular-nums text-amber-700">{j.collected ? `− ${fmtMoney(j.collected)}` : '—'}</td>
                                <td className={`px-3 py-2 font-semibold tabular-nums ${j.net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>{j.net < 0 ? `− ${fmtMoney(-j.net)}` : fmtMoney(j.net)}</td>
                              </tr>))}
                            </tbody>
                          </table>
                          <p className="text-xs text-slate-600 mt-2 flex items-center gap-1.5"><Wallet size={13} className="text-brand-600" />
                            Earned {fmtMoney(r.earned)} − collected from customer {fmtMoney(r.collected)} = <b className={r.net < 0 ? 'text-red-600' : 'text-emerald-700'}>{r.net < 0 ? `technician owes ${fmtMoney(-r.net)}` : `net pay ${fmtMoney(r.net)}`}</b></p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              {shown.length > 1 && (
                <tr className="bg-brand-50/50 font-semibold">
                  <td /><td className="td">Total</td><td className="td tabular-nums">{tot.jobs}</td><td />
                  <td className="td tabular-nums">{fmtMoney(tot.earned)}</td><td className="td tabular-nums">− {fmtMoney(tot.collected)}</td><td className="td tabular-nums">{tot.amazon ? `${tot.amazon} job${tot.amazon > 1 ? 's' : ''}` : '—'}</td>
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
