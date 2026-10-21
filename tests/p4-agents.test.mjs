// P4 (DCR Agents 2's PC on the home page): the pure line site/js/map/agents.js serverLine() draws from
// rpc agents_server_status (migration M4 20261023000100_agents_core); repo/agents.js over the DEMO database
// (tools/fake: an admin's only, the database's shape and online rule) and over a stub client; the home page
// draws the line for an admin only; the service worker keeps the two new files. Made-up data only
// (tools/schema-check.mjs runs the same modules against the real migrations).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, person, clientAs, loadFake } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as agents from "../site/js/repo/agents.js";
import { serverLine, agoText, minutesSince } from "../site/js/map/agents.js";

const skip = !available && "the demo database (tools/fake) is not here";
const read = (p) => readFileSync(new URL("../site/" + p, import.meta.url), "utf8");
const NOW = new Date("2026-10-20T18:00:00Z");
const server = (extra) => Object.assign({ host: "OFFICE-PC#agents2", version: "2.0.0", proto: 1, lastSeen: "2026-10-20T17:57:00.000Z",
  minutesAgo: 3, online: true, standby: false, paused: false, lastError: "" }, extra || {});

test("serverLine: 'DCR Agents 2 PC - last seen N min ago', green while online, amber once quiet, grey when no PC has reported", () => {
  assert.deepEqual(serverLine({ server: server() }, NOW),
    { text: "DCR Agents 2 PC - last seen 3 min ago", cls: "ok", title: "OFFICE-PC#agents2 · DCR Agents 2.0.0" });
  assert.deepEqual(serverLine({ server: server({ minutesAgo: 0 }) }, NOW).text, "DCR Agents 2 PC - last seen just now");
  assert.deepEqual(serverLine({ server: server({ minutesAgo: 14, online: false }) }, NOW).cls, "warn", "quiet: amber");
  assert.equal(serverLine({ server: server({ minutesAgo: 135, online: false }) }, NOW).text, "DCR Agents 2 PC - last seen 2 h ago");
  assert.equal(serverLine({ server: server({ minutesAgo: 4 * 1440 + 5, online: false }) }, NOW).text, "DCR Agents 2 PC - last seen 4 days ago");
  assert.deepEqual(serverLine({ server: null, lease: null, others: [] }, NOW),
    { text: "DCR Agents 2 PC - not seen yet", cls: "off", title: "No computer running DCR Agents 2 has reported yet." });
  assert.equal(serverLine({ server: server({ standby: true, paused: true }) }, NOW).text, "DCR Agents 2 PC - last seen 3 min ago (in Standby, paused)");
  assert.equal(serverLine({ server: server({ lastError: "Outlook: the mailbox is not open" }) }, NOW).title,
    "OFFICE-PC#agents2 · DCR Agents 2.0.0 · last error: Outlook: the mailbox is not open");
  assert.equal(serverLine({ server: server({ minutesAgo: null }) }, NOW).text, "DCR Agents 2 PC - last seen 3 min ago", "from lastSeen when no count");
  assert.equal(serverLine({ server: server({ minutesAgo: null, lastSeen: "" }) }, NOW).cls, "off");
  for (const nothing of [null, undefined, "x", [], 5]) assert.equal(serverLine(nothing, NOW), null, String(nothing));
  assert.equal(agoText(59), "59 min ago");
  assert.equal(agoText(60), "1 h ago");
  assert.equal(agoText(null), "");
  assert.equal(minutesSince("2026-10-20T17:50:30Z", NOW), 10, "rounded, as the database counts");
  assert.equal(minutesSince("2026-10-20T18:05:00Z", NOW), 0, "a clock ahead never goes negative");
  assert.equal(minutesSince("soon", NOW), null);
});

test("serverStatus() asks rpc agents_server_status with no arguments; the database's refusal comes back as an error with its code", async () => {
  const calls = [];
  useClient({ rpc: async (name, args) => { calls.push([name, args]); return { data: { ready: false, server: null }, error: null }; } });
  assert.deepEqual(await agents.serverStatus(), { ready: false, server: null });
  assert.deepEqual(calls, [["agents_server_status", undefined]]);
  useClient({ rpc: async () => ({ data: null, error: { code: "42501", message: "Only an admin can read the DCR Agents 2 status.", hint: "forbidden" } }) });
  await assert.rejects(agents.serverStatus(), (e) => e.code === "42501" && e.hint === "forbidden");
  useClient(null);
});

test("the demo database: an admin reads the made-up PC (seen two minutes ago, online, the lease holder); anyone else is refused 42501, the agents account too", { skip }, async () => {
  const F0 = await loadFake();
  const e = F0.createEngine({ clock: () => NOW });
  e.load(F0.seed({ now: NOW }));
  const admin = await person("admin");
  useClient(clientAs(e, admin.id));
  const s = await agents.serverStatus();
  assert.deepEqual(Object.keys(s).sort(), ["generatedAt", "lease", "minutesAgo", "others", "ready", "server", "status"], "the database's keys");
  // M6: ready (the console relay is in the database) and consoleOn from the PC's own heartbeat
  assert.deepEqual([s.ready, s.server.host, s.server.minutesAgo, s.server.online, s.lease.host, s.server.consoleOn],
    [true, "DCR-OFFICE-PC#agents2", 2, true, "DCR-OFFICE-PC#agents2", true]);
  assert.deepEqual(serverLine(s, NOW), { text: "DCR Agents 2 PC - last seen 2 min ago", cls: "ok", title: "DCR-OFFICE-PC#agents2 · DCR Agents 2.1.0" });
  for (const key of ["manager", "manager_prices", "accountant", "lead", "field", "viewer", "agents", "inactive"]) {
    const p = await person(key);
    useClient(clientAs(e, p.id));
    await assert.rejects(agents.serverStatus(), (x) => x.code === "42501", key);
  }
  // no PC yet, and a quiet one
  const F = await loadFake();
  const empty = F.createEngine({ clock: () => NOW });
  const data = F.seed({ now: NOW });
  delete data.agents_server;
  empty.load(data);
  useClient(clientAs(empty, admin.id));
  assert.equal(serverLine(await agents.serverStatus(), NOW).text, "DCR Agents 2 PC - not seen yet");
  const later = F.createEngine({ clock: () => new Date(NOW.getTime() + 20 * 60000) });
  later.load(F.seed({ now: NOW }));
  useClient(clientAs(later, admin.id));
  assert.deepEqual(serverLine(await agents.serverStatus(), NOW).cls, "warn", "22 minutes: quiet");
  useClient(null);
});

test("the home page: the line is an admin's only, drawn in its own slot after the cards; the service worker keeps the two new files", () => {
  const dash = read("js/shell/dashboard.js");
  assert.ok(/if \(p\.role === "admin"\) agentsLine\(\);/.test(dash), "admins only");
  assert.ok(dash.includes('import { serverStatus } from "../repo/agents.js";') && dash.includes('import { serverLine } from "../map/agents.js";'));
  assert.ok(/catch \(e\) \{ return; \}/.test(dash.split("async function agentsLine")[1]), "a failure leaves the line hidden");
  const html = read("dashboard.html");
  assert.ok(html.includes('<div id="hmAgents" hidden></div>'), "the slot, hidden until there is a line");
  assert.ok(/\.hm-agents\.ok \.dot/.test(html) && /\.hm-agents\.warn \.dot/.test(html), "the dot's colours");
  const sw = read("sw.js");
  assert.ok(sw.includes('"js/repo/agents.js"') && sw.includes('"js/map/agents.js"'));
  const body = dash.split("async function agentsLine")[1].split("function notes")[0];
  assert.deepEqual(body.match(/innerHTML[^;]*;/g), ['innerHTML = "";'], "the slot is only emptied: the line is text, never HTML");
  assert.ok(body.includes("el(\"span\", { text: line.text })"), "drawn as text");
});
