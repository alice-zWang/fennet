// Study Stack: flashcards as a small stack of physical cards inside the Learn panel.
// Quiet and precise: flip on its vertical axis, "Again" / "Got it", Previous undoes the last choice.
// All 3D stays inside this component; nothing here touches the canvas, toolbox or zoom.
//
// Cards come from doc.study.cards ({ id, front, back, explanation?, page? }). Long-term progress is kept
// on each card (got: times answered "Got it", seen, last); the session (this sitting) is kept separately.
import { h, prefs } from './util.js';

const MASTERED = 3;   // "Got it" this many times (across sessions) counts as mastered
const reduceMotion = () => prefs.get('reduceCardMotion', false) || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function studyStack(cards, { onChange = () => {}, onPage = null, onEmpty = null } = {}) {
  const root = h('div', { class: 'stack-wrap', tabindex: '0', role: 'group', 'aria-roledescription': 'flashcards', 'aria-label': 'Flashcards. Space flips, 1 is Again, 2 is Got it, Left arrow goes back.' });
  if (!cards.length) { if (onEmpty) root.append(onEmpty()); return root; }

  // ---- session state (not saved): order of cards still to go, what happened, undo history
  const S = { queue: cards.map((c) => c.id), done: new Set(), again: 0, flipped: false, busy: false, history: [] };
  const byId = new Map(cards.map((c) => [c.id, c]));
  const live = h('p', { class: 'visually-hidden', 'aria-live': 'polite' });

  const pos = h('p', { class: 'stack-pos' });
  const stack = h('div', { class: 'stack' }, h('div', { class: 'stack-back b2', 'aria-hidden': 'true' }), h('div', { class: 'stack-back b1', 'aria-hidden': 'true' }));
  const card = h('div', { class: 'scard' });
  const front = h('div', { class: 'face front' }), back = h('div', { class: 'face back' });
  card.append(front, back);
  stack.append(card);

  const flipBtn = h('button', { type: 'button', class: 'btn stack-flip' }, 'Flip');
  const prevBtn = h('button', { type: 'button', class: 'btn ghost', title: 'Go back one card (undoes your last choice)' }, '‹ Previous');
  const againBtn = h('button', { type: 'button', class: 'btn stack-again' }, 'Again');
  const gotBtn = h('button', { type: 'button', class: 'btn primary stack-got' }, 'Got it');
  const controls = h('div', { class: 'stack-controls' }, h('div', { class: 'stack-row' }, prevBtn, flipBtn), h('div', { class: 'stack-row' }, againBtn, gotBtn));
  const body = h('div', { class: 'stack-body' }, pos, stack, controls);
  root.append(body, live);

  const total = cards.length;
  const current = () => byId.get(S.queue[0]);
  const say = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };

  function paintFaces() {
    const c = current();
    front.textContent = ''; back.textContent = '';
    front.append(h('span', { class: 'face-label' }, 'Question'), h('div', { class: 'face-text' }, c.front));
    back.append(h('span', { class: 'face-label' }, 'Answer'), h('div', { class: 'face-text' }, c.back));
    if (c.explanation) back.append(h('p', { class: 'face-note' }, c.explanation));
    if (Number.isInteger(c.page) && onPage) {                      // only when the card really knows its page
      const jump = h('button', { type: 'button', class: 'btn ghost small' }, `Go to page ${c.page + 1}`);
      jump.onclick = (e) => { e.stopPropagation(); onPage(c.page); };
      back.append(jump);
    }
    const mastery = c.got >= MASTERED ? 'Mastered' : c.seen ? `Got it ${c.got || 0} of ${MASTERED} times` : 'New card';
    back.append(h('span', { class: 'face-meta' }, mastery));
  }

  function paint() {
    if (!S.queue.length) return finish();
    const reviewed = S.done.size;
    pos.textContent = `Card ${Math.min(reviewed + 1, total)} of ${total}`;
    paintFaces();
    setFlipped(false, true);
    stack.dataset.left = String(Math.min(2, S.queue.length - 1));   // how many cards peek out behind
    prevBtn.disabled = !S.history.length;
  }

  // only the visible face is exposed to assistive tech and to Tab
  function setFlipped(on, instant) {
    S.flipped = on;
    card.classList.toggle('flipped', on);
    if (instant) { card.classList.add('no-anim'); void card.offsetWidth; card.classList.remove('no-anim'); }
    front.inert = on; back.inert = !on;
    front.setAttribute('aria-hidden', String(on)); back.setAttribute('aria-hidden', String(!on));
    againBtn.disabled = gotBtn.disabled = !on;
    flipBtn.textContent = on ? 'Show question' : 'Show answer';
  }

  function flip() {
    if (S.busy || !S.queue.length) return;
    setFlipped(!S.flipped);
    say(S.flipped ? 'Answer: ' + current().back : 'Question: ' + current().front);
  }

  // outgoing card animates away, then the next one lifts forward
  function advance(kind) {
    if (S.busy || !S.flipped || !S.queue.length) return;
    const c = current();
    S.busy = true;
    S.history.push({ id: c.id, kind, queue: [...S.queue], got: c.got || 0, seen: c.seen || 0, last: c.last || 0, again: S.again });
    c.seen = (c.seen || 0) + 1;
    c.last = Date.now();
    if (kind === 'got') { c.got = (c.got || 0) + 1; S.done.add(c.id); S.queue.shift(); }
    else { S.again++; S.queue.push(S.queue.shift()); }                  // comes back later this session
    onChange();
    say(kind === 'got' ? 'Got it.' : 'Again: this card comes back later.');
    const out = kind === 'got' ? 'leave-got' : 'leave-again';
    const settle = () => {
      if (!root.isConnected) return;                                    // panel closed mid-animation
      card.classList.remove(out);
      paint();
      if (S.queue.length) { card.classList.add('enter'); setTimeout(() => card.classList.remove('enter'), reduceMotion() ? 0 : 260); }
      S.busy = false;
    };
    if (reduceMotion()) { settle(); return; }
    card.classList.add(out);
    setTimeout(settle, 220);
  }

  // Previous: go back to the last card and undo the choice made on it
  function undo() {
    if (S.busy || !S.history.length) return;
    const last = S.history.pop();
    const c = byId.get(last.id);
    Object.assign(c, { got: last.got, seen: last.seen, last: last.last });
    S.queue = last.queue;
    S.done.delete(last.id);
    S.again = last.again;
    onChange();
    body.hidden = false;
    root.querySelector('.stack-done')?.remove();
    paint();
    setFlipped(true, true);
    say('Back to the previous card. Your last choice was undone.');
  }

  function finish() {
    body.hidden = true;
    root.querySelector('.stack-done')?.remove();
    const mastered = cards.filter((c) => (c.got || 0) >= MASTERED).length;
    const restart = h('button', { type: 'button', class: 'btn primary' }, 'Study again');
    restart.onclick = () => {
      Object.assign(S, { queue: cards.map((c) => c.id), done: new Set(), again: 0, history: [] });
      done.remove(); body.hidden = false; paint(); root.focus();
    };
    const back = h('button', { type: 'button', class: 'btn ghost' }, 'Undo last');
    back.onclick = undo;
    const done = h('div', { class: 'stack-done' },
      h('h3', {}, 'Session complete'),
      h('p', {}, `You reviewed ${S.done.size} of ${total} cards this session${S.again ? `, with ${S.again} "Again" ${S.again === 1 ? 'repeat' : 'repeats'}` : ''}.`),
      h('p', { class: 'hint' }, `Overall: ${mastered} of ${total} mastered (answered "Got it" ${MASTERED} or more times across sessions).`),
      h('div', { class: 'stack-row' }, back, restart));
    root.append(done);
    say(`Session complete. ${S.done.size} of ${total} reviewed.`);
  }

  flipBtn.onclick = flip;
  card.onclick = (e) => { if (!e.target.closest('button')) flip(); };
  againBtn.onclick = () => advance('again');
  gotBtn.onclick = () => advance('got');
  prevBtn.onclick = undo;
  root.addEventListener('keydown', (e) => {
    if (e.target.closest('button,input,textarea,select') && e.key !== 'ArrowLeft') return;
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
    else if (e.key === '1') advance('again');
    else if (e.key === '2') advance('got');
    else if (e.key === 'ArrowLeft') undo();
  });

  // restrained hover tilt (≤ 3°), only with a real mouse/trackpad, never while flipping
  if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
    stack.addEventListener('pointermove', (e) => {
      if (S.busy || reduceMotion() || e.pointerType !== 'mouse') return;
      const r = stack.getBoundingClientRect();
      stack.style.setProperty('--tilt-x', `${(((e.clientY - r.top) / r.height) - 0.5) * -6}deg`);
      stack.style.setProperty('--tilt-y', `${(((e.clientX - r.left) / r.width) - 0.5) * 6}deg`);
    });
    stack.addEventListener('pointerleave', () => { stack.style.setProperty('--tilt-x', '0deg'); stack.style.setProperty('--tilt-y', '0deg'); });
  }

  paint();
  card.classList.add('enter');
  setTimeout(() => card.classList.remove('enter'), reduceMotion() ? 0 : 320);
  return root;
}
