/* The DCR Agents web console's shell (site/js/console/shell.js, the old agents-console.js), run in
   the DOM stand-in of console-page-dom.mjs with a fake clock and a fake
   relay: the admin gate, the request mechanics (POST, poll every second for
   10 s then every 2 s, cancel at 60 s, timeout with a background finish, at
   most 4 in flight, resumed after a reload), the confirm flow, the method
   list, the status bar and banners, greying what cannot be used, routing,
   the unsaved-changes guard, and that every server string is escaped. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openConsole, onlineStatus, statusApi, scan, EVIL, esc, plain } from "./console-page-dom.mjs";

const SHELL = readFileSync(new URL("../../site/js/console/shell.js", import.meta.url), "utf8");
const site = (p) => readFileSync(new URL("../../site/" + p, import.meta.url), "utf8");
const ADMIN_ONLY = "Only an Admin can manage DCR Agents 2.";
const BUSY = "The DCR server is busy — try again in a minute.";
const TIMEOUT = "This is taking too long on the DCR server; it may still finish — check before trying again.";

/* A fake relay: ?action=console POST / cancel / GET id / server=1, with each
   request's state under the test's control. */
function relay(clock, status = onlineStatus()) {
  const reqs = new Map();
  const state = { status, postError: null, n: 0 };
  const api = async (path, opts = {}) => {
    if (/[?&]server=1/.test(path)) {
      if (state.statusError) throw state.statusError;
      return JSON.parse(JSON.stringify(state.status));
    }
    if (opts.method === "POST") {
      const body = opts.body || {};
      if (body.cancel) {
        const r = reqs.get(body.cancel);
        r.cancels = (r.cancels || 0) + 1;
        if (r.loseCancel) { r.status = "taken"; return { ok: false, status: "taken" }; }
        if (r.status === "new") { r.status = "cancelled"; return { ok: true, status: "cancelled" }; }
        return { ok: false, status: r.status };
      }
      if (state.postError) throw state.postError;
      const id = `${++state.n}.${"abcdefghijklmnopqrstuvwx"}`;
      const r = { id, method: body.method, args: body.args, status: "new", result: null, error: null, gets: [], posted: clock.now() };
      if (body.method === "console.methods") Object.assign(r, { status: "done", result: { protocol: 1, version: "2.0.0", host: "DCR-SERVER", methods: [] } });
      reqs.set(id, r);
      if (state.onPost) state.onPost(r);
      return { id, at: new Date(clock.now()).toISOString() };
    }
    const m = /[?&]id=([^&]+)/.exec(path);
    if (m) {
      const r = reqs.get(decodeURIComponent(m[1]));
      if (!r) throw Object.assign(new Error("No such request."), { status: 404, data: { error: "No such request.", code: "not_found" } });
      r.gets.push(clock.now() - r.posted);
      if (r.onGet) r.onGet(r, clock.now() - r.posted);
      if (r.netDown) throw new Error("Failed to fetch");
      return { id: r.id, status: r.status, method: r.method, at: "", takenAt: "", doneAt: "", host: "DCR-SERVER", result: r.result, error: r.error };
    }
    throw Object.assign(new Error("unexpected " + path), { status: 500, data: {} });
  };
  const posts = () => [...reqs.values()].filter((r) => r.method !== "console.methods");
  return { api, reqs, state, posts };
}

const METHODS = [
  { name: "agents.list", timeout: 15, ai: false, confirm: "", kind: "R", lane: "q" },
  { name: "agents.preview", timeout: 180, ai: true, confirm: "", kind: "R", lane: "s" },
  { name: "replies.reply", timeout: 5, ai: false, confirm: "C", kind: "W", lane: "s" },
  { name: "dashboard.pause", timeout: 10, ai: false, confirm: "C", kind: "W", lane: "q" },
];

async function withRelay(over = {}) {
  const { fakeClock } = await import("./console-page-dom.mjs");
  const clock = fakeClock();
  const R = relay(clock, over.status || onlineStatus());
  const h = await openConsole({ clock, api: R.api, methods: over.methods === undefined ? METHODS : over.methods, session: over.session || new Map(),
    modules: over.modules || [] });
  return { h, R, clock, ctx: h.C._test.ctx };
}

function settledState(p) {
  const s = { done: false };
  p.then((v) => { s.done = true; s.value = v; }, (e) => { s.done = true; s.error = e; });
  return s;
}

/* ── who may use it ───────────────────────────────────────────────────── */

test("anybody but an Admin sees only the refusal: no status read, no tabs, no request", async () => {
  for (const role of ["Lead", "Manager", "Agents", "Field"]) {
    const h = await openConsole({ role, api: statusApi(onlineStatus()), modules: ["console-dashboard.js", "console-agents.js", "console-settings.js"] });
    await h.settle(60000);
    assert.match(h.view().textContent, /Only an Admin can manage DCR Agents 2\./, role);
    assert.equal(h.calls.length, 0, `${role}: nothing is asked of the portal`);
    assert.equal(h.$("cTabs").hidden, true);
    assert.equal(h.$("cStatus").hidden, true);
    assert.match(h.html(), /href="dashboard\.html"/, "a way back");
  }
});

test("an account demoted while the page is open (403 on the status read) gets the refusal and the polling stops", async () => {
  const { fakeClock } = await import("./console-page-dom.mjs");
  const clock = fakeClock();
  const R = relay(clock);
  const h = await openConsole({ clock, api: R.api, methods: METHODS, modules: ["console-dashboard.js"] });
  R.state.statusError = Object.assign(new Error(ADMIN_ONLY), { status: 403, data: { error: ADMIN_ONLY, code: "forbidden" } });
  await h.settle(31000);
  assert.match(h.view().textContent, /Only an Admin can manage DCR Agents 2\./);
  const reads = h.calls.filter((c) => /server=1/.test(c.path)).length;
  await h.settle(120000);
  assert.equal(h.calls.filter((c) => /server=1/.test(c.path)).length, reads, "no more status reads");
});

/* ── tabs ─────────────────────────────────────────────────────────────── */

test("register: tabs in their order, a fresh element per visit, unknown routes land on the dashboard, a second id throws", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [], boot: false });
  const seen = [];
  h.C.register({ id: "zeta", title: "Zeta", order: 50, render(el, ctx) { seen.push(["zeta", plain(ctx.route)]); el.innerHTML = "<p id='zp'>z</p>"; } });
  h.C.register({ id: "dashboard", title: `Dash ${EVIL}`, order: 10, render(el) { seen.push(["dashboard", el.childNodes.length]); el.innerHTML = "<p>d</p>"; } });
  h.C.register({ id: "alpha", title: "Alpha", order: 20, render() { seen.push(["alpha"]); } });
  assert.throws(() => h.C.register({ id: "alpha", title: "Again", order: 1, render() {} }), /registered twice/);
  assert.throws(() => h.C.register({ id: "Bad Id", title: "x", render() {} }), /id like/);
  assert.throws(() => h.C.register({ id: "norender", title: "x" }), /needs render/);
  await h.boot();
  assert.deepEqual(h.$("cTabs").children.map((a) => a.id), ["cTab-dashboard", "cTab-alpha", "cTab-zeta"]);
  assert.equal(h.$("cTab-dashboard").getAttribute("aria-selected"), "true");
  assert.ok(h.html("cTabs").includes(esc(`Dash ${EVIL}`)) && !scan(h.$("cTabs")).length, "the tab title is escaped");
  await h.go("zeta/edit/ab%20cd?x=1&name=Luis%20Martinez");
  assert.deepEqual(seen.at(-1), ["zeta", { tab: "zeta", parts: ["edit", "ab cd"], query: { x: "1", name: "Luis Martinez" } }]);
  await h.go("nothing-here");
  assert.deepEqual(seen.at(-1), ["dashboard", 0], "an unknown tab shows the dashboard, in an empty element");
  await h.go("dashboard");
  assert.equal(seen.at(-1)[1], 0, "again a fresh, empty element");
});

test("leave() runs before the next tab draws; autoRefresh redraws only while visible and no dialog is open", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [], boot: false });
  const log = [];
  h.C.register({ id: "dashboard", title: "D", order: 10, autoRefresh: 30, render() { log.push("render-d"); }, leave() { log.push("leave-d"); } });
  h.C.register({ id: "other", title: "O", order: 20, render() { log.push("render-o"); } });
  await h.boot();
  await h.settle(30000);
  assert.deepEqual(log, ["render-d", "leave-d", "render-d"], "redrawn after 30 s");
  h.doc.body.appendChild(Object.assign(h.doc.createElement("div"), { className: "dcr-mo open" }));
  await h.settle(30000);
  assert.equal(log.filter((x) => x === "render-d").length, 2, "not while a dialog is open");
  h.doc.querySelector(".dcr-mo").remove();
  h.doc.visibilityState = "hidden";
  await h.settle(30000);
  assert.equal(log.filter((x) => x === "render-d").length, 2, "not while the page is hidden");
  h.doc.visibilityState = "visible";
  await h.go("other");
  assert.deepEqual(log.slice(-2), ["leave-d", "render-o"]);
  await h.settle(120000);
  assert.equal(log.at(-1), "render-o", "the other tab has no autoRefresh");
});

/* ── the request mechanics ────────────────────────────────────────────── */

test("rpc: POST, then the id every second for 10 s and every 2 s after; the answer's data comes back", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.onPost = (r) => { r.onGet = (rr, at) => { if (at >= 14000) Object.assign(rr, { status: "done", result: { feeds: [], words: EVIL } }); else if (at >= 3000) rr.status = "taken"; }; };
  const s = settledState(ctx.rpc("agents.list", { a: 1 }));
  await h.settle(20000);
  assert.equal(s.done, true);
  assert.deepEqual(plain(s.value), { feeds: [], words: EVIL });
  const r = R.posts()[0];
  assert.deepEqual(plain({ method: r.method, args: r.args }), { method: "agents.list", args: { a: 1 } });
  assert.deepEqual(r.gets, [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 14000]);
  assert.deepEqual(plain(h.session.get("dcr.agentsConsole.pending.v1") ?? null), null, "nothing left pending");
});

test("rpc: nobody picked it up in 60 s → it is cancelled and the caller hears the server is busy", async () => {
  const { R, ctx, h } = await withRelay();
  const s = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
  await h.settle(59000);
  assert.equal(s.done, false);
  await h.settle(3000);
  assert.equal(s.done, true);
  assert.equal(s.error.code, "busy");
  assert.equal(s.error.message, BUSY);
  assert.equal(R.posts()[0].cancels, 1);
  assert.equal(R.posts()[0].status, "cancelled");
});

test("rpc: a cancel that loses the race to the server keeps waiting, and the answer still arrives", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.onPost = (r) => { r.loseCancel = true; r.onGet = (rr, at) => { if (at >= 70000) Object.assign(rr, { status: "done", result: { ok: 1 } }); }; };
  const s = settledState(ctx.rpc("agents.preview", {}, { quiet: true }));   // 180 s + 30: no timeout yet at 60 s
  await h.settle(75000);
  assert.equal(R.posts()[0].cancels, 1);
  assert.equal(s.done, true);
  assert.deepEqual(plain(s.value), { ok: 1 });
});

test("rpc: past the method's timeout + 30 s while taken → timeout, still followed in the background, and the outcome is a toast", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.onPost = (r) => { r.onGet = (rr, at) => { rr.status = at >= 50000 ? "done" : "taken"; if (at >= 50000) rr.result = { words: `Sent ${EVIL}` }; }; };
  const s = settledState(ctx.rpc("replies.reply", { sid: "x", text: "hi" }, { quiet: true }));   // timeout 5 s → 35 s
  await h.settle(34000);
  assert.equal(s.done, false);
  await h.settle(4000);
  assert.equal(s.error.code, "timeout");
  assert.equal(s.error.message, TIMEOUT);
  await h.settle(15000);
  assert.ok(h.toasts().some((t) => t.text === `Finished on the DCR server: Sent ${EVIL}`), JSON.stringify(h.toasts()));
  assert.ok(!scan(h.$("cToasts")).length, "a toast is text, never markup");
});

test("rpc: the server's error, an expired request, a lost one and a cancelled one each reject with their code", async () => {
  const cases = [
    [{ status: "error", error: { code: "refused", message: `No ${EVIL}` } }, "refused", `No ${EVIL}`],
    [{ status: "error", error: { code: "bad_args", message: "agent.name is longer than 80 characters" } }, "bad_args", "agent.name is longer than 80 characters"],
    [{ status: "expired", error: { code: "expired", message: "The DCR server did not pick this up — it may be off or in Standby." } }, "expired", /did not pick this up/],
    [{ status: "error", error: { code: "lost", message: "The DCR server stopped while working on this — check before trying again." } }, "lost", /stopped while working/],
    [{ status: "cancelled", error: { code: "cancelled", message: "" } }, "cancelled", /cancelled/],
  ];
  for (const [answer, code, words] of cases) {
    const { R, ctx, h } = await withRelay();
    R.state.onPost = (r) => { r.onGet = (rr) => Object.assign(rr, answer); };
    const s = settledState(ctx.rpc("agents.list", {}));
    await h.settle(3000);
    assert.equal(s.error.code, code);
    if (words instanceof RegExp) assert.match(s.error.message, words); else assert.equal(s.error.message, words);
    assert.ok(h.toasts().some((t) => t.bad), "not quiet: the reason is a toast");
  }
});

test("rpc: the portal's refusals of the POST come back as rate (with retryAfter), too_big, not_set_up, forbidden and network", async () => {
  const cases = [
    [{ status: 429, data: { error: "Slow down.", code: "rate", retryAfter: 12 } }, "rate"],
    [{ status: 429, data: { error: "You have 20 actions waiting on the DCR server — wait for them to finish.", code: "too_many" } }, "rate"],
    [{ status: 413, data: { error: "That is too much to send to the DCR server at once.", code: "too_big" } }, "too_big"],
    [{ status: 503, data: { error: "The DCR server has not set up remote management yet.", code: "not_set_up" } }, "not_set_up"],
    [{ status: 403, data: { error: ADMIN_ONLY, code: "forbidden" } }, "forbidden"],
    [{ status: 400, data: { error: "args must be an object.", code: "bad_request" } }, "bad_args"],
    [{}, "network"],
  ];
  for (const [e, code] of cases) {
    const { R, ctx, h } = await withRelay();
    R.state.postError = Object.assign(new Error((e.data && e.data.error) || "Failed to fetch"), e);
    const s = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
    await h.settle(100);
    if (code === "rate" && e.data.retryAfter) {
      assert.equal(s.done, false, "a read waits out retryAfter and is tried once more");
      await h.settle(13000);
      assert.equal(s.error.retryAfter, 12);
      assert.equal(s.error.message, "Too many requests in a short time — try again in 12 seconds.");
    }
    assert.equal(s.error.code, code, JSON.stringify(e));
  }
});

test("rpc: a read refused for the rate is tried once more after retryAfter; a change never is", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.postError = Object.assign(new Error("Slow down."), { status: 429, data: { error: "Slow down.", code: "rate", retryAfter: 5 } });
  R.state.onPost = (r) => { r.onGet = (rr) => Object.assign(rr, { status: "done", result: { feeds: [] } }); };
  const read = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
  await h.settle(1000);
  assert.equal(read.done, false);
  R.state.postError = null;
  await h.settle(6000);
  assert.deepEqual(plain(read.value), { feeds: [] }, "the second try went through");
  R.state.postError = Object.assign(new Error("Slow down."), { status: 429, data: { error: "Slow down.", code: "rate", retryAfter: 5 } });
  const write = settledState(ctx.rpc("replies.reply", { sid: "x", text: "hi" }, { quiet: true }));
  await h.settle(100);
  assert.equal(write.error.code, "rate", "a change is never sent twice without the admin");
  R.state.postError = Object.assign(new Error("Slow down."), { status: 429, data: { error: "Slow down.", code: "rate", retryAfter: 600 } });
  const long = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
  await h.settle(100);
  assert.equal(long.error.code, "rate", "a long wait is not waited out");
});

test("rpc: still not picked up after 10 s, the working line says the DCR server is busy", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.onPost = (r) => { r.onGet = (rr, at) => { if (at >= 20000) Object.assign(rr, { status: "done", result: {} }); }; };
  const s = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
  await h.settle(3000);
  assert.equal(h.$("cWorking").textContent, "Working…");
  await h.settle(9000);
  assert.equal(h.$("cWorking").textContent, "Waiting for the DCR server — it is busy with other actions…");
  await h.settle(10000);
  assert.equal(s.done, true);
  assert.equal(h.$("cWorking").textContent, "");
});

test("rpc: after a reload, a request the portal has already forgotten (404) finished — it is not called a failure", async () => {
  const session = new Map();
  const first = await withRelay({ session });
  first.R.state.onPost = (r) => { r.status = "taken"; };
  settledState(first.ctx.rpc("replies.reply", { sid: "x", text: "hi" }, { quiet: true }));
  await first.h.settle(3000);
  /* a new page in the same tab, after the portal purged the finished request */
  const again = await withRelay({ session });
  await again.h.settle(3000);
  const toasts = again.h.toasts().map((t) => t.text);
  assert.ok(toasts.some((t) => t === "That finished on the DCR server a while ago — see Activity → Remote actions."), JSON.stringify(toasts));
  assert.ok(!toasts.some((t) => /Not done/.test(t)));
});

test("rpc: a dropped connection while following is retried quietly, then given up after a minute", async () => {
  const { R, ctx, h } = await withRelay();
  R.state.onPost = (r) => { r.onGet = (rr, at) => { rr.netDown = at >= 2000 && at < 8000; if (at >= 9000) Object.assign(rr, { status: "done", result: { ok: true } }); }; };
  const s = settledState(ctx.rpc("agents.list", {}));
  await h.settle(10000);
  assert.deepEqual(plain(s.value), { ok: true }, "a few failed reads cost nothing");
  const again = await withRelay();
  again.R.state.onPost = (r) => { r.status = "taken"; r.onGet = (rr) => { rr.netDown = true; }; };
  const s2 = settledState(again.ctx.rpc("agents.list", {}, { quiet: true }));
  await again.h.settle(70000);
  assert.equal(s2.error.code, "network");
});

test("rpc: at most 4 requests in flight; the fifth is posted when one finishes", async () => {
  const { R, ctx, h } = await withRelay();
  const all = [1, 2, 3, 4, 5, 6].map((n) => settledState(ctx.rpc("agents.list", { n }, { quiet: true })));
  await h.settle(10);
  assert.equal(R.posts().length, 4);
  Object.assign(R.posts()[0], { status: "done", result: { n: 1 } });
  await h.settle(1500);
  assert.equal(all[0].done, true);
  assert.equal(R.posts().length, 5);
  assert.deepEqual(plain(R.posts()[4].args), { n: 5 });
});

test("rpc: offline, Standby or not set up rejects at once without posting; force skips the check", async () => {
  const offline = onlineStatus({}, { online: false, minutesAgo: 20 });
  const standby = onlineStatus({ lease: null }, { standby: true, host: "OLD-PC" });
  const unset = onlineStatus({ ready: false });
  const oldBuild = onlineStatus({}, { proto: 0, consoleOn: false, version: "1.9.0" });
  for (const [status, code, words] of [[offline, "offline", /has not reported for 20 min/],
    [standby, "standby", /^OLD-PC is waiting in Standby\. To make it the server, press “Make this computer the DCR server” on its Dashboard\.$/],
    [unset, "not_set_up", /not set up remote management/], [oldBuild, "offline", /older DCR Agents 2 \(1\.9\.0\)/]]) {
    const { R, ctx, h } = await withRelay({ status });
    const s = settledState(ctx.rpc("agents.list", {}, { quiet: true }));
    await h.settle(100);
    assert.equal(s.error.code, code);
    assert.match(s.error.message, words);
    assert.equal(R.posts().length, 0, "nothing was posted");
    assert.equal(ctx.canAct(), false);
    ctx.rpc("agents.list", {}, { quiet: true, force: true }).catch(() => {});
    await h.settle(100);
    assert.equal(R.posts().length, 1, "force posts anyway");
  }
});

test("rpc: the ids being waited on are kept in this tab, and a reload follows them to the end", async () => {
  const session = new Map();
  const first = await withRelay({ session });
  first.R.state.onPost = (r) => { r.status = "taken"; };
  settledState(first.ctx.rpc("replies.reply", { sid: "x", text: "hi" }, { quiet: true }));
  settledState(first.ctx.rpc("agents.list", {}, { quiet: true }));
  await first.h.settle(3000);
  const kept = JSON.parse(session.get("dcr.agentsConsole.pending.v1"));
  assert.deepEqual(kept.map((k) => [k.method, k.kind]), [["replies.reply", "W"], ["agents.list", "R"]]);
  /* the "reload": a new page on the same tab storage and the same relay */
  const { fakeClock } = await import("./console-page-dom.mjs");
  const clock = first.clock;
  const req = first.R.posts()[0];
  const h2 = await openConsole({ clock, session, api: first.R.api, methods: METHODS });
  req.onGet = (rr) => Object.assign(rr, { status: "done", result: { words: "Sent the text." } });
  first.R.posts()[1].onGet = (rr) => Object.assign(rr, { status: "done", result: { feeds: [] } });
  await h2.settle(5000);
  assert.deepEqual(h2.toasts().map((t) => t.text), ["Finished on the DCR server: Sent the text."], "a change is told; a late read is dropped");
  assert.equal(session.get("dcr.agentsConsole.pending.v1") ?? null, null, "forgotten once answered");
  assert.ok(fakeClock);
});

/* ── confirms ─────────────────────────────────────────────────────────── */

test("act: the server's question is shown (danger, ok words, extra boxes); yes calls again with confirmed:true and the boxes", async () => {
  const calls = [];
  const question = { title: "Turn on", question: `Turn on ${EVIL}?`, ok_text: "Turn on", danger: true, twice: null,
    extra: [{ name: "also_enable_here", label: "Also run the assistants on the DCR server computer", type: "checkbox", value: true },
      { name: "bad name!", label: "dropped", type: "checkbox", value: true }] };
  const rpc = async (method, args) => { calls.push(plain({ method, args })); return args.confirmed ? { words: "Done." } : { confirm: question }; };
  const h = await openConsole({ api: statusApi(onlineStatus()), rpc, methods: [], answers: [{ also_enable_here: false }] });
  const ctx = h.C._test.ctx;
  const out = await ctx.act("assistants.set_on", { names: ["Luis"], on: true });
  assert.deepEqual(plain(out), { words: "Done." });
  const d = h.dialogs[0].opts;
  assert.deepEqual(plain({ title: d.title, message: d.message, okText: d.okText, danger: d.danger, fields: d.fields }), {
    title: "Turn on", message: `Turn on ${EVIL}?`, okText: "Turn on", danger: true,
    fields: [{ name: "also_enable_here", label: "Also run the assistants on the DCR server computer", type: "checkbox", value: true }] });
  assert.deepEqual(calls, [
    { method: "assistants.set_on", args: { names: ["Luis"], on: true } },
    { method: "assistants.set_on", args: { names: ["Luis"], on: true, also_enable_here: false, confirmed: true } },
  ]);
});

test("act: declining calls nothing more; a method that does not ask acts on the first call; twice asks a second time", async () => {
  let calls = [];
  const ask = (twice) => async (method, args) => { calls.push(plain(args)); return args.confirmed ? { ok: true } : { confirm: { title: "T", question: "Q?", ok_text: "Yes", danger: false, twice } }; };
  let h = await openConsole({ api: statusApi(onlineStatus()), rpc: ask(null), methods: [], answers: [null] });
  assert.equal(await h.C._test.ctx.act("x.y", { a: 1 }), null);
  assert.equal(calls.length, 1, "declined: no second call");
  calls = [];
  h = await openConsole({ api: statusApi(onlineStatus()), rpc: async (m, args) => { calls.push(plain(args)); return { words: "acted" }; }, methods: [] });
  assert.deepEqual(plain(await h.C._test.ctx.act("agents.toggle", { ids: ["a"], on: true })), { words: "acted" });
  assert.equal(calls.length, 1, "no question, no second call");
  calls = [];
  h = await openConsole({ api: statusApi(onlineStatus()), rpc: ask("Are you sure? It replaces everything."), methods: [], answers: [true, false] });
  assert.equal(await h.C._test.ctx.act("training.import", { data: {} }), null);
  assert.equal(h.dialogs[1].kind, "confirm");
  assert.equal(h.dialogs[1].opts.message, "Are you sure? It replaces everything.");
  assert.equal(calls.length, 1, "the second question declined: nothing done");
  calls = [];
  h = await openConsole({ api: statusApi(onlineStatus()), rpc: ask("Sure?"), methods: [], answers: [true, true] });
  assert.deepEqual(plain(await h.C._test.ctx.act("training.import", { data: {} })), { ok: true });
  assert.deepEqual(calls.at(-1), { data: {}, confirmed: true });
});

/* ── what the server knows ────────────────────────────────────────────── */

test("has(): everything until console.methods answers; then a control for a method the server lacks is greyed with the update words", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: undefined, boot: false,
    rpc: async (m) => (m === "console.methods" ? { protocol: 1, version: "2.0.0", host: "S", methods: [{ name: "agents.list", timeout: 15 }] } : {}) });
  h.C.register({ id: "dashboard", title: "D", order: 1, render(el) {
    el.innerHTML = '<button id="b1" data-method="agents.list" title="List">L</button><button id="b2" data-method="photo.print" title="Print">P</button>';
  } });
  const ctx = h.C._test.ctx;
  assert.equal(ctx.has("photo.print"), true, "unknown yet: not greyed");
  await h.boot();
  await h.settle(100);
  assert.equal(ctx.has("agents.list"), true);
  assert.equal(ctx.has("photo.print"), false);
  assert.equal(h.$("b2").disabled, true);
  assert.equal(h.$("b2").title, "Update DCR Agents 2 on the server computer to use this");
  assert.equal(h.$("b1").disabled, false);
  assert.equal(plain(ctx.info()).version, "2.0.0");
  h.C._test.setMethods(["agents.list", "photo.print"]);
  assert.equal(h.$("b2").disabled, false, "a newer server: back on");
  assert.equal(h.$("b2").title, "Print");
});

test("the method list is asked once per server build and kept in the tab; a new version asks again", async () => {
  const session = new Map();
  let asked = 0;
  const rpc = async (m) => { if (m === "console.methods") { asked++; return { protocol: 1, version: "2.0.0", host: "DCR-SERVER", methods: [{ name: "agents.list" }] }; } return {}; };
  const first = await openConsole({ api: statusApi(onlineStatus()), methods: undefined, rpc, session });
  await first.settle(100);
  assert.equal(asked, 1);
  const again = await openConsole({ api: statusApi(onlineStatus()), methods: undefined, rpc, session });
  await again.settle(100);
  assert.equal(asked, 1, "the same host and version: not asked again");
  assert.equal(again.C._test.ctx.has("photo.print"), false, "and the kept list is used");
  const newer = await openConsole({ api: statusApi(onlineStatus({}, { version: "2.1.0" })), methods: undefined, rpc, session });
  await newer.settle(100);
  assert.equal(asked, 2, "an updated server is asked");
});

/* ── status bar, banners, greying ─────────────────────────────────────── */

test("the status bar and the banners: online, paused (with Resume), offline, Standby, not set up, another computer also running — all escaped", async () => {
  const evilHost = `PC${EVIL}`;
  const on = await openConsole({ api: statusApi(onlineStatus({}, { host: evilHost, version: EVIL })), methods: [] });
  assert.match(on.$("cStatusText").textContent, /^DCR server PC<img src=x onerror=alert\(1\)> · v<img src=x onerror=alert\(1\)> · last seen just now$/);
  assert.deepEqual(scan(on.$("cApp")), []);
  assert.equal(on.$("cDot").className, "c-dot good");
  assert.equal(on.$("cBanners").children.length, 0);

  const off = await openConsole({ api: statusApi(onlineStatus({}, { online: false, minutesAgo: 95 })), methods: [] });
  assert.match(off.$("cBanners").textContent, /^The DCR server has not reported for 2 h\. Nothing can be changed until it is back\.$/);
  assert.equal(off.$("cDot").className, "c-dot bad");

  const sb = await openConsole({ api: statusApi(onlineStatus({ lease: null }, { standby: true, host: evilHost })), methods: [] });
  assert.equal(sb.$("cBanners").textContent,
    `${evilHost} is waiting in Standby. To make it the server, press “Make this computer the DCR server” on its Dashboard.`);
  assert.deepEqual(scan(sb.$("cApp")), []);

  /* just restarted: its first beat said Standby, but the lease is its own; or
     its console has not polled yet — a start, said in amber, not an alarm */
  for (const st of [onlineStatus({}, { standby: true }), onlineStatus({}, { consoleOn: false, consoleAt: "" }),
    onlineStatus({}, { consoleOn: false })]) {
    const starting = await openConsole({ api: statusApi(st), methods: [] });
    assert.equal(starting.$("cBanners").textContent, "The DCR server is starting — try again in a minute.");
    assert.equal(starting.$("cDot").className, "c-dot warn");
    assert.match(starting.$("cStatusText").textContent, /Starting$/);
  }
  const stuck = await openConsole({ api: statusApi(onlineStatus({}, { consoleOn: false, consoleAt: "2026-10-10T16:20:00.000Z" })), methods: [] });
  assert.match(stuck.$("cBanners").textContent, /remote management is not running right now/);
  const never = await openConsole({ api: statusApi(onlineStatus({}, { online: false, minutesAgo: null })), methods: [] });
  assert.equal(never.$("cBanners").textContent, "The DCR server has not reported yet. Nothing can be changed until it does.");

  const unset = await openConsole({ api: statusApi(onlineStatus({ ready: false })), methods: [] });
  assert.equal(unset.$("cBanners").textContent, "The DCR server has not set up remote management yet.");

  const none = await openConsole({ api: statusApi({ ready: false, server: null, lease: null, others: [] }), methods: [] });
  assert.match(none.$("cBanners").textContent, /No DCR server has reported yet/);

  const others = await openConsole({ api: statusApi(onlineStatus({ others: [
    { host: evilHost, version: "1.9.0", proto: 0, lastSeen: "", minutesAgo: 2, standby: false, legacy: true },
    { host: "SLEEPY", minutesAgo: 2, standby: true }, { host: "GONE", minutesAgo: 45, standby: false },
    { host: "DCR-SERVER", minutesAgo: 0, standby: false }] })), methods: [] });
  assert.equal(others.$("cBanners").textContent, `${evilHost} is also running DCR Agents 2 — stop it there.`, "only the fresh, sending one");
  assert.deepEqual(scan(others.$("cApp")), []);
});

test("paused: an amber banner whose Resume asks the server's question, then calls dashboard.pause {paused:false} confirmed", async () => {
  const calls = [];
  const rpc = async (method, args) => {
    calls.push(plain({ method, args }));
    return args.confirmed ? { paused: false } : { confirm: { title: "Resume", question: "Resume everything?", ok_text: "Resume", danger: false, twice: null, extra: [] } };
  };
  const h = await openConsole({ api: statusApi(onlineStatus({}, { paused: true })), rpc, methods: ["dashboard.pause"], answers: [true] });
  assert.equal(h.$("cDot").className, "c-dot warn");
  assert.match(h.$("cBanners").textContent, /Everything is paused on the DCR server/);
  await h.click("cResume");
  await h.settle(10);
  assert.deepEqual(calls, [{ method: "dashboard.pause", args: { paused: false } }, { method: "dashboard.pause", args: { paused: false, confirmed: true } }]);
  assert.equal(h.$("cBanners").children.length, 0, "believed at once, until the next heartbeat says so");
  assert.ok(h.toasts().some((t) => /Resumed/.test(t.text)));
});

test("offline greys every [data-act] control and marks the page; back online they come back, but not one the module greyed itself", async () => {
  let status = onlineStatus({}, { online: false, minutesAgo: 30 });
  const h = await openConsole({ api: async (p) => { if (/server=1/.test(p)) return plain(status); throw new Error("x"); }, methods: [], boot: false });
  h.C.register({ id: "dashboard", title: "D", order: 1, render(el) {
    el.innerHTML = '<button id="w" data-act>Write</button><button id="m" data-act disabled>Mine</button><button id="r">Read</button>';
  } });
  await h.boot();
  await h.settle(10);
  assert.equal(h.$("w").disabled, true);
  assert.equal(h.$("m").disabled, true);
  assert.equal(h.$("r").disabled, false, "only writes");
  assert.ok(h.doc.body.classList.contains("c-offline"));
  status = onlineStatus();
  await h.settle(31000);
  assert.equal(h.$("w").disabled, false);
  assert.equal(h.$("m").disabled, true, "its own reason still stands");
  assert.ok(!h.doc.body.classList.contains("c-offline"));
});

test("a tab that could not load while the server was away tries again by itself when it is back", async () => {
  let status = onlineStatus({}, { online: false, minutesAgo: 30 });
  let renders = 0;
  const h = await openConsole({ api: async (p) => { if (/server=1/.test(p)) return plain(status); throw new Error("x"); }, methods: [], boot: false,
    rpc: async () => ({ ok: true }) });
  h.C.register({ id: "dashboard", title: "D", order: 1, render(el, ctx) {
    renders++;
    return ctx.rpc("dashboard.status", {}, { quiet: true }).then(() => { el.innerHTML = "<p id='ok'>loaded</p>"; }, (e) => { el.innerHTML = ctx.ui.failed(e); });
  } });
  await h.boot();
  await h.settle(10);
  assert.match(h.view().textContent, /The DCR server is not available right now/);
  status = onlineStatus();
  await h.settle(31000);
  assert.equal(renders, 2);
  assert.ok(h.$("ok"));
});

/* ── the unsaved-changes guard ────────────────────────────────────────── */

test("guard: leaving a tab with unsaved changes asks first; No stays, Yes goes", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [], boot: false });
  let dirty = true, edits = 0;
  h.C.register({ id: "dashboard", title: "D", order: 1, render(el, ctx) { edits++; ctx.guard(() => (dirty ? "Leave without saving?" : "")); } });
  h.C.register({ id: "other", title: "O", order: 2, render() {} });
  await h.boot();
  await h.go("other");
  await h.settle(10);
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].opts.message, "Leave without saving?");
  await h.answerDialog(false);
  await h.settle(10);
  assert.equal(h.ctx.location.hash, "", "stayed put");
  assert.equal(h.C._test.state().current.tab, "dashboard");
  await h.go("other");
  await h.settle(10);
  await h.answerDialog(true);
  await h.settle(10);
  assert.equal(h.C._test.state().current.tab, "other");
  dirty = false;
  assert.equal(edits, 1);
});

/* ── drawing helpers ──────────────────────────────────────────────────── */

test("ctx.ui escapes every value: table (a card list on a phone), kv, chip, section, pager, empty, failed; only https: and portal links survive", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [] });
  const ui = h.C._test.ctx.ui;
  const picked = [];
  const pages = [];
  const t = ui.table({ cols: [{ key: "a", label: `A${EVIL}` }, { key: "b", label: "B", render: (r) => ui.chip(r.b, "warn") }],
    rows: [{ a: EVIL, b: EVIL }, { a: "two", b: "x" }], onRow: (r) => picked.push(r.a) });
  const page = ui.pager({ offset: 0, limit: 50, total: 120, next: 50 }, (o) => pages.push(o));
  const html = [t, page, ui.kv([[EVIL, EVIL], ["raw", { html: "<b>ok</b>" }]]), ui.chip(EVIL, `bad" onclick="x`), ui.section(EVIL, "<p>x</p>", { open: true }),
    ui.empty(EVIL), ui.failed(Object.assign(new Error(EVIL), { code: "refused" }))].join("");
  h.view().innerHTML = html;
  assert.deepEqual(scan(h.view()), []);
  assert.ok(h.html().includes(esc(EVIL)));
  assert.match(t, /<td data-label="A&lt;img src=x onerror=alert\(1\)&gt;">/, "each cell carries its label for the phone's card view");
  assert.ok(!/class="c-chip bad/.test(ui.chip("x", `bad" onclick="x`)), "an unknown tone adds no class");
  h.view().querySelector('[data-row="1"] td').click();
  assert.deepEqual(picked, ["two"]);
  h.view().querySelector('[data-c-page="50"]').click();
  assert.deepEqual(pages, [50]);
  assert.equal(ui.href("javascript:alert(1)"), "");
  assert.equal(ui.href("//evil.test/x"), "");
  assert.equal(ui.href("https://www.google.com/maps/x"), "https://www.google.com/maps/x");
  assert.equal(ui.href("my-tasks.html?task=41"), "my-tasks.html?task=41");
  assert.equal(ui.href("#/agents/edit/ab12"), "#/agents/edit/ab12");
  assert.equal(ui.plural(1, "agent"), "1 agent");
  assert.equal(ui.plural(3, "person", "people"), "3 people");
});

test("ctx.ui.form: every field type drawn escaped and read back typed", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [] });
  const f = h.C._test.ctx.ui.form({ fields: [
    { name: "t", label: EVIL, type: "text", value: EVIL, maxLength: 80, help: EVIL },
    { name: "a", label: "Area", type: "textarea", value: `${EVIL}\nline 2` },
    { name: "n", label: "N", type: "number", value: 5, min: 0, max: 9 },
    { name: "s", label: "S", type: "select", value: "b", options: [{ value: "a", label: EVIL }, { value: "b", label: "Bee" }] },
    { name: "c", label: "C", type: "checkbox", value: true },
    { name: "d", label: "Days", type: "days", value: "weekdays" },
    { name: "l", label: "L", type: "list", value: ["Ana", "Luis"] },
    { name: "h", label: "H", type: "time", value: "07:30" },
  ] });
  h.view().innerHTML = f.html;
  assert.deepEqual(scan(h.view()), []);
  assert.deepEqual(plain(f.read(h.view())), { t: EVIL, a: `${EVIL}\nline 2`, n: 5, s: "b", c: true, d: [0, 1, 2, 3, 4], l: ["Ana", "Luis"], h: "07:30" });
  h.$(f.id("n")).value = "";
  h.$(f.id("c")).checked = false;
  h.$(f.id("d") + "-6").checked = true;
  h.$(f.id("l")).value = " Sam ,, Olga ";
  assert.deepEqual(plain(f.read(h.view())), { t: EVIL, a: `${EVIL}\nline 2`, n: null, s: "b", c: false, d: [0, 1, 2, 3, 4, 6], l: ["Sam", "Olga"], h: "07:30" });
});

test("ctx.busy counts the seconds and goes away; ctx.press greys the button with Working… and gives it back", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [] });
  const ctx = h.C._test.ctx;
  h.view().innerHTML = '<div id="slot"></div><button id="b" data-act>Save <b>it</b></button>';
  const done = ctx.busy(h.$("slot"), "Claude is working… this can take a minute");
  await h.settle(5000);
  assert.equal(h.$("slot").textContent, "Claude is working… this can take a minute 5 s");
  done();
  assert.equal(h.$("slot").textContent, "");
  let finish;
  const p = ctx.press(h.$("b"), () => new Promise((r) => { finish = r; }));
  await h.settle(0);
  assert.equal(h.$("b").disabled, true);
  assert.equal(h.$("b").textContent, "Working…");
  finish(1);
  assert.equal(await p, 1);
  assert.equal(h.$("b").disabled, false);
  assert.equal(h.$("b").innerHTML, "Save <b>it</b>");
});

test("ctx.print puts the page in the print host, sets the paper size and prints", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), methods: [] });
  h.C._test.ctx.print(`<h1>${esc(EVIL)}</h1>`, { title: "Shoots", paper: "a4" });
  assert.equal(h.printed(), 1);
  assert.equal(h.$("cPrint").textContent, EVIL);
  assert.match(h.$("cPrintPage").textContent, /@page \{ size: A4;/);
  assert.equal(h.doc.body.getAttribute("data-paper"), "a4");
});

/* ── the files ────────────────────────────────────────────────────────── */

test("the page (Portal 2): the portal's look, both dark blocks, the shell then every module in order, then the bridge; no inline script or handler; the modal takes a tick box", () => {
  const html = site("agents-console.html");
  const css = site("css/agents-console.css");
  assert.match(html, /<link rel="stylesheet" href="css\/styles\.css" \/>\s*<link rel="stylesheet" href="css\/agents-console\.css" \/>\s*<link rel="stylesheet" href="css\/console-print\.css" \/>/);
  const scripts = [...html.matchAll(/<script(?: type="module")? src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, ["js/config.js", "js/console/framed.js", "js/console/shell.js", "js/console/console-dashboard.js", "js/console/console-agents.js",
    "js/console/console-work.js", "js/console/console-photo.js", "js/console/console-assistants.js", "js/console/console-training.js",
    "js/console/console-people.js", "js/console/console-settings.js", "js/console/bridge.js"]);
  assert.match(html, /<script type="module" src="js\/console\/bridge\.js"><\/script>/, "the bridge is a module: it runs before the shell boots (DOMContentLoaded)");
  assert.ok(!/\son[a-z]+="/i.test(html), "no inline event handlers");
  assert.ok(![...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].some((m) => !/\bsrc=/.test(m[1]) || m[2].trim()), "no inline script");
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\) \.c-app\{/);
  assert.match(css, /:root\[data-theme="dark"\] \.c-app\{/);
  assert.match(css, /\.c-offline \[data-act\]\{opacity:\.45; pointer-events:none;\}/);
  assert.match(css, /@media \(max-width:640px\)\{\s*\.c-tablewrap/, "tables become cards on a phone");
  assert.ok(!/innerHTML\s*=\s*[^;]*\+\s*(?:s|d|r|data)\.[a-z]+\s*[+;]/i.test(SHELL.replace(/esc\([^)]*\)/g, "")), "the shell draws server values only through esc()");
  const common = site("js/common2.js");
  assert.match(common, /if \(f\.type === "checkbox"\) \{/);
  assert.match(common, /v\[f\.name \|\| String\(i\)\] = f\.type === "checkbox" \? !!\(n && n\.checked\)/);
  assert.ok(!/\/api\/portal|DCR\.api/.test(SHELL.replace(/\/\*[\s\S]*?\*\//g, "")), "no old server: the four network points go through the bridge");
  assert.match(SHELL, /posted = await bridge\(\)\.request\(job\.method, job\.args\);/);
  assert.match(SHELL, /r = await bridge\(\)\.read\(id\);/);
  assert.match(SHELL, /c = await bridge\(\)\.cancel\(id\);/);
  assert.match(SHELL, /return bridge\(\)\.status\(\);/);
  assert.match(SHELL, /if \(TEST\) \{\s*api\._test = \{/, "the test hooks exist only under window.__DCR_CONSOLE_TEST__");
  const bridge = site("js/console/bridge.js");
  assert.ok(!/^\s*await\b/m.test(bridge.replace(/async[\s\S]*?\n\s{2}\},?\n/g, "")), "no top-level await: nothing delays the bridge past DOMContentLoaded");
  assert.match(bridge, /window\.DCRConsoleBridge = bridge;/);
});

test("the home page (Portal 2): the DCR Agents 2 card is an admin's only, in Admin, with the server's dot from the status line", async () => {
  const dash = site("js/shell/dashboard.js");
  assert.match(dash, /\{ href: "agents-console\.html", ic: "🛰️", tt: "DCR Agents 2", id: "hmAgentsConsole", show: role === "admin",/);
  assert.match(dash, /function agentsConsoleDot\(line\) \{[\s\S]*?\$\("hmAgentsConsole"\)[\s\S]*?"hm-dot " \+ line\.cls/);
  assert.match(dash, /try \{ line = serverLine\(await serverStatus\(\), new Date\(\)\); \} catch \(e\) \{ return; \}\s*agentsConsoleDot\(line\);/);
  assert.match(site("dashboard.html"), /\.hm-dot\.ok \{ background: #1f9d55; \}/);
});

test("inside another site's frame the console does not start: hidden before the first paint, a link to its own window", async () => {
  const h = await openConsole({ api: statusApi(onlineStatus()), modules: ["console-dashboard.js"], boot: false });
  h.ctx.top = { notThisWindow: true };
  await h.boot();
  await h.settle(1000);
  assert.equal(h.calls.length, 0, "nothing is asked of the database");
  assert.equal(h.$("cFramed").hidden, false);
  assert.match(h.$("cFramed").textContent, /does not open inside another page/);
  const a = h.$("cFramed").querySelector("a");
  assert.deepEqual([a.getAttribute("href"), a.getAttribute("target"), a.getAttribute("rel")], ["agents-console.html", "_blank", "noopener"]);
  assert.equal(h.$("cTabs").children.length, 0);
  const page = site("agents-console.html");
  assert.ok(page.indexOf('<script src="js/console/framed.js"></script>') !== -1 && page.indexOf("js/console/framed.js") < page.indexOf("<body>"), "before the first paint");
  assert.match(site("js/console/framed.js"), /if \(window\.top !== window\.self\) document\.documentElement\.className \+= " c-framed";/);
  assert.match(site("css/agents-console.css"), /html\.c-framed \.topbar, html\.c-framed \.c-app, html\.c-framed #cPrint, html\.c-framed \.c-toasts\{display:none !important;\}/);
  const own = await openConsole({ api: statusApi(onlineStatus()), modules: ["console-dashboard.js"] });
  assert.equal(own.$("cFramed").hidden, true, "its own window: as always");
});
