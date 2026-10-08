// All "today" logic uses India time, whatever the device clock zone is.
const IST = 'Asia/Kolkata'

export function todayIST() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date()) // yyyy-mm-dd
}

export function addDays(isoDate, n) {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** '2026-10-06' → '06 Oct 26' (date-only values, no timezone shift) */
export function fmtDate(isoDate, opts = { day: '2-digit', month: 'short', year: '2-digit' }) {
  if (!isoDate) return '—'
  const [y, m, d] = String(isoDate).slice(0, 10).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', { ...opts, timeZone: 'UTC' })
}

/** timestamp → '06 Oct, 4:35 pm' in IST */
export function fmtDateTime(ts, opts = { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('en-IN', { ...opts, timeZone: IST })
}

export function isTodayIST(ts) {
  if (!ts) return false
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(new Date(ts)) === todayIST()
}

export function fmtMoney(n) {
  const v = Number(n || 0)
  return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })
}

export const STATUS = {
  PENDING:   { label: 'Pending',   badge: 'badge-pending',   bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  COMPLETED: { label: 'Completed', badge: 'badge-completed', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  REJECTED:  { label: 'Rejected',  badge: 'badge-rejected',  bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
}

export function mapsUrl(o) {
  const q = [o.address, o.location, o.pin_code, 'Tamil Nadu'].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}

export function telUrl(phone) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10)
  return d ? `tel:+91${d}` : null
}

export function waUrl(phone, text = '') {
  const d = String(phone || '').replace(/\D/g, '').slice(-10)
  return d ? `https://wa.me/91${d}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null
}

const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
function words(n) {
  if (n === 0) return ''
  if (n < 20) return ones[n]
  if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
  if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + words(n % 100) : '')
  if (n < 100000) return words(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + words(n % 1000) : '')
  if (n < 10000000) return words(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + words(n % 100000) : '')
  return words(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + words(n % 10000000) : '')
}
export function amountToWords(total) {
  if (!total) return ''
  const rs = Math.floor(total)
  const ps = Math.round((total - rs) * 100)
  return (rs ? words(rs) + ' Rupees' : '') + (ps ? (rs ? ' and ' : '') + words(ps) + ' Paise' : '') + ' Only'
}
