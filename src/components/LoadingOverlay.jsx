import React from 'react'

export default function LoadingOverlay({ message = 'Loading...' }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
      <div className="card" style={{ maxWidth: 420, textAlign: 'center' }}>
        <div className="h2" style={{ marginTop: 0 }}>{message}</div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <div
            aria-label="Loading"
            role="status"
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              border: '4px solid rgba(108,127,247,0.2)',
              borderTopColor: '#6c7ff7',
              animation: 'spin 1s linear infinite'
            }}
          />
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}