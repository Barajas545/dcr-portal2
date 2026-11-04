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
        {type: "ptt-offline", v: 1, nonce}: onOffline() - the Plans Library notes it (READY_KEY);
     6. the save back (owner decisions Q1-Q3, 2026-11-04; contract C2): a plan handed to the FRAME as a file, for a
        person who may save it back (map/plans.js saveBackFor), comes with canSave: true. The app's Save then hands the
        whole saved project over - {type: "ptt-save", v: 1, nonce, req, name, size, file} (saveOf: req at most 20
        characters, the opened plan's file name, size === file.size) - and this window answers
        {type: "ptt-save-state", v: 1, nonce, req, state, why?}: "kept" once the Plans Library has the bytes in its own
        storage (spooled and checked: only then does the app mark the project saved), "refused", "no-room" or "failed".
        While it is being kept, "keeping" (pct) - the spool worker's own progress, at most every 2 s - restarts the
        app's 120 s wait each time (takeoff-web's heartbeat; a stalled worker goes silent, so both waits still end it);
        a save queued behind it hears "keeping" without a pct then too. Later, while the app is open, the send to
        OneDrive's news: "sending" (pct), "sent", "copy" (name) or "failed".
        Such a conversation lasts as long as the frame is open (a Save can come any time). A tab is never offered a
        save, and a ptt-save there - or for a plan not offered - is refused.
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

/** A save's own word (takeoff-web's newSaveReq: "s" and nine more; at most 20 of these characters). */
export const REQ_RE = /^[A-Za-z0-9_-]{1,20}$/;
/** The opened plan's file name, as takeoff-web sends it (never a path) - the rule of a plan's name (map/plan-library.js). */
const SAVE_NAME = /^[^\u0000-\u001f\u007f/\\]{1,250}\.takeoff$/i;
/** The words the app is told back, a sentence at most this long. */
const WHY_MAX = 300;

/**
 * A ptt-save as the Plans Library takes it ({req, name, size, file}), {req, why} when it is not one to keep (answered
 * "refused" with that why), or null when it carries no word to answer to (nothing is said). The file is the saved
 * project itself - a Blob (or File) of exactly `size` bytes, handed over by reference: never read here.
 */
export function saveOf(d) {
  if (!d || typeof d !== "object" || d.type !== "ptt-save" || typeof d.req !== "string" || !REQ_RE.test(d.req)) return null;
  const req = d.req;
  if (typeof d.name !== "string" || !SAVE_NAME.test(d.name)) return { req, why: "That is not a takeoff project file's name." };
  if (!Number.isSafeInteger(d.size) || d.size <= 0) return { req, why: "The save did not say how big it is." };
  const f = d.file;
  const blob = !!f && typeof f === "object" && typeof f.slice === "function" && (typeof Blob === "undefined" || f instanceof Blob);
  if (!blob || f.size !== d.size) return { req, why: "The save did not arrive whole: save again." };
  return { req, name: d.name, size: d.size, file: f };
}

/** The answers that end a save's wait in the app (one each); every other word about a save is news. */
export const SAVE_FINAL = Object.freeze(["kept", "refused", "no-room", "failed"]);

/** The answer about save `req` ({type: "ptt-save-state", v, nonce, req, state, why?, pct?, name?}). "keeping" (pct?) is
    the heartbeat while the save is being kept: takeoff-web restarts its 120 s wait at each one (its portal-handoff.js
    SAVE_PROGRESS) and shows the pct on its bar. */
export function saveState(word, req, state, extra) {
  const x = extra || {};
  const m = { type: "ptt-save-state", v: VERSION, nonce: word, req, state };
  if (x.why) m.why = String(x.why).replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, WHY_MAX);
  if ((state === "sending" || state === "keeping") && typeof x.pct === "number" && isFinite(x.pct)) m.pct = Math.max(0, Math.min(100, Math.round(x.pct)));
  if (state === "copy" && typeof x.name === "string" && SAVE_NAME.test(x.name)) m.name = x.name;
  return m;
}

/**
 * The conversation with the app in `peer` ({win, origin, via: "tab" | "frame", closed(), close()}), whose page was
 * opened at #portal=<word>. `host` is the window that hears the app's messages (this window; a test's stand-in).
 * plan(), renew(), done(), onOffline(), onSave() as openInTakeoff's. -> {stop()}: this side stops listening (the frame
 * closed).
 */
export function talk(peer, word, plan, renew, done, onOffline, host, onSave) {
  const listen = host || window;
  const via = peer.via;
  const got = Promise.resolve().then(plan);
  got.catch(function () { /* said when the app asks */ });
  let posted = false, finished = false, kind = "", saving = false;
  let saves = Promise.resolve();          // the saves, one at a time in the order they came
  const heard = new Set();                // the save words answered (or being): one answer each
  const queued = new Set();               // the save words waiting behind another one (not started yet)
  const answered = new Set();             // the save words given their answer (no "keeping" after it)
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
      // the save back: offered only to the frame, for a file, when the Plans Library takes it (onSave) and the plan
      // says so (map/plans.js saveBackFor) - never to a tab, never for a link
      saving = via === "frame" && p.kind === "file" && p.canSave === true && typeof onSave === "function";
      const open = Object.assign({}, p, { type: "ptt-open", v: VERSION, nonce: word });
      if (saving) open.canSave = true; else delete open.canSave;
      try {
        peer.win.postMessage(open, peer.origin);
      } catch (e) {
        finish({ ok: false, why: "failed", error: e, via });
        return;
      }
      kind = p.kind;
      done({ ok: true, via, kind });
      // a saved copy needs nothing more but the "kept for offline use" word - unless its saves are taken: then, as a
      // link's renewals, for as long as the app is open; a link may be asked again while the app is open
      if (kind !== "link" && !saving) timer = setTimeout(function () { finish(null); }, OFFLINE_WAIT_MS);
      return;
    }
    if (d.type === "ptt-offline" && posted) {
      if (typeof onOffline === "function") { try { onOffline(); } catch (e) { /* a note only */ } }
      if (kind !== "link" && !saving) finish(null);
      return;
    }
    if (d.type === "ptt-save" && posted) {
      const s = saveOf(d);
      if (!s || heard.has(s.req)) return;                     // no word to answer to, or answered already
      heard.add(s.req);
      if (!saving || !s.file) {
        tell(s.req, "refused", { why: s.why || "The portal does not take a save of this plan here: use Save a copy to Files in the takeoff app." });
        return;
      }
      queued.add(s.req);
      saves = saves.then(async function () {
        queued.delete(s.req);
        let out = null;
        try {
          out = await onSave(s, function (state, extra) {
            // the heartbeat of the save being kept goes to the ones waiting behind it too (no pct: not started)
            if (state === "keeping") queued.forEach(function (q) { tell(q, "keeping"); });
            tell(s.req, state, extra);
          });
        } catch (e) {
          out = { state: "failed", why: (e && e.message) || "The save could not be kept on this device." };
        }
        const state = out && SAVE_FINAL.indexOf(out.state) !== -1 ? out.state : "failed";
        tell(s.req, state, { why: out && out.why });
      });
      return;
    }
    if (d.type === "ptt-renew" && posted && kind === "link" && typeof d.req === "string" && d.req.length <= 20) {
      let url = "";
      try { url = String((typeof renew === "function" ? await renew() : "") || ""); } catch (e) { url = ""; }
      try { peer.win.postMessage({ type: "ptt-link", v: VERSION, nonce: word, req: d.req, url }, peer.origin); } catch (e) { /* gone */ }
    }
  }
  /** A word about save `req` to the app (its answer, then the send's news while it is open). */
  function tell(req, state, extra) {
    if (finished) return;
    if (state === "keeping" && answered.has(req)) return;   // its answer is out: the heartbeat is over
    if (SAVE_FINAL.indexOf(state) !== -1) answered.add(req);
    try { peer.win.postMessage(saveState(word, req, state, extra), peer.origin); } catch (e) { /* the frame went */ }
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
 *   opts.onSave(save, tell)  the frame only (a tab is never offered a save): the app's ptt-save ({req, name, size,
 *            file}: saveOf) -> {state: "kept" | "refused" | "no-room" | "failed", why} - its answer; tell(state, extra)
 *            says the send's news ("sending" {pct}, "sent", "copy" {name}, "failed" {why}) while the app is open. Only
 *            a plan() that says canSave: true is offered it.
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
    }, onOffline, null, opts && opts.onSave);
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
