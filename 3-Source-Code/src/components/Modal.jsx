import { X } from 'lucide-react'

export default function Modal({ title, subtitle, onClose, children, width = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 bg-ink-950/45 backdrop-blur-md flex items-center justify-center z-50 p-4 animate-fade-in" onMouseDown={onClose}>
      <div className={`relative bg-white rounded-3xl border border-white/60 w-full ${width} p-6 shadow-[0_30px_80px_-20px_rgba(11,17,34,.45)] animate-scale-in max-h-[90vh] overflow-y-auto`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="absolute inset-x-0 top-0 h-1 rounded-t-3xl" style={{ background: 'var(--grad-brand)' }} />
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            <h3 className="text-base font-heading font-bold text-slate-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}
