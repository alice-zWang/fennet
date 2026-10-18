// Handwriting recognition, on-device.
//  • Page indexing for handwriting search: Tesseract.js (Apache-2.0) runs OCR on an ink-only render.
//  • Converting a selection to text: the browser's Handwriting Recognition API when present
//    (uses the actual pen strokes), otherwise Tesseract.
import { loadScript, prefs, asset } from './util.js';

const TESS = 'vendor/tesseract/'; // Tesseract.js 5.1.1 + core + English model (Apache-2.0), bundled
let workerP = null;

export const ocrEnabled = () => prefs.get('ocr', true);

async function worker() {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(asset(TESS + 'tesseract.min.js'));
      return window.Tesseract.createWorker('eng', 1, {
        workerPath: asset(TESS + 'worker.min.js'),
        corePath: asset(TESS),
        langPath: asset(TESS + 'lang'),
      });
    })();
    workerP.catch(() => { workerP = null; });
  }
  return workerP;
}

// Ink-only render (dark strokes on white, highlighter skipped) for OCR.
function inkCanvas(strokes, box, scale) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(box.w * scale));
  c.height = Math.max(1, Math.round(box.h * scale));
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(scale, 0, 0, scale, -box.x * scale, -box.y * scale);
  ctx.strokeStyle = ctx.fillStyle = '#000';
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (s.tool === 'highlighter') continue;
    const p = s.pts;
    ctx.lineWidth = Math.max(2, s.size * 1.1);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
    if (p.length === 3) ctx.lineTo(p[0] + 0.1, p[1]);
    ctx.stroke();
  }
  return c;
}

export function inkSignature(page) {
  let n = 0, sum = 0;
  for (const o of page.objs) if (o.type === 'stroke' && o.tool !== 'highlighter') { n++; sum += o.pts.length + o.pts[0] + o.pts[1]; }
  return n ? `${n}:${Math.round(sum)}` : '';
}

// Recognize all handwriting on a page. Returns {sig, text, words:[{t, b:[x0,y0,x1,y1]}]} in page units.
export async function recognizePage(page) {
  const strokes = page.objs.filter((o) => o.type === 'stroke' && o.tool !== 'highlighter');
  const sig = inkSignature(page);
  if (!strokes.length) return { sig, text: '', words: [] };
  const scale = 1.4;
  const c = inkCanvas(strokes, { x: 0, y: 0, w: page.w, h: page.h }, scale);
  const w = await worker();
  const { data } = await w.recognize(c);
  c.width = c.height = 0;
  const words = (data.words || [])
    .filter((wd) => wd.confidence > 35 && /\w/.test(wd.text))
    .map((wd) => ({ t: wd.text, b: [wd.bbox.x0 / scale, wd.bbox.y0 / scale, wd.bbox.x1 / scale, wd.bbox.y1 / scale].map(Math.round) }));
  return { sig, text: words.map((x) => x.t).join(' '), words };
}

// Convert specific strokes to text (for "Convert to text" on a lasso selection).
export async function recognizeStrokes(strokes) {
  if ('createHandwritingRecognizer' in navigator) {
    try {
      const rec = await navigator.createHandwritingRecognizer({ languages: [navigator.language || 'en'] });
      const drawing = rec.startDrawing({ recognitionType: 'text' });
      for (const s of strokes) {
        if (s.tool === 'highlighter') continue;
        const st = new window.HandwritingStroke();
        for (let i = 0; i < s.pts.length; i += 3) st.addPoint({ x: s.pts[i], y: s.pts[i + 1], t: i * 4 });
        drawing.addStroke(st);
      }
      const preds = await drawing.getPrediction();
      drawing.clear && drawing.clear();
      rec.finish && rec.finish();
      if (preds && preds[0] && preds[0].text) return preds[0].text;
    } catch (e) { console.warn('Handwriting API failed, using OCR', e); }
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (let i = 0; i < s.pts.length; i += 3) {
    x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]); y1 = Math.max(y1, s.pts[i + 1]);
  }
  const pad = 20, box = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const scale = Math.min(3, Math.max(1, 900 / box.w));
  const c = inkCanvas(strokes, box, scale);
  const w = await worker();
  const { data } = await w.recognize(c);
  return (data.text || '').trim();
}

// PNG (base64, no prefix) of strokes for sending to a vision model.
export function strokesImage(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) for (let i = 0; i < s.pts.length; i += 3) {
    x0 = Math.min(x0, s.pts[i]); x1 = Math.max(x1, s.pts[i]); y0 = Math.min(y0, s.pts[i + 1]); y1 = Math.max(y1, s.pts[i + 1]);
  }
  const pad = 24, box = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  const c = inkCanvas(strokes, box, Math.min(2, 1400 / box.w));
  return c.toDataURL('image/png').split(',')[1];
}
