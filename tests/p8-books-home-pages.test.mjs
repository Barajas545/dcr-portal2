// The Books program, release B part 2a (P4): the Accounting page (books-home.html) and its panels - read from their
// source, and DRIVEN in node over the demo database (tools/fake: p8-books.js on p5b-books.js and p8-register.js) with a
// small DOM (tests/console/console-page-dom.mjs, which parses the markup the pages write into a real tree):
// * the page refuses before reading without financials; NO approve call in any new module (S1); no write control
//   without the money switch; a financials-only account (the demo approver: no prices) sees no amount (S4);
// * Ask to approve: the usual approver ticked, a channel with nothing on file off, one ask - an e-mail queued with an
//   amount-free body, a text as a draft whose sms: link carries the database's number and body; [I sent it];
// * the hand text: no sms: link for a number that is not E.164;
// * injection (critic, S17): a vendor, a contact, a file name and a message body of <img src=x onerror=alert(1)> and
//   <a href=//evil.example>x</a> show as TEXT on the page, in the ask and tell panels, the drafts list, the template
//   editor and its preview;
// * the template editor: an amount refused in the database's words; someone else's save meanwhile (PT409) shows theirs.
// Made-up people and data only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as common2 from "../site/js/common2.js";
import { makeDom, scan, EVIL } from "./console/console-page-dom.mjs";
import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";

const skip = !available && "the demo database (tools/fake) is not here";
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const AMOUNT = /\$\s?\d/;
const LINK = "<a href=//evil.example>x</a>";
const NEW = ["js/pages/books-home.js", "js/pages/ask-approval.js", "js/pages/tell-payee.js", "js/pages/money-templates.js", "js/pages/books-nav.js",
  "js/repo/books-home.js", "js/repo/money-messages.js", "js/map/books-home.js", "js/map/money-messages.js"];

/* the browser stand-in: the page modules are imported only once it is there */
globalThis.Node = class { static [Symbol.hasInstance](x) { return !!x && typeof x.nodeType === "number"; } };
globalThis.window = { DCR2: common2.DCR2, addEventListener() {}, removeEventListener() {}, matchMedia: null, __BH_TEST__: true };
globalThis.document = makeDom("<!doctype html><html><head></head><body><div id=\"bhBody\"></div></body></html>");
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(fn, ms) {
  const end = Date.now() + (ms || 3000);
  for (;;) { const v = fn(); if (v) return v; if (Date.now() > end) throw new Error("timed out"); await tick(); }
}
const page = await import("../site/js/pages/books-home.js");
const ask = await import("../site/js/pages/ask-approval.js");
const tell = await import("../site/js/pages/tell-payee.js");
const tpl = await import("../site/js/pages/money-templates.js");
const nav = await import("../site/js/pages/books-nav.js");
const homeRepo = await import("../site/js/repo/books-home.js");
const mm = await import("../site/js/repo/money-messages.js");

async function as(e, key, extra) {
  const p = await person(key);
  const row = e.rows.profiles.find((x) => x.id === p.id);
  useClient(clientAs(e, p.id));
  clearPeople();
  return Object.assign({ id: p.id, name: p.name, role: p.role, active: true, can_see_financials: p.role === "admin" || !!row.can_see_financials,
    can_see_prices: p.role === "admin" || !!row.can_see_prices, can_approve_payments: !!row.can_approve_payments }, extra || {});
}
function parse(html) {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
}
function sheet() { return document.getElementById("bhSheet"); }

/* ── the page's own rules, read from the source ── */

test("books-home.html: the standard policy, its module, the Books' look, the top bar, the big Advanced button (twice) and no inline script", () => {
  const h = read("books-home.html"), acc = read("accounting.html");
  const csp = (x) => (/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(x) || [])[1];
  assert.equal(csp(h), csp(acc), "the same policy word for word");
  assert.ok(h.includes('<script type="module" src="js/pages/books-home.js"></script>') && h.includes('id="dcr2Topbar"'));
  assert.ok(h.includes('<link rel="stylesheet" href="css/books.css" />'));
  assert.ok(!/<script>(?!\s*<\/script>)/.test(h.replace(/<script[^>]*src=[^>]*><\/script>/g, "")), "no inline script");
  assert.equal((h.match(/class="bh-adv"[^>]*href="accounting\.html"/g) || []).length, 2, "Advanced mode — the Books, at the top and the foot");
  assert.match(h, /Advanced mode — the Books &rarr;/);
  const css = read("css/books.css");
  for (const rule of [".bh-chips {", ".bh-row {", ".bh-pc {", ".bh-adv {", "@media (max-width: 560px)"]) assert.ok(css.includes(rule), rule);
});

test("S1: NO approve call or button in any new module; the page refuses before reading without financials; Home reads the money code lazily", () => {
  for (const f of NEW) {
    const s = code(read(f));
    assert.ok(!/approve_bill|\.approve\(|setPayMethod|set_bill_pay_method|unapprove/.test(s), f + ": approves nothing");
  }
  const pg = code(read("js/pages/books-home.js"));
  const refuse = pg.indexOf("if (!seesBooks(me)) {"), first = pg.indexOf("await load();", refuse);
  assert.ok(refuse > 0 && first > refuse, "refused before the first read");
  assert.match(pg, /if \(!seesBooks\(me\)\) \{[^]*?location\.replace\("dashboard\.html"\);\s*return;/);
  assert.match(code(read("js/repo/books-home.js")), /export async function loadHome\(me, opts\) \{\s*if \(!seesBooks\(me\)\) throw noBooks\(\);/);
  const dash = code(read("js/shell/dashboard.js"));
  assert.ok(!/^import [^\n]*(repo|map)\/(books-home|money-messages|books)\.js/m.test(dash), "no static import of money code on Home");
  assert.match(dash, /import\("\.\.\/repo\/books-home\.js"\), import\("\.\.\/map\/books-home\.js"\)/);
  assert.match(dash, /\{ href: "books-home\.html", ic: "🧾", tt: "Accounting", id: "hmAccounting",/);
  assert.match(dash, /tt: "The Books \(advanced\)", id: "hmBooks"/);
});

test("S17: every innerHTML of the new modules is built from escaped words (h) or the modules' own builders", () => {
  for (const f of NEW.filter((x) => /pages\//.test(x))) {
    const s = code(read(f));
    for (const m of s.matchAll(/\.innerHTML = ([^;]+);/g)) {
      const x = m[1].trim();
      assert.ok(/^"[^"]*"$|^'[^']*'$|^\w+Html\([^)]*\)$|^bodyHtml\(d\)$|^'[^']*' \+ h\([^;]*\) \+ (['"])[^'"]*\1$|^'<div class="bh-dlg-card' \+ \(opt\.wide/.test(x) || x === '""',
        f + ": innerHTML = " + x.slice(0, 120));
    }
    assert.ok(!/document\.write|insertAdjacentHTML|outerHTML =/.test(s), f + ": no other way in");
    assert.ok(!/\.href = /.test(s), f + ": an sms: / tel: href is set with setAttribute on a node");
  }
});

/* ── driven over the demo database ── */

test("Ask to approve: the usual approver ticked, a channel with nothing on file off; one ask - the e-mail queued (no amount), the text a draft with the database's sms: link; I sent it", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  const d = await homeRepo.loadHome(me);
  const bills = d.waiting.filter((b) => b.projectNumber === "A303");
  assert.equal(bills.length, 2, "two bills waiting on the made-up kitchen job");
  // the approver with no phone on file: Text is off for them
  const drew = e.rows.profiles.find((p) => p.full_name === "Drew Approver");
  const phone = drew.phone;
  drew.phone = null;
  await ask.openAsk({ bills, me, templates: d.templates, today: d.today });
  let s = sheet();
  await until(() => s.querySelector('[data-pick="0"]'));
  const names = s.querySelectorAll(".bh-ap .nm span").map((n) => n.textContent);
  assert.equal(names[0], "Avery Admin");
  assert.ok(s.querySelector('[data-pick="0"]').checked, "the usual approver of the job is ticked");
  assert.match(s.querySelector('[data-ap="0"]').textContent, /Usual for A303/);
  assert.ok(!s.querySelector('[data-pick="1"]').checked, "not usual: not ticked");
  const sms1 = s.querySelector('input[name="bhCh1"][value="sms"]');
  assert.ok(sms1.disabled && /no mobile number on file/.test(s.querySelector('[data-ap="1"]').textContent), "no phone: Text is off and says why");
  assert.match(s.textContent, /Messages carry no amounts/);
  assert.ok(!AMOUNT.test(s.textContent), "no amount in the dialog");
  nav.closeSheet();
  drew.phone = phone;
  // e-mail to the usual approver, a text to the other
  await ask.openAsk({ bills, me, templates: d.templates, today: d.today });
  s = sheet();
  await until(() => s.querySelector('[data-pick="1"]'));
  s.querySelector('[data-pick="1"]').click();
  s.querySelector('input[name="bhCh1"][value="email"]').checked = false;
  s.querySelector('input[name="bhCh1"][value="sms"]').checked = true;
  const before = e.rows.notifications_outbox.length;
  s.querySelector("#bhAskSend").click();
  await until(() => s.querySelector(".bh-text"));
  const rows = e.rows.notifications_outbox.slice(before);
  assert.deepEqual(rows.map((o) => o.kind), ["approval_request"], "one outbox row: the e-mail");
  assert.ok(!AMOUNT.test(rows[0].body) && !AMOUNT.test(rows[0].subject) && /invoice #INV-6206/.test(rows[0].body), "amount-free, the invoice number with its #");
  const msg = e.rows.money_messages.find((m) => m.channel === "sms" && m.status === "draft");
  const open = s.querySelector('.bh-text [data-act="open"]');
  assert.equal(open.localName, "a");
  assert.equal(open.getAttribute("href"), "sms:+18055550111?&body=" + encodeURIComponent(msg.body), "the database's number and body");
  assert.equal(s.querySelector(".bh-text-b").textContent, msg.body);
  assert.match(s.textContent, /E-mail to Avery Admin: E-mail waiting for the reminder PC/);
  s.querySelector('.bh-text [data-act="sent"]').click();
  await until(() => e.rows.money_messages.find((m) => m.id === msg.id).status === "sent");
  nav.closeSheet();
  // both now show as the last ask
  const d2 = await homeRepo.loadHome(me);
  const q = d2.waiting.find((b) => b.id === bills[0].id);
  assert.match(page._test.billRowHtml(q, { asked: true }), /Asked Avery · e-mail waiting for the reminder PC; Drew · text \(by hand\)/);
});

test("the hand text: no sms: link for a number that is not E.164 (the button stays off); Copy and I sent it are there", async () => {
  const box = tell.textStep({ id: 9, channel: "sms", phone: "805-555-0101", body: "Hi", bill_ids: [1], status: "draft" }, {});
  const open = box.querySelector('[data-act="open"]');
  assert.equal(open.localName, "button");
  assert.ok(open.disabled && !open.getAttribute("href"));
  assert.deepEqual(box.querySelectorAll("[data-act]").map((b) => b.getAttribute("data-act")), ["open", "copy", "sent", "notsent"]);
});

test("S17 injection: a vendor, an invoice, a contact, the company and a message body of markup are TEXT - on the page, the ask and tell panels, the drafts, the template editor and its preview", { skip }, async () => {
  const e = await freshEngine();
  const quarry = e.rows.bills.find((b) => b.description === "Footings and stem wall, phase 1");
  quarry.vendor_name = EVIL;
  quarry.invoice_number = LINK;
  const bright = e.rows.contacts.find((c) => c.company === "Brightwater Concrete");
  bright.name = EVIL;
  bright.company = LINK;
  e.rows.settings[0].company_name = EVIL;
  const f = e.rows.files.find((x) => x.bill_id === e.rows.payments.find((p) => p.check_number === "5310").bill_id);
  if (f) f.name = EVIL + ".pdf";
  const me = await as(e, "accountant");
  // a text drafted through the database: its body carries the company's name as it is (the database removes no "<")
  const fern = e.rows.payments.find((p) => p.check_number === "5202");
  await mm.tell([fern.id], "sms", {});
  const d = await homeRepo.loadHome(me);
  page._test.state.me = me;
  page._test.state.d = d;
  page._test.render();
  const body = document.getElementById("bhBody");
  assert.deepEqual(scan(body), [], "no element from the data on the page");
  assert.ok(body.textContent.includes(EVIL) && body.textContent.includes(LINK), "the words are shown as they are");
  assert.ok(!body.querySelectorAll("a").some((a) => /evil\.example/.test(a.getAttribute("href") || "")), "no link from the data");
  const drafts = body.querySelectorAll("#bhDraftList .bh-text-b");
  assert.ok(drafts.length >= 1 && drafts.some((n) => n.textContent.includes(EVIL)), "the draft's body as text");
  // the ask panel's bill list
  await ask.openAsk({ bills: [d.waiting.find((b) => b.id === quarry.id)], me, templates: d.templates, today: d.today });
  await until(() => sheet().querySelector(".bh-bills li"));
  assert.deepEqual(scan(sheet()), []);
  assert.ok(sheet().querySelector(".bh-bills li").textContent.includes(EVIL));
  nav.closeSheet();
  // the tell panel: the group's markup alone
  const g = d.tellGroups.find((x) => x.vendorContactId === bright.id);
  const t = parse(tell.groupHtml(g, { me, links: d.desk.links }));
  assert.deepEqual(scan(t), []);
  assert.ok(t.textContent.includes(LINK));
  // the template editor and its preview: a template body holding markup (no amount, link or address: the database takes it)
  const row = e.rows.message_templates.find((x) => x.key === "check_ready" && x.channel === "sms");
  row.body = "Hi {{firstName}}, " + EVIL + " ready.";
  await tpl.openTemplates({ me, key: "check_ready" });
  await until(() => sheet().querySelector("#bhTplSms"));
  assert.deepEqual(scan(sheet()), []);
  assert.equal(sheet().querySelector("#bhTplSms").value, row.body, "shown in the box as it is");
  sheet().querySelector('[data-prev="sms"]').click();
  await until(() => !sheet().querySelector("#bhTplPrevS").hidden);
  assert.deepEqual(scan(sheet()), []);
  assert.ok(sheet().querySelector("#bhTplPrevS").textContent.includes("<img src=x onerror=alert(1)>"));
  nav.closeSheet();
});

test("S4: a financials-only account (the demo approver: no prices) sees no amount on the page - Paid in the last 30 days included", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "approver");
  assert.equal(me.can_see_prices, false);
  const d = await homeRepo.loadHome(me);
  assert.ok(d.paid30.length > 3);
  page._test.state.me = me;
  const html = page._test.bodyHtml(d);
  assert.ok(!AMOUNT.test(html), (html.match(/.{60}\$\s?\d.{20}/) || [""])[0]);
  page._test.state.me = me;
  page._test.state.d = d;
  page._test.render();
  const paid = document.getElementById("secPaid");
  assert.ok(paid && !AMOUNT.test(paid.textContent) && /payments/.test(paid.textContent), "the Paid list without an amount or a total");
  // an approver's rows say "Open & approve" (the bill page approves, signed in) - nothing here does
  assert.match(html, /Open &amp; approve &rarr;/);
});

test("no write control without the money switch: someone with financials but no money editing sees no Ask, Tell, Picked up or record button", { skip }, async () => {
  const e = await freshEngine();
  const field = e.rows.profiles.find((p) => p.role === "field" && p.active);
  field.can_see_financials = true;
  const me = await as(e, "field");
  const d = await homeRepo.loadHome(me);
  page._test.state.me = me;
  const html = page._test.bodyHtml(d);
  for (const w of ["data-askpick", "data-ask=", "data-tell=", "data-picked=", "data-unpick=", "bhAskSel", "ckWrite"]) assert.ok(!html.includes(w), w);
  assert.match(html, /Only an admin, or a manager or accountant with financials, tells a payee/);
});

test("the template editor: an amount refused in the database's words; someone else's save meanwhile shows theirs (PT409); reset", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  await tpl.openTemplates({ me, key: "check_ready" });
  const s = sheet();
  await until(() => s.querySelector("#bhTplBody"));
  assert.deepEqual(s.querySelectorAll("[data-chip]").map((b) => b.getAttribute("data-chip")), ["company", "requesterName", "requesterFirstName", "requesterPhone",
    "requesterEmail", "firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate", "checkNumber"], "the chips: the allow-list");
  assert.ok(s.querySelectorAll("[data-chip]").map((b) => b.textContent).includes("#{{checkNumber}}"), "a number's chip carries its #");
  assert.match(s.textContent, /No link, e-mail address or phone number may be typed/);
  s.querySelector("#bhTplBody").value = "Your check for $1,250.00 is ready.";
  s.querySelector('[data-save="email"]').click();
  await until(() => /amount/.test(s.querySelector("#bhTplMsgE").textContent));
  assert.equal(s.querySelector("#bhTplMsgE").textContent, "The text holds an amount: a money message never carries one.");
  // someone else saves the text meanwhile
  const admin = await person("admin");
  const row = e.rows.message_templates.find((x) => x.key === "check_ready" && x.channel === "sms");
  e.rpc({ uid: admin.id }, "save_message_template", { p_key: "check_ready", p_channel: "sms", p_subject: null, p_body: "Hi {{firstName}}, the office has it.", p_version: row.version });
  useClient(clientAs(e, me.id));
  s.querySelector("#bhTplSms").value = "Hi {{firstName}}, mine.";
  s.querySelector('[data-save="sms"]').click();
  await until(() => /someone else/i.test(s.querySelector("#bhTplMsgS").textContent));
  assert.equal(s.querySelector("#bhTplMsgS").textContent, "Changed by someone else — showing theirs.");
  assert.equal(s.querySelector("#bhTplSms").value, "Hi {{firstName}}, the office has it.");
  common2.DCR2.confirm = async () => true;
  s.querySelector('[data-reset="sms"]').click();
  await until(() => /original/.test(s.querySelector("#bhTplMsgS").textContent));
  assert.match(e.rows.message_templates.find((x) => x.key === "check_ready" && x.channel === "sms").body, /^Hi \{\{firstName\}\}, your check from \{\{company\}\}/);
  nav.closeSheet();
});

/* ── release B review fixes 1 ── */

test("Ask to approve: the boxes show the template as stored NOW (never the page's older copy); Send sends exactly the text shown and previewed", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  const d = await homeRepo.loadHome(me);       // the page's copy of the templates
  const bills = d.waiting.filter((b) => b.projectNumber === "A303");
  const admin = await person("admin");
  const save = (subject) => {
    const row = e.rows.message_templates.find((x) => x.key === "approval_request" && x.channel === "email");
    e.rpc({ uid: admin.id }, "save_message_template", { p_key: "approval_request", p_channel: "email", p_subject: subject, p_body: row.body, p_version: row.version });
    useClient(clientAs(e, me.id));
  };
  // an admin saves a new wording elsewhere after the page read its templates
  save("Fresh wording: {{billsPhrase}} waiting");
  await ask.openAsk({ bills, me, templates: d.templates, today: d.today });
  const s = sheet();
  await until(() => s.querySelector("#bhAskSubj") && s.querySelector('[data-pick="0"]'));
  assert.equal(s.querySelector("#bhAskSubj").value, "Fresh wording: {{billsPhrase}} waiting", "read when the dialog opened, not the page's copy");
  // ... and once more while the dialog is open: what she sees and previews is what goes out
  save("Newest wording: {{billsPhrase}} waiting");
  s.querySelector("#bhAskPrev").click();
  await until(() => !s.querySelector("#bhAskPrevBox").hidden);
  const shown = s.querySelector("#bhAskPrevBox .bh-prev-s").textContent;
  assert.match(shown, /^Fresh wording: 2 bills are waiting/);
  const before = e.rows.notifications_outbox.length;
  s.querySelector("#bhAskSend").click();
  await until(() => e.rows.notifications_outbox.length > before);
  const out = e.rows.notifications_outbox.slice(before);
  assert.equal(out.length, 1, "one e-mail: the usual approver");
  assert.equal(out[0].subject, shown, "the subject previewed is the subject sent");
  assert.equal(e.rows.money_messages.find((m) => m.id === out[0].money_message_id).subject, shown);
  nav.closeSheet();
});

test("Ask to approve says when the reminder PC is not taking e-mails - read when the dialog opens, wherever it is opened from (the bill page gives it nothing)", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  const d = await homeRepo.loadHome(me);
  const bill = d.waiting.find((b) => b.projectNumber === "A303");
  const dev = e.exts.find((x) => x.name === "p8-books").__dev;
  for (const [pc, want] of [[{ notTaking: true }, /isn't sending e-mails right now/], [{ paused: true }, /is paused/], [{ seenMinutesAgo: 240 }, /last heard from 4 hours ago/]]) {
    dev.pcStatus(pc);
    await ask.openAsk({ bills: [bill], me, today: d.today });     // as bill.js opens it
    const s = sheet();
    await until(() => s.querySelector('[data-pick="0"]'));
    const w = s.querySelector("#bhAskPc");
    assert.ok(w && want.test(w.textContent) && /Text or call instead/.test(w.textContent), JSON.stringify(pc) + ": " + (w ? w.textContent : "no warning"));
    assert.ok(s.querySelector(".bh-ask").firstChild === w, "at the top of the dialog");
    nav.closeSheet();
  }
  dev.pcStatus({ seenMinutesAgo: 1 });
  await ask.openAsk({ bills: [bill], me, today: d.today });
  await until(() => sheet().querySelector('[data-pick="0"]'));
  assert.equal(sheet().querySelector("#bhAskPc"), null, "a PC that takes e-mails: no warning");
  nav.closeSheet();
  dev.pcStatus(null);
});

test("the template editor keeps what was typed and not saved: over a switch of template, a reset or someone else's save of the OTHER channel; closing asks first", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  await tpl.openTemplates({ me, key: "approval_request" });
  const s = sheet();
  await until(() => s.querySelector("#bhTplBody"));
  const type = (id, v) => { const f = s.querySelector("#" + id); f.value = v; f.dispatchEvent({ type: "input" }); };
  const body0 = s.querySelector("#bhTplBody").value;
  type("bhTplBody", body0 + " MY EDIT");
  s.querySelector('[data-key="check_ready"]').click();
  assert.equal(s.querySelector('[data-key="check_ready"]').getAttribute("aria-selected"), "true");
  assert.ok(!/MY EDIT/.test(s.querySelector("#bhTplBody").value), "the other template shows its own");
  s.querySelector('[data-key="approval_request"]').click();
  assert.equal(s.querySelector("#bhTplBody").value, body0 + " MY EDIT", "back on the template: the edit is still there");
  // the e-mail typed, the text reset to the original: the e-mail keeps its words
  type("bhTplSubj", "My subject {{billsPhrase}}");
  common2.DCR2.confirm = async () => true;
  s.querySelector('[data-reset="sms"]').click();
  await until(() => /original/.test(s.querySelector("#bhTplMsgS").textContent));
  assert.equal(s.querySelector("#bhTplSubj").value, "My subject {{billsPhrase}}", "the e-mail's subject survives the text's reset");
  assert.equal(s.querySelector("#bhTplBody").value, body0 + " MY EDIT", "and its body");
  // someone else saves the text meanwhile and mine is refused (PT409): theirs on the text, mine still on the e-mail
  const admin = await person("admin");
  const row = e.rows.message_templates.find((x) => x.key === "approval_request" && x.channel === "sms");
  e.rpc({ uid: admin.id }, "save_message_template", { p_key: "approval_request", p_channel: "sms", p_subject: null, p_body: "Hi {{approverFirstName}}, the office wrote this.", p_version: row.version });
  useClient(clientAs(e, me.id));
  type("bhTplSms", "Hi {{approverFirstName}}, mine.");
  s.querySelector('[data-save="sms"]').click();
  await until(() => /someone else/i.test(s.querySelector("#bhTplMsgS").textContent));
  assert.equal(s.querySelector("#bhTplSms").value, "Hi {{approverFirstName}}, the office wrote this.");
  assert.equal(s.querySelector("#bhTplSubj").value, "My subject {{billsPhrase}}", "the e-mail keeps what was typed");
  // closing with words not saved asks first: No keeps the sheet open, Yes closes it
  let asked = 0;
  common2.DCR2.confirm = async () => { asked++; return false; };
  s.querySelector("#bhSheetX").click();
  for (let i = 0; i < 5; i++) await tick();
  assert.ok(asked === 1 && !s.hidden, "asked, and kept open");
  common2.DCR2.confirm = async () => { asked++; return true; };
  s.querySelector("#bhSheetX").click();
  await until(() => s.hidden);
  assert.equal(asked, 2);
  // saved: nothing to ask about
  await tpl.openTemplates({ me, key: "check_ready" });
  const s2 = sheet();
  await until(() => s2.querySelector("#bhTplSms"));
  type("bhTplSms", "Hi {{firstName}}, it is ready at the office.");
  s2.querySelector('[data-save="sms"]').click();
  await until(() => /^Saved/.test(s2.querySelector("#bhTplMsgS").textContent));
  assert.equal(e.rows.message_templates.find((x) => x.key === "check_ready" && x.channel === "sms").body, "Hi {{firstName}}, it is ready at the office.", "saved");
  s2.querySelector("#bhSheetX").click();
  await until(() => s2.hidden);
  assert.equal(asked, 2, "nothing unsaved: closed unasked");
});

test("the Call step: its tel: link and \u2713 Told by phone stay open over the page's redraw (back from the phone's dialer, the 30 s poll) until the call is recorded", { skip }, async () => {
  const e = await freshEngine();
  const me = await as(e, "accountant");
  page._test.state.me = me;
  page._test.state.d = await homeRepo.loadHome(me);
  page._test.render();
  const body = document.getElementById("bhBody");
  const btn = body.querySelectorAll('[data-tell="call"]').find((b) => !b.disabled);
  assert.ok(btn, "a payee with a phone on file");
  const key = btn.getAttribute("data-g");
  const box = () => body.querySelectorAll("[data-call]").find((x) => x.getAttribute("data-call") === key) || null;
  btn.click();
  await tick();
  assert.ok(!box().hidden && /\u2713 Told by phone/.test(box().textContent) && box().querySelector('a[href^="tel:"]'), "the call step");
  // back from the dialer: the page reads everything again and draws it again
  page._test.state.d = await homeRepo.loadHome(me);
  page._test.render();
  assert.ok(box() && !box().hidden && /\u2713 Told by phone/.test(box().textContent) && box().querySelector('a[href^="tel:"]'), "still open after the redraw");
  const g = page._test.state.d.tellGroups.find((x) => x.key === key);
  // another group's call box stays shut
  assert.ok(body.querySelectorAll("[data-call]").filter((x) => x.getAttribute("data-call") !== key).every((x) => x.hidden));
  box().querySelector("button").click();
  await until(() => g.payments.every((p) => e.rows.payments.find((x) => x.id === p.paymentId).pickup_told_at));
  assert.ok(g.payments.every((p) => e.rows.payments.find((x) => x.id === p.paymentId).pickup_told_how === "phone"), "told by phone");
  // recorded: the step is forgotten - a later redraw opens no call box
  page._test.state.d = await homeRepo.loadHome(me);
  page._test.render();
  assert.ok(body.querySelectorAll("[data-call]").every((x) => x.hidden), "no call step open");
});
