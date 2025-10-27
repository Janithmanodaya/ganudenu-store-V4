import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function VerifyListingPage() {
  const [sp] = useSearchParams()
  const draftId = sp.get('draftId')
  const [draft, setDraft] = useState(null)
  const [images, setImages] = useState([])
  const [structuredJSON, setStructuredJSON] = useState('')
  const [status, setStatus] = useState(null)
  const [submitted, setSubmitted] = useState(null)
  const [activeIdx, setActiveIdx] = useState(0)

  // Optional SEO states (fixes setSeoTitle/Description/Keywords not defined)
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [seoKeywords, setSeoKeywords] = useState('')

  // Description (editable)
  const [descriptionText, setDescriptionText] = useState('')

  

  // Generator controls (one-time)
  const [genBusy, setGenBusy] = useState(false)
  const [genUsed, setGenUsed] = useState(false)

  // Convenience accessors for required fields in structuredJSON
  function parseStruct() {
    try { return JSON.parse(structuredJSON || '{}') } catch (_) { return {} }
  }
  function patchStruct(next) {
    setStructuredJSON(JSON.stringify(next, null, 2))
  }

  const struct = parseStruct()
  const loc = String(struct.location || '')
  const price = struct.price != null && struct.price !== '' ? String(struct.price) : ''
  const pricingType = String(struct.pricing_type || '')
  const phone = String(struct.phone || '')
  const modelName = String(struct.model_name || '')
  const year = struct.manufacture_year != null && struct.manufacture_year !== '' ? String(struct.manufacture_year) : ''
  const subCategory = String(struct.sub_category || '')
  const condition = String(struct.condition || '')

  // Vehicle extra fields
  const mileageKm = struct.mileage_km != null && struct.mileage_km !== '' ? String(struct.mileage_km) : ''
  const engineCc = struct.engine_capacity_cc != null && struct.engine_capacity_cc !== '' ? String(struct.engine_capacity_cc) : ''
  const transmission = String(struct.transmission || '')
  const colour = String(struct.colour || '')
  const manufacturer = String(struct.manufacturer || '')
  const fuelType = String(struct.fuel_type || '')

  // Category flags
  const mainCat = String(draft?.main_category || '')
  const isVehicle = mainCat === 'Vehicle'
  const isJob = mainCat === 'Job'
  const isProperty = mainCat === 'Property'
  const isMobile = mainCat === 'Mobile'
  const isElectronic = mainCat === 'Electronic'
  const isHomeGarden = mainCat === 'Home Garden'

  // Job-specific fields
  const employmentType = String(struct.employment_type || '')
  const company = String(struct.company || '')

  // Property-specific fields (optional)
  const bedrooms = struct.bedrooms != null && struct.bedrooms !== '' ? String(struct.bedrooms) : ''
  const bathrooms = struct.bathrooms != null && struct.bathrooms !== '' ? String(struct.bathrooms) : ''
  const sizeText = String(struct.size || '')
  const furnishing = String(struct.furnishing || '')
  const parking = Boolean(struct.parking)
  // Property extras
  const address = String(struct.address || '')
  const landType = String(struct.land_type || '')
  const landSize = String(struct.land_size || '')

  // Generic optional brand (useful for Mobile/Electronic/Home Garden)
  const brand = String(struct.brand || '')

  useEffect(() => {
    async function load() {
      if (!draftId) return;
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      const email = user?.email || '';

      try {
        const url = `/api/listings/draft/${encodeURIComponent(draftId)}?email=${encodeURIComponent(email)}`;
        const r = await fetch(url);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed to load draft');
        setDraft(data.draft);
        setImages(data.images || []);
        setStructuredJSON(data.draft.structured_json || '');
        setSeoTitle(data.draft.seo_title || '');
        setSeoDescription(data.draft.seo_description || '');
        setSeoKeywords(data.draft.seo_keywords || '');
        setDescriptionText(data.draft.enhanced_description || data.draft.description || '');
      } catch (e) {
        setStatus(`Error: ${e.message}`);
      }
    }
    load();
  }, [draftId]);

  // Init one-time flag from localStorage
  useEffect(() => {
    if (!draftId) return
    const key = `desc_gen_used_${draftId}`
    try {
      const raw = localStorage.getItem(key)
      setGenUsed(raw === '1')
    } catch (_) {}
  }, [draftId])

  // Reset active index if images change size
  useEffect(() => {
    if (activeIdx >= images.length) setActiveIdx(0)
  }, [images, activeIdx])

  const urls = useMemo(() => {
    // Use server-provided URL if available; fall back to filename extraction supporting Windows paths
    return images.map(img => {
      if (img.url) return img.url
      const filename = String(img.path || '').split(/[\\\/]/).pop()
      return filename ? `/uploads/${filename}` : ''
    })
  }, [images])

  // Image grid management (NewListing-style)
  const slotFileInputRef = useRef(null)
  const pendingSlotRef = useRef(null)

  const maxImages = useMemo(() => {
    if (!draft) return 5
    const cat = String(draft.main_category || '')
    if (cat === 'Job') return 1
    if (cat === 'Mobile' || cat === 'Electronic' || cat === 'Home Garden') return 4
    return 5
  }, [draft])

  function openPickerForSlot(index) {
    pendingSlotRef.current = index
    slotFileInputRef.current?.click()
  }

  async function onSlotFileChange(e) {
    const file = (e.target.files && e.target.files[0]) || null
    e.target.value = ''
    if (!file) return
    const idx = pendingSlotRef.current ?? 0
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      // If slot currently has an image, delete it first
      const current = images[idx]
      if (current && current.id) {
        await fetch(`/api/listings/draft/${encodeURIComponent(draftId)}/images/${encodeURIComponent(current.id)}`, {
          method: 'DELETE',
          headers: user?.email ? { 'X-User-Email': user.email } : undefined,
        })
      }
      // Add the new image
      const fd = new FormData()
      fd.append('images', file)
      const r = await fetch(`/api/listings/draft/${encodeURIComponent(draftId)}/images`, {
        method: 'POST',
        headers: user?.email ? { 'X-User-Email': user.email } : undefined,
        body: fd
      })
      const data = await r.json()
      if (!r.ok) throw new Error((data && data.error) || 'Failed to upload image')
      const list = Array.isArray(data.images) ? data.images : []
      // If we replaced an in-bounds slot, keep index; else jump to last
      setImages(list)
      setActiveIdx(Math.min(idx, Math.max(0, list.length - 1)))
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    } finally {
      pendingSlotRef.current = null
    }
  }

  async function clearSlot(index) {
    const img = images[index]
    if (!img || !img.id) return
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      const r = await fetch(`/api/listings/draft/${encodeURIComponent(draftId)}/images/${encodeURIComponent(img.id)}`, {
        method: 'DELETE',
        headers: user?.email ? { 'X-User-Email': user.email } : undefined,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error((data && data.error) || 'Failed to remove image')
      setImages(prev => prev.filter((x, i) => i !== index))
      setActiveIdx(i => Math.max(0, Math.min(i, images.length - 2)))
    } catch (err) {
      setStatus(`Error: ${err.message}`)
    }
  }

  async function submitPost() {
    // Category-aware field validation
    const s = parseStruct()
    const hasLoc = String(s.location || '').trim().length > 0
    const nPrice = Number(s.price)
    const hasPrice = !Number.isNaN(nPrice) && nPrice >= 0
    const hasPricing = ['Fixed Price', 'Negotiable'].includes(String(s.pricing_type || ''))
    const hasPhone = /^\+94\d{9}$/.test(String(s.phone || '').trim())
    const hasDesc = String(descriptionText || '').trim().length >= 20
    const hasSubCat = String(s.sub_category || '').trim().length > 0
    const hasCondition = (isVehicle || isMobile || isElectronic || isHomeGarden)
      ? String(s.condition || '').trim().length > 0
      : true

    if (isVehicle) {
      const hasModel = String(s.model_name || '').trim().length >= 2
      const nYear = Number(s.manufacture_year)
      const hasYear = Number.isFinite(nYear) && nYear >= 1950 && nYear <= 2100
      const validSubCats = new Set(['Bike','Car','Van','Bus'])
      const hasVehicleSubCat = validSubCats.has(String(s.sub_category || '').trim())

      if (!hasLoc || !hasPrice || !hasPricing || !hasPhone || !hasModel || !hasYear || !hasDesc || !hasVehicleSubCat || !hasCondition) {
        setStatus('Missing required fields. Please fill: Location, Condition, Price, Pricing Type, Phone (+94), Model Name, Manufacture Year (1950-2100), Vehicle Sub-category (Bike/Car/Van/Bus), and a Description (min 20 chars). AI auto-fill is disabled; enter values manually.')
        return
      }
    } else if (isMobile || isElectronic) {
      const hasModel = String(s.model_name || '').trim().length >= 2
      const nYear = Number(s.manufacture_year)
      const hasYear = Number.isFinite(nYear) && nYear >= 1980 && nYear <= 2100
      if (!hasLoc || !hasPrice || !hasPricing || !hasPhone || !hasDesc || !hasSubCat || !hasCondition || !hasModel || !hasYear) {
        setStatus('Missing required fields. Please fill: Location, Condition, Price, Pricing Type, Phone (+94), Model Name, Manufacture Year, Sub-category, and Description (min 20 chars).')
        return
      }
    } else if (isHomeGarden) {
      // Home & Garden: no model/year, but condition and sub-category are required
      if (!hasLoc || !hasPrice || !hasPricing || !hasPhone || !hasDesc || !hasSubCat || !hasCondition) {
        setStatus('Missing required fields. Please fill: Location, Condition, Price, Pricing Type, Phone (+94), Sub-category, and Description (min 20 chars).')
        return
      }
    } else if (isProperty) {
      // Property: require base commerce fields and sub-category (property type). No condition/model/year.
      if (!hasLoc || !hasPrice || !hasPricing || !hasPhone || !hasDesc || !hasSubCat) {
        setStatus('Missing required fields. Please fill: Location, Price, Pricing Type, Phone (+94), Property Type, and Description (min 20 chars).')
        return
      }
    } else if (isJob) {
      const hasEmpType = String(s.employment_type || '').trim().length > 0
      if (!hasLoc || !hasPhone || !hasDesc || !hasSubCat || !hasEmpType) {
        setStatus('For Job: please provide Location, Phone (+94), Employment Type, Job Sub-category (e.g., Driver), and a Description (min 20 chars). Salary is optional.')
        return
      }
    } else {
      // Other categories
      if (!hasLoc || !hasPrice || !hasPricing || !hasPhone || !hasDesc || !hasSubCat) {
        setStatus('Missing required fields. Please fill: Location, Price, Pricing Type, Phone (+94), Sub-category, and Description (min 20 chars).')
        return
      }
    }

    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null')
      const r = await fetch('/api/listings/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(user?.email ? { 'X-User-Email': user.email } : {}) },
        body: JSON.stringify({
          draftId,
          structured_json: structuredJSON,
          description: descriptionText
        })
      })
      const text = await r.text()
      const ct = r.headers.get('content-type') || ''
      const data = ct.includes('application/json') && text ? JSON.parse(text) : {}
      if (!r.ok) throw new Error((data && data.error) || 'Failed to submit')
      // Redirect to payment instructions page with listing ID
      const listingId = data.listingId
      if (listingId) {
        window.location.href = `/payment/${encodeURIComponent(listingId)}`
      } else {
        setStatus('Submitted. Redirecting...')
      }
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  async function generateDescription() {
    if (genUsed || genBusy) return;
    setGenBusy(true);
    setStatus(null);
    try {
      const r = await fetch('/api/listings/describe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId, structured_json: structuredJSON })
      });
      const text = await r.text();
      const ct = r.headers.get('content-type') || '';
      const data = ct.includes('application/json') && text ? JSON.parse(text) : {};
      if (!r.ok) throw new Error((data && data.error) || 'Failed to generate description');
      const desc = String(data.description || '').trim();
      if (!desc) throw new Error('Empty description');

      // Keep markdown-style **bold** so it renders in preview and on the listing page.
      setDescriptionText(desc);
      setGenUsed(true);
      try { localStorage.setItem(`desc_gen_used_${draftId}`, '1'); } catch (_) {}
    } catch (e) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setGenBusy(false);
    }
  }

  

  return (
    <div className="center">
      <div className="card">
        <div className="h1">Review & Publish</div>
        {!draft && <p className="text-muted">Loading draft...</p>}

        {draft && (
          <>
            <div className="grid two">
              <div>
                <div className="h2">Required Details</div>
                <div style={{ marginBottom: 6 }}>
                  <small className="text-muted">Please review and complete the details below.</small>
                </div>

                {/* Location (always required) */}
                <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Location</label>
                <input
                  className="input"
                  placeholder="Location (required)"
                  value={loc}
                  onChange={e => { const s = parseStruct(); s.location = e.target.value; patchStruct(s) }}
                />

                {/* Condition for categories that sell items */}
                {(isVehicle || isMobile || isElectronic || isHomeGarden) && (
                  <>
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Condition</label>
                    <select
                      className="select"
                      value={condition || ''}
                      onChange={e => { const s = parseStruct(); s.condition = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select condition</option>
                      <option value="Brand New">Brand New</option>
                      <option value="Used">Used</option>
                    </select>
                  </>
                )}

                {/* Category-specific fields */}
                {isVehicle && (
                  <>
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Price (required)"
                      value={price}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.price = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Pricing Type</label>
                    <select
                      className="select"
                      value={pricingType || ''}
                      onChange={e => { const s = parseStruct(); s.pricing_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select pricing type</option>
                      <option value="Fixed Price">Fixed Price</option>
                      <option value="Negotiable">Negotiable</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Phone</label>
                    <input
                      className="input"
                      placeholder="Phone (+94XXXXXXXXX)"
                      value={phone}
                      onChange={e => { const s = parseStruct(); s.phone = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Model Name</label>
                    <input
                      className="input"
                      placeholder="Model Name (required)"
                      value={modelName}
                      onChange={e => { const s = parseStruct(); s.model_name = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Manufacture Year</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Manufacture Year (required)"
                      value={year}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.manufacture_year = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Sub-category</label>
                    <select
                      className="select"
                      value={subCategory || ''}
                      onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                    >
                      <option value="">{subCategory ? subCategory : 'Select vehicle sub-category'}</option>
                      <option value="Bike">Bike</option>
                      <option value="Car">Car</option>
                      <option value="Van">Van</option>
                      <option value="Bus">Bus</option>
                    </select>
                    {!subCategory && (
                      <small className="text-muted">AI couldn't detect a sub-category. Please select one.</small>
                    )}

                    {/* Vehicle extra specs */}
                    <div className="card" style={{ marginTop: 8 }}>
                      <div className="h2" style={{ marginTop: 0 }}>Vehicle Specs</div>

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Mileage (km)</label>
                      <input
                        className="input"
                        type="number"
                        placeholder="e.g., 65000"
                        value={mileageKm}
                        onChange={e => { const s = parseStruct(); const v = e.target.value; s.mileage_km = v === '' ? '' : Number(v); patchStruct(s) }}
                      />

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Engine Capacity (cc)</label>
                      <input
                        className="input"
                        type="number"
                        placeholder="e.g., 1500"
                        value={engineCc}
                        onChange={e => { const s = parseStruct(); const v = e.target.value; s.engine_capacity_cc = v === '' ? '' : Number(v); patchStruct(s) }}
                      />

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Transmission</label>
                      <select
                        className="select"
                        value={transmission || ''}
                        onChange={e => { const s = parseStruct(); s.transmission = e.target.value; patchStruct(s) }}
                      >
                        <option value="">Select transmission</option>
                        <option value="Automatic">Automatic</option>
                        <option value="Manual">Manual</option>
                      </select>

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Colour</label>
                      <input
                        className="input"
                        placeholder="e.g., White"
                        value={colour}
                        onChange={e => { const s = parseStruct(); s.colour = e.target.value; patchStruct(s) }}
                      />

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Manufacturer</label>
                      <input
                        className="input"
                        placeholder="e.g., Toyota"
                        value={manufacturer}
                        onChange={e => { const s = parseStruct(); s.manufacturer = e.target.value; patchStruct(s) }}
                      />

                      <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Fuel Type</label>
                      <select
                        className="select"
                        value={fuelType || ''}
                        onChange={e => { const s = parseStruct(); s.fuel_type = e.target.value; patchStruct(s) }}
                      >
                        <option value="">Select fuel type</option>
                        <option value="Petrol">Petrol</option>
                        <option value="Diesel">Diesel</option>
                        <option value="Hybrid">Hybrid</option>
                        <option value="Electric">Electric</option>
                      </select>

                      <div style={{ marginTop: 8 }}>
                        <small className="text-muted">Please fill the specs manually. AI auto-fill has been disabled.</small>
                      </div>
                    </div>
                  </>
                )}

                {isJob && (
                  <>
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Salary</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Salary (optional)"
                      value={price}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.price = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Salary Type</label>
                    <select
                      className="select"
                      value={pricingType || ''}
                      onChange={e => { const s = parseStruct(); s.pricing_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select salary type</option>
                      <option value="Negotiable">Negotiable</option>
                      <option value="Fixed Price">Fixed Salary</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Phone</label>
                    <input
                      className="input"
                      placeholder="Phone (+94XXXXXXXXX)"
                      value={phone}
                      onChange={e => { const s = parseStruct(); s.phone = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Company</label>
                    <input
                      className="input"
                      placeholder="Company or employer name"
                      value={company}
                      onChange={e => { const s = parseStruct(); s.company = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Employment Type</label>
                    <select
                      className="select"
                      value={employmentType || ''}
                      onChange={e => { const s = parseStruct(); s.employment_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select employment type</option>
                      <option value="Full-time">Full-time</option>
                      <option value="Part-time">Part-time</option>
                      <option value="Contract">Contract</option>
                      <option value="Internship">Internship</option>
                      <option value="Temporary">Temporary</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Job Sub-category</label>
                    <select
                      className="select"
                      value={subCategory || ''}
                      onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select job sub-category</option>
                      <option value="Driver">Driver</option>
                      <option value="IT/Software">IT/Software</option>
                      <option value="Sales/Marketing">Sales/Marketing</option>
                      <option value="Education">Education</option>
                      <option value="Logistics/Delivery">Logistics/Delivery</option>
                      <option value="Accounting/Finance">Accounting/Finance</option>
                      <option value="Healthcare">Healthcare</option>
                      <option value="Construction/Trades">Construction/Trades</option>
                      <option value="Customer Service">Customer Service</option>
                      <option value="Security">Security</option>
                      <option value="Cleaning/Housekeeping">Cleaning/Housekeeping</option>
                      <option value="Other">Other</option>
                    </select>
                  </>
                )}

                {isProperty && (
                  <>
                    {/* Address (extra) */}
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Address</label>
                    <input
                      className="input"
                      placeholder="Street/Area, City (optional)"
                      value={address}
                      onChange={e => { const s = parseStruct(); s.address = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Price (required)"
                      value={price}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.price = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Pricing Type</label>
                    <select
                      className="select"
                      value={pricingType || ''}
                      onChange={e => { const s = parseStruct(); s.pricing_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select pricing type</option>
                      <option value="Fixed Price">Fixed Price</option>
                      <option value="Negotiable">Negotiable</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Phone</label>
                    <input
                      className="input"
                      placeholder="Phone (+94XXXXXXXXX)"
                      value={phone}
                      onChange={e => { const s = parseStruct(); s.phone = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Property Type</label>
                    <select
                      className="select"
                      value={subCategory || ''}
                      onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select property type</option>
                      <option value="House">House</option>
                      <option value="Apartment">Apartment</option>
                      <option value="Land">Land</option>
                      <option value="Room/Annex">Room/Annex</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Other">Other</option>
                    </select>

                    {/* Land-specific extras */}
                    {String(subCategory) === 'Land' && (
                      <>
                        <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Land type</label>
                        <input
                          className="input"
                          placeholder="e.g., Residential, Agricultural, Commercial"
                          value={landType}
                          onChange={e => { const s = parseStruct(); s.land_type = e.target.value; patchStruct(s) }}
                        />

                        <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Land size</label>
                        <input
                          className="input"
                          placeholder="e.g., 10 perches or 1 acre"
                          value={landSize}
                          onChange={e => { const s = parseStruct(); s.land_size = e.target.value; patchStruct(s) }}
                        />
                      </>
                    )}

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Bedrooms</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Bedrooms (optional)"
                      value={bedrooms}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.bedrooms = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Bathrooms</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Bathrooms (optional)"
                      value={bathrooms}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.bathrooms = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Size</label>
                    <input
                      className="input"
                      placeholder="Size (e.g., 1200 sqft or 10 perches)"
                      value={sizeText}
                      onChange={e => { const s = parseStruct(); s.size = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Furnishing</label>
                    <select
                      className="select"
                      value={furnishing || ''}
                      onChange={e => { const s = parseStruct(); s.furnishing = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select furnishing (optional)</option>
                      <option value="Unfurnished">Unfurnished</option>
                      <option value="Semi-furnished">Semi-furnished</option>
                      <option value="Fully furnished">Fully furnished</option>
                    </select>

                    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <input
                        id="parking"
                        type="checkbox"
                        checked={parking}
                        onChange={e => { const s = parseStruct(); s.parking = e.target.checked; patchStruct(s) }}
                      />
                      <label htmlFor="parking" className="text-muted">Parking available</label>
                    </div>
                  </>
                )}

                {(isMobile || isElectronic || isHomeGarden) && (
                  <>
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Price (required)"
                      value={price}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.price = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Pricing Type</label>
                    <select
                      className="select"
                      value={pricingType || ''}
                      onChange={e => { const s = parseStruct(); s.pricing_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select pricing type</option>
                      <option value="Fixed Price">Fixed Price</option>
                      <option value="Negotiable">Negotiable</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Phone</label>
                    <input
                      className="input"
                      placeholder="Phone (+94XXXXXXXXX)"
                      value={phone}
                      onChange={e => { const s = parseStruct(); s.phone = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Model Name</label>
                    <input
                      className="input"
                      placeholder="Model Name (required)"
                      value={modelName}
                      onChange={e => { const s = parseStruct(); s.model_name = e.target.value; patchStruct(s) }}
                    />
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Brand</label>
                    <input
                      className="input"
                      placeholder="Brand (optional)"
                      value={brand}
                      onChange={e => { const s = parseStruct(); s.brand = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Manufacture Year</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Manufacture Year (required)"
                      value={year}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.manufacture_year = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Condition</label>
                    <select
                      className="select"
                      value={condition || ''}
                      onChange={e => { const s = parseStruct(); s.condition = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select condition</option>
                      <option value="Brand New">Brand New</option>
                      <option value="Used">Used</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Sub-category</label>
                    <div className="grid two">
                      <select
                        className="select"
                        value={subCategory || ''}
                        onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                      >
                        <option value="">
                          {isMobile ? 'Select mobile sub-category' : isElectronic ? 'Select electronic sub-category' : 'Select home & garden sub-category'}
                        </option>
                        {/* Mobile options */}
                        {isMobile && (
                          <>
                            <option value="Smartphone">Smartphone</option>
                            <option value="Feature Phone">Feature Phone</option>
                            <option value="Tablet">Tablet</option>
                            <option value="Smartwatch">Smartwatch</option>
                            <option value="Accessories">Accessories</option>
                          </>
                        )}
                        {/* Electronic options */}
                        {isElectronic && (
                          <>
                            <option value="Laptop">Laptop</option>
                            <option value="Desktop">Desktop</option>
                            <option value="TV">TV</option>
                            <option value="Camera">Camera</option>
                            <option value="Audio">Audio</option>
                            <option value="Appliances">Appliances</option>
                            <option value="Accessories">Accessories</option>
                          </>
                        )}
                        {/* Home & Garden options */}
                        {isHomeGarden && (
                          <>
                            <option value="Furniture">Furniture</option>
                            <option value="Kitchen">Kitchen</option>
                            <option value="Garden Tools">Garden Tools</option>
                            <option value="Decor">Decor</option>
                            <option value="Appliances">Appliances</option>
                            <option value="Other">Other</option>
                          </>
                        )}
                        {/* Fallback other for any */}
                        {!isHomeGarden && !isMobile && !isElectronic && <option value="Other">Other</option>}
                      </select>
                      <input
                        className="input"
                        placeholder="Or type a custom sub-category"
                        value={subCategory}
                        onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                      />
                    </div>
                    {!subCategory && (
                      <small className="text-muted">Pick a suggested option or type your own sub-category.</small>
                    )}
                    {subCategory && (
                      <small className="text-muted">You can edit the sub-category if needed.</small>
                    )}
                  </>
                )}

                {!isVehicle && !isJob && !isProperty && !(isMobile || isElectronic || isHomeGarden) && (
                  <>
                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Price</label>
                    <input
                      className="input"
                      type="number"
                      placeholder="Price (required)"
                      value={price}
                      onChange={e => { const s = parseStruct(); const v = e.target.value; s.price = v === '' ? '' : Number(v); patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Pricing Type</label>
                    <select
                      className="select"
                      value={pricingType || ''}
                      onChange={e => { const s = parseStruct(); s.pricing_type = e.target.value; patchStruct(s) }}
                    >
                      <option value="">Select pricing type</option>
                      <option value="Fixed Price">Fixed Price</option>
                      <option value="Negotiable">Negotiable</option>
                    </select>

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Phone</label>
                    <input
                      className="input"
                      placeholder="Phone (+94XXXXXXXXX)"
                      value={phone}
                      onChange={e => { const s = parseStruct(); s.phone = e.target.value; patchStruct(s) }}
                    />

                    <label className="text-muted" style={{ display: 'block', marginTop: 8 }}>Sub-category</label>
                    <input
                      className="input"
                      placeholder="Enter sub-category"
                      value={subCategory}
                      onChange={e => { const s = parseStruct(); s.sub_category = e.target.value; patchStruct(s) }}
                    />
                    {!subCategory && (
                      <small className="text-muted">AI couldn't detect a sub-category. Please provide one.</small>
                    )}
                    {subCategory && (
                      <small className="text-muted">You can edit the sub-category if needed.</small>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="h2" style={{ marginTop: 12 }}>Description</div>

            {!genUsed && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={generateDescription}
                  disabled={genBusy}
                  aria-label="Generate description"
                >
                  {genBusy ? 'Generating…' : 'Generate Description ✨'}
                </button>
                {genBusy && (
                  <div
                    aria-hidden="true"
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: '3px solid rgba(108,127,247,0.2)',
                      borderTopColor: '#6c7ff7',
                      animation: 'spin 1s linear infinite'
                    }}
                  />
                )}
                <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                <small className="text-muted">One-time use. Adds emojis and bullet points for clarity.</small>
              </div>
            )}

            <label className="text-muted" style={{ display: 'block', marginTop: 6 }}>Description</label>
            <textarea
              className="input"
              placeholder="Description (required)"
              value={descriptionText}
              onChange={e => setDescriptionText(e.target.value)}
              rows={6}
              style={{ marginTop: 6 }}
            />
            {/* Live preview with **bold** and line breaks */}
            {descriptionText && (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="h2" style={{ marginTop: 0 }}>Preview</div>
                <div
                  dangerouslySetInnerHTML={(() => {
                    try {
                      let s = String(descriptionText || '');
                      // Escape HTML
                      s = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                      // **bold**
                      s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                      // Preserve line breaks
                      s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '<br/>');
                      return { __html: s };
                    } catch (_) {
                      return { __html: String(descriptionText || '') };
                    }
                  })()}
                />
              </div>
            )}

            <div className="h2" style={{ marginTop: 12 }}>Images</div>

            {/* NewListing-style image slots */}
            <div>
              <input
                ref={slotFileInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={onSlotFileChange}
              />
              <div className="grid five" style={{ gap: 10 }}>
                {Array.from({ length: maxImages }).map((_, i) => {
                  const hasImg = !!images[i]
                  const url = hasImg ? (images[i].url || (/[^\\/]+$/.exec(String(images[i].path || '')) ? `/uploads/${/[^\\/]+$/.exec(String(images[i].path || ''))[0]}` : '')) : null
                  return (
                    <div
                      key={i}
                      className="card"
                      style={{ padding: 0, position: 'relative', height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                      onClick={() => openPickerForSlot(i)}
                    >
                      {hasImg && url ? (
                        <>
                          <img
                            src={url}
                            alt={`image-${i + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
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
                {Math.min(images.length, maxImages)}/{maxImages} selected
              </div>
            </div>

            <div style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={submitPost}>Publish</button>
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
