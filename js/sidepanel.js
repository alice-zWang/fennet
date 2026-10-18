// Right-hand panel in the editor: Recordings · AI · Study · Find · History
import { h, toast, fmtTime, fmtDate, uid, blockedOut, prefs } from './util.js';
import { icon } from './icons.js';
import { db } from './db.js';
import { ask, aiUnavailableReason, aiSupportsImages, AIError } from './ai.js';
import { renderPageCanvas } from './render.js';
import { textToPages } from './importers.js';
import { confirmDlg, promptText } from './ui.js';
import { studyStack } from './studystack.js';

// Learn holds summary, chat and practice (flashcards, quiz, fill-in-the-blank) in one place.
const TABS = [['outline', 'Outline', 'pages'], ['audio', 'Audio', 'wave'], ['ai', 'Learn', 'spark'], ['find', 'Find', 'search'], ['history', 'History', 'clock']];

// Minimal, safe Markdown → HTML (escape first, then a few patterns).
export function md(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = [];
  let list = false;
  for (const line of (src || '').split('\n')) {
    const m = line.match(/^\s*[-*•]\s+(.*)/), hd = line.match(/^(#{1,4})\s+(.*)/);
    if (m) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    if (hd) out.push(`<h4>${inline(hd[2])}</h4>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  if (list) out.push('</ul>');
  return out.join('');
}

// Text (and optionally page images) describing a note, for the model.
export async function noteContent(ed, { images = true, maxPages = 12, pageIndices = null } = {}) {
  const { note, doc } = ed;
  const parts = [`Note title: ${note.title}`];
  doc.pages.forEach((p, i) => {
    if (pageIndices && !pageIndices.includes(i)) return;
    const bits = [];
    for (const o of p.objs) if (o.type === 'text' && o.text.trim()) bits.push(o.text.trim());
    if (p.ocr && p.ocr.text) bits.push('[Handwriting, machine-read] ' + p.ocr.text);
    if (p.text) bits.push('[PDF text] ' + p.text.slice(0, 6000));
    if (bits.length) parts.push(`--- Page ${i + 1} ---\n${bits.join('\n')}`);
  });
  for (const r of (pageIndices ? [] : doc.recordings || [])) {
    if (r.transcript && r.transcript.length) parts.push(`--- Transcript of "${r.name}" ---\n` + r.transcript.map((s) => `[${fmtTime(s.t)}] ${s.text}`).join('\n'));
  }
  const content = [];
  if (images && aiSupportsImages()) {
    const selected = doc.pages.filter((_, i) => !pageIndices || pageIndices.includes(i));
    for (const p of selected.slice(0, maxPages)) {
      if (!p.objs.length && !p.pdf) continue;
      const c = await renderPageCanvas(p, note.paper, 0.9);
      content.push({ type: 'image', mediaType: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.72).split(',')[1] });
      c.width = c.height = 0;
    }
    if (selected.length > maxPages) parts.push(`(Only the first ${maxPages} pages are attached as images.)`);
  }
  content.push({ type: 'text', text: parts.join('\n\n') });
  return content;
}

const SYSTEM = 'You are a study assistant inside a note-taking app. The user\'s notes may include handwriting (attached as page images and as imperfect machine-read text), typed text, PDF text and audio transcripts. Be accurate to the notes; if something is unreadable, say so briefly instead of guessing.';

export class SidePanel {
  constructor(ed, el) {
    this.ed = ed;
    this.el = el;
    this.tab = null;
    this.chat = [];
    this.nav = h('nav', { class: 'side-tabs', role: 'tablist' });
    this.body = h('div', { class: 'side-body' });
    const close = h('button', { class: 'icon-btn small side-close', title: 'Close panel', 'aria-label': 'Close panel', html: icon('close') });
    close.onclick = () => this.close();
    for (const [id, label, ic] of TABS) {
      const b = h('button', { role: 'tab', 'data-tab': id, title: label, html: icon(ic) });
      b.append(h('span', {}, label));
      b.onclick = () => this.open(id);
      this.nav.append(b);
    }
    // collapse to a slim edge tab, and dock left or right (remembered)
    const collapse = h('button', { class: 'icon-btn small side-collapse', title: 'Collapse panel', 'aria-label': 'Collapse panel', html: icon('chev') });
    collapse.onclick = () => this.setCollapsed(true);
    const dock = h('button', { class: 'icon-btn small side-dock', title: 'Move panel to the other side', 'aria-label': 'Move panel to the other side', html: icon('split') });
    dock.onclick = () => { prefs.set('panelSide', prefs.get('panelSide', 'right') === 'right' ? 'left' : 'right'); this.applyDock(); };
    this.edge = h('button', { class: 'side-edge', type: 'button', title: 'Show panel', 'aria-label': 'Show panel' });
    this.edge.onclick = () => this.setCollapsed(false);
    this.nav.append(h('span', { class: 'side-nav-tools' }, dock, collapse, close));
    el.append(this.nav, this.body, this.edge);
    this.applyDock();
  }

  applyDock() { this.ed.root.classList.toggle('side-left', prefs.get('panelSide', 'right') === 'left'); }

  setCollapsed(on) {
    this.collapsed = on;
    this.ed.root.classList.toggle('side-collapsed', on);
    const label = (TABS.find(([id]) => id === this.tab) || [])[1] || 'Panel';
    this.edge.replaceChildren(h('span', { html: icon((TABS.find(([id]) => id === this.tab) || [])[2] || 'panel') }), h('span', { class: 'side-edge-label' }, label));
    this.edge.setAttribute('aria-label', 'Show ' + label);
    if (!on) this.nav.querySelector('[data-tab].on')?.focus?.();
  }

  get isOpen() { return !this.el.hidden; }

  open(tab) {
    if (tab === 'study') { tab = 'ai'; this.learnView = 'practice'; }
    const prev = this.tab;
    this.tab = tab;
    this.ed.pm.hidden = true;
    this.ed.root.querySelector('[data-act="pages"]').classList.remove('on');
    this.el.hidden = false;
    this.ed.root.classList.add('side-open');
    if (this.collapsed) this.setCollapsed(false);
    for (const b of this.nav.querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', String(b.dataset.tab === tab)); }
    if (prev === 'audio' && tab !== 'audio') this.ed.audioClosed();
    this.render();
    this.syncButtons();
    this.ed.root.querySelector('[data-act="panel"]').classList.add('on');
  }

  close() {
    if (this.tab === 'audio') this.ed.audioClosed();
    this.el.hidden = true;
    this.tab = null;
    this.ed.root.classList.remove('side-open');
    if (this.collapsed) this.setCollapsed(false);
    this.ed.root.querySelector('[data-act="panel"]').classList.remove('on');
    this.syncButtons();
  }

  syncButtons() {
    for (const [act, tab] of [['ai', 'ai'], ['outline', 'outline']]) {
      const b = this.ed.root.querySelector(`[data-act="${act}"]`);
      b.classList.toggle('on', this.isOpen && this.tab === tab); b.setAttribute('aria-pressed', String(this.isOpen && this.tab === tab));
    }
  }

  toggle(tab) { if (this.isOpen && (!tab || tab === this.tab)) this.close(); else this.open(tab || this.lastTab || 'audio'); }

  render() {
    this.lastTab = this.tab;
    this.body.textContent = '';
    ({ outline: () => this.renderOutline(), audio: () => this.renderAudio(), ai: () => this.renderAI(), find: () => this.renderFind(), history: () => this.renderHistory() })[this.tab]();
  }

  refreshIf(tab) { if (this.isOpen && this.tab === tab) this.render(); }

  notReady() {
    const why = aiUnavailableReason();
    if (!why) return null;
    const b = h('button', { class: 'btn primary small', type: 'button' }, 'Set up AI');
    b.onclick = () => this.ed.app.settings('ai');
    return h('div', { class: 'callout connect-ai' }, h('strong', {}, 'Connect AI to create new study material'),
      h('p', {}, 'Uses your own Claude key; Anthropic bills a few cents per summary or quiz. Only the pages you choose are sent. Anything already created below works without it.'), b);
  }

  selectedPages() {
    if (this.sourceMode === 'library') return null;
    if (this.sourceMode === 'current') return [this.ed.curIdx];
    if (this.sourceMode === 'custom') return (this.sourcePages || []).filter((i) => i < this.ed.doc.pages.length);
    return null;
  }

  sourceLabel() {
    const pages = this.selectedPages();
    return pages ? 'Pages ' + pages.map((i) => i + 1).join(', ') : 'Whole note';
  }

  sourcePicker({ library = false } = {}) {
    const wrap = h('section', { class: 'learn-source' });
    const opts = [['all', 'This note · all pages'], ['current', 'This note · current page'], ['custom', 'This note · choose pages…'], ...(library ? [['library', 'All my notes']] : [])];
    const select = h('select', { 'aria-label': 'Study content' }, ...opts.map(([value, label]) => h('option', { value }, label)));
    if (!library && this.sourceMode === 'library') this.sourceMode = 'all';
    select.value = this.sourceMode || 'all';
    const pages = h('div', { class: 'source-pages' });
    const draw = () => {
      pages.textContent = '';
      if (select.value !== 'custom') return;
      this.sourcePages ||= [this.ed.curIdx];
      this.ed.doc.pages.forEach((p, i) => {
        const input = h('input', { type: 'checkbox', checked: this.sourcePages.includes(i), 'aria-label': `Include page ${i + 1}` });
        input.onchange = () => {
          const next = new Set(this.sourcePages); input.checked ? next.add(i) : next.delete(i);
          this.sourcePages = [...next].sort((a, b) => a - b); this.apiHistory = []; this.chat = [];
        };
        pages.append(h('label', {}, input, `Page ${i + 1}`));
      });
    };
    select.onchange = () => { this.sourceMode = select.value; this.apiHistory = []; this.chat = []; this.render(); };
    draw();
    wrap.append(h('div', { class: 'row' }, h('span', {}, 'From'), select), pages);
    return wrap;
  }

  renderOutline() {
    const B = this.body, ed = this.ed;
    const heading = h('h2', { class: 'outline-head' }, 'Pages & outline');
    const search = h('input', { type: 'search', placeholder: 'Search pages and headings', 'aria-label': 'Search pages and headings', value: this.outlineQuery || '' });
    const modes = h('div', { class: 'outline-modes', role: 'group', 'aria-label': 'Page view' });
    modes.classList.add('seg');
    for (const [mode, label] of [['pages', 'Pages'], ['headings', 'Outline'], ['bookmarks', 'Bookmarks']]) {
      const b = h('button', { class: (this.outlineMode || 'pages') === mode ? 'on' : '', type: 'button', 'aria-pressed': String((this.outlineMode || 'pages') === mode) }, label);
      b.onclick = () => { this.outlineMode = mode; this.render(); }; modes.append(b);
    }
    const list = h('div', { class: 'outline-list' });
    const draw = () => {
      list.textContent = '';
      const q = (this.outlineQuery || '').trim().toLowerCase();
      ed.doc.pages.forEach((page, i) => {
        const typed = [...page.objs].filter((o) => o.type === 'text').sort((a, b) => a.y - b.y).map((o) => o.text).join('\n');
        const text = [typed, page.text || '', page.ocr?.text || ''].join('\n');
        const extracted = text.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 100);
        const title = page.outlineTitle || extracted || `Page ${i + 1}`;
        const kind = page.outlineTitle ? 'heading' : extracted ? 'extracted' : 'plain';   // your heading vs first line of the page
        if (this.outlineMode === 'bookmarks' && !page.bookmarked) return;
        if (q && !(`${title} ${text} ${i + 1}`.toLowerCase().includes(q))) return;
        const row = h('article', { class: 'outline-page ' + kind + (this.outlineMode === 'headings' ? ' compact' : '') + (ed.curIdx === i ? ' current' : ''), 'data-page-index': i });
        const jump = h('button', { class: 'outline-jump', type: 'button', 'aria-label': `Go to page ${i + 1}: ${title}` });
        if (this.outlineMode !== 'headings') {
          const preview = h('div', { class: 'outline-preview', style: { aspectRatio: `${page.w}/${page.h}` } });
          jump.append(preview);
          renderPageCanvas(page, ed.note.paper, .18).then((canvas) => {
            if (preview.isConnected) preview.replaceChildren(h('img', { src: canvas.toDataURL('image/jpeg', .7), alt: `Preview of page ${i + 1}` }));
            canvas.width = canvas.height = 0;
          }).catch(() => { preview.textContent = `Page ${i + 1}`; });
        }
        jump.append(h('span', { class: 'outline-line' }, h('span', { class: 'outline-page-title', title: kind === 'extracted' ? 'From the text on this page' : kind === 'heading' ? 'Your heading' : '' }, title), h('span', { class: 'outline-num' }, String(i + 1))));
        jump.onclick = () => { ed.scrollToPage(i); for (const r of list.children) r.classList.toggle('current', +r.dataset.pageIndex === i); };
        const bookmark = h('button', { class: 'icon-btn small' + (page.bookmarked ? ' on' : ''), type: 'button', title: page.bookmarked ? 'Remove bookmark' : 'Bookmark page', 'aria-label': `Bookmark page ${i + 1}`, 'aria-pressed': String(!!page.bookmarked), html: icon('star') });
        bookmark.onclick = () => { page.bookmarked = !page.bookmarked; ed.changed(); draw(); };
        const rename = h('button', { class: 'btn ghost small', type: 'button' }, 'Edit heading');
        rename.onclick = async () => { const value = await promptText('Page heading', title); if (value) { page.outlineTitle = value; ed.changed(); draw(); } };
        row.append(jump, h('div', { class: 'row outline-actions' }, rename, bookmark)); list.append(row);
      });
      if (!list.children.length) list.append(h('p', { class: 'hint' }, this.outlineMode === 'bookmarks' ? 'Bookmark a page with its star to keep it here.' : q ? 'No matching pages.' : 'Add headings with "Edit heading", or type a title at the top of a page.'));
    };
    search.oninput = () => { this.outlineQuery = search.value; draw(); };
    B.append(heading, search, modes, list);
    draw();
  }

  // ---------------------------------------------------------------- audio
  renderAudio() {
    this.body.append(this.ed.audioPanel);
    this.ed.audioOpened();
  }

  // ---------------------------------------------------------------- AI
  renderAI() {
    const B = this.body, doc = this.ed.doc;
    doc.study ||= {};
    const nr = this.notReady();
    this.learnView ||= doc.summary ? 'summary' : 'practice';
    const seg = h('div', { class: 'seg learn-seg', role: 'tablist', 'aria-label': 'Learn views' });
    for (const [id, label] of [['summary', 'Summary'], ['chat', 'Chat'], ['practice', 'Practice']]) {
      const b = h('button', { type: 'button', role: 'tab', class: this.learnView === id ? 'on' : '', 'aria-selected': String(this.learnView === id) }, label);
      b.onclick = () => { this.learnView = id; this.practiceMode = null; this.render(); };
      seg.append(b);
    }
    B.append(h('div', { class: 'learn-head' }, h('h2', {}, 'Learn'), seg));
    if (!(this.learnView === 'practice' && this.practiceMode === 'cards' && (doc.study.cards || []).length)) B.append(this.sourcePicker({ library: this.learnView === 'chat' }));
    if (this.learnView === 'summary') this.renderSummary(B, nr);
    else if (this.learnView === 'chat') this.renderChat(B, nr);
    else this.renderPractice(B, nr);
    if (nr) B.append(nr);   // existing material first; the setup card follows
  }

  renderSummary(B, nr) {
    const doc = this.ed.doc;
    // Summary
    const sumOut = h('div', { class: 'ai-out' });
    if (doc.summary) sumOut.innerHTML = md(doc.summary);
    const sumBtn = h('button', { class: 'btn primary', type: 'button', disabled: !!nr }, doc.summary ? 'Summarize again' : 'Create summary');
    const sumActs = h('div', { class: 'row' });
    const showSumActs = () => {
      sumActs.textContent = '';
      if (!doc.summary) return;
      const ins = h('button', { class: 'btn small', type: 'button' }, 'Insert into note');
      ins.onclick = () => this.ed.appendText('Summary', doc.summary);
      const cp = h('button', { class: 'btn small', type: 'button' }, 'Copy');
      cp.onclick = () => (blockedOut() ? null : navigator.clipboard.writeText(doc.summary).then(() => toast('Copied')));
      sumActs.append(ins, cp);
    };
    showSumActs();
    sumBtn.onclick = async () => {
      sumBtn.disabled = true; sumBtn.textContent = 'Reading your notes…';
      let acc = '';
      try {
        const content = await this.noteOrToast();
        if (!content) return;
        content.push({ type: 'text', text: 'Summarize these notes for studying: a 2–3 sentence overview, then the key points as bullets, then important terms with one-line definitions. Use Markdown headings (##) and bullets.' });
        const text = await ask({ system: SYSTEM, content, effort: 'low', onText: (t) => { acc += t; sumOut.innerHTML = md(acc); } });
        doc.summary = text;
        this.ed.changed();
        sumOut.innerHTML = md(text);
        showSumActs();
      } catch (e) { this.err(e, sumOut); } finally { sumBtn.disabled = !!nr; sumBtn.textContent = 'Summarize again'; }
    };
    B.append(h('section', { class: 'side-sec' }, h('h3', {}, 'Smart summary'), sumBtn, sumOut, sumActs));

    // Live smart notes
    const sn = doc.smartNotes || [];
    const snSec = h('section', { class: 'side-sec' }, h('h3', {}, 'Smart Notes'),
      h('p', { class: 'hint' }, 'While you record with live transcription on, AI writes running notes from the lecture every minute or so.'));
    if (sn.length) {
      const all = sn.map((s) => s.text).join('\n');
      snSec.append(h('div', { class: 'ai-out', html: md(all) }));
      const ins = h('button', { class: 'btn small', type: 'button' }, 'Insert into note');
      ins.onclick = () => this.ed.appendText('Smart Notes', all);
      snSec.append(ins);
    }
    B.append(snSec);

  }

  renderChat(B, nr) {
    // Chat
    const scope = { value: this.sourceMode === 'library' ? 'all' : 'note' };   // one source selector above
    const log = h('div', { class: 'chat-log' });
    const draw = () => {
      log.textContent = '';
      if (!this.chat.length) log.append(h('p', { class: 'hint' }, scope.value === 'all' ? 'Ask anything about all your notes, e.g. "Where did I write about mitosis?"' : 'Ask about this note, e.g. "Explain the second page simply" or "What did the lecturer say about exams?"'));
      for (const m of this.chat) log.append(h('div', { class: 'msg ' + m.role, html: m.role === 'user' ? md(m.text) : md(m.text || '…') }));
      log.scrollTop = log.scrollHeight;
    };
    draw();
    const input = h('textarea', { rows: 2, placeholder: 'Ask about your notes…', disabled: !!nr });
    const send = h('button', { class: 'btn primary', type: 'button', disabled: !!nr }, 'Send');
    const go = async () => {
      const q = input.value.trim();
      if (!q) return;
      if (scope.value === 'note' && this.selectedPages()?.length === 0) { toast('Select at least one page to study.'); return; }
      input.value = '';
      send.disabled = true;
      const first = !this.apiHistory || !this.apiHistory.length;
      this.chat.push({ role: 'user', text: q });
      const reply = { role: 'assistant', text: '' };
      this.chat.push(reply);
      draw();
      try {
        // The notes go into the first question only; follow-ups reuse the conversation.
        if (first) {
          this.apiHistory = [];
          this.ctxBlocks = scope.value === 'all' ? await this.allNotesContent() : await noteContent(this.ed, { pageIndices: this.selectedPages() });
        }
        const blocks = first ? [...this.ctxBlocks, { type: 'text', text: q }] : [{ type: 'text', text: q }];
        const text = await ask({ system: SYSTEM, content: blocks, history: this.apiHistory, effort: 'low', onText: (t) => { reply.text += t; draw(); } });
        reply.text = text;
        this.apiHistory.push({ role: 'user', content: toApi(blocks) }, { role: 'assistant', content: text });
      } catch (e) { reply.text = '⚠️ ' + (e.message || e); draw(); } finally { send.disabled = false; draw(); }
    };
    send.onclick = go;
    input.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } };
    const clear = h('button', { class: 'btn ghost small', type: 'button' }, 'New chat');
    clear.onclick = () => { this.chat = []; this.apiHistory = []; draw(); };
    const chatSection = h('section', { class: 'side-sec learn-chat' }, log, h('div', { class: 'chat-input' }, input, send), clear);
    B.append(chatSection);
  }

  // Practice: flashcards (Study Stack), quiz, fill in the blanks
  renderPractice(B, nr) {
    const doc = this.ed.doc, st = doc.study;
    const mode = this.practiceMode;
    if (!mode) {
      const cards = st.cards || [], mastered = cards.filter((c) => (c.got || 0) >= 3).length;
      const items = [
        ['cards', 'Flashcards', cards.length ? `${cards.length} cards · ${mastered} mastered` : 'Recall the key ideas'],
        ['quiz', 'Quiz', (st.quiz || []).length ? `${st.quiz.length} questions${st.progress ? ` · ${st.progress.correct} of ${st.progress.answered} right so far` : ''}` : 'Check your understanding'],
        ['blanks', 'Fill in the blanks', (st.blanks || []).length ? `${st.blanks.length} prompts` : 'Complete the missing ideas'],
      ];
      const list = h('section', { class: 'side-sec learn-practice' });
      for (const [id, title, sub] of items) {
        const b = h('button', { class: 'learn-action', type: 'button' }, h('strong', {}, title), h('span', { class: 'hint' }, sub), h('span', { class: 'learn-arrow', 'aria-hidden': 'true' }, '›'));
        b.onclick = () => { this.practiceMode = id; this.render(); };
        list.append(b);
      }
      B.append(list);
      return;
    }
    const back = h('button', { type: 'button', class: 'btn ghost small practice-back' }, '‹ Practice');
    back.onclick = () => { this.practiceMode = null; this.render(); };
    B.append(back);
    if (mode === 'cards') this.renderCards(B, nr);
    else if (mode === 'quiz') this.renderQuiz(B, nr);
    else this.renderBlanks(B, nr);
  }

  renderCards(B, nr) {
    const doc = this.ed.doc, cards = doc.study.cards || [];
    const n = h('select', { 'aria-label': 'Number of cards' }, ...[10, 20, 30].map((v) => h('option', { value: v }, v + ' cards')));
    const out = h('div', {});
    const gen = h('button', { class: cards.length ? 'btn small' : 'btn primary', type: 'button', disabled: !!nr }, cards.length ? 'Create new flashcards' : 'Create flashcards');
    gen.onclick = async () => {
      if (cards.length && !(await confirmDlg('Replace these flashcards with a new set? Your progress on them will be lost.', { title: 'New flashcards?', okLabel: 'Replace' }))) return;
      gen.disabled = true; gen.textContent = 'Writing flashcards…';
      try {
        const content = await this.noteOrToast();
        if (!content) return;
        content.push({ type: 'text', text: `Write ${n.value} flashcards that test the most important facts and concepts in these notes. Front: a short question or term. Back: a concise answer.` });
        const res = await ask({
          system: SYSTEM, content, effort: 'low',
          schema: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['front', 'back'], properties: { front: { type: 'string' }, back: { type: 'string' } } } } } },
        });
        doc.study.cards = res.cards.map((c) => ({ ...c, id: uid() }));
        doc.study.cardsSource = this.sourceLabel();
        this.ed.changed();
        this.render();
      } catch (e) { this.err(e, out); } finally { gen.disabled = !!nr; }
    };
    const sec = h('section', { class: 'side-sec', 'data-study': 'cards' });
    if (cards.length) {
      sec.append(studyStack(cards, { onChange: () => this.ed.changed(), onPage: (i) => this.ed.scrollToPage(i) }));
      sec.append(h('div', { class: 'row practice-foot' }, h('span', { class: 'hint' }, doc.study.cardsSource ? 'From: ' + doc.study.cardsSource : ''), h('span', { style: { flex: 1 } }), gen, n), out);
    } else {
      sec.append(h('p', { class: 'hint' }, 'Flashcards are made from the pages selected above.'), h('div', { class: 'row' }, gen, n), out);
    }
    B.append(sec);
  }

  renderQuiz(B, nr) {
    const doc = this.ed.doc;
    // Quiz
    const qz = h('section', { class: 'side-sec', 'data-study': 'quiz' }, h('h3', {}, 'Quiz'));
    const qs = (doc.study.quiz || []);
    const qgen = h('button', { class: 'btn primary', type: 'button', disabled: !!nr }, qs.length ? 'Create new quiz' : 'Create quiz');
    const qn = h('select', { 'aria-label': 'Number of questions' }, ...[5, 10, 20].map((v) => h('option', { value: v }, v + ' questions')));
    const qout = h('div', {});
    qgen.onclick = async () => {
      qgen.disabled = true; qgen.textContent = 'Writing questions…';
      try {
        const content = await this.noteOrToast();
        if (!content) return;
        content.push({ type: 'text', text: `Write ${qn.value} multiple-choice questions testing understanding of these notes. Exactly 4 choices each, one correct. "answer" is the 0-based index of the correct choice. Add a one-sentence explanation.` });
        const res = await ask({
          system: SYSTEM, content, effort: 'low',
          schema: { type: 'object', additionalProperties: false, required: ['questions'], properties: { questions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['question', 'choices', 'answer', 'explanation'], properties: { question: { type: 'string' }, choices: { type: 'array', items: { type: 'string' } }, answer: { type: 'integer' }, explanation: { type: 'string' } } } } } },
        });
        doc.study.quizSource = this.sourceLabel();
        doc.study.quiz = res.questions.filter((q) => q.choices.length >= 2 && q.answer >= 0 && q.answer < q.choices.length);
        this.ed.changed();
        this.quizState = { i: 0, score: 0, picked: null };
        this.render();
      } catch (e) { this.err(e, qout); } finally { qgen.disabled = !!nr; }
    };
    qz.append(h('div', { class: 'row' }, qgen, qn), qout);
    if (qs.length) {
      if (doc.study.quizSource) qz.append(h('p', { class: 'hint' }, 'Created from: ' + doc.study.quizSource));
      qz.append(this.quizView(qs));
    }
    B.append(qz);
  }

  async allNotesContent() {
    const notes = this.ed.app.notes.filter((n) => !n.deleted);
    let text = '';
    for (const n of notes) {
      const block = `=== Note: "${n.title}" (edited ${new Date(n.updated).toLocaleDateString()}) ===\n${(n.searchText || '').slice(0, 20000)}\n\n`;
      if (text.length + block.length > 600000) break;
      text += block;
    }
    return [{ type: 'text', text: 'Here are all of my notes (typed text, machine-read handwriting, PDF text and transcripts):\n\n' + text }];
  }

  async noteOrToast() {
    if (this.selectedPages()?.length === 0) { toast('Select at least one page to study.'); return null; }
    const content = await noteContent(this.ed, { pageIndices: this.selectedPages() });
    const hasStuff = content.length > 1 || content[0].text.split('\n').length > 1;
    if (!hasStuff) { toast('This note is empty. Write something first.'); return null; }
    return content;
  }

  err(e, el) {
    const msg = e instanceof AIError ? e.message : 'Something went wrong: ' + (e.message || e);
    el.textContent = '';
    el.append(h('p', { class: 'error' }, msg));
  }

  renderBlanks(B, nr) {
    const doc = this.ed.doc;
    const section = h('section', { class: 'side-sec', 'data-study': 'blanks' }, h('h3', {}, 'Fill in the blanks'));
    const generate = h('button', { class: 'btn primary', type: 'button', disabled: !!nr }, 'Create 10 practice prompts');
    const out = h('div', {});
    generate.onclick = async () => {
      generate.disabled = true; generate.textContent = 'Creating prompts…';
      try {
        const content = await this.noteOrToast(); if (!content) return;
        content.push({ type: 'text', text: 'Create 10 fill-in-the-blank study prompts from these notes. Each prompt must contain ___ in place of one important term. Include the missing answer and a brief explanation.' });
        const result = await ask({ system: SYSTEM, content, effort: 'low', schema: { type: 'object', additionalProperties: false, required: ['prompts'], properties: { prompts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['prompt', 'answer', 'explanation'], properties: { prompt: { type: 'string' }, answer: { type: 'string' }, explanation: { type: 'string' } } } } } } });
        doc.study.blanksSource = this.sourceLabel();
        doc.study.blanks = result.prompts.filter((p) => p.prompt.includes('___') && p.answer.trim()); this.ed.changed(); this.render();
      } catch (error) { this.err(error, out); }
      finally { generate.disabled = !!nr; generate.textContent = 'Create 10 practice prompts'; }
    };
    section.append(generate, out);
    if (doc.study.blanksSource) section.append(h('p', { class: 'hint' }, 'Created from: ' + doc.study.blanksSource));
    for (const [i, item] of (doc.study.blanks || []).entries()) {
      const input = h('input', { type: 'text', placeholder: 'Your answer', 'aria-label': `Answer for prompt ${i + 1}` });
      const reveal = h('button', { class: 'btn small', type: 'button' }, 'Check answer');
      const feedback = h('p', { class: 'hint', 'aria-live': 'polite' });
      reveal.onclick = () => { feedback.textContent = `${input.value.trim().toLowerCase() === item.answer.trim().toLowerCase() ? 'Correct. ' : 'Answer: ' + item.answer + '. '}${item.explanation}`; };
      section.append(h('div', { class: 'blank-prompt' }, h('p', {}, item.prompt), input, reveal, feedback));
    }
    B.append(section);
  }

  quizView(qs) {
    const st = (this.quizState ||= { i: 0, score: 0, picked: null });
    const wrap = h('div', { class: 'quiz' });
    if (st.i >= qs.length) {
      const again = h('button', { class: 'btn primary', type: 'button' }, 'Retake quiz');
      again.onclick = () => { this.quizState = { i: 0, score: 0, picked: null }; this.render(); };
      wrap.append(h('p', { class: 'score' }, `You scored ${st.score} / ${qs.length}`), again);
      return wrap;
    }
    const q = qs[st.i];
    wrap.append(h('p', { class: 'hint' }, `Question ${st.i + 1} of ${qs.length} · Score ${st.score}`), h('p', { class: 'q' }, q.question));
    q.choices.forEach((c, i) => {
      const b = h('button', { type: 'button', class: 'choice-btn' + (st.picked != null ? (i === q.answer ? ' right' : i === st.picked ? ' wrong' : '') : '') }, c);
      b.disabled = st.picked != null;
      b.onclick = () => { st.picked = i; if (i === q.answer) st.score++; const progress = (this.ed.doc.study.progress ||= { answered: 0, correct: 0 }); progress.answered++; if (i === q.answer) progress.correct++; this.ed.changed(); this.render(); };
      wrap.append(b);
    });
    if (st.picked != null) {
      const next = h('button', { class: 'btn primary', type: 'button' }, st.i + 1 < qs.length ? 'Next question' : 'See score');
      next.onclick = () => { st.i++; st.picked = null; this.render(); };
      wrap.append(h('p', { class: 'hint' }, q.explanation), next);
    }
    return wrap;
  }

  // ---------------------------------------------------------------- find
  renderFind() {
    const B = this.body, ed = this.ed;
    const input = h('input', { type: 'search', placeholder: 'Find in this note', value: this.findQ || '', 'aria-label': 'Find in this note' });
    const res = h('div', { class: 'find-results' });
    const pagesWithInk = ed.doc.pages.filter((p) => p.objs.some((o) => o.type === 'stroke')).length;
    const indexed = ed.doc.pages.filter((p) => p.ocr && p.ocr.sig && p.ocr.sig === ed.inkSig(p)).length;
    const status = h('p', { class: 'hint' });
    if (!ed.ocrOn()) status.append('Handwriting search is off (Settings → Handwriting).');
    else if (pagesWithInk) status.append(`Handwriting recognized on ${indexed} of ${pagesWithInk} handwritten page${pagesWithInk > 1 ? 's' : ''}.`);
    if (ed.ocrOn() && indexed < pagesWithInk) {
      const b = h('button', { class: 'btn ghost small', type: 'button' }, 'Recognize now');
      b.onclick = async () => { b.disabled = true; b.textContent = 'Recognizing… (first time downloads ~10 MB)'; await ed.indexAll(true); this.render(); };
      status.append(' ', b);
    }
    const run = () => {
      this.findQ = input.value;
      res.textContent = '';
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) return;
      const hits = [];
      ed.doc.pages.forEach((p, i) => {
        for (const o of p.objs) if (o.type === 'text' && o.text.toLowerCase().includes(q)) hits.push({ i, kind: 'Typed', snip: snippet(o.text, q), box: { x: o.x, y: o.y, w: o.w, h: o.size * 2 } });
        if (p.ocr) for (const w of p.ocr.words) if (w.t.toLowerCase().includes(q)) hits.push({ i, kind: 'Handwriting', snip: w.t, box: { x: w.b[0], y: w.b[1], w: w.b[2] - w.b[0], h: w.b[3] - w.b[1] } });
        if (p.text && p.text.toLowerCase().includes(q)) hits.push({ i, kind: 'PDF', snip: snippet(p.text, q) });
      });
      for (const r of ed.doc.recordings || []) for (const s of r.transcript || []) if (s.text.toLowerCase().includes(q)) hits.push({ rec: r, t: s.t, kind: 'Audio', snip: s.text });
      if (!hits.length) { res.append(h('p', { class: 'hint' }, 'No matches.')); return; }
      res.append(h('p', { class: 'hint' }, `${hits.length} match${hits.length > 1 ? 'es' : ''}`));
      for (const hit of hits.slice(0, 200)) {
        const b = h('button', { type: 'button', class: 'find-hit' },
          h('span', { class: 'tag' }, hit.rec ? `${hit.kind} ${fmtTime(hit.t)}` : `${hit.kind} · p${hit.i + 1}`), h('span', {}, hit.snip));
        b.onclick = () => {
          if (hit.rec) { this.open('audio'); ed.selectRecording(hit.rec).then(() => ed.seek(hit.t, true)); return; }
          ed.scrollToPage(hit.i);
          if (hit.box) ed.flashBox(hit.i, hit.box);
        };
        res.append(b);
      }
    };
    input.oninput = run;
    B.append(h('section', { class: 'side-sec' }, input, status, res));
    run();
    setTimeout(() => input.focus(), 30);
  }

  // ---------------------------------------------------------------- history
  async renderHistory() {
    const B = this.body, ed = this.ed;
    const save = h('button', { class: 'btn', type: 'button' }, 'Save a version now');
    save.onclick = async () => { await ed.snapshot(true); toast('Version saved'); this.render(); };
    B.append(h('section', { class: 'side-sec' }, h('p', { class: 'hint' }, 'Versions are saved automatically while you work (every 10 minutes of editing) and kept for 90 days on this device.'), save));
    const list = h('div', { class: 'versions' });
    B.append(list);
    const vs = (await db.byIndex('versions', 'noteId', ed.note.id)).sort((a, b) => b.ts - a.ts);
    if (!vs.length) { list.append(h('p', { class: 'hint' }, 'No earlier versions yet.')); return; }
    for (const v of vs) {
      const restore = h('button', { class: 'btn small', type: 'button' }, 'Restore');
      const copy = h('button', { class: 'btn small', type: 'button' }, 'Open as copy');
      restore.onclick = async () => {
        if (!(await confirmDlg(`Restore the version from ${new Date(v.ts).toLocaleString()}? Your current version is saved to History first.`, { okLabel: 'Restore', danger: false }))) return;
        await ed.restoreVersion(v);
        this.render();
      };
      copy.onclick = () => ed.app.versionAsCopy(v);
      list.append(h('div', { class: 'version' },
        h('img', { src: v.thumb || '', alt: '' }),
        h('div', { class: 'v-meta' }, h('b', {}, fmtDate(v.ts) + ' ' + new Date(v.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })), h('span', { class: 'hint' }, `${v.pages.length} page${v.pages.length > 1 ? 's' : ''}`), h('div', { class: 'row' }, restore, copy))));
    }
  }
}

function snippet(text, q) {
  const i = text.toLowerCase().indexOf(q);
  const s = Math.max(0, i - 40);
  return (s ? '…' : '') + text.slice(s, i + q.length + 60).replace(/\s+/g, ' ') + (i + q.length + 60 < text.length ? '…' : '');
}

// ai.ask() block format → API message content (for chat history)
function toApi(blocks) { return blocks.map((b) => (b.type === 'image' ? { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } } : { type: 'text', text: b.text })); }
