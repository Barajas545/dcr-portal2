/* DCR Portal 2 — DEMO MODE ONLY: the browser's push service imitated (P3 phone reminders).

   tools/devserve.mjs adds this file to /__dev/fake-supabase.js. In the demo, "Phone reminders" can be
   turned on and off and "Send me a test notice" answered (engine.invoke, the push function's stand-in)
   without any request to Google, Mozilla or Apple: PushManager.subscribe / getSubscription keep ONE
   made-up subscription for this browser in localStorage ("dcr2-demo-push"), with the real API's rules
   (userVisibleOnly, a 65-byte P-256 applicationServerKey, InvalidStateError for a different key), and
   Notification.permission / requestPermission are the demo's own (a headless browser refuses a real
   prompt at once). window.DCR2DemoPush.block() / .reset() set "blocked" or forget everything.
   The published site never contains any of this. */
(function (root) {
  "use strict";
  const PM = root.PushManager;
  if (!PM || !root.Notification || !root.navigator || !root.navigator.serviceWorker) return;
  const LS_SUB = "dcr2-demo-push";
  const LS_PERM = "dcr2-demo-push-permission";

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* */ } };
  const b64u = (bytes) => btoa(String.fromCharCode.apply(null, Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function unb64u(s) {
    const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(atob(t + "=".repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
  }
  function random(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function bytesOf(k) {
    if (!k) return null;
    if (typeof k === "string") { try { return unb64u(k); } catch (e) { return null; } }
    if (k instanceof ArrayBuffer) return new Uint8Array(k);
    if (ArrayBuffer.isView(k)) return new Uint8Array(k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength));
    return null;
  }
  function load() { try { return JSON.parse(get(LS_SUB) || "null"); } catch (e) { return null; } }
  function permission() { const p = get(LS_PERM); return p === "granted" || p === "denied" ? p : "default"; }

  function subscription(rec) {
    const key = unb64u(rec.key);
    return {
      endpoint: rec.endpoint,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: key.buffer.slice(0) },
      getKey(name) { const v = name === "p256dh" ? rec.p256dh : name === "auth" ? rec.auth : null; return v ? unb64u(v).buffer : null; },
      toJSON() { return { endpoint: rec.endpoint, expirationTime: null, keys: { p256dh: rec.p256dh, auth: rec.auth } }; },
      async unsubscribe() {
        const cur = load();
        if (!cur || cur.endpoint !== rec.endpoint) return false;
        set(LS_SUB, null);
        return true;
      },
    };
  }

  PM.prototype.getSubscription = async function () {
    const rec = load();
    return rec ? subscription(rec) : null;
  };
  PM.prototype.subscribe = async function (opts) {
    const o = opts || {};
    if (permission() !== "granted") throw new DOMException("Registration failed - permission denied", "NotAllowedError");
    if (o.userVisibleOnly !== true) throw new DOMException("Push subscriptions must set userVisibleOnly to true", "NotAllowedError");
    const key = bytesOf(o.applicationServerKey);
    if (!key || key.length !== 65 || key[0] !== 4) throw new DOMException("The provided applicationServerKey is not valid.", "InvalidAccessError");
    const cur = load();
    if (cur) {
      if (cur.key === b64u(key)) return subscription(cur);
      throw new DOMException("A subscription with a different applicationServerKey (or gcm_sender_id) already exists; " +
        "to change the applicationServerKey, unsubscribe then resubscribe.", "InvalidStateError");
    }
    const pub = new Uint8Array(65);
    pub[0] = 4;
    pub.set(random(64), 1);
    const rec = { endpoint: "https://push.demo.invalid/sub/" + b64u(random(18)), key: b64u(key), p256dh: b64u(pub), auth: b64u(random(16)) };
    set(LS_SUB, JSON.stringify(rec));
    return subscription(rec);
  };
  PM.prototype.permissionState = async function () {
    const p = permission();
    return p === "default" ? "prompt" : p;
  };

  try {
    Object.defineProperty(root.Notification, "permission", { configurable: true, get: permission });
    root.Notification.requestPermission = async function (cb) {
      if (permission() === "default") set(LS_PERM, "granted");
      const p = permission();
      if (typeof cb === "function") cb(p);
      return p;
    };
  } catch (e) { /* this browser keeps its own Notification */ }

  root.DCR2DemoPush = {
    block() { set(LS_PERM, "denied"); },
    reset() { set(LS_PERM, null); set(LS_SUB, null); },
    subscription: () => load(),
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
