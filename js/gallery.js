// Template gallery: search 200+ templates, pick paper color (any RGB), line color and page size,
// or use your own image/PDF page as a template.
import { h, pickFiles, toast, prefs } from './util.js';
import { modal } from './ui.js';
import { putBlob, loadImage } from './db.js';
import { TEMPLATES, TEMPLATE_CATS, LINE_COLORS, drawTemplate } from './templates.js';
import { PAGE_SIZES, PAPER_COLORS, paperFill, isDarkPaper, pdfToPages, renderPageCanvas } from './render.js';
import { pickColor } from './colorpicker.js';

function drawPreview(c, type, paper, customBlob) {
  const ctx = c.getContext('2d');
  ctx.setTransform(c.width / 816, 0, 0, c.height / 1056, 0, 0);
  ctx.fillStyle = paperFill(paper);
  ctx.fillRect(0, 0, 816, 1056);
  if (type === 'custom') { if (customBlob) loadImage(customBlob).then((img) => img && ctx.drawImage(img, 0, 0, 816, 1056)); }
  else drawTemplate(ctx, type, 816, 1056, isDarkPaper(paper), paper.line, 4.5);
}

/**
 * opts: { title, paper, size, scopes: [['page','This page'],['all','All pages']] | null, okLabel }
 * resolves { paper, size, scope } or null
 */
export async function templateGallery({ title = 'Templates', paper = { type: 'lined', color: 'white' }, size = 'letter', scopes = null, okLabel = 'Apply' } = {}) {
  const cur = { ...paper, line: paper.line || 'blue', size, scope: scopes ? scopes[0][0] : null };
  let cat = prefs.get('galleryCat', 'All'), query = '';
  const recent = prefs.get('recentTemplates', []);
  const res = await modal({
    title,
    wide: true,
    body: (b) => {
      const search = h('input', { type: 'search', placeholder: `Search ${TEMPLATES.length} templates (e.g. "cornell", "weekly", "basketball")`, 'aria-label': 'Search templates' });
      const cats = h('nav', { class: 'gal-cats' });
      const grid = h('div', { class: 'choice-grid gal-grid' });
      const io = new IntersectionObserver((entries) => {
        for (const en of entries) if (en.isIntersecting) { const c = en.target; io.unobserve(c); drawPreview(c, c.dataset.type, cur, cur.blob); }
      }, { root: grid, rootMargin: '200px' });
      const drawCats = () => {
        cats.textContent = '';
        const list = ['All', ...(recent.length ? ['Recent'] : []), ...TEMPLATE_CATS, 'Custom'];
        for (const c of list) {
          const n = c === 'All' ? TEMPLATES.length : c === 'Recent' ? recent.length : c === 'Custom' ? '' : TEMPLATES.filter((t) => t.cat === c).length;
          const x = h('button', { type: 'button', class: c === cat && !query ? 'on' : '' }, h('span', {}, c), h('span', { class: 'count' }, String(n)));
          x.onclick = () => { cat = c; query = ''; search.value = ''; prefs.set('galleryCat', c); drawCats(); drawGrid(); };
          cats.append(x);
        }
      };
      const card = (type, name, on, onClick) => {
        const c = h('canvas', { width: 156, height: 202, 'data-type': type });
        const ch = h('button', { type: 'button', class: 'choice' + (on ? ' on' : ''), title: name }, c, h('span', { class: 'nm' }, name));
        ch.onclick = onClick;
        io.observe(c);
        return ch;
      };
      const drawGrid = () => {
        grid.textContent = '';
        grid.scrollTop = 0;
        if (!query && (cat === 'Custom' || cur.type === 'custom')) {
          const own = h('button', { type: 'button', class: 'choice' }, h('span', { class: 'own' }, '+'), h('span', { class: 'nm' }, 'Use an image or PDF…'));
          own.onclick = async () => {
            const [f] = await pickFiles('image/*,application/pdf,.pdf');
            if (!f) return;
            try {
              let blob = f;
              if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
                const { pages } = await pdfToPages(await putBlob(f));
                const c = await renderPageCanvas(pages[0], {}, 2);
                blob = await new Promise((r) => c.toBlob(r, 'image/png'));
              }
              cur.type = 'custom'; cur.blob = await putBlob(blob); cat = 'Custom';
              drawCats(); drawGrid();
            } catch (e) { toast('Could not use that file: ' + e.message); }
          };
          grid.append(own);
          if (cur.type === 'custom' && cur.blob) grid.append(card('custom', 'Your template', true, () => {}));
          if (cat === 'Custom') return;
        }
        const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        let list = TEMPLATES;
        if (q.length) list = TEMPLATES.filter((t) => q.every((w) => t.tags.includes(w)));
        else if (cat === 'Recent') list = recent.map((id) => TEMPLATES.find((t) => t.id === id)).filter(Boolean);
        else if (cat !== 'All') list = TEMPLATES.filter((t) => t.cat === cat);
        if (!list.length) grid.append(h('p', { class: 'hint' }, 'No templates match.'));
        for (const t of list) {
          grid.append(card(t.id, t.name, cur.type === t.id, () => {
            cur.type = t.id; delete cur.blob;
            for (const x of grid.querySelectorAll('.choice.on')) x.classList.remove('on');
            grid.querySelector(`canvas[data-type="${t.id}"]`)?.parentElement.classList.add('on');
          }));
        }
      };
      const redrawPreviews = () => { for (const c of grid.querySelectorAll('canvas[data-type]')) drawPreview(c, c.dataset.type, cur, cur.blob); };
      search.oninput = () => { query = search.value; drawCats(); drawGrid(); };

      const colors = h('div', { class: 'color-row' });
      const drawColors = () => {
        colors.textContent = '';
        for (const [k, c] of Object.entries(PAPER_COLORS)) {
          const s = h('button', { type: 'button', class: 'swatch' + (cur.color === k ? ' on' : ''), title: k, 'aria-label': k + ' paper', style: { background: c } });
          s.onclick = () => { cur.color = k; drawColors(); redrawPreviews(); };
          colors.append(s);
        }
        const custom = cur.color && cur.color[0] === '#';
        const more = h('button', { type: 'button', class: 'swatch custom' + (custom ? ' on' : ''), title: 'Any color (RGB / HEX)', 'aria-label': 'Custom paper color' });
        if (custom) more.style.background = cur.color;
        more.onclick = async () => {
          const prev = cur.color;
          const c = await pickColor(more, paperFill(cur), { title: 'Paper color', onChange: (x) => { cur.color = x; redrawPreviews(); } });
          cur.color = c || prev; drawColors(); redrawPreviews();
        };
        colors.append(more);
      };
      const lineSel = h('select', { 'aria-label': 'Line color' }, ...Object.entries(LINE_COLORS).map(([k, v]) => h('option', { value: k, selected: cur.line === k }, v.label)));
      lineSel.onchange = () => { cur.line = lineSel.value; redrawPreviews(); };
      const sizeSel = h('select', { 'aria-label': 'Page size' }, ...Object.entries(PAGE_SIZES).map(([k, s]) => h('option', { value: k, selected: cur.size === k }, s.label)));
      sizeSel.onchange = () => { cur.size = sizeSel.value; };
      drawCats(); drawGrid(); drawColors();
      const bottom = h('div', { class: 'row wrap' },
        h('div', { class: 'field' }, h('span', {}, 'Paper color'), colors),
        h('label', { class: 'field' }, h('span', {}, 'Lines'), lineSel),
        h('label', { class: 'field' }, h('span', {}, 'Page size'), sizeSel));
      if (scopes) {
        const seg = h('div', { class: 'seg' });
        const drawScope = () => {
          seg.textContent = '';
          for (const [v, l] of scopes) { const x = h('button', { type: 'button', class: cur.scope === v ? 'on' : '' }, l); x.onclick = () => { cur.scope = v; drawScope(); }; seg.append(x); }
        };
        drawScope();
        bottom.append(h('div', { class: 'field' }, h('span', {}, 'Apply to'), seg));
      }
      b.append(search, h('div', { class: 'gal' }, cats, grid), bottom);
    },
    actions: [{ label: 'Cancel', value: null }, { label: okLabel, primary: true, value: true }],
  });
  if (!res) return null;
  const out = { type: cur.type, color: cur.color, line: cur.line };
  if (cur.type === 'custom') out.blob = cur.blob;
  else prefs.set('recentTemplates', [cur.type, ...recent.filter((x) => x !== cur.type)].slice(0, 18));
  return { paper: out, size: cur.size, scope: cur.scope };
}
