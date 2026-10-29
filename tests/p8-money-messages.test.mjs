// The Books program, release B part 2a (P4): the money messages' page-side rules (site/js/map/money-messages.js) - the
// placeholders equal the database's allow-list (app.money_template_vars; tools/schema-check-p8-books.mjs compares them
// with the real migration, here with the demo's port of it), the sms: link only for an E.164 number, the sizes, the
// state words, the reminder PC's warning (never its name) - and NO renderer: the database renders every message (I16).
// Made-up values only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as M from "../site/js/map/money-messages.js";

const read = (rel) => readFileSync(new URL("../" + rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the chips are the database's allow-list (app.money_template_vars, camelCase), no amount placeholder anywhere; a number's chip carries its #", async () => {
  const EVERY = ["company", "requesterName", "requesterFirstName", "requesterPhone", "requesterEmail"];
  assert.deepEqual(M.PLACEHOLDERS.approval_request, EVERY.concat(["approverFirstName", "approverName", "billsPhrase", "billList", "link"]));
  assert.deepEqual(M.PLACEHOLDERS.check_ready, EVERY.concat(["firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate", "checkNumber"]));
  assert.deepEqual(M.PLACEHOLDERS.cash_ready, EVERY.concat(["firstName", "name", "payee", "projectLabel", "invoiceNumber", "writtenDate"]));
  assert.deepEqual(M.TEMPLATE_KEYS, ["approval_request", "check_ready", "cash_ready"]);
  for (const k of M.TEMPLATE_KEYS) {
    assert.ok(!M.PLACEHOLDERS[k].some((n) => /amount|total|price|owed/i.test(n)), k + ": no amount placeholder");
    for (const n of M.PLACEHOLDERS[k]) assert.ok(M.PLACEHOLDER_WORDS[n], n + " has its words");
  }
  // the demo database's port of the migration has the same lists (tools/fake/p8-books.js)
  globalThis.DCR2Fake = globalThis.DCR2Fake || {};
  await import("../tools/fake/p8-books.js");
  assert.deepEqual(globalThis.DCR2Fake.p8MoneyVars, Object.fromEntries(M.TEMPLATE_KEYS.map((k) => [k, M.PLACEHOLDERS[k].slice()])));
  assert.equal(M.chipText("checkNumber"), "#{{checkNumber}}");
  assert.equal(M.chipText("invoiceNumber"), "#{{invoiceNumber}}");
  assert.equal(M.chipText("payee"), "{{payee}}");
  assert.deepEqual(M.insertAt("Hello  there", 6, 6, "{{payee}}"), { text: "Hello {{payee}} there", at: 15 });
  assert.deepEqual(M.insertAt("abc", 1, 3, "X"), { text: "aX", at: 2 });
  assert.deepEqual(M.unknownPlaceholders("check_ready", "{{payee}} {{amount}} {{amount}} {{link}}"), ["amount", "link"]);
  assert.match(M.LINK_RULE, /No link, e-mail address or phone number may be typed/);
});

test("smsHref: only for the database's E.164 shape (+1XXXXXXXXXX); the body encoded; anything else null (the button stays off)", () => {
  assert.equal(M.smsHref("+18055550123", "Hi Sam, your check is ready & waiting\n- Casey"),
    "sms:+18055550123?&body=" + encodeURIComponent("Hi Sam, your check is ready & waiting\n- Casey"));
  assert.ok(M.smsHref("+18055550123", "x").startsWith("sms:+18055550123?&body="));
  for (const bad of ["8055550123", "(805) 555-0123", "+1 805 555 0123", "+11055550123", "+18055550123,+18055550124", "+18055550123?body=x", "javascript:alert(1)",
    "+4402071234567", "", null, undefined, "+1805555012"]) {
    assert.equal(M.smsHref(bad, "x"), null, String(bad));
  }
  // a body cannot add a recipient or a parameter: it is encoded whole
  assert.equal(M.smsHref("+18055550123", "a&body=b,+18005550000"), "sms:+18055550123?&body=a%26body%3Db%2C%2B18005550000");
  assert.equal(M.telHref("(805) 555-0123"), "tel:8055550123");
  assert.equal(M.telHref("+1 805 555 0123 ext"), "tel:+18055550123");
  assert.equal(M.telHref("555"), null);
  assert.equal(M.phoneWords("+18055550123"), "(805) 555-0123");
});

test("the sizes (the database checks again): a subject one line of 200, an e-mail 4000, a text 640; the counter", () => {
  assert.deepEqual([M.LIMITS.bills, M.LIMITS.approvers, M.LIMITS.payments, M.LIMITS.subject, M.LIMITS.body, M.LIMITS.sms], [50, 10, 20, 200, 4000, 640]);
  assert.equal(M.lengthProblem("email", "Subject", "Body"), "");
  assert.equal(M.lengthProblem("email", "", "Body"), "An e-mail needs a subject.");
  assert.equal(M.lengthProblem("email", "a\nb", "Body"), "The subject is one line.");
  assert.equal(M.lengthProblem("email", "x".repeat(201), "Body"), "The subject is at most 200 characters.");
  assert.equal(M.lengthProblem("email", "S", "x".repeat(4001)), "The e-mail is at most 4000 characters.");
  assert.equal(M.lengthProblem("sms", null, "x".repeat(641)), "A text is at most 640 characters.");
  assert.equal(M.lengthProblem("sms", null, "  "), "The message is empty.");
  assert.equal(M.smsCount("x".repeat(10)), "10 / 640 characters");
  assert.match(M.smsCount("x".repeat(200)), /^200 \/ 640 characters · 2 texts on most phones$/);
});

test("a message's state in words; a refusal in the database's words (a limit too); the reminder PC's warning never names it", () => {
  const m = (o) => M.toMessage(Object.assign({ id: 1, kind: "approval_request", channel: "email", bill_ids: [3], status: "queued", created_at: "2026-10-28T17:42:00Z" }, o));
  assert.deepEqual(M.messageStatus(m({})), { cls: "wait", text: "E-mail waiting for the reminder PC (since Oct 28 10:42 AM)" });
  assert.deepEqual(M.messageStatus(m({ status_note: "trying again: the mail channel failed" })), { cls: "wait", text: "E-mail waiting for the reminder PC — trying again: the mail channel failed" });
  assert.deepEqual(M.messageStatus(m({ status: "sent", sent_at: "2026-10-28T17:44:00Z" })), { cls: "ok", text: "e-mail sent ✓ Oct 28 10:44 AM" });
  assert.deepEqual(M.messageStatus(m({ status: "not_sent", status_note: "opted out" })), { cls: "bad", text: "not sent: opted out" });
  assert.deepEqual(M.messageStatus(m({ status: "not_sent", status_note: "not sent after 5 tries: x" })), { cls: "bad", text: "not sent after 5 tries: x" });
  assert.deepEqual(M.messageStatus(m({ channel: "sms", status: "draft" })), { cls: "draft", text: "text written — not marked sent yet" });
  assert.equal(M.messageStatus(m({ channel: "sms", status: "cancelled" })).text, "text not sent");
  // a text read back carries its number (to_address); an RPC answer names it phone
  assert.equal(M.toMessage({ channel: "sms", to_address: "+18055550123" }).phone, "+18055550123");
  assert.equal(M.toMessage({ channel: "email", to_address: "a@example.com" }).phone, "", "an e-mail's address is never a phone");
  assert.deepEqual(M.toMessage({ bill_ids: [1, 2], payment_ids: null }).billIds, ["1", "2"]);
  assert.equal(M.messageError({ code: "PT429", message: "Avery Admin was already e-mailed 3 times today about X, invoice #12, job A1: call instead" }, () => "Too many attempts."),
    "Avery Admin was already e-mailed 3 times today about X, invoice #12, job A1: call instead.");
  assert.equal(M.messageError({ code: "22023", message: "x" }, () => "mapped"), "mapped");
  assert.equal(M.pcWarning({ seenMinutesAgo: 1, paused: false, notTaking: false }), "");
  assert.match(M.pcWarning({ seenMinutesAgo: 1, paused: false, notTaking: true }), /^The reminder PC isn't sending e-mails right now \(paused or off\).*Text or call instead, or ask an admin\.$/);
  assert.match(M.pcWarning({ seenMinutesAgo: 2, paused: true, notTaking: false }), /is paused/);
  assert.match(M.pcWarning({ seenMinutesAgo: null, paused: null, notTaking: false }), /has not been heard from/);
  assert.match(M.pcWarning({ seenMinutesAgo: 47, paused: false, notTaking: false }), /last heard from 47 minutes ago/);
  assert.equal(M.pcWarning(null), "");
  assert.equal(M.agoWords("2026-10-28T10:00:00Z", new Date("2026-10-28T12:05:00Z")), "2 h ago");
  assert.equal(M.agoWords("2026-10-28T12:04:30Z", new Date("2026-10-28T12:05:00Z")), "just now");
});

test("NO renderer on the page side (I16): map/money-messages.js fills no placeholder, and no new page module does", () => {
  const src = code(read("site/js/map/money-messages.js"));
  assert.ok(!/function render|renderTemplate|DEFAULT_TEMPLATES|\.replace\(\/\\\{\\\{/.test(src), "no template is filled here");
  for (const f of ["site/js/pages/ask-approval.js", "site/js/pages/tell-payee.js", "site/js/pages/money-templates.js", "site/js/pages/books-home.js",
    "site/js/map/books-home.js", "site/js/repo/money-messages.js"]) {
    const s = code(read(f));
    assert.ok(!/renderTemplate|\.replace\(\/\\\{\\\{\(|scrubMoney\(/.test(s), f + ": no renderer, no scrub of its own");
  }
  // and no company name, mailbox or phone of the office in the defaults - there are no defaults on the page side
  assert.ok(!/@[a-z0-9-]+\.(com|net|org)|\(\d{3}\) \d{3}-\d{4}/i.test(code(read("site/js/map/money-messages.js"))));
});
