// ════════════════════════════════════════════════════════════════════════════
//  Hitech Services — automatic daily backup
//  Runs on GitHub (see .github/workflows/daily-backup.yml), not on your PC.
//  Saves every table of the Supabase database as a CSV file in the  data/  folder.
//  CSV files open in Excel and can be imported back in Supabase (Table Editor → Import).
//
//  Needs two settings (the workflow passes them in):
//    SUPABASE_URL                your project URL
//    SUPABASE_SERVICE_ROLE_KEY   the SECRET key — stored as a GitHub secret, never in a file
//  No npm install needed (plain Node 20+).
// ════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs'
import path from 'node:path'

const URL_ = (process.env.SUPABASE_URL || '').replace(/\/+$/, '')
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const OUT = process.env.BACKUP_DIR || 'data'
const PAGE = 1000

// Used only if the list of tables cannot be read from Supabase
const FALLBACK_TABLES = ['orders', 'technicians', 'profiles', 'comment_logs', 'audit_logs', 'bills', 'upload_logs',
  'app_settings', 'service_rates', 'pin_reset_requests']
// Phone push tokens: useless in a restore (phones register again), so they are left out
const SKIP = new Set(['push_subscriptions'])

if (!URL_ || !KEY) {
  console.error('::error::SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Add the secret in GitHub → Settings → Secrets and variables → Actions.')
  process.exit(1)
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }

async function get(pathAndQuery, extra = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${URL_}/rest/v1/${pathAndQuery}`, { headers: { ...headers, ...extra } })
      if (res.ok) return res.json()
      const text = (await res.text()).slice(0, 300)
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`Supabase refused the key (HTTP ${res.status}). Check the SUPABASE_SERVICE_ROLE_KEY secret.`), { fatal: true })
      if (res.status < 500 || attempt >= 4) throw Object.assign(new Error(`HTTP ${res.status} for ${pathAndQuery.split('?')[0]}: ${text}`), { fatal: true })
    } catch (e) {
      if (e.fatal || attempt >= 4) throw e
    }
    await new Promise((r) => setTimeout(r, attempt * 3000))
  }
}

/** Every table in the public schema, with its columns: { orders: ['id', 'order_id', …], … } */
async function listTables() {
  try {
    const spec = await get('', { Accept: 'application/openapi+json' })
    const defs = spec.definitions || {}
    const tables = {}
    for (const [p, ops] of Object.entries(spec.paths || {})) {
      const name = p.replace(/^\//, '')
      if (!name || name.startsWith('rpc/') || !ops.get || !defs[name]) continue
      tables[name] = Object.keys(defs[name].properties || {})
    }
    if (Object.keys(tables).length) return tables
  } catch (e) {
    console.log(`Could not read the table list (${e.message}); using the built-in list.`)
  }
  return Object.fromEntries(FALLBACK_TABLES.map((t) => [t, null]))
}

async function readTable(name, columns) {
  // A fixed sort order keeps pages from overlapping while the office is working
  const sortBy = !columns ? null : columns.includes('id') ? 'id' : columns.includes('created_at') ? 'created_at' : columns[0]
  const rows = []
  for (let offset = 0; ; offset += PAGE) {
    const page = await get(`${encodeURIComponent(name)}?select=*${sortBy ? `&order=${encodeURIComponent(sortBy)}.asc` : ''}&limit=${PAGE}&offset=${offset}`)
    rows.push(...page)
    if (page.length < PAGE) break
  }
  return rows
}

const cell = (v) => {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(rows, columns) {
  const cols = columns?.length ? columns : [...new Set(rows.flatMap((r) => Object.keys(r)))]
  // The first character (BOM) makes Excel show Tamil and other non-English text correctly
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}

async function main() {
  const tables = await listTables()
  fs.mkdirSync(OUT, { recursive: true })
  const counts = {}
  for (const name of Object.keys(tables).sort()) {
    if (SKIP.has(name)) continue
    let rows
    try { rows = await readTable(name, tables[name]) } catch (e) {
      // A table from the built-in list that this database does not have yet is not an error
      if (!tables[name] && /HTTP 404/.test(e.message)) { console.log(`- ${name}: not in this database, skipped`); continue }
      throw e
    }
    fs.writeFileSync(path.join(OUT, `${name}.csv`), toCsv(rows, tables[name]))
    counts[name] = rows.length
    console.log(`✓ ${name}: ${rows.length} rows`)
  }
  if (!('orders' in counts)) throw new Error('The orders table was not found. Is SUPABASE_URL correct?')

  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
  fs.writeFileSync(path.join(OUT, 'LAST-BACKUP.txt'),
    `Last backup: ${when} (India time)\n\n` + Object.entries(counts).map(([t, n]) => `${t.padEnd(22)} ${n} rows`).join('\n') + '\n')
  const summary = `${counts.orders} orders, ${counts.technicians ?? 0} technicians`
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `summary=${summary}\n`)
  console.log(`Backup complete: ${summary}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => { console.error(`::error::Backup failed: ${e.message}`); process.exit(1) })
}
