// Importers: Word documents (.docx), text/Markdown, PowerPoint slides (.pptx), images and scans → pages.
import { loadScript, uid, asset } from './util.js';
import { putBlob } from './db.js';
import { blankPage, textFont, PAGE_SIZES } from './render.js';

const MAMMOTH = 'vendor/mammoth.browser.min.js'; // Mammoth 1.6.0 (BSD-2), bundled
const JSZIP = 'vendor/jszip.min.js'; // JSZip 3.10.1 (MIT), bundled

export const DOC_ACCEPT = '.docx,.txt,.md,.markdown,.pptx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown';

export const isDoc = (f) => /\.(docx|txt|md|markdown|pptx)$/i.test(f.name);

export async function fileToPages(file, size = 'letter') {
  if (/\.pptx$/i.test(file.name)) return pptxToPages(file);
  if (/\.docx$/i.test(file.name)) return docxToPages(file, size);
  return textToPages(await file.text(), size, /\.(md|markdown)$/i.test(file.name));
}

// ---------- text layout: blocks [{text, size, bold}] → pages of text boxes
function layoutBlocks(blocks, size) {
  const S = PAGE_SIZES[size] || PAGE_SIZES.letter;
  const margin = 72, maxW = S.w - margin * 2 - 8, bottom = S.h - margin;
  const ctx = document.createElement('canvas').getContext('2d');
  const pages = [];
  let page = blankPage(size), y = margin, text = '';
  page.paper = { type: 'blank', color: 'white' };
  const all = [];
  for (const b of blocks) {
    const o = { size: b.size || 16, bold: !!b.bold };
    ctx.font = textFont(o);
    const lines = [];
    for (const para of b.text.split('\n')) {
      let line = '';
      for (const word of para.split(/(\s+)/)) {
        const t = line + word;
        if (ctx.measureText(t).width > maxW && line.trim()) { lines.push(line.trimEnd()); line = word.trimStart(); } else line = t;
      }
      lines.push(line);
    }
    const lh = o.size * 1.35;
    let chunk = [];
    const flush = () => {
      if (!chunk.length) return;
      page.objs.push({ id: uid(), type: 'text', x: margin, y, w: maxW + 8, text: chunk.join('\n'), size: o.size, color: '#1f2328', bold: o.bold });
      y += chunk.length * lh + 8;
      chunk = [];
    };
    let top = y;
    for (const ln of lines) {
      if (top + (chunk.length + 1) * lh + 8 > bottom) {
        flush();
        pages.push(page); page = blankPage(size); page.paper = { type: 'blank', color: 'white' };
        y = top = margin;
      }
      chunk.push(ln);
    }
    flush();
    y += o.size * 0.5;
    text += b.text + '\n';
    all.push(b.text);
  }
  pages.push(page);
  return { pages, text: all.join('\n').slice(0, 200000) };
}

export function textToPages(raw, size, markdown) {
  const blocks = [];
  for (const para of raw.replace(/\r/g, '').split(/\n{2,}/)) {
    const t = para.trim();
    if (!t) continue;
    if (markdown) {
      const m = t.match(/^(#{1,6})\s+(.*)$/s);
      if (m) { blocks.push({ text: m[2], size: [30, 24, 20, 18, 17, 16][m[1].length - 1], bold: true }); continue; }
      blocks.push({ text: t.replace(/^\s*[-*+]\s+/gm, '•  ').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1'), size: 16 });
    } else blocks.push({ text: t, size: 16 });
  }
  if (!blocks.length) blocks.push({ text: '', size: 16 });
  return layoutBlocks(blocks, size);
}

async function docxToPages(file, size) {
  await loadScript(asset(MAMMOTH));
  const { value: html } = await window.mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = [];
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase(), t = n.textContent.trim();
      if (/^h[1-6]$/.test(tag)) { if (t) blocks.push({ text: t, size: [30, 24, 20, 18, 17, 16][+tag[1] - 1], bold: true }); }
      else if (tag === 'ul' || tag === 'ol') {
        [...n.children].forEach((li, i) => { const lt = li.textContent.trim(); if (lt) blocks.push({ text: (tag === 'ol' ? `${i + 1}.  ` : '•  ') + lt, size: 16 }); });
      } else if (tag === 'table') {
        for (const tr of n.querySelectorAll('tr')) blocks.push({ text: [...tr.children].map((c) => c.textContent.trim()).join('   |   '), size: 14 });
      } else if (t) blocks.push({ text: t, size: 16 });
    }
  };
  walk(doc.body);
  if (!blocks.length) blocks.push({ text: '(This document has no text.)', size: 16 });
  return layoutBlocks(blocks, size);
}

// ---------- PowerPoint: one landscape page per slide with its text boxes and pictures
async function pptxToPages(file) {
  await loadScript(asset(JSZIP));
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const xml = async (p) => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('text'), 'application/xml') : null; };
  const pres = await xml('ppt/presentation.xml');
  const sz = pres && pres.getElementsByTagName('p:sldSz')[0];
  const cx = sz ? +sz.getAttribute('cx') : 12192000, cy = sz ? +sz.getAttribute('cy') : 6858000;
  const W = 1056, H = Math.round((W * cy) / cx), k = W / cx;
  const slideFiles = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => +a.match(/(\d+)\.xml/)[1] - +b.match(/(\d+)\.xml/)[1]);
  const pages = [];
  let allText = '';
  for (const sf of slideFiles) {
    const doc = await xml(sf);
    const rels = await xml(sf.replace('slides/', 'slides/_rels/') + '.rels');
    const relMap = {};
    if (rels) for (const r of rels.getElementsByTagName('Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');
    const page = { id: uid(), w: W, h: H, objs: [], paper: { type: 'blank', color: 'white' } };
    const box = (el) => {
      const off = el.getElementsByTagName('a:off')[0], ext = el.getElementsByTagName('a:ext')[0];
      if (!off || !ext) return null;
      return { x: +off.getAttribute('x') * k, y: +off.getAttribute('y') * k, w: +ext.getAttribute('cx') * k, h: +ext.getAttribute('cy') * k };
    };
    for (const pic of doc.getElementsByTagName('p:pic')) {
      const blip = pic.getElementsByTagName('a:blip')[0], b = box(pic);
      const target = blip && relMap[blip.getAttribute('r:embed')];
      if (!target || !b) continue;
      const path = 'ppt/' + target.replace(/^\.\.\//, '');
      const f = zip.file(path);
      if (!f || !/\.(png|jpe?g|gif|webp)$/i.test(path)) continue;
      const ext = path.split('.').pop().toLowerCase().replace('jpg', 'jpeg');
      const blob = new Blob([await f.async('arraybuffer')], { type: 'image/' + ext });
      page.objs.push({ id: uid(), type: 'image', blob: await putBlob(blob), ...b });
    }
    let slideText = '';
    for (const sp of doc.getElementsByTagName('p:sp')) {
      const paras = [...sp.getElementsByTagName('a:p')].map((p) => [...p.getElementsByTagName('a:t')].map((t) => t.textContent).join('')).filter(Boolean);
      if (!paras.length) continue;
      const b = box(sp) || { x: 60, y: 60 + page.objs.length * 40, w: W - 120, h: 40 };
      const rpr = sp.getElementsByTagName('a:rPr')[0];
      const isTitle = [...sp.getElementsByTagName('p:ph')].some((ph) => /title/i.test(ph.getAttribute('type') || ''));
      const pt = rpr && rpr.getAttribute('sz') ? +rpr.getAttribute('sz') / 100 : isTitle ? 36 : 20;
      const text = paras.join('\n');
      page.objs.push({
        id: uid(), type: 'text', x: b.x, y: b.y, w: Math.max(120, b.w), text, size: Math.round(Math.min(48, Math.max(11, pt * 1.25 * (W / 960)))),
        color: '#1f2328', bold: isTitle || (rpr && rpr.getAttribute('b') === '1'),
      });
      slideText += text + '\n';
    }
    allText += slideText + '\n';
    pages.push(page);
  }
  if (!pages.length) throw new Error('No slides found in this file');
  return { pages, text: allText.slice(0, 200000) };
}

// Image blobs (photos/scans) → one page each, image fitted to the page.
export async function imagesToPages(blobs, size = 'letter', margin = 0) {
  const pages = [];
  for (const blob of blobs) {
    const bmp = await createImageBitmap(blob);
    const p = blankPage(size);
    p.paper = { type: 'blank', color: 'white' };
    let w = p.w - 2 * margin, ht = (w * bmp.height) / bmp.width;
    if (ht > p.h - 2 * margin) { ht = p.h - 2 * margin; w = (ht * bmp.width) / bmp.height; }
    bmp.close && bmp.close();
    p.objs.push({ id: uid(), type: 'image', blob: await putBlob(blob), x: (p.w - w) / 2, y: margin, w, h: ht });
    pages.push(p);
  }
  return pages;
}
