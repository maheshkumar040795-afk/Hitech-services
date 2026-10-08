import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Subscribe to live changes on the orders table (Supabase Realtime).
 * Security rules still apply — a technician only receives their own jobs.
 * onChange is debounced so a 100-row Excel upload triggers one refresh, not 100.
 */
export function useOrdersRealtime({ filter, onChange, onEvent, enabled = true, channelName = 'orders-live' }) {
  const [connected, setConnected] = useState(false)
  const cb = useRef({ onChange, onEvent })
  cb.current = { onChange, onEvent }

  useEffect(() => {
    if (!enabled) return
    let timer
    const channel = supabase
      .channel(`${channelName}-${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', ...(filter ? { filter } : {}) }, (payload) => {
        cb.current.onEvent?.(payload)
        clearTimeout(timer)
        timer = setTimeout(() => cb.current.onChange?.(), 700)
      })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'))
    return () => { clearTimeout(timer); supabase.removeChannel(channel) }
  }, [filter, enabled, channelName])

  return connected
}
