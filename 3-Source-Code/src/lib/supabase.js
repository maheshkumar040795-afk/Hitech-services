import { createClient } from '@supabase/supabase-js'

// Keys come from config.js (edit it without rebuilding) or, when developing with npm, from .env
const cfg = (typeof window !== 'undefined' && window.HITECH_CONFIG) || {}
const isSet = (v) => v && !String(v).includes('YOUR-')
const url = isSet(cfg.SUPABASE_URL) ? cfg.SUPABASE_URL : import.meta.env.VITE_SUPABASE_URL
const key = isSet(cfg.SUPABASE_ANON_KEY) ? cfg.SUPABASE_ANON_KEY : import.meta.env.VITE_SUPABASE_ANON_KEY
export const CONFIG_MISSING = !isSet(url) || !isSet(key)

export const supabase = createClient(url || 'https://missing.supabase.co', key || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

export const TECH_EMAIL_DOMAIN = cfg.TECH_EMAIL_DOMAIN || import.meta.env.VITE_TECH_EMAIL_DOMAIN || 'tech.htservice.in'

/** Office users type an email; technicians type their 10-digit mobile. */
export function loginToEmail(input) {
  const s = String(input || '').trim()
  if (s.includes('@')) return s.toLowerCase()
  const digits = s.replace(/\D/g, '')
  return `${digits.slice(-10)}@${TECH_EMAIL_DOMAIN}`
}

/** Friendly error text from Supabase / Postgres errors */
export function errMsg(e) {
  const m = e?.message || String(e || 'Something went wrong')
  if (m.includes('Invalid login credentials')) return 'Wrong mobile/email or password'
  if (m.includes('User is banned')) return 'This login has been disabled. Contact the office.'
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return 'No internet connection. Please try again.'
  if (m.startsWith('UPLOAD_LOCKED:')) return m.replace('UPLOAD_LOCKED:', '').trim()
  if (m.includes('duplicate key') && m.includes('technicians_name_ci')) return 'A technician with this name already exists'
  if (m.includes('duplicate key') && m.includes('mobile')) return 'This mobile number is already used by another technician'
  if (m.includes('technicians_mobile_check')) return 'Mobile must be a valid 10-digit number'
  if (m.includes('row-level security')) return 'You do not have permission to do this'
  return m
}

export async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw error
  return data
}

/** Call the admin-users Edge Function */
export async function adminAction(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action, ...payload } })
  if (error) {
    let msg = error.message
    try { const b = await error.context.json(); msg = b?.error || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

/** Supabase returns max 1000 rows per request — page through everything. */
export async function fetchAll(buildQuery, pageSize = 1000) {
  const out = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1)
    if (error) throw error
    out.push(...data)
    if (data.length < pageSize) break
  }
  return out
}

/** Strip characters that would break a PostgREST or() filter */
export const safeSearch = (q) => String(q || '').replace(/[,()*%\\]/g, ' ').trim()
