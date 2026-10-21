// P6 pages: the DCR Agents 2 console (agents-console.html: the old portal's console, its eight tab modules
// unchanged, the shell's four network points through js/console/bridge.js), My Assistant (my-assistant.html)
// and the office's Assistants page (assistant-admin.html); the home page's cards; what the service worker
// keeps ahead. The tab modules themselves are run by tests/console/*.test.mjs (the old portal's page tests,
// pointed at these files).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const site = (p) => readFileSync(new URL("../site/" + p, import.meta.url), "utf8");
const OLD = "C:/DCR/DCR Internal Website/dcr-portal/";
const MODULES = ["console-dashboard.js", "console-agents.js", "console-work.js", "console-photo.js", "console-assistants.js",
  "console-training.js", "console-people.js", "console-settings.js"];
const lf = (s) => s.replace(/\r\n/g, "\n");

test("the console's eight tab modules are the old portal's, byte for byte (BLUEPRINT 3.3.10: they port unchanged)",
  { skip: !existsSync(OLD + "console-agents.js") && "the old portal's source is not on this computer" }, () => {
    for (const m of MODULES) assert.equal(lf(site("js/console/" + m)), lf(readFileSync(OLD + m, "utf8")), m);
    for (const c of ["agents-console.css", "console-print.css"]) assert.equal(lf(site("css/" + c)), lf(readFileSync(OLD + c, "utf8")), c);
  });

test("the console's shell differs from the old agents-console.js only at its network points and its words", () => {
  const shell = site("js/console/shell.js");
  const code = shell.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/DCR\.api|\/api\/portal|\bEP\b/.test(code), "no old server");
  assert.equal((code.match(/bridge\(\)\./g) || []).length, 4, "status, request, read, cancel");
  assert.match(code, /var ADMIN_ONLY = "Only an Admin can manage DCR Agents 2\.";/);
  assert.match(code, /String\(profile\.role\)\.toLowerCase\(\) !== "admin"/, "Portal 2's role names");
  if (existsSync(OLD + "agents-console.js")) {
    const old = lf(readFileSync(OLD + "agents-console.js", "utf8"));
    const keep = ["function relayRpc(method, args, opts) {", "async function runJob(job) {", "function act(method, args, opts) {",
      "function applyGates() {", "function table(o) {", "function form(spec) {", "function print(html, o) {", "function parseHash(h) {",
      "function register(def) {"];
    for (const k of keep) {
      const body = (s) => { const i = s.indexOf(k); return i < 0 ? "" : s.slice(i, s.indexOf("\n  }\n", i)); };
      if (k === "async function runJob(job) {") {
        assert.equal(body(lf(shell)).replace("posted = await bridge().request(job.method, job.args);", "X").replace("The database did not take", "The portal did not take"),
          body(old).replace(`posted = await DCR.api(EP, { method: "POST", body: { method: job.method, args: job.args } });`, "X"), k);
      } else assert.equal(body(lf(shell)), body(old), k + " is the old one");
    }
  }
});

test("the console page: admin only by the shell's gate and the database's; the bridge is a module, no top-level await, the old DCR helpers from Portal 2's own", () => {
  const bridge = site("js/console/bridge.js");
  assert.match(bridge, /import \{ h, modal, confirm, alert, requireAuth, topbar \} from "\.\.\/common2\.js";/);
  assert.match(bridge, /window\.DCR = \{\s*esc: h,/);
  assert.match(bridge, /return \{ id: p\.id, displayName: p\.name, email: p\.email, role: p\.role \};/);
  assert.match(bridge, /read\(id\) \{ return call\(\(\) => repo\.get\(id\)\); \}/, "expired / lost worked out by the database (console_get)");
  assert.match(bridge, /repo\.watchMine\(me\.id,/, "Realtime on this admin's own rows");
  const repo = site("js/repo/console.js");
  assert.match(repo, /c\.rpc\("console_request", \{ p_method: String\(method \|\| ""\), p_args:/);
  assert.match(repo, /c\.rpc\("console_get", \{ p_id:/);
  assert.match(repo, /c\.rpc\("console_cancel", \{ p_id:/);
  assert.match(repo, /live\.watch\("agents_console", uid \? "admin_id=eq\." \+ uid : "", cb, \{ lost: true \}\)/);
  // a channel that drops is not live any more: the shell polls at its own pace (review fix)
  assert.match(bridge, /if \(evt\.type === "LOST"\) \{ joined = false; wake\(null\); return; \}/);
});

test("My Assistant: the old page's drawing and words, Portal 2's data; drafts and language per profile (dcr2:), every refusal in the database's words", () => {
  const js = site("js/pages/my-assistant.js");
  const code = js.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/DCR\.(api|esc|modal|confirm|getToken|requireAuth)|\/api\/portal/.test(code), "nothing of the old common.js");
  assert.match(code, /var DRAFT_KEY = "dcr2:myAssistant\.draft\.v1";/);
  assert.match(code, /var LANG_KEY = "dcr2:myAssistant\.lang\.v1";/);
  assert.match(code, /function account\(\) \{ return S\.me \? String\(S\.me\.id \|\| ""\) : ""; \}/);
  assert.match(code, /var esc = function \(v\) \{ return h\(v\); \};/);
  // the old GET and POST, one call each (M6 answers the old JSON)
  assert.match(code, /var d = await repo\.page\(\{ agenda: true \}\);/, "GET ?action=assistant&agenda=1");
  assert.match(code, /var r = await repo\.page\(\{ rev: S\.data\.rev \}\);/, "GET &rev=");
  assert.match(code, /if \(body\.op === "say"\) return repo\.say\(b\.text, b\.clientId\);\s*return repo\.op\(body\.op, b\);/, "POST {op}");
  for (const op of ["item.add", "item.update", "item.complete", "item.delete", "memory.add", "memory.delete", "prefs.set", "read"]) {
    assert.ok(code.includes('op: "' + op + '"'), op + " is sent as the old page sent it");
  }
  assert.match(code, /repo\.watchMine\(S\.me\.id,/, "Realtime on the person's own rows");
  assert.match(code, /S\.live \? LIVE_MS :/, "the poll is only the fallback while Realtime is joined");
  assert.match(code, /mountSwitch\("pushSlot"\)/, "Portal 2's phone reminders switch");
  assert.ok(!/innerHTML\s*=\s*[^;]*\+\s*(?:e|err)\.message/.test(code), "a refusal is never drawn unescaped");
  const html = site("my-assistant.html");
  assert.match(html, /<script type="module" src="js\/pages\/my-assistant\.js"><\/script>/);
  for (const id of ["maTitle", "maSub", "maBanner", "maTabs", "maToday", "maTomorrow", "maWeek", "maChat", "maSuggest", "maForm", "maText", "maSend",
    "maStatus", "maItems", "maMe", "pushSlot", "maPrivacy", "maPushLink"]) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /maxlength="1500"/, "the chat box's limit is the database's");
});

test("Assistants (the office's page): admins only; the chat is read only and only with office reads on; the office's own items only", () => {
  const js = site("js/pages/assistant-admin.js");
  assert.match(js, /await requireAuth\(\{ roles: \["admin"\] \}\)/);
  assert.match(js, /repo\.officeView\(id\)/, "the database answers the chat only while the office may read it");
  assert.match(js, /if \(v\.chatHidden \|\| !v\.officeReads\) \{/);
  assert.match(js, /The office does not read /);
  assert.match(js, /office\.map\(\(i\) => itemLi\(i, !i\.done\)\)/, "only the office's own open items have Edit / Delete");
  assert.ok(!/innerHTML\s*=\s*[^;"']*\+/.test(js), "drawn with el(), never by string");
});

test("the home page: My Assistant for everyone (with its badge), DCR Agents 2 and Assistants for an admin only", () => {
  const dash = site("js/shell/dashboard.js");
  assert.match(dash, /\{ href: "my-assistant\.html", ic: "🤖", tt: "My Assistant", id: "hmMyAssistant",\s*ds: "Your day, reminders and a chat with your DCR assistant\." \},/);
  assert.match(dash, /\{ href: "agents-console\.html", ic: "🛰️", tt: "DCR Agents 2", id: "hmAgentsConsole", show: role === "admin",/);
  assert.match(dash, /\{ href: "assistant-admin\.html", ic: "🤖", tt: "Assistants", show: role === "admin",/);
  const adminSection = dash.slice(dash.indexOf('if (role === "admin" || role === "manager") {'), dash.indexOf("return sections.map"));
  assert.ok(adminSection.includes("agents-console.html") && adminSection.includes("assistant-admin.html"), "in the Admin section");
});

test("the service worker keeps My Assistant ahead (a phone page), not the admins' console (600 KB of scripts) nor Assistants", () => {
  const sw = site("sw.js");
  const shell = JSON.parse("[" + /const SHELL = \[([\s\S]*?)\];/.exec(sw)[1].replace(/\/\/[^\n]*/g, "").replace(/,\s*$/, "") + "]");
  for (const f of ["my-assistant.html", "js/pages/my-assistant.js", "js/repo/assistant.js", "js/map/assistant.js"]) assert.ok(shell.includes(f), f);
  for (const f of ["agents-console.html", "assistant-admin.html", "js/console/shell.js", "css/agents-console.css"]) assert.ok(!shell.includes(f), f);
  assert.match(sw, /const CACHE = "dcr-portal2-v3";/);
});

test("Guided Assist is not built (Q21 default: dropped)", () => {
  for (const f of ["agents-console.html", "my-assistant.html", "assistant-admin.html", "dashboard.html"]) {
    assert.ok(!/assist\.html|assist-admin|Guided Assist/i.test(site(f)), f);
  }
  assert.ok(!existsSync(new URL("../site/assist.html", import.meta.url)));
  assert.ok(!/assist_sessions|dcr-assist-/.test(site("js/repo/assistant.js") + site("js/repo/console.js")));
});
