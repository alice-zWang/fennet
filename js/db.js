// IndexedDB storage. Everything stays on this device.
//   notes:    note metadata (title, subject, thumbnail, search text…)
//   content:  note pages, objects and recordings, keyed by note id
//   subjects / dividers: library organisation
//   blobs:    binary files (PDFs, images, audio)
//   versions: snapshots of notes for version history
//   meta:     app-level records (e.g. the sync folder handle)
import { DEMO, uid } from './util.js';

const NAME = DEMO ? 'openpage-demo' : 'openpage';
const OLD_NAME = 'free-notability';
const VERSION = 2;
const STORES = ['notes', 'content', 'subjects', 'dividers', 'blobs', 'versions', 'meta'];
let dbp;

function openDB(name, version, upgrade) {
  return new Promise((res, rej) => {
    const r = version ? indexedDB.open(name, version) : indexedDB.open(name);
    if (upgrade) r.onupgradeneeded = () => upgrade(r.result, r.transaction);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function open() {
  if (!dbp) {
    dbp = openDB(NAME, VERSION, (db, tx) => {
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!tx.objectStore('versions').indexNames.contains('noteId')) tx.objectStore('versions').createIndex('noteId', 'noteId');
    }).then(async (db) => { if (!DEMO) await migrateOld(db); return db; });
  }
  return dbp;
}

// One-time copy of notes made before the app was renamed.
async function migrateOld(db) {
  try {
    if (localStorage.getItem('fn:migrated')) return;
    localStorage.setItem('fn:migrated', '1');
    if (!indexedDB.databases) return;
    const list = await indexedDB.databases();
    if (!list.some((d) => d.name === OLD_NAME)) return;
    const old = await openDB(OLD_NAME);
    for (const s of ['notes', 'content', 'subjects', 'dividers', 'blobs']) {
      if (!old.objectStoreNames.contains(s)) continue;
      const rows = await req(old.transaction(s).objectStore(s).getAll());
      const st = db.transaction(s, 'readwrite').objectStore(s);
      for (const r of rows) st.put(r);
    }
    old.close();
  } catch (e) { console.warn('migration skipped', e); }
}

function req(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

async function store(name, mode = 'readonly') {
  return (await open()).transaction(name, mode).objectStore(name);
}

// Erase everything Fennet stores in this browser (Settings → Erase all data).
export async function eraseAllStorage() {
  try { if (dbp) (await dbp).close(); } catch {}
  dbp = null;
  const names = new Set([NAME, OLD_NAME]);
  try { for (const d of (await indexedDB.databases?.()) || []) names.add(d.name); } catch {}
  await Promise.all([...names].map((n) => new Promise((res) => { const r = indexedDB.deleteDatabase(n); r.onsuccess = r.onerror = r.onblocked = () => res(); })));
  try { for (const k of await caches.keys()) await caches.delete(k); } catch {}
  try { for (const reg of (await navigator.serviceWorker?.getRegistrations?.()) || []) await reg.unregister(); } catch {}
  localStorage.clear(); sessionStorage.clear();
}

export const db = {
  async get(s, id) { return id == null ? undefined : req((await store(s)).get(id)); },
  async all(s) { return req((await store(s)).getAll()); },
  async keys(s) { return req((await store(s)).getAllKeys()); },
  async put(s, obj) { await req((await store(s, 'readwrite')).put(obj)); return obj; },
  async del(s, id) { return req((await store(s, 'readwrite')).delete(id)); },
  async byIndex(s, index, value) { return req((await store(s)).index(index).getAll(value)); },
};

const blobCache = new Map();
export async function putBlob(blob, id = uid()) {
  await db.put('blobs', { id, blob, type: blob.type });
  return id;
}
export async function getBlob(id) {
  if (!blobCache.has(id)) blobCache.set(id, db.get('blobs', id).then((r) => r && r.blob));
  return blobCache.get(id);
}

const urlCache = new Map();
export async function blobURL(id) {
  if (!urlCache.has(id)) {
    urlCache.set(id, getBlob(id).then((b) => (b ? URL.createObjectURL(b) : '')));
  }
  return urlCache.get(id);
}

const imgCache = new Map();
export function loadImage(id) {
  if (!imgCache.has(id)) {
    imgCache.set(id, blobURL(id).then((u) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => res(null);
      img.src = u;
    })));
  }
  return imgCache.get(id);
}

// Ask the browser not to evict our data under storage pressure.
export async function persist() {
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch {}
}
