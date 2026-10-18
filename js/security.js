// Privacy & security: a local profile ("account"), a required unlock, auto-lock, a privacy cover,
// and Protected mode (no export/share/print/copy-out, blur while the screen is recorded).
//
// Nothing here talks to a server. In the iPad app, unlocking uses the iPad's own Touch ID / Face ID /
// passcode (LocalAuthentication, via the native bridge); notes are also file-protected by iPadOS.
// In a browser, unlocking uses an Openpage passcode, stored only as a salted PBKDF2 hash.
import { h, prefs, toast, isNative, nativeCall, DEMO } from './util.js';
import { mascot, setMood } from './mascot.js';
import { confirmDlg } from './ui.js';
import { eraseAllStorage } from './db.js';

const PIN_ITER = 210000;
let native = null;            // { available, biometry } from the iPad app
let locked = false;
let hiddenAt = 0;
const ask = (op, extra) => nativeCall('secure', op, extra);   // iPad app only
const biometryName = () => (native?.biometry === 'faceID' ? 'Face ID' : native?.biometry === 'touchID' ? 'Touch ID' : 'your iPad passcode');
const usesDeviceAuth = () => !!(native && native.available);

// ---------- passcode (browser, or an iPad without a passcode)
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function pinHash(pin, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((x) => parseInt(x, 16)));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PIN_ITER }, key, 256));
}
async function setPin(pin) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  prefs.set('pin', { salt, hash: await pinHash(pin, salt) });
}
async function checkPin(pin) {
  const p = prefs.get('pin', null);
  if (!p) return false;
  const got = await pinHash(pin, p.salt);
  let diff = got.length ^ p.hash.length;               // constant-time compare
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ p.hash.charCodeAt(i);
  return diff === 0;
}

export async function verifyUser(reason) {
  if (lockMethod() === 'none') return true;
  if (lockMethod() === 'device' && usesDeviceAuth()) { const r = await ask('auth', { reason }); return !!(r && r.ok); }
  return pinPrompt(reason);
}

// ---------- policy
export const profile = () => prefs.get('profile', null);
export const isProtected = () => !!prefs.get('protected', false);

// ---------- screens
function screen(cls, ...kids) {
  const el = h('div', { class: 'secure-screen ' + cls, role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'secure-card' }, mascot('secure'), ...kids));
  document.body.append(el);
  return el;
}
function pinField(label) {
  return h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', pattern: '[0-9]*', maxlength: 12, class: 'pin', 'aria-label': label, placeholder: '••••••' });
}

function pinPrompt(reason) {
  return new Promise((resolve) => {
    const input = pinField('Passcode'), msg = h('p', { class: 'secure-msg', 'aria-live': 'polite' });
    const ok = h('button', { class: 'btn primary', type: 'button' }, 'Continue');
    const cancel = h('button', { class: 'btn', type: 'button' }, 'Cancel');
    const el = screen('pin-sheet', h('h2', {}, reason), input, msg, h('div', { class: 'secure-actions' }, cancel, ok));
    const done = (v) => { el.remove(); resolve(v); };
    ok.onclick = async () => { if (await checkPin(input.value)) done(true); else { msg.textContent = 'Wrong passcode'; input.value = ''; input.focus(); } };
    input.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
    cancel.onclick = () => done(false);
    input.focus();
  });
}

// First launch: create the local profile and turn on the lock.
function onboarding() {
  return new Promise((resolve) => {
    const name = h('input', { type: 'text', maxlength: 40, autocomplete: 'name', placeholder: 'Your name', 'aria-label': 'Your name' });
    const next = h('button', { class: 'btn primary', type: 'button' }, 'Continue');
    const el = screen('onboard',
      h('h1', {}, 'Welcome to Openpage'),
      h('p', {}, 'Create your profile. It stays on this device: Openpage has no servers and never sees your notes. Your name is shown to people you collaborate with.'),
      name, next);
    name.focus();
    name.onkeydown = (e) => { if (e.key === 'Enter') next.click(); };
    next.onclick = async () => {
      const n = name.value.trim();
      if (!n) { name.focus(); toast('Please enter your name'); return; }
      el.remove();
      await setupLock();
      prefs.set('profile', { name: n, id: crypto.randomUUID(), created: Date.now() });
      resolve();
    };
  });
}

// Choose how Openpage is unlocked: Touch ID / Face ID, an Openpage passcode, or not now.
// Resolves with 'device', 'pin' or 'none' (null if cancelled from Settings).
function setupLock({ fromSettings = false, start = 'choose' } = {}) {
  return new Promise((resolve) => {
    let el;
    const finish = (method) => { el && el.remove(); if (method) prefs.set('lockMethod', method); resolve(method); };
    const choose = () => {
      el && el.remove();
      const kids = [h('h1', {}, 'Lock Openpage?'),
        h('p', {}, 'A lock keeps your notes private if someone else picks up your iPad. You can change this any time in Settings → Privacy & security.')];
      if (usesDeviceAuth()) {
        const bio = h('button', { class: 'btn primary', type: 'button' }, `Yes, use ${biometryName()}`);
        bio.onclick = async () => {
          const r = await ask('auth', { reason: 'Turn on the Openpage lock' });
          if (r && r.ok) finish('device'); else toast(`${biometryName()} didn't confirm. Try again or choose another option.`);
        };
        kids.push(bio);
      }
      const pin = h('button', { class: usesDeviceAuth() ? 'btn' : 'btn primary', type: 'button' }, usesDeviceAuth() ? 'Use an Openpage passcode instead' : 'Yes, set a passcode');
      pin.onclick = makePin;
      const no = h('button', { class: 'btn ghost', type: 'button' }, fromSettings ? 'Cancel' : 'Not now');
      no.onclick = () => finish(fromSettings ? null : 'none');
      kids.push(pin, no);
      el = screen('onboard lock-choice', ...kids);
    };
    const makePin = () => {
      el && el.remove();
      const a = pinField('New passcode'), b = pinField('Repeat passcode'), msg = h('p', { class: 'secure-msg', 'aria-live': 'polite' });
      const go = h('button', { class: 'btn primary', type: 'button' }, 'Set passcode');
      const back = h('button', { class: 'btn', type: 'button' }, 'Back');
      el = screen('onboard', h('h1', {}, 'Create a passcode'),
        h('p', {}, 'At least 6 digits. You\'ll enter it each time you open Openpage. It can\'t be recovered, so choose one you\'ll remember.'), a, b, msg,
        h('div', { class: 'secure-actions' }, back, go));
      a.focus();
      back.onclick = fromSettings ? () => finish(null) : choose;
      b.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
      go.onclick = async () => {
        if (!/^\d{6,12}$/.test(a.value)) { msg.textContent = 'Use 6 to 12 digits.'; return; }
        if (a.value !== b.value) { msg.textContent = 'The passcodes don\'t match.'; return; }
        await setPin(a.value);
        finish('pin');
      };
    };
    if (start === 'pin') makePin(); else choose();
  });
}

const lockMethod = () => prefs.get('lockMethod', 'none');

export function lock() {
  if (locked || !profile() || lockMethod() === 'none') return;
  locked = true;
  document.body.classList.add('is-locked');
  setMood('sleepy');
  const p = profile();
  const msg = h('p', { class: 'secure-msg', 'aria-live': 'polite' });
  const kids = [h('h1', {}, `Welcome back, ${p.name}`)];
  let el;
  const unlocked = () => { locked = false; document.body.classList.remove('is-locked'); el.remove(); prefs.set('failedUnlocks', 0); setMood('happy'); setMood('wink', 2200); };
  if (prefs.get('lockMethod') === 'device' && usesDeviceAuth()) {
    const go = h('button', { class: 'btn primary', type: 'button' }, `Unlock with ${biometryName()}`);
    go.onclick = async () => { const r = await ask('auth', { reason: 'Unlock Openpage' }); if (r && r.ok) unlocked(); else msg.textContent = 'Not unlocked. Try again.'; };
    kids.push(go, msg);
    el = screen('lock', ...kids);
    setTimeout(() => go.click(), 250);
  } else {
    const input = pinField('Passcode'), go = h('button', { class: 'btn primary', type: 'button' }, 'Unlock');
    go.onclick = async () => {
      const wait = prefs.get('lockoutUntil', 0) - Date.now();
      if (wait > 0) { msg.textContent = `Too many tries. Wait ${Math.ceil(wait / 1000)} s.`; return; }
      if (await checkPin(input.value)) { unlocked(); return; }
      const n = prefs.get('failedUnlocks', 0) + 1;
      prefs.set('failedUnlocks', n);
      if (n >= 5) prefs.set('lockoutUntil', Date.now() + Math.min(3600, 30 * 2 ** (n - 5)) * 1000);   // 30 s, 60 s, 2 min… up to 1 h
      msg.textContent = n >= 5 ? 'Wrong passcode. Openpage is paused for a moment.' : 'Wrong passcode.';
      input.value = ''; input.focus();
    };
    input.onkeydown = (e) => { if (e.key === 'Enter') go.click(); };
    kids.push(input, msg, go);
    el = screen('lock', ...kids);
    input.focus();
  }
}

// ---------- lifecycle: lock after time away, privacy cover
const lockAfterMs = () => prefs.get('lockAfter', 60) * 1000;
function wentAway() {
  hiddenAt = Date.now();
  document.body.classList.add('privacy-cover');
  if (lockAfterMs() === 0) lock();
}
function cameBack() {
  if (hiddenAt && Date.now() - hiddenAt >= lockAfterMs()) lock();
  hiddenAt = 0;
  document.body.classList.remove('privacy-cover');
  return locked ? 'locked' : 'open';
}
window.openpageLifecycle = (state) => (state === 'background' ? (wentAway(), 'away') : cameBack());
window.openpageCaptured = (on) => document.body.classList.toggle('captured', !!on);

// Called once at startup, before notes are shown.
export async function initSecurity() {
  if (isNative()) native = await ask('status');
  if (!isNative() && !DEMO) {   // demo: nothing private, and screenshot tools load pages in the background
    document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? wentAway() : cameBack()));
  }
  document.body.classList.toggle('protected', isProtected());
  // Protected mode: nothing leaves through the system clipboard
  for (const type of ['copy', 'cut']) {
    document.addEventListener(type, (e) => {
      if (!isProtected() || e.target.closest?.('.secure-screen')) return;
      e.preventDefault();
      toast('Copying to other apps is off in Protected mode');
    }, true);
  }
  if (!profile()) await onboarding();
  else lock();
}

// Settings → Privacy & security
export function securitySettings() {
  const p = profile() || { name: '' };
  const name = h('input', { type: 'text', value: p.name, maxlength: 40, 'aria-label': 'Profile name' });
  name.onchange = () => { const n = name.value.trim(); if (n) prefs.set('profile', { ...profile(), name: n }); };
  const after = h('select', { 'aria-label': 'Lock after' });
  for (const [v, label] of [[0, 'Immediately'], [60, 'After 1 minute'], [300, 'After 5 minutes'], [900, 'After 15 minutes']]) {
    after.append(h('option', { value: v, selected: prefs.get('lockAfter', 60) === v }, label));
  }
  after.onchange = () => prefs.set('lockAfter', +after.value);
  const prot = h('input', { type: 'checkbox', checked: isProtected() });
  prot.onchange = async () => {
    if (!prot.checked) {
      if (!(await verifyUser('Turn off Protected mode'))) { prot.checked = true; return; }
    }
    prefs.set('protected', prot.checked);
    document.body.classList.toggle('protected', prot.checked);
    toast(prot.checked ? 'Protected mode on' : 'Protected mode off');
  };
  const erase = h('button', { type: 'button', class: 'btn danger' }, 'Erase all Openpage data on this device…');
  erase.onclick = async () => {
    if (DEMO) { toast('Demo: starting over with fresh sample notes'); setTimeout(() => location.reload(), 600); return; }   // never touch real notes from the demo
    const sure = await confirmDlg('Every note, recording, shared-subject link and setting in Openpage on this device will be erased. Shared folders in iCloud Drive aren\'t touched. This can\'t be undone.',
      { title: 'Erase all Openpage data?', okLabel: 'Erase everything' });
    if (!sure) return;
    if (!(await verifyUser('Erase all Openpage data'))) return;
    toast('Erasing…');
    // the iPad app wipes its whole web storage natively (most thorough), then reloads
    if (isNative() && (await ask('erase'))) return;
    await eraseAllStorage();
    location.replace(location.pathname);
  };
  const how = h('select', { 'aria-label': 'Lock with' });
  const drawHow = () => {
    how.textContent = '';
    const opts = [...(usesDeviceAuth() ? [['device', biometryName()]] : []), ['pin', 'Openpage passcode'], ['none', 'Off (no lock)']];
    for (const [v, label] of opts) how.append(h('option', { value: v, selected: lockMethod() === v }, label));
    after.disabled = lockMethod() === 'none';
  };
  how.onchange = async () => {
    const want = how.value;
    if (!(await verifyUser('Change the Openpage lock'))) { drawHow(); return; }
    if (want === 'none') prefs.set('lockMethod', 'none');
    else if (want === 'device') {
      const r = await ask('auth', { reason: 'Turn on the Openpage lock' });
      if (r && r.ok) prefs.set('lockMethod', 'device');
    } else await setupLock({ fromSettings: true, start: 'pin' });
    drawHow();
    toast(lockMethod() === 'none' ? 'Lock turned off' : 'Lock updated');
  };
  drawHow();
  return h('div', { class: 'field', 'data-sec': 'security' },
    h('span', { style: { fontSize: '15px' } }, 'Privacy & security'),
    h('small', {}, 'Profile name (shown to collaborators)'), name,
    h('div', { class: 'row' }, h('small', {}, 'Lock with'), how),
    h('div', { class: 'row' }, h('small', {}, 'Lock Openpage'), after),
    h('label', { class: 'check' }, prot, 'Protected mode'),
    h('small', {}, 'Blocks exporting, sharing, printing, backups and copying to other apps, and hides the screen while it\'s being recorded or mirrored. Turning it off needs your unlock.'),
    h('small', {}, 'Privacy: notes stay on this device (and in iCloud Drive folders you choose to share). Openpage has no account servers, ads, analytics or trackers. AI features are off unless you add your own key, and then send only what you ask about to that provider.'),
    erase);
}
