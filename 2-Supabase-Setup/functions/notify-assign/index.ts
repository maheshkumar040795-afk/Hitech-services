// ════════════════════════════════════════════════════════════════════════════
//  Edge Function: notify-assign
//  Sends "N new jobs assigned to you" to the technician's phone (web push) the
//  moment the office assigns jobs — works even when HT Jobs is closed.
//
//  Called by the database (trigger notify_job_assigned → pg_net) with { order_id }.
//  It trusts nothing in the request: it re-reads the order and only notifies for a
//  job assigned in the last 2 minutes. A bulk assignment sends ONE notification.
//
//  Deploy:  Supabase → Edge Functions → Deploy new function → name "notify-assign"
//           → paste this file → turn OFF "Verify JWT" (the database calls it) → Deploy.
//  Secrets: Edge Functions → Secrets → add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const ok = (msg: string) => new Response(JSON.stringify({ ok: true, msg }), { headers: { 'Content-Type': 'application/json' } })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const pub = Deno.env.get('VAPID_PUBLIC_KEY'), priv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!pub || !priv) return ok('VAPID keys not set')
  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@htservice.in', pub, priv)

  const { order_id } = await req.json().catch(() => ({}))
  if (typeof order_id !== 'string') return ok('no order')

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Let a bulk assignment finish, so one message covers all of its jobs
  await sleep(2500)

  const { data: o } = await db.from('orders').select('id, technician_id, assigned_at, status, is_deleted').eq('id', order_id).maybeSingle()
  if (!o?.technician_id || o.is_deleted || ['COMPLETED', 'REJECTED'].includes(o.status) || !o.assigned_at) return ok('nothing to send')
  if (Date.now() - new Date(o.assigned_at).getTime() > 2 * 60_000) return ok('old assignment')

  // Jobs given to this technician in the same ~30 s burst
  const since = new Date(new Date(o.assigned_at).getTime() - 30_000).toISOString()
  const { data: batch = [] } = await db.from('orders')
    .select('id, customer_name, location, pin_code, assigned_at')
    .eq('technician_id', o.technician_id).eq('is_deleted', false)
    .not('status', 'in', '(COMPLETED,REJECTED)')
    .gte('assigned_at', since)
    .order('assigned_at', { ascending: false }).order('id', { ascending: false })
  if (!batch?.length || batch[0].id !== o.id) return ok('another job in this batch sends the message')

  const { data: subs = [] } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth, app_url').eq('technician_id', o.technician_id)
  if (!subs?.length) return ok('technician has not turned on alerts')

  const n = batch.length
  const names = batch.slice(0, 3).map((j) => [j.customer_name, j.location].filter(Boolean).join(' · ')).join('\n')
  let sent = 0
  for (const s of subs) {
    const payload = JSON.stringify({
      title: `${n} new job${n > 1 ? 's' : ''} assigned to you`,
      body: names + (n > 3 ? `\n+${n - 3} more` : ''),
      url: s.app_url || './tech/',
    })
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 3600, urgency: 'high' })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id)   // phone unsubscribed / app removed
    }
  }
  return ok(`sent ${sent}/${subs.length}`)
})
