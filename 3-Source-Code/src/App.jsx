import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { CONFIG_MISSING } from './lib/supabase'
import { lazy, Suspense, useEffect } from 'react'
import PWABanners from './components/ui/PWABanners'
import TechLogin from './tech/TechLogin'
import TechApp from './tech/TechApp'

// Office screens load on demand, so technicians' phones only download the small HT Jobs app
const AppShell = lazy(() => import('./components/layout/AppShell'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const OrdersPage = lazy(() => import('./pages/OrdersPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))
const TechniciansPage = lazy(() => import('./pages/TechniciansPage'))
const AuditPage = lazy(() => import('./pages/AuditPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const IdCardsPage = lazy(() => import('./pages/IdCardsPage'))

/** true when running from …/tech/ (the HT Jobs app) */
const TECH_ENTRY = typeof window !== 'undefined' && !!window.HT_TECH_ENTRY

function Splash({ text = 'Loading…' }) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#f0f4f8]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
        <p className="text-sm text-slate-500 font-medium">{text}</p>
      </div>
    </div>
  )
}

/** Office pages: ADMIN + STAFF. Technicians are sent to their mobile app. */
function OfficeRoute({ children, adminOnly = false }) {
  const { user, loading, isTech, isAdmin } = useAuth()
  if (loading) return <Splash text="Loading Hitech Services…" />
  if (!user) return <Navigate to="/login" replace />
  if (isTech) return <Navigate to="/tech" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  return children
}

function TechRoute({ children }) {
  const { user, loading, isTech, logout } = useAuth()
  if (loading) return <Splash text="Loading your jobs…" />
  if (!user) return <Navigate to="/tech/login" replace />
  if (!isTech) {
    if (!TECH_ENTRY) return <Navigate to="/" replace />
    // An office login opened the technician app: don't show office screens here
    return (
      <div className="flex h-screen items-center justify-center p-6 bg-[#f1f3fa]">
        <div className="card p-6 max-w-sm text-center space-y-3">
          <p className="font-heading font-bold text-slate-900">This is the HT Jobs technician app</p>
          <p className="text-sm text-slate-500">Office accounts can't use it. Sign out and log in with a technician mobile number.</p>
          <button onClick={logout} className="btn-primary w-full justify-center">Sign out</button>
        </div>
      </div>
    )
  }
  return children
}

/** On the office site, technician pages move to the …/tech/ folder (the HT Jobs app) */
function GoToTechApp() {
  const { pathname } = useLocation()
  useEffect(() => { window.location.replace(`./tech/#${pathname}`) }, [pathname])
  return <Splash text="Opening HT Jobs…" />
}

/** HT Jobs (…/tech/): technician screens only — never the office login */
function TechOnlyRoutes() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route path="/tech/login" element={!loading && user ? <Navigate to="/tech" replace /> : <TechLogin />} />
      <Route path="/tech" element={<TechRoute><TechApp /></TechRoute>} />
      <Route path="*" element={<Navigate to="/tech" replace />} />
    </Routes>
  )
}

function AppRoutes() {
  const { user, isTech, loading } = useAuth()
  const home = isTech ? '/tech' : '/'
  return (
    <Routes>
      <Route path="/login" element={!loading && user ? <Navigate to={home} replace /> : <LoginPage />} />
      <Route path="/tech/*" element={<GoToTechApp />} />

      <Route path="/" element={<OfficeRoute><AppShell /></OfficeRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="technicians" element={<TechniciansPage />} />
        <Route path="billing" element={<BillingPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="reports" element={<OfficeRoute adminOnly><ReportsPage /></OfficeRoute>} />
        <Route path="audit" element={<OfficeRoute adminOnly><AuditPage /></OfficeRoute>} />
        <Route path="users" element={<OfficeRoute adminOnly><UsersPage /></OfficeRoute>} />
        <Route path="id-cards" element={<OfficeRoute adminOnly><IdCardsPage /></OfficeRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  if (CONFIG_MISSING) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-md text-sm text-slate-700 space-y-2">
          <h1 className="font-bold text-lg">Setup needed</h1>
          <p>Open <b>config.js</b> (next to index.html) and paste your Supabase <b>Project URL</b> and <b>anon / publishable key</b>, then reload this page.</p>
          <p className="text-xs text-slate-500">Supabase → Project Settings → API</p>
        </div>
      </div>
    )
  }
  return (
    <AuthProvider>
      <ToastProvider>
        <PWABanners />
        <Suspense fallback={<Splash />}>
          {TECH_ENTRY ? <TechOnlyRoutes /> : <AppRoutes />}
        </Suspense>
      </ToastProvider>
    </AuthProvider>
  )
}
