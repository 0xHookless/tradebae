import { useEffect, useState } from 'react'

export const Ico = ({ d, size = 14 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
)
export const Icons = {
  home: 'M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5',
  box: 'M12 2 21 7v10l-9 5-9-5V7l9-5zM3.3 7.3 12 12l8.7-4.7M12 12v10',
  key: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5 3-3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4m0 0L7 9m5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2',
  zip: 'M22 8V5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3M22 8h-6M22 13h-6M11 3v4M11 7v3M11 10v3M11 13v3',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16 16l5 5',
  cog: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 2.5a7 7 0 0 0-1.7 1l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 2.5h5l.4-2.5a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.07-.33.1-.66.1-1z',
  x: 'M6 6l12 12M18 6 6 18',
  shield: 'M12 2 4 5v6c0 5 3.4 9.6 8 11 4.6-1.4 8-6 8-11V5l-8-3zM9 12l2 2 4-4',
  publish: 'M4 19h16M12 15V4m0 0L7 9m5-5 5 5',
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9L12 3z',
  paw: 'M11 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM16.5 5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM7 8a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zM17 10a4.5 4.5 0 0 0-4.5 4.5V19a2 2 0 0 1-2 2c-2.5 0-4.5-2.6-4.5-6 0-4 2.5-7 6-7',
  logout: 'M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9M10 17l5-5-5-5M15 12H21',
}

export function Tile({ name, lg }) {
  const mono = (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'
  return <div className={lg ? 'tile lg' : 'tile'}>{mono}</div>
}

export function Pill({ tone = '', children }) {
  return <span className={'pill ' + tone}>{children}</span>
}

export function Dialog({ title, onClose, children, wide }) {
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={wide ? 'dialog wide' : 'dialog'} role="dialog" aria-modal="true">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Toasts({ items }) {
  return (
    <div className="toasts">
      {items.map(t => <div key={t.id} className={t.tone === 'err' ? 'toast err' : 'toast ok'}>{t.text}</div>)}
    </div>
  )
}

export function useToasts() {
  const [items, setItems] = useState([])
  const push = (text, tone = 'ok') => {
    const id = Math.random().toString(36).slice(2)
    setItems(l => [...l, { id, text, tone }])
    setTimeout(() => setItems(l => l.filter(i => i.id !== id)), 4200)
  }
  return [items, push]
}

export function ProductEditor({ all, products, value, onChange }) {
  if (!products?.length) return <div className="muted" style={{ padding: 12 }}>No software in catalog yet — create it first.</div>
  const allowed = value ? value.split(',').map(s => s.trim()).filter(Boolean) : []
  const isAll = allowed.includes('*')
  const toggle = slug => {
    if (isAll) return onChange('*')
    const next = allowed.includes(slug) ? allowed.filter(s => s !== slug) : [...allowed, slug]
    onChange(sortProds(next))
  }
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={isAll} onChange={e => onChange(e.target.checked ? '*' : '')} />
        All products ({all.length})
      </label>
      <div className="prods">
        {products.map(s => (
          <label key={s.slug} className="check">
            <input
              type="checkbox"
              disabled={isAll}
              checked={isAll || allowed.includes(s.slug)}
              onChange={() => toggle(s.slug)}
            />
            {s.display_name} <span className="tl">{s.slug}</span>
          </label>
        ))}
      </div>
      {!isAll && !allowed.length && <div className="hint" style={{ color: '#e5566f' }}>Select at least one product.</div>}
    </>
  )
}

export function fmtSize(n) {
  if (n == null) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

export function fmtWhen(s) {
  if (!s) return '—'
  const d = new Date(typeof s === 'string' ? (s.endsWith('Z') || s.includes('+') ? s : s + 'Z') : s)
  return d.toLocaleString()
}

export function sortProds(v) {
  if (!v) return ''
  const list = Array.isArray(v) ? v : String(v).split(',')
  const set = [...new Set(list.map(s => String(s).trim()).filter(Boolean))]
  set.sort()
  return set.join(',')
}

export function scopeList(l, slugs) {
  if (l?.software_slug === '*' || !l?.software_slug) return ['All']
  return l.software_slug.split(',').map(s => s.trim()).filter(Boolean)
}

export function licenseActive(l) {
  if (l.revoked) return { tone: 'red', label: 'Revoked' }
  if (l.expires_at && new Date(l.expires_at + (l.expires_at.endsWith('Z') ? '' : 'Z')) < new Date()) return { tone: 'amber', label: 'Expired' }
  return { tone: 'green', label: 'Active' }
}
