// P5c subcontractor form and review over the demo database (tools/fake/p5c-sub.js: M5c's sub_submissions rules,
// accept_submission / reject_submission, the notices, and the public "subform" function's stand-in):
// * site/js/repo/subform.js as the public page uses it - NO sign-in at all: search, submit, the one signed upload,
//   "attached" (P5 acceptance check 4 as far as the demo can say it; the real function and rules:
//   DCR Desktop 2 supabase/functions/subform/*_test.ts and tools/schema-check-p5c-sub.mjs);
// * site/js/repo/submissions.js as each role: who reads the queue, accept (a bill NOT approved; a change order on the
//   job), reject, "already done", a stale version; check 5 (no amount in an activity row or an outbox body).
import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as subform from "../site/js/repo/subform.js";
import * as subs from "../site/js/repo/submissions.js";
import * as S from "../site/js/map/submissions.js";

const skip = !available && "the demo database (tools/fake) is not here";
let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(new Date());
  subform.useSubformClient(publicClient());
}
const id = (key) => F.PEOPLE.find((p) => p.key === key).id;
function me(key) {
  const p = E.rows.profiles.find((x) => x.id === id(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
function as(key) {
  const c = clientAs(E, id(key));
  const asked = [];
  useClient({ from: (t) => { asked.push(t); return c.from(t); }, rpc: (n, a) => { asked.push("rpc:" + n); return c.rpc(n, a); }, storage: c.storage });
  clearPeople();
  return asked;
}
/** supabase-js as the public page has it: no session; functions.invoke and the signed upload, answered by the engine */
function publicClient() {
  return {
    functions: {
      invoke: async (name, o) => {
        const r = E.invoke({ uid: null }, name, (o && o.body) || {});
        if (r.status >= 200 && r.status < 300) return { data: r.data, error: null };
        return { data: null, error: { name: "FunctionsHttpError", context: new Response(JSON.stringify(r.data), { status: r.status }) } };
      },
    },
    storage: { from: (bucket) => ({ uploadToSignedUrl: async (path, token, blob, o) => {
      try { E.storage.uploadSigned(path, token, blob.size, (o && o.contentType) || blob.type, blob, bucket); return { data: { path }, error: null }; }
      catch (e) { return { data: null, error: { message: e.message, statusCode: e.statusCode } }; }
    } }) },
  };
}
function png(pixels = 400) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(pixels, 7)), chunk("IEND", Buffer.alloc(0))]);
}
const SIG = "data:image/png;base64," + png().toString("base64");
const openJob = () => E.rows.projects.find((p) => !p.deleted_at && !p.completed_date && p.status === "in_progress" && p.number !== "A267");
const closedJob = () => E.rows.projects.find((p) => !p.deleted_at && (p.status === "closed" || p.status === "completed"));
const payload = (project, extra) => Object.assign({ kind: "Invoice", projectId: String(project.id), vendorCompany: "Juniper Glass", contactName: "Jun Iper",
  email: "jun@juniper-glass.example", phone: "", invoiceNumber: "G-12", amount: "1,375.50", description: "Shower glass, first fitting.",
  invoiceDate: "", dueDate: "", signatureName: "Jun Iper", signature: SIG, agree: true, website: "", document: { type: "application/pdf", size: 4096 } }, extra || {});
async function refused(fn, code) {
  try { await fn(); } catch (e) { if (code) assert.equal(e.code, code, e.message); return e; }
  assert.fail("expected a refusal " + (code || ""));
}

test("the public form, with no sign-in: open jobs only, the four public fields (no street address), at least 3 characters", { skip }, async () => {
  await setup();
  const job = openJob();
  const d = await subform.searchProjects(job.number);
  assert.deepEqual(d.projects.map((p) => p.id), [job.id]);
  assert.deepEqual(Object.keys(d.projects[0]).sort(), ["city", "id", "name", "number"], "no street address (owner, 2026-10-23)");
  assert.ok(!JSON.stringify(d).includes(job.client_name), "the client never leaves");
  assert.deepEqual((await subform.searchProjects("ab")).projects, []);
  const shut = closedJob();
  assert.deepEqual((await subform.searchProjects(shut.number)).projects, [], "a closed or completed job is not offered");
  const town = await subform.searchProjects(job.city);
  assert.ok(town.projects.length <= 8);
});

test("submit -> the one signed upload -> attached: a pending submission with its paperwork under f/, the office told without the amount", { skip }, async () => {
  await setup();
  const job = openJob();
  const before = E.rows.notifications_outbox.length;
  const out = await subform.submit(payload(job));
  assert.match(out.reference, /^SUB-[23456789CDFGHJKMNPQRTVWXY]{4}-[23456789CDFGHJKMNPQRTVWXY]{4}$/);
  assert.match(out.upload.path, new RegExp("^f/" + job.id + "/receipts/[0-9a-f]{32}/SUB INVOICE " + out.reference + "\\.pdf$"));
  const blob = new Blob([Buffer.alloc(4096, 1)], { type: "application/pdf" });
  assert.equal(await subform.sendDocument(out.reference, out.upload, blob, "application/pdf"), true);
  const s = E.rows.sub_submissions.find((x) => x.reference === out.reference);
  assert.deepEqual([s.state, s.kind, s.amount, s.project_id, !!s.document_attached_at, s.document_size, s.submitted_ip],
    ["pending", "invoice", 1375.5, job.id, true, 4096, "198.51.100.23"]);
  assert.ok(s.signature_path.startsWith("f/" + job.id + "/receipts/"));
  await refused(() => subform.call({ op: "attached", reference: out.reference, path: out.upload.path }), "invalid");
  assert.equal(E.rows.bills.some((b) => String(b.description || "").includes(out.reference)), false, "a submission is never a bill by itself");
  // one waiting notice per reviewer: a new one, or this submission folded into the one still waiting for them
  const notes = E.rows.notifications_outbox.filter((n) => (n.submission_ids || [n.submission_id]).indexOf(s.id) !== -1);
  const told = notes.map((n) => E.rows.profiles.find((p) => p.id === n.to_profile_id).key || E.rows.profiles.find((p) => p.id === n.to_profile_id).role);
  assert.ok(notes.length >= 2 && notes.every((n) => n.kind === "sub_submission" && n.email_wanted && !n.sent_at), "one notice per reviewer: " + told);
  assert.equal(new Set(notes.map((n) => n.to_profile_id)).size, notes.length, "each person once");
  assert.ok(E.rows.notifications_outbox.length - before < notes.length, "folded into the notices still waiting (the seed has one for the admin and the accountant)");
  const roles = notes.map((n) => E.rows.profiles.find((p) => p.id === n.to_profile_id)).map((p) => p.role + (p.role === "manager" && p.can_approve_payments ? "+approve" : ""));
  assert.ok(roles.every((r) => r === "admin" || r === "accountant" || r === "manager+approve"), roles.join());
  for (const n of notes) assert.ok(!/1,?375|\$/.test(n.subject + n.body) && !/Shower glass/.test(n.body), "no amount, no description: " + n.body);
});

test("the paperwork lands in the private inbox first (Storage's own limits: 25 MB, a photo, scan or PDF; that bucket only) and nobody reads it; 'attached' copies it into project-files - only then does a money editor open it", { skip }, async () => {
  await setup();
  const job = openJob();
  const out = await subform.submit(payload(job));
  assert.equal(out.upload.bucket, "subform-inbox");
  const inbox = publicClient().storage.from("subform-inbox");
  const big = await inbox.uploadToSignedUrl(out.upload.path, out.upload.token, { size: 26 * 1024 * 1024, type: "application/pdf" }, { contentType: "application/pdf" });
  assert.equal(String(big.error && big.error.statusCode), "413", "over 25 MB: refused by Storage itself");
  const html = await inbox.uploadToSignedUrl(out.upload.path, out.upload.token, new Blob(["<b>x</b>"], { type: "text/html" }), { contentType: "text/html" });
  assert.equal(String(html.error && html.error.statusCode), "415", "not a photo, scan or PDF: refused");
  const files = await publicClient().storage.from("project-files").uploadToSignedUrl(out.upload.path, out.upload.token, new Blob([Buffer.alloc(9)], { type: "application/pdf" }),
    { contentType: "application/pdf" });
  assert.ok(files.error, "the token is not good for project-files");
  const ok = await inbox.uploadToSignedUrl(out.upload.path, out.upload.token, new Blob([Buffer.alloc(4096, 1)], { type: "application/pdf" }), { contentType: "application/pdf" });
  assert.equal(ok.error, null);
  assert.equal(E.objects.has(out.upload.path), false, "not in project-files before 'attached'");
  assert.throws(() => E.storage.sign({ uid: id("admin") }, out.upload.path), "an admin cannot open it yet");
  await subform.call({ op: "attached", reference: out.reference, path: out.upload.path });
  assert.equal(E.objects.has(out.upload.path), true, "copied into project-files");
  assert.ok(E.storage.sign({ uid: id("admin") }, out.upload.path), "and now a money editor opens it");
  assert.throws(() => E.storage.sign({ uid: id("lead") }, out.upload.path), "a lead never");
});

test("the review queue says what became of each waiting submission's e-mail (the old 'Nobody was emailed about this'); an accepted invoice's line says its bill as it is now", { skip }, async () => {
  await setup();
  as("admin");
  const d = await subs.list(me("admin"));
  const by = (ref) => d.all.find((s) => s.reference === ref);
  assert.equal(by("SUB-7KQ4-HM3D").notice, null, "sent: nothing to say");
  assert.deepEqual(by("SUB-RM6G-8JKV").notice, { warn: false, text: "The e-mail about it has not gone out yet (DCR Agents 2 sends it)." });
  assert.equal(by("SUB-C9TX-2PWF").notice.warn, true);
  assert.match(by("SUB-C9TX-2PWF").notice.text, /^Nobody was e-mailed about this: the e-mail could not be sent/);
  assert.equal(by("SUB-W4FD-QX7N").notice, null, "a reviewed one: no warning");
  const c = clientAs(E, id("lead"));
  assert.equal((await c.rpc("sub_submission_notices", { p_ids: [1] })).error.code, "42501", "a lead is refused");
  // the switch off: the next submission's notice is written set aside, and the queue says why
  E.rows.settings[0].sub_email_enabled = false;
  const out = await subform.submit(payload(openJob()));
  E.rows.settings[0].sub_email_enabled = true;
  const d2 = await subs.list(me("admin"));
  assert.match(d2.all.find((s) => s.reference === out.reference).notice.text, /turned off/);
  // accept, then approve: the Accepted tab's line follows the bill
  as("accountant");
  const inv = (await subs.list(me("accountant"))).all.find((s) => s.reference === "SUB-7KQ4-HM3D");
  const acc = await subs.accept(inv, null);
  let line = S.reviewedLine((await subs.list(me("accountant"))).all.find((s) => s.reference === "SUB-7KQ4-HM3D"));
  assert.match(line, new RegExp("bill #" + acc.bill_id + " \\(waiting for approval\\)$"));
  const b = E.rows.bills.find((x) => x.id === acc.bill_id);
  b.approved_at = new Date().toISOString(); b.approved_by = id("admin"); b.approved_amount = b.amount; b.pay_method = "check";
  line = S.reviewedLine((await subs.list(me("accountant"))).all.find((s) => s.reference === "SUB-7KQ4-HM3D"));
  assert.match(line, new RegExp("bill #" + acc.bill_id + " \\(approved\\)$"));
  assert.equal(b.vendor_contact_id, null, "no contact chosen by a typed e-mail");
});

test("the public form refuses in plain words: every problem at once, the honeypot, a closed job, an upload that is not the one announced", { skip }, async () => {
  await setup();
  const job = openJob();
  const many = await refused(() => subform.submit({ kind: "", projectId: "", amount: "x" }), "invalid");
  assert.ok(many.errors.length >= 7, many.errors.join(" | "));
  const bot = await refused(() => subform.submit(payload(job, { website: "http://spam.example" })), "invalid");
  assert.deepEqual(bot.errors, ["That submission could not be accepted."]);
  const shut = await refused(() => subform.submit(payload(closedJob())), "invalid");
  assert.match(shut.message, /not open/);
  for (const amount of ["0", "5000000.01"]) await refused(() => subform.submit(payload(job, { amount })), "invalid");
  const out = await subform.submit(payload(job, { document: { type: "image/jpeg", size: 2048 } }));
  // a PNG where a JPEG was announced is removed and refused
  const wrong = new Blob([Buffer.alloc(2048, 1)], { type: "image/png" });
  await refused(() => subform.sendDocument(out.reference, out.upload, wrong, "image/png"), "invalid");
  assert.equal(E.objects.has(out.upload.path), false);
  // the token is for that one path, once
  const again = await subform.submit(payload(job));
  const other = Object.assign({}, again.upload, { path: again.upload.path.replace(/[0-9a-f]{32}/, "0".repeat(32)) });
  assert.equal(await subform.sendDocument(again.reference, other, new Blob([Buffer.alloc(9)], { type: "application/pdf" }), "application/pdf"), false);
});

test("the review queue: only the money editors read it, and nothing is asked for anyone else", { skip }, async () => {
  await setup();
  for (const k of ["admin", "accountant"]) {
    as(k);
    const d = await subs.list(me(k));
    assert.ok(d.all.length >= 4, k);
    assert.deepEqual(d.counts, { pending: 3, accepted: 0, rejected: 1 }, k);
    assert.equal(await subs.pendingCount(me(k)), 3);
    const noDoc = d.all.find((s) => s.reference === "SUB-C9TX-2PWF");
    assert.deepEqual([noDoc.canAccept, noDoc.hasDocument], [false, false]);
  }
  for (const k of ["manager", "manager_prices", "lead", "field", "viewer"]) {
    const asked = as(k);
    await refused(() => subs.list(me(k)), "42501");
    assert.equal(await subs.pendingCount(me(k)), null);
    assert.deepEqual(asked, [], k + ": nothing asked");
    // and the database answers them nothing anyway
    const c = clientAs(E, id(k));
    assert.deepEqual((await c.from("sub_submissions").select("id")).data, [], k + ": no rows");
  }
});

test("accept is not approve: an invoice -> a bill waiting for approval with its document; a second accept is 'already done'", { skip }, async () => {
  await setup();
  as("accountant");
  const d = await subs.list(me("accountant"));
  const inv = d.all.find((s) => s.reference === "SUB-7KQ4-HM3D");
  const row = await subs.accept(inv, null);
  assert.equal(row.state, "accepted");
  const bill = E.rows.bills.find((b) => b.id === row.bill_id);
  assert.deepEqual([bill.amount, bill.approved_at, bill.approved_by, bill.kind, bill.vendor_name], [4250, null, null, "Subcontractor", "Northwind Roofing"]);
  const doc = E.rows.files.find((f) => f.id === bill.document_file_id);
  assert.deepEqual([doc.storage_path, doc.folder, doc.source], [inv.document.path, "receipts", "subform"]);
  const e = await refused(() => subs.accept(inv, null), "23514");
  assert.match(e.message, /already done: that submission was already accepted by Casey Accounts/);
  // the queue now
  const after = await subs.list(me("accountant"));
  const a = after.all.find((s) => s.reference === "SUB-7KQ4-HM3D");
  assert.equal(a.billId, row.bill_id);
  assert.match(a.reviewedByName, /Casey/);
});

test("a change order -> the job's change order (awarded, its amount under prices); an invoice without paperwork is refused; a stale version is PT409", { skip }, async () => {
  await setup();
  as("admin");
  let d = await subs.list(me("admin"));
  const co = d.all.find((s) => s.reference === "SUB-RM6G-8JKV");
  await refused(() => subs.accept(Object.assign({}, co, { version: co.version + 5 }), null), "PT409");
  const row = await subs.accept(co, null);
  const q = E.rows.quotes.find((x) => x.id === row.quote_id);
  assert.deepEqual([q.kind, q.status, q.project_id], ["change_order", "awarded", co.projectId]);
  assert.equal(E.rows.quote_prices.find((x) => x.quote_id === q.id).amount, 860);
  const noDoc = d.all.find((s) => s.reference === "SUB-C9TX-2PWF");
  const e = await refused(() => subs.accept(noDoc, null), "23514");
  assert.match(e.message, /no document attached/);
  const r = await subs.reject(noDoc, "  Sent to the wrong   company  ");
  assert.deepEqual([r.state, r.review_note], ["rejected", "Sent to the wrong company"]);
  await refused(() => subs.reject(noDoc, "again"), "23514");
  // the quotes an invoice may bill against: the amount only with the prices switch
  as("admin");
  assert.ok((await subs.quotesFor(co.projectId, me("admin"))).some((x) => x.id === q.id && x.kind === "change_order" && x.amount === 860));
  as("manager");
  assert.ok((await subs.quotesFor(co.projectId, me("manager"))).some((x) => x.id === q.id && x.amount === null), "a manager without prices: no amount");
  as("accountant");
  d = await subs.list(me("accountant"));
  assert.deepEqual(d.counts, { pending: 1, accepted: 1, rejected: 2 }, "the invoice with its paperwork still waits");
});

test("people write no submission and review none without the switch: a manager without financials, a lead, the agents account", { skip }, async () => {
  await setup();
  const s = E.rows.sub_submissions[0];
  for (const k of ["manager", "lead", "field", "viewer"]) {
    const c = clientAs(E, id(k));
    const r = await c.rpc("accept_submission", { p_id: s.id, p_version: s.version, p_quote_id: null });
    assert.equal(r.error && r.error.code, "42501", k);
    const ins = await c.from("sub_submissions").insert({ reference: "SUB-2222-3333", kind: "invoice", project_id: s.project_id });
    assert.ok(ins.error, k + ": no insert");
  }
  const admin = clientAs(E, id("admin"));
  const up = await admin.from("sub_submissions").update({ amount: 1 }).eq("id", s.id).select("id");
  assert.deepEqual(up.data, [], "not even an admin changes what a submission says");
});

test("P5 check 5: nothing in this flow writes an amount into an activity row or an outbox body", { skip }, async () => {
  await setup();
  const job = openJob();
  const a0 = E.rows.activity.length, o0 = E.rows.notifications_outbox.length;
  const out = await subform.submit(payload(job, { amount: "9,876.54", description: "Glass for $9,876.54 total" }));
  await subform.sendDocument(out.reference, out.upload, new Blob([Buffer.alloc(4096, 1)], { type: "application/pdf" }), "application/pdf");
  as("accountant");
  const d = await subs.list(me("accountant"));
  await subs.accept(d.all.find((s) => s.reference === out.reference), null);
  const texts = E.rows.activity.slice(a0).map((r) => r.text).concat(E.rows.notifications_outbox.slice(o0).map((n) => n.subject + " " + n.body));
  for (const t of texts) assert.ok(!/9,?876|\$\s?\d/.test(String(t)), "an amount in: " + t);
});
