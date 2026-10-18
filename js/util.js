// Small shared helpers.

export const APP_NAME = 'Openpage';

// Absolute URL of a bundled file (works on the web and inside the iPad app).
export const asset = (path) => new URL(path, document.baseURI).href;
// True inside the native iPad app.
export const isNative = () => !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.share);

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function fmtTime(ms) {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), hr = Math.floor(m / 60);
  const ss = String(s % 60).padStart(2, '0');
  return hr ? `${hr}:${String(m % 60).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = res;
      s.onerror = () => { scripts.delete(src); rej(new Error('Could not load ' + src + ' (are you offline?)')); };
      document.head.append(s);
    }));
  }
  return scripts.get(src);
}

export const prefs = {
  get(k, d) {
    try { const v = localStorage.getItem('fn:' + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('fn:' + k, JSON.stringify(v)); } catch {} },
};

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

// Inside the iPad app: hand the file to the native share sheet (Save to Files, AirDrop, Print, Mail…).
async function nativeShare(blob, name) {
  const data = (await blobToDataURL(blob)).split(',')[1];
  window.webkit.messageHandlers.share.postMessage({ name, type: blob.type, data });
}

// Protected mode (Settings → Privacy & security): nothing leaves the app.
export function blockedOut() {
  if (!prefs.get('protected', false)) return false;
  toast('Exporting and sharing are off in Protected mode');
  return true;
}

export function download(blob, name) {
  if (blockedOut()) return;
  if (isNative()) { nativeShare(blob, name); return; }
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Use the system share sheet when it can take files (iPad/iPhone/Android), else download.
export async function shareOrDownload(blob, name) {
  if (blockedOut()) return;
  if (isNative()) return nativeShare(blob, name);
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  download(blob, name);
}

// Ask the iPad app to do something only native code can (unlock, files, nearby devices).
// Resolves with the native reply, or null outside the iPad app.
const nativeWaiting = new Map();
let nativeSeq = 0;
window.openpageNativeReply = (id, result) => { const r = nativeWaiting.get(id); if (r) { nativeWaiting.delete(id); r(result); } };
export function nativeCall(handler, op, extra = {}) {
  const mh = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[handler];
  if (!mh) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = ++nativeSeq;
    nativeWaiting.set(id, resolve);
    mh.postMessage({ id, op, ...extra });
  });
}

export const nativeWake = (on) => { try { isNative() && window.webkit.messageHandlers.wake.postMessage(!!on); } catch {} };
export const blobToDataURL = (b) => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b);
});
export const dataURLToBlob = (u) => fetch(u).then((r) => r.blob());

export function safeName(s) { return (s || 'Untitled').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80); }

export function pickFiles(accept, { multiple = false, capture } = {}) {
  return new Promise((res) => {
    const inp = document.getElementById('file-input');
    inp.value = '';
    inp.accept = accept;
    inp.multiple = multiple;
    if (capture) inp.setAttribute('capture', capture); else inp.removeAttribute('capture');
    inp.onchange = () => res([...inp.files]);
    inp.click();
  });
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
