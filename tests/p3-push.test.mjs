// Phone reminders (P3, BLUEPRINT 2.2.6 / 3.3.8) without a browser or a push service:
//  - the service worker's push and notificationclick (site/sw.js in a node vm): what is shown, and that a
//    tap only ever opens a page of this site;
//  - the demo database's push_subscriptions (own rows only, newest 5, no update) and its stand-in of the
//    Edge Function "push" (public_key, send for agents/admin only, test, drain over the outbox);
//  - site/js/push2.js over the demo client and the demo push service (tools/fake/push-demo.js): on, off,
//    an old key, a shared device, blocked, iPhone not on the Home Screen, the test notice, the errors.
// Made-up people only (the demo seed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SW_SRC = readFileSync(new URL("../site/sw.js", import.meta.url), "utf8");
const SITE = "https://portal.dcrframing.com";

/* ── a browser of sorts (installed before the modules load) ──────────── */
function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
    key: (i) => Array.from(m.keys())[i] ?? null, get length() { return m.size; }, clear: () => m.clear(),
  };
}
globalThis.localStorage = memStore();
globalThis.sessionStorage = memStore();
globalThis.DCR2_CONFIG = { SUPABASE_URL: "https://demo-ref.supabase.co", SUPABASE_KEY: "sb_publishable_demo", SITE_URL: SITE };
await import("../tools/fake/engine.js");
await import("../tools/fake/seed.js");
await import("../tools/fake/fake-supabase.js");
const demo = globalThis.DCR2Demo;
demo.setLatency(0);
const engine = demo.engine;
const PEOPLE = Object.fromEntries(globalThis.DCR2Fake.PEOPLE.map((p) => [p.key, p]));

class PushManager {}
const reg = { pushManager: new PushManager() };
const UA = {
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
};
const device = { userAgent: UA.android, platform: "Linux armv8l", maxTouchPoints: 5, standalone: undefined, serviceWorker: { ready: Promise.resolve(reg) } };
Object.defineProperty(globalThis, "navigator", { configurable: true, value: device });
globalThis.isSecureContext = true;
globalThis.PushManager = PushManager;
globalThis.Notification = function Notification() {};
globalThis.Notification.permission = "default";
globalThis.Notification.requestPermission = async () => "default";
let standalone = false;
globalThis.matchMedia = (q) => ({ matches: /standalone/.test(q) && standalone });
await import("../tools/fake/push-demo.js");
const push2 = await import("../site/js/push2.js");
const { sb } = await import("../site/js/sb.js");

async function signInAs(key) {
  await sb().auth.signOut({ scope: "local" }).catch(() => {});
  const r = await sb().auth.signInWithPassword({ email: PEOPLE[key].email, password: "demo-password-1" });
  assert.equal(r.error, null, key);
}
function freshDevice() {
  globalThis.DCR2DemoPush.reset();
  sessionStorage.clear();
  device.userAgent = UA.android;
  device.platform = "Linux armv8l";
  standalone = false;
  globalThis.PushManager = PushManager;
}
const rowsOf = (key) => engine.rows.push_subscriptions.filter((s) => s.profile_id === PEOPLE[key].id);
/** wraps functions.invoke: counts the calls, or answers with `fake` instead */
function spyInvoke(fake) {
  const c = sb();
  const real = c.functions.invoke;
  const calls = [];
  c.functions.invoke = async (name, opts) => { calls.push([name, opts && opts.body]); return fake ? fake(name, opts) : real(name, opts); };
  return { calls, restore: () => { c.functions.invoke = real; } };
}
const httpError = (status, body) => ({ data: null, error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code",
  context: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }) } });

/* ── the service worker ───────────────────────────────────────────────── */

function worker(windows = []) {
  const handlers = {};
  const shown = [], opened = [];
  const self = {
    location: new URL(SITE + "/sw.js"),
    registration: { scope: SITE + "/", showNotification: async (title, o) => { shown.push(Object.assign({ title }, o)); } },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async (u) => { opened.push(u); return { url: u }; } },
    skipWaiting() {},
    addEventListener(type, fn) { handlers[type] = fn; },
  };
  vm.runInContext(SW_SRC, vm.createContext({ self, URL, Promise, console, caches: {}, fetch: async () => { throw new TypeError("offline"); } }));
  async function fire(type, event) {
    let done = Promise.resolve();
    handlers[type](Object.assign({ waitUntil(p) { done = p; } }, event));
    return done;
  }
  const push = (payload) => fire("push", { data: payload === undefined ? null : {
    json() { if (typeof payload === "string") return JSON.parse(payload); return payload; },
    text() { return typeof payload === "string" ? payload : JSON.stringify(payload); } } });
  const click = (url) => {
    const n = { closed: false, data: url === undefined ? undefined : { url }, close() { this.closed = true; } };
    return fire("notificationclick", { notification: n }).then(() => n);
  };
  return { shown, opened, push, click };
}
function win(url) {
  return { url, focused: 0, navigated: null, focus() { this.focused++; return Promise.resolve(this); },
    navigate(u) { this.navigated = u; this.url = u; return Promise.resolve(this); } };
}

test("sw: a push shows the title, body, tag and the task link (renotify, the site's icon)", async () => {
  const w = worker();
  await w.push({ title: "New task", body: "Frame the stair at unit 2", url: SITE + "/my-tasks.html?task=41", tag: "task-41" });
  assert.equal(w.shown.length, 1);
  const n = w.shown[0];
  assert.equal(n.title, "New task");
  assert.equal(n.body, "Frame the stair at unit 2");
  assert.equal(n.tag, "task-41");
  assert.equal(n.renotify, true);
  assert.equal(n.icon, SITE + "/icons/icon-192.png");
  assert.equal(n.data.url, SITE + "/my-tasks.html?task=41");
});

test("sw: a link to another site (or a script) in a payload becomes the home page; junk still shows something", async () => {
  const w = worker();
  for (const url of ["https://evil.example/x", "javascript:alert(1)", "//evil.example/y", "http://portal.dcrframing.com/x",
    "https://portal.dcrframing.com.evil.example/", 42, null]) {
    await w.push({ title: "t", url });
  }
  for (const n of w.shown) assert.equal(n.data.url, SITE + "/dashboard.html");
  const j = worker();
  await j.push("not json at all");
  await j.push(undefined);
  await j.push({ title: { x: 1 }, body: ["a"], tag: 5 });
  await j.push({ title: "T".repeat(500), body: "B".repeat(2000), tag: "g".repeat(200) });
  assert.equal(j.shown[0].body, "not json at all");
  assert.equal(j.shown[1].title, "DCR Framing");
  assert.equal(j.shown[2].title, "DCR Framing");
  assert.equal(j.shown[2].tag, "dcr-portal2");
  assert.equal(j.shown[3].title.length, 80);
  assert.equal(j.shown[3].body.length, 400);
  assert.equal(j.shown[3].tag.length, 60);
  // a relative link is read against the site
  const r = worker();
  await r.push({ url: "my-tasks.html?task=7" });
  assert.equal(r.shown[0].data.url, SITE + "/my-tasks.html?task=7");
});

test("sw: a tap focuses the window already on that page, else takes a Portal 2 window there, else opens one", async () => {
  const target = SITE + "/my-tasks.html?task=41";
  const exact = win(target), other = win(SITE + "/board.html"), foreign = win("https://other.example/");
  const a = worker([foreign, other, exact]);
  const n = await a.click(target);
  assert.ok(n.closed);
  assert.equal(exact.focused, 1);
  assert.equal(other.navigated, null, "the window on the page is used, nothing navigated");
  const b = worker([foreign, other]);
  await b.click(target);
  assert.equal(other.navigated, target);
  assert.equal(other.focused, 1);
  assert.equal(foreign.navigated, null, "a window of another site is never steered");
  const c = worker([foreign]);
  await c.click(target);
  assert.deepEqual(c.opened, [target]);
  const d = worker([]);
  await d.click("https://evil.example/phish");
  await d.click(undefined);
  assert.deepEqual(d.opened, [SITE + "/dashboard.html", SITE + "/dashboard.html"]);
});

test("sw: the cache name moved on with P3 and the task pages are kept for offline", () => {
  const name = /const CACHE = "([^"]+)"/.exec(SW_SRC)[1];
  assert.match(name, /^dcr-portal2-v\d+$/);
  assert.notEqual(name, "dcr-portal2-v1", "a new name, so every installed copy takes the push handlers");
  assert.match(SW_SRC, /"my-tasks\.html", "tasks-map\.html"/);
});

/* ── the demo database: push_subscriptions and the push function ─────── */

function fakeClient() {
  const st = memStore();
  return globalThis.supabase.createClient("https://demo-ref.supabase.co", "sb_publishable_demo", { auth: { storage: st, storageKey: "dcr2-auth" } });
}
async function as(key) {
  const c = fakeClient();
  await c.auth.signInWithPassword({ email: PEOPLE[key].email, password: "x" });
  return c;
}
let epNo = 0;
const sub = (extra) => Object.assign({ endpoint: "https://push.demo.invalid/sub/t" + (++epNo), p256dh: "B" + "x".repeat(86), auth: "a".repeat(22), device: "Android (app)" }, extra);

test("demo push_subscriptions: own rows only (an admin too), the caller's id by default, person and endpoint fixed, a shared device taken over", async () => {
  const field = await as("field"), lead = await as("lead"), admin = await as("admin");
  const one = sub();
  const ins = await field.from("push_subscriptions").insert(one).select().single();
  assert.equal(ins.error, null);
  assert.equal(ins.data.profile_id, PEOPLE.field.id);
  assert.ok(ins.data.created_at);
  assert.equal((await field.from("push_subscriptions").select("*").eq("endpoint", one.endpoint)).data.length, 1);
  for (const c of [lead, admin]) {
    assert.deepEqual((await c.from("push_subscriptions").select("*").eq("endpoint", one.endpoint)).data, [], "nobody else reads it");
    const del = await c.from("push_subscriptions").delete().eq("endpoint", one.endpoint).select();
    assert.deepEqual(del.data, []);
  }
  const forged = await lead.from("push_subscriptions").insert(sub({ profile_id: PEOPLE.field.id }));
  assert.equal(forged.error.code, "42501");
  const upd = await field.from("push_subscriptions").update({ device: "Android (app)" }).eq("endpoint", one.endpoint).select();
  assert.equal(upd.data.length, 1, "the person refreshes their own row");
  assert.deepEqual((await lead.from("push_subscriptions").update({ device: "x" }).eq("endpoint", one.endpoint).select()).data, []);
  assert.equal((await field.from("push_subscriptions").update({ endpoint: "https://push.demo.invalid/other" }).eq("endpoint", one.endpoint)).error.code, "42501");
  const owner = () => engine.rows.push_subscriptions.filter((s) => s.endpoint === one.endpoint).map((s) => s.profile_id);
  // a shared device: whoever subscribes on it now takes the endpoint over (M3's t10 trigger)
  assert.equal((await lead.from("push_subscriptions").insert({ ...one })).error, null);
  assert.deepEqual(owner(), [PEOPLE.lead.id]);
  const back = await field.from("push_subscriptions").upsert(sub({ endpoint: one.endpoint }), { onConflict: "endpoint", ignoreDuplicates: true });
  assert.equal(back.error, null);
  assert.deepEqual(owner(), [PEOPLE.field.id]);
  const again = await field.from("push_subscriptions").upsert(sub({ endpoint: one.endpoint }), { onConflict: "endpoint", ignoreDuplicates: true });
  assert.equal(again.error, null, "the own row again: on conflict do nothing");
  assert.equal((await field.from("push_subscriptions").insert(sub({ endpoint: one.endpoint }))).error.code, "23505");
  assert.deepEqual(owner(), [PEOPLE.field.id]);
  const agents = await as("agents");
  assert.equal((await agents.from("push_subscriptions").insert(sub())).error.code, "42501", "the agents account keeps no phone");
  for (const bad of [{ endpoint: "http://push.demo.invalid/x" }, { endpoint: "https://x/" + "y".repeat(2000) }, { p256dh: "" }, { auth: "a".repeat(101) }]) {
    const r = await field.from("push_subscriptions").insert(sub(bad));
    assert.equal(r.error.code, "23514", JSON.stringify(bad).slice(0, 60));
  }
  assert.equal((await field.from("push_subscriptions").delete().eq("endpoint", one.endpoint).select()).data.length, 1);
});

test("demo push_subscriptions: the newest 5 per person are kept", async () => {
  const c = await as("newhire");
  const made = [];
  for (let i = 0; i < 7; i++) {
    const s = sub();
    made.push(s.endpoint);
    assert.equal((await c.from("push_subscriptions").insert(s)).error, null);
  }
  const kept = (await c.from("push_subscriptions").select("endpoint")).data.map((r) => r.endpoint).sort();
  assert.deepEqual(kept, made.slice(2).sort());
});

test("demo push function: public_key for any active account; send only for agents and admin; test and drain", async () => {
  const field = await as("field"), agents = await as("agents"), admin = await as("admin"), manager = await as("manager");
  const k = await field.functions.invoke("push", { body: { op: "public_key" } });
  assert.equal(k.error, null);
  assert.match(k.data.key, /^B[A-Za-z0-9_-]{86}$/);
  assert.equal((await agents.functions.invoke("push", { body: { op: "key" } })).data.key, k.data.key);
  await field.from("push_subscriptions").insert(sub());
  for (const c of [field, manager]) {
    const r = await c.functions.invoke("push", { body: { op: "send", profile_ids: [PEOPLE.field.id], title: "x" } });
    assert.equal(r.error.context.status, 403);
    assert.equal((await r.error.context.json()).error, "forbidden");
  }
  const sent = await agents.functions.invoke("push", { body: { op: "send", profile_ids: [PEOPLE.field.id, PEOPLE.viewer.id], title: "Timesheet", url: SITE + "/timesheet-mobile.html" } });
  assert.deepEqual(sent.data, { sent: rowsOf("field").length, gone: 0, failed: 0, none: false });
  const byEmp = engine.rows.employees.find((e) => e.profile_id === PEOPLE.field.id);
  assert.equal((await admin.functions.invoke("push", { body: { op: "send", employee_id: byEmp.id, body: "Hi" } })).data.sent, rowsOf("field").length);
  const nobody = engine.rows.employees.find((e) => !e.profile_id);
  assert.equal((await admin.functions.invoke("push", { body: { op: "send", employee_id: nobody.id, body: "Hi" } })).error.context.status, 404);
  for (const bad of [{ title: "x".repeat(81) }, { url: "https://evil.example/" }, { title: "", body: "" }, { profile_ids: [], title: "t" }, { color: "red", title: "t" }]) {
    const r = await agents.functions.invoke("push", { body: Object.assign({ op: "send", profile_ids: [PEOPLE.field.id] }, bad) });
    assert.equal(r.error.context.status, 400, JSON.stringify(bad));
  }
  assert.deepEqual((await manager.functions.invoke("push", { body: { op: "test" } })).data, { sent: 0, gone: 0, failed: 0, none: true });
  assert.equal((await field.functions.invoke("push", { body: { op: "test" } })).data.sent, rowsOf("field").length);
  assert.equal((await field.functions.invoke("push", { body: { op: "nope" } })).error.context.status, 400);
  assert.equal((await fakeClient().functions.invoke("push", { body: { op: "public_key" } })).error.context.status, 401);
  assert.equal((await field.functions.invoke("agents", { body: {} })).error.context.status, 404);
});

test("demo push function: drain claims the unsent new-task notices once (a new assignment from the outbox)", async () => {
  const manager = await as("manager"), field = await as("field");
  await field.from("push_subscriptions").insert(sub());
  const before = engine.rows.notifications_outbox.length;
  const pid = engine.rows.projects.find((p) => !p.deleted_at).id;
  const t = await manager.from("tasks").insert({ title: "Check the hold-downs", assigned_to: PEOPLE.field.id, project_id: pid }).select().single();
  assert.equal(t.error, null);
  assert.equal(engine.rows.notifications_outbox.length, before + 1, "the tasks trigger wrote one outbox row");
  const d = await field.functions.invoke("push", { body: { op: "drain" } });
  assert.equal(d.error, null);
  assert.ok(d.data.notices >= 1);
  assert.ok(d.data.sent >= rowsOf("field").length);
  assert.ok(!/endpoint|http/.test(JSON.stringify(d.data)), "counts only");
  const row = engine.rows.notifications_outbox.find((o) => o.task_id === t.data.id);
  assert.ok(row.push_sent_at, "claimed");
  assert.deepEqual((await field.functions.invoke("push", { body: { op: "drain" } })).data, { notices: 0, sent: 0, gone: 0, failed: 0, none: 0 });
});

/* ── push2.js ─────────────────────────────────────────────────────────── */

test("push2: Android, not set up yet -> on: the key from the function, the person's own row, the device named", async () => {
  freshDevice();
  await signInAs("field");
  for (const s of rowsOf("field")) engine.rows.push_subscriptions.splice(engine.rows.push_subscriptions.indexOf(s), 1);
  const spy = spyInvoke();
  try {
    assert.deepEqual(await push2.state(), { status: "off" });
    assert.deepEqual(spy.calls, [["push", { op: "public_key" }]], "the key comes from op public_key");
    assert.equal(await push2.enable(), true);
    assert.deepEqual(await push2.state(), { status: "on" });
    assert.equal(await push2.enabled(), true);
    assert.equal(spy.calls.length, 1, "the key is kept for the session");
  } finally { spy.restore(); }
  const rows = rowsOf("field");
  assert.equal(rows.length, 1);
  const kept = globalThis.DCR2DemoPush.subscription();
  assert.equal(rows[0].endpoint, kept.endpoint);
  assert.equal(rows[0].p256dh, kept.p256dh);
  assert.equal(rows[0].auth, kept.auth);
  assert.equal(rows[0].device, "Android (browser)");
  assert.equal(await push2.enable(), true, "again: nothing doubles");
  assert.equal(rowsOf("field").length, 1);
});

test("push2: off deletes the row and the browser's subscription", async () => {
  freshDevice();
  await signInAs("lead");
  await push2.enable();
  assert.equal(rowsOf("lead").length >= 1, true);
  const ep = globalThis.DCR2DemoPush.subscription().endpoint;
  assert.equal(await push2.disable(), false);
  assert.equal(globalThis.DCR2DemoPush.subscription(), null);
  assert.ok(!engine.rows.push_subscriptions.some((s) => s.endpoint === ep));
  assert.deepEqual(await push2.state(), { status: "off" });
  assert.equal(await push2.disable(), false, "off again is harmless");
});

test("push2: a subscription made with an old key is replaced (its row too)", async () => {
  freshDevice();
  await signInAs("field");
  await push2.enable();
  const old = globalThis.DCR2DemoPush.subscription();
  const pub = new Uint8Array(65); pub[0] = 4; pub.fill(7, 1);
  localStorage.setItem("dcr2-demo-push", JSON.stringify(Object.assign({}, old, { key: Buffer.from(pub).toString("base64url") })));
  assert.deepEqual(await push2.state(), { status: "off" });
  await push2.enable();
  const now = globalThis.DCR2DemoPush.subscription();
  assert.notEqual(now.endpoint, old.endpoint);
  assert.ok(!engine.rows.push_subscriptions.some((s) => s.endpoint === old.endpoint), "the old row is gone");
  assert.deepEqual(await push2.state(), { status: "on" });
});

test("push2: a shared device: the browser's subscription is another account's -> off for me; on gives me my own", async () => {
  freshDevice();
  await signInAs("field");
  await push2.enable();
  const fieldEp = globalThis.DCR2DemoPush.subscription().endpoint;
  await signInAs("viewer");
  assert.deepEqual(await push2.state(), { status: "off", other: true });
  await push2.enable();
  const mine = globalThis.DCR2DemoPush.subscription().endpoint;
  assert.ok(rowsOf("viewer").some((s) => s.endpoint === mine), "the device is the viewer's now");
  assert.ok(!rowsOf("field").some((s) => s.endpoint === mine), "and no longer the field user's (M3 takes the endpoint over)");
  assert.equal(mine, fieldEp, "taken over, not a second subscription");
  assert.deepEqual(await push2.state(), { status: "on" });
});

test("push2: blocked notifications, an iPhone outside the Home Screen app, an old iPhone, a browser without push", async () => {
  freshDevice();
  await signInAs("field");
  globalThis.DCR2DemoPush.block();
  assert.deepEqual(await push2.state(), { status: "blocked" });
  await assert.rejects(push2.enable(), (e) => e.code === "blocked" && /blocked/.test(e.message));
  freshDevice();
  device.userAgent = UA.iphone;
  device.platform = "iPhone";
  assert.deepEqual(await push2.state(), { status: "install" });
  await assert.rejects(push2.enable(), (e) => e.code === "install" && /Home Screen/.test(e.message));
  standalone = true;
  assert.equal((await push2.state()).status, "off", "from the Home Screen it works");
  delete globalThis.PushManager;
  assert.deepEqual(await push2.state(), { status: "old_ios" });
  await assert.rejects(push2.enable(), /iOS 16\.4/);
  device.userAgent = UA.android;
  device.platform = "Linux armv8l";
  assert.deepEqual(await push2.state(), { status: "unsupported" });
  freshDevice();
  // an iPad that says it is a Mac
  device.userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15";
  device.platform = "MacIntel";
  assert.equal(push2.environment().ios, true);
  freshDevice();
  assert.equal(push2.IOS_STEPS.length, 4);
  assert.ok(push2.IOS_STEPS.some((s) => /Add to Home Screen/.test(s)));
});

test("push2: the server without keys (503) or without the function (404) says 'not switched on yet'", async () => {
  for (const [status, body] of [[503, { error: "push_not_configured", message: "Phone notifications are not set up yet (VAPID keys)." }],
    [404, { code: "NOT_FOUND", message: "Requested function was not found" }]]) {
    freshDevice();
    await signInAs("field");
    const spy = spyInvoke(async () => httpError(status, body));
    try {
      assert.deepEqual(await push2.state(), { status: "not_configured" });
      await assert.rejects(push2.enable(), (e) => e.code === "not_configured" && /not switched on/.test(e.message));
      await assert.rejects(push2.sendTest(), /not switched on/);
    } finally { spy.restore(); }
  }
});

test("push2: the test notice says what happened; errors are plain sentences", async () => {
  freshDevice();
  await signInAs("field");
  await push2.enable();
  const r = await push2.sendTest();
  assert.ok(r.sent >= 1);
  assert.match(r.message, /^Sent to \d+ devices?\. It should arrive/);
  assert.match(push2.testMessage({ sent: 0, gone: 0, failed: 0, none: true }), /None of your devices/);
  assert.match(push2.testMessage({ sent: 1, gone: 0, failed: 0, none: false }), /^Sent to 1 device\./);
  assert.match(push2.testMessage({ sent: 2, gone: 1, failed: 0, none: false }), /Sent to 2 devices.*1 other/);
  assert.match(push2.testMessage({ sent: 0, gone: 1, failed: 0, none: false }), /no longer accepts/);
  assert.match(push2.testMessage({ sent: 0, gone: 0, failed: 2, none: false }), /did not take it/);
  const cases = [
    [async () => httpError(401, { error: "unauthorized" }), /sign in again/],
    [async () => httpError(403, { error: "forbidden", message: "This account is not active." }), /not active/],
    [async () => httpError(500, { error: "server_error", message: "the request could not be completed" }), /could not be completed/],
    [async () => ({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function", context: new TypeError("Failed to fetch") } }), /Can't reach the server/],
    [async () => { throw new TypeError("Failed to fetch"); }, /Can't reach the server/],
  ];
  for (const [fake, msg] of cases) {
    const spy = spyInvoke(fake);
    try { await assert.rejects(push2.sendTest(), msg); } finally { spy.restore(); }
  }
});

test("push2: signing out turns this device off for the person (their row and the browser's subscription); another account's is left alone", async () => {
  freshDevice();
  await signInAs("field");
  await push2.enable();
  const ep = globalThis.DCR2DemoPush.subscription().endpoint;
  assert.equal(rowsOf("field").length >= 1, true);
  assert.equal(await push2.forgetOnSignOut(2000), true);
  assert.equal(globalThis.DCR2DemoPush.subscription(), null, "the browser's subscription is gone");
  assert.ok(!engine.rows.push_subscriptions.some((s) => s.endpoint === ep), "the person's row for this device is gone");
  assert.equal(await push2.forgetOnSignOut(2000), false, "nothing left: harmless");
  // a shared device whose subscription is kept for another account: not this person's to remove
  freshDevice();
  await signInAs("lead");
  await push2.enable();
  const leadEp = globalThis.DCR2DemoPush.subscription().endpoint;
  await signInAs("field");
  assert.equal(await push2.forgetOnSignOut(2000), false);
  assert.ok(engine.rows.push_subscriptions.some((s) => s.endpoint === leadEp), "the lead's row stays");
  assert.ok(globalThis.DCR2DemoPush.subscription(), "and so does the browser's subscription");
  // a browser that cannot do push: nothing to do, at once
  freshDevice();
  delete globalThis.PushManager;
  assert.equal(await push2.forgetOnSignOut(2000), false);
  freshDevice();
});

test("push2: the test notice on an iPhone in Safari (no switch there) points to the Home Screen app", async () => {
  assert.match(push2.testMessage({ sent: 0, gone: 0, failed: 0, none: true }, { install: true }), /Add Portal 2 to your Home Screen first.*turn reminders on in the app/);
  assert.doesNotMatch(push2.testMessage({ none: true }, { install: true }), /above first/);
  assert.match(push2.testMessage({ sent: 0, gone: 1, failed: 0, none: false }, { install: true }), /in the Home Screen app/);
  assert.match(push2.testMessage({ none: true }), /Turn them on above first/, "elsewhere the switch is right there");
  const src = readFileSync(new URL("../site/js/push2.js", import.meta.url), "utf8");
  assert.match(src, /sendTest\(\{ install: box\.dataset\.state === "install" \}\)/, "the Settings panel passes the state");
  const common = readFileSync(new URL("../site/js/common2.js", import.meta.url), "utf8");
  assert.match(common, /export async function logout\(\)[\s\S]{0,700}forgetOnSignOut\(3000\)[\s\S]{0,400}await signOut\(\)/, "logout() turns the device off first");
});

test("push2 never names the other people's subscriptions or the service role; the settings page has the panel", () => {
  const src = readFileSync(new URL("../site/js/push2.js", import.meta.url), "utf8");
  assert.ok(!/service_role|VAPID_PRIVATE|private key/i.test(src));
  assert.match(src, /functions\.invoke\(FUNCTION/);
  assert.match(src, /op: "public_key"/);
  assert.match(src, /op: "test"/);
  assert.match(src, /upsert\(row, \{ onConflict: "endpoint", ignoreDuplicates: true \}\)/);
  const html = readFileSync(new URL("../site/settings.html", import.meta.url), "utf8");
  assert.match(html, /id="stPushBox"/);
  assert.match(html, /<h3 id="stPushH">Phone reminders<\/h3>/);
  const js = readFileSync(new URL("../site/js/shell/settings.js", import.meta.url), "utf8");
  assert.match(js, /mountSettings\("stPushBox"\)/);
});
