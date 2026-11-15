// ════════════════════════════════════════════════════════════════════════════
//  Edge Function: fetch-sheet
//  Orders → "Google Sheet" downloads a shared Google Sheet as an Excel file so the
//  office can import it without saving and uploading the file by hand.
//  Browsers are not always allowed to read Google's file directly, so the web app
//  asks this function to fetch it instead.
//
//  POST JSON body { sheet_id, gid? }  →  the sheet as .xlsx bytes
//  Only logged-in office users (ADMIN / STAFF) can call it, and it can only read
//  docs.google.com spreadsheets shared as "Anyone with the link".
//
//  Deploy:  Supabase Dashboard → Edge Functions → Deploy new function → name "fetch-sheet"
//           → paste this file → Deploy. Keep "Verify JWT" ON.
// ════════════════════════════════════════════════════════════════════════════
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_BYTES = 15 * 1024 * 1024
const NOT_SHARED = 'Google did not allow reading this sheet. In Google Sheets click Share → General access → "Anyone with the link" (Viewer), then try again.'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    // ── Who is calling? Must be an active office user ─────────────────────
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: { user: caller }, error: authErr } = await admin.auth.getUser(token)
    if (authErr || !caller) return json({ error: 'Please log in again' }, 401)
    const { data: me } = await admin.from('profiles').select('role, is_active').eq('id', caller.id).maybeSingle()
    if (!me || !me.is_active || !['ADMIN', 'STAFF'].includes(me.role)) return json({ error: 'Office access required' }, 403)

    // ── Which sheet? Only an id is accepted, never a free URL ─────────────
    const body = await req.json().catch(() => ({}))
    const sheetId = String(body.sheet_id ?? '')
    const gid = String(body.gid ?? '')
    if (!/^[A-Za-z0-9_-]{20,120}$/.test(sheetId)) return json({ error: 'This does not look like a Google Sheets link' }, 400)
    if (gid && !/^\d{1,12}$/.test(gid)) return json({ error: 'This does not look like a Google Sheets link' }, 400)

    const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=xlsx${gid ? `&gid=${gid}` : ''}`
    const res = await fetch(url, { redirect: 'follow' })
    const type = res.headers.get('content-type') ?? ''
    // A sheet that is not shared answers with Google's sign-in page (HTML) instead of a file
    if (!res.ok || type.includes('text/html')) {
      return json({ error: res.status === 404 ? 'Google could not find this sheet. Check the link.' : NOT_SHARED }, 400)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length > MAX_BYTES) return json({ error: 'This sheet is too large to import (over 15 MB)' }, 400)
    // .xlsx files are zip files and always start with "PK"
    if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return json({ error: NOT_SHARED }, 400)

    return new Response(bytes, { headers: { ...cors, 'Content-Type': 'application/octet-stream' } })
  } catch (e) {
    console.error(e)
    return json({ error: 'Could not read the Google Sheet. Please try again.' }, 500)
  }
})
