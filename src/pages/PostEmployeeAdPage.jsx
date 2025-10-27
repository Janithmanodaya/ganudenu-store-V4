import React, { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import LoadingOverlay from '../components/LoadingOverlay.jsx'
import CustomSelect from '../components/CustomSelect.jsx'

const DEFAULT_JOB_SUBCATEGORIES = [
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

// Persist custom sub-categories locally so users see them next time
const CUSTOM_KEY = 'job_subcategories_custom'
function readCustomSubs() {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY) || '[]'
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(v => String(v)).filter(Boolean) : []
  } catch (_) {
    return []
  }
}
function saveCustomSub(newVal) {
  const v = String(newVal || '').trim()
  if (!v) return
  const cur = readCustomSubs()
  if (!cur.find(x => x.toLowerCase() === v.toLowerCase())) {
    const next = [...cur, v].slice(0, 50)
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(next)) } catch (_) {}
  }
}

// Sri Lankan locations (districts + common cities)
const DEFAULT_LOCATIONS = [
  'Colombo','Gampaha','Kalutara','Kandy','Matale','Nuwara Eliya','Galle','Matara','Hambantota',
  'Jaffna','Kilinochchi','Mannar','Vavuniya','Mullaitivu','Batticaloa','Ampara','Trincomalee',
  'Kurunegala','Puttalam','Anuradhapura','Polonnaruwa','Badulla','Monaragala','Ratnapura','Kegalle',
  // Common cities/towns
  'Negombo','Maharagama','Dehiwala','Mount Lavinia','Moratuwa','Sri Jayawardenepura Kotte','Katunayake','Kadawatha',
  'Homagama','Avissawella','Panadura','Kalutara','Beruwala','Wadduwa','Weligama','Tangalle','Embilipitiya',
  'Hikkaduwa','Peradeniya','Hatton','Bandarawela','Badulla','Kuliyapitiya','Chilaw',
  'Kalmunai','Nuwara Eliya','Anuradhapura Town',
  'Other'
]

const LOCATION_CUSTOM_KEY = 'job_locations_custom'
function readCustomLocations() {
  try {
    const raw = localStorage.getItem(LOCATION_CUSTOM_KEY) || '[]'
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.map(v => String(v)).filter(Boolean) : []
  } catch (_) {
    return []
  }
}
function saveCustomLocation(newVal) {
  const v = String(newVal || '').trim()
  if (!v) return
  const cur = readCustomLocations()
  if (!cur.find(x => x.toLowerCase() === v.toLowerCase())) {
    const next = [...cur, v].slice(0, 100)
    try { localStorage.setItem(LOCATION_CUSTOM_KEY, JSON.stringify(next)) } catch (_) {}
  }
}

export default function PostEmployeeAdPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [targetTitle, setTargetTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [location, setLocation] = useState('')
  const [customLocation, setCustomLocation] = useState('') // shown when 'Other' is selected
  const [phone, setPhone] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [customSubCategory, setCustomSubCategory] = useState('') // shown when 'Other' is selected
  const [status, setStatus] = useState(null)
  const [processing, setProcessing] = useState(false)

  // If an employee profile or draft already exists, show management UI instead of the form
  const [existingDraft, setExistingDraft] = useState(null)
  const [existingProfile, setExistingProfile] = useState(null)
  const [checkingExisting, setCheckingExisting] = useState(true)

  // Merge defaults with any locally saved custom values (keep 'Other' last)
  const mergedSubCategories = useMemo(() => {
    const customs = readCustomSubs()
    const withoutOther = DEFAULT_JOB_SUBCATEGORIES.filter(v => v !== 'Other')
    const all = [...withoutOther]
    for (const c of customs) {
      if (!all.find(x => x.toLowerCase() === String(c).toLowerCase())) all.push(c)
    }
    all.push('Other')
    return all
  }, [])

  const mergedLocations = useMemo(() => {
    const customs = readCustomLocations()
    const withoutOther = DEFAULT_LOCATIONS.filter(v => v !== 'Other')
    const all = [...withoutOther]
    for (const c of customs) {
      if (!all.find(x => x.toLowerCase() === String(c).toLowerCase())) all.push(c)
    }
    all.push('Other')
    return all
  }, [])

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch { return null }
  }

  function buildAuthHeaders() {
    const user = getUser()
    const token = localStorage.getItem('auth_token')
    if (token) return { Authorization: `Bearer ${token}` }
    if (user?.email) return { 'X-User-Email': user.email }
    return {}
  }

  // Heuristic to detect a talent profile listing
  function isTalentProfile(item) {
    try {
      if (String(item.title || '').includes(' • ')) return true
      const sj = JSON.parse(item.structured_json || '{}')
      const hasSkills = !!(sj.skills && ((Array.isArray(sj.skills) && sj.skills.length) || (typeof sj.skills === 'string' && sj.skills.trim())))
      const hasCompany = !!(sj.company && String(sj.company).trim())
      const hasEmploymentType = !!(sj.employment_type && String(sj.employment_type).trim())
      if (hasSkills && !hasCompany && !hasEmploymentType) return true
      if (sj.is_talent === true || sj.type === 'candidate') return true
    } catch (_) {}
    return false
  }

  useEffect(() => {
    async function checkExisting() {
      try {
        const user = getUser()
        if (!user?.email) { setCheckingExisting(false); return }
        // Check for existing draft first
        try {
          const rd = await fetch('/api/listings/my-drafts?employee_profile=1', { headers: buildAuthHeaders() })
          const dd = await rd.json().catch(() => ({}))
          if (rd.ok && Array.isArray(dd.results) && dd.results.length > 0) {
            setExistingDraft(dd.results[0])
            return
          }
        } catch (_) {}
        // Then check for an active/pending profile
        const r = await fetch('/api/listings/my', { headers: buildAuthHeaders() })
        const data = await r.json().catch(() => ({}))
        if (r.ok && Array.isArray(data.results)) {
          const found = data.results.find(x => (x.employee_profile === 1 || x.employee_profile === true) || (String(x.main_category || '') === 'Job' && isTalentProfile(x)))
          if (found) setExistingProfile(found)
        }
      } catch (_) {
        // ignore
      } finally {
        setCheckingExisting(false)
      }
    }
    checkExisting()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function makeSlug(s) {
    const base = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    return base || 'listing'
  }

  async function handleDeleteExisting(id) {
    const user = getUser()
    if (!user?.email) { alert('Please login first.'); return }
    const ok = window.confirm('Delete your Employee Profile? This cannot be undone.')
    if (!ok) return
    try {
      const r = await fetch(`/api/listings/${id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders()
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || 'Delete failed')
      setExistingProfile(null)
      setStatus('Profile deleted. You can create a new one now.')
    } catch (e) {
      alert(e.message || 'Failed to delete')
    }
  }

  async function handleDeleteDraft(id) {
    const user = getUser()
    if (!user?.email) { alert('Please login first.'); return }
    const ok = window.confirm('Delete your Employee Profile draft? This cannot be undone.')
    if (!ok) return
    try {
      const r = await fetch(`/api/listings/draft/${id}`, {
        method: 'DELETE',
        headers: buildAuthHeaders()
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || 'Delete failed')
      setExistingDraft(null)
      setStatus('Draft deleted. You can create a new one now.')
    } catch (e) {
      alert(e.message || 'Failed to delete draft')
    }
  }

  async function submit(e) {
    e.preventDefault()
    // Require login to enforce one-profile-per-email on server
    let userEmail = ''
    try {
      const user = getUser()
      userEmail = user?.email || ''
    } catch (_) {}
    if (!userEmail) {
      setStatus('Please login to continue.')
      return
    }

    if (!name.trim() || !targetTitle.trim() || !summary.trim()) {
      setStatus('Name, Target Title, and Summary are required.')
      return
    }

    // Resolve final location (handle "Other" custom and free-typed values)
    const selLoc = String(location || '').trim()
    let finalLocation = selLoc
    if (!finalLocation) {
      setStatus('Location is required.')
      return
    }
    if (selLoc.toLowerCase() === 'other') {
      const manual = String(customLocation || '').trim()
      if (!manual) {
        setStatus('Please enter your Location.')
        return
      }
      finalLocation = manual
    }

    const phoneVal = phone.trim()
    if (!/^\+94\d{9}$/.test(phoneVal)) {
      setStatus('Phone must be in +94XXXXXXXXX format.')
      return
    }

    let sub = String(subCategory || '').trim()
    let subCustom = ''
    if (!sub) {
      setStatus('Please select a Job sub-category or type your own.')
      return
    }
    if (sub.toLowerCase() === 'other') {
      subCustom = String(customSubCategory || '').trim()
      if (!subCustom) {
        setStatus('Please enter your Job sub-category.')
        return
      }
    }

    try {
      setProcessing(true)
      setStatus(null)
      const fd = new FormData()
      fd.append('name', name.trim())
      fd.append('target_title', targetTitle.trim())
      fd.append('summary', summary.trim())
      fd.append('location', finalLocation)
      fd.append('phone', phoneVal)
      fd.append('sub_category', sub)
      if (subCustom) {
        fd.append('sub_category_custom', subCustom)
      }
      const r = await fetch('/api/jobs/employee/draft', {
        method: 'POST',
        headers: { 'X-User-Email': userEmail },
        body: fd
      })
      const data = await r.json()
      if (!r.ok) {
        setProcessing(false)
        setStatus(data.error || 'Failed to create draft.')
        return
      }

      // Persist new custom entries for future sessions
      if (subCustom) saveCustomSub(subCustom)
      // Save custom location if it was "Other" manual OR a free-typed non-default
      const isDefaultLoc = mergedLocations.some(x => x.toLowerCase() === finalLocation.toLowerCase())
      if (!isDefaultLoc) saveCustomLocation(finalLocation)

      setTimeout(() => {
        navigate(`/verify-employee?draftId=${encodeURIComponent(data.draftId)}`)
      }, 400)
    } catch (e) {
      setProcessing(false)
      setStatus('Network error.')
    }
  }

  const isOtherSub = String(subCategory || '').toLowerCase() === 'other'
  const isOtherLoc = String(location || '').toLowerCase() === 'other'

  return (
    <div className="center">
      {processing && <LoadingOverlay message="Saving your profile..." />}
      <div className="card">
        <div className="h1">Post Employee Profile (Free)</div>
        {checkingExisting ? (
          <p className="text-muted">Checking for an existing profile...</p>
        ) : existingDraft ? (
          <>
            <p className="text-muted" style={{ marginTop: 0 }}>
              You have an Employee Profile draft. You can continue or delete it below.
            </p>
            <div className="card">
              <div className="h2" style={{ marginTop: 0 }}>{existingDraft.title}</div>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Created: {existingDraft.created_at ? new Date(existingDraft.created_at).toLocaleString() : '—'}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => navigate(`/verify-employee?draftId=${encodeURIComponent(existingDraft.id)}`)}
                >
                  Continue to Review & Publish
                </button>
                <button className="btn" type="button" onClick={() => handleDeleteDraft(existingDraft.id)} style={{ background: '#f44336', color: '#fff' }}>
                  Delete Draft
                </button>
              </div>
            </div>
          </>
        ) : existingProfile ? (
          <>
            <p className="text-muted" style={{ marginTop: 0 }}>
              You already have an Employee Profile. You can view or delete it below.
            </p>
            <div className="card">
              <div className="h2" style={{ marginTop: 0 }}>{existingProfile.title}</div>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Status: {existingProfile.status} {existingProfile.location ? `• ${existingProfile.location}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => {
                    const slug = makeSlug(existingProfile.title)
                    navigate(`/listing/${existingProfile.id}-${slug}`)
                  }}
                >
                  Open Profile
                </button>
                <button className="btn" type="button" onClick={() => navigate('/my-ads')}>Manage in My Ads</button>
                <button className="btn" type="button" onClick={() => handleDeleteExisting(existingProfile.id)} style={{ background: '#f44336', color: '#fff' }}>
                  Delete Profile
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              Create your profile manually. One profile per email. Profiles expire after 3 months.
            </p>
            <form onSubmit={submit} className="grid two">
              <input className="input" placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} />
              <input className="input" placeholder="Target Job Title" value={targetTitle} onChange={e => setTargetTitle(e.target.value)} />

              <div>
                <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Location</div>
                <CustomSelect
                  value={location}
                  onChange={v => setLocation(v)}
                  ariaLabel="Location"
                  placeholder="Select or type a location"
                  options={mergedLocations.map(v => ({ value: v, label: v }))}
                  searchable={true}
                  allowCustom={true}
                />
                {isOtherLoc && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    placeholder="Type your Location"
                    value={customLocation}
                    onChange={e => setCustomLocation(e.target.value)}
                  />
                )}
              </div>

              <input className="input" placeholder="Contact phone (+94XXXXXXXXX)" value={phone} onChange={e => setPhone(e.target.value)} />
              <div>
                <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Job Sub-category</div>
                <CustomSelect
                  value={subCategory}
                  onChange={v => setSubCategory(v)}
                  ariaLabel="Job sub-category"
                  placeholder="Select or type a sub-category"
                  options={mergedSubCategories.map(v => ({ value: v, label: v }))}
                  searchable={true}
                  allowCustom={true}
                />
                {isOtherSub && (
                  <input
                    className="input"
                    style={{ marginTop: 8 }}
                    placeholder="Type your Job sub-category"
                    value={customSubCategory}
                    onChange={e => setCustomSubCategory(e.target.value)}
                  />
                )}
              </div>
              <textarea className="textarea" placeholder="Summary / Pitch" value={summary} onChange={e => setSummary(e.target.value)} />
              <div>
                <button className="btn primary" type="submit" disabled={processing}>Continue</button>
              </div>
            </form>
          </>
        )}
        {status && <p style={{ marginTop: 8 }}>{status}</p>}
      </div>
    </div>
  )
}
