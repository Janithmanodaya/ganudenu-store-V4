import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * Dev helper: serve a local fallback for /api/maintenance-status when the backend isn't running.
 * - If the backend at http://localhost:5174 responds, we proxy the real response.
 * - If it doesn't (or times out quickly), we return { enabled: false, message: '' } to avoid noisy proxy errors.
 */
function devMaintenanceStatusFallback() {
  const BACKEND = process.env.BACKEND_URL || 'http://localhost:5174'
  const TIMEOUT_MS = Number(process.env.MAINTENANCE_STATUS_TIMEOUT_MS || 500)

  return {
    name: 'dev-maintenance-status-fallback',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = req.url || ''
          if (!url.startsWith('/api/maintenance-status')) return next()

          // If a manual override is provided, always serve mock in dev
          if (process.env.MOCK_MAINTENANCE_STATUS === '1') {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ enabled: false, message: '' }))
            return
          }

          // Try to fetch from backend quickly; if it fails, serve fallback
          const controller = new AbortController()
          const to = setTimeout(() => controller.abort(), TIMEOUT_MS)
          try {
            const r = await fetch(`${BACKEND}/api/maintenance-status`, { signal: controller.signal })
            clearTimeout(to)
            const text = await r.text()
            // Pass through response from backend
            res.statusCode = r.status
            for (const [k, v] of r.headers.entries()) {
              // Avoid overriding Vite dev headers accidentally
              if (k.toLowerCase() === 'transfer-encoding') continue
              res.setHeader(k, v)
            }
            res.end(text)
            return
          } catch (_) {
            clearTimeout(to)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ enabled: false, message: '' }))
            return
          }
        } catch {
          // On any unexpected error, do not block the request chain
          return next()
        }
      })
    }
  }
}

export default defineConfig({
  // Use relative paths in the built index.html so deployments in subdirectories work (assets -> ./assets)
  base: './',
  plugins: [
    devMaintenanceStatusFallback(),
    react()
  ],
  server: {
    port: 5173,
    // Allow Cloudflare Tunnel host to access dev server
    allowedHosts: ['test.ganudenu.store'],
    proxy: {
      // Proxy API calls to the backend server to avoid JSON parse errors from Vite's index.html
      '/api': {
        target: 'http://localhost:5174',
        changeOrigin: true
      },
      '/uploads': {
        target: 'http://localhost:5174',
        changeOrigin: true
      }
    }
  },
  build: {
    // Generate manifest so index.html loader can find the built entry
    manifest: true,
    rollupOptions: {
      // Ensure the app entry is included in the build even if index.html doesn't reference it directly
      input: {
        index: path.resolve(__dirname, 'index.html'),
        app: path.resolve(__dirname, 'src/main.jsx')
      }
    }
  }
})