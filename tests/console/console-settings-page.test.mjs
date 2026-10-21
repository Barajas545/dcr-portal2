/* The DCR Agents console's Settings tab (site/js/console/console-settings.js)
   against a settings.get answer in the shape settings_model.read_all builds
   (console-spec §6.1.12), with an <img onerror> in every string: only the
   remote fields are drawn, a secret is only ever set / not set / unreadable,
   a section saves only what changed with its rev, the server's refusals are
   shown in its words, and the tests are health checks with the saved key. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { openConsole, onlineStatus, statusApi, scan, EVIL, esc, plain } from "./console-page-dom.mjs";

const METHODS = ["settings.get", "settings.save", "settings.test", "settings.test_claude", "assistants.tell_pages"];

function settings() {
  return {
    sections: {
      general: { rev: "2b1faa833fe6c894", values: { "general.company_name": EVIL, "general.timesheet_link": "https://x.test/t", "general.quiet_hours": ["20:00", "07:00"],
        "general.digest_time": "07:30", "general.min_gap_minutes": 30, "general.keep_awake": true },
        fields: [{ key: "general.company_name", label: `Company ${EVIL}`, type: "text", max: 120 }, { key: "general.timesheet_link", label: "Timesheet link", type: "link", max: 300 },
          { key: "general.quiet_hours", label: "Quiet hours", type: "quiet" }, { key: "general.digest_time", label: "Daily digest at", type: "hhmm" },
          { key: "general.min_gap_minutes", label: "Never twice within", type: "int", lo: 0, hi: 1440 },
          { key: "general.keep_awake", label: "Keep this PC awake", type: "bool", help: EVIL }] },
      email: { rev: "b4f25bdacee572c1", values: { "email.backend": "none", "email.from_name": "DCR Framing" },
        fields: [{ key: "email.backend", label: "Send email", type: "backend", choices: [{ key: "portal", label: "Through the portal" }, { key: "none", label: `No email ${EVIL}` }] },
          { key: "email.from_name", label: "From name", type: "text", max: 120 }] },
      claude: { rev: "80e0a103fe2adfda", values: { "llm.enabled": false, "photo.model": "claude-opus-5-5" },
        fields: [{ key: "llm.enabled", label: "Also use Claude", type: "bool" }, { key: "photo.model", label: "Model", type: "enum", choices: [{ key: "claude-opus-5-5", label: "Claude Opus 5.5 (recommended)" }] }] },
      photo: { rev: "74e82975ba2baced", values: { "photo.shoot_days": [0, 1, 2, 3, 4, 5], "photo.cc": [{ name: EVIL, email: "ana@dcr.test" }], "photo.cc_kinds": ["heads_up", "followups"],
        "photo.photographer": "" },
        fields: [{ key: "photo.photographer", label: "Photographer", type: "person", help: "empty = the portal's best guess" }, { key: "photo.shoot_days", label: "Shoot days", type: "days" },
          { key: "photo.cc", label: "Also send copies to", type: "cc" }, { key: "photo.cc_kinds", label: "Copies go with", type: "cc_kinds" }] },
      assistant: { rev: "03b61ecb0d048d2b", values: { "assistant.office_reads": true, "assistant.evening_at": "18:00" },
        fields: [{ key: "assistant.office_reads", label: "The office can read the conversations", type: "bool" }, { key: "assistant.evening_at", label: "Evening briefing at", type: "briefing" }] },
      training: { rev: "2b38217732e5a4db", values: { "training.smart_wording": true }, fields: [{ key: "training.smart_wording", label: "Smart wording", type: "bool" }] },
    },
    secrets: { "portal.password_enc": "set", "twilio.auth_token_enc": "not set", "email.smtp.password_enc": "unreadable", "email.graph.client_secret_enc": "not set",
      "llm.api_key_enc": "not set" },
    claude_words: [`No key yet ${EVIL}`, "dim"],
    readonly: { portal_url: `https://portal${EVIL}`, portal_site: "https://site.test", portal_email: "agents@dcr.test", twilio: "not set up", email_smtp_host: "smtp.office365.com",
      email_graph_sender: "" },
    missing_setup: [`Twilio ${EVIL}`], server_note: "Change it on the DCR server computer.",
  };
}

async function open(answers, extra = {}) {
  const calls = [];
  const fn = async (method, args) => {
    calls.push(plain({ method, args }));
    const a = answers[method];
    if (a === undefined) throw Object.assign(new Error(`no stub for ${method}`), { code: "failed" });
    const v = typeof a === "function" ? a(plain(args)) : a;
    if (v instanceof Error) throw v;
    return JSON.parse(JSON.stringify(v));
  };
  const h = await openConsole({ modules: ["console-settings.js"], api: statusApi(onlineStatus()), rpc: fn, methods: METHODS, hash: "#/settings", ...extra });
  await h.settle(10);
  return { h, calls, of: (m) => calls.filter((c) => c.method === m) };
}
const saveBtn = (h, s) => h.view().querySelector(`[data-do="save"][data-section="${s}"]`);

test("the settings page draws the server's remote fields escaped; secrets only as set / not set / unreadable; the server-only settings read-only", async () => {
  const { h } = await open({ "settings.get": settings() });
  const v = h.view();
  assert.deepEqual(scan(v), []);
  assert.ok(h.html().includes(esc(EVIL)));
  assert.deepEqual(v.querySelectorAll(".cs-sec h3").map((x) => x.textContent), ["General", "Email", "Claude", "Photo & Video", "Personal assistants", "Training"]);
  assert.equal(h.$("cs-general-general_company_name").value, EVIL);
  assert.equal(h.$("cs-general-general_quiet_hours-0").value, "20:00");
  assert.equal(h.$("cs-email-email_backend").value, "none");
  assert.equal(h.$("cs-photo-photo_shoot_days-5").checked, true);
  assert.equal(h.$("cs-photo-photo_shoot_days-6").checked, false);
  assert.equal(h.$("cs-photo-photo_cc-n0").value, EVIL);
  assert.equal(h.$("cs-photo-photo_cc_kinds-2").checked, false, "the evening-before group, not picked");
  const secrets = h.$("cs-secrets");
  assert.match(secrets.textContent, /The portal password \(the DCR Agents account\)set/);
  assert.match(secrets.textContent, /The SMTP passwordunreadable this computer cannot read it/);
  assert.match(secrets.textContent, /Change it on the DCR server computer\. They are never shown or changed on the web\./);
  assert.equal(secrets.querySelectorAll("input").length, 0, "no field to type a secret into");
  assert.ok(!/password_enc|_enc"/.test(h.html().replace(/data-[a-z-]+="[^"]*"/g, "")), "no secret key name or value in the page");
  assert.match(h.$("cs-readonly").textContent, /Portal addresshttps:\/\/portal<img src=x onerror=alert\(1\)>/);
  assert.equal(h.$("cs-readonly").querySelectorAll("input").length, 0);
  assert.match(v.querySelector(".c-banner").textContent, /^Still to set up on the DCR server: Twilio <img/);
  assert.match(h.$("cs-sec-claude").textContent, /No key yet <img/);
});

test("a section saves only what changed, with its rev; nothing changed is said without asking the server", async () => {
  const { h, of } = await open({ "settings.get": settings(), "settings.save": (a) => ({ rev: "ffff000011112222", words: "Saved.", effects: [] }) });
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.equal(of("settings.save").length, 0);
  assert.equal(h.$("cs-msg-general").textContent, "Nothing changed.");
  await h.change("cs-general-general_company_name", "DCR Framing");
  await h.change("cs-general-general_min_gap_minutes", "45");
  await h.change("cs-general-general_quiet_hours-0", "21:00");
  await h.change("cs-general-general_keep_awake", false);
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.deepEqual(of("settings.save").map((c) => c.args), [{ section: "general", rev: "2b1faa833fe6c894",
    values: { "general.company_name": "DCR Framing", "general.quiet_hours": ["21:00", "07:00"], "general.min_gap_minutes": 45, "general.keep_awake": false } }]);
  assert.equal(h.$("cs-msg-general").textContent, "Saved.");
  await h.change("cs-general-general_digest_time", "08:00");
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.deepEqual(of("settings.save")[1].args, { section: "general", rev: "ffff000011112222", values: { "general.digest_time": "08:00" } },
    "the new rev, and only the newly changed key");
});

test("the server's refusal is shown in its words; a stale rev says someone changed it and keeps what was typed", async () => {
  let answer = Object.assign(new Error(`Timesheet link must start with https://. Nothing was saved. ${EVIL}`), { code: "refused" });
  const { h } = await open({ "settings.get": settings(), "settings.save": () => answer });
  await h.change("cs-general-general_timesheet_link", "ftp://x");
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.equal(h.$("cs-msg-general").textContent, `Timesheet link must start with https://. Nothing was saved. ${EVIL}`);
  assert.equal(h.$("cs-msg-general").className, "cs-msg bad");
  assert.deepEqual(scan(h.view()), []);
  answer = Object.assign(new Error("Someone changed this since you opened it — reload and try again."), { code: "changed" });
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.match(h.$("cs-msg-general").textContent, /^Someone changed this since you opened it — reload and try again\. Your changes are still here/);
  assert.equal(h.$("cs-general-general_timesheet_link").value, "ftp://x");
});

test("turning office_reads off offers to tell the employees' pages (assistants.tell_pages, the server's question)", async () => {
  const { h, of } = await open({
    "settings.get": settings(),
    "settings.save": { rev: "aaaa000011112222", words: "Saved.", effects: ["offer_tell_pages"] },
    "assistants.tell_pages": (a) => (a.confirmed ? { words: "Told 3 pages." } : { confirm: { title: "Tell the pages", question: "Tell the employees' pages?", ok_text: "Tell them", danger: false, twice: null, extra: [] } }),
  }, { answers: [true] });
  await h.change("cs-assistant-assistant_office_reads", false);
  await h.click(saveBtn(h, "assistant"));
  await h.settle(10);
  assert.deepEqual(of("assistants.tell_pages").map((c) => c.args), [{ reads: false }, { reads: false, confirmed: true }]);
  assert.ok(h.toasts().some((t) => t.text === "Told 3 pages."));
});

test("copies: add and remove people; the list, the groups and the shoot days are saved as the server takes them", async () => {
  const { h, of } = await open({ "settings.get": settings(), "settings.save": { rev: "r2", words: "Saved.", effects: [] } });
  await h.click(h.view().querySelector('[data-do="ccadd"]'));
  await h.change("cs-photo-photo_cc-n1", "Sam Sample");
  await h.change("cs-photo-photo_cc-e1", "sam@dcr.test");
  await h.click(h.view().querySelector('[data-do="ccdel"][data-i="0"]'));
  assert.equal(h.$("cs-photo-photo_cc-n0").value, "Sam Sample", "the rows close up");
  await h.change("cs-photo-photo_cc_kinds-3", true);
  await h.change("cs-photo-photo_shoot_days-6", true);
  await h.click(saveBtn(h, "photo"));
  await h.settle(10);
  assert.deepEqual(of("settings.save")[0].args, { section: "photo", rev: "74e82975ba2baced", values: {
    "photo.shoot_days": [0, 1, 2, 3, 4, 5, 6], "photo.cc": [{ name: "Sam Sample", email: "sam@dcr.test" }], "photo.cc_kinds": ["heads_up", "followups", "agenda"] } });
});

test("the tests are health checks and the Claude test uses the saved key: OK / PROBLEM in the server's words", async () => {
  const { h, of } = await open({ "settings.get": settings(), "settings.test": (a) => ({ ok: a.what !== "email", detail: `${a.what} ${EVIL}` }),
    "settings.test_claude": { ok: false, words: "No key saved on this PC." } });
  await h.click(h.view().querySelector('[data-do="test"][data-what="email"]'));
  await h.settle(10);
  assert.equal(h.$("cs-msg-email").textContent, `PROBLEM — email ${EVIL}`);
  await h.click(h.view().querySelector('[data-do="test"][data-what="portal"]'));
  await h.settle(10);
  assert.equal(h.$("cs-msg-general").textContent, `OK — portal ${EVIL}`);
  await h.click(h.view().querySelector('[data-do="claude"]'));
  await h.settle(10);
  assert.equal(h.$("cs-msg-claude").textContent, "PROBLEM — No key saved on this PC.");
  assert.deepEqual(of("settings.test_claude").map((c) => c.args), [{}], "no key is ever sent from the web");
  assert.deepEqual(scan(h.view()), []);
});

test("unsaved settings ask before leaving the tab", async () => {
  const { h } = await open({ "settings.get": settings() }, { answers: [false] });
  await h.change("cs-email-email_from_name", "Other");
  await h.go("dashboard");
  await h.settle(10);
  assert.equal(h.dialogs[0].opts.message, "Leave without saving your settings?");
  assert.equal(h.ctx.location.hash, "#/settings");
});

/* ── review fixes ──────────────────────────────────────────────────────── */

test("a setting two sections share is shown once (the planner's model with Photo & Video), and a save refreshes the other sections' change checks", async () => {
  const first = settings();
  first.sections.photo.fields.push({ key: "photo.model", label: "Model", type: "enum", choices: [{ key: "claude-opus-5-5", label: "Claude Opus 5.5" }] });
  first.sections.photo.values["photo.model"] = "claude-opus-5-5";
  let reads = 0;
  const saves = [];
  const { h, of } = await open({
    "settings.get": () => {
      reads++;
      const d = JSON.parse(JSON.stringify(first));
      if (reads > 1) { d.sections.photo.rev = "1111222233334444"; d.sections.claude.rev = "5555666677778888"; }
      return d;
    },
    "settings.save": (a) => { saves.push(a); return { rev: "9999aaaabbbbcccc", words: "Saved.", effects: [] }; },
  });
  assert.equal(h.$("cs-claude-photo_model"), null, "not under Claude as well");
  assert.ok(h.$("cs-photo-photo_model"));
  assert.match(h.$("cs-sec-claude").textContent, /The Photo & Video planner's model is in the Photo & Video section\./);
  await h.change("cs-general-general_company_name", "Fake Framing");
  await h.click(saveBtn(h, "general"));
  await h.settle(10);
  assert.equal(of("settings.get").length, 2, "read again after the save");
  await h.change("cs-photo-photo_photographer", "Ana Testa");
  await h.click(saveBtn(h, "photo"));
  await h.settle(10);
  assert.equal(saves[1].rev, "1111222233334444", "the photo section's fresh change check, not the one from before the general save");
  await h.change("cs-claude-llm_enabled", true);
  await h.click(saveBtn(h, "claude"));
  await h.settle(10);
  assert.deepEqual(Object.keys(saves[2].values), ["llm.enabled"], "the hidden copy is never sent");
});

/* ── WhatsApp on the DCR server computer ──────────────────────────────── */

function withWa(mode = "Wait for a person to press Send (safe — recommended)") {
  const d = settings();
  const sections = {};
  for (const k of Object.keys(d.sections)) {
    sections[k] = d.sections[k];
    if (k === "email") {
      sections.wadesktop = { rev: "aaaabbbbccccdddd", values: { "wadesktop.enabled": true, "wadesktop.auto_per_hour": 20, "wadesktop.fallback_minutes": 0 },
        fields: [{ key: "wadesktop.enabled", label: `Use WhatsApp on the DCR server computer as a channel ${EVIL}`, type: "bool" },
          { key: "wadesktop.auto_per_hour", label: "Send automatically: at most (messages an hour)", type: "int", lo: 1, hi: 60 },
          { key: "wadesktop.fallback_minutes", label: "If nobody sends it within (minutes) send it the next way instead (0 = off)", type: "int", lo: 0, hi: 720 }] };
    }
  }
  d.sections = sections;
  d.readonly.wadesktop_mode = mode;
  return d;
}

test("WhatsApp on the DCR server computer: its section after Email, the mode shown read-only, the rest saved like any section", async () => {
  const { h, of } = await open({ "settings.get": withWa(), "settings.save": { rev: "1234123412341234", words: "Saved.", effects: ["rebuild_channels"] } },
    { methods: METHODS.concat(["wadesktop.test"]) });
  const v = h.view();
  assert.deepEqual(scan(v), []);
  assert.deepEqual(v.querySelectorAll(".cs-sec h3").map((x) => x.textContent).slice(0, 3), ["General", "Email", "WhatsApp on the DCR server computer"]);
  const mode = h.$("cs-wa-mode");
  assert.match(mode.textContent, /How messages goWait for a person to press Send \(safe — recommended\)/);
  assert.match(mode.textContent, /Changed only at the DCR server computer: sending automatically can get the company's number restricted or banned/);
  assert.equal(h.$("cs-sec-wadesktop").querySelectorAll("select").length, 0, "no way to switch the mode from here");
  assert.match(h.$("cs-readonly").textContent, /WhatsApp on the DCR server computer: how messages goWait for a person/);
  await h.change("cs-wadesktop-wadesktop_auto_per_hour", "10");
  await h.click(saveBtn(h, "wadesktop"));
  await h.settle(10);
  assert.deepEqual(of("settings.save").map((c) => c.args), [{ section: "wadesktop", rev: "aaaabbbbccccdddd", values: { "wadesktop.auto_per_hour": 10 } }]);
  assert.equal(h.$("cs-msg-wadesktop").textContent, "Saved.");
  const auto = await open({ "settings.get": withWa("Send automatically — WhatsApp may restrict or ban the number") }, { methods: METHODS.concat(["wadesktop.test"]) });
  assert.match(auto.h.$("cs-wa-mode").innerHTML, /c-chip warn">Send automatically/);
});

test("Test WhatsApp on the server only looks: one line per check, in the server's words", async () => {
  const { h, of } = await open({ "settings.get": withWa(), "wadesktop.test": { ok: false, lines: [
    { ok: true, text: "WhatsApp is installed" }, { ok: false, text: `WhatsApp isn't running — open it and leave it open ${EVIL}` },
    { ok: true, text: "Nothing was sent." }] } }, { methods: METHODS.concat(["wadesktop.test"]) });
  const btn = h.view().querySelector('[data-do="watest"]');
  assert.equal(btn.textContent, "Test WhatsApp on the server");
  assert.equal(btn.getAttribute("data-method"), "wadesktop.test");
  await h.click(btn);
  await h.settle(10);
  assert.deepEqual(of("wadesktop.test").map((c) => c.args), [{}]);
  assert.equal(h.$("cs-msg-wadesktop").textContent, `PROBLEM — something still needs doing\n✓ WhatsApp is installed\n✗ WhatsApp isn't running — open it and leave it open ${EVIL}\n✓ Nothing was sent.`);
  assert.equal(h.$("cs-msg-wadesktop").className, "cs-msg bad");
  assert.deepEqual(scan(h.view()), []);
  const old = await open({ "settings.get": withWa() });
  assert.equal(old.h.view().querySelector('[data-do="watest"]'), null, "a server build without the Test shows no button");
});
