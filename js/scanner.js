// Document scanner: camera or photo → detect page edges → adjust corners → flatten → filter.
// Resolves with an array of JPEG blobs (one per scanned page), or [] if cancelled.
import { h, pickFiles, toast, clamp, prefs } from './util.js';

// ---------- image math
function gray(img, maxSide) {
  const k = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k)), ht = Math.max(1, Math.round(img.height * k));
  const c = h('canvas', { width: w, height: ht });
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, ht);
  const d = ctx.getImageData(0, 0, w, ht).data, g = new Uint8Array(w * ht);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) | 0;
  return { g, w, h: ht, k };
}

function otsu(g) {
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

// Find the largest bright region (the paper) and take its extreme corners.
export function detectCorners(img) {
  const { g, w, h: ht, k } = gray(img, 320);
  const th = otsu(g);
  const seen = new Uint8Array(w * ht);
  let bestPts = null, bestN = 0;
  const stack = [];
  for (let start = 0; start < g.length; start++) {
    if (seen[start] || g[start] <= th) continue;
    let n = 0, tl = [0, 0, Infinity], tr = [0, 0, -Infinity], br = [0, 0, -Infinity], bl = [0, 0, Infinity];
    stack.push(start); seen[start] = 1;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0;
      n++;
      if (x + y < tl[2]) tl = [x, y, x + y];
      if (x + y > br[2]) br = [x, y, x + y];
      if (x - y > tr[2]) tr = [x, y, x - y];
      if (x - y < bl[2]) bl = [x, y, x - y];
      const nb = [i - 1, i + 1, i - w, i + w];
      if (x === 0) nb[0] = -1; if (x === w - 1) nb[1] = -1;
      for (const j of nb) if (j >= 0 && j < g.length && !seen[j] && g[j] > th) { seen[j] = 1; stack.push(j); }
    }
    if (n > bestN) { bestN = n; bestPts = [tl, tr, br, bl]; }
  }
  const W = img.width, H = img.height;
  if (!bestPts || bestN < g.length * 0.12) {
    return [[W * 0.06, H * 0.06], [W * 0.94, H * 0.06], [W * 0.94, H * 0.94], [W * 0.06, H * 0.94]];
  }
  return bestPts.map(([x, y]) => [x / k, y / k]);
}

// Homography mapping unit-square-ish destination rect → source quad.
function homography(src, dw, dh) {
  const dst = [[0, 0], [dw, 0], [dw, dh], [0, dh]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  // Gaussian elimination
  for (let c = 0; c < 8; c++) {
    let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  return b.map((v, i) => v / A[i][i]);
}

export function warp(img, quad) {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let dw = Math.max(dist(quad[0], quad[1]), dist(quad[3], quad[2]));
  let dh = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]));
  const k = Math.min(1, 2200 / Math.max(dw, dh));
  dw = Math.round(dw * k); dh = Math.round(dh * k);
  const sc = h('canvas', { width: img.width, height: img.height });
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const S = sctx.getImageData(0, 0, img.width, img.height).data, SW = img.width, SH = img.height;
  const out = h('canvas', { width: dw, height: dh });
  const octx = out.getContext('2d');
  const O = octx.createImageData(dw, dh), D = O.data;
  const [a, b, c, d, e, f, g, hh] = homography(quad, dw, dh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const den = g * x + hh * y + 1;
      const u = (a * x + b * y + c) / den, v = (d * x + e * y + f) / den;
      const x0 = Math.floor(u), y0 = Math.floor(v);
      const o = (y * dw + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= SW - 1 || y0 >= SH - 1) { D[o] = D[o + 1] = D[o + 2] = 255; D[o + 3] = 255; continue; }
      const fx = u - x0, fy = v - y0, i00 = (y0 * SW + x0) * 4, i10 = i00 + 4, i01 = i00 + SW * 4, i11 = i01 + 4;
      for (let ch = 0; ch < 3; ch++) {
        D[o + ch] = (S[i00 + ch] * (1 - fx) + S[i10 + ch] * fx) * (1 - fy) + (S[i01 + ch] * (1 - fx) + S[i11 + ch] * fx) * fy;
      }
      D[o + 3] = 255;
    }
  }
  octx.putImageData(O, 0, 0);
  sc.width = sc.height = 0;
  return out;
}

export function applyFilter(canvas, mode) {
  if (mode === 'color') return canvas;
  const w = canvas.width, ht = canvas.height;
  const out = h('canvas', { width: w, height: ht });
  const ctx = out.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, w, ht), d = img.data;
  const g = new Float32Array(w * ht);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  if (mode === 'gray') {
    for (let i = 0; i < g.length; i++) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g[i];
  } else {
    // "Document" mode: adaptive threshold against a local mean (integral image).
    const I = new Float64Array((w + 1) * (ht + 1));
    for (let y = 0; y < ht; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    const r = Math.max(8, Math.round(Math.min(w, ht) / 40));
    for (let y = 0; y < ht; y++) {
      const ya = Math.max(0, y - r), yb = Math.min(ht, y + r + 1);
      for (let x = 0; x < w; x++) {
        const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
        const sum = I[yb * (w + 1) + xb] - I[ya * (w + 1) + xb] - I[yb * (w + 1) + xa] + I[ya * (w + 1) + xa];
        const mean = sum / ((xb - xa) * (yb - ya));
        const v = g[y * w + x] < mean * 0.88 ? Math.max(0, g[y * w + x] - 60) : 255;
        const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = v;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

const toBlob = (c) => new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
const fileToImage = (f) => createImageBitmap(f, { imageOrientation: 'from-image' }).catch(() => null);

// ---------- UI
export function scanDocuments() {
  return new Promise((resolve) => {
    const results = [];
    const d = h('dialog', { class: 'modal scanner' });
    document.body.append(d);
    let stream = null, mode = prefs.get('scanFilter', 'doc');
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    d.addEventListener('close', () => { stop(); d.remove(); resolve(results); });
    const count = h('span', { class: 'scan-count' });
    const setCount = () => { count.textContent = results.length ? `${results.length} page${results.length > 1 ? 's' : ''} scanned` : ''; };

    const showCapture = async () => {
      d.textContent = '';
      const video = h('video', { autoplay: true, playsinline: true, muted: true });
      const snap = h('button', { class: 'btn primary', type: 'button' }, 'Capture');
      const pick = h('button', { class: 'btn', type: 'button' }, 'Choose photo');
      const done = h('button', { class: 'btn', type: 'button' }, 'Done');
      const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
      d.append(h('h2', {}, 'Scan documents'), h('div', { class: 'scan-stage' }, video),
        h('div', { class: 'actions' }, count, h('span', { style: { flex: 1 } }), cancel, pick, results.length ? done : '', snap));
      setCount();
      cancel.onclick = () => { results.length = 0; d.close(); };
      done.onclick = () => d.close();
      pick.onclick = async () => {
        const files = await pickFiles('image/*', { multiple: true });
        for (const f of files) { const img = await fileToImage(f); if (img) { await adjust(img); return; } }
      };
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1920 } } });
          video.srcObject = stream;
        } catch { video.replaceWith(h('p', { class: 'audio-empty' }, 'Camera not available. Use "Choose photo" to pick or take a picture.')); snap.disabled = true; }
      } else { snap.disabled = true; }
      snap.onclick = async () => {
        if (!video.videoWidth) return;
        const c = h('canvas', { width: video.videoWidth, height: video.videoHeight });
        c.getContext('2d').drawImage(video, 0, 0);
        stop();
        await adjust(await createImageBitmap(c));
      };
    };

    const adjust = async (img) => {
      stop();
      d.textContent = '';
      let quad = detectCorners(img);
      const stage = h('div', { class: 'scan-stage' });
      const cv = h('canvas', { class: 'scan-canvas' });
      stage.append(cv);
      const maxW = Math.min(innerWidth - 80, 760), maxH = innerHeight - 260;
      const k = Math.min(maxW / img.width, maxH / img.height, 1);
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      const ctx = cv.getContext('2d');
      const draw = () => {
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        ctx.fillStyle = 'rgba(43,110,245,.15)'; ctx.strokeStyle = '#2b6ef5'; ctx.lineWidth = 2;
        ctx.beginPath(); quad.forEach(([x, y], i) => ctx[i ? 'lineTo' : 'moveTo'](x * k, y * k)); ctx.closePath(); ctx.fill(); ctx.stroke();
        for (const [x, y] of quad) { ctx.beginPath(); ctx.arc(x * k, y * k, 11, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }
      };
      draw();
      let drag = -1;
      cv.addEventListener('pointerdown', (e) => {
        const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
        let best = -1, bd = 40 / k;
        quad.forEach(([qx, qy], i) => { const dd = Math.hypot(qx - x, qy - y); if (dd < bd) { bd = dd; best = i; } });
        drag = best;
        if (drag >= 0) { cv.setPointerCapture(e.pointerId); e.preventDefault(); }
      });
      cv.addEventListener('pointermove', (e) => {
        if (drag < 0) return;
        const r = cv.getBoundingClientRect();
        quad[drag] = [clamp((e.clientX - r.left) / k, 0, img.width), clamp((e.clientY - r.top) / k, 0, img.height)];
        draw();
      });
      cv.addEventListener('pointerup', () => { drag = -1; });
      const seg = h('div', { class: 'seg' });
      const modes = [['doc', 'Document'], ['gray', 'Grayscale'], ['color', 'Color']];
      const drawSeg = () => {
        seg.textContent = '';
        for (const [m, l] of modes) { const b = h('button', { type: 'button', class: m === mode ? 'on' : '' }, l); b.onclick = () => { mode = m; prefs.set('scanFilter', m); drawSeg(); }; seg.append(b); }
      };
      drawSeg();
      const full = h('button', { class: 'btn', type: 'button' }, 'Whole photo');
      full.onclick = () => { quad = [[0, 0], [img.width, 0], [img.width, img.height], [0, img.height]]; draw(); };
      const retake = h('button', { class: 'btn', type: 'button' }, 'Retake');
      retake.onclick = () => showCapture();
      const keep = h('button', { class: 'btn', type: 'button' }, 'Keep & scan more');
      const finish = h('button', { class: 'btn primary', type: 'button' }, 'Save');
      const process = async () => {
        finish.disabled = keep.disabled = true;
        finish.textContent = 'Processing…';
        await new Promise((r) => setTimeout(r, 30));
        const flat = warp(img, quad);
        const out = applyFilter(flat, mode);
        results.push(await toBlob(out));
        flat.width = out.width = 0;
      };
      keep.onclick = async () => { await process(); toast(`Page ${results.length} saved`); showCapture(); };
      finish.onclick = async () => { await process(); d.close(); };
      d.append(h('h2', {}, 'Adjust the corners'), stage,
        h('div', { class: 'actions' }, seg, full, h('span', { style: { flex: 1 } }), retake, keep, finish));
    };

    d.showModal();
    showCapture();
  });
}
