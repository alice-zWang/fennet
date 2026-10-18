// Openpage's mascot: a Koch-snowflake fractal (design F01) whose face reacts to what you do.
// Body color follows the accent color. Purely decorative: aria-hidden, never blocks the page,
// no animation when "Reduce Motion" is on, and it can be turned off in Settings.
import { prefs } from './util.js';

// Koch snowflake, 3 iterations, centered in a 160×160 box
function flake() {
  let p = [[80, 30], [127, 111], [33, 111]];
  for (let k = 0; k < 3; k++) {
    const q = [];
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const dx = (bx - ax) / 3, dy = (by - ay) / 3, c = [ax + dx, ay + dy], e = [ax + 2 * dx, ay + 2 * dy];
      q.push([ax, ay], c, [c[0] + dx * 0.5 + dy * 0.866, c[1] + dy * 0.5 - dx * 0.866], e);
    }
    p = q;
  }
  return p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}
const BODY = flake();
const INK = '#11180d';

// faces are drawn around (80, 84); eyes at x = ±10
const eyes = (r = 4) => `<g class="m-eyes"><circle cx="70" cy="80" r="${r}" fill="${INK}"/><circle cx="90" cy="80" r="${r}" fill="${INK}"/><circle cx="71.4" cy="78.4" r="${r * 0.32}" fill="#fff"/><circle cx="91.4" cy="78.4" r="${r * 0.32}" fill="#fff"/></g>`;
const smile = (w = 8, d = 7) => `<path d="M${80 - w} 90 Q80 ${90 + d} ${80 + w} 90" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
const blush = `<circle cx="63" cy="89" r="3.2" fill="#ff8fb1" opacity=".55"/><circle cx="97" cy="89" r="3.2" fill="#ff8fb1" opacity=".55"/>`;

const FACES = {
  // F01: friendly default
  happy: () => eyes() + smile(),
  // writing: round glasses, focused small smile
  studious: () => `<circle cx="70" cy="80" r="7.5" fill="#ffffffcc" stroke="${INK}" stroke-width="2"/><circle cx="90" cy="80" r="7.5" fill="#ffffffcc" stroke="${INK}" stroke-width="2"/><path d="M77.5 80 H82.5" stroke="${INK}" stroke-width="2"/><path d="M62.5 79 L58 77 M97.5 79 L102 77" stroke="${INK}" stroke-width="1.6"/>`
    + `<g class="m-eyes"><circle cx="70.5" cy="81" r="2.6" fill="${INK}"/><circle cx="90.5" cy="81" r="2.6" fill="${INK}"/></g>` + smile(5, 4),
  // erasing: "oops"
  oops: () => eyes(4.6) + `<ellipse cx="80" cy="93" rx="3.6" ry="4.4" fill="${INK}"/>` + blush,
  // lasso / selecting: curious, one raised brow
  curious: () => `<path d="M63 71 Q70 66 76 70" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>` + `<g class="m-eyes"><circle cx="70" cy="80" r="4.8" fill="${INK}"/><circle cx="90" cy="81" r="3.4" fill="${INK}"/><circle cx="71.5" cy="78.4" r="1.5" fill="#fff"/><circle cx="91" cy="79.6" r="1.1" fill="#fff"/></g>` + `<path d="M75 92 Q80 90 86 93" stroke="${INK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  // recording: headphones, happy closed eyes
  listening: () => `<path d="M52 82 A28 28 0 0 1 108 82" fill="none" stroke="${INK}" stroke-width="4"/><rect x="46" y="76" width="10" height="17" rx="4.5" fill="var(--m-accent2, #4ee6c8)" stroke="${INK}" stroke-width="1.5"/><rect x="104" y="76" width="10" height="17" rx="4.5" fill="var(--m-accent2, #4ee6c8)" stroke="${INK}" stroke-width="1.5"/>`
    + `<path d="M65 81 Q70 76 75 81 M85 81 Q90 76 95 81" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` + smile(6, 6),
  // idle: asleep
  sleepy: () => `<path d="M65 81 Q70 85 75 81 M85 81 Q90 85 95 81" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M77 92 Q80 94 83 92" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>` + blush
    + `<text class="m-z" x="104" y="58" font-family="Space Grotesk, sans-serif" font-weight="700" font-size="14" fill="${INK}">z</text>`,
  // saved / unlocked: wink + tongue
  wink: () => `<circle cx="70" cy="80" r="4.2" fill="${INK}"/><circle cx="71.3" cy="78.4" r="1.3" fill="#fff"/><path d="M85 80 Q90 76 95 80" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>` + smile(8, 8)
    + `<path d="M79 94 Q82 100 85 94" fill="#ff6f91" stroke="${INK}" stroke-width="1.2"/>`,
  // collaborator joined / new note: big shiny eyes, open smile
  excited: () => `<ellipse cx="69" cy="79" rx="6.5" ry="8" fill="#fff" stroke="${INK}" stroke-width="1.6"/><ellipse cx="91" cy="79" rx="6.5" ry="8" fill="#fff" stroke="${INK}" stroke-width="1.6"/>`
    + `<g class="m-eyes"><circle cx="70" cy="81" r="3.6" fill="${INK}"/><circle cx="92" cy="81" r="3.6" fill="${INK}"/><circle cx="71" cy="79.4" r="1.2" fill="#fff"/><circle cx="93" cy="79.4" r="1.2" fill="#fff"/></g>`
    + `<path d="M74 91 Q80 100 86 91 Z" fill="${INK}"/>`,
};
export const MOODS = Object.keys(FACES);

const all = new Set();   // every mascot on screen
let mood = 'happy', base = 'happy', revertT = 0, idleT = 0, dozed = false;

export function mascotSVG(m = mood, label = '') {
  return `<svg class="mascot-svg" viewBox="20 20 120 104" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'} focusable="false">`
    + `<polygon class="m-body" points="${BODY}"/><g class="m-face">${FACES[m]()}</g></svg>`;
}

// A mascot element; it follows every mood change until removed from the page.
export function mascot(cls = '') {
  const el = document.createElement('span');
  el.className = 'mascot ' + cls;
  el.dataset.mood = mood;
  el.innerHTML = mascotSVG(mood);
  all.add(el);
  return el;
}

function paint() {
  for (const el of [...all]) {
    if (!el.isConnected && el.dataset.placed) { all.delete(el); continue; }
    if (el.isConnected) el.dataset.placed = '1';
    if (el.dataset.mood === mood) continue;
    el.dataset.mood = mood;
    el.querySelector('.m-face').innerHTML = FACES[mood]();
    el.classList.remove('m-pop'); void el.offsetWidth; el.classList.add('m-pop');
  }
}

// Change the face. For a moment (ms), or until the next change (no ms).
export function setMood(m, ms = 0) {
  if (!FACES[m]) return;
  clearTimeout(revertT);
  mood = m;
  if (!ms) base = m; else revertT = setTimeout(() => { mood = base; paint(); }, ms);
  dozed = false;
  paint();
  restartIdle();
}

// Something is happening: wake up, and fall asleep again after a quiet while.
function restartIdle() {
  clearTimeout(idleT);
  idleT = setTimeout(() => { if (base === 'happy') { base = mood = 'sleepy'; dozed = true; paint(); } }, 90000);
}
export function nudgeIdle() {
  restartIdle();
  if (dozed) { dozed = false; base = mood = 'happy'; paint(); }   // only wake it if it dozed off by itself
}

// Tool in use → face. Called when a stroke/gesture starts and ends.
const TOOL_MOOD = { pen: 'studious', highlighter: 'studious', text: 'studious', eraser: 'oops', lasso: 'curious', laser: 'excited' };
let recording = false;
export function toolStart(tool) { if (!recording) setMood(TOOL_MOOD[tool] || 'happy'); }
export function toolEnd() { if (!recording) { clearTimeout(revertT); revertT = setTimeout(() => setMood('happy'), 1800); } }
export function recordingChanged(on) { recording = on; setMood(on ? 'listening' : 'happy'); }

export const mascotOn = () => prefs.get('mascot', true);
export function applyMascotSetting() { document.body.classList.toggle('no-mascot', !mascotOn()); }

for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => nudgeIdle(), { passive: true, capture: true });
restartIdle();
