import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, Phone, MapPin, Send, History, MessageSquare } from 'lucide-react'
import { supabase, errMsg } from '../lib/supabase'
import { fmtDate, fmtDateTime, fmtMoney, STATUS, mapsUrl, telUrl } from '../lib/format'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

/** Slide-in panel: full order details, comment history, change history */
export default function OrderDrawer({ orderId, onClose }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: o, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const { data, error } = await supabase.from('orders')
        .select('*, technician:technicians(id,name,mobile,city), modifier:profiles!orders_modified_by_fkey(name), assigner:profiles!orders_assigned_by_fkey(name)')
        .eq('id', orderId).single()
      if (error) throw error
      return data
    },
  })
  const { data: comments } = useQuery({
    queryKey: ['order', orderId, 'comments'],
    queryFn: async () => {
      const { data, error } = await supabase.from('comment_logs')
        .select('id, comment, created_at, user:profiles(name, role)').eq('order_id', orderId).order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
  const { data: history } = useQuery({
    queryKey: ['order', orderId, 'history'],
    queryFn: async () => {
      const { data, error } = await supabase.from('audit_logs')
        .select('id, action, note, created_at, actor:profiles(name)').eq('order_id', orderId).order('created_at', { ascending: false }).limit(30)
      if (error) throw error
      return data
    },
  })

  const addComment = async () => {
    if (!text.trim()) return
    setSaving(true)
    const { error } = await supabase.from('comment_logs').insert({ order_id: orderId, user_id: user.id, comment: text.trim() })
    setSaving(false)
    if (error) return toast(errMsg(error), 'error')
    setText('')
    qc.invalidateQueries({ queryKey: ['order', orderId] })
    qc.invalidateQueries({ queryKey: ['orders'] })
  }

  const st = STATUS[o?.status] || STATUS.PENDING
  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-40" onClick={onClose}>
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl z-50 flex flex-col" onClick={(e) => e.stopPropagation()}
           style={{ animation: 'slideRight .25s ease-out' }}>
        <style>{'@keyframes slideRight{from{transform:translateX(100%)}to{transform:translateX(0)}}'}</style>
        <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Order Detail</h2>
            <p className="text-xs text-brand-600 font-mono mt-0.5">{o?.order_id}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        {isLoading || !o ? <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">Loading…</div> : (
          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={st.badge}>{st.label}</span>
              {o.closed_at && <span className="text-[11px] text-slate-400">closed {fmtDateTime(o.closed_at)}</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                ['Order Date', fmtDate(o.order_date)], ['Customer', o.customer_name],
                ['Phone', o.phone_no || '—'], ['Service', o.service || '—'],
                ['Brand', o.brand || '—'], ['Pin Code', o.pin_code || '—'],
                ['Location', o.location || '—'], ['Address', o.address || '—'],
                ['Technician', o.technician?.name || 'Unassigned'], ['Amount Collected', fmtMoney(o.cod_amount)],
                ['Assigned By', o.assigner?.name ? `${o.assigner.name}${o.assigned_at ? ' · ' + fmtDateTime(o.assigned_at) : ''}` : '—'],
                ['Last Modified', o.modifier?.name ? `${o.modifier.name} · ${fmtDateTime(o.modified_at)}` : '—'],
              ].map(([l, v]) => (
                <div key={l}><p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-0.5">{l}</p><p className="text-xs font-medium text-slate-800 break-words">{v}</p></div>
              ))}
            </div>
            <div className="flex gap-2">
              {telUrl(o.phone_no) && <a href={telUrl(o.phone_no)} className="btn-secondary text-xs"><Phone size={12} /> Call customer</a>}
              <a href={mapsUrl(o)} target="_blank" rel="noreferrer" className="btn-secondary text-xs"><MapPin size={12} /> Map</a>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><MessageSquare size={12} /> Comments</p>
              <div className="flex gap-2 mb-3">
                <input className="input text-sm" placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addComment()} />
                <button onClick={addComment} disabled={saving || !text.trim()} className="btn-primary px-3"><Send size={14} /></button>
              </div>
              <div className="space-y-2">
                {(comments || []).map((c) => (
                  <div key={c.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-brand-600">{c.user?.name || '—'}{c.user?.role === 'TECHNICIAN' && <span className="ml-1 text-[10px] text-slate-400">(technician)</span>}</span>
                      <span className="text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-700">{c.comment}</p>
                  </div>
                ))}
                {!comments?.length && <p className="text-xs text-slate-400">No comments yet</p>}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><History size={12} /> History</p>
              <ol className="border-l-2 border-slate-100 ml-1 space-y-3">
                {(history || []).map((h) => (
                  <li key={h.id} className="pl-3 relative">
                    <span className="absolute -left-[5px] top-1.5 w-2 h-2 rounded-full bg-brand-400" />
                    <p className="text-xs text-slate-700">{h.note}</p>
                    <p className="text-[10px] text-slate-400">{h.actor?.name || 'System'} · {fmtDateTime(h.created_at)}</p>
                  </li>
                ))}
                {!history?.length && <li className="pl-3 text-xs text-slate-400">No changes yet</li>}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
