import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Search, X, Check } from 'lucide-react'
import { techLabel } from '../lib/format'
import { useTechStats } from '../hooks/useData'

/**
 * Type-to-search technician picker (300+ technicians).
 * Search by ID, name, area or mobile. Shows each technician's open jobs so work can be spread evenly.
 *   value        technician id | '' | special value from `extra`
 *   extra        [{ value: 'none', label: 'Unassigned' }] shown at the top
 *   activeOnly   hide inactive technicians (the current value is always shown)
 *   size         'sm' for table rows
 */
export default function TechPicker({ techs = [], value = '', onChange, extra = [], placeholder = 'Select technician', activeOnly = true,
  size = 'md', disabled = false, className = '', danger = false, showLoad = true }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hi, setHi] = useState(0)
  const [pos, setPos] = useState(null)
  const btn = useRef(null)
  const input = useRef(null)
  const listRef = useRef(null)
  const { data: stats = {} } = useTechStats(null, null, { enabled: open && showLoad })

  const current = extra.find((e) => e.value === value) || techs.find((t) => t.id === value)
  const label = current ? (current.label || techLabel(current)) : placeholder

  const items = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = techs.filter((t) => (!activeOnly || t.is_active || t.id === value) &&
      (!s || [t.tech_code, t.name, t.city, t.district, t.mobile].some((v) => v && String(v).toLowerCase().includes(s))))
    return [...(s ? [] : extra), ...list.slice(0, 80)]
  }, [techs, q, activeOnly, value, extra])

  const place = () => {
    const r = btn.current?.getBoundingClientRect()
    if (!r) return
    const width = Math.max(r.width, 280)
    const below = window.innerHeight - r.bottom
    const up = below < 320 && r.top > below
    setPos({ left: Math.min(r.left, window.innerWidth - width - 8), width, ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) })
  }
  const show = () => { if (disabled) return; place(); setQ(''); setHi(0); setOpen(true) }
  const pick = (v) => { setOpen(false); if (v !== value) onChange?.(v) }

  useEffect(() => {
    if (!open) return
    setTimeout(() => input.current?.focus(), 0)
    const close = (e) => { if (!listRef.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', place)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', place) }
  }, [open])

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[hi]; if (it) pick(it.value ?? it.id) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const sm = size === 'sm'
  return (
    <>
      <button type="button" ref={btn} onClick={() => (open ? setOpen(false) : show())} disabled={disabled} title={current ? label : undefined}
        className={`inline-flex items-center justify-between gap-1.5 text-left border transition disabled:opacity-60 ${sm
          ? `text-[11px] px-2 py-1 rounded-lg max-w-[150px] ${danger ? 'border-red-200 bg-red-50 text-red-600 font-semibold' : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'}`
          : 'input py-2.5'} ${className}`}>
        <span className={`truncate ${current ? '' : 'text-slate-400'}`}>{label}</span>
        <ChevronDown size={sm ? 12 : 14} className="flex-shrink-0 opacity-60" />
      </button>
      {open && pos && createPortal(
        <div ref={listRef} className="fixed z-[400] bg-white rounded-xl border border-slate-200 shadow-[0_18px_40px_-12px_rgba(11,17,34,.35)] overflow-hidden animate-scale-in"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom }}>
          <div className="relative border-b border-slate-100">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setHi(0) }} onKeyDown={onKey}
              placeholder="Type ID, name, area or mobile…" className="w-full pl-9 pr-8 py-2.5 text-sm outline-none" />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400"><X size={13} /></button>}
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {items.map((it, i) => {
              const v = it.value ?? it.id
              const st = it.id ? stats[it.id] : null
              return (
                <li key={v || 'empty'}>
                  <button type="button" onMouseEnter={() => setHi(i)} onClick={() => pick(v)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs ${i === hi ? 'bg-brand-50' : ''}`}>
                    <span className="w-4 flex-shrink-0">{v === value && <Check size={13} className="text-brand-600" />}</span>
                    {it.id ? <>
                      <span className="font-mono text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 rounded flex-shrink-0">{it.tech_code || '—'}</span>
                      <span className="font-semibold text-slate-800 truncate">{it.name}</span>
                      <span className="text-slate-400 truncate">{it.city || ''}</span>
                      {!it.is_active && <span className="text-[10px] text-red-500">inactive</span>}
                      {showLoad && <span className={`ml-auto flex-shrink-0 text-[10px] font-semibold px-1.5 rounded-full ${Number(st?.pending) ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{Number(st?.pending || 0)} open</span>}
                    </> : <span className="font-semibold text-slate-600">{it.label}</span>}
                  </button>
                </li>
              )
            })}
            {!items.length && <li className="px-3 py-4 text-center text-xs text-slate-400">No technician matches “{q}”</li>}
            {!q && techs.length > 80 && <li className="px-3 py-1.5 text-[10px] text-slate-400 text-center">Showing 80 of {techs.length} — type to search</li>}
          </ul>
        </div>, document.body)}
    </>
  )
}
