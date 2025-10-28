/**
 * Global API and asset polyfills for hosts without proper rewrites.
 * - fetch: retry any failing/non-JSON /api/* responses via /api/index.php?r=<path> (covers 4xx/5xx and HTML fallbacks)
 * - EventSource: in production, rewrite /api/* to /api/index.php?r=<path>
 * - Image src: in production, rewrite /uploads/* to /api/index.php?r=/uploads/* to survive hosts without PHP rewrites
 * - Also upgrade same-origin http:// URLs to https:// when the page is on https (avoid mixed-content blocking)
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
  const urlWithQuery = String(pathLike || '')
  const fc = `${base}?r=${encodeURIComponent(urlWithQuery)}`
  return fc
}

function sameOrigin(urlStr) {
  try {
    const u = new URL(urlStr, window.location.origin)
    return u.origin === window.location.origin
  } catch {
    return false
  }
}

function maybeUpgradeToHttps(urlStr) {
  try {
    if (window.location.protocol !== 'https:') return urlStr
    const u = new URL(urlStr, window.location.origin)
    if (u.protocol === 'http:' && u.hostname === window.location.hostname) {
      u.protocol = 'https:'
      return u.toString()
    }
  } catch {}
  return urlStr
}

function normalizeAssetUrl(urlStr) {
  // Only active in production builds
  if (IS_DEV) return urlStr
  if (!urlStr) return urlStr
  try {
    // Rewrite relative /uploads/* to front-controller override to bypass missing rewrites on shared hosts
    if (urlStr.startsWith('/uploads/')) {
      return buildFrontControllerUrl(urlStr)
    }
    // Absolute same-origin /uploads paths
    if (sameOrigin(urlStr)) {
      const u = new URL(urlStr, window.location.origin)
      if (u.pathname.startsWith('/uploads/')) {
        return buildFrontControllerUrl(u.pathname + (u.search || ''))
      }
    }
    // Avoid mixed content if page is https and URL is same-origin http
    return maybeUpgradeToHttps(urlStr)
  } catch {
    return urlStr
  }
}

// Wrap fetch with fallback retry
window.fetch = async function(input, init) {
  // In dev, use original fetch directly
  if (IS_DEV) {
    return origFetch(input, init)
  }

  // Only consider retry logic for /api/* relative same-origin requests
  const shouldCheck = isApiRelativeUrl(input)

  // Call original
  let resp = null
  try {
    resp = await origFetch(input, init)
  } catch (_) {
    // Network error: if it's an /api/* call, try front-controller once
    if (shouldCheck) {
      const urlStr = typeof input === 'string' ? input : (input && input.url) ? String(input.url) : ''
      const retryUrl = buildFrontControllerUrl(urlStr)
      try { return await origFetch(retryUrl, init) } catch { return null }
    }
    return null
  }
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
    // Retry when HTML fallback OR any non-OK status (e.g., 502 Bad Gateway from proxies)
    if (isHtml || !resp.ok) {
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

// Install EventSource polyfill
window.EventSource = EventSourcePolyfill

// Install global IMG src normalizer (production only)
;(function installImageSrcRewrite() {
  if (IS_DEV) return
  try {
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    if (desc && desc.set) {
      const origSet = desc.set
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) {
          try {
            const v = String(value || '')
            const norm = normalizeAssetUrl(v)
            return origSet.call(this, norm)
          } catch {
            return origSet.call(this, value)
          }
        }
      })
    }
    // Also patch setAttribute for safety when setting src via attributes
    const origSetAttr = Element.prototype.setAttribute
    Element.prototype.setAttribute = function(name, value) {
      if (!name || typeof name !== 'string') return origSetAttr.call(this, name, value)
      if (name.toLowerCase() === 'src' && this instanceof HTMLImageElement) {
        try {
          const v = String(value || '')
          const norm = normalizeAssetUrl(v)
          return origSetAttr.call(this, name, norm)
        } catch {
          // fallthrough
        }
      }
      return origSetAttr.call(this, name, value)
    }
  } catch {
    // ignore
  }
})()