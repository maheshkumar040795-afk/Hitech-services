import { useState, Suspense } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  LayoutDashboard, ClipboardList, Wrench, FileBarChart2, History, Users, Settings,
  LogOut, ChevronLeft, ChevronRight, Wifi, WifiOff, Receipt, Menu, X,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { useOrdersRealtime } from '../../hooks/useRealtime'

const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',   icon: LayoutDashboard, exact: true },
  { to: '/orders',      label: 'Orders',      icon: ClipboardList },
  { to: '/technicians', label: 'Technicians', icon: Wrench },
  { to: '/billing',     label: 'Billing',     icon: Receipt },
  { to: '/reports',     label: 'Reports',     icon: FileBarChart2, adminOnly: true },
  { to: '/audit',       label: 'Audit Log',   icon: History,       adminOnly: true },
  { to: '/users',       label: 'Users',       icon: Users,         adminOnly: true },
  { to: '/settings',    label: 'Settings',    icon: Settings },
]

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(new Date()))
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
}

export default function AppShell() {
  const { user, logout, isAdmin } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  // Live: when anyone (office or technician) changes an order, refresh screens
  const connected = useOrdersRealtime({
    channelName: 'office',
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

  const handleLogout = async () => { await logout(); navigate('/login') }
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin)

  const Sidebar = ({ mobile = false }) => (
    <aside className={`flex flex-col bg-[var(--color-sidebar)] h-full ${mobile ? 'w-64' : collapsed ? 'w-16' : 'w-[var(--sidebar-w)]'} transition-all duration-200 flex-shrink-0`}>
      <div className="flex items-center justify-between px-4 py-4 border-b border-white/10">
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-white text-sm">H</div>
            <div>
              <div className="text-white font-semibold text-sm leading-tight">Hitech</div>
              <div className="text-slate-400 text-[10px] leading-tight">Services</div>
            </div>
          </div>
        ) : <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center font-bold text-white text-sm mx-auto">H</div>}
        {mobile
          ? <button onClick={() => setMobileOpen(false)} className="text-slate-400 hover:text-white p-1"><X size={16} /></button>
          : <button onClick={() => setCollapsed((p) => !p)} className="text-slate-400 hover:text-white p-1 rounded ml-auto">
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>}
      </div>
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.exact} onClick={() => setMobileOpen(false)}
            className={({ isActive }) => `flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150
              ${isActive ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-400 hover:text-white hover:bg-white/10'}`}>
            <item.icon size={16} className="flex-shrink-0" />
            {(!collapsed || mobile) && <span className="truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="p-3 border-t border-white/10">
        <button onClick={handleLogout} className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/10 group text-left">
          <div className="w-7 h-7 rounded-full bg-brand-500/30 flex items-center justify-center text-xs font-bold text-brand-300 flex-shrink-0">
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
    <div className="flex h-screen bg-[var(--color-bg)] overflow-hidden">
      <div className="hidden lg:flex"><Sidebar /></div>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative"><Sidebar mobile /></div>
        </div>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-[var(--header-h)] bg-white border-b border-[var(--color-border)] flex items-center justify-between px-4 lg:px-6 flex-shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100 text-slate-600"><Menu size={18} /></button>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{greeting()}, <span className="text-brand-600">{user?.name}</span></p>
              <p className="text-[11px] text-slate-400 mt-0.5 hidden sm:block">
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}
              </p>
            </div>
          </div>
          <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}
               title={connected ? 'Live updates on' : 'Live updates reconnecting'}>
            {connected ? <Wifi size={11} /> : <WifiOff size={11} />}
            {connected ? 'Live' : 'Offline'}
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Suspense fallback={<div className="text-sm text-slate-400 p-6">Loading…</div>}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  )
}
