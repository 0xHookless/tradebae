import { useEffect, useRef, useState } from 'react'
import { api, uploadMultipart } from '../api.js'
import { Ico, Icons, Tile, Pill, Dialog, fmtSize, fmtWhen } from '../ui.jsx'

export default function Catalog({ pushToast }) {
  const [sw, setSw] = useState([])
  const [sel, setSel] = useState(null)
  const [rels, setRels] = useState([])
  const [detail, setDetail] = useState(null)
  const [editOpen, setEditOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [relOpen, setRelOpen] = useState(false)
  const [err, setErr] = useState('')

  const loadSoftware = () =>
    fetch('/software').then(r => r.json()).then(l => {
      const arr = Array.isArray(l) ? l : l.software || []
      setSw(arr)
      if (!sel && arr.length) setSel(arr[0].slug)
    })

  useEffect(() => { loadSoftware() }, [])
  useEffect(() => {
    setDetail(null); setRels([])
    if (!sel) return
    fetch(`/releases/${sel}`).then(r => r.json()).then(setRels).catch(() => {})
  }, [sel])

  const refreshDetail = id =>
    fetch(`/release/${id}`).then(r => r.json()).then(d => { setDetail(d); return d })

  const openRelease = async rel => {
    try { await refreshDetail(rel.id) } catch (ex) { setErr(ex.message) }
  }

  const active = sw.find(s => s.slug === sel)

  return (
    <div className="page">
      <div className="page-head">
        <h1>Catalog</h1>
        <span className="sub">Applications, releases and package uploads</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreateOpen(true)}><Ico d={Icons.plus} /> New application</button>
      </div>
      <div className="split">
        <div className="mlist">
          <div className="mlist-head"><span className="t">Applications</span><span className="n">{sw.length}</span></div>
          {sw.map(s => (
            <button key={s.slug} className={s.slug === sel ? 'mrow sel' : 'mrow'} onClick={() => setSel(s.slug)}>
              <Tile name={s.display_name} />
              <span className="mid"><span className="nm">{s.display_name}</span><span className="sb mono">{s.slug}</span></span>
              {s.latest_version && <Pill tone="green">{s.latest_version.replace('test-', 'v').slice(0, 14)}</Pill>}
            </button>
          ))}
          {!sw.length && <div className="table-empty">Nothing in the catalog yet.</div>}
        </div>
        <div className="detail">
          {active && <SoftwareDetail key={active.slug} sw={active} rels={rels} onOpenRelease={openRelease} onEdit={() => setEditOpen(true)} onDeleted={() => { setSel(null); setRels([]); setDetail(null); loadSoftware() }} pushToast={pushToast} setRelOpen={setRelOpen} />}
          {detail && <ReleaseDetail key={detail.id} detail={detail} reload={() => { fetch(`/releases/${sel}`).then(r => r.json()).then(setRels); refreshDetail(detail.id) }} pushToast={pushToast} close={() => setDetail(null)} />}
          {err && <p className="msg err">{err}</p>}
        </div>
      </div>
      {editOpen && <SoftwareForm sw={active} onClose={() => setEditOpen(false)} onSaved={() => { loadSoftware(); pushToast('Application updated') }} />}
      {createOpen && <SoftwareForm onClose={() => setCreateOpen(false)} onSaved={() => { loadSoftware(); setCreateOpen(false); pushToast('Application created') }} />}
      {relOpen && active && <NewReleaseDialog sw={active} onClose={() => setRelOpen(false)} onCreated={() => { setRelOpen(false); fetch(`/releases/${sel}`).then(r => r.json()).then(setRels); pushToast('Draft release created') }} />}
    </div>
  )
}

function SoftwareDetail({ sw, rels, onOpenRelease, onEdit, onDeleted, pushToast, setRelOpen }) {
  const [confirmDel, setConfirmDel] = useState(false)
  const del = async () => {
    try {
      await api(`/software/${sw.slug}`, { method: 'DELETE' })
      pushToast('Application deleted', 'err')
      setConfirmDel(false)
      onDeleted()
    } catch (ex) { pushToast(ex.detailText || ex.message, 'err') }
  }
  return (
    <>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
          <Tile name={sw.display_name} lg />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{sw.display_name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{sw.description || '—'}</div>
          </div>
          <button className="btn" onClick={onEdit}><Ico d={Icons.cog} /> Configure</button>
          <button className="btn btn-danger" onClick={() => setConfirmDel(true)}>Delete</button>
        </div>
        <div className="kv">
          <div><span className="k">Latest version</span>{sw.latest_version ? <Pill tone="blue">{sw.latest_version}</Pill> : <span className="muted">none published</span>}</div>
          <div><span className="k">Package size</span><span className="v">{fmtSize(sw.total_size)}</span></div>
          <div><span className="k">Install folder</span><span className="v">{sw.install_dir_name || '—'}</span></div>
          <div><span className="k">Executable</span><span className="v">{sw.executable_name || '—'}</span></div>
          <div><span className="k">Launch args</span><span className="v">{sw.launch_args || '—'}</span></div>
          <div><span className="k">Reflective launch</span><span className="v">{sw.separate_executable ? 'yes' : 'no'}</span></div>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Version</th><th>State</th><th>Files</th><th>Size</th><th>Published</th><th /></tr></thead>
          <tbody>
            {rels.map(r => (
              <tr key={r.id}>
                <td className="mono strong">{r.version}</td>
                <td>{r.published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Draft</Pill>}</td>
                <td>{r.file_count}</td>
                <td className="mono">{fmtSize(r.total_size)}</td>
                <td className="mono">{fmtWhen(r.published_at)}</td>
                <td><div className="actions"><button className="btn btn-sm" onClick={() => onOpenRelease(r)}>Open</button></div></td>
              </tr>
            ))}
            {!rels.length && <tr><td colSpan={6} className="table-empty">No releases yet — create a draft to upload into.</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-primary" onClick={() => setRelOpen(true)}><Ico d={Icons.plus} /> New release</button>
      </div>
      {confirmDel && (
        <Dialog title={`Delete ${sw.display_name}?`} onClose={() => setConfirmDel(false)}>
          <p className="soft" style={{ marginBottom: 14 }}>This removes the application, every release, its files and blobs from the server. Launchers will no longer list it. This cannot be undone.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn" onClick={() => setConfirmDel(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={del}>Delete application</button>
          </div>
        </Dialog>
      )}
    </>
  )
}

function ReleaseDetail({ detail, reload, pushToast, close }) {
  const filesRef = useRef(null)
  const zipRef = useRef(null)
  const [ frm, setFrm ] = useState({ relPath: '', role: 'auto' })
  const [prog, setProg] = useState(null)
  const [zipProg, setZipProg] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const payloadRef = useRef(null)
  const [payloadOver, setPayloadOver] = useState(false)
  const [payloadProg, setPayloadProg] = useState(null)
  const [skipped, setSkipped] = useState([])
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const draft = !detail.published
  const payload = (detail.files || []).find(f => f.role === 'executable')

  const uploadFiles = async list => {
    setErr(''); setMsg('')
    try {
      for (const f of list) {
        const rp = (f.webkitRelativePath || f.name)
        if (rp.toLowerCase().endsWith('.lnk')) { setErr(`.lnk files are not allowed: ${f.name}`); return }
        const fd = new FormData()
        fd.append('file', f)
        fd.append('relative_path', rp)
        fd.append('role', 'normal')  // the payload has its own upload section
        setProg({ name: f.name, p: 0 })
        await uploadMultipart(`/release/${detail.id}/upload`, fd, p => setProg({ name: f.name, p }))
      }
      setMsg(`${list.length} file${list.length > 1 ? 's' : ''} uploaded`)
      setProg(null)
      if (filesRef.current) filesRef.current.value = ''
      reload()
    } catch (ex) { pushToast(ex.detailText || ex.message, 'err'); setProg(null) }
  }

  const uploadZip = async f => {
    setErr(''); setMsg(''); setSkipped([])
    if (!f.name.toLowerCase().endsWith('.zip')) { setErr('Drop a .zip file.'); return }
    const have = (detail.files || []).length
    if (have && !window.confirm(`This draft already has ${have} file${have > 1 ? 's' : ''}. Replace them with the contents of ${f.name}?`)) return
    const fd = new FormData()
    fd.append('file', f)
    if (have) fd.append('replace', 'true')
    setZipProg(0)
    try {
      const res = await uploadMultipart(`/release/${detail.id}/zip`, fd, setZipProg)
      setZipProg(null)
      setSkipped(res.skipped || [])
      setMsg(`Zip accepted · ${res.files} files included${res.skipped?.length ? ` · ${res.skipped.length} excluded` : ''}`)
      pushToast('Package zip uploaded and parsed')
      if (zipRef.current) zipRef.current.value = ''
      reload()
    } catch (ex) { setZipProg(null); setErr(ex.detailText || ex.message) }
  }

  const uploadPayload = async f => {
    setErr(''); setMsg('')
    if (payload && !window.confirm(`Replace the current payload (${payload.relative_path}) with ${f.name}?`)) return
    const fd = new FormData()
    fd.append('file', f)
    setPayloadProg(0)
    try {
      const res = await uploadMultipart(`/release/${detail.id}/payload`, fd, setPayloadProg)
      setPayloadProg(null)
      setMsg(`Payload ${res.relative_path} uploaded · ${fmtSize(res.size)}`)
      pushToast('Payload uploaded')
      if (payloadRef.current) payloadRef.current.value = ''
      reload()
    } catch (ex) { setPayloadProg(null); setErr(ex.detailText || ex.message) }
  }

  const publish = async () => {
    setErr(''); setMsg('')
    try {
      await api(`/release/${detail.id}/publish`, { method: 'POST' })
      pushToast('Release published')
      reload()
    } catch (ex) { setErr(ex.detailText || ex.message) }
  }
  const republish = async () => {
    try { await api(`/release/${detail.id}/republish`, { method: 'POST' }); pushToast('Marked latest'); reload(); } catch (ex) { pushToast(ex.detailText || ex.message, 'err') }
  }
  const delFile = async fid => {
    try { await api(`/release/${detail.id}/files/${fid}`, { method: 'DELETE' }); reload() } catch (ex) { pushToast(ex.detailText || ex.message, 'err') }
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Release <span className="mono" style={{ fontSize: 13 }}>{detail.version}</span></h2>
        {detail.published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Draft</Pill>}
        <span className="spacer" />
        {draft ? <button className="btn btn-run" disabled={!detail.files.length} title={payload ? '' : 'Upload the payload first'} onClick={publish}><Ico d={Icons.publish} /> Publish</button>
               : <button className="btn" onClick={republish}><Ico d={Icons.star} /> Mark latest</button>}
        <button className="btn btn-ghost" onClick={close}><Ico d={Icons.x} /> Close</button>
      </div>

      {draft && (
        <div className="upzone" style={{ marginBottom: 12 }}>
          <span className="lbl"><Ico d={Icons.upload} /> Upload payload</span>
          <span className="desc">The program the launcher loads into memory (for example SierraChart_64.exe). It is encrypted on the server and is not part of the package zip.</span>
          {payload && (
            <div className="msg ok" style={{ textAlign: 'left' }}>
              Current payload: <code className="mono">{payload.relative_path}</code> · {fmtSize(payload.size)} · <span className="mono">{(payload.sha256 || '').slice(0, 12)}…</span>
            </div>
          )}
          <div
            className={'dropzone' + (payloadOver ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setPayloadOver(true) }}
            onDragLeave={() => setPayloadOver(false)}
            onDrop={e => { e.preventDefault(); setPayloadOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) uploadPayload(f) }}
            onClick={() => payloadRef.current && payloadRef.current.click()}
            role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); payloadRef.current && payloadRef.current.click() } }}
          >
            {payload ? 'Drop a new payload here to replace it, or click to choose one' : 'Drop the payload .exe here, or click to choose one'}
          </div>
          <input ref={payloadRef} type="file" hidden onChange={e => e.target.files && e.target.files[0] && uploadPayload(e.target.files[0])} />
          {payloadProg != null && <div><div className="bar"><i style={{ width: payloadProg + '%' }} /></div><span className="muted" style={{ fontSize: 11 }}>uploading… {payloadProg}%</span></div>}
        </div>
      )}

      {draft && (
        <div className="uprow">
          <div className="upzone">
            <span className="lbl"><Ico d={Icons.upload} /> Add files</span>
            <span className="desc">Individual package files (config, helpers, other .exe tools). Not the payload. Relative path below.</span>
            <div className="input-wrap">
              <input className="input mono" placeholder="relative/path/file.exe" value={frm.relPath} onChange={e => setFrm({ ...frm, relPath: e.target.value })} style={{ height: 34 }} />
            </div>
            <input ref={filesRef} type="file" multiple style={{ fontSize: 12, color: 'var(--muted)' }} onChange={e => e.target.files && e.target.files.length && uploadFiles(e.target.files)} />
            {prog && <div><div className="bar"><i style={{ width: prog.p + '%' }} /></div><span className="muted" style={{ fontSize: 11 }}>{prog.name} · {prog.p}%</span></div>}
          </div>
          <div className="upzone">
            <span className="lbl"><Ico d={Icons.zip} /> Upload package zip</span>
            <span className="desc">Everything except the payload, in one .zip. The server builds the file list from it. Forbidden files are left out.</span>
            <div
              className={'dropzone' + (dragOver ? ' over' : '')}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if (f) uploadZip(f) }}
              onClick={() => zipRef.current && zipRef.current.click()}
              role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); zipRef.current && zipRef.current.click() } }}
            >
              Drop the package .zip here, or click to choose one
            </div>
            <input ref={zipRef} type="file" accept=".zip" hidden onChange={e => e.target.files && e.target.files[0] && uploadZip(e.target.files[0])} />
            {zipProg != null && <div><div className="bar"><i style={{ width: zipProg + '%' }} /></div><span className="muted" style={{ fontSize: 11 }}>parsing… {zipProg}%</span></div>}
          </div>
        </div>
      )}

      {msg && <p className="msg ok">{msg}</p>}
      {skipped.length > 0 && (
        <div className="msg err" style={{ textAlign: 'left' }}>
          <b>{skipped.length} file{skipped.length > 1 ? 's were' : ' was'} left out of the package:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {skipped.slice(0, 12).map(x => <li key={x.path}><code className="mono">{x.path}</code> — {x.reason}</li>)}
            {skipped.length > 12 && <li>…and {skipped.length - 12} more</li>}
          </ul>
        </div>
      )}
      {err && <p className="msg err">{err}</p>}

      <table className="table" style={{ marginTop: 10 }}>
        <thead><tr><th>Path</th><th>Size</th><th>Role</th><th>SHA-256</th>{draft && <th style={{ width: 60 }} />}</tr></thead>
        <tbody>
          {detail.files.map(f => (
            <tr key={f.id}>
              <td className="mono strong">{f.relative_path}</td>
              <td className="mono">{fmtSize(f.size)}</td>
              <td><Pill tone={f.role === 'executable' ? 'red' : ''}>{f.role === 'executable' ? 'payload' : f.role}</Pill></td>
              <td className="mono muted" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>{(f.sha256 || '').slice(0, 12)}…</td>
              {draft && <td><div className="actions"><button className="btn btn-sm" onClick={() => delFile(f.id)}>Delete</button></div></td>}
            </tr>
          ))}
          {!detail.files.length && <tr><td colSpan={5} className="table-empty">No files yet.</td></tr>}
        </tbody>
      </table>
      <div className="kv" style={{ marginTop: 12 }}>
        <div><span className="k">Zip SHA-256</span><span className="v">{detail.zip_sha256 ? detail.zip_sha256.slice(0, 24) + '…' : '—'}</span></div>
        <div><span className="k">Zip size</span><span className="v">{detail.zip_size != null ? fmtSize(detail.zip_size) : '—'}</span></div>
        <div><span className="k">Total</span><span className="v">{fmtSize(detail.total_size)}</span></div>
      </div>
    </div>
  )
}

function SoftwareForm({ sw, onClose, onSaved }) {
  const isEdit = !!sw
  const [f, setF] = useState(isEdit ? { ...sw } : { slug: '', display_name: '', install_dir_name: '', executable_name: '', launch_args: '', description: '', icon_url: '', separate_executable: true })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k, v) => setF(o => ({ ...o, [k]: v }))
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try {
      if (isEdit) await api(`/software/${sw.slug}`, { method: 'PUT', body: { ...f, slug: sw.slug } })
      else await api('/software', { method: 'POST', body: { ...f, separate_executable: !!f.separate_executable } })
      onSaved()
      onClose()
    } catch (ex) { setErr(ex.detailText || ex.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={isEdit ? `Configure ${sw.display_name}` : 'New application'} onClose={onClose} wide>
      <form className="form-grid" onSubmit={submit}>
        {!isEdit && (
          <div className="field">
            <label>Slug (license scope id)</label>
            <input className="input mono" placeholder="metatrader-5" value={f.slug} onChange={e => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} autoFocus />
          </div>
        )}
        <div className={isEdit ? '' : 'field'}>
          {isEdit ? <label className="muted" style={{ fontSize: 12 }}>slug: <code style={{ fontFamily: 'var(--mono)' }}>{sw.slug}</code></label> : <span />}
        </div>
        <div className="field"><label>Display name</label><input className="input" value={f.display_name} onChange={e => set('display_name', e.target.value)} /></div>
        <div className="field"><label>Install folder name</label><input className="input mono" value={f.install_dir_name} onChange={e => set('install_dir_name', e.target.value)} /></div>
        <div className="field"><label>Executable</label><input className="input mono" value={f.executable_name} onChange={e => set('executable_name', e.target.value)} /></div>
        <div className="field span2"><label>Launch args</label><input className="input mono" value={f.launch_args} onChange={e => set('launch_args', e.target.value)} /></div>
        <div className="field span2"><label>Description</label><textarea className="input" value={f.description} onChange={e => set('description', e.target.value)} /></div>
        <div className="field span2"><label>Icon URL (optional, for future use)</label><input className="input mono" value={f.icon_url} onChange={e => set('icon_url', e.target.value)} /></div>
        <div className="field span2">
          <label className="check"><input type="checkbox" checked={!!f.separate_executable} onChange={e => set('separate_executable', e.target.checked)} /> Reflective (separate) executable launch</label>
        </div>
        {err && <div className="err msg span2">{err}</div>}
        <div className="span2" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f.display_name || (!isEdit && !f.slug)}>{isEdit ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Dialog>
  )
}

function NewReleaseDialog({ sw, onClose, onCreated }) {
  const [v, setV] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async e => {
    e.preventDefault(); setBusy(true); setErr('')
    try { await api(`/releases/${sw.slug}`, { method: 'POST', body: { version: v } }); onCreated(); onClose() }
    catch (ex) { setErr(ex.detailText || ex.message) } finally { setBusy(false) }
  }
  return (
    <Dialog title={`New release · ${sw.display_name}`} onClose={onClose}>
      <form className="form-grid" onSubmit={submit}>
        <div className="field span2">
          <label>Version tag</label>
          <input className="input mono" placeholder="1.0.2" value={v} onChange={e => setV(e.target.value.trim())} autoFocus />
        </div>
        {err && <div className="err msg span2">{err}</div>}
        <div className="span2" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !v}>Create draft</button>
        </div>
      </form>
    </Dialog>
  )
}
