import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useTechnicians } from '../hooks/useData'
import { techLabel } from '../lib/format'
import TechPicker from '../components/TechPicker'
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
  const [height, setHeight] = useState(900)
  const observer = useRef(null)

  // Grow the frame to fit the generator, so the page scrolls normally (no box-inside-a-box on phones)
  const onLoad = () => {
    const doc = frame.current?.contentDocument
    if (!doc?.body) return
    const fit = () => setHeight(Math.max(400, Math.ceil(doc.body.getBoundingClientRect().height) + 8))
    observer.current?.disconnect()
    observer.current = new ResizeObserver(fit)
    observer.current.observe(doc.body)
    fit()
  }
  useEffect(() => () => observer.current?.disconnect(), [])
  const newCard = () => { setPick(''); frame.current?.contentWindow?.resetForm?.(); frame.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }

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
          <TechPicker techs={techs} value={pick} onChange={fill} showLoad={false} placeholder="Fill from technician…" className="flex-1 sm:flex-none sm:min-w-[260px] py-2" />
          <button onClick={newCard} className="btn-primary text-xs py-2.5"><Plus size={14} /> New ID Card</button>
        </div>
      </div>
      <iframe ref={frame} src="./id-cards.html" title="ID card generator" onLoad={onLoad} scrolling="no"
        className="w-full block border-0 bg-transparent" style={{ height }} />
    </div>
  )
}
