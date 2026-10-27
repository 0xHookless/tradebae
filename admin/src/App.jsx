import { useEffect, useState } from 'react'
import { startSession, endSession, loginPost, hasSession, getStoredUser, me, api } from './api.js'
import { Ico, Icons, Dialog, Toasts, useToasts } from './ui.jsx'
import Overview from './pages/Overview.jsx'
import Catalog from './pages/Catalog.jsx'
import Licenses from './pages/Licenses.jsx'
import Audit from './pages/Audit.jsx'

const TABS = [
  { id: 'overview', label: 'Overview', icon: Icons.home },
  { id: 'catalog', label: 'Catalog', icon: Icons.box },
  { id: 'licenses', label: 'Licenses', icon: Icons.key },
  { id: 'audit', label: 'Audit', icon: Icons.list },
]

export default function App() {
  const [mode, setMode] = useState(hasSession() ? 'app' : 'login')
  const [user, setUser] = useState(getStoredUser()?.username || '')
  const [tab, setTab] = useState('overview')
  const [pwOpen, setPwOpen] = useState(false)
  const [toasts, pushToast] = useToasts()

  useEffect(() => {
    const onAuth = e => { if (!e.detail) { setMode('login'); setUser('') } }
    window.addEventListener('tba-auth', onAuth)
    if (hasSession()) me().then(who => { if (who && typeof who === 'object') setUser(who.username) }).catch(() => {})
    return () => window.removeEventListener('tba-auth', onAuth)
  }, [])

  if (mode === 'login') return <Login onIn={u => { setUser(u); setMode('app') }} />

  return (
    <div className="shell">
      <div className="topbar">
        <span className="brand"><span className="dot" style={{ fontFamily: 'var(--mono)', fontSize: 9 }}>TB</span> Trade Bay</span>
        <span className="crumb">· Admin · <b>{TABS.find(t => t.id === tab)?.label}</b></span>
        <span className="spacer" />
      </div>
      <nav className="rail">
        {TABS.map(t => (
          <button key={t.id} className="rail-btn" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)} title={t.label}>
            <Ico d={t.icon} size={18} />
          </button>
        ))}
        <span className="rail-push" />
        <button className="rail-btn" onClick={() => setPwOpen(true)} title="Change password">
          <Ico d={Icons.shield} size={18} />
        </button>
        <button className="rail-btn" onClick={() => { endSession(); setUser(''); setMode('login') }} title="Sign out">
          <Ico d={Icons.logout} size={18} />
        </button>
      </nav>
      <div className="main">
        {tab === 'overview' && <Overview />}
        {tab === 'catalog' && <Catalog pushToast={pushToast} />}
        {tab === 'licenses' && <Licenses pushToast={pushToast} />}
        {tab === 'audit' && <Audit />}
      </div>
      <div className="statusbar">
        <span className="lead"><span className="dot" /> Connected</span>
        <span className="sep">·</span>
        <span>signed in as <code>{user}</code></span>
        <span className="push" />
        <span>server</span>
        <span className="sep">·</span>
        <code>v1.0.0</code>
        <span className="sep">·</span>
        <code>admin v2</code>
      </div>
      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} pushToast={pushToast} />}
      <Toasts items={toasts} />
    </div>
  )
}

function Login({ onIn }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const d = await loginPost(u.trim(), p)
      const who = await fetch('/auth/me', { headers: { Authorization: 'Bearer ' + d.access_token } }).then(r => r.ok ? r.json() : null)
      onIn((who && who.username) || u.trim())
    } catch (ex) { setErr(ex.message || 'Login failed') } finally { setBusy(false) }
  }
  return (
    <form className="login" onSubmit={submit}>
      <div className="aurora" />
      <div className="login-card">
        <div className="lg"><b>Trade Bay · Admin</b><span>Distribution control panel</span></div>
        <div className="field">
          <label htmlFor="lu">Username</label>
          <input id="lu" className="input mono" autoFocus autoComplete="username" value={u} onChange={e => setU(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="lp">Password</label>
          <div className="input-wrap">
            <input id="lp" className="input mono" type={show ? 'text' : 'password'} autoComplete="current-password" value={p} onChange={e => setP(e.target.value)} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShow(s => !s)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        {err && <div className="err">{err}</div>}
        <button className="btn btn-primary" disabled={busy || !u || !p}>Sign in</button>
      </div>
    </form>
  )
}

function PasswordDialog({ onClose, pushToast }) {
  const [oldPw, setOld] = useState('')
  const [newPw, setNew] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async e => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await api('/auth/change-password', { method: 'POST', body: { old_password: oldPw, new_password: newPw } }); pushToast('Password changed'); onClose() }
    catch (ex) { setErr(ex.detailText || ex.message) }
    finally { setBusy(false) }
  }
  return (
    <Dialog title="Change password" onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field span2">
          <label>Current password</label>
          <input className="input mono" type="password" autoFocus value={oldPw} onChange={e => setOld(e.target.value)} />
        </div>
        <div className="field span2">
          <label>New password (min 10 chars)</label>
          <input className="input mono" type="password" value={newPw} onChange={e => setNew(e.target.value)} />
        </div>
        {err && <div className="err span2 msg">{err}</div>}
        <div className="span2 dactions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !oldPw || newPw.length < 10}>Change</button>
        </div>
      </form>
    </Dialog>
  )
}
