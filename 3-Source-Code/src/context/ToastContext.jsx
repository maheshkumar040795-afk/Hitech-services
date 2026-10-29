import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error:   AlertCircle,
  info:    Info,
}
const STYLES = {
  success: 'text-emerald-800 [&>svg]:text-emerald-500 before:bg-emerald-500',
  error:   'text-red-800 [&>svg]:text-red-500 before:bg-red-500',
  info:    'text-brand-800 [&>svg]:text-brand-500 before:bg-brand-500',
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const toast = useCallback((message, type = 'info', duration = 3500) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  const dismiss = useCallback((id) => setToasts(prev => prev.filter(t => t.id !== id)), [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container */}
      <div className="fixed top-4 right-4 z-[999] space-y-2 pointer-events-none">
        {toasts.map(t => {
          const Icon = ICONS[t.type] || Info
          return (
            <div
              key={t.id}
              className={`relative overflow-hidden flex items-start gap-3 pl-5 pr-4 py-3.5 rounded-2xl bg-white/90 backdrop-blur-xl border border-slate-200/70
                         shadow-[0_18px_40px_-14px_rgba(11,17,34,.35)] min-w-[280px] max-w-sm pointer-events-auto animate-scale-in
                         before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${STYLES[t.type]}`}
            >
              <Icon size={16} className="flex-shrink-0 mt-0.5" />
              <span className="flex-1 text-sm font-medium leading-snug">{t.message}</span>
              <button onClick={() => dismiss(t.id)} className="text-current opacity-50 hover:opacity-100 flex-shrink-0">
                <X size={14} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
