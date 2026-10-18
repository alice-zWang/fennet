// Welcome tour: shown once after the first profile is made (and once to people updating), replayable from
// Settings → About. Six short cards with the buddy; swipe, arrow keys, the dots or Back / Next to move.
import { h, prefs } from './util.js';
import { icon } from './icons.js';
import { mascotSVG } from './mascot.js';
import { coverPicker } from './covers.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const bub = (label, cls = '', ic = '') => h('span', { class: 'btn intro-bub ' + cls, html: ic ? icon(ic) : '' }, label);

function steps(app) {
  const name = (prefs.get('profile', null) || {}).name;
  const theme = h('div', { class: 'seg' });
  const drawTheme = () => {
    theme.textContent = '';
    for (const [v, label] of [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]) {
      const b = h('button', { type: 'button', class: prefs.get('theme', 'system') === v ? 'on' : '' }, label);
      b.onclick = () => { prefs.set('theme', v); app.applyTheme(); drawTheme(); };
      theme.append(b);
    }
  };
  drawTheme();
  const cover = h('button', { type: 'button', class: 'btn', html: icon('image') }, 'Choose a library cover…');
  cover.onclick = () => coverPicker();

  return [
    { mood: 'wink', title: name ? `Welcome to Fennet, ${name}!` : 'Welcome to Fennet!',
      text: 'A free notebook for handwriting, PDFs and studying. Here’s a quick tour. It takes about 30 seconds.',
      art: () => h('div', { class: 'intro-hero' }) },
    { mood: 'studious', title: 'Write naturally',
      text: 'Pick a tool from the tray at the top. Tap the chosen tool again for its style, size and color. Double-tap Apple Pencil to switch to the eraser.',
      art: () => h('div', { class: 'intro-tray' }, bub('', 'on round', 'pen'), bub('', 'round', 'highlighter'), bub('', 'round', 'eraser'), bub('', 'round', 'lasso'), bub('', 'round', 'text')) },
    { mood: 'curious', title: 'Keep it organized',
      text: 'Make subjects and dividers in the sidebar, star your favorites, and search everything, even your handwriting.',
      art: () => h('div', { class: 'intro-tray stack' }, bub('Biology 101', '', 'folder'), bub('Geometry', 'primary', 'folder'), bub('Number Theory', '', 'folder')) },
    { mood: 'excited', title: 'Study smarter',
      text: 'Open Learn in any note for an outline, flashcards, quizzes and fill-in-the-blanks. Record a lecture and the audio follows what you write.',
      art: () => h('div', { class: 'intro-study' }, h('div', { class: 'intro-card' }, h('small', {}, 'QUESTION'), h('b', {}, 'Heron’s formula?')),
        h('div', { class: 'intro-row' }, bub('Again', 'stack-again'), bub('Got it', 'primary'))) },
    { mood: 'happy', title: 'Private by design',
      text: 'Your notes stay on this device, locked with Touch ID or a passcode. Nothing is uploaded. Share a subject only when you choose, encrypted end to end.',
      art: () => h('div', { class: 'intro-lock', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>' }) },
    { mood: 'happy', title: 'Make it yours',
      text: 'Choose a theme, an accent color and a cover for your library. You can change them any time in Settings.',
      art: () => h('div', { class: 'intro-yours' }, theme, app.accentPicker(), cover) },
  ];
}

export function showIntro(app) {
  return new Promise((resolve) => {
    const list = steps(app);
    let i = 0;
    const d = h('dialog', { class: 'modal intro', 'aria-label': 'Welcome to Fennet' });
    const buddy = h('div', { class: 'intro-buddy', 'aria-hidden': 'true' });
    const art = h('div', { class: 'intro-art' });
    const title = h('h2', { id: 'intro-title' });
    const text = h('p', { class: 'intro-text' });
    const dots = h('div', { class: 'intro-dots', role: 'tablist', 'aria-label': 'Tour steps' });
    const back = h('button', { type: 'button', class: 'btn' }, 'Back');
    const next = h('button', { type: 'button', class: 'btn primary' }, 'Next');
    const skip = h('button', { type: 'button', class: 'btn ghost intro-skip' }, 'Skip');
    const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });
    const stage = h('div', { class: 'intro-stage' }, buddy, art, title, text);
    d.append(h('div', { class: 'intro-body' }, skip, stage, dots, h('div', { class: 'intro-actions' }, back, next), live));
    d.setAttribute('aria-labelledby', 'intro-title');

    list.forEach((_, k) => {
      const dot = h('button', { type: 'button', class: 'intro-dot', role: 'tab', 'aria-label': `Step ${k + 1} of ${list.length}` });
      dot.onclick = () => go(k);
      dots.append(dot);
    });
    function paint() {
      const s = list[i];
      buddy.innerHTML = mascotSVG(s.mood);
      stage.classList.toggle('first', i === 0);
      art.textContent = ''; art.append(s.art());
      title.textContent = s.title;
      text.textContent = s.text;
      [...dots.children].forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.classList.toggle('on', k === i); });
      back.hidden = i === 0;
      next.textContent = i === list.length - 1 ? 'Start writing' : 'Next';
      skip.hidden = i === list.length - 1;
      live.textContent = `Step ${i + 1} of ${list.length}: ${s.title}`;
    }
    function go(k, dir = Math.sign(k - i)) {
      if (k < 0 || k >= list.length || k === i) return;
      i = k;
      if (reduceMotion()) { paint(); return; }
      stage.classList.remove('in-left', 'in-right'); void stage.offsetWidth;
      paint();
      stage.classList.add(dir < 0 ? 'in-left' : 'in-right');
    }
    const finish = () => { prefs.set('introSeen', true); d.close(); };
    back.onclick = () => go(i - 1);
    next.onclick = () => (i === list.length - 1 ? finish() : go(i + 1));
    skip.onclick = finish;
    d.addEventListener('cancel', () => prefs.set('introSeen', true));   // Escape
    d.addEventListener('keydown', (e) => {
      if (e.target.closest('input, textarea')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    });
    // swipe between steps
    let sx = null, sy = 0;
    stage.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', (e) => {
      if (sx == null) return;
      const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(i + (dx < 0 ? 1 : -1));
    });
    d.addEventListener('close', () => { d.remove(); resolve(); });
    document.body.append(d);
    paint();
    d.showModal();
    next.focus();
  });
}
