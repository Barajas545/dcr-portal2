// P6 (the DCR Agents 2 web console): site/js/map/console.js (pure: the database's answers and refusals -> the
// old relay's), site/js/repo/console.js over a stub client (migration M6's names and parameters) and over the
// DEMO database (tools/fake/p6.js, M6's rules: only the admin who asked reads a request - another admin's id
// and an unknown one are the same PT404 -, expired and lost worked out on read, 20 open, 60 a minute, take
// only by the agents account, the purge). Made-up data only; tools/schema-check.mjs runs the same modules
// against the real migration.
import test from "node:test";
import assert from "node:assert/strict";
import { available, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/console.js";
import { requestOf, consoleServer, httpError, isNetwork, NOT_SET_UP } from "../site/js/map/console.js";

const skip = !available && "the demo database (tools/fake) is not here";
const NOW = Date.parse("2026-10-21T17:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

test("requestOf: the id and the moment; consoleServer: ready, and consoleOn from the PC's own heartbeat when the status line did not lift it", () => {
  assert.deepEqual(requestOf({ id: "abc", at: iso(NOW) }), { id: "abc", at: iso(NOW) });
  assert.deepEqual(requestOf("abc"), { id: "abc", at: "" }, "a bare id");
  assert.deepEqual(requestOf(null), { id: "", at: "" });
  const m6 = { ready: true, server: { host: "PC#agents2", online: true, standby: false, consoleOn: true, consoleAt: iso(NOW - 30000) }, status: {}, others: [] };
  assert.deepEqual(consoleServer(m6).server, m6.server, "M6 says it itself");
  const m4 = { ready: false, server: { host: "PC#agents2", online: true, standby: false, consoleOn: false, consoleAt: "" },
    status: { consoleOn: true, consoleAt: iso(NOW - 30000), assistantAt: iso(NOW - 9000) }, lease: { host: "PC#agents2" }, others: [] };
  const s = consoleServer(m4);
  assert.deepEqual([s.ready, s.server.consoleOn, s.server.consoleAt, s.server.assistantAt], [true, true, iso(NOW - 30000), iso(NOW - 9000)]);
  assert.equal(m4.server.consoleOn, false, "the answer itself is not changed");
  assert.equal(consoleServer(Object.assign({}, m4, { server: Object.assign({}, m4.server, { standby: true }) })).server.consoleOn, false, "never in Standby");
  assert.equal(consoleServer({ server: null, status: null }).server, null);
  assert.equal(consoleServer(null), null);
});

test("httpError: the database's refusals become the old portal's error the shell maps (status, code word, retryAfter); a lost connection has no status", () => {
  const e = (code, message, hint, details) => httpError({ code, message, hint, details });
  assert.deepEqual([e("42501", "Only an Admin can manage DCR Agents 2.", "forbidden").status, e("42501", "x", "forbidden").data.code], [403, "forbidden"]);
  const rate = e("PT429", "That is a lot of actions in a short time.", "rate", JSON.stringify({ retryAfter: 17 }));
  assert.deepEqual([rate.status, rate.data.code, rate.data.retryAfter], [429, "rate", 17]);
  assert.equal(e("PT429", "You have 20 actions waiting.", "too_many").data.code, "too_many");
  assert.deepEqual([e("PT413", "Too much.", "too_big").status, e("PT413", "Too much.", "too_big").data.code], [413, "too_big"]);
  assert.deepEqual([e("PT404", "No such request.", "not_found").status, e("PT404", "No such request.").data.code], [404, "not_found"]);
  assert.deepEqual([e("22023", "method must be ...", "bad_request").status, e("22023", "x").data.code], [400, "bad_request"]);
  const missing = e("PGRST202", "Could not find the function public.console_request");
  assert.deepEqual([missing.status, missing.data.code, missing.message], [503, "not_set_up", NOT_SET_UP], "M6 not in the database yet");
  assert.equal(e("PT429", "x", "rate", "retry after 9 seconds").data.retryAfter, 9);
  const net = httpError(Object.assign(new TypeError("Failed to fetch"), { code: "" }));
  assert.equal(net.status, undefined, "no status: the shell says it cannot reach the database");
  assert.equal(isNetwork({ code: "NETWORK", message: "No answer from the database." }), true);
  assert.equal(isNetwork({ code: "42501", message: "network policy" }), false, "a database code is never the network");
});

test("repo/console: M6's calls by name and parameter", async () => {
  const calls = [];
  useClient({ rpc: async (name, args) => { calls.push([name, args]); return { data: { id: "x", at: "y", ok: true }, error: null }; } });
  await repo.request("agents.list", { all: true });
  await repo.request("dashboard.status");
  await repo.get("abc");
  await repo.cancel("abc");
  await repo.status();
  assert.deepEqual(calls, [
    ["console_request", { p_method: "agents.list", p_args: { all: true } }],
    ["console_request", { p_method: "dashboard.status", p_args: {} }],
    ["console_get", { p_id: "abc" }],
    ["console_cancel", { p_id: "abc" }],
    ["agents_server_status", undefined],
  ]);
  useClient({ rpc: async () => ({ data: null, error: { code: "PT429", message: "That is a lot of actions.", hint: "rate" } }) });
  await assert.rejects(repo.request("agents.list"), (e) => e.code === "PT429" && e.hint === "rate");
  useClient(null);
});

test("the demo database: only the admin who asked reads a request (another admin's id reads like an unknown one), nobody else may ask; cancel only while new", { skip }, async () => {
  const F = await loadFake();
  let now = NOW;
  const e = F.createEngine({ clock: () => new Date(now) });
  e.load(F.seed({ now: new Date(NOW) }));
  const admin = await person("admin");
  const otherId = "00000000-0000-4000-8000-0000000000aa";
  e.rows.profiles.push(Object.assign({}, e.rows.profiles.find((p) => p.id === admin.id), { id: otherId, full_name: "Second Admin", email: "admin2@demo.test" }));
  useClient(clientAs(e, admin.id));
  const r = await repo.request("agents.list", {});
  assert.match(r.id, /^[0-9a-f-]{36}$/);
  assert.equal(r.at, new Date(NOW).toISOString());
  const mine = await repo.get(r.id);
  assert.deepEqual(Object.keys(mine).sort(), ["at", "doneAt", "error", "host", "id", "method", "result", "status", "takenAt"], "the old ?id= answer");
  assert.equal(mine.status, "new");
  useClient(clientAs(e, otherId));
  await assert.rejects(repo.get(r.id), (x) => x.code === "PT404" && x.message === "No such request.", "another admin: the same as unknown");
  await assert.rejects(repo.get("not-an-id"), (x) => x.code === "PT404");
  await assert.rejects(repo.cancel(r.id), (x) => x.code === "PT404");
  for (const key of ["manager", "manager_prices", "accountant", "lead", "field", "viewer", "agents"]) {
    const p = await person(key);
    useClient(clientAs(e, p.id));
    await assert.rejects(repo.request("agents.list", {}), (x) => x.code === "42501", key + " may not ask");
    await assert.rejects(repo.get(r.id), (x) => x.code === "42501", key + " reads nothing");
  }
  useClient(clientAs(e, admin.id));
  assert.deepEqual(await repo.cancel(r.id), { ok: true, status: "cancelled" });
  assert.deepEqual(await repo.cancel(r.id), { ok: false, status: "cancelled" }, "only while new");
  assert.equal((await repo.get(r.id)).error.code, "cancelled");
  const r2 = await repo.request("dashboard.status", {});
  const q = e.p6.pc.step();
  assert.equal(q.method, "dashboard.status", "the DCR server takes the oldest new one");
  assert.deepEqual(await repo.cancel(r2.id), { ok: false, status: "done" }, "taken and answered: too late to cancel");
  const done = await repo.get(r2.id);
  assert.equal(done.status, "done");
  assert.equal(done.result.host, "DCR-OFFICE-PC#agents2", "the PC's data, out of its envelope");
  // expired and lost are worked out on read; the purge stores them, then deletes them 10 minutes after they finished
  const r3 = await repo.request("agents.list", {});
  now += 16 * 60000;
  assert.equal((await repo.get(r3.id)).status, "expired");
  assert.equal(e.rows.agents_console.find((x) => x.id === r3.id).status, "new", "a read never writes");
  e.p6.pc.step();
  assert.equal(e.rows.agents_console.find((x) => x.id === r3.id).status, "expired", "the purge stores it");
  now += 11 * 60000;
  e.p6.pc.step();
  await assert.rejects(repo.get(r3.id), (x) => x.code === "PT404", "deleted 10 minutes after it finished");
  const r4 = await repo.request("agents.list", {});
  const agents = await person("agents");
  e.rpc({ uid: agents.id }, "agents_console_take", { p_id: r4.id, p_timeout: 15 });
  now += 15000 + 121000;
  const lost = await repo.get(r4.id);
  assert.deepEqual([lost.status, lost.error.code], ["error", "lost"], "taken past its timeout + 2 minutes");
  useClient(null);
});

test("the demo database: 20 open per admin, 60 a minute (the wait in details), arguments at most 20,000 characters, a method name the PC could know", { skip }, async () => {
  const F = await loadFake();
  let now = NOW;
  const e = F.createEngine({ clock: () => new Date(now) });
  e.load(F.seed({ now: new Date(NOW) }));
  const admin = await person("admin");
  useClient(clientAs(e, admin.id));
  for (let i = 0; i < 20; i++) await repo.request("agents.list", { i });
  await assert.rejects(repo.request("agents.list", {}), (x) => x.code === "PT429" && x.hint === "too_many");
  const shellErr = httpError(await repo.request("agents.list", {}).catch((x) => x));
  assert.deepEqual([shellErr.status, shellErr.data.code], [429, "too_many"]);
  while (e.p6.pc.step()) { /* the server answers them all */ }
  for (let i = 0; i < 40; i++) { await repo.request("console.ping", {}); e.p6.pc.step(); }
  const rate = await repo.request("console.ping", {}).catch((x) => x);
  assert.equal(rate.code, "PT429");
  assert.equal(rate.hint, "rate");
  assert.ok(httpError(rate).data.retryAfter > 0 && httpError(rate).data.retryAfter <= 60, "how long to wait");
  now += 61000;
  await repo.request("console.ping", {});
  await assert.rejects(repo.request("console.ping", { blob: "x".repeat(20001) }), (x) => x.code === "PT413");
  await assert.rejects(repo.request("Not A Method", {}), (x) => x.code === "22023");
  await assert.rejects(repo.request("x", {}), (x) => x.code === "22023");
  useClient(null);
});

test("the demo database: the DCR server's side is the agents account's only — feed, take, done, error, purge refuse anyone else, an admin included", { skip }, async () => {
  const F = await loadFake();
  const e = F.createEngine({ clock: () => new Date(NOW) });
  e.load(F.seed({ now: new Date(NOW) }));
  const admin = await person("admin"), agents = await person("agents");
  const r = e.rpc({ uid: admin.id }, "console_request", { p_method: "agents.list", p_args: {} });
  for (const name of ["agents_console_feed", "agents_console_take", "agents_console_purge"]) {
    assert.throws(() => e.rpc({ uid: admin.id }, name, {}), (x) => x.code === "42501", name);
  }
  assert.throws(() => e.rpc({ uid: admin.id }, "agents_console_done", { p_id: r.id, p_result: {} }), (x) => x.code === "42501");
  assert.equal(e.rpc({ uid: agents.id }, "agents_console_feed", {}).requests[0].id, r.id);
  const t = e.rpc({ uid: agents.id }, "agents_console_take", { p_id: r.id, p_timeout: 15 });
  assert.equal(t.request.id, r.id);
  assert.equal(e.rpc({ uid: agents.id }, "agents_console_take", { p_id: r.id }).again, true, "the same host asking again is answered again");
  assert.deepEqual(e.rpc({ uid: agents.id }, "agents_console_take", {}), { ok: true, request: null }, "nothing else waits");
  e.rpc({ uid: agents.id }, "agents_console_error", { p_id: r.id, p_error: { code: "refused", message: "Not now." } });
  assert.deepEqual(e.rpc({ uid: admin.id }, "console_get", { p_id: r.id }).error, { code: "refused", message: "Not now." });
  assert.throws(() => e.rpc({ uid: agents.id }, "agents_console_done", { p_id: r.id, p_result: {} }), (x) => x.code === "PT409", "finished: not theirs any more");
});
