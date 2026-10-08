import { X } from 'lucide-react'

export default function Modal({ title, subtitle, onClose, children, width = 'max-w-md' }) {
  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onMouseDown={onClose}>
      <div className={`card w-full ${width} p-6 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5 gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
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
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}
