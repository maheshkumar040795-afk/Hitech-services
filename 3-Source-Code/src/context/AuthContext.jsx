import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, loginToEmail, errMsg } from '../lib/supabase'

const AuthContext = createContext(null)

/**
 * session  → Supabase login session (kept in the browser, auto-refreshed)
 * user     → our profile row { id, name, login, role, is_active }
 * technician → for TECHNICIAN logins: their technicians row
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still checking
  const [user, setUser] = useState(null)
  const [technician, setTechnician] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null))
    return () => sub.subscription.unsubscribe()
  }, [])

  const uid = session?.user?.id
  const checked = session !== undefined
  useEffect(() => {
    if (!checked) return
    if (!uid) { setUser(null); setTechnician(null); setLoading(false); return }
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle()
      if (cancelled) return
      if (error || !profile || !profile.is_active) {
        setAuthError(error ? errMsg(error) : 'Your login is not active. Contact the office.')
        await supabase.auth.signOut()
        return
      }
      let tech = null
      if (profile.role === 'TECHNICIAN') {
        const { data } = await supabase.from('technicians').select('*').eq('user_id', uid).maybeSingle()
        tech = data
      }
      if (cancelled) return
      setUser(profile)
      setTechnician(tech)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [uid, checked]) // not on every token refresh — only when the logged-in person changes

  const login = useCallback(async (loginId, password) => {
    setAuthError('')
    const { error } = await supabase.auth.signInWithPassword({ email: loginToEmail(loginId), password })
    if (error) throw new Error(errMsg(error))
  }, [])

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    setUser(null)
    setTechnician(null)
  }, [])

  const value = {
    session, user, technician, loading: loading || session === undefined, authError,
    login, logout,
    isAdmin: user?.role === 'ADMIN',
    isOffice: user?.role === 'ADMIN' || user?.role === 'STAFF',
    isTech: user?.role === 'TECHNICIAN',
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
