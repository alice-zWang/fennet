// Export, print, thumbnails, and note/library backup files.
import { renderPageCanvas, blankPage } from './render.js';
import { db, getBlob, putBlob } from './db.js';
import { loadScript, blobToDataURL, dataURLToBlob, uid, h, APP_NAME, fmtTime, asset, isNative, shareOrDownload } from './util.js';

// jsPDF (MIT), loaded on demand
const JSPDF = 'vendor/jspdf.umd.min.js'; // jsPDF 2.5.1, bundled

// Library preview. Cards show the top of the page in a 236:168 frame, so only that part is rendered,
// ~900 px wide: sharp on 2× iPad screens and large cards, while staying small to store.
export const THUMB_VERSION = 2;
export async function makeThumb(page, paper) {
  const scale = Math.min(1.25, 900 / page.w);
  const cropH = page.h >= page.w ? Math.min(page.h, Math.round(page.w / 1.3)) : page.h;
  const c = await renderPageCanvas(page, paper, scale, cropH);
  const url = c.toDataURL('image/jpeg', 0.86);
  c.width = c.height = 0;
  return url;
}

export async function exportPDF(note, doc, onProgress) {
  await loadScript(asset(JSPDF));
  const { jsPDF } = window.jspdf;
  let pdf;
  const n = doc.pages.length;
  for (let i = 0; i < n; i++) {
    const p = doc.pages[i];
    const c = await renderPageCanvas(p, note.paper, 2);
    const img = c.toDataURL('image/jpeg', 0.9);
    c.width = c.height = 0;
    const orient = p.w > p.h ? 'l' : 'p';
    if (!pdf) pdf = new jsPDF({ unit: 'px', format: [p.w, p.h], orientation: orient, hotfixes: ['px_scaling'], compress: true });
    else pdf.addPage([p.w, p.h], orient);
    pdf.addImage(img, 'JPEG', 0, 0, p.w, p.h, undefined, 'FAST');
    onProgress && onProgress(i + 1, n);
  }
  pdf.setProperties({ title: note.title, creator: APP_NAME });
  return pdf.output('blob');
}

export async function exportPagePNG(page, paper) {
  const c = await renderPageCanvas(page, paper, 2);
  const b = await new Promise((res) => c.toBlob(res, 'image/png'));
  c.width = c.height = 0;
  return b;
}

export async function printNote(note, doc) {
  // WKWebView can't print a page directly; the share sheet's Print option prints the PDF.
  if (isNative()) { await shareOrDownload(await exportPDF(note, doc), (note.title || 'Note').replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'); return; }
  const frame = h('iframe', { style: { position: 'fixed', right: 0, bottom: 0, width: 0, height: 0, border: 0 }, 'aria-hidden': 'true' });
  document.body.append(frame);
  const d = frame.contentDocument;
  d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><title></title><style>@page{margin:0}html,body{margin:0}img{width:100%;display:block;break-after:page}</style></head><body></body></html>');
  d.close();
  d.title = note.title;
  for (const p of doc.pages) {
    const c = await renderPageCanvas(p, note.paper, 2);
    const img = d.createElement('img');
    img.src = c.toDataURL('image/jpeg', 0.92);
    c.width = c.height = 0;
    d.body.append(img);
  }
  await Promise.all([...d.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  frame.contentWindow.focus();
  frame.contentWindow.print();
  setTimeout(() => frame.remove(), 60000);
}

export function blobIdsOf(content) {
  const ids = new Set();
  for (const p of content.pages || []) {
    if (p.pdf) ids.add(p.pdf.blob);
    for (const o of p.objs) if (o.type === 'image') ids.add(o.blob);
  }
  for (const r of content.recordings || []) ids.add(r.blob);
  return ids;
}

export async function packBlobs(ids) {
  const out = {};
  for (const id of ids) {
    const b = await getBlob(id);
    if (b) out[id] = await blobToDataURL(b);
  }
  return out;
}

export async function unpackBlobs(blobs) {
  for (const [id, url] of Object.entries(blobs || {})) {
    if (!(await db.get('blobs', id))) await putBlob(await dataURLToBlob(url), id);
  }
}

export async function exportNoteFile(note, content) {
  const { thumb, ...meta } = note;
  const data = { format: NOTE_FORMAT, version: 1, note: meta, content, blobs: await packBlobs(blobIdsOf(content)) };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

const NOTE_FORMAT = 'openpage-note';
const BACKUP_FORMAT = 'openpage-backup';
const isNoteFile = (d) => d && (d.format === NOTE_FORMAT || d.format === 'free-notability-note');
const isBackupFile = (d) => d && (d.format === BACKUP_FORMAT || d.format === 'free-notability-backup');
export { isNoteFile, isBackupFile };

// Returns the imported note's metadata. keepId: replace the note with the same id (used by folder sync).
export async function importNoteData(data, subjectIds, { keepId = false } = {}) {
  if (!isNoteFile(data)) throw new Error('Not an Openpage note file');
  await unpackBlobs(data.blobs);
  const id = keepId ? data.note.id : uid();
  const content = { ...data.content, id };
  if (!content.pages || !content.pages.length) content.pages = [blankPage()];
  const note = keepId
    ? { ...data.note, subjectId: subjectIds.has(data.note.subjectId) ? data.note.subjectId : null }
    : { ...data.note, id, deleted: null, updated: Date.now(), subjectId: subjectIds.has(data.note.subjectId) ? data.note.subjectId : null };
  note.thumb = await makeThumb(content.pages[0], note.paper).catch(() => null);
  note.thumbV = THUMB_VERSION;
  await db.put('content', content);
  await db.put('notes', note);
  return note;
}

export async function exportLibrary() {
  const [notes, subjects, dividers] = await Promise.all([db.all('notes'), db.all('subjects'), db.all('dividers')]);
  const contents = [];
  const ids = new Set();
  for (const n of notes) {
    const c = await db.get('content', n.id);
    if (c) { contents.push(c); for (const b of blobIdsOf(c)) ids.add(b); }
  }
  const data = { format: BACKUP_FORMAT, version: 1, created: Date.now(), notes, contents, subjects, dividers, blobs: await packBlobs(ids) };
  return new Blob([JSON.stringify(data)], { type: 'application/json' });
}

export async function importLibrary(data) {
  if (!isBackupFile(data)) throw new Error('Not an Openpage backup file');
  await unpackBlobs(data.blobs);
  for (const s of data.subjects || []) await db.put('subjects', s);
  for (const d of data.dividers || []) await db.put('dividers', d);
  for (const c of data.contents || []) await db.put('content', c);
  for (const n of data.notes || []) await db.put('notes', n);
  return (data.notes || []).length;
}

// A single self-contained web page (pages as images + recordings + transcripts) that anyone can open.
export async function exportWebPage(note, doc) {
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const imgs = [];
  for (const p of doc.pages) {
    const c = await renderPageCanvas(p, note.paper, 1.5);
    imgs.push(`<img src="${c.toDataURL('image/jpeg', 0.85)}" alt="Page ${imgs.length + 1}" style="aspect-ratio:${p.w}/${p.h}">`);
    c.width = c.height = 0;
  }
  const audio = [];
  for (const r of doc.recordings || []) {
    const b = await getBlob(r.blob);
    if (!b) continue;
    const tr = (r.transcript || []).map((s) => `<p><span>${fmtTime(s.t)}</span> ${esc(s.text)}</p>`).join('');
    audio.push(`<section class="rec"><h2>${esc(r.name)} · ${fmtTime(r.duration)}</h2><audio controls preload="none" src="${await blobToDataURL(b)}"></audio>${tr ? `<details><summary>Transcript</summary>${tr}</details>` : ''}</section>`);
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(note.title)}</title><style>
:root{color-scheme:light dark}body{margin:0;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#eef0f4;color:#1d2129}
@media(prefers-color-scheme:dark){body{background:#15171c;color:#e8eaef}}
header{padding:20px 16px 8px;max-width:860px;margin:auto}h1{margin:0 0 4px;font-size:24px}header p{margin:0;opacity:.6;font-size:13px}
main{max-width:860px;margin:auto;padding:8px 16px 40px}img{display:block;width:100%;height:auto;margin:0 0 16px;border-radius:6px;box-shadow:0 2px 10px rgba(0,0,0,.12);background:#fff}
.rec{margin:0 0 16px}.rec h2{font-size:15px;margin:0 0 6px}audio{width:100%}details p{margin:4px 0}details span{opacity:.6;font-variant-numeric:tabular-nums;margin-right:6px}
</style></head><body><header><h1>${esc(note.title)}</h1><p>Shared from ${esc(APP_NAME)} · ${new Date(note.updated).toLocaleString()}</p></header>
<main>${audio.join('')}${imgs.join('')}</main></body></html>`;
  return new Blob([html], { type: 'text/html' });
}
