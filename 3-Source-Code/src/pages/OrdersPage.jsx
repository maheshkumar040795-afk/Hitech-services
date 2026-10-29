import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Search, Upload, Download, Eye, MessageSquare, X, ChevronLeft, ChevronRight, Plus, FileDown, Trash2, AlertTriangle, CheckCircle2, Pencil, MapPin, CalendarClock, Save } from 'lucide-react'
import { supabase, rpc, errMsg, fetchAll, safeSearch } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtDayIST, STATUS, PAYMENT, todayIST, techLabel, isUrl } from '../lib/format'
import { parseOrdersFile, downloadOrdersTemplate, downloadXlsx } from '../lib/excel'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useTechnicians } from '../hooks/useData'
import OrderDrawer from '../components/OrderDrawer'
import TechPicker from '../components/TechPicker'
import Modal, { Field } from '../components/Modal'

const LIMIT = 25
// '*' so new columns (location_url, rescheduled_date, payment_mode) come through without breaking older databases
const SELECT = '*, technician:technicians(id,name), modifier:profiles!orders_modified_by_fkey(name)'

function applyFilters(q, f) {
  q = q.eq('is_deleted', false)
  if (f.status) q = q.eq('status', f.status)
  if (f.tech === 'none') q = q.is('technician_id', null)
  else if (f.tech) q = q.eq('technician_id', f.tech)
  if (f.from) q = q.gte('order_date', f.from)
  if (f.to) q = q.lte('order_date', f.to)
  const s = safeSearch(f.search)
  if (s) q = q.or(['order_id', 'customer_name', 'phone_no', 'location', 'pin_code', 'service'].map((c) => `${c}.ilike.*${s}*`).join(','))
  return q
}

// ── Upload: preview → import → result ─────────────────────────────────────────
function UploadModal({ file, parsed, onClose, onDone }) {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const run = async () => {
    setBusy(true)
    try {
      const r = await rpc('import_orders', { p_rows: parsed.rows, p_filename: file.name })
      setResult(r)
      onDone()
      toast(`Upload done: ${r.created} new, ${r.updated} updated${r.failed ? `, ${r.failed} failed` : ''}`, r.failed ? 'info' : 'success')
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }
  const preview = parsed.rows.slice(0, 5)
  return (
    <Modal title={result ? 'Upload complete' : 'Upload orders'} subtitle={file.name} onClose={onClose} width="max-w-2xl">
      {!result ? (
        <>
          <p className="text-sm text-slate-700 mb-2"><b>{parsed.rows.length}</b> rows found. Columns detected:</p>
          <div className="flex flex-wrap gap-1 mb-4">
            {parsed.columns.map((c) => <span key={c} className="text-[10px] font-mono bg-brand-50 text-brand-700 px-2 py-0.5 rounded">{c}</span>)}
          </div>
          <div className="overflow-x-auto border border-slate-200 rounded-xl mb-4">
            <table className="w-full text-[11px]">
              <thead className="bg-slate-50"><tr>{['Date', 'Order ID', 'Customer', 'Location', 'Technician', 'Status'].map((h) => <th key={h} className="px-2 py-1.5 text-left text-slate-500">{h}</th>)}</tr></thead>
              <tbody>{preview.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{r.order_date ? fmtDate(r.order_date) : <span className="text-amber-600">today</span>}</td>
                  <td className="px-2 py-1.5 font-mono">{r.order_id}</td><td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5">{r.location}</td><td className="px-2 py-1.5">{r.technician || '—'}</td><td className="px-2 py-1.5">{r.status || 'Pending'}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          <ul className="text-xs text-slate-500 space-y-1 mb-5 list-disc pl-4">
            <li>Existing ORDER IDs are updated, not duplicated.</li>
            <li>Status and technician from the file only change orders that are still <b>Pending</b>. Completed work is never undone.</li>
            <li>Technician names not found are added automatically. Give them a mobile number and app login on the Technicians page.</li>
          </ul>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            <button onClick={run} disabled={busy} className="btn-primary text-xs"><Upload size={13} /> {busy ? 'Importing…' : `Import ${parsed.rows.length} rows`}</button>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {[['New', result.created, 'text-emerald-600'], ['Updated', result.updated, 'text-brand-600'], ['Failed', result.failed, 'text-red-500']].map(([l, v, c]) => (
              <div key={l} className="bg-slate-50 rounded-xl p-3 text-center"><p className={`text-2xl font-bold ${c}`}>{v}</p><p className="text-xs text-slate-500">{l}</p></div>
            ))}
          </div>
          {result.errors?.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-3 mb-4 max-h-48 overflow-y-auto">
              <p className="text-xs font-semibold text-red-700 mb-1 flex items-center gap-1"><AlertTriangle size={12} /> Rows not imported</p>
              {result.errors.map((e, i) => <p key={i} className="text-xs text-red-700">Row {e.row}: {e.error}</p>)}
            </div>
          )}
          <div className="flex justify-end"><button onClick={onClose} className="btn-primary text-xs"><CheckCircle2 size={13} /> Done</button></div>
        </>
      )}
    </Modal>
  )
}

const ORDER_FIELDS = ['order_id', 'order_date', 'customer_name', 'phone_no', 'service', 'brand', 'location', 'address', 'pin_code', 'location_url', 'technician_id']

/** Add a new order, or edit an existing one to fill in missed details */
function OrderFormModal({ order, techs, onClose, onSaved }) {
  const { toast } = useToast()
  const editing = !!order
  const [f, setF] = useState(() => {
    const base = { order_id: '', order_date: todayIST(), customer_name: '', phone_no: '', service: '', brand: '', location: '', address: '', pin_code: '', location_url: '', technician_id: '' }
    if (!order) return base
    const o = Object.fromEntries(ORDER_FIELDS.map((k) => [k, order[k] ?? '']))
    return { ...base, ...o, cod_amount: order.cod_amount ?? 0, payment_mode: order.payment_mode || '' }
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const completed = order?.status === 'COMPLETED'
  const save = async (e) => {
    e.preventDefault()
    const row = Object.fromEntries(ORDER_FIELDS.map((k) => [k, typeof f[k] === 'string' ? f[k].trim() || null : f[k]]))
    if (row.location_url && !isUrl(row.location_url)) return toast('Google location must be a link starting with https://', 'error')
    if (editing && !row.location_url && !order.location_url) delete row.location_url   // older database without the column
    if (completed) {
      row.cod_amount = Math.max(0, parseFloat(f.cod_amount) || 0)
      row.payment_mode = row.cod_amount > 0 ? (f.payment_mode || null) : null
    }
    setBusy(true)
    const { error } = editing
      ? await supabase.from('orders').update(row).eq('id', order.id)
      : await supabase.from('orders').insert(row)
    setBusy(false)
    if (error) return toast(error.code === '23505' ? 'This Order ID already exists' : errMsg(error), 'error')
    toast(editing ? 'Order updated' : 'Order added', 'success'); onSaved(); onClose()
  }
  return (
    <Modal title={editing ? 'Edit order' : 'New order'} subtitle={editing ? `${order.order_id} · fill in or correct details` : 'For jobs that are not in the Excel file'} onClose={onClose} width="max-w-xl">
      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Order ID *"><input className="input" value={f.order_id} onChange={set('order_id')} required /></Field>
        <Field label="Order Date *"><input type="date" className="input" value={f.order_date} onChange={set('order_date')} required /></Field>
        <Field label="Customer Name *"><input className="input" value={f.customer_name} onChange={set('customer_name')} required /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone_no} onChange={set('phone_no')} /></Field>
        <Field label="Service"><input className="input" value={f.service} onChange={set('service')} placeholder="AC Installation Service" /></Field>
        <Field label="Brand"><input className="input" value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Location / Area"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Pin Code"><input className="input" inputMode="numeric" value={f.pin_code} onChange={set('pin_code')} /></Field>
        <div className="sm:col-span-2"><Field label="Full Address"><input className="input" value={f.address} onChange={set('address')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Google location URL" hint="Paste the link from Google Maps → Share. The technician's Map button opens this exact spot.">
          <div className="relative"><MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" inputMode="url" placeholder="https://maps.app.goo.gl/…" value={f.location_url} onChange={set('location_url')} /></div>
        </Field></div>
        <div className="sm:col-span-2"><Field label="Assign Technician">
          <TechPicker techs={techs} value={f.technician_id || ''} onChange={(v) => setF((p) => ({ ...p, technician_id: v }))}
            extra={[{ value: '', label: '— Unassigned —' }]} placeholder="— Unassigned —" className="w-full" /></Field></div>
        {completed && <>
          <Field label="Amount collected ₹"><input type="number" min="0" step="0.01" className="input" value={f.cod_amount} onChange={set('cod_amount')} /></Field>
          <Field label="Payment">
            <select className="input" value={f.payment_mode} onChange={set('payment_mode')}>
              <option value="">—</option><option value="CASH">Cash</option><option value="ONLINE">Online</option>
            </select></Field>
        </>}
        <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button disabled={busy} className="btn-primary text-xs">{editing ? <Save size={13} /> : <Plus size={13} />} {busy ? 'Saving…' : editing ? 'Save changes' : 'Add Order'}</button>
        </div>
      </form>
    </Modal>
  )
}

/** Status → Rescheduled: pick the new visit date */
function RescheduleModal({ orders, onClose, onSave }) {
  const current = orders.length === 1 ? orders[0].rescheduled_date : null
  const [date, setDate] = useState(current || todayIST())
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    if (!date) return
    setBusy(true); await onSave(date); setBusy(false)
  }
  return (
    <Modal title="Reschedule" subtitle={orders.length === 1 ? `${orders[0].order_id} · ${orders[0].customer_name}` : `${orders.length} orders`} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {orders.length === 1 && <p className="text-xs text-slate-500">Order date: <b>{fmtDate(orders[0].order_date)}</b>{current ? <> · currently rescheduled to <b>{fmtDate(current)}</b></> : null}</p>}
        <Field label="New visit date *" hint="The job stays in the technician's Pending list with this date.">
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required autoFocus />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button disabled={busy || !date} className="btn-primary text-xs"><CalendarClock size={13} /> {busy ? 'Saving…' : 'Reschedule'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function OrdersPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { isAdmin } = useAuth()
  const fileRef = useRef(null)
  const { data: techs = [] } = useTechnicians()

  const [params] = useSearchParams()
  const [searchInput, setSearchInput] = useState('')
  const [f, setF] = useState({ search: '', status: params.get('status') || '', tech: params.get('tech') || '', from: '', to: '' })
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [detailId, setDetailId] = useState(null)
  const [upload, setUpload] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [editOrder, setEditOrder] = useState(null)
  const [resched, setResched] = useState(null) // orders being rescheduled
  const [bulkTech, setBulkTech] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { const t = setTimeout(() => { setF((p) => ({ ...p, search: searchInput })); setPage(1) }, 400); return () => clearTimeout(t) }, [searchInput])
  const setFilter = (k) => (e) => { setF((p) => ({ ...p, [k]: e.target.value })); setPage(1); setSelected(new Set()) }

  const { data, isLoading } = useQuery({
    queryKey: ['orders', f, page],
    queryFn: async () => {
      const { data, count, error } = await applyFilters(supabase.from('orders').select(SELECT, { count: 'exact' }), f)
        .order('order_date', { ascending: false }).order('created_at', { ascending: false })
        .range((page - 1) * LIMIT, page * LIMIT - 1)
      if (error) throw error
      return { orders: data, total: count || 0 }
    },
    placeholderData: (prev) => prev,
  })
  const orders = data?.orders || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / LIMIT))
  const refresh = () => { qc.invalidateQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); qc.invalidateQueries({ queryKey: ['technicians'] }) }

  const update = async (ids, patch, okMsg) => {
    setBusy(true)
    const { error } = await supabase.from('orders').update(patch).in('id', ids)
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    if (okMsg) toast(okMsg, 'success')
    refresh()
  }

  const onFile = async (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try { setUpload({ file, parsed: await parseOrdersFile(file) }) } catch (err) { toast(err.message, 'error') }
  }

  const exportFiltered = async () => {
    setBusy(true)
    try {
      const rows = await fetchAll(() => applyFilters(supabase.from('orders').select(SELECT), f).order('order_date', { ascending: false }))
      downloadXlsx(`hitech-orders-${todayIST()}.xlsx`, [{ name: 'Orders', rows: rows.map((o) => ({
        'Order Date': fmtDate(o.order_date), 'Rescheduled To': o.rescheduled_date ? fmtDate(o.rescheduled_date) : '', 'Order ID': o.order_id, 'Customer Name': o.customer_name, 'Phone No': o.phone_no || '',
        Service: o.service || '', Brand: o.brand || '', Location: o.location || '', Address: o.address || '', 'Pin Code': o.pin_code || '', 'Google Location': o.location_url || '',
        'Technician ID': techs.find((t) => t.id === o.technician_id)?.tech_code || '', Technician: o.technician?.name || 'Unassigned', Status: STATUS[o.status]?.label || o.status,
        'Completed On': o.status === 'COMPLETED' && o.closed_at ? fmtDayIST(o.closed_at) : '', 'Not Done On': o.status === 'REJECTED' && o.closed_at ? fmtDayIST(o.closed_at) : '',
        Amount: Number(o.cod_amount || 0), Payment: PAYMENT[o.payment_mode] || '', Comments: o.comments || '',
        'Modified By': o.modifier?.name || '', 'Modified At': o.modified_at ? fmtDateTime(o.modified_at) : '',
      })) }])
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const allSel = orders.length > 0 && orders.every((o) => selected.has(o.id))
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(orders.map((o) => o.id)))
  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s) }
  const filtersOn = f.search || f.status || f.tech || f.from || f.to

  return (
    <div className="space-y-4">
      {detailId && <OrderDrawer orderId={detailId} onClose={() => setDetailId(null)} />}
      {upload && <UploadModal {...upload} onClose={() => setUpload(null)} onDone={refresh} />}
      {showNew && <OrderFormModal techs={techs} onClose={() => setShowNew(false)} onSaved={refresh} />}
      {editOrder && <OrderFormModal order={editOrder} techs={techs} onClose={() => setEditOrder(null)} onSaved={refresh} />}
      {resched && <RescheduleModal orders={resched} onClose={() => setResched(null)}
        onSave={async (date) => { await update(resched.map((o) => o.id), { status: 'RESCHEDULED', rescheduled_date: date }, `${resched.length === 1 ? resched[0].order_id : resched.length + ' orders'} rescheduled to ${fmtDate(date)}`); setResched(null); setSelected(new Set()) }} />}
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={onFile} />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">Orders</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} {filtersOn ? 'matching' : 'total'} orders</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={downloadOrdersTemplate} className="btn-secondary text-xs"><Download size={13} /> Template</button>
          <button onClick={exportFiltered} disabled={busy} className="btn-secondary text-xs"><FileDown size={13} /> Export</button>
          <button onClick={() => setShowNew(true)} className="btn-secondary text-xs"><Plus size={13} /> New Order</button>
          <button onClick={() => fileRef.current?.click()} className="btn-primary text-xs"><Upload size={13} /> Upload Excel</button>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 py-2" placeholder="Search order ID, customer, phone, location, pincode…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <select className="input w-auto py-2" value={f.status} onChange={setFilter('status')}>
          <option value="">All statuses</option><option value="PENDING">Pending</option><option value="RESCHEDULED">Rescheduled</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option>
        </select>
        <TechPicker techs={techs} value={f.tech} activeOnly={false} showLoad={false} placeholder="All technicians" className="w-auto min-w-[180px]"
          extra={[{ value: '', label: 'All technicians' }, { value: 'none', label: '⚠ Unassigned' }]}
          onChange={(v) => { setF((p) => ({ ...p, tech: v })); setPage(1); setSelected(new Set()) }} />
        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl px-3 py-1.5">
          <input type="date" className="text-xs outline-none" value={f.from} onChange={setFilter('from')} title="From date" />
          <span className="text-xs text-slate-400">to</span>
          <input type="date" className="text-xs outline-none" value={f.to} onChange={setFilter('to')} title="To date" />
        </div>
        {filtersOn && <button onClick={() => { setSearchInput(''); setF({ search: '', status: '', tech: '', from: '', to: '' }); setPage(1) }} className="btn-secondary text-xs py-2"><X size={12} /> Clear</button>}
      </div>

      {selected.size > 0 && (
        <div className="card p-3 bg-brand-50 border-brand-200 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-brand-700 mr-2">{selected.size} selected</span>
          <TechPicker techs={techs} value={bulkTech} onChange={setBulkTech} placeholder="Assign to…" className="w-auto min-w-[200px] py-1.5 text-xs"
            extra={[{ value: 'none', label: '— Unassign —' }]} />
          <button disabled={!bulkTech || busy} className="btn-primary text-xs py-1.5"
            onClick={() => update([...selected], { technician_id: bulkTech === 'none' ? null : bulkTech }, `${selected.size} orders ${bulkTech === 'none' ? 'unassigned' : 'assigned'}`).then(() => { setSelected(new Set()); setBulkTech('') })}>Assign</button>
          <span className="w-px h-6 bg-brand-200 mx-1" />
          {['PENDING', 'COMPLETED', 'REJECTED'].map((s) => (
            <button key={s} disabled={busy} onClick={() => update([...selected], { status: s }, `${selected.size} orders → ${STATUS[s].label}`).then(() => setSelected(new Set()))}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${STATUS[s].bg} ${STATUS[s].text} ${STATUS[s].border}`}>→ {STATUS[s].label}</button>
          ))}
          <button disabled={busy} onClick={() => setResched(orders.filter((o) => selected.has(o.id)))}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${STATUS.RESCHEDULED.bg} ${STATUS.RESCHEDULED.text} ${STATUS.RESCHEDULED.border}`}>→ Reschedule…</button>
          {isAdmin && <button disabled={busy} className="btn-danger text-xs py-1.5" onClick={() => {
            if (confirm(`Delete ${selected.size} orders? They will be hidden everywhere (can be restored from the database).`))
              update([...selected], { is_deleted: true }, 'Orders deleted').then(() => setSelected(new Set()))
          }}><Trash2 size={12} /> Delete</button>}
          <button onClick={() => setSelected(new Set())} className="btn-secondary text-xs py-1.5 ml-auto"><X size={13} /></button>
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-3 w-10"><input type="checkbox" checked={allSel} onChange={toggleAll} /></th>
                {['Date', 'Order ID', 'Customer', 'Phone', 'Service', 'Location', 'Pin', 'Technician', 'Status', 'Completed', 'Amount ₹', 'Comment', 'Modified', ''].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-50"><td colSpan={15} className="px-3 py-3"><div className="h-4 bg-slate-100 animate-pulse rounded" /></td></tr>
              )) : orders.length === 0 ? (
                <tr><td colSpan={15} className="px-3 py-12 text-center text-sm text-slate-400">No orders found</td></tr>
              ) : orders.map((o) => {
                const sc = STATUS[o.status] || STATUS.PENDING
                return (
                  <tr key={o.id} className={`border-b border-slate-50 hover:bg-slate-50/80 ${selected.has(o.id) ? 'bg-brand-50/50' : ''}`}>
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-600">{fmtDate(o.order_date)}
                      {o.rescheduled_date && <div className="text-[10px] font-semibold text-sky-700 flex items-center gap-0.5" title="Rescheduled to"><CalendarClock size={10} /> {fmtDate(o.rescheduled_date)}</div>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><button onClick={() => setDetailId(o.id)} className="font-mono text-xs text-brand-600 font-semibold hover:underline">{o.order_id}</button></td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-800 whitespace-nowrap">{o.customer_name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{o.phone_no}</td>
                    <td className="px-3 py-2 max-w-[150px]"><span className="text-xs text-slate-600 line-clamp-2">{o.service}{o.brand ? ` · ${o.brand}` : ''}</span></td>
                    <td className="px-3 py-2 text-xs text-slate-600">{o.location}{isUrl(o.location_url) && <a href={o.location_url} target="_blank" rel="noreferrer" title="Open Google location" className="ml-1 inline-flex align-middle text-emerald-600 hover:text-emerald-700"><MapPin size={12} /></a>}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{o.pin_code}</td>
                    <td className="px-3 py-2">
                      <TechPicker size="sm" techs={techs} value={o.technician_id || ''} disabled={busy} danger={!o.technician_id}
                        placeholder="Unassigned" extra={[{ value: '', label: 'Unassigned' }]}
                        onChange={(v) => {
                          const t = techs.find((x) => x.id === v)
                          update([o.id], { technician_id: v || null }, t ? `${o.order_id} assigned to ${techLabel(t)}` : `${o.order_id} unassigned`)
                        }} />
                    </td>
                    <td className="px-3 py-2">
                      <select value={o.status} disabled={busy} onChange={(e) => e.target.value === 'RESCHEDULED' ? setResched([o]) : update([o.id], { status: e.target.value }, `${o.order_id} → ${STATUS[e.target.value].label}`)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <option value="PENDING">Pending</option><option value="RESCHEDULED">Rescheduled</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option>
                      </select>
                      {o.status === 'RESCHEDULED' && <button onClick={() => setResched([o])} className="block mt-0.5 text-[10px] font-semibold text-sky-700 hover:underline whitespace-nowrap">to {fmtDate(o.rescheduled_date)} · change</button>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[11px]">
                      {o.status === 'COMPLETED' && o.closed_at ? <span className="text-emerald-700 font-semibold" title={fmtDateTime(o.closed_at)}>{fmtDayIST(o.closed_at)}</span>
                        : o.status === 'REJECTED' && o.closed_at ? <span className="text-red-600" title={`Not done · ${fmtDateTime(o.closed_at)}`}>{fmtDayIST(o.closed_at)}</span>
                        : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <input key={`${o.id}-${o.cod_amount}`} type="number" min="0" step="0.01" defaultValue={Number(o.cod_amount || 0)}
                        className="w-20 text-xs px-2 py-1 border border-slate-200 rounded-lg text-right"
                        onBlur={(e) => { const v = Math.max(0, parseFloat(e.target.value) || 0); if (v !== Number(o.cod_amount || 0)) update([o.id], { cod_amount: v }, 'Amount saved') }} />
                      {o.status === 'COMPLETED' && Number(o.cod_amount) > 0 && (
                        <select value={o.payment_mode || ''} disabled={busy} title="Cash or Online"
                          onChange={(e) => update([o.id], { payment_mode: e.target.value || null }, `Payment: ${PAYMENT[e.target.value] || 'not set'}`)}
                          className={`block mt-1 w-20 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${o.payment_mode === 'ONLINE' ? 'bg-violet-50 text-violet-700 border-violet-200' : o.payment_mode === 'CASH' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                          <option value="">Mode?</option><option value="CASH">Cash</option><option value="ONLINE">Online</option>
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => setDetailId(o.id)} title={o.comments || 'Add comment'}
                        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-200 hover:bg-brand-50 max-w-[120px]">
                        <MessageSquare size={10} className="flex-shrink-0" />
                        <span className={`truncate ${o.comments ? 'text-slate-700' : 'text-slate-400'}`}>{o.comments || 'Add'}</span>
                      </button>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {o.modifier?.name ? <div className="flex flex-col"><span className="text-[10px] font-semibold text-violet-700">{o.modifier.name}</span>
                        <span className="text-[9px] text-slate-400">{fmtDateTime(o.modified_at)}</span></div> : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => setEditOrder(o)} title="Edit order" className="p-1.5 rounded-lg hover:bg-brand-50 text-slate-400 hover:text-brand-600"><Pencil size={14} /></button>
                      <button onClick={() => setDetailId(o.id)} title="View details" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-brand-600"><Eye size={14} /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
          <span className="text-xs text-slate-500">{total ? `${(page - 1) * LIMIT + 1}–${Math.min(page * LIMIT, total)} of ${total}` : '0 orders'}</span>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary p-1.5 disabled:opacity-40"><ChevronLeft size={14} /></button>
            <span className="text-xs text-slate-500 px-2">Page {page} / {pages}</span>
            <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} className="btn-secondary p-1.5 disabled:opacity-40"><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
