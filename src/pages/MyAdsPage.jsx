import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/Modal.jsx'
import useSEO from '../components/useSEO.js'
import { useI18n } from '../components/i18n.jsx'

export default function MyAdsPage() {
  const [items, setItems] = useState([])
  const [status, setStatus] = useState(null)
  const [rejectModal, setRejectModal] = useState({ open: false, reason: '', title: '' })
  const navigate = useNavigate()
  const { t } = useI18n()

  // SEO for My Ads via helper
  useSEO({
    title: 'My Ads — Ganudenu Marketplace',
    description: 'Manage your pending, approved, and rejected listings. Track views and status at a glance.',
    canonical: 'https://ganudenu.store/my-ads'
  })

  // Dashboard: Your Ad Progress
  const [lastUpdated, setLastUpdated] = useState(null)
  // Poll in the background for near‑real‑time progress
  useEffect(() => {
    let timer = null
    async function tick() {
      await refresh(true)
    }
    tick()
    timer = setInterval(tick, 20000)
    return () => { if (timer) clearInterval(timer) }
  }, [])

  async function refresh(silent = false) {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      if (!user?.email) {
        setStatus(t('auth.loginRequiredMessage'))
        return
      }
      if (!silent) setStatus(null)
      const token = localStorage.getItem('auth_token')
      const headers = token
        ? { 'Authorization': `Bearer ${token}` }
        : { 'X-User-Email': user.email }
      const r = await fetch('/api/listings/my', { headers })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to load')
      setItems(data.results || [])
      setLastUpdated(new Date())
      if (!silent) setStatus(null)
    } catch (e) {
      if (!silent) setStatus(`Error: ${e.message}`)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  async function handleDelete(e, id) {
    e.stopPropagation()
    const user = JSON.parse(localStorage.getItem('user') || 'null')
    if (!user?.email) {
      alert('Please login first.')
      return
    }
    const ok = window.confirm('Are you sure you want to delete this ad? This cannot be undone.')
    if (!ok) return
    try {
      const r = await fetch(`/api/listings/${id}`, {
        method: 'DELETE',
        headers: { 'X-User-Email': user.email }
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data.error || 'Delete failed')
      // Remove item from state
      setItems(prev => prev.filter(x => x.id !== id))
    } catch (err) {
      alert(err.message || 'Failed to delete')
    }
  }

  function makeSlug(s) {
    const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return base || 'listing'
  }
  function permalinkForItem(it) {
    const titleSlug = makeSlug(it.title || '')
    let year = ''
    try {
      const sj = JSON.parse(it.structured_json || '{}')
      const y = sj.manufacture_year || sj.year || sj.model_year || null
      if (y) year = String(y)
    } catch (_) {}
    const idCode = Number(it.id).toString(36).toUpperCase()
    const parts = [titleSlug, year, idCode].filter(Boolean)
    return `/listing/${it.id}-${parts.join('-')}`
  }
  function handleCardClick(item) {
    const st = String(item.status || '').toLowerCase()
    if (st.includes('pending')) {
      navigate(`/payment/${item.id}`)
    } else if (st.includes('approved')) {
      navigate(permalinkForItem(item))
    } else if (st.includes('reject')) {
      const reason = String(item.reject_reason || '').trim()
      setRejectModal({ open: true, reason: reason || 'No reason provided.', title: item.title || 'Rejected Ad' })
    } else {
      navigate(permalinkForItem(item))
    }
  }

  function renderCard(item) {
    let expires = ''
    if (item.valid_until) {
      const diff = new Date(item.valid_until).getTime() - Date.now()
      const days = Math.max(0, Math.ceil(diff / (1000*60*60*24)))
      expires = `Expires in ${days} day${days === 1 ? '' : 's'}`
    }
    const imgs = Array.isArray(item.small_images) ? item.small_images : []
    const hero = imgs.length ? imgs[0] : (item.thumbnail_url || null)
    const st = String(item.status || '')
    const badgeColor =
      st === 'Approved' ? '#16a34a' :
      st.includes('Pending') ? '#f59e0b' :
      st === 'Rejected' ? '#ef4444' : '#6b7280'

    return (
      <div
        key={item.id}
        className="card"
        onClick={() => handleCardClick(item)}
        style={{ cursor: 'pointer', position: 'relative' }}
      >
        {hero && (
          <div style={{ position: 'relative' }}>
            <img
              src={hero}
              alt={item.title}
              loading="lazy"
              sizes="(max-width: 780px) 100vw, (max-width: 1200px) 50vw, 33vw"
              style={{ width: '100%', borderRadius: 8, marginBottom: 8, objectFit: 'cover' }}
            />
            {(item.is_urgent || item.urgent) && (
              <span
                className="pill"
                style={{
                  position: 'absolute',
                  top: 8,
                  left: 8,
                  background: 'linear-gradient(135deg, rgba(239,68,68,0.28), rgba(255,160,160,0.22))',
                  border: '1px solid rgba(239,68,68,0.5)',
                  color: '#fff',
                  fontSize: 12,
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(239,68,68,0.25)'
                }}
              >
                {t('common.urgent')}
              </span>
            )}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <div className="h2" style={{ margin: '6px 0' }}>{item.title}</div>
          {item.price != null && (
            <div className="price-chip" style={{ margin: '6px 0', whiteSpace: 'nowrap', fontSize: 14 }}>
              {`LKR ${Number(item.price).toLocaleString('en-US')}`}
            </div>
          )}
        </div>
        <div className="text-muted" style={{ marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span className="pill" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'transparent', color: '#cbd5e1' }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: badgeColor, display: 'inline-block' }} /> {st}
          </span>
          <span>{item.location || 'N/A'}</span>
          {item.pricing_type ? <span>• {item.pricing_type}</span> : null}
          {expires ? <span>• {expires}</span> : null}
          {/* Views badge */}
          <span className="pill" title="Total views" style={{ marginLeft: 'auto' }}>
            👁️ {Number(item.views || 0).toLocaleString('en-US')}
          </span>
        </div>
        {st === 'Rejected' && item.reject_reason ? (
          <div className="card" style={{ background: 'rgba(239,68,68,0.08)', borderColor: '#ef44441a' }}>
            <strong>{t('myAds.rejectReason')}:</strong>
            <div className="text-muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{item.reject_reason}</div>
          </div>
        ) : null}
        <button
          onClick={(e) => handleDelete(e, item.id)}
          style={{
            position: 'absolute',
            right: 8,
            bottom: 8,
            background: '#f44336',
            color: 'white',
            border: 'none',
            padding: '6px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 12
          }}
        >
          Delete
        </button>
      </div>
    )
  }

  const pending = items.filter(x => String(x.status).toLowerCase().includes('pending'))
  const approved = items.filter(x => String(x.status).toLowerCase().includes('approved'))
  const rejected = items.filter(x => String(x.status).toLowerCase().includes('reject'))

  // Dashboard aggregates
  const totals = useMemo(() => {
    const total = items.length
    const totalViews = items.reduce((acc, it) => acc + (Number(it.views || 0)), 0)
    return { total, totalViews, approved: approved.length, pending: pending.length, rejected: rejected.length }
  }, [items])

  // Last 7 days status trend (counts per day by created_at & current status)
  const last7 = useMemo(() => {
    const days = []
    const now = new Date()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
      const key = d.toISOString().slice(0, 10)
      days.push({ key, label: d.toLocaleDateString(undefined, { weekday: 'short' }), approved: 0, pending: 0, rejected: 0 })
    }
    function dayKey(ts) {
      try { return new Date(ts).toISOString().slice(0, 10) } catch { return '' }
    }
    for (const it of items) {
      const k = dayKey(it.created_at)
      const slot = days.find(x => x.key === k)
      if (slot) {
        const st = String(it.status || '').toLowerCase()
        if (st.includes('approved')) slot.approved++
        else if (st.includes('pending')) slot.pending++
        else if (st.includes('reject')) slot.rejected++
      }
    }
    return days
  }, [items])

  return (
    <div className="center">
      <div className="card">
        <div className="h1">{t('myAds.title')}</div>
        {status && <p className="text-muted">{status}</p>}

        {/* Your Ad Progress dashboard */}
        <div className="card" style={{ marginTop: 8 }}>
          <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Your Ad Progress</span>
            <small className="text-muted">{lastUpdated ? `Updated ${Math.max(0, Math.floor((Date.now() - lastUpdated.getTime())/1000))}s ago` : '—'}</small>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="pill">Total: {totals.total}</span>
            <span className="pill" style={{ background: 'rgba(120,200,140,0.15)', border: '1px solid rgba(120,200,140,0.4)' }}>Approved: {totals.approved}</span>
            <span className="pill" style={{ background: 'rgba(255,200,120,0.15)', border: '1px solid rgba(255,200,120,0.4)' }}>Pending: {totals.pending}</span>
            <span className="pill" style={{ background: 'rgba(255,120,120,0.15)', border: '1px solid rgba(255,120,120,0.4)' }}>Rejected: {totals.rejected}</span>
            <span className="pill" title="Sum of all listing views">👁️ Total Views: {totals.totalViews.toLocaleString('en-US')}</span>
          </div>
          {/* Progress bar */}
          {totals.total > 0 && (
            <div style={{ marginTop: 10 }}>
              <div className="text-muted" style={{ fontSize: 12, marginBottom: 4 }}>{t('myAds.approvalProgress')}</div>
              <div style={{ height: 10, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', position: 'relative' }}>
                <div
                  style={{
                    position: 'absolute',
                    left: 0, top: 0, bottom: 0,
                    width: `${Math.round((totals.approved / totals.total) * 100)}%`,
                    background: 'linear-gradient(90deg, #6c7ff7, #00d1ff)',
                    transition: 'width 300ms ease'
                  }}
                />
              </div>
            </div>
          )}

          {/* Last 7 days stacked mini-bars */}
          <div style={{ marginTop: 12 }}>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>{t('myAds.last7days')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, alignItems: 'end' }}>
              {last7.map(day => {
                const total = day.approved + day.pending + day.rejected
                const h = (n) => (total ? (n / Math.max(1, total)) * 70 : 0)
                return (
                  <div key={day.key} title={`${day.label}\nApproved: ${day.approved}\nPending: ${day.pending}\nRejected: ${day.rejected}`} style={{ display: 'grid', gridTemplateRows: 'auto 70px auto', alignItems: 'end' }}>
                    <div style={{ height: 70, display: 'grid', gridTemplateRows: 'auto auto auto', alignItems: 'end' }}>
                      <div style={{ height: `${h(day.rejected)}px`, background: 'rgba(239,68,68,0.7)', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                      <div style={{ height: `${h(day.pending)}px`, background: 'rgba(245,158,11,0.7)' }} />
                      <div style={{ height: `${h(day.approved)}px`, background: 'rgba(34,197,94,0.7)', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }} />
                    </div>
                    <div className="text-muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 4 }}>{day.label}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 8 }}>
          <div className="h2" style={{ marginTop: 0 }}>{t('myAds.pendingTitle')}</div>
          <p className="text-muted" style={{ marginTop: 4 }}>Click a pending ad to go to the payment page and complete publishing.</p>
          <div className="grid three" style={{ marginTop: 12 }}>
            {pending.map(renderCard)}
            {pending.length === 0 && <p className="text-muted">{t('myAds.noPending')}</p>}
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2" style={{ marginTop: 0 }}>{t('myAds.approvedTitle')}</div>
          <p className="text-muted" style={{ marginTop: 4 }}>Click an approved ad to view the live listing.</p>
          <div className="grid three" style={{ marginTop: 12 }}>
            {approved.map(renderCard)}
            {approved.length === 0 && <p className="text-muted">{t('myAds.noApproved')}</p>}
          </div>
        </div>

        <div className="card" style={{ marginTop: 12 }}>
          <div className="h2" style={{ marginTop: 0 }}>{t('myAds.rejectedTitle')}</div>
          <p className="text-muted" style={{ marginTop: 4 }}>Click a rejected ad to see the reason.</p>
          <div className="grid three" style={{ marginTop: 12 }}>
            {rejected.map(renderCard)}
            {rejected.length === 0 && <p className="text-muted">{t('myAds.noRejected')}</p>}
          </div>
        </div>
      </div>

      <Modal
        open={rejectModal.open}
        title={rejectModal.title}
        onClose={() => setRejectModal({ open: false, reason: '', title: '' })}
      >
        <div className="card" style={{ background: 'rgba(239,68,68,0.08)', borderColor: '#ef44441a' }}>
          <strong>{t('myAds.rejectReason')}:</strong>
          <div className="text-muted" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{rejectModal.reason}</div>
        </div>
      </Modal>
    </div>
  )
}