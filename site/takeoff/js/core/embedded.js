/**
 * The embedded profile: this app inside the employee portal.
 *
 * On a phone or a tablet the portal (Portal 2) does not open this app in a
 * new tab on its own site any more: an iPhone or iPad home-screen app opens
 * another site in Safari, without an opener and without the app's storage,
 * so a plan saved on the device could never reach it. It shows its OWN copy
 * of this app instead — the same files at one reviewed commit, served from
 * the portal's site at /takeoff/ — in a full-screen frame over its page, at
 * `/takeoff/index.html#portal=<nonce>`, and hands the plan over exactly as
 * it does to a new tab (js/core/portal-handoff.js), with the frame's parent
 * as the peer.
 *
 * There the portal is the keeper of plans. Its Plans Library saves them on
 * the device, gated by prices, and removes them — and this app's own copies
 * and drafts on its site — when a person's Sees prices goes. So inside it:
 *
 *   · plans come from the portal's 📐 menu: no Plans Archive folder section,
 *     no Keep on This Device (a copy the portal could not account for), and
 *     not the OLD portal's Plans Library list (another site's names: never
 *     this one's) — PLANS_SOURCE behaves as 'sharepoint', the portal's way;
 *   · no File › Recent, and nothing noted for it: a list of the names of
 *     plans gated by prices, on the portal's site, would outlive the
 *     person's prices (the portal's purge clears this app's drafts and kept
 *     copies; Recent could only offer the file picker there anyway);
 *   · a draft of a plan the portal handed over is offered back, never
 *     dropped because the file is dated later (draftFate in save-route.js);
 *   · Save hands the saved project back to the portal when it said it would
 *     take one (canSave), else does what it does on any phone (a new file
 *     through the share sheet or a download);
 *   · the service worker is this app's own, at its own scope (/takeoff/),
 *     with its own caches (ptt-web-*): nothing of the portal's.
 *
 * ON when this page is framed by a page of its own site (framedBySameSite:
 * a frame from any other site is never embedded) AND it came with the
 * portal's `#portal=` hand-over. The hand-over's address is consumed at
 * once (a reload must not wait for a plan that already came), so the answer
 * is remembered for this tab (sessionStorage, which a frame shares only with
 * pages of its own site in the same tab): a reload inside the same frame is
 * still inside the portal. Never on in a tab of its own, whatever is
 * remembered.
 */

import { parsePortalHash, framedBySameSite } from './portal-handoff.js';
import { HANDHELD_SAVE, handheldSaveWords } from './save-route.js';

/** sessionStorage: this tab's frame has been the portal's (the hand-over's address is gone after the first load). */
export const EMBEDDED_KEY = 'ptt.embedded.v1';

/** The decision, from what was seen: framed by a page of this site, and handed over now or before in this tab. */
export function embeddedFrom({ framed = false, handoff = false, remembered = false } = {}) {
  return !!framed && (!!handoff || !!remembered);
}

/**
 * Whether this page runs inside the portal — read off the window (`win`), and
 * remembered for the next load of this frame when it does. Never throws: a
 * blocked store only forgets.
 */
export function detectEmbedded(win = globalThis) {
  const framed = framedBySameSite(win);
  if (!framed) return false;
  const handoff = !!parsePortalHash((win.location && win.location.hash) || '');
  let remembered = false;
  try { remembered = win.sessionStorage.getItem(EMBEDDED_KEY) === '1'; } catch { remembered = false; }
  const on = embeddedFrom({ framed, handoff, remembered });
  if (on && handoff) {
    try { win.sessionStorage.setItem(EMBEDDED_KEY, '1'); } catch { /* not remembered: the next load is not embedded */ }
  }
  return on;
}

/**
 * Where plans come from: inside the portal, always the portal's way
 * ('sharepoint'), whatever this device's Settings or the company line say —
 * the folder and the old portal's copies are not this site's. Otherwise as
 * before (`resolve`: js/core/plans-folder.js resolvePlansSource).
 */
export function plansSourceFor({ embedded = false, personal = null, company = null, resolve } = {}) {
  if (embedded) return 'sharepoint';
  return resolve(personal, company);
}

// ── the words ─────────────────────────────────────────────────────────────

/** Inside the portal: where plans come from. Only what exists is promised. */
export const EMBEDDED_PLANS = 'Plans come from the portal: 📐 on the project, or its Plans Library. '
  + 'It saves them on this device and opens them here.';

/** The start screen's status line inside the portal. */
export const EMBEDDED_IDLE = 'Open a plan from the portal: 📐 on the project, or its Plans Library.';

/** File › Keep on This Device inside the portal: the portal keeps plans on this device, not this app. */
export const EMBEDDED_NO_KEEP = 'Inside the portal, plans are kept on this device by the portal\'s Plans Library '
  + '(📐 › Save to this device), not by this app.';

/** File › Plans Archive inside the portal. */
export const EMBEDDED_NO_ARCHIVE = 'Inside the portal there is no Plans Archive folder. ' + EMBEDDED_PLANS;

/** Nothing came from the portal into its frame (a reload of a used frame, or a portal page that went away). */
export const EMBEDDED_NOTHING = 'Nothing came from the portal — close this and open the plan again: 📐 on the project, '
  + 'or its Plans Library.';

/**
 * A plan opened over the internet inside the portal (its Plans Library had
 * no room to keep it on the device, C3): it is never handed back, and how
 * its work may yet reach OneDrive — only where the portal lets this person
 * save plans back (its switch on, and admin or Sees prices with "Can upload
 * to OneDrive"), which this page cannot know, so it is said as an "if" —
 * then what Save does here (HANDHELD_SAVE). Said inside the portal only: a
 * tab of its own is never offered a save, whatever it reopens.
 */
export const TO_ONEDRIVE_HINT = 'A plan opened over the internet is not saved back to OneDrive from here. '
  + 'If the portal lets you save plans back, open it again from 📐 when this device has room to keep it: '
  + 'Save then hands it to the portal.';
export const NO_SAVE_BACK = `${TO_ONEDRIVE_HINT} ${HANDHELD_SAVE}`;

/**
 * The words said when such a plan opens: NO_SAVE_BACK — unless it is too big
 * for Save to make a file of it on this phone or tablet (js/core/save-route.js
 * remoteSaveRefused: its sheets would all come into memory at once), when
 * what Save does there is said instead (review MEM-1). Never a promise of a
 * file that cannot come.
 *
 *   remoteBytes  its sheets' bytes on the server (remoteSaveBytes)
 */
export function noSaveBackWords({ remoteBytes = 0, device = 'device', handheld = true } = {}) {
  return `${TO_ONEDRIVE_HINT} ${handheldSaveWords({ remoteBytes, device, handheld })}`;
}

/**
 * Said in "Unsaved work found" inside the portal, for a draft kept before the
 * portal said who is signed in (js/core/save-route.js findDraft `legacy`):
 * it may be another person's, and saying no leaves it as it is.
 */
export const DRAFT_OF_ANYONE = 'It was kept on this device before the portal told this app who is signed in, so on a '
  + 'device more than one person uses it may be someone else\'s work. Restore it only if it is yours: Cancel leaves it '
  + 'as it is.';

/** The fallback offered beside a save the portal did not keep: P1's share sheet or download, under its own name. */
export const COPY_TO_FILES = 'Save a copy to Files';
