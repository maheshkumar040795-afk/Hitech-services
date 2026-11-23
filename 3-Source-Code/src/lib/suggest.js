/**
 * Best technicians for an order, by pin code AND area. Order of preference:
 *   1. same pin code and same area (order Location = technician City/Area)
 *   2. same pin code
 *   3. same area (order Location = technician City/Area)
 *   4. has already completed jobs at this pin code
 *   5. same district (order Location = technician District)
 *   6. lives nearby (same first 3 digits of the pin = same postal sorting district)
 * Within each group the technician with fewer open jobs comes first, so work is spread evenly.
 *
 *   techs     technicians (id, pincode, city, district, is_active, …)
 *   order     { pin, location } of the order
 *   doneHere  { technicianId: completed jobs at this pin code }
 *   stats     { technicianId: { pending } } — open jobs, may be empty while loading
 * Returns up to `max` technicians, each with `why` (label shown in the picker).
 */

// Tamil place names are spelt many ways: Kancheepuram / Kanchipuram, Thiruvallur / Tiruvallur
export function placeKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z]/g, '')
    .replace(/th/g, 't').replace(/ee|ii/g, 'i').replace(/oo|uu/g, 'u').replace(/aa/g, 'a').replace(/(.)\1+/g, '$1')
}
/** 'Mangadu, Chennai' → ['mangadu', 'chenai'] (words of 4+ letters) */
const placeWords = (s) => String(s || '').split(/[,/()\-]+|\s{1,}/).map(placeKey).filter((w) => w.length >= 4)

/** Does the order's location match this place (technician city or district)? */
export function samePlace(orderLocation, techPlace) {
  const a = placeKey(orderLocation), b = placeKey(techPlace)
  if (a.length < 4 || b.length < 4) return false
  if (a === b) return true
  const wa = placeWords(orderLocation), wb = new Set(placeWords(techPlace))
  return wa.some((w) => wb.has(w))
}

export function suggestForOrder(techs, { pin = '', location = '' } = {}, doneHere = {}, stats = {}, max = 6) {
  pin = String(pin || '').trim()
  const hasPin = /^\d{6}$/.test(pin)
  const hasLoc = placeKey(location).length >= 4
  if (!hasPin && !hasLoc) return []
  const open = (t) => Number(stats[t.id]?.pending || 0)
  const out = []
  for (const t of techs) {
    if (!t.is_active) continue
    const own = String(t.pincode || '').trim()
    const done = hasPin ? Number(doneHere[t.id] || 0) : 0
    const samePin = hasPin && own === pin
    const area = hasLoc && samePlace(location, t.city)
    const district = hasLoc && !area && samePlace(location, t.district)
    const doneTxt = done ? ` · ${done} done here` : ''
    let tier = 0, why = ''
    if (samePin && area) { tier = 1; why = `Same pin code & area${doneTxt}` }
    else if (samePin) { tier = 2; why = `Same pin code${doneTxt}` }
    else if (area) { tier = 3; why = `Same area · ${t.city}${doneTxt}` }
    else if (done) { tier = 4; why = `${done} done here` }
    else if (district) { tier = 5; why = `Same district · ${t.district}` }
    else if (hasPin && /^\d{6}$/.test(own) && own.slice(0, 3) === pin.slice(0, 3)) { tier = 6; why = `Nearby · ${own}` }
    if (tier) out.push({ ...t, why, tier, done })
  }
  out.sort((a, b) => a.tier - b.tier || (a.tier === 4 ? b.done - a.done : 0) || open(a) - open(b) || String(a.name).localeCompare(String(b.name)))
  return out.slice(0, max).map(({ tier, done, ...t }) => t)
}

/** Older name, pin code only */
export const suggestForPin = (techs, pin, doneHere, stats, max) => suggestForOrder(techs, { pin }, doneHere, stats, max)
