import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtWhen, fmtSize } from '../ui.jsx'

export default function Overview() {
  const [sw, setSw] = useState(null)
  const [hc, setHc] = useState(null)
  const [lic, setLic] = useState(null)
  const [aud, setAud] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/software').then(r => r.json()),
      fetch('/health').then(r => r.json()),
      api('/licenses'),
      api('/audit'),
    ]).then(([s, h, l, a]) => { setSw(s); setHc(h); setLic(Array.isArray(l) ? l : l.licenses || []); setAud(Array.isArray(a) ? a : a.audit || []) })
      .catch(ex => setErr(ex.message))
  }, [])

  const apps = Array.isArray(sw) ? sw : sw?.software || []
  const published = apps.filter(a => a.latest_version).length
  const active = (lic || []).filter(l => !l.revoked && !(l.expires_at && new Date(l.expires_at + (l.expires_at.endsWith('Z') ? '' : 'Z')) < new Date())).length
  const totalSize = apps.reduce((n, a) => n + (a.total_size || 0), 0)

  return (
    <div className="page">
      <div className="page-head">
        <h1>Overview</h1>
        <span className="sub">Server status and recent activity</span>
      </div>
      <div className="stats">
        <div className="stat"><span className="v">{apps.length}</span><span className="k">Applications</span></div>
        <div className="stat"><span className="v blue">{published}</span><span className="k">Published</span></div>
        <div className="stat"><span className="v">{(lic || []).length}</span><span className="k">Licenses</span></div>
        <div className="stat"><span className="v green">{active}</span><span className="k">Active</span></div>
        <div className="stat"><span className="v">{fmtSize(totalSize)}</span><span className="k">Distributed</span></div>
        <div className="stat"><span className="v" style={hc ? { color: '#44a282' } : { color: '#e5566f' }}>{hc ? 'OK' : '—'}</span><span className="k">Service</span></div>
      </div>
      <div style={{ marginTop: 24 }} className="table-wrap">
        <table className="table">
          <thead>
            <tr><th style={{ width: 180 }}>Time</th><th style={{ width: 130 }}>Actor</th><th style={{ width: 180 }}>Action</th><th>Target</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {(aud || []).slice(0, 10).map(a => (
              <tr key={a.id}>
                <td className="mono">{fmtWhen(a.created_at)}</td>
                <td className="mono">{a.actor}</td>
                <td className="mono strong">{a.action}</td>
                <td className="mono">{a.target}</td>
                <td className="muted">{a.detail}</td>
              </tr>
            ))}
            {!(aud || []).length && <tr><td className="table-empty" colSpan={5}>No activity yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {err && <p className="msg err">{err}</p>}
    </div>
  )
}
