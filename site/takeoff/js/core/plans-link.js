/**
 * A `#plans` / `#plans=A249` link that lands where no folder can be opened.
 *
 * The employee portal puts a plan button beside every project that has a
 * takeoff — for everyone who can see the project, field crews on phones
 * included — and it opens this app at `index.html#plans=<number>`. Chrome and
 * Edge on a computer open the Plans Archive folder at that job
 * (js/ui/plans-archive.js). Firefox and Safari on a computer cannot open a
 * folder at all, and a phone or a tablet does not open it whatever its
 * browser offers (canOpenArchiveFolder), so the link would land on the plain
 * start screen with the project number already gone from the address.
 *
 * What it shows there instead, as data: the job's plans already kept on this
 * device (one tap opens one), the way to open a plan file, and — on a
 * computer — the same link to copy into Edge or Chrome. The screen itself is
 * PlansArchive.linkPanel; everything here is pure, so the Node tests drive it
 * with made-up lists and made-up browsers. Nothing here touches the network.
 */

import { canPickFolders, parseProjectCode, projectCodeOf } from './plans-folder.js';

/** Said when a link's number is not a project number (the wording the app has always used). */
export const INVALID_LINK = 'That link did not name a project number — showing the whole Plans Archive.';

export const HANDHELD_HINT = 'Pick the plan from the Plans Archive in the OneDrive app. '
  + 'Then File › Keep on This Device keeps it here for next time.';
export const COMPUTER_HINT = 'Pick the plan from the Plans Archive folder in your OneDrive.';

// ── which device ──────────────────────────────────────────────────────────

function coarsePointer(win) {
  try { return !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(pointer: coarse)').matches); } catch { return false; }
}

/**
 * A phone or a tablet, rather than a computer. Only the words differ: a
 * computer is told to open the link in Edge or Chrome, a phone where to pick
 * the plan instead.
 *
 *   · userAgentData.mobile, when it says so (Chrome and Edge on a phone). It
 *     says false on an Android tablet, so false is not the last word;
 *   · the user agent's own words for a phone or a tablet (Firefox and Safari
 *     have no userAgentData);
 *   · iPadOS asks for the desktop site and calls itself a Mac — but a Mac has
 *     no touch screen, so a "Mac" with touch points is an iPad;
 *   · Windows and ChromeOS are computers, touch screen or not: a touch
 *     laptop folded into a tablet still has Edge;
 *   · anything else — a desktop Linux user agent included — touch points
 *     with a coarse pointer. An Android tablet asking for the desktop site
 *     (Chrome's default on a big tablet; Samsung Internet and Firefox when
 *     it is ticked) sends "X11; Linux x86_64" with no "Android" and
 *     userAgentData.mobile false, but it still has a touch screen and no
 *     mouse. A Linux computer with a mouse has a fine pointer.
 */
export function isPhoneOrTablet(win = globalThis) {
  const nav = (win && win.navigator) || {};
  const ua = String(nav.userAgent || '');
  const uad = nav.userAgentData;
  if (uad && uad.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
  const touch = Number(nav.maxTouchPoints) > 0;
  if (touch && /Macintosh/.test(ua)) return true;
  if (/Windows NT|CrOS/.test(ua)) return false;
  return touch && coarsePointer(win);
}

/**
 * Whether the Plans Archive FOLDER is opened here: Chrome or Edge on a
 * computer. Not on a phone or a tablet, even one whose browser has
 * showDirectoryPicker — Chrome for Android has had it since 132. There the
 * plans are picked one file at a time from the OneDrive app (what the start
 * screen has always told a phone), so a #plans link shows its panel.
 */
export function canOpenArchiveFolder(win = globalThis) {
  return canPickFolders(win) && !isPhoneOrTablet(win);
}

/**
 * Open a plan from a list, asking about unsaved changes first: `beforeOpen`
 * (the link panel closing itself) runs only once the answer is yes, so
 * Cancel leaves the panel where it was. With nothing unsaved there is no
 * await before `open` — it starts inside the tap. Resolves true when it
 * opened, false when the person kept their work.
 */
export async function openAfterAsking({ dirty = false, confirmDiscard, beforeOpen = null, open }) {
  if (dirty && !(await confirmDiscard())) return false;
  if (beforeOpen) beforeOpen();
  await open();
  return true;
}

// ── which plans ───────────────────────────────────────────────────────────

/** The job a plan kept by File › Keep on This Device belongs to, by the project-number rule; '' when none. */
export function keptCode(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return parseProjectCode(entry.code) || projectCodeOf(entry.project) || projectCodeOf(entry.name);
}

/** The job one of the old portal's saved copies belongs to; '' when none. */
export function portalCode(entry) {
  if (!entry || typeof entry !== 'object') return '';
  return parseProjectCode(entry.projectCode) || projectCodeOf(entry.name);
}

/**
 * The plans on this device for job `code` — exactly that job: A024 is never
 * A024-B or A0245 (js/core/plans-folder.js). No number at all (a bare
 * `#plans`) is every plan on the device; a number that is not one is none.
 * The lists keep their own order.
 */
export function plansForProject(code, { kept = [], portal = [] } = {}) {
  const k = Array.isArray(kept) ? kept : [];
  const p = Array.isArray(portal) ? portal : [];
  if (!String(code ?? '').trim()) return { kept: [...k], portal: [...p] };
  const want = parseProjectCode(code);
  if (!want) return { kept: [], portal: [] };
  return { kept: k.filter(e => keptCode(e) === want), portal: p.filter(e => portalCode(e) === want) };
}

// ── the link again ────────────────────────────────────────────────────────

/**
 * The link, rebuilt — the address lost its hash when the link was read — on
 * this page's own origin and path (so a local copy of the app hands out its
 * own address): `…/index.html#plans=A249`, or `…/index.html#plans` for the
 * whole archive. '' when the page's address cannot be read.
 */
export function plansLinkHref(pageHref, code = '') {
  let u;
  try { u = new URL(String(pageHref || '')); } catch { return ''; }
  u.search = '';
  u.hash = '';
  if (u.pathname.endsWith('/')) u.pathname += 'index.html';
  const want = parseProjectCode(code);
  return `${u.href}#plans${want ? `=${encodeURIComponent(want)}` : ''}`;
}

/** Put text on the clipboard. true when it is there; false — never a throw — when the browser would not. */
export async function copyText(nav, text) {
  try {
    const cb = nav && nav.clipboard;
    if (!cb || typeof cb.writeText !== 'function') return false;
    await cb.writeText(String(text));
    return true;
  } catch {
    return false;
  }
}

// ── the panel, as data ────────────────────────────────────────────────────

/**
 * What the panel says and lists for a link.
 *
 *   { code, title, invalidNote, kept, portal, count, emptyText,
 *     openHint, browserNote, href }
 *
 * `browserNote` and `href` (the Copy link button) are for a computer only: a
 * phone or a tablet has no browser that opens the folder.
 */
export function linkPanelModel({
  code = '', invalid = false, handheld = false, kept = [], portal = [], pageHref = '',
} = {}) {
  const want = parseProjectCode(code);
  const list = plansForProject(want, { kept, portal });
  return {
    code: want,
    title: want ? `Plans for ${want}` : 'Plans Archive',
    invalidNote: invalid ? INVALID_LINK : '',
    kept: list.kept,
    portal: list.portal,
    count: list.kept.length + list.portal.length,
    emptyText: want ? `No plans for ${want} are kept on this device.` : 'No plans are kept on this device.',
    openHint: handheld ? HANDHELD_HINT : COMPUTER_HINT,
    browserNote: handheld ? '' : 'This browser cannot open the Plans Archive folder. '
      + (want ? `To see every plan for ${want}, open this link in Edge or Chrome.`
        : 'To browse it, open this link in Edge or Chrome.'),
    href: handheld ? '' : plansLinkHref(pageHref, want),
  };
}
