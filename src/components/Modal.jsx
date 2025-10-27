import React from 'react'

export default function Modal({ open, title, children, onClose }) {
  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'grid',
        placeItems: 'center',
        zIndex: 50
      }}
      onMouseDown={(e) => {
        const target = e.target
        // Close if backdrop clicked
        if (target && target.getAttribute('role') === 'dialog') {
          onClose && onClose()
        }
      }}
    >
      <div className="card" style={{ width: 'min(640px, 92vw)' }}>
        <div className="h2" style={{ marginTop: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span>{title || 'Info'}</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      </div>
    </div>
  )
}