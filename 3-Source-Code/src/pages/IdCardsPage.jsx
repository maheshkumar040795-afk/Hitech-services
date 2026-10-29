import { useRef, useState } from 'react'
import { UserRoundSearch } from 'lucide-react'
import { useTechnicians } from '../hooks/useData'
import { techLabel } from '../lib/format'
import { useToast } from '../context/ToastContext'

/**
 * ID Cards — the Hitech ID card generator (public/id-cards.html, its own Firebase history),
 * shown inside the admin portal. "Fill from technician" copies name, Technician ID and mobile into the form.
 */
export default function IdCardsPage() {
  const frame = useRef(null)
  const { toast } = useToast()
  const { data: techs = [] } = useTechnicians()
  const [pick, setPick] = useState('')

  const fill = (id) => {
    setPick(id)
    const t = techs.find((x) => x.id === id)
    const w = frame.current?.contentWindow
    if (!t || !w?.document?.getElementById('empName')) return
    try {
      w.resetForm?.()
      const set = (k, v) => { const el = w.document.getElementById(k); if (el) el.value = v || '' }
      set('empName', t.name)
      set('empRole', 'Field Technician')
      set('empCode', t.tech_code || '')
      set('empContact', t.mobile ? `91${t.mobile}` : '')
      w.renderCard?.()
      toast(`Filled ${techLabel(t)} — add photo, DOB, sex & blood group, then Save & Generate`, 'info', 6000)
    } catch { toast('Could not fill the form — please type the details', 'error') }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-heading font-extrabold text-slate-900">ID Cards</h1>
          <p className="text-sm text-slate-500 mt-0.5">Generate employee ID cards · download PNG, PDF or print-ready CMYK</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <UserRoundSearch size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <select className="input pl-9 py-2 min-w-[240px]" value={pick} onChange={(e) => fill(e.target.value)}>
              <option value="">Fill from technician…</option>
              {techs.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{techLabel(t)}</option>)}
            </select>
          </div>
        </div>
      </div>
      <div className="card p-0 overflow-hidden">
        <iframe ref={frame} src="./id-cards.html" title="ID card generator" className="w-full block border-0"
          style={{ height: 'max(720px, calc(100vh - var(--header-h) - 150px))' }} />
      </div>
    </div>
  )
}
