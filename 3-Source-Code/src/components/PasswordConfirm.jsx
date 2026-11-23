import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { Lock, Trash2, Loader2, Eye, EyeOff } from 'lucide-react'
import { supabase, errMsg, SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase'
import Modal from './Modal'

/**
 * Admin password before deleting anything.
 *   const askPassword = usePasswordConfirm()
 *   if (!(await askPassword({ title: 'Delete 7 orders?', message: '…' }))) return
 * The password is checked with a separate, throw-away login, so the admin's own session is not touched.
 */
const Ctx = createContext(null)

async function passwordIsRight(password) {
  const { data } = await supabase.auth.getSession()
  const email = data.session?.user?.email
  if (!email) throw new Error('Please log in again')
  const check = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'ht-password-check' } })
  const { error } = await check.auth.signInWithPassword({ email, password })
  if (error) {
    if (/Invalid login credentials/i.test(error.message || '')) return false
    throw error
  }
  await check.auth.signOut({ scope: 'local' }).catch(() => {})   // only this throw-away login
  return true
}

export function PasswordConfirmProvider({ children }) {
  const [req, setReq] = useState(null)   // { title, message, action }
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const resolver = useRef(null)

  const ask = useCallback((opts = {}) => new Promise((resolve) => {
    resolver.current = resolve
    setPw(''); setErr(''); setShow(false); setBusy(false)
    setReq({ title: opts.title || 'Confirm delete', message: opts.message || '', action: opts.action || 'Delete' })
  }), [])

  const close = (ok) => { setReq(null); resolver.current?.(ok); resolver.current = null }
  const submit = async (e) => {
    e.preventDefault()
    if (!pw) return setErr('Enter your password')
    setBusy(true); setErr('')
    try {
      if (await passwordIsRight(pw)) return close(true)
      setErr('Wrong password')
    } catch (e2) { setErr(errMsg(e2)) } finally { setBusy(false) }
  }

  return (
    <Ctx.Provider value={ask}>
      {children}
      {req && (
        <Modal title={req.title} subtitle="Admin password needed" onClose={() => close(false)} width="max-w-sm">
          <form onSubmit={submit} className="space-y-4">
            {req.message && <p className="text-sm text-slate-600 bg-red-50 border border-red-200 rounded-xl p-3 whitespace-pre-line">{req.message}</p>}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your password</label>
              <div className="relative">
                <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={show ? 'text' : 'password'} className={`input pl-9 pr-10 ${err ? 'border-red-400' : ''}`} value={pw} autoFocus autoComplete="current-password"
                  onChange={(e) => { setPw(e.target.value); setErr('') }} placeholder="Enter your login password" />
                <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
              </div>
              {err && <p className="text-xs font-semibold text-red-600 mt-1.5">{err}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => close(false)} className="btn-secondary text-xs">Cancel</button>
              <button disabled={busy} className="btn-danger text-xs">{busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {req.action}</button>
            </div>
          </form>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

export const usePasswordConfirm = () => useContext(Ctx) || (async () => false)
