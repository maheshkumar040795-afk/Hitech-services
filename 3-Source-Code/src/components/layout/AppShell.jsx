import { useState, Suspense, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, ClipboardList, Wrench, FileBarChart2, History, Users, Settings,
  LogOut, Contact2 as IdCard, ChevronLeft, ChevronRight, Wifi, WifiOff, Receipt, Menu, X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useOrdersRealtime } from '../../hooks/useRealtime'
import { usePinResets } from '../../hooks/useData'
import WelcomeModal from '../WelcomeModal'
import { ShieldCheck, CalendarDays, KeyRound as KeyIcon } from 'lucide-react'
import Logo from '../Logo'

const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, exact: true },
  { to: '/orders',      label: 'Orders',      icon: ClipboardList },
  { to: '/technicians', label: 'Technicians', icon: Wrench },
  { to: '/billing',     label: 'Billing',     icon: Receipt },
  { to: '/reports',     label: 'Reports',     icon: FileBarChart2, adminOnly: true },
  { to: '/audit',       label: 'Audit Log',   icon: History,       adminOnly: true },
  { to: '/users',       label: 'Users',       icon: Users,         adminOnly: true },
  { to: '/id-cards',    label: 'ID Cards',    icon: IdCard,        adminOnly: true },
  { to: '/settings',    label: 'Settings',    icon: Settings },
]

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
}

export default function AppShell() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Live: when anyone (office or technician) changes an order, refresh screens
  const connected = useOrdersRealtime({
    channelName: 'office',
    debounceMs: 3000,   // many technicians updating at once → one refresh every few seconds, not one per change
    onChange: () => {
      for (const key of ['orders', 'dashboard', 'tech-stats', 'order', 'reports']) qc.invalidateQueries({ queryKey: [key] })
    },
    onEvent: (p) => {
      const n = p.new
      if (p.eventType === 'UPDATE' && n?.modified_by && n.modified_by !== user?.id && n.closed_at &&
          Date.now() - new Date(n.closed_at).getTime() < 15000) {
        toast(`Order ${n.order_id} marked ${n.status === 'COMPLETED' ? 'COMPLETED' : 'NOT DONE'}`, n.status === 'COMPLETED' ? 'success' : 'info', 5000)
      }
    },
  })

  // Technicians' "Forgot PIN" requests → red badge on Technicians + a toast when a new one arrives
  const { data: pinResets = [] } = usePinResets(isAdmin)
  const seenResets = useRef(null)
  useEffect(() => {
    const ids = pinResets.map((r) => r.id + r.created_at)
    if (seenResets.current && ids.some((id) => !seenResets.current.includes(id))) toast('A technician forgot their PIN — see Technicians', 'info', 7000)
    seenResets.current = ids
  }, [pinResets, toast])

  const handleLogout = async () => { await logout(); navigate('/login') }
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin)

  const Sidebar = ({ mobile = false }) => (
    <aside className={`noise relative flex flex-col h-full overflow-hidden bg-gradient-to-b from-ink-900 via-ink-900 to-ink-950 ${mobile ? 'w-64' : collapsed ? 'w-16' : 'w-[var(--sidebar-w)]'} transition-[width] duration-300 flex-shrink-0`}>
      <div className="aurora-blob animate-aurora w-56 h-56 -top-20 -left-24 bg-brand-500/50" />
      <div className="aurora-blob animate-aurora-2 w-48 h-48 bottom-10 -right-28 bg-sky-500/30" />
      <div className="relative flex items-center justify-between px-4 py-4 border-b border-white/[.07]">
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-2.5">
            <Logo size={40} />
            <div>
              <div className="text-white font-heading font-bold text-sm leading-tight tracking-tight">Hitech</div>
              <div className="text-sky-300/90 text-[10px] font-semibold uppercase tracking-[.18em] leading-tight">Services</div>
            </div>
          </div>
        ) : <Logo size={36} className="mx-auto" />}
        {mobile
          ? <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white p-1"><X size={16} /></button>
          : <button onClick={() => setCollapsed((p) => !p)} className="text-slate-400 hover:text-white p-1 rounded ml-auto">
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>}
      </div>
      <nav className="relative flex-1 py-4 space-y-1 px-2.5 overflow-y-auto">
        {(!collapsed || mobile) && <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">Workspace</p>}
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.exact} onClick={() => setMobileOpen(false)}
            title={collapsed && !mobile ? item.label : undefined}
            className={({ isActive }) => `group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
              ${isActive ? 'text-white bg-gradient-to-r from-brand-600/90 to-sky-500/80 shadow-glow ring-1 ring-white/15' : 'text-slate-400 hover:text-white hover:bg-white/[.06]'}`}>
            {({ isActive }) => <>
            {isActive && <span className="absolute -left-2.5 top-2 bottom-2 w-1 rounded-r-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,.9)]" />}
            <item.icon size={17} className={`flex-shrink-0 transition-transform duration-200 ${isActive ? '' : 'group-hover:scale-110'}`} />
            {(!collapsed || mobile) && <span className="truncate">{item.label}</span>}
            {item.to === '/technicians' && pinResets.length > 0 && (
              <span title="Forgot PIN requests" className={`${collapsed && !mobile ? 'absolute top-1 right-1' : 'ml-auto'} min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[11px] font-bold flex items-center justify-center ring-2 ring-ink-900`}>{pinResets.length}</span>
            )}
            </>}
          </NavLink>
        ))}
      </nav>
      <div className="relative p-3 border-t border-white/[.07]">
        <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl glass-dark hover:bg-white/10 group text-left transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-sky-300 to-brand-500 flex items-center justify-center text-xs font-extrabold text-white flex-shrink-0 ring-2 ring-white/10">
            {user?.name?.[0]?.toUpperCase()}
          </div>
          {(!collapsed || mobile) && <>
            <div className="flex-1 min-w-0">
              <div className="text-white text-xs font-medium truncate">{user?.name}</div>
              <div className="text-slate-500 text-[10px] truncate">{user?.role === 'ADMIN' ? 'Admin' : 'Office Staff'} · Sign out</div>
            </div>
            <LogOut size={13} className="text-slate-500 group-hover:text-red-400" />
          </>}
        </button>
      </div>
    </aside>
  )

  return (
    <div className="flex h-screen overflow-hidden">
      <WelcomeModal name={user?.name} badge={user?.role === 'ADMIN' ? 'Administrator' : 'Office Staff'}
        lines={[
          <><ShieldCheck size={16} className="text-brand-600 flex-shrink-0" /> Signed in to the Hitech Services operations dashboard</>,
          <><CalendarDays size={16} className="text-brand-600 flex-shrink-0" /> Live orders, technicians and reports are ready</>,
          ...(pinResets.length ? [<><KeyIcon size={16} className="text-amber-600 flex-shrink-0" /> {pinResets.length} technician{pinResets.length > 1 ? 's' : ''} asked for a new PIN</>] : []),
        ]} closeLabel="Go to dashboard" />
      <div className="hidden lg:flex"><Sidebar /></div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="relative animate-slide-up"><Sidebar mobile /></div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-[var(--header-h)] bg-white/70 backdrop-blur-xl border-b border-slate-200/70 flex items-center justify-between px-4 lg:px-6 flex-shrink-0 gap-3 relative z-20">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600"><Menu size={18} /></button>
            <div className="min-w-0">
              <p className="text-[15px] font-heading font-bold text-slate-800 truncate">{greeting()}, <span className="bg-gradient-to-r from-brand-700 to-sky-500 bg-clip-text text-transparent">{user?.name}</span></p>
              <p className="text-[11px] text-slate-400 mt-0.5 hidden sm:block">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full ring-1 ring-inset ${connected ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-100 text-slate-500 ring-slate-300/50'}`}
               title={connected ? 'Live updates on' : 'Live updates reconnecting'}>
            {connected ? <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot" /> : <WifiOff size={11} />}
            {connected ? 'Live' : 'Offline'}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Suspense fallback={<div className="text-sm text-slate-400 p-6">Loading…</div>}><div key={location.pathname} className="page-enter-wrap animate-fade-in"><Outlet /></div></Suspense>
        </main>
      </div>
    </div>
  )
}
