import { useQuery } from '@tanstack/react-query'
import { supabase, rpc } from '../lib/supabase'

/** All technicians (+ whether their app login is active) */
export function useTechnicians() {
  return useQuery({
    queryKey: ['technicians'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('technicians')
        .select('*, login:profiles!technicians_user_id_fkey(id, is_active, login)')
        .order('name')
      if (error) throw error
      return data
    },
    staleTime: 5 * 60_000,   // 300 technicians: load once, reuse across pages
  })
}

/** Per-technician counts; keyed by technician id */
export function useTechStats(from = null, to = null, opts = {}) {
  return useQuery({
    queryKey: ['tech-stats', from, to],
    staleTime: 60_000,
    ...opts,
    queryFn: async () => {
      const rows = await rpc('technician_stats', { p_from: from, p_to: to })
      return Object.fromEntries(rows.map((r) => [r.technician_id, r]))
    },
  })
}

export function useAppSettings() {
  return useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').eq('id', 1).single()
      if (error) throw error
      return data
    },
    staleTime: 300_000,
  })
}

/** Open "Forgot PIN" requests from technicians (empty until update-2026-10-forgot-pin.sql has been run) */
export function usePinResets(enabled = true) {
  return useQuery({
    queryKey: ['pin-resets'],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pin_reset_requests')
        .select('id, technician_id, mobile, created_at')
        .eq('status', 'OPEN')
        .order('created_at', { ascending: false })
      if (error) return []   // table not created yet → just show nothing
      return data
    },
    refetchInterval: 2 * 60_000,
    refetchIntervalInBackground: false,
  })
}

/** Mark a technician's open PIN requests as handled */
export async function resolvePinResets(technicianId, status = 'DONE') {
  const { data: { user } } = await supabase.auth.getUser()
  await supabase.from('pin_reset_requests')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: user?.id || null })
    .eq('technician_id', technicianId).eq('status', 'OPEN')
}
