// Folder sync: mirror every note as a file in a folder you choose. Pick a folder inside
// iCloud Drive, Dropbox, OneDrive or Google Drive and your notes sync between computers.
// Uses the File System Access API (Chrome / Edge / Opera on desktop).
import { db } from './db.js';
import { exportNoteFile, importNoteData } from './export.js';
import { prefs } from './util.js';

const EXT = '.opage';
export const syncSupported = () => typeof window.showDirectoryPicker === 'function';

export async function chooseSyncFolder() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'openpage-sync' });
  await db.put('meta', { id: 'syncDir', handle });
  return handle;
}
export async function syncFolder() { const r = await db.get('meta', 'syncDir'); return r && r.handle; }
export async function forgetSyncFolder() { await db.del('meta', 'syncDir'); prefs.set('lastSync', 0); }

async function allowed(handle, ask) {
  const o = { mode: 'readwrite' };
  if ((await handle.queryPermission(o)) === 'granted') return true;
  return ask ? (await handle.requestPermission(o)) === 'granted' : false;
}

let running = null;
// ask: may show the browser's permission prompt (needs a click). Returns {pulled, pushed} or null if not connected.
export function syncNow(ask = false) {
  if (!running) running = doSync(ask).finally(() => { running = null; });
  return running;
}

async function doSync(ask) {
  const dir = await syncFolder();
  if (!dir || !(await allowed(dir, ask))) return null;
  const [notes, subjects, dividers] = await Promise.all([db.all('notes'), db.all('subjects'), db.all('dividers')]);
  const local = new Map(notes.map((n) => [n.id, n]));
  const remote = new Map();
  let pulled = 0, pushed = 0;

  for await (const [name, fh] of dir.entries()) {
    if (fh.kind !== 'file') continue;
    if (name.endsWith(EXT)) {
      const id = name.slice(0, -EXT.length);
      const f = await fh.getFile();
      remote.set(id, { fh, modified: f.lastModified, file: f });
    } else if (name === 'library.json') {
      try {
        const lib = JSON.parse(await (await fh.getFile()).text());
        for (const s of lib.subjects || []) { const l = subjects.find((x) => x.id === s.id); if (!l || (s.edited || 0) > (l.edited || 0)) await db.put('subjects', s); }
        for (const d of lib.dividers || []) { const l = dividers.find((x) => x.id === d.id); if (!l || (d.edited || 0) > (l.edited || 0)) await db.put('dividers', d); }
      } catch {}
    }
  }

  // Pull notes that are newer in the folder
  const subjectIds = new Set((await db.all('subjects')).map((s) => s.id));
  for (const [id, r] of remote) {
    const l = local.get(id);
    if (l && (l.updated || 0) >= r.modified - 2000) continue;
    try {
      const data = JSON.parse(await r.file.text());
      if (l && (data.note.updated || 0) <= (l.updated || 0)) continue;
      await importNoteData(data, subjectIds, { keepId: true });
      pulled++;
    } catch (e) { console.warn('sync: could not read', id, e); }
  }

  // Push notes that are newer here
  for (const n of await db.all('notes')) {
    const r = remote.get(n.id);
    if (r && r.modified >= (n.updated || 0)) continue;
    const content = await db.get('content', n.id);
    if (!content) continue;
    const fh = await dir.getFileHandle(n.id + EXT, { create: true });
    const w = await fh.createWritable();
    await w.write(await exportNoteFile(n, content));
    await w.close();
    pushed++;
  }
  const lib = await dir.getFileHandle('library.json', { create: true });
  const w = await lib.createWritable();
  await w.write(JSON.stringify({ subjects: await db.all('subjects'), dividers: await db.all('dividers') }));
  await w.close();
  prefs.set('lastSync', Date.now());
  return { pulled, pushed };
}

export async function removeFromSync(id) {
  const dir = await syncFolder();
  if (!dir || !(await allowed(dir, false))) return;
  try { await dir.removeEntry(id + EXT); } catch {}
}
