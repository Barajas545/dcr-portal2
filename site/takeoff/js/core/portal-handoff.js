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
 *      charge, its program cached), it says `{type: 'ptt-offline', v, nonce}`.
 *
 * A message counts only when it comes from the window that opened this tab,
 * from a portal address, with this tab's nonce, and in exactly this shape.
 * Everything here is pure, so the Node tests drive it with made-up messages.
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

const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/;
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
 * file, name, size, number, lastModified, updateAvailable} or {kind: 'link',
 * url, name, size, number, lastModified} — or null for anything else.
 */
export function openFromMessage(d, nonce) {
  const c = common(d, nonce);
  if (!c) return null;
  if (d.kind === 'file') {
    const f = d.file;
    if (typeof Blob === 'undefined' || !(f instanceof Blob) || f.size !== c.size) return null;
    return { kind: 'file', file: f, ...c, updateAvailable: d.updateAvailable === true };
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
