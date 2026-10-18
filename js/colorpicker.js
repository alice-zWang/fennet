// Color picker popover: saturation/brightness square, hue slider, R/G/B and HEX fields, saved colors.
import { h, prefs, clamp } from './util.js';

export const hexToRgb = (hex) => {
  let x = String(hex).replace('#', '').trim();
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(x)) return null;
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16));
};
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hh = 0;
  if (d) {
    if (max === r) hh = ((g - b) / d) % 6; else if (max === g) hh = (b - r) / d + 2; else hh = (r - g) / d + 4;
    hh *= 60; if (hh < 0) hh += 360;
  }
  return [hh, max ? d / max : 0, max];
}
function hsvToRgb(hh, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export const savedColors = () => prefs.get('savedColors', []);
function setSaved(list) { prefs.set('savedColors', list.slice(0, 30)); }

let open = null;
export function closeColorPicker() { if (open) open(null); }

/** Opens near `anchor`. Resolves with "#rrggbb" or null. onChange fires live while picking. */
export function pickColor(anchor, initial = '#1f2328', { onChange, title = 'Color' } = {}) {
  closeColorPicker();
  return new Promise((resolve) => {
    let [r, g, b] = hexToRgb(initial) || [31, 35, 40];
    let [hue, sat, val] = rgbToHsv(r, g, b);
    const pop = h('div', { class: 'cpicker', role: 'dialog', 'aria-label': title });
    const sv = h('canvas', { class: 'cp-sv', width: 240, height: 160 });
    const hueBar = h('canvas', { class: 'cp-hue', width: 240, height: 16 });
    const preview = h('span', { class: 'cp-preview' });
    const num = (label) => {
      const i = h('input', { type: 'number', min: 0, max: 255, inputmode: 'numeric', 'aria-label': label });
      return [i, h('label', { class: 'cp-num' }, h('span', {}, label), i)];
    };
    const [ri, rl] = num('R'), [gi, gl] = num('G'), [bi, bl] = num('B');
    const hexIn = h('input', { type: 'text', class: 'cp-hex', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex color' });
    const savedRow = h('div', { class: 'cp-saved' });
    const ok = h('button', { class: 'btn primary small', type: 'button' }, 'Use color');
    const cancel = h('button', { class: 'btn small', type: 'button' }, 'Cancel');
    const save = h('button', { class: 'btn ghost small', type: 'button', title: 'Save this color' }, '+ Save');

    pop.append(h('div', { class: 'cp-title' }, title), sv, hueBar,
      h('div', { class: 'cp-fields' }, preview, rl, gl, bl, h('label', { class: 'cp-num' }, h('span', {}, 'HEX'), hexIn)),
      h('div', { class: 'cp-saved-head' }, h('span', {}, 'Saved colors'), save), savedRow,
      h('div', { class: 'cp-actions' }, cancel, ok));
    document.body.append(pop);

    const drawSV = () => {
      const c = sv.getContext('2d'), W = sv.width, H = sv.height;
      const [hr, hg, hb] = hsvToRgb(hue, 1, 1);
      c.fillStyle = `rgb(${hr},${hg},${hb})`; c.fillRect(0, 0, W, H);
      const wg = c.createLinearGradient(0, 0, W, 0); wg.addColorStop(0, '#fff'); wg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = wg; c.fillRect(0, 0, W, H);
      const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, 'rgba(0,0,0,0)'); bg.addColorStop(1, '#000'); c.fillStyle = bg; c.fillRect(0, 0, W, H);
      const x = sat * W, y = (1 - val) * H;
      c.lineWidth = 2; c.strokeStyle = val > 0.5 ? '#000' : '#fff'; c.beginPath(); c.arc(x, y, 7, 0, 7); c.stroke();
    };
    const drawHue = () => {
      const c = hueBar.getContext('2d'), W = hueBar.width, H = hueBar.height;
      const gr = c.createLinearGradient(0, 0, W, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      const x = (hue / 360) * W; c.lineWidth = 3; c.strokeStyle = '#fff'; c.strokeRect(x - 3, 1, 6, H - 2);
    };
    const hex = () => rgbToHex(r, g, b);
    const sync = (from) => {
      if (from !== 'rgb') { ri.value = Math.round(r); gi.value = Math.round(g); bi.value = Math.round(b); }
      if (from !== 'hex') hexIn.value = hex();
      preview.style.background = hex();
      drawSV(); drawHue();
      onChange && onChange(hex());
    };
    const fromHSV = () => { [r, g, b] = hsvToRgb(hue, sat, val).map(Math.round); sync('hsv'); };
    // Grays have no hue: keep the current one so the hue slider doesn't jump.
    const fromRGB = (from) => { const [hh, s2, v2] = rgbToHsv(r, g, b); if (s2 > 0 && v2 > 0) hue = hh; sat = s2; val = v2; sync(from); };

    const drag = (el, fn) => {
      el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); fn(e); e.preventDefault(); });
      el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) fn(e); });
    };
    drag(sv, (e) => { const rc = sv.getBoundingClientRect(); sat = clamp((e.clientX - rc.left) / rc.width, 0, 1); val = clamp(1 - (e.clientY - rc.top) / rc.height, 0, 1); fromHSV(); });
    drag(hueBar, (e) => { const rc = hueBar.getBoundingClientRect(); hue = clamp(((e.clientX - rc.left) / rc.width) * 360, 0, 359.9); fromHSV(); });
    for (const [inp, idx] of [[ri, 0], [gi, 1], [bi, 2]]) {
      inp.addEventListener('input', () => {
        const v = clamp(parseInt(inp.value || '0', 10) || 0, 0, 255);
        if (idx === 0) r = v; else if (idx === 1) g = v; else b = v;
        fromRGB('rgb');
      });
      inp.addEventListener('change', () => { inp.value = Math.round([r, g, b][idx]); });
    }
    hexIn.addEventListener('input', () => { const c = hexToRgb(hexIn.value); if (c) { [r, g, b] = c; fromRGB('hex'); } });

    const drawSaved = () => {
      savedRow.textContent = '';
      const list = savedColors();
      if (!list.length) savedRow.append(h('span', { class: 'hint' }, 'No saved colors yet.'));
      for (const c of list) {
        const sw = h('button', { type: 'button', class: 'swatch', style: { background: c }, title: c + ' (right-click or long-press to remove)', 'aria-label': 'Saved color ' + c });
        sw.onclick = () => { [r, g, b] = hexToRgb(c); fromRGB(); };
        const remove = (e) => { e.preventDefault(); setSaved(savedColors().filter((x) => x !== c)); drawSaved(); };
        sw.oncontextmenu = remove;
        let t; sw.onpointerdown = (e) => { t = setTimeout(() => remove(e), 650); }; sw.onpointerup = sw.onpointerleave = () => clearTimeout(t);
        savedRow.append(sw);
      }
    };
    save.onclick = () => { const c = hex(); setSaved([c, ...savedColors().filter((x) => x !== c)]); drawSaved(); };
    drawSaved();
    sync();

    // position
    const rc = anchor ? anchor.getBoundingClientRect() : { left: innerWidth / 2 - 140, bottom: 80, top: 80 };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let top = rc.bottom + 8; if (top + ph > innerHeight - 8) top = Math.max(8, rc.top - ph - 8);
    pop.style.left = clamp(rc.left - pw / 2 + 14, 8, innerWidth - pw - 8) + 'px';
    pop.style.top = top + 'px';

    const outside = (e) => { if (!pop.contains(e.target)) done(null); };
    const key = (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && document.activeElement !== cancel) done(hex()); };
    const done = (v) => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      pop.remove();
      open = null;
      resolve(v);
    };
    open = done;
    ok.onclick = () => done(hex());
    cancel.onclick = () => done(null);
    setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', key, true); });
  });
}
