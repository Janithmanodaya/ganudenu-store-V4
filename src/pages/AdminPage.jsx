import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import CustomSelect from '../components/CustomSelect.jsx'

export default function AdminPage() {
  const navigate = useNavigate()
  const [adminEmail, setAdminEmail] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [allowed, setAllowed] = useState(false)
  const [status, setStatus] = useState(null)

  // Config
  const [maskedKey, setMaskedKey] = useState(null)
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [bankDetails, setBankDetails] = useState('')
  const [bankAccountNumber, setBankAccountNumber] = useState('')
  const [bankAccountName, setBankAccountName] = useState('')
  const [bankName, setBankName] = useState('')
  const [whatsappNumber, setWhatsappNumber] = useState('')
  const [emailOnApprove, setEmailOnApprove] = useState(false)
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false)
  const [maintenanceMessage, setMaintenanceMessage] = useState('')

  // Dashboard/metrics
  const [metrics, setMetrics] = useState(null)
  const [rangeDays, setRangeDays] = useState(7)

  // Tabs
  const [activeTab, setActiveTab] = useState('dashboard')

  // Approvals
  const [pending, setPending] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editStructured, setEditStructured] = useState('')
  const [rejectReason, setRejectReason] = useState('')
  const [urgentFlag, setUrgentFlag] = useState(false)

  // Users
  const [users, setUsers] = useState([])
  const [userQuery, setUserQuery] = useState('')
  const [suspendDays, setSuspendDays] = useState(7)
  const [userEmailOptionsCache, setUserEmailOptionsCache] = useState([])
  const [userSelect, setUserSelect] = useState('')
  const [userAds, setUserAds] = useState({})
  const [expandedUserIds, setExpandedUserIds] = useState([])
  const [userAdsFilters, setUserAdsFilters] = useState({})

  // Reports
  const [reports, setReports] = useState([])
  const [reportFilter, setReportFilter] = useState('pending')

  // Banners
  const [banners, setBanners] = useState([])
  const fileRef = useRef(null)

  // Notifications
  const [notificationsAdmin, setNotificationsAdmin] = useState([])
  const [notifyTitle, setNotifyTitle] = useState('')
  const [notifyMessage, setNotifyMessage] = useState('')
  const [notifyTargetType, setNotifyTargetType] = useState('all')
  const [notifyEmail, setNotifyEmail] = useState('')
  const [notifySendEmail, setNotifySendEmail] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)

  // Chat
  const [conversations, setConversations] = useState([])
  const [selectedChatEmail, setSelectedChatEmail] = useState('')
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [sendEmailOnReply, setSendEmailOnReply] = useState(false)
  const [chatLastId, setChatLastId] = useState(0)
  const esChatRef = useRef(null)

  // Backup
  const backupFileRef = useRef(null)

  // Helpers
  function getAdminHeaders(extra = {}) {
    const h = { 'X-Admin-Email': adminEmail }
    if (authToken) h['Authorization'] = `Bearer ${authToken}`
    return { ...h, ...extra }
  }
  async function safeJson(r) {
    if (!r) throw new Error('No response')
    const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').toLowerCase()
    if (ct.includes('application/json')) {
      try { return await r.json() } catch (_) { return {} }
    }
    let text = ''
    try { text = await r.text() } catch (_) {}
    const trimmed = String(text || '').trim()
    if (!trimmed || r.status === 204) return {}
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed) } catch (_) { /* fallthrough */ }
    }
    const isHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.includes('<html')
    if (isHtml) return {}
    return { message: trimmed }
  }

  // Auth/init
  useEffect(() => {
    async function init() {
      try {
        const user = JSON.parse(localStorage.getItem('user') || 'null')
        const token = localStorage.getItem('auth_token') || ''
        const email = user?.email || ''
        if (token) setAuthToken(token)
        try {
          const hdrs = token ? { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' }
          const r = await fetch(`/api/auth/status?t=${Date.now()}`, {
            headers: hdrs,
            cache: 'no-store',
            credentials: 'include'
          })
          if (r.ok) {
            const data = await r.json().catch(() => ({}))
            if (data && data.is_admin) {
              setAllowed(true)
              // Prefer server-reported email
              setAdminEmail(String(data.email || ''))
              if (token) setAuthToken(token)
              return
            }
          }
          // Fallback: use localStorage snapshot
          if (user && user.is_admin && user.email) {
            setAllowed(true)
            setAdminEmail(user.email)
            if (token) setAuthToken(token)
          } else {
            setAllowed(false)
          }
        } catch (_) {
          if (user && user.is_admin && user.email) {
            setAllowed(true)
            setAdminEmail(user.email)
            if (token) setAuthToken(token)
          } else {
            setAllowed(false)
          }
        }
      } catch (_) {
        setAllowed(false)
      }
    }
    init()
  }, [])

  // Load initial data when allowed
  useEffect(() => {
    if (!allowed || !adminEmail) return
    fetchConfig()
    loadMetrics(rangeDays)
    loadPending()
    loadBanners()
    loadUsers('')
    loadReports(reportFilter)
    loadAdminNotifications()
    loadConversations()
    fetch('/api/notifications/unread-count', { headers: { 'X-User-Email': adminEmail, 'Authorization': authToken ? `Bearer ${authToken}` : undefined }, credentials: 'include' })
      .then(async r => { const d = await safeJson(r); setUnreadCount(Number(d.unread_count) || 0) })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, adminEmail, authToken])

  // Notifications auto-refresh when on tab
  useEffect(() => {
    if (!allowed || !adminEmail || activeTab !== 'notifications') return
    const refresh = () => {
      loadAdminNotifications()
      fetch('/api/notifications/unread-count', { headers: { 'X-User-Email': adminEmail, 'Authorization': authToken ? `Bearer ${authToken}` : undefined } })
        .then(async r => { const d = await safeJson(r); setUnreadCount(Number(d.unread_count) || 0) })
        .catch(() => {})
    }
    refresh()
    const timer = setInterval(refresh, 15000)
    return () => clearInterval(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed, adminEmail, activeTab])

  // Config
  async function fetchConfig() {
    try {
      const r = await fetch('/api/admin/config', { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to load config')
      setMaskedKey(data.gemini_api_key_masked)
      setBankDetails(data.bank_details || '')
      setBankAccountNumber(data.bank_account_number || '')
      setBankAccountName(data.bank_account_name || '')
      setBankName(data.bank_name || '')
      setWhatsappNumber(data.whatsapp_number || '')
      setEmailOnApprove(!!data.email_on_approve)
      setMaintenanceEnabled(!!data.maintenance_mode)
      setMaintenanceMessage(String(data.maintenance_message || ''))
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function saveConfig() {
    try {
      const payload = {
        geminiApiKey,
        bankDetails,
        bankAccountNumber,
        bankAccountName,
        bankName,
        whatsappNumber,
        emailOnApprove,
        maintenanceMode: !!maintenanceEnabled,
        maintenanceMessage: String(maintenanceMessage || '')
      }
      const r = await fetch('/api/admin/config', {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to save config')
      setStatus('Configuration saved.')
      setGeminiApiKey('')
      fetchConfig()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function testGemini() {
    try {
      const r = await fetch('/api/admin/test-gemini', { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error?.message || data.error || 'Failed to test API key')
      setStatus(`API key OK. Models available: ${data.models_count}`)
    } catch (e) {
      setStatus(`Test failed: ${e.message}`)
    }
  }

  // Metrics
  async function loadMetrics(days = rangeDays) {
    try {
      const r = await fetch(`/api/admin/metrics?days=${encodeURIComponent(days)}`, { headers: getAdminHeaders(), cache: 'no-store' })
      let data = {}
      try {
        data = await safeJson(r)
      } catch (_) {
        data = {}
      }
      // If backend is down/maintenance, avoid global errors; keep dashboard responsive.
      if (!r.ok) {
        return
      }
      setMetrics(data)
    } catch (_) {
      // Silent on errors
    }
  }

  // Approvals
  async function loadPending() {
    try {
      const r = await fetch('/api/admin/pending', { headers: getAdminHeaders(), cache: 'no-store' })
      let data = {}
      try {
        data = await safeJson(r)
      } catch (_) {
        data = {}
      }
      // If backend responds non-OK (e.g., maintenance), avoid global status errors.
      if (!r.ok) {
        return
      }
      const items = Array.isArray(data.items) ? data.items : []
      setPending(items)
    } catch (_) {
      // Silent on errors to keep dashboard responsive
    }
  }
  async function loadDetail(id) {
    try {
      const r = await fetch(`/api/admin/pending/${encodeURIComponent(id)}`, { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to load item')
      setDetail(data)
      setEditStructured(data.listing.structured_json || '')
      setSelectedId(id)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function saveEdits() {
    try {
      const r = await fetch(`/api/admin/pending/${encodeURIComponent(selectedId)}/update`, {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ structured_json: editStructured, seo_title: '', meta_description: '', seo_keywords: '' })
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to save edits')
      setStatus('Edits saved.')
      await loadDetail(selectedId)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function approve() {
    try {
      const r = await fetch(`/api/admin/pending/${encodeURIComponent(selectedId)}/approve`, { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to approve')
      setStatus('Approved.')
      setDetail(null)
      setSelectedId(null)
      await loadPending()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function reject() {
    try {
      const r = await fetch(`/api/admin/pending/${encodeURIComponent(selectedId)}/reject`, {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ reason: rejectReason })
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to reject')
      setStatus('Rejected.')
      setDetail(null)
      setSelectedId(null)
      setRejectReason('')
      await loadPending()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  // Users
  async function loadUsers(q = '') {
    try {
      const r = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`, { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) return
      const results = Array.isArray(data.results) ? data.results : []
      setUsers(results)
      const emails = Array.from(new Set(results.map(u => String(u.email || '').trim()).filter(Boolean)))
      setUserEmailOptionsCache(prev => Array.from(new Set([...prev, ...emails])))
    } catch (_) {}
  }
  async function banUser(id) {
    try {
      const r = await fetch(`/api/admin/users/${id}/ban`, { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to ban user')
      loadUsers(userQuery)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function unbanUser(id) {
    try {
      const r = await fetch(`/api/admin/users/${id}/unban`, { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to unban user')
      loadUsers(userQuery)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function suspendUser(id) {
    try {
      const r = await fetch(`/api/admin/users/${id}/suspend`, {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ days: Number(suspendDays) || 7 })
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to suspend user')
      loadUsers(userQuery)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function unsuspendUser(id) {
    try {
      const r = await fetch(`/api/admin/users/${id}/unsuspend`, { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to unsuspend user')
      loadUsers(userQuery)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function loadUserAds(user) {
    try {
      const userId = (typeof user === 'object' && user !== null) ? user.id : user
      const r = await fetch(`/api/admin/users/${userId}/listings`, { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to load user ads')
      const rows = Array.isArray(data.results) ? data.results : []
      setUserAds(prev => ({ ...prev, [userId]: rows }))
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function deleteUserAd(listingId, userId) {
    const yes = window.confirm('Delete this ad? This cannot be undone.')
    if (!yes) return
    try {
      const r = await fetch(`/api/admin/listings/${listingId}`, { method: 'DELETE', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to delete listing')
      setStatus('Ad deleted.')
      setUserAds(prev => {
        const rows = Array.isArray(prev[userId]) ? prev[userId] : []
        const nextRows = rows.filter(x => x.id !== listingId)
        return { ...prev, [userId]: nextRows }
      })
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  function toggleExpandUser(userId) {
    setExpandedUserIds(prev => {
      const has = prev.includes(userId)
      const next = has ? prev.filter(id => id !== userId) : [...prev, userId]
      if (!has) {
        const userObj = users.find(x => x.id === userId) || { id: userId }
        loadUserAds(userObj)
      }
      return next
    })
  }
  function updateUserAdsFilter(userId, patch) {
    setUserAdsFilters(prev => ({ ...prev, [userId]: { ...(prev[userId] || {}), ...patch } }))
  }
  function getFilteredUserAds(userId) {
    const ads = Array.isArray(userAds[userId]) ? userAds[userId] : []
    const f = userAdsFilters[userId] || {}
    const q = String(f.q || '').toLowerCase().trim()
    const cat = String(f.category || '')
    const loc = String(f.location || '')
    const pmin = f.priceMin != null && f.priceMin !== '' ? Number(f.priceMin) : null
    const pmax = f.priceMax != null && f.priceMax !== '' ? Number(f.priceMax) : null
    return ads.filter(ad => {
      const textOk = q ? [ad.title, ad.location, ad.main_category, ad.description, ad.seo_description].filter(Boolean).join(' ').toLowerCase().includes(q) : true
      const catOk = cat ? (String(ad.main_category || '') === cat) : true
      const locOk = loc ? String(ad.location || '').toLowerCase().includes(loc.toLowerCase()) : true
      const price = ad.price != null ? Number(ad.price) : null
      const minOk = pmin != null ? (price != null && price >= pmin) : true
      const maxOk = pmax != null ? (price != null && price <= pmax) : true
      return textOk && catOk && locOk && minOk && maxOk
    })
  }

  // Reports
  async function loadReports(filter = 'pending') {
    try {
      const r = await fetch(`/api/admin/reports?status=${encodeURIComponent(filter)}`, { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) return
      const results = Array.isArray(data.results) ? data.results : []
      setReports(results)
    } catch (_) {}
  }
  async function resolveReport(id) {
    try {
      const r = await fetch(`/api/admin/reports/${id}/resolve`, { method: 'POST', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to resolve report')
      loadReports(reportFilter)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function deleteReport(id) {
    const yes = window.confirm('Delete this report?')
    if (!yes) return
    try {
      const r = await fetch(`/api/admin/reports/${id}`, { method: 'DELETE', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to delete report')
      loadReports(reportFilter)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  // Banners
  async function loadBanners() {
    try {
      const r = await fetch('/api/admin/banners', { headers: getAdminHeaders(), cache: 'no-store' })
      let data = {}
      try {
        data = await safeJson(r)
      } catch (_) {
        data = {}
      }
      // If backend is in maintenance or returns non-JSON/html, avoid surfacing a global error.
      if (!r.ok) {
        return
      }
      const results = Array.isArray(data.results) ? data.results : []
      setBanners(results)
    } catch (_) {
      // Silent on errors to avoid noisy Status card
    }
  }
  async function onUploadBanner(file) {
    if (!file) return
    // Block SVG (backend will reject too, but provide early feedback)
    const nameLower = (file && file.name) ? String(file.name).toLowerCase() : ''
    const isSvg = (file && file.type && String(file.type).toLowerCase() === 'image/svg+xml') || nameLower.endsWith('.svg')
    if (isSvg) {
      setStatus('SVG images are not allowed. Please upload PNG, JPEG, WebP, GIF, or AVIF.')
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    try {
      const fd = new FormData()
      fd.append('image', file)
      const r = await fetch('/api/admin/banners', { method: 'POST', headers: getAdminHeaders(), body: fd })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to upload banner')
      setStatus('Banner uploaded.')
      loadBanners()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  async function toggleBanner(id, active) {
    try {
      const r = await fetch(`/api/admin/banners/${id}/active`, {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ active: !active })
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to update banner')
      loadBanners()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function deleteBanner(id) {
    const yes = window.confirm('Delete this banner?')
    if (!yes) return
    try {
      const r = await fetch(`/api/admin/banners/${id}`, { method: 'DELETE', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to delete banner')
      loadBanners()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  // Notifications
  async function loadAdminNotifications() {
    try {
      const r = await fetch('/api/admin/notifications', { headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) return
      const results = Array.isArray(data.results) ? data.results : []
      setNotificationsAdmin(results)
    } catch (_) {}
  }
  async function sendNotification() {
    if (!notifyTitle.trim() || !notifyMessage.trim()) {
      setStatus('Title and message are required.')
      return
    }
    try {
      const payload = {
        title: notifyTitle.trim(),
        message: notifyMessage.trim(),
        targetEmail: notifyTargetType === 'email' ? notifyEmail.trim().toLowerCase() : null,
        sendEmail: notifyTargetType === 'email' ? !!notifySendEmail : false
      }
      const r = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to send notification')
      setNotifyTitle('')
      setNotifyMessage('')
      setNotifyTargetType('all')
      setNotifyEmail('')
      loadAdminNotifications()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function deleteNotification(id) {
    const yes = window.confirm('Delete this notification?')
    if (!yes) return
    try {
      const r = await fetch(`/api/admin/notifications/${id}`, { method: 'DELETE', headers: getAdminHeaders() })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to delete notification')
      loadAdminNotifications()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  // Chat
  async function loadConversations() {
    try {
      if (!authToken) { setConversations([]); return }
      const r = await fetch('/api/chats/admin/conversations', { headers: { 'X-Admin-Email': adminEmail, 'Authorization': `Bearer ${authToken}` } })
      const data = await safeJson(r)
      if (!r.ok) return
      setConversations(Array.isArray(data.results) ? data.results : [])
    } catch (_) {}
  }
  async function loadChatMessages(email) {
    try {
      const r = await fetch(`/api/chats/admin/${encodeURIComponent(email)}`, { headers: { 'X-Admin-Email': adminEmail, 'Authorization': authToken ? `Bearer ${authToken}` : undefined } })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to load messages')
      setSelectedChatEmail(email)
      const rows = Array.isArray(data.results) ? data.results : []
      setChatMessages(rows)
      const maxId = rows.length ? Number(rows[rows.length - 1].id) : 0
      if (Number.isFinite(maxId)) setChatLastId(maxId)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function sendAdminReply() {
    const msg = chatInput.trim()
    if (!msg || !selectedChatEmail) return
    try {
      // 1) Send chat reply (email optional via checkbox)
      const r = await fetch(`/api/chats/admin/${encodeURIComponent(selectedChatEmail)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Admin-Email': adminEmail, 'Authorization': authToken ? `Bearer ${authToken}` : undefined },
        body: JSON.stringify({ message: msg, notifyEmail: !!sendEmailOnReply, notifyInApp: true })
      })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to send')

      // 2) Always create an in-app notification for the user via admin notifications API
      //    This ensures the user sees a notification in the app, independently of chat delivery.
      try {
        const payload = {
          title: 'Admin replied',
          message: msg,
          targetEmail: selectedChatEmail
        }
        const nr = await fetch('/api/admin/notifications', {
          method: 'POST',
          headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(payload)
        })
        // We don't block on errors here; just try to refresh notifications list if OK.
        if (nr.ok) {
          loadAdminNotifications()
        }
      } catch (_) {
        // Silent on notification errors; chat reply is the primary action.
      }

      // 3) Update UI
      setChatInput('')
      setChatMessages(prev => [...prev, { id: Date.now(), sender: 'admin', message: msg, created_at: new Date().toISOString() }])
      setStatus(sendEmailOnReply ? 'Reply sent. Email and in-app notification requested.' : 'Reply sent. In-app notification created.')
      // Auto-turn off email notification after each send; admin can re-enable for the next reply.
      setSendEmailOnReply(false)
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  // Live stream updates for selected conversation via SSE (cookie-auth)
  useEffect(() => {
    if (!selectedChatEmail) return
    // Start after current lastId to avoid duplicates
    const url = `/api/chats/admin/${encodeURIComponent(selectedChatEmail)}/stream${chatLastId ? `?last_id=${encodeURIComponent(chatLastId)}` : ''}`
    let es
    try {
      es = new EventSource(url)
      esChatRef.current = es
      es.addEventListener('chat_messages', (e) => {
        try {
          const d = JSON.parse(e.data || '{}')
          const rows = Array.isArray(d.results) ? d.results : []
          if (!rows.length) return
          setChatMessages(prev => {
            const seen = new Set(prev.map(m => Number(m.id)))
            const toAdd = rows.filter(r => !seen.has(Number(r.id)))
            const next = [...prev, ...toAdd]
            const maxId = next.length ? Number(next[next.length - 1].id) : chatLastId
            if (Number.isFinite(maxId)) setChatLastId(maxId)
            return next
          })
        } catch (_) {}
      })
      es.onerror = () => {
        // Fallback refresh; browser will auto-reconnect
        if (selectedChatEmail) loadChatMessages(selectedChatEmail)
      }
    } catch (_) {
      // Silent; admin can use manual refresh
    }
    return () => {
      try { esChatRef.current && esChatRef.current.close() } catch (_) {}
      esChatRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChatEmail])

  // Backup/Restore
  async function createBackup() {
    try {
      const r = await fetch('/api/admin/backup', { method: 'POST', headers: getAdminHeaders() })
      if (!r.ok) {
        let msg = 'Failed to create backup'
        try {
          const ct = (r.headers && r.headers.get && r.headers.get('content-type')) ? String(r.headers.get('content-type')).toLowerCase() : ''
          if (ct.includes('application/json')) { const d = await r.json(); msg = d?.error || msg }
          else { const t = await r.text(); if (t) msg = t }
        } catch (_) {}
        throw new Error(msg)
      }
      const blob = await r.blob()
      const cd = (r.headers && r.headers.get && r.headers.get('content-disposition')) ? String(r.headers.get('content-disposition')) : ''
      let filename = 'ganudenu-backup.zip'
      const m = cd.match(/filename="([^"]+)"/)
      if (m && m[1]) filename = m[1]
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      setTimeout(() => {
        document.body.removeChild(a)
        window.URL.revokeObjectURL(url)
      }, 0)
      setStatus('Backup downloaded.')
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }
  async function restoreFromBackup(file) {
    if (!file) return
    try {
      const fd = new FormData()
      fd.append('backup', file)
      const r = await fetch('/api/admin/restore', { method: 'POST', headers: { 'X-Admin-Email': adminEmail, 'Authorization': authToken ? `Bearer ${authToken}` : undefined }, body: fd })
      const data = await safeJson(r)
      if (!r.ok) throw new Error(data.error || 'Failed to restore from backup')
      setStatus('Restore completed successfully.')
      loadMetrics(rangeDays)
      loadPending()
      loadAdminNotifications()
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      if (backupFileRef.current) backupFileRef.current.value = ''
    }
  }

  // UI Components
  function BarChart({ data, color = '#6c7ff7' }) {
    if (!Array.isArray(data) || data.length === 0) return <p className="text-muted">No data</p>
    const max = Math.max(1, ...data.map(d => d.count || 0))
    return (
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 140, minWidth: Math.max(360, data.length * 22) }}>
          {data.map((d, idx) => {
            const h = Math.round(((d.count || 0) / max) * 120)
            return (
              <div key={idx} style={{ width: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <div style={{ width: '100%', background: color, height: h, borderRadius: 8, opacity: 0.9 }} title={`${d.date || d.label}: ${d.count || 0}`} />
                <small className="text-muted" style={{ whiteSpace: 'nowrap' }}>{(d.date || '').slice(5)}</small>
              </div>
            )
          })}
        </div>
      </div>
    )
  }
  function SparklineBars({ data, color = '#6c7ff7' }) {
    if (!Array.isArray(data) || data.length === 0) return null
    const max = Math.max(1, ...data.map(d => d.count || 0))
    return (
      <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
        <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 40, minWidth: Math.max(280, data.length * 14) }}>
          {data.map((d, idx) => {
            const h = Math.round(((d.count || 0) / max) * 36)
            return <div key={idx} style={{ width: 10, height: h, background: color, borderRadius: 4, opacity: 0.9 }} />
          })}
        </div>
      </div>
    )
  }
  function StackedBars({ a, b, aLabel = 'A', bLabel = 'B', aColor = '#34d399', bColor = '#ef4444' }) {
    const len = Math.max((a && a.length) || 0, (b && b.length) || 0)
    const merged = Array.from({ length: len }, (_, i) => {
      const ai = Array.isArray(a) ? a[i] : undefined
      const bi = Array.isArray(b) ? b[i] : undefined
      return { date: (ai && ai.date) || (bi && bi.date) || '', a: (ai && ai.count) || 0, b: (bi && bi.count) || 0 }
    })
    const max = Math.max(1, ...merged.map(x => x.a + x.b))
    return (
      <div>
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <span className="pill" style={{ borderColor: 'transparent', background: 'rgba(52,211,153,0.15)', color: '#a7f3d0', whiteSpace: 'nowrap' }}>
            <span style={{ width: 10, height: 10, background: aColor, borderRadius: 2 }} /> {aLabel}
          </span>
          <span className="pill" style={{ borderColor: 'transparent', background: 'rgba(239,68,68,0.15)', color: '#fecaca', whiteSpace: 'nowrap' }}>
            <span style={{ width: 10, height: 10, background: bColor, borderRadius: 2 }} /> {bLabel}
          </span>
        </div>
        <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 140, minWidth: Math.max(360, merged.length * 22) }}>
            {merged.map((d, idx) => {
              const totalH = Math.round(((d.a + d.b) / max) * 120)
              const aH = totalH > 0 ? Math.round((d.a / (d.a + d.b)) * totalH) : 0
              const bH = totalH - aH
              return (
                <div key={idx} style={{ width: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: totalH, borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }} title={`${d.date}: ${d.a} / ${d.b}`}>
                    <div style={{ background: aColor, height: aH }} />
                    <div style={{ background: bColor, height: bH }} />
                  </div>
                  <small className="text-muted" style={{ whiteSpace: 'nowrap' }}>{(d.date || '').slice(5)}</small>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }
  function HorizontalBars({ items }) {
    if (!Array.isArray(items) || items.length === 0) return <p className="text-muted">No data</p>
    const max = Math.max(1, ...items.map(i => i.value || 0))
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((i, idx) => {
          const w = Math.round(((i.value || 0) / max) * 100)
          return (
            <div key={idx}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div className="text-muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.label}</div>
                <div className="text-muted" style={{ whiteSpace: 'nowrap' }}>{i.value}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: 8, overflow: 'hidden', height: 10 }}>
                <div style={{ width: `${w}%`, height: '100%', background: 'linear-gradient(90deg,#6c7ff7,#00d1ff)' }} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="center">
        <div className="card">
          <div className="h1">Admin Dashboard</div>
          <p className="text-muted">Access denied. Admins only.</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" onClick={() => navigate('/auth')}>Go to Login</button>
            <button className="btn" onClick={() => navigate('/')}>Home</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      <div className="card">
        <div className="h1">Admin Dashboard</div>
        <p className="text-muted">Configure, monitor, and manage users, listings, and reports.</p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8, marginBottom: 8 }}>
          {[
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'users', label: 'Users' },
            { key: 'reports', label: 'Reports' },
            { key: 'banners', label: 'Banners' },
            { key: 'notifications', label: (unreadCount > 0 ? `Notifications (${unreadCount})` : 'Notifications') },
            { key: 'chat', label: 'Chat' },
            { key: 'ai', label: 'AI Config' },
            { key: 'backup', label: 'Backup' },
            { key: 'approvals', label: 'Approvals' }
          ].map(t => (
            <button
              key={t.key}
              className="btn"
              onClick={() => setActiveTab(t.key)}
              style={{
                borderColor: 'var(--border)',
                background: activeTab === t.key ? 'linear-gradient(90deg, var(--primary), #5569e2)' : 'rgba(22,28,38,0.7)',
                color: activeTab === t.key ? '#fff' : 'var(--text)',
                whiteSpace: 'nowrap'
              }}
            >
              {t.key === 'notifications' ? (
                <>
                  <span>Notifications</span>
                  {unreadCount > 0 && <span className="pill" style={{ marginLeft: 6, whiteSpace: 'nowrap' }}>{unreadCount}</span>}
                </>
              ) : t.label}
            </button>
          ))}
        </div>

        {/* Dashboard */}
        {activeTab === 'dashboard' && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="text-muted">Range:</span>
              <select className="select" style={{ maxWidth: 180 }} value={String(rangeDays)} onChange={e => { const v = Number(e.target.value); setRangeDays(v); loadMetrics(v); }}>
                <option value="7">Last 7 days</option>
                <option value="14">Last 14 days</option>
                <option value="30">Last 30 days</option>
              </select>
              <button className="btn" onClick={() => loadMetrics(rangeDays)}>Refresh</button>
            </div>

            {/* Payment & Bank Settings */}
            <div className="card" style={{ marginTop: 8 }}>
              <div className="h2" style={{ marginTop: 0 }}>Payment & Bank Settings</div>
              <div className="grid two" style={{ gap: 8 }}>
                <div>
                  <label className="text-muted">Bank Name</label>
                  <input className="input" placeholder="e.g., Bank of Ceylon" value={bankName} onChange={e => setBankName(e.target.value)} />
                </div>
                <div>
                  <label className="text-muted">Account Name</label>
                  <input className="input" placeholder="e.g., Ganudenu Pvt Ltd" value={bankAccountName} onChange={e => setBankAccountName(e.target.value)} />
                </div>
              </div>
              <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                <div>
                  <label className="text-muted">Account Number</label>
                  <input className="input" placeholder="e.g., 1234567890" value={bankAccountNumber} onChange={e => setBankAccountNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-muted">WhatsApp Number</label>
                  <input className="input" placeholder="e.g., +94 7X XXX XXXX" value={whatsappNumber} onChange={e => setWhatsappNumber(e.target.value)} />
                </div>
              </div>
              <div style={{ marginTop: 8 }}>
                <label className="text-muted">Legacy Bank Details (combined text)</label>
                <textarea className="textarea" placeholder="Optional combined details shown to users if set" value={bankDetails} onChange={e => setBankDetails(e.target.value)} />
              </div>
              <div style={{ marginTop: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={!!emailOnApprove} onChange={e => setEmailOnApprove(!!e.target.checked)} />
                  <span className="text-muted">Email on approve (when Facebook share succeeds)</span>
                </label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button className="btn primary" onClick={saveConfig}>Save Settings</button>
                <button className="btn" onClick={fetchConfig}>Refresh</button>
              </div>
            </div>

            {!metrics && <p className="text-muted">Loading analytics...</p>}
            {metrics && (
              <>
                <div className="grid three" style={{ marginTop: 12 }}>
                  <div className="card">
                    <div className="h2">Users</div>
                    <div className="text-muted">Total: {metrics.totals.totalUsers}</div>
                    <div className="text-muted">Banned: {metrics.totals.bannedUsers}</div>
                    <div className="text-muted">Suspended: {metrics.totals.suspendedUsers}</div>
                  </div>
                  <div className="card">
                    <div className="h2">Listings</div>
                    <div className="text-muted">Total: {metrics.totals.totalListings}</div>
                    <div className="text-muted">Active: {metrics.totals.activeListings}</div>
                    <div className="text-muted">Pending: {metrics.totals.pendingListings}</div>
                    <div className="text-muted">Rejected: {metrics.totals.rejectedListings}</div>
                  </div>
                  <div className="card">
                    <div className="h2">Reports</div>
                    <div className="text-muted">Pending: {metrics.totals.reportPending}</div>
                    <div className="text-muted">Resolved: {metrics.totals.reportResolved}</div>
                  </div>
                </div>

                {/* New system/traffic stats */}
                <div className="grid three" style={{ marginTop: 12 }}>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">Visitors</div>
                    <div className="text-muted">Total (distinct): {metrics.totals.visitorsTotal}</div>
                    <div className="text-muted">New (last {metrics.params?.days}d): {metrics.rangeTotals.visitorsInRange}</div>
                    <div className="text-muted" style={{ marginTop: 6 }}>Per day</div>
                    <SparklineBars data={metrics.series.visitorsPerDay} color="#34d399" />
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">Images</div>
                    <div className="text-muted">Total stored: {metrics.totals.imagesCount}</div>
                    <div className="text-muted" style={{ marginTop: 6 }}>Added per day (last {metrics.params?.days}d)</div>
                    <SparklineBars data={metrics.series.imagesAddedPerDay} color="#f97316" />
                  </div>
                  <div className="card">
                    <div className="h2">Storage & Files</div>
                    <div className="text-muted">Uploads size: {((Number(metrics.totals.uploadsDiskUsageBytes) || 0) / (1024 * 1024)).toFixed(1)} MB</div>
                    <div className="text-muted">Databases: {metrics.totals.databasesCount}</div>
                    <div className="text-muted">Files in data/: {metrics.totals.systemFilesCount}</div>
                    <div className="text-muted">All files in project: {metrics.totals.allFilesCount}</div>
                  </div>
                </div>

                <div className="grid three" style={{ marginTop: 12 }}>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">New Users (last {metrics.params?.days}d): {metrics.rangeTotals.usersNewInRange}</div>
                    <SparklineBars data={metrics.series.signups} color="#6c7ff7" />
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">New Ads (last {metrics.params?.days}d): {metrics.rangeTotals.listingsNewInRange}</div>
                    <SparklineBars data={metrics.series.listingsCreated} color="#00d1ff" />
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">Reports (last {metrics.params?.days}d): {metrics.rangeTotals.reportsInRange}</div>
                    <SparklineBars data={metrics.series.reports} color="#e58e26" />
                  </div>
                </div>

                <div className="grid two" style={{ marginTop: 12 }}>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <div className="h2">Approvals vs Rejections (last {metrics.params?.days} days)</div>
                    <StackedBars a={metrics.series.approvals} b={metrics.series.rejections} aLabel="Approve" bLabel="Reject" aColor="#34d399" bColor="#ef4444" />
                    <div className="text-muted" style={{ marginTop: 8 }}>
                      Total approvals: {metrics.rangeTotals.approvalsInRange} • Total rejections: {metrics.rangeTotals.rejectionsInRange}
                    </div>
                  </div>
                  <div className="card">
                    <div className="h2">Top Categories</div>
                    <HorizontalBars items={metrics.topCategories.map(c => ({ label: c.category, value: c.cnt }))} />
                    <div className="h2" style={{ marginTop: 16 }}>Status Breakdown</div>
                    <HorizontalBars items={metrics.statusBreakdown.map(s => ({ label: s.status, value: s.count }))} />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Users */}
        {activeTab === 'users' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>User Management</div>
            <div className="grid two">
              <div>
                <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Find user</div>
                <CustomSelect
                  value={userSelect}
                  onChange={v => { const s = String(v || ''); setUserSelect(s); setUserQuery(s); loadUsers(s); }}
                  ariaLabel="Find user by email"
                  placeholder={users.length ? 'Type or pick an email...' : 'No users loaded yet'}
                  options={userEmailOptionsCache.map(e => ({ value: e, label: e }))}
                  searchable={true}
                  allowCustom={true}
                  virtualized={true}
                  maxDropdownHeight={420}
                />
                <small className="text-muted" style={{ display: 'block', marginTop: 6 }}>
                  Tip: start typing to filter. You can also enter a custom email.
                </small>
              </div>
              <div>
                <input className="input" placeholder="Or search by email or username..." value={userQuery} onChange={e => setUserQuery(e.target.value)} />
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button className="btn" onClick={() => loadUsers(userQuery)}>Search</button>
                  <button className="btn" onClick={() => { setUserQuery(''); setUserSelect(''); loadUsers(''); }}>Reset</button>
                </div>
              </div>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <div>
                <label className="text-muted">Suspend days</label>
                <input className="input" type="number" min="1" max="365" value={suspendDays} onChange={e => setSuspendDays(Math.max(1, Math.min(365, Number(e.target.value || 1))))} />
              </div>
              <div className="text-muted" style={{ display: 'flex', alignItems: 'center' }}>
                This value is used when clicking “Suspend” on a user.
              </div>
            </div>
            <div className="grid two" style={{ marginTop: 8 }}>
              <div className="card">
                <div className="h2">Results</div>
                {users.length === 0 && <p className="text-muted">No users.</p>}
                {users.map(u => (
                  <div key={u.id} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <strong>{u.email}</strong> {u.username ? <span className="text-muted">• @{u.username}</span> : null}
                    </div>
                    <div className="text-muted">ID: {u.id} • Admin: {u.is_admin ? 'Yes' : 'No'} • Created: {new Date(u.created_at).toLocaleString()}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                      <button className="btn" onClick={() => banUser(u.id)}>Ban</button>
                      <button className="btn" onClick={() => unbanUser(u.id)}>Unban</button>
                      <button className="btn" onClick={() => suspendUser(u.id)}>Suspend</button>
                      <button className="btn" onClick={() => unsuspendUser(u.id)}>Unsuspend</button>
                      <button className="btn" onClick={() => toggleExpandUser(u.id)}>{expandedUserIds.includes(u.id) ? 'Hide Ads' : 'Show Ads'}</button>
                    </div>
                    {expandedUserIds.includes(u.id) && (
                      <div className="card" style={{ marginTop: 8 }}>
                        <div className="h2">Ads</div>
                        <div className="grid two" style={{ gap: 8 }}>
                          <input className="input" placeholder="Filter text..." onChange={e => updateUserAdsFilter(u.id, { q: e.target.value })} />
                          <input className="input" placeholder="Location..." onChange={e => updateUserAdsFilter(u.id, { location: e.target.value })} />
                        </div>
                        <div className="grid two" style={{ gap: 8, marginTop: 8 }}>
                          <input className="input" placeholder="Category..." onChange={e => updateUserAdsFilter(u.id, { category: e.target.value })} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <input className="input" placeholder="Price min" onChange={e => updateUserAdsFilter(u.id, { priceMin: e.target.value })} />
                            <input className="input" placeholder="Price max" onChange={e => updateUserAdsFilter(u.id, { priceMax: e.target.value })} />
                          </div>
                        </div>
                        <div style={{ marginTop: 8 }}>
                          {(getFilteredUserAds(u.id) || []).map(ad => (
                            <div key={ad.id} className="card" style={{ marginBottom: 8 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  <strong>#{ad.id}</strong> {ad.title}
                                </div>
                                <div style={{ display: 'flex', gap: 8 }}>
                                  <button className="btn" onClick={() => deleteUserAd(ad.id, u.id)}>Delete Ad</button>
                                </div>
                              </div>
                              <div className="text-muted">{ad.main_category} • {ad.location} • {ad.status}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Reports */}
        {activeTab === 'reports' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>Reports</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="select" value={reportFilter} onChange={e => { const f = e.target.value; setReportFilter(f); loadReports(f) }}>
                <option value="pending">Pending</option>
                <option value="resolved">Resolved</option>
                <option value="all">All</option>
              </select>
              <button className="btn" onClick={() => loadReports(reportFilter)}>Refresh</button>
            </div>
            <div className="card" style={{ marginTop: 8 }}>
              {reports.length === 0 && <p className="text-muted">No reports.</p>}
              {reports.map(r => (
                <div key={r.id} className="card" style={{ marginBottom: 8 }}>
                  <div><strong>#{r.id}</strong> Listing #{r.listing_id}</div>
                  <div className="text-muted">{r.reason}</div>
                  <div className="text-muted">{new Date(r.ts).toLocaleString()}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    {r.status !== 'resolved' && <button className="btn" onClick={() => resolveReport(r.id)}>Resolve</button>}
                    <button className="btn" onClick={() => deleteReport(r.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Banners */}
        {activeTab === 'banners' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>Banners</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="file" ref={fileRef} accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={e => onUploadBanner(e.target.files?.[0])} />
              <button className="btn" onClick={loadBanners}>Refresh</button>
            </div>
            <div className="card" style={{ marginTop: 8 }}>
              {banners.length === 0 && <p className="text-muted">No banners.</p>}
              {banners.map(b => (
                <div key={b.id} className="card" style={{ marginBottom: 8 }}>
                  <div className="text-muted">#{b.id} • {b.url}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="btn" onClick={() => toggleBanner(b.id, b.active)}>{b.active ? 'Deactivate' : 'Activate'}</button>
                    <button className="btn" onClick={() => deleteBanner(b.id)}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Notifications */}
            {activeTab === 'notifications' && (
              <>
                <div className="h2" style={{ marginTop: 8 }}>Notifications</div>
                <div className="grid two">
                  <div>
                    <input className="input" placeholder="Title" value={notifyTitle} onChange={e => setNotifyTitle(e.target.value)} />
                  </div>
                  <div>
                    <select className="select" value={notifyTargetType} onChange={e => setNotifyTargetType(e.target.value)}>
                      <option value="all">All</option>
                      <option value="email">Email</option>
                      <option value="app">App</option>
                    </select>
                  </div>
                </div>
                {notifyTargetType === 'email' && (
                  <div style={{ marginTop: 8 }}>
                    <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Select user email</div>
                    <CustomSelect
                      value={notifyEmail}
                      onChange={v => setNotifyEmail(String(v || ''))}
                      ariaLabel="Target email"
                      placeholder={userEmailOptionsCache.length ? 'Pick an email...' : 'No users loaded yet'}
                      options={userEmailOptionsCache.map(e => ({ value: e, label: e }))}
                      searchable={true}
                      allowCustom={true}
                      virtualized={true}
                      maxDropdownHeight={420}
                    />
                    <small className="text-muted" style={{ display: 'block', marginTop: 6 }}>
                      Tip: start typing to filter. You can also enter a custom email not in the list.
                    </small>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <input type="checkbox" checked={notifySendEmail} onChange={e => setNotifySendEmail(!!e.target.checked)} />
                      <span className="text-muted">Send email to this user</span>
                    </label>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <textarea className="textarea" placeholder="Message" value={notifyMessage} onChange={e => setNotifyMessage(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn primary" onClick={sendNotification}>Send Notification</button>
                  <button className="btn" onClick={loadAdminNotifications}>Refresh</button>
                </div>
                <div className="card" style={{ marginTop: 8 }}>
                  {notificationsAdmin.length === 0 && <p className="text-muted">No notifications.</p>}
                  {notificationsAdmin.map(n => (
                    <div key={n.id} className="card" style={{ marginBottom: 8 }}>
                      <div><strong>{n.title}</strong></div>
                      <div className="text-muted">{n.message}</div>
                      <div className="text-muted">{n.target_email || 'All'} • {new Date(n.created_at).toLocaleString()}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        <button className="btn" onClick={() => deleteNotification(n.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

        {/* Chat */}
        {activeTab === 'chat' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>Admin Chat</div>
            <div className="grid two">
              <div className="card">
                <div className="h2">Conversations</div>
                {!authToken && (
                  <p className="text-muted">Admin chat requires a valid login token. Please log in again.</p>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn" onClick={loadConversations}>Refresh</button>
                </div>
                {conversations.length === 0 && <p className="text-muted" style={{ marginTop: 8 }}>No conversations.</p>}
                {conversations.map(c => (
                  <div key={(c.user_email || c.email || '') + (c.last_ts || '')} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.user_email || c.email}</strong>
                      {c.last_ts && <small className="text-muted">{new Date(c.last_ts).toLocaleString()}</small>}
                    </div>
                    <div className="text-muted" style={{ marginTop: 6 }}>{c.last_message || ''}</div>
                    <button className="btn" style={{ marginTop: 6 }} onClick={() => loadChatMessages(c.user_email || c.email)}>Open</button>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="h2">Messages</div>
                {selectedChatEmail ? (
                  <>
                    <div className="text-muted">Chatting with {selectedChatEmail}</div>
                    <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
                      {chatMessages.map(m => (
                        <div key={m.id} className="card" style={{ marginBottom: 6 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <strong>{m.sender}</strong>
                            <small className="text-muted">{new Date(m.created_at).toLocaleString()}</small>
                          </div>
                          <div className="text-muted" style={{ marginTop: 4 }}>{m.message}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input className="input" placeholder="Type a message..." value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendAdminReply() } }} />
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={sendEmailOnReply} onChange={e => setSendEmailOnReply(!!e.target.checked)} />
                        <span className="text-muted">Send email notification</span>
                      </label>
                      <button className="btn primary" onClick={sendAdminReply}>Send</button>
                    </div>
                  </>
                ) : (
                  <p className="text-muted">Select a conversation.</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* AI Config */}
        {activeTab === 'ai' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>AI Configuration</div>
            <div className="grid two">
              <div>
                <label className="text-muted">Gemini API key</label>
                <input className="input" placeholder="Enter API key (not stored in plaintext)" value={geminiApiKey} onChange={e => setGeminiApiKey(e.target.value)} />
              </div>
              <div className="text-muted" style={{ display: 'flex', alignItems: 'center' }}>
                {maskedKey ? `Configured: ${maskedKey}` : 'No key configured'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn primary" onClick={saveConfig}>Save Config</button>
              <button className="btn" onClick={testGemini}>Test Gemini</button>
              <button className="btn" onClick={fetchConfig}>Refresh</button>
            </div>

            {/* Maintenance Mode */}
            <div className="card" style={{ marginTop: 16 }}>
              <div className="h2" style={{ marginTop: 0 }}>Maintenance Mode</div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={!!maintenanceEnabled}
                  onChange={e => setMaintenanceEnabled(!!e.target.checked)}
                />
                <span className="text-muted">Enable maintenance (blocks public pages and APIs)</span>
              </label>
              <div style={{ marginTop: 8 }}>
                <label className="text-muted">Message (optional)</label>
                <input
                  className="input"
                  placeholder="e.g., Upgrading database..."
                  value={maintenanceMessage}
                  onChange={e => setMaintenanceMessage(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <button className="btn primary" onClick={saveConfig}>Save Maintenance Settings</button>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/admin/maintenance', {
                        method: 'POST',
                        headers: getAdminHeaders({ 'Content-Type': 'application/json' }),
                        body: JSON.stringify({ enabled: !!maintenanceEnabled, message: maintenanceMessage })
                      })
                      const d = await safeJson(r)
                      if (!r.ok) throw new Error(d.error || 'Failed to update maintenance')
                      setStatus(maintenanceEnabled ? 'Maintenance enabled.' : 'Maintenance disabled.')
                    } catch (e) {
                      setStatus(`Error: ${e.message}`)
                    }
                  }}
                >
                  Apply Now
                </button>
                <button
                  className="btn"
                  onClick={async () => {
                    try {
                      const r = await fetch('/api/admin/maintenance', { headers: getAdminHeaders() })
                      const d = await safeJson(r)
                      if (!r.ok) throw new Error(d.error || 'Failed to load maintenance state')
                      setMaintenanceEnabled(!!d.enabled)
                      setMaintenanceMessage(String(d.message || ''))
                      setStatus('Maintenance state refreshed.')
                    } catch (e) {
                      setStatus(`Error: ${e.message}`)
                    }
                  }}
                >
                  Refresh State
                </button>
              </div>
              <small className="text-muted" style={{ display: 'block', marginTop: 6 }}>
                While enabled, only /api/admin/* and /api/health are accessible. All other routes serve the maintenance page.
              </small>
            </div>
          </>
        )}

        {/* Backup */}
        {activeTab === 'backup' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>Backup & Restore</div>
            <div className="card">
              <div className="h2" style={{ marginTop: 0 }}>Full Backup</div>
              <p className="text-muted">Creates a ZIP file containing the entire database (consistent snapshot), all uploads (images), and secure config. Download the file and keep it safe.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" onClick={createBackup}>Create Full Backup</button>
              </div>
            </div>

            <div className="card" style={{ marginTop: 8 }}>
              <div className="h2" style={{ marginTop: 0 }}>Restore from Backup</div>
              <p className="text-muted">Restoring will replace the entire database contents and merge uploads from the backup. Make sure you trust the backup file.</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => backupFileRef.current?.click()}>Choose Backup (.zip)</button>
                <input
                  ref={backupFileRef}
                  type="file"
                  accept=".zip,application/zip"
                  style={{ display: 'none' }}
                  onChange={e => restoreFromBackup(e.target.files?.[0])}
                />
                <small className="text-muted">Recommended: use the most recent backup. Max size 500MB.</small>
              </div>
            </div>
          </>
        )}

        {/* Approvals */}
        {activeTab === 'approvals' && (
          <>
            <div className="h2" style={{ marginTop: 8 }}>Pending Approvals</div>
            <div className="card">
              {pending.length === 0 && <p className="text-muted">No pending items.</p>}
              {pending.map(p => (
                <div key={p.id} className="card" style={{ marginBottom: 8 }}>
                  <div><strong>#{p.id}</strong> {p.title}</div>
                  <div className="text-muted">{p.main_category} • {new Date(p.created_at).toLocaleString()}</div>
                  <button className="btn" style={{ marginTop: 6 }} onClick={() => loadDetail(p.id)}>Open</button>
                </div>
              ))}
            </div>
            {detail && (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="h2">Edit Listing #{selectedId}</div>
                <div className="text-muted">Category: {detail.listing.main_category}</div>
                <div className="text-muted">Title: {detail.listing.title}</div>
                <div style={{ marginTop: 8 }}>
                  <label className="text-muted">Structured JSON</label>
                  <textarea className="textarea" value={editStructured} onChange={e => setEditStructured(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn primary" onClick={saveEdits}>Save</button>
                  <button className="btn" onClick={() => setDetail(null)}>Close</button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label className="text-muted">Reject reason</label>
                  <input className="input" value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn" onClick={approve}>Approve</button>
                  <button className="btn" onClick={reject}>Reject</button>
                </div>
              </div>
            )}
          </>
        )}

        {status && <p style={{ marginTop: 8 }}>{status}</p>}
      </div>
    </div>
  )
}
