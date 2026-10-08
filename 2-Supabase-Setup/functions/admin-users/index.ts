// ════════════════════════════════════════════════════════════════════════════
//  Edge Function: admin-users
//  Creating logins needs the secret service-role key, which must never be in the
//  browser. So the web app calls this function, it checks the caller is an ADMIN,
//  then does the privileged work.
//
//  Actions (POST JSON body { action, ... }):
//    create_staff        { name, email, password, role: 'ADMIN' | 'STAFF' }
//    update_staff        { user_id, name?, role? }
//    set_tech_login      { technician_id, password }   create OR reset technician app login
//    set_password        { user_id, password }
//    set_active          { user_id, active: boolean }   block / unblock login
//
//  Deploy:  Supabase Dashboard → Edge Functions → Deploy new function → name "admin-users"
//           → paste this file → Deploy.   (or: supabase functions deploy admin-users)
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2'

// Must match VITE_TECH_EMAIL_DOMAIN in the web app (.env). Technicians never see this.
const TECH_EMAIL_DOMAIN = Deno.env.get('TECH_EMAIL_DOMAIN') ?? 'tech.htservice.in'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const bad = (msg: string) => { throw new HttpError(400, msg) }

const BAN_FOREVER = '876000h' // ~100 years

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // ── Who is calling? Must be an active ADMIN ───────────────────────────
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !caller) throw new HttpError(401, 'Please log in again')
    const { data: me } = await admin.from('profiles').select('id, role, is_active').eq('id', caller.id).maybeSingle()
    if (!me || !me.is_active || me.role !== 'ADMIN') throw new HttpError(403, 'Admin access required')

    const body = await req.json().catch(() => ({}))
    const audit = (action: string, entityId: string, note: string, newValue: unknown = null) =>
      admin.from('audit_logs').insert({ action, entity_type: 'user', entity_id: entityId, note, new_value: newValue, actor_id: caller.id })

    const checkPassword = (pw: unknown) => {
      if (typeof pw !== 'string' || pw.length < 6) bad('Password / PIN must be at least 6 characters')
    }

    switch (body.action) {
      // ── Office user ───────────────────────────────────────────────────────
      case 'create_staff': {
        const name = String(body.name ?? '').trim()
        const email = String(body.email ?? '').trim().toLowerCase()
        const role = body.role === 'ADMIN' ? 'ADMIN' : 'STAFF'
        if (name.length < 2) bad('Name is required')
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) bad('Valid email is required')
        if (email.endsWith('@' + TECH_EMAIL_DOMAIN)) bad('This email domain is reserved for technicians')
        checkPassword(body.password)

        const { data, error } = await admin.auth.admin.createUser({
          email, password: body.password, email_confirm: true, user_metadata: { name },
        })
        if (error) bad(error.message.includes('already') ? 'A user with this email already exists' : error.message)
        const { error: pErr } = await admin.from('profiles').insert({
          id: data.user!.id, name, login: email, role, created_by: caller.id,
        })
        if (pErr) { await admin.auth.admin.deleteUser(data.user!.id); bad(pErr.message) }
        await audit('USER_CREATED', data.user!.id, `${role} user ${name} (${email}) created`, { name, email, role })
        return json({ ok: true, user_id: data.user!.id })
      }

      case 'update_staff': {
        const patch: Record<string, unknown> = {}
        if (body.name) patch.name = String(body.name).trim()
        if (body.role) {
          if (!['ADMIN', 'STAFF'].includes(body.role)) bad('Invalid role')
          if (body.user_id === caller.id && body.role !== 'ADMIN') bad('You cannot remove your own admin access')
          patch.role = body.role
        }
        const { data: target } = await admin.from('profiles').select('role').eq('id', body.user_id).maybeSingle()
        if (!target) bad('User not found')
        if (target!.role === 'TECHNICIAN' && patch.role) bad('Technician role cannot be changed here')
        const { error } = await admin.from('profiles').update(patch).eq('id', body.user_id)
        if (error) bad(error.message)
        if (patch.role) await audit('USER_ROLE_CHANGED', body.user_id, `Role changed to ${patch.role}`, patch)
        return json({ ok: true })
      }

      // ── Technician app login (create or reset; also re-syncs mobile number) ─
      case 'set_tech_login': {
        checkPassword(body.password)
        const { data: tech } = await admin.from('technicians')
          .select('id, name, mobile, user_id, is_active').eq('id', body.technician_id).maybeSingle()
        if (!tech) bad('Technician not found')
        if (!tech!.mobile || !/^[6-9]\d{9}$/.test(tech!.mobile)) bad('Add a valid 10-digit mobile number to this technician first')
        const email = `${tech!.mobile}@${TECH_EMAIL_DOMAIN}`

        // Re-use an existing login if this technician (or this mobile) already had one
        let userId: string | null = tech!.user_id
        if (!userId) {
          const { data: existing } = await admin.from('profiles').select('id, role').eq('login', tech!.mobile).maybeSingle()
          if (existing) {
            if (existing.role !== 'TECHNICIAN') bad('This mobile number is already used by an office login')
            const { data: other } = await admin.from('technicians').select('id').eq('user_id', existing.id).maybeSingle()
            if (other && other.id !== tech!.id) bad('This mobile number is already linked to another technician')
            userId = existing.id
          }
        }

        if (userId) {
          const { error } = await admin.auth.admin.updateUserById(userId, {
            email, password: body.password, email_confirm: true, ban_duration: 'none',
          })
          if (error) bad(error.message)
          const { error: pErr } = await admin.from('profiles')
            .update({ name: tech!.name, login: tech!.mobile, is_active: true }).eq('id', userId)
          if (pErr) bad(pErr.message)
        } else {
          const { data, error } = await admin.auth.admin.createUser({
            email, password: body.password, email_confirm: true, user_metadata: { name: tech!.name },
          })
          if (error) bad(error.message.includes('already') ? 'A login for this mobile already exists — contact support' : error.message)
          userId = data.user!.id
          const { error: pErr } = await admin.from('profiles').insert({
            id: userId, name: tech!.name, login: tech!.mobile, role: 'TECHNICIAN', created_by: caller.id,
          })
          if (pErr) { await admin.auth.admin.deleteUser(userId); bad(pErr.message) }
        }

        const { error: lErr } = await admin.from('technicians').update({ user_id: userId }).eq('id', tech!.id)
        if (lErr) bad(lErr.message)
        await audit('TECH_LOGIN_SET', userId!, `App login set for technician ${tech!.name} (${tech!.mobile})`)
        return json({ ok: true, user_id: userId, login: tech!.mobile })
      }

      case 'set_password': {
        checkPassword(body.password)
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password })
        if (error) bad(error.message)
        await audit('PASSWORD_RESET', body.user_id, 'Password reset by admin')
        return json({ ok: true })
      }

      case 'set_active': {
        const active = body.active === true
        if (body.user_id === caller.id && !active) bad('You cannot deactivate your own account')
        const { error } = await admin.auth.admin.updateUserById(body.user_id, {
          ban_duration: active ? 'none' : BAN_FOREVER,
        })
        if (error) bad(error.message)
        const { data: p } = await admin.from('profiles').update({ is_active: active }).eq('id', body.user_id).select('name').maybeSingle()
        await audit(active ? 'USER_ACTIVATED' : 'USER_DEACTIVATED', body.user_id,
          `${p?.name ?? 'User'} ${active ? 'activated' : 'deactivated'}`)
        return json({ ok: true })
      }

      default:
        bad('Unknown action')
    }
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Server error: ' + (e as Error).message }, 500)
  }
  return json({ error: 'Unhandled' }, 500)
})
