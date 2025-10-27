/**
 * Global API polyfill for hosts without proper /api rewrites.
 * - Wraps window.fetch: if a relative /api request returns HTML (likely index.html), retry via /api/index.php?r=<path>
 * - Wraps window.EventSource: always transform /api/* URLs to /api/index.php?r=<path> in production builds.
 * - No changes in dev (Vite proxy handles /api).
 */

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV

// Save originals
const origFetch = window.fetch
const OrigEventSource = window.EventSource

function isApiRelativeUrl(u) {
  try {
    if (!u) return false
    if (typeof u === 'string') {
      return u.startsWith('/api/')
    }
    // Request object
    if (u && typeof u === 'object' && 'url' in u) {
      const url = String(u.url || '')
      // Only consider same-origin /api paths
      try {
        const parsed = new URL(url, window.location.origin)
        return parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/')
      } catch (_) {
        return url.startsWith('/api/')
      }
    }
  } catch (_) {}
  return false
}

function buildFrontControllerUrl(pathLike) {
  const base = '/api/index.php'
  const hasQ = String(pathLike || '').includes('?')
  const urlWithQuery = String(pathLike || '')
  const fc = `${base}?r=${encodeURIComponent(urlWithQuery)}`
  return fc
}

// Wrap fetch with fallback retry
window.fetch = async function(input, init) {
  // In dev, use original fetch directly
  if (IS_DEV) {
    return origFetch(input, init)
  }

  // Call original
  const resp = await origFetch(input, init).catch(() => null)
  if (!resp) return resp

  // Only consider retry logic for /api/* relative same-origin requests
  const shouldCheck = isApiRelativeUrl(input)
  if (!shouldCheck) return resp

  // Peek into a clone to avoid consuming response body
  try {
    const cloned = resp.clone()
    const ct = String((cloned.headers && cloned.headers.get && cloned.headers.get('content-type')) || '').toLowerCase()
    if (ct.includes('application/json')) {
      return resp
    }
    // Some APIs legitimately return 204 No Content
    if (cloned.status === 204) {
      return resp
    }
    const text = await cloned.text().catch(() => '')
    const trimmed = String(text || '').trim()
    const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
    if (looksJson) {
      // Mislabelled content-type but JSON payload; keep original
      return resp
    }
    const isHtml = trimmed.startsWith('<!DOCTYPE') || trimmed.includes('<html')
    if (isHtml || (!resp.ok && resp.status === 200)) {
      // Retry via front-controller
      const urlStr = typeof input === 'string' ? input : (input && input.url) ? String(input.url) : ''
      const retryUrl = buildFrontControllerUrl(urlStr)
      try {
        const retryResp = await origFetch(retryUrl, init)
        return retryResp
      } catch (_) {
        return resp
      }
    }
  } catch (_) {
    // On any error, return original response
  }

  return resp
}

// Wrap EventSource to transform /api/* URLs in production
function EventSourcePolyfill(url, ...args) {
  // Dev: keep original URL; Prod: transform /api/* to front-controller override
  let finalUrl = url
  if (!IS_DEV) {
    try {
      const urlStr = String(url || '')
      if (urlStr.startsWith('/api/')) {
        finalUrl = buildFrontControllerUrl(urlStr)
      }
    } catch (_) {}
  }
  // Return the real EventSource instance
  return new OrigEventSource(finalUrl, ...args)
}

// Preserve basic prototype reference to avoid breaking instanceof checks
EventSourcePolyfill.prototype = OrigEventSource.prototype

// Install
window.EventSource = EventSourcePolyfill