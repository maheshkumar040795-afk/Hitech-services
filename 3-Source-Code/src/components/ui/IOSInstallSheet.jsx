import { useState } from 'react'
import { Share, PlusSquare, X, Compass, CheckCircle2 } from 'lucide-react'
import Logo from '../Logo'

/** iPhone / iPad detection (iPadOS reports itself as a Mac, so also check touch) */
export const isIOS = () => {
  const ua = navigator.userAgent || ''
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}
/** Chrome / Firefox / Edge on iPhone (Add to Home Screen is in their share menu on iOS 16.4+, but Safari is the reliable path) */
export const isIOSOtherBrowser = () => /crios|fxios|edgios|opios/i.test(navigator.userAgent || '')
/** In-app browsers (Instagram, Facebook, LinkedIn, Line…) have no "Add to Home Screen" */
export const isInAppBrowser = () => /fban|fbav|instagram|line\/|linkedinapp|snapchat|micromessenger/i.test(navigator.userAgent || '')

const Step = ({ n, children }) => (
  <li className="flex gap-3 items-start">
    <span className="w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center flex-shrink-0" style={{ background: 'var(--grad-brand)' }}>{n}</span>
    <div className="text-[15px] text-slate-700 leading-snug pt-0.5">{children}</div>
  </li>
)

export default function IOSInstallSheet({ appName = 'HT Jobs', onClose }) {
  const other = isIOSOtherBrowser()
  const inApp = isInAppBrowser()
  const [copied, setCopied] = useState(false)
  const copyLink = async () => { try { await navigator.clipboard.writeText(window.location.href); setCopied(true) } catch { window.prompt('Copy this link:', window.location.href) } }
  return (
    <div className="fixed inset-0 z-[300] bg-ink-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center animate-fade-in" onClick={onClose}>
      <div className="w-full sm:max-w-sm bg-white rounded-t-[28px] sm:rounded-[28px] p-6 pb-8 shadow-2xl animate-slide-up" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 2rem)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-5">
          <Logo size={48} />
          <div className="flex-1"><p className="font-heading font-extrabold text-lg text-slate-900 leading-tight">Install {appName}</p><p className="text-xs text-slate-500">on your iPhone home screen</p></div>
          <button onClick={onClose} className="p-2 -mr-2 rounded-full text-slate-400 active:bg-slate-100"><X size={20} /></button>
        </div>

        {(inApp || other) && (
          <div className="mb-5 p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-[13px] text-amber-900 leading-snug">
            <b>Open this page in Safari first.</b> {inApp ? 'This app’s built-in browser cannot add to the home screen.' : 'Safari works best for installing on iPhone.'}
            <button onClick={copyLink} className="block mt-2 font-semibold text-brand-700 underline">{copied ? 'Link copied ✓' : 'Copy link'}</button>
            <span className="text-amber-800/80"> then paste it in Safari.</span>
          </div>
        )}

        <ol className="space-y-4">
          <Step n={1}>Make sure this page is open in <b>Safari</b> <Compass size={15} className="inline -mt-0.5 text-sky-500" />. If you opened the link from WhatsApp, tap <b>⋯</b> or the <Compass size={14} className="inline -mt-0.5 text-sky-500" /> icon → <b>Open in Safari</b>.</Step>
          <Step n={2}>Tap the <b>Share</b> button <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 align-middle"><Share size={15} className="text-brand-600" /></span> at the bottom of the screen (top-right on iPad).</Step>
          <Step n={3}>Scroll down and tap <b>Add to Home Screen</b> <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-slate-100 align-middle"><PlusSquare size={15} className="text-slate-700" /></span></Step>
          <Step n={4}>Tap <b>Add</b> (top-right). Open <b>{appName}</b> from your home screen <CheckCircle2 size={15} className="inline -mt-0.5 text-emerald-500" /></Step>
        </ol>

        <button onClick={onClose} className="btn-primary w-full justify-center py-3.5 mt-6 rounded-2xl text-[15px]">Got it</button>
      </div>
    </div>
  )
}
