import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ChatWidget() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const [token, setToken] = useState('');
  const [lastId, setLastId] = useState(0);
  const esRef = useRef(null);

  useEffect(() => {
    try {
      const user = JSON.parse(localStorage.getItem('user') || 'null');
      setUserEmail(user?.email || '');
      const t = localStorage.getItem('auth_token') || '';
      setToken(t || '');
    } catch (_) {
      setUserEmail('');
      setToken('');
    }
  }, []);

  // Helpers to robustly parse server responses and retry direct backend if proxy returns HTML
  async function safeJson(r) {
    if (!r) return {};
    const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '').toLowerCase();
    if (ct.includes('application/json')) {
      try {
        return await r.json();
      } catch (_) {
        return {};
      }
    }
    let text = '';
    try { text = await r.text(); } catch (_) {}
    const trimmed = String(text || '').trim();
    if (!trimmed || r.status === 204) return {};
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { return JSON.parse(trimmed); } catch (_) { return {}; }
    }
    const isHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.includes('<html');
    if (isHtml) return { _html: true, error: 'Proxy returned HTML' };
    return { message: trimmed };
  }

  async function apiFetch(path, options) {
    const rel = await fetch(path, options).catch(() => null);
    if (!rel) return { resp: null, data: { error: 'Network error' } };
    const relData = await safeJson(rel);
    const looksHtml = relData && relData._html === true;
    if (looksHtml || (!rel.ok && rel.status === 200)) {
      try {
        const fcUrl = `/api/index.php?r=${encodeURIComponent(path)}`;
        const retryResp = await fetch(fcUrl, options);
        const retryData = await safeJson(retryResp);
        return { resp: retryResp, data: retryData };
      } catch (_) {
        // fall through to return original
      }
    }
    return { resp: rel, data: relData };
  }

  async function loadMessages() {
    if (!token) return;
    try {
      const { resp: r, data } = await apiFetch('/api/chats', {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' }
      });
      if (r && r.ok) {
        const rows = Array.isArray(data.results) ? data.results : [];
        setMessages(rows);
        const maxId = rows.length ? Number(rows[rows.length - 1].id) : 0;
        if (Number.isFinite(maxId)) setLastId(maxId);
        const el = listRef.current;
        if (el) { el.scrollTop = el.scrollHeight; }
        setStatus('');
      } else {
        const msg = (data && data.error) || (data && data.message) || 'Failed to load chat.';
        setStatus(String(msg));
      }
    } catch (e) {
      setStatus('Network error while loading chat.');
    }
  }

  function startSSE() {
    // EventSource relies on auth_token cookie; ensure user is logged in
    if (!open || !token) return;
    try {
      const url = `/api/chats/stream${lastId ? `?last_id=${encodeURIComponent(lastId)}` : ''}`;
      const es = new EventSource(url);
      esRef.current = es;
      es.addEventListener('chat_messages', (evt) => {
        try {
          const payload = JSON.parse(evt.data || '{}');
          const rows = Array.isArray(payload.results) ? payload.results : [];
          if (!rows.length) return;
          setMessages(prev => {
            // Append new rows, dedupe by id
            const seen = new Set(prev.map(m => Number(m.id)));
            const toAdd = rows.filter(r => !seen.has(Number(r.id)));
            const next = [...prev, ...toAdd];
            const maxId = next.length ? Number(next[next.length - 1].id) : lastId;
            if (Number.isFinite(maxId)) setLastId(maxId);
            // autoscroll
            const el = listRef.current;
            if (el) { el.scrollTop = el.scrollHeight; }
            return next;
          });
        } catch (_) {}
      });
      es.onerror = () => {
        // Fallback immediate refresh; browser will auto-reconnect
        loadMessages();
      };
    } catch (_) {
      // Fall back to polling if EventSource fails to construct (older browsers)
      const timer = setInterval(loadMessages, 5000);
      esRef.current = { close: () => clearInterval(timer) };
    }
  }

  function stopSSE() {
    try { esRef.current && esRef.current.close && esRef.current.close(); } catch (_) {}
    esRef.current = null;
  }

  useEffect(() => {
    if (!open || !token) return;
    // Initial load then start SSE
    loadMessages().then(() => startSSE());
    return () => stopSSE();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userEmail]);

  async function sendMessage() {
    const msg = input.trim();
    if (!msg) return;
    if (!token) {
      setStatus('Please login to send a message.');
      return;
    }
    try {
      const { resp: r, data } = await apiFetch('/api/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
        body: JSON.stringify({ message: msg })
      });
      if (!r || !r.ok) {
        const code = r ? r.status : 0;
        const errMsg = (data && data.error) || (data && data.message) || 'Failed to send';
        // If unauthorized, hint user to re-login (token may be missing/expired)
        if (code === 401) {
          setStatus('Please login again to continue the chat.');
        } else {
          setStatus(`Error: ${String(errMsg)}`);
        }
        return;
      }
      setInput('');
      // Optimistically append; SSE/refresh will confirm
      setMessages(prev => [...prev, { id: Date.now(), sender: 'user', message: msg, created_at: new Date().toISOString() }]);
      const el = listRef.current;
      if (el) { el.scrollTop = el.scrollHeight; }
      setStatus('');
      // Refresh last_id baseline so SSE picks up newer admin replies
      loadMessages();
    } catch (e) {
      setStatus('Network error. Please try again.');
    }
  }

  function updatePopupPosition() {
    const panel = panelRef.current;
    if (!panel) return;

    // Default bottom spacing when no keyboard (desktop or unsupported)
    let bottomBase = 74;

    // If visualViewport is available, compute keyboard overlap
    const vv = window.visualViewport;
    if (vv) {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel.style.bottom = `${bottomBase + keyboardHeight + 8}px`;
    } else {
      panel.style.bottom = `${bottomBase}px`;
    }
  }

  function adjustForInputFocus() {
    // Ensure latest messages visible
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;

    // Move popup above keyboard if present
    updatePopupPosition();

    // Bring input into view (useful on mobile keyboards)
    const inp = inputRef.current;
    if (inp) {
      setTimeout(() => {
        try {
          inp.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          const panel = panelRef.current || document.getElementById('chat-popup');
          if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (_) {}
      }, 50);
    }
  }

  function handleInputBlur() {
    const panel = panelRef.current;
    if (!panel) return;
    // Reset to default bottom when input loses focus
    panel.style.bottom = '74px';
  }

  // Close popup when clicking outside
  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      const panel = document.getElementById('chat-popup');
      const btn = document.getElementById('chat-toggle-btn');
      const target = e.target;
      if (panel && panel.contains(target)) return;
      if (btn && btn.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  // Adjust popup position when the virtual keyboard shows/hides (mobile)
  useEffect(() => {
    if (!open) return;
    const vv = window.visualViewport;
    if (!vv) return;

    const handler = () => {
      updatePopupPosition();
    };

    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    // Initialize once opened
    handler();

    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
    };
  }, [open]);

  return (
    <>
      {/* Floating chat button */}
      <button
        id="chat-toggle-btn"
        className="btn"
        type="button"
        aria-label="Chat"
        title="Chat"
        onClick={() => setOpen(o => !o)}
        style={{
          position: 'fixed',
          right: 16,
          bottom: 16,
          zIndex: 1200,
          width: 48,
          height: 48,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(180deg, var(--primary), #5569e2)',
          color: '#fff',
          boxShadow: '0 10px 25px rgba(0,0,0,0.35)'
        }}
      >
        💬
      </button>

      {/* Chat popup */}
      {open && (
        <div
          id="chat-popup"
          ref={panelRef}
          className="card"
          role="dialog"
          aria-label="Support chat"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 74,
            width: 300,
            maxHeight: 420,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            zIndex: 1200,
            boxShadow: '0 10px 25px rgba(0,0,0,0.45)',
            background: 'rgba(18,22,31,0.96)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="h2" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Support</span>
            <button className="btn" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          {!token && (
            <div className="card" style={{ background: 'rgba(18,22,31,0.9)', borderColor: 'var(--border)' }}>
              <div className="text-muted">Please login to chat with admin.</div>
              <div className="text-muted" style={{ marginTop: 6 }}>Try to contact admin after you log into the website.</div>
              <div style={{ marginTop: 8 }}>
                <button className="btn primary" onClick={() => navigate('/auth')}>Login</button>
              </div>
            </div>
          )}

          {token && (
            <>
              <div ref={listRef} style={{ flex: 1, overflowY: 'auto', paddingRight: 4 }}>
                {messages.length === 0 && <p className="text-muted">Start a conversation. Messages are kept for 7 days.</p>}
                {messages.map(m => (
                  <div
                    key={m.id}
                    className="card"
                    style={{
                      marginBottom: 6,
                      background: m.sender === 'admin' ? 'rgba(108,127,247,0.22)' : 'rgba(0,209,255,0.18)',
                      borderColor: m.sender === 'admin' ? '#4656cc33' : '#0892b033'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                      <strong>{m.sender === 'admin' ? 'Admin' : 'You'}</strong>
                      <small className="text-muted">{new Date(m.created_at).toLocaleString()}</small>
                    </div>
                    <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{m.message}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  ref={inputRef}
                  className="input"
                  placeholder="Type a message..."
                  value={input}
                  onFocus={adjustForInputFocus}
                  onClick={adjustForInputFocus}
                  onBlur={handleInputBlur}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); sendMessage(); } }}
                />
                <button className="btn primary" onClick={sendMessage}>Send</button>
              </div>
              {status && <small className="text-muted">{status}</small>}
            </>
          )}
        </div>
      )}
    </>
  );
}