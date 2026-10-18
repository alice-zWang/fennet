// The note editor: one instance per pane (two panes = side-by-side multi-note).
import { h, uid, debounce, fmtTime, prefs, toast, pickFiles, clamp, shareOrDownload, safeName, download, nativeWake } from './util.js';
import { mascot, toolStart, toolEnd, recordingChanged } from './mascot.js';
import { mergeContent, idsOf } from './collab.js';
import { icon, hydrateIcons } from './icons.js';
import { db, putBlob, blobURL, loadImage } from './db.js';
import {
  drawPaper, drawStroke, strokeBBox, BRUSHES, brushOf, drawPdfPage, blankPage, PAGE_SIZES, PAPER_TYPES, PAPER_COLORS, pdfToPages, textFont,
} from './render.js';
import { recognize } from './shapes.js';
import { menu, modal, confirmDlg, promptText, popover } from './ui.js';
import { pickColor } from './colorpicker.js';
import { exportPDF, exportPagePNG, exportNoteFile, makeThumb, THUMB_VERSION, printNote, exportWebPage } from './export.js';
import { SidePanel } from './sidepanel.js';
import { templateGallery } from './gallery.js';
import { ocrEnabled, recognizePage, recognizeStrokes, inkSignature, strokesImage } from './ocr.js';
import { ask, aiReady, aiUnavailableReason, aiSupportsImages } from './ai.js';
import { fileToPages, textToPages, imagesToPages, DOC_ACCEPT } from './importers.js';
import { scanDocuments } from './scanner.js';
import { renderPageCanvas } from './render.js';

const VERSION_EVERY = 10 * 60 * 1000; // auto-save a version at most every 10 minutes of editing
const VERSION_KEEP_DAYS = 90;

export const PEN_COLORS = ['#1f2328', '#2557d6', '#d6283b', '#1d9a50', '#7a3fe4', '#e8730c', '#ffffff'];
const HL_COLORS = ['#ffd60a', '#5be37d', '#ff7eb6', '#6cb8ff', '#ffa34d'];
const SIZES = { pen: [1.2, 2.2, 3.5, 6], highlighter: [10, 18, 28], eraser: [10, 22, 44] };
const SIZE_RANGE = { tape: [12, 80, 1], pen: [0.5, 24, 0.1], highlighter: [4, 60, 1], eraser: [4, 120, 1] };
const TEXT_SIZES = [[14, 'S'], [18, 'M'], [24, 'L'], [34, 'XL']];
const DEFAULT_OPTS = {
  pen: { color: PEN_COLORS[0], size: 2.2, brush: 'ballpoint' },
  highlighter: { color: HL_COLORS[0], size: 18, brush: 'classic' },
  tape: { color: '#b8ff2c', size: 24 },
  eraser: { size: 22, mode: 'stroke' },
  text: { color: PEN_COLORS[0], size: 18, bold: false },
};
const MAX_PIXELS = 14e6; // per canvas, keeps iPad Safari within its memory limits
const r1 = (v) => Math.round(v * 10) / 10;

const bboxCache = new WeakMap();
function sbbox(s) {
  let b = bboxCache.get(s.pts);
  if (!b) { b = strokeBBox(s); bboxCache.set(s.pts, b); }
  return b;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function hitStroke(p, x, y, rr) {
  if (p.length === 3) return Math.hypot(p[0] - x, p[1] - y) < rr;
  for (let i = 3; i < p.length; i += 3) if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) < rr) return true;
  return false;
}
function densify(p, step) {
  const out = [p[0], p[1], p[2]];
  for (let i = 3; i < p.length; i += 3) {
    const ax = p[i - 3], ay = p[i - 2], bx = p[i], by = p[i + 1];
    const k = Math.ceil(Math.hypot(bx - ax, by - ay) / step);
    for (let j = 1; j <= k; j++) out.push(ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k, p[i + 2]);
  }
  return out;
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const xi = poly[i], yi = poly[i + 1], xj = poly[j], yj = poly[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const clone = (o) => JSON.parse(JSON.stringify(o));

const brushName = (f) => (BRUSHES[f.tool].find((b) => b[0] === f.brush) || [0, 'Pen'])[1];
// Small canvas showing what a pen draws like (wavy stroke with rising pressure).
function brushPreview(f, w, ht) {
  const c = h('canvas', { width: w * 2, height: ht * 2, class: 'brush-prev', style: { width: w + 'px', height: ht + 'px' } });
  const ctx = c.getContext('2d');
  ctx.scale(2, 2);
  const pts = [];
  const n = 28;
  for (let i = 0; i <= n; i++) { const x = 6 + ((w - 12) * i) / n; pts.push(x, ht / 2 + Math.sin((i / n) * Math.PI * 2) * (ht / 2 - Math.max(4, f.size * 0.6)), f.tool === 'pen' ? 0.15 + 0.8 * Math.sin((i / n) * Math.PI) : 0.5); }
  drawStroke(ctx, { tool: f.tool, brush: f.brush, color: f.color || '#1f2328', size: f.size || 2.2, pts });
  return c;
}

export class Editor {
  constructor(app, host) {
    this.app = app;
    this.root = document.getElementById('tpl-editor').content.firstElementChild.cloneNode(true);
    host.append(this.root);
    hydrateIcons(this.root);
    const q = (s) => this.root.querySelector(s);
    this.titleEl = q('.ed-title');
    this.scroller = q('.scroller');
    this.pagesEl = q('.pages');
    this.optsEl = q('.tool-opts');
    this.audioPanel = h('div', { class: 'audio-panel' });
    this.audioPanel.hidden = true;
    this.pm = q('.page-manager');
    this.videoBar = q('.video-bar');
    this.side = new SidePanel(this, q('.side'));
    this.selMenu = q('.selmenu');
    this.banner = q('.replay-banner');
    this.zoomLabel = q('.zoom-label');
    this.recInd = q('.rec-ind');
    this.recBtn = q('[data-act="record"]');

    const saved = prefs.get('toolOpts', {});
    this.opts = clone(DEFAULT_OPTS);
    for (const k in this.opts) Object.assign(this.opts[k], saved[k] || {});
    this.tool = prefs.get('tool', 'pen');
    this.shapes = prefs.get('shapes', false);
    this.z = 1;
    this.fitMode = true;
    this.views = [];
    this.curIdx = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.touchIds = new Set();
    this.live = h('canvas', { class: 'live' });
    this.save = debounce(() => this.saveNow(), 700);
    this.thumbSave = debounce(() => this.saveThumb(), 2500);
    this.rasterSoon = debounce(() => this.views.forEach((v) => v.visible && this.raster(v)), 140);
    this.ocrSoon = debounce(() => this.indexAll(false), 4000);
    this.pmSoon = debounce(() => this.renderPageManager(), 800);
    this.root.querySelector('.ed-left').insertBefore(mascot('ed'), this.titleEl);
    // quiet orientation: which page you're on, and a brief "Saved" after each save
    this.pageChip = h('span', { class: 'page-chip', 'aria-live': 'polite' });
    this.savedChip = h('span', { class: 'saved-chip', role: 'status' }, 'Saved');
    this.titleEl.after(h('span', { class: 'ed-status' }, this.pageChip, this.savedChip));
    this.bindUI();
    this.bindPointer();
  }

  // ---------------------------------------------------------------- lifecycle
  async open(id) {
    this.note = await db.get('notes', id);
    if (!this.note || this.note.deleted) return false;
    this.openedAt = Date.now();
    this.doc = (await db.get('content', id)) || { id, pages: [], recordings: [] };
    if (!this.doc.pages.length) this.doc.pages.push(blankPage(this.note.pageSize));
    this.doc.recordings ||= [];
    this.note.paper ||= { type: 'lined', color: 'white' };
    this.titleEl.value = this.note.title;
    this.setTool(this.tool);
    this.root.querySelector('[data-act="shapes"]').classList.toggle('on', this.shapes);
    this.preEdit = this.snap();
    this.buildPages();
    this.resumeAt = Math.min(this.note.lastPage || 0, this.doc.pages.length - 1);
    requestAnimationFrame(() => this.fit());
    this.updateUndo();
    if (this.doc.video) this.setupVideo();
    this.ocrSoon();
    return true;
  }

  async close() {
    if (this.recording) await this.stopRecording();
    this.stopReplay();
    this.ocrSoon.cancel();
    this.pmSoon.cancel();
    if (this.ytTimer) clearInterval(this.ytTimer);
    if (this.editing) this.editing.el.blur();
    this.save.cancel();
    this.thumbSave.cancel();
    if (this.dirty) { await this.saveNow(); await this.saveThumb(); await this.snapshot(false); }
    // remember the page for "Resume · p.N" in the library (not an edit, so `updated` stays)
    if (this.note && (this.note.lastPage || 0) !== this.curIdx) {
      this.note.lastPage = this.curIdx;
      await db.put('notes', this.note);
      this.app.noteChanged?.(this.note);
    }
    this.io && this.io.disconnect();
    this.ro && this.ro.disconnect();
    for (const v of this.views) this.unload(v);
    this.root.remove();
  }

  changed() {
    // First edit of this session: keep the state as it was when the note was opened.
    if (!this.sessionSnap) { this.sessionSnap = true; this.snapshot(false, this.preEdit); }
    this.dirty = true;
    this.save();
    this.thumbSave();
    this.ocrSoon();
    if (!this.pm.hidden) this.pmSoon();
  }

  async saveNow() {
    if (!this.doc) return;
    const n = this.note;
    await db.put('content', this.doc);
    n.updated = Date.now();
    n.pageCount = this.doc.pages.length;
    n.hasAudio = this.doc.recordings.length > 0;
    n.audioMs = this.doc.recordings.reduce((t, r) => t + (r.duration || 0), 0);
    const texts = [];
    for (const p of this.doc.pages) {
      for (const o of p.objs) if (o.type === 'text') texts.push(o.text);
      if (p.ocr && p.ocr.text) texts.push(p.ocr.text);
    }
    for (const r of this.doc.recordings) if (r.transcript) texts.push(r.transcript.map((s) => s.text).join(' '));
    n.searchText = (texts.join('\n') + '\n' + (this.doc.pdfText || '')).slice(0, 80000);
    await db.put('notes', n);
    this.app.noteChanged(n);
    this.showSaved();
    if (Date.now() - (this.lastSnap || this.openedAt || 0) > VERSION_EVERY) this.snapshot(false);
  }

  async saveThumb() {
    if (!this.doc) return;
    try {
      this.note.thumb = await makeThumb(this.doc.pages[0], this.note.paper);
      this.note.thumbV = THUMB_VERSION;
      await db.put('notes', this.note);
      this.app.noteChanged(this.note);
    } catch (e) { console.warn(e); }
    this.dirty = false;
  }

  // ---------------------------------------------------------------- UI wiring
  bindUI() {
    const R = this.root;
    R.addEventListener('click', (e) => {
      const t = e.target.closest('[data-act],[data-tool]');
      if (!t || !R.contains(t) || t.closest('.selmenu')) return;
      if (t.dataset.tool) {
        const pencilOn = this.tool === 'pen' && this.opts.pen.brush === 'pencil';
        if (this.tool === t.dataset.tool && !(t.dataset.tool === 'pen' && pencilOn)) return this.toolPopover(t);
        if (t.dataset.tool === 'pen' && this.opts.pen.brush === 'pencil') this.setOpt('pen', 'brush', this.previousPenBrush || 'ballpoint');
        return this.setTool(t.dataset.tool);
      }
      const acts = {
        'tool-next': () => { const strip = this.root.querySelector('.tools'); strip.scrollBy({ left: strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 8 ? -strip.scrollWidth : strip.clientWidth * .75, behavior: 'smooth' }); },
        pencil: () => {
          if (this.tool === 'pen' && this.opts.pen.brush === 'pencil') return this.toolPopover(t);
          if (this.opts.pen.brush !== 'pencil') this.previousPenBrush = this.opts.pen.brush; this.setOpt('pen', 'brush', 'pencil'); this.setTool('pen');
        },
        stickers: () => this.stickerMenu(t),
        'zoom-tool': () => menu(t, [
          { label: 'Zoom in', icon: 'plus', action: () => this.zoomBy(1.2) },
          { label: 'Zoom out', icon: 'minus', action: () => this.zoomBy(1 / 1.2) },
          { label: 'Fit page width', icon: 'paper', action: () => this.fit() },
        ]),
        back: () => this.app.goLibrary(),
        record: () => this.toggleRecord(),
        audio: () => this.toggleAudioPanel(),
        pages: () => this.togglePageManager(),
        panel: () => this.side.toggle(),
        ai: () => this.side.toggle('ai'),
        outline: () => this.side.toggle('outline'),
        more: () => this.moreMenu(t),
        'tool-settings': () => this.toolPopover(t),
        undo: () => this.undo(),
        redo: () => this.redo(),
        add: () => this.addMenu(t),
        paper: () => this.paperDialog(),
        share: () => this.shareMenu(t),
        split: () => this.app.pickSplit(this),
        'close-pane': () => this.app.closePane(this),
        shapes: () => this.toggleShapes(),
        'zoom-in': () => this.zoomBy(1.2),
        'zoom-out': () => this.zoomBy(1 / 1.2),
        'zoom-fit': () => this.fit(),
      };
      acts[t.dataset.act] && acts[t.dataset.act]();
    });
    R.addEventListener('pointerdown', () => this.app.setActive(this), true);

    this.titleEl.addEventListener('input', () => { this.note.title = this.titleEl.value; this.save(); });
    this.titleEl.addEventListener('change', () => {
      if (!this.titleEl.value.trim()) this.titleEl.value = this.note.title = 'Untitled';
      this.saveNow();
    });
    this.titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.titleEl.blur(); });

    let raf = 0;
    this.scroller.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; this.onScroll(); });
    }, { passive: true });

    this.ro = new ResizeObserver(debounce(() => { if (this.fitMode) this.fit(); }, 120));
    this.ro.observe(this.scroller);

    // Trackpad pinch / ctrl+wheel zoom
    this.scroller.addEventListener('wheel', (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.fitMode = false;
      this.setZoom(this.z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
    }, { passive: false });

    // Two-finger pinch-zoom and pan
    let pinch = null;
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    this.scroller.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this.cancelGesture();
        const c = mid(e.touches);
        pinch = { d: dist(e.touches), z: this.z, x: c.x, y: c.y };
      }
    }, { passive: false });
    this.scroller.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      const c = mid(e.touches);
      this.fitMode = false;
      this.setZoom(pinch.z * (dist(e.touches) / pinch.d), c.x, c.y, true);
      this.scroller.scrollLeft += pinch.x - c.x;
      this.scroller.scrollTop += pinch.y - c.y;
      pinch.x = c.x; pinch.y = c.y;
    }, { passive: false });
    const endPinch = (e) => { if (pinch && e.touches.length < 2) { pinch = null; this.rasterSoon(); } };
    this.scroller.addEventListener('touchend', endPinch);
    this.scroller.addEventListener('touchcancel', endPinch);

    // Drag & drop images / PDFs onto a page
    R.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); this.scroller.classList.add('drop-hint'); }
    });
    R.addEventListener('dragleave', (e) => { if (!R.contains(e.relatedTarget)) this.scroller.classList.remove('drop-hint'); });
    R.addEventListener('drop', async (e) => {
      this.scroller.classList.remove('drop-hint');
      const files = [...(e.dataTransfer?.files || [])];
      if (!files.length) return;
      e.preventDefault();
      const pageEl = e.target.closest && e.target.closest('.page');
      const v = pageEl ? pageEl._view : this.currentView();
      const at = pageEl ? this.pt(e, v.layer.getBoundingClientRect()) : null;
      for (const f of files) {
        if (f.type.startsWith('image/')) await this.insertImageFile(f, v, at);
        else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) await this.insertPdf(f);
      }
    });
  }

  setTool(t) {
    if (this.tool !== t && this.editing) this.editing.el.blur();
    this.tool = t;
    prefs.set('tool', t);
    for (const b of this.root.querySelectorAll('[data-tool]')) b.classList.toggle('on', b.dataset.tool === t);
    this.root.className = this.root.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + t;
    if (t !== 'lasso') this.clearSel();
    const pencil = t === 'pen' && this.opts.pen.brush === 'pencil';
    this.root.querySelector('[data-act="pencil"]').classList.toggle('on', pencil);
    if (pencil) this.root.querySelector('[data-tool="pen"]').classList.remove('on');
    this.renderOpts();
  }

  // The palette's six color slots for a tool
  colorSlots(tool) {
    const key = 'palette-' + tool;
    const defaults = tool === 'highlighter' ? [...HL_COLORS, '#b8ff2c'].slice(0, 6) : ['#1f2328', '#b8ff2c', '#d6283b', '#ffffff', '#ff00aa', '#16a085'];
    const stored = prefs.get(key, defaults);
    return Array.from({ length: 6 }, (_, i) => /^#[0-9a-f]{6}$/i.test(stored[i] || '') ? stored[i] : defaults[i]);
  }

  // "+": open the color picker straight away; the slots across its top choose which one to replace.
  async editColor(tool, anchor) {
    const slots = this.colorSlots(tool);
    const cur = this.opts[tool].color;
    const pick = { colors: slots, index: Math.max(0, slots.indexOf(cur)) };
    const color = await pickColor(anchor, slots[pick.index], { title: 'Change a color', slots: pick });
    if (!color) return;
    slots[pick.index] = color;
    prefs.set('palette-' + tool, slots);
    this.setOpt(tool, 'color', color);
  }

  // Tap the active tool again (or the gear): Style, Thickness and Color in one popover.
  toolPopover(anchor) {
    const t = this.tool === 'ruler' ? 'pen' : this.tool;
    if (!['pen', 'highlighter', 'eraser', 'text'].includes(t)) return;
    const box = h('div', { class: 'tool-pop', role: 'dialog', 'aria-label': 'Tool settings' });
    const draw = () => {
      box.textContent = '';
      const o = this.opts[t];
      const sec = (label, ...kids) => box.append(h('div', { class: 'tp-sec' }, h('div', { class: 'tp-label' }, label), ...kids));
      if (t === 'pen' || t === 'highlighter') {
        const list = h('div', { class: 'tp-styles' });
        for (const [id, name] of BRUSHES[t]) {
          const on = o.brush === id;
          const b = h('button', { type: 'button', class: 'tp-style' + (on ? ' on' : ''), 'aria-pressed': String(on) },
            brushPreview({ tool: t, brush: id, color: o.color, size: t === 'pen' ? Math.max(2.2, Math.min(o.size, 5)) : o.size }, 88, 24), h('span', {}, name));
          b.onclick = () => { this.setOpt(t, 'brush', id); draw(); };
          list.append(b);
        }
        sec('Style', list);
      }
      if (t === 'eraser') {
        const seg = h('div', { class: 'seg' });
        for (const [m, label] of [['stroke', 'Whole stroke'], ['partial', 'Partial']]) {
          const b = h('button', { type: 'button', class: o.mode === m ? 'on' : '' }, label);
          b.onclick = () => { this.setOpt('eraser', 'mode', m); draw(); };
          seg.append(b);
        }
        sec('Erase', seg);
      }
      if (t !== 'text') {
        const [min, max, step] = SIZE_RANGE[t];
        const range = h('input', { type: 'range', class: 'size-range', min, max, step, value: o.size, 'aria-label': 'Thickness' });
        const num = h('span', { class: 'tp-num' }, String(o.size));
        range.oninput = () => { num.textContent = range.value; };
        range.onchange = () => { this.setOpt(t, 'size', +range.value); draw(); };
        const presets = h('div', { class: 'tp-presets' });
        for (const s of SIZES[t]) {
          const d = t === 'highlighter' ? Math.min(18, Math.max(4, s * 0.6)) : t === 'eraser' ? Math.min(18, s * 0.4) : Math.min(18, Math.max(3, s * 1.6));
          const b = h('button', { type: 'button', class: 'size-btn' + (o.size === s ? ' on' : ''), 'aria-label': 'Thickness ' + s }, h('span', { style: { width: d + 'px', height: d + 'px' } }));
          b.onclick = () => { this.setOpt(t, 'size', s); draw(); };
          presets.append(b);
        }
        sec('Thickness', h('div', { class: 'tp-row' }, range, num), presets);
      }
      if (t !== 'eraser') {
        const row = h('div', { class: 'tp-colors' });
        for (const c of this.colorSlots(t)) {
          const b = h('button', { type: 'button', class: 'swatch color-slot' + (o.color === c ? ' on' : ''), 'aria-label': 'Color ' + c, style: { background: c } });
          b.onclick = () => { this.setOpt(t, 'color', c); draw(); };
          row.append(b);
        }
        const custom = h('button', { type: 'button', class: 'btn small' }, 'Change a color…');
        custom.onclick = async () => { close(); await this.editColor(t, anchor); };
        sec('Color', row, custom);
      }
      if (t === 'pen' || t === 'highlighter') {
        const fav = h('button', { type: 'button', class: 'btn ghost small', html: icon('star') });
        fav.append(' Save as favorite pen');
        fav.onclick = () => {
          const f = { tool: t, brush: o.brush, color: o.color, size: o.size };
          prefs.set('favPens', [...prefs.get('favPens', []).filter((x) => JSON.stringify(x) !== JSON.stringify(f)), f].slice(-10));
          toast('Saved to favorites');
          this.renderOpts();
        };
        box.append(fav);
      }
    };
    draw();
    const close = popover(anchor, box, { cls: 'tool-popover' });
  }

  setOpt(tool, key, val) {
    this.opts[tool][key] = val;
    prefs.set('toolOpts', this.opts);
    this.renderOpts();
    if (tool === 'text' && this.editing) {
      const { o, el } = this.editing;
      o[key] = val;
      this.styleText(el, o);
      this.changed();
    }
  }

  toggleShapes() {
    this.shapes = !this.shapes;
    prefs.set('shapes', this.shapes);
    this.root.querySelector('[data-act="shapes"]').classList.toggle('on', this.shapes);
    toast(this.shapes ? 'Shape recognition on: rough shapes snap to clean ones' : 'Shape recognition off (draw and hold still snaps a shape)');
  }

  renderOpts() {
    const el = this.optsEl;
    el.textContent = '';
    const t = this.tool === 'ruler' ? 'pen' : this.tool;
    const keepFocus = (b) => b.addEventListener('pointerdown', (e) => this.editing && e.preventDefault());
    const btn = (attrs, ...kids) => { const b = h('button', { type: 'button', ...attrs }, ...kids); keepFocus(b); return b; };
    const sep = () => el.append(h('span', { class: 'opt-sep' }));

    const swatches = (colors, tool) => {
      const key = 'palette-' + tool;
      const defaults = tool === 'highlighter' ? [...colors, '#b8ff2c'].slice(0, 6) : ['#1f2328', '#b8ff2c', '#d6283b', '#ffffff', '#ff00aa', '#16a085'];
      const stored = prefs.get(key, defaults);
      const slots = Array.from({ length: 6 }, (_, i) => /^#[0-9a-f]{6}$/i.test(stored[i] || '') ? stored[i] : defaults[i]);
      const cur = this.opts[tool].color;
      slots.forEach((c, i) => {
        const b = btn({ class: 'swatch color-slot' + (cur === c ? ' on' : ''), title: 'Color ' + (i + 1) + ': ' + c, 'aria-label': 'Color ' + (i + 1) + ': ' + c, 'aria-pressed': String(cur === c), style: { background: c } });
        b.onclick = () => this.setOpt(tool, 'color', c);
        el.append(b);
      });
      const add = btn({ class: 'swatch add-color', title: 'Change a color', 'aria-label': 'Change a color in the palette', html: icon('plus') });
      add.onclick = () => this.editColor(tool, add);
      el.append(add);
    };
    const sizes = (tool, list, dot) => {
      const o = this.opts[tool];
      for (const [index, s] of list.entries()) {
        const d = dot(s);
        const b = btn({ class: 'size-btn' + (index > 1 ? ' size-extra' : '') + (o.size === s ? ' on' : ''), title: 'Size ' + s, 'aria-label': 'Size ' + s }, h('span', { style: { width: d + 'px', height: d + 'px' } }));
        b.onclick = () => this.setOpt(tool, 'size', s);
        el.append(b);
      }
      const [min, max, step] = SIZE_RANGE[tool];
      const range = h('input', { type: 'range', class: 'size-range', min, max, step, value: o.size, 'aria-label': 'Size' });
      const val = h('span', { class: 'size-val' }, String(o.size));
      range.oninput = () => { o.size = +range.value; val.textContent = range.value; prefs.set('toolOpts', this.opts); for (const b of el.querySelectorAll('.size-btn')) b.classList.remove('on'); };
      range.onchange = () => this.renderOpts();
      el.append(range, val);
    };
    const favorites = () => {
      const favs = prefs.get('favPens', []);
      for (const f of favs) {
        const c = brushPreview(f, 46, 26);
        const on = this.tool === f.tool && this.opts[f.tool].brush === f.brush && this.opts[f.tool].color === f.color && this.opts[f.tool].size === f.size;
        const b = btn({ class: 'fav-pen' + (on ? ' on' : ''), title: `${brushName(f)} (right-click or long-press to remove)` }, c);
        b.onclick = () => { Object.assign(this.opts[f.tool], { brush: f.brush, color: f.color, size: f.size }); prefs.set('toolOpts', this.opts); this.setTool(f.tool); };
        const remove = (e) => { e.preventDefault(); prefs.set('favPens', prefs.get('favPens', []).filter((x) => JSON.stringify(x) !== JSON.stringify(f))); this.renderOpts(); };
        b.oncontextmenu = remove;
        let tm; b.addEventListener('pointerdown', (e) => { tm = setTimeout(() => remove(e), 700); }); b.addEventListener('pointerup', () => clearTimeout(tm)); b.addEventListener('pointerleave', () => clearTimeout(tm));
        el.append(b);
      }
      if (t === 'pen' || t === 'highlighter') {
        const add = btn({ class: 'icon-btn small', title: 'Save this pen as a favorite', 'aria-label': 'Save pen as favorite', html: icon('star') });
        add.onclick = () => {
          const o = this.opts[t], f = { tool: t, brush: o.brush, color: o.color, size: o.size };
          const list = prefs.get('favPens', []).filter((x) => JSON.stringify(x) !== JSON.stringify(f));
          prefs.set('favPens', [...list, f].slice(-10));
          toast('Saved to favorites. Tap it to switch pens.');
          this.renderOpts();
        };
        el.append(add);
      }
      if (favs.length || t === 'pen' || t === 'highlighter') sep();
    };
    const typeChip = (tool) => {
      const o = this.opts[tool];
      const chip = btn({ class: 'brush-chip', title: 'Pen type', 'aria-haspopup': 'true' }, brushPreview({ tool, brush: o.brush, color: o.color, size: Math.min(o.size, tool === 'pen' ? 6 : 16) }, 44, 24), h('span', {}, brushName({ tool, brush: o.brush })), h('span', { class: 'chev', html: icon('chev') }));
      chip.onclick = () => {
        const list = h('div', { class: 'brush-list' });
        for (const [id, name] of BRUSHES[tool]) {
          const item = h('button', { type: 'button', class: 'brush-item' + (o.brush === id ? ' on' : '') },
            brushPreview({ tool, brush: id, color: o.color, size: tool === 'pen' ? Math.max(2.2, Math.min(o.size, 5)) : o.size }, 120, 30), h('span', {}, name));
          item.onclick = () => { close(); this.setOpt(tool, 'brush', id); };
          list.append(item);
        }
        const close = popover(chip, list, { cls: 'brush-pop' });
      };
      el.append(chip);
      sep();
    };

    if (t === 'pen') { favorites(); typeChip('pen'); swatches(PEN_COLORS, 'pen'); sep(); sizes('pen', SIZES.pen, (s) => Math.min(20, Math.max(3, s * 1.6))); }
    else if (t === 'highlighter') { favorites(); typeChip('highlighter'); swatches(HL_COLORS, 'highlighter'); sep(); sizes('highlighter', SIZES.highlighter, (s) => Math.min(20, Math.max(3, s * 0.6))); }
    else if (t === 'eraser') {
      const seg = h('div', { class: 'seg' });
      for (const [m, label] of [['stroke', 'Whole stroke'], ['partial', 'Partial']]) {
        const b = btn({ class: this.opts.eraser.mode === m ? 'on' : '' }, label);
        b.onclick = () => this.setOpt('eraser', 'mode', m);
        seg.append(b);
      }
      el.append(seg);
      sep();
      sizes('eraser', SIZES.eraser, (s) => s * 0.4);
    } else if (t === 'text') {
      swatches(PEN_COLORS, 'text');
      sep();
      const seg = h('div', { class: 'seg' });
      for (const [s, label] of TEXT_SIZES) {
        const b = btn({ class: this.opts.text.size === s ? 'on' : '' }, label);
        b.onclick = () => this.setOpt('text', 'size', s);
        seg.append(b);
      }
      el.append(seg);
      const bold = btn({ class: 'size-btn' + (this.opts.text.bold ? ' on' : ''), title: 'Bold', style: { fontWeight: 800 } }, 'B');
      bold.onclick = () => this.setOpt('text', 'bold', !this.opts.text.bold);
      el.append(bold);
    } else if (t === 'lasso') {
      el.append(h('span', { class: 'opt-hint' }, 'Circle ink to select it, or tap an image or text box. Drag to move, corner to resize.'));
    } else if (t === 'tape') {
      swatches(PEN_COLORS, 'tape'); sizes('tape', [16, 24, 40], (s) => Math.min(14, s * .4));
    } else if (t === 'navigate') {
      el.append(h('span', { class: 'opt-hint' }, 'Drag the page to move around. Your ink stays untouched.'));
    } else if (t === 'laser') {
      el.append(h('span', { class: 'opt-hint' }, 'Laser pointer for presenting: the trail fades and is not saved.'));
    }
  }

  // ---------------------------------------------------------------- pages & zoom
  buildPages() {
    this.io && this.io.disconnect();
    this.io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        const v = en.target._view;
        if (!v) continue;
        v.visible = en.isIntersecting;
        if (v.visible) this.raster(v); else this.unload(v);
      }
    }, { root: this.scroller, rootMargin: '900px 0px' });
    for (const v of this.views) this.unload(v);
    this.pagesEl.textContent = '';
    const n = this.doc.pages.length;
    this.views = this.doc.pages.map((p, i) => {
      const el = h('div', { class: 'page' });
      const layer = h('div', { class: 'layer' });
      const bg = h('canvas', { class: 'bg' });
      const objs = h('div', { class: 'objs' });
      const ink = h('canvas', { class: 'ink' });
      layer.append(objs);
      el.append(bg, layer, ink);
      const more = h('button', { title: 'Page options', 'aria-label': `Page ${i + 1} options`, html: icon('more') });
      const foot = h('div', { class: 'page-foot' }, h('span', {}, `Page ${i + 1} of ${n}`), more);
      const v = { page: p, el, layer, bg, objs, ink, foot, visible: false, rz: 0, idx: i };
      more.onclick = () => this.pageMenu(more, v.idx);
      el._view = v;
      this.pagesEl.append(el, foot);
      this.renderObjs(v);
      return v;
    });
    const add = h('button', { class: 'btn add-page' }, '+ Add page');
    add.onclick = () => this.addPage(this.doc.pages.length - 1, true);
    this.pagesEl.append(add);
    this.applyLayout();
    for (const v of this.views) this.io.observe(v.el);
    this.updatePageChip();
  }

  // Re-sync views after an undo/redo; full rebuild only if the page list changed.
  rebuild() {
    const pages = this.doc.pages;
    const same = pages.length === this.views.length &&
      pages.every((p, i) => p.id === this.views[i].page.id && p.w === this.views[i].page.w && p.h === this.views[i].page.h);
    if (same) {
      this.views.forEach((v, i) => { v.page = pages[i]; this.renderObjs(v); this.drawInk(v); });
    } else {
      const st = this.scroller.scrollTop;
      this.buildPages();
      this.scroller.scrollTop = st;
    }
  }

  applyLayout() {
    const z = this.z;
    for (const v of this.views) {
      const { w, h: ht } = v.page;
      v.el.style.width = w * z + 'px';
      v.el.style.height = ht * z + 'px';
      v.layer.style.width = w + 'px';
      v.layer.style.height = ht + 'px';
      v.layer.style.transform = `scale(${z})`;
      this.placeCanvases(v);
    }
    this.zoomLabel.textContent = Math.round(z * 100) + '%';
    if (this.sel) this.updateSel();
    this.rasterSoon();
  }

  fit() {
    if (!this.views.length) return;
    this.fitMode = true;
    const avail = this.scroller.clientWidth - 32;
    if (avail <= 0) return;
    const maxW = Math.max(...this.doc.pages.map((p) => p.w));
    const z = clamp(avail / maxW, 0.25, 1.6);
    this.setZoom(z, null, null);
  }

  zoomBy(k) { this.fitMode = false; this.setZoom(this.z * k); }

  setZoom(z, cx, cy) {
    z = clamp(z, 0.25, 4);
    if (Math.abs(z - this.z) < 0.0005) { this.applyLayout(); return; }
    const s = this.scroller, r = s.getBoundingClientRect();
    const ox = (cx ?? r.left + r.width / 2) - r.left, oy = (cy ?? r.top + r.height / 2) - r.top;
    const ax = s.scrollLeft + ox, ay = s.scrollTop + oy, k = z / this.z;
    this.z = z;
    this.applyLayout();
    s.scrollLeft = ax * k - ox;
    s.scrollTop = ay * k - oy;
  }

  // Region of page v to draw, in page units: what is on screen plus a margin for scrolling,
  // at full screen resolution (z × devicePixelRatio) within a per-canvas pixel budget.
  // At normal zoom that's the whole page; zoomed in, only the visible part (always sharp).
  regionFor(v) {
    const z = this.z, { w, h: ht } = v.page;
    let rz = z * (window.devicePixelRatio || 1);
    const sr = this.scroller.getBoundingClientRect(), pr = v.el.getBoundingClientRect();
    const vis = {
      x0: clamp((sr.left - pr.left) / z, 0, w), x1: clamp((sr.right - pr.left) / z, 0, w),
      y0: clamp((sr.top - pr.top) / z, 0, ht), y1: clamp((sr.bottom - pr.top) / z, 0, ht),
    };
    if (vis.y1 - vis.y0 < 1) { // page is just outside the viewport: take the slice nearest to it
      const vh = sr.height / z;
      if (pr.top > sr.top) { vis.y0 = 0; vis.y1 = Math.min(ht, vh); } else { vis.y1 = ht; vis.y0 = Math.max(0, ht - vh); }
    }
    if (vis.x1 - vis.x0 < 1) { vis.x0 = 0; vis.x1 = Math.min(w, sr.width / z); }
    if (w * ht * rz * rz <= MAX_PIXELS) return { rz, reg: { x: 0, y: 0, w, h: ht }, vis };
    const vw = vis.x1 - vis.x0, vh = vis.y1 - vis.y0;
    for (const k of [0.75, 0.5, 0.25, 0.1, 0]) {
      const x0 = clamp(vis.x0 - vw * k, 0, w), x1 = clamp(vis.x1 + vw * k, 0, w);
      const y0 = clamp(vis.y0 - vh * k, 0, ht), y1 = clamp(vis.y1 + vh * k, 0, ht);
      if ((x1 - x0) * (y1 - y0) * rz * rz <= MAX_PIXELS || k === 0) {
        if (k === 0) rz = Math.min(rz, Math.sqrt(MAX_PIXELS / ((x1 - x0) * (y1 - y0))));
        return { rz, reg: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, vis };
      }
    }
  }

  // Map page units → canvas pixels for view v.
  tx(v, ctx) {
    ctx.setTransform(v.rz, 0, 0, v.rz, -v.reg.x * v.rz, -v.reg.y * v.rz);
  }

  placeCanvases(v) {
    if (!v.reg) return;
    const z = this.z, r = v.reg;
    const list = [v.bg, v.ink];
    if (this.liveView === v && this.live.parentNode === v.el) list.push(this.live);
    for (const c of list) {
      c.style.left = r.x * z + 'px';
      c.style.top = r.y * z + 'px';
      c.style.width = r.w * z + 'px';
      c.style.height = r.h * z + 'px';
    }
  }

  raster(v, force) {
    const { rz, reg, vis } = this.regionFor(v);
    const covers = v.reg && vis.x0 >= v.reg.x - 0.5 && vis.y0 >= v.reg.y - 0.5 &&
      vis.x1 <= v.reg.x + v.reg.w + 0.5 && vis.y1 <= v.reg.y + v.reg.h + 0.5;
    if (!force && v.rz && Math.abs(v.rz - rz) < 0.01 && covers) return;
    v.rz = rz;
    v.reg = reg;
    for (const c of [v.bg, v.ink]) { c.width = Math.max(1, Math.round(reg.w * rz)); c.height = Math.max(1, Math.round(reg.h * rz)); }
    this.placeCanvases(v);
    if (this.liveView === v) this.sizeLive(v);
    this.drawBg(v);
    this.drawInk(v);
  }

  unload(v) {
    // Don't cancel pdf.js tasks: cancelling can also abort a newer render of the same page.
    if (v.pdfTask) v.pdfTask.stale = true;
    v.rz = 0;
    v.reg = null;
    v.bg.width = v.bg.height = 0;
    v.ink.width = v.ink.height = 0;
  }

  async drawBg(v) {
    if (!v.rz) return;
    const ctx = v.bg.getContext('2d');
    this.tx(v, ctx);
    await drawPaper(ctx, v.page, this.note.paper);
    if (v.page.pdf) {
      if (v.pdfTask) v.pdfTask.stale = true;
      const holder = (v.pdfTask = {});
      const rz = v.rz;
      try {
        await drawPdfPage(ctx, v.page, rz, holder, v.reg);
      } catch (e) {
        if (!holder.stale && e && e.name === 'RenderingCancelledException') { setTimeout(() => v.rz && this.drawBg(v), 50); return; }
        if (!holder.stale && e && e.name !== 'RenderingCancelledException') {
          console.warn(e);
          ctx.fillStyle = '#888'; ctx.font = '14px sans-serif';
          ctx.fillText('Could not render this PDF page (offline?)', 24, 40);
        }
      }
    }
  }

  drawInk(v) {
    if (!v.rz) return;
    const ctx = v.ink.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, v.ink.width, v.ink.height);
    this.tx(v, ctx);
    const rp = this.replay, cut = rp ? rp.audio.currentTime * 1000 : 0;
    for (const o of v.page.objs) {
      if (o.type !== 'stroke') continue;
      drawStroke(ctx, o, rp && o.rec === rp.rec.id && o.t > cut ? 0.12 : 1);
    }
  }

  renderObjs(v) {
    v.objs.textContent = '';
    for (const o of v.page.objs) {
      if (o.type === 'image') {
        const img = h('img', { alt: '', 'data-id': o.id, draggable: 'false' });
        this.placeEl(img, o);
        blobURL(o.blob).then((u) => { img.src = u; });
        v.objs.append(img);
      } else if (o.type === 'text') {
        v.objs.append(this.makeTextEl(v, o));
      }
    }
  }

  placeEl(el, o) {
    el.style.left = o.x + 'px';
    el.style.top = o.y + 'px';
    el.style.width = o.w + 'px';
    if (o.type === 'image') el.style.height = o.h + 'px';
    else this.styleText(el, o);
  }

  onScroll() {
    const r = this.scroller.getBoundingClientRect(), mid = r.top + r.height / 2;
    let best = 0, bd = Infinity;
    for (const v of this.views) {
      const er = v.el.getBoundingClientRect();
      const d = mid < er.top ? er.top - mid : mid > er.bottom ? mid - er.bottom : 0;
      if (d < bd) { bd = d; best = v.idx; }
      if (d === 0) break;
    }
    if (best !== this.curIdx && !this.pm.hidden) this.pm.querySelectorAll('.pm-page').forEach((b, i) => b.classList.toggle('cur', i === best));
    this.curIdx = best;
    this.updatePageChip();
    if (this.sel) this.positionSelMenu();
    // Zoomed in, each page holds only part of itself: redraw when the screen moves past it.
    for (const v of this.views) if (v.rz && (v.reg.w < v.page.w || v.reg.h < v.page.h)) this.raster(v);
  }

  currentView() { return this.views[this.curIdx] || this.views[0]; }

  updatePageChip() {
    if (!this.pageChip || !this.doc) return;
    const n = this.doc.pages.length;
    this.pageChip.textContent = `${Math.min(this.curIdx + 1, n)} / ${n}`;
    this.pageChip.title = `Page ${Math.min(this.curIdx + 1, n)} of ${n}`;
  }

  showSaved() {
    if (!this.savedChip) return;
    this.savedChip.classList.add('show');
    clearTimeout(this.savedT);
    this.savedT = setTimeout(() => this.savedChip.classList.remove('show'), 1600);
  }

  // y coordinate (logical page units) at the centre of what's visible of page v
  visibleCenter(v) {
    const r = this.scroller.getBoundingClientRect(), pr = v.layer.getBoundingClientRect();
    const top = Math.max(r.top, pr.top), bot = Math.min(r.bottom, pr.bottom);
    const y = bot > top ? ((top + bot) / 2 - pr.top) / this.z : v.page.h / 2;
    return { x: v.page.w / 2, y };
  }

  // after the first layout: go back to the page this note was left on
  resume() {
    if (this.resumeAt > 0) this.scrollToPage(this.resumeAt);
    this.resumeAt = 0;
  }

  scrollToPage(i) {
    const v = this.views[i];
    if (v) this.scroller.scrollTop = v.el.offsetTop - 16;
  }

  // ---------------------------------------------------------------- page ops
  pageMenu(btn, i) {
    const p = this.doc.pages[i];
    menu(btn, [
      { label: 'Insert blank page after', icon: 'pageplus', action: () => this.addPage(i, false) },
      { label: 'Duplicate page', icon: 'dup', action: () => this.dupPage(i) },
      i > 0 && { label: 'Move page up', icon: 'up', action: () => this.movePage(i, -1) },
      i < this.doc.pages.length - 1 && { label: 'Move page down', icon: 'down', action: () => this.movePage(i, 1) },
      { label: 'Export page as image', icon: 'image', action: () => this.exportPage(i) },
      'sep',
      p.objs.length && { label: 'Clear page', icon: 'eraser', action: () => { this.pushUndo(); p.objs = []; this.rebuild(); this.changed(); } },
      this.doc.pages.length > 1 && { label: 'Delete page', icon: 'trash', danger: true, action: () => this.deletePage(i) },
    ]);
  }

  addPage(after, scroll) {
    this.pushUndo();
    const ref = this.doc.pages[after];
    const p = blankPage(this.note.pageSize);
    if (ref && !ref.pdf && !PAGE_SIZES[this.note.pageSize]) { p.w = ref.w; p.h = ref.h; }
    this.doc.pages.splice(after + 1, 0, p);
    this.rebuild();
    this.changed();
    if (scroll) requestAnimationFrame(() => this.scrollToPage(after + 1));
  }
  dupPage(i) {
    this.pushUndo();
    const p = clone(this.doc.pages[i]);
    p.id = uid();
    for (const o of p.objs) o.id = uid();
    this.doc.pages.splice(i + 1, 0, p);
    this.rebuild();
    this.changed();
  }
  movePage(i, d) {
    this.pushUndo();
    const [p] = this.doc.pages.splice(i, 1);
    this.doc.pages.splice(i + d, 0, p);
    this.rebuild();
    this.changed();
    requestAnimationFrame(() => this.scrollToPage(i + d));
  }
  async deletePage(i) {
    if (this.doc.pages[i].objs.length && !(await confirmDlg(`Delete page ${i + 1}? You can undo this.`))) return;
    this.pushUndo();
    this.doc.pages.splice(i, 1);
    this.clearSel();
    this.rebuild();
    this.changed();
  }

  // ---------------------------------------------------------------- undo
  snap() { return JSON.stringify(this.doc.pages); }
  pushUndo(s = this.snap()) {
    this.undoStack.push(s);
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
    this.updateUndo();
  }
  undo() {
    if (this.editing) this.editing.el.blur();
    if (!this.undoStack.length) return;
    this.redoStack.push(this.snap());
    this.restore(this.undoStack.pop());
  }
  redo() {
    if (this.editing) this.editing.el.blur();
    if (!this.redoStack.length) return;
    this.undoStack.push(this.snap());
    this.restore(this.redoStack.pop());
  }
  restore(s) {
    this.doc.pages = JSON.parse(s);
    this.clearSel();
    this.rebuild();
    this.changed();
    this.updateUndo();
  }
  updateUndo() {
    this.root.querySelector('[data-act="undo"]').disabled = !this.undoStack.length;
    this.root.querySelector('[data-act="redo"]').disabled = !this.redoStack.length;
  }

  // ---------------------------------------------------------------- pointer input
  bindPointer() {
    const P = this.pagesEl;
    P.addEventListener('pointerdown', (e) => this.onDown(e));
    P.addEventListener('pointermove', (e) => this.onMove(e));
    P.addEventListener('pointerup', (e) => this.onUp(e, false));
    P.addEventListener('pointercancel', (e) => this.onUp(e, true));
    // Fingers resting on the screen while writing with a stylus shouldn't draw (palm rejection)
    P.addEventListener('touchstart', (e) => { if (this.gesture && this.gesture.pointerType === 'pen' && e.cancelable) e.preventDefault(); }, { passive: false });
  }

  pt(e, rect) {
    let p = 0.5;
    if (e.pointerType === 'pen') {
      // A missing (0) reading repeats the last one instead of jumping to medium pressure.
      p = e.pressure > 0 ? e.pressure : this.lastPressure || 0.5;
      this.lastPressure = p;
    }
    return { x: r1((e.clientX - rect.left) / this.z), y: r1((e.clientY - rect.top) / this.z), p: Math.round(p * 100) / 100 };
  }

  onDown(e) {
    if (e.pointerType === 'touch') this.touchIds.add(e.pointerId);
    const pageEl = e.target.closest('.page');
    if (!pageEl) return;
    const v = pageEl._view;
    if (e.pointerType === 'pen') this.app.sawPen();
    if (e.pointerType === 'touch') {
      if (this.app.stylusOnly() && !this.replay && this.tool !== 'navigate') return;
      if (this.gesture && this.gesture.pointerType === 'pen') return; // palm
      if (this.touchIds.size > 1) { this.cancelGesture(); return; }
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.gesture) return;
    const rect = v.layer.getBoundingClientRect();
    const pt = this.pt(e, rect);
    if (this.replay || this.ytLink) {
      this.gesture = { kind: 'tap', v, rect, id: e.pointerId, sx: e.clientX, sy: e.clientY, start: pt, pointerType: e.pointerType };
      return;
    }
    let tool = this.tool;
    if (e.button === 5 || (e.buttons & 32)) tool = 'eraser'; // stylus eraser end
    if (tool === 'tape') {
      const tape = [...v.page.objs].reverse().find((o) => o.tape && (() => { const b = sbbox(o); return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; })());
      if (tape) { e.preventDefault(); this.pushUndo(); tape.revealed = !tape.revealed; this.drawInk(v); this.changed(); return; }
    }
    if (tool === 'text') { this.textDown(e, v, pt); return; }
    if (this.editing) this.editing.el.blur();
    e.preventDefault();
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    const g = (this.gesture = { kind: tool, v, rect, id: e.pointerId, start: pt, last: pt, pointerType: e.pointerType, moved: false });
    this['begin_' + tool](g, pt);
    toolStart(tool);
  }

  onMove(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    if (g.kind === 'tap') return;
    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];
    // Pen, highlighter and eraser can travel onto the next/previous page without lifting.
    const crosses = g.kind === 'pen' || g.kind === 'highlighter' || g.kind === 'eraser';
    let batch = [];
    const flush = () => { if (batch.length) { this['move_' + g.kind](g, batch); g.last = batch[batch.length - 1]; batch = []; } };
    for (const ev of evs) {
      if (crosses && !g.snapped) {
        const tv = this.viewAt(ev.clientY);
        if (tv && tv !== g.v) { flush(); this.switchPage(g, tv); }
      }
      batch.push(this.pt(ev, g.rect));
    }
    flush();
    // where the pen is about to be (supported browsers only): drawn live, never saved
    if (g.kind === 'pen' || g.kind === 'highlighter') {
      const pr = e.getPredictedEvents ? e.getPredictedEvents() : null;
      const last = pr && pr.length ? pr[pr.length - 1] : null;
      g.pred = last ? { x: (last.clientX - g.rect.left) / this.z, y: (last.clientY - g.rect.top) / this.z } : null;
    }
  }

  // The rendered page under a screen y (null in the gap between pages).
  viewAt(clientY) {
    for (const v of this.views) {
      if (!v.rz) continue;
      const r = v.el.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return v;
    }
    return null;
  }

  // Continue the current gesture on page tv. Each page keeps its own part of the stroke; the new
  // part starts from the previous point (mapped into tv's coordinates) so the line runs off one
  // page's edge and in at the other's, while the gap between pages stays empty.
  switchPage(g, tv) {
    const z = this.z, oldR = g.rect, newR = tv.layer.getBoundingClientRect();
    const conv = (x, y) => ({ x: r1((x * z + oldR.left - newR.left) / z), y: r1((y * z + oldR.top - newR.top) / z) });
    if (g.kind === 'pen' || g.kind === 'highlighter') {
      const s = this.cur;
      if (!s) return;
      clearTimeout(this.holdT);
      g.crossed = true;
      if (!g.undoPushed) { this.pushUndo(); g.undoPushed = true; }
      g.v.page.objs.push(s);
      if (g.v.rz) { const ctx = g.v.ink.getContext('2d'); this.tx(g.v, ctx); drawStroke(ctx, s); }
      const p = s.pts, c = conv(p[p.length - 3], p[p.length - 2]);
      this.cur = { ...s, id: uid(), pts: [c.x, c.y, p[p.length - 1]] }; // same pen, same recording time
      const st = conv(g.sx, g.sy);
      g.sx = st.x; g.sy = st.y;
      if (g.raw) g.raw = { ...g.raw, ...conv(g.raw.x, g.raw.y) };
      g.pred = null;
      this.changed();
    } else if (g.kind === 'eraser') {
      g.last = { ...g.last, ...conv(g.last.x, g.last.y) };
      this.eraserAt = null;
    }
    this.clearLive();
    g.v = tv;
    g.rect = newR;
    this.attachLive(tv);
    this.drawLiveSoon();
  }

  onUp(e, cancelled) {
    if (e.pointerType === 'touch') this.touchIds.delete(e.pointerId);
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    this.gesture = null;
    toolEnd();
    if (this.pendingRemote) {
      // merge what arrived during the stroke with what was just drawn, then save and share it
      const p = this.pendingRemote;
      this.pendingRemote = null;
      setTimeout(() => {
        const merged = mergeContent(p.base, this.doc, { ...p.content, id: this.doc.id }, true);
        this.applyRemote(merged, p.note);
        this.changed();
      }, 0);
    }
    if (g.kind === 'tap') {
      if (!cancelled && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < 10) {
        if (this.replay) this.replayTap(g.v, g.start); else this.videoTap(g.v, g.start);
      }
      return;
    }
    if (cancelled && ['pen', 'highlighter', 'ruler', 'tape'].includes(g.kind)) { this.cur = null; this.clearLive(); return; }
    this['end_' + g.kind](g);
  }

  cancelGesture() {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    clearTimeout(this.holdT);
    if (['pen', 'highlighter', 'ruler', 'tape'].includes(g.kind)) this.cur = null;
    if (g.kind === 'lasso' && g.mode === 'lasso') this.hideLasso();
    if (g.kind === 'eraser' && g.changed) { this.pushUndo(g.before); this.changed(); }
    if (g.kind === 'lasso' && g.mode !== 'lasso' && g.moved) { this.pushUndo(g.before); this.changed(); }
    this.clearLive();
  }

  // live overlay canvas (current stroke, lasso path, eraser ring, laser)
  sizeLive(v) {
    const L = this.live;
    if (!v.reg) return;
    L.width = Math.max(1, Math.round(v.reg.w * v.rz));
    L.height = Math.max(1, Math.round(v.reg.h * v.rz));
    this.placeCanvases(v);
  }
  attachLive(v) {
    if (this.liveView !== v || this.live.parentNode !== v.el || this.live.width !== Math.round(v.reg.w * v.rz)) {
      this.liveView = v;
      v.el.append(this.live);
      this.sizeLive(v);
    }
  }
  clearLive() {
    const c = this.live.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.live.width, this.live.height);
  }
  drawLiveSoon() {
    if (!this.liveRaf) this.liveRaf = requestAnimationFrame(() => { this.liveRaf = 0; this.drawLive(); });
  }
  drawLive() {
    const v = this.liveView;
    if (!v || !v.rz) return;
    this.clearLive();
    const c = this.live.getContext('2d');
    this.tx(v, c);
    if (this.cur) drawStroke(c, this.liveStroke());
    if (this.eraserAt) {
      c.save();
      c.lineWidth = 1 / this.z;
      c.strokeStyle = 'rgba(80,80,80,.8)';
      c.fillStyle = 'rgba(255,255,255,.35)';
      c.beginPath();
      c.arc(this.eraserAt.x, this.eraserAt.y, this.opts.eraser.size / 2, 0, 7);
      c.fill(); c.stroke();
      c.restore();
    }
    if (this.laserPts) this.drawLaser(c);
  }

  // The saved stroke trails the pen slightly (stabilizer); while writing, extend it to the
  // pen tip and the predicted next point so the ink stays under the Pencil.
  liveStroke() {
    const s = this.cur, g = this.gesture;
    if (!g || g.snapped || !g.raw || (g.kind !== 'pen' && g.kind !== 'highlighter')) return s;
    const p = s.pts, lp = p[p.length - 1], tail = [g.raw.x, g.raw.y, lp];
    if (g.pred && Math.hypot(g.pred.x - g.raw.x, g.pred.y - g.raw.y) < 40) tail.push(g.pred.x, g.pred.y, lp);
    return { ...s, pts: p.concat(tail) };
  }

  stamp(o) {
    if (this.recording) { o.rec = this.recording.id; o.t = Math.round(performance.now() - this.recording.t0); }
    if (this.yt && this.yt.ready && this.yt.player.getPlayerState && this.yt.player.getPlayerState() === 1) o.vt = Math.round(this.yt.player.getCurrentTime() * 1000);
    return o;
  }

  // ---- pen & highlighter
  begin_pen(g, pt) {
    const o = this.opts[g.kind];
    g.sx = pt.x; g.sy = pt.y; g.sp = pt.p;
    this.cur = this.stamp({ id: uid(), type: 'stroke', tool: g.kind, brush: o.brush, color: o.color, size: o.size, pts: [pt.x, pt.y, pt.p] });
    this.attachLive(g.v);
    this.armHold(g);
    this.drawLiveSoon();
  }
  move_pen(g, pts) {
    if (g.snapped || !this.cur) return;
    const p = this.cur.pts;
    let added = false;
    // Stabilizer: each new point moves part of the way toward the pen (removes hand/sensor
    // tremor without noticeable lag at the Pencil's high sample rate). Pressure eases too.
    const a = g.pointerType === 'pen' ? 0.45 : 0.6;
    for (const q of pts) {
      g.sx += (q.x - g.sx) * a; g.sy += (q.y - g.sy) * a; g.sp += (q.p - g.sp) * 0.35;
      const lx = p[p.length - 3], ly = p[p.length - 2];
      if (Math.hypot(g.sx - lx, g.sy - ly) >= 0.8) { p.push(r1(g.sx), r1(g.sy), Math.round(g.sp * 100) / 100); added = true; }
    }
    g.raw = pts[pts.length - 1];
    if (added) this.armHold(g);
    this.drawLiveSoon();
  }
  end_pen(g) {
    clearTimeout(this.holdT);
    const s = this.cur;
    this.cur = null;
    if (!s) return;
    // finish exactly where the pen lifted (the stabilizer trails slightly behind)
    if (g.raw && !g.snapped) {
      const p = s.pts;
      if (Math.hypot(g.raw.x - p[p.length - 3], g.raw.y - p[p.length - 2]) >= 0.5) p.push(g.raw.x, g.raw.y, p[p.length - 1]);
    }
    if (!g.snapped && !g.crossed && this.shapes) {
      const shape = recognize(s.pts, s.tool === 'highlighter');
      if (shape) { s.pts = shape; s.shape = true; }
    }
    if (s.brush === 'straight' && s.pts.length > 6 && !s.shape && !g.crossed) {
      const p = s.pts;
      s.pts = [p[0], p[1], 0.5, p[p.length - 3], p[p.length - 2], 0.5];
      s.shape = true;
    }
    if (!g.undoPushed) this.pushUndo();   // a stroke that crossed pages is one undo step
    g.v.page.objs.push(s);
    this.clearLive();
    if (g.v.rz) {
      const ctx = g.v.ink.getContext('2d');
      this.tx(g.v, ctx);
      drawStroke(ctx, s);
    }
    this.changed();
  }
  armHold(g) {
    clearTimeout(this.holdT);
    this.holdT = setTimeout(() => {
      if (this.gesture !== g || !this.cur || g.crossed) return;
      const shape = recognize(this.cur.pts, this.cur.tool === 'highlighter');
      if (shape) {
        this.cur.pts = shape;
        this.cur.shape = true;
        g.snapped = true;
        this.drawLiveSoon();
      }
    }, 600);
  }
  begin_highlighter(g, pt) { this.begin_pen(g, pt); }
  move_highlighter(g, pts) { this.move_pen(g, pts); }
  end_highlighter(g) { this.end_pen(g); }

  // Straightedge and study tape use ordinary saved strokes, so undo/export work.
  begin_ruler(g, pt) {
    const o = this.opts.pen;
    this.cur = this.stamp({ id: uid(), type: 'stroke', tool: 'pen', brush: 'fineliner', color: o.color, size: o.size, shape: true, pts: [pt.x, pt.y, .5, pt.x, pt.y, .5] });
    g.snapped = true; this.attachLive(g.v); this.drawLiveSoon();
  }
  move_ruler(g, pts) { if (this.cur) { const p = pts[pts.length - 1]; this.cur.pts.splice(3, 3, p.x, p.y, .5); this.drawLiveSoon(); } }
  end_ruler(g) { this.end_pen(g); }
  begin_tape(g, pt) { this.begin_ruler(g, pt); Object.assign(this.cur, { tape: true, brush: 'ballpoint', color: this.opts.tape.color, size: this.opts.tape.size }); }
  move_tape(g, pts) { this.move_ruler(g, pts); }
  end_tape(g) { this.end_pen(g); }
  begin_navigate(g) { g.scrollX = this.scroller.scrollLeft; g.scrollY = this.scroller.scrollTop; }
  move_navigate(g, pts) { const p = pts[pts.length - 1]; this.scroller.scrollLeft = g.scrollX - (p.x - g.start.x) * this.z; this.scroller.scrollTop = g.scrollY - (p.y - g.start.y) * this.z; }
  end_navigate() {}

  stickerMenu(anchor) {
    const grid = h('div', { class: 'sticker-grid' });
    for (const [text, label] of [['★', 'Star'], ['✓', 'Check'], ['!', 'Important'], ['?', 'Question'], ['→', 'Arrow'], ['💡', 'Idea'], ['🎯', 'Goal'], ['📌', 'Remember'], ['❤️', 'Heart'], ['😊', 'Smile'], ['🔥', 'Focus'], ['🏆', 'Achievement']]) {
      const button = h('button', { type: 'button', 'aria-label': label, title: label }, text);
      button.onclick = async () => {
        close();
        const v = this.currentView(), at = this.visibleCenter(v);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
        const ctx = canvas.getContext('2d'); ctx.font = '112px -apple-system, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#b8ff2c'; ctx.fillText(text, 80, 88);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (blob) await this.insertImageFile(new File([blob], 'sticker.png', { type: 'image/png' }), v, { x: at.x - 40, y: at.y - 40 });
      };
      grid.append(button);
    }
    const close = popover(anchor, grid, { cls: 'sticker-pop' });
  }

  // ---- eraser
  begin_eraser(g, pt) {
    g.before = this.snap();
    g.changed = false;
    this.attachLive(g.v);
    this.eraseSeg(g, pt, pt);
  }
  move_eraser(g, pts) {
    let a = g.last;
    for (const b of pts) { this.eraseSeg(g, a, b); a = b; }
  }
  end_eraser(g) {
    this.eraserAt = null;
    this.clearLive();
    if (g.changed) { this.pushUndo(g.before); this.changed(); }
  }
  eraseSeg(g, a, b) {
    const r = this.opts.eraser.size / 2;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r * 0.5)));
    let hit = false;
    for (let i = 1; i <= steps; i++) {
      if (this.eraseAt(g, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps, r)) hit = true;
    }
    if (steps === 1 && a === b) hit = this.eraseAt(g, a.x, a.y, r) || hit;
    this.eraserAt = b;
    if (hit) { g.changed = true; this.drawInk(g.v); }
    this.drawLiveSoon();
  }
  eraseAt(g, x, y, r) {
    const objs = g.v.page.objs, partial = this.opts.eraser.mode === 'partial';
    let hit = false;
    for (let i = objs.length - 1; i >= 0; i--) {
      const s = objs[i];
      if (s.type !== 'stroke') continue;
      const b = sbbox(s), rr = r + s.size / 2;
      if (x < b.x - r || x > b.x + b.w + r || y < b.y - r || y > b.y + b.h + r) continue;
      if (!partial) {
        if (hitStroke(s.pts, x, y, rr)) { objs.splice(i, 1); hit = true; }
        continue;
      }
      if (!hitStroke(s.pts, x, y, rr)) continue;
      const p = densify(s.pts, Math.max(1, r * 0.4));
      const runs = [];
      let cur = [];
      for (let k = 0; k < p.length; k += 3) {
        if (Math.hypot(p[k] - x, p[k + 1] - y) < rr) { if (cur.length) runs.push(cur); cur = []; }
        else cur.push(r1(p[k]), r1(p[k + 1]), p[k + 2]);
      }
      if (cur.length) runs.push(cur);
      const parts = runs.filter((q) => q.length >= 6).map((q) => ({ ...s, id: uid(), pts: q }));
      objs.splice(i, 1, ...parts);
      hit = true;
    }
    return hit;
  }

  // ---- laser pointer
  begin_laser(g, pt) {
    this.attachLive(g.v);
    this.laserPts ||= [];
    this.laserPts.push(null, { x: pt.x, y: pt.y, t: performance.now() });
    this.laserLoop();
  }
  move_laser(g, pts) {
    const now = performance.now();
    for (const q of pts) this.laserPts.push({ x: q.x, y: q.y, t: now });
  }
  end_laser() {}
  laserLoop() {
    if (this.laserRaf) return;
    const tick = () => {
      const now = performance.now();
      const pts = this.laserPts || [];
      while (pts.length && (!pts[0] || now - pts[0].t > 900)) pts.shift();
      this.drawLive();
      if (pts.length || (this.gesture && this.gesture.kind === 'laser')) this.laserRaf = requestAnimationFrame(tick);
      else { this.laserRaf = 0; this.laserPts = null; this.clearLive(); }
    };
    this.laserRaf = requestAnimationFrame(tick);
  }
  drawLaser(c) {
    const pts = this.laserPts, now = performance.now();
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.shadowColor = '#ff2d2d';
    c.shadowBlur = 12;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (!a || !b) continue;
      const alpha = Math.max(0, 1 - (now - b.t) / 900);
      c.strokeStyle = `rgba(255,45,45,${alpha})`;
      c.lineWidth = 5 / Math.max(0.6, this.z);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
    }
    const last = pts[pts.length - 1];
    if (last && this.gesture && this.gesture.kind === 'laser') {
      c.fillStyle = '#ff2d2d';
      c.beginPath(); c.arc(last.x, last.y, 6 / Math.max(0.6, this.z), 0, 7); c.fill();
    }
    c.restore();
  }

  // ---- lasso / selection (can span several pages)
  // A selection is a map of page view → set of object ids. Objects always live on one page in that
  // page's own coordinates; when moved over another page they move to it, and strokes that end up
  // straddling a page break are split so each page draws its own part.

  // Convert page units of view a into page units of view b.
  conv(a, b) {
    if (a === b) return (x, y) => [x, y];
    const ra = a.layer.getBoundingClientRect(), rb = b.layer.getBoundingClientRect(), z = this.z;
    const dx = (ra.left - rb.left) / z, dy = (ra.top - rb.top) / z;
    return (x, y) => [x + dx, y + dy];
  }
  moveObj(o, f) {
    if (o.type === 'stroke') {
      const p = o.pts.slice();
      for (let i = 0; i < p.length; i += 3) { const [x, y] = f(p[i], p[i + 1]); p[i] = r1(x); p[i + 1] = r1(y); }
      o.pts = p;
    } else { const [x, y] = f(o.x, o.y); o.x = r1(x); o.y = r1(y); }
  }
  // Page under a screen y; in the gap between pages, the nearer page.
  viewNear(clientY) {
    let best = null, bd = Infinity;
    for (const v of this.views) {
      const r = v.el.getBoundingClientRect();
      const d = clientY < r.top ? r.top - clientY : clientY > r.bottom ? clientY - r.bottom : 0;
      if (d < bd) { bd = d; best = v; }
      if (!d) break;
    }
    return best;
  }

  lassoOverlay() {
    if (!this.lassoCv) {
      this.lassoCv = h('canvas', { class: 'lasso-overlay' });
      this.scroller.parentNode.append(this.lassoCv);
    }
    const c = this.lassoCv, s = this.scroller, dpr = window.devicePixelRatio || 1;
    Object.assign(c.style, { left: s.offsetLeft + 'px', top: s.offsetTop + 'px', width: s.clientWidth + 'px', height: s.clientHeight + 'px' });
    c.width = Math.round(s.clientWidth * dpr);
    c.height = Math.round(s.clientHeight * dpr);
    c.hidden = false;
    return c;
  }
  drawLasso() {
    const c = this.lassoCv, P = this.lassoC;
    if (!c || !P || P.length < 4) return;
    const ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1, sr = this.scroller.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, -sr.left * dpr, -sr.top * dpr);
    ctx.clearRect(sr.left, sr.top, sr.width, sr.height);
    ctx.save();
    ctx.setLineDash([6, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#3b5bdb';
    ctx.fillStyle = 'rgba(59,91,219,.07)';
    ctx.beginPath();
    ctx.moveTo(P[0], P[1]);
    for (let i = 2; i < P.length; i += 2) ctx.lineTo(P[i], P[i + 1]);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  hideLasso() {
    this.lassoC = null;
    if (this.lassoCv) { this.lassoCv.getContext('2d').clearRect(0, 0, this.lassoCv.width, this.lassoCv.height); this.lassoCv.hidden = true; }
  }

  client(g, q) { return { x: g.rect.left + q.x * this.z, y: g.rect.top + q.y * this.z }; }

  begin_lasso(g, pt) {
    const c = this.client(g, pt);
    if (this.sel && this.sel.box) {
      const b = this.sel.box.getBoundingClientRect();
      if (Math.hypot(c.x - b.right, c.y - b.bottom) < 24) {
        g.mode = 'resize';
        g.before = this.snap();
        g.bb = { left: b.left, top: b.top, w: Math.max(4, b.width), h: Math.max(4, b.height) };
        g.orig = new Map(this.selEntries().map(({ v, o }) => [o.id, clone(o)]));
        this.selMenu.hidden = true;
        return;
      }
      if (c.x >= b.left && c.x <= b.right && c.y >= b.top && c.y <= b.bottom) {
        g.mode = 'move';
        g.before = this.snap();
        g.lastC = c;
        this.selMenu.hidden = true;
        return;
      }
    }
    this.clearSel();
    g.mode = 'lasso';
    this.lassoC = [c.x, c.y];
    this.lassoOverlay();
  }
  move_lasso(g, pts) {
    if (g.mode === 'lasso') {
      for (const q of pts) { const c = this.client(g, q); this.lassoC.push(c.x, c.y); }
      if (!this.lassoRaf) this.lassoRaf = requestAnimationFrame(() => { this.lassoRaf = 0; this.drawLasso(); });
      return;
    }
    const c = this.client(g, pts[pts.length - 1]);
    const touched = new Set();
    if (g.mode === 'move') {
      const du = (c.x - g.lastC.x) / this.z, dv = (c.y - g.lastC.y) / this.z;
      g.lastC = c;
      if (!du && !dv) return;
      for (const { v, o } of this.selEntries()) { this.moveObj(o, (x, y) => [x + du, y + dv]); touched.add(v); }
      for (const v of this.rehomeSel()) touched.add(v);
    } else if (g.mode === 'resize') {
      const b = g.bb, s = clamp(Math.max((c.x - b.left) / b.w, (c.y - b.top) / b.h), 0.1, 20);
      for (const { v, o } of this.selEntries()) {
        const or = g.orig.get(o.id), r = v.layer.getBoundingClientRect();
        const ax = (b.left - r.left) / this.z, ay = (b.top - r.top) / this.z; // anchor in this page's units
        if (o.type === 'stroke') {
          o.pts = or.pts.map((val, i) => (i % 3 === 0 ? r1(ax + (val - ax) * s) : i % 3 === 1 ? r1(ay + (val - ay) * s) : val));
          o.size = Math.round(or.size * s * 100) / 100;
        } else {
          o.x = ax + (or.x - ax) * s; o.y = ay + (or.y - ay) * s; o.w = or.w * s;
          if (o.type === 'image') o.h = or.h * s; else o.size = Math.round(or.size * s * 10) / 10;
        }
        touched.add(v);
      }
    }
    g.moved = true;
    for (const v of touched) { this.drawInk(v); this.refreshObjEls(v); }
    this.updateSel(false);
  }
  end_lasso(g) {
    if (g.mode === 'lasso') {
      const P = this.lassoC;
      this.hideLasso();
      if (!P) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < P.length; i += 2) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); }
      if (x1 - x0 < 8 && y1 - y0 < 8) this.tapSelect(g.v, g.start);
      else this.polySelect(P, { x0, y0, x1, y1 });
      return;
    }
    if (g.moved) {
      // final placement: objects go to the page they are over; strokes over a page break are split
      const touched = this.rehomeSel();
      for (const v of this.splitSelAcrossPages()) touched.add(v);
      for (const v of touched) { this.renderObjs(v); this.drawInk(v); }
      this.pushUndo(g.before);
      this.changed();
    }
    this.updateSel();
  }

  objBox(v, o) {
    if (o.type === 'stroke') return sbbox(o);
    if (o.type === 'image') return { x: o.x, y: o.y, w: o.w, h: o.h };
    const el = v.objs.querySelector(`[data-id="${o.id}"]`);
    return { x: o.x, y: o.y, w: o.w, h: el ? el.offsetHeight : o.size * 1.35 + 8 };
  }
  tapSelect(v, pt) {
    const objs = v.page.objs;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === 'stroke' && hitStroke(o.pts, pt.x, pt.y, o.size / 2 + 8 / this.z)) return this.select(v, [o.id]);
    }
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.type === 'stroke') continue;
      const b = this.objBox(v, o);
      if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return this.select(v, [o.id]);
    }
    this.clearSel();
  }
  // P: lasso polygon in screen coordinates; may cover several pages.
  polySelect(P, bb) {
    const items = new Map();
    for (const v of this.views) {
      const r = v.layer.getBoundingClientRect();
      if (r.bottom < bb.y0 || r.top > bb.y1 || r.right < bb.x0 || r.left > bb.x1) continue;
      const poly = P.map((val, i) => (i % 2 ? (val - r.top) / this.z : (val - r.left) / this.z));
      const ids = new Set();
      for (const o of v.page.objs) {
        if (o.type === 'stroke') {
          const p = o.pts, n = p.length / 3, step = Math.max(1, Math.floor(n / 40));
          let inside = 0, tot = 0;
          for (let i = 0; i < n; i += step) { tot++; if (inPoly(p[i * 3], p[i * 3 + 1], poly)) inside++; }
          if (inside / tot >= 0.5) ids.add(o.id);
        } else {
          const b = this.objBox(v, o);
          if (inPoly(b.x + b.w / 2, b.y + b.h / 2, poly)) ids.add(o.id);
        }
      }
      if (ids.size) items.set(v, ids);
    }
    this.selectItems(items);
  }
  select(v, ids) { this.selectItems(new Map([[v, new Set(ids)]])); }
  selectItems(items) {
    this.clearSel();
    for (const [v, ids] of items) if (!ids.size) items.delete(v);
    if (!items.size) return;
    this.sel = { items };
    this.buildSelMenu();
    this.updateSel();
  }
  // [{v, o}] for every selected object, in page order
  selEntries() {
    const out = [];
    if (!this.sel) return out;
    for (const v of this.views) {
      const ids = this.sel.items.get(v);
      if (!ids) continue;
      for (const o of v.page.objs) if (ids.has(o.id)) out.push({ v, o });
    }
    return out;
  }
  selObjs() { return this.selEntries().map((e) => e.o); }
  selViews() { return this.sel ? [...this.sel.items.keys()] : []; }

  // Move each selected object to the page its centre is over. Returns the views that changed.
  rehomeSel() {
    const touched = new Set();
    for (const { v, o } of this.selEntries()) {
      const b = this.objBox(v, o), r = v.layer.getBoundingClientRect();
      const cy = r.top + (b.y + b.h / 2) * this.z;
      const t = this.viewNear(cy);
      if (!t || t === v) continue;
      this.moveObj(o, this.conv(v, t));
      v.page.objs = v.page.objs.filter((x) => x !== o);
      t.page.objs.push(o);
      this.sel.items.get(v).delete(o.id);
      if (!this.sel.items.has(t)) this.sel.items.set(t, new Set());
      this.sel.items.get(t).add(o.id);
      touched.add(v); touched.add(t);
    }
    for (const [v, ids] of [...this.sel.items]) if (!ids.size) this.sel.items.delete(v);
    if (touched.size) for (const v of touched) this.renderObjs(v);
    return touched;
  }
  // Split selected strokes that run over a page break into one part per page (continuous at the edge).
  splitSelAcrossPages() {
    const touched = new Set();
    for (const { v, o } of this.selEntries()) {
      if (o.type !== 'stroke' || o.pts.length < 6) continue;
      const r = v.layer.getBoundingClientRect(), p = o.pts, runs = [];
      let cur = null;
      for (let i = 0; i < p.length; i += 3) {
        const cy = r.top + p[i + 1] * this.z;
        const pg = this.viewAt(cy) || (cur ? cur.v : v); // in the gap: stay with the current part
        if (!cur || pg !== cur.v) {
          const prev = cur && cur.pts.slice(-3);
          cur = { v: pg, pts: [] };
          runs.push(cur);
          if (prev) cur.pts.push(prev[0], prev[1], prev[2]); // repeat the previous point so parts join
        }
        cur.pts.push(p[i], p[i + 1], p[i + 2]);
      }
      if (runs.length === 1 && runs[0].v === v) continue;
      v.page.objs = v.page.objs.filter((x) => x !== o);
      this.sel.items.get(v).delete(o.id);
      touched.add(v);
      runs.forEach((run, k) => {
        const part = { ...o, id: k ? uid() : o.id, pts: run.pts };
        this.moveObj(part, this.conv(v, run.v));
        run.v.page.objs.push(part);
        if (!this.sel.items.has(run.v)) this.sel.items.set(run.v, new Set());
        this.sel.items.get(run.v).add(part.id);
        touched.add(run.v);
      });
    }
    for (const [v, ids] of [...this.sel.items]) if (!ids.size) this.sel.items.delete(v);
    return touched;
  }

  updateSel(showMenu = true) {
    const s = this.sel;
    if (!s) return;
    const entries = this.selEntries();
    if (!entries.length) return this.clearSel();
    const P = this.pagesEl.getBoundingClientRect(), z = this.z;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rects = new Map();
    for (const { v, o } of entries) {
      if (!rects.has(v)) rects.set(v, v.layer.getBoundingClientRect());
      const r = rects.get(v), b = this.objBox(v, o);
      x0 = Math.min(x0, r.left + b.x * z); y0 = Math.min(y0, r.top + b.y * z);
      x1 = Math.max(x1, r.left + (b.x + b.w) * z); y1 = Math.max(y1, r.top + (b.y + b.h) * z);
    }
    const pad = 4;
    if (!s.box) s.box = h('div', { class: 'selbox' }, h('div', { class: 'handle' }));
    Object.assign(s.box.style, {
      left: x0 - P.left - pad + 'px', top: y0 - P.top - pad + 'px', width: x1 - x0 + 2 * pad + 'px', height: y1 - y0 + 2 * pad + 'px',
    });
    if (s.box.parentNode !== this.pagesEl) this.pagesEl.append(s.box);
    if (showMenu) { this.selMenu.hidden = false; this.positionSelMenu(); }
  }
  positionSelMenu() {
    if (!this.sel || !this.sel.box || this.selMenu.hidden) return;
    const r = this.sel.box.getBoundingClientRect(), pr = this.root.getBoundingClientRect(), sr = this.scroller.getBoundingClientRect();
    const m = this.selMenu, mw = m.offsetWidth, mh = m.offsetHeight;
    let top = r.top - pr.top - mh - 10;
    if (r.top - mh - 10 < sr.top) top = r.bottom - pr.top + 12;
    top = clamp(top, sr.top - pr.top + 6, pr.height - mh - 8);
    m.style.top = top + 'px';
    m.style.left = clamp(r.left - pr.left + r.width / 2 - mw / 2, 8, Math.max(8, pr.width - mw - 8)) + 'px';
  }
  buildSelMenu() {
    const m = this.selMenu;
    m.textContent = '';
    const btn = (label, fn) => { const b = h('button', {}, label); b.onclick = fn; m.append(b); };
    btn('Copy', () => this.copySel());
    btn('Cut', () => { this.copySel(); this.deleteSel(); });
    btn('Duplicate', () => this.duplicateSel());
    btn('Delete', () => this.deleteSel());
    const objs = this.selObjs();
    if (objs.some((o) => o.type === 'stroke' && o.tool !== 'highlighter')) {
      btn('To text', () => this.selToText());
      btn('Math → LaTeX', () => this.selToLatex());
    }
    if (objs.some((o) => o.type !== 'image')) {
      for (const c of PEN_COLORS.slice(0, 6)) {
        const s = h('button', { class: 'swatch', style: { background: c }, title: 'Recolor', 'aria-label': 'Recolor ' + c });
        s.onclick = () => this.recolorSel(c);
        m.append(s);
      }
      const more = h('button', { class: 'swatch custom', title: 'Recolor: any color', 'aria-label': 'Recolor with any color' });
      more.onclick = async () => { const c = await pickColor(more, this.selObjs().find((o) => o.color)?.color || '#1f2328', { title: 'Recolor' }); if (c) this.recolorSel(c); };
      m.append(more);
    }
  }
  clearSel() {
    if (this.sel && this.sel.box) this.sel.box.remove();
    this.sel = null;
    this.selMenu.hidden = true;
  }
  refreshObjEls(v) {
    for (const o of v.page.objs) {
      if (o.type === 'stroke') continue;
      const el = v.objs.querySelector(`[data-id="${o.id}"]`);
      if (el) this.placeEl(el, o);
    }
  }
  // Selected objects as clones, all converted into the coordinates of one page (the first).
  selInOnePage() {
    const entries = this.selEntries();
    if (!entries.length) return { base: null, objs: [] };
    const base = entries[0].v;
    return { base, objs: entries.map(({ v, o }) => { const c = clone(o); this.moveObj(c, this.conv(v, base)); return c; }) };
  }
  copySel() {
    this.app.clipboard = this.selInOnePage().objs;
    toast('Copied');
  }
  deleteSel() {
    if (!this.sel) return;
    this.pushUndo();
    for (const [v, ids] of this.sel.items) {
      v.page.objs = v.page.objs.filter((o) => !ids.has(o.id));
      this.renderObjs(v);
      this.drawInk(v);
    }
    this.clearSel();
    this.changed();
  }
  duplicateSel() {
    if (!this.sel) return;
    const { base, objs } = this.selInOnePage();
    this.placeObjs(base, objs, 24);
  }
  recolorSel(c) {
    this.pushUndo();
    for (const o of this.selObjs()) if (o.type !== 'image') o.color = c;
    for (const v of this.selViews()) { this.renderObjs(v); this.drawInk(v); }
    this.changed();
  }
  paste() {
    const objs = this.app.clipboard;
    if (!objs || !objs.length) { toast('Nothing to paste'); return; }
    this.placeObjs(this.currentView(), clone(objs), 24);
  }
  // Add objects (in v's coordinates) and select them; anything that lands on another page moves there.
  placeObjs(v, objs, offset) {
    this.pushUndo();
    for (const o of objs) {
      o.id = uid();
      delete o.rec; delete o.t;
      if (o.type === 'stroke') o.pts = o.pts.map((val, i) => (i % 3 === 2 ? val : r1(val + offset)));
      else { o.x += offset; o.y += offset; }
      v.page.objs.push(o);
    }
    this.renderObjs(v);
    if (this.tool !== 'lasso') this.setTool('lasso');
    this.select(v, objs.map((o) => o.id));
    const touched = this.rehomeSel();
    for (const t of this.splitSelAcrossPages()) touched.add(t);
    touched.add(v);
    for (const t of touched) { this.renderObjs(t); this.drawInk(t); }
    this.changed();
    this.updateSel();
  }

  // ---- text boxes
  styleText(el, o) {
    el.style.left = o.x + 'px';
    el.style.top = o.y + 'px';
    el.style.width = o.w + 'px';
    el.style.font = textFont(o);
    el.style.color = o.color;
  }
  makeTextEl(v, o) {
    const el = h('div', { class: 'tbox', 'data-id': o.id, spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' });
    el.contentEditable = 'plaintext-only';
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
    this.styleText(el, o);
    el.textContent = o.text;
    el.addEventListener('focus', () => {
      this.editing = { v, o, el, before: this.editBefore || this.snap() };
      this.editBefore = null;
    });
    el.addEventListener('input', () => {
      o.text = el.innerText.replace(/\n$/, '');
      this.save();
      this.thumbSave();
      this.dirty = true;
    });
    el.addEventListener('blur', () => this.endTextEdit(el));
    return el;
  }
  endTextEdit(el) {
    const ed = this.editing;
    if (!ed || ed.el !== el) return;
    this.editing = null;
    if (!ed.o.text.trim()) {
      ed.v.page.objs = ed.v.page.objs.filter((x) => x !== ed.o);
      el.remove();
    }
    if (this.snap() !== ed.before) { this.pushUndo(ed.before); this.changed(); }
  }
  textDown(e, v, pt) {
    if (e.target.closest('.tbox')) return;
    e.preventDefault();
    if (this.editing) { this.editing.el.blur(); return; }
    const before = this.snap();
    const t = this.opts.text;
    const o = this.stamp({
      id: uid(), type: 'text', x: r1(pt.x - 4), y: r1(pt.y - t.size * 0.9),
      w: clamp(v.page.w - pt.x - 24, 120, 440), text: '', size: t.size, color: t.color, bold: t.bold,
    });
    v.page.objs.push(o);
    const el = this.makeTextEl(v, o);
    v.objs.append(el);
    this.editBefore = before;
    el.focus();
  }

  // ---- images & PDFs
  async insertImageFile(file, v = this.currentView(), at = null) {
    let blob = file;
    let img = await createImageBitmap(file).catch(() => null);
    if (!img) { toast('Could not read that image'); return; }
    const MAX = 2400;
    let { width: iw, height: ih } = img;
    if (Math.max(iw, ih) > MAX) {
      const k = MAX / Math.max(iw, ih);
      const c = h('canvas');
      c.width = Math.round(iw * k); c.height = Math.round(ih * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      blob = await new Promise((res) => c.toBlob(res, type, 0.9));
      iw = c.width; ih = c.height;
    }
    img.close && img.close();
    const id = await putBlob(blob);
    let w = Math.min(iw, v.page.w * 0.6), ht = (w * ih) / iw;
    if (ht > v.page.h * 0.6) { ht = v.page.h * 0.6; w = (ht * iw) / ih; }
    const c = at || this.visibleCenter(v);
    const o = this.stamp({
      id: uid(), type: 'image', blob: id,
      x: r1(clamp(c.x - w / 2, 0, v.page.w - w)), y: r1(clamp(c.y - ht / 2, 0, v.page.h - ht)), w: r1(w), h: r1(ht),
    });
    this.pushUndo();
    v.page.objs.push(o);
    this.renderObjs(v);
    this.changed();
    this.setTool('lasso');
    this.select(v, [o.id]);
  }

  async insertPdf(file) {
    toast('Importing PDF…', 8000);
    try {
      const blobId = await putBlob(file);
      const { pages, text } = await pdfToPages(blobId);
      this.pushUndo();
      const at = this.curIdx + 1;
      // If the note is just one empty blank page, replace it
      const only = this.doc.pages.length === 1 && !this.doc.pages[0].objs.length && !this.doc.pages[0].pdf;
      if (only) this.doc.pages = pages; else this.doc.pages.splice(at, 0, ...pages);
      this.doc.pdfText = ((this.doc.pdfText || '') + '\n' + text).slice(0, 200000);
      this.rebuild();
      this.changed();
      requestAnimationFrame(() => { this.fit(); if (!only) this.scrollToPage(at); });
      toast(`Added ${pages.length} PDF page${pages.length === 1 ? '' : 's'}`);
    } catch (e) {
      console.error(e);
      toast('Could not import that PDF: ' + e.message, 5000);
    }
  }

  addMenu(btn) {
    menu(btn, [
      { label: 'Page with template…', icon: 'template', action: () => this.insertTemplatePage() },
      { label: 'Blank page at end', icon: 'pageplus', action: () => this.addPage(this.doc.pages.length - 1, true) },
      'sep',
      { label: 'Image from files', icon: 'image', action: async () => { const [f] = await pickFiles('image/*'); f && this.insertImageFile(f); } },
      { label: 'Take photo', icon: 'camera', action: async () => { const [f] = await pickFiles('image/*', { capture: 'environment' }); f && this.insertImageFile(f); } },
      { label: 'Scan documents', icon: 'scan', action: () => this.insertScan() },
      'sep',
      { label: 'PDF pages', icon: 'file', action: async () => { const [f] = await pickFiles('application/pdf,.pdf'); f && this.insertPdf(f); } },
      { label: 'Word doc, slides or text file', icon: 'doc', action: async () => { const [f] = await pickFiles(DOC_ACCEPT); f && this.insertDocFile(f); } },
      { label: 'YouTube video', icon: 'video', action: () => this.addVideo() },
      this.app.clipboard && 'sep',
      this.app.clipboard && { label: 'Paste', icon: 'clip', action: () => this.paste() },
    ]);
  }

  moreMenu(btn) {
    const split = this.app.panes.length > 1;
    menu(btn, [
      { label: 'Rename note', icon: 'text', action: async () => {
        const title = await promptText('Rename note', this.note.title);
        if (title) { this.note.title = title; this.titleEl.value = title; this.saveNow(); }
      } },
      { label: 'AI assistant', icon: 'spark', action: () => this.side.open('ai') },
      { label: 'Shape recognition' + (this.shapes ? ' ✓' : ''), icon: 'shapes', action: () => this.toggleShapes() },
      { label: 'Laser pointer', icon: 'laser', action: () => this.setTool('laser') },
      { label: 'Zoom in', icon: 'plus', action: () => this.zoomBy(1.2) },
      { label: 'Zoom out', icon: 'minus', action: () => this.zoomBy(1 / 1.2) },
      'sep',
      { label: 'Paper & templates', icon: 'template', action: () => this.paperDialog() },
      { label: 'Find in note', icon: 'search', action: () => this.side.open('find') },
      { label: 'Page manager', icon: 'pages', action: () => this.togglePageManager() },
      'sep',
      { label: 'Recordings', icon: 'wave', action: () => this.side.open('audio') },
      { label: 'Flashcards & quiz', icon: 'cards', action: () => this.side.open('study') },
      { label: 'Version history', icon: 'clock', action: () => this.side.open('history') },
      { label: 'Share & export…', icon: 'share', action: () => this.shareMenu(btn) },
      'sep',
      split ? { label: 'Close this pane', icon: 'close', action: () => this.app.closePane(this) }
        : { label: 'Open another note side by side', icon: 'split', action: () => this.app.pickSplit(this) },
      { label: 'Fit page width', icon: 'paper', action: () => this.fit() },
    ]);
  }

  // ---------------------------------------------------------------- paper & templates
  async paperDialog() {
    const cur = this.doc.pages[this.curIdx] || this.doc.pages[0];
    const res = await templateGallery({
      title: 'Paper & templates',
      paper: cur.paper || this.note.paper,
      size: this.note.pageSize || 'letter',
      scopes: [['all', 'Whole note'], ['page', `This page (${this.curIdx + 1})`]],
    });
    if (!res) return;
    this.pushUndo();
    if (res.scope === 'page') {
      cur.paper = res.paper;
    } else {
      this.note.paper = res.paper;
      for (const p of this.doc.pages) delete p.paper;
    }
    if (res.size !== this.note.pageSize) {
      this.note.pageSize = res.size;
      const sz = PAGE_SIZES[res.size];
      const targets = res.scope === 'page' ? [cur] : this.doc.pages;
      for (const p of targets) if (!p.pdf) { p.w = sz.w; p.h = sz.h; }
      this.buildPages();
      requestAnimationFrame(() => this.fit());
    } else {
      for (const v of this.views) if (v.rz) this.drawBg(v);
    }
    this.changed();
  }

  async insertTemplatePage() {
    const res = await templateGallery({ title: 'Insert page', paper: this.note.paper, size: this.note.pageSize || 'letter', okLabel: 'Insert page' });
    if (!res) return;
    this.pushUndo();
    const p = blankPage(res.size);
    p.paper = res.paper;
    this.doc.pages.splice(this.curIdx + 1, 0, p);
    this.rebuild();
    this.changed();
    requestAnimationFrame(() => this.scrollToPage(this.curIdx + 1));
  }

  // ---------------------------------------------------------------- export
  shareMenu(btn) {
    menu(btn, [
      { label: 'Export as PDF', icon: 'file', action: () => this.exportPdf() },
      { label: 'Export current page as image', icon: 'image', action: () => this.exportPage(this.curIdx) },
      { label: 'Share as web page', icon: 'link', action: () => this.exportWeb() },
      { label: 'Export note file (.opage)', icon: 'download', action: () => this.exportFile() },
      { label: 'Print', icon: 'print', action: () => printNote(this.note, this.doc) },
    ]);
  }
  async exportPdf() {
    toast('Creating PDF…', 20000);
    try {
      const blob = await exportPDF(this.note, this.doc, (i, n) => toast(`Creating PDF… page ${i} of ${n}`, 20000));
      toast('PDF ready');
      await shareOrDownload(blob, safeName(this.note.title) + '.pdf');
    } catch (e) { console.error(e); toast('PDF export failed: ' + e.message, 5000); }
  }
  async exportPage(i) {
    const blob = await exportPagePNG(this.doc.pages[i], this.note.paper);
    await shareOrDownload(blob, `${safeName(this.note.title)} - page ${i + 1}.png`);
  }
  async exportFile() {
    toast('Packaging note…');
    const blob = await exportNoteFile(this.note, this.doc);
    await shareOrDownload(blob, safeName(this.note.title) + '.opage');
  }
  async exportWeb() {
    toast('Building web page…', 20000);
    try {
      const blob = await exportWebPage(this.note, this.doc);
      toast('Web page ready. Send it to anyone, or upload it to any website host to get a link.', 5000);
      await shareOrDownload(blob, safeName(this.note.title) + '.html');
    } catch (e) { toast('Could not build the page: ' + e.message, 5000); }
  }

  // ---------------------------------------------------------------- audio recording
  async toggleRecord() {
    if (this.recording) return this.stopRecording();
    if (this.app.panes.some((p) => p !== this && p.recording)) { toast('Already recording in the other note'); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      toast('Audio recording is not supported in this browser', 4000);
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      toast('Microphone access was blocked. Allow it in your browser settings to record.', 5000);
      return;
    }
    this.stopReplay();
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const r = (this.recording = { id: uid(), t0: performance.now(), mr, stream, chunks: [], transcript: [], created: Date.now() });
    recordingChanged(true);
    mr.ondataavailable = (e) => { if (e.data && e.data.size) r.chunks.push(e.data); };
    mr.start(1000);
    this.recBtn.classList.add('recording');
    this.recBtn.innerHTML = icon('stop');
    this.recBtn.title = 'Stop recording';
    this.recInd.hidden = false;
    const timeEl = this.recInd.querySelector('.rec-time');
    r.timer = setInterval(() => { timeEl.textContent = fmtTime(performance.now() - r.t0); }, 500);
    timeEl.textContent = '0:00';
    if (prefs.get('transcribe', false)) {
      this.startTranscription(r);
      if (prefs.get('smartNotes', true) && aiReady()) r.smart = setInterval(() => this.smartNotesTick(r), 75000);
    }
    try { r.wake = navigator.wakeLock && (await navigator.wakeLock.request('screen')); } catch {}
    nativeWake(true);
    if (!this.audioPanel.hidden) this.renderAudioPanel();
  }

  stopRecording() {
    const r = this.recording;
    if (!r) return Promise.resolve();
    recordingChanged(false);
    r.duration = Math.round(performance.now() - r.t0);
    return new Promise((res) => {
      r.mr.onstop = async () => {
        r.stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
        const blobId = await putBlob(blob);
        this.doc.recordings.push({
          id: r.id, blob: blobId, name: `Recording ${this.doc.recordings.length + 1}`, created: r.created,
          duration: r.duration, mime: blob.type, transcript: r.transcript,
        });
        this.changed();
        if (!this.audioPanel.hidden) this.renderAudioPanel();
        toast('Recording saved. Open recordings to replay it with your notes.');
        res();
      };
      clearInterval(r.timer);
      clearInterval(r.smart);
      if (r.smart) this.smartNotesTick(r, true);
      r.stopped = true;
      try { r.sr && r.sr.stop(); } catch {}
      try { r.wake && r.wake.release(); } catch {}
      nativeWake(false);
      this.recording = null;
      this.recBtn.classList.remove('recording');
      this.recBtn.innerHTML = icon('mic');
      this.recBtn.title = 'Record audio';
      this.recInd.hidden = true;
      r.mr.stop();
    });
  }

  startTranscription(r) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Live transcription is not available in this browser'); return; }
    const sr = new SR();
    sr.continuous = true;
    sr.interimResults = false;
    sr.lang = navigator.language || 'en-US';
    sr.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (!e.results[i].isFinal) continue;
        const text = e.results[i][0].transcript.trim();
        if (!text) continue;
        const est = text.split(/\s+/).length * 380; // rough start time of the phrase
        r.transcript.push({ t: Math.max(0, Math.round(performance.now() - r.t0 - est)), text });
      }
    };
    sr.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { r.srOff = true; toast('Live transcription was blocked by the browser'); }
    };
    sr.onend = () => { if (!r.stopped && !r.srOff) { try { sr.start(); } catch {} } };
    try { sr.start(); r.sr = sr; } catch {}
  }

  // ---------------------------------------------------------------- playback / replay
  toggleAudioPanel() { this.side.toggle('audio'); }

  // Called by the side panel when the Audio tab is shown / hidden.
  audioOpened() {
    this.audioPanel.hidden = false;
    const recs = this.doc.recordings;
    if (recs.length && !this.replay) this.selectRecording(recs[recs.length - 1]);
    else this.renderAudioPanel();
  }
  audioClosed() {
    this.audioPanel.hidden = true;
    this.stopReplay(true);
  }

  async selectRecording(rec) {
    this.stopReplay(true);
    const audio = new Audio(await blobURL(rec.blob));
    audio.preload = 'auto';
    audio.playbackRate = prefs.get('speed', 1);
    const times = [];
    for (const p of this.doc.pages) for (const o of p.objs) if (o.rec === rec.id && o.t != null) times.push(o.t);
    times.sort((a, b) => a - b);
    this.replay = { rec, audio, times, idx: -1 };
    this.root.classList.add('replaying');
    this.banner.hidden = false;
    audio.onplay = () => this.replayLoop();
    audio.onpause = audio.onended = () => this.updatePlayer();
    this.renderAudioPanel();
    this.redrawReplay(true);
  }

  stopReplay(keepPanel) {
    const rp = this.replay;
    if (!rp) return;
    rp.audio.pause();
    rp.audio.removeAttribute('src');
    this.replay = null;
    cancelAnimationFrame(this.replayRaf);
    this.replayRaf = 0;
    this.root.classList.toggle('replaying', !!this.ytLink);
    this.banner.hidden = !this.ytLink;
    for (const v of this.views) this.drawInk(v);
    if (!keepPanel && !this.audioPanel.hidden) this.renderAudioPanel();
  }

  replayLoop() {
    cancelAnimationFrame(this.replayRaf);
    const tick = () => {
      if (!this.replay) return;
      this.updatePlayer();
      this.redrawReplay();
      if (!this.replay.audio.paused) this.replayRaf = requestAnimationFrame(tick);
    };
    this.replayRaf = requestAnimationFrame(tick);
  }

  redrawReplay(force) {
    const rp = this.replay;
    if (!rp) return;
    const cut = rp.audio.currentTime * 1000;
    let lo = 0, hi = rp.times.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (rp.times[m] <= cut) lo = m + 1; else hi = m; }
    if (force || lo !== rp.idx) {
      rp.idx = lo;
      for (const v of this.views) if (v.visible) this.drawInk(v);
    }
  }

  seek(ms, play) {
    const rp = this.replay;
    if (!rp) return;
    rp.audio.currentTime = clamp(ms, 0, rp.rec.duration) / 1000;
    this.redrawReplay(true);
    this.updatePlayer();
    if (play) rp.audio.play().catch(() => {});
  }

  replayTap(v, pt) {
    const objs = v.page.objs;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.rec == null || o.t == null) continue;
      const hit = o.type === 'stroke'
        ? hitStroke(o.pts, pt.x, pt.y, o.size / 2 + 10 / this.z)
        : (() => { const b = this.objBox(v, o); return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; })();
      if (!hit) continue;
      const rec = this.doc.recordings.find((r) => r.id === o.rec);
      if (!rec) continue;
      const go = () => this.seek(o.t - 1500, true);
      if (rec.id !== this.replay.rec.id) this.selectRecording(rec).then(go); else go();
      return;
    }
    toast('That part of the note was not written during a recording');
  }

  updatePlayer() {
    const rp = this.replay, p = this.audioPanel;
    if (!rp || p.hidden) return;
    const ms = rp.audio.currentTime * 1000;
    const range = p.querySelector('input[type="range"]');
    if (range && !range.matches(':active')) range.value = ms;
    const time = p.querySelector('.time');
    if (time) time.textContent = `${fmtTime(ms)} / ${fmtTime(rp.rec.duration)}`;
    const play = p.querySelector('[data-p="play"]');
    if (play) {
      const want = rp.audio.paused ? 'play' : 'pause';
      if (play.dataset.state !== want) { play.dataset.state = want; play.innerHTML = icon(want); play.title = want === 'play' ? 'Play' : 'Pause'; }
    }
    const segs = p.querySelectorAll('.transcript span');
    let now = -1;
    (rp.rec.transcript || []).forEach((s, i) => { if (s.t <= ms) now = i; });
    segs.forEach((s, i) => s.classList.toggle('now', i === now));
  }

  renderAudioPanel() {
    const p = this.audioPanel;
    p.textContent = '';
    const recs = this.doc.recordings;
    if (this.recording) p.append(h('div', { class: 'audio-empty' }, 'Recording… everything you write now is linked to this moment in the audio.'));
    if (!recs.length) {
      if (!this.recording) p.append(h('div', { class: 'audio-empty' },
        'No recordings yet. Tap the microphone to record a lecture or meeting while you take notes. Afterwards, play it back here and your notes replay in sync — tap any ink to jump to that moment.'));
      return;
    }
    const list = h('div', { class: 'rec-list' });
    for (const r of recs) {
      const more = h('button', { class: 'icon-btn', title: 'Recording options', html: icon('more') });
      const chip = h('div', { class: 'rec-chip' + (this.replay && this.replay.rec.id === r.id ? ' on' : ''), role: 'button', tabindex: 0 },
        h('span', {}, `${r.name} · ${fmtTime(r.duration)}`), more);
      chip.onclick = (e) => { if (!more.contains(e.target)) this.selectRecording(r); };
      more.onclick = (e) => {
        e.stopPropagation();
        menu(more, [
          { label: 'Rename', icon: 'edit', action: async () => { const n = await promptText('Rename recording', r.name); if (n) { r.name = n; this.changed(); this.renderAudioPanel(); } } },
          { label: 'Download audio', icon: 'download', action: async () => {
            const b = await (await import('./db.js')).getBlob(r.blob);
            const ext = (b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm');
            download(b, `${safeName(this.note.title)} - ${safeName(r.name)}.${ext}`);
          } },
          { label: 'Delete recording', icon: 'trash', danger: true, action: async () => {
            if (!(await confirmDlg(`Delete "${r.name}"? Your notes stay; only the audio is removed.`))) return;
            if (this.replay && this.replay.rec.id === r.id) this.stopReplay(true);
            this.doc.recordings = this.doc.recordings.filter((x) => x !== r);
            this.changed();
            this.renderAudioPanel();
          } },
        ]);
      };
      list.append(chip);
    }
    p.append(list);
    const rp = this.replay;
    if (!rp) return;
    const b = (name, title, fn, attrs = {}) => { const x = h('button', { class: 'icon-btn', title, html: icon(name), ...attrs }); x.onclick = fn; return x; };
    const range = h('input', { type: 'range', min: 0, max: rp.rec.duration, step: 100, value: rp.audio.currentTime * 1000, 'aria-label': 'Playback position' });
    range.oninput = () => this.seek(+range.value);
    const speed = h('select', { 'aria-label': 'Playback speed' }, ...[0.75, 1, 1.25, 1.5, 2].map((s) => h('option', { value: s, selected: rp.audio.playbackRate === s }, s + '×')));
    speed.onchange = () => { rp.audio.playbackRate = +speed.value; prefs.set('speed', +speed.value); };
    p.append(h('div', { class: 'player' },
      b('play', 'Play', () => (rp.audio.paused ? rp.audio.play().catch(() => {}) : rp.audio.pause()), { 'data-p': 'play', 'data-state': 'play' }),
      b('back15', 'Back 15 seconds', () => this.seek(rp.audio.currentTime * 1000 - 15000)),
      b('fwd15', 'Forward 15 seconds', () => this.seek(rp.audio.currentTime * 1000 + 15000)),
      range,
      h('span', { class: 'time' }),
      speed,
    ));
    if (rp.rec.transcript && rp.rec.transcript.length) {
      const tr = h('div', { class: 'transcript' });
      for (const s of rp.rec.transcript) {
        const sp = h('span', { title: fmtTime(s.t) }, s.text + ' ');
        sp.onclick = () => this.seek(s.t, true);
        tr.append(sp);
      }
      p.append(h('div', { class: 'field' }, h('span', {}, 'Transcript'), tr));
    }
    this.updatePlayer();
  }

  // ---------------------------------------------------------------- page manager
  togglePageManager() {
    this.pm.hidden = !this.pm.hidden;
    this.root.querySelector('[data-act="pages"]').classList.toggle('on', !this.pm.hidden);
    if (!this.pm.hidden) this.renderPageManager();
  }

  async renderPageManager() {
    if (this.pm.hidden) return;
    const token = (this.pmToken = {});
    this.thumbCache ||= new Map();
    this.pm.textContent = '';
    const jobs = [];
    this.doc.pages.forEach((p, i) => {
      const key = `${p.w}x${p.h}:${p.objs.length}:${JSON.stringify(p.objs).length}:${JSON.stringify(p.paper || this.note.paper)}`;
      const ph = h('div', { class: 'ph', style: { aspectRatio: `${p.w} / ${p.h}` } });
      const b = h('button', { type: 'button', class: 'pm-page' + (i === this.curIdx ? ' cur' : ''), title: `Page ${i + 1}` }, ph, String(i + 1));
      b.onclick = () => this.scrollToPage(i);
      b.oncontextmenu = (e) => { e.preventDefault(); this.pageMenu(b, i); };
      this.pm.append(b);
      const hit = this.thumbCache.get(p.id);
      if (hit && hit.key === key) ph.replaceWith(h('img', { src: hit.url, alt: '' }));
      else jobs.push({ p, ph, key });
    });
    const add = h('button', { type: 'button', class: 'btn small' }, '+ Page');
    add.onclick = () => this.insertTemplatePage();
    this.pm.append(add);
    for (const { p, ph, key } of jobs) {
      if (this.pmToken !== token || this.pm.hidden) return;
      try {
        const c = await renderPageCanvas(p, this.note.paper, 0.2);
        const url = c.toDataURL('image/jpeg', 0.7);
        c.width = c.height = 0;
        this.thumbCache.set(p.id, { key, url });
        if (this.pmToken === token) ph.replaceWith(h('img', { src: url, alt: '' }));
      } catch {}
    }
  }

  // ---------------------------------------------------------------- handwriting recognition
  ocrOn() { return ocrEnabled(); }
  inkSig(p) { return inkSignature(p); }

  async indexAll(force) {
    if (!this.ocrOn() || this.ocrBusy || !this.doc) return;
    this.ocrBusy = true;
    let any = false;
    try {
      for (const p of this.doc.pages) {
        if (!this.doc) break;
        const sig = inkSignature(p);
        if (p.ocr && p.ocr.sig === sig) continue;
        if (!sig) { if (p.ocr) { delete p.ocr; any = true; } continue; }
        const r = await recognizePage(p);
        if (inkSignature(p) === r.sig) { p.ocr = r; any = true; }
      }
    } catch (e) {
      console.warn('Handwriting recognition unavailable', e);
      if (force) toast('Handwriting recognition could not start (are you offline?)');
    } finally { this.ocrBusy = false; }
    if (any) { this.dirty = true; this.save(); }
  }

  flashBox(i, box) {
    const v = this.views[i];
    if (!v) return;
    const pad = 4;
    const el = h('div', { class: 'flash', style: { left: box.x - pad + 'px', top: box.y - pad + 'px', width: box.w + 2 * pad + 'px', height: box.h + 2 * pad + 'px' } });
    v.layer.append(el);
    setTimeout(() => el.remove(), 2000);
    this.scroller.scrollTop = v.el.offsetTop + box.y * this.z - this.scroller.clientHeight / 3;
  }

  // ---------------------------------------------------------------- adding content
  appendPages(pages, at = this.doc.pages.length) {
    this.pushUndo();
    this.doc.pages.splice(at, 0, ...pages);
    this.rebuild();
    this.changed();
    requestAnimationFrame(() => this.scrollToPage(at));
  }

  appendText(title, text) {
    const { pages } = textToPages(`# ${title}\n\n${text}`, this.note.pageSize || 'letter', true);
    this.appendPages(pages);
    toast(`${title} added at the end of the note`);
  }

  async insertScan() {
    const blobs = await scanDocuments();
    if (!blobs.length) return;
    const pages = await imagesToPages(blobs, this.note.pageSize || 'letter', 0);
    const only = this.doc.pages.length === 1 && !this.doc.pages[0].objs.length && !this.doc.pages[0].pdf;
    if (only) { this.pushUndo(); this.doc.pages = pages; this.rebuild(); this.changed(); }
    else this.appendPages(pages, this.curIdx + 1);
    toast(`Added ${pages.length} scanned page${pages.length > 1 ? 's' : ''}`);
  }

  async insertDocFile(f) {
    toast(`Importing ${f.name}…`, 10000);
    try {
      const { pages, text } = await fileToPages(f, this.note.pageSize || 'letter');
      this.doc.pdfText = ((this.doc.pdfText || '') + '\n' + text).slice(0, 200000);
      this.appendPages(pages, this.curIdx + 1);
      toast(`Added ${pages.length} page${pages.length > 1 ? 's' : ''}`);
    } catch (e) { console.error(e); toast('Could not import that file: ' + e.message, 5000); }
  }

  // ---------------------------------------------------------------- selection → text / LaTeX
  // Selected handwriting (possibly over several pages) in one page's coordinates, plus its bounds.
  selStrokesInOnePage() {
    const { base: v, objs } = this.selInOnePage();
    const strokes = objs.filter((o) => o.type === 'stroke' && o.tool !== 'highlighter');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of strokes) { const bb = sbbox(o); x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y); x1 = Math.max(x1, bb.x + bb.w); y1 = Math.max(y1, bb.y + bb.h); }
    return { v, strokes, ids: new Set(strokes.map((o) => o.id)), b: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
  }
  // Place a new object given in v's coordinates; it moves to whichever page it lands on.
  addObjRehomed(v, o) {
    v.page.objs.push(o);
    this.renderObjs(v);
    const t = this.viewNear(v.layer.getBoundingClientRect().top + (o.y + 10) * this.z);
    if (t && t !== v) {
      this.moveObj(o, this.conv(v, t));
      v.page.objs = v.page.objs.filter((x) => x !== o);
      t.page.objs.push(o);
      this.renderObjs(v);
      this.renderObjs(t);
    }
  }

  async selToText() {
    const { v, strokes, ids: strokeIds, b } = this.selStrokesInOnePage();
    toast('Reading handwriting…', 15000);
    let text = '';
    try {
      if (aiReady() && aiSupportsImages()) {
        text = await ask({
          system: 'You transcribe handwriting exactly as written.',
          content: [{ type: 'image', mediaType: 'image/png', data: strokesImage(strokes) }, { type: 'text', text: 'Transcribe this handwriting. Keep the line breaks. Output only the transcription.' }],
          effort: 'low', maxTokens: 4000,
        });
      } else text = await recognizeStrokes(strokes);
    } catch (e) { toast('Could not convert: ' + e.message, 5000); return; }
    text = (text || '').trim();
    if (!text) { toast('Could not read that handwriting'); return; }
    this.pushUndo();
    const pages = this.selViews();
    for (const pv of pages) pv.page.objs = pv.page.objs.filter((o) => !strokeIds.has(o.id));
    const lines = text.split('\n').length;
    const o = { id: uid(), type: 'text', x: r1(b.x), y: r1(b.y), w: r1(Math.max(160, b.w + 40)), text, size: Math.round(clamp(b.h / lines / 1.6, 13, 40)), color: strokes[0].color === '#ffffff' ? PEN_COLORS[0] : strokes[0].color, bold: false };
    this.clearSel();
    this.addObjRehomed(v, o);
    for (const pv of pages) { this.renderObjs(pv); this.drawInk(pv); }
    this.changed();
    toast('Converted to text');
  }

  async selToLatex() {
    if (!aiReady() || !aiSupportsImages()) {
      toast(aiReady() ? 'Math conversion needs Claude (Settings → AI).' : aiUnavailableReason(), 5000);
      return;
    }
    const { v, strokes, b } = this.selStrokesInOnePage();
    toast('Converting math…', 15000);
    try {
      const tex = (await ask({
        system: 'You convert handwritten mathematics to LaTeX.',
        content: [{ type: 'image', mediaType: 'image/png', data: strokesImage(strokes) }, { type: 'text', text: 'Convert this handwritten math to LaTeX. Output only the LaTeX source, without $ delimiters or code fences.' }],
        effort: 'low', maxTokens: 4000,
      })).trim().replace(/^```(?:latex)?\s*|\s*```$/g, '');
      if (!prefs.get('protected', false)) try { await navigator.clipboard.writeText(tex); } catch {}
      this.pushUndo();
      this.addObjRehomed(v, { id: uid(), type: 'text', x: r1(b.x), y: r1(b.y + b.h + 8), w: r1(Math.max(240, b.w)), text: tex, size: 15, color: '#5b3cc4', bold: false });
      this.changed();
      toast('LaTeX added below the math and copied to the clipboard');
    } catch (e) { toast('Could not convert: ' + e.message, 5000); }
  }

  // ---------------------------------------------------------------- live smart notes (AI, while recording)
  async smartNotesTick(r, final) {
    const from = r.smartFrom || 0;
    const segs = r.transcript.slice(from);
    const chunk = segs.map((s) => s.text).join(' ');
    if (chunk.length < (final ? 60 : 240)) return;
    r.smartFrom = r.transcript.length;
    try {
      const text = await ask({
        system: 'You take concise, accurate lecture notes for a student.',
        content: [{ type: 'text', text: `Lecture transcript excerpt (speech-to-text, may contain errors):\n\n${chunk}\n\nWrite 2–6 short bullet points with the key ideas, facts, definitions and any instructions (deadlines, exam hints). Bullets only.` }],
        effort: 'low', maxTokens: 2000,
      });
      this.doc.smartNotes ||= [];
      this.doc.smartNotes.push({ t: segs[0].t, rec: r.id, text: text.trim() });
      this.changed();
      this.side.refreshIf('ai');
    } catch (e) { console.warn('Smart notes', e); }
  }

  // ---------------------------------------------------------------- versions
  async snapshot(force, pagesJson = this.snap()) {
    if (!this.doc) return;
    if (!force && pagesJson === this.lastSnapJson) return;
    const now = Date.now();
    this.lastSnap = now;
    this.lastSnapJson = pagesJson;
    await db.put('versions', {
      id: uid(), noteId: this.note.id, ts: now, title: this.note.title, pages: JSON.parse(pagesJson),
      recordings: clone(this.doc.recordings), paper: this.note.paper, pageSize: this.note.pageSize, thumb: this.note.thumb,
    });
    const vs = (await db.byIndex('versions', 'noteId', this.note.id)).sort((a, b) => b.ts - a.ts);
    const cutoff = now - VERSION_KEEP_DAYS * 864e5;
    for (const [i, v] of vs.entries()) if (i >= 60 || v.ts < cutoff) await db.del('versions', v.id);
    this.side.refreshIf('history');
  }

  // A collaborator's changes arrived (shared subject). Show them without touching undo history,
  // keeping the scroll position and anything being drawn right now.
  applyRemote(content, note) {
    if (!this.doc || (note && note.id !== this.note.id)) return;
    if (this.gesture) { this.pendingRemote = { content, note, base: idsOf(this.doc) }; return; }   // finish the stroke first
    const top = this.scroller.scrollTop, left = this.scroller.scrollLeft, z = this.z, fitMode = this.fitMode;
    this.clearSel && this.clearSel();
    this.doc.pages = content.pages;
    this.doc.recordings = content.recordings || [];
    if (note) { this.note.title = note.title; this.note.paper = note.paper || this.note.paper; this.note.updated = note.updated; if (document.activeElement !== this.titleEl) this.titleEl.value = note.title; }
    this.buildPages();
    if (fitMode) this.fit(); else this.setZoom(z);
    this.scroller.scrollTop = top; this.scroller.scrollLeft = left;
    this.updateUndo && this.updateUndo();
  }

  async restoreVersion(v) {
    await this.snapshot(true);
    this.pushUndo();
    this.doc.pages = clone(v.pages);
    if (v.recordings) this.doc.recordings = clone(v.recordings);
    if (v.paper) this.note.paper = v.paper;
    this.clearSel();
    this.buildPages();
    requestAnimationFrame(() => this.fit());
    this.changed();
    toast('Version restored');
  }

  // ---------------------------------------------------------------- YouTube notes
  async addVideo() {
    const url = await promptText('Add a YouTube video', '', { placeholder: 'https://www.youtube.com/watch?v=…', okLabel: 'Add' });
    if (!url) return;
    const m = url.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/);
    if (!m) { toast('That does not look like a YouTube link'); return; }
    this.doc.video = { yt: m[1], url };
    this.changed();
    this.setupVideo();
    toast('Video added. Notes you write while it plays are linked to that moment.', 5000);
  }

  async setupVideo() {
    const vb = this.videoBar;
    vb.hidden = false;
    vb.textContent = '';
    const holder = h('div', { class: 'yt' }), mount = h('div');
    holder.append(mount);
    const link = h('button', { class: 'btn small', type: 'button' }, 'Tap notes to jump: off');
    const remove = h('button', { class: 'btn small', type: 'button' }, 'Remove video');
    vb.append(holder, h('div', { class: 'vb-actions' }, link, remove));
    link.onclick = () => {
      this.ytLink = !this.ytLink;
      link.textContent = `Tap notes to jump: ${this.ytLink ? 'on' : 'off'}`;
      this.root.classList.toggle('replaying', this.ytLink || !!this.replay);
      this.banner.hidden = !(this.ytLink || this.replay);
    };
    remove.onclick = async () => {
      if (!(await confirmDlg('Remove the video from this note? Your notes stay.', { okLabel: 'Remove' }))) return;
      delete this.doc.video;
      this.yt = null;
      this.ytLink = false;
      vb.hidden = true;
      vb.textContent = '';
      this.root.classList.toggle('replaying', !!this.replay);
      this.changed();
    };
    try {
      if (!(window.YT && window.YT.Player)) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://www.youtube.com/iframe_api';
          s.onerror = () => rej(new Error('offline'));
          document.head.append(s);
          const t0 = Date.now();
          const poll = setInterval(() => {
            if (window.YT && window.YT.Player) { clearInterval(poll); res(); }
            else if (Date.now() - t0 > 15000) { clearInterval(poll); rej(new Error('timeout')); }
          }, 100);
        });
      }
      const yt = (this.yt = { ready: false });
      yt.player = new window.YT.Player(mount, {
        videoId: this.doc.video.yt, host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, playsinline: 1 },
        events: { onReady: () => { yt.ready = true; } },
      });
    } catch {
      holder.textContent = '';
      holder.append(h('p', { class: 'audio-empty', style: { color: '#fff', padding: '16px' } }, 'The video could not load. YouTube videos need an internet connection.'));
    }
  }

  videoTap(v, pt) {
    const objs = v.page.objs;
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (o.vt == null) continue;
      const hit = o.type === 'stroke'
        ? hitStroke(o.pts, pt.x, pt.y, o.size / 2 + 10 / this.z)
        : (() => { const b = this.objBox(v, o); return pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h; })();
      if (!hit || !this.yt || !this.yt.ready) continue;
      this.yt.player.seekTo(Math.max(0, o.vt / 1000 - 2), true);
      this.yt.player.playVideo();
      return;
    }
    toast('That part of the note was not written while the video played');
  }


  // ---------------------------------------------------------------- keyboard
  onKey(e) {
    const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"]');
    const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
    if (mod && k === 'z' && !typing) { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); this.redo(); return; }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); this.zoomBy(1.2); return; }
    if (mod && k === '-') { e.preventDefault(); this.zoomBy(1 / 1.2); return; }
    if (mod && k === '0') { e.preventDefault(); this.fit(); return; }
    if (typing) { if (k === 'escape') e.target.blur(); return; }
    if (this.sel) {
      if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.deleteSel(); return; }
      if (mod && k === 'c') { e.preventDefault(); this.copySel(); return; }
      if (mod && k === 'x') { e.preventDefault(); this.copySel(); this.deleteSel(); return; }
      if (mod && k === 'd') { e.preventDefault(); this.duplicateSel(); return; }
      if (k === 'escape') { this.clearSel(); return; }
    }
    if (!mod && !e.altKey) {
      const map = { p: 'pen', h: 'highlighter', e: 'eraser', l: 'lasso', t: 'text' };
      if (map[k]) this.setTool(map[k]);
    }
  }

  async onPaste(e) {
    const t = e.target;
    if (t.closest && t.closest('input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"]')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); for (const f of files) await this.insertImageFile(f); return; }
    if (this.app.clipboard) { e.preventDefault(); this.paste(); }
  }
}
