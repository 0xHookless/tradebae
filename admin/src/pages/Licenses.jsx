import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Ico, Icons, Pill, Dialog, ProductEditor, licenseActive, fmtWhen, scopeList, sortProds } from '../ui.jsx'

export default function Licenses({ pushToast }) {
  const [lic, setLic] = useState(null)
  const [sw, setSw] = useState([])
  const [q, setQ] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editLic, setEditLic] = useState(null)
  const [err, setErr] = useState('')

  const reload = () =>
    Promise.all([api('/licenses'), fetch('/software').then(r => r.json())])
      .then(([l, s]) => { setLic(Array.isArray(l) ? l : l.licenses || []); setSw(Array.isArray(s) ? s : s.software || []) })
      .catch(ex => setErr(ex.message))
  useEffect(() => { reload() }, [])

  const filtered = (lic || []).filter(l => {
    if (!q.trim()) return true
    const hay = `${l.key} ${l.software_slug} ${l.note} ${l.hwid_masked || ''}`.toLowerCase()
    return hay.includes(q.toLowerCase())
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Licenses</h1>
        <span className="sub">Keys, product scope and device binding</span>
        <span className="spacer" />
        <div className="search"><Ico d={Icons.search} /><input className="input mono" placeholder="search key, scope, note…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}><Ico d={Icons.plus} /> New license</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Key</th><th style={{ width: 90 }}>State</th><th>Products</th><th style={{ width: 150 }}>Bound device</th><th>Expires</th><th>Note</th><th style={{ width: 300 }} /></tr>
          </thead>
          <tbody>
            {filtered.map(l => {
              const st = licenseActive(l)
              return (
                <tr key={l.key}>
                  <td><code className="mono strong">{l.key.slice(0, 20)}…</code></td>
                  <td><Pill tone={st.tone}>{st.label}</Pill></td>
                  <td>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', maxWidth: 320 }}>
                      {scopeList(l).map(p => Array.isArray(p) ? null : p === 'All'
                        ? <Pill key={p} tone="blue">All products</Pill>
                        : <Pill key={p}>{p}</Pill>)}
                    </div>
                  </td>
                  <td className="mono">{l.hwid_masked || <span className="muted">unbound</span>}</td>
                  <td className="mono">{fmtWhen(l.expires_at)}</td>
                  <td className="muted" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.note}</td>
                  <td>
                    <div className="actions">
                      <button className="btn btn-sm" title="Copy full key" onClick={() => { navigator.clipboard?.writeText(l.key); pushToast('Key copied') }}>
                        <Ico d={Icons.key} /> key
                      </button>
                      <button className="btn btn-sm" onClick={() => setEditLic(l)}>Manage</button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {!filtered.length && <tr><td colSpan={7} className="table-empty">{lic ? 'No licenses match.' : 'Loading…'}</td></tr>}
          </tbody>
        </table>
      </div>
      {err && <p className="msg err">{err}</p>}
      {createOpen && <LicenseForm sw={sw} onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); reload(); pushToast('License created') }} />}
      {editLic && <ManageLicense l={editLic} sw={sw} onClose={() => setEditLic(null)} onDone={() => { reload(); pushToast('License updated') }} pushToast={pushToast} />}
    </div>
  )
}

function LicenseForm({ sw, onClose, onDone }) {
  const [days, setDays] = useState(30)
  const [note, setNote] = useState('')
  const [scope, setScope] = useState('*')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    const body = { days: Number(days) || 0, software_slug: scope, note }
    if (key.trim()) body.key = key.trim()
    try { await api('/licenses', { method: 'POST', body }); onDone() }
    catch (ex) { setErr(ex.detailText || ex.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title="Create license" onClose={onClose} wide>
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label>Custom key (optional)</label>
          <input className="input mono" placeholder="LIC-… (blank = auto-generate)" value={key} onChange={e => setKey(e.target.value)} />
        </div>
        <div className="field">
          <label>Duration (days, 0 = perpetual)</label>
          <input className="input mono" type="number" min="0" value={days} onChange={e => setDays(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Note</label>
          <input className="input" placeholder="e.g. reseller X, 2 seats" value={note} onChange={e => setNote(e.target.value)} />
        </div>
        <div className="field span2">
          <label>Products</label>
          <ProductEditor all={sw} products={sw} value={scope} onChange={setScope} />
        </div>
        {err && <div className="err msg span2">{err}</div>}
        <div className="span2" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !scope}>Create</button>
        </div>
      </form>
    </Dialog>
  )
}

function ManageLicense({ l, sw, onClose, onDone, pushToast }) {
  const [scope, setScope] = useState(l.software_slug || '*')
  const [extend, setExtend] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const run = async (path, method, body, msg, close) => {
    setBusy(true); setErr('')
    try { await api(path, { method, body }); pushToast(msg); onDone(); if (close) onClose() }
    catch (ex) { setErr(ex.detailText || ex.message) }
    finally { setBusy(false) }
  }
  const scopeChanged = (scope || '*') !== (l.software_slug || '*')
  const prodBody = { products: scope === '*' ? '*' : sortProds(scope).split(',') }
  return (
    <Dialog title={`Manage · ${l.key}`} onClose={onClose} wide>
      <div className="form-grid">
        <div className="field span2">
          <label>Products</label>
          <ProductEditor all={sw} products={sw} value={scope} onChange={setScope} />
        </div>
        <div className="field">
          <label>Extend (days)</label>
          <input className="input mono" type="number" min="1" value={extend} onChange={e => setExtend(e.target.value)} placeholder="e.g. 30" />
        </div>
        <div className="field">
          <label>&nbsp;</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" disabled={busy || !extend} onClick={() => run(`/licenses/${l.key}/extend`, 'POST', { days: Number(extend) }, 'Extended', true)}>Extend</button>
            <button className="btn" disabled={busy || !l.hwid_masked} onClick={() => run(`/licenses/${l.key}/unbind`, 'POST', undefined, 'Device unbound')}>Unbind device</button>
          </div>
        </div>
        <div className="field span2" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {!l.revoked && <button className="btn btn-danger" disabled={busy} onClick={() => run(`/licenses/${l.key}/revoke`, 'POST', undefined, 'License revoked', true)}>Revoke</button>}
          <button className="btn btn-primary" disabled={busy || !scope || !scopeChanged} onClick={() => run(`/licenses/${l.key}/products`, 'PUT', prodBody, 'Products updated', true)}>Save products</button>
        </div>
        <div className="field span2">
          <label>Key</label>
          <div className="input-wrap">
            <code className="mono" style={{ fontSize: 12, flex: 1 }}>{l.key}</code>
            <button className="btn btn-sm" onClick={() => { navigator.clipboard?.writeText(l.key); pushToast('Key copied') }}>Copy</button>
          </div>
        </div>
        {err && <div className="err msg span2">{err}</div>}
      </div>
    </Dialog>
  )
}
