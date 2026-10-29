import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isIOS } from '../components/ui/IOSInstallSheet'

// Public half of the push key pair (config.js). The private half is a Supabase secret.
const PUBLIC_KEY = (typeof window !== 'undefined' && window.HITECH_CONFIG?.WEB_PUSH_PUBLIC_KEY) || ''

function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
const appUrl = () => `${location.origin}${location.pathname}`

/**
 * Phone notifications when the office assigns a job, even if HT Jobs is closed.
 * state: 'off' (not supported / not set up) | 'install-first' (iPhone: add to Home Screen first)
 *        | 'ask' | 'on' | 'blocked'
 */
export function usePushAlerts(technician, user) {
  const supported = !!PUBLIC_KEY && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const initial = () => {
    if (isIOS() && !standalone()) return 'install-first'
    if (!supported) return 'off'
    return Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'blocked' : 'ask'
  }
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)

  const save = useCallback(async () => {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_KEY) })
    const j = sub.toJSON()
    await supabase.from('push_subscriptions').upsert({
      endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth,
      user_id: user.id, technician_id: technician.id, app_url: appUrl(), user_agent: navigator.userAgent.slice(0, 200),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })
  }, [technician?.id, user?.id])

  // Already allowed → keep this phone's subscription fresh on every open
  useEffect(() => {
    if (state === 'on' && technician && user) save().catch(() => {})
  }, [state, technician, user, save])

  const enable = async () => {
    if (!supported) return false
    setBusy(true)
    try {
      const p = await Notification.requestPermission()
      if (p !== 'granted') { setState(p === 'denied' ? 'blocked' : 'ask'); return false }
      await save()
      setState('on')
      return true
    } catch { return false } finally { setBusy(false) }
  }
  return { state, enable, busy }
}
