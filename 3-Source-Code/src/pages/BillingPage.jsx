import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus, Printer, Save, X, Trash2 } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { amountToWords, fmtDate, fmtMoney, todayIST } from '../lib/format'
import { printBill } from '../lib/printBill'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { useAppSettings } from '../hooks/useData'

const EMPTY_ROW = { particulars: '', quantity: '', rate: '', amount: '' }
const LIMIT = 20

function BillForm({ company, onClose, onSaved }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const [date, setDate] = useState(todayIST())
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [rows, setRows] = useState(() => Array.from({ length: 5 }, () => ({ ...EMPTY_ROW })))
  const [saved, setSaved] = useState(null)
  const [busy, setBusy] = useState(false)

  const setRow = (i, k, v) => setRows((prev) => prev.map((r, idx) => {
    if (idx !== i) return r
    const u = { ...r, [k]: v }
    if (k === 'quantity' || k === 'rate') {
      const q = parseFloat(u.quantity) || 0, rt = parseFloat(u.rate) || 0
      u.amount = q && rt ? (q * rt).toFixed(2) : u.amount
    }
    return u
  }))
  const total = useMemo(() => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0), [rows])
  const items = rows.filter((r) => r.particulars.trim()).map((r) => ({
    particulars: r.particulars.trim(), quantity: r.quantity, rate: parseFloat(r.rate) || 0, amount: parseFloat(r.amount) || 0,
  }))

  const save = async () => {
    if (!name.trim()) return toast('Customer name required', 'error')
    if (!items.length) return toast('Add at least one item', 'error')
    setBusy(true)
    const { data, error } = await supabase.from('bills')
      .insert({ bill_date: date, customer_name: name.trim(), address: address.trim() || null, items, total_amount: total, created_by: user.id })
      .select().single()
    setBusy(false)
    if (error) return toast(errMsg(error), 'error')
    setSaved(data); onSaved()
    toast(`Bill No. ${data.bill_number} saved`, 'success')
  }

  const locked = !!saved
  return (
    <div className="fixed inset-0 bg-black/50 z-50 overflow-y-auto p-4">
      <div className="max-w-3xl mx-auto space-y-3">
        <div className="flex justify-end gap-2">
          <button className="btn-secondary text-xs" onClick={onClose}><X size={13} /> Close</button>
          {!locked && <button className="btn-primary text-xs bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={busy}><Save size={13} /> {busy ? 'Saving…' : 'Save Bill'}</button>}
          {locked && <button className="btn-primary text-xs" onClick={() => printBill(saved, company)}><Printer size={13} /> Print Bill</button>}
        </div>
        <div className="bg-white border-[2.5px] border-[#1a3a7a] text-[#1a3a7a]">
          <div className="border-b-2 border-[#1a3a7a] p-4 grid grid-cols-[64px_1fr] gap-4 items-center">
            <div className="w-16 h-16 border-2 border-[#1a3a7a] flex items-center justify-center text-3xl font-black">{(company?.company_name || 'H')[0]}</div>
            <div className="text-center">
              <div className="text-2xl font-black tracking-widest">{company?.company_name}</div>
              <div className="text-xs mt-1">{company?.company_address}</div>
              <span className="inline-block bg-[#1a3a7a] text-white text-xs font-bold tracking-widest px-6 py-0.5 rounded-full mt-2">CASH BILL</span>
            </div>
          </div>
          <div className="flex justify-between items-center px-4 py-2 border-b border-[#1a3a7a] text-sm font-bold">
            <div>No. <span className="text-slate-900">{saved?.bill_number || <span className="text-slate-400 font-normal text-xs">auto on save</span>}</span></div>
            <div className="flex items-center gap-2">Date: <input type="date" disabled={locked} value={date} onChange={(e) => setDate(e.target.value)} className="border-b border-[#1a3a7a] outline-none text-slate-900 font-normal" /></div>
          </div>
          <div className="px-4 py-2 border-b border-[#1a3a7a] space-y-1 text-sm">
            {[['Name', name, setName], ['Address', address, setAddress]].map(([l, v, set]) => (
              <div key={l} className="flex items-center gap-2"><b className="w-16">{l}</b>:<input disabled={locked} value={v} onChange={(e) => set(e.target.value)} className="flex-1 border-b border-slate-300 outline-none text-slate-900 px-1" /></div>
            ))}
          </div>
          <table className="w-full border-collapse text-sm">
            <thead><tr>{['S.No', 'Particulars', 'Qty', 'Rate', 'Amount', ''].map((h, i) => <th key={i} className={`border border-[#1a3a7a] py-2 ${i === 1 ? 'text-left pl-2' : ''} ${i === 5 ? 'w-8' : ''}`}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-[#1a3a7a] text-center w-12">{i + 1}</td>
                  {['particulars', 'quantity', 'rate', 'amount'].map((k) => (
                    <td key={k} className={`border border-[#1a3a7a] ${k === 'particulars' ? '' : 'w-24'}`}>
                      <input disabled={locked} value={r[k]} onChange={(e) => setRow(i, k, e.target.value)} inputMode={k === 'particulars' ? 'text' : 'decimal'}
                        className={`w-full px-2 py-1.5 outline-none text-slate-900 ${k === 'particulars' ? '' : 'text-center'}`} />
                    </td>
                  ))}
                  <td className="border border-[#1a3a7a] text-center">{!locked && rows.length > 1 && <button onClick={() => setRows((p) => p.filter((_, x) => x !== i))} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>}</td>
                </tr>
              ))}
              <tr className="bg-[#f0f4ff] font-extrabold"><td colSpan={4} className="border border-[#1a3a7a] text-right pr-4 py-2">TOTAL</td><td className="border border-[#1a3a7a] text-center text-slate-900">{total ? total.toFixed(2) : ''}</td><td className="border border-[#1a3a7a]" /></tr>
            </tbody>
          </table>
          {!locked && <button onClick={() => setRows((p) => [...p, { ...EMPTY_ROW }])} className="m-3 text-xs font-semibold border border-dashed border-[#1a3a7a] px-3 py-1 rounded"><Plus size={11} className="inline" /> Add Row</button>}
          <div className="px-4 py-3 border-t border-[#1a3a7a] text-sm"><b>Rupees</b> <i className="text-slate-900">{amountToWords(total)}</i></div>
        </div>
      </div>
    </div>
  )
}

export default function BillingPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [page, setPage] = useState(1)
  const { data: company } = useAppSettings()

  const { data, isLoading } = useQuery({
    queryKey: ['bills', page],
    queryFn: async () => {
      const { data, count, error } = await supabase.from('bills').select('*, creator:profiles(name)', { count: 'exact' })
        .order('created_at', { ascending: false }).range((page - 1) * LIMIT, page * LIMIT - 1)
      if (error) throw error
      return { bills: data, total: count || 0 }
    },
  })
  const bills = data?.bills || []
  const total = data?.total || 0
  const pages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="space-y-4">
      {showForm && <BillForm company={company} onClose={() => setShowForm(false)} onSaved={() => qc.invalidateQueries({ queryKey: ['bills'] })} />}
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-bold text-slate-900">Billing</h1><p className="text-sm text-slate-500 mt-0.5">{total} bills · company details are set in Settings</p></div>
        <button onClick={() => setShowForm(true)} className="btn-primary text-xs"><Plus size={13} /> New Bill</button>
      </div>
      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Bill No.', 'Date', 'Customer', 'Address', 'Amount', 'Created By', ''].map((h) => <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wide">{h}</th>)}
            </tr></thead>
            <tbody>
              {isLoading ? <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-400">Loading…</td></tr>
                : bills.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-400">No bills yet. Click "New Bill" to create one.</td></tr>
                : bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50/80">
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-600">{b.bill_number}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{fmtDate(b.bill_date)}</td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-800">{b.customer_name}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate">{b.address || '—'}</td>
                    <td className="px-4 py-3 text-xs font-semibold text-slate-900">{fmtMoney(b.total_amount)}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{b.creator?.name}</td>
                    <td className="px-4 py-3"><button onClick={() => printBill(b, company)} className="btn-secondary text-[11px] py-1 px-2"><Printer size={12} /> Print</button></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">Page {page} of {pages}</span>
            <div className="flex gap-1.5">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="btn-secondary p-1.5 disabled:opacity-40"><ChevronLeft size={14} /></button>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="btn-secondary p-1.5 disabled:opacity-40"><ChevronRight size={14} /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
