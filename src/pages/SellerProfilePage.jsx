import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

export default function SellerProfilePage() {
  const { username } = useParams()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState(null)
  const [ratingStars, setRatingStars] = useState(5)
  const [ratingComment, setRatingComment] = useState('')

  function getUser() {
    try { return JSON.parse(localStorage.getItem('user') || 'null') } catch (_) { return null }
  }

  useEffect(() => {
    async function load() {
      try {
        setStatus(null)
        // Try with both username and email params to maximize match
        const r = await fetch(`/api/users/profile?username=${encodeURIComponent(username)}&email=${encodeURIComponent(username)}`)
        const d = await r.json()
        if (!r.ok) throw new Error(d.error || 'Failed to load profile')
        setData(d)
      } catch (e) {
        setStatus(`Error: ${e.message}`)
      }
    }
    load()
  }, [username])

  async function addRating() {
    try {
      const user = getUser()
      const email = user?.email || ''
      if (!email || !data?.user?.email) { setStatus('Please login to rate.'); return }
      if (email === data.user.email) { setStatus('You cannot rate your own profile.'); return }
      const body = {
        seller_email: data.user.email,
        stars: ratingStars,
        comment: ratingComment
      }
      const r = await fetch('/api/users/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Email': email },
        body: JSON.stringify(body)
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        // Show specific message if already reviewed
        const msg = d.error || (r.status === 409 ? 'You have already rated this seller.' : 'Failed to rate')
        throw new Error(msg)
      }
      setStatus('Thank you for your rating.')
      // refresh ratings
      const rr = await fetch(`/api/users/profile?username=${encodeURIComponent(username)}&email=${encodeURIComponent(username)}`)
      const dd = await rr.json()
      if (rr.ok) setData(dd)
      setRatingComment('')
    } catch (e) {
      setStatus(`Error: ${e.message}`)
    }
  }

  if (!data) {
    return (
      <div className="center">
        <div className="card">
          <div className="h1">Seller Profile</div>
          {status ? (
            <p className="text-muted">{status}</p>
          ) : (
            <p className="text-muted">Loading...</p>
          )}
        </div>
      </div>
    )
  }

  const u = data.user || {}
  const p = data.profile || {}
  const stats = data.stats || {}
  const viewer = getUser()
  const isSelf = viewer && viewer.email && (viewer.email.toLowerCase() === String(u.email || '').toLowerCase())

  return (
    <div className="center">
      <div className="card">
        <div className="h1">Seller Profile</div>
        <div className="profile-row" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {u.photo_url && <img src={u.photo_url} alt="Seller" style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }} />}
          <div>
            <div><strong>{u.username || (u.id != null ? `User #${u.id}` : 'User')}</strong></div>
            <div className="text-muted" style={{ marginTop: 4 }}>ID: {u.id != null ? u.id : '—'}</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="pill" title="Average rating" style={{ borderColor: 'transparent', background: 'rgba(255,255,255,0.08)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span>{Number(p.rating_avg || 0).toFixed(2)}</span>
                <span aria-hidden="true">★</span>
                <span>({p.rating_count || 0})</span>
              </span>
              {p.verified_email ? <span className="pill">Verified Email</span> : null}
              {p.verified_phone ? <span className="pill">Verified Phone</span> : null}
            </div>
          </div>
        </div>

        {p.bio && (
          <div className="card" style={{ marginTop: 12 }}>
            <div className="h2" style={{ marginTop: 0 }}>About</div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{p.bio}</p>
          </div>
        )}

        <div className="grid two" style={{ marginTop: 12 }}>
          <div className="card">
            <div className="h2" style={{ marginTop: 0 }}>Ratings</div>
            <div className="text-muted">Average: {Number(p.rating_avg || 0).toFixed(2)} ({p.rating_count || 0} ratings)</div>
            <div style={{ marginTop: 8 }}>
              {(data.ratings || []).map(r => (
                <div key={r.id} className="card" style={{ marginBottom: 8 }}>
                  <div><strong>{r.stars} ⭐</strong></div>
                  {r.comment && <div className="text-muted" style={{ whiteSpace: 'pre-wrap' }}>{r.comment}</div>}
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{new Date(r.created_at).toLocaleString()} • by {r.rater_id != null ? `User #${r.rater_id}` : 'User'}</div>
                </div>
              ))}
              {(data.ratings || []).length === 0 && <p className="text-muted">No ratings yet.</p>}
            </div>

            {/* Add a rating */}
            {!isSelf ? (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="h2" style={{ marginTop: 0 }}>Leave a rating</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label>
                    Stars:
                    <select className="select" value={ratingStars} onChange={e => setRatingStars(Number(e.target.value))} style={{ marginLeft: 6 }}>
                      {[1,2,3,4,5].map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <input className="input" placeholder="Optional comment" value={ratingComment} onChange={e => setRatingComment(e.target.value)} />
                  <button className="btn primary" type="button" onClick={addRating}>Submit</button>
                </div>
              </div>
            ) : (
              <div className="card" style={{ marginTop: 8 }}>
                <div className="text-muted">You cannot rate your own profile.</div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="h2" style={{ marginTop: 0 }}>Seller Stats</div>
            <div>Active listings: {stats.active_listings || 0}</div>
            <div>Total ratings: {stats.ratings_count || 0}</div>
          </div>
        </div>

        {status && <p style={{ marginTop: 8 }}>{status}</p>}
      </div>
    </div>
  )
}