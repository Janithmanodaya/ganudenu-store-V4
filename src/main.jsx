import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// Global API polyfills for host deployments (fetch/EventSource fallbacks)
import './lib/api-polyfill.js'
import App from './App.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
)