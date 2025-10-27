import React, { useEffect, useMemo, useState } from 'react';
import CustomSelect from '../components/CustomSelect.jsx';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../components/i18n.jsx';

const CATEGORIES = ['Vehicle', 'Property', 'Job', 'Electronic', 'Mobile', 'Home Garden', 'Other'];

export default function WantedBoardPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [userEmail, setUserEmail] = useState('');
  const [tab, setTab] = useState('browse'); // 'browse' | 'post' | 'mine'
  const [loading, setLoading] = useState(false);

  // Browse data
  const [requests, setRequests] = useState([]);
  const [myRequests, setMyRequests] = useState([]);

  // My listings (for sellers to offer against requests)
  const [myListings, setMyListings] = useState([]);
  const [offerSelections, setOfferSelections] = useState({}); // wantedId -> listingId
  const [offerSending, setOfferSending] = useState({}); // wantedId -> boolean

  // Browse filters (home page style)
  const [showFilters, setShowFilters] = useState(false);
  const [localFilter, setLocalFilter] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterPriceMin, setFilterPriceMin] = useState('');
  const [filterPriceMax, setFilterPriceMax] = useState('');
  const [browseFiltersDef, setBrowseFiltersDef] = useState({ keys: [], valuesByKey: {} });
  const [browseFilters, setBrowseFilters] = useState({});
  const [modelQuery, setModelQuery] = useState('');
  const modelSelected = Array.isArray(browseFilters.model) ? browseFilters.model : [];
  const jobTypeSelected = Array.isArray(browseFilters.job_type) ? browseFilters.job_type : [];
  const [locQuery, setLocQuery] = useState('');
  const [locSuggestions, setLocSuggestions] = useState([]);
  const [locationOptionsCache, setLocationOptionsCache] = useState([]);

  // Form state (dynamic)
  const [form, setForm] = useState({
    title: '',
    category: '',
    description: ''
  });
  const [locations, setLocations] = useState([]);
  const [locInput, setLocInput] = useState('');
  const [locSuggestedValue, setLocSuggestedValue] = useState('');
  const [models, setModels] = useState([]);
  const [modelInput, setModelInput] = useState('');
  const [modelSuggestedValue, setModelSuggestedValue] = useState('');
  const [jobTypes, setJobTypes] = useState([]);
  const [jobTypeInput, setJobTypeInput] = useState('');
  const [jobTypeSuggestedValue, setJobTypeSuggestedValue] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [priceNoMatter, setPriceNoMatter] = useState(false);

  // Dynamic filters derived from existing listings by category (for post form)
  const [filtersMeta, setFiltersMeta] = useState({ keys: [], valuesByKey: {} });
  const [filterKey, setFilterKey] = useState('');
  const [filterSuggestedValue, setFilterSuggestedValue] = useState('');
  const [filterCustomValue, setFilterCustomValue] = useState('');
  const [selectedFilters, setSelectedFilters] = useState({}); // key -> [values]

  const [postStatus, setPostStatus] = useState({ ok: false, message: '' });

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      setUserEmail(user?.email || '');
    } catch (_) {
      setUserEmail('');
    }
  }, []);

  useEffect(() => {
    loadRequests();
    if (userEmail) {
      loadMyListings();
      loadMyRequests();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userEmail]);

  // Load dynamic filters for the selected category in POST form
  useEffect(() => {
    async function loadFilters() {
      if (!form.category) {
        setFiltersMeta({ keys: [], valuesByKey: {} });
        setSelectedFilters({});
        setFilterKey('');
        setFilterSuggestedValue('');
        setFilterCustomValue('');
        return;
      }
      try {
        const r = await fetch(`/api/listings/filters?category=${encodeURIComponent(form.category)}`);
        const data = await r.json();
        if (r.ok && Array.isArray(data.keys) && data.valuesByKey) {
          setFiltersMeta({ keys: data.keys, valuesByKey: data.valuesByKey });
        } else {
          setFiltersMeta({ keys: [], valuesByKey: {} });
        }
      } catch (_) {
        setFiltersMeta({ keys: [], valuesByKey: {} });
      }
      // reset selections when category changes
      setSelectedFilters({});
      setFilterKey('');
      setFilterSuggestedValue('');
      setFilterCustomValue('');
      setModelSuggestedValue('');
      setLocSuggestedValue('');
      setJobTypeSuggestedValue('');
    }
    loadFilters();
  }, [form.category]);

  // Load dynamic filters for BROWSE derived from Wanted ads (not listings)
  useEffect(() => {
    try {
      const valuesByKey = {};
      const seenKeys = new Set();

      const relevant = (requests || []).filter(r => {
        return !filterCategory || String(r.category || '') === String(filterCategory);
      });

      for (const r of relevant) {
        // Parse filters_json from wanted requests
        const f = (() => { try { return JSON.parse(String(r.filters_json || '{}')) || {}; } catch (_) { return {}; } })();
        for (const [k, v] of Object.entries(f)) {
          const key = String(k).trim();
          if (!key) continue;
          seenKeys.add(key);
          const arr = Array.isArray(v) ? v : [v];
          for (const val of arr) {
            const s = String(val || '').trim();
            if (!s) continue;
            if (!Array.isArray(valuesByKey[key])) valuesByKey[key] = [];
            if (!valuesByKey[key].includes(s)) valuesByKey[key].push(s);
          }
        }
        // Include models_json and job_types_json explicitly
        const modelsArr = (() => { try { return JSON.parse(String(r.models_json || '[]')) || []; } catch (_) { return []; } })();
        if (Array.isArray(modelsArr) && modelsArr.length) {
          const key = 'model';
          seenKeys.add(key);
          for (const m of modelsArr) {
            const s = String(m || '').trim();
            if (!s) continue;
            if (!Array.isArray(valuesByKey[key])) valuesByKey[key] = [];
            if (!valuesByKey[key].includes(s)) valuesByKey[key].push(s);
          }
        }
        const jobTypesArr = (() => { try { return JSON.parse(String(r.job_types_json || '[]')) || []; } catch (_) { return []; } })();
        if (Array.isArray(jobTypesArr) && jobTypesArr.length && String(r.category || '') === 'Job') {
          const key = 'job_type';
          seenKeys.add(key);
          for (const jt of jobTypesArr) {
            const s = String(jt || '').trim();
            if (!s) continue;
            if (!Array.isArray(valuesByKey[key])) valuesByKey[key] = [];
            if (!valuesByKey[key].includes(s)) valuesByKey[key].push(s);
          }
        }
      }

      const keys = Array.from(seenKeys);
      setBrowseFiltersDef({ keys, valuesByKey });
      // Reset input queries when category changes
      setModelQuery('');
      if (!filterCategory) {
        setBrowseFilters({});
      }
    } catch (_) {
      setBrowseFiltersDef({ keys: [], valuesByKey: {} });
    }
  }, [filterCategory, requests]);

  // Location suggestions for browse (debounced)
  useEffect(() => {
    const term = (locQuery || '').trim();
    if (!term) { setLocSuggestions([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/listings/locations?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data = await r.json();
        if (r.ok) setLocSuggestions(Array.isArray(data.results) ? data.results : []);
      } catch (_) {}
    }, 250);
    return () => { ctrl.abort(); clearTimeout(timer); };
  }, [locQuery]);

  // Keep a stable cache of locations for browse so options don't shrink
  useEffect(() => {
    const vals = (browseFiltersDef?.valuesByKey?.['location'] || []).map(v => String(v).trim()).filter(Boolean);
    if (vals.length) {
      setLocationOptionsCache(Array.from(new Set(vals)));
      return;
    }
    const fromRequests = Array.from(new Set(
      (requests || []).flatMap(r => {
        const arr = (() => { try { return JSON.parse(String(r.locations_json || '[]')) || []; } catch (_) { return []; } })();
        return [...arr, r.location].map(v => String(v || '').trim()).filter(Boolean);
      })
    ));
    if (fromRequests.length) {
      setLocationOptionsCache(prev => {
        const merged = [...prev];
        for (const v of fromRequests) if (!merged.includes(v)) merged.push(v);
        return merged;
      });
    }
  }, [browseFiltersDef, requests]);

  // Keep locQuery loosely synced with current filterLocation
  useEffect(() => {
    setLocQuery(String(filterLocation || '').trim());
  }, [filterLocation]);

  async function loadRequests() {
    setLoading(true);
    try {
      const r = await fetch('/api/wanted?limit=100');
      const data = await r.json();
      const rows = Array.isArray(data.results) ? data.results : [];
      setRequests(rows);
    } catch (_) {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }

  function buildAuthHeaders(extra = {}) {
    let headers = { ...extra };
    try {
      const token = localStorage.getItem('auth_token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch (_) {}
    if (userEmail) headers['X-User-Email'] = userEmail;
    return headers;
  }

  async function loadMyListings() {
    if (!userEmail) return;
    try {
      const r = await fetch('/api/listings/my', { headers: buildAuthHeaders() });
      const data = await r.json();
      const rows = Array.isArray(data.results) ? data.results : [];
      setMyListings(rows);
    } catch (_) {
      setMyListings([]);
    }
  }

  function addLocation() {
    const v = String(locInput || locSuggestedValue || '').trim();
    if (!v) return;
    setLocations(prev => (prev.includes(v) ? prev : [...prev, v]));
    setLocInput('');
    setLocSuggestedValue('');
  }
  function removeLocation(v) {
    setLocations(prev => prev.filter(x => x !== v));
  }
  function addModel() {
    const v = String(modelInput || modelSuggestedValue || '').trim();
    if (!v) return;
    setModels(prev => (prev.includes(v) ? prev : [...prev, v]));
    setModelInput('');
    setModelSuggestedValue('');
  }
  function removeModel(v) {
    setModels(prev => prev.filter(x => x !== v));
  }
  function addJobType() {
    const v = String(jobTypeInput || jobTypeSuggestedValue || '').trim();
    if (!v) return;
    setJobTypes(prev => (prev.includes(v) ? prev : [...prev, v]));
    setJobTypeInput('');
    setJobTypeSuggestedValue('');
  }
  function removeJobType(v) {
    setJobTypes(prev => prev.filter(x => x !== v));
  }

  function addFilterValue() {
    const key = String(filterKey || '').trim();
    const val = String(filterCustomValue || filterSuggestedValue || '').trim();
    if (!key || !val) return;
    setSelectedFilters(prev => {
      const arr = prev[key] || [];
      if (arr.includes(val)) return prev;
      return { ...prev, [key]: [...arr, val] };
    });
    setFilterSuggestedValue('');
    setFilterCustomValue('');
  }
  function removeFilterValue(key, val) {
    setSelectedFilters(prev => {
      const arr = (prev[key] || []).filter(x => x !== val);
      const next = { ...prev };
      if (arr.length === 0) delete next[key];
      else next[key] = arr;
      return next;
    });
  }
  function removeFilterKey(key) {
    setSelectedFilters(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // Renders chips for currently selected dynamic filters with remove controls
  function renderSelectedFiltersChips() {
    const entries = Object.entries(selectedFilters || {});
    if (!entries.length) return null;
    return (
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {entries.map(([k, arr]) => {
          const values = Array.isArray(arr) ? arr : [];
          if (!values.length) return null;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <strong>{k}</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {values.map((v, idx) => (
                  <span key={idx} className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {v}
                    <button
                      type="button"
                      className="back-btn"
                      onClick={() => removeFilterValue(k, v)}
                      title="Remove"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <button
                type="button"
                className="btn"
                onClick={() => removeFilterKey(k)}
                title="Clear this filter"
                aria-label="Clear this filter"
              >
                Clear {k}
              </button>
            </div>
          );
        })}
      </div>
    );
  }

  // Helpers for browse
  function parseArray(jsonText) {
    try {
      const arr = JSON.parse(String(jsonText || '[]'));
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }
  function parseFilters(jsonText) {
    try {
      const obj = JSON.parse(String(jsonText || '{}'));
      return obj && typeof obj === 'object' ? obj : {};
    } catch (_) {
      return {};
    }
  }

  
  const modelOptions = useMemo(() => {
    const q = (modelQuery || '').toLowerCase().trim();
    // Build dynamic model list from Wanted ads instead of homepage/listings filters
    const fromRequests = Array.from(new Set(
      (requests || [])
        .filter(r => !filterCategory || String(r.category || '') === String(filterCategory))
        .flatMap(r => parseArray(r.models_json).map(v => String(v).trim()).filter(Boolean))
    ));
    const arr = fromRequests;
    if (!q) return arr.slice(0, 25);
    return arr.filter(v => v.toLowerCase().includes(q)).slice(0, 25);
  }, [requests, filterCategory, modelQuery]);

  // Job type options derived from Wanted ads (dynamic, independent of backend keys)
  const jobTypeOptions = useMemo(() => {
    const fromRequests = Array.from(new Set(
      (requests || [])
        .filter(r => (!filterCategory || String(r.category || '') === String(filterCategory)) && String(r.category || '') === 'Job')
        .flatMap(r => parseArray(r.job_types_json).map(v => String(v).trim()).filter(Boolean))
    ));
    return fromRequests;
  }, [requests, filterCategory]);

  function updateBrowseFilter(key, value) {
    setBrowseFilters(prev => ({ ...prev, [key]: value }));
  }

  function resetBrowseFilters() {
    try {
      setFilterCategory('');
      setFilterLocation('');
      setFilterPriceMin('');
      setFilterPriceMax('');
      setBrowseFilters({});
      setShowFilters(false);
      setLocationOptionsCache([]);
      setLocalFilter('');
    } catch (_) {}
  }

  const hasActiveBrowseFilters = useMemo(() => {
    return !!(filterCategory || filterLocation || filterPriceMin || filterPriceMax || localFilter || Object.keys(browseFilters).length);
  }, [filterCategory, filterLocation, filterPriceMin, filterPriceMax, localFilter, browseFilters]);

  const filteredRequests = useMemo(() => {
    const t = (localFilter || '').toLowerCase().trim();
    return (requests || []).filter(r => {
      if (r.status !== 'open') return false;
      const locs = parseArray(r.locations_json);
      const modelsArr = parseArray(r.models_json);
      const filtersObj = parseFilters(r.filters_json);
      const jobTypesArr = parseArray(r.job_types_json);

      const textParts = [
        r.title || '',
        r.category || '',
        r.description || '',
        String(r.location || ''),
        locs.join(' '),
        modelsArr.join(' '),
        jobTypesArr.join(' '),
        Object.values(filtersObj || {}).map(v => Array.isArray(v) ? v.join(' ') : String(v)).join(' ')
      ];
      const textMatch = t ? textParts.join(' ').toLowerCase().includes(t) : true;

      const categoryOk = filterCategory ? (r.category || '') === filterCategory : true;

      const locationOk = filterLocation
        ? (() => {
            const target = String(filterLocation).toLowerCase();
            const inSingle = String(r.location || '').toLowerCase().includes(target);
            const inArray = locs.some(v => String(v || '').toLowerCase().includes(target));
            return inSingle || inArray;
          })()
        : true;

      // Price range overlap logic (budget semantics)
      const priceOk = (() => {
        if (!filterPriceMin && !filterPriceMax) return true;
        if (r.price_not_matter) return true;
        const pmn = typeof r.price_min === 'number' ? r.price_min : null;
        const pmx = typeof r.price_max === 'number' ? r.price_max : null;
        let minOk = true, maxOk = true;
        if (filterPriceMin) {
          const fmin = Number(filterPriceMin);
          minOk = (pmx == null) || (pmx >= fmin);
        }
        if (filterPriceMax) {
          const fmax = Number(filterPriceMax);
          maxOk = (pmn == null) || (pmn <= fmax);
        }
        return minOk && maxOk;
      })();

      // Structured filters AND logic
      let structuredOk = true;
      if (Object.keys(browseFilters).length) {
        for (const [k, v] of Object.entries(browseFilters)) {
          const key = String(k);
          const val = v;
          if (key === 'sub_category') {
            const arr = Array.isArray(val) ? val : [val];
            const targetArr = Array.isArray(filtersObj.sub_category) ? filtersObj.sub_category.map(x => String(x).toLowerCase()) : [];
            for (const x of arr) {
              if (!targetArr.includes(String(x).toLowerCase())) { structuredOk = false; break; }
            }
            if (!structuredOk) break;
          } else if (key === 'model') {
            const arr = Array.isArray(val) ? val : [val];
            const targetArr = modelsArr.map(x => String(x).toLowerCase());
            for (const x of arr) {
              if (!targetArr.includes(String(x).toLowerCase())) { structuredOk = false; break; }
            }
            if (!structuredOk) break;
          } else if (key === 'job_type') {
            const arr = Array.isArray(val) ? val : [val];
            const targetArr = jobTypesArr.map(x => String(x).toLowerCase());
            for (const x of arr) {
              if (!targetArr.includes(String(x).toLowerCase())) { structuredOk = false; break; }
            }
            if (!structuredOk) break;
          } else if (key === 'location') {
            // Each selected location must exist in either main location or locations_json
            const arr = Array.isArray(val) ? val : [val];
            const targetSingle = String(r.location || '').toLowerCase();
            const targetArr = locs.map(x => String(x).toLowerCase());
            for (const x of arr) {
              const needle = String(x || '').toLowerCase();
              if (!(targetSingle.includes(needle) || targetArr.some(t => t.includes(needle)))) { structuredOk = false; break; }
            }
            if (!structuredOk) break;
          } else {
            const target = filtersObj[key];
            if (Array.isArray(val)) {
              const targetArr = Array.isArray(target) ? target.map(x => String(x).toLowerCase()) : [];
              for (const x of val) {
                if (!targetArr.includes(String(x).toLowerCase())) { structuredOk = false; break; }
              }
              if (!structuredOk) break;
            } else {
              const targetStr = String(target || '').toLowerCase();
              const valStr = String(val || '').toLowerCase();
              if (valStr && targetStr !== valStr) { structuredOk = false; break; }
            }
          }
        }
      }

      return textMatch && categoryOk && locationOk && priceOk && structuredOk;
    });
  }, [requests, localFilter, filterCategory, filterLocation, filterPriceMin, filterPriceMax, browseFilters]);

  // Numbered pagination (same design/behaviour as HomePage)
  const [page, setPage] = useState(1);
  const limit = 10;

  // Reset to page 1 when filters/search change
  useEffect(() => {
    setPage(1);
  }, [localFilter, filterCategory, filterLocation, filterPriceMin, filterPriceMax, browseFilters]);

  const totalPages = Math.max(1, Math.ceil(filteredRequests.length / limit));
  const startIdx = (page - 1) * limit;
  const endIdx = startIdx + limit;
  const visibleRequests = filteredRequests.slice(startIdx, endIdx);

  const pageWindow = [page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1 && p <= totalPages);

  const filteredKeysForUI = (filtersMeta.keys || []).filter(k => !['location', 'pricing_type', 'price', 'phone', 'model', 'job_type', 'sub_category'].includes(k));

  // Helpers and missing handlers

  // Render array as chips with remove buttons
  function renderChips(items, onRemove) {
    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        {arr.map((v, idx) => (
          <span key={`${String(v)}-${idx}`} className="pill" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {String(v)}
            <button
              type="button"
              className="back-btn"
              onClick={() => onRemove(v)}
              title="Remove"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    );
  }

  // Load my wanted requests for the "mine" tab
  async function loadMyRequests() {
    if (!userEmail) { setMyRequests([]); return; }
    try {
      const r = await fetch('/api/wanted/my', { headers: buildAuthHeaders() });
      const data = await r.json();
      setMyRequests(Array.isArray(data.results) ? data.results : []);
    } catch (_) {
      setMyRequests([]);
    }
  }

  // Can current user offer one of their listings
  const canOffer = useMemo(() => {
    return !!(userEmail && myListings && myListings.length > 0);
  }, [userEmail, myListings]);

  // Send an offer (seller responds to a wanted request)
  async function sendOffer(wantedId) {
    const lid = Number(offerSelections[wantedId] || 0);
    if (!userEmail) { alert('Please login first.'); return; }
    if (!lid) { alert('Select one of your ads to offer.'); return; }
    setOfferSending(prev => ({ ...prev, [wantedId]: true }));
    try {
      const r = await fetch('/api/wanted/respond', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ wanted_id: wantedId, listing_id: lid, message: '' })
      });
      const data = await r.json();
      if (!r.ok) {
        alert(data?.error || 'Failed to send offer');
      } else {
        alert('Offer sent');
      }
    } catch (_) {
      alert('Failed to send offer');
    } finally {
      setOfferSending(prev => ({ ...prev, [wantedId]: false }));
    }
  }

  // Close my wanted request
  async function closeRequest(id) {
    if (!userEmail) { alert('Please login first.'); return; }
    try {
      const r = await fetch(`/api/wanted/${id}/close`, {
        method: 'POST',
        headers: buildAuthHeaders()
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        alert(data?.error || 'Failed to close request');
      } else {
        await loadMyRequests();
      }
    } catch (_) {
      alert('Failed to close request');
    }
  }

  // Submit a new wanted request
  async function submitForm(e) {
    e.preventDefault();
    if (loading) return;
    setPostStatus({ ok: false, message: '' });
    setLoading(true);
    try {
      const payload = {
        title: String(form.title || '').trim(),
        description: String(form.description || '').trim(),
        category: String(form.category || '').trim(),
        locations: Array.isArray(locations) ? locations : [],
        models: Array.isArray(models) ? models : [],
        year_min: yearMin ? Number(yearMin) : null,
        year_max: yearMax ? Number(yearMax) : null,
        price_min: priceMin ? Number(priceMin) : null,
        price_max: priceMax ? Number(priceMax) : null,
        price_not_matter: !!priceNoMatter,
        filters: selectedFilters
      };
      const r = await fetch('/api/wanted', {
        method: 'POST',
        headers: buildAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok) {
        setPostStatus({ ok: false, message: data?.error || 'Failed to post request' });
      } else {
        setPostStatus({ ok: true, message: 'Request posted successfully' });
        // reset form minimally
        setForm({ title: '', category: '', description: '' });
        setLocations([]);
        setModels([]);
        setJobTypes([]);
        setYearMin('');
        setYearMax('');
        setPriceMin('');
        setPriceMax('');
        setPriceNoMatter(false);
        setSelectedFilters({});
        setFilterKey('');
        setFilterSuggestedValue('');
        setFilterCustomValue('');
        // refresh lists
        await loadRequests();
        await loadMyRequests();
        setTab('mine');
      }
    } catch (_) {
      setPostStatus({ ok: false, message: 'Failed to post request' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="center">
      {/* Hero header to match HomePage */}
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
          <h1 className="h1" style={{ textAlign: 'center', marginBottom: 8 }}>{t('wanted.title')}</h1>
          <p className="text-muted" style={{ textAlign: 'center', marginTop: 0 }}>
            {t('wanted.subtitle')}
          </p>

          {/* Quick categories (same style as Home) */}
          <div className="quick-cats" style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className={`btn ${filterCategory === 'Vehicle' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Vehicle'); setShowFilters(true); }}>🚗 Vehicles</button>
            <button className={`btn ${filterCategory === 'Property' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Property'); setShowFilters(true); }}>🏠 Property</button>
            
            <button className={`btn ${filterCategory === 'Electronic' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Electronic'); setShowFilters(true); }}>🔌 Electronic</button>
            <button className={`btn ${filterCategory === 'Mobile' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Mobile'); setShowFilters(true); }}>📱 Mobile</button>
            <button className={`btn ${filterCategory === 'Home Garden' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Home Garden'); setShowFilters(true); }}>🏡 Home&nbsp;Garden</button>
            <button className={`btn ${filterCategory === 'Job' ? 'accent' : ''}`} type="button" onClick={() => { setFilterCategory('Job'); setShowFilters(true); }}>💼 Job</button>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className={`btn ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>{t('wanted.tabBrowse')}</button>
            <button className={`btn ${tab === 'post' ? 'active' : ''}`} onClick={() => setTab('post')}>{t('wanted.tabPost')}</button>
            <button className={`btn ${tab === 'mine' ? 'active' : ''}`} onClick={() => setTab('mine')}>{t('wanted.tabMine')}</button>
          </div>
        </div>
      </div>

      {tab === 'browse' && (
        <div style={{ padding: 18 }}>
          {/* Filters dropdown toggle */}
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <div>
              {hasActiveBrowseFilters && (
                <button className="btn compact" type="button" onClick={resetBrowseFilters} title="Reset all filters" style={{ flex: '0 0 auto' }}>
                  {t('common.resetFilters')}
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="input"
                placeholder="Search requests..."
                value={localFilter}
                onChange={e => setLocalFilter(e.target.value)}
                style={{ minWidth: 200 }}
              />
              <button className="btn" type="button" onClick={() => setShowFilters(s => !s)}>
                {showFilters ? t('common.hideFilters') : t('common.filters')}
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
                      { value: 'Job', label: 'Job' },
                    ]}
                  />
                </div>
                <div>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Location</div>
                  {/* Multi-location tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                    {(Array.isArray(browseFilters.location) ? browseFilters.location : []).map((tag, idx) => (
                      <span key={`loc-${tag}-${idx}`} className="pill">
                        {tag}
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            const cur = Array.isArray(browseFilters.location) ? browseFilters.location : [];
                            const next = cur.filter((t, i) => !(t === tag && i === idx));
                            updateBrowseFilter('location', next);
                          }}
                          aria-label="Remove"
                          style={{ padding: '2px 6px', marginLeft: 6 }}
                        >✕</button>
                      </span>
                    ))}
                  </div>
                  {/* Add location via CustomSelect (keeps single-select control, appends to tags) */}
                  <CustomSelect
                    value=""
                    onChange={(val) => {
                      const v = String(val || '').trim();
                      if (!v) return;
                      const cur = Array.isArray(browseFilters.location) ? browseFilters.location : [];
                      const next = Array.from(new Set([...cur, v]));
                      updateBrowseFilter('location', next);
                    }}
                    ariaLabel="Add location"
                    placeholder="Add location..."
                    options={(() => {
                      const cached = Array.from(new Set((locationOptionsCache || []).map(v => String(v).trim()).filter(Boolean)));
                      const fromSuggest = Array.from(new Set((locSuggestions || []).map(v => String(v).trim()).filter(Boolean)))
                        .filter(v => !cached.includes(v));
                      const merged = [...cached, ...fromSuggest];
                      const opts = merged.map(v => ({ value: v, label: v }));
                      return opts;
                    })()}
                    searchable={true}
                    allowCustom={true}
                    virtualized={true}
                    maxDropdownHeight={420}
                  />
                  {/* Simple single location quick filter preserved (optional) */}
                  <div style={{ marginTop: 6 }}>
                    <CustomSelect
                      value={filterLocation}
                      onChange={v => setFilterLocation(v)}
                      ariaLabel="Quick location"
                      placeholder="Quick location (optional)"
                      options={[{ value: '', label: 'Any' }, ...Array.from(new Set([...(locationOptionsCache || []), ...(locSuggestions || [])].map(v => String(v).trim()).filter(Boolean))).map(v => ({ value: v, label: v }))]}
                      searchable={true}
                      allowCustom={true}
                      virtualized={true}
                      maxDropdownHeight={420}
                    />
                  </div>
                </div>
                <input className="input" type="number" placeholder="Min budget (LKR)" value={filterPriceMin} onChange={e => setFilterPriceMin(e.target.value)} />
                <input className="input" type="number" placeholder="Max budget (LKR)" value={filterPriceMax} onChange={e => setFilterPriceMax(e.target.value)} />

                {/* Model multi-select tags (from Wanted ads), independent of backend filter keys */}
                {(filterCategory === 'Vehicle' || filterCategory === 'Mobile' || filterCategory === 'Electronic' || filterCategory === 'Home Garden') && (
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
                              const next = modelSelected.filter((t, i) => !(t === tag && i === idx));
                              updateBrowseFilter('model', next);
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
                          const v = String(val || '').trim();
                          if (!v) return;
                          const next = Array.from(new Set([...modelSelected, v]));
                          updateBrowseFilter('model', next);
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
                )}

                {/* Job type multi-select (from Wanted ads), independent of backend filter keys */}
                {filterCategory === 'Job' && (
                  <div>
                    <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Job Type</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                      {jobTypeSelected.map((tag, idx) => (
                        <span key={`job-${tag}-${idx}`} className="pill">
                          {tag}
                          <button
                            type="button"
                            className="btn"
                            onClick={() => {
                              const next = jobTypeSelected.filter((t, i) => !(t === tag && i === idx));
                              updateBrowseFilter('job_type', next);
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
                          const v = String(val || '').trim();
                          if (!v) return;
                          const next = Array.from(new Set([...jobTypeSelected, v]));
                          updateBrowseFilter('job_type', next);
                        }}
                        ariaLabel="Add job type"
                        placeholder="Add job type..."
                        options={jobTypeOptions.map(v => ({ value: v, label: v }))}
                        searchable={true}
                        allowCustom={true}
                        virtualized={true}
                        maxDropdownHeight={420}
                      />
                    </div>
                  </div>
                )}

                {/* Dynamic sub_category/job_type tag inputs + other keys */}
                {filterCategory && browseFiltersDef.keys.length > 0 && (
                  <>
                    

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
                      return browseFiltersDef.keys
                        .filter(k => !['location','pricing_type','price','sub_category','model','model_name','job_type'].includes(k))
                        .map(key => {
                          const values = (browseFiltersDef.valuesByKey[key] || []).map(v => String(v));
                          const opts = [{ value: '', label: 'Any' }, ...values.map(v => ({ value: v, label: v }))];
                          return (
                            <div key={key}>
                              <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>{pretty(key)}</div>
                              <CustomSelect
                                value={browseFilters[key] || ''}
                                onChange={val => updateBrowseFilter(key, val)}
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
                  <button className="btn accent compact" type="button" onClick={() => setShowFilters(false)} style={{ flex: '0 0 auto' }}>
                    {t('common.apply')}
                  </button>
                  <button className="btn compact" type="button" onClick={resetBrowseFilters} style={{ flex: '0 0 auto' }}>
                    {t('common.reset')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {loading && <div className="pill">Loading...</div>}
          {!loading && filteredRequests.length === 0 && (
            <p className="text-muted">{t('wanted.noMatch')}</p>
          )}

          {/* Redesigned cards to match HomePage grid and style */}
          {!loading && filteredRequests.length > 0 && (
            <div className="grid three">
              {visibleRequests.map(r => {
                const locs = parseArray(r.locations_json);
                const modelsArr = parseArray(r.models_json);
                const filtersObj = parseFilters(r.filters_json);
                const filterEntries = Object.entries(filtersObj || {}).filter(([k]) => !['model', 'job_type'].includes(String(k)));
                const jobTypesArr = parseArray(r.job_types_json);
                // Age label from created_at: minutes in first hour, then hours, then days (same as homepage)
                let ageStr = '';
                try {
                  if (r.created_at) {
                    const created = new Date(r.created_at);
                    const diffMs = Date.now() - created.getTime();
                    const mins = Math.max(0, Math.floor(diffMs / 60000));
                    if (mins < 60) {
                      ageStr = `${mins} min${mins === 1 ? '' : 's'} ago`;
                    } else {
                      const hours = Math.floor(mins / 60);
                      if (hours < 24) {
                        ageStr = `${hours} hour${hours === 1 ? '' : 's'} ago`;
                      } else {
                        const days = Math.floor(hours / 24);
                        ageStr = `${days} day${days === 1 ? '' : 's'} ago`;
                      }
                    }
                  }
                } catch (_) {}
                return (
                  <div key={r.id} className="card" style={{ cursor: 'default' }}>
                    <div className="text-muted" style={{ marginBottom: 6 }}>{r.category || 'Any'}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                      <div className="h2" style={{ marginTop: 0, marginBottom: 0 }}>{r.title}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                        {(() => {
                          const uname = String(r.poster_username || '').trim();
                          const userLabel = uname ? `@${uname}` : (r.user_email ? String(r.user_email).split('@')[0] : '');
                          if (!userLabel) return null;
                          return <span className="pill" style={{ whiteSpace: 'nowrap' }}>{userLabel}</span>;
                        })()}
                        {r.price_not_matter ? (
                          <span className="pill">No budget cap</span>
                        ) : (
                          (r.price_min != null || r.price_max != null) && (
                            <div style={{ margin: 0, whiteSpace: 'nowrap', fontSize: 14, fontWeight: 700 }}>
                              {`LKR ${r.price_min != null ? Number(r.price_min).toLocaleString('en-US') : 'Any'} - ${r.price_max != null ? Number(r.price_max).toLocaleString('en-US') : 'Any'}`}
                            </div>
                          )
                        )}
                      </div>
                    </div>
                    <div className="text-muted" style={{ marginBottom: 6, marginTop: 4 }}>
                      {(() => {
                        const parts = [];
                        const allLocs = [...locs, r.location].filter(Boolean);
                        if (allLocs.length) parts.push(`Locations: ${Array.from(new Set(allLocs)).join(', ')}`);
                        if (r.category === 'Vehicle' && (r.year_min || r.year_max)) parts.push(`Year: ${r.year_min || 'Any'} - ${r.year_max || 'Any'}`);
                        // Always show the user name (poster of the wanted request)
                        const uname = String(r.poster_username || '').trim();
                        if (uname) parts.push(`Posted by @${uname}`);
                        else if (r.user_email) parts.push(`Posted by ${String(r.user_email).split('@')[0]}`);
                        if (ageStr) parts.push(ageStr);
                        return parts.join(' • ');
                      })()}
                    </div>
                    {(r.category === 'Vehicle' || r.category === 'Mobile' || r.category === 'Electronic') && modelsArr.length > 0 && (
                      <div className="text-muted" style={{ marginTop: 6 }}>
                        Models: {modelsArr.join(', ')}
                      </div>
                    )}
                    {r.category === 'Job' && jobTypesArr.length > 0 && (
                      <div className="text-muted" style={{ marginTop: 6 }}>
                        Job Types: {jobTypesArr.join(', ')}
                      </div>
                    )}
                    {filterEntries.length > 0 && (
                      <div className="text-muted" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {filterEntries.map(([k, v]) => (
                          <span key={k} className="pill">{k}: {Array.isArray(v) ? v.join(', ') : String(v)}</span>
                        ))}
                      </div>
                    )}
                    {r.description && <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{r.description}</div>}

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          const catParam = r.category ? `?category=${encodeURIComponent(r.category)}&tagWantedId=${encodeURIComponent(r.id)}` : `?tagWantedId=${encodeURIComponent(r.id)}`;
                          navigate(`/new${catParam}`);
                        }}
                        title="Post a new ad for this request"
                        aria-label="Post a new ad for this request"
                      >
                        {t('wanted.postAd')}
                      </button>
                      {canOffer && (
                        <>
                          <div style={{ minWidth: 220, flex: '0 0 220px' }}>
                            <CustomSelect
                              value={offerSelections[r.id] || ''}
                              onChange={v => setOfferSelections(prev => ({ ...prev, [r.id]: v ? Number(v) : '' }))}
                              ariaLabel="Offer one of your ads"
                              placeholder="Offer one of your ads"
                              options={myListings.map(l => {
                                const priceLabel = (typeof l.price === 'number')
                                  ? ` • LKR ${Number(l.price).toLocaleString('en-US')}`
                                  : '';
                                return {
                                  value: String(l.id),
                                  label: `${l.title}${priceLabel}`
                                };
                              })}
                              searchable={true}
                              virtualized={true}
                              maxDropdownHeight={420}
                            />
                          </div>
                          <button className="btn" onClick={() => sendOffer(r.id)} disabled={!offerSelections[r.id] || offerSending[r.id]}>
                            {offerSending[r.id] ? 'Sending...' : t('wanted.offerThisAd')}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Pagination (matches HomePage style) */}
          {!loading && filteredRequests.length > 0 && (
            <div className="pagination" style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <button
                className="btn page"
                onClick={() => setPage(Math.max(1, page - 1))}
                aria-label="Previous page"
                disabled={page <= 1}
              >
                {t('common.prev')}
              </button>
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
              <button
                className="btn page"
                onClick={() => setPage(Math.min(totalPages, page + 1))}
                aria-label="Next page"
                disabled={page >= totalPages}
              >
                {t('common.next')}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'post' && (
        <form className="card" style={{ marginTop: 16 }} onSubmit={submitForm}>
          <div className="h2" style={{ marginTop: 0 }}>Post a Wanted Request</div>

          <label className="label">Title</label>
          <input
            className="input"
            required
            minLength={6}
            placeholder="Wanted: Used Nikon D750 camera, Max Budget LKR 150,000"
            value={form.title}
            onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
          />

          <label className="label" style={{ marginTop: 10 }}>Category</label>
          <select
            className="select"
            value={form.category}
            onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}
          >
            <option value="">Any</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div className="card" style={{ marginTop: 10 }}>
            <div className="h3" style={{ marginTop: 0 }}>Locations</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ minWidth: 240, flex: '0 0 240px' }}>
                <CustomSelect
                  value={locSuggestedValue}
                  onChange={v => setLocSuggestedValue(v)}
                  ariaLabel="Suggested locations"
                  placeholder="Suggested locations"
                  options={(filtersMeta.valuesByKey?.['location'] || []).map(v => ({ value: v, label: v }))}
                  searchable={true}
                  allowCustom={true}
                />
              </div>
              <input
                className="input"
                placeholder="Or type a location (e.g., Colombo)"
                value={locInput}
                onChange={e => setLocInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLocation(); }}}
                style={{ minWidth: 220 }}
              />
              <button className="btn" type="button" onClick={addLocation}>Add</button>
            </div>
            {renderChips(locations, removeLocation)}
          </div>

          {(form.category === 'Vehicle' || form.category === 'Mobile' || form.category === 'Electronic') && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="h3" style={{ marginTop: 0 }}>Models (optional)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240, flex: '0 0 240px' }}>
                  <CustomSelect
                    value={modelSuggestedValue}
                    onChange={v => setModelSuggestedValue(v)}
                    ariaLabel="Suggested models"
                    placeholder="Suggested models"
                    options={(filtersMeta.valuesByKey?.['model'] || []).map(v => ({ value: v, label: v }))}
                    searchable={true}
                    allowCustom={true}
                  />
                </div>
                <input
                  className="input"
                  placeholder="Or type model (e.g., Toyota Aqua)"
                  value={modelInput}
                  onChange={e => setModelInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addModel(); }}}
                  style={{ minWidth: 220 }}
                />
                <button className="btn" type="button" onClick={addModel}>Add</button>
              </div>
              {renderChips(models, removeModel)}
            </div>
          )}

          {form.category === 'Job' && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="h3" style={{ marginTop: 0 }}>Job Type(s)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ minWidth: 240, flex: '0 0 240px' }}>
                  <CustomSelect
                    value={jobTypeSuggestedValue}
                    onChange={v => setJobTypeSuggestedValue(v)}
                    ariaLabel="Suggested job types"
                    placeholder="Suggested job types"
                    options={(filtersMeta.valuesByKey?.['job_type'] || []).map(v => ({ value: v, label: v }))}
                    searchable={true}
                    allowCustom={true}
                  />
                </div>
                <input
                  className="input"
                  placeholder="Or type a job type (e.g., Accountant)"
                  value={jobTypeInput}
                  onChange={e => setJobTypeInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addJobType(); }}}
                  style={{ minWidth: 220 }}
                />
                <button className="btn" type="button" onClick={addJobType}>Add</button>
              </div>
              {renderChips(jobTypes, removeJobType)}
            </div>
          )}

          {form.category === 'Vehicle' && (
            <div className="card" style={{ marginTop: 10 }}>
              <div className="h3" style={{ marginTop: 0 }}>Year Range (optional)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  className="input"
                  type="number"
                  min="1950"
                  max="2100"
                  placeholder="Min year"
                  value={yearMin}
                  onChange={e => setYearMin(e.target.value)}
                  style={{ width: 140 }}
                />
                <input
                  className="input"
                  type="number"
                  min="1950"
                  max="2100"
                  placeholder="Max year"
                  value={yearMax}
                  onChange={e => setYearMax(e.target.value)}
                  style={{ width: 140 }}
                />
              </div>
            </div>
          )}

          <div className="card" style={{ marginTop: 10 }}>
            <div className="h3" style={{ marginTop: 0 }}>{form.category === 'Job' ? 'Salary Range' : 'Price Range'}</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={priceNoMatter} onChange={e => setPriceNoMatter(e.target.checked)} />
              {form.category === 'Job' ? 'Salary not a constraint' : 'Price not a constraint'}
            </label>
            {!priceNoMatter && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder={form.category === 'Job' ? 'Min Salary LKR' : 'Min LKR'}
                  value={priceMin}
                  onChange={e => setPriceMin(e.target.value)}
                  style={{ width: 160 }}
                />
                <input
                  className="input"
                  type="number"
                  min="0"
                  placeholder={form.category === 'Job' ? 'Max Salary LKR' : 'Max LKR'}
                  value={priceMax}
                  onChange={e => setPriceMax(e.target.value)}
                  style={{ width: 160 }}
                />
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 10 }}>
            <div className="h3" style={{ marginTop: 0 }}>Additional Filters (optional)</div>
            {!form.category && <p className="text-muted">Select a category to see filters.</p>}
            {form.category && filteredKeysForUI.length === 0 && (
              <p className="text-muted">No dynamic filters available for {form.category} yet.</p>
            )}
            {form.category && filteredKeysForUI.length > 0 && (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    className="select"
                    value={filterKey}
                    onChange={e => { setFilterKey(e.target.value); setFilterSuggestedValue(''); setFilterCustomValue(''); }}
                    style={{ minWidth: 200 }}
                  >
                    <option value="">Select a filter key</option>
                    {filteredKeysForUI.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  {filterKey && (
                    <>
                      <div style={{ minWidth: 220, flex: '0 0 220px' }}>
                        <CustomSelect
                          value={filterSuggestedValue}
                          onChange={v => setFilterSuggestedValue(v)}
                          ariaLabel="Suggested values"
                          placeholder="Suggested values"
                          options={(filtersMeta.valuesByKey?.[filterKey] || []).map(v => ({ value: v, label: v }))}
                          searchable={true}
                          allowCustom={true}
                        />
                      </div>
                      <input
                        className="input"
                        placeholder="Or type a custom value"
                        value={filterCustomValue}
                        onChange={e => setFilterCustomValue(e.target.value)}
                        style={{ minWidth: 200 }}
                      />
                      <button className="btn" type="button" onClick={addFilterValue}>Add</button>
                    </>
                  )}
                </div>
                {renderSelectedFiltersChips()}
              </>
            )}
          </div>

          <label className="label" style={{ marginTop: 10 }}>Description (optional)</label>
          <textarea
            className="textarea"
            rows={4}
            placeholder="Add details to help sellers match your need..."
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
          />

          {postStatus.message && (
            <div className="pill" style={{ marginTop: 10, background: postStatus.ok ? 'rgba(10,200,120,0.12)' : 'rgba(239,68,68,0.12)' }}>
              {postStatus.message}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn" type="submit" disabled={loading}>Post Request</button>
            <button className="btn" type="button" onClick={() => setTab('browse')}>Cancel</button>
          </div>
        </form>
      )}

      {tab === 'mine' && (
        <div style={{ marginTop: 16, padding: 18 }}>
          {!userEmail && <p className="text-muted">Login to view your requests.</p>}
          {userEmail && (
            <>
              {myRequests.length === 0 && (
                <p className="text-muted">You have not posted any requests yet.</p>
              )}
              {/* Redesigned My Requests into grid (three) to match HomePage cards */}
              <div className="grid three">
                {myRequests.map(r => {
                  const locs = parseArray(r.locations_json);
                  const modelsArr = parseArray(r.models_json);
                  const filtersObj = parseFilters(r.filters_json);
                  const filterEntries = Object.entries(filtersObj || {}).filter(([k]) => !['model', 'job_type'].includes(String(k)));
                  const jobTypesArr = parseArray(r.job_types_json);
                  // Age label from created_at (same as homepage)
                  let ageStr = '';
                  try {
                    if (r.created_at) {
                      const created = new Date(r.created_at);
                      const diffMs = Date.now() - created.getTime();
                      const mins = Math.max(0, Math.floor(diffMs / 60000));
                      if (mins < 60) {
                        ageStr = `${mins} min${mins === 1 ? '' : 's'} ago`;
                      } else {
                        const hours = Math.floor(mins / 60);
                        if (hours < 24) {
                          ageStr = `${hours} hour${hours === 1 ? '' : 's'} ago`;
                        } else {
                          const days = Math.floor(hours / 24);
                          ageStr = `${days} day${days === 1 ? '' : 's'} ago`;
                        }
                      }
                    }
                  } catch (_) {}
                  return (
                    <div key={r.id} className="card" style={{ cursor: 'default' }}>
                      <div className="text-muted" style={{ marginBottom: 6 }}>{r.category || 'Any'}</div>
                      <div className="h2" style={{ marginTop: 0, marginBottom: 0 }}>{r.title}</div>
                      <div className="text-muted" style={{ marginBottom: 6, marginTop: 4 }}>
                        {(() => {
                          const parts = [];
                          const allLocs = [...locs, r.location].filter(Boolean);
                          if (allLocs.length) parts.push(`Locations: ${Array.from(new Set(allLocs)).join(', ')}`);
                          if (r.category === 'Vehicle' && (r.year_min || r.year_max)) parts.push(`Year: ${r.year_min || 'Any'} - ${r.year_max || 'Any'}`);
                          if (ageStr) parts.push(ageStr);
                          return parts.join(' • ');
                        })()}
                      </div>
                      {(r.category === 'Vehicle' || r.category === 'Mobile' || r.category === 'Electronic') && modelsArr.length > 0 && (
                        <div className="text-muted" style={{ marginTop: 6 }}>
                          Models: {modelsArr.join(', ')}
                        </div>
                      )}
                      {r.category === 'Job' && jobTypesArr.length > 0 && (
                        <div className="text-muted" style={{ marginTop: 6 }}>
                          Job Types: {jobTypesArr.join(', ')}
                        </div>
                      )}
                      {filterEntries.length > 0 && (
                        <div className="text-muted" style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {filterEntries.map(([k, v]) => (
                            <span key={k} className="pill">{k}: {Array.isArray(v) ? v.join(', ') : String(v)}</span>
                          ))}
                        </div>
                      )}
                      <div className="text-muted" style={{ marginTop: 6 }}>
                        {r.price_not_matter ? 'Price not a constraint' : (
                          (r.price_min != null || r.price_max != null) ? `Budget: ${r.price_min != null ? `LKR ${Number(r.price_min).toLocaleString('en-US')}` : 'Any'} - ${r.price_max != null ? `LKR ${Number(r.price_max).toLocaleString('en-US')}` : 'Any'}` : 'Budget: Any'
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                        {r.status === 'open' && (
                          <button className="btn" onClick={() => closeRequest(r.id)}>Close</button>
                        )}
                        {r.status !== 'open' && (
                          <button className="btn" onClick={() => alert('This request is closed.')}>Closed</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
