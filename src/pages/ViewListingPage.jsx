import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import { getSimilarListings, trackView } from '../components/recommendations.js'
import { useI18n } from '../components/i18n.jsx'

export default function ViewListingPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { t } = useI18n()
  // Support both legacy "/listing/:id" and SEO-friendly "/listing/:id-:slug"
  const listingId = (() => {
    const raw = String(id || '')
    const first = raw.split('-')[0]
    const num = Number(first)
    return Number.isFinite(num) ? num : null
  })()
  const [listing, setListing] = useState(null)
  const [images, setImages] = useState([])
  const [structured, setStructured] = useState({})
  const [status, setStatus] = useState(null)
  const [copiedToast, setCopiedToast] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [favorited, setFavorited] = useState(false)
  const [loading, setLoading] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [favPulse, setFavPulse] = useState(false)
  const [descOpen, setDescOpen] = useState(false)
  const [sellerUsername, setSellerUsername] = useState(null)

  const [similar, setSimilar] = useState([])
  const [similarLoading, setSimilarLoading] = useState(false)

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch (_) { return null }
  }
  function isLoggedIn() {
    return !!getUser()
  }
  function formatPhoneDisplay(p) {
    const s = String(p || '').trim()
    return s.startsWith('+94') ? ('0' + s.slice(3)) : s
  }
  function formatPrice(n) {
    const v = typeof n === 'number' ? n : Number(n)
    if (!isFinite(v)) return String(n ?? '')
    return v.toLocaleString('en-US')
  }

  // Make a professional Title Case (e.g., "honda dio" -> "Honda Dio")
  function formatTitleCase(s) {
    const str = String(s || '').trim()
    if (!str) return ''
    return str
      .split(/\s+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
  }

  // Simple formatter: escape HTML, preserve newlines, support **bold** and ••bold••
  function renderDescHTML(desc) {
    try {
      let s = String(desc || '');
      // Escape HTML
      s = s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      // Bold markers:
      // - Markdown style: **text**
      // - Bullet style seen in older descriptions: ••text••
      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      s = s.replace(/•{2}(.+?)•{2}/g, '<strong>$1</strong>');
      // Preserve line breaks
      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br/>');
      return { __html: s };
    } catch (_) {
      return { __html: String(desc || '') };
    }
  }

  // Truncate for mobile preview while keeping bold markers balanced where possible
  function truncateForPreview(desc, limit = 180) {
    const s = String(desc || '');
    if (s.length <= limit) return s;
    let t = s.slice(0, limit);
    // If we cut inside an odd "**" count, remove the last unmatched "**" to avoid showing raw asterisks
    const starPairs = (t.match(/\*\*/g) || []).length;
    if (starPairs % 2 === 1) {
      const li = t.lastIndexOf('**');
      if (li >= 0) t = t.slice(0, li) + t.slice(li + 2);
    }
    // Same for the bullet bold marker "••"
    const bulletPairs = (t.match(/•{2}/g) || []).length;
    if (bulletPairs % 2 === 1) {
      const li = t.lastIndexOf('••');
      if (li >= 0) t = t.slice(0, li) + t.slice(li + 2);
    }
    return t + '…';
  }

  // Lightbox state for full-size image with zoom and slide controls
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [prevViewportContent, setPrevViewportContent] = useState(null)

  // Responsive: detect mobile to tailor lightbox UI
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    try {
      const mq = window.matchMedia('(max-width: 780px)')
      const handle = () => setIsMobile(!!mq.matches)
      handle()
      if (mq.addEventListener) mq.addEventListener('change', handle)
      else if (mq.addListener) mq.addListener(handle)
      return () => {
        if (mq.removeEventListener) mq.removeEventListener('change', handle)
        else if (mq.removeListener) mq.removeListener(handle)
      }
    } catch (_) {
      setIsMobile(false)
    }
  }, [])

  function openLightbox(idx = 0) {
    setLightboxIndex(idx)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    // Lock body scroll and disable page pinch-zoom for mobile to avoid whole-site zoom/lag
    try {
      document.body.style.overflow = 'hidden'
      const vp = document.querySelector('meta[name="viewport"]')
      if (vp) {
        setPrevViewportContent(vp.getAttribute('content'))
        vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
      }
    } catch (_) {}
    setLightboxOpen(true)
  }
  function closeLightbox() {
    setLightboxOpen(false)
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setDragging(false)
    // Restore body scroll and viewport scaling
    try {
      document.body.style.overflow = ''
      const vp = document.querySelector('meta[name="viewport"]')
      if (vp && prevViewportContent != null) {
        vp.setAttribute('content', prevViewportContent)
      }
    } catch (_) {}
  }
  function lbPrev() {
    setLightboxIndex(i => {
      const n = images.length || 0
      if (!n) return 0
      const ni = (i - 1 + n) % n
      setZoom(1); setPan({ x: 0, y: 0 })
      return ni
    })
  }
  function lbNext() {
    setLightboxIndex(i => {
      const n = images.length || 0
      if (!n) return 0
      const ni = (i + 1) % n
      setZoom(1); setPan({ x: 0, y: 0 })
      return ni
    })
  }
  function zoomIn() { setZoom(z => Math.min(4, Number((z + 0.2).toFixed(2)))) }
  function zoomOut() { setZoom(z => Math.max(1, Number((z - 0.2).toFixed(2)))) }
  function resetZoom() { setZoom(1); setPan({ x: 0, y: 0 }) }

  // Desktop keyboard navigation when lightbox is open
  useEffect(() => {
    if (!(lightboxOpen && !isMobile)) return
    function onKey(e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); lbPrev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); lbNext() }
      else if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightboxOpen, isMobile, images.length])

  function onWheelZoom(e) {
    e.preventDefault()
    const delta = e.deltaY
    if (delta > 0) {
      zoomOut()
    } else {
      zoomIn()
    }
  }
  function onDragStart(e) {
    e.preventDefault()
    setDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }
  function onDragMove(e) {
    if (!dragging) return
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  function onDragEnd() {
    setDragging(false)
  }

  // --- Mobile pinch-zoom gesture support (lightbox only) ---
  const [pinching, setPinching] = useState(false)
  const [pinchStartDist, setPinchStartDist] = useState(0)
  const [pinchStartZoom, setPinchStartZoom] = useState(1)
  const [pinchStartPan, setPinchStartPan] = useState({ x: 0, y: 0 })
  const [pinchCenter, setPinchCenter] = useState({ x: 0, y: 0 })

  function distance(touches) {
    if (touches.length < 2) return 0
    const dx = touches[0].clientX - touches[1].clientX
    const dy = touches[0].clientY - touches[1].clientY
    return Math.hypot(dx, dy)
  }
  function center(touches) {
    if (touches.length < 2) return { x: 0, y: 0 }
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    }
  }

  const lastTapRef = useRef(0)

  function onTouchStart(e) {
    if (!isMobile) return
    if (!lightboxOpen) return

    // Double-tap to toggle zoom (mobile)
    if (e.touches.length === 1) {
      const now = Date.now()
      const elapsed = now - (lastTapRef.current || 0)
      lastTapRef.current = now

      const t = e.touches[0]
      if (elapsed > 0 && elapsed < 300) {
        // Double tap detected: toggle zoom around tap point
        e.preventDefault()
        if (zoom <= 1.01) {
          const targetZoom = 2
          // Pan so that tapped point moves toward center
          const cx = window.innerWidth / 2
          const cy = window.innerHeight / 2
          const dx = t.clientX - cx
          const dy = t.clientY - cy
          const dz = targetZoom - 1
          setZoom(targetZoom)
          setPan({ x: pan.x - dx * dz, y: pan.y - dy * dz })
        } else {
          // Reset
          setZoom(1)
          setPan({ x: 0, y: 0 })
        }
        return
      }
    }

    if (e.touches.length === 2) {
      e.preventDefault()
      const dist = distance(e.touches)
      setPinching(true)
      setPinchStartDist(dist)
      setPinchStartZoom(zoom)
      setPinchStartPan(pan)
      setPinchCenter(center(e.touches))
    } else if (e.touches.length === 1 && zoom > 1) {
      // One-finger pan when zoomed
      e.preventDefault()
      const t = e.touches[0]
      setDragging(true)
      setDragStart({ x: t.clientX - pan.x, y: t.clientY - pan.y })
    }
  }

  function onTouchMove(e) {
    if (!isMobile) return
    if (!lightboxOpen) return
    if (pinching && e.touches.length === 2) {
      e.preventDefault()
      const dist = distance(e.touches)
      if (pinchStartDist > 0) {
        const scale = dist / pinchStartDist
        // Update zoom clamped to [1,4]
        const newZoom = Math.max(1, Math.min(4, Number((pinchStartZoom * scale).toFixed(3))))
        // Compute pan so that the pinch center stays roughly stable
        const c = center(e.touches)
        const dx = c.x - pinchCenter.x
        const dy = c.y - pinchCenter.y
        // Adjust pan: base pan plus finger movement; also adjust for zoom delta
        const zoomDelta = newZoom / (pinchStartZoom || 1)
        const newPan = {
          x: pinchStartPan.x + dx + (pinchCenter.x - window.innerWidth / 2) * (zoomDelta - 1),
          y: pinchStartPan.y + dy + (pinchCenter.y - window.innerHeight / 2) * (zoomDelta - 1)
        }
        setZoom(newZoom)
        setPan(newPan)
      }
    } else if (dragging && e.touches.length === 1) {
      e.preventDefault()
      const t = e.touches[0]
      setPan({ x: t.clientX - dragStart.x, y: t.clientY - dragStart.y })
    }
  }

  function onTouchEnd(e) {
    if (!isMobile) return
    if (!lightboxOpen) return
    if (pinching && e.touches.length < 2) {
      setPinching(false)
    }
    if (dragging && e.touches.length === 0) {
      setDragging(false)
    }
  }

  // Load listing
  useEffect(() => {
    async function load() {
      if (!listingId) { setStatus('Error: Invalid ID'); return }
      try {
        setLoading(true)
        const user = getUser()
        const headers = {}
        if (user?.email) headers['X-User-Email'] = user.email
        const r = await fetch(`/api/listings/${encodeURIComponent(String(listingId))}`, { headers })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Failed to load listing')
        setListing(data)
        try { trackView(data) } catch (_) {}
        const imgs = Array.isArray(data.images) ? data.images.filter(Boolean) : []
        setImages(imgs)
        setCurrentIndex(0)
        try {
          const parsed = JSON.parse(data.structured_json || '{}')
          setStructured(parsed)
        } catch (_) {
          setStructured({})
        }
        // Load seller username
        try {
          const email = String(data.owner_email || '').trim()
          if (email) {
            const rs = await fetch(`/api/auth/status?email=${encodeURIComponent(email)}`)
            const usr = await rs.json()
            if (rs.ok && usr?.username) {
              setSellerUsername(usr.username)
            } else {
              setSellerUsername(null)
            }
          } else {
            setSellerUsername(null)
          }
        } catch (_) {
          setSellerUsername(null)
        }
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [listingId])

  // Fetch similar listings using the same cookie-based algorithm
  useEffect(() => {
    let alive = true
    async function loadSimilar() {
      try {
        if (!listing) return
        setSimilarLoading(true)
        const out = await getSimilarListings(listing, 6)
        if (alive) setSimilar(Array.isArray(out) ? out : [])
      } catch (_) {
        if (alive) setSimilar([])
      } finally {
        if (alive) setSimilarLoading(false)
      }
    }
    loadSimilar()
    return () => { alive = false }
  }, [listing, structured?.sub_category, structured?.model_name])

  // Load favorite status from local storage (client-only favorite)
  useEffect(() => {
    const user = getUser()
    if (!user?.email || !listingId) return
    try {
      const key = `favorites_${user.email}`
      const arr = JSON.parse(localStorage.getItem(key) || '[]')
      setFavorited(arr.includes(Number(listingId)))
    } catch (_) {}
  }, [listingId])


  // Dynamic SEO based on listing fields + OpenGraph/Twitter + canonical + JSON-LD
  useEffect(() => {
    if (!listing) return
    const rawTitle = listing.seo_title || listing.title || 'Listing'
    const title = formatTitleCase(rawTitle)
    const desc = listing.seo_description || listing.enhanced_description || listing.description || ''

    // Build SEO-friendly permalink: title + optional year + short alphanumeric id
    function makeSlug(s) {
      const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      return base || 'listing'
    }
    const year = (() => {
      const sj = (() => { try { return JSON.parse(listing.structured_json || '{}') } catch (_) { return {} } })()
      const y = sj.manufacture_year || sj.year || sj.model_year || null
      return y ? String(y) : ''
    })()
    const idCode = Number(listing.id).toString(36).toUpperCase()
    const parts = [makeSlug(rawTitle), year, idCode].filter(Boolean)
    const permalinkPath = `/listing/${listing.id}-${parts.join('-')}`
    const url = `https://ganudenu.store${permalinkPath}`
    document.title = title

    // If current path is missing slug, replace it for better SEO without breaking navigation
    try {
      const cur = window.location.pathname
      if (cur === `/listing/${listing.id}`) {
        window.history.replaceState({}, title, permalinkPath)
      }
    } catch (_) {}

    function setMeta(name, content) {
      let tag = document.querySelector(`meta[name="${name}"]`)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute('name', name)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }
    function setProperty(property, content) {
      let tag = document.querySelector(`meta[property="${property}"]`)
      if (!tag) {
        tag = document.createElement('meta')
        tag.setAttribute('property', property)
        document.head.appendChild(tag)
      }
      tag.setAttribute('content', content)
    }
    function setCanonical(href) {
      let link = document.querySelector('link[rel="canonical"]')
      if (!link) {
        link = document.createElement('link')
        link.setAttribute('rel', 'canonical')
        document.head.appendChild(link)
      }
      link.setAttribute('href', href)
    }

    setMeta('description', desc)
    setMeta('keywords', listing.seo_keywords || '')
    setProperty('og:title', title)
    setProperty('og:description', desc)
    setProperty('og:url', url)
    setProperty('og:type', 'website')
    // Prefer generated OG image; fallback to medium/thumbnail
    const ogImg = listing.og_image_url || listing.medium_url || listing.thumbnail_url || (images[0]?.url || '')
    if (ogImg) {
      setProperty('og:image', ogImg)
      setMeta('twitter:image', ogImg)
    }
    setMeta('twitter:card', 'summary_large_image')
    setMeta('twitter:title', title)
    setMeta('twitter:description', desc)
    setCanonical(url)

    // JSON-LD by category (Vehicle, Property, Job) else Product/Offer
    try {
      const scriptId = 'jsonld-listing'
      let script = document.getElementById(scriptId)
      if (!script) {
        script = document.createElement('script')
        script.type = 'application/ld+json'
        script.id = scriptId
        document.head.appendChild(script)
      }
      const price = typeof listing.price === 'number' ? listing.price : undefined
      const mainCat = String(listing.main_category || '')
      let jsonld = null

      if (mainCat === 'Job') {
        jsonld = {
          "@context": "https://schema.org",
          "@type": "JobPosting",
          title,
          description: desc,
          datePosted: listing.created_at || new Date().toISOString(),
          employmentType: (structured && structured.employment_type) || undefined,
          jobLocation: listing.location ? { "@type": "Place", name: listing.location } : undefined,
          hiringOrganization: sellerUsername ? { "@type": "Organization", name: sellerUsername } : undefined,
          baseSalary: price != null ? {
            "@type": "MonetaryAmount",
            currency: "LKR",
            value: { "@type": "QuantitativeValue", value: String(price) }
          } : undefined
        }
      } else if (mainCat === 'Property') {
        jsonld = {
          "@context": "https://schema.org",
          "@type": "RealEstateListing",
          name: title,
          description: desc,
          address: (structured && structured.address) ? { "@type": "PostalAddress", streetAddress: structured.address } : undefined,
          offers: price != null ? {
            "@type": "Offer",
            price: String(price),
            priceCurrency: "LKR",
            availability: "https://schema.org/InStock"
          } : undefined
        }
      } else if (mainCat === 'Vehicle') {
        const brand = (structured && structured.manufacturer) || undefined
        jsonld = {
          "@context": "https://schema.org",
          "@type": "Vehicle",
          name: title,
          model: (structured && structured.model_name) || undefined,
          brand: brand ? { "@type": "Brand", name: brand } : undefined,
          productionDate: (structured && structured.manufacture_year) ? String(structured.manufacture_year) : undefined,
          description: desc,
          offers: price != null ? {
            "@type": "Offer",
            price: String(price),
            priceCurrency: "LKR",
            availability: "https://schema.org/InStock"
          } : undefined
        }
      } else {
        jsonld = {
          "@context": "https://schema.org",
          "@type": "Product",
          name: title,
          description: desc,
          offers: price != null ? {
            "@type": "Offer",
            price: String(price),
            priceCurrency: "LKR",
            availability: "https://schema.org/InStock"
          } : undefined
        }
      }
      script.text = JSON.stringify(jsonld)
    } catch (_) {}
  }, [listing, images])

  const isPropertyCat = String(listing?.main_category || '') === 'Property'
  const propAddress = String((structured && structured.address) || '')
  const propLandType = String((structured && structured.land_type) || '')
  const propLandSize = String((structured && structured.land_size) || '')

  const structuredEntries = useMemo(() => {
    const obj = structured || {}
    let entries = Object.entries(obj).filter(([k]) => k && k !== '')
    const isJobCat = String(listing?.main_category || '') === 'Job'
    const isPropCat = String(listing?.main_category || '') === 'Property'

    // Always avoid duplicating the long description in the right-side details
    const removeKeys = new Set([
      'description',
      // Common salary duplicates coming from extraction
      'salary',
      'salary_type'
    ])

    if (isJobCat) {
      // Job view: hide vehicle-specific fields and extra year/model variants
      ;['model_name','model','manufacture_year','model_year','year','mfg_year'].forEach(k => removeKeys.add(k))
      // Also remove alternative salary fields to avoid duplicates when price/pricing_type are present
      ;['expected_salary','salary_lkr','pay','compensation','compensation_type'].forEach(k => removeKeys.add(k))
    }

    if (isPropCat) {
      // We'll render these explicitly at the top of the details section
      ;['address','land_type','land_size'].forEach(k => removeKeys.add(k))
    }

    entries = entries.filter(([k]) => !removeKeys.has(String(k)))
    return entries
  }, [structured, listing])

  function prettyLabel(key) {
    // Adjust labels based on category (e.g., Salary for Job)
    const isJob = String(listing?.main_category || '') === 'Job'
    const map = {
      pricing_type: isJob ? 'Salary Type' : 'Price Type',
      sub_category: isJob ? 'Job Sub-category' : 'Sub Category',
      valid_until: 'Valid Until',
      main_category: 'Category',
      phone: 'Phone',
      email: 'Email',
      model: 'Model',
      location: 'Location',
      price: isJob ? 'Salary' : 'Price',
      status: 'Status'
    }
    if (map[key]) return map[key]
    const s = String(key || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    return s.replace(/(^|\s)\w/g, m => m.toUpperCase())
  }

  function onDial() {
    if (!isLoggedIn()) {
      setShowLogin(true)
      return
    }
    // Anchor with tel: will handle the dial action
  }

  async function onReport() {
    if (!isLoggedIn()) {
      setShowLogin(true)
      return
    }
    const reason = window.prompt('Report reason:')
    if (!reason || !reason.trim()) return
    try {
      const user = getUser()
      const r = await fetch('/api/listings/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: Number(listingId), reason: reason.trim(), reporter_email: user.email })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to report listing')
      setStatus('Thank you. Your report has been submitted.')
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  function onToggleFavorite() {
    if (!isLoggedIn()) {
      setShowLogin(true)
      return
    }
    try {
      const user = getUser()
      const key = `favorites_${user.email}`
      const arr = JSON.parse(localStorage.getItem(key) || '[]')
      const nid = Number(id)
      const exists = arr.includes(nid)
      const next = exists ? arr.filter(v => v !== nid) : [...arr, nid]
      localStorage.setItem(key, JSON.stringify(next))
      setFavorited(!exists)
      setFavPulse(true)
      setTimeout(() => setFavPulse(false), 300)
    } catch (e) {
      setStatus('Failed to update favorites.')
    }
  }

  async function onShare() {
    try {
      const url = window.location.href
      await navigator.clipboard.writeText(url)
      setCopiedToast(true)
      setTimeout(() => setCopiedToast(false), 1500)
    } catch (_) {
      setStatus('Failed to copy link')
      setTimeout(() => setStatus(null), 2000)
    }
  }

  function prevImage() {
    setCurrentIndex(i => {
      const n = images.length
      return n ? (i - 1 + n) % n : 0
    })
  }
  function nextImage() {
    setCurrentIndex(i => {
      const n = images.length
      return n ? (i + 1) % n : 0
    })
  }
  function selectImage(idx) {
    setCurrentIndex(idx)
  }

  const mainImage = images[currentIndex]
  const isInteracting = (pinching || dragging || zoom > 1)
  return (
    <div className="center viewlisting has-actionbar">
      {loading && <LoadingOverlay message={t('view.loading')} />}
      {showLogin && (
        <div className="card" style={{ position: 'sticky', top: 8, zIndex: 5, marginBottom: 12 }}>
          <div className="h2">{t('auth.pleaseLogin')}</div>
          <p className="text-muted">{t('auth.loginSeeContact')}</p>
          <a className="btn primary" href="/auth">{t('auth.goToLogin')}</a>
          <button className="btn" onClick={() => setShowLogin(false)} style={{ marginLeft: 8 }}>{t('common.dismiss')}</button>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
        {/* Gradient header to match Home/Job pages */}
        <div
          className="viewlisting-hero"
          style={{
            padding: '32px 18px',
            background:
              'radial-gradient(1000px 300px at 10% -20%, rgba(0,209,255,0.25), transparent 60%), ' +
              'radial-gradient(1000px 300px at 90% 0%, rgba(108,127,247,0.25), transparent 60%), ' +
              'linear-gradient(180deg, rgba(18,22,31,0.9), rgba(18,22,31,0.6))'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div className="h1 viewlisting-title" style={{ marginBottom: 6 }}>
                {formatTitleCase(listing?.seo_title || listing?.title || 'View Listing')}
              </div>

              {listing && (
                <div className="seo-keys" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {!isMobile ? (
                    <>
                      {listing.main_category && <span className="pill">{listing.main_category}</span>}
                      {listing.location && <span className="pill">{listing.location}</span>}
                      {sellerUsername && (
                        <a className="pill" href={`/seller/${encodeURIComponent(sellerUsername)}`} title="View seller profile">{t('view.seller')}: {sellerUsername}</a>
                      )}
                      {Number.isFinite(Number(listing?.views)) && <span className="pill">👁️ {Number(listing.views).toLocaleString('en-US')}</span>}
                    </>
                  ) : (
                    <>
                      {/* Row 1: location, views */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto' }}>
                        {listing.location && <span className="pill">{listing.location}</span>}
                        {Number.isFinite(Number(listing?.views)) && <span className="pill">👁️ {Number(listing.views).toLocaleString('en-US')}</span>}
                      </div>
                      {/* Row 2: category, seller */}
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap', overflowX: 'auto', marginTop: 6 }}>
                        {listing.main_category && <span className="pill">{listing.main_category}</span>}
                        {sellerUsername && (
                          <a className="pill" href={`/seller/${encodeURIComponent(sellerUsername)}`} title="View seller profile">{t('view.seller')}: {sellerUsername}</a>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="viewlisting-header-actions" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {typeof listing?.price !== 'undefined' && listing?.price !== null && (
                <div className="price-chip large">LKR {formatPrice(listing.price)}</div>
              )}
              <button
                className={`btn fav-btn ${favorited ? 'active' : ''} ${favPulse ? 'pulse' : ''}`}
                onClick={onToggleFavorite}
                aria-label={favorited ? 'Remove favorite' : 'Add favorite'}
                title={favorited ? 'Remove favorite' : 'Add favorite'}
                type="button"
              >
                ★ {favorited ? t('view.favorited') : t('view.favorite')}
              </button>
              <button
                className="btn"
                onClick={onShare}
                aria-label="Share listing link"
                title={t('common.share')}
                type="button"
              >
                🔗
              </button>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div style={{ padding: 18 }}>
          {/* Gallery + Details */}
          <div className="grid two" style={{ marginTop: 0 }}>
            {/* Left: Gallery + Description */}
            <div>
              <div className="h2">{t('view.gallery')}</div>
              {images.length > 0 ? (
                <div className="carousel">
                  <div className="carousel-main">
                    {mainImage?.url ? (
                    <img
                      src={mainImage.medium_url || mainImage.url}
                      srcSet={(() => {
                        const m = mainImage.medium_url || '';
                        const o = mainImage.url || '';
                        const parts = [];
                        if (m) parts.push(`${m} 1024w`);
                        if (o) parts.push(`${o} 1600w`);
                        return parts.join(', ');
                      })()}
                      sizes="(max-width: 780px) 100vw, 60vw"
                      alt={mainImage.original_name || 'Image'}
                      loading="eager"
                      onClick={() => openLightbox(currentIndex)}
                      style={{ cursor: 'zoom-in' }}
                    />
                  ) : (
                      <div className="carousel-empty text-muted">{t('view.noPreview')}</div>
                    )}
                    {images.length > 1 && (
                      <>
                        <button className="btn nav prev" onClick={prevImage} aria-label={t('common.prevImage')}>‹</button>
                        <button className="btn nav next" onClick={nextImage} aria-label={t('common.nextImage')}>›</button>
                      </>
                    )}
                  </div>
                  {images.length > 1 && (
                    <div className="carousel-thumbs">
                      {images.map((img, idx) => (
                        <button
                          key={img.id ?? idx}
                          className={`thumb ${idx === currentIndex ? 'active' : ''}`}
                          onClick={() => selectImage(idx)}
                          aria-label={`Show image ${idx + 1}`}
                          title={img.original_name || `Image ${idx + 1}`}
                        >
                          {img.url ? (
                            <img src={img.url} alt={img.original_name || `Image ${idx + 1}`} />
                          ) : (
                            <span className="text-muted">{img.path || 'Image'}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="card" style={{ textAlign: 'center' }}>
                  <div className="text-muted">{t('view.noImages')}</div>
                </div>
              )}

              <div className="h2" style={{ marginTop: 16 }}>{t('view.description')}</div>
              {/* Desktop full description (preserve line breaks + **bold**) */}
              <div className="desc-desktop">
                <div dangerouslySetInnerHTML={renderDescHTML(listing?.enhanced_description || listing?.description)} />
              </div>
              {/* Mobile collapsible description */}
              <div className="desc-mobile">
                {descOpen ? (
                  <div dangerouslySetInnerHTML={renderDescHTML(listing?.enhanced_description || listing?.description)} />
                ) : (
                  <div
                    className="desc-mobile-preview"
                    dangerouslySetInnerHTML={renderDescHTML(
                      truncateForPreview(listing?.enhanced_description || listing?.description || '', 180)
                    )}
                  />
                )}
                {String(listing?.enhanced_description || listing?.description || '').length > 180 && (
                  <button type="button" className="btn" onClick={() => setDescOpen(o => !o)}>
                    {descOpen ? t('common.showLess') : t('common.readMore')}
                  </button>
                )}
              </div>
            </div>

            {/* Right: Key Details, Contact, Report */}
            <div>
              {/* Contact (mobile-first duplicate, hidden on desktop via CSS) */}
              {listing?.phone ? (
                <div className="card contact-mobile" style={{ marginTop: 0 }}>
                  <div className="h2" style={{ marginTop: 0 }}>{t('view.contact')}</div>
                  {sellerUsername && <div className="text-muted" style={{ marginBottom: 6 }}>{t('view.seller')}: {sellerUsername}</div>}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a
                      className="btn primary"
                      href={`tel:${listing.phone}`}
                    >
                      {formatPhoneDisplay(listing.phone)}
                    </a>
                    {listing?.email && <a className="btn" href={`mailto:${listing.email}`}>{t('view.emailSeller')}</a>}
                  </div>
                </div>
              ) : null}

              <div className="h2" style={{ marginTop: 16 }}>{t('view.keyDetails')}</div>
              {structuredEntries.length === 0 && !isPropertyCat && <p className="text-muted">{t('view.noStructuredData')}</p>}
              <div className="details-grid">
                {/* Property extras shown first if present */}
                {isPropertyCat && propAddress && (
                  <div className="detail">
                    <div className="label">Address</div>
                    <div className="value">{propAddress}</div>
                  </div>
                )}
                {isPropertyCat && propLandType && (
                  <div className="detail">
                    <div className="label">Land Type</div>
                    <div className="value">{propLandType}</div>
                  </div>
                )}
                {isPropertyCat && propLandSize && (
                  <div className="detail">
                    <div className="label">Land Size</div>
                    <div className="value">{propLandSize}</div>
                  </div>
                )}

                

                {structuredEntries.map(([k, v]) => (
                  <div key={k} className="detail">
                    <div className="label">{prettyLabel(k)}</div>
                    <div className="value">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</div>
                  </div>
                ))}
              </div>

              {/* Contact info card (desktop) */}
              {listing?.phone && (
                <div className="card contact-desktop" style={{ marginTop: 16 }}>
                  <div className="h2" style={{ marginTop: 0 }}>{t('view.contact')}</div>
                  {sellerUsername && <div className="text-muted" style={{ marginBottom: 6 }}>{t('view.seller')}: {sellerUsername}</div>}
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a
                      className="btn primary"
                      href={`tel:${listing.phone}`}
                    >
                      {formatPhoneDisplay(listing.phone)}
                    </a>
                    {listing?.email && <a className="btn" href={`mailto:${listing.email}`}>{t('view.emailSeller')}</a>}
                  </div>
                </div>
              )}

              {/* Desktop: Report button moved under contact card, right-aligned */}
              <div className="report-desktop" style={{ marginTop: 8, textAlign: 'right' }}>
                <button className="btn" onClick={onReport} type="button">{t('view.reportListing')}</button>
              </div>
            </div>
          </div>

          {/* Similar listings */}
          <div style={{ marginTop: 16 }}>
            <div className="h2" style={{ marginTop: 0 }}>{t('view.similarListings')}</div>
            {similarLoading && (
              <div className="grid three">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={`sk-sim-${i}`} className="skeleton-card">
                    <div className="skeleton skeleton-img" />
                    <div className="skeleton skeleton-line" style={{ width: '60%', marginTop: 8 }} />
                    <div className="skeleton skeleton-line" style={{ width: '40%', marginTop: 6 }} />
                  </div>
                ))}
              </div>
            )}
            {!similarLoading && (
              <div className="grid three">
                {similar.map(item => {
                  const imgs = Array.isArray(item.small_images) ? item.small_images : []
                  const hero = imgs.length ? imgs[0] : (item.thumbnail_url || null)
                  function makeSlug(s) {
                    const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                    return base || 'listing';
                  }
                  function permalinkForItem(it) {
                    const titleSlug = makeSlug(it.title || '');
                    let year = '';
                    try {
                      const sj = JSON.parse(it.structured_json || '{}');
                      const y = sj.manufacture_year || sj.year || sj.model_year || null;
                      if (y) year = String(y);
                    } catch (_) {}
                    const idCode = Number(it.id).toString(36).toUpperCase();
                    const parts = [titleSlug, year, idCode].filter(Boolean);
                    return `/listing/${it.id}-${parts.join('-')}`;
                  }
                  return (
                    <div
                      key={item.id}
                      className="card"
                      onClick={() => { try { trackView(item) } catch (_) {}; navigate(permalinkForItem(item)) }}
                      style={{ cursor: 'pointer' }}
                    >
                      {hero && (
                        <div style={{ position: 'relative', marginBottom: 8 }}>
                          <img
                            src={hero}
                            alt={item.title}
                            loading="lazy"
                            sizes="(max-width: 780px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            style={{ width: '100%', height: 160, borderRadius: 8, objectFit: 'cover' }}
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
                          <div style={{ margin: '6px 0', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700 }}>
                            {`LKR ${Number(item.price).toLocaleString('en-US')}`}
                          </div>
                        )}
                      </div>
                      <div className="text-muted" style={{ marginBottom: 6 }}>
                        {item.location ? item.location : ''}
                        {item.pricing_type ? ` • ${item.pricing_type}` : ''}
                      </div>
                    </div>
                  )
                })}
                {similar.length === 0 && <p className="text-muted">{t('view.noSimilar')}</p>}
              </div>
            )}
          </div>
        </div>

        {/* Mobile: Report button moved away from description read-more, placed at bottom of card */}
        <div className="report-mobile" style={{ margin: '12px 18px 0' }}>
          <button className="btn" onClick={onReport} type="button">{t('view.reportListing')}</button>
        </div>

        {status && <p style={{ marginTop: 8 }}>{status}</p>}
      </div>

      {/* Fullscreen Lightbox for images */}
      {lightboxOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox() }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.78)',
            zIndex: 2000,
            display: 'grid',
            gridTemplateRows: 'auto 1fr auto',
            backdropFilter: 'blur(2px)',
            touchAction: 'none',
            overscrollBehavior: 'contain'
          }}
        >
          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 10, position: 'relative', zIndex: 2101 }}>
            <div className="pill" style={{ background: 'rgba(255,255,255,0.08)' }}>
              {lightboxIndex + 1} / {images.length || 0}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {!isMobile && (
                <>
                  <button className="btn" type="button" onClick={zoomOut} aria-label="Zoom out">−</button>
                  <button className="btn" type="button" onClick={resetZoom} aria-label="Reset zoom">Reset</button>
                  <button className="btn" type="button" onClick={zoomIn} aria-label="Zoom in">+</button>
                </>
              )}
              <button className="btn" type="button" onClick={(e) => { e.stopPropagation(); closeLightbox() }} aria-label="Close">✕</button>
            </div>
          </div>

          {/* Image stage */}
          <div
            onWheel={!isMobile ? onWheelZoom : undefined}
            onMouseDown={!isMobile ? onDragStart : undefined}
            onMouseMove={!isMobile ? onDragMove : undefined}
            onMouseUp={!isMobile ? onDragEnd : undefined}
            onMouseLeave={!isMobile ? onDragEnd : undefined}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            style={{ display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: (!isMobile && dragging) ? 'grabbing' : (!isMobile && zoom > 1 ? 'grab' : 'default') }}
          >
            {images[lightboxIndex]?.url ? (
              <img
                src={images[lightboxIndex].url}
                alt={images[lightboxIndex].original_name || 'Image'}
                draggable={false}
                onDoubleClick={!isMobile ? resetZoom : undefined}
                style={{
                  maxWidth: '90vw',
                  maxHeight: '80vh',
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                  transition: dragging ? 'none' : 'transform 120ms ease',
                  boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
                  borderRadius: 10,
                  userSelect: 'none',
                  willChange: 'transform'
                }}
              />
            ) : (
              <div className="text-muted">No image</div>
            )}
          </div>

          {/* Desktop bottom nav buttons; Mobile gets large side overlays */}
          {!isMobile ? (
            <div style={{ position: 'relative', padding: 12 }}>
              <button
                className="btn"
                type="button"
                onClick={lbPrev}
                aria-label={t('common.prevImage')}
                style={{
                  position: 'absolute',
                  left: 12,
                  bottom: 12,
                  borderRadius: '999px',
                  width: 44,
                  height: 44
                }}
              >‹</button>
              <button
                className="btn"
                type="button"
                onClick={lbNext}
                aria-label={t('common.nextImage')}
                style={{
                  position: 'absolute',
                  right: 12,
                  bottom: 12,
                  borderRadius: '999px',
                  width: 44,
                  height: 44
                }}
              >›</button>
            </div>
          ) : (
            <>
              {!isInteracting && (
                <>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); lbPrev() }}
                    aria-label={t('common.prevImage')}
                    style={{
                      position: 'absolute',
                      top: 56,
                      left: 0,
                      bottom: 0,
                      width: '24%',
                      background: 'linear-gradient(to right, rgba(0,0,0,0.25), rgba(0,0,0,0))',
                      border: 'none',
                      color: '#fff',
                      fontSize: 34,
                      display: 'grid',
                      placeItems: 'center',
                      touchAction: 'manipulation',
                      zIndex: 2050
                    }}
                  >‹</button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); lbNext() }}
                    aria-label={t('common.nextImage')}
                    style={{
                      position: 'absolute',
                      top: 56,
                      right: 0,
                      bottom: 0,
                      width: '24%',
                      background: 'linear-gradient(to left, rgba(0,0,0,0.25), rgba(0,0,0,0))',
                      border: 'none',
                      color: '#fff',
                      fontSize: 34,
                      display: 'grid',
                      placeItems: 'center',
                      touchAction: 'manipulation',
                      zIndex: 2050
                    }}
                  >›</button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Mobile sticky action bar (hidden on desktop via CSS) */}
      <div className="mobile-actionbar">
        {typeof listing?.price !== 'undefined' && listing?.price !== null ? (
          <div className="price-chip">LKR {formatPrice(listing.price)}</div>
        ) : <span />}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn"
            onClick={onShare}
            aria-label="Share listing link"
            title={t('common.share')}
            type="button"
          >
            🔗
          </button>
          {listing?.phone && (
            <a
              className="btn accent"
              href={`tel:${listing.phone}`}
              aria-label="Call seller"
              title="Call seller"
            >
              {t('common.call')}
            </a>
          )}
        </div>
      </div>

      {copiedToast && (
        <div
          role="status"
          aria-live="polite"
          className="pill"
          style={{
            position: 'fixed',
            bottom: 20,
            zIndex: 3000,
            background: 'rgba(18,22,31,0.92)',
            color: '#fff',
            padding: isMobile ? '14px 20px' : '12px 18px',
            borderRadius: 999,
            fontSize: isMobile ? 17 : 15,
            fontWeight: 700,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            ...(isMobile
              ? { left: '50%', transform: 'translateX(-50%)' }
              : { right: 20 })
          }}
        >
          {t('view.linkCopied')}
        </div>
      )}
    </div>
  )
}
