/**
 * usePWA — Phase 5
 * Handles:
 *  - Service worker registration
 *  - Install prompt (Add to Home Screen)
 *  - Offline/online detection
 *  - SW-sourced offline cache banner
 *  - Update available notification
 */
import { useState, useEffect, useRef } from 'react'

export function usePWA() {
  const [isOnline,       setIsOnline]       = useState(navigator.onLine)
  const [swReady,        setSwReady]        = useState(false)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [installPrompt,  setInstallPrompt]  = useState(null)
  const [isInstalled,    setIsInstalled]    = useState(false)
  const swRegistration = useRef(null)

  useEffect(() => {
    // ── Online/offline events ──
    const onOnline  = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)

    // ── Install prompt ──
    const onBeforeInstall = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    // ── Already installed (standalone mode) ──
    if (window.matchMedia('(display-mode: standalone)').matches) setIsInstalled(true)

    // ── Register service worker ──
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js', { scope: './' })
        .then(reg => {
          swRegistration.current = reg
          setSwReady(true)

          // Check for update
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  setUpdateAvailable(true)
                }
              })
            }
          })
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err))

      // Listen for sync-complete message from SW
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'sync-complete') {
          window.dispatchEvent(new CustomEvent('sw-sync-complete'))
        }
      })
    }

    return () => {
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
    }
  }, [])

  const promptInstall = async () => {
    if (!installPrompt) return false
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') { setIsInstalled(true); setInstallPrompt(null) }
    return outcome === 'accepted'
  }

  const applyUpdate = () => {
    if (swRegistration.current?.waiting) {
      swRegistration.current.waiting.postMessage({ type: 'SKIP_WAITING' })
      window.location.reload()
    }
  }

  return { isOnline, swReady, updateAvailable, installPrompt, isInstalled, promptInstall, applyUpdate }
}
