import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { Ico, Icons, Pill, fmtWhen } from '../ui.jsx'

const TONE = {
  login: 'blue', login_failed: 'red', login_locked: 'red', change_password: 'amber',
  revoke_license: 'red', delete_software: 'red', delete_file: 'red',
  create_license: 'green', publish_release: 'green', create_software: 'blue',
}

export default function Audit() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')

  const load = () =>
    api('/audit').then(a => setRows(a))
      .catch(ex => setErr(ex.message))
  useEffect(() => { load() }, [])

  const filtered = (rows || []).filter(r => {
    if (!q.trim()) return true
    return `${r.actor} ${r.action} ${r.target} ${r.detail}`.toLowerCase().includes(q.toLowerCase())
  })

  return (
    <div className="page">
      <div className="page-head">
        <h1>Audit log</h1>
        <span className="sub">Most recent 200 server events</span>
        <span className="spacer" />
        <div className="search"><Ico d={Icons.search} /><input className="input mono" placeholder="filter by actor, action, target…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className="btn" onClick={load}><Ico d={Icons.refresh} /> Refresh</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th style={{ width: 180 }}>Time</th><th style={{ width: 130 }}>Actor</th><th style={{ width: 200 }}>Action</th><th>Target</th><th>Detail</th></tr>
          </thead>
          <tbody>
            {filtered.map(r => (
              <tr key={r.id}>
                <td className="mono">{fmtWhen(r.created_at)}</td>
                <td className="mono">{r.actor}</td>
                <td><Pill tone={TONE[r.action] || ''}>{r.action}</Pill></td>
                <td className="mono strong">{r.target}</td>
                <td className="muted">{r.detail}</td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={5} className="table-empty">{rows ? 'No events match.' : 'Loading…'}</td></tr>}
          </tbody>
        </table>
      </div>
      {err && <p className="msg err">{err}</p>}
    </div>
  )
}
