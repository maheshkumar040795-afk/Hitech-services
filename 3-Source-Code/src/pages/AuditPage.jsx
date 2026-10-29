import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download, Search, History, FileSpreadsheet, Users } from 'lucide-react'
import { supabase, rpc, errMsg, safeSearch } from '../lib/supabase'
import { fmtDateTime, todayIST, STATUS } from '../lib/format'
import { downloadXlsx } from '../lib/excel'
import { useToast } from '../context/ToastContext'
import OrderDrawer from '../components/OrderDrawer'

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
  PIN_RESET_REQUESTED: ['Forgot PIN', 'bg-amber-100 text-amber-700'],
  USER_CREATED: ['User Created', 'bg-cyan-100 text-cyan-700'],
  USER_ROLE_CHANGED: ['Role Changed', 'bg-violet-100 text-violet-700'],
  USER_DEACTIVATED: ['Deactivated', 'bg-red-100 text-red-700'],
  USER_ACTIVATED: ['Activated', 'bg-green-100 text-green-700'],
  PASSWORD_RESET: ['Password Reset', 'bg-orange-100 text-orange-700'],
}
const meta = (a) => ACTION_META[a] || [a, 'bg-slate-100 text-slate-600']
const LIMIT = 20
const Chip = ({ action }) => <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${meta(action)[1]}`}>{meta(action)[0]}</span>

/** Order-wise: latest-changed orders first, each with its last 3 changes (older ones are deleted by the database) */
async function loadOrderAudit(search, page) {
  try {
    return await rpc('audit_by_order', { p_search: search || null, p_limit: LIMIT, p_offset: (page - 1) * LIMIT })
  } catch (e) {
    if (!/audit_by_order|schema cache/i.test(e?.message || '')) throw e
    // Database update not run yet → group the latest entries here (lighter than before: one small query)
    const { data, error } = await supabase.from('audit_logs')
      .select('action, note, created_at, order_id, actor:profiles(name, role), order:orders(id, order_id, customer_name, status)')
      .not('order_id', 'is', null).order('created_at', { ascending: false }).limit(200)
    if (error) throw error
    const map = new Map()
    for (const l of data) {
      if (!l.order) continue
      if (search && ![l.order.order_id, l.order.customer_name].some((v) => v?.toLowerCase().includes(search.toLowerCase()))) continue
      const g = map.get(l.order_id) || { ...l.order, last_at: l.created_at, changes: [] }
      if (g.changes.length < 3) g.changes.push({ action: l.action, note: l.note, at: l.created_at, by: l.actor?.name || 'System', role: l.actor?.role })
      map.set(l.order_id, g)
    }
    const all = [...map.values()]
    return { total: all.length, rows: all.slice((page - 1) * LIMIT, page * LIMIT) }
  }
}

export default function AuditPage() {
  const { toast } = useToast()
  const [page, setPage] = useState(1)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [exporting, setExporting] = useState(false)
  useEffect(() => { const t = setTimeout(() => { setSearch(safeSearch(input) || ''); setPage(1) }, 400); return () => clearTimeout(t) }, [input])

  const { data, isLoading, error } = useQuery({ queryKey: ['audit', 'orders', search, page], queryFn: () => loadOrderAudit(search, page), placeholderData: (p) => p })
  const { data: other = [] } = useQuery({
    queryKey: ['audit', 'other'],
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_logs').select('id, action, note, created_at, actor:profiles(name)')
        .is('order_id', null).order('created_at', { ascending: false }).limit(8)
      if (error) throw error
      return data
    },
  })
  const { data: uploads = [] } = useQuery({
    queryKey: ['upload-logs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('upload_logs').select('id, filename, created_at, records_created, records_updated, records_failed, status, error_message, uploader:profiles(name)')
        .order('created_at', { ascending: false }).limit(5)
      if (error) throw error
      return data
    },
  })

  const rows = data?.rows || []
  const pages = Math.max(1, Math.ceil((data?.total || 0) / LIMIT))
  const exportLog = async () => {
    setExporting(true)
    try {
      const all = []
      for (let p = 1; p <= 50; p++) {
        const r = await loadOrderAudit(search, p); all.push(...r.rows)
        if (r.rows.length < LIMIT) break
      }
      downloadXlsx(`audit-log-${todayIST()}.xlsx`, [{ name: 'Audit Log', rows: all.flatMap((o) => o.changes.map((c) => ({
        'Order ID': o.order_id, Customer: o.customer_name, Change: meta(c.action)[0], Details: c.note || '', By: c.by, 'Date/Time': fmtDateTime(c.at, { dateStyle: 'medium', timeStyle: 'short' }),
      }))) }])
    } catch (e) { toast(errMsg(e), 'error') } finally { setExporting(false) }
  }

  return (
    <div className="space-y-5">
      {detailId && <OrderDrawer orderId={detailId} onClose={() => setDetailId(null)} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-0.5">Who changed each order — last 3 changes kept, older ones removed automatically</p>
        </div>
        <button className="btn-secondary text-xs" onClick={exportLog} disabled={exporting}><Download size={13} /> {exporting ? 'Exporting…' : 'Export'}</button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-heading font-bold text-slate-800 flex items-center gap-2"><History size={15} className="text-brand-600" /> Orders</h2>
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9 py-2" placeholder="Search order ID or customer…" value={input} onChange={(e) => setInput(e.target.value)} />
          </div>
        </div>
        {error ? <p className="px-4 py-10 text-center text-sm text-red-500">{errMsg(error)}</p>
          : isLoading ? <p className="px-4 py-10 text-center text-sm text-slate-400">Loading…</p>
          : !rows.length ? <p className="px-4 py-10 text-center text-sm text-slate-400">No changes recorded{search ? ' for this search' : ''}</p>
          : (
            <ul className="divide-y divide-slate-100">
              {rows.map((o) => {
                const last = o.changes[0]
                const st = STATUS[o.status]
                return (
                  <li key={o.id} className="px-4 py-3 hover:bg-brand-50/30 transition-colors">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button onClick={() => setDetailId(o.id)} className="font-mono text-xs font-semibold text-brand-600 hover:underline">{o.order_id}</button>
                      <span className="text-sm font-semibold text-slate-800">{o.customer_name}</span>
                      {st && <span className={st.badge}>{st.label}</span>}
                      <span className="ml-auto text-[11px] text-slate-500">Last modified by <b className="text-slate-700">{last?.by}</b>{last?.role === 'TECHNICIAN' ? ' (tech)' : ''} · {fmtDateTime(last?.at)}</span>
                    </div>
                    <ol className="mt-2 space-y-1">
                      {o.changes.map((c, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === 0 ? 'bg-brand-500' : 'bg-slate-300'}`} />
                          <Chip action={c.action} />
                          <span className="text-slate-600 truncate flex-1 min-w-0" title={c.note}>{c.note}</span>
                          <span className="text-[10px] text-slate-400 whitespace-nowrap">{c.by} · {fmtDateTime(c.at)}</span>
                        </li>
                      ))}
                    </ol>
                  </li>
                )
              })}
            </ul>
          )}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Page {page} of {pages} · {data.total} orders</span>
            <div className="flex gap-1">
              <button className="btn-secondary p-1.5" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft size={14} /></button>
              <button className="btn-secondary p-1.5" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages}><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-0 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-heading font-bold text-slate-800 flex items-center gap-2"><Users size={15} className="text-brand-600" /> Technicians & users</h2>
          <ul className="divide-y divide-slate-50">
            {other.map((l) => (
              <li key={l.id} className="px-4 py-2.5 flex items-center gap-2 text-xs min-w-0">
                <Chip action={l.action} />
                <span className="text-slate-600 truncate flex-1 min-w-0" title={l.note}>{l.note}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{l.actor?.name || 'System'} · {fmtDateTime(l.created_at)}</span>
              </li>
            ))}
            {!other.length && <li className="px-4 py-6 text-center text-xs text-slate-400">No changes</li>}
          </ul>
        </div>
        <div className="card p-0 overflow-hidden">
          <h2 className="px-4 py-3 border-b border-slate-100 text-sm font-heading font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet size={15} className="text-brand-600" /> Excel uploads</h2>
          <ul className="divide-y divide-slate-50">
            {uploads.map((u) => (
              <li key={u.id} className="px-4 py-2.5 flex items-center gap-2 text-xs min-w-0" title={u.error_message || ''}>
                <span className={u.status === 'SUCCESS' ? 'badge-completed' : u.status === 'FAILED' ? 'badge-rejected' : 'badge-pending'}>{u.status}</span>
                <span className="text-slate-700 truncate flex-1 min-w-0">{u.filename}</span>
                <span className="text-[11px] whitespace-nowrap"><b className="text-emerald-600">{u.records_created}</b> new · <b className="text-brand-600">{u.records_updated}</b> upd{u.records_failed ? <> · <b className="text-red-500">{u.records_failed}</b> failed</> : null}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{u.uploader?.name || '—'} · {fmtDateTime(u.created_at)}</span>
              </li>
            ))}
            {!uploads.length && <li className="px-4 py-6 text-center text-xs text-slate-400">No uploads yet</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}
