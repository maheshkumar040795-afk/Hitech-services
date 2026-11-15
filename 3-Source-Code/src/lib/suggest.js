/**
 * Best technicians for an order's pin code. Order of preference:
 *   1. lives at the same pin code
 *   2. has already completed jobs at this pin code
 *   3. lives nearby (same first 3 digits = same postal sorting district)
 * Within each group the technician with fewer open jobs comes first, so work is spread evenly.
 *
 *   techs     technicians (id, pincode, is_active, …)
 *   pin       6-digit pin code of the order
 *   doneHere  { technicianId: completed jobs at this pin code }
 *   stats     { technicianId: { pending } } — open jobs, may be empty while loading
 * Returns up to `max` technicians, each with `why` (label shown in the picker).
 */
export function suggestForPin(techs, pin, doneHere = {}, stats = {}, max = 5) {
  if (!/^\d{6}$/.test(pin || '')) return []
  const open = (t) => Number(stats[t.id]?.pending || 0)
  const out = []
  for (const t of techs) {
    if (!t.is_active) continue
    const own = String(t.pincode || '').trim()
    const done = Number(doneHere[t.id] || 0)
    let tier = 0, why = ''
    if (own === pin) { tier = 1; why = done ? `Same pin code · ${done} done here` : 'Same pin code' }
    else if (done) { tier = 2; why = `${done} done here` }
    else if (/^\d{6}$/.test(own) && own.slice(0, 3) === pin.slice(0, 3)) { tier = 3; why = `Nearby · ${own}` }
    if (tier) out.push({ ...t, why, tier, done })
  }
  out.sort((a, b) => a.tier - b.tier || (a.tier === 2 ? b.done - a.done : 0) || open(a) - open(b) || String(a.name).localeCompare(String(b.name)))
  return out.slice(0, max).map(({ tier, done, ...t }) => t)
}
