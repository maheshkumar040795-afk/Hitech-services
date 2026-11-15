import * as XLSX from 'xlsx'

// Header name (any case / spacing) → field. First match wins.
const FIELD_ALIASES = {
  order_date:    ['DATE', 'ORDERDATE'],
  order_id:      ['SERVICEORDERID', 'SERVICEORDERNO', 'ORDERID', 'ORDERNO', 'ORDERNUMBER'],
  customer_name: ['CUSTOMERNAME', 'CUSTOMER', 'NAME'],
  phone_no:      ['PHONENO', 'PHONE', 'MOBILE', 'MOBILENO', 'CONTACT', 'PHONENUMBER'],
  service:       ['SERVICE', 'PRODUCTNAME', 'PRODUCT'],
  brand:         ['BRAND'],
  product_type:  ['PRODUCTTYPE', 'CATEGORY', 'APPLIANCE', 'APPLIANCETYPE'],
  location:      ['LOCATION', 'CITY', 'AREA'],
  address:       ['ADDRESS', 'FULLADDRESS'],
  location_url:  ['LOCATIONURL', 'GOOGLELOCATION', 'GOOGLELOCATIONURL', 'GOOGLEMAP', 'GOOGLEMAPS', 'GOOGLEMAPLINK', 'MAPLINK', 'MAPURL', 'MAP', 'LOCATIONLINK'],
  pin_code:      ['PINCODE', 'PIN', 'POSTALCODE', 'ZIPCODE'],
  technician:    ['TECHNICIAN', 'TECHNICIANNAME', 'TECH'],
  status:        ['STATUS'],
  comments:      ['COMMENTS', 'COMMENT', 'REMARKS'],
}
const norm = (h) => String(h || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const pad = (n) => String(n).padStart(2, '0')

/** Excel serial / Date / '4/25/2025' / '25-04-2025' / '2025-04-25' → 'yyyy-mm-dd' or '' */
export function toISODate(v) {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    return d ? `${d.y}-${pad(d.m)}-${pad(d.d)}` : ''
  }
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  const s = String(v).trim()
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/)
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    let [, a, b, y] = m
    a = +a; b = +b; y = +y < 100 ? 2000 + +y : +y
    // Amazon sheets use M/D/YYYY. If the first part can't be a month, treat as D/M/YYYY.
    let month = a, day = b
    if (a > 12 && b <= 12) { month = b; day = a }
    if (month < 1 || month > 12 || day < 1 || day > 31) return ''
    return `${y}-${pad(month)}-${pad(day)}`
  }
  return ''
}

/** Read the first sheet of an .xlsx/.xls/.csv file → normalised order rows */
export async function parseOrdersFile(file) {
  return parseOrdersBuffer(await file.arrayBuffer())
}

/** Same as parseOrdersFile, for file bytes that did not come from a file picker (Google Sheet import) */
export function parseOrdersBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
  if (!raw.length) throw new Error('The sheet has no data rows')

  const headers = Object.keys(raw[0])
  const colFor = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const h = headers.find((x) => aliases.includes(norm(x)))
    if (h) colFor[field] = h
  }
  if (!colFor.order_id || !colFor.customer_name) {
    throw new Error('Could not find the "SERVICE_ORDER_ID" and "CUSTOMER NAME" columns. Download the template to see the format.')
  }

  const rows = raw
    .map((r) => {
      const o = {}
      for (const [field, h] of Object.entries(colFor)) {
        const v = r[h]
        o[field] = field === 'order_date' ? toISODate(v) : String(v ?? '').trim()
      }
      if (o.phone_no) o.phone_no = o.phone_no.replace(/\.0$/, '')
      if (o.pin_code) o.pin_code = o.pin_code.replace(/\.0$/, '')
      return o
    })
    .filter((o) => Object.values(o).some((v) => v)) // drop blank lines

  return { rows, columns: Object.keys(colFor) }
}

export function downloadXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new()
  for (const { name, rows, widths } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'No data for the selected filters' }])
    const keys = Object.keys(rows[0] || { Info: '' })
    ws['!cols'] = keys.map((k, i) => ({ wch: widths?.[i] || Math.max(k.length + 2, 14) }))
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

/** Order sheet columns — same order as the Hi-Tech model sheet (upload, template and export) */
export const ORDER_SHEET_COLUMNS = ['DATE', 'SERVICE_ORDER_ID', 'CUSTOMER NAME', 'PHONE NUMBER', 'SERVICE', 'BRAND', 'PRODUCT_TYPE', 'LOCATION', 'PIN CODE', 'TECHNICIAN', 'STATUS']

export function downloadOrdersTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ORDER_SHEET_COLUMNS,
    ['11/2/2026', '404-2330510-9169150', 'Suresh', '9585986893', 'TV Installation Service (PP)', 'PHILIPS', 'TELEVISION', 'TIRUNELVELI', '627102', 'Azar', 'NOT_SERVICED'],
    ['11/2/2026', '403-5405966-8456307', 'Sathiyaraj', '9698787620', 'TV Installation Service (PP)', 'PHILIPS', 'TELEVISION', 'ARIYALUR', '612903', 'Karthikeyan J', 'COMPLETED'],
    ['11/2/2026', '171-4273629-9033140', 'Gokulsendrayan', '6380241141', 'TV Installation Service', 'Visio World', 'TELEVISION', 'ERODE', '638504', 'Kavinesh', 'Physically completed'],
  ])
  ws['!cols'] = [12, 22, 18, 14, 30, 14, 14, 16, 10, 16, 20].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')
  XLSX.writeFile(wb, 'hitech-orders-template.xlsx')
}

export async function readSheetRows(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
}

/** Google Sheets link (or bare sheet id) → { id, gid }. null when it is not a Sheets link. */
export function parseSheetLink(input) {
  const s = String(input || '').trim()
  if (!s) return null
  if (/\/spreadsheets\/d\/e\//.test(s)) return { published: true }   // "Publish to web" link — has no sheet id
  const id = (s.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/) || [])[1] || (/^[A-Za-z0-9_-]{30,}$/.test(s) ? s : '')
  if (!id) return null
  const gid = (s.match(/[#?&]gid=(\d+)/) || [])[1] || ''
  return { id, gid }
}

const isXlsx = (buf) => { const b = new Uint8Array(buf.slice(0, 2)); return b[0] === 0x50 && b[1] === 0x4b }   // zip "PK"

/**
 * Download a Google Sheet shared as "Anyone with the link" as Excel bytes.
 * Tries the browser first (no setup needed); Google often refuses browsers, so the
 * fetch-sheet Edge Function is the fallback. `viaFunction(id, gid)` must return an ArrayBuffer.
 */
export async function fetchGoogleSheet(link, viaFunction) {
  const ref = parseSheetLink(link)
  if (!ref) throw new Error('Paste the link of a Google Sheet (https://docs.google.com/spreadsheets/d/…)')
  if (ref.published) throw new Error('This is a "Publish to web" link. Paste the normal link from the browser address bar or the Share button instead.')
  try {
    const res = await fetch(`https://docs.google.com/spreadsheets/d/${ref.id}/export?format=xlsx${ref.gid ? `&gid=${ref.gid}` : ''}`, { credentials: 'omit' })
    if (res.ok) { const buf = await res.arrayBuffer(); if (isXlsx(buf)) return buf }
  } catch { /* blocked by the browser → use the Edge Function */ }
  const buf = await viaFunction(ref.id, ref.gid)
  if (!isXlsx(buf)) throw new Error('Google did not return a sheet. Check that it is shared as "Anyone with the link".')
  return buf
}
