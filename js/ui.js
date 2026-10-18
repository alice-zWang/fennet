// Menus and dialogs.
import { h } from './util.js';
import { icon } from './icons.js';

let openMenu = null;
export function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
}

// items: [{label, icon, action, danger}] | 'sep' | {heading}
export function menu(anchor, items, { x, y } = {}) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it === 'sep') { m.append(h('hr')); continue; }
    if (it.heading) { m.append(h('div', { class: 'label' }, it.heading)); continue; }
    const b = h('button', { class: it.danger ? 'danger' : '', role: 'menuitem', html: (it.icon ? icon(it.icon) : '') });
    b.append(it.label);
    b.onclick = (e) => { e.stopPropagation(); closeMenu(); it.action(); };
    m.append(b);
  }
  document.body.append(m);
  const r = anchor ? anchor.getBoundingClientRect() : { left: x, right: x, bottom: y, top: y };
  const mw = m.offsetWidth, mh = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = Math.max(8, left) + 'px';
  m.style.top = top + 'px';
  openMenu = m;
  setTimeout(() => {
    const off = (e) => {
      if (openMenu === m && !m.contains(e.target)) { closeMenu(); }
      if (openMenu !== m) document.removeEventListener('pointerdown', off, true);
    };
    document.addEventListener('pointerdown', off, true);
  });
  return m;
}

// Generic modal. body: Node or (bodyEl) => void. actions: [{label, value, primary, danger}]
// Resolves with the clicked action's value, or null if dismissed.
export function modal({ title, body, actions = [{ label: 'OK', value: true, primary: true }], onOpen, wide = false, cls = '' }) {
  return new Promise((resolve) => {
    const d = h('dialog', { class: 'modal' + (wide ? ' wide' : '') + (cls ? ' ' + cls : '') });
    const form = h('form', { method: 'dialog' });
    const bodyEl = h('div', { class: 'body' });
    if (typeof body === 'function') body(bodyEl); else if (body) bodyEl.append(body);
    const acts = h('div', { class: 'actions' });
    let result = null;
    for (const a of actions) {
      const b = h('button', {
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        type: a.primary ? 'submit' : 'button',
      }, a.label);
      b.onclick = (e) => { e.preventDefault(); result = typeof a.value === 'function' ? a.value(bodyEl) : a.value; d.close(); };
      acts.append(b);
    }
    form.append(title ? h('h2', {}, title) : '', bodyEl, acts);
    form.onsubmit = (e) => {
      e.preventDefault();
      const p = actions.find((a) => a.primary);
      if (p) { result = typeof p.value === 'function' ? p.value(bodyEl) : p.value; d.close(); }
    };
    d.append(form);
    document.body.append(d);
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.showModal();
    // On touch screens don't pop up the keyboard just because a dialog opened.
    if (matchMedia('(pointer: coarse)').matches && document.activeElement && document.activeElement.matches('input, textarea')) document.activeElement.blur();
    onOpen && onOpen(bodyEl, d);
  });
}

export async function promptText(title, value = '', { placeholder = '', okLabel = 'Save' } = {}) {
  let input;
  return modal({
    title,
    body: (b) => { input = h('input', { type: 'text', value, placeholder }); b.append(input); },
    actions: [{ label: 'Cancel', value: null }, { label: okLabel, primary: true, value: () => input.value.trim() || null }],
    onOpen: () => { input.focus(); input.select(); },
  });
}

export async function confirmDlg(message, { title = 'Are you sure?', okLabel = 'Delete', danger = true } = {}) {
  return modal({
    title,
    body: h('div', {}, message),
    actions: [{ label: 'Cancel', value: false }, { label: okLabel, value: true, primary: true, danger }],
  });
}

// Anchored popover holding arbitrary content; closes on outside tap or Escape.
let openPop = null;
export function popover(anchor, content, { cls = '' } = {}) {
  if (openPop) openPop();
  const p = h('div', { class: 'menu popover ' + cls });
  p.append(content);
  document.body.append(p);
  const r = anchor.getBoundingClientRect(), pw = p.offsetWidth, ph = p.offsetHeight;
  let top = r.bottom + 6;
  if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  p.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
  p.style.top = top + 'px';
  const close = () => { p.remove(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc, true); if (openPop === close) openPop = null; };
  const off = (e) => { if (!p.contains(e.target) && !anchor.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', esc, true); });
  openPop = close;
  return close;
}
