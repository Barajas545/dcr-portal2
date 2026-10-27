/* Handing a plan to the takeoff app (Professional Takeoff Tools on the web, takeoff-web; owner 2026-10-26).

   The takeoff app is another site (map/plans.js TAKEOFF_ORIGIN), so nothing of this portal's storage can be read
   there and nothing of a plan may travel in an address (a download link is a credential). The two windows talk
   instead (takeoff-web js/core/portal-handoff.js is the other half):
     1. openInTakeoff() opens the app in a new tab at #portal=<a random word> - in the click itself, so no popup
        blocker stops it - and keeps that tab's window;
     2. the app answers {type: "ptt-ready", v: 1, nonce} to this window;
     3. this window posts the plan, to the app's address only: {type: "ptt-open", v: 1, nonce, kind: "file", file, ...}
        (a copy saved on this device: a File out of the Plans Library, nothing copied) or {kind: "link", url, ...}
        (a plan in OneDrive, opened over byte ranges);
     4. for a link, the app asks {type: "ptt-renew", v: 1, nonce, req} when it expires; this window answers
        {type: "ptt-link", v: 1, nonce, req, url} ('' when there is none) for as long as it stays open;
     5. once the app really keeps itself on this device for offline use (its service worker and program), it says
        {type: "ptt-offline", v: 1, nonce}: onOffline() - the Plans Library notes it (READY_KEY).
   A message counts only from that tab, from the app's address, with its word.

   An iPhone or iPad home-screen app opens another site without an opener (and in Safari), so nothing can be handed
   over from there: the person is told to open the portal in Safari (handoffProblem). */

import { TAKEOFF_ORIGIN, handoffLink } from "./map/plans.js";

export const VERSION = 1;
/** How long the new tab has to say it is ready (a slow phone on a weak signal, the app's first load); the app itself
    waits 120 s for the plan after it said so. */
export const READY_WAIT_MS = 90 * 1000;
/** After a saved copy is handed over, how long this window still listens for "kept for offline use". */
const OFFLINE_WAIT_MS = 4 * 60 * 1000;
/** When the takeoff app last said it keeps itself on this device for offline use (localStorage; an ISO time). */
export const READY_KEY = "dcr2-takeoff-ready-at";

function nonce() {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode.apply(null, Array.from(a))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** When the takeoff app last said it is kept for offline use here (an ISO time), or null. */
export function lastReady() {
  try { return localStorage.getItem(READY_KEY) || null; } catch (e) { return null; }
}

/** An iPhone or iPad home-screen app (another site opens without an opener there). */
export function iosHomeScreen(win) {
  const w = win || (typeof window !== "undefined" ? window : null);
  if (!w || !w.navigator) return false;
  const ua = String(w.navigator.userAgent || "");
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (w.navigator.maxTouchPoints || 0) > 1);
  let standalone = w.navigator.standalone === true;
  try { standalone = standalone || (typeof w.matchMedia === "function" && w.matchMedia("(display-mode: standalone)").matches); } catch (e) { /* */ }
  return ios && standalone;
}

/**
 * Open the takeoff app in a new tab and hand it a plan. Call it IN the click (it opens the tab at once).
 *   plan()   async -> {kind: "file", file, name, size, lastModified, number, updateAvailable}
 *                  | {kind: "link", url, name, size, lastModified, number}; asked at once (it runs while the app loads)
 *   renew()  async -> a fresh link ("" when none) - for kind "link"
 *   onDone({ok, why, error})  the plan was posted (ok), or why not: "blocked" (no tab: a popup blocker), "no_answer"
 *            (the app did not answer: offline before it was ever kept on this device, or a home-screen app on an iPhone
 *            or iPad), "failed" (plan() failed: error)
 *   onOffline()  the app said it keeps itself on this device for offline use
 */
export function openInTakeoff(plan, renew, onDone, onOffline) {
  const word = nonce();
  const done = typeof onDone === "function" ? onDone : function () {};
  let win = null;
  try { win = window.open(handoffLink(word), "_blank"); } catch (e) { win = null; }
  if (!win) { done({ ok: false, why: "blocked" }); return; }
  const got = Promise.resolve().then(plan);
  got.catch(function () { /* said when the app asks */ });
  let posted = false, finished = false, kind = "";
  let timer = setTimeout(function () { if (!posted) finish({ ok: false, why: "no_answer" }); }, READY_WAIT_MS);
  // the tab closed: nothing more to answer
  const watch = setInterval(function () { if (win.closed) finish(null); }, 5000);
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearInterval(watch);
    window.removeEventListener("message", onMessage);
    if (result) done(result);
  }
  async function onMessage(ev) {
    if (ev.source !== win || ev.origin !== TAKEOFF_ORIGIN) return;
    const d = ev.data;
    if (!d || typeof d !== "object" || d.v !== VERSION || d.nonce !== word) return;
    if (d.type === "ptt-ready" && !posted) {
      posted = true;
      clearTimeout(timer);
      let p;
      try { p = await got; } catch (e) {
        try { win.close(); } catch (x) { /* */ }
        finish({ ok: false, why: "failed", error: e });
        return;
      }
      try {
        win.postMessage(Object.assign({}, p, { type: "ptt-open", v: VERSION, nonce: word }), TAKEOFF_ORIGIN);
      } catch (e) {
        finish({ ok: false, why: "failed", error: e });
        return;
      }
      kind = p.kind;
      done({ ok: true });
      // a saved copy needs nothing more but the "kept for offline use" word; a link may be asked again while this
      // page is open
      if (kind !== "link") timer = setTimeout(function () { finish(null); }, OFFLINE_WAIT_MS);
      return;
    }
    if (d.type === "ptt-offline" && posted) {
      if (typeof onOffline === "function") { try { onOffline(); } catch (e) { /* a note only */ } }
      if (kind !== "link") finish(null);
      return;
    }
    if (d.type === "ptt-renew" && posted && kind === "link" && typeof d.req === "string" && d.req.length <= 20) {
      let url = "";
      try { url = String((typeof renew === "function" ? await renew() : "") || ""); } catch (e) { url = ""; }
      try { win.postMessage({ type: "ptt-link", v: VERSION, nonce: word, req: d.req, url }, TAKEOFF_ORIGIN); } catch (e) { /* gone */ }
    }
  }
  window.addEventListener("message", onMessage);
}

/** What to tell the person when a hand-over did not happen. */
export function handoffProblem(result, win) {
  if (!result || result.ok) return "";
  if ((result.why === "blocked" || result.why === "no_answer") && iosHomeScreen(win)) {
    return "On an iPhone or iPad, plans open from the portal in Safari: open portal.dcrframing.com in Safari (not from the home-screen icon), then tap Open again.";
  }
  if (result.why === "blocked") return "The browser blocked the new tab. Allow pop-ups for the portal, then try again.";
  if (result.why === "no_answer") {
    return "The takeoff app did not answer. Open a plan once while online so this device keeps the takeoff app for offline use, then try again.";
  }
  return (result.error && result.error.message) || "The plan could not be handed to the takeoff app.";
}
