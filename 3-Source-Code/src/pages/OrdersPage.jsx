import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Search, Upload, Download, Eye, MessageSquare, X, ChevronLeft, ChevronRight, Plus, FileDown, Trash2, AlertTriangle, CheckCircle2, Pencil, MapPin, CalendarClock, Save, Sheet, Loader2, Home } from 'lucide-react'
import { supabase, rpc, errMsg, fetchAll, safeSearch, fetchSheetViaFunction } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtDayIST, STATUS, PAYMENT, payLabel, todayIST, techLabel, isUrl, OWN_INSTALL } from '../lib/format'
import { parseOrdersFile, parseOrdersBuffer, fetchGoogleSheet, downloadOrdersTemplate, downloadXlsx } from '../lib/excel'
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
              <thead className="bg-slate-50"><tr>{['DATE', 'STATE', 'VENDOR NAME', 'SERVICE ORDER ID', 'CUSTOMER NAME', 'SERVICE', 'PRODUCT TYPE', 'LOCATION', 'TECHNICIAN', 'STATUS'].map((h) => <th key={h} className="px-2 py-1.5 text-left text-slate-500 whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{preview.map((r, i) => (
                <tr key={i} className="border-t border-slate-100">
                  <td className="px-2 py-1.5">{r.order_date ? fmtDate(r.order_date) : <span className="text-amber-600">today</span>}</td>
                  <td className="px-2 py-1.5">{r.state || '—'}</td><td className="px-2 py-1.5">{r.vendor_name || '—'}</td>
                  <td className="px-2 py-1.5 font-mono">{r.order_id}</td><td className="px-2 py-1.5">{r.customer_name}</td>
                  <td className="px-2 py-1.5">{r.service}</td><td className="px-2 py-1.5">{r.product_type || '—'}</td>
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

const SHEET_LINK_KEY = 'ht_sheet_link'
const savedSheetLink = () => { try { return localStorage.getItem(SHEET_LINK_KEY) || '' } catch { return '' } }

/** Import orders straight from a shared Google Sheet (same columns as the Excel upload) */
function GoogleSheetModal({ onClose, onParsed }) {
  const [link, setLink] = useState(savedSheetLink)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true)
    try {
      const parsed = parseOrdersBuffer(await fetchGoogleSheet(link, fetchSheetViaFunction))
      try { localStorage.setItem(SHEET_LINK_KEY, link.trim()) } catch { /* private mode */ }
      onParsed({ file: { name: 'Google Sheet' }, parsed })
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }
  return (
    <Modal title="Import from Google Sheet" subtitle="Same columns as the Excel upload" onClose={onClose} width="max-w-lg">
      <form onSubmit={load} className="space-y-4">
        <Field label="Google Sheet link *" hint="The link is remembered on this computer, so next time you only click Read sheet.">
          <input className="input" inputMode="url" autoFocus required placeholder="https://docs.google.com/spreadsheets/d/…" value={link} onChange={(e) => setLink(e.target.value)} />
        </Field>
        <ul className="text-xs text-slate-500 space-y-1 list-disc pl-4">
          <li>In Google Sheets: <b>Share → General access → Anyone with the link</b> (Viewer).</li>
          <li>Open the tab that has the orders, then copy the link from the address bar. That tab is the one imported.</li>
          <li>You see a preview before anything is saved.</li>
        </ul>
        {err && <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> <span>{err}</span></p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button disabled={busy || !link.trim()} className="btn-primary text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : <Sheet size={13} />} {busy ? 'Reading…' : 'Read sheet'}</button>
        </div>
      </form>
    </Modal>
  )
}

const ORDER_FIELDS = ['order_id', 'order_date', 'state', 'vendor_name', 'customer_name', 'phone_no', 'service', 'brand', 'product_type', 'location', 'address', 'pin_code', 'location_url', 'technician_id']

/** Add a new order, or edit an existing one to fill in missed details */
function OrderFormModal({ order, techs, onClose, onSaved }) {
  const { toast } = useToast()
  const editing = !!order
  const [f, setF] = useState(() => {
    const base = { order_id: '', order_date: todayIST(), state: '', vendor_name: '', customer_name: '', phone_no: '', service: '', brand: '', product_type: '', location: '', address: '', pin_code: '', location_url: '', technician_id: '' }
    if (!order) return base
    const o = Object.fromEntries(ORDER_FIELDS.map((k) => [k, order[k] ?? '']))
    return { ...base, ...o, collect_amount: order.collect_amount ?? '', cod_amount: order.cod_amount ?? 0, payment_mode: order.payment_mode === 'AMAZON' ? 'AMAZON' : Number(order.cod_amount) > 0 ? 'CASH' : '', region: order.region || '', installed_item: order.installed_item || '' }
  })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))
  const completed = order?.status === 'COMPLETED'
  const { data: items = [] } = useQuery({
    queryKey: ['service-rates-names'], enabled: completed, staleTime: 5 * 60_000,
    queryFn: async () => { const { data } = await supabase.from('service_rates').select('service').order('service'); return (data || []).map((r) => r.service) },
  })
  const save = async (e) => {
    e.preventDefault()
    const row = Object.fromEntries(ORDER_FIELDS.map((k) => [k, typeof f[k] === 'string' ? f[k].trim() || null : f[k]]))
    if (row.location_url && !isUrl(row.location_url)) return toast('Google location must be a link starting with https://', 'error')
    if (editing && !row.location_url && !order.location_url) delete row.location_url   // older database without the column
    if (!row.product_type && !(editing && 'product_type' in order)) delete row.product_type
    for (const k of ['state', 'vendor_name']) if (!row[k] && !(editing && k in order)) delete row[k]   // older database without the columns
    if (order?.status === 'CANCELLED') delete row.technician_id   // cancelled = own installation, no technician
    if (editing && 'region' in order && f.region) row.region = f.region
    const cc = parseFloat(f.collect_amount)
    if (!editing || 'collect_amount' in order) row.collect_amount = cc > 0 ? Math.round(cc * 100) / 100 : null
    if (completed) {
      row.cod_amount = Math.max(0, parseFloat(f.cod_amount) || 0)
      if (f.payment_mode === 'AMAZON') row.cod_amount = 0
      row.payment_mode = f.payment_mode === 'AMAZON' ? 'AMAZON' : row.cod_amount > 0 ? 'CASH' : null   // CASH = collected from customer
      if ('installed_item' in order) row.installed_item = f.installed_item || null
    }
    setBusy(true)
    let { error } = editing
      ? await supabase.from('orders').update(row).eq('id', order.id)
      : await supabase.from('orders').insert(row)
    if (error && /collect_amount/.test(error.message || '')) {   // database not updated yet
      const { collect_amount, ...rest } = row
      ;({ error } = editing ? await supabase.from('orders').update(rest).eq('id', order.id) : await supabase.from('orders').insert(rest))
    }
    setBusy(false)
    if (error) return toast(error.code === '23505' ? 'This Order ID already exists' : errMsg(error), 'error')
    toast(editing ? 'Order updated' : 'Order added', 'success'); onSaved(); onClose()
  }
  return (
    <Modal title={editing ? 'Edit order' : 'New order'} subtitle={editing ? `${order.order_id} · fill in or correct details` : 'For jobs that are not in the Excel file'} onClose={onClose} width="max-w-xl">
      <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Order ID *"><input className="input" value={f.order_id} onChange={set('order_id')} required /></Field>
        <Field label="Order Date *"><input type="date" className="input" value={f.order_date} onChange={set('order_date')} required /></Field>
        <Field label="State"><input className="input" value={f.state || ''} onChange={set('state')} placeholder="Tamil Nadu" /></Field>
        <Field label="Vendor Name"><input className="input" value={f.vendor_name || ''} onChange={set('vendor_name')} placeholder="Amazon" /></Field>
        <Field label="Customer Name *"><input className="input" value={f.customer_name} onChange={set('customer_name')} required /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone_no} onChange={set('phone_no')} /></Field>
        <Field label="Service"><input className="input" value={f.service} onChange={set('service')} placeholder="AC Installation Service" /></Field>
        <Field label="Brand"><input className="input" value={f.brand} onChange={set('brand')} /></Field>
        <Field label="Product Type"><input className="input" value={f.product_type || ''} onChange={set('product_type')} placeholder="TELEVISION" /></Field>
        <Field label="Location / Area"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Pin Code"><input className="input" inputMode="numeric" value={f.pin_code} onChange={set('pin_code')} /></Field>
        <div className="sm:col-span-2"><Field label="Full Address"><input className="input" value={f.address} onChange={set('address')} /></Field></div>
        <div className="sm:col-span-2"><Field label="Google location URL" hint="Paste the link from Google Maps → Share. The technician's Map button opens this exact spot.">
          <div className="relative"><MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" inputMode="url" placeholder="https://maps.app.goo.gl/…" value={f.location_url} onChange={set('location_url')} /></div>
        </Field></div>
        {editing && 'region' in order && (
          <div className="sm:col-span-2"><Field label="Rate region" hint="Decides the technician rate in Rate Config. Set from the pin code (600xxx = Chennai) unless you change it.">
            <select className="input" value={f.region} onChange={set('region')}>
              <option value="CHENNAI">Within Chennai</option><option value="OUTSIDE">Outside Chennai</option>
            </select></Field></div>
        )}
        {(!editing || 'collect_amount' in order) && (
          <div className="sm:col-span-2"><Field label="Cash Collect ₹" hint="Amount the technician must collect from the customer. When set, HT Jobs shows it on Complete and hides “Paid on Amazon”. Leave empty if paid on Amazon.">
            <input type="number" min="0" step="0.01" inputMode="decimal" className="input" placeholder="e.g. 1000" value={f.collect_amount ?? ''} onChange={set('collect_amount')} /></Field></div>
        )}
        <div className="sm:col-span-2"><Field label="Assign Technician">
          {order?.status === 'CANCELLED' ? <p className="input bg-slate-50 text-slate-600 flex items-center gap-2"><Home size={14} /> {OWN_INSTALL} (order cancelled)</p> :
          <TechPicker techs={techs} value={f.technician_id || ''} onChange={(v) => setF((p) => ({ ...p, technician_id: v }))}
            extra={[{ value: '', label: '— Unassigned —' }]} placeholder="— Unassigned —" className="w-full" pinCode={f.pin_code} />}</Field></div>
        {completed && <>
          {'installed_item' in order && <div className="sm:col-span-2"><Field label="Installed item" hint="What the technician installed — the rate in Rate Config is taken from this.">
            <select className="input" value={f.installed_item} onChange={set('installed_item')}>
              <option value="">— Same as service —</option>
              {[...new Set([...(f.installed_item ? [f.installed_item] : []), ...items])].map((i) => <option key={i} value={i}>{i}</option>)}
            </select></Field></div>}
          <Field label="Payment">
            <select className="input" value={f.payment_mode === 'AMAZON' ? 'AMAZON' : 'CASH'} onChange={set('payment_mode')}>
              <option value="CASH">Collected from customer</option><option value="AMAZON">Paid on Amazon</option>
            </select></Field>
          <Field label="Collected from customer ₹" hint={f.payment_mode === 'AMAZON' ? 'Paid on Amazon: nothing collected.' : 'Deducted from the technician\'s pay in Technician Payout.'}>
            <input type="number" min="0" step="0.01" className="input" disabled={f.payment_mode === 'AMAZON'} value={f.payment_mode === 'AMAZON' ? 0 : f.cod_amount} onChange={set('cod_amount')} /></Field>
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

/**
 * Office marks a job Completed on behalf of the technician: ask the same two things HT Jobs asks,
 * so every completed job has an installed item (→ rate from Rate Config) and a payment (→ deducted in Payout).
 */
function CompleteModal({ order, techs, onClose, onSaved }) {
  const { toast } = useToast()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['service-rates-names'], staleTime: 5 * 60_000,
    queryFn: async () => { const { data } = await supabase.from('service_rates').select('service').order('service'); return (data || []).map((r) => r.service) },
  })
  const norm = (x) => String(x || '').trim().toLowerCase()
  const [item, setItem] = useState(order.installed_item || '')
  useEffect(() => {
    if (!item && items.length) { const m = items.find((i) => norm(i) === norm(order.service)); if (m) setItem(m) }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  const had = Number(order.cod_amount) > 0
  const toCollect = Number(order.collect_amount) || 0
  const [pay, setPay] = useState(toCollect > 0 ? 'CASH' : order.payment_mode === 'AMAZON' ? 'AMAZON' : had ? 'CASH' : '')
  const [amount, setAmount] = useState(had ? String(Number(order.cod_amount)) : toCollect > 0 ? String(toCollect) : '')
  const [busy, setBusy] = useState(false)
  const tech = techs.find((t) => t.id === order.technician_id)
  const save = async (e) => {
    e.preventDefault()
    if (items.length && !item) return toast('Select what was installed', 'error')
    if (!pay) return toast('Select Collected from customer or Paid on Amazon', 'error')
    const amazon = pay === 'AMAZON'
    const v = amazon ? 0 : Math.round((parseFloat(amount) || 0) * 100) / 100
    if (!amazon && v <= 0) return toast('Enter the amount collected from the customer', 'error')
    setBusy(true)
    // payout_rate: null → the database takes the rate again from Rate Config for the installed item
    const patch = { status: 'COMPLETED', cod_amount: v, payment_mode: amazon ? 'AMAZON' : 'CASH', payout_rate: null }
    if (item) patch.installed_item = item
    let { error } = await supabase.from('orders').update(patch).eq('id', order.id)
    if (error && /payout_rate|installed_item/.test(error.message || '')) {   // older database without these columns
      const { payout_rate, installed_item, ...basic } = patch
      ;({ error } = await supabase.from('orders').update(basic).eq('id', order.id))
    }
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    toast(`${order.order_id} completed · ${amazon ? 'paid on Amazon' : `₹${v} collected from customer`}`, 'success')
    onSaved(); onClose()
  }
  const opt = (on) => `flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border-2 text-xs font-bold transition ${on}`
  return (
    <Modal title="Mark as completed" subtitle={`${order.order_id} · ${order.customer_name}`} onClose={onClose} width="max-w-lg">
      <form onSubmit={save} className="space-y-4">
        <p className="text-xs text-slate-500">Service on the order: <b className="text-slate-700">{order.service || '—'}</b> · Technician: <b className="text-slate-700">{tech ? techLabel(tech) : 'not assigned'}</b></p>
        {!tech && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-2.5 flex gap-2"><AlertTriangle size={14} className="flex-shrink-0 mt-0.5" /> No technician is assigned, so this job will not appear in Technician Payout. Assign the technician first if it should.</p>}
        <Field label="1. What was installed? *" hint="The technician's rate is taken from Rate Config for this item.">
          {isLoading ? <div className="h-10 rounded-xl bg-slate-100 animate-pulse" /> : items.length ? (
            <select className="input" value={item} onChange={(e) => setItem(e.target.value)} required autoFocus>
              <option value="">— Select —</option>
              {[...new Set([...(item ? [item] : []), ...items])].map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
          ) : <p className="text-xs text-slate-500">No items in Rate Config yet. The rate will be taken from the order's service.</p>}
        </Field>
        {toCollect > 0 && <p className="text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-xl p-2.5">Cash Collect on this order: ₹{toCollect} — the technician has to collect this from the customer (not paid on Amazon).</p>}
        <Field label="2. Payment *">
          <div className="flex gap-2">
            <button type="button" onClick={() => setPay('CASH')} className={opt(pay === 'CASH' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>Collected from customer</button>
            {!(toCollect > 0) && <button type="button" onClick={() => setPay('AMAZON')} className={opt(pay === 'AMAZON' ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-600 hover:border-slate-300')}>Paid on Amazon</button>}
          </div>
        </Field>
        {pay === 'CASH' && <Field label="Amount the technician collected ₹ *" hint="Cash or UPI received by the technician. It is deducted from his pay in Technician Payout.">
          <input type="number" min="0" step="0.01" inputMode="decimal" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>}
        {pay === 'AMAZON' && <p className="text-xs text-amber-700">Customer already paid on Amazon: nothing collected (₹0), the technician gets the full rate.</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-xs">Cancel</button>
          <button disabled={busy} className="btn-primary text-xs"><CheckCircle2 size={13} /> {busy ? 'Saving…' : 'Mark completed'}</button>
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
  const [showSheet, setShowSheet] = useState(false)
  const [editOrder, setEditOrder] = useState(null)
  const [resched, setResched] = useState(null) // orders being rescheduled
  const [completing, setCompleting] = useState(null) // order the office is marking Completed
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

  // Cancelled = the owner installed it himself → the technician is removed and "Own Installation" is shown
  const cancelOrders = async (list) => {
    if (!list.length) return
    const withTech = list.filter((o) => o.technician_id).length
    const msg = list.length === 1
      ? `Cancel ${list[0].order_id}? It will show as "${OWN_INSTALL}"${withTech ? ' and be removed from the technician\'s HT Jobs and Payout' : ''}.`
      : `Cancel ${list.length} orders? They will show as "${OWN_INSTALL}"${withTech ? ` and ${withTech} will be removed from the technicians' HT Jobs and Payout` : ''}.`
    if (!confirm(msg)) return
    await update(list.map((o) => o.id), { status: 'CANCELLED', technician_id: null },
      list.length === 1 ? `${list[0].order_id} → Cancelled · ${OWN_INSTALL}` : `${list.length} orders → Cancelled · ${OWN_INSTALL}`)
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
        DATE: fmtDate(o.order_date), STATE: o.state || '', 'VENDOR NAME': o.vendor_name || '', SERVICE_ORDER_ID: o.order_id, 'CUSTOMER NAME': o.customer_name, 'PHONE NUMBER': o.phone_no || '',
        SERVICE: o.service || '', BRAND: o.brand || '', PRODUCT_TYPE: o.product_type || '', LOCATION: o.location || '', 'PIN CODE': o.pin_code || '',
        TECHNICIAN: o.status === 'CANCELLED' ? OWN_INSTALL : o.technician?.name || '', STATUS: STATUS[o.status]?.label || o.status,
        'Sheet Status': o.source_status || '', 'Installed Item': o.installed_item || '', 'Technician ID': techs.find((t) => t.id === o.technician_id)?.tech_code || '',
        'Rescheduled To': o.rescheduled_date ? fmtDate(o.rescheduled_date) : '', Address: o.address || '', 'Google Location': o.location_url || '',
        'Completed On': o.status === 'COMPLETED' && o.closed_at ? fmtDayIST(o.closed_at) : '', 'Not Done On': o.status === 'REJECTED' && o.closed_at ? fmtDayIST(o.closed_at) : '', 'Cancelled On': o.status === 'CANCELLED' && o.closed_at ? fmtDayIST(o.closed_at) : '',
        'Cash Collect': Number(o.collect_amount || 0), 'Collected from customer': Number(o.cod_amount || 0), Payment: payLabel(o), Comments: o.comments || '',
        'Modified By': o.modifier?.name || '', 'Modified At': o.modified_at ? fmtDateTime(o.modified_at) : '',
      })) }])
    } catch (e) { toast(errMsg(e), 'error') } finally { setBusy(false) }
  }

  const allSel = orders.length > 0 && orders.every((o) => selected.has(o.id))
  const toggleAll = () => setSelected(allSel ? new Set() : new Set(orders.map((o) => o.id)))
  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s) }
  const selPins = new Set(orders.filter((o) => selected.has(o.id)).map((o) => o.pin_code || ''))
  const bulkPin = selPins.size === 1 ? [...selPins][0] : ''
  const filtersOn = f.search || f.status || f.tech || f.from || f.to

  return (
    <div className="space-y-4">
      {detailId && <OrderDrawer orderId={detailId} onClose={() => setDetailId(null)} />}
      {upload && <UploadModal {...upload} onClose={() => setUpload(null)} onDone={refresh} />}
      {showSheet && <GoogleSheetModal onClose={() => setShowSheet(false)} onParsed={(u) => { setShowSheet(false); setUpload(u) }} />}
      {showNew && <OrderFormModal techs={techs} onClose={() => setShowNew(false)} onSaved={refresh} />}
      {editOrder && <OrderFormModal order={editOrder} techs={techs} onClose={() => setEditOrder(null)} onSaved={refresh} />}
      {completing && <CompleteModal order={completing} techs={techs} onClose={() => setCompleting(null)} onSaved={() => { refresh(); setSelected(new Set()) }} />}
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
          <button onClick={() => setShowSheet(true)} className="btn-secondary text-xs"><Sheet size={13} /> Google Sheet</button>
          <button onClick={() => fileRef.current?.click()} className="btn-primary text-xs"><Upload size={13} /> Upload Excel</button>
        </div>
      </div>

      <div className="card p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-52">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9 py-2" placeholder="Search order ID, customer, phone, location, pincode…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        </div>
        <select className="input w-auto py-2" value={f.status} onChange={setFilter('status')}>
          <option value="">All statuses</option><option value="PENDING">Pending</option><option value="RESCHEDULED">Rescheduled</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled (own installation)</option>
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
          <TechPicker techs={techs} value={bulkTech} onChange={setBulkTech} placeholder="Assign to…" className="w-auto min-w-[200px] py-1.5 text-xs" pinCode={bulkPin}
            extra={[{ value: 'none', label: '— Unassign —' }]} />
          <button disabled={!bulkTech || busy} className="btn-primary text-xs py-1.5"
            onClick={() => update([...selected], { technician_id: bulkTech === 'none' ? null : bulkTech }, `${selected.size} orders ${bulkTech === 'none' ? 'unassigned' : 'assigned'}`).then(() => { setSelected(new Set()); setBulkTech('') })}>Assign</button>
          <span className="w-px h-6 bg-brand-200 mx-1" />
          {['PENDING', 'COMPLETED', 'REJECTED'].map((s) => (
            <button key={s} disabled={busy} onClick={() => {
              const one = selected.size === 1 && orders.find((o) => selected.has(o.id))
              if (s === 'COMPLETED' && one) return setCompleting(one)   // one order → ask installed item + payment
              update([...selected], { status: s }, s === 'COMPLETED' ? `${selected.size} orders → Completed. Open each one (pencil) to set the installed item and amount collected.` : `${selected.size} orders → ${STATUS[s].label}`).then(() => setSelected(new Set()))
            }}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${STATUS[s].bg} ${STATUS[s].text} ${STATUS[s].border}`}>→ {STATUS[s].label}</button>
          ))}
          <button disabled={busy} onClick={() => cancelOrders(orders.filter((o) => selected.has(o.id))).then(() => setSelected(new Set()))}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${STATUS.CANCELLED.bg} ${STATUS.CANCELLED.text} ${STATUS.CANCELLED.border}`}>→ Cancelled</button>
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
                {['Date', 'State', 'Vendor Name', 'Service Order ID', 'Customer Name', 'Phone Number', 'Service', 'Brand', 'Product Type', 'Location', 'Pin Code', 'Cash Collect ₹', 'Technician', 'Status', 'Completed / Installed', 'Collected ₹', 'Comment', 'Modified', ''].map((h) => (
                  <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-50"><td colSpan={20} className="px-3 py-3"><div className="h-4 bg-slate-100 animate-pulse rounded" /></td></tr>
              )) : orders.length === 0 ? (
                <tr><td colSpan={20} className="px-3 py-12 text-center text-sm text-slate-400">No orders found</td></tr>
              ) : orders.map((o) => {
                const sc = STATUS[o.status] || STATUS.PENDING
                return (
                  <tr key={o.id} className={`border-b border-slate-50 hover:bg-slate-50/80 ${selected.has(o.id) ? 'bg-brand-50/50' : ''}`}>
                    <td className="px-3 py-2"><input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} /></td>
                    <td className="px-3 py-2 whitespace-nowrap text-[11px] text-slate-600">{fmtDate(o.order_date)}
                      {o.rescheduled_date && <div className="text-[10px] font-semibold text-sky-700 flex items-center gap-0.5" title="Rescheduled to"><CalendarClock size={10} /> {fmtDate(o.rescheduled_date)}</div>}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{o.state || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{o.vendor_name || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><button onClick={() => setDetailId(o.id)} className="font-mono text-xs text-brand-600 font-semibold hover:underline">{o.order_id}</button></td>
                    <td className="px-3 py-2 text-xs font-semibold text-slate-800 whitespace-nowrap">{o.customer_name}</td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{o.phone_no}</td>
                    <td className="px-3 py-2 max-w-[170px]"><span className="text-xs text-slate-600 line-clamp-2">{o.service}</span></td>
                    <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">{o.brand}</td>
                    <td className="px-3 py-2 text-[11px] text-slate-500 whitespace-nowrap">{o.product_type}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{o.location}{isUrl(o.location_url) && <a href={o.location_url} target="_blank" rel="noreferrer" title="Open Google location" className="ml-1 inline-flex align-middle text-emerald-600 hover:text-emerald-700"><MapPin size={12} /></a>}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-400">{o.pin_code}</td>
                    <td className="px-3 py-2">
                      <input key={`cc-${o.id}-${o.collect_amount}`} type="number" min="0" step="0.01" placeholder="—" defaultValue={Number(o.collect_amount) > 0 ? Number(o.collect_amount) : ''}
                        title="Amount the technician must collect from the customer (empty = paid on Amazon)" disabled={busy || !('collect_amount' in o)}
                        className={`w-20 text-xs px-2 py-1 border rounded-lg text-right ${Number(o.collect_amount) > 0 ? 'border-red-300 bg-red-50 text-red-700 font-bold' : 'border-slate-200'}`}
                        onBlur={(e) => { const v = Math.max(0, parseFloat(e.target.value) || 0); if (v !== (Number(o.collect_amount) || 0)) update([o.id], { collect_amount: v > 0 ? v : null }, v > 0 ? `${o.order_id}: collect ₹${v} from customer` : `${o.order_id}: cash collect cleared`) }} />
                    </td>
                    <td className="px-3 py-2">
                      {o.status === 'CANCELLED' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap" title="Order cancelled: the owner installed it himself">
                          <Home size={11} /> {OWN_INSTALL}</span>
                      ) : <TechPicker size="sm" techs={techs} value={o.technician_id || ''} disabled={busy} danger={!o.technician_id}
                        placeholder="Unassigned" extra={[{ value: '', label: 'Unassigned' }]} pinCode={o.pin_code}
                        onChange={(v) => {
                          const t = techs.find((x) => x.id === v)
                          update([o.id], { technician_id: v || null }, t ? `${o.order_id} assigned to ${techLabel(t)}` : `${o.order_id} unassigned`)
                        }} />}
                    </td>
                    <td className="px-3 py-2">
                      <select value={o.status} disabled={busy} onChange={(e) => e.target.value === 'RESCHEDULED' ? setResched([o]) : e.target.value === 'COMPLETED' ? setCompleting(o) : e.target.value === 'CANCELLED' ? cancelOrders([o]) : update([o.id], { status: e.target.value }, `${o.order_id} → ${STATUS[e.target.value].label}`)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-lg border ${sc.bg} ${sc.text} ${sc.border}`}>
                        <option value="PENDING">Pending</option><option value="RESCHEDULED">Rescheduled</option><option value="COMPLETED">Completed</option><option value="REJECTED">Rejected</option><option value="CANCELLED">Cancelled</option>
                      </select>
                      {o.source_status && o.source_status.toUpperCase() !== o.status && <div className="text-[10px] text-slate-400 mt-0.5 whitespace-nowrap" title="STATUS in the uploaded sheet">Sheet: {o.source_status}</div>}
                      {o.status === 'RESCHEDULED' && <button onClick={() => setResched([o])} className="block mt-0.5 text-[10px] font-semibold text-sky-700 hover:underline whitespace-nowrap">to {fmtDate(o.rescheduled_date)} · change</button>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-[11px]">
                      {o.status === 'COMPLETED' && o.closed_at ? <span className="text-emerald-700 font-semibold" title={fmtDateTime(o.closed_at)}>{fmtDayIST(o.closed_at)}</span>
                        : o.status === 'REJECTED' && o.closed_at ? <span className="text-red-600" title={`Not done · ${fmtDateTime(o.closed_at)}`}>{fmtDayIST(o.closed_at)}</span>
                        : o.status === 'CANCELLED' && o.closed_at ? <span className="text-slate-500" title={`Cancelled · ${fmtDateTime(o.closed_at)}`}>{fmtDayIST(o.closed_at)}</span>
                        : <span className="text-slate-300">—</span>}
                      {o.installed_item && <div className="text-[10px] text-slate-500 max-w-[140px] whitespace-normal leading-tight mt-0.5" title="Installed">{o.installed_item}</div>}
                    </td>
                    <td className="px-3 py-2">
                      <input key={`${o.id}-${o.cod_amount}`} type="number" min="0" step="0.01" defaultValue={Number(o.cod_amount || 0)}
                        className="w-20 text-xs px-2 py-1 border border-slate-200 rounded-lg text-right"
                        onBlur={(e) => { const v = Math.max(0, parseFloat(e.target.value) || 0); if (v !== Number(o.cod_amount || 0)) update([o.id], { cod_amount: v }, 'Amount saved') }} />
                      {o.status === 'COMPLETED' && (Number(o.cod_amount) > 0 || o.payment_mode === 'AMAZON') && (
                        <select value={o.payment_mode === 'AMAZON' ? 'AMAZON' : 'CASH'} disabled={busy} title="Collected from customer, or paid on Amazon"
                          onChange={(e) => update([o.id], { payment_mode: e.target.value }, `Payment: ${PAYMENT[e.target.value]}`)}
                          className={`block mt-1 w-24 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${o.payment_mode === 'AMAZON' ? 'bg-amber-50 text-amber-800 border-amber-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                          <option value="CASH">Collected</option><option value="AMAZON">Amazon</option>
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
