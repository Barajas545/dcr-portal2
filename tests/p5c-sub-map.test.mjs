// P5c subcontractor form and review - the pure rules: site/js/map/subform.js (the public page's checks and what it
// sends) and site/js/map/submissions.js (rows of public.sub_submissions -> the review page). Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import * as F from "../site/js/map/subform.js";
import * as S from "../site/js/map/submissions.js";

test("the public form relabels the fields for a change order instead of hiding them", () => {
  assert.deepEqual(F.KINDS, ["Invoice", "Change order"]);
  const inv = F.kindCopy("Invoice"), co = F.kindCopy("Change order");
  assert.equal(inv.head, "The invoice");
  assert.equal(co.head, "The change order");
  assert.match(co.desc, /extra work/);
  assert.match(inv.number, /invoice #/);
  assert.match(co.number, /reference #/);
});

test("a file's type: a photo, a scan or a PDF; a phone's HEIC with no type goes by its name; nothing else", () => {
  assert.equal(F.typeOf({ type: "image/jpeg", name: "x.jpg" }), "image/jpeg");
  assert.equal(F.typeOf({ type: "", name: "IMG_0001.HEIC" }), "image/heic");
  assert.equal(F.typeOf({ type: "", name: "scan.pdf" }), "application/pdf");
  assert.equal(F.typeOf({ type: "image/svg+xml", name: "x.svg" }), "");
  assert.equal(F.typeOf({ type: "text/html", name: "x.pdf" }), "", "the type the browser says wins over the name");
  assert.equal(F.typeOf({ type: "", name: "run.exe" }), "");
});

test("checkFile: up to 25 MB, not empty, with a label", () => {
  assert.deepEqual(F.checkFile({ type: "application/pdf", name: "inv.pdf", size: 2048 }), { ok: true, type: "application/pdf", size: 2048, label: "inv.pdf · 2 KB" });
  assert.equal(F.checkFile({ type: "application/pdf", name: "big.pdf", size: F.MAX_DOC + 1 }).ok, false);
  assert.match(F.checkFile({ type: "application/pdf", name: "big.pdf", size: F.MAX_DOC + 1 }).message, /25 MB/);
  assert.equal(F.checkFile({ type: "application/pdf", name: "e.pdf", size: 0 }).ok, false);
  assert.equal(F.checkFile({ type: "text/plain", name: "a.txt", size: 9 }).ok, false);
  assert.equal(F.fmtSize(3.4 * 1024 * 1024), "3.4 MB");
});

test("a found job reads 'A041 — Deck rebuild' over its town; a street address is never shown (owner, 2026-10-23)", () => {
  const p = { id: 41, number: "A041", name: "Deck rebuild", address: "12 Cedar Ln", city: "Pine Hollow" };
  assert.deepEqual(F.hitLines(p), { title: "A041 — Deck rebuild", where: "Pine Hollow" });
  assert.equal(F.pickedLabel(p), "A041 — Deck rebuild · Pine Hollow");
  assert.deepEqual(F.hitLines({ id: 1, number: "A1" }), { title: "A1", where: "" });
});

test("the page checks only what it alone knows (job picked, signed, paperwork), then sends what was typed", () => {
  assert.equal(F.localProblems({ project: null, signed: false, file: null }).length, 3);
  assert.deepEqual(F.localProblems({ project: { id: 1 }, signed: true, file: { type: "image/png", size: 9 } }), []);
  const body = F.payloadFor({ kind: "Change order", project: { id: 41 }, file: { type: "image/png", size: 900 } },
    { company: " Copperline ", contact: "Cy", email: "cy@x.example", phone: "", number: "CO-3", amount: "860", description: "Six outlets",
      date: "2026-10-01", due: "", signatureName: "Cy", signature: "data:image/png;base64,AAA", agree: true, website: "" });
  assert.deepEqual(body, { kind: "Change order", projectId: "41", vendorCompany: " Copperline ", contactName: "Cy", email: "cy@x.example", phone: "",
    invoiceNumber: "CO-3", amount: "860", description: "Six outlets", invoiceDate: "2026-10-01", dueDate: "", signatureName: "Cy",
    signature: "data:image/png;base64,AAA", agree: true, website: "", document: { type: "image/png", size: 900 } });
  assert.equal(F.payloadFor({ kind: "nonsense", project: null, file: null }, { agree: "yes" }).kind, "Invoice");
  assert.equal(F.payloadFor({ kind: "Invoice", project: null, file: null }, { agree: "yes" }).agree, false, "only a real tick");
  assert.equal(F.payloadFor({ kind: "Invoice", project: null, file: null }, {}).document, null);
});

const ROW = {
  id: 7, version: 2, reference: "SUB-7KQ4-HM3D", kind: "invoice", state: "pending", project_id: 41, project_label: "A041 — Deck rebuild (then)",
  vendor_company: "Northwind Roofing", contact_name: "Ari Northwind", contact_email: "ari@northwind-roofing.example", contact_phone: "(805) 555-0161",
  invoice_number: "1042", amount: "4250.00", description: "Trusses set", invoice_date: "2026-10-19", due_date: "2026-11-02", signature_name: "Ari Northwind",
  signed_at: "2026-10-21T17:05:00Z", signature_path: "f/41/receipts/" + "a".repeat(32) + "/SUB INVOICE SUB-7KQ4-HM3D signature.png",
  document_path: "f/41/receipts/" + "b".repeat(32) + "/SUB INVOICE SUB-7KQ4-HM3D.jpg", document_name: "SUB INVOICE SUB-7KQ4-HM3D.jpg",
  document_size: 1240000, document_mime: "image/jpeg", document_attached_at: "2026-10-21T17:06:00Z", submitted_ip: "203.0.113.21",
  reviewed_by: null, reviewed_at: null, review_note: null, bill_id: null, quote_id: null, document_file_id: null, created_at: "2026-10-21T17:05:00Z",
};

test("toSubmission: the job from the projects read (the label it was sent with otherwise), the paperwork once attached", () => {
  const s = S.toSubmission(ROW, { projects: new Map([["41", { number: "A041", name: "Deck rebuild" }]]), nameOf: () => "" });
  assert.deepEqual([s.reference, s.kindLabel, s.isCo, s.state, s.stateLabel, s.pending, s.projectLabel, s.amount, s.amountText],
    ["SUB-7KQ4-HM3D", "Invoice", false, "pending", "Waiting", true, "A041 — Deck rebuild", 4250, "$4,250.00"]);
  assert.deepEqual(s.document, { name: "SUB INVOICE SUB-7KQ4-HM3D.jpg", path: ROW.document_path, mime: "image/jpeg", size: 1240000 });
  assert.equal(s.signature.path, ROW.signature_path);
  assert.equal(s.signedDay, "2026-10-21");
  assert.deepEqual([s.canAccept, s.acceptWhy, s.hasDocument], [true, "", true]);
  assert.equal(S.toSubmission(ROW, {}).projectLabel, "A041 — Deck rebuild (then)");
});

test("an invoice whose paperwork never arrived cannot be accepted, and says why (a change order can)", () => {
  const announced = S.toSubmission(Object.assign({}, ROW, { document_attached_at: null }), {});
  assert.deepEqual([announced.document, announced.hasDocument, announced.documentAnnounced, announced.canAccept], [null, false, true, false]);
  assert.match(announced.acceptWhy, /SUB-7KQ4-HM3D/);
  const none = S.toSubmission(Object.assign({}, ROW, { document_attached_at: null, document_path: null }), {});
  assert.equal(none.documentAnnounced, false);
  const co = S.toSubmission(Object.assign({}, ROW, { kind: "change_order", document_attached_at: null, document_path: null }), {});
  assert.deepEqual([co.isCo, co.kindLabel, co.canAccept, co.acceptWhy], [true, "Change order", true, ""]);
});

test("a reviewed one: who, when, what it became, the note", () => {
  const acc = S.toSubmission(Object.assign({}, ROW, { state: "accepted", reviewed_by: "u1", reviewed_at: "2026-10-22T01:30:00Z", bill_id: 16 }),
    { nameOf: (u) => (u === "u1" ? "Casey Accounts" : ""), bills: new Map([["16", { id: 16, approved_at: null, void: false, deleted_at: null }]]) });
  assert.equal(acc.canAccept, false);
  assert.equal(S.reviewedLine(acc), "Accepted by Casey Accounts on Oct 21, 2026 · bill #16 (waiting for approval)", "the company day (Pacific)");
  // the bill's state as it is now (never a status the page cannot know)
  const approved = S.toSubmission(Object.assign({}, ROW, { state: "accepted", reviewed_at: "2026-10-22T01:30:00Z", bill_id: 16 }),
    { bills: new Map([["16", { id: 16, approved_at: "2026-10-23T17:00:00Z", void: false, deleted_at: null }]]) });
  assert.equal(S.reviewedLine(approved), "Accepted on Oct 21, 2026 · bill #16 (approved)");
  const unknown = S.toSubmission(Object.assign({}, ROW, { state: "accepted", reviewed_at: "2026-10-22T01:30:00Z", bill_id: 16 }), {});
  assert.equal(S.reviewedLine(unknown), "Accepted on Oct 21, 2026 · bill #16", "not read: no status said");
  assert.equal(S.billState({ void: true }), "void");
  assert.equal(S.billState({ deleted_at: "2026-10-23T00:00:00Z" }), "removed");
  const rej = S.toSubmission(Object.assign({}, ROW, { state: "rejected", reviewed_by: "u1", reviewed_at: "2026-10-20T18:00:00Z", review_note: "Duplicate" }),
    { nameOf: () => "Casey Accounts" });
  assert.equal(S.reviewedLine(rej), "Rejected by Casey Accounts on Oct 20, 2026 — Duplicate");
  const co = S.toSubmission(Object.assign({}, ROW, { kind: "change_order", state: "accepted", reviewed_at: "2026-10-20T18:00:00Z", quote_id: 9 }), {});
  assert.equal(S.reviewedLine(co), "Accepted on Oct 20, 2026 · change order #9 on the job");
});

test("the e-mail about a waiting submission (the old 'Nobody was emailed about this'): sent says nothing, waiting a while a quiet note, not sent a warning with why", () => {
  const now = Date.parse("2026-10-23T18:00:00Z");
  assert.equal(S.noticeLine(null), null, "nothing known: nothing said");
  assert.equal(S.noticeLine({ state: "sent", sentAt: "2026-10-23T17:00:00Z" }), null);
  assert.equal(S.noticeLine({ state: "waiting" }, "2026-10-23T17:50:00Z", now), null, "just sent in: not yet worth a word");
  assert.deepEqual(S.noticeLine({ state: "waiting" }, "2026-10-23T16:00:00Z", now),
    { warn: false, text: "The e-mail about it has not gone out yet (DCR Agents 2 sends it)." });
  const said = (why) => S.noticeLine({ state: "not_sent", why }, "2026-10-20T16:00:00Z", now);
  assert.deepEqual(said("expired: not sent within 3 days"), { warn: true, text: "Nobody was e-mailed about this: it was not sent within 3 days (is DCR Agents 2 running?)." });
  assert.match(said("not sent: e-mails about subcontractor submissions are turned off (DCR Desktop 2, Settings)").text, /turned off/);
  assert.match(said("not sent: nobody to tell (no active admin, accountant with financials or approver with an e-mail address)").text, /nobody to tell/);
  assert.match(said("no notice was written").text, /no notice was written/);
  assert.match(said("SMTP 550 mailbox unavailable").text, /could not be sent \(SMTP 550/);
  const row = S.toSubmission(ROW, { notices: new Map([[String(ROW.id), { state: "not_sent", why: "expired: not sent within 3 days" }]]), now });
  assert.equal(row.notice.warn, true, "on the card of a waiting submission");
  const done = S.toSubmission(Object.assign({}, ROW, { state: "rejected", reviewed_at: "2026-10-22T00:00:00Z" }),
    { notices: new Map([[String(ROW.id), { state: "not_sent", why: "skipped: the submission was already reviewed" }]]), now });
  assert.equal(done.notice, null, "a reviewed one: nothing to warn about");
});

test("the database's refusals in plain words; 'already done' and PT409 mean look again", () => {
  const done = { code: "23514", message: "already done: that submission was already accepted by Casey Accounts" };
  assert.equal(S.refusalText(done), "Already done — that submission was already accepted by Casey Accounts.");
  assert.equal(S.isStale(done), true);
  assert.equal(S.isStale({ code: "PT409", message: "the submission was changed by someone else" }), true);
  assert.match(S.refusalText({ code: "PT409", message: "x" }), /changed this submission/);
  const nodoc = { code: "23514", message: "That invoice has no document attached, so it could never be approved for payment." };
  assert.equal(S.isStale(nodoc), false);
  assert.equal(S.refusalText(nodoc), nodoc.message);
});

test("who reviews: an admin, or a manager or accountant with the financials switch (Appendix D)", () => {
  const p = (role, fin) => ({ role, active: true, can_see_financials: !!fin });
  assert.equal(S.canReview(p("admin")), true);
  assert.equal(S.canReview(p("accountant", true)), true);
  assert.equal(S.canReview(p("manager", true)), true);
  for (const [role, fin] of [["manager", false], ["accountant", false], ["lead", true], ["field", true], ["viewer", true], ["agents", false]]) {
    assert.equal(S.canReview(p(role, fin)), false, role + " " + fin);
  }
  assert.equal(S.canReview(Object.assign(p("admin"), { active: false })), false);
});

test("counts, the quotes an invoice may bill against (amount only when the prices switch gave one)", () => {
  assert.deepEqual(S.counts([{ state: "pending" }, { state: "pending" }, { state: "rejected" }, { state: "odd" }]), { pending: 2, accepted: 0, rejected: 1 });
  assert.deepEqual(S.quoteOption({ id: 3, kind: "change_order", status: "awarded", vendor_name: "Copperline", amount: 860 }),
    { value: "3", label: "CO · Copperline (awarded) · $860.00" });
  assert.deepEqual(S.quoteOption({ id: 4, kind: "quote", status: "received", vendor_name: "Northwind", amount: null }),
    { value: "4", label: "Quote · Northwind (received)" });
});
