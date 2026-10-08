import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Search } from 'lucide-react'
import { supabase, rpc, errMsg, fetchAll } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtMoney, STATUS, todayIST, addDays } from '../lib/format'
import { downloadXlsx } from '../lib/excel'
import { useTechnicians } from '../hooks/useData'
import { useToast } from '../context/ToastContext'

const SELECT = 'id, order_id, order_date, customer_name, phone_no, service, brand, location, address, pin_code, status, cod_amount, comments, closed_at, modified_at, technician:technicians(name, mobile, city), modifier:profiles!orders_modified_by_fkey(name)'

function filtered(q, a) {
  q = q.eq('is_deleted', false).gte('order_date', a.from).lte('order_date', a.to)
  if (a.status) q = q.eq('status', a.status)
  if (a.tech === 'none') q = q.is('technician_id', null)
  else if (a.tech) q = q.eq('technician_id', a.tech)
  return q
}

export default function ReportsPage() {
  const { toast } = useToast()
  const { data: techs = [] } = useTechnicians()
  const [f, setF] = useState({ from: addDays(todayIST(), -6), to: todayIST(), status: '', tech: '' })
  const [active, setActive] = useState(f)
  const [exporting, setExporting] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  const { data, isLoading } = useQuery({
    queryKey: ['reports', active],
    queryFn: async () => {
      const [{ data: rows, count, error }, stats] = await Promise.all([
        filtered(supabase.from('orders').select(SELECT, { count: 'exact' }), active).order('order_date', { ascending: false }).limit(200),
        rpc('technician_stats', { p_from: active.from, p_to: active.to }),
      ])
      if (error) throw error
      const sum = await rpc('dashboard_summary', { p_from: active.from, p_to: active.to })
      return { rows, count: count || 0, stats, sum }
    },
  })

  const perf = (data?.stats || [])
    .map((s) => ({ ...s, name: techs.find((t) => t.id === s.technician_id)?.name || '—' }))
    .filter((s) => Number(s.total) > 0)
    .sort((a, b) => b.completed - a.completed)

  const exportExcel = async () => {
    setExporting(true)
    try {
      const rows = await fetchAll(() => filtered(supabase.from('orders')
        .select(SELECT + ', comment_logs(comment, created_at, user:profiles(name))'), active).order('order_date', { ascending: false }))
      const orders = rows.map((o) => ({
        Date: fmtDate(o.order_date), 'Order ID': o.order_id, 'Customer Name': o.customer_name, 'Phone No': o.phone_no || '',
        Service: o.service || '', Brand: o.brand || '', Location: o.location || '', Address: o.address || '', 'Pin Code': o.pin_code || '',
        Status: o.status, 'Amount Collected': Number(o.cod_amount || 0), Technician: o.technician?.name || 'Unassigned',
        'Tech Mobile': o.technician?.mobile || '', 'Closed At': o.closed_at ? fmtDateTime(o.closed_at) : '',
        Comments: (o.comment_logs || []).sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((c) => `[${c.user?.name || '?'} ${fmtDateTime(c.created_at)}] ${c.comment}`).join(' | ') || o.comments || '',
        'Modified By': o.modifier?.name || '', 'Modified At': o.modified_at ? fmtDateTime(o.modified_at) : '',
      }))
      const perfRows = perf.map((p) => ({ Technician: p.name, Total: Number(p.total), Completed: Number(p.completed), Pending: Number(p.pending),
        Rejected: Number(p.rejected), 'Completion %': Math.round((p.completed / p.total) * 100), 'Amount Collected': Number(p.amount) }))
      downloadXlsx(`hitech-report-${active.from}-to-${active.to}.xlsx`, [{ name: 'Orders', rows: orders }, { name: 'Technician Performance', rows: perfRows }])
    } catch (e) { toast(errMsg(e), 'error') } finally { setExporting(false) }
  }

  const s = data?.sum
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Reports</h1><p className="text-sm text-slate-500 mt-0.5">Filter, review and export to Excel</p></div>
        <button onClick={exportExcel} disabled={exporting} className="btn-primary text-xs"><Download size={13} /> {exporting ? 'Exporting…' : 'Export Excel'}</button>
      </div>

      <div className="card p-4 flex flex-wrap gap-3 items-end">
        {[['From', 'from'], ['To', 'to']].map(([l, k]) => (
          <div key={k}><label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">{l}</label><input type="date" className="input py-2" value={f[k]} onChange={set(k)} /></div>
        ))}
        <div><label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Status</label>
          <select className="input py-2" value={f.status} onChange={set('status')}><option value="">All</option>{Object.keys(STATUS).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}</select></div>
        <div><label className="block text-[10px] font-semibold text-slate-500 uppercase mb-1">Technician</label>
          <select className="input py-2" value={f.tech} onChange={set('tech')}><option value="">All</option><option value="none">Unassigned</option>{techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <button onClick={() => setActive(f)} className="btn-primary text-xs py-2.5"><Search size={12} /> Retrieve</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[['Total', s?.total], ['Completed', s?.completed], ['Pending', s?.pending], ['Rejected', s?.rejected], ['Collected', s ? fmtMoney(s.amount) : null]].map(([l, v]) => (
          <div key={l} className="card p-4"><p className="text-xs text-slate-500">{l}</p><p className="text-xl font-bold text-slate-900">{v ?? '—'}</p></div>
        ))}
      </div>
      {(active.status || active.tech) && <p className="text-xs text-slate-400 -mt-2">Cards above show all orders in the date range; the table and export use all filters.</p>}

      {perf.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100"><h2 className="text-sm font-semibold text-slate-700">Technician Performance</h2></div>
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="bg-slate-50 border-b border-slate-200">{['Technician', 'Total', 'Completed', 'Pending', 'Rejected', 'Rate', 'Collected'].map((h) => <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">{h}</th>)}</tr></thead>
            <tbody>{perf.map((t) => (
              <tr key={t.technician_id} className="border-b border-slate-50">
                <td className="px-4 py-2.5 text-sm font-medium text-slate-800">{t.name}</td><td className="px-4 py-2.5 text-sm">{t.total}</td>
                <td className="px-4 py-2.5"><span className="badge-completed">{t.completed}</span></td><td className="px-4 py-2.5"><span className="badge-pending">{t.pending}</span></td>
                <td className="px-4 py-2.5"><span className="badge-rejected">{t.rejected}</span></td>
                <td className="px-4 py-2.5 text-sm font-semibold text-brand-600">{Math.round((t.completed / t.total) * 100)}%</td>
                <td className="px-4 py-2.5 text-sm font-semibold">{fmtMoney(t.amount)}</td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex justify-between"><h2 className="text-sm font-semibold text-slate-700">Orders</h2>
          {data && <span className="text-xs text-slate-400">{data.count > 200 ? `Showing 200 of ${data.count} — export for all` : `${data.count} orders`}</span>}</div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">{['Date', 'Order ID', 'Customer', 'Service', 'Location', 'Technician', 'Status', 'Amount', 'Comment'].map((h) => <th key={h} className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
              : !data?.rows?.length ? <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">No orders for these filters</td></tr>
              : data.rows.map((o) => (
                <tr key={o.id} className="border-b border-slate-50">
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{fmtDate(o.order_date)}</td>
                  <td className="px-3 py-2 font-mono text-xs text-brand-600">{o.order_id}</td>
                  <td className="px-3 py-2 text-xs font-medium">{o.customer_name}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 max-w-[150px] truncate">{o.service}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{o.location}</td>
                  <td className="px-3 py-2 text-xs">{o.technician?.name || '—'}</td>
                  <td className="px-3 py-2"><span className={STATUS[o.status].badge}>{STATUS[o.status].label}</span></td>
                  <td className="px-3 py-2 text-xs">{fmtMoney(o.cod_amount)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 max-w-[200px] truncate">{o.comments || '—'}</td>
                </tr>))}
          </tbody>
        </table></div>
      </div>
    </div>
  )
}
