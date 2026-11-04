/**
 * A plan handed over by the employee portal (Portal 2, portal.dcrframing.com).
 *
 * The old portal shared this app's address (barajas545.github.io), so it
 * handed a project over through sessionStorage and kept its Plans Library in
 * the same private file system this app reads. Portal 2 is another site:
 * nothing of its storage can be read from here, and nothing of a plan may
 * travel in an address (a download link is a credential, and an address ends
 * up in history and in logs). So the hand-over is a conversation between the
 * two windows:
 *
 *   1. the portal opens this app in a new tab at `index.html#portal=<nonce>`
 *      (a one-time random word, no credential), and keeps the tab's window;
 *   2. this app answers its opener `{type: 'ptt-ready', v, nonce}` — posted
 *      ONLY to the portal's own address (PORTAL_ORIGINS), so no other site
 *      that opened this app hears it;
 *   3. the portal posts the plan to this tab, to this app's own address:
 *        {type: 'ptt-open', v, nonce, kind: 'file', file, name, size,
 *         lastModified, number, updateAvailable}
 *          a copy the portal's Plans Library keeps on this device (a File
 *          out of its storage: nothing is copied, this app reads it by slices
 *          like a file from disk) — opens with no internet;
 *        {type: 'ptt-open', v, nonce, kind: 'link', url, name, size,
 *         lastModified, number}
 *          a plan in the OneDrive Plans Archive, opened over HTTP ranges
 *          through a pre-authenticated link (js/core/remote-file.js);
 *   4. when that link expires (about an hour) this app asks the portal tab
 *      for a fresh one: `{type: 'ptt-renew', v, nonce, req}`, answered
 *      `{type: 'ptt-link', v, nonce, req, url}` ('' when there is none);
 *   5. once this device keeps the app for offline use (its service worker in
 *      charge, its program cached), it says `{type: 'ptt-offline', v, nonce}`;
 *   6. a plan the portal will take a save of comes with `canSave: true` (a
 *      copy its Plans Library keeps on this device, handed to the portal's
 *      own copy of this app in its frame, for a person who may save back).
 *      Save then hands the whole saved project to the portal:
 *        {type: 'ptt-save', v, nonce, req, name, size, file}
 *      and waits for `{type: 'ptt-save-state', v, nonce, req, state, why?}`:
 *      'kept' (the portal has the bytes in its own storage — only then is the
 *      project saved), 'refused', 'no-room' or 'failed'. While it keeps them it
 *      may say so — `{..., state: 'keeping', pct?}` — and each such word (any
 *      word about this save that is not an answer) starts the wait again: a
 *      big plan takes more than the wait to copy on an iPad. Sending to
 *      OneDrive is the portal's job after that; it may say how it goes
 *      ('sending' with a `pct`, 'sent', 'copy' with the copy's `name`), and
 *      nothing here waits for those. A 'kept' that comes after the wait has
 *      ended is still heard (the caller decides whether it is a save then).
 *
 * Two windows can be the portal (the PEER, portalPeer):
 *
 *   · the window that opened this tab (a computer: this app on its own site),
 *     at a portal address (PORTAL_ORIGINS);
 *   · the page this one is framed in, when it is a page of this page's own
 *     site (a phone or a tablet: the portal shows its own copy of this app,
 *     /takeoff/, in a frame over the page) — at this page's own address.
 *
 * A message counts only when it comes from that window, from that address,
 * with this tab's nonce, and in exactly this shape. Everything here is pure,
 * so the Node tests drive it with made-up messages and made-up windows.
 */

/** Where the portal lives. A message from anywhere else is not the portal's. */
export const PORTAL_ORIGINS = Object.freeze(['https://portal.dcrframing.com']);
export const HANDOFF_VERSION = 1;
/** How long the new tab waits for the portal's plan before it says so (the portal may first ask OneDrive for a
 *  link: a walk of the project's folders, and its own wait for this tab is 90 s). */
export const HANDOFF_WAIT_MS = 120 * 1000;
/** How long a fresh link may take to come back (the portal asks OneDrive for it: a walk of the project's folders, and
 *  once more after a short busy answer). */
export const RENEW_WAIT_MS = 90 * 1000;

/** How long Save waits for the portal to say it has the file before it keeps the work as a draft and says so (the
 *  portal spools the file into its own storage first: a gigabyte plan takes a while on an iPad). Any word of the
 *  portal's about the save that is not its answer starts this wait again, for the whole of it. */
export const SAVE_WAIT_MS = 120 * 1000;
/** The answers that end a save's wait: only 'kept' is a save. */
export const SAVE_ENDINGS = Object.freeze(['kept', 'refused', 'no-room', 'failed']);
/** What the portal may say while it keeps the file, before its answer — `pct` how far, 0-100, when it knows. Optional
 *  (a portal that never says it is waited for as ever); each one starts the wait again. */
export const SAVE_PROGRESS = Object.freeze(['keeping']);
/** What the portal may say afterwards, while it sends the kept file to OneDrive (never waited for). */
export const SAVE_NEWS = Object.freeze(['sending', 'sent', 'copy']);

const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
// A save's own word: up to 20 characters, the nonce's alphabet (the portal checks the same, as it does a renewal's).
const REQ_RE = /^[A-Za-z0-9_-]{1,20}$/;
const NUMBER_RE = /^[^\u0000-\u001f\u007f]{1,40}$/;
// A file name, not a path: no folder separators, no control characters, a .takeoff at the end.
const NAME_RE = /^[^\u0000-\u001f\u007f/\\]{1,250}\.takeoff$/i;

/** The nonce in `#portal=<nonce>` (alone, or among other hash parts), or null. */
export function parsePortalHash(hash) {
  const m = /(?:^|[#&])portal=([^&]*)/.exec(String(hash || ''));
  return m && NONCE_RE.test(m[1]) ? m[1] : null;
}

/** Is this a portal address (exactly, scheme and port included)? */
export function isPortalOrigin(origin, origins = PORTAL_ORIGINS) {
  return typeof origin === 'string' && origins.includes(origin);
}

// ── the peer: which window is the portal ─────────────────────────────────

/**
 * This page is in a frame of a page of its OWN site: a parent window that is
 * not this one, whose address can be read (another site's cannot: reading it
 * throws) and is this page's own. An opaque origin ('null': a sandboxed frame,
 * a file) is nobody's site.
 */
export function framedBySameSite(win) {
  try {
    if (!win || !win.parent || win.parent === win) return false;
    const mine = win.location && win.location.origin;
    if (typeof mine !== 'string' || !mine || mine === 'null') return false;
    return win.parent.location.origin === mine;
  } catch {
    return false;   // another site's page: its address is not ours to read
  }
}

/**
 * The window that hands this tab its plan, and hears its save:
 *
 *   { via: 'frame',  win: parent, origin: this page's own }   framed by a page of this site
 *   { via: 'opener', win: opener, origin: '' }                a tab the portal opened; its
 *                                                             address is one of PORTAL_ORIGINS,
 *                                                             and is pinned once the plan comes
 *   null                                                      neither
 *
 * The frame comes first: a framed page has no opener of its own anyway, and
 * the portal that framed it is the one to talk to.
 */
export function portalPeer(win) {
  if (framedBySameSite(win)) return { via: 'frame', win: win.parent, origin: win.location.origin };
  let opener = null;
  try { opener = win && win.opener; } catch { opener = null; }
  return opener ? { via: 'opener', win: opener, origin: '' } : null;
}

/**
 * Whether a message event is the peer's: from its window, and from its address — the frame's parent at this page's
 * own address; the opener at the address the plan came from, or before that at any portal address.
 */
export function fromPeer(ev, peer, origins = PORTAL_ORIGINS) {
  if (!ev || !peer || !peer.win || ev.source !== peer.win) return false;
  if (typeof ev.origin !== 'string' || !ev.origin || ev.origin === 'null') return false;
  if (peer.via === 'frame') return ev.origin === peer.origin;
  return peer.origin ? ev.origin === peer.origin : isPortalOrigin(ev.origin, origins);
}

/** The addresses this tab's words to the peer are posted to (postMessage's targetOrigin): never '*'. */
export function peerTargets(peer, origins = PORTAL_ORIGINS) {
  if (!peer || !peer.win) return [];
  if (peer.via === 'frame') return peer.origin ? [peer.origin] : [];
  return peer.origin ? [peer.origin] : [...origins];
}

export function readyMessage(nonce) {
  return { type: 'ptt-ready', v: HANDOFF_VERSION, nonce };
}

export function renewMessage(nonce, req) {
  return { type: 'ptt-renew', v: HANDOFF_VERSION, nonce, req };
}

/** This device keeps the app for offline use now (its service worker and its program): the portal's Plans Library
 *  says saved plans open with no signal only once it has heard this. */
export function offlineMessage(nonce) {
  return { type: 'ptt-offline', v: HANDOFF_VERSION, nonce };
}

/** A pre-authenticated OneDrive link: https on a sharepoint.com host, no credentials in it. */
export function linkOk(url) {
  if (typeof url !== 'string' || !url || url.length > 4096) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.username && !u.password && !u.port
      && /^[a-z0-9-]+(\.[a-z0-9-]+)*\.sharepoint\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

function common(d, nonce) {
  if (!d || typeof d !== 'object' || d.type !== 'ptt-open' || d.v !== HANDOFF_VERSION) return null;
  if (!NONCE_RE.test(String(nonce || '')) || d.nonce !== nonce) return null;
  if (typeof d.name !== 'string' || !NAME_RE.test(d.name)) return null;
  if (!Number.isSafeInteger(d.size) || d.size <= 0) return null;
  const number = typeof d.number === 'string' && NUMBER_RE.test(d.number.trim()) ? d.number.trim() : '';
  const lastModified = Number.isFinite(d.lastModified) && d.lastModified > 0 ? d.lastModified : 0;
  return { name: d.name, size: d.size, number, lastModified };
}

/**
 * The plan in a 'ptt-open' message for this tab's nonce — {kind: 'file',
 * file, name, size, number, lastModified, updateAvailable, canSave} or
 * {kind: 'link', url, name, size, number, lastModified} — or null for anything
 * else. `canSave` (the portal will take a save of THIS plan) only when it says
 * exactly true, and only for a copy on this device: a link never has it.
 */
export function openFromMessage(d, nonce) {
  const c = common(d, nonce);
  if (!c) return null;
  if (d.kind === 'file') {
    const f = d.file;
    if (typeof Blob === 'undefined' || !(f instanceof Blob) || f.size !== c.size) return null;
    return { kind: 'file', file: f, ...c, updateAvailable: d.updateAvailable === true, canSave: d.canSave === true };
  }
  if (d.kind === 'link') {
    if (!linkOk(d.url)) return null;
    return { kind: 'link', url: d.url, ...c };
  }
  return null;
}

/** The fresh link in a 'ptt-link' answer to renewal `req` ('' when the portal has none), or null when it is not one. */
export function linkFromMessage(d, nonce, req) {
  if (!d || typeof d !== 'object' || d.type !== 'ptt-link' || d.v !== HANDOFF_VERSION) return null;
  if (!NONCE_RE.test(String(nonce || '')) || d.nonce !== nonce || d.req !== req) return null;
  if (d.url === '') return '';
  return linkOk(d.url) ? d.url : null;
}

// ── a save handed back to the portal ─────────────────────────────────────

/**
 * A save's own word, `req`: 's' and nine characters of the nonce's alphabet
 * (ten in all, inside the portal's 20). Random, so an answer to an earlier
 * save — a tap that timed out, then a second Save — is never taken for this
 * one's. `fill` is crypto.getRandomValues (the tests give their own).
 */
const REQ_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
export function newSaveReq(fill = a => globalThis.crypto.getRandomValues(a)) {
  const a = new Uint8Array(9);
  fill(a);
  return `s${Array.from(a, b => REQ_ALPHABET[b & 63]).join('')}`;
}

/**
 * The save, as the portal is handed it — or null when it is not one to send:
 * a well-formed nonce and req, the opened plan's file NAME (never a path, a
 * .takeoff), a whole number of bytes, and the file itself, of exactly that
 * size. The file is the saved project as composed: its untouched sheets are
 * slices of the plan the portal handed over, so nothing is read or copied
 * here, and a postMessage passes it by reference.
 */
export function saveMessage({ nonce, req, name, size, file } = {}) {
  if (!NONCE_RE.test(String(nonce || '')) || typeof req !== 'string' || !REQ_RE.test(req)) return null;
  if (typeof name !== 'string' || !NAME_RE.test(name)) return null;
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (typeof Blob === 'undefined' || !(file instanceof Blob) || file.size !== size) return null;
  return { type: 'ptt-save', v: HANDOFF_VERSION, nonce, req, name, size, file };
}

/** A short sentence of the portal's, as plain text: no control characters, one line, at most 300 characters. */
function plainWords(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * The portal's word about save `req` for this tab's nonce — or null for
 * anything else (another save's, another tab's, another shape):
 *
 *   { state, final, why }          state one of SAVE_ENDINGS (final: ends the
 *                                  wait), SAVE_PROGRESS or SAVE_NEWS; why the
 *                                  portal's short words, '' when none
 *   + pct  for 'keeping' and 'sending': 0-100, or null when it gave no number
 *   + name for 'copy': the copy's file name ('' when it is not one)
 */
export function saveStateFromMessage(d, nonce, req) {
  if (!d || typeof d !== 'object' || d.type !== 'ptt-save-state' || d.v !== HANDOFF_VERSION) return null;
  if (!NONCE_RE.test(String(nonce || '')) || d.nonce !== nonce) return null;
  if (typeof req !== 'string' || !REQ_RE.test(req) || d.req !== req) return null;
  const final = SAVE_ENDINGS.includes(d.state);
  if (!final && !SAVE_PROGRESS.includes(d.state) && !SAVE_NEWS.includes(d.state)) return null;
  const out = { state: d.state, final, why: plainWords(d.why) };
  if (d.state === 'keeping' || d.state === 'sending') {
    out.pct = typeof d.pct === 'number' && Number.isFinite(d.pct) ? Math.max(0, Math.min(100, Math.round(d.pct))) : null;
  }
  if (d.state === 'copy') out.name = typeof d.name === 'string' && NAME_RE.test(d.name) ? d.name : '';
  return out;
}

/**
 * Hand the saved project to the portal and wait for its answer.
 *
 *   save  { peer, nonce, req, name, size, file } — the peer as portalPeer
 *         gave it, its address pinned (an opener's, once the plan came): a
 *         save goes to exactly one address, the one the plan came from
 *   env   the browser, so the tests can be any:
 *           listen(fn) → unlisten     fn gets every message event
 *           post(win, msg, origin)    postMessage; throws when the window is gone
 *           peerGone() → bool         the portal's window has closed
 *           onNews(news)              a word about this save that is not its
 *                                     answer: while waiting, 'keeping' (pct)
 *                                     or any of SAVE_NEWS; after 'kept' (in
 *                                     time or late), SAVE_NEWS or a 'failed'.
 *                                     Never waited for
 *           doc                       the document, for whether the page is in
 *                                     front (default: the page's own; null: never hidden)
 *           waitMs, pollMs, origins, setTimeout/clearTimeout/setInterval/clearInterval
 *
 * Any word of the portal's about this save that is not its answer — 'keeping'
 * while it copies the file into its own storage (with how far, when it
 * knows), or any of SAVE_NEWS — starts the wait again from now, for the whole
 * window: the portal is at it, and a 2 GB plan takes longer than the window
 * to copy on an iPad. A portal that says nothing before its answer is waited
 * for exactly as before.
 *
 * Time the page spends hidden is not counted (as workerWriter's watchdog,
 * js/core/device-plans.js). Switching apps while the portal spools a big plan
 * suspends the portal's page and this frame together; this page's timer runs
 * on a clock that kept going, so on the way back it is already overdue and
 * would end the wait — "not saved" — a moment before the portal's 'kept'
 * arrives, while the portal goes on to send the file. So a wait that comes
 * due while the page is hidden, or after it has been hidden since the save
 * was posted (or since the wait last started again), starts again from now,
 * for the whole window.
 *
 * Resolves { ending, why, stop, late }:
 *   ending  'kept' — the portal has the bytes in its own storage: the ONE
 *                    answer that makes this a save
 *           'refused' | 'no-room' | 'failed' — the portal's answer
 *           'timeout'  — no answer within waitMs
 *           'gone'     — the portal's window closed first
 *           'not-sent' — the save could not be handed over at all
 *   why     the portal's short words ('' when none)
 *   late    after a 'timeout', a Promise of the portal's answer if it still
 *           comes — { state, why }, state one of SAVE_ENDINGS — or null once
 *           stop() is called; null at once for any other ending. A late
 *           'kept' says the portal HAS the file as it was composed: whether
 *           the project is saved then is the caller's to judge (nothing done
 *           since: js/core/save-route.js savedStill), and only for the latest
 *           save it handed over — it calls stop() before it posts the next.
 *           After a late 'kept' the news of the send is heard as after one in
 *           time.
 *   stop()  stops listening. After 'kept' the listener stays for the news of
 *           the send, until 'sent', 'copy' or 'failed'; after 'timeout', for
 *           a late answer (and then as after 'kept'); until this either way.
 */
export function askPortalToKeep({ peer, nonce, req, name, size, file } = {}, env = {}) {
  // Called through wrappers, never as T.setTimeout(...) of the browser's own:
  // a window's timers called with another `this` throw "Illegal invocation".
  const T = {
    setTimeout: env.setTimeout || ((fn, ms) => globalThis.setTimeout(fn, ms)),
    clearTimeout: env.clearTimeout || (id => globalThis.clearTimeout(id)),
    setInterval: env.setInterval || ((fn, ms) => globalThis.setInterval(fn, ms)),
    clearInterval: env.clearInterval || (id => globalThis.clearInterval(id)),
  };
  const noop = () => {};
  const none = Promise.resolve(null);
  const gone = () => { try { return !!(env.peerGone && env.peerGone()); } catch { return true; } };
  const doc = 'doc' in env ? env.doc : (typeof document !== 'undefined' ? document : null);
  const hiddenNow = () => { try { return !!doc && doc.visibilityState === 'hidden'; } catch { return false; } };
  const msg = saveMessage({ nonce, req, name, size, file });
  // Exactly one address: the one the plan came from (an opener's is pinned
  // only once the plan has come; before that it could be any portal address).
  const targets = peer && peer.origin ? peerTargets(peer, env.origins) : [];
  if (!msg || targets.length !== 1 || typeof env.listen !== 'function' || typeof env.post !== 'function') {
    return Promise.resolve({ ending: 'not-sent', why: '', stop: noop, late: none });
  }
  if (gone()) return Promise.resolve({ ending: 'gone', why: '', stop: noop, late: none });
  return new Promise(resolve => {
    // 'waiting' for the answer; then 'news' (kept, in time or late: the
    // send's news is heard), 'late' (timed out: a late answer is still
    // heard) or 'over'.
    let phase = 'waiting';
    let unlisten = noop;
    let timer = 0;
    let poll = 0;
    let answerLate = noop;
    const late = new Promise(r => { answerLate = v => { answerLate = noop; r(v); }; });
    let wasHidden = hiddenNow();          // hidden at any moment since the wait (last) started
    const onVisibility = () => { if (hiddenNow()) wasHidden = true; };
    let unwatch = noop;
    try {
      if (doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('visibilitychange', onVisibility);
        unwatch = () => doc.removeEventListener('visibilitychange', onVisibility);
      }
    } catch { /* counted as always in front */ }
    const quiet = () => {
      const w = unwatch;
      unwatch = noop;
      try { w(); } catch { /* gone with the page */ }
    };
    const stop = () => {
      phase = 'over';
      const u = unlisten;
      unlisten = noop;
      T.clearTimeout(timer);
      T.clearInterval(poll);
      quiet();
      try { u(); } catch { /* already gone */ }
      answerLate(null);
    };
    const end = (ending, why = '') => {
      if (phase !== 'waiting') return;
      T.clearTimeout(timer);
      T.clearInterval(poll);
      quiet();
      if (ending === 'kept') phase = 'news';
      else if (ending === 'timeout') phase = 'late';
      else stop();
      if (ending !== 'timeout') answerLate(null);    // a late answer is a timed-out save's only
      resolve({ ending, why, stop, late });
    };
    const waitMs = Number(env.waitMs) > 0 ? Number(env.waitMs) : SAVE_WAIT_MS;
    // The whole window, from now (and the page's time away counted from now).
    const arm = () => {
      T.clearTimeout(timer);
      wasHidden = hiddenNow();
      timer = T.setTimeout(due, waitMs);
    };
    const due = () => {
      if (phase !== 'waiting') return;
      // Put away meanwhile: the portal was too. Wait again, from now.
      if (hiddenNow() || wasHidden) { arm(); return; }
      end('timeout');
    };
    const tell = s => { try { if (env.onNews) env.onNews(s); } catch { /* words only */ } };
    const heard = ev => {
      if (!fromPeer(ev, peer, env.origins)) return;
      const s = saveStateFromMessage(ev && ev.data, nonce, req);
      if (!s) return;
      if (phase === 'waiting') {
        if (s.final) { end(s.state, s.why); return; }
        arm();                            // the portal is at it: the whole wait again
        tell(s);
        return;
      }
      if (phase === 'late') {
        if (!s.final) return;             // still at it: only its answer is news now
        answerLate({ state: s.state, why: s.why });
        if (s.state === 'kept') phase = 'news'; else stop();
        return;
      }
      if (phase !== 'news') return;
      // A second answer to a save already answered, or 'keeping' after it: nothing new.
      if (!(SAVE_NEWS.includes(s.state) || s.state === 'failed')) return;
      tell(s);
      if (s.state === 'sent' || s.state === 'copy' || s.state === 'failed') stop();
    };
    try { unlisten = env.listen(heard) || noop; } catch { end('not-sent'); return; }
    timer = T.setTimeout(due, waitMs);
    poll = T.setInterval(() => { if (gone()) end('gone'); }, Number(env.pollMs) > 0 ? Number(env.pollMs) : 2000);
    try { env.post(peer.win, msg, targets[0]); } catch { end(gone() ? 'gone' : 'not-sent'); }
  });
}
