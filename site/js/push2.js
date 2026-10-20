/* Phone reminders for Portal 2 (P3: BLUEPRINT 2.2.6 "Push", 3.3.8; ported from the old push.js).

   A device that turns reminders on asks the Edge Function "push" for the VAPID public key
   (op "public_key"), subscribes with it in this browser, and keeps the subscription in
   push_subscriptions: its OWN row only (RLS: select, insert and delete own rows; at most 5 per person,
   the oldest falls off). Turning off deletes that row and the browser's subscription. Only the push
   function reads other people's subscriptions; no account ever lists them.

   Old subscriptions (the old portal's address and key) cannot move: every phone turns reminders on
   again here. On iPhone and iPad web push works only in the Home Screen app (iOS 16.4+), so Safari
   proper gets "Add to Home Screen first" with the steps.

   A browser can hold a subscription kept for ANOTHER account (a shared device that someone else used
   before): it then counts as off here, and turning on replaces it with a new one for this account.

   Signing out turns this device off for the person (forgetOnSignOut, called by common2.js logout).

   API: state(), enabled(), enable(), disable(), forgetOnSignOut(), sendTest(), serverKey(); mountSwitch(slot) draws the
   compact "Phone reminders: on/off" (home page, phone time sheet); mountSettings(box) the Settings
   panel with the switch, the iPhone steps and "Send me a test notice". */
import { sb } from "./sb.js";
import { errorText } from "./common2.js";

export const SUB_TABLE = "push_subscriptions";
export const FUNCTION = "push";
const KEY_CACHE = "dcr2-push-key";        // sessionStorage: the server's public key (public by design)

export const TEXT = Object.freeze({
  unsupported: "This browser cannot show phone notifications. On Android use Chrome; on iPhone use the Portal 2 app on your Home Screen.",
  oldIos: "This iPhone or iPad needs iOS 16.4 or newer for phone reminders (Settings > General > Software Update).",
  install: "On iPhone and iPad, reminders work only in the Portal 2 app on your Home Screen. Add it first:",
  installShort: "Add Portal 2 to your Home Screen first (Share, then \"Add to Home Screen\").",
  blocked: "Notifications are blocked for Portal 2 on this device. Allow them in the browser's site settings (on a phone: Settings > Notifications), then come back here.",
  notAllowed: "Notifications were not allowed. Turn reminders on again and choose Allow.",
  notConfigured: "Phone reminders are not switched on for DCR yet. The office turns them on; there is nothing to do here.",
  on: "On for this device. New tasks for you and DCR Agents reminders arrive here.",
  off: "Off for this device.",
  otherAccount: "Off for you on this device (it was set up for another account). Turn it on to get your own reminders here.",
  setup: "The app is still setting up. Try again in a moment.",
  offline: "Can't reach the server. Check the internet connection and try again.",
});
export const IOS_STEPS = Object.freeze([
  "Open portal.dcrframing.com in Safari.",
  "Tap Share (the square with the arrow pointing up).",
  "Choose \"Add to Home Screen\", then Add.",
  "Open Portal 2 from the new icon, sign in, and turn reminders on here.",
]);

/* ── the device ──────────────────────────────────────────────────────── */

function nav() { return globalThis.navigator || {}; }
function win() { return globalThis.window || globalThis; }

export function environment() {
  const n = nav(), w = win();
  const ua = String(n.userAgent || "");
  const ios = /iphone|ipad|ipod/i.test(ua) || (n.platform === "MacIntel" && Number(n.maxTouchPoints) > 1);
  let standalone = false;
  try { standalone = !!((w.matchMedia && w.matchMedia("(display-mode: standalone)").matches) || n.standalone === true); } catch (e) { standalone = false; }
  const supported = !!(w.isSecureContext && n.serviceWorker && "PushManager" in w && "Notification" in w);
  const N = w.Notification;
  return { ios, standalone, supported, permission: supported && N ? N.permission : "default" };
}

export function supported() { return environment().supported; }

/** True once this session knows the server has keys (the compact switch draws nothing before). */
export function available() {
  try { return !!sessionStorage.getItem(KEY_CACHE); } catch (e) { return false; }
}

export function keyBytes(b64) {
  const s = String(b64 || "");
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Whether a subscription was made with this key (after a key change at the office it must be renewed). */
export function sameKey(sub, key) {
  const k = sub && sub.options && sub.options.applicationServerKey;
  if (!k) return true;                       // the browser does not say: assume it is
  const a = new Uint8Array(k instanceof ArrayBuffer ? k : (k.buffer ? k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength) : k));
  const b = keyBytes(key);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Which phone this is, for the person's own list: nothing personal. */
export function deviceLabel() {
  const ua = String(nav().userAgent || "");
  const env = environment();
  // in this order: an Android phone also says "Linux", an iPad may say "Macintosh"
  let kind = ["iPhone", "iPad", "Android", "Windows", "Macintosh", "Linux"].find((k) => ua.indexOf(k) !== -1) || "phone";
  if (kind === "Macintosh" && env.ios) kind = "iPad";
  return kind + (env.standalone ? " (app)" : " (browser)");
}

function registration() {
  let timer = null;
  return Promise.race([
    nav().serviceWorker.ready,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(TEXT.setup)), 8000); }),
  ]).finally(() => clearTimeout(timer));
}

async function current() {
  if (!environment().supported) return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

async function safeUnsubscribe(sub) {
  try { if (sub) await sub.unsubscribe(); } catch (e) { /* the database side is what counts */ }
}

/** Off for this browser: the person's row for it (own rows only: someone else's stays theirs) and the
    browser's subscription. Offline, the row stays until the push service answers 410 for it. */
async function forget(sub) {
  if (!sub) return;
  try { await sb().from(SUB_TABLE).delete().eq("endpoint", sub.endpoint); } catch (e) { /* see above */ }
  await safeUnsubscribe(sub);
}

/* ── the function and the table ──────────────────────────────────────── */

function failure(message, code, status) {
  const e = new Error(message);
  e.code = code;
  e.status = status;
  return e;
}

/** POST {op...} to the Edge Function "push" with this person's sign-in. Errors are plain sentences. */
export async function callPush(body) {
  let res;
  try {
    res = await sb().functions.invoke(FUNCTION, { body });
  } catch (e) {
    throw failure(TEXT.offline, "offline", 0);
  }
  const { data, error } = res || {};
  if (!error) return data;
  const ctx = error.context;
  let status = 0, info = null;
  if (ctx && typeof ctx.status === "number") {
    status = ctx.status;
    try { info = await (ctx.clone ? ctx.clone() : ctx).json(); } catch (e) { info = null; }
  }
  // 503: no keys yet; 404: the function is not there yet (the gateway's "not found")
  if (status === 503 || (status === 404 && !(info && info.error === "not_found"))) throw failure(TEXT.notConfigured, "not_configured", status);
  if (status === 401) throw failure("Your sign-in has expired. Please sign in again.", "auth", 401);
  if (status === 403) throw failure((info && info.message) || "This account cannot do that.", "forbidden", 403);
  if (!status) throw failure(TEXT.offline, "offline", 0);
  throw failure((info && info.message) || "The server could not do that. Try again in a moment.", (info && info.error) || "error", status);
}

/** The VAPID public key from the server (kept for this browser session). */
export async function serverKey(opts) {
  if (!(opts && opts.fresh)) {
    try { const k = sessionStorage.getItem(KEY_CACHE); if (k) return k; } catch (e) { /* no storage */ }
  }
  const data = await callPush({ op: "public_key" });
  const key = data && typeof data.key === "string" ? data.key : "";
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(key)) throw failure("The server sent an unusable key. Try again later.", "bad_key", 200);
  try { sessionStorage.setItem(KEY_CACHE, key); } catch (e) { /* no storage */ }
  return key;
}

/** Whether this endpoint is kept for the signed-in person (RLS: own rows only). */
async function isMine(endpoint) {
  const { data, error } = await sb().from(SUB_TABLE).select("id").eq("endpoint", endpoint).limit(1);
  if (error) throw new Error(errorText(error));
  return !!(data && data.length);
}

/** Keeps the subscription as the person's own row (insert, or nothing when that endpoint is kept
    already); true when the row is theirs afterwards. */
async function keep(sub) {
  const j = sub.toJSON();
  const row = { endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth, device: deviceLabel() };
  const { error } = await sb().from(SUB_TABLE).upsert(row, { onConflict: "endpoint", ignoreDuplicates: true });
  if (error) throw new Error(errorText(error));
  return isMine(j.endpoint);
}

/* ── state, on, off, test ────────────────────────────────────────────── */

/** {status: "on" | "off" | "install" | "old_ios" | "unsupported" | "blocked" | "not_configured" | "unknown", other?, message?} */
export async function state() {
  const env = environment();
  if (env.ios && !env.standalone) return { status: "install" };
  if (!env.supported) return { status: env.ios ? "old_ios" : "unsupported" };
  let key;
  try { key = await serverKey(); } catch (e) {
    return e.code === "not_configured" ? { status: "not_configured" } : { status: "unknown", message: e.message };
  }
  if (env.permission === "denied") return { status: "blocked" };
  let sub;
  try { sub = await current(); } catch (e) { return { status: "unknown", message: e.message }; }
  if (!sub || !sameKey(sub, key) || env.permission !== "granted") return { status: "off" };
  try {
    return (await isMine(sub.endpoint)) ? { status: "on" } : { status: "off", other: true };
  } catch (e) {
    return { status: "unknown", message: e.message };
  }
}

export async function enabled() {
  try { return (await state()).status === "on"; } catch (e) { return false; }
}

export async function enable() {
  const env = environment();
  if (env.ios && !env.standalone) throw failure(TEXT.installShort, "install");
  if (!env.supported) throw failure(env.ios ? TEXT.oldIos : TEXT.unsupported, "unsupported");
  const key = await serverKey();
  const N = win().Notification;
  if (N.permission === "denied") throw failure(TEXT.blocked, "blocked");
  const perm = N.permission === "granted" ? "granted" : await N.requestPermission();
  if (perm !== "granted") throw failure(perm === "denied" ? TEXT.blocked : TEXT.notAllowed, "not_allowed");
  const reg = await registration();
  const subscribe = () => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await forget(sub); sub = null; }                 // made with an old key
  if (!sub) sub = await subscribe();
  try {
    if (await keep(sub)) return true;
    // the endpoint is kept for another account (a shared device): this account gets a new one
    await safeUnsubscribe(sub);
    sub = await subscribe();
    if (await keep(sub)) return true;
  } catch (e) {
    await safeUnsubscribe(sub);           // not kept: the device must not think it is on
    throw e;
  }
  await safeUnsubscribe(sub);
  throw failure("Reminders could not be turned on for this device. Try again.", "not_kept");
}

export async function disable() {
  let sub = null;
  try { sub = await current(); } catch (e) { sub = null; }
  await forget(sub);
  return false;
}

/** Signing out (common2.js logout): this browser stops getting the person's notices, so the next person on
    a shared phone never sees their task titles on the lock screen. Their row for this device goes (own rows
    only, while the sign-in still holds) and the browser's subscription is dropped. A subscription kept for
    ANOTHER account is left alone; when the server cannot be asked (no signal) the browser's subscription is
    dropped anyway (the push service then answers 410 and the function prunes the row). Best effort, and
    never longer than `ms`: signing out does not wait on it. -> true when this device was turned off. */
export async function forgetOnSignOut(ms) {
  if (!environment().supported) return false;
  let timer = null;
  const work = (async () => {
    const sw = nav().serviceWorker;
    const reg = typeof sw.getRegistration === "function" ? await sw.getRegistration() : await registration();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    if (!sub) return false;
    let mine = true;
    try { mine = await isMine(sub.endpoint); } catch (e) { mine = true; }        // can't tell: privacy first
    if (!mine) return false;
    await forget(sub);
    return true;
  })();
  try {
    return await Promise.race([work, new Promise((res) => { timer = setTimeout(() => res(false), ms || 3000); })]);
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** What the test notice did, in words. o.install: this is an iPhone / iPad browser tab, where there is no
    switch to point at - the Home Screen app is where reminders are turned on. */
export function testMessage(r, o) {
  const n = (k) => Number((r && r[k]) || 0);
  const install = !!(o && o.install);
  if (!r || r.none) {
    return install ? "None of your devices has reminders on yet. Add Portal 2 to your Home Screen first (the steps above), then turn reminders on in the app."
      : "None of your devices has reminders on yet. Turn them on above first.";
  }
  if (n("sent") > 0) {
    return "Sent to " + n("sent") + (n("sent") === 1 ? " device" : " devices") + ". It should arrive within a few seconds." +
      (n("failed") + n("gone") > 0 ? " (" + (n("failed") + n("gone")) + " other did not take it.)" : "");
  }
  if (n("gone") > 0 && !n("failed")) {
    return "Your device no longer accepts reminders (removed). " + (install ? "Turn them on again in the Home Screen app." : "Turn them on again above.");
  }
  return "The phone's push service did not take it. Try again in a minute.";
}

/** {sent, gone, failed, none, message}: a fixed test notice to this person's own devices. o: {install}. */
export async function sendTest(o) {
  const r = await callPush({ op: "test" });
  return Object.assign({}, r, { message: testMessage(r, o) });
}

/* ── the compact switch (home page, phone time sheet) ────────────────── */

/** "Phone reminders: on/off" into slot (an element or an id). Draws nothing until the server has keys
    (or on a browser that cannot do it at all). */
export function mountSwitch(slotIn) {
  const slot = typeof slotIn === "string" ? document.getElementById(slotIn) : slotIn;
  if (!slot) return;
  const env = environment();
  if (!env.supported && !(env.ios && !env.standalone)) return;
  state().then((st) => {
    if (!["on", "off", "blocked", "install"].includes(st.status)) return;
    slot.innerHTML = "";
    const wrap = document.createElement("span");
    wrap.className = "dcr2-push";
    wrap.style.cssText = "display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--text-muted)";
    const text = document.createElement("span");
    text.textContent = "Phone reminders: ";
    const b = document.createElement("b");
    text.appendChild(b);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    const note = document.createElement("span");
    note.style.cssText = "flex-basis:100%;font-size:12px";
    wrap.append(text, btn, note);
    slot.appendChild(wrap);
    const draw = (on) => {
      b.textContent = on ? "on" : "off";
      btn.textContent = on ? "Turn off" : "Turn on";
      btn.hidden = false;
      btn.disabled = false;
    };
    if (st.status === "install") { b.textContent = "off"; btn.hidden = true; note.textContent = TEXT.installShort; return; }
    if (st.status === "blocked") { b.textContent = "blocked"; btn.hidden = true; note.textContent = TEXT.blocked; return; }
    draw(st.status === "on");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      note.textContent = "";
      try {
        const on = (await state()).status === "on";
        const now = on ? await disable() : await enable();
        draw(now);
        note.textContent = now ? "This device will get reminders." : "";
      } catch (e) {
        draw((await state()).status === "on");
        note.textContent = (e && e.message) || "Could not change phone reminders.";
      }
    });
  });
}

/* ── the Settings panel ──────────────────────────────────────────────── */

function el(tag, attrs, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v; else if (k === "hidden") n.hidden = !!v; else n.setAttribute(k, v);
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

/** The "Phone reminders" panel: the switch for this device, what it means, the iPhone steps when
    needed, and "Send me a test notice". */
export function mountSettings(boxIn) {
  const box = typeof boxIn === "string" ? document.getElementById(boxIn) : boxIn;
  if (!box) return null;
  box.innerHTML = "";
  const row = el("div", { class: "pr-row" });
  const label = el("div", { class: "pr-label" });
  const title = el("div", { class: "pr-title", id: "prTitle" }, "Phone reminders on this device");
  const status = el("div", { class: "pr-status", id: "prStatus", role: "status" }, "Checking…");
  label.append(title, status);
  const sw = el("button", { class: "pr-switch", type: "button", role: "switch", "aria-checked": "false",
    "aria-labelledby": "prTitle", "aria-describedby": "prStatus", disabled: "" });
  sw.appendChild(el("span", { class: "pr-knob", "aria-hidden": "true" }));
  row.append(label, sw);
  const guide = el("div", { class: "pr-guide", hidden: true });
  guide.appendChild(el("p", {}, TEXT.install));
  const ol = el("ol");
  for (const s of IOS_STEPS) ol.appendChild(el("li", {}, s));
  guide.appendChild(ol);
  guide.appendChild(el("p", { class: "pr-small" }, "Needs iOS 16.4 or newer."));
  const acts = el("div", { class: "st-acts pr-acts" });
  const test = el("button", { class: "btn btn-ghost btn-sm", type: "button", id: "prTest" }, "Send me a test notice");
  const msg = el("span", { class: "st-msg", id: "prMsg", role: "status" });
  acts.append(test, msg);
  box.append(row, guide, acts);

  const say = (text, cls) => { msg.textContent = text || ""; msg.className = "st-msg" + (cls ? " " + cls : ""); };
  let busy = false;
  function paint(st) {
    const on = st.status === "on";
    sw.setAttribute("aria-checked", on ? "true" : "false");
    sw.disabled = busy || !["on", "off"].includes(st.status);
    sw.hidden = ["install", "unsupported", "old_ios", "not_configured"].includes(st.status);
    guide.hidden = st.status !== "install";
    acts.hidden = ["not_configured", "unsupported", "old_ios"].includes(st.status);
    test.disabled = busy;
    box.dataset.state = st.status;
    status.className = "pr-status" + (on ? " on" : st.status === "blocked" ? " warn" : "");
    status.textContent = on ? TEXT.on
      : st.status === "off" ? (st.other ? TEXT.otherAccount : TEXT.off)
      : st.status === "install" ? "Off. iPhone and iPad need the Home Screen app."
      : st.status === "old_ios" ? TEXT.oldIos
      : st.status === "unsupported" ? TEXT.unsupported
      : st.status === "blocked" ? TEXT.blocked
      : st.status === "not_configured" ? TEXT.notConfigured
      : (st.message || TEXT.offline);
  }
  async function refresh() { const st = await state(); paint(st); return st; }

  sw.addEventListener("click", async () => {
    if (busy) return;
    const wasOn = sw.getAttribute("aria-checked") === "true";
    busy = true;
    sw.disabled = true;
    say(wasOn ? "Turning off…" : "Turning on…", "");
    try {
      if (wasOn) await disable(); else await enable();
      const st = await refresh();
      say(st.status === "on" ? "Reminders are on. Try \"Send me a test notice\"." : wasOn ? "Reminders are off for this device." : "", "ok");
    } catch (e) {
      say((e && e.message) || "Could not change phone reminders.", "err");
    } finally {
      busy = false;
      await refresh().catch(() => {});
    }
  });
  test.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    test.disabled = true;
    say("Sending…", "");
    try {
      const r = await sendTest({ install: box.dataset.state === "install" });   // no switch here: the app's words
      say(r.message, r.sent > 0 ? "ok" : "err");
    } catch (e) {
      say((e && e.message) || "Could not send the test notice.", "err");
    } finally {
      busy = false;
      test.disabled = false;
    }
  });
  const ready = refresh().catch((e) => paint({ status: "unknown", message: e && e.message }));
  return { refresh, ready };
}
