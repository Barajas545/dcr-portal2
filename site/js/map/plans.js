/* The plan buttons and the Floor Plans card (owner decisions 2026-10-26). The owner's .takeoff files live in his
   OneDrive folder "Projects-Takeoff-Files" (a folder per project, its name starting with the project's number), and
   takeoff-web opens them from each person's own Plans Archive on their computer (or the plans kept on that device):
   the bytes never pass through the portal or the broker. The broker only COUNTS them (op plans_for, read only:
   js/repo/onedrive.js plansFor) - no file or folder name, no item id, no link comes back.

   (1) a project whose takeoff folder(s) hold at least one .takeoff file shows 📐 in Search and on its page, opening
       takeoff-web at its number (#plans=<number>) in a new tab;
   (2) EVERYONE who can see the project sees the button (the owner's choice: the price gate stays the OneDrive
       sharing of the folder - takeoff-web opens only what that person's computer has);
   (4) the home page's Floor Plans card (takeoff-web's #plans) for the people who see prices (an admin, Sees prices).

   * plansLink(number)            takeoff-web at a project's plans ("#plans=A249"), or the archive itself ("#plans");
   * PLANS_HOME                   takeoff-web's plans: the Floor Plans card;
   * planEntry(v)                 one project of a plans_for answer as the pages use it ({number, plans}), or null;
   * planLabel / planTitle        the button's accessible name and its tooltip (the count);
   * planButtonHtml(entry, style) the button ("icon": Search's square beside the result; "button": the project
                                  header's), or "" for a project without a takeoff file (plans 0) or without a number;
   * plansCardFor(me)             whether the home page shows the Floor Plans card.

   On a phone or a tablet (owner decision Q4, 2026-11-04) the takeoff app opens INSIDE the portal - the portal's own copy
   of takeoff-web (site/takeoff/, tools/vendor-takeoff.mjs) in a full-screen frame (js/plan-frame.js), in the
   home-screen app and in Safari alike; a computer keeps the new tab (and its Plans Archive folder, saved in place
   through OneDrive sync). And no door of a phone or a tablet leads to the Plans Archive any more (a folder only Chrome
   or Edge on a computer can open: a dead end there): the 📐 button, the Floor Plans card and the Takeoffs tab's link
   open the 📐 menu or the Plans Library instead, and for the people who do not see prices they say so.
   * PLAN_FRAME                   the frame's switch (on): off, a phone or a tablet opens the tab as a computer does;
   * handheld(win)                a phone or a tablet (an iPad that calls itself a Mac included), as takeoff-web's own
                                  isPhoneOrTablet says it (js/core/plans-link.js): both apps call the same device one;
   * planRoute(win)               "frame" or "tab": where this device opens the takeoff app;
   * frameLink(nonce)             the portal's copy at #portal=<the hand-over's word>;
   * floorPlansCard(me, handheld) the Floor Plans card's address and words for this device.

   Pure module (node tests import it). */

export const TAKEOFF_WEB = "https://barajas545.github.io/takeoff-web/index.html";
export const PLANS_HOME = TAKEOFF_WEB + "#plans";
/** The takeoff app's site: the Plans Library hands it a plan window to window (js/plan-handoff.js), to this address only. */
export const TAKEOFF_ORIGIN = new URL(TAKEOFF_WEB).origin;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
/** The takeoff app inside the portal on a phone or a tablet (owner decision Q4, 2026-11-04). Off: back to the new tab
    everywhere (and the iPhone or iPad home-screen app told to use Safari) - nothing else changes. */
export const PLAN_FRAME = true;
/** The portal's own copy of the takeoff app, beside every page of the site (they all sit at its root, as the manifest's
    start page does). */
export const TAKEOFF_FRAME = "takeoff/index.html";

/** The takeoff app in a new tab, waiting for the plan this page hands it (takeoff-web js/core/portal-handoff.js). */
export function handoffLink(nonce) {
  if (!NONCE.test(String(nonce || ""))) throw new Error("not a hand-over word");
  return TAKEOFF_WEB + "#portal=" + nonce;
}

/** The portal's copy of the takeoff app in the frame, waiting for the plan this page hands it. */
export function frameLink(nonce) {
  if (!NONCE.test(String(nonce || ""))) throw new Error("not a hand-over word");
  return TAKEOFF_FRAME + "#portal=" + nonce;
}

function coarsePointer(win) {
  try { return !!(win && typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches); } catch (e) { return false; }
}

/**
 * A phone or a tablet rather than a computer - takeoff-web's own rule (js/core/plans-link.js isPhoneOrTablet), so the
 * portal and the app never disagree about a device:
 *   · userAgentData.mobile when it says so (Chrome and Edge on a phone; false on an Android tablet is not the last word);
 *   · the user agent's own words for a phone or a tablet (Safari and Firefox have no userAgentData);
 *   · iPadOS asks for the desktop site and calls itself a Mac - a "Mac" with touch points is an iPad (a Mac has none);
 *   · Windows and ChromeOS are computers, touch screen or not (a folded touch laptop still has Edge);
 *   · anything else (an Android tablet asking for the desktop site says "X11; Linux"): touch with a coarse pointer.
 */
export function handheld(win) {
  const nav = (win && win.navigator) || {};
  const ua = String(nav.userAgent || "");
  const uad = nav.userAgentData;
  if (uad && uad.mobile === true) return true;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua)) return true;
  const touch = Number(nav.maxTouchPoints) > 0;
  if (touch && /Macintosh/.test(ua)) return true;
  if (/Windows NT|CrOS/.test(ua)) return false;
  return touch && coarsePointer(win);
}

/** Where this device opens the takeoff app: "frame" (a phone or a tablet, the frame switched on) or "tab". `on`
    stands in for PLAN_FRAME (a test). */
export function planRoute(win, on) {
  return (on === undefined ? PLAN_FRAME : !!on) && handheld(win) ? "frame" : "tab";
}

/** The Plans Library (save plan files on this device, the 📐 menu of files): the people who see prices, as the
    Floor Plans card - plan files carry prices (the broker's plans_list / plan_link refuse anyone else). */
export function planFilesFor(me) {
  return plansCardFor(me);
}
/** A project number as the broker answers one (A068, A024-B, A000T1): short text without control characters. */
const NUMBER = /^[^\u0000-\u001f\u007f]{1,40}$/;

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** takeoff-web's Plans Archive at this project's plans ("#plans=A249"), or the archive itself without a number. */
export function plansLink(number) {
  const n = String(number == null ? "" : number).trim();
  return TAKEOFF_WEB + (n ? "#plans=" + encodeURIComponent(n) : "#plans");
}

/** {number, plans} from one project of the broker's answer; anything else (a malformed answer) is null. */
export function planEntry(v) {
  if (!v || typeof v !== "object") return null;
  const number = typeof v.number === "string" ? v.number.trim() : "";
  if (!NUMBER.test(number)) return null;
  if (typeof v.plans !== "number" || !Number.isSafeInteger(v.plans) || v.plans < 0) return null;
  return { number, plans: v.plans };
}

export function planLabel(number) {
  return "Plans for " + number + " — open in the takeoff app";
}

export function planTitle(number, plans) {
  return plans + " takeoff file" + (plans === 1 ? "" : "s") + " for " + number +
    " — opens its plans in the takeoff app (your Plans Archive, or the plans kept on this device)";
}

/** The 📐 button of a project with at least one takeoff file, or "" (no button). `menu`: the person sees prices, so
    the button opens the menu of the project's plan files (js/pages/plan-buttons.js) - the link stays for a middle
    click and for a page whose script has not run. `hand` (a phone or a tablet): the Plans Archive is no door there, so
    the button of a person who does not see prices says why instead (data-plan-none: "Plans are for the people who see
    prices"), and a price person's link is the Plans Library (the menu opens over it). */
export function planButtonHtml(entry, style, menu, hand) {
  const e = planEntry(entry);
  if (!e || e.plans < 1) return "";
  const href = hand ? "plans-library.html" : plansLink(e.number);
  const attrs = ' href="' + esc(href) + '"' + (hand ? "" : ' target="_blank" rel="noopener"') + ' aria-label="' +
    esc(menu ? "Plans for " + e.number + " — open or save the plan files" : hand ? "Plans for " + e.number : planLabel(e.number)) +
    '" title="' + esc(menu ? e.plans + " takeoff file" + (e.plans === 1 ? "" : "s") + " for " + e.number +
      " — open one, or save it on this device" : hand ? e.plans + " takeoff file" + (e.plans === 1 ? "" : "s") + " for " + e.number
      : planTitle(e.number, e.plans)) + '"' +
    (menu ? ' data-plan-menu="' + esc(e.number) + '" aria-haspopup="dialog"' : hand ? ' data-plan-none="' + esc(e.number) + '" aria-haspopup="dialog"' : "");
  const arrow = hand ? "" : " ↗";
  if (style === "button") return '<a class="pj-btn"' + attrs + '><span aria-hidden="true">📐 Plans' + arrow + "</span></a>";
  return '<a class="se-plan-go"' + attrs + '><span class="ic" aria-hidden="true">📐</span><span class="tx" aria-hidden="true">Plans</span></a>';
}

/** What a phone or a tablet says to a person who does not see prices, where a computer opens the Plans Archive. */
export const PRICES_ONLY = "Plans are for the people who see prices: plan files carry prices.";

/** The home page's Floor Plans card: the people who see prices (an admin, or Sees prices) - decision 4. */
export function plansCardFor(me) {
  return !!me && me.active !== false && me.role !== "agents" && (me.role === "admin" || !!me.can_see_prices);
}

/** The Floor Plans card for this device: a computer's opens takeoff-web's plans in a new tab (the Plans Archive and
    the plans kept on that computer); a phone's or a tablet's the Plans Library (plans open inside the portal there).
    -> {href, ext, ds}. */
export function floorPlansCard(hand) {
  return hand
    ? { href: "plans-library.html", ext: false, ds: "Open plans on this device: the Plans Library, or 📐 on a project." }
    : { href: PLANS_HOME, ext: true, ds: "Open plans in the takeoff app — the Plans Archive and the plans kept on this device." };
}
