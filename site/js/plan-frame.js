/* The takeoff app inside the portal, on a phone or a tablet (owner decision Q4, 2026-11-04; map/plans.js planRoute).

   The portal's own copy of takeoff-web (site/takeoff/: one reviewed commit, tools/vendor-takeoff.mjs) in a frame over
   the whole page - not a new tab: an iPhone or iPad home-screen app opens another site in Safari, without an opener and
   without the app's storage, so a plan saved on the device could never reach it there. A page of this site, in this
   window, shares the app's storage: it is handed the Plans Library's own File, and it opens from the home-screen icon
   and with no signal (takeoff's own service worker keeps the copy; site/sw.js leaves takeoff/ alone).

   js/plan-handoff.js talks to it exactly as to a computer's new tab - the same messages, the same rules. This module is
   only the frame: the overlay and its bar, the page under it held still, and the PEER the hand-over talks to:
   {win: the frame's own window, origin: this site's (location.origin)}. A message counts only from that window, from
   this site, with the hand-over's word (plan-handoff.js accepted()) - the frame is never another site's page, and no
   other frame or window of this site can speak for it.

   Closing it:
   * at once when nothing would be lost;
   * asked first while the takeoff app has changes it has not saved (its own TakeoffApp.app.project.dirty: the live
     objects it exposes for the portal embed), or while a save is being kept on this device or sent to OneDrive (guard():
     the save-back, P4, says what is in flight) - closeQuestion() words it, unsaved changes first;
   * then the app keeps its draft (TakeoffApp.saveDraftNow, at most 3 s: keepDraft) before its frame goes;
   * the hand-over itself closes it only when nothing would be lost (closeIfIdle: the app never answered, or the plan
     could not be read) and otherwise says why on the bar.
   The ✕ Close button and Escape on the bar do the same; Escape inside the frame is the app's own (it ends a
   measurement there). While it is open the page under it cannot scroll, be tapped or take the focus (inert), and the
   focus goes back where it was afterwards.

   On an iPhone or iPad the frame follows the visual viewport (the on-screen keyboard and the home-screen app's
   translucent status bar: safe-area insets), so its bar never slides under either.

   The copy's page loads only once its own service worker is registered (takeoffWorker: else the app reloads itself
   under the portal's worker on a first visit and loses the hand-over's word). Browser-only module (node tests import
   its pure helpers: peerOf, closeQuestion, unsavedIn, viewportBox, takeoffWorker, keepDraft). */

/** What the frame's page may use: a same-site page has these by default anyway (their allowlists are 'self'); said so
    that its Save can still reach the share sheet (web-share) and a link be copied, whatever a browser's default. No
    sandbox: the copy is this site's own reviewed program, held by its own page policy (no inline script). */
export const FRAME_ALLOW = "fullscreen; clipboard-write; web-share";

/** The copy's own service worker - the script and scope takeoff-web registers itself (one registration) - and how long
    the frame's page waits for it (offline, or a browser without workers: it loads anyway). */
export const TAKEOFF_SW = "takeoff/sw.js";
export const TAKEOFF_SCOPE = "takeoff/";
/** A first install keeps the app's whole program (about a megabyte): a slow phone may need a while. */
export const WORKER_WAIT_MS = 20000;
const READYING = "Getting the takeoff app ready on this device…";

/**
 * The copy's own worker registered and ACTIVE before its page loads in the frame. Otherwise, on a first visit, the
 * frame's page belongs to the portal's worker (its scope "./" covers takeoff/; site/sw.js only lets the requests
 * through), and when the copy's own worker then takes it over (clients.claim) the app sees a new controller and reloads
 * itself as for an update - losing the #portal=<word> it was opened with, so the plan never arrives (seen in headless
 * Chrome, 2026-11-04, also with the registration made first but not yet active). Active first, the frame's page is that
 * worker's from the start, and its claim changes nothing. An existing registration is used as it is (no second update
 * check). `nav`, `base`: the browser's navigator and this page's address (a test's stand-ins). -> the registration
 * (active, or still installing after `ms`), or null (no workers here, a refusal: offline before it was ever kept).
 * Never throws.
 */
export function takeoffWorker(nav, base, ms) {
  const sw = nav && nav.serviceWorker;
  if (!sw || typeof sw.register !== "function") return Promise.resolve(null);
  const scope = new URL(TAKEOFF_SCOPE, base).href;
  return Promise.resolve(typeof sw.getRegistration === "function" ? sw.getRegistration(scope) : null)
    .then(function (reg) { return reg && reg.scope === scope ? reg : sw.register(new URL(TAKEOFF_SW, base).href, { scope }); })
    .then(function (reg) { return activeOf(reg, ms === undefined ? WORKER_WAIT_MS : ms); })
    .catch(function () { return null; });
}

/** `reg` once it has an active worker (an install that fails, "redundant", or `ms` passing: as it is). */
export function activeOf(reg, ms) {
  if (!reg || reg.active) return Promise.resolve(reg || null);
  const w = reg.installing || reg.waiting;
  if (!w || typeof w.addEventListener !== "function") return Promise.resolve(reg);
  return new Promise(function (resolve) {
    const t = setTimeout(done, ms);
    function done() { clearTimeout(t); w.removeEventListener("statechange", on); resolve(reg); }
    function on() { if (reg.active || w.state === "activated" || w.state === "redundant") done(); }
    w.addEventListener("statechange", on);
    on();
  });
}

let shell = null;
let active = null;          // {frame, onClose, back, inerted, overflow}
let listening = false;
let asking = false;         // Close's question is on screen
const guards = [];

function el(id) { return document.getElementById(id); }
function dcr2() { return (typeof window !== "undefined" && window.DCR2) || {}; }

/** The hand-over's peer for this frame: its own window, this site's origin (never "*", never another site's). */
export function peerOf(frame, loc) {
  return {
    win: frame.contentWindow,
    origin: loc.origin,
    via: "frame",
    closed: function () { return !active || active.frame !== frame; },
    close: function () { closeIfIdle(); },
  };
}

/** Whether the takeoff app in this window has changes it has not saved: true, false, or null (no app there yet - still
    loading, or a page that is not the app, such as a browser's offline page). Never throws. */
export function unsavedIn(win) {
  try {
    const t = win && win.TakeoffApp;
    if (!t || !t.app || !t.app.project) return null;
    return !!t.app.project.dirty;
  } catch (e) { return null; }
}

/** What Close asks first, or null (it closes at once). `busy`: what a guard says is in flight - a sentence (a save
    being kept on this device) or a whole question {title, text, okText, danger} (a save being sent to OneDrive); both
    go on in the page after the frame closes, so they only say so. `dirty`: unsavedIn's answer. Unsaved changes come
    first, whatever else is in flight: always the danger question, with what is in flight said after it (review
    FRAME-1 - a send of another plan, or of an earlier save of this one, never hides unsaved work). */
export function closeQuestion(busy, dirty) {
  const said = busy && typeof busy === "object" ? String(busy.text || "") : busy ? String(busy) + STILL_KEPT : "";
  if (dirty === true) {
    return { title: "Close the takeoff app?", okText: "Close without saving", danger: true,
      text: "This plan has changes that are not saved. Save them in the takeoff app first (File › Save), or they may be lost." + (said ? " " + said : "") };
  }
  if (busy && typeof busy === "object") {
    return { title: String(busy.title || "The save is not finished"), okText: String(busy.okText || "Close anyway"), danger: busy.danger !== false,
      text: said };
  }
  if (busy) return { title: "The save is not finished", okText: "Close anyway", danger: false, text: said };
  return null;
}
/** A save being kept on this device when the frame closes goes on in the page (its Blob is the page's own copy): it is
    kept and sent - only the app no longer hears of it (review WORDS-1: "closing now stops it" was untrue). */
const STILL_KEPT = " Closing now does not stop it: it still finishes on this device and goes to OneDrive, but the takeoff app will not hear that it was kept.";

/** How long Close waits for the takeoff app to keep its draft (contract C2b). */
export const DRAFT_WAIT_MS = 3000;
/**
 * The takeoff app keeps its draft NOW (takeoff-web's window.TakeoffApp.saveDraftNow(), contract C2b), waited for at
 * most `ms`: the app's own pagehide write is an async IndexedDB put that does not outlive a frame removed at once
 * (review FRAME-1). -> true (kept, or nothing needed keeping), false (it failed, or took too long), null (an app
 * without it - an older copy - or no app in the frame). Never throws.
 */
export function keepDraft(win, ms) {
  let t = null, fn = null;
  try {
    t = win && win.TakeoffApp;
    fn = t && typeof t.saveDraftNow === "function" ? t.saveDraftNow : null;
  } catch (e) { fn = null; }
  if (!fn) return Promise.resolve(null);
  return new Promise(function (resolve) {
    const timer = setTimeout(function () { resolve(false); }, ms === undefined ? DRAFT_WAIT_MS : ms);
    let p;
    try { p = Promise.resolve(fn.call(t)); } catch (e) { p = Promise.reject(e); }
    p.then(function (v) { clearTimeout(timer); resolve(v === true); }, function () { clearTimeout(timer); resolve(false); });
  });
}

/** The box the frame takes: the visual viewport (above an on-screen keyboard, where a pinch left it), or null when the
    browser has none (the whole window then: the stylesheet's own). */
export function viewportBox(vv) {
  if (!vv || !(Number(vv.height) > 0) || !(Number(vv.width) > 0)) return null;
  return { top: Math.max(0, Math.round(Number(vv.offsetTop) || 0)), left: Math.max(0, Math.round(Number(vv.offsetLeft) || 0)),
    width: Math.round(Number(vv.width)), height: Math.round(Number(vv.height)) };
}

/** A save-back step says what is in flight (js/plan-library.js): fn() -> "", a sentence, or a question (closeQuestion).
    -> unregister. */
export function guard(fn) {
  guards.push(fn);
  return function () { const i = guards.indexOf(fn); if (i !== -1) guards.splice(i, 1); };
}
function busyText() {
  for (const g of guards) {
    try {
      const t = g();
      if (t && typeof t === "object") return t;
      if (t) return String(t);
    } catch (e) { /* a guard's own problem */ }
  }
  return "";
}

export function isOpen() { return !!active; }

function ensureShell() {
  if (shell && shell.isConnected) return shell;
  shell = document.createElement("div");
  shell.id = "ptfShell";
  shell.setAttribute("role", "dialog");
  shell.setAttribute("aria-modal", "true");
  shell.setAttribute("aria-labelledby", "ptfTitle");
  shell.innerHTML =
    '<div class="ptf-bar">' +
      '<span class="ptf-title" id="ptfTitle">📐 Takeoff</span>' +
      '<span class="ptf-say" id="ptfSay" role="status" aria-live="polite"></span>' +
      '<button type="button" class="ptf-close" id="ptfClose" aria-label="Close the takeoff app">✕ Close</button>' +
    "</div>" +
    '<div class="ptf-body"></div>';
  document.body.appendChild(shell);
  if (!el("ptfStyle")) {
    const style = document.createElement("style");
    style.id = "ptfStyle";
    style.textContent =
      "#ptfShell{position:fixed;left:0;top:0;width:100%;height:100%;z-index:100000;display:none;flex-direction:column;" +
        "background:#141414;overscroll-behavior:contain;}" +
      "#ptfShell.open{display:flex;}" +
      "#ptfShell .ptf-bar{flex:0 0 auto;display:flex;align-items:center;gap:10px;min-height:44px;box-sizing:border-box;" +
        "padding:calc(4px + env(safe-area-inset-top, 0px)) calc(10px + env(safe-area-inset-right, 0px)) 4px calc(10px + env(safe-area-inset-left, 0px));" +
        "background:#0d0d0d;color:#e6e6e6;border-bottom:1px solid #2a2a2a;font:600 14px system-ui,-apple-system,Segoe UI,Arial,sans-serif;}" +
      "#ptfShell .ptf-title{font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:0 1 auto;}" +
      "#ptfShell .ptf-say{flex:1 1 auto;min-width:0;font-weight:400;font-size:12.5px;color:#9aa5ad;overflow:hidden;" +
        "text-overflow:ellipsis;white-space:nowrap;}" +
      "#ptfShell .ptf-say.warn{color:#f0c060;white-space:normal;}" +
      "#ptfShell .ptf-close{flex:0 0 auto;min-height:40px;min-width:44px;padding:6px 14px;border-radius:9px;border:1px solid #3a3a3a;" +
        "background:#1f1f1f;color:#f0f0f0;font:700 14px system-ui,-apple-system,Segoe UI,Arial,sans-serif;cursor:pointer;}" +
      "#ptfShell .ptf-close:hover,#ptfShell .ptf-close:focus-visible{background:#2a2a2a;outline:2px solid #4c9be8;outline-offset:1px;}" +
      "#ptfShell .ptf-body{flex:1 1 auto;min-height:0;position:relative;box-sizing:border-box;" +
        "padding:0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);}" +
      "#ptfShell iframe{display:block;width:100%;height:100%;border:0;background:#141414;}";
    document.head.appendChild(style);
  }
  el("ptfClose").addEventListener("click", function () { requestClose(); });
  return shell;
}

/** The frame follows the visual viewport (the keyboard, a pinch): its bar stays in sight. */
function fit() {
  if (!active || !shell) return;
  const box = viewportBox(window.visualViewport);
  const s = shell.style;
  if (!box) { s.top = s.left = ""; s.width = s.height = ""; return; }
  s.top = box.top + "px"; s.left = box.left + "px"; s.width = box.width + "px"; s.height = box.height + "px";
}

function onKey(e) {
  // only keys on the portal's own bar reach this page (the frame's are the app's); a dialog over the frame (Close's own
  // question) keeps its keys
  if (!active || asking || !shell || !(e.target && shell.contains(e.target))) return;
  if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
  if (e.key === "Tab") {
    // the bar and the frame are all there is while it is open
    const close = el("ptfClose"), frame = active.frame;
    if (e.shiftKey && document.activeElement === close) { e.preventDefault(); frame.focus(); }
    else if (!e.shiftKey && document.activeElement !== close) { e.preventDefault(); close.focus(); }
  }
}

/**
 * Open the takeoff app's copy at `link` (map/plans.js frameLink) over the page. opts: {title, onClose()} - onClose runs
 * once the frame is gone (however it closed). -> the hand-over's peer (peerOf), or null (no page to show it on).
 * A frame already open is closed first - only when nothing would be lost (only a script can ask while one is open: the
 * page under it takes no taps); otherwise nothing opens (null, isOpen() true).
 */
export function open(link, opts) {
  if (typeof document === "undefined" || !document.body) return null;
  if (active && !closeIfIdle()) return null;
  const o = opts || {};
  const host = ensureShell();
  // a new frame each time (a new window: a conversation of an earlier opening can never hear this one's app)
  const frame = document.createElement("iframe");
  frame.id = "ptfFrame";
  frame.title = "Takeoff app";
  frame.setAttribute("allow", FRAME_ALLOW);
  // the rest of the page: still, out of reach of taps and of the focus (inert), until the frame closes - all but the
  // portal's own dialog host (common2 modalHost: made once, kept in the page): a dialog over the frame (Close's own
  // question) must take taps, also when an earlier dialog of the page made that host already (review FRAME-2)
  const inerted = [];
  Array.prototype.forEach.call(document.body.children, function (n) {
    if (n === host || n.inert || n.tagName === "SCRIPT" || n.id === "dcrModalHost") return;
    n.inert = true;
    inerted.push(n);
  });
  active = { frame, onClose: o.onClose, back: document.activeElement, inerted,
    overflow: [document.documentElement.style.overflow, document.body.style.overflow] };
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  el("ptfTitle").textContent = "📐 " + (o.title ? String(o.title).slice(0, 120) : "Takeoff");
  say("");
  host.querySelector(".ptf-body").appendChild(frame);
  // the copy's page once its own worker is active (takeoffWorker), or after WORKER_WAIT_MS whatever happens; the
  // frame's window (the hand-over's peer) is the same before and after
  let started = false;
  const go = function () {
    if (started || !active || active.frame !== frame) return;
    started = true;
    if (el("ptfSay").textContent === READYING) say("");
    frame.src = String(link);
  };
  takeoffWorker(navigator, location.href).then(go, go);
  setTimeout(go, WORKER_WAIT_MS + 500);
  setTimeout(function () { if (!started && active && active.frame === frame && !el("ptfSay").textContent) say(READYING); }, 600);
  host.classList.add("open");
  fit();
  if (!listening) {
    listening = true;
    document.addEventListener("keydown", onKey, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", fit);
      window.visualViewport.addEventListener("scroll", fit);
    }
    window.addEventListener("orientationchange", fit);
    // a page left while a save is in flight (P4): the browser asks first, where it can
    window.addEventListener("beforeunload", function (e) { if (active && busyText()) { e.preventDefault(); e.returnValue = ""; } });
  }
  frame.addEventListener("load", function focusApp() {
    frame.removeEventListener("load", focusApp);
    try { if (active && active.frame === frame) frame.focus(); } catch (e) { /* */ }
  });
  setTimeout(function () { try { if (active && active.frame === frame && document.activeElement !== frame) el("ptfClose").focus(); } catch (e) { /* */ } }, 30);
  return peerOf(frame, location);
}

/** A line on the frame's bar (the page under it cannot be read while it is open). */
export function say(text, kind) {
  const n = shell && el("ptfSay");
  if (!n) return;
  n.textContent = text || "";
  n.className = "ptf-say" + (kind ? " " + kind : "");
}

/** Close now, whatever is in it (the hand-over's own close asks closeIfIdle; a person's, requestClose). */
export function close() {
  if (!active) return;
  const a = active;
  active = null;
  const frame = a.frame;
  // the app's page goes with its frame (a person's Close had it keep its draft first: requestClose - its own pagehide
  // write does not outlive the frame's removal)
  try { frame.remove(); } catch (e) { /* */ }
  if (shell) {
    shell.classList.remove("open");
    shell.style.top = shell.style.left = shell.style.width = shell.style.height = "";
  }
  a.inerted.forEach(function (n) { n.inert = false; });
  document.documentElement.style.overflow = a.overflow[0];
  document.body.style.overflow = a.overflow[1];
  try { if (a.back && a.back.isConnected && a.back.focus) a.back.focus(); } catch (e) { /* */ }
  if (typeof a.onClose === "function") { try { a.onClose(); } catch (e) { /* the caller's own problem */ } }
}

/** Close unless that would lose something (unsaved changes, a save in flight): -> whether it closed. */
export function closeIfIdle() {
  if (!active) return true;
  if (closeQuestion(busyText(), unsavedIn(active.frame.contentWindow))) return false;
  close();
  return true;
}

/** The person's Close (the button, Escape on the bar): asked first when something would be lost; then the app keeps
    its draft (keepDraft, at most DRAFT_WAIT_MS) before the frame goes. */
export async function requestClose() {
  if (!active || asking) return;
  const a = active;
  const q = closeQuestion(busyText(), unsavedIn(a.frame.contentWindow));
  asking = true;                                             // (a second Close meanwhile is the same one)
  try {
    if (q) {
      const c = dcr2().confirm;
      // no dialog of the portal's (a page without common2): the browser's own
      const yes = typeof c === "function" ? await c(q.text, { title: q.title, okText: q.okText, danger: q.danger }) : window.confirm(q.title + "\n\n" + q.text);
      if (!yes || active !== a) return;
    }
    await keepDraft(a.frame.contentWindow);
  } finally {
    asking = false;
  }
  if (active !== a) return;
  close();
}

export default { open, close, closeIfIdle, requestClose, say, guard, isOpen, peerOf, closeQuestion, unsavedIn, viewportBox, keepDraft };
