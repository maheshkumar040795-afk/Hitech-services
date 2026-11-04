import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, rpc } from '../lib/supabase'

// Who has HT Jobs open right now — Supabase Realtime Presence (nothing is written to the database).
const TOPIC = 'ht-presence'

/** HT Jobs: announce "I'm online" while the app is open on screen; record login / last seen */
export function useTechPresence(technician) {
  useEffect(() => {
    if (!technician?.id) return
    let loginEvent = false
    try { loginEvent = sessionStorage.getItem('ht_login_event') === '1'; sessionStorage.removeItem('ht_login_event') } catch { /* ignore */ }
    rpc('tech_activity', { p_event: loginEvent ? 'login' : 'seen' }).catch(() => {})
    const seen = setInterval(() => document.visibilityState === 'visible' && rpc('tech_activity', { p_event: 'seen' }).catch(() => {}), 5 * 60_000)

    const ch = supabase.channel(TOPIC, { config: { presence: { key: technician.id } } })
    const track = () => ch.track({ name: technician.name, code: technician.tech_code || '', at: new Date().toISOString() }).catch(() => {})
    ch.subscribe((status) => { if (status === 'SUBSCRIBED' && document.visibilityState === 'visible') track() })
    const onVis = () => (document.visibilityState === 'visible' ? track() : ch.untrack().catch(() => {}))
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(seen); document.removeEventListener('visibilitychange', onVis); supabase.removeChannel(ch) }
  }, [technician?.id])
}

/** Office: set of technician ids that are online now */
export function useOnlineTechsLive(enabled = true) {
  const [online, setOnline] = useState(() => new Set())
  useEffect(() => {
    if (!enabled) return
    const ch = supabase.channel(TOPIC)
    ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState()))))
    ch.subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [enabled])
  return online
}

export const OnlineTechsContext = createContext(new Set())
export const useOnlineTechs = () => useContext(OnlineTechsContext)

/** Status of one technician for the office screens */
export function techStatus(t, online) {
  if (online?.has(t.id)) return 'online'
  if (!t.user_id) return 'noapp'
  const li = t.last_login_at ? new Date(t.last_login_at).getTime() : 0
  const lo = t.last_logout_at ? new Date(t.last_logout_at).getTime() : 0
  if (t.login?.is_active === false) return 'blocked'
  return li && li > lo ? 'loggedin' : 'loggedout'
}
export const STATUS_META = {
  online:    { label: 'Online',     dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  loggedin:  { label: 'Logged in',  dot: 'bg-sky-500',     chip: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  loggedout: { label: 'Logged out', dot: 'bg-slate-400',   chip: 'bg-slate-100 text-slate-600 ring-slate-400/20' },
  blocked:   { label: 'Blocked',    dot: 'bg-red-500',     chip: 'bg-red-50 text-red-600 ring-red-600/20' },
  noapp:     { label: 'No app',     dot: 'bg-amber-400',   chip: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
}
export function ago(ts) {
  if (!ts) return 'never'
  const m = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
}
