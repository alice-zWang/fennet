// Demo mode: open the app with ?demo to see it filled with sample notes (for design reviews and
// screenshots). Storage is separate from real notes and starts fresh on every visit.
//
// Link options (combine with &):
//   ?demo                     library, dark theme
//   &theme=light|dark|system  appearance
//   &accent=4ee6c8            accent color (hex, without #)
//   &note=1..5                open that sample note
//   &panel=learn|outline|study|find|history   open a side panel in the note (needs &note)
//   &settings=1               open Settings
import { prefs, uid, DEMO } from './util.js';
import { db } from './db.js';
import { blankPage } from './render.js';

const params = new URLSearchParams(location.search);
const PEN = '#1f2328', BLUE = '#2b5bd7', RED = '#d23b3b', GREEN = '#1f8a4c', HL = '#ffe14d';
const r1 = (v) => Math.round(v * 10) / 10;

// ---- little drawing helpers (page units, letter page 816 × 1056)
const stroke = (pts, { color = PEN, size = 2.2, brush = 'ballpoint', tool = 'pen', shape = false } = {}) =>
  ({ id: uid(), type: 'stroke', tool, brush, color, size, pts: pts.flatMap(([x, y, p = 0.55]) => [r1(x), r1(y), p]), ...(shape ? { shape: true } : {}) });
const text = (x, y, w, t, { size = 18, color = PEN, bold = false } = {}) => ({ id: uid(), type: 'text', x, y, w, text: t, size, color, bold });
const line = (x1, y1, x2, y2, o) => stroke([[x1, y1, 0.5], [x2, y2, 0.5]], { ...o, shape: true });
const poly = (pts, o) => stroke([...pts, pts[0]].map(([x, y]) => [x, y, 0.5]), { ...o, shape: true });
const circle = (cx, cy, r, o) => stroke(Array.from({ length: 49 }, (_, i) => [cx + r * Math.cos(i / 48 * Math.PI * 2), cy + r * Math.sin(i / 48 * Math.PI * 2), 0.5]), { ...o, shape: true });
// handwriting-like scribble: connected cursive loops (a prolate cycloid) with ascenders and
// descenders here and there, split into "words", with natural pressure
function scribble(x, y, width, { seed = 1, color = PEN, size = 2, h = 9 } = {}) {
  const out = [];
  let rnd = seed * 7919 % 233280;
  const rand = () => ((rnd = (rnd * 9301 + 49297) % 233280) / 233280);
  let cx = x;
  while (cx < x + width - 24) {
    const letters = 2 + Math.floor(rand() * 6), pts = [];
    let px = cx;
    for (let l = 0; l < letters; l++) {
      const kind = rand(), tall = kind < 0.18 ? 2.3 : kind > 0.9 ? -1.6 : 1;   // ascender, descender, or x-height
      const w = 6 + rand() * 3, loop = w * 0.62;
      for (let t = 0; t <= Math.PI * 2; t += 0.22) {
        const lift = (1 - Math.cos(t)) / 2;
        const yy = tall > 0 ? y - h * tall * lift : y - h * lift + (t > Math.PI ? h * -tall * Math.sin((t - Math.PI) / 2) : 0);
        pts.push([px + (w * t) / (Math.PI * 2) - loop * Math.sin(t) * 0.5 + (y - yy) * 0.28, yy, 0.42 + 0.22 * lift + (rand() - 0.5) * 0.05]);
      }
      px += w;
    }
    out.push(stroke(pts, { color, size }));
    cx = px + 9 + rand() * 7;
  }
  return out;
}
const highlight = (x1, x2, y) => stroke([[x1, y, 0.5], [x2, y, 0.5]], { tool: 'highlighter', brush: 'straight', color: HL, size: 18, shape: true });

function page(paperType, objs) { const p = blankPage('letter'); p.objs = objs; if (paperType) p.paper = { type: paperType, color: 'white' }; return p; }

const NOTES = [
  {
    title: 'MP4G Practice · Set 3', subject: 0, paper: 'cornell', fav: true, ago: 0.2,
    objs: () => [
      text(212, 70, 560, 'Problem 7 · Triangle ABC', { size: 24, bold: true }),
      text(212, 112, 560, 'In triangle ABC, AB = 13, BC = 14, CA = 15. Find the length of the altitude from A to BC.', { size: 16 }),
      text(24, 160, 150, 'Heron\'s formula', { size: 14, color: BLUE }),
      text(24, 300, 150, 'Area = ½ · base · height', { size: 14, color: BLUE }),
      poly([[300, 380], [560, 380], [390, 200]], { size: 2.6 }),
      line(390, 200, 390, 380, { color: RED, size: 2, brush: 'fineliner' }),
      text(280, 386, 30, 'B', { size: 16 }), text(566, 386, 30, 'C', { size: 16 }), text(378, 178, 30, 'A', { size: 16 }),
      text(400, 300, 60, 'h = ?', { size: 15, color: RED }),
      ...scribble(212, 470, 520, { seed: 7 }),
      ...scribble(212, 506, 460, { seed: 11 }),
      text(212, 540, 520, 's = 21,  Area = √(21·8·7·6) = 84', { size: 18 }),
      highlight(212, 520, 552),
      text(212, 590, 520, '84 = ½ · 14 · h  →  h = 12', { size: 20, bold: true, color: GREEN }),
      poly([[204, 580], [520, 580], [520, 624], [204, 624]], { color: GREEN, size: 2.2 }),
      text(24, 880, 760, 'Summary: find the area first (Heron), then solve for the height.', { size: 15 }),
    ],
  },
  {
    title: 'Modular arithmetic tricks', subject: 1, paper: 'grid', fav: true, ago: 5,
    objs: () => [
      text(60, 60, 600, 'Modular arithmetic', { size: 26, bold: true }),
      text(60, 110, 680, 'a ≡ b (mod n) means n divides a − b.', { size: 18 }),
      text(60, 150, 680, 'Last two digits of 7^2026: work mod 100.', { size: 18 }),
      ...scribble(60, 220, 640, { seed: 21, color: BLUE }),
      ...scribble(60, 262, 560, { seed: 25, color: BLUE }),
      text(60, 300, 680, '7^4 = 2401 ≡ 1 (mod 100)  ⇒  7^2026 = (7^4)^506 · 7^2 ≡ 49', { size: 18 }),
      poly([[50, 340], [620, 340], [620, 392], [50, 392]], { color: RED, size: 2 }),
      text(64, 352, 540, 'Answer: last two digits are 49', { size: 20, bold: true, color: RED }),
    ],
  },
  {
    title: 'Counting with symmetry', subject: 2, paper: 'coord-1', ago: 26,
    objs: () => {
      const hex = Array.from({ length: 6 }, (_, i) => [408 + 120 * Math.cos(i * Math.PI / 3), 520 + 120 * Math.sin(i * Math.PI / 3)]);
      return [
        text(60, 60, 680, 'Necklaces with 6 beads, 2 colors', { size: 24, bold: true }),
        text(60, 104, 680, 'Burnside: average the number of colorings fixed by each rotation.', { size: 17 }),
        poly(hex, { size: 2.6 }),
        ...hex.map(([x, y], i) => circle(x, y, 14, { color: i % 2 ? BLUE : RED, size: 3 })),
        ...scribble(60, 760, 600, { seed: 31 }),
        text(60, 800, 680, '(64 + 2 + 4 + 8 + 4 + 2) / 6 = 14 necklaces', { size: 19, bold: true }),
      ];
    },
  },
  {
    title: 'Cell structure lecture', subject: 3, paper: 'lined', ago: 50,
    objs: () => [
      text(70, 46, 600, 'Cell structure', { size: 26, bold: true }),
      ...scribble(70, 150, 640, { seed: 41 }), ...scribble(70, 182, 560, { seed: 43 }), ...scribble(70, 214, 600, { seed: 47 }),
      highlight(70, 400, 214),
      stroke(Array.from({ length: 61 }, (_, i) => [408 + 190 * Math.cos(i / 60 * Math.PI * 2), 470 + 110 * Math.sin(i / 60 * Math.PI * 2), 0.55]), { color: GREEN, size: 3 }),
      circle(440, 470, 42, { color: '#7a3fd1', size: 2.6 }),
      text(500, 380, 200, 'nucleus', { size: 15, color: '#7a3fd1' }), line(495, 392, 470, 440, { color: '#7a3fd1', size: 1.6 }),
      text(160, 600, 260, 'cell membrane', { size: 15, color: GREEN }), line(250, 598, 290, 545, { color: GREEN, size: 1.6 }),
      ...scribble(70, 690, 620, { seed: 51 }), ...scribble(70, 722, 540, { seed: 53 }),
    ],
  },
  {
    title: 'Weekly study plan', subject: null, paper: 'planner', ago: 120,
    objs: () => [
      ...scribble(150, 150, 300, { seed: 61, color: BLUE }),
      ...scribble(150, 246, 260, { seed: 63, color: BLUE }),
      text(150, 330, 400, 'MP4G mock test, 2 hours', { size: 17, bold: true, color: RED }),
      ...scribble(150, 438, 340, { seed: 67 }),
    ],
  },
];
// Sample study material (clearly part of the demo; real notes get theirs from AI).
const card = (front, back, extra = {}) => ({ id: uid(), front, back, ...extra });
const STUDY = {
  'MP4G Practice · Set 3': () => ({
    summary: '## Overview\nFinding an altitude in a 13-14-15 triangle by computing the area first.\n\n## Key points\n- **Heron\'s formula:** Area = √(s(s−a)(s−b)(s−c)), with s the semi-perimeter.\n- For 13-14-15: s = 21, Area = √(21·8·7·6) = 84.\n- **Area = ½ · base · height**, so the altitude to BC is h = 2·84 / 14 = **12**.\n\n## Terms\n- **Semi-perimeter:** half the perimeter, s = (a + b + c) / 2.\n- **Altitude:** the perpendicular segment from a vertex to the opposite side.',
    study: {
      cardsSource: 'Whole note (demo sample)',
      cards: [
        card('Heron\'s formula', 'Area = √(s(s−a)(s−b)(s−c)), where s is the semi-perimeter.', { page: 0 }),
        card('Semi-perimeter of a 13-14-15 triangle', 's = (13 + 14 + 15) / 2 = 21'),
        card('Area of the 13-14-15 triangle', '√(21·8·7·6) = √7056 = 84', { page: 0 }),
        card('Area in terms of a base and its height', 'Area = ½ · base · height'),
        card('Altitude from A to BC (BC = 14)', 'h = 2 · 84 / 14 = 12', { explanation: 'Solve 84 = ½ · 14 · h for h.', page: 0 }),
        card('What is an altitude?', 'The perpendicular segment from a vertex to the line containing the opposite side.'),
        card('The 13-14-15 triangle splits into two right triangles with legs…', '5-12-13 and 9-12-15 (the altitude 12 is shared).'),
        card('Why compute the area first?', 'Area links all three sides (Heron) to any one altitude (½ · base · height).'),
        card('Altitude to the side of length 13', 'h = 2 · 84 / 13 = 168/13 ≈ 12.92'),
        card('Altitude to the side of length 15', 'h = 2 · 84 / 15 = 11.2'),
        card('Inradius r of the 13-14-15 triangle', 'r = Area / s = 84 / 21 = 4'),
        card('Circumradius R of the 13-14-15 triangle', 'R = abc / (4·Area) = 2730 / 336 = 65/8'),
      ],
      quizSource: 'Whole note (demo sample)',
      quiz: [
        { question: 'What is the semi-perimeter of a triangle with sides 13, 14, 15?', choices: ['21', '42', '14', '19.5'], answer: 0, explanation: 's = (13 + 14 + 15) / 2 = 21.' },
        { question: 'What is the area of the 13-14-15 triangle?', choices: ['72', '84', '91', '105'], answer: 1, explanation: '√(21·8·7·6) = √7056 = 84.' },
        { question: 'What is the altitude to the side of length 14?', choices: ['10', '11.2', '12', '13'], answer: 2, explanation: '84 = ½ · 14 · h gives h = 12.' },
        { question: 'What is the inradius?', choices: ['3', '4', '5', '6'], answer: 1, explanation: 'r = Area / s = 84 / 21 = 4.' },
        { question: 'Which pair of right triangles does the altitude to BC create?', choices: ['3-4-5 and 6-8-10', '5-12-13 and 9-12-15', '8-15-17 and 7-24-25', '6-8-10 and 9-12-15'], answer: 1, explanation: 'BC = 14 splits into 5 + 9 with the shared height 12.' },
      ],
      blanksSource: 'Whole note (demo sample)',
      blanks: [
        { prompt: 'Heron\'s formula uses the ___ s = (a + b + c) / 2.', answer: 'semi-perimeter', explanation: 'Half the perimeter.' },
        { prompt: 'Area = ½ · base · ___.', answer: 'height', explanation: 'The altitude to that base.' },
        { prompt: 'The 13-14-15 triangle has area ___.', answer: '84', explanation: '√(21·8·7·6).' },
        { prompt: 'The altitude from A to BC is ___.', answer: '12', explanation: '2·84 / 14.' },
      ],
    },
  }),
  'Modular arithmetic tricks': () => ({
    summary: '## Overview\nUsing a small power that is ≡ 1 to find last digits of huge powers.\n\n## Key points\n- a ≡ b (mod n) means n divides a − b.\n- 7⁴ = 2401 ≡ 1 (mod 100), so powers of 7 repeat every 4 steps mod 100.\n- 2026 = 4·506 + 2, so 7²⁰²⁶ ≡ 7² = **49** (mod 100).',
    study: { cardsSource: 'Whole note (demo sample)', cards: [
      card('a ≡ b (mod n) means…', 'n divides a − b.'),
      card('7⁴ mod 100', '2401 ≡ 1 (mod 100)'),
      card('Last two digits of 7²⁰²⁶', '49, since 2026 ≡ 2 (mod 4) and 7² = 49.'),
      card('Why reduce the exponent mod 4?', 'Because 7⁴ ≡ 1, powers of 7 repeat with period 4 mod 100.'),
    ] },
  }),
};

const SUBJECTS = [['Geometry', '#b8ff2c'], ['Number Theory', '#4ee6c8'], ['Combinatorics', '#ffb547'], ['Biology 101', '#ff6fcf']];

// Fresh sample library + demo-friendly settings. Runs before anything is shown.
export async function setupDemo(app) {
  if (!DEMO) return false;
  await new Promise((res) => { const r = indexedDB.deleteDatabase('openpage-demo'); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  for (const k of Object.keys(localStorage)) if (k.startsWith('fn-demo:')) localStorage.removeItem(k);
  prefs.set('profile', { name: 'Demo', id: 'demo', created: Date.now() });
  prefs.set('lockMethod', 'none');
  prefs.set('penSeen', true);
  prefs.set('theme', ['light', 'dark', 'system'].includes(params.get('theme')) ? params.get('theme') : 'dark');
  const accent = (params.get('accent') || '').replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(accent)) prefs.set('accent', '#' + accent.toLowerCase());
  app.notes = app.notes || [];
  const subjects = SUBJECTS.map(([name, color]) => ({ id: uid(), name, color, dividerId: null, edited: Date.now() }));
  for (const s of subjects) await db.put('subjects', s);
  const now = Date.now();
  for (const n of NOTES) {
    const pages = [page(null, n.objs()), page(null, [])];
    const note = await app.newNote({ title: n.title, pages, subjectId: n.subject == null ? null : subjects[n.subject].id, paper: { type: n.paper, color: 'white' } });
    note.updated = now - n.ago * 3600e3;
    note.created = note.updated - 864e5;
    note.favorite = !!n.fav;
    note.pageCount = pages.length;
    await db.put('notes', note);
  }
  // ready-made study material for the first two notes, so Learn can be explored without AI
  const notes = await db.all('notes');
  for (const [title, extra] of Object.entries(STUDY)) {
    const n = notes.find((x) => x.title === title);
    const c = n && await db.get('content', n.id);
    if (c) { Object.assign(c, extra()); await db.put('content', c); }
  }
  document.documentElement.classList.add('demo');
  return true;
}

// After the library is ready: open the screen the link asks for.
export async function openDemoView(app) {
  if (!DEMO) return;
  // label the demo quietly in the brand row instead of a badge floating over content
  const v = document.querySelector('.brand-version');
  if (v) { v.textContent = 'demo'; v.title = 'Demo: sample notes, changes aren\'t saved'; }
  document.title = 'Openpage demo';
  const n = parseInt(params.get('note'), 10);
  if (n >= 1 && n <= NOTES.length) {
    const note = (await db.all('notes')).find((x) => x.title === NOTES[n - 1].title);
    const tab = { learn: 'ai', outline: 'outline', study: 'study', find: 'find', history: 'history' }[params.get('panel')];
    if (note) { if (tab) app.pendingPanel = { id: note.id, tab }; app.openNote(note.id); }
  } else if (params.get('settings')) {
    setTimeout(() => app.settings(), 300);
  }
}
