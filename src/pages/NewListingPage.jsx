import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import CustomSelect from '../components/CustomSelect.jsx'
import { useI18n } from '../components/i18n.jsx'

export default function NewListingPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [sp] = useSearchParams()
  const [mainCategory, setMainCategory] = useState('Vehicle')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  // Store images in fixed-size array of File|null according to maxImages
  const [images, setImages] = useState([])
  const [status, setStatus] = useState(null)
  const [showAuthPrompt, setShowAuthPrompt] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [progressIdx, setProgressIdx] = useState(0)
  const progressPhrases = useMemo(() => ([
    'Thinking…',
    'Analyzing title…',
    'Extracting key details…',
    'Generating summary…',
    'Optimizing your photos…',
    'Estimating price signals…',
    'Calibrating categories…',
    'Structuring data…',
    'Finalizing draft…'
  ]), [])
  useEffect(() => {
    if (!processing) { setProgressIdx(0); return }
    const id = setInterval(() => {
      setProgressIdx(i => (i + 1) % progressPhrases.length)
    }, 1200)
    return () => clearInterval(id)
  }, [processing, progressPhrases])

  // Tag Wanted Requests (optional; max 3)
  const [wantedTags, setWantedTags] = useState([]) // [{id, title}]
  const [allWanted, setAllWanted] = useState([])   // suggestions pool
  const [wantedQuery, setWantedQuery] = useState('')
  const [wantedSelectId, setWantedSelectId] = useState('')

  // SEO for new listing page
  useEffect(() => {
    try {
      const titleText = 'Create New Listing — Ganudenu Marketplace'
      const descText = 'Post your ad in minutes. Upload photos and describe your vehicle, property, job, electronics, mobile, or home & garden listing.'
      document.title = titleText
      const setMeta = (name, content) => {
        let tag = document.querySelector(`meta[name="${name}"]`)
        if (!tag) { tag = document.createElement('meta'); tag.setAttribute('name', name); document.head.appendChild(tag) }
        tag.setAttribute('content', content)
      }
      const setProp = (property, content) => {
        let tag = document.querySelector(`meta[property="${property}"]`)
        if (!tag) { tag = document.createElement('meta'); tag.setAttribute('property', property); document.head.appendChild(tag) }
        tag.setAttribute('content', content)
      }
      let link = document.querySelector('link[rel="canonical"]')
      if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link) }
      link.setAttribute('href', 'https://ganudenu.store/new')
      setMeta('description', descText)
      setProp('og:title', titleText)
      setProp('og:description', descText)
      setProp('og:url', link.getAttribute('href'))
      setMeta('twitter:title', titleText)
      setMeta('twitter:description', descText)
    } catch (_) {}
  }, [])

  const hiddenFileInput = useRef(null)
  const pendingSlotRef = useRef(null)

  const maxImages = useMemo(() => {
    if (mainCategory === 'Job') return 1
    if (mainCategory === 'Mobile' || mainCategory === 'Electronic' || mainCategory === 'Home Garden') return 4
    return 5
  }, [mainCategory])

  // Initialize/resize image slots whenever category changes
  useEffect(() => {
    setImages(prev => {
      const arr = Array.from({ length: maxImages }, (_, i) => prev[i] || null)
      return arr
    })
  }, [maxImages])

  // Require login
  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      if (!user || !user.email) {
        setShowAuthPrompt(true)
      }
    } catch (_) {
      setShowAuthPrompt(true)
    }
  }, [])

  // Draft autosave
  useEffect(() => {
    try {
      const raw = localStorage.getItem('new_listing_draft')
      if (raw) {
        const d = JSON.parse(raw)
        if (d && typeof d === 'object') {
          if (d.mainCategory) setMainCategory(d.mainCategory)
          if (d.title) setTitle(d.title)
          if (d.description) setDescription(d.description)
        }
      }
    } catch (_) {}
  }, [])
  useEffect(() => {
    const data = { mainCategory, title, description }
    try { localStorage.setItem('new_listing_draft', JSON.stringify(data)) } catch (_) {}
  }, [mainCategory, title, description])

  // Preselect category and tagWantedId from query params
  useEffect(() => {
    const cat = sp.get('category')
    if (cat && ['Vehicle', 'Property', 'Job', 'Electronic', 'Mobile', 'Home Garden'].includes(cat)) {
      setMainCategory(cat)
    }
  }, [sp])

  // Load open wanted requests for suggestions
  useEffect(() => {
    async function loadWanted() {
      try {
        const r = await fetch('/api/wanted?limit=200')
        const data = await r.json()
        const rows = Array.isArray(data.results) ? data.results : []
        setAllWanted(rows)
        // Preselect tag from URL if present
        const tidRaw = sp.get('tagWantedId')
        const tid = tidRaw ? Number(tidRaw) : null
        if (Number.isFinite(tid)) {
          const found = rows.find(x => Number(x.id) === tid)
          if (found) {
            setWantedTags(prev => {
              const exists = prev.some(t => t.id === found.id)
              if (exists) return prev
              if (prev.length >= 3) return prev
              return [...prev, { id: found.id, title: found.title }]
            })
          }
        }
      } catch (_) {
        setAllWanted([])
      }
    }
    loadWanted()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist selected tags locally (so verify page can read if needed)
  useEffect(() => {
    try {
      const ids = wantedTags.map(t => t.id)
      localStorage.setItem('new_listing_tag_wanted_ids', JSON.stringify(ids))
    } catch (_) {}
  }, [wantedTags])

  function openPickerForSlot(index) {
    pendingSlotRef.current = index
    hiddenFileInput.current?.click()
  }

  function onHiddenFileChange(e) {
    const file = (e.target.files && e.target.files[0]) || null
    e.target.value = ''
    if (!file) return

    if (file.size > 5 * 1024 * 1024) {
      setStatus(`File ${file.name} exceeds 5MB limit.`)
      return
    }
    setStatus(null)

    const idx = pendingSlotRef.current ?? 0
    setImages(prev => {
      const next = [...prev]
      next[idx] = file
      return next
    })
  }

  function clearSlot(index) {
    setImages(prev => {
      const next = [...prev]
      next[index] = null
      return next
    })
  }

  function addWantedTagById(id) {
    const nid = Number(id)
    if (!Number.isFinite(nid)) return
    setWantedTags(prev => {
      if (prev.some(t => t.id === nid)) return prev
      if (prev.length >= 3) { setStatus('You can tag up to 3 requests.'); return prev }
      const found = allWanted.find(x => Number(x.id) === nid)
      if (!found) return prev
      return [...prev, { id: found.id, title: found.title }]
    })
    setWantedSelectId('')
  }

  function removeWantedTag(id) {
    setWantedTags(prev => prev.filter(t => t.id !== id))
  }

  async function onNext(e) {
    e.preventDefault()
    // block when not logged in
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      if (!user || !user.email) {
        setShowAuthPrompt(true)
        setStatus('Please login to continue.')
        return
      }
    } catch (_) {
      setShowAuthPrompt(true)
      setStatus('Please login to continue.')
      return
    }

    if (!title.trim() || !description.trim()) {
      setStatus('Title and description are required.')
      return
    }
    const selectedImages = images.filter(Boolean)
    if (selectedImages.length < 1) {
      setStatus('At least 1 image is required.')
      return
    }

    try {
      setProcessing(true)
      const fd = new FormData()
      fd.append('main_category', mainCategory)
      fd.append('title', title.trim())
      fd.append('description', description.trim())
      for (const img of selectedImages) fd.append('images', img)
      // include tag wanted ids (max 3) for server to persist on draft
      try {
        const ids = wantedTags.map(t => t.id).slice(0, 3)
        fd.append('wanted_tags_json', JSON.stringify(ids))
      } catch (_) {}

      const user = JSON.parse(localStorage.getItem('user') || 'null')
      const r = await fetch('/api/listings/draft', {
        method: 'POST',
        headers: user?.email ? { 'X-User-Email': user.email } : undefined,
        body: fd
      })
      const ct = r.headers.get('content-type') || ''
      const text = await r.text()
      const data = ct.includes('application/json') && text ? JSON.parse(text) : {}
      if (!r.ok) {
        setProcessing(false)
        setStatus((data && data.error) || 'Failed to create draft.')
        return
      }
      // clear autosave after successful draft
      try { localStorage.removeItem('new_listing_draft') } catch (_) {}
      navigate(`/verify?draftId=${encodeURIComponent(data.draftId)}`)
    } catch (e) {
      setProcessing(false)
      setStatus('Network error.')
    }
  }

  const helperText = useMemo(() => {
    if (mainCategory === 'Job') return t('newListing.helperJob')
    if (mainCategory === 'Mobile' || mainCategory === 'Electronic' || mainCategory === 'Home Garden') {
      return t('newListing.helperSimple')
    }
    return t('newListing.helperDefault')
  }, [mainCategory, t])

  // Render grid of image slots with + for empty
  function ImageSlots() {
    return (
      <div>
        <input
          ref={hiddenFileInput}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={onHiddenFileChange}
        />
        <div className="grid five" style={{ gap: 10 }}>
          {images.map((file, i) => {
            const hasFile = !!file
            const url = hasFile ? URL.createObjectURL(file) : null
            return (
              <div key={i} className="card" style={{ padding: 0, position: 'relative', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} onClick={() => openPickerForSlot(i)}>
                {hasFile ? (
                  <>
                    <img
                      src={url}
                      alt={`image-${i + 1}`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
                      onLoad={() => url && URL.revokeObjectURL(url)}
                    />
                    <button
                      type="button"
                      className="btn"
                      onClick={(e) => { e.stopPropagation(); clearSlot(i) }}
                      style={{ position: 'absolute', top: 6, right: 6 }}
                      aria-label="Remove image"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <div className="text-muted" style={{ fontSize: 28 }}>+</div>
                )}
              </div>
            )
          })}
        </div>
        <div className="text-muted" style={{ marginTop: 6 }}>
          {images.filter(Boolean).length}/{maxImages} selected
        </div>
      </div>
    )
  }

  // Derived filtered suggestions by query and category (when available)
  const filteredWanted = useMemo(() => {
    const q = wantedQuery.trim().toLowerCase()
    return allWanted
      .filter(w => String(w.status || '') === 'open')
      .filter(w => (q ? String(w.title || '').toLowerCase().includes(q) : true))
      .filter(w => (mainCategory ? (!w.category || w.category === mainCategory) : true))
      .slice(0, 50)
  }, [allWanted, wantedQuery, mainCategory])

  return (
    <div className="center">
      <div className="card">
        <div className="h1">{t('newListing.title')}</div>
        <p className="text-muted">{helperText}</p>

        <form onSubmit={onNext} className="grid two">
          <CustomSelect
            value={mainCategory}
            onChange={v => setMainCategory(String(v || 'Vehicle'))}
            ariaLabel="Main category"
            placeholder="Main category"
            options={[
              { value: 'Vehicle', label: 'Vehicle' },
              { value: 'Property', label: 'Property' },
              { value: 'Job', label: 'Job' },
              { value: 'Electronic', label: 'Electronic' },
              { value: 'Mobile', label: 'Mobile' },
              { value: 'Home Garden', label: 'Home &amp; Garden' },
            ]}
            searchable={true}
            virtualized={true}
            maxDropdownHeight={420}
          />
          <input id="title" className="input" placeholder="Main Title" value={title} onChange={e => setTitle(e.target.value)} />
          <textarea id="description" className="textarea" placeholder="Description (free-form text)" value={description} onChange={e => setDescription(e.target.value)} />

          {/* Tag buyer requests (optional) */}
          <div className="card" style={{ marginTop: 8 }}>
            <div className="h2" style={{ marginTop: 0 }}>
              {mainCategory === 'Job' ? t('newListing.talentRequests') : t('newListing.buyerRequests')}
            </div>
            {mainCategory === 'Job' ? (
              <p className="text-muted">{t('newListing.talentInfo')}</p>
            ) : (
              <p className="text-muted">{t('newListing.buyerInfo')}</p>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <input
                className="input"
                placeholder={t('newListing.searchRequestsPlaceholder')}
                value={wantedQuery}
                onChange={e => setWantedQuery(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <div style={{ minWidth: 260, flex: '0 0 260px' }}>
                <CustomSelect
                  value={wantedSelectId}
                  onChange={v => setWantedSelectId(String(v || ''))}
                  ariaLabel={t('newListing.pickRequest')}
                  placeholder={t('newListing.pickRequest')}
                  options={[
                    { value: '', label: t('newListing.pickRequest') },
                    ...filteredWanted.map(w => ({ value: String(w.id), label: w.title }))
                  ]}
                  searchable={true}
                  virtualized={true}
                  maxDropdownHeight={420}
                />
              </div>
              <button
                className="btn"
                type="button"
                onClick={() => addWantedTagById(wantedSelectId)}
                disabled={!wantedSelectId || wantedTags.length >= 3}
              >
                {t('common.add')}
              </button>
            </div>
            {wantedTags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {wantedTags.map(t => (
                  <span key={t.id} className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {t.title}
                    <button
                      type="button"
                      className="back-btn"
                      onClick={() => removeWantedTag(t.id)}
                      title="Remove tag"
                      aria-label="Remove tag"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="text-muted" style={{ marginTop: 6 }}>
              {wantedTags.length}/3 tagged
            </div>
          </div>

          <div>
            <div className="h2" style={{ marginTop: 0 }}>{t('newListing.photos')}</div>
            <ImageSlots />
          </div>

          <div>
            <button className="btn primary" type="submit">{t('common.continue')}</button>
          </div>
        </form>

        {status && <p style={{ marginTop: 8 }}>{status}</p>}
      </div>

      {showAuthPrompt && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div className="card" style={{ maxWidth: 420 }}>
            <div className="h2" style={{ marginTop: 0 }}>{t('auth.loginRequired')}</div>
            <p className="text-muted">{t('auth.loginRequiredMessage')}</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn primary" onClick={() => navigate('/auth')}>{t('auth.goToLogin')}</button>
            </div>
          </div>
        </div>
      )}

      {processing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div className="card" style={{ maxWidth: 460, textAlign: 'center', paddingBottom: 18 }}>
            <div className="h2" style={{ marginTop: 0 }}>{t('newListing.processing') || 'Processing your listing'}</div>
            <p className="text-muted" aria-live="polite" aria-atomic="true">
              {progressPhrases[progressIdx]}
            </p>

            {/* Spinner */}
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
              <div
                aria-hidden="true"
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  border: '4px solid rgba(108,127,247,0.2)',
                  borderTopColor: '#6c7ff7',
                  animation: 'spin 1s linear infinite'
                }}
              />
            </div>

            {/* Animated progress bar */}
            <div style={{ marginTop: 16, width: '100%', padding: '0 8px' }}>
              <div style={{ height: 6, background: 'rgba(108,127,247,0.15)', borderRadius: 999 }}>
                <div
                  style={{
                    height: 6,
                    width: `${((progressIdx + 1) / progressPhrases.length) * 100}%`,
                    transition: 'width 0.5s ease',
                    background: '#6c7ff7',
                    borderRadius: 999
                  }}
                />
              </div>
              <small className="text-muted" style={{ display: 'block', marginTop: 8 }}>
                This may take a few seconds…
              </small>
            </div>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}
    </div>
  )
}