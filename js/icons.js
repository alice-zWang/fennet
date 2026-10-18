// Original line icons (24x24, stroked with currentColor).
const P = {
  pencil: '<path d="m4 20 1-5L16 4l4 4L9 19zM13 7l4 4M5 15l4 4"/>',
  ruler: '<path d="m3 16 13-13 5 5L8 21zM12 7l2 2M9 10l3 3M6 13l2 2M15 4l3 3"/>',
  sticker: '<path d="M20 13V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h8zM13 20v-5a2 2 0 0 1 2-2h5"/><path d="M7 8h8M7 11h5"/>',
  hand: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-4a1.5 1.5 0 0 1 3 0v7c0 4-3 6-6 6h-2c-2 0-3-1-4-3l-4-5a1.5 1.5 0 0 1 2-2l3 3"/>',
  tape: '<path d="m4 7 3-3h13l-2 3 2 3-3 3H4l2-3zM4 14h13l-2 3 2 3H4l2-3z"/>',

  back: '<path d="M15 18l-6-6 6-6"/>',
  pen: '<path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z"/><path d="M13.6 7.2l3.2 3.2"/>',
  highlighter: '<path d="M7 14l7.5-9.5 5 4L12 18z"/><path d="M7 14l-1.5 3.5L9 19l3-1"/><path d="M3 21h9"/>',
  eraser: '<path d="M9 20h11"/><path d="M4.5 15.5l9.8-10.8 6 5.6-9.4 9.7H9z"/><path d="M9.6 10l6 5.6"/>',
  lasso: '<path d="M6.5 15.2C4 14.1 3 12.6 3 11c0-3.9 4-7 9-7s9 3.1 9 7-4 7-9 7c-.8 0-1.6-.1-2.4-.2" stroke-dasharray="2.6 2.6"/><path d="M8 14.5c-1.6.8-2 2.3-1 3.5s3 .9 3.5-.6"/>',
  text: '<path d="M5 7V4.5h14V7"/><path d="M12 4.5v15"/><path d="M9 19.5h6"/>',
  shapes: '<circle cx="8" cy="8" r="4.5"/><path d="M13 13h7.5v7.5H13z"/><path d="M15.5 3.5L20 10h-9z"/>',
  laser: '<circle cx="12" cy="12" r="2.6"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  wave: '<path d="M3 12h1.5M7 8.5v7M11 5v14M15 8v8M19 10.5v3M21.5 12H21"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  paper: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  star: '<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1-4.5-4.3 6.1-.8z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.3-4.3"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  play: '<path d="M7.5 4.8v14.4L19 12z" fill="currentColor"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/>',
  back15: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">15</text>',
  fwd15: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/><text x="12" y="15.5" font-size="7" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif">15</text>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7M9 7V4.5h6V7"/>',
  notes: '<rect x="4" y="3" width="13" height="17" rx="2"/><path d="M20 7v13a1 1 0 0 1-1 1H8"/><path d="M7.5 8h6M7.5 12h6"/>',
  inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2h9A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  pageplus: '<path d="M6 3h8l4 4v14H6z"/><path d="M12 10v7M8.5 13.5h7"/>',
  clip: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v4h4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/><path d="M14 11v6M11 14h6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  cards: '<rect x="3" y="6" width="14" height="12" rx="2"/><path d="M7 6V5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-3"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pages: '<rect x="3" y="4" width="7" height="16" rx="1.5"/><path d="M14 6h7M14 10h7M14 14h7M14 18h5"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M4 12h16"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20v-4h-4"/>',
  template: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M10 9v12"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  math: '<path d="M4 6h7M7.5 2.5v7M4 18h7M14 5l6 6M20 5l-6 6M14 16h6M14 20h6"/>',
  print: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v7H6z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;
}

// Fill every element that has data-icon="name" with that icon.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) {
    if (!el.firstElementChild) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    if (!el.getAttribute('aria-label') && el.title) el.setAttribute('aria-label', el.title);
  }
}
