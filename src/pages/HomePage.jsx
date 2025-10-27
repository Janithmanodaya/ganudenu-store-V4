import React, { useEffect, useMemo, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import ChatWidget from '../components/ChatWidget.jsx'
import { useI18n } from '../components/i18n.jsx'

import CustomSelect from '../components/CustomSelect.jsx'
import useSEO from '../components/useSEO.js'
import { getSuggestedListings, trackSearch, trackView } from '../components/recommendations.js'

export default function HomePage() {
  const [q, setQ] = useState('')
  const { t } = useI18n()
  const [latest, setLatest] = useState([])
  const [status, setStatus] = useState(null)
  const [localFilter, setLocalFilter] = useState('')
  const [banners, setBanners] = useState([])
  const [slide, setSlide] = useState(0)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  // Prevent accidental double navigations from rapid clicks/touches
  const navLockRef = useRef({ locked: false, t: null })
  function navigateOnce(path, itemForTrack = null) {
    const ref = navLockRef.current
    if (ref.locked) return
    try { if (itemForTrack) trackView(itemForTrack) } catch (_) {}
    ref.locked = true
    navigate(path)
    try { if (ref.t) clearTimeout(ref.t) } catch (_) {}
    ref.t = setTimeout(() => { ref.locked = false; ref.t = null }, 800)
  }
  const [showFilters, setShowFilters] = useState(false)
  const [filterCategory, setFilterCategory] = useState('')
  const [filterLocation, setFilterLocation] = useState('')
  const [filterPriceMin, setFilterPriceMin] = useState('')
  const [filterPriceMax, setFilterPriceMax] = useState('')
  const [filtersDef, setFiltersDef] = useState({ keys: [], valuesByKey: {} })
  const [filters, setFilters] = useState({})
  const [locQuery, setLocQuery] = useState('')
  const [locSuggestions, setLocSuggestions] = useState([])
  const [locationOptionsCache, setLocationOptionsCache] = useState([])
  const [sort, setSort] = useState('latest')
  const [suggested, setSuggested] = useState([])
  const [suggestedLoading, setSuggestedLoading] = useState(false)

  // Site-wide SEO for homepage (via helper)
  useSEO({
    title: 'Ganudenu Marketplace — Buy • Sell • Hire in Sri Lanka',
    description: 'Discover great deals on vehicles, property, jobs, electronics, mobiles, and home & garden. Post your ad in minutes.',
    canonical: 'https://ganudenu.store/'
  })

  // Global search suggestions
  const [searchSuggestions, setSearchSuggestions] = useState([])

  // Selected tag arrays for multi-select fields
  const subCategorySelected = Array.isArray(filters.sub_category) ? filters.sub_category : []
  const modelSelected = Array.isArray(filters.model) ? filters.model : []

  // Pagination
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const limit = 10

  // Ref for features mini-cards scroller
  const featureRef = useRef(null)
  // Ref for suggested horizontal scroller
  const suggestedRef = useRef(null)

  // Seamless ad-free experience flag (hides banner slider)
  const AD_FREE = true


  // Suggestions derived from filtersDef values (full set; filtering happens inside the dropdown)
  const subCategoryOptions = useMemo(() => {
    return (filtersDef.valuesByKey['sub_category'] || []).map(v => String(v))
  }, [filtersDef])
  const modelOptions = useMemo(() => {
    return (filtersDef.valuesByKey['model'] || []).map(v => String(v))
  }, [filtersDef])

  // Mobile detection for UX tweaks (keyboard-safe dropdown)
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    let cleanup = null
    try {
      const mq = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(max-width: 780px)') : null
      setIsMobile(!!(mq && mq.matches))
      const handler = (e) => { try { setIsMobile(!!e.matches) } catch (_) {} }
      if (mq && mq.addEventListener) {
        mq.addEventListener('change', handler)
        cleanup = () => { try { mq.removeEventListener('change', handler) } catch (_) {} }
      } else if (mq && mq.addListener) {
        mq.addListener(handler)
        cleanup = () => { try { mq.removeListener(handler) } catch (_) {} }
      }
    } catch (_) {}
    return cleanup || (() => {})
  }, [])

  function onSearch(e) {
    e.preventDefault()
    const term = (q || '').trim()
    const path = term ? `/search?q=${encodeURIComponent(term)}` : '/search'
    try { if (term) trackSearch(term) } catch (_) {}
    try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (_) {}
    navigate(path)
  }

  useEffect(() => {
    async function loadAll() {
      try {
        setLoading(true)
        const initialSort = filterCategory ? 'latest' : 'random'
        const lr = await fetch(`/api/listings/search?limit=${limit}&page=${page}&sort=${initialSort}`)
        // listings
        if (lr.status === 204) {
          setLatest([])
        } else {
          const ct = lr.headers.get('content-type') || ''
          const ltext = await lr.text()
          const ldata = ct.includes('application/json') && ltext ? JSON.parse(ltext) : {}
          if (!lr.ok) throw new Error((ldata && ldata.error) || 'Failed to load listings')
          const items = Array.isArray(ldata.results) ? ldata.results : []
          setLatest(items)
        }
        // banners (skip when ad-free)
        if (!AD_FREE) {
          try {
            const br = await fetch('/api/banners')
            const bdata = await br.json().catch(() => ({}))
            if (br.ok && Array.isArray(bdata.results)) {
              setBanners(bdata.results)
            }
          } catch (_) {}
        } else {
          setBanners([])
        }
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    loadAll()
  }, [page, refreshKey])

  // Load dynamic filters when a category is selected
  useEffect(() => {
    async function loadFilters() {
      if (!filterCategory) { setFiltersDef({ keys: [], valuesByKey: {} }); setFilters({}); return }
      try {
        const r = await fetch(`/api/listings/filters?category=${encodeURIComponent(filterCategory)}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Failed to load filters')
        setFiltersDef({ keys: data.keys || [], valuesByKey: data.valuesByKey || {} })
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      }
    }
    loadFilters()
  }, [filterCategory])

  useEffect(() => {
    if (!banners.length) return
    const timer = setInterval(() => {
      setSlide(s => (s + 1) % banners.length)
    }, 4000)
    return () => clearInterval(timer)
  }, [banners])

  // NOTE: We intentionally DO NOT refetch listings when filters change on the Home page.
  // Pressing "Apply" will show the default latest 10 listings.

  // Fetch global search suggestions (titles, locations, sub_category, model)
  // Home page must NOT show job suggestions; exclude Job via backend param.
  useEffect(() => {
    const term = (q || '').trim()
    if (!term) { setSearchSuggestions([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listings/suggestions?q=${encodeURIComponent(term)}&exclude_category=Job`, { signal: ctrl.signal })
        const data = await r.json()
        if (r.ok && Array.isArray(data.results)) setSearchSuggestions(data.results)
      } catch (_) {}
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q])

  // Location suggestions fetching (debounced) for Home filters
  useEffect(() => {
    const term = (locQuery || '').trim()
    if (!term) { setLocSuggestions([]); return }
    const ctrl = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listings/locations?q=${encodeURIComponent(term)}`, { signal: ctrl.signal })
        const data = await r.json()
        if (r.ok) setLocSuggestions(Array.isArray(data.results) ? data.results : [])
      } catch (_) {}
    }, 250)
    return () => { ctrl.abort(); clearTimeout(timer) }
  }, [locQuery])

  // Keep a stable cache of location options so the dropdown doesn't shrink to only current results
  useEffect(() => {
    // If backend provided explicit locations for the selected category, prioritize and reset cache to those.
    const vals = (filtersDef?.valuesByKey?.['location'] || []).map(v => String(v).trim()).filter(Boolean)
    if (vals.length) {
      setLocationOptionsCache(Array.from(new Set(vals)))
      return
    }
    // Otherwise, merge-in locations seen in current listings without removing prior ones.
    const fromLatest = Array.from(new Set((latest || []).map(it => String(it.location || '').trim()).filter(Boolean)))
    if (fromLatest.length) {
      setLocationOptionsCache(prev => {
        const merged = [...prev]
        for (const v of fromLatest) if (!merged.includes(v)) merged.push(v)
        return merged
      })
    }
  }, [filtersDef, latest])

  // Suggested ads for you (horizontal grid) using cookie-based profile
  useEffect(() => {
    let alive = true
    const term = (q || '').trim()
    async function load() {
      try {
        setSuggestedLoading(true)
        const res = await getSuggestedListings({ query: term, limit: 10 })
        if (alive) setSuggested(Array.isArray(res) ? res : [])
      } catch (_) {
        if (alive) setSuggested([])
      } finally {
        if (alive) setSuggestedLoading(false)
      }
    }
    load()
    return () => { alive = false }
  }, [q, filterCategory, filterLocation, filters, refreshKey])

  // Cache for preloaded images to avoid re-downloading when sliding
  const imageCacheRef = useRef(new Map())
  function prefetchImage(url) {
    try {
      const cache = imageCacheRef.current
      if (!url || cache.has(url)) return
      const img = new Image()
      img.decoding = 'async'
      img.loading = 'eager'
      img.src = url
      img.onload = () => { try { cache.set(url, true) } catch (_) {} }
      img.onerror = () => { try { cache.set(url, false) } catch (_) {} }
    } catch (_) {}
  }

  const [cardSlideIndex, setCardSlideIndex] = useState({})
  function nextImage(item) {
    const imgs = Array.isArray(item.small_images) ? item.small_images : []
    const len = imgs.length || 1
    const nextIdx = ((cardSlideIndex[item.id] || 0) + 1) % len
    // Prefetch upcoming image to make slide feel instant
    if (imgs.length > 1) prefetchImage(imgs[nextIdx])
    setCardSlideIndex(prev => ({ ...prev, [item.id]: nextIdx }))
  }
  function prevImage(item) {
    const imgs = Array.isArray(item.small_images) ? item.small_images : []
    const len = imgs.length || 1
    setCardSlideIndex(prev => {
      const cur = prev[item.id] || 0
      const nxt = (cur - 1 + len) % len
      // Prefetch upcoming image
      if (imgs.length > 1) prefetchImage(imgs[nxt])
      return { ...prev, [item.id]: nxt }
    })
  }

  // Client-side filtering with AND logic across multiple selected filters.
  const filtered = useMemo(() => {
    const t = (localFilter || '').toLowerCase().trim()
    return latest.filter(item => {
      const parts = [
        item.title || '',
        item.main_category || '',
        item.location || '',
        item.seo_description || item.description || ''
      ]
      const textMatch = t ? parts.join(' ').toLowerCase().includes(t) : true

      const categoryOk = filterCategory ? (item.main_category || '') === filterCategory : true
      const locationOk = filterLocation ? (item.location || '').toLowerCase().includes(filterLocation.toLowerCase()) : true
      const priceVal = item.price != null ? Number(item.price) : null
      const priceMinOk = filterPriceMin ? (priceVal != null && priceVal >= Number(filterPriceMin)) : true
      const priceMaxOk = filterPriceMax ? (priceVal != null && priceVal <= Number(filterPriceMax)) : true

      // Structured filters (exact match except partial for model/sub_category)
      let structuredOk = true
      if (Object.keys(filters).length) {
        try {
          const raw = JSON.parse(item.structured_json || '{}')
          const sj = Object.fromEntries(Object.entries(raw).map(([k, v]) => [String(k).toLowerCase(), v]))
          for (const [k, v] of Object.entries(filters)) {
            const key = String(k).toLowerCase()
            const val = String(v || '').toLowerCase()
            if (!val) continue
            // Map UI key 'model' to stored 'model_name'
            const lookupKey = key === 'model' ? 'model_name' : key
            const target = sj[lookupKey]
            const targetStr = String(target || '').toLowerCase()
            if (lookupKey === 'model_name' || lookupKey === 'sub_category') {
              if (!targetStr.includes(val)) { structuredOk = false; break }
            } else {
              if (targetStr !== val) { structuredOk = false; break }
            }
          }
        } catch (_) {}
      }

      // AND all conditions
      return textMatch && categoryOk && locationOk && priceMinOk && priceMaxOk && structuredOk
    })
  }, [latest, localFilter, filterCategory, filterLocation, filterPriceMin, filterPriceMax, filters])

  // Compute 3-wide window for banners
  const visibleBanners = useMemo(() => {
    if (!banners.length) return []
    const arr = []
    for (let i = 0; i < Math.min(3, banners.length); i++) {
      const idx = (slide + i) % banners.length
      arr.push(banners[idx])
    }
    return arr
  }, [banners, slide])

  function updateFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  async function fetchFilteredListings(sortOverride) {
    try {
      setLoading(true)
      setShowFilters(false)
      // Build server-side query based on current filter selections and keep current page
      const params = new URLSearchParams()
      params.set('limit', String(limit))
      params.set('page', String(page))
      const effectiveSort = String(sortOverride || sort || 'latest')
      params.set('sort', effectiveSort)
      if (filterCategory) params.set('category', filterCategory)
      if (filterLocation) params.set('location', filterLocation)
      if (filterPriceMin) params.set('price_min', filterPriceMin)
      if (filterPriceMax) params.set('price_max', filterPriceMax)
      if (Object.keys(filters).length) params.set('filters', JSON.stringify(filters))

      const r = await fetch(`/api/listings/search?${params.toString()}`)
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || 'Failed to load filtered listings')
      setLatest(Array.isArray(data.results) ? data.results : [])
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    } finally {
      setLoading(false)
    }
  }

  function resetHomeFilters() {
    try {
      setFilterCategory('');
      setFilterLocation('');
      setFilterPriceMin('');
      setFilterPriceMax('');
      setFilters({});
      setShowFilters(false);
      setLocationOptionsCache([]);
      setPage(1);
      // Trigger reload of latest listings
      setRefreshKey(k => k + 1)
      // Scroll back to top of listings
      try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (_) {}
    } catch (_) {}
  }

  const hasActiveFilters = useMemo(() => {
    return !!(filterCategory || filterLocation || filterPriceMin || filterPriceMax || Object.keys(filters).length);
  }, [filterCategory, filterLocation, filterPriceMin, filterPriceMax, filters]);

  // Build pagination window (around 5 pages centered on current)
  const pageWindow = [page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1)

  return (
    <div className="center">
      {loading && <LoadingOverlay message="Loading latest listings..." />}
      <div className="card" style={{ padding: 0 }}>
        <div
          style={{
            padding: '42px 18px',
            background:
              'radial-gradient(1000px 300px at 10% -20%, rgba(0,209,255,0.25), transparent 60%), ' +
              'radial-gradient(1000px 300px at 90% 0%, rgba(108,127,247,0.25), transparent 60%), ' +
              'linear-gradient(180deg, rgba(18,22,31,0.9), rgba(18,22,31,0.6))'
          }}
        >
          <h1 className="h1" style={{ textAlign: 'center', marginBottom: 8 }}>Buy • Sell • Hire</h1>
          <p className="text-muted" style={{ textAlign: 'center', marginTop: 0 }}>
            Discover great deals on vehicles, property, jobs, electronics, mobiles, and home &amp; garden.
          </p>

          {/* Seamless ad‑free badge */}
          {AD_FREE && (
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
              <span className="pill" style={{ background: 'rgba(108,127,247,0.15)', border: '1px solid rgba(108,127,247,0.35)' }}>
                ✨ Seamless ad‑free experience
              </span>
            </div>
          )}

          <form onSubmit={onSearch} className="searchbar" style={{ margin: '16px auto 0', maxWidth: 720, position: 'relative' }}>
            <input
              className="input"
              type="text"
              placeholder="Search anything (e.g., Toyota, House in Kandy)..."
              value={q}
              onChange={e => setQ(e.target.value)}
              onFocus={(e) => {
                // On mobile, make sure the search bar is fully visible above keyboard
                try {
                  if (isMobile) {
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  } else {
                    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }
                } catch (_) {}
              }}
              onClick={(e) => {
                // Also handle tap/click bringing the search bar to top on mobile
                try {
                  if (isMobile) window.scrollTo({ top: 0, behavior: 'smooth' })
                } catch (_) {}
              }}
              onTouchStart={(e) => {
                // Ensure early touch shows the input unobstructed on mobile
                try { if (isMobile) window.scrollTo({ top: 0 }) } catch (_) {}
              }}
            />
            {/* Dynamic typed suggestions dropdown (titles, locations, sub_category, model) */}
            {q.trim() && Array.isArray(searchSuggestions) && searchSuggestions.length > 0 && (
              <div
                className="card"
                role="listbox"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '100%',
                  marginTop: 6,
                  zIndex: 60,
                  maxHeight: isMobile ? 180 : 300,
                  overflowY: 'auto',
                  padding: 6,
                  background: 'rgba(18,22,31,0.96)',
                  border: '1px solid var(--border)',
                  boxShadow: '0 14px 36px var(--shadow)',
                  borderRadius: 12
                }}
              >
                {(isMobile ? searchSuggestions.slice(0, 6) : searchSuggestions.slice(0, 12)).map((sug, idx) => {
                  const isObj = typeof sug === 'object' && sug !== null
                  const label = isObj ? String(sug.value) : String(sug)
                  const type = isObj ? String(sug.type || '') : ''
                  const badge = type
                    ? { title: 'Title', location: 'Location', sub_category: 'Sub-category', model: 'Model' }[type] || ''
                    : ''
                  return (
                    <div
                      key={`${label}-${idx}`}
                      role="option"
                      className="custom-select-option"
                      onMouseDown={(e) => {
                        // Prevent input blur before click handler runs
                        e.preventDefault()
                      }}
                      onClick={() => {
                        const v = String(label || '').trim()
                        if (!v) return
                        setQ(v)
                        try { trackSearch(v) } catch (_) {}
                        // Scroll a bit to keep the search bar visible while navigating
                        try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch (_) {}
                        // Build a smarter search path based on suggestion type
                        const params = new URLSearchParams()
                        if (type === 'location') {
                          params.set('location', v)
                        } else if (type === 'sub_category') {
                          params.set('filters', JSON.stringify({ sub_category: [v] }))
                        } else if (type === 'model') {
                          params.set('filters', JSON.stringify({ model: [v] }))
                        } else {
                          // default: keyword search
                          params.set('q', v)
                        }
                        navigate(`/search?${params.toString()}`)
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        color: 'var(--text)'
                      }}
                    >
                      <span>{label}</span>
                      {badge && (
                        <span className="pill" style={{ fontSize: 11 }}>
                          {badge}
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <button className="btn primary" type="submit">Search</button>
          </form>

          <div className="quick-cats" style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={`btn ${filterCategory === 'Vehicle' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Vehicle'); setShowFilters(true); }}>🚗 Vehicles</button>
            <button className={`btn ${filterCategory === 'Property' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Property'); setShowFilters(true); }}>🏠 Property</button>
            
            <button className={`btn ${filterCategory === 'Electronic' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Electronic'); setShowFilters(true); }}>🔌 Electronic</button>
            <button className={`btn ${filterCategory === 'Mobile' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Mobile'); setShowFilters(true); }}>📱 Mobile</button>
            <button className={`btn ${filterCategory === 'Home Garden' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Home Garden'); setShowFilters(true); }}>🏡 Home&nbsp;Garden</button>
          </div>
        </div>

        {/* Banner slider - hidden in ad‑free mode */}
        {!AD_FREE && visibleBanners.length > 0 && (
          <div style={{ padding: 18 }}>
            <div className="grid three">
              {visibleBanners.map(b => (
                <div key={b.id} className="card" style={{ padding: 0 }}>
                  <img
                    src={b.url}
                    alt="Banner"
                    style={{
                      width: '100%',
                      height: 180,
                      objectFit: 'cover',
                      borderRadius: 12
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        
        {/* Suggested for you - horizontal grid */}
        <div style={{ padding: 18 }}>
          <div className="h2" style={{ marginTop: 0 }}>Suggested for you</div>
          <div className="card sug-wrap">
            <div ref={suggestedRef} className="hide-scroll" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <div className="sug-row">
                {suggestedLoading && Array.from({ length: 8 }).map((_, i) => (
                  <div key={`sk-sug-${i}`} className="skeleton-card sug-card">
                    <div className="skeleton skeleton-img" />
                    <div className="skeleton skeleton-line" style={{ width: '60%', marginTop: 8 }} />
                    <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 6 }} />
                  </div>
                ))}
                {!suggestedLoading && suggested.slice(0, 10).map(item => {
                  const imgs = Array.isArray(item.small_images) ? item.small_images : []
                  const idx = cardSlideIndex[item.id] || 0
                  const hero = imgs.length ? imgs[idx % imgs.length] : (item.thumbnail_url || null)
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
                  return (
                    <div key={item.id} className="card sug-card" style={{ cursor: 'pointer' }} onClick={() => navigateOnce(permalinkForItem(item), item)}>
                      {hero && (
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <img
                            className="sug-img"
                            src={hero}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                            fetchpriority="low"
                            width={320}
                            height={180}
                            sizes="(max-width: 780px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            style={{ transition: 'opacity 160ms ease', opacity: 1 }}
                            onLoad={(e) => { try { e.currentTarget.style.opacity = '1' } catch (_) {} }}
                          />
                          {(item.is_urgent || item.urgent) && (
                            <span className="pill" style={{ position: 'absolute', top: 8, left: 8, background: 'linear-gradient(135deg, rgba(239,68,68,0.28), rgba(255,160,160,0.22))', border: '1px solid rgba(239,68,68,0.5)', color: '#fff', fontSize: 12, fontWeight: 700, boxShadow: '0 4px 12px rgba(239,68,68,0.25)' }}>Urgent</span>
                          )}
                          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, zIndex: 5 }}>
                            <button
                              className="btn"
                              type="button"
                              onClick={(e) => { e.stopPropagation(); prevImage(item) }}
                              aria-label="Previous image"
                              disabled={!(Array.isArray(imgs) && imgs.length > 1)}
                            >‹</button>
                            <button
                              className="btn"
                              type="button"
                              onClick={(e) => { e.stopPropagation(); nextImage(item) }}
                              aria-label="Next image"
                              disabled={!(Array.isArray(imgs) && imgs.length > 1)}
                            >›</button>
                          </div>
                        </div>
                      )}
                      <div className="text-muted" style={{ marginBottom: 6 }}>{item.main_category}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div className="h2" style={{ margin: 0 }}>{item.title}</div>
                        {item.price != null && (
                          <div style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700 }}>LKR {Number(item.price).toLocaleString('en-US')}</div>
                        )}
                      </div>
                      <div className="text-muted" style={{ marginTop: 4 }}>{item.location ? item.location : ''}{item.pricing_type ? ` • ${item.pricing_type}` : ''}</div>
                    </div>
                  )
                })}
              </div>
            </div>
            {/* Desktop nav buttons for suggested scroller */}
            {!isMobile && (
              <>
                <button
                  className="btn sug-nav sug-left"
                  type="button"
                  aria-label="Scroll suggestions left"
                  onClick={() => { const el = suggestedRef.current; if (el) el.scrollBy({ left: -(el.clientWidth * 0.85), behavior: 'smooth' }) }}
                >‹</button>
                <button
                  className="btn sug-nav sug-right"
                  type="button"
                  aria-label="Scroll suggestions right"
                  onClick={() => { const el = suggestedRef.current; if (el) el.scrollBy({ left: (el.clientWidth * 0.85), behavior: 'smooth' }) }}
                >›</button>
              </>
            )}
          </div>
          {/* Styles for suggested section */}
          <style>{`
            .sug-wrap { position: relative; padding: 12px; margin-top: 8px; border: 1px solid var(--border); box-shadow: 0 8px 24px var(--shadow); border-radius: 12px; background: linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.03)); }
            .sug-row { display: flex; gap: 16px; min-width: max-content; padding-bottom: 6px; }
            /* Match grid-three card width by using a third of the container minus gap */
            .sug-card { flex: 0 0 calc(33.333% - 12px); max-width: calc(33.333% - 12px); }
            /* Suggested card image default (desktop/tablet) */
            .sug-img { width: 100%; height: 180px; border-radius: 8px; object-fit: cover; display: block; }

            /* Mobile: one ad per view with swipe, no buttons, adjust image fit */
            @media (max-width: 780px) {
              .sug-wrap .hide-scroll { overscroll-behavior-x: contain; scroll-padding-left: 12px; scroll-padding-right: 12px; }
              .sug-row { scroll-snap-type: x mandatory; gap: 12px; min-width: auto; }
              .sug-card { flex: 0 0 calc(100% - 12px); max-width: calc(100% - 12px); scroll-snap-align: start; }
              .sug-nav { display: none; }
              /* Use aspect-ratio to keep images proportionate across device widths */
              .sug-img { height: auto; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; }
            }

            /* Desktop nav buttons */
            .sug-nav { position: absolute; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: linear-gradient(135deg, rgba(255,255,255,0.30), rgba(255,255,255,0.14)); color: #0a0f1e; border: 1px solid rgba(255,255,255,0.45); outline: none; box-sizing: border-box; cursor: pointer; backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); box-shadow: 0 10px 30px rgba(0,0,0,0.28), inset 0 1px 1px rgba(255,255,255,0.45); -webkit-tap-highlight-color: transparent; user-select: none; }
            /* Prevent "jump" on press by locking transform and border on interactive states */
            .sug-nav:hover,
            .sug-nav:active,
            .sug-nav:focus,
            .sug-nav:focus-visible { transform: translateY(-50%); border-width: 1px; outline: none; }
            .sug-left { left: 8px; }
            .sug-right { right: 8px; }
          `}</style>
        </div>

        <div style={{ padding: 18 }}>
          <div className="h2" style={{ marginTop: 0 }}>{filterCategory ? `${filterCategory} listings` : 'Latest listings'}</div>

          {/* Filters dropdown toggle */}
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              {hasActiveFilters && (
                <button className="btn compact" type="button" onClick={resetHomeFilters} title="Reset all filters" style={{ flex: '0 0 auto' }}>
                  Reset filters
                </button>
              )}
            </div>
            <div>
              <button className="btn" type="button" onClick={() => setShowFilters(s => !s)}>
                {showFilters ? 'Hide Filters' : 'Filters'}
              </button>
            </div>
          </div>

          {showFilters && (
            <div className="card" style={{ padding: 12, marginBottom: 12 }}>
              <div className="grid two">
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Category</div>
                  <CustomSelect
                    value={filterCategory}
                    onChange={v => setFilterCategory(v)}
                    ariaLabel="Category"
                    placeholder="Category"
                    options={[
                      { value: '', label: 'Any' },
                      { value: 'Vehicle', label: 'Vehicle' },
                      { value: 'Property', label: 'Property' },
                      { value: 'Electronic', label: 'Electronic' },
                      { value: 'Mobile', label: 'Mobile' },
                      { value: 'Home Garden', label: 'Home Garden' },
                    ]}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                </div>
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Location</div>
                  <CustomSelect
                    value={filterLocation}
                    onChange={v => setFilterLocation(v)}
                    ariaLabel="Location"
                    placeholder="Location"
                    options={(() => {
                      // Build from stable cache so options don't shrink to only current filtered results
                      const cached = Array.from(new Set((locationOptionsCache || []).map(v => String(v).trim()).filter(Boolean)))
                      const fromSuggest = Array.from(new Set((locSuggestions || []).map(v => String(v).trim()).filter(Boolean)))
                        .filter(v => !cached.includes(v))
                      const merged = [...cached, ...fromSuggest]
                      const opts = merged.map(v => ({ value: v, label: v }))
                      return [{ value: '', label: 'Any' }, ...opts]
                    })()}
                    searchable={true}
                    allowCustom={true}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                  {/* Geolocation button to auto-fill nearest district */}
                  <div style={{ marginTop: 6 }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        try {
                          setStatus('')
                          if (!('geolocation' in navigator)) { setStatus('Geolocation not supported on this device.'); return }
                          navigator.geolocation.getCurrentPosition(async (pos) => {
                            try {
                              const { latitude, longitude } = pos.coords
                              const url = `https://nominatim.openstreetmap.org/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&format=json`
                              const r = await fetch(url, { headers: { 'Accept': 'application/json' } })
                              const data = await r.json().catch(() => ({}))
                              const district = String(
                                data?.address?.state_district ||
                                data?.address?.county ||
                                data?.address?.state ||
                                data?.address?.city ||
                                data?.address?.town ||
                                data?.address?.suburb ||
                                ''
                              ).trim()
                              if (district) {
                                setFilterLocation(district)
                                setLocQuery(district)
                                setStatus(`Location set to: ${district}`)
                              } else {
                                setStatus('Could not determine district from location.')
                              }
                            } catch (e) {
                              setStatus(`Failed to detect location: ${e.message}`)
                            }
                          }, (err) => {
                            setStatus('Geolocation permission denied or failed.')
                          }, { timeout: 8000 })
                        } catch (e) {
                          setStatus('Geolocation error.')
                        }
                      }}
                    >
                      Use my location
                    </button>
                  </div>
                </div>
                <input className="input" type="number" placeholder="Min price" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value)} />
                <input className="input" type="number" placeholder="Max price" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value)} />

                {/* Dynamic sub_category/model tag inputs + other keys */}
                {filterCategory && filtersDef.keys.length > 0 && (
                  <>
                    {/* Sub-category multi-select tags */}
                    <div>
                      <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Sub-category</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        {subCategorySelected.map((tag, idx) => (
                          <span key={`subcat-${tag}-${idx}`} className="pill">
                            {tag}
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                const next = subCategorySelected.filter((t, i) => !(t === tag && i === idx))
                                updateFilter('sub_category', next)
                              }}
                              aria-label="Remove"
                              style={{ padding: '2px 6px', marginLeft: 6 }}
                            >✕</button>
                          </span>
                        ))}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <CustomSelect
                          value=""
                          onChange={(val) => {
                            const v = String(val || '').trim()
                            if (!v) return
                            const next = Array.from(new Set([...subCategorySelected, v]))
                            updateFilter('sub_category', next)
                          }}
                          ariaLabel="Add sub-category"
                          placeholder="Add sub-category..."
                          options={subCategoryOptions.map(v => ({ value: v, label: v }))}
                          searchable={true}
                          allowCustom={true}
                          virtualized={true}
                          maxDropdownHeight={420}
                        />
                      </div>
                    </div>

                    {/* Model multi-select tags */}
                    <div>
                      <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Model</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                        {modelSelected.map((tag, idx) => (
                          <span key={`model-${tag}-${idx}`} className="pill">
                            {tag}
                            <button
                              type="button"
                              className="btn"
                              onClick={() => {
                                const next = modelSelected.filter((t, i) => !(t === tag && i === idx))
                                updateFilter('model', next)
                              }}
                              aria-label="Remove"
                              style={{ padding: '2px 6px', marginLeft: 6 }}
                            >✕</button>
                          </span>
                        ))}
                      </div>
                      <div style={{ marginTop: 4 }}>
                        <CustomSelect
                          value=""
                          onChange={(val) => {
                            const v = String(val || '').trim()
                            if (!v) return
                            const next = Array.from(new Set([...modelSelected, v]))
                            updateFilter('model', next)
                          }}
                          ariaLabel="Add model"
                          placeholder="Add model..."
                          options={modelOptions.map(v => ({ value: v, label: v }))}
                          searchable={true}
                          allowCustom={true}
                          virtualized={true}
                          maxDropdownHeight={420}
                        />
                      </div>
                    </div>

                    {/* Other dynamic keys as selects */}
                    {(() => {
                      const pretty = (k) => {
                        if (!k) return '';
                        const map = {
                          manufacture_year: 'Manufacture Year',
                          pricing_type: 'Pricing',
                        };
                        if (map[k]) return map[k];
                        return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
                      };
                      return filtersDef.keys
                        .filter(k => !['location','pricing_type','price','sub_category','model','model_name','mileage_km'].includes(k))
                        .map(key => {
                          const values = (filtersDef.valuesByKey[key] || []).map(v => String(v));
                          const opts = [{ value: '', label: 'Any' }, ...values.map(v => ({ value: v, label: v }))];
                          return (
                            <div key={key}>
                              <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>{pretty(key)}</div>
                              <CustomSelect
                                value={filters[key] || ''}
                                onChange={val => updateFilter(key, val)}
                                ariaLabel={key}
                                placeholder={pretty(key)}
                                options={opts}
                                searchable={true}
                                virtualized={true}
                                maxDropdownHeight={420}
                              />
                            </div>
                          );
                        });
                    })()}
                  </>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="btn accent compact" type="button" onClick={() => fetchFilteredListings()} style={{ flex: '0 0 auto' }}>
                    Apply
                  </button>
                  <button className="btn compact" type="button" onClick={resetHomeFilters} style={{ flex: '0 0 auto' }}>
                    Reset
                  </button>
                  {/* Save this search */}
                  <button
                    className="btn"
                    type="button"
                    title="Save this search and get alerts"
                    onClick={async () => {
                      try {
                        const user = JSON.parse(localStorage.getItem('user') || 'null')
                        const email = user?.email || ''
                        if (!email) { setStatus('Please login to save searches.'); return }
                        const body = {
                          name: `${filterCategory || 'Any'} search`,
                          category: filterCategory || '',
                          location: filterLocation || '',
                          price_min: filterPriceMin || '',
                          price_max: filterPriceMax || '',
                          filters
                        }
                        const r = await fetch('/api/notifications/saved-searches', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', 'X-User-Email': email },
                          body: JSON.stringify(body)
                        })
                        const data = await r.json().catch(() => ({}))
                        if (!r.ok) throw new Error(data.error || 'Failed to save search')
                        setStatus('Search saved. You will be notified when new matching listings appear.')
                      } catch (e) {
                        setStatus(`Error: ${e.message}`)
                      }
                    }}
                  >
                    Save this search
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sort selector - below filters, right corner */}
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <div style={{ width: 240 }}>
              <CustomSelect
                value={sort}
                onChange={v => { setSort(v); fetchFilteredListings(v) }}
                ariaLabel="Sort"
                placeholder="Sort"
                options={[
                  { value: 'latest', label: 'Latest' },
                  { value: 'views_desc', label: 'Most Viewed' },
                  { value: 'favorites_desc', label: 'Most Favorites' },
                  { value: 'price_desc', label: 'Price: High to Low' },
                  { value: 'price_asc', label: 'Price: Low to High' },
                ]}
              />
            </div>
          </div>

          {(() => {
            const baseList = filterCategory ? latest.filter(it => (it.main_category || '') === filterCategory) : latest
            const displayList = baseList.filter(it => (it.main_category || '') !== 'Job')
            return (
              <div className="grid three">
                {/* Skeletons while loading */}
                {loading && Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-${i}`} className="skeleton-card">
                    <div className="skeleton skeleton-img" />
                    <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 10 }} />
                    <div className="skeleton skeleton-line" style={{ width: '75%', marginTop: 6 }} />
                    <div className="skeleton skeleton-line" style={{ width: '60%', marginTop: 6 }} />
                  </div>
                ))}
                {!loading && displayList.map(item => {
                  // Background: keep expires calculation (not shown to user)
                  let expires = ''
                  try {
                    if (item.valid_until) {
                      const diff = new Date(item.valid_until).getTime() - Date.now()
                      const days = Math.max(0, Math.ceil(diff / (1000*60*60*24)))
                      expires = `Expires in ${days} day${days === 1 ? '' : 's'}`
                    }
                  } catch (_) {}

                  // Age label from created_at: minutes in first hour, then hours, then days
                  let ageStr = ''
                  try {
                    if (item.created_at) {
                      const created = new Date(item.created_at)
                      const diffMs = Date.now() - created.getTime()
                      const mins = Math.max(0, Math.floor(diffMs / 60000))
                      if (mins < 60) {
                        ageStr = `${mins} min${mins === 1 ? '' : 's'} ago`
                      } else {
                        const hours = Math.floor(mins / 60)
                        if (hours < 24) {
                          ageStr = `${hours} hour${hours === 1 ? '' : 's'} ago`
                        } else {
                          const days = Math.floor(hours / 24)
                          ageStr = `${days} day${days === 1 ? '' : 's'} ago`
                        }
                      }
                    }
                  } catch (_) {}

                  const imgs = Array.isArray(item.small_images) ? item.small_images : []
                  const idx = cardSlideIndex[item.id] || 0
                  const hero = imgs.length ? imgs[idx % imgs.length] : (item.thumbnail_url || null)

                  function makeSlug(s) {
                    const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    return base || 'listing';
                  }
                  function permalinkForItem(it) {
                    const titleSlug = makeSlug(it.title || '');
                    // Try to include year from structured_json if present
                    let year = '';
                    try {
                      const sj = JSON.parse(it.structured_json || '{}');
                      const y = sj.manufacture_year || sj.year || sj.model_year || null;
                      if (y) year = String(y);
                    } catch (_) {}
                    const idCode = Number(it.id).toString(36).toUpperCase(); // short alphanumeric
                    const parts = [titleSlug, year, idCode].filter(Boolean);
                    return `/listing/${it.id}-${parts.join('-')}`;
                  }
                  return (
                    <div key={item.id} className="card" onClick={() => navigateOnce(permalinkForItem(item), item)} style={{ cursor: 'pointer' }}>
                      {/* Small image slider */}
                      {hero && (
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <img
                            src={hero}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                            fetchpriority="low"
                            sizes="(max-width: 780px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            style={{ width: '100%', borderRadius: 8, objectFit: 'cover', height: 170, transition: 'opacity 160ms ease', opacity: 1 }}
                            width={320}
                            height={170}
                            onLoad={(e) => { try { e.currentTarget.style.opacity = '1' } catch (_) {} }}
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
                              Urgent
                            </span>
                          )}
                          <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6, zIndex: 5 }}>
                            <button
                              className="btn"
                              type="button"
                              onClick={(e) => { e.stopPropagation(); prevImage(item) }}
                              aria-label="Previous image"
                              disabled={!(Array.isArray(imgs) && imgs.length > 1)}
                            >‹</button>
                            <button
                              className="btn"
                              type="button"
                              onClick={(e) => { e.stopPropagation(); nextImage(item) }}
                              aria-label="Next image"
                              disabled={!(Array.isArray(imgs) && imgs.length > 1)}
                            >›</button>
                          </div>
                        </div>
                      )}
                      <div className="text-muted" style={{ marginBottom: 6 }}>{item.main_category}</div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                        <div className="h2" style={{ marginTop: 0, marginBottom: 0 }}>{item.title}</div>
                        {item.price != null && (
                          <div style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700 }}>
                            {`LKR ${Number(item.price).toLocaleString('en-US')}`}
                          </div>
                        )}
                      </div>
                      <div className="text-muted" style={{ marginBottom: 6, marginTop: 4 }}>
                        {item.location ? item.location : ''}
                        {item.pricing_type ? ` • ${item.pricing_type}` : ''}
                        {ageStr ? ` • ${ageStr}` : ''}
                      </div>
                      
                    </div>
                  )
                })}
                {!loading && displayList.length === 0 && (
                  <div className="card">
                    <div className="h2" style={{ marginTop: 0 }}>No listings match your filters</div>
                    <ul className="text-muted" style={{ marginTop: 6 }}>
                      <li>Try removing some filters</li>
                      <li>Try a different location</li>
                      <li><Link to="/new" style={{ color: 'var(--accent)' }}>Post your first ad</Link></li>
                    </ul>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Pagination */}
          <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn page" onClick={() => setPage(Math.max(1, page - 1))} aria-label="Previous page">‹ Prev</button>
            {pageWindow.map(p => (
              <button
                key={p}
                className={`btn page ${p === page ? 'primary' : ''}`}
                onClick={() => setPage(p)}
                aria-label={`Go to page ${p}`}
              >
                {p}
              </button>
            ))}
            <button className="btn page" onClick={() => setPage(page + 1)} aria-label="Next page">Next ›</button>
          </div>

          {status && <p style={{ marginTop: 8 }}>{status}</p>}
        </div>
      </div>

      {/* Standalone Feature section (separate from main card) */}
      <section style={{ marginTop: 18 }}>
        <div style={{ margin: '0 auto', maxWidth: 1000 }}>
          <div className="h2" style={{ marginTop: 0, textAlign: 'center' }}>{t('features.sectionTitle')}</div>
        </div>

        {/* Feature mini-cards - horizontal slider with floating nav buttons and hidden scrollbar */}
        <div style={{ position: 'relative', marginTop: 12 }}>
          <div
            ref={featureRef}
            className="hide-scroll"
            style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
          >
            <div style={{ display: 'flex', gap: 12, paddingBottom: 6, minWidth: 'max-content' }}>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.aiCategoriesTitle')}
                </div>
                <div className="text-muted">
                  {t('features.aiCategoriesDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.aiDescriptionsTitle')}
                </div>
                <div className="text-muted">
                  {t('features.aiDescriptionsDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.advancedFiltersTitle')}
                </div>
                <div className="text-muted">
                  {t('features.advancedFiltersDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.futuristicUiTitle')}
                </div>
                <div className="text-muted">
                  {t('features.futuristicUiDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.sriLankanTitle')}
                </div>
                <div className="text-muted">
                  {t('features.sriLankanDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.lowCostTitle')}
                </div>
                <div className="text-muted">
                  {t('features.lowCostDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.autoFacebookTitle')}
                </div>
                <div className="text-muted">
                  {t('features.autoFacebookDesc')}
                </div>
              </div>
              <div className="card" style={{ minWidth: 180 }}>
                <div className="h2" style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('features.allInOneTitle')}
                </div>
                <div className="text-muted">
                  {t('features.allInOneDesc')}
                </div>
              </div>
            </div>
          </div>

          {/* Glass-morphism sliding buttons */}
          {!isMobile && (
            <>
              <button
                className="btn feature-nav"
                type="button"
                aria-label="Scroll features left"
                onClick={() => { const el = featureRef.current; if (el) el.scrollBy({ left: -300, behavior: 'smooth' }) }}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: 10,
                  transform: 'translateY(-50%)',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.30), rgba(255,255,255,0.14))',
                  color: '#0a0f1e',
                  border: '1px solid rgba(255,255,255,0.45)',
                  outline: '1px solid rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.28), inset 0 1px 1px rgba(255,255,255,0.45)',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, background 150ms ease'
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(-50%) scale(0.96)'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,0,0,0.24), inset 0 1px 1px rgba(255,255,255,0.45)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.28), inset 0 1px 1px rgba(255,255,255,0.45)'; }}
              >‹</button>
              <button
                className="btn feature-nav"
                type="button"
                aria-label="Scroll features right"
                onClick={() => { const el = featureRef.current; if (el) el.scrollBy({ left: 300, behavior: 'smooth' }) }}
                style={{
                  position: 'absolute',
                  top: '50%',
                  right: 10,
                  transform: 'translateY(-50%)',
                  borderRadius: '50%',
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.30), rgba(255,255,255,0.14))',
                  color: '#0a0f1e',
                  border: '1px solid rgba(255,255,255,0.45)',
                  outline: '1px solid rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(16px)',
                  WebkitBackdropFilter: 'blur(16px)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.28), inset 0 1px 1px rgba(255,255,255,0.45)',
                  transition: 'transform 150ms ease, box-shadow 150ms ease, background 150ms ease'
                }}
                onMouseDown={(e) => { e.currentTarget.style.transform = 'translateY(-50%) scale(0.96)'; e.currentTarget.style.boxShadow = '0 6px 22px rgba(0,0,0,0.24), inset 0 1px 1px rgba(255,255,255,0.45)'; }}
                onMouseUp={(e) => { e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; e.currentTarget.style.boxShadow = '0 10px 30px rgba(0,0,0,0.28), inset 0 1px 1px rgba(255,255,255,0.45)'; }}
              >›</button>
            </>
          )}

          {/* Hide scrollbar styling */}
          <style>{`
            .hide-scroll { scrollbar-width: none; -ms-overflow-style: none; }
            .hide-scroll::-webkit-scrollbar { display: none; }
          `}</style>
        </div>
      </section>

      {/* Floating CTA: Post your first ad */}
      {(() => {
        const [show, setShow] = [true, () => {}]; // statically visible for eye-catching CTA
        return (
          <div
            role="dialog"
            aria-live="polite"
            style={{
              position: 'fixed',
              left: '50%',
              bottom: 22,
              transform: 'translateX(-50%)',
              zIndex: 1100,
              pointerEvents: 'none'
            }}
          >
            <div
              className="card"
              role="button"
              tabIndex={0}
              onClick={() => navigate('/new')}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/new'); } }}
              style={{
                pointerEvents: 'auto',
                display: show ? 'flex' : 'none',
                alignItems: 'center',
                gap: 12,
                padding: '10px 14px',
                borderRadius: 16,
                boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                background:
                  'radial-gradient(300px 120px at 20% 0%, rgba(108,127,247,0.25), transparent 60%), ' +
                  'radial-gradient(300px 120px at 80% 100%, rgba(0,209,255,0.25), transparent 60%), ' +
                  'linear-gradient(180deg, rgba(29,35,48,0.98), rgba(29,35,48,0.92))',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.06)',
                animation: 'cta-pop 0.6s ease-out',
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, textAlign: 'center' }}>
                <button
                  className="btn primary"
                  onClick={() => navigate('/new')}
                  aria-label="Post your first ad"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: '50%',
                    padding: 0,
                    fontSize: 18,
                    display: 'grid',
                    placeItems: 'center',
                    background:
                      'radial-gradient(120px 80px at 30% 0%, rgba(255,255,255,0.25), transparent 60%), ' +
                      '#6c7ff7',
                    boxShadow: '0 10px 25px rgba(108,127,247,0.55)',
                    position: 'relative',
                    overflow: 'visible'
                  }}
                  title="Post an ad"
                >
                  +
                  <span
                    aria-hidden="true"
                    style={{
                      content: '""',
                      position: 'absolute',
                      inset: -6,
                      borderRadius: '50%',
                      boxShadow: '0 0 0 0 rgba(108,127,247,0.6)',
                      animation: 'pulse 1.6s ease-out infinite'
                    }}
                  />
                </button>
                <div style={{ fontWeight: 700, fontSize: 12 }}>Start making money</div>
              </div>
              <style>{`
                @keyframes pulse {
                  0% { box-shadow: 0 0 0 0 rgba(108,127,247,0.6); }
                  70% { box-shadow: 0 0 0 12px rgba(108,127,247,0); }
                  100% { box-shadow: 0 0 0 0 rgba(108,127,247,0); }
                }
                @keyframes cta-pop {
                  0% { transform: translateY(20px) scale(0.96); opacity: 0; }
                  100% { transform: translateY(0) scale(1); opacity: 1; }
                }
              `}</style>
            </div>
          </div>
        );
      })()}

      {/* Bottom-right chat widget (homepage) */}
      <ChatWidget />

      {/* Mobile sticky reset/filter action bar */}
      {hasActiveFilters && (
        <div className="mobile-actionbar" aria-label="Filter actions">
          <button className="btn" type="button" onClick={resetHomeFilters} title="Reset all filters">Reset filters</button>
          <button className="btn" type="button" onClick={() => setShowFilters(s => !s)}>
            {showFilters ? 'Hide Filters' : 'Filters'}
          </button>
        </div>
      )}
    </div>
  )
}
