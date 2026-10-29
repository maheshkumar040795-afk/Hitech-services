import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Line } from 'recharts'
import { CheckCircle2, Clock, Package, TrendingUp, TrendingDown, Minus, IndianRupee, Search, UserX, Timer } from 'lucide-react'
import { rpc } from '../lib/supabase'
import { todayIST, addDays, fmtDate, fmtMoney } from '../lib/format'
import { useTechnicians, useTechStats } from '../hooks/useData'

const PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444']
const TREND_OPTIONS = [{ days: 7, label: '7 Days' }, { days: 15, label: '15 Days' }, { days: 30, label: '30 Days' }]
const QUICK = [
  { key: 'today', label: 'Today',     range: () => [todayIST(), todayIST()] },
  { key: 'yday',  label: 'Yesterday', range: () => [addDays(todayIST(), -1), addDays(todayIST(), -1)] },
  { key: '7d',    label: '7 Days',    range: () => [addDays(todayIST(), -6), todayIST()] },
  { key: 'month', label: 'This Month', range: () => [todayIST().slice(0, 8) + '01', todayIST()] },
]

function Delta({ value }) {
  if (value === null || value === undefined) return null
  if (value > 0) return <span className="flex items-center gap-0.5 text-emerald-600 text-[10px] font-semibold"><TrendingUp size={10} /> +{value}%</span>
  if (value < 0) return <span className="flex items-center gap-0.5 text-red-500 text-[10px] font-semibold"><TrendingDown size={10} /> {value}%</span>
  return <span className="flex items-center gap-0.5 text-slate-400 text-[10px]"><Minus size={10} /> 0%</span>
}

function Kpi({ icon: Icon, label, value, sub, color, delta, loading }) {
  return (
    <div className="card cursor-pointer p-4 flex items-start gap-3 overflow-hidden">
      <div className={`absolute -right-8 -top-8 w-24 h-24 rounded-full opacity-[.12] blur-xl ${color}`} />
      <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-gradient-to-br ${color} shadow-[inset_0_1px_0_rgba(255,255,255,.3),0_8px_18px_-8px_rgba(15,23,42,.45)]`}><Icon size={19} className="text-white drop-shadow" /></div>
      <div className="relative flex-1 min-w-0">
        <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-[.08em] truncate">{label}</p>
        {loading ? <div className="h-7 w-16 bg-slate-100 animate-pulse rounded mt-1" /> : <p className="text-[22px] font-heading font-extrabold text-slate-900 mt-0.5 truncate tabular-nums">{value ?? '—'}</p>}
        <div className="flex items-center gap-2 mt-0.5 min-w-0">{sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}<Delta value={delta} /></div>
      </div>
    </div>
  )
}

function BarList({ title, items }) {
  const max = items?.[0]?.count || 1
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
      <div className="space-y-2.5">
        {(items || []).map((b) => (
          <div key={b.name}>
            <div className="flex justify-between mb-1"><span className="text-xs font-medium text-slate-700 truncate pr-2">{b.name}</span><span className="text-xs text-slate-400">{b.count}</span></div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-brand-600 to-sky-400 transition-[width] duration-700" style={{ width: `${Math.round((b.count / max) * 100)}%` }} /></div>
          </div>
        ))}
        {!items?.length && <p className="text-sm text-slate-400 text-center py-4">No data</p>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [from, setFrom] = useState(todayIST())
  const [to, setTo] = useState(todayIST())
  const [range, setRange] = useState([todayIST(), todayIST()])
  const [quick, setQuick] = useState('today')
  const [trendDays, setTrendDays] = useState(7)
  const [rFrom, rTo] = range

  const pick = (q) => { const [a, b] = q.range(); setFrom(a); setTo(b); setRange([a, b]); setQuick(q.key) }
  const retrieve = () => { const a = from <= to ? from : to, b = from <= to ? to : from; setRange([a, b]); setQuick('') }

  const { data: s, isLoading } = useQuery({ queryKey: ['dashboard', 'summary', rFrom, rTo], queryFn: () => rpc('dashboard_summary', { p_from: rFrom, p_to: rTo }) })
  const { data: trend } = useQuery({ queryKey: ['dashboard', 'trend', trendDays], queryFn: () => rpc('dashboard_trend', { p_days: trendDays }) })
  const { data: br } = useQuery({ queryKey: ['dashboard', 'breakdown', rFrom, rTo], queryFn: () => rpc('dashboard_breakdown', { p_from: rFrom, p_to: rTo }) })
  const { data: techs } = useTechnicians()
  const { data: stats } = useTechStats(rFrom, rTo)

  const leaders = useMemo(() => (techs || [])
    .map((t) => ({ ...t, st: stats?.[t.id] }))
    .filter((t) => t.st && Number(t.st.total) > 0)
    .sort((a, b) => b.st.completed - a.st.completed || b.st.total - a.st.total)
    .slice(0, 8), [techs, stats])

  const pieData = s ? [{ name: 'Completed', value: s.completed }, { name: 'Pending', value: s.pending }, { name: 'Rejected', value: s.rejected }] : []
  const trendData = (trend || []).map((d) => ({ ...d, label: fmtDate(d.day, { day: '2-digit', month: 'short' }) }))
  const rangeLabel = rFrom === rTo ? fmtDate(rFrom, { day: 'numeric', month: 'long', year: 'numeric' }) : `${fmtDate(rFrom)} – ${fmtDate(rTo)}`

  return (
    <div className="space-y-5">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Showing orders dated {rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {QUICK.map((q) => (
              <button key={q.key} onClick={() => pick(q)}
                className={`chip ${quick === q.key ? 'chip-on' : 'chip-off'}`}>{q.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white/90 border border-slate-200 rounded-xl px-3 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,.05)] focus-within:border-brand-400 focus-within:ring-4 focus-within:ring-brand-500/10 transition">
            <input type="date" className="text-xs outline-none" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" className="text-xs outline-none" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button onClick={retrieve} className="btn-primary text-xs py-2 px-3"><Search size={12} /> Retrieve</button>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Package} label="Total Orders" value={s?.total} sub="All statuses" color="from-brand-600 to-sky-500" delta={s?.deltas?.total} loading={isLoading} />
        <Kpi icon={CheckCircle2} label="Completed" value={s?.completed} sub={`${s?.completion_rate ?? 0}% rate`} color="from-emerald-400 to-emerald-600" delta={s?.deltas?.completed} loading={isLoading} />
        <Kpi icon={Clock} label="Pending" value={s?.pending} sub={s?.rescheduled ? `incl. ${s.rescheduled} rescheduled` : "Awaiting visit"} color="from-amber-400 to-orange-500" loading={isLoading} />
        <Kpi icon={UserX} label="Unassigned" value={s?.unassigned} sub="Need a technician" color={s?.unassigned ? 'from-rose-500 to-red-600' : 'from-slate-400 to-slate-500'} loading={isLoading} />
        <Kpi icon={IndianRupee} label="Collected" value={s ? fmtMoney(s.amount) : null} sub={s?.amount_cash !== undefined ? `Cash ${fmtMoney(s.amount_cash)} · Online ${fmtMoney(s.amount_online)}` : "From completed jobs"} color="from-teal-400 to-cyan-600" loading={isLoading} />
        <Kpi icon={Timer} label="Avg Time" value={s?.avg_hours == null ? '—' : s.avg_hours < 1 ? `${Math.max(1, Math.round(s.avg_hours * 60))} min` : `${s.avg_hours} h`} sub="Assign → complete" color="from-fuchsia-500 to-purple-600" loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={54} outerRadius={78} paddingAngle={3} cornerRadius={6} stroke="none" dataKey="value">
                {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex justify-center gap-4 mt-1">
            {['Completed', 'Pending', 'Rejected'].map((l, i) => (
              <div key={l} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i] }} /><span className="text-xs text-slate-500">{l}</span></div>
            ))}
          </div>
        </div>
        <div className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">Daily Trend</h2>
            <div className="flex gap-1">
              {TREND_OPTIONS.map((o) => (
                <button key={o.days} onClick={() => setTrendDays(o.days)}
                  className={`chip py-1 ${trendDays === o.days ? 'chip-on' : 'chip-off'}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={trendData}>
              <defs>
                <linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.28} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient>
                <linearGradient id="gt" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1d55e0" stopOpacity={0.18} /><stop offset="95%" stopColor="#1d55e0" stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e3e8f2', fontSize: 12, boxShadow: '0 12px 30px -12px rgba(11,17,34,.3)' }} />
              <Area type="monotone" dataKey="total" name="Total" stroke="#1d55e0" fill="url(#gt)" strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              <Area type="monotone" dataKey="completed" name="Completed" stroke="#10b981" fill="url(#g)" strokeWidth={2.5} dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
              <Line type="monotone" dataKey="pending" name="Pending" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <BarList title="Orders by Service" items={br?.by_service} />
        <BarList title="Orders by Location" items={br?.by_location} />
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Technicians</h2>
          <div className="space-y-1.5">
            {leaders.map((t, i) => (
              <div key={t.id} className="flex items-center gap-2.5 py-1">
                <span className={`text-[10px] font-bold w-5 ${i < 3 ? 'text-amber-500' : 'text-slate-300'}`}>#{i + 1}</span>
                <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center text-[10px] font-bold text-brand-700 flex-shrink-0">{t.name[0]}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-slate-700 truncate">{t.name}{t.tech_code && <span className="ml-1 font-mono text-[10px] text-brand-600">{t.tech_code}</span>}</div>
                  <div className="text-[10px] text-slate-400">{fmtMoney(t.st.amount)} collected</div>
                </div>
                <span className="badge-completed" title="Completed">{t.st.completed}</span>
                {Number(t.st.pending) > 0 && <span className="badge-pending" title="Pending">{t.st.pending}</span>}
              </div>
            ))}
            {!leaders.length && <p className="text-sm text-slate-400 text-center py-4">No assigned orders in this range</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
