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
    staleTime: 60_000,
  })
}

/** Per-technician counts; keyed by technician id */
export function useTechStats(from = null, to = null) {
  return useQuery({
    queryKey: ['tech-stats', from, to],
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
