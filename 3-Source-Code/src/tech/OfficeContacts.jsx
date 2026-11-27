import { Phone, Headset } from 'lucide-react'
import { tr as t } from './i18n'

/** Hitech Services office numbers for technicians. Tapping a number opens the phone's dial pad (tel: link). */
export const OFFICE_PHONES = [
  { label: 'Primary office number', show: '+91 733 874 6746', tel: 'tel:+917338746746' },
  { label: 'Secondary number', show: '+91 63848 77877', tel: 'tel:+916384877877' },
]

export default function OfficeContacts({ compact = false }) {
  return (
    <div className="space-y-2">
      {!compact && <p className="text-sm text-slate-500">{t('Need help? Call the Hitech Services office.')}</p>}
      {OFFICE_PHONES.map((p, i) => (
        <a key={p.tel} href={p.tel}
          className="flex items-center gap-3 rounded-2xl border-2 border-slate-200 px-4 py-3 active:bg-slate-50">
          <span className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${i === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-brand-100 text-brand-700'}`}>
            {i === 0 ? <Headset size={20} /> : <Phone size={20} />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-xs font-semibold text-slate-500">{t(p.label)}</span>
            <span className="block text-[17px] font-bold text-slate-900 tabular-nums whitespace-nowrap">{p.show}</span>
          </span>
          <span className={`px-3 py-2 rounded-xl text-white text-sm font-bold flex items-center gap-1.5 flex-shrink-0 ${i === 0 ? 'bg-emerald-600' : 'bg-brand-600'}`}>
            <Phone size={15} /> {t('Call')}
          </span>
        </a>
      ))}
    </div>
  )
}
