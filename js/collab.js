// Collaboration without accounts or servers.
//
// A "shared subject" is linked to a folder you share in iCloud Drive (Files app → Share →
// Collaborate). Every note in it is stored there as an encrypted file; only people who know the
// subject's passphrase can read it — not Apple, not anyone else who gets the folder.
// Changes merge object by object, so two people writing in the same note keep both their strokes.
// iPads near each other also exchange edits live (Apple's Multipeer Connectivity, no internet).
import { db } from './db.js';
import { exportNoteFile, importNoteData, unpackBlobs, packBlobs, blobIdsOf } from './export.js';
import { h, prefs, toast, isNative, nativeCall, debounce } from './util.js';
import { profile } from './security.js';
import { setMood } from './mascot.js';

const ITER = 310000, SPACE_FILE = 'openpage-space.json', EXT = '.opage.enc';
const te = new TextEncoder(), td = new TextDecoder();
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------- encryption (AES-256-GCM, key from PBKDF2)
async function deriveKey(passphrase, saltB64, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(text)));
  return JSON.stringify({ v: 1, iv: b64(iv), data: b64(data) });
}
async function unseal(key, sealed) {
  const o = JSON.parse(sealed);
  return td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.data)));
}
async function spaceHash(spaceId) {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('openpage-live:' + spaceId)))).replace(/[^a-z0-9]/gi, '').slice(0, 16);
}

// ---------------------------------------------------------------- folders: iPad (native bridge) or desktop Chrome (File System Access)
export const collabSupported = () => isNative() || typeof window.showDirectoryPicker === 'function';
function folderAPI(folder) {
  if (folder.kind === 'native') {
    const call = (op, extra) => nativeCall('collab', op, { ref: folder.ref, ...extra });
    return {
      list: async () => (await call('list')) || [],
      read: async (name) => { const r = await call('read', { name }); return r && r.text != null ? r.text : null; },
      write: async (name, text) => { const r = await call('write', { name, text }); return (r && r.modified) || Date.now(); },
      remove: (name) => call('remove', { name }),
    };
  }
  const dir = folder.handle;
  return {
    list: async () => { const out = []; for await (const [name, fh] of dir.entries()) if (fh.kind === 'file') out.push({ name, modified: (await fh.getFile()).lastModified }); return out; },
    read: async (name) => { try { return await (await (await dir.getFileHandle(name)).getFile()).text(); } catch { return null; } },
    write: async (name, text) => { const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(text); await w.close(); return (await fh.getFile()).lastModified; },
    remove: async (name) => { try { await dir.removeEntry(name); } catch {} },
  };
}
async function pickFolder() {
  if (isNative()) { const r = await nativeCall('collab', 'pick'); return r && r.ref ? { kind: 'native', ref: r.ref, name: r.name } : null; }
  if (typeof window.showDirectoryPicker !== 'function') { toast('Shared folders work in the iPad app, or in Chrome/Edge on a computer.'); return null; }
  try { const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'openpage-shared' }); return { kind: 'web', handle, name: handle.name }; } catch { return null; }
}

// ---------------------------------------------------------------- spaces (shared subjects)
const keys = new Map();   // spaceId -> CryptoKey (also kept, non-extractable, in IndexedDB)
export async function spaces() { return (await db.all('meta')).filter((m) => m.id.startsWith('space:')); }
export async function spaceForSubject(subjectId) { return (await spaces()).find((s) => s.subjectId === subjectId) || null; }
async function keyFor(space) {
  if (keys.has(space.spaceId)) return keys.get(space.spaceId);
  const k = await db.get('meta', 'key:' + space.spaceId);
  if (k && k.key) { keys.set(space.spaceId, k.key); return k.key; }
  return null;
}
async function rememberKey(spaceId, key) { keys.set(spaceId, key); try { await db.put('meta', { id: 'key:' + spaceId, key }); } catch {} }

// Ask for a passphrase in a small dialog. twice: confirm it (when creating).
function askPassphrase(title, twice) {
  return new Promise((resolve) => {
    const a = h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Passphrase', 'aria-label': 'Passphrase' });
    const b = twice ? h('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat passphrase', 'aria-label': 'Repeat passphrase' }) : null;
    const msg = h('p', { class: 'secure-msg', 'aria-live': 'polite' });
    const ok = h('button', { class: 'btn primary', type: 'button' }, 'Continue');
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const el = h('div', { class: 'secure-screen pin-sheet', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'secure-card' }, h('h2', {}, title),
        h('p', {}, twice ? 'Everyone in this subject needs this passphrase. Share it in person or by message, never in the shared folder. At least 10 characters; it can\'t be recovered.' : 'Enter the passphrase the person who shared this subject gave you.'),
        a, b || '', msg, h('div', { class: 'secure-actions' }, cancel, ok)));
    document.body.append(el);
    a.focus();
    const done = (v) => { el.remove(); resolve(v); };
    ok.onclick = () => {
      if (twice && a.value.length < 10) { msg.textContent = 'Use at least 10 characters.'; return; }
      if (twice && a.value !== b.value) { msg.textContent = 'The passphrases don\'t match.'; return; }
      if (!a.value) return;
      done(a.value);
    };
    (b || a).onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
    cancel.onclick = () => done(null);
  });
}

// Share an existing subject: pick (or make) a folder in iCloud Drive, set a passphrase.
export async function shareSubject(app, subject) {
  if (await spaceForSubject(subject.id)) { toast('This subject is already shared'); return; }
  toast('Choose or create an empty folder in iCloud Drive for this subject', 5000);
  const folder = await pickFolder();
  if (!folder) return;
  const api = folderAPI(folder);
  if ((await api.list()).some((f) => f.name === SPACE_FILE)) { toast('That folder already holds a shared subject. Use "Join shared subject" instead.', 6000); return; }
  const pass = await askPassphrase(`Passphrase for "${subject.name}"`, true);
  if (!pass) return;
  const spaceId = crypto.randomUUID(), salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const key = await deriveKey(pass, salt);
  const header = { format: 'openpage-space', v: 1, spaceId, salt, iter: ITER, check: await seal(key, 'openpage:' + spaceId),
    subject: await seal(key, JSON.stringify({ id: subject.id, name: subject.name, color: subject.color })) };
  await api.write(SPACE_FILE, JSON.stringify(header));
  const space = { id: 'space:' + spaceId, spaceId, subjectId: subject.id, folder, folderName: folder.name, created: Date.now() };
  await db.put('meta', space);
  await rememberKey(spaceId, key);
  await syncSpace(app, space);
  startLive(app);
  app.renderNav();
  await howToInvite(subject.name, folder.name);
}

// Join a subject someone shared with you: pick their shared folder, enter the passphrase.
export async function joinSubject(app) {
  toast('Choose the shared folder in iCloud Drive (accept the invite first)', 5000);
  const folder = await pickFolder();
  if (!folder) return;
  const api = folderAPI(folder);
  const raw = await api.read(SPACE_FILE);
  if (!raw) { toast('That folder isn\'t an Fennet shared subject (or it\'s still downloading — try again in a moment)', 6000); return; }
  const header = JSON.parse(raw);
  if ((await spaces()).some((s) => s.spaceId === header.spaceId)) { toast('You\'ve already joined this subject'); return; }
  let key = null;
  for (let tries = 0; tries < 5 && !key; tries++) {
    const pass = await askPassphrase(tries ? 'Wrong passphrase — try again' : 'Join shared subject', false);
    if (!pass) return;
    const k = await deriveKey(pass, header.salt, header.iter);
    try { if ((await unseal(k, header.check)) === 'openpage:' + header.spaceId) key = k; } catch {}
  }
  if (!key) return;
  const subj = JSON.parse(await unseal(key, header.subject));
  if (!(await db.get('subjects', subj.id))) {
    const s = { id: subj.id, name: subj.name, color: subj.color, dividerId: null, edited: Date.now() };
    await db.put('subjects', s);
    app.subjects.push(s);
  }
  const space = { id: 'space:' + header.spaceId, spaceId: header.spaceId, subjectId: subj.id, folder, folderName: folder.name, created: Date.now() };
  await db.put('meta', space);
  await rememberKey(header.spaceId, key);
  const r = await syncSpace(app, space);
  startLive(app);
  app.renderNav();
  toast(`Joined "${subj.name}"${r ? ` · ${r.pulled} notes` : ''}`);
}

export async function stopSharing(app, subjectId) {
  const space = await spaceForSubject(subjectId);
  if (!space) return;
  await db.del('meta', space.id);
  await db.del('meta', 'key:' + space.spaceId);
  await db.del('meta', 'base:' + space.spaceId);
  keys.delete(space.spaceId);
  startLive(app);
  app.renderNav();
  toast('This subject is no longer shared from this device. The notes stay here; the shared folder is unchanged.', 6000);
}

function howToInvite(subjectName, folderName) {
  return new Promise((resolve) => {
    const ok = h('button', { class: 'btn primary', type: 'button' }, 'Got it');
    const el = h('div', { class: 'secure-screen pin-sheet', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'secure-card invite' }, h('h2', {}, `"${subjectName}" is shared`),
        h('ol', {},
          h('li', {}, `Open the Files app → iCloud Drive → "${folderName}".`),
          h('li', {}, 'Press and hold the folder → Share → Collaborate, and invite people (only they can open it).'),
          h('li', {}, 'Tell them the passphrase yourself — in person or in a message.'),
          h('li', {}, 'They open Fennet → + New → Join shared subject, and pick the folder.')),
        h('p', {}, 'Notes sync through iCloud within seconds to minutes. iPads near each other also update live.'), ok));
    document.body.append(el);
    ok.onclick = () => { el.remove(); resolve(); };
  });
}

// ---------------------------------------------------------------- merging
// What each note looked like at the last sync, so deletions can be told apart from additions.
export const idsOf = (content) => ({ pages: content.pages.map((p) => p.id), objs: Object.fromEntries(content.pages.map((p) => [p.id, p.objs.map((o) => o.id)])),
  recs: (content.recordings || []).map((r) => r.id) });

// 3-way merge by id: keeps everything either side added, drops what either side deleted.
export function mergeContent(base, local, remote, localNewer) {
  const bPages = new Set(base ? base.pages : []);
  const L = new Map(local.pages.map((p) => [p.id, p])), R = new Map(remote.pages.map((p) => [p.id, p]));
  const keepPage = (id, inL, inR) => (inL && inR) || !bPages.has(id);   // present on both, or newly added on one side
  const order = [];
  for (const p of remote.pages) if (keepPage(p.id, L.has(p.id), true)) order.push(p.id);
  local.pages.forEach((p, i) => {
    if (R.has(p.id) || !keepPage(p.id, true, false)) return;
    const prev = i > 0 ? local.pages[i - 1].id : null, at = prev ? order.indexOf(prev) : -1;
    order.splice(at + 1, 0, p.id);
  });
  const pages = order.map((id) => {
    const lp = L.get(id), rp = R.get(id);
    if (!lp || !rp) return clone(lp || rp);
    const bIds = new Set((base && base.objs[id]) || []);
    const lo = new Map(lp.objs.map((o) => [o.id, o])), ro = new Map(rp.objs.map((o) => [o.id, o]));
    const objs = [];
    for (const o of rp.objs) {
      if (lo.has(o.id)) objs.push(clone(localNewer ? lo.get(o.id) : o));      // edited on both: newest note wins
      else if (!bIds.has(o.id)) objs.push(clone(o));                         // added remotely
    }
    for (const o of lp.objs) if (!ro.has(o.id) && !bIds.has(o.id)) objs.push(clone(o));   // added here
    return { ...clone(localNewer ? lp : rp), objs };
  });
  const bRecs = new Set(base ? base.recs : []);
  const recs = new Map();
  for (const r of remote.recordings || []) if ((local.recordings || []).some((x) => x.id === r.id) || !bRecs.has(r.id)) recs.set(r.id, r);
  for (const r of local.recordings || []) if (!recs.has(r.id) && !bRecs.has(r.id)) recs.set(r.id, r);
  const newer = localNewer ? local : remote;
  return { ...clone(newer), id: local.id, pages: pages.length ? pages : clone(newer.pages), recordings: [...recs.values()] };
}

// ---------------------------------------------------------------- folder sync
let syncing = null;
export function syncAll(app, quiet = true) {
  if (!syncing) syncing = (async () => {
    let pulled = 0, pushed = 0;
    for (const s of await spaces()) {
      try { const r = await syncSpace(app, s); if (r) { pulled += r.pulled; pushed += r.pushed; } }
      catch (e) { console.warn('shared subject sync failed', e); if (!quiet) toast('Couldn\'t reach a shared folder. Check iCloud Drive and try again.'); }
    }
    return { pulled, pushed };
  })().finally(() => { syncing = null; });
  return syncing;
}

async function openEditorFor(app, noteId) { return app.panes.find((p) => p.note && p.note.id === noteId) || null; }

async function syncSpace(app, space) {
  const key = await keyFor(space);
  if (!key) return null;
  const api = folderAPI(space.folder);
  const files = await api.list();
  const remote = new Map();
  for (const f of files) if (f.name.endsWith(EXT)) remote.set(f.name.slice(0, -EXT.length), f);
  const baseRec = (await db.get('meta', 'base:' + space.spaceId)) || { id: 'base:' + space.spaceId, notes: {} };
  const base = baseRec.notes;
  let pulled = 0, pushed = 0;

  const push = async (note, content) => {
    const blob = await exportNoteFile({ ...note, subjectId: space.subjectId }, content);
    const modified = await api.write(note.id + EXT, await seal(key, await blob.text()));
    base[note.id] = { mod: modified, updated: note.updated, ids: idsOf(content) };
    pushed++;
  };

  for (const [id, f] of remote) {
    if (f.pending) continue;                            // iCloud is still downloading it
    const b = base[id];
    let local = await db.get('notes', id);
    if (local && local.deleted) {                       // deleted here: remove for everyone
      if (b) { await api.remove(id + EXT); delete base[id]; }
      continue;
    }
    const remoteChanged = !b || b.mod !== f.modified;
    const ed = await openEditorFor(app, id);
    if (ed && ed.dirty) { await ed.saveNow(); local = await db.get('notes', id); }
    const localChanged = local && (!b || (local.updated || 0) > (b.updated || 0));
    if (!remoteChanged && !localChanged) continue;
    if (!remoteChanged) { await push(local, await db.get('content', id)); continue; }
    const text = await api.read(id + EXT);
    if (text == null) continue;
    let data;
    try { data = JSON.parse(await unseal(key, text)); } catch { console.warn('shared note could not be decrypted', id); continue; }
    data.note.subjectId = space.subjectId;
    if (!local) {
      await importNoteData(data, new Set([space.subjectId]), { keepId: true });
      base[id] = { mod: f.modified, updated: data.note.updated, ids: idsOf(data.content) };
      app.noteChanged(await db.get('notes', id), { fromSync: true });
      pulled++;
      continue;
    }
    if (!localChanged) {                                // only they changed it
      await importNoteData(data, new Set([space.subjectId]), { keepId: true });
      base[id] = { mod: f.modified, updated: data.note.updated, ids: idsOf(data.content) };
      const n = await db.get('notes', id);
      app.noteChanged(n, { fromSync: true });
      if (ed) ed.applyRemote(await db.get('content', id), n);
      pulled++;
      continue;
    }
    // both changed: merge, save here, and write the merged note back
    await unpackBlobs(data.blobs);
    const lc = await db.get('content', id);
    const localNewer = (local.updated || 0) >= (data.note.updated || 0);
    const merged = mergeContent(b && b.ids, lc, { ...data.content, id }, localNewer);
    const note = { ...(localNewer ? local : { ...data.note, thumb: local.thumb }), subjectId: space.subjectId, updated: Math.max(local.updated || 0, data.note.updated || 0) + 1 };
    await db.put('content', merged);
    await db.put('notes', note);
    app.noteChanged(note, { fromSync: true });
    if (ed) ed.applyRemote(merged, note);
    await push(note, merged);
    pulled++;
  }

  // notes here that the folder doesn't have
  for (const n of await db.all('notes')) {
    if (n.subjectId !== space.subjectId || remote.has(n.id)) continue;
    if (base[n.id]) {                                   // someone deleted it: move to Recently Deleted here
      if (!n.deleted) { n.deleted = Date.now(); await db.put('notes', n); app.noteChanged(n, { fromSync: true }); }
      delete base[n.id];
      continue;
    }
    if (n.deleted) continue;
    await push(n, await db.get('content', n.id));
  }
  await db.put('meta', baseRec);
  prefs.set('collabSync:' + space.spaceId, Date.now());
  if (pulled) { app.notes = await db.all('notes'); app.render(); }
  return { pulled, pushed };
}

// ---------------------------------------------------------------- live editing with iPads nearby
const live = { peers: [], spaces: new Map(), sent: new Map() };   // hash -> space; noteId -> last exchanged content ids
window.openpageLiveEvent = async (ev) => {
  if (ev.type === 'peers') {
    const before = live.peers.length;
    live.peers = ev.peers || [];
    document.body.classList.toggle('live-peers', live.peers.length > 0);
    if (live.peers.length > before) { toast(`Live with ${live.peers.join(', ')} nearby`); setMood('excited', 2500); }
    window.dispatchEvent(new CustomEvent('openpage-live-peers', { detail: live.peers }));
  } else if (ev.type === 'data') {
    try { await receiveLive(ev.text); } catch (e) { console.warn('live update ignored', e); }
  }
};
let liveApp = null;
export async function startLive(app) {
  liveApp = app;
  if (!isNative()) return;
  live.spaces.clear();
  const list = await spaces();
  for (const s of list) live.spaces.set(await spaceHash(s.spaceId), s);
  if (!list.length) { nativeCall('collab', 'liveStop'); return; }
  nativeCall('collab', 'liveStart', { spaces: [...live.spaces.keys()], name: (profile() && profile().name) || 'Fennet' });
}

// Called when a note is saved here: send it to nearby collaborators in the same shared subject.
const pending = new Map();
export async function noteSaved(note) {
  if (!live.peers.length || !note || note.deleted) return;
  const space = await spaceForSubject(note.subjectId);
  if (!space) return;
  clearTimeout(pending.get(note.id));
  pending.set(note.id, setTimeout(() => sendLive(space, note.id), 250));
}
async function sendLive(space, noteId) {
  const key = await keyFor(space);
  if (!key) return;
  const note = await db.get('notes', noteId), content = await db.get('content', noteId);
  if (!note || !content) return;
  const prev = live.sent.get(noteId);
  const known = new Set(prev ? prev.blobs : []);
  const blobs = blobIdsOf(content).filter((b) => !known.has(b));
  const { thumb, ...meta } = note;
  const msg = await seal(key, JSON.stringify({ note: meta, content, blobs: await packBlobs(blobs), base: prev ? prev.ids : null, from: profile() && profile().id }));
  live.sent.set(noteId, { ids: idsOf(content), blobs: blobIdsOf(content) });
  nativeCall('collab', 'liveSend', { text: JSON.stringify({ space: await spaceHash(space.spaceId), payload: msg }) });
}
async function receiveLive(text) {
  const { space: hash, payload } = JSON.parse(text);
  const space = live.spaces.get(hash);
  if (!space || !liveApp) return;
  const key = await keyFor(space);
  const data = JSON.parse(await unseal(key, payload));
  await unpackBlobs(data.blobs);
  const id = data.note.id, app = liveApp;
  const ed = await openEditorFor(app, id);
  if (ed && ed.dirty) await ed.saveNow();
  const local = await db.get('notes', id), lc = await db.get('content', id);
  const note = { ...data.note, subjectId: space.subjectId };
  let content = { ...data.content, id };
  if (local && lc) content = mergeContent(data.base || (live.sent.get(id) || {}).ids || null, lc, content, (local.updated || 0) > (note.updated || 0));
  const saved = { ...(local || {}), ...note, thumb: local ? local.thumb : null, updated: Math.max(note.updated || 0, (local && local.updated) || 0) };
  await db.put('content', content);
  await db.put('notes', saved);
  live.sent.set(id, { ids: idsOf(content), blobs: blobIdsOf(content) });
  app.noteChanged(saved, { fromSync: true });
  if (ed) ed.applyRemote(content, saved); else app.render();
}

// ---------------------------------------------------------------- settings section + background sync
export function collabSettings(app) {
  const list = h('div', { class: 'collab-list' });
  const draw = async () => {
    list.textContent = '';
    const sp = await spaces();
    if (!sp.length) list.append(h('small', {}, 'No shared subjects yet. Share one from a subject\'s ⋯ menu, or join one with + New → Join shared subject.'));
    for (const s of sp) {
      const subj = app.subjects.find((x) => x.id === s.subjectId);
      const last = prefs.get('collabSync:' + s.spaceId, 0);
      list.append(h('div', { class: 'collab-row' }, h('span', { class: 'dot', style: { background: subj ? subj.color : 'var(--dot-muted)' } }),
        h('span', {}, `${subj ? subj.name : 'Shared subject'} · iCloud Drive/${s.folderName || ''}`),
        h('small', {}, last ? `synced ${new Date(last).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not synced yet')));
    }
    if (live.peers.length) list.append(h('small', {}, `Live now with: ${live.peers.join(', ')}`));
  };
  draw();
  const now = h('button', { type: 'button', class: 'btn small' }, 'Sync shared subjects now');
  now.onclick = async () => { const r = await syncAll(app, false); toast(`Synced · ${r.pulled} updated here, ${r.pushed} sent`); draw(); };
  const join = h('button', { type: 'button', class: 'btn small' }, 'Join shared subject…');
  join.onclick = () => joinSubject(app).then(draw);
  return h('div', { class: 'field', 'data-sec': 'collab' },
    h('span', { style: { fontSize: '15px' } }, 'Collaboration'),
    h('small', {}, 'Share a subject through a folder in iCloud Drive. Notes are encrypted with a passphrase before they leave this device; iPads nearby also update each other live without the internet.'),
    list, h('div', { class: 'row' }, now, join));
}

export function initCollab(app) {
  if (!collabSupported()) return;
  startLive(app);
  const soon = debounce(() => syncAll(app), 5000);
  app.collabSoon = soon;
  setInterval(() => document.visibilityState === 'visible' && !document.body.classList.contains('is-locked') && syncAll(app), 30000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && soon());
  soon();
}
