/* Phone reminders for Portal 2 (P3, BLUEPRINT 2.2.6 "Push"). Present from P1 so the service worker
   and the pages have their place; it stays silent until config.js carries the NEW VAPID public key
   (the old portal's subscriptions belong to the old address and key and cannot move: every phone
   turns reminders on again, and on iPhone only from the Home Screen app).

   The subscription goes into push_subscriptions (own rows only, at most 5 — migration M3). Only the
   Edge Function "push" reads other people's subscriptions; no account ever lists them.

   mountSwitch(slot) draws "Phone reminders: on/off"; enable() / disable() / enabled() for others. */
import { sb, me } from "./sb.js";
import { errorText } from "./common2.js";

const cfg = () => globalThis.DCR2_CONFIG || {};
const standalone = () => typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function supported() {
  return typeof window !== "undefined" && !!(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
}

/** False until the VAPID public key is configured (P3). */
export function available() {
  return !!cfg().VAPID_PUBLIC_KEY;
}

function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function registration() {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, rej) => setTimeout(() => rej(new Error("The app is still setting up. Try again in a moment.")), 8000)),
  ]);
}

function deviceLabel() {
  const m = /iPhone|iPad|Android|Windows|Macintosh|Linux/.exec(navigator.userAgent || "");
  return ((m && m[0]) || "phone") + (standalone() ? " (app)" : " (browser)");
}

async function current() {
  if (!supported()) return null;
  const reg = await registration();
  return reg.pushManager.getSubscription();
}

export async function enabled() {
  try { return !!(await current()); } catch (e) { return false; }
}

export async function enable() {
  if (!available()) throw new Error("Phone reminders come with a later update of Portal 2.");
  if (!supported()) throw new Error("This browser cannot show phone notifications.");
  if (isIOS() && !standalone()) throw new Error("Add Portal 2 to your Home Screen first (Install), then turn reminders on from there.");
  if (Notification.permission === "denied") throw new Error("Notifications are blocked for Portal 2 in this phone's settings.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were not allowed.");
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(cfg().VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  const p = await me();
  const { error } = await sb().from("push_subscriptions").insert({
    profile_id: p && p.id, endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth, device: deviceLabel(),
  });
  if (error && String(error.code) !== "23505") {           // already kept: fine
    try { await sub.unsubscribe(); } catch (e) { /* the phone must not think it is on */ }
    throw new Error(errorText(error));
  }
  return true;
}

export async function disable() {
  let sub = null;
  try { sub = await current(); } catch (e) { sub = null; }
  if (!sub) return false;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch (e) { /* the database side still comes off */ }
  try { await sb().from("push_subscriptions").delete().eq("endpoint", endpoint); } catch (e) { /* pruned on the next send */ }
  return false;
}

/** "Phone reminders: on/off" into slot (an element or an id). Draws nothing before P3. */
export function mountSwitch(slotIn) {
  const slot = typeof slotIn === "string" ? document.getElementById(slotIn) : slotIn;
  if (!slot || !available()) return;
  if (!supported() && !(isIOS() && !standalone())) return;
  slot.innerHTML = "";
  const wrap = document.createElement("span");
  wrap.className = "dcr2-push";
  wrap.style.cssText = "display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;font-size:13px;color:var(--text-muted)";
  const text = document.createElement("span");
  text.textContent = "Phone reminders: ";
  const state = document.createElement("b");
  state.textContent = "…";
  text.appendChild(state);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-ghost btn-sm";
  btn.style.display = "none";
  const note = document.createElement("span");
  note.style.cssText = "flex-basis:100%;font-size:12px";
  wrap.append(text, btn, note);
  slot.appendChild(wrap);
  const draw = (on) => {
    state.textContent = on ? "on" : "off";
    btn.textContent = on ? "Turn off" : "Turn on";
    btn.style.display = "inline-flex";
    btn.disabled = false;
  };
  if (isIOS() && !standalone()) {
    state.textContent = "off";
    note.textContent = "Add Portal 2 to your Home Screen first (Install).";
    return;
  }
  enabled().then(draw);
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    note.textContent = "";
    try {
      const now = (await enabled()) ? await disable() : await enable();
      draw(now);
      note.textContent = now ? "This phone will get reminders." : "";
    } catch (e) {
      draw(await enabled());
      note.textContent = (e && e.message) || "Could not change phone reminders.";
    }
  });
}
