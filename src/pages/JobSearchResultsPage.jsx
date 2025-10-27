import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'
import { useI18n } from '../components/i18n.jsx'

export default function JobSearchResultsPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [sp, setSp] = useSearchParams()
  const qParam = sp.get('q') || ''
  const [q, setQ] = useState(qParam)
  const [searchSuggestions, setSearchSuggestions] = useState([])

  // Job-focused filters (server-side / advanced)
  const [location, setLocation] = useState(sp.get('location') || '')
  const [employmentType, setEmploymentType] = useState(sp.get('employment_type') || '')
  const [experience, setExperience] = useState(sp.get('experience_level') || '')
  const [remote, setRemote] = useState(sp.get('remote') === '1')
  const [salaryMin, setSalaryMin] = useState(sp.get('salary_min') || '')
  const [salaryMax, setSalaryMax] = useState(sp.get('salary_max') || '')
  const [sort, setSort] = useState(sp.get('sort') || 'latest')
  const [page, setPage] = useState(Number(sp.get('page') || 1))

  // In-page filter (client-side)
  const [localFilter, setLocalFilter] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const [results, setResults] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)

  // Location autocomplete
  const [locQuery, setLocQuery] = useState(location)
  const [locSuggestions, setLocSuggestions] = useState([])

  useEffect(() => {
    async function runSearch() {
      try {
        setLoading(true)
        const params = new URLSearchParams()
        params.set('category', 'Job')
        if (qParam) params.set('q', qParam)
        if (location) params.set('location', location)
        if (salaryMin) params.set('price_min', salaryMin)
        if (salaryMax) params.set('price_max', salaryMax)
        if (page) params.set('page', String(page))
        if (sort) params.set('sort', sort)

        const filters = {}
        if (employmentType) filters.employment_type = employmentType
        if (experience) filters.experience_level = experience
        if (remote) filters.remote = 'true'

        if (Object.keys(filters).length) {
          params.set('filters', JSON.stringify(filters))
        }

        const r = await fetch(`/api/listings/search?${params.toString()}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data?.error || 'Search failed')
        setResults(Array.isArray(data.results) ? data.results : [])
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    runSearch()
  }, [qParam, location, employmentType, experience, remote, salaryMin, salaryMax, page, sort])

  useEffect(() => {
    const q = locQuery.trim()
    if (!q) { setLocSuggestions([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listings/locations?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const data = await r.json()
        if (r.ok && Array.isArray(data.results)) setLocSuggestions(data.results)
      } catch (_) {}
    }, 200)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [locQuery])

  // Fetch job-only search suggestions for Advanced input
  useEffect(() => {
    const term = (q || '').trim()
    if (!term) { setSearchSuggestions([]); return }
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listings/suggestions?q=${encodeURIComponent(term)}&category=Job`, { signal: ctrl.signal })
        const data = await r.json()
        if (r.ok && Array.isArray(data.results)) {
          const arr = data.results.map(x => (typeof x === 'string' ? x : String(x.value || ''))).filter(Boolean)
          setSearchSuggestions(arr)
        }
      } catch (_) {}
    }, 250)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [q])

  function onSubmit(e) {
    e.preventDefault()
    const next = new URLSearchParams()
    if (q.trim()) next.set('q', q.trim())
    if (location) next.set('location', location)
    if (employmentType) next.set('employment_type', employmentType)
    if (experience) next.set('experience_level', experience)
    if (remote) next.set('remote', '1')
    if (salaryMin) next.set('salary_min', salaryMin)
    if (salaryMax) next.set('salary_max', salaryMax)
    if (sort) next.set('sort', sort)
    next.set('page', '1')
    setPage(1)
    setSp(next, { replace: true })
  }

  const heading = useMemo(() => {
    const base = t('jobSearch.heading')
    return qParam ? `${base} • “${qParam}”` : base
  }, [qParam, t])

  // Apply client-side filter
  const filtered = useMemo(() => {
    const t = (localFilter || '').toLowerCase().trim()
    if (!t) return results
    return results.filter(job => {
      const fields = []
      fields.push(job.title || '')
      fields.push(job.location || '')
      try {
        const sj = JSON.parse(job.structured_json || '{}')
        fields.push(sj.company || sj.employer || '')
        fields.push(sj.employment_type || '')
        fields.push(sj.experience_level || '')
      } catch (_) {}
      return fields.join(' ').toLowerCase().includes(t)
    })
  }, [results, localFilter])

  return (
    <div className="center">
      {loading && <LoadingOverlay message={t('jobSearch.loading')} />}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
       <div style={{
          padding: 18,
          background: 'linear-gradient(180deg, rgba(18,22,31,0.9), rgba(18,22,31,0.6))'
        }}>
          <div className="h1" style={{ textAlign: 'center' }}>{heading}</div>
          <p className="text-muted" style={{ textAlign: 'center', marginTop: 4 }}>{t('jobSearch.subtitle')}</p>

          {/* In-page filter (client-side) */}
          <div className="grid two" style={{ marginTop: 12 }}>
            <input
              className="input"
              placeholder="Filter results on this page (title, company, location...)"
              value={localFilter}
              onChange={e => setLocalFilter(e.target.value)}
            />
            <button className="btn" type="button" onClick={() => setShowAdvanced(s => !s)}>
              {showAdvanced ? t('search.hideAdvanced') : t('search.advanced')}
            </button>
          </div>

          {/* Advanced (server-side) */}
          {showAdvanced && (
            <form onSubmit={onSubmit} className="grid two" style={{ marginTop: 12 }}>
              <input className="input" list="job-adv-global-suggest" placeholder="Job title, skill, or company" value={q} onChange={e => setQ(e.target.value)} />
              <datalist id="job-adv-global-suggest">
                {searchSuggestions.map(s => <option key={s} value={s} />)}
              </datalist>
              <div>
                <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Location</div>
                <CustomSelect
                  value={location}
                  onChange={v => { setLocation(String(v || '')); setLocQuery(String(v || '')); }}
                  ariaLabel="Location"
                  placeholder="Location"
                  options={[{ value: '', label: 'Any' }, ...locSuggestions.map(loc => ({ value: loc, label: loc }))]}
                  searchable={true}
                  allowCustom={true}
                  virtualized={true}
                  maxDropdownHeight={420}
                />
              </div>
              <CustomSelect
                value={employmentType}
                onChange={v => setEmploymentType(String(v || ''))}
                ariaLabel="Employment type"
                placeholder="Employment type"
                options={[
                  { value: '', label: 'Any' },
                  { value: 'Full-time', label: 'Full-time' },
                  { value: 'Part-time', label: 'Part-time' },
                  { value: 'Contract', label: 'Contract' },
                  { value: 'Internship', label: 'Internship' },
                  { value: 'Temporary', label: 'Temporary' },
                ]}
                virtualized={true}
                maxDropdownHeight={420}
              />
              <CustomSelect
                value={experience}
                onChange={v => setExperience(String(v || ''))}
                ariaLabel="Experience"
                placeholder="Experience"
                options={[
                  { value: '', label: 'Any' },
                  { value: 'Intern', label: 'Intern' },
                  { value: 'Junior', label: 'Junior' },
                  { value: 'Mid', label: 'Mid' },
                  { value: 'Senior', label: 'Senior' },
                  { value: 'Lead', label: 'Lead' },
                ]}
                virtualized={true}
                maxDropdownHeight={420}
              />
              <input className="input" type="number" placeholder="Min salary" value={salaryMin} onChange={e => setSalaryMin(e.target.value)} />
              <input className="input" type="number" placeholder="Max salary" value={salaryMax} onChange={e => setSalaryMax(e.target.value)} />
              <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input id="remote" type="checkbox" checked={remote} onChange={e => setRemote(e.target.checked)} />
                <label htmlFor="remote">Remote only</label>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <CustomSelect
                  value={sort}
                  onChange={v => setSort(String(v || 'latest'))}
                  ariaLabel="Sort"
                  placeholder="Sort"
                  options={[
                    { value: 'latest', label: 'Latest' },
                    { value: 'price_asc', label: 'Salary: Low to High' },
                    { value: 'price_desc', label: 'Salary: High to Low' },
                  ]}
                  virtualized={true}
                  maxDropdownHeight={420}
                />
                <button className="btn primary" type="submit">{t('common.apply')}</button>
              </div>
            </form>
          )}
        </div>

        <div style={{ padding: 18 }}>
          <div className="h2" style={{ marginTop: 0 }}>{t('common.results')}</div>
          <div className="grid two">
            {filtered.map(job => {
              // Extract possible job-specific info from structured_json if present
              let company = ''
              let employment = ''
              let exp = ''
              try {
                const sj = JSON.parse(job.structured_json || '{}')
                company = sj.company || sj.employer || ''
                employment = sj.employment_type || ''
                exp = sj.experience_level || ''
              } catch (_) {}

              const salary =
                job.price != null ? String(job.price) :
                ''

              return (
                <div key={job.id} className="card">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {job.thumbnail_url && (
                      <img src={job.thumbnail_url} alt={job.title} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover' }} />
                    )}
                    <div>
                      <div className="h2" style={{ margin: 0 }}>{job.title}</div>
                      <div className="text-muted" style={{ marginTop: 2 }}>
                        {company ? company + ' • ' : ''}{employment || '—'}
                      </div>
                    </div>
                  </div>

                  <div className="text-muted" style={{ marginTop: 8 }}>
                    {job.location ? job.location : ''}{exp ? ` • ${exp}` : ''}{salary ? ` • ${salary}` : ''}{job.pricing_type ? ` • ${job.pricing_type}` : ''}
                  </div>

                  <p className="text-muted" style={{ marginTop: 8 }}>{job.seo_description || (job.description || '').slice(0, 180)}</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Link className="btn" to={`/listing/${job.id}`}>View</Link>
                    <button className="btn" onClick={() => navigate(`/listing/${job.id}`)}>Apply</button>
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && <p className="text-muted">{t('jobSearch.noJobs')}</p>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
            <button className="btn" onClick={() => setPage(Math.max(1, page - 1))}>{t('common.prev')}</button>
            <div className="text-muted">Page {page}</div>
            <button className="btn" onClick={() => setPage(page + 1)}>{t('common.next')}</button>
          </div>

          {status && <p style={{ marginTop: 8 }}>{status}</p>}
        </div>
      </div>
    </div>
  )
}