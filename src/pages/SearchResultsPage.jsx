import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import { useI18n } from '../components/i18n.jsx'
import useSEO from '../components/useSEO.js'

export default function SearchResultsPage() {
  const [sp, setSp] = useSearchParams()
  const q = sp.get('q') || ''
  const category = sp.get('category') || ''
  const navigate = useNavigate()
  const { t } = useI18n()
  const [advCategory, setAdvCategory] = useState(category)

  // SEO for search page via helper
  const qp = new URLSearchParams()
  if (q) qp.set('q', q)
  if (category) qp.set('category', category)
  const canonical = `https://ganudenu.store/search${qp.toString() ? `?${qp.toString()}` : ''}`
  useSEO({
    title: q ? `Search: ${q} — Ganudenu Marketplace` : 'Search — Ganudenu Marketplace',
    description: q
      ? `Find results for "${q}" across vehicles, property, jobs, electronics, mobiles, and home & garden.`
      : 'Browse the latest listings across vehicles, property, jobs, electronics, mobiles, and home & garden.',
    canonical
  })

  // Advanced filters (query params aware)
  const [location, setLocation] = useState(sp.get('location') || '')
  const [pricingType, setPricingType] = useState(sp.get('pricing_type') || '')
  const [priceMin, setPriceMin] = useState(sp.get('price_min') || '')
  const [priceMax, setPriceMax] = useState(sp.get('price_max') || '')

  // Keyword mode: AND/OR
  const [keywordMode, setKeywordMode] = useState(sp.get('keyword_mode') || 'or')

  // Pagination/sort
  const [page, setPage] = useState(Number(sp.get('page') || 1))
  const [sort, setSort] = useState(sp.get('sort') || 'latest')
  const limit = 10 // Always show latest 10 results per page

  const [filtersDef, setFiltersDef] = useState({ keys: [], valuesByKey: {} })
  const [filters, setFilters] = useState({})
  const [results, setResults] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  // Initialize filters from URL param if present (e.g., when clicking a suggestion for model/sub_category)
  useEffect(() => {
    const f = sp.get('filters')
    if (f) {
      try {
        const obj = JSON.parse(f)
        if (obj && typeof obj === 'object') {
          setFilters(obj)
        }
      } catch (_) {}
    }
  }, [sp])

  // Location autocomplete
  const [locQuery, setLocQuery] = useState(location)
  const [locSuggestions, setLocSuggestions] = useState([])

  const [showAdvanced, setShowAdvanced] = useState(false)

  // Derived dynamic bounds for price slider from current results
  const priceBounds = useMemo(() => {
    const nums = (results || [])
      .map(r => (r.price != null ? Number(r.price) : null))
      .filter(n => Number.isFinite(n));
    if (!nums.length) return { min: 0, max: 1000000 };
    return { min: Math.min(...nums), max: Math.max(...nums) };
  }, [results]);

  useEffect(() => {
    async function loadFilters() {
      if (!advCategory) { setFiltersDef({ keys: [], valuesByKey: {} }); return }
      try {
        const r = await fetch(`/api/listings/filters?category=${encodeURIComponent(advCategory)}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Failed to load filters')
        setFiltersDef({ keys: data.keys || [], valuesByKey: data.valuesByKey || {} })
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      }
    }
    loadFilters()
  }, [advCategory])

  useEffect(() => {
    async function runSearch() {
      try {
        setLoading(true)
        const query = new URLSearchParams()
        if (q) query.set('q', q)
        if (category) query.set('category', category)
        if (location) query.set('location', location)
        if (pricingType) query.set('pricing_type', pricingType)
        if (priceMin) query.set('price_min', priceMin)
        if (priceMax) query.set('price_max', priceMax)
        if (keywordMode) query.set('keyword_mode', keywordMode)
        if (page) query.set('page', String(page))
        if (sort) query.set('sort', String(sort))
        query.set('limit', String(limit))

        const filtersStr = JSON.stringify(filters)
        if (Object.keys(filters).length) query.set('filters', filtersStr)

        const url = `/api/listings/search?${query.toString()}`
        const r = await fetch(url)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Search failed')
        setResults(data.results || [])
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    runSearch()
  }, [q, category, filters, location, pricingType, priceMin, priceMax, keywordMode, page, sort])

  // Location suggestions fetching (debounced)
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

  function updateFilter(key, value) {
    setFilters(prev => ({ ...prev, [key]: value }))
  }

  // Helper to update multi-select values stored as array
  function updateFilterArray(key, arr) {
    setFilters(prev => ({ ...prev, [key]: arr }))
  }

  function onApplyAdvanced(e) {
    e.preventDefault()
    // Apply current selections by updating URL params (handled by runSearch above)
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (advCategory) next.set('category', advCategory)
    if (location) next.set('location', location)
    if (pricingType) next.set('pricing_type', pricingType)
    if (priceMin) next.set('price_min', priceMin)
    if (priceMax) next.set('price_max', priceMax)
    if (keywordMode) next.set('keyword_mode', keywordMode)
    if (sort) next.set('sort', sort)
    next.set('page', '1')
    next.set('limit', String(limit))
    if (Object.keys(filters).length) next.set('filters', JSON.stringify(filters))
    setSp(next, { replace: true })
    setPage(1)
  }

  function resetAdvancedFilters() {
    setLocation('');
    setPricingType('');
    setPriceMin('');
    setPriceMax('');
    setFilters({});
    setSort('latest');
    setKeywordMode('or');
    setPage(1);
    setAdvCategory('');
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    next.set('page', '1')
    next.set('sort', 'latest')
    next.set('limit', String(limit))
    setSp(next, { replace: true })
  }

  const heading = useMemo(() => {
    const base = t('search.headingBase')
    if (category) return `${base} • ${category}`
    return base
  }, [category, t])

  // Build pagination window (around 5 pages centered on current)
  const pageWindow = [page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1)

  // Utility: render a tag input for multi-select (comma-separated tokens)
  function TagInput({ label, values, suggestions, onChange }) {
    const [text, setText] = useState('')
    function addToken(token) {
      const v = String(token || '').trim()
      if (!v) return
      const next = Array.from(new Set([...(values || []), v]))
      onChange(next)
      setText('')
    }
    function removeToken(v) {
      const next = (values || []).filter(x => String(x).toLowerCase() !== String(v).toLowerCase())
      onChange(next)
    }
    return (
      <div>
        <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>{label}</div>
        <div className="card" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {(values || []).map(v => (
            <span key={v} className="pill">
              {v}
              <button type="button" className="btn" onClick={() => removeToken(v)} title="Remove" aria-label="Remove" style={{ marginLeft: 6, padding: '2px 6px' }}>✕</button>
            </span>
          ))}
          <input
            className="input"
            list="tag-suggest"
            placeholder="Type and press Enter..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addToken(text) } }}
            style={{ minWidth: 200, flex: '1 1 200px' }}
          />
          <datalist id="tag-suggest">
            {(suggestions || []).map(s => <option key={s} value={s} />)}
          </datalist>
          <button className="btn" type="button" onClick={() => addToken(text)}>Add</button>
        </div>
      </div>
    )
  }

  return (
    <div className="center">
      {loading && <LoadingOverlay message={t('search.loading')} />}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: 18,
          background: 'linear-gradient(180deg, rgba(18,22,31,0.9), rgba(18,22,31,0.6))'
        }}>
          <div className="h1" style={{ textAlign: 'center' }}>{heading}</div>
          <p className="text-muted" style={{ textAlign: 'center', marginTop: 4 }}>{q ? `Query: "${q}"` : 'Browse the latest listings.'}</p>

          {/* Advanced toggle */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
            <button className="btn" type="button" onClick={() => setShowAdvanced(s => !s)}>
              {showAdvanced ? t('search.hideAdvanced') : t('search.advanced')}
            </button>
          </div>

          {showAdvanced && (
            <>
              <div className="h2" style={{ marginTop: 8 }}>{t('search.advancedTitle')}</div>
              <form onSubmit={onApplyAdvanced} className="grid two">
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Category</div>
                  <CustomSelect
                    value={advCategory}
                    onChange={v => setAdvCategory(v)}
                    ariaLabel="Category"
                    placeholder="Category"
                    options={[
                      { value: '', label: 'Any' },
                      { value: 'Vehicle', label: 'Vehicle' },
                      { value: 'Property', label: 'Property' },
                      { value: 'Electronic', label: 'Electronic' },
                      { value: 'Mobile', label: 'Mobile' },
                      { value: 'Home Garden', label: 'Home Garden' },
                      { value: 'Job', label: 'Job' },
                    ]}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                </div>
                <div>
                  <input
                    className="input"
                    list="location-suggest"
                    placeholder="Location"
                    value={location}
                    onChange={e => { setLocation(e.target.value); setLocQuery(e.target.value) }}
                  />
                  <datalist id="location-suggest">
                    {locSuggestions.map(loc => <option key={loc} value={loc} />)}
                  </datalist>
                </div>
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Pricing</div>
                  <CustomSelect
                    value={pricingType}
                    onChange={v => setPricingType(v)}
                    ariaLabel="Pricing"
                    placeholder="Pricing"
                    options={[
                      { value: '', label: 'Any' },
                      { value: 'Fixed Price', label: 'Fixed Price' },
                      { value: 'Negotiable', label: 'Negotiable' },
                    ]}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                </div>

                {/* Price inputs */}
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Min price</div>
                  <input className="input" type="number" placeholder="Min price" value={priceMin} onChange={e => setPriceMin(e.target.value)} />
                </div>
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Max price</div>
                  <input className="input" type="number" placeholder="Max price" value={priceMax} onChange={e => setPriceMax(e.target.value)} />
                </div>

                {/* Keyword mode toggle */}
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Keyword logic</div>
                  <CustomSelect
                    value={keywordMode}
                    onChange={v => setKeywordMode(v)}
                    ariaLabel="Keyword mode"
                    placeholder="Keyword mode"
                    options={[
                      { value: 'or', label: 'OR (any word)' },
                      { value: 'and', label: 'AND (all words)' },
                    ]}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                </div>

                {/* Dynamic filters from structured_json */}
                {advCategory && filtersDef.keys.length > 0 && (() => {
                  const pretty = (k) => {
                    if (!k) return '';
                    const map = {
                      model: 'Model',
                      model_name: 'Model',
                      manufacture_year: 'Manufacture Year',
                      sub_category: 'Sub-category',
                      pricing_type: 'Pricing',
                    };
                    if (map[k]) return map[k];
                    return String(k).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase());
                  };
                  // Render all dynamic keys as dropdowns (including sub_category and model)
                  return filtersDef.keys
                    .filter(k => !['location','pricing_type','price'].includes(k))
                    .map(key => {
                      const values = (filtersDef.valuesByKey[key] || []).map(v => String(v));
                      return (
                        <div key={key}>
                          <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>{pretty(key)}</div>
                          <CustomSelect
                            value={filters[key] || ''}
                            onChange={val => updateFilter(key, val)}
                            ariaLabel={key}
                            placeholder={pretty(key)}
                            options={[{ value: '', label: 'Any' }, ...values.map(v => ({ value: v, label: v }))]}
                            searchable={true}
                            allowCustom={true}
                            virtualized={true}
                            maxDropdownHeight={420}
                          />
                        </div>
                      );
                    });
                })()}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <CustomSelect
                    value={sort}
                    onChange={v => setSort(v)}
                    ariaLabel="Sort"
                    placeholder="Sort"
                    options={[
                      { value: 'latest', label: 'Latest' },
                      { value: 'price_asc', label: 'Price: Low to High' },
                      { value: 'price_desc', label: 'Price: High to Low' },
                    ]}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                  <button className="btn accent compact" type="submit" style={{ flex: '0 0 auto' }}>Apply</button>
                  <button className="btn compact" type="button" onClick={resetAdvancedFilters} style={{ flex: '0 0 auto' }}>Reset</button>
                </div>
              </form>
            </>
          )}
        </div>

        <div style={{ padding: 18 }}>
          <div className="h2" style={{ marginTop: 0 }}>{t('search.results')}</div>
          <div className="grid three">
            {results.map(r => {
              let expires = ''
              if (r.valid_until) {
                const diff = new Date(r.valid_until).getTime() - Date.now()
                const days = Math.max(0, Math.ceil(diff / (1000*60*60*24)))
                expires = `Expires in ${days} day${days === 1 ? '' : 's'}`
              }
              const imgs = Array.isArray(r.small_images) ? r.small_images : []
              const hero = imgs.length ? imgs[0] : (r.thumbnail_url || null)

              {
                const makeSlug = (s) => {
                  const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
                  return base || 'listing';
                };
                const permalinkForItem = (it) => {
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
                };
                return (
                  <div
                    key={r.id}
                    className="card"
                    onClick={() => navigate(permalinkForItem(r))}
                    style={{ cursor: 'pointer' }}
                  >
                    {hero && (
                      <div style={{ position: 'relative', marginBottom: 8 }}>
                        <img
                          src={hero}
                          alt={r.title}
                          loading="lazy"
                          sizes="(max-width: 780px) 100vw, (max-width: 1200px) 50vw, 33vw"
                          style={{ width: '100%', height: 160, borderRadius: 8, objectFit: 'cover' }}
                        />
                        {(r.is_urgent || r.urgent) && (
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
                      <div className="h2" style={{ margin: '6px 0' }}>{r.title}</div>
                      {r.price != null && (
                        <div style={{ margin: '6px 0', whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700 }}>
                          {`LKR ${Number(r.price).toLocaleString('en-US')}`}
                        </div>
                      )}
                    </div>
                    <div className="text-muted" style={{ marginBottom: 6 }}>
                      {r.location ? r.location : ''}
                      {r.pricing_type ? ` • ${r.pricing_type}` : ''}
                      {expires ? ` • ${expires}` : ''}
                    </div>
                  </div>
                );
              }
            })}
            {results.length === 0 && <p className="text-muted">{t('search.noResults')}</p>}

          </div>
          {/* Pagination */}
          <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn page" onClick={() => setPage(Math.max(1, page - 1))} aria-label="Previous page">{t('common.prev')}</button>
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
            <button className="btn page" onClick={() => setPage(page + 1)} aria-label="Next page">{t('common.next')}</button>

          </div>

          {status && <p style={{ marginTop: 8 }}>{status}</p>}
        </div>
      </div>
    </div>
  )
}
