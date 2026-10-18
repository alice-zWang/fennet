// Library (subjects, dividers, search) + workspace routing.
import { $, h, uid, prefs, toast, fmtDate, fmtTime, pickFiles, shareOrDownload, safeName, APP_NAME, debounce, DEMO } from './util.js';
import { icon, hydrateIcons } from './icons.js';
import { db, putBlob, persist } from './db.js';
import { blankPage, pdfToPages, PAGE_SIZES, PAPER_TYPES, PAPER_COLORS } from './render.js';
import { menu, modal, promptText, confirmDlg } from './ui.js';
import { Editor } from './editor.js';
import { makeThumb, THUMB_VERSION, exportPDF, exportNoteFile, importNoteData, exportLibrary, importLibrary, blobIdsOf, exportWebPage, isBackupFile } from './export.js';
import { templateGallery } from './gallery.js';
import { scanDocuments } from './scanner.js';
import { fileToPages, imagesToPages, isDoc, DOC_ACCEPT } from './importers.js';
import { CLAUDE_MODELS, deviceModelAPI } from './ai.js';
import { applyTheme, ACCENT_PRESETS, DEFAULT_ACCENT } from './theme.js';
import { initSecurity, securitySettings, whenUnlocked } from './security.js';
import { paintCover, coverPicker } from './covers.js';
import { showIntro } from './intro.js';
import { setupDemo, openDemoView } from './demo.js';
import { mascot, setMood, applyMascotSetting } from './mascot.js';
import { initCollab, collabSettings, shareSubject, joinSubject, stopSharing, spaces, noteSaved } from './collab.js';
import { pickColor } from './colorpicker.js';
import { syncSupported, chooseSyncFolder, syncFolder, forgetSyncFolder, syncNow, removeFromSync } from './sync.js';

const RECENT_MS = 7 * 864e5;
// "Edited today / yesterday / Mon / Oct 3" for library cards
const edited = (ts) => {
  const d = new Date(ts), now = new Date(), day = 864e5;
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ts >= startToday) return 'Edited today, ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (ts >= startToday - day) return 'Edited yesterday';
  if (ts >= startToday - 6 * day) return 'Edited ' + d.toLocaleDateString([], { weekday: 'long' });
  return 'Edited ' + d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
};
// "OCT 16 · 14:20", the library's compact date stamp
const stamp = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase() + ' · ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

const SUBJECT_COLORS = ['#e8590c', '#f08c00', '#2f9e44', '#0c8599', '#1971c2', '#5f3dc4', '#c2255c', '#868e96'];
const TRASH_DAYS = 30;

class App {
  constructor() {
    this.panes = [];
    this.active = null;
    this.clipboard = null;
    this.filter = prefs.get('filter', { kind: 'all' });
    this.sort = prefs.get('sort', 'updated');
    this.query = '';
    this.quickFilter = 'all';
    this.collapsed = new Set(prefs.get('collapsed', []));
    this.routing = Promise.resolve();
  }

  async init() {
    await setupDemo(this);
    this.applyTheme();
    document.title = APP_NAME;
    for (const el of document.querySelectorAll('.app-name')) el.textContent = APP_NAME;
    hydrateIcons(document);
    this.applyInputMode();
    applyMascotSetting();
    document.body.classList.toggle('reduce-card-motion', prefs.get('reduceCardMotion', false));
    $('#lib-mascot').append(mascot('lib'));
    paintCover();
    const splashGone = hideSplash();
    await initSecurity();
    await this.load();
    await this.purgeTrash();
    this.bindLibrary();
    // the welcome tour: once, after the splash and any lock screen (demo links show it only with &intro)
    const wantIntro = DEMO ? new URLSearchParams(location.search).has('intro') : !prefs.get('introSeen', false);
    if (wantIntro) splashGone.then(whenUnlocked).then(() => showIntro(this));
    addEventListener('hashchange', () => this.route());
    addEventListener('keydown', (e) => this.active && !$('#workspace').hidden && this.active.onKey(e));
    addEventListener('paste', (e) => this.active && !$('#workspace').hidden && this.active.onPaste(e));
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvt = e; });
    addEventListener('pagehide', () => this.panes.forEach((p) => p.dirty && p.saveNow()));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.panes.forEach((p) => p.dirty && p.saveNow());
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault()); // iOS page zoom
    // Apple Pencil double-tap (iPad app): switch between the current tool and the eraser, like Notability.
    window.openpagePencilDoubleTap = () => {
      const ed = this.active;
      if (!ed || $('#workspace').hidden) return;
      if (ed.tool === 'eraser') ed.setTool(ed.prevTool || 'pen'); else { ed.prevTool = ed.tool; ed.setTool('eraser'); }
    };
    if ('serviceWorker' in navigator && location.protocol !== 'file:' && !document.documentElement.classList.contains('demo')) navigator.serviceWorker.register('sw.js').catch(() => {});
    persist();
    this.syncSoon = debounce(() => this.runSync(false), 4000);
    this.initSync();
    initCollab(this);
    await this.route();
    openDemoView(this);
  }

  async load() {
    [this.notes, this.subjects, this.dividers] = await Promise.all([db.all('notes'), db.all('subjects'), db.all('dividers')]);
  }

  // ---------------------------------------------------------------- settings helpers
  applyTheme() { applyTheme(); }

  // Settings row: preset accent colors plus "Custom…" (full RGB / HEX picker)
  accentPicker() {
    const row = h('div', { class: 'accent-row', role: 'radiogroup', 'aria-label': 'Accent color' });
    const draw = () => {
      row.textContent = '';
      const cur = prefs.get('accent', DEFAULT_ACCENT).toLowerCase();
      const set = (c) => { prefs.set('accent', c); this.applyTheme(); draw(); };
      for (const [c, name] of ACCENT_PRESETS) {
        const b = h('button', { type: 'button', class: 'accent-swatch' + (c === cur ? ' on' : ''), role: 'radio', 'aria-checked': String(c === cur), 'aria-label': name, title: name, style: { background: c } });
        b.onclick = () => set(c);
        row.append(b);
      }
      const custom = !ACCENT_PRESETS.some(([c]) => c === cur);
      const more = h('button', { type: 'button', class: 'accent-swatch custom' + (custom ? ' on' : ''), role: 'radio', 'aria-checked': String(custom), 'aria-label': 'Custom color', title: 'Custom color', style: custom ? { background: cur } : {} });
      more.onclick = async () => {
        const c = await pickColor(more, cur, { title: 'Accent color', onChange: (v) => { prefs.set('accent', v); applyTheme(); } });
        set(c || cur);
      };
      row.append(more);
      if (cur !== DEFAULT_ACCENT) {
        const reset = h('button', { type: 'button', class: 'btn ghost small' }, 'Reset');
        reset.onclick = () => set(DEFAULT_ACCENT);
        row.append(reset);
      }
    };
    draw();
    return row;
  }
  stylusOnly() {
    const m = prefs.get('inputMode', 'auto');
    return m === 'stylus' || (m === 'auto' && prefs.get('penSeen', false));
  }
  applyInputMode() { document.body.classList.toggle('stylus-only', this.stylusOnly()); }
  sawPen() {
    if (prefs.get('penSeen', false)) return;
    prefs.set('penSeen', true);
    this.applyInputMode();
    if (prefs.get('inputMode', 'auto') === 'auto') toast('Stylus detected: your stylus writes, fingers scroll and zoom. Change this in Settings.', 5000);
  }

  // ---------------------------------------------------------------- routing
  route() {
    this.routing = this.routing.then(() => this._route()).catch((e) => console.error(e));
    return this.routing;
  }
  async _route() {
    const m = location.hash.match(/^#\/note\/([^/]+)(?:\/([^/]+))?/);
    if (m) await this.showWorkspace([m[1], m[2]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i));
    else await this.showLibrary();
  }
  openNote(id) { location.hash = `#/note/${id}`; }
  goLibrary() { location.hash = '#/'; }

  async showWorkspace(ids) {
    const ws = $('#workspace');
    for (const p of [...this.panes]) {
      if (!ids.includes(p.note && p.note.id)) { await p.close(); this.panes = this.panes.filter((x) => x !== p); }
    }
    const ordered = [];
    for (const id of ids) {
      let p = this.panes.find((x) => x.note && x.note.id === id);
      if (!p) {
        p = new Editor(this, ws);
        if (!(await p.open(id))) {
          p.root.remove();
          toast('That note no longer exists');
          if (!this.panes.length) { history.replaceState(null, '', '#/'); await this.showLibrary(); return; }
          continue;
        }
      }
      ordered.push(p);
    }
    this.panes = ordered;
    for (const p of ordered) ws.append(p.root);
    const want = this.pendingPanel;
    this.pendingPanel = null;
    const target = want && ordered.find((p) => p.note.id === want.id);
    if (target) target.side.open(want.tab);
    ws.classList.toggle('split', ordered.length > 1);
    for (const p of ordered) {
    }
    this.setActive(this.panes.includes(this.active) ? this.active : ordered[ordered.length - 1]);
    $('#library').hidden = true;
    ws.hidden = false;
    document.body.classList.remove('nav-open');
    requestAnimationFrame(() => ordered.forEach((p) => { if (p.fitMode) p.fit(); p.resume(); }));
  }

  async showLibrary() {
    for (const p of this.panes) await p.close();
    this.panes = [];
    this.active = null;
    $('#workspace').hidden = true;
    $('#workspace').classList.remove('split');
    $('#library').hidden = false;
    await this.load();
    this.render();
  }

  setActive(ed) {
    if (this.active === ed) return;
    this.active = ed;
    for (const p of this.panes) p.root.classList.toggle('active', p === ed);
  }

  async pickSplit(ed) {
    const open = new Set(this.panes.map((p) => p.note.id));
    const id = await this.pickNote('Open side by side', (n) => !open.has(n.id));
    if (id) location.hash = `#/note/${ed.note.id}/${id}`;
  }
  closePane(ed) {
    const rest = this.panes.filter((p) => p !== ed).map((p) => p.note.id);
    location.hash = rest.length ? `#/note/${rest.join('/')}` : '#/';
  }

  pickNote(title, filterFn) {
    const notes = this.notes.filter((n) => !n.deleted && filterFn(n)).sort((a, b) => b.updated - a.updated);
    let picked = null;
    return modal({
      title,
      body: (b) => {
        if (!notes.length) { b.append(h('p', {}, 'No other notes yet. Create one first.')); return; }
        const search = h('input', { type: 'search', placeholder: 'Filter notes' });
        const list = h('div', { class: 'pick-list' });
        const draw = () => {
          list.textContent = '';
          const q = search.value.toLowerCase();
          for (const n of notes.filter((x) => x.title.toLowerCase().includes(q))) {
            const btn = h('button', { type: 'button' }, h('img', { src: n.thumb || '', alt: '' }), h('span', {}, n.title));
            btn.onclick = () => { picked = n.id; b.closest('dialog').close(); };
            list.append(btn);
          }
        };
        search.oninput = draw;
        draw();
        b.append(search, list);
      },
      actions: [{ label: 'Cancel', value: null }],
    }).then(() => picked);
  }

  noteChanged(n, { fromSync = false } = {}) {
    const i = this.notes.findIndex((x) => x.id === n.id);
    if (i >= 0) this.notes[i] = n; else this.notes.push(n);
    if (this.syncOn) this.syncSoon();
    if (!fromSync && this.sharedSubjects && this.sharedSubjects.has(n.subjectId)) { noteSaved(n); this.collabSoon && this.collabSoon(); }
  }

  // ---------------------------------------------------------------- folder sync
  async initSync() {
    const btn = $('#btn-sync');
    if (!syncSupported() || !(await syncFolder())) { btn.hidden = true; this.syncOn = false; return; }
    this.syncOn = true;
    btn.hidden = false;
    btn.onclick = () => this.runSync(true);
    this.runSync(false);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.syncOn) this.runSync(false); });
  }

  async runSync(ask) {
    const btn = $('#btn-sync');
    btn.classList.add('syncing');
    try {
      const r = await syncNow(ask);
      if (!r) {
        btn.title = 'Sync paused: click to allow access to your sync folder';
        if (ask) toast('Sync needs permission to use the folder');
        return;
      }
      btn.title = 'Synced ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ' (click to sync now)';
      if (r.pulled) {
        await this.load();
        if (!$('#library').hidden) this.render();
        toast(`Synced: ${r.pulled} note${r.pulled > 1 ? 's' : ''} updated from your sync folder`);
      } else if (ask) toast('Everything is in sync');
    } catch (e) {
      console.warn(e);
      if (ask) toast('Sync failed: ' + e.message, 5000);
    } finally { btn.classList.remove('syncing'); }
  }

  async versionAsCopy(v) {
    const pages = JSON.parse(JSON.stringify(v.pages));
    for (const p of pages) { p.id = uid(); for (const o of p.objs) o.id = uid(); }
    const n = await this.newNote({ title: `${v.title} (${new Date(v.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`, pages, paper: v.paper, pageSize: v.pageSize });
    const c = await db.get('content', n.id);
    c.recordings = JSON.parse(JSON.stringify(v.recordings || []));
    await db.put('content', c);
    toast('Opened a copy of that version');
    this.openNote(n.id);
  }

  newMenu(anchor) {
    menu(anchor, [
      { label: 'New note', icon: 'edit', action: () => { setMood('excited', 1600); this.newNote().then((n) => this.openNote(n.id)); } },
      { label: 'New note from template…', icon: 'template', action: async () => {
        const r = await templateGallery({ title: 'New note', paper: prefs.get('defaultPaper', { type: 'lined', color: 'white' }), size: prefs.get('pageSize', 'letter'), okLabel: 'Create note' });
        if (r) this.newNote({ paper: r.paper, pageSize: r.size }).then((n) => this.openNote(n.id));
      } },
      'sep',
      { label: 'Scan documents', icon: 'scan', action: async () => {
        const blobs = await scanDocuments();
        if (!blobs.length) return;
        const pages = await imagesToPages(blobs, prefs.get('pageSize', 'letter'), 0);
        const n = await this.newNote({ title: 'Scan ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric' }), pages });
        this.openNote(n.id);
      } },
      { label: 'Import PDF, Word, slides, images…', icon: 'file', action: () => this.importFiles() },
      { label: 'YouTube video note', icon: 'video', action: async () => {
        const n = await this.newNote({ title: 'Video notes' });
        this.openNote(n.id);
        setTimeout(() => this.active && this.active.addVideo(), 600);
      } },
      'sep',
      { label: 'Join shared subject…', icon: 'link', action: () => joinSubject(this) },
    ]);
  }

  // ---------------------------------------------------------------- library UI
  bindLibrary() {
    $('#btn-cover').onclick = () => coverPicker();
    $('#btn-new').onclick = (e) => this.newMenu(e.currentTarget);
    $('#btn-settings').onclick = () => this.settings();
    $('#btn-new-subject').onclick = () => this.newSubject(null);
    $('#btn-new-divider').onclick = () => this.newDivider();
    $('#btn-menu').onclick = () => document.body.classList.toggle('nav-open');
    $('#scrim').onclick = () => document.body.classList.remove('nav-open');
    $('#btn-view').onclick = (e) => this.viewMenu(e.currentTarget);
    const density = $('#btn-density');
    const setDense = (big) => {
      $('#grid').classList.toggle('big', big);
      density.setAttribute('aria-pressed', String(big));
      density.setAttribute('aria-label', big ? 'Smaller cards' : 'Larger cards');
    };
    setDense(prefs.get('bigCards', false));
    density.onclick = () => { const big = !prefs.get('bigCards', false); prefs.set('bigCards', big); setDense(big); };
    addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !$('#library').hidden) {
        e.preventDefault(); document.body.classList.add('nav-open'); $('#search').focus();
      }
      if (e.key === 'Escape') document.body.classList.remove('nav-open');
    });
    $('#search').oninput = (e) => { this.query = e.target.value.trim().toLowerCase(); this.renderGrid(); };
    const main = $('#lib-main');
    main.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); main.classList.add('drop-hint'); }
    });
    main.addEventListener('dragleave', (e) => { if (!main.contains(e.relatedTarget)) main.classList.remove('drop-hint'); });
    main.addEventListener('drop', (e) => {
      main.classList.remove('drop-hint');
      if (e.dataTransfer?.files?.length) { e.preventDefault(); this.importFiles([...e.dataTransfer.files]); }
    });
  }

  viewMenu(anchor) {
    const mark = (on, label) => (on ? '✓  ' : '     ') + label;
    const sortBy = (v) => () => { this.sort = v; prefs.set('sort', v); this.renderGrid(); };
    const show = (v) => () => { this.quickFilter = v; this.renderGrid(); };
    menu(anchor, [
      { heading: 'Sort by' },
      { label: mark(this.sort === 'updated', 'Date modified'), action: sortBy('updated') },
      { label: mark(this.sort === 'created', 'Date created'), action: sortBy('created') },
      { label: mark(this.sort === 'title', 'Title A–Z'), action: sortBy('title') },
      'sep',
      { heading: 'Show' },
      { label: mark(this.quickFilter === 'all', 'All notes'), action: show('all') },
      { label: mark(this.quickFilter === 'favorites', 'Favorites'), action: show('favorites') },
      { label: mark(this.quickFilter === 'audio', 'With audio'), action: show('audio') },
    ]);
  }

  // Sidebar card: how much this device's storage the library uses (no cloud account exists).
  async renderStorage() {
    const n = this.live().length;
    $('#storage-label').textContent = `${n} ${n === 1 ? "NOTE" : "NOTES"} · ON THIS DEVICE`;
    const est = await navigator.storage?.estimate?.().catch(() => null);
    if (!est || !est.quota) return;
    const size = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1e6)) + ' MB');
    $('#storage-fill').style.width = Math.max(2, Math.min(100, (est.usage / est.quota) * 100)) + '%';
    $('#storage-detail').textContent = `${size(est.usage)} of ${size(est.quota)} used`;
  }

  render() { this.renderNav(); this.renderGrid(); this.renderStorage(); this.refreshThumbs(); }

  // Previews made by older versions were low-resolution: redo them once, a few at a time, in the background.
  refreshThumbs() {
    if (this.thumbRefresh) return;
    const old = this.notes.filter((n) => !n.deleted && (n.thumbV || 0) < THUMB_VERSION);
    if (!old.length) return;
    this.thumbRefresh = (async () => {
      for (const n of old) {
        await new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 800 }) : setTimeout(r, 60)));
        const content = await db.get('content', n.id);
        if (!content || !content.pages.length) continue;
        try {
          n.thumb = await makeThumb(content.pages[0], n.paper);
          n.thumbV = THUMB_VERSION;
          await db.put('notes', n);
          const card = [...document.querySelectorAll('#grid .card')].find((c) => c.dataset.id === n.id);
          if (card) card.querySelector('.thumb').style.backgroundImage = `url("${n.thumb}")`;
        } catch {}
      }
    })().finally(() => { this.thumbRefresh = null; });
  }

  live() { return this.notes.filter((n) => !n.deleted); }

  setFilter(f) {
    this.filter = f;
    this.quickFilter = 'all';
    prefs.set('filter', f);
    document.body.classList.remove('nav-open');
    this.render();
  }

  renderNav() {
    // which subjects are shared (looked up in the background; re-render if it changed)
    spaces().then((sp) => {
      const ids = new Set(sp.map((s) => s.subjectId));
      const changed = !this.sharedSubjects || ids.size !== this.sharedSubjects.size || [...ids].some((x) => !this.sharedSubjects.has(x));
      this.sharedSubjects = ids;
      if (changed) this.renderNav();
    }).catch(() => {});
    const nav = $('#nav');
    nav.textContent = '';
    const live = this.live();
    const subjectIds = new Set(this.subjects.map((s) => s.id));
    const f = this.filter;
    const item = (label, ic, filter, count, extra = {}) => {
      const active = f.kind === filter.kind && f.id === filter.id;
      const el = h('div', { class: 'nav-item' + (active ? ' active' : ''), role: 'button', tabindex: 0 });
      el.append(h('span', { class: 'dot' + (extra.color ? '' : ' plain'), style: extra.color ? { background: extra.color } : {} }));
      el.append(h('span', { class: 'nav-label' }, label));
      if (extra.shared) el.append(h('span', { class: 'shared-mark', title: 'Shared', 'aria-label': 'Shared', html: icon('link') }));
      el.append(h('span', { class: 'count' }, count ? String(count).padStart(2, '0') : ''));
      if (extra.more) {
        const m = h('button', { class: 'icon-btn more', title: 'Options', 'aria-label': label + ' options', html: icon('more') });
        m.onclick = (e) => { e.stopPropagation(); extra.more(m); };
        el.append(m);
      }
      el.onclick = () => this.setFilter(filter);
      el.onkeydown = (e) => { if (e.key === 'Enter') this.setFilter(filter); };
      if (extra.drop !== undefined) {
        el.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-note')) { e.preventDefault(); el.classList.add('drop'); } });
        el.addEventListener('dragleave', () => el.classList.remove('drop'));
        el.addEventListener('drop', (e) => {
          el.classList.remove('drop');
          const id = e.dataTransfer.getData('text/x-note');
          if (id) { e.preventDefault(); this.moveNote(id, extra.drop); }
        });
      }
      nav.append(el);
    };
    item('All Notes', 'notes', { kind: 'all' }, live.length);
    item('Recents', 'clock', { kind: 'recent' }, live.filter((n) => n.updated > Date.now() - RECENT_MS).length);
    item('Favorites', 'star', { kind: 'fav' }, live.filter((n) => n.favorite).length);
    item('Unfiled', 'inbox', { kind: 'unfiled' }, live.filter((n) => !subjectIds.has(n.subjectId)).length, { drop: null });

    const subjItem = (s) => item(s.name, null, { kind: 'subject', id: s.id }, live.filter((n) => n.subjectId === s.id).length, {
      color: s.color, drop: s.id, more: (btn) => this.subjectMenu(btn, s), shared: this.sharedSubjects && this.sharedSubjects.has(s.id),
    });
    const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    for (const d of [...this.dividers].sort(byName)) {
      const collapsed = this.collapsed.has(d.id);
      const head = h('div', { class: 'nav-head' + (collapsed ? ' collapsed' : ''), role: 'button', tabindex: 0, html: icon('chev', 'chev') });
      head.append(h('span', { class: 'nav-label' }, d.name));
      const more = h('button', { class: 'icon-btn more', title: 'Divider options', 'aria-label': d.name + ' options', html: icon('more') });
      more.onclick = (e) => { e.stopPropagation(); this.dividerMenu(more, d); };
      head.append(more);
      head.onclick = () => {
        collapsed ? this.collapsed.delete(d.id) : this.collapsed.add(d.id);
        prefs.set('collapsed', [...this.collapsed]);
        this.renderNav();
      };
      nav.append(head);
      if (!collapsed) this.subjects.filter((s) => s.dividerId === d.id).sort(byName).forEach(subjItem);
    }
    const loose = this.subjects.filter((s) => !this.dividers.some((d) => d.id === s.dividerId)).sort(byName);
    if (loose.length) {
      nav.append(h('div', { class: 'nav-head' }, h('span', {}, this.dividers.length ? 'Other subjects' : 'Subjects')));
      loose.forEach(subjItem);
    }
    this.newLinks ||= $('.new-links');
    nav.append(this.newLinks, h('div', { class: 'nav-sep', role: 'separator' }));
    item('Recently Deleted', 'trash', { kind: 'trash' }, this.notes.filter((n) => n.deleted).length);
  }

  filtered() {
    const f = this.filter, subjectIds = new Set(this.subjects.map((s) => s.id));
    let list = f.kind === 'trash' ? this.notes.filter((n) => n.deleted) : this.live();
    if (f.kind === 'fav') list = list.filter((n) => n.favorite);
    else if (f.kind === 'recent') list = list.filter((n) => n.updated > Date.now() - RECENT_MS);
    else if (f.kind === 'unfiled') list = list.filter((n) => !subjectIds.has(n.subjectId));
    else if (f.kind === 'subject') list = list.filter((n) => n.subjectId === f.id);
    if (this.quickFilter === 'favorites') list = list.filter((n) => n.favorite);
    if (this.quickFilter === 'audio') list = list.filter((n) => n.hasAudio);
    if (this.query) {
      const terms = this.query.split(/\s+/);
      list = list.filter((n) => {
        const hay = (n.title + '\n' + (n.searchText || '')).toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const s = this.sort;
    list.sort((a, b) => (s === 'title' ? a.title.localeCompare(b.title, undefined, { numeric: true }) : (b[s] || 0) - (a[s] || 0)));
    return list;
  }

  filterTitle() {
    const f = this.filter;
    if (f.kind === 'subject') {
      const s = this.subjects.find((x) => x.id === f.id);
      if (s) return s.name;
      this.filter = { kind: 'all' };
    }
    return { all: 'All Notes', recent: 'Recents', fav: 'Favorites', unfiled: 'Unfiled', trash: 'Recently Deleted' }[this.filter.kind] || 'All Notes';
  }

  renderGrid() {
    const grid = $('#grid'), empty = $('#empty');
    const title = this.filterTitle();
    $('#lib-title').textContent = title;
    $('#lib-crumb').textContent = `LIBRARY / ${title.toUpperCase()}`;
    const list = this.filtered();
    $('#note-count').textContent = `${list.length} ${list.length === 1 ? 'note' : 'notes'}`;
    const viewBtn = $('#btn-view');
    viewBtn.querySelector('.head-dot').hidden = this.quickFilter === 'all';
    viewBtn.setAttribute('aria-label', this.quickFilter === 'all' ? 'Sort and filter' : `Sort and filter (showing ${this.quickFilter === 'audio' ? 'notes with audio' : 'favorites'})`);
    const recent = [...this.live()].sort((a, b) => b.updated - a.updated)[0];
    const recentSubj = recent && this.subjects.find((x) => x.id === recent.subjectId);
    $('#continue-card').hidden = this.filter.kind !== 'all' || !!this.query || this.quickFilter !== 'all';
    $('#continue-label').textContent = recent ? '▸ CONTINUE WHERE YOU LEFT OFF' : 'A LITTLE SPACE FOR BIG IDEAS';
    $('#continue-title').textContent = recent ? recent.title : 'Make room for your next idea.';
    $('#continue-detail').textContent = recent ? `${recentSubj ? recentSubj.name + ' · ' : ''}Last edited ${fmtDate(recent.updated)}` : 'Handwrite, annotate, and bring your thinking together.';
    $('#continue-btn-label').textContent = recent ? `Resume · p.${(recent.lastPage || 0) + 1}` : 'Create your first note';
    $('#btn-continue').onclick = () => recent ? this.openNote(recent.id) : this.newNote().then((n) => this.openNote(n.id));
    const audioBtn = $('#btn-continue-audio');
    audioBtn.hidden = !(recent && recent.hasAudio);
    if (recent && recent.hasAudio) {
      $('#continue-audio-label').textContent = recent.audioMs ? `${fmtTime(recent.audioMs)} AUDIO` : 'AUDIO';
      audioBtn.setAttribute('aria-label', `Open ${recent.title} and its audio`);
      audioBtn.onclick = () => { this.pendingPanel = { id: recent.id, tab: 'audio' }; this.openNote(recent.id); };
    }
    grid.textContent = '';
    const trash = this.filter.kind === 'trash';
    empty.hidden = list.length > 0;
    grid.hidden = !list.length;
    if (!list.length) {
      empty.textContent = '';
      empty.append(h('div', { class: 'empty-icon', html: icon(this.query ? 'search' : trash ? 'trash' : 'pen') }));
      if (this.query) empty.append(h('h2', {}, 'No matches'), h('p', {}, 'Search looks through titles, typed text, PDF text and transcripts.'));
      else if (this.quickFilter !== 'all') empty.append(h('h2', {}, this.quickFilter === 'audio' ? 'No audio notes here' : 'No favorites here'), h('p', {}, this.quickFilter === 'audio' ? 'Record audio in a note to see it here.' : 'Star a note from its options menu to find it here.'));
      else if (trash) empty.append(h('h2', {}, 'Nothing here'), h('p', {}, `Deleted notes stay here for ${TRASH_DAYS} days, then are removed.`));
      else {
        empty.append(h('h2', {}, 'No notes yet'), h('p', {}, 'Create a note to start writing, or import a PDF to annotate. You can also drag files here.'));
        const b = h('button', { class: 'btn primary' }, '+ New Note');
        b.onclick = () => this.newNote().then((n) => this.openNote(n.id));
        empty.append(b);
      }
      return;
    }
    const subj = new Map(this.subjects.map((s) => [s.id, s]));
    for (const n of list) {
      const s = subj.get(n.subjectId);
      const thumb = h('div', { class: 'thumb' });
      if (n.thumb) thumb.style.backgroundImage = `url("${n.thumb}")`;
      const pages = n.pageCount || 1;
      thumb.append(h('span', { class: 'page-badge' }, `${pages} ${pages === 1 ? 'page' : 'pages'}`));
      if (n.favorite) thumb.append(h('span', { class: 'fav', html: icon('star') }));
      if (n.hasAudio) { const r = h('span', { class: 'rec', html: icon('mic') }); r.append('AUDIO'); thumb.append(r); }
      const more = h('button', { class: 'icon-btn small', title: 'Note options', 'aria-label': n.title + ' options', html: icon('more') });
      const sub = h('div', { class: 'sub', title: s ? s.name : 'Unfiled' });
      sub.append(h('span', { class: 'dot' + (s ? '' : ' plain'), style: s ? { background: s.color } : {} }));
      sub.append(h('span', { class: 'sub-text' }, (s ? s.name + ' · ' : '') + (trash ? 'Deleted ' + stamp(n.deleted).toLowerCase() : edited(n.updated))));
      const card = h('div', { class: 'card', 'data-id': n.id, tabindex: 0, draggable: trash ? 'false' : 'true', role: 'button', 'aria-label': `${n.title}, ${s ? s.name + ', ' : ''}${pages} ${pages === 1 ? 'page' : 'pages'}` },
        thumb, h('div', { class: 'meta' }, h('div', { class: 'txt' }, h('div', { class: 'title' }, n.title), sub), more));
      card.onclick = (e) => {
        if (more.contains(e.target)) return;
        trash ? this.noteMenu(card, n) : this.openNote(n.id);
      };
      card.onkeydown = (e) => { if (e.key === 'Enter') card.click(); };
      more.onclick = (e) => { e.stopPropagation(); this.noteMenu(more, n); };
      card.oncontextmenu = (e) => { e.preventDefault(); this.noteMenu(null, n, e.clientX, e.clientY); };
      card.ondragstart = (e) => { e.dataTransfer.setData('text/x-note', n.id); e.dataTransfer.effectAllowed = 'move'; };
      grid.append(card);
    }
  }

  // ---------------------------------------------------------------- notes
  async newNote({ title, pages, pdfText, subjectId, paper, pageSize } = {}) {
    const now = Date.now();
    const size = pageSize || prefs.get('pageSize', 'letter');
    const note = {
      id: uid(),
      title: title || 'Note ' + new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }),
      subjectId: subjectId !== undefined ? subjectId : this.filter.kind === 'subject' ? this.filter.id : null,
      created: now, updated: now, favorite: false, deleted: null,
      paper: { ...(paper || prefs.get('defaultPaper', { type: 'lined', color: 'white' })) },
      pageSize: size, thumb: null, searchText: (pdfText || '').slice(0, 80000),
    };
    const content = { id: note.id, pages: pages || [blankPage(size)], recordings: [], pdfText: pdfText || '' };
    note.thumb = await makeThumb(content.pages[0], note.paper).catch(() => null);
    note.thumbV = THUMB_VERSION;
    await db.put('content', content);
    await db.put('notes', note);
    this.notes.push(note);
    return note;
  }

  async saveMeta(n) {
    await db.put('notes', n);
    this.noteChanged(n);
    this.render();
  }

  noteMenu(anchor, n, x, y) {
    if (n.deleted) {
      menu(anchor, [
        { label: 'Restore', icon: 'restore', action: () => { n.deleted = null; this.saveMeta(n); toast('Restored'); } },
        { label: 'Delete forever', icon: 'trash', danger: true, action: async () => {
          if (await confirmDlg(`Permanently delete "${n.title}"? This cannot be undone.`, { okLabel: 'Delete forever' })) {
            await this.destroyNotes([n.id]); this.render();
          }
        } },
      ], { x, y });
      return;
    }
    menu(anchor, [
      { label: 'Open', icon: 'notes', action: () => this.openNote(n.id) },
      { label: 'Rename', icon: 'edit', action: async () => { const t = await promptText('Rename note', n.title); if (t) { n.title = t; n.updated = Date.now(); this.saveMeta(n); } } },
      { label: 'Move to…', icon: 'folder', action: () => this.moveDialog(n) },
      { label: n.favorite ? 'Remove from Favorites' : 'Add to Favorites', icon: 'star', action: () => { n.favorite = !n.favorite; this.saveMeta(n); } },
      { label: 'Duplicate', icon: 'dup', action: () => this.duplicate(n) },
      'sep',
      { label: 'Export as PDF', icon: 'file', action: async () => {
        toast('Creating PDF…', 20000);
        try {
          const c = await db.get('content', n.id);
          const b = await exportPDF(n, c, (i, t) => toast(`Creating PDF… page ${i} of ${t}`, 20000));
          toast('PDF ready');
          await shareOrDownload(b, safeName(n.title) + '.pdf');
        } catch (e) { toast('PDF export failed: ' + e.message, 5000); }
      } },
      { label: 'Share as web page', icon: 'link', action: async () => {
        toast('Building web page…', 20000);
        const b = await exportWebPage(n, await db.get('content', n.id));
        toast('Web page ready');
        await shareOrDownload(b, safeName(n.title) + '.html');
      } },
      { label: 'Export note file (.opage)', icon: 'download', action: async () => {
        const b = await exportNoteFile(n, await db.get('content', n.id));
        await shareOrDownload(b, safeName(n.title) + '.opage');
      } },
      'sep',
      { label: 'Delete', icon: 'trash', danger: true, action: () => { n.deleted = Date.now(); this.saveMeta(n); toast(`Moved to Recently Deleted`); } },
    ], { x, y });
  }

  async moveDialog(n) {
    let choice;
    const res = await modal({
      title: `Move "${n.title}"`,
      body: (b) => {
        const list = h('div', { class: 'pick-list' });
        const opts = [{ id: null, name: 'Unfiled', color: null }, ...this.subjects];
        for (const s of opts) {
          const btn = h('button', { type: 'button' });
          if (s.color) btn.append(h('span', { class: 'dot', style: { background: s.color, width: '14px', height: '14px', borderRadius: '4px', display: 'inline-block' } }));
          else btn.insertAdjacentHTML('beforeend', icon('inbox'));
          btn.append(h('span', {}, s.name + (n.subjectId === s.id ? '  (current)' : '')));
          btn.onclick = () => { choice = s.id; b.closest('dialog').close(); };
          list.append(btn);
        }
        if (!this.subjects.length) b.append(h('p', { class: 'legal' }, 'Tip: create subjects with "+ Subject" in the sidebar.'));
        b.append(list);
      },
      actions: [{ label: 'Cancel', value: null }],
    });
    void res;
    if (choice !== undefined) this.moveNote(n.id, choice);
  }

  async moveNote(id, subjectId) {
    const n = this.notes.find((x) => x.id === id);
    if (!n || n.subjectId === subjectId) return;
    n.subjectId = subjectId;
    await this.saveMeta(n);
    const s = this.subjects.find((x) => x.id === subjectId);
    toast(`Moved to ${s ? s.name : 'Unfiled'}`);
  }

  async duplicate(n) {
    const c = JSON.parse(JSON.stringify(await db.get('content', n.id)));
    for (const p of c.pages) { p.id = uid(); for (const o of p.objs) o.id = uid(); }
    const copy = { ...n, id: uid(), title: n.title + ' copy', created: Date.now(), updated: Date.now(), favorite: false };
    c.id = copy.id;
    await db.put('content', c);
    await db.put('notes', copy);
    this.notes.push(copy);
    this.render();
    toast('Duplicated');
  }

  async destroyNotes(ids) {
    for (const id of ids) {
      await db.del('notes', id);
      await db.del('content', id);
      for (const v of await db.byIndex('versions', 'noteId', id)) await db.del('versions', v.id);
      if (this.syncOn) removeFromSync(id);
    }
    this.notes = this.notes.filter((n) => !ids.includes(n.id));
    await this.gcBlobs();
  }

  // Remove files (PDFs, images, audio) no note refers to anymore.
  async gcBlobs() {
    const used = new Set();
    for (const n of await db.all('notes')) {
      const c = await db.get('content', n.id);
      if (c) for (const b of blobIdsOf(c)) used.add(b);
    }
    for (const v of await db.all('versions')) for (const b of blobIdsOf(v)) used.add(b);
    for (const n of await db.all('notes')) if (n.paper && n.paper.blob) used.add(n.paper.blob);
    for (const k of await db.keys('blobs')) if (!used.has(k)) await db.del('blobs', k);
  }

  async purgeTrash() {
    const cutoff = Date.now() - TRASH_DAYS * 864e5;
    const old = this.notes.filter((n) => n.deleted && n.deleted < cutoff).map((n) => n.id);
    if (old.length) await this.destroyNotes(old);
  }

  // ---------------------------------------------------------------- subjects & dividers
  async newSubject(dividerId) {
    const name = await promptText('New subject', '', { placeholder: 'e.g. Biology 101', okLabel: 'Create' });
    if (!name) return;
    const s = { id: uid(), name, color: SUBJECT_COLORS[this.subjects.length % SUBJECT_COLORS.length], dividerId, created: Date.now() };
    await db.put('subjects', s);
    this.subjects.push(s);
    this.setFilter({ kind: 'subject', id: s.id });
  }
  async newDivider() {
    const name = await promptText('New divider', '', { placeholder: 'e.g. Fall Semester', okLabel: 'Create' });
    if (!name) return;
    const d = { id: uid(), name, created: Date.now() };
    await db.put('dividers', d);
    this.dividers.push(d);
    this.renderNav();
    toast('Divider created. Use a subject\'s ⋯ menu to move it into the divider.', 4000);
  }
  subjectMenu(btn, s) {
    menu(btn, [
      { label: 'Rename', icon: 'edit', action: async () => { const n = await promptText('Rename subject', s.name); if (n) { s.name = n; await db.put('subjects', s); this.render(); } } },
      { label: 'Change color', icon: 'paper', action: () => this.colorDialog(s) },
      this.dividers.length && { label: 'Move to divider…', icon: 'folder', action: () => this.subjectDividerMenu(btn, s) },
      this.sharedSubjects && this.sharedSubjects.has(s.id)
        ? { label: 'Stop sharing on this device', icon: 'link', action: () => stopSharing(this, s.id) }
        : { label: 'Share subject…', icon: 'link', action: () => shareSubject(this, s) },
      'sep',
      { label: 'Delete subject', icon: 'trash', danger: true, action: async () => {
        if (!(await confirmDlg(`Delete subject "${s.name}"? Its notes are kept and move to Unfiled.`))) return;
        for (const n of this.notes.filter((x) => x.subjectId === s.id)) { n.subjectId = null; await db.put('notes', n); }
        await db.del('subjects', s.id);
        this.subjects = this.subjects.filter((x) => x !== s);
        if (this.filter.id === s.id) this.filter = { kind: 'all' };
        this.render();
      } },
    ]);
  }
  subjectDividerMenu(btn, s) {
    menu(btn, [
      { heading: 'Move to divider' },
      ...this.dividers.map((d) => ({ label: d.name + (s.dividerId === d.id ? ' ✓' : ''), icon: 'folder', action: async () => { s.dividerId = d.id; await db.put('subjects', s); this.renderNav(); } })),
      { label: 'No divider', action: async () => { s.dividerId = null; await db.put('subjects', s); this.renderNav(); } },
    ]);
  }
  async colorDialog(s) {
    let pick = s.color;
    const ok = await modal({
      title: 'Subject color',
      body: (b) => {
        const row = h('div', { class: 'color-row' });
        const draw = () => {
          row.textContent = '';
          for (const c of SUBJECT_COLORS) {
            const sw = h('button', { type: 'button', class: 'swatch' + (pick === c ? ' on' : ''), style: { background: c }, 'aria-label': c });
            sw.onclick = () => { pick = c; draw(); };
            row.append(sw);
          }
        };
        draw();
        b.append(row);
      },
      actions: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }],
    });
    if (ok) { s.color = pick; await db.put('subjects', s); this.render(); }
  }
  dividerMenu(btn, d) {
    menu(btn, [
      { label: 'New subject here', icon: 'plus', action: () => this.newSubject(d.id) },
      { label: 'Rename', icon: 'edit', action: async () => { const n = await promptText('Rename divider', d.name); if (n) { d.name = n; await db.put('dividers', d); this.renderNav(); } } },
      { label: 'Delete divider', icon: 'trash', danger: true, action: async () => {
        if (!(await confirmDlg(`Delete divider "${d.name}"? Its subjects and notes are kept.`))) return;
        for (const s of this.subjects.filter((x) => x.dividerId === d.id)) { s.dividerId = null; await db.put('subjects', s); }
        await db.del('dividers', d.id);
        this.dividers = this.dividers.filter((x) => x !== d);
        this.renderNav();
      } },
    ]);
  }

  // ---------------------------------------------------------------- import
  async importFiles(files) {
    files ||= await pickFiles('application/pdf,.pdf,image/*,.opage,.fnote,.json,' + DOC_ACCEPT, { multiple: true });
    let last = null, count = 0;
    const subjectIds = new Set(this.subjects.map((s) => s.id));
    for (const f of files) {
      try {
        const base = f.name.replace(/\.[^.]+$/, '');
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          toast(`Importing ${f.name}…`, 10000);
          const blobId = await putBlob(f);
          const { pages, text } = await pdfToPages(blobId);
          last = await this.newNote({ title: base, pages, pdfText: text });
        } else if (f.type.startsWith('image/')) {
          const note = await this.newNote({ title: base });
          const c = await db.get('content', note.id);
          const bmp = await createImageBitmap(f);
          const p = c.pages[0], m = 48;
          let w = p.w - 2 * m, ht = (w * bmp.height) / bmp.width;
          if (ht > p.h - 2 * m) { ht = p.h - 2 * m; w = (ht * bmp.width) / bmp.height; }
          bmp.close && bmp.close();
          p.objs.push({ id: uid(), type: 'image', blob: await putBlob(f), x: (p.w - w) / 2, y: m, w, h: ht });
          await db.put('content', c);
          note.thumb = await makeThumb(p, note.paper);
          note.thumbV = THUMB_VERSION;
          await db.put('notes', note);
          last = note;
        } else if (isDoc(f)) {
          toast(`Importing ${f.name}…`, 10000);
          const { pages, text } = await fileToPages(f, prefs.get('pageSize', 'letter'));
          last = await this.newNote({ title: base, pages, pdfText: text });
        } else if (/\.(opage|fnote|json)$/i.test(f.name)) {
          const data = JSON.parse(await f.text());
          if (isBackupFile(data)) {
            const n = await importLibrary(data);
            await this.load();
            toast(`Restored ${n} notes from backup`);
            count += n;
            continue;
          }
          last = await importNoteData(data, subjectIds);
          this.notes.push(last);
        } else {
          toast(`Skipped ${f.name}: unsupported file type`);
          continue;
        }
        count++;
      } catch (e) {
        console.error(e);
        toast(`Could not import ${f.name}: ${e.message}`, 5000);
      }
    }
    this.render();
    if (count === 1) toast('Imported');
    if (count === 1 && last) this.openNote(last.id);
    else if (count > 1) toast(`Imported ${count} items`);
  }

  // ---------------------------------------------------------------- settings
  async settings(section) {
    const seg = (key, def, options, onChange) => {
      const el = h('div', { class: 'seg' });
      const draw = () => {
        el.textContent = '';
        for (const [v, label] of options) {
          const b = h('button', { type: 'button', class: prefs.get(key, def) === v ? 'on' : '' }, label);
          b.onclick = () => { prefs.set(key, v); draw(); onChange && onChange(v); };
          el.append(b);
        }
      };
      draw();
      return el;
    };
    const select = (key, def, options, onChange) => {
      const s = h('select', {}, ...options.map(([v, l]) => h('option', { value: v, selected: prefs.get(key, def) === v }, l)));
      s.onchange = () => { prefs.set(key, s.value); onChange && onChange(s.value); };
      return s;
    };
    const check = (key, def, label, onChange) => {
      const c = h('input', { type: 'checkbox', checked: prefs.get(key, def) });
      c.onchange = () => { prefs.set(key, c.checked); onChange && onChange(c.checked); };
      return h('label', { class: 'check' }, c, label);
    };
    const sec = (id, title, ...kids) => h('div', { class: 'field', 'data-sec': id }, h('span', { style: { fontSize: '15px' } }, title), ...kids);

    await modal({
      title: 'Settings',
      body: (b) => {
        // ----- General
        const appearance = sec('appearance', 'Appearance',
          h('div', { class: 'row' }, h('small', {}, 'Theme'), seg('theme', 'system', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], () => this.applyTheme())),
          h('small', {}, 'Accent color'), this.accentPicker(),
          h('small', {}, 'Library cover'), (() => { const b = h('button', { type: 'button', class: 'btn small', html: icon('image') }, 'Choose a cover…'); b.onclick = () => coverPicker(); return h('div', {}, b); })(),
          check('mascot', true, 'Show the mascot (its face follows what you do)', applyMascotSetting),
          check('reduceCardMotion', false, 'Reduce card motion (flashcards change without flipping)', (v) => document.body.classList.toggle('reduce-card-motion', v)));
        const general = sec('writing', 'Writing & Pencil',
          h('small', {}, 'Drawing input'),
          select('inputMode', 'auto', [['auto', 'Automatic (fingers scroll once a stylus is used)'], ['finger', 'Finger and stylus both write'], ['stylus', 'Stylus only (fingers scroll)']], () => this.applyInputMode()),
          h('small', {}, 'Two fingers always scroll and pinch-zoom. Your palm is ignored while writing with a stylus.'));
        const newBtn = h('button', { type: 'button', class: 'btn small' }, 'Default template for new notes…');
        newBtn.onclick = async () => {
          const r = await templateGallery({ title: 'Default for new notes', paper: prefs.get('defaultPaper', { type: 'lined', color: 'white' }), size: prefs.get('pageSize', 'letter'), okLabel: 'Save' });
          if (r) { prefs.set('defaultPaper', r.paper); prefs.set('pageSize', r.size); toast('Saved'); }
        };
        general.append(newBtn);

        // ----- AI
        const key = h('input', { type: 'password', placeholder: 'sk-ant-…', value: prefs.get('ai.key', ''), autocomplete: 'off', 'aria-label': 'Claude API key' });
        key.onchange = () => prefs.set('ai.key', key.value.trim());
        const claudeBox = h('div', { class: 'field' },
          h('small', {}, 'Your Claude API key (from console.anthropic.com). It is stored only in this browser and sent only to Anthropic. Usage is billed to your Anthropic account.'),
          key, select('ai.model', 'claude-opus-5-5', CLAUDE_MODELS));
        const devNote = h('small', {}, deviceModelAPI() ? 'Uses the AI model built into this browser. Free and private, but text only (it cannot read handwriting from page images) and less capable.' : 'This browser has no built-in AI model (needs Chrome 138+ on desktop).');
        const showProv = () => { const p = prefs.get('ai.provider', 'claude'); claudeBox.hidden = p !== 'claude'; devNote.hidden = p !== 'device'; };
        const ai = sec('learn', 'Learn & AI',
          h('small', {}, 'Summaries, flashcards, quizzes, chat, Smart Notes and Math → LaTeX. Off unless you choose a provider.'),
          seg('ai.provider', 'claude', [['claude', 'Claude'], ['device', 'On-device'], ['off', 'Off']], showProv),
          claudeBox, devNote,
          check('smartNotes', true, 'Live Smart Notes while recording (needs live transcription)'));
        showProv();

        // ----- Handwriting & audio
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        general.append(check('ocr', true, 'Handwriting recognition (makes handwriting searchable)'),
          h('small', {}, 'Runs on this device. The first time, it downloads a ~10 MB recognition model.'));
        const hw = sec('audio', 'Audio',
          check('transcribe', false, SR ? 'Live transcription while recording' : 'Live transcription (not supported in this browser)'),
          h('small', {}, 'Uses the browser\'s speech recognition. Some browsers (e.g. Chrome) send the audio to the browser maker\'s servers for this.'));

        // ----- Sync & data
        const syncRow = h('div', { class: 'row' });
        const drawSync = async () => {
          syncRow.textContent = '';
          if (!syncSupported()) { syncRow.append(h('small', {}, 'Folder sync needs Chrome, Edge or Opera on a computer. On iPad/iPhone, use backup files to move notes.')); return; }
          const dir = await syncFolder();
          if (dir) {
            const now = h('button', { type: 'button', class: 'btn small' }, 'Sync now');
            now.onclick = () => this.runSync(true);
            const stop = h('button', { type: 'button', class: 'btn small danger' }, 'Stop syncing');
            stop.onclick = async () => { await forgetSyncFolder(); $('#btn-sync').hidden = true; this.syncOn = false; drawSync(); };
            syncRow.append(h('small', {}, `Syncing with folder "${dir.name}".`), now, stop);
          } else {
            const pick = h('button', { type: 'button', class: 'btn small primary' }, 'Choose sync folder…');
            pick.onclick = async () => {
              try { await chooseSyncFolder(); await this.initSync(); await this.runSync(true); drawSync(); } catch (e) { if (e.name !== 'AbortError') toast('Could not use that folder: ' + e.message); }
            };
            syncRow.append(pick);
          }
        };
        drawSync();
        const backup = h('button', { type: 'button', class: 'btn small' }, 'Export full backup');
        backup.onclick = async () => {
          toast('Preparing backup…', 20000);
          const blob = await exportLibrary();
          toast('Backup ready');
          await shareOrDownload(blob, `${safeName(APP_NAME)} backup ${new Date().toISOString().slice(0, 10)}.json`);
        };
        const restore = h('button', { type: 'button', class: 'btn small' }, 'Restore from backup');
        restore.onclick = async () => { const [f] = await pickFiles('.json,application/json'); if (f) this.importFiles([f]); };
        const usage = h('small', {});
        if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then((e) => { usage.textContent = `Using ${(e.usage / 1048576).toFixed(1)} MB on this device.`; });
        const data = sec('sync', 'Sync & backup',
          h('small', {}, 'Notes are stored on this device. To sync between computers, choose a folder inside iCloud Drive, Dropbox, OneDrive or Google Drive; every note is saved there as a file.'),
          syncRow, h('div', { class: 'row' }, backup, restore), usage);

        // ----- Install
        const install = sec('install', 'Install as an app');
        if (this.installEvt) {
          const ib = h('button', { type: 'button', class: 'btn primary small' }, 'Install ' + APP_NAME);
          ib.onclick = async () => { this.installEvt.prompt(); await this.installEvt.userChoice; this.installEvt = null; ib.remove(); };
          install.append(ib);
        }
        install.append(h('small', {}, 'iPad / iPhone: open in Safari, tap Share → Add to Home Screen. Android / Chrome / Edge: use the install icon in the address bar. Mac Safari: File → Add to Dock. Once installed it works offline.'));

        const tour = h('button', { type: 'button', class: 'btn small' }, 'Replay the welcome tour');
        tour.onclick = () => { tour.closest('dialog')?.close(); showIntro(this); };
        const about = sec('about', 'About', h('div', { class: 'about-logo', role: 'img', 'aria-label': `${APP_NAME} logo` }), h('div', {}, tour), h('small', { class: 'legal' },
          `${APP_NAME} is free, independent software. It is not affiliated with, endorsed by, or sponsored by Ginger Labs or the Notability app. ` +
          'Open-source components: PDF.js (Apache-2.0), jsPDF (MIT), Tesseract.js (Apache-2.0), Mammoth (BSD-2), JSZip (MIT), Anthropic TypeScript SDK (MIT).'));

        // one section at a time, chosen from tabs that stay at the top
        const groups = [
          ['appearance', 'Appearance', [appearance]], ['writing', 'Writing & Pencil', [general]], ['learn', 'Learn & AI', [ai]],
          ['audio', 'Audio', [hw]], ['storage', 'Storage & sync', [data, collabSettings(this), install]],
          ['privacy', 'Privacy', [securitySettings()]], ['about', 'About', [about]],
        ];
        const alias = { general: 'appearance', ai: 'learn', handwriting: 'writing', sync: 'storage', collab: 'storage', security: 'privacy', install: 'storage' };
        let current = alias[section] || section || prefs.get('settingsTab', 'appearance');
        if (!groups.some(([id]) => id === current)) current = 'appearance';
        const nav = h('div', { class: 'settings-nav', role: 'tablist', 'aria-label': 'Settings sections' });
        const panel = h('div', { class: 'settings-panel', role: 'tabpanel' });
        const show = (id) => {
          current = id; prefs.set('settingsTab', id);
          for (const btn of nav.children) { const on = btn.dataset.id === id; btn.classList.toggle('on', on); btn.setAttribute('aria-selected', String(on)); }
          panel.replaceChildren(...groups.find(([g]) => g === id)[2]);
          panel.scrollTop = 0;
        };
        for (const [id, label] of groups) {
          const btn = h('button', { type: 'button', role: 'tab', 'data-id': id }, label);
          btn.onclick = () => show(id);
          nav.append(btn);
        }
        b.append(nav, panel);
        show(current);
        setTimeout(() => nav.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' }), 30);
      },
      actions: [{ label: 'Done', value: true, primary: true }],
      cls: 'settings-modal',
    });
  }
}

const app = new App();
// The splash (index.html) stays a moment once the app is ready, so it isn't lost under the system's
// opening animation, then fades to the library or lock screen. The app keeps loading underneath.
const SPLASH_MS = 1200;
function hideSplash() {
  const el = $('#splash');
  if (!el) return Promise.resolve();
  return new Promise((done) => setTimeout(() => { el.classList.add('gone'); setTimeout(() => { el.remove(); done(); }, 500); }, DEMO ? 0 : SPLASH_MS));
}
window.addEventListener('DOMContentLoaded', () => app.init());
export default app;
