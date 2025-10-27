import React, { Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Modal from './components/Modal.jsx'
import LoadingOverlay from './components/LoadingOverlay.jsx'
import { I18nProvider, useI18n } from './components/i18n.jsx'

// Code-splitting: lazy-load route components
const HomePage = React.lazy(() => import('./pages/HomePage.jsx'))
const ViewListingPage = React.lazy(() => import('./pages/ViewListingPage.jsx'))
const NewListingPage = React.lazy(() => import('./pages/NewListingPage.jsx'))
const VerifyListingPage = React.lazy(() => import('./pages/VerifyListingPage.jsx'))
const AdminPage = React.lazy(() => import('./pages/AdminPage.jsx'))
const AuthPage = React.lazy(() => import('./pages/AuthPage.jsx'))
const JobPortalPage = React.lazy(() => import('./pages/JobPortalPage.jsx'))
const PostEmployeeAdPage = React.lazy(() => import('./pages/PostEmployeeAdPage.jsx'))
const SearchResultsPage = React.lazy(() => import('./pages/SearchResultsPage.jsx'))
const VerifyEmployeePage = React.lazy(() => import('./pages/VerifyEmployeePage.jsx'))
const MyAdsPage = React.lazy(() => import('./pages/MyAdsPage.jsx'))
const AccountPage = React.lazy(() => import('./pages/AccountPage.jsx'))
const JobSearchResultsPage = React.lazy(() => import('./pages/JobSearchResultsPage.jsx'))
const PolicyPage = React.lazy(() => import('./pages/PolicyPage.jsx'))
const TermsPage = React.lazy(() => import('./pages/TermsPage.jsx'))
const PaymentPendingPage = React.lazy(() => import('./pages/PaymentPendingPage.jsx'))
const SellerProfilePage = React.lazy(() => import('./pages/SellerProfilePage.jsx'))
const WantedBoardPage = React.lazy(() => import('./pages/WantedBoardPage.jsx'))

export default function App() {
  const navigate = useNavigate()
  const location = useLocation()
  const isHome = location.pathname === '/'

  // Maintenance gate (client-side overlay for SPA when backend is in maintenance)
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '' })
  const [isAdminLocal, setIsAdminLocal] = useState(false)

  // Track last distinct paths to provide a reliable "Back" fallback
  const pathHistoryRef = useRef([])
  useEffect(() => {
    const p = location.pathname + location.search
    const hist = pathHistoryRef.current
    if (hist.length === 0 || hist[hist.length - 1] !== p) {
      hist.push(p)
      // cap history size to avoid unbounded growth
      if (hist.length > 50) hist.shift()
      try { sessionStorage.setItem('lastGoodPath', p) } catch (_) {}
    }
  }, [location])

  function safeBack() {
    // If native history has entries, try normal back first
    const hasNativeHistory = typeof window !== 'undefined' && window.history && window.history.length > 1
    if (hasNativeHistory) {
      navigate(-1)
      return
    }
    // Otherwise, find the last distinct path in our ref that isn't current
    const hist = pathHistoryRef.current
    const current = location.pathname + location.search
    for (let i = hist.length - 2; i >= 0; i--) {
      if (hist[i] && hist[i] !== current) {
        navigate(hist[i], { replace: true })
        return
      }
    }
    // Fallback to lastGoodPath from sessionStorage
    try {
      const last = sessionStorage.getItem('lastGoodPath') || '/'
      if (last && last !== current) {
        navigate(last, { replace: true })
        return
      }
    } catch (_) {}
    // Final fallback
    navigate('/', { replace: true })
  }

  // Language switcher (basic infrastructure)
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('lang') || 'en' } catch (_) { return 'en' }
  })
  function setLanguage(next) {
    try { localStorage.setItem('lang', next) } catch (_) {}
    setLang(next)
  }

  // Notifications state (top-right bell)
  const [userEmail, setUserEmail] = useState('')
  const [notifOpen, setNotifOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])
  const notifBtnRefDesktop = useRef(null)
  const notifBtnRefMobile = useRef(null)
  const notifPanelRef = useRef(null)
  const [rejectNotifModal, setRejectNotifModal] = useState({ open: false, title: '', reason: '' })

  // Account enforcement overlay (ban/suspension)
  const [accountBlock, setAccountBlock] = useState({ show: false, title: '', message: '' })

  // Mobile menu (only used on small screens)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const mobileMenuBtnRef = useRef(null)
  const mobileMenuRef = useRef(null)

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      setUserEmail(user?.email || '')
      setIsAdminLocal(!!(user && user.is_admin))
    } catch (_) {
      setUserEmail('')
      setIsAdminLocal(false)
    }
  }, [location])

  // Check ban/suspend status and show blocking overlay if necessary
  useEffect(() => {
    let cancelled = false
    async function checkStatus() {
      if (!userEmail) { setAccountBlock({ show: false, title: '', message: '' }); return }
      try {
        const r = await fetch(`/api/auth/status`, {
          headers: { 'X-User-Email': userEmail },
          credentials: 'include' // include auth cookie across domains/subdomains
        })
        const data = await r.json()
        if (!r.ok) { setAccountBlock({ show: false, title: '', message: '' }); return }
        if (cancelled) return
        const isAdmin = !!data.is_admin
        if (isAdmin) { setAccountBlock({ show: false, title: '', message: '' }); return }
        const banned = !!data.is_banned
        const suspUntil = data.suspended_until ? new Date(data.suspended_until) : null
        const now = new Date()
        if (banned) {
          setAccountBlock({
            show: true,
            title: 'Account Banned',
            message: 'Your account has been banned by an administrator. Please contact support if you believe this is a mistake.'
          })
        } else if (suspUntil && suspUntil > now) {
          setAccountBlock({
            show: true,
            title: 'Account Suspended',
            message: `Your account is temporarily suspended until ${suspUntil.toLocaleString()}. You cannot use the site during this period.`
          })
        } else {
          setAccountBlock({ show: false, title: '', message: '' })
        }
      } catch (_) {
        setAccountBlock({ show: false, title: '', message: '' })
      }
    }
    checkStatus()
    const timer = setInterval(checkStatus, 60 * 1000) // re-check periodically
    return () => { cancelled = true; clearInterval(timer) }
  }, [userEmail])

  async function loadUnread() {
    if (!userEmail) { setUnreadCount(0); return }
    try {
      const r = await fetch('/api/notifications/unread-count', { headers: { 'X-User-Email': userEmail } })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      setUnreadCount(Number(data.unread_count || 0))
    } catch (_) {
      setUnreadCount(0)
    }
  }

  async function loadNotifications() {
    if (!userEmail) { setNotifications([]); return { results: [], unread: 0 } }
    try {
      const r = await fetch('/api/notifications', { headers: { 'X-User-Email': userEmail } })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed')
      const results = Array.isArray(data.results) ? data.results : []
      const unread = Number(data.unread_count || 0)
      setNotifications(results)
      setUnreadCount(unread)
      return { results, unread }
    } catch (_) {
      setNotifications([])
      return { results: [], unread: 0 }
    }
  }

  useEffect(() => {
    // Establish SSE subscription for unread count to reduce polling
    if (!userEmail) { setUnreadCount(0); return }
    let es;
    try {
      const url = `/api/notifications/unread-count/stream?user_email=${encodeURIComponent(userEmail)}`
      es = new EventSource(url)
      es.addEventListener('unread_count', (e) => {
        try {
          const data = JSON.parse(e.data || '{}')
          setUnreadCount(Number(data.unread_count || 0))
        } catch (_) {}
      })
      es.onerror = () => {
        // Fallback: if SSE errors, do an immediate fetch and let the browser reconnect
        loadUnread()
      }
    } catch (_) {
      // Fallback to single fetch if EventSource fails to construct
      loadUnread()
    }
    return () => {
      try { es && es.close() } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail])

  // Check maintenance status via SSE (fallback to one-time fetch)
  useEffect(() => {
    let es
    try {
      es = new EventSource('/api/maintenance-status/stream')
      es.addEventListener('maintenance_status', (e) => {
        try {
          const d = JSON.parse(e.data || '{}')
          setMaintenance({ enabled: !!d.enabled, message: String(d.message || '') })
        } catch (_) {}
      })
      es.onerror = () => {
        // Silent error; the browser will attempt to reconnect automatically
      }
    } catch (_) {
      // Fallback: one-time fetch
      ;(async () => {
        try {
          const r = await fetch('/api/maintenance-status', { cache: 'no-store' })
          const d = await r.json().catch(() => ({}))
          setMaintenance({ enabled: !!d.enabled, message: String(d.message || '') })
        } catch (_) {}
      })()
    }
    return () => { try { es && es.close() } catch (_) {} }
  }, [])

  async function markAllRead() {
    if (!userEmail) return
    const unread = notifications.filter(n => !n.is_read)
    for (const n of unread) {
      try {
        await fetch(`/api/notifications/${n.id}/read`, {
          method: 'POST',
          headers: { 'X-User-Email': userEmail }
        })
      } catch (_) {}
    }
    setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
    setUnreadCount(0)
  }

  // Auto-mark as read when opening the dropdown
  async function toggleNotif() {
    const next = !notifOpen
    setNotifOpen(next)
    if (next) {
      const { results } = await loadNotifications()
      if (userEmail && Array.isArray(results) && results.length) {
        const unreadItems = results.filter(n => !n.is_read)
        if (unreadItems.length) {
          try {
            await Promise.all(
              unreadItems.map(n =>
                fetch(`/api/notifications/${n.id}/read`, {
                  method: 'POST',
                  headers: { 'X-User-Email': userEmail }
                }).catch(() => {})
              )
            )
          } catch (_) {}
          setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
          setUnreadCount(0)
        }
      }
    }
  }

  // Close notification dropdown when clicking outside
  useEffect(() => {
    if (!notifOpen) return
    function onDocMouseDown(e) {
      const panel = notifPanelRef.current
      const btnDesk = notifBtnRefDesktop.current
      const btnMob = notifBtnRefMobile.current
      const target = e.target
      if (panel && panel.contains(target)) return
      if (btnDesk && btnDesk.contains(target)) return
      if (btnMob && btnMob.contains(target)) return
      setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
    }
  }, [notifOpen])

  // Close mobile menu when clicking outside
  useEffect(() => {
    if (!mobileMenuOpen) return
    function onDocMouseDown(e) {
      const panel = mobileMenuRef.current
      const btn = mobileMenuBtnRef.current
      const target = e.target
      if (panel && panel.contains(target)) return
      if (btn && btn.contains(target)) return
      setMobileMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocMouseDown)
    return () => document.removeEventListener('mousedown', onDocMouseDown)
  }, [mobileMenuOpen])

  async function handleNotificationClick(n) {
    if (!userEmail) return
    const type = String(n.type || '').toLowerCase()
    const listingId = n.listing_id
    let dest = null
    let openRejectModal = false
    if (type === 'pending' && listingId) {
      dest = `/payment/${listingId}`
    } else if (type === 'approved' && listingId) {
      dest = `/listing/${listingId}`
    } else if (type === 'rejected') {
      openRejectModal = true
    }
    try {
      await fetch(`/api/notifications/${n.id}/read`, {
        method: 'POST',
        headers: { 'X-User-Email': userEmail }
      })
    } catch (_) {}
    setNotifications(prev => prev.map(x => x.id === n.id ? ({ ...x, is_read: 1 }) : x))
    setUnreadCount(c => c - (n.is_read ? 0 : 1))
    setNotifOpen(false)
    if (openRejectModal) {
      const msg = String(n.message || '').trim()
      setRejectNotifModal({ open: true, title: n.title || 'Listing Rejected', reason: msg })
      return
    }
    if (dest) navigate(dest)
  }

  return (
    <I18nProvider lang={lang}>
    <div className="app light">
      <header className="topbar" style={{ position: 'sticky' }}>
        <div className="topbar-left">
          {!isHome && (
            <button
              className="back-btn"
              type="button"
              aria-label="Back"
              onClick={safeBack}
              title="Back"
            >
              ‹
            </button>
          )}
          <div className="brand">
            <Link to="/">Ganudenu</Link>
            <span className="domain"><LangText path="brand.marketplace" /></span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="nav" style={{ alignItems: 'center', gap: 10, flex: 1 }}>
          <div className="nav-desktop" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="pill" title="Language" style={{ cursor: 'default' }}>Lang: {lang.toUpperCase()}</div>
            <CustomLangSelector lang={lang} onChange={setLanguage} />
          </div>

          <div className="nav-desktop" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Link to="/"><LangText path="nav.home" /></Link>
            <Link to="/new"><LangText path="nav.sell" /></Link>
            <Link to="/jobs"><LangText path="nav.jobs" /></Link>
            <Link to="/wanted">Wanted</Link>
            <Link to="/my-ads"><LangText path="nav.myAds" /></Link>
            <Link to="/account"><LangText path="nav.account" /></Link>
            {userEmail ? (
              <div style={{ position: 'relative' }}>
                <button
                  ref={notifBtnRefDesktop}
                  className="back-btn"
                  type="button"
                  aria-label="Notifications"
                  title="Notifications"
                  onClick={toggleNotif}
                >
                  🔔
                </button>
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      width: 16,
                      height: 16,
                      borderRadius: '999px',
                      background: '#ef4444',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      boxShadow: '0 0 0 2px rgba(10,12,18,0.9)'
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
            ) : null}
          </div>

          <div className="nav-mobile" style={{ position: 'relative', width: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 140 }}>
                <CustomLangSelector lang={lang} onChange={setLanguage} />
              </div>
            </div>

            {userEmail ? (
              <div style={{ position: 'relative' }}>
                <button
                  ref={notifBtnRefMobile}
                  className="back-btn"
                  type="button"
                  aria-label="Notifications"
                  title="Notifications"
                  onClick={toggleNotif}
                >
                  🔔
                </button>
                {unreadCount > 0 && (
                  <span
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      top: -2,
                      right: -2,
                      width: 16,
                      height: 16,
                      borderRadius: '999px',
                      background: '#ef4444',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 10,
                      fontWeight: 700,
                      boxShadow: '0 0 0 2px rgba(10,12,18,0.9)'
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
            ) : null}

            <Link to="/account" className="back-btn" aria-label="Account" title="Account">👤</Link>

            <div style={{ position: 'relative' }}>
              <button
                ref={mobileMenuBtnRef}
                className="back-btn"
                type="button"
                aria-label="Menu"
                title="Menu"
                onClick={() => setMobileMenuOpen(o => !o)}
              >
                ☰
              </button>
              {mobileMenuOpen && (
                <div
                  ref={mobileMenuRef}
                  className="card dropdown-panel"
                  style={{ width: 200, padding: 8, right: 0, left: 'auto' }}
                >
                  <Link to="/" onClick={() => setMobileMenuOpen(false)}><LangText path="nav.home" /></Link>
                  <Link to="/new" onClick={() => setMobileMenuOpen(false)}><LangText path="nav.sell" /></Link>
                  <Link to="/jobs" onClick={() => setMobileMenuOpen(false)}><LangText path="nav.jobs" /></Link>
                  <Link to="/wanted" onClick={() => setMobileMenuOpen(false)}>Wanted</Link>
                  <Link to="/my-ads" onClick={() => setMobileMenuOpen(false)}><LangText path="nav.myAds" /></Link>
                </div>
              )}
            </div>
          </div>
        </nav>

        {/* Notifications dropdown panel */}
        {notifOpen && (
          <div ref={notifPanelRef} style={{ position: 'absolute', top: 62, right: 14, zIndex: 20 }}>
            <div className="card" style={{ width: 340, maxHeight: 420, overflow: 'auto' }}>
              <div className="h2" style={{ marginTop: 0 }}><LangText path="notifications.title" /></div>
              {notifications.length === 0 && <p className="text-muted">No notifications.</p>}
              {notifications.map(n => (
                <div
                  key={n.id}
                  className="card"
                  onClick={() => handleNotificationClick(n)}
                  style={{ marginBottom: 8, cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <strong>{n.title}</strong>
                    {!n.is_read && <span className="pill" style={{ background: 'rgba(108,127,247,0.15)', borderColor: 'transparent', color: '#c9d1ff' }}><LangText path="notifications.new" /></span>}
                  </div>
                  <div className="text-muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{n.message}</div>
                  <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                    {new Date(n.created_at).toLocaleString()}
                    {n.target_email ? <span> • to {n.target_email}</span> : <span> • to All</span>}
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                <button className="btn" onClick={() => setNotifOpen(false)}><LangText path="notifications.close" /></button>
                <button className="btn" onClick={markAllRead} disabled={unreadCount === 0}><LangText path="notifications.markAllRead" /></button>
              </div>
            </div>
          </div>
        )}
      </header>
      <main className="content">
        {/* Global maintenance overlay for non-admin users */}
        {maintenance.enabled && !isAdminLocal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Maintenance Mode"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 2500,
              background: 'rgba(9,12,18,0.92)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backdropFilter: 'blur(4px)'
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: 820,
                margin: 12,
                padding: 24,
                borderRadius: 16,
                background: 'linear-gradient(180deg, rgba(18,26,46,.9), rgba(11,18,32,.9))',
                boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
                textAlign: 'left'
              }}
            >
              <div className="h1" style={{ marginTop: 0, backgroundImage: 'linear-gradient(90deg,#d4e0ff,#9fd1ff,#c6a8ff,#d4e0ff)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                We’re performing maintenance
              </div>
              <p className="text-muted">Ganudenu is temporarily unavailable while we upgrade our systems. Please check back in a little while.</p>
              {maintenance.message ? (
                <div className="card" style={{ marginTop: 8, background: 'rgba(88,166,255,0.08)', borderColor: 'transparent' }}>
                  <strong>Note from admin</strong>
                  <div className="text-muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{maintenance.message}</div>
                </div>
              ) : null}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => window.location.reload()}>Retry</button>
              </div>
            </div>
          </div>
        )}

        <Suspense fallback={<LoadingOverlay message="Loading..." />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            {/* Permalink with SEO-friendly slug support (place slug route first to avoid matching plain :id) */}
            <Route path="/listing/:id-:slug" element={<ViewListingPage />} />
            <Route path="/listing/:id" element={<ViewListingPage />} />
            <Route path="/new" element={<NewListingPage />} />
            <Route path="/verify" element={<VerifyListingPage />} />
            <Route path="/verify-employee" element={<VerifyEmployeePage />} />
            {/* Admin panel route (obscured path) */}
            <Route path="/janithmanodya" element={<AdminPage />} />
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/my-ads" element={<MyAdsPage />} />
            <Route path="/jobs" element={<JobPortalPage />} />
            <Route path="/jobs/search" element={<JobSearchResultsPage />} />
            <Route path="/jobs/post-employee" element={<PostEmployeeAdPage />} />
            <Route path="/wanted" element={<WantedBoardPage />} />
            <Route path="/search" element={<SearchResultsPage />} />
            <Route path="/policy" element={<PolicyPage />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/payment/:id" element={<PaymentPendingPage />} />
            <Route path="/seller/:username" element={<SellerProfilePage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="footer">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, width: '100%' }}>
          <small><LangText path="footer.copyright" params={new Date().getFullYear()} /></small>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Link to="/policy" style={{ color: 'var(--muted)', textDecoration: 'none' }}><LangText path="footer.policy" /></Link>
            <Link to="/terms" style={{ color: 'var(--muted)', textDecoration: 'none' }}>Terms &amp; Conditions</Link>
          </div>
        </div>
      </footer>

      <Modal
        open={rejectNotifModal.open}
        title={rejectNotifModal.title}
        onClose={() => setRejectNotifModal({ open: false, title: '', reason: '' })}
      >
        <div className="card" style={{ background: 'rgba(239,68,68,0.08)', borderColor: '#ef44441a' }}>
          <strong>Reject Reason</strong>
          <div className="text-muted" style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{rejectNotifModal.reason}</div>
        </div>
      </Modal>

      {/* Blocking overlay for banned/suspended users */}
      {accountBlock.show && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={accountBlock.title}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        >
          <div
            className="card"
            style={{
              maxWidth: 520,
              margin: 12,
              background: 'rgba(18,22,31,0.96)',
              borderColor: 'var(--border)',
              boxShadow: '0 16px 40px rgba(0,0,0,0.5)'
            }}
            onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
          >
            <div className="h1" style={{ marginTop: 0 }}>{accountBlock.title}</div>
            <p className="text-muted">{accountBlock.message}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button
                className="btn"
                onClick={() => {
                  try { localStorage.removeItem('user') } catch (_) {}
                  setUserEmail('')
                  navigate('/', { replace: true })
                }}
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </I18nProvider>
  )
}

function LangText({ path, params }) {
  const { t } = useI18n()
  return <>{t(path, params)}</>
}

function CustomLangSelector({ lang, onChange }) {
  return (
    <div style={{ position: 'relative' }}>
      <select
        className="select"
        aria-label="Language"
        value={lang}
        onChange={e => onChange(e.target.value)}
        style={{ minWidth: 120 }}
      >
        <option value="en">English</option>
        <option value="si">සිංහල</option>
        <option value="ta">தமிழ்</option>
      </select>
    </div>
  )
}
