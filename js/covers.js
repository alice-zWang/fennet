// Library cover: the art behind the big "Continue" card on the home screen.
// Fractal art (Julia set, fern), plain colors, gradients, or the user's own image or PDF page.
// Art drawn from a white shape (CSS mask) follows the accent color. The choice lives in prefs:
//   cover      { kind: 'art' | 'color' | 'gradient' | 'image', id?, color?, a?, b? }
//   coverImage a downscaled JPEG data URL (only for kind 'image')
import { $, h, prefs, toast, pickFiles } from './util.js';
import { modal } from './ui.js';
import { icon } from './icons.js';
import { pickColor } from './colorpicker.js';
import { contrast } from './theme.js';
import { pdfjs } from './render.js';

const C = 'icons/design/covers/';
const JULIA = 'z² + c  ·  c = −0.835 − 0.2321i';
const FERN = 'Barnsley fern  ·  4 affine maps';

// tone: which text color the card needs on top ('dark' art → light text)
export const ART = [
  { id: 'julia', name: 'Julia set', tone: 'dark', caption: JULIA, paint: () => `<img class="cover-photo fractal" src="${C}julia-dark.jpg" alt="">` },
  { id: 'julia-light', name: 'Julia set, paper', tone: 'light', caption: JULIA, paint: () => `<img class="cover-photo fractal" src="${C}julia-light.jpg" alt="">` },
  { id: 'spiral', name: 'Spiral arm', tone: 'dark', caption: 'Julia set  ·  one spiral arm',
    paint: () => `<div class="cover-bg" style="background:radial-gradient(90% 120% at 80% 50%, #1d3410, #0C110C 70%)"></div><div class="cover-mask" style="--src:url(${C}spiral.png); right:-4%; top:50%; width:58%; aspect-ratio:1; transform:translateY(-50%)"></div>` },
  { id: 'fern', name: 'Fern', tone: 'dark', caption: FERN,
    paint: () => `<div class="cover-bg" style="background:radial-gradient(90% 120% at 82% 40%, #1d3410, #0C110C 70%)"></div><div class="cover-mask" style="--src:url(${C}fern.png); right:6%; top:-28%; width:26%; aspect-ratio:1077/2048; transform:rotate(-58deg); transform-origin:50% 70%"></div>` },
  { id: 'fiddlehead', name: 'Fiddlehead', tone: 'dark', caption: 'Barnsley fern, curled',
    paint: () => `<div class="cover-bg" style="background:radial-gradient(90% 120% at 80% 40%, #1d3410, #0C110C 70%)"></div><div class="cover-mask" style="--src:url(${C}fiddlehead.png); right:-2%; top:4%; width:56%; aspect-ratio:2048/1917"></div>` },
  { id: 'fern-paper', name: 'Fern, paper', tone: 'light', caption: FERN,
    paint: () => `<div class="cover-bg" style="background:#F4F8EE"></div><div class="cover-mask" style="--src:url(${C}fern.png); --ink:#2f5a00; right:6%; top:-28%; width:26%; aspect-ratio:1077/2048; transform:rotate(-58deg); transform-origin:50% 70%"></div>` },
];
export const COLORS = ['#0C110C', '#1d3410', '#14161c', '#B8FF2C', '#F4F8EE', '#F2786B', '#5CB8FF', '#A98BFF', '#FFC447'];
export const GRADIENTS = [
  { id: 'lime-glow', name: 'Lime glow', css: 'radial-gradient(120% 160% at 88% 30%, #B8FF2C 0%, #3d6a12 32%, #0C110C 72%)', tone: 'dark' },
  { id: 'aurora', name: 'Aurora', css: 'linear-gradient(115deg, #0C110C 0%, #12403a 45%, #1f7a5c 75%, #B8FF2C 125%)', tone: 'dark' },
  { id: 'ocean', name: 'Ocean', css: 'linear-gradient(115deg, #071a2e, #0f4c81 55%, #2d8cff 85%, #7ee8fa 120%)', tone: 'dark' },
  { id: 'dusk', name: 'Dusk', css: 'linear-gradient(115deg, #1a0b2e, #4a1d6b 50%, #d16ba5 100%)', tone: 'dark' },
  { id: 'ember', name: 'Ember', css: 'linear-gradient(115deg, #1a0a06, #6b1d12 55%, #F2786B 100%)', tone: 'dark' },
  { id: 'mint', name: 'Mint', css: 'linear-gradient(115deg, #f4ffe2, #d8ffa0 55%, #B8FF2C 100%)', tone: 'light' },
  { id: 'sunrise', name: 'Sunrise', css: 'linear-gradient(115deg, #fff1d6, #ffd36e 50%, #ff9a8b 100%)', tone: 'light' },
  { id: 'peach', name: 'Peach', css: 'linear-gradient(115deg, #fff4ee, #ffd1c1 55%, #ffb1a1 100%)', tone: 'light' },
  { id: 'sky', name: 'Sky', css: 'linear-gradient(115deg, #f2f9ff, #c9e6ff 55%, #8fd0ff 100%)', tone: 'light' },
];
const DEFAULT = { kind: 'art', id: 'julia' };
// only well-formed values ever reach the HTML below
const hex = (v, d = '#0C110C') => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
const toneOf = (hex) => (contrast(hex, '#000000') > contrast(hex, '#ffffff') ? 'light' : 'dark');
const mid = (a, b) => '#' + [1, 3, 5].map((i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, '0')).join('');

export const currentCover = () => prefs.get('cover', DEFAULT);

// what a cover looks like: { html, tone, caption, plain (no dark wash needed) }
function describe(c) {
  if (c.kind === 'color') { const k = hex(c.color); return { html: `<div class="cover-bg" style="background:${k}"></div>`, tone: toneOf(k), caption: '', plain: true }; }
  if (c.kind === 'gradient') {
    const a = hex(c.a), b = hex(c.b, '#B8FF2C');
    const g = c.id === 'custom' ? { css: `linear-gradient(115deg, ${a}, ${b})`, tone: toneOf(mid(a, b)) } : GRADIENTS.find((x) => x.id === c.id) || GRADIENTS[0];
    return { html: `<div class="cover-bg" style="background:${g.css}"></div>`, tone: g.tone, caption: '', plain: true };
  }
  if (c.kind === 'image') {
    const src = prefs.get('coverImage', null);
    if (typeof src === 'string' && /^data:image\/jpeg;base64,[a-z0-9+/=]+$/i.test(src)) return { html: `<img class="cover-photo" src="${src}" alt="">`, tone: 'dark', caption: '' };
  }
  const a = ART.find((x) => x.id === c.id) || ART[0];
  return { html: a.paint(), tone: a.tone, caption: a.caption };
}

// paint the library card (or a preview tile)
export function paintCover(target = $('#continue-card'), c = currentCover()) {
  if (!target) return;
  const d = describe(c);
  const layer = target.querySelector('.continue-art, .cover-tile-art');
  layer.innerHTML = d.html;
  target.classList.toggle('cover-light', d.tone === 'light');
  target.classList.toggle('cover-plain', !!d.plain);
  const cap = target.querySelector('.continue-coords');
  if (cap) { cap.textContent = d.caption; cap.hidden = !d.caption; }
}

const same = (a, b) => a.kind === b.kind && (a.id || a.color || '') === (b.id || b.color || '');

// your own picture: images, or the first page of a PDF; kept small enough for on-device settings
export async function importCover(file) {
  const MAX = 2000;
  let canvas;
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const page = await doc.getPage(1);
    const v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(4, 1600 / v1.width) });
    canvas = h('canvas', { width: Math.round(vp.width), height: Math.round(vp.height) });
    const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: g, viewport: vp, intent: 'print' }).promise;   // 'print' doesn't wait on animation frames
    doc.destroy();
  } else {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas = h('canvas', { width: Math.round(img.naturalWidth * s), height: Math.round(img.naturalHeight * s) });
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    } finally { URL.revokeObjectURL(url); }
  }
  for (const q of [0.85, 0.7, 0.55]) {
    const data = canvas.toDataURL('image/jpeg', q);
    prefs.set('coverImage', data);
    if (prefs.get('coverImage', null) === data) return true;
  }
  toast('That picture is too large to keep. Try a smaller one.');
  return false;
}

export function coverPicker() {
  let cur = currentCover();
  const card = $('#continue-card');
  const choose = (c) => { cur = c; prefs.set('cover', c); paintCover(card, c); mark(); };
  const tiles = [];
  const tile = (c, label, onPick) => {
    const art = h('span', { class: 'cover-tile-art', 'aria-hidden': 'true' });
    const b = h('button', { type: 'button', class: 'cover-tile', 'aria-label': label, title: label }, art, h('span', { class: 'cover-tile-name' }, label));
    b._cover = c;
    paintCover(b, c);
    b.onclick = () => (onPick ? onPick(b) : choose(c));
    tiles.push(b);
    return b;
  };
  const mark = () => { for (const t of tiles) t.setAttribute('aria-pressed', String(!!t._cover && same(t._cover, cur))); };

  const grid = (...kids) => h('div', { class: 'cover-grid' }, ...kids);
  const art = grid(...ART.map((a) => tile({ kind: 'art', id: a.id }, a.name)));
  const customColor = tile({ kind: 'color', color: cur.kind === 'color' ? cur.color : '#3d6a12' }, 'Custom color', async (b) => {
    const was = cur;
    const picked = await pickColor(b, b._cover.color, { title: 'Cover color', onChange: (hex) => paintCover(card, { kind: 'color', color: hex }) });
    if (picked) { b._cover = { kind: 'color', color: picked }; paintCover(b, b._cover); choose(b._cover); } else paintCover(card, was);
  });
  customColor.classList.add('custom');
  const colors = grid(...COLORS.map((c) => tile({ kind: 'color', color: c }, c)), customColor);
  const customGrad = tile(cur.kind === 'gradient' && cur.id === 'custom' ? cur : { kind: 'gradient', id: 'custom', a: '#0C110C', b: '#B8FF2C' }, 'Your two colors', async (b) => {
    const g = { ...b._cover };
    const a = await pickColor(b, g.a, { title: 'First color', onChange: (hex) => paintCover(card, { ...g, a: hex }) });
    if (!a) { paintCover(card, cur); return; }
    const c2 = await pickColor(b, g.b, { title: 'Second color', onChange: (hex) => paintCover(card, { ...g, a, b: hex }) });
    if (!c2) { paintCover(card, cur); return; }
    b._cover = { kind: 'gradient', id: 'custom', a, b: c2 }; paintCover(b, b._cover); choose(b._cover);
  });
  customGrad.classList.add('custom');
  const gradients = grid(...GRADIENTS.map((g) => tile({ kind: 'gradient', id: g.id }, g.name)), customGrad);

  const imgTile = tile({ kind: 'image' }, 'Your picture');
  const refreshImg = () => { imgTile.hidden = !prefs.get('coverImage', null); paintCover(imgTile, { kind: 'image' }); };
  const pick = async (accept) => {
    const [f] = await pickFiles(accept);
    if (!f) return;
    try { if (await importCover(f)) { refreshImg(); choose({ kind: 'image' }); } } catch (e) { console.warn(e); toast('Couldn\'t open that file'); }
  };
  const btnImg = h('button', { type: 'button', class: 'btn', html: icon('image') }, 'Choose a picture…');
  btnImg.onclick = () => pick('image/*');
  const btnPdf = h('button', { type: 'button', class: 'btn', html: icon('doc') }, 'Use a PDF page…');
  btnPdf.onclick = () => pick('application/pdf,.pdf');
  const btnDel = h('button', { type: 'button', class: 'btn ghost' }, 'Remove picture');
  btnDel.onclick = () => { prefs.set('coverImage', null); if (cur.kind === 'image') choose(DEFAULT); refreshImg(); };
  const mine = h('div', { class: 'cover-mine' }, grid(imgTile),
    h('div', { class: 'cover-mine-actions' }, btnImg, btnPdf, btnDel),
    h('small', {}, 'Pictures stay on this device. A PDF uses its first page.'));
  refreshImg();

  const panes = { art, colors, gradients, mine };
  const tabs = h('div', { class: 'seg cover-tabs', role: 'tablist', 'aria-label': 'Cover type' });
  const show = (k) => { for (const [id, p] of Object.entries(panes)) p.hidden = id !== k; for (const b of tabs.children) { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); } };
  for (const [k, label] of [['art', 'Art'], ['colors', 'Colors'], ['gradients', 'Gradients'], ['mine', 'Your picture']]) {
    const b = h('button', { type: 'button', role: 'tab', 'data-k': k }, label);
    b.onclick = () => show(k);
    tabs.append(b);
  }
  show({ art: 'art', color: 'colors', gradient: 'gradients', image: 'mine' }[cur.kind] || 'art');
  mark();
  return modal({ title: 'Library cover', cls: 'cover-modal', body: h('div', { class: 'cover-picker' }, tabs, art, colors, gradients, mine), actions: [{ label: 'Done', value: true, primary: true }] });
}
