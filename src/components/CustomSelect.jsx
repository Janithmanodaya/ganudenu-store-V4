import React, { useEffect, useMemo, useRef, useState } from 'react'

/**
 * CustomSelect
 * - Keeps the trigger sized like the native .select control
 * - Renders a floating dropdown menu that is more spacious and clear
 * - Keyboard: Enter/Space to open, Esc to close, ArrowUp/Down to navigate, Enter to select
 * - Optional searchable mode with a text input to filter options (mobile-friendly)
 * - Optional allowCustom to commit arbitrary text not in the options list
 * - Optional virtualized list rendering for large datasets (keeps DOM light and smooth)
 */
export default function CustomSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select...',
  ariaLabel,
  className = '',
  searchable = false,
  allowCustom = false,
  // Enhancements (opt-in to avoid changing behavior on other pages)
  virtualized = false,
  optionHeight = 36,
  maxDropdownHeight = 300,
}) {
  const [open, setOpen] = useState(false)
  const [hoverIndex, setHoverIndex] = useState(-1)
  const [searchTerm, setSearchTerm] = useState('')
  const [openUp, setOpenUp] = useState(false)
  const [menuMaxHeight, setMenuMaxHeight] = useState(maxDropdownHeight)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(maxDropdownHeight)

  const rootRef = useRef(null)
  const btnRef = useRef(null)
  const listRef = useRef(null)
  const searchInputRef = useRef(null)

  const selectedIndex = useMemo(() => {
    return options.findIndex(o => String(o.value) === String(value))
  }, [options, value])

  // Filtered view when searchable
  const filteredOptions = useMemo(() => {
    if (!searchable) return options
    const t = searchTerm.trim().toLowerCase()
    if (!t) return options
    return options.filter(o => String(o.label ?? o.value).toLowerCase().includes(t))
  }, [options, searchable, searchTerm])

  const selectedIndexInFiltered = useMemo(() => {
    return filteredOptions.findIndex(o => String(o.value) === String(value))
  }, [filteredOptions, value])

  useEffect(() => {
    function onDocClick(e) {
      if (!rootRef.current) return
      if (!rootRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  // Decide open direction and compute max height dynamically on open
  useEffect(() => {
    if (!open) return
    // Reset hover to selected (or first) when opening
    setHoverIndex(selectedIndexInFiltered >= 0 ? selectedIndexInFiltered : (filteredOptions.length ? 0 : -1))
    // Clear search only once when opening, not on every keystroke/filter size change
    setSearchTerm('')

    try {
      const vh = typeof window !== 'undefined' ? window.innerHeight : 800
      const dynamicMax = Math.min(Math.max(260, Math.floor(vh * 0.6)), Math.max(260, maxDropdownHeight))
      setMenuMaxHeight(dynamicMax)

      if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect()
        const spaceBelow = vh - rect.bottom - 10
        const spaceAbove = rect.top - 10
        // Open upward if there's significantly more space above than below
        setOpenUp(spaceBelow < dynamicMax * 0.6 && spaceAbove > spaceBelow)
      } else {
        setOpenUp(false)
      }
    } catch (_) {
      setOpenUp(false)
      setMenuMaxHeight(maxDropdownHeight)
    }

    // On mobile, ensure the field is visible above the keyboard by scrolling into view
    setTimeout(() => {
      // Focus search input if available
      if (searchable && searchInputRef.current) {
        try { searchInputRef.current.focus() } catch (_) {}
      }
      if (rootRef.current) {
        try {
          const rect = rootRef.current.getBoundingClientRect()
          const top = rect.top + window.scrollY - 100 // small offset
          window.scrollTo({ top, behavior: 'smooth' })
        } catch (_) {
          // fallback: scroll into view
          try { rootRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (_) {}
        }
      }
    }, 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep hover item in view when navigating via keyboard
  useEffect(() => {
    if (!open || hoverIndex < 0 || !listRef.current) return
    try {
      const itemTop = hoverIndex * optionHeight
      const itemBottom = itemTop + optionHeight
      const st = listRef.current.scrollTop
      const ch = listRef.current.clientHeight
      if (itemTop < st) {
        listRef.current.scrollTop = itemTop
      } else if (itemBottom > st + ch) {
        listRef.current.scrollTop = itemBottom - ch
      }
    } catch (_) {}
  }, [hoverIndex, open, optionHeight])

  // Track container height for virtualization
  useEffect(() => {
    if (!open || !listRef.current) return
    const update = () => {
      const h = listRef.current.clientHeight || menuMaxHeight
      setContainerHeight(h)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, menuMaxHeight])

  function commitSelect(idx) {
    if (idx < 0 || idx >= filteredOptions.length) return
    const opt = filteredOptions[idx]
    if (onChange) onChange(opt.value)
    setOpen(false)
    // Return focus to the button for accessibility
    btnRef.current && btnRef.current.focus()
  }

  function commitCustom(val) {
    const v = String(val || '').trim()
    if (!v) return
    if (onChange) onChange(v)
    setOpen(false)
    btnRef.current && btnRef.current.focus()
  }

  function onKeyDown(e) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHoverIndex(i => Math.min(filteredOptions.length - 1, i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHoverIndex(i => Math.max(0, i - 1))
      return
    }
    if (e.key === 'PageDown') {
      e.preventDefault()
      const page = Math.max(1, Math.floor(containerHeight / optionHeight) - 1)
      setHoverIndex(i => Math.min(filteredOptions.length - 1, i + page))
      return
    }
    if (e.key === 'PageUp') {
      e.preventDefault()
      const page = Math.max(1, Math.floor(containerHeight / optionHeight) - 1)
      setHoverIndex(i => Math.max(0, i - page))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (searchable && allowCustom && searchTerm.trim() && filteredOptions.findIndex(o => String(o.value) === searchTerm.trim()) === -1) {
        commitCustom(searchTerm.trim())
      } else {
        commitSelect(hoverIndex >= 0 ? hoverIndex : selectedIndexInFiltered)
      }
    }
  }

  const label = selectedIndex >= 0 ? (options[selectedIndex].label ?? options[selectedIndex].value) : placeholder

  // Virtualization calculations
  const itemH = Number(optionHeight) || 36
  const overscan = 4
  const startIndex = virtualized ? Math.max(0, Math.floor(scrollTop / itemH) - overscan) : 0
  const visibleCount = virtualized ? Math.ceil(containerHeight / itemH) + overscan * 2 : filteredOptions.length
  const endIndex = virtualized ? Math.min(filteredOptions.length, startIndex + visibleCount) : filteredOptions.length
  const topPad = virtualized ? startIndex * itemH : 0
  const itemsToRender = virtualized ? filteredOptions.slice(startIndex, endIndex) : filteredOptions

  return (
    <div ref={rootRef} className={`custom-select ${className || ''}`} style={{ position: 'relative' }}>
      <button
        type="button"
        className="input custom-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-label={ariaLabel || placeholder}
        onClick={() => setOpen(o => !o)}
        onKeyDown={onKeyDown}
        ref={btnRef}
        style={{
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          width: '100%'
        }}
      >
        <span style={{ color: selectedIndex >= 0 ? 'var(--text)' : '#7f8ba3' }}>{label}</span>
        <span aria-hidden="true" style={{ opacity: 0.8 }}>▾</span>
      </button>

      {open && (
        <div
          role="listbox"
          ref={listRef}
          tabIndex={-1}
          className="custom-select-menu"
          onScroll={virtualized ? (e) => { setScrollTop(e.currentTarget.scrollTop) } : undefined}
          style={{
            position: 'absolute',
            zIndex: 50,
            left: 0,
            right: 0,
            ...(openUp ? { bottom: '100%', marginBottom: 6 } : { top: '100%', marginTop: 6 }),
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: 'rgba(22, 28, 38, 0.98)',
            boxShadow: '0 14px 36px var(--shadow)',
            maxHeight: menuMaxHeight,
            overflowY: 'auto',
            padding: 6
          }}
        >
          {searchable && (
            <div style={{ padding: '6px 6px 8px 6px', position: 'sticky', top: 0, zIndex: 2, background: 'rgba(22, 28, 38, 0.98)' }}>
              <input
                ref={searchInputRef}
                className="input"
                type="text"
                placeholder="Type to filter..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                onFocus={() => {
                  // When keyboard opens, make sure the control stays visible
                  if (rootRef.current) {
                    try {
                      const rect = rootRef.current.getBoundingClientRect()
                      const top = rect.top + window.scrollY - 100
                      window.scrollTo({ top, behavior: 'smooth' })
                    } catch (_) {
                      try { rootRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch (_) {}
                    }
                  }
                }}
                style={{ width: '100%' }}
                aria-label="Filter options"
              />
            </div>
          )}

          {filteredOptions.length === 0 && (
            <div
              className="custom-select-option"
              style={{
                padding: '10px 12px',
                fontSize: 15,
                color: 'var(--muted)'
              }}
            >
              No options
            </div>
          )}

          {!virtualized && filteredOptions.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value)
            const isHover = idx === hoverIndex
            return (
              <div
                key={String(opt.value)}
                role="option"
                aria-selected={isSelected ? 'true' : 'false'}
                className="custom-select-option"
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(-1)}
                onClick={() => commitSelect(idx)}
                style={{
                  padding: '10px 12px',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontSize: 15,
                  lineHeight: 1.4,
                  background: isHover ? '#1a2332' : 'transparent',
                  color: 'var(--text)',
                  outline: isSelected ? '2px solid rgba(108,127,247,0.35)' : 'none'
                }}
              >
                {opt.label ?? opt.value}
              </div>
            )
          })}

          {virtualized && filteredOptions.length > 0 && (
            <div style={{ position: 'relative', height: filteredOptions.length * itemH }}>
              <div style={{ transform: `translateY(${topPad}px)` }}>
                {itemsToRender.map((opt, relIdx) => {
                  const idx = startIndex + relIdx
                  const isSelected = String(opt.value) === String(value)
                  const isHover = idx === hoverIndex
                  return (
                    <div
                      key={`${String(opt.value)}-${idx}`}
                      role="option"
                      aria-selected={isSelected ? 'true' : 'false'}
                      className="custom-select-option"
                      onMouseEnter={() => setHoverIndex(idx)}
                      onMouseLeave={() => setHoverIndex(-1)}
                      onClick={() => commitSelect(idx)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        cursor: 'pointer',
                        fontSize: 15,
                        lineHeight: 1.4,
                        height: itemH,
                        display: 'flex',
                        alignItems: 'center',
                        background: isHover ? '#1a2332' : 'transparent',
                        color: 'var(--text)',
                        outline: isSelected ? '2px solid rgba(108,127,247,0.35)' : 'none'
                      }}
                    >
                      {opt.label ?? opt.value}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}