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
    <div className="card p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}><Icon size={18} className="text-white" /></div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        {loading ? <div className="h-7 w-16 bg-slate-100 animate-pulse rounded mt-1" /> : <p className="text-xl font-bold text-slate-900 mt-0.5 truncate">{value ?? '—'}</p>}
        <div className="flex items-center gap-2 mt-0.5">{sub && <p className="text-xs text-slate-400">{sub}</p>}<Delta value={delta} /></div>
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
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.round((b.count / max) * 100)}%` }} /></div>
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
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">Showing orders dated {rangeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {QUICK.map((q) => (
              <button key={q.key} onClick={() => pick(q)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium ${quick === q.key ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{q.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
            <input type="date" className="text-xs outline-none" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="text-xs text-slate-400">to</span>
            <input type="date" className="text-xs outline-none" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <button onClick={retrieve} className="btn-primary text-xs py-2 px-3"><Search size={12} /> Retrieve</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Package} label="Total Orders" value={s?.total} sub="All statuses" color="bg-brand-600" delta={s?.deltas?.total} loading={isLoading} />
        <Kpi icon={CheckCircle2} label="Completed" value={s?.completed} sub={`${s?.completion_rate ?? 0}% rate`} color="bg-emerald-500" delta={s?.deltas?.completed} loading={isLoading} />
        <Kpi icon={Clock} label="Pending" value={s?.pending} sub="Awaiting visit" color="bg-amber-500" loading={isLoading} />
        <Kpi icon={UserX} label="Unassigned" value={s?.unassigned} sub="Need a technician" color={s?.unassigned ? 'bg-red-500' : 'bg-slate-400'} loading={isLoading} />
        <Kpi icon={IndianRupee} label="Collected" value={s ? fmtMoney(s.amount) : null} sub="From completed jobs" color="bg-teal-600" loading={isLoading} />
        <Kpi icon={Timer} label="Avg Time" value={s?.avg_hours == null ? '—' : s.avg_hours < 1 ? `${Math.max(1, Math.round(s.avg_hours * 60))} min` : `${s.avg_hours} h`} sub="Assign → complete" color="bg-purple-500" loading={isLoading} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Status Distribution</h2>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" innerRadius={52} outerRadius={75} paddingAngle={3} dataKey="value">
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
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${trendDays === o.days ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>{o.label}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={trendData}>
              <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#10b981" stopOpacity={0.2} /><stop offset="95%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Area dataKey="total" name="Total" stroke="#2e8bff" fill="none" strokeWidth={1.5} dot={false} />
              <Area dataKey="completed" name="Completed" stroke="#10b981" fill="url(#g)" strokeWidth={2} dot={false} />
              <Line dataKey="pending" name="Pending" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
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
                  <div className="text-xs font-semibold text-slate-700 truncate">{t.name}</div>
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
