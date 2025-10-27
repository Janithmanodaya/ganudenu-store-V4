import React, { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import CustomSelect from '../components/CustomSelect.jsx'

const JOB_SUBCATEGORIES = [
  'IT/Software',
  'Accounting/Finance',
  'Sales/Marketing',
  'Customer Service',
  'Administration',
  'HR/Recruitment',
  'Education/Training',
  'Healthcare',
  'Construction/Trades',
  'Logistics/Delivery',
  'Driver',
  'Security',
  'Cleaning/Housekeeping',
  'Hospitality/Food',
  'Design/Creative',
  'Legal',
  'Other'
]

export default function VerifyEmployeePage() {
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const draftId = sp.get('draftId')

  const [draft, setDraft] = useState(null)
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')
  const [status, setStatus] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [loading, setLoading] = useState(false)

  // Publishing essentials
  const [location, setLocation] = useState('')
  const [phone, setPhone] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [description, setDescription] = useState('')

  function getUserEmail() {
    try {
      const u = JSON.parse(localStorage.getItem('user') || 'null')
      return u?.email || ''
    } catch (_) { return '' }
  }

  function buildAuthHeaders() {
    const email = getUserEmail()
    const token = localStorage.getItem('auth_token')
    if (token) return { Authorization: `Bearer ${token}` }
    if (email) return { 'X-User-Email': email }
    return {}
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)

        // If no draftId in URL, try to locate latest employee draft and redirect
        if (!draftId) {
          const r2 = await fetch('/api/listings/my-drafts?employee_profile=1', { headers: buildAuthHeaders() })
          const d2 = await r2.json().catch(() => ({}))
          if (r2.ok && Array.isArray(d2.results) && d2.results.length > 0) {
            const first = d2.results[0]
            navigate(`/verify-employee?draftId=${encodeURIComponent(first.id)}`, { replace: true })
            return
          }
          setStatus('No draft specified. Please go back and create a profile first.')
          return
        }

        const r = await fetch(`/api/listings/draft/${encodeURIComponent(draftId)}`)
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Failed to load draft')
        if (cancelled) return

        setDraft(data.draft)
        setSeoTitle(data.draft.seo_title || '')
        setSeoDescription(data.draft.seo_description || '')
        setSeoKeywords(data.draft.seo_keywords || '')
        setDescription(data.draft.description || '')

        try {
          const obj = JSON.parse(data.draft.structured_json || '{}')
          setLocation(String(obj.location || ''))
          setPhone(String(obj.phone || ''))
          setSubCategory(String(obj.sub_category || ''))
        } catch (_) {}
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  async function submitPost() {
    try {
      // Basic validation required by server
      const loc = String(location || '').trim()
      const ph = String(phone || '').trim()
      const sub = String(subCategory || '').trim()
      const desc = String(description || '').trim()
      if (!sub) { setStatus('Please specify a Job sub-category (e.g., Driver, IT/Software, Sales/Marketing)'); return }
      if (!loc) { setStatus('Location is required'); return }
      if (!/^\+94\d{9}$/.test(ph)) { setStatus('Phone must be in +94XXXXXXXXX format'); return }
      if (!desc || desc.length < 10) { setStatus('Description must be at least 10 characters'); return }

      const obj = { sub_category: sub, location: loc, phone: ph }

      const payload = {
        draftId,
        structured_json: JSON.stringify(obj, null, 2),
        seo_title: seoTitle,
        seo_description: seoDescription,
        seo_keywords: seoKeywords,
        description: desc
      }
      const headers = { 'Content-Type': 'application/json', ...buildAuthHeaders() }

      const r = await fetch('/api/listings/submit', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Failed to submit')
      setSubmitted(data)
      setStatus('Profile submitted. Status: Pending Approval')
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  return (
    <div className="center">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div className="h1" style={{ marginTop: 0, marginBottom: 0 }}>Review Profile & Publish</div>
          <button
            className="btn"
            type="button"
            onClick={() => navigate('/jobs/post-employee')}
            aria-label="Back to post profile"
            title="Back to post profile"
          >
            Back
          </button>
        </div>

        {loading && <p className="text-muted">Loading profile draft...</p>}

        {!loading && !draft && (
          <div className="card" style={{ marginTop: 8 }}>
            <p className="text-muted">{status || 'No draft found.'}</p>
            <div style={{ marginTop: 8 }}>
              <button className="btn" type="button" onClick={() => navigate('/jobs/post-employee')}>Go to Post Profile</button>
            </div>
          </div>
        )}

        {draft && (
          <>
            <p className="text-muted">Category: {draft.main_category} • Title: {draft.title}</p>

            <div className="card" style={{ marginTop: 8 }}>
              <div className="h2" style={{ marginTop: 0 }}>Publishing Details</div>
              <div className="grid two">
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Job Sub-category</div>
                  <CustomSelect
                    value={subCategory}
                    onChange={v => setSubCategory(v)}
                    ariaLabel="Job sub-category"
                    placeholder="Select or type a sub-category"
                    options={JOB_SUBCATEGORIES.map(v => ({ value: v, label: v }))}
                    searchable={true}
                    allowCustom={true}
                  />
                </div>
                <input
                  className="input"
                  placeholder="Location (e.g., Colombo)"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                />
                <input
                  className="input"
                  placeholder="Contact phone (+94XXXXXXXXX)"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                />
              </div>
              <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                Sub-category, location and phone are required to publish.
              </div>
            </div>

            <div className="card" style={{ marginTop: 8 }}>
              <div className="h2" style={{ marginTop: 0 }}>Profile Summary</div>
              <textarea
                className="textarea"
                rows={4}
                placeholder="Add details to help companies match your profile..."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>

            <div className="card" style={{ marginTop: 8 }}>
              <div className="h2" style={{ marginTop: 0 }}>SEO Metadata (optional)</div>
              <input className="input" placeholder="SEO Title (max 60 chars)" value={seoTitle} onChange={e => setSeoTitle(e.target.value.slice(0,60))} />
              <input className="input" placeholder="Meta Description (max 160 chars)" value={seoDescription} onChange={e => setSeoDescription(e.target.value.slice(0,160))} style={{ marginTop: 8 }} />
              <input className="input" placeholder="SEO Keywords (comma-separated)" value={seoKeywords} onChange={e => setSeoKeywords(e.target.value)} style={{ marginTop: 8 }} />
            </div>

            <div style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={submitPost}>Publish Profile</button>
            </div>
          </>
        )}

        {status && <p style={{ marginTop: 8 }}>{status}</p>}
        {submitted && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="h2">Submission</div>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(submitted, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
