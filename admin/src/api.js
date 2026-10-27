const LS_ACCESS = 'tba_tok'
const LS_REFRESH = 'tba_ref'
const LS_USER = 'tba_user'

export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(LS_USER) || 'null') } catch { return null }
}

export function startSession(access, refresh, username) {
  localStorage.setItem(LS_ACCESS, access)
  localStorage.setItem(LS_REFRESH, refresh)
  localStorage.setItem(LS_USER, JSON.stringify({ username }))
}

export function endSession() {
  localStorage.removeItem(LS_ACCESS)
  localStorage.removeItem(LS_REFRESH)
  localStorage.removeItem(LS_USER)
}

export function hasSession() { return !!localStorage.getItem(LS_REFRESH) }
export function me() {
  return fetch('/auth/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem(LS_ACCESS) } })
    .then(r => r.ok ? r.json() : null)
}

let refreshing = null
export async function refreshTokens() {
  refreshing = refreshing || (async () => {
    const ref = localStorage.getItem(LS_REFRESH)
    if (!ref) return false
    const r = await fetch(`/auth/refresh?refresh_token=${encodeURIComponent(ref)}`, { method: 'POST' })
    if (!r.ok) { endSession(); return false }
    const d = await r.json()
    localStorage.setItem(LS_ACCESS, d.access_token)
    localStorage.setItem(LS_REFRESH, d.refresh_token)
    return true
  })()
  try { return await refreshing } finally { refreshing = null }
}

export async function api(path, { method = 'GET', body, headers = {}, retry = true } = {}) {
  const tok = localStorage.getItem(LS_ACCESS)
  const h = { ...headers }
  if (tok) h.Authorization = 'Bearer ' + tok
  const opts = { method, headers: h }
  if (body !== undefined) {
    opts.body = typeof body === 'string' ? body : JSON.stringify(body)
    h['Content-Type'] = 'application/json'
  }
  const r = await fetch('' + path, opts)
  if (r.status === 401 && retry && localStorage.getItem(LS_REFRESH)) {
    const ok = await refreshTokens()
    if (ok) return api(path, { ...arguments[1], retry: false })
    endSession()
    location.hash = '#'
    window.dispatchEvent(new CustomEvent('tba-auth', { detail: false }))
    throw new Error('Session expired — please sign in again')
  }
  if (!r.ok) {
    let detail = r.statusText
    try { const j = await r.json(); if (j.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch {}
    const err = new Error(`${r.status}: ${detail}`)
    err.status = r.status
    err.detailText = detail
    throw err
  }
  return r.json().then(j => {
    if (j && typeof j === 'object') { try { Object.defineProperty(j, '__status', { value: r.status, enumerable: false }) } catch {} }
    return j
  })
}

export async function loginPost(username, password) {
  const r = await fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.detail || 'Login failed')
  startSession(d.access_token, d.refresh_token, username)
  return d
}

export async function uploadMultipart(path, formData, onProgress) {
  const tok = localStorage.getItem(LS_ACCESS)
  const opts = { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: formData }
  if (onProgress) return xhrUpload('' + path, opts, onProgress)
  const r = await fetch('' + path, opts)
  if (r.status === 401 && localStorage.getItem(LS_REFRESH)) {
    const ok = await refreshTokens()
    if (ok) return uploadMultipart(path, formData, onProgress)
    endSession()
    throw new Error('Session expired')
  }
  if (!r.ok) {
    let detail = r.statusText
    try { const j = await r.json(); if (j.detail) detail = j.detail } catch {}
    throw new Error(`${r.status}: ${detail}`)
  }
  return r.json()
}

function xhrUpload(url, opts, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(opts.method, url)
    xhr.setRequestHeader('Authorization', opts.headers.Authorization)
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)) }
    xhr.onload = () => {
      if (xhr.status === 200) { try { resolve(JSON.parse(xhr.responseText)) } catch (e) { resolve({}) } }
      else {
        let d = xhr.statusText
        try { d = JSON.parse(xhr.responseText).detail || d } catch {}
        reject(new Error(`${xhr.status}: ${d}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(opts.body)
  })
}
