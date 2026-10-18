// Light / dark / system appearance and the user's accent color.
// The accent is one color the user picks; from it we derive versions that stay readable:
//   --accent-fill   buttons, selected tools, progress bars (the color itself)
//   --on-accent     text and icons drawn on top of the fill (near-black or white)
//   --accent        text and icons drawn on the page background (darkened or lightened for 4.5:1 contrast)
//   --accent-on-dark  accent text on the dark chips and hero art, in every theme
//   --accent-soft / --accent-glow  tinted backgrounds and glows
import { prefs } from './util.js';
import { hexToRgb, rgbToHex } from './colorpicker.js';

export const DEFAULT_ACCENT = '#b8ff2c';
export const ACCENT_PRESETS = [
  ['#b8ff2c', 'Lime'], ['#4ee6c8', 'Mint'], ['#5cb8ff', 'Sky'], ['#7c8cff', 'Indigo'],
  ['#b28cff', 'Violet'], ['#ff6fcf', 'Pink'], ['#ff6b6b', 'Coral'], ['#ffb547', 'Amber'],
];

// background colors the accent must stay readable against (match styles.css)
const SURFACES = {
  light: { bg: '#ffffff', worst: '#e3e9da', meta: '#f4f6f0' },
  dark: { bg: '#050705', worst: '#1a2418', meta: '#050705' },
};
const DARK_CHIP = '#050705';

const lum = (hex) => {
  const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, t) => { const p = hexToRgb(a), q = hexToRgb(b); return rgbToHex(...p.map((v, i) => v + (q[i] - v) * t)); };

// move the color toward black or white until it reaches the target contrast against `bg`
function readableOn(color, bg, target = 4.5) {
  const toward = lum(bg) > 0.4 ? '#000000' : '#ffffff';
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const c = mix(color, toward, t);
    if (contrast(c, bg) >= target) return c;
  }
  return toward;
}

export function effectiveTheme() {
  const t = prefs.get('theme', 'system');
  if (t === 'light' || t === 'dark') return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// hue (degrees) and saturation (0-1) of a hex color
function hueSat(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return [0, 0];
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0];
}
// the hero fractal is rendered in lime; turn it toward the chosen accent
function artFilter(accent) {
  const [h, sat] = hueSat(accent), [lime] = hueSat(DEFAULT_ACCENT);
  if (sat < 0.25) return 'grayscale(1) brightness(1.15)';
  return `hue-rotate(${Math.round(h - lime)}deg)`;
}

export function accentTokens(accent, mode) {
  const s = SURFACES[mode];
  return {
    '--accent-fill': accent,
    '--on-accent': contrast('#071003', accent) >= contrast('#ffffff', accent) ? '#071003' : '#ffffff',
    '--accent': readableOn(accent, s.worst),
    '--accent-on-dark': readableOn(accent, DARK_CHIP),
    '--accent-soft': mix(s.bg, accent, mode === 'dark' ? 0.14 : 0.16),
    '--accent-glow': accent + '40',
    '--art-filter': artFilter(accent),
  };
}

export function applyTheme() {
  const t = prefs.get('theme', 'system');
  const root = document.documentElement;
  if (t === 'system') delete root.dataset.theme; else root.dataset.theme = t;
  const mode = effectiveTheme();
  const accent = prefs.get('accent', DEFAULT_ACCENT);
  for (const [k, v] of Object.entries(accentTokens(accent, mode))) root.style.setProperty(k, v);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', SURFACES[mode].meta);
}

// follow the iPad's light/dark switch while "System" is selected
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (prefs.get('theme', 'system') === 'system') applyTheme(); });
