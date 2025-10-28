import React, { useEffect, useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'

export default function AccountPage() {
  const navigate = useNavigate()
  const [user, setUser] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [result, setResult] = useState(null) // { ok, message }
  const fileInputRef = useRef(null)

  // Favorites state
  const [favorites, setFavorites] = useState([])
  const [favListings, setFavListings] = useState([])
  const [favStatus, setFavStatus] = useState(null)

  // Seller profile editing
  const [profile, setProfile] = useState({ bio: '', verified_email: false, verified_phone: false })
  const [profileStatus, setProfileStatus] = useState(null)

  useEffect(() => {
    (async () => {
      try {
        const raw = localStorage.getItem('user')
        if (!raw) {
          // Try to recover from server status (cookie-auth) before redirecting
          try {
            const r = await fetch('/api/auth/status', { credentials: 'include', headers: { 'Accept': 'application/json' } })
            if (r.ok) {
              const s = await r.json().catch(() => ({}))
              if (s && s.email) {
                const recovered = { email: s.email, username: s.username || null, is_admin: !!s.is_admin }
                localStorage.setItem('user', JSON.stringify(recovered))
                setUser(recovered)
                setUsername(recovered.username || '')
                const key = `favorites_${recovered.email}`
                const arr = JSON.parse(localStorage.getItem(key) || '[]')
                setFavorites(Array.isArray(arr) ? arr : [])
                await loadSellerProfile(recovered)
                return
              }
            }
          } catch (_) {}
          navigate('/auth', { replace: true })
          return
        }
        const u = JSON.parse(raw)
        // If stored user has no email, attempt recovery via status endpoint
        if (!u || !u.email) {
          try {
            const tok = localStorage.getItem('auth_token') || ''
            const hdrs = tok ? { Authorization: 'Bearer ' + tok, Accept: 'application/json' } : { Accept: 'application/json' }
            const r = await fetch('/api/auth/status', { credentials: 'include', headers: hdrs })
            if (r.ok) {
              const s = await r.json().catch(() => ({}))
              if (s && s.email) {
                const recovered = { email: s.email, username: s.username || null, is_admin: !!s.is_admin }
                localStorage.setItem('user', JSON.stringify(recovered))
                setUser(recovered)
                setUsername(recovered.username || '')
                const key = `favorites_${recovered.email}`
                const arr = JSON.parse(localStorage.getItem(key) || '[]')
                setFavorites(Array.isArray(arr) ? arr : [])
                await loadSellerProfile(recovered)
                return
              }
            }
          } catch (_) {}
          navigate('/auth', { replace: true })
          return
        }
        setUser(u)
        setUsername(u?.username || '')
        // Load favorites
        const key = `favorites_${u.email}`
        const arr = JSON.parse(localStorage.getItem(key) || '[]')
        setFavorites(Array.isArray(arr) ? arr : [])

        // Load seller profile
        await loadSellerProfile(u)
      } catch (_) {
        navigate('/auth', { replace: true })
      }
    })()
  }, [navigate])

  async function loadSellerProfile(u) {
    try {
      if (!u || !u.email) return
      setProfileStatus(null)
      const r = await fetch(`/api/users/profile?email=${encodeURIComponent(u.email)}`)
      const data = await r.json()
      if (r.ok) {
        const p = data?.profile || {}
        setProfile({
          bio: p.bio || '',
          verified_email: !!p.verified_email,
          verified_phone: !!p.verified_phone
        })
      }
    } catch (_) {}
  }

  // Load listings for favorites
  useEffect(() => {
    async function loadFavs() {
      if (!favorites.length) { setFavListings([]); return }
      try {
        setFavStatus(null)
        const results = await Promise.all(favorites.map(async (lid) => {
          try {
            const r = await fetch(`/api/listings/${encodeURIComponent(lid)}`)
            const data = await r.json()
            if (!r.ok) throw new Error(data.error || 'Failed')
            return data
          } catch (_) {
            return null
          }
        }))
        setFavListings(results.filter(Boolean))
      } catch (e) {
        setFavStatus('Failed to load favorites.')
      }
    }
    loadFavs()
  }, [favorites])

  function removeFavorite(id) {
    try {
      const key = `favorites_${user.email}`
      const next = favorites.filter(v => v !== id)
      localStorage.setItem(key, JSON.stringify(next))
      setFavorites(next)
    } catch (_) {
      setFavStatus('Failed to update favorites.')
    }
  }

  function formatPrice(n) {
    const v = typeof n === 'number' ? n : Number(n)
    if (!isFinite(v)) return String(n ?? '')
    return v.toLocaleString('en-US')
  }

  async function updateUsername(e) {
    e.preventDefault()
    if (!user) return
    setResult(null)
    try {
      const r = await fetch('/api/auth/update-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password, username })
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setResult({ ok: false, message: data?.error || 'Failed to update username.' })
        return
      }
      const updated = { ...user, username: data.username }
      localStorage.setItem('user', JSON.stringify(updated))
      setUser(updated)
      setPassword('')
      setResult({ ok: true, message: 'Username updated.' })
    } catch (_) {
      setResult({ ok: false, message: 'Network error. Try again.' })
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0] || null
    if (!file || !user) return
    if (!password) {
      setResult({ ok: false, message: 'Enter your current password to change photo.' })
      return
    }
    setResult(null)
    try {
      const fd = new FormData()
      fd.append('email', user.email)
      fd.append('password', password)
      fd.append('photo', file)
      const r = await fetch('/api/auth/upload-profile-photo', { method: 'POST', body: fd })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setResult({ ok: false, message: data?.error || 'Failed to upload photo.' })
        return
      }
      const updated = { ...user, photo_url: data.photo_url }
      localStorage.setItem('user', JSON.stringify(updated))
      setUser(updated)
      setPassword('')
      setResult({ ok: true, message: 'Profile photo updated.' })
    } catch (_) {
      setResult({ ok: false, message: 'Network error. Try again.' })
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function onAvatarClick() {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  async function deleteAccount() {
    if (!user) return
    const sure = window.confirm('Are you sure you want to permanently delete your account? This cannot be undone.')
    if (!sure) return
    setResult(null)
    try {
      const r = await fetch('/api/auth/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password })
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setResult({ ok: false, message: data?.error || 'Failed to delete account.' })
        return
      }
      localStorage.removeItem('user')
      setResult({ ok: true, message: 'Account deleted. Redirecting to home...' })
      setTimeout(() => navigate('/', { replace: true }), 800)
    } catch (_) {
      setResult({ ok: false, message: 'Network error. Try again.' })
    }
  }

  function logout() {
    try {
      localStorage.removeItem('user')
    } catch (_) {}
    navigate('/', { replace: true })
  }

  async function saveProfile(e) {
    e.preventDefault()
    if (!user) return
    try {
      setProfileStatus(null)
      const r = await fetch('/api/users/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Email': user.email },
        body: JSON.stringify({
          bio: profile.bio || ''
        })
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(data?.error || 'Failed to save profile')
      setProfileStatus('Profile updated.')
    } catch (e) {
      setProfileStatus(`Error: ${e.message}`)
    }
  }

  if (!user) return null

  const defaultAvatarUrl = 'https://cdn-icons-png.flaticon.com/512/149/149071.png' // common profile icon

  return (
    <div className="center account-page">
      <div className="card">
        <div className="h1">Account</div>
        <p className="text-muted">Manage your profile.</p>

        <div className="grid two">
          <div className="card">
            <div className="h2" style={{ marginTop: 0 }}>Profile</div>
            <div className="profile-row" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div
                className="avatar"
                onClick={onAvatarClick}
                title="Set profile photo"
                style={{
                  position: 'relative',
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: '2px solid #ddd'
                }}
              >
                <img
                  src={user.photo_url || defaultAvatarUrl}
                  alt="Profile"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    right: -2,
                    bottom: -2,
                    background: '#fff',
                    color: '#333',
                    border: '1px solid #ccc',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 'bold',
                    fontSize: 14
                  }}
                >
                  =
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div>
                <div><strong>Email:</strong> {user.email}</div>
                <div><strong>Username:</strong> {user.username || '-'}</div>
                <small className="text-muted">Click the profile icon to set/update your photo.</small>
              </div>
            </div>

            <form onSubmit={updateUsername} className="grid two">
              <input className="input" placeholder="New username" value={username} onChange={e => setUsername(e.target.value)} />
              <input className="input" type="password" placeholder="Current password (required)" value={password} onChange={e => setPassword(e.target.value)} />
              <div className="actions" style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary" type="submit">Update Username</button>
                <button className="btn" type="button" onClick={logout}>Logout</button>
              </div>
            </form>

            {/* Seller profile editing */}
            <div className="card" style={{ marginTop: 12 }}>
              <div className="h2" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Seller Profile</span>
                <Link to={`/seller/${encodeURIComponent(user.username || user.email)}`} className="btn" title="View public profile">View Public Profile</Link>
              </div>
              <form onSubmit={saveProfile} className="grid two">
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="text-muted" style={{ marginBottom: 4, fontSize: 12 }}>Bio</div>
                  <textarea
                    className="textarea"
                    placeholder="Tell buyers about yourself, what you sell, and your experience."
                    value={profile.bio}
                    onChange={e => setProfile(prev => ({ ...prev, bio: e.target.value }))}
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" type="submit">Save Profile</button>
                </div>
              </form>
              {profileStatus && <small className="text-muted">{profileStatus}</small>}
            </div>
          </div>

          <div className="card">
            <div className="h2" style={{ marginTop: 0 }}>Danger Zone</div>
            <p className="text-muted">Delete your account permanently.</p>
            <input className="input" type="password" placeholder="Current password (required)" value={password} onChange={e => setPassword(e.target.value)} />
            <button className="btn" style={{ background: '#ffe5e5', color: '#a00', marginTop: 8 }} onClick={deleteAccount}>
              Delete Account
            </button>
          </div>
        </div>

        {/* Favorites section */}
        <div style={{ marginTop: 16 }}>
          <div className="card">
            <div className="h2" style={{ marginTop: 0 }}>Favorites</div>
            {favStatus && <p className="text-muted">{favStatus}</p>}
            {favListings.length === 0 ? (
              <p className="text-muted">No favorite listings yet.</p>
            ) : (
              <div className="grid three">
                {favListings.map(item => (
                  <div key={item.id} className="card">
                    {item.thumbnail_url && (
                      <img
                        src={item.thumbnail_url}
                        alt={item.title}
                        style={{ width: '100%', borderRadius: 8, objectFit: 'cover', height: 160 }}
                      />
                    )}
                    <div className="text-muted" style={{ marginTop: 8 }}>{item.main_category}</div>
                    <div className="h2" style={{ marginTop: 0 }}>{item.title}</div>
                    <div className="text-muted" style={{ marginBottom: 6 }}>
                      {item.location ? item.location : ''}
                      {item.pricing_type ? ` • ${item.pricing_type}` : ''}
                      {item.price != null ? ` • LKR ${formatPrice(item.price)}` : ''}
                    </div>
                    <div className="actions" style={{ display: 'flex', gap: 8 }}>
                      <a className="btn primary" href={`/listing/${item.id}`}>View</a>
                      <button className="btn" onClick={() => removeFavorite(item.id)}>Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {result && (
          <div style={{ marginTop: 12 }}>
            <div className="card" style={{ padding: 12 }}>
              <div className="h2" style={{ marginTop: 0 }}>{result.ok ? 'Success' : 'Error'}</div>
              <p style={{ margin: 0 }}>{result.message}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
