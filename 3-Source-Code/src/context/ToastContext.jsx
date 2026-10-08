import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'

const ToastContext = createContext(null)

const ICONS = {
  success: CheckCircle2,
  error:   AlertCircle,
  info:    Info,
}
const STYLES = {
  success: 'border-l-emerald-500 bg-emerald-50 text-emerald-800',
  error:   'border-l-red-500 bg-red-50 text-red-800',
  info:    'border-l-brand-500 bg-brand-50 text-brand-800',
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
              className={`flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border border-l-4 min-w-[280px] max-w-sm
                         pointer-events-auto animate-slide-up ${STYLES[t.type]}`}
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
