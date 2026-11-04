/* Handing a plan to the takeoff app (Professional Takeoff Tools on the web, takeoff-web; owner 2026-10-26, and on a
   phone or a tablet inside the portal: owner decision Q4, 2026-11-04).

   Two ways to reach the app, ONE conversation with it (takeoff-web js/core/portal-handoff.js is the other half):
     · a computer: takeoff-web on its own site (map/plans.js TAKEOFF_ORIGIN) in a new tab - nothing of this portal's
       storage can be read there and nothing of a plan may travel in an address (a download link is a credential);
     · a phone or a tablet (map/plans.js planRoute; the home-screen app and Safari alike): the portal's own copy of
       takeoff-web (site/takeoff/, tools/vendor-takeoff.mjs) in a full-screen frame over the page (js/plan-frame.js) -
       an iPhone or iPad home-screen app opens another site in Safari, without an opener and without the app's
       storage, so only a page of this site can be handed a plan there; the frame shares the app's storage, so the
       Plans Library's own File is handed over and opens with no signal too.
   The conversation (talk(), the same rules for both):
     1. openInTakeoff() opens the app at #portal=<a random word> - the tab in the click itself (no popup blocker stops
        it), or the frame - and keeps that window as the PEER: {win, origin} (the tab: TAKEOFF_ORIGIN; the frame: this
        site's own origin, location.origin);
     2. the app answers {type: "ptt-ready", v: 1, nonce} to this window;
     3. this window posts the plan, to the peer's origin only: {type: "ptt-open", v: 1, nonce, kind: "file", file, ...}
        (a copy saved on this device: a File out of the Plans Library, nothing copied) or {kind: "link", url, ...}
        (a plan in OneDrive, opened over byte ranges);
     4. for a link, the app asks {type: "ptt-renew", v: 1, nonce, req} when it expires; this window answers
        {type: "ptt-link", v: 1, nonce, req, url} ('' when there is none) for as long as the app is open;
     5. once the app really keeps itself on this device for offline use (its service worker and program), it says
        {type: "ptt-offline", v: 1, nonce}: onOffline() - the Plans Library notes it (READY_KEY).
   A message counts only from the peer's window, from the peer's origin, with its word (accepted()).

   With the frame switched off (map/plans.js PLAN_FRAME) a phone or a tablet opens the tab as a computer does, and an
   iPhone or iPad home-screen app is told to open the portal in Safari (handoffProblem). */

import { TAKEOFF_ORIGIN, handoffLink, frameLink, planRoute } from "./map/plans.js";
import * as frame from "./plan-frame.js";

/** The frame is open (a page's own keys - the 📐 menu's Escape - wait while it is). */
export const frameOpen = frame.isOpen;

export const VERSION = 1;
/** How long the app has to say it is ready (a slow phone on a weak signal, the app's first load); the app itself waits
    120 s for the plan after it said so. */
export const READY_WAIT_MS = 90 * 1000;
/** How long, after the app said it is ready, the plan may take (a OneDrive walk for a link): under the app's own 120 s
    wait for it (takeoff-web HANDOFF_WAIT_MS), so it never posts a plan the app has stopped waiting for. */
export const PLAN_WAIT_MS = 100 * 1000;
/** What an iPhone or iPad home-screen app says when the frame is switched off (it opens another site without an
    opener, in Safari - and its storage is not Safari's, so plans are saved and opened from the portal in Safari). */
export const IOS_HOME = "On an iPhone or iPad, open the portal in Safari (not from its home-screen icon) to save and open plans: " +
  "the home-screen app cannot hand a plan to the takeoff app, and Safari does not see plans saved in it.";
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

/** This device opens the takeoff app in the frame (a phone or a tablet, the frame switched on): nothing is refused for
    the home-screen app then - the frame is this site, in this window. */
export function usesFrame(win) {
  const w = win || (typeof window !== "undefined" ? window : null);
  return planRoute(w) === "frame";
}

/** The home-screen app's refusal applies here: an iPhone or iPad home-screen app that would open a tab. */
export function iosHomeRefused(win) {
  return iosHomeScreen(win) && !usesFrame(win);
}

/** A message from the app, or null: only from the peer's window, from the peer's origin, protocol v1, with the word. */
export function accepted(ev, peer, word) {
  if (!ev || !peer || ev.source !== peer.win || ev.origin !== peer.origin) return null;
  const d = ev.data;
  if (!d || typeof d !== "object" || d.v !== VERSION || d.nonce !== word) return null;
  return d;
}

/**
 * The conversation with the app in `peer` ({win, origin, via: "tab" | "frame", closed(), close()}), whose page was
 * opened at #portal=<word>. `host` is the window that hears the app's messages (this window; a test's stand-in).
 * plan(), renew(), done(), onOffline() as openInTakeoff's. -> {stop()}: this side stops listening (the frame closed).
 */
export function talk(peer, word, plan, renew, done, onOffline, host) {
  const listen = host || window;
  const via = peer.via;
  const got = Promise.resolve().then(plan);
  got.catch(function () { /* said when the app asks */ });
  let posted = false, finished = false, kind = "";
  // said first, then closed: closing the frame stops this conversation too (its onClose), which must not say "closed"
  let timer = setTimeout(function () {
    if (posted) return;
    finish({ ok: false, why: "no_answer", via });
    try { peer.close(); } catch (e) { /* not ours to close */ }
  }, READY_WAIT_MS);
  // the tab closed (or the frame): nothing more to answer
  const watch = setInterval(function () { if (peer.closed()) finish(posted ? null : { ok: false, why: "closed", via }); }, 5000);
  function finish(result) {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearInterval(watch);
    listen.removeEventListener("message", onMessage);
    if (result) done(result);
  }
  async function onMessage(ev) {
    const d = accepted(ev, peer, word);
    if (!d) return;
    if (d.type === "ptt-ready" && !posted) {
      posted = true;
      clearTimeout(timer);
      let p;
      let slow = null;
      try {
        p = await Promise.race([got, new Promise(function (_, no) {
          slow = setTimeout(function () {
            no(Object.assign(new Error("OneDrive took too long to answer. Try again in a minute."), { code: "slow" }));
          }, PLAN_WAIT_MS);
        })]);
      } catch (e) {
        finish({ ok: false, why: "failed", error: e, via });
        try { peer.close(); } catch (x) { /* */ }
        return;
      } finally {
        clearTimeout(slow);
      }
      if (finished) return;                                   // closed meanwhile: nothing to report as opened
      try {
        peer.win.postMessage(Object.assign({}, p, { type: "ptt-open", v: VERSION, nonce: word }), peer.origin);
      } catch (e) {
        finish({ ok: false, why: "failed", error: e, via });
        return;
      }
      kind = p.kind;
      done({ ok: true, via, kind });
      // a saved copy needs nothing more but the "kept for offline use" word; a link may be asked again while the app
      // is open
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
      try { peer.win.postMessage({ type: "ptt-link", v: VERSION, nonce: word, req: d.req, url }, peer.origin); } catch (e) { /* gone */ }
    }
  }
  listen.addEventListener("message", onMessage);
  return { stop: function () { finish(posted ? null : { ok: false, why: "closed", via }); } };
}

/**
 * Open the takeoff app and hand it a plan: in the frame on a phone or a tablet, else in a new tab - call it IN the click
 * (a tab must open at once).
 *   plan()   async -> {kind: "file", file, name, size, lastModified, number, updateAvailable}
 *                  | {kind: "link", url, name, size, lastModified, number}; asked at once (it runs while the app loads)
 *   renew()  async -> a fresh link ("" when none) - for kind "link"
 *   onDone({ok, why, error, via})  the plan was posted (ok), or why not: "blocked" (no tab: a popup blocker),
 *            "no_answer" (the app did not answer: offline before it was ever kept on this device), "failed" (plan()
 *            failed: error), "ios_home" (the frame switched off, an iPhone or iPad home-screen app), "closed" (the
 *            person closed the frame first), "busy" (the frame already open with something that would be lost).
 *            via: "tab" | "frame". (openOnDevice adds "paused": the person paused the plan's download.)
 *   onOffline()  the app said it keeps itself on this device for offline use
 *   opts.title   the frame's title (the plan's name)
 */
export function openInTakeoff(plan, renew, onDone, onOffline, opts) {
  const word = nonce();
  const done = typeof onDone === "function" ? onDone : function () {};
  if (usesFrame()) {
    let ctl = null;
    const peer = frame.open(frameLink(word), { title: (opts && opts.title) || "", onClose: function () { if (ctl) ctl.stop(); } });
    // none: no page to show it on, or the takeoff app already open with something that would be lost
    if (!peer) { done({ ok: false, why: frame.isOpen() ? "busy" : "blocked", via: "frame" }); return; }
    // the page under the frame cannot be read while it is open: a problem is said on the frame's bar too (the frame
    // stays open when closing it would lose work: js/plan-frame.js closeIfIdle)
    ctl = talk(peer, word, plan, renew, function (r) {
      if (r && !r.ok && r.why !== "closed") frame.say(handoffProblem(r), "warn");
      done(r);
    }, onOffline);
    return;
  }
  if (iosHomeScreen()) { done({ ok: false, why: "ios_home", via: "tab" }); return; }
  let win = null;
  try { win = window.open(handoffLink(word), "_blank"); } catch (e) { win = null; }
  if (!win) { done({ ok: false, why: "blocked", via: "tab" }); return; }
  talk({ win, origin: TAKEOFF_ORIGIN, via: "tab", closed: function () { return win.closed; },
    close: function () { win.close(); } }, word, plan, renew, done, onOffline);
}

/** What to tell the person when a hand-over did not happen. */
export function handoffProblem(result, win) {
  if (!result || result.ok || result.why === "closed") return "";
  const tab = result.via !== "frame";
  if (result.why === "ios_home" || (tab && (result.why === "blocked" || result.why === "no_answer") && iosHomeScreen(win))) return IOS_HOME;
  if (result.why === "blocked") {
    return tab ? "The browser blocked the new tab. Allow pop-ups for the portal, then try again." : "The takeoff app could not open on this page. Reload the page and try again.";
  }
  if (result.why === "no_answer") {
    return "The takeoff app did not answer. Open a plan once while online so this device keeps the takeoff app for offline use, then try again.";
  }
  if (result.why === "paused") return "The download was paused, so the plan did not open. Tap Open to carry on.";
  if (result.why === "busy") return "The takeoff app is open with changes that are not saved: save or close it first, then open this plan.";
  return (result.error && result.error.message) || "The plan could not be handed to the takeoff app.";
}
