import * as XLSX from 'xlsx'

// Header name (any case / spacing) → field. First match wins.
const FIELD_ALIASES = {
  order_date:    ['DATE', 'ORDERDATE'],
  order_id:      ['ORDERID', 'ORDERNO', 'ORDERNUMBER'],
  customer_name: ['CUSTOMERNAME', 'CUSTOMER', 'NAME'],
  phone_no:      ['PHONENO', 'PHONE', 'MOBILE', 'MOBILENO', 'CONTACT', 'PHONENUMBER'],
  service:       ['SERVICE', 'PRODUCTNAME', 'PRODUCT'],
  brand:         ['BRAND'],
  location:      ['LOCATION', 'CITY', 'AREA'],
  address:       ['ADDRESS', 'FULLADDRESS'],
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
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true })
  if (!raw.length) throw new Error('The file has no data rows')

  const headers = Object.keys(raw[0])
  const colFor = {}
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    const h = headers.find((x) => aliases.includes(norm(x)))
    if (h) colFor[field] = h
  }
  if (!colFor.order_id || !colFor.customer_name) {
    throw new Error('Could not find "ORDER ID" and "CUSTOMER NAME" columns. Download the template to see the format.')
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

export function downloadOrdersTemplate() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    ['DATE', 'ORDER ID', 'CUSTOMER NAME', 'PHONE NO', 'SERVICE', 'BRAND', 'LOCATION', 'ADDRESS', 'PIN CODE', 'TECHNICIAN', 'STATUS', 'COMMENTS'],
    ['10/6/2026', '406-0764915-3871521', 'Karthiga', '7708240150', 'AC Installation Service', 'Voltas', 'Kanchipuram', '12, Gandhi Road', '631502', 'Abinesh', 'Pending', 'Tomorrow Appointment'],
    ['10/6/2026', '406-6864501-1397130', 'Senthil', '9840067251', 'AC Installation Service', 'Godrej', 'Besant Nagar', '', '600090', '', 'Pending', ''],
  ])
  ws['!cols'] = [12, 24, 18, 14, 28, 12, 16, 28, 10, 14, 10, 22].map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Orders')
  XLSX.writeFile(wb, 'hitech-orders-template.xlsx')
}

export async function readSheetRows(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false })
}
