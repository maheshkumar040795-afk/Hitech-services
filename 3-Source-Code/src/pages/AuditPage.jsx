import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { supabase, rpc, fetchAll, errMsg } from '../lib/supabase'
import { fmtDateTime, todayIST } from '../lib/format'
import { downloadXlsx } from '../lib/excel'
import { useToast } from '../context/ToastContext'

const ACTION_META = {
  ORDER_CREATED: ['Created', 'bg-brand-100 text-brand-700'],
  STATUS_CHANGED: ['Status', 'bg-purple-100 text-purple-700'],
  TECH_ASSIGNED: ['Assigned', 'bg-emerald-100 text-emerald-700'],
  TECH_UNASSIGNED: ['Unassigned', 'bg-amber-100 text-amber-700'],
  AMOUNT_UPDATED: ['Amount', 'bg-teal-100 text-teal-700'],
  ORDER_DELETED: ['Deleted', 'bg-red-100 text-red-700'],
  ORDER_RESTORED: ['Restored', 'bg-green-100 text-green-700'],
  UPLOAD_EXCEL: ['Excel Upload', 'bg-sky-100 text-sky-700'],
  TECHNICIAN_CREATED: ['Tech Added', 'bg-cyan-100 text-cyan-700'],
  TECHNICIAN_UPDATED: ['Tech Updated', 'bg-slate-100 text-slate-600'],
  TECH_LOGIN_SET: ['App Login', 'bg-indigo-100 text-indigo-700'],
  USER_CREATED: ['User Created', 'bg-cyan-100 text-cyan-700'],
  USER_ROLE_CHANGED: ['Role Changed', 'bg-violet-100 text-violet-700'],
  USER_DEACTIVATED: ['Deactivated', 'bg-red-100 text-red-700'],
  USER_ACTIVATED: ['Activated', 'bg-green-100 text-green-700'],
  PASSWORD_RESET: ['Password Reset', 'bg-orange-100 text-orange-700'],
}
const meta = (a) => ACTION_META[a] || [a, 'bg-slate-100 text-slate-600']
const LIMIT = 30
const SELECT = 'id, action, note, created_at, actor:profiles(name, role), order:orders(order_id)'

export default function AuditPage() {
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [action, setAction] = useState('')
  const [exporting, setExporting] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page, action],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select(SELECT, { count: 'exact' })
      if (action) q = q.eq('action', action)
      const { data, count, error } = await q.order('created_at', { ascending: false }).range((page - 1) * LIMIT, page * LIMIT - 1)
      if (error) throw error
      return { logs: data, total: count || 0 }
    },
  })
  const { data: stats } = useQuery({ queryKey: ['audit-stats'], queryFn: () => rpc('audit_stats') })
  const { data: uploads } = useQuery({
    queryKey: ['upload-logs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('upload_logs').select('*, uploader:profiles(name)').order('created_at', { ascending: false }).limit(15)
      if (error) throw error
      return data
    },
  })

  const pages = Math.max(1, Math.ceil((data?.total || 0) / LIMIT))
  const exportLog = async () => {
    setExporting(true)
    try {
      const rows = await fetchAll(() => supabase.from('audit_logs').select(SELECT).order('created_at', { ascending: false }))
      downloadXlsx(`audit-log-${todayIST()}.xlsx`, [{ name: 'Audit Log', rows: rows.map((l) => ({
        'Date/Time': fmtDateTime(l.created_at, { dateStyle: 'medium', timeStyle: 'short' }), Action: meta(l.action)[0],
        'Done By': l.actor?.name || 'System', Role: l.actor?.role || '', 'Order ID': l.order?.order_id || '', Note: l.note || '',
      })) }])
    } catch (e) { toast(errMsg(e), 'error') } finally { setExporting(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Audit Log</h1><p className="text-sm text-slate-500 mt-0.5">Every change, who made it and when (recorded automatically by the database)</p></div>
        <button className="btn-primary text-xs" onClick={exportLog} disabled={exporting}><Download size={13} /> {exporting ? 'Exporting…' : 'Export'}</button>
      </div>

      {stats && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card p-4"><p className="text-xs font-semibold text-slate-400 uppercase">Last 7 days</p><p className="text-3xl font-bold text-slate-900">{stats.total_7d}</p><p className="text-xs text-slate-400">actions</p></div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Top actions</p>
            {stats.by_action.map((a) => <div key={a.action} className="flex justify-between text-xs py-0.5"><span className={`px-2 rounded-full ${meta(a.action)[1]}`}>{meta(a.action)[0]}</span><b>{a.count}</b></div>)}</div>
          <div className="card p-4"><p className="text-xs font-semibold text-slate-400 uppercase mb-2">Most active</p>
            {stats.top_actors.map((a) => <div key={a.name} className="flex justify-between text-xs py-0.5"><span>{a.name}</span><b>{a.count}</b></div>)}</div>
        </div>
      )}

      {uploads?.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100"><h2 className="text-sm font-semibold text-slate-700">Excel Upload History</h2></div>
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr className="bg-slate-50 border-b border-slate-200">{['When', 'By', 'File', 'New', 'Updated', 'Failed', 'Status'].map((h) => <th key={h} className="px-4 py-2 text-left text-[10px] font-bold text-slate-500 uppercase">{h}</th>)}</tr></thead>
            <tbody>{uploads.map((u) => (
              <tr key={u.id} className="border-b border-slate-50" title={u.error_message || ''}>
                <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDateTime(u.created_at)}</td>
                <td className="px-4 py-2 text-xs">{u.uploader?.name || '—'}</td>
                <td className="px-4 py-2 text-xs max-w-[200px] truncate">{u.filename}</td>
                <td className="px-4 py-2 text-xs font-semibold text-emerald-600">{u.records_created}</td>
                <td className="px-4 py-2 text-xs font-semibold text-brand-600">{u.records_updated}</td>
                <td className="px-4 py-2 text-xs font-semibold text-red-500">{u.records_failed}</td>
                <td className="px-4 py-2"><span className={u.status === 'SUCCESS' ? 'badge-completed' : u.status === 'FAILED' ? 'badge-rejected' : 'badge-pending'}>{u.status}</span></td>
              </tr>))}</tbody>
          </table></div>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-700">All activity</h2>
          <select className="input w-auto py-1.5 text-xs" value={action} onChange={(e) => { setAction(e.target.value); setPage(1) }}>
            <option value="">All actions</option>{Object.entries(ACTION_META).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto"><table className="w-full">
          <thead><tr className="bg-slate-50 border-b border-slate-200">{['Time', 'Action', 'By', 'Order', 'Details'].map((h) => <th key={h} className="px-4 py-2.5 text-left text-[10px] font-bold text-slate-500 uppercase">{h}</th>)}</tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">Loading…</td></tr>
              : !data?.logs?.length ? <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-400">No entries</td></tr>
              : data.logs.map((l) => (
                <tr key={l.id} className="border-b border-slate-50">
                  <td className="px-4 py-2.5 text-xs text-slate-400 whitespace-nowrap font-mono">{fmtDateTime(l.created_at)}</td>
                  <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${meta(l.action)[1]}`}>{meta(l.action)[0]}</span></td>
                  <td className="px-4 py-2.5 text-xs font-medium text-slate-700 whitespace-nowrap">{l.actor?.name || 'System'}{l.actor?.role === 'TECHNICIAN' && <span className="text-slate-400"> (tech)</span>}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-brand-600">{l.order?.order_id || '—'}</td>
                  <td className="px-4 py-2.5 text-xs text-slate-600 max-w-[340px]"><span className="block truncate" title={l.note}>{l.note}</span></td>
                </tr>))}
          </tbody>
        </table></div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Page {page} of {pages} · {data.total} entries</span>
            <div className="flex gap-1">
              <button className="btn-secondary p-1.5" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={14} /></button>
              <button className="btn-secondary p-1.5" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
