/**
 * PWA Banners — Phase 5
 * Rendered once at the root level inside App.jsx
 * Shows: offline warning, update available, install prompt
 */
import { usePWA } from '../../hooks/usePWA'
import { WifiOff, RefreshCw, Download, X } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router-dom'

export default function PWABanners() {
  const { isOnline, updateAvailable, installPrompt, isInstalled, promptInstall, applyUpdate } = usePWA()
  const [dismissedInstall, setDismissedInstall] = useState(false)
  const { pathname } = useLocation()
  const isTechApp = pathname === '/tech' || pathname.startsWith('/tech/')
  // The technician login screen has its own install button
  if (pathname === '/tech/login') return null

  return (
    <>
      {/* Offline banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] flex items-center justify-center gap-2
                        bg-amber-500 text-white text-xs font-semibold py-2 px-4 animate-slide-up">
          <WifiOff size={13} />
          You're offline. Changes can't be saved until the internet is back.
        </div>
      )}

      {/* Update available banner */}
      {updateAvailable && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3
                        bg-slate-900 text-white text-sm px-5 py-3 rounded-2xl shadow-2xl animate-slide-up">
          <RefreshCw size={15} className="text-brand-400" />
          <span>A new version is available</span>
          <button
            onClick={applyUpdate}
            className="ml-1 px-3 py-1 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-500 transition-colors"
          >
            Update now
          </button>
        </div>
      )}

      {/* Install prompt (only on mobile, not already installed, not dismissed) */}
      {installPrompt && !isInstalled && !dismissedInstall && (
        <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 z-[200]
                        bg-white border border-slate-200 rounded-2xl shadow-2xl p-4 animate-slide-up">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center text-white font-bold text-lg flex-shrink-0">H</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900">Install {isTechApp ? 'HT Jobs' : 'Hitech Ops'}</p>
              <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Add to your home screen — opens like a normal app.</p>
            </div>
            <button onClick={() => setDismissedInstall(true)} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
              <X size={15} />
            </button>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setDismissedInstall(true)} className="btn-secondary flex-1 justify-center text-xs py-2">
              Not now
            </button>
            <button onClick={promptInstall} className="btn-primary flex-1 justify-center text-xs py-2">
              <Download size={13} /> Install
            </button>
          </div>
        </div>
      )}
    </>
  )
}
