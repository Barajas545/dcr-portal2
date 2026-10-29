// The Books program, release A (P1): the money files on the web - a bill's document and extras, a payment's files, a
// cost's several receipts. Over the demo database with the money files' rules (tools/fake/p8-files.js: payment_id, no
// version for a money file but "name (2)", the safe shape, money editors remove, the bill's guarded document) and the
// pages' own rules read from their source. tools/schema-check-p8-files.mjs runs the same modules against the REAL
// migration (20261030000100_money_files) in PGlite. Made-up people and jobs only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { available, loadFake, freshEngine, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import { clearPeople } from "../site/js/repo/people.js";
import * as books from "../site/js/repo/books.js";
import * as filesRepo from "../site/js/repo/files.js";
import { createQueue } from "../site/js/upload-queue2.js";
import * as FV from "../site/js/pages/file-viewer.js";          // landingProblem, claimStage: asserted, not imported by name
import { paperwork, documentProblem, withdrawsApproval, WITHDRAW_TEXT, paymentFileLabel, kindOf, fileOf } from "../site/js/pages/file-viewer.js";

const skip = !available && "the demo database (tools/fake) is not here";
const NOW = new Date("2026-10-19T18:00:00Z");
const WHEN = "2026-10-19T17:30:12Z";
const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

let F, E;
async function setup() {
  F = await loadFake();
  E = await freshEngine(NOW);
}
const uid = (key) => F.PEOPLE.find((p) => p.key === key).id;
function me(key) {
  const p = E.rows.profiles.find((x) => x.id === uid(key));
  const admin = p.role === "admin";
  return { id: p.id, name: p.full_name, role: p.role, active: p.active !== false, can_see_prices: admin || !!p.can_see_prices,
    can_see_financials: admin || !!p.can_see_financials, can_approve_payments: admin || !!p.can_approve_payments };
}
function as(key) { useClient(clientAs(E, uid(key))); clearPeople(); }
const billOf = (desc) => E.rows.bills.find((b) => b.description === desc);
async function refused(fn, code, re) {
  try { await fn(); } catch (e) { assert.equal(e.code, code, e.message); if (re) assert.match(e.message, re); return e; }
  assert.fail("expected " + code);
}
const blob = (size, type) => new Blob([new Uint8Array(size).fill(3)], { type });
const fileNamed = (name, type, size) => new File([new Uint8Array(size || 900)], name, { type });

/** The upload queue over this demo database as `key` (its Storage and files table, with every rule). */
function queueAs(key) {
  const user = uid(key);
  const ctx = () => ({ uid: user });
  const store = new Map();
  const q = createQueue({
    store: { put: async (v) => { store.set(v.id, Object.assign({}, v)); }, del: async (id) => { store.delete(id); },
      all: async () => Array.from(store.values()).map((v) => Object.assign({}, v)) },
    send: async (req) => {
      const r = E.storage.request(req.method, new URL(req.url).pathname, req.headers, req.body);
      if (req.onProgress && r.status < 300 && req.body) req.onProgress(req.body.size);
      return { status: r.status, header: (n) => (r.headers[n.toLowerCase()] ?? null), text: () => r.text };
    },
    auth: async () => ({ url: "https://demo-ref.supabase.co", apikey: "publishable", token: user }),
    owner: () => user,
    db: {
      findByPath: async (k) => E.select(ctx(), "files", { columns: "*", filters: [{ col: "storage_path", op: "eq", val: k }] }).data[0] || null,
      nameTaken: async () => false,
      insert: async (row) => E.insert(ctx(), "files", row)[0],
    },
    now: () => NOW.getTime(),
    setTimeout: () => 0, clearTimeout: () => {},
    makePreview: async (f, mime) => (/^image\//.test(mime) ? blob(300, "image/jpeg") : null),
  });
  const done = [];
  q.onProgress((items, evt) => { if (evt && evt.type === "done") done.push(evt); });
  return { q, store, done };
}

/* ── pure: the paperwork's order, labels and rules (js/pages/file-viewer.js) ── */

test("paperwork(): the document first, then the extras, then each payment's files labelled \"Check #1043 · Oct 28\"", () => {
  const bill = { id: 5, documentFileId: 11, approved: true, paid: 400 };
  const pays = [{ id: 70, method: "check", checkNumber: "1043", paidDate: "2026-10-28" }, { id: 71, method: "ach", reference: "ACH 0041", paidDate: "2026-10-20" }];
  const files = [{ id: 13, name: "photo of check.jpg", paymentId: 70 }, { id: 12, name: "site photo.jpg", paymentId: null }, { id: 11, name: "INV-4101.pdf" },
    { id: 14, name: "ach.pdf", paymentId: 71 }];
  const pw = paperwork(bill, files, pays);
  assert.deepEqual(pw.map((f) => [f.id, f.role]), [[11, "document"], [12, "extra"], [13, "payment"], [14, "payment"]]);
  assert.deepEqual(pw.map((f) => f.label), ["The bill's document", "Another file of this bill", "Proof of payment: Check #1043 · Oct 28",
    "Proof of payment: ACH transfer · ACH 0041 · Oct 20"]);
  assert.equal(paymentFileLabel({ method: "cash", paidDate: "2026-10-28" }), "Cash · Oct 28");
  assert.deepEqual(paperwork({ documentFileId: null }, [{ id: 1, name: "a.pdf" }], []).map((f) => f.role), ["extra"], "no document: every file an extra");
});

test("documentProblem / withdrawsApproval: refused before any byte moves (void, entered, paid); asked first on an approved bill", () => {
  assert.equal(documentProblem({}), "");
  assert.match(documentProblem({ void: true }), /voided/);
  assert.match(documentProblem({ entered: true, paid: 0 }), /marked entered in QuickBooks: unmark it in the Books first/);
  assert.match(documentProblem({ paid: 12.5 }), /has payments: its document stays as it is/);
  assert.equal(withdrawsApproval({ approved: true }), true);
  assert.equal(withdrawsApproval({ approved: false }), false);
  assert.match(WITHDRAW_TEXT, /withdraws the approval — the bill goes back to waiting/);
});

test("fileOf / kindOf: every repo's file shape; a HEIC said, a local file never opened", () => {
  assert.deepEqual(fileOf({ id: 1, name: "a.jpg", storagePath: "f/1/receipts/x/a.jpg", previewPath: "f/1/receipts/x/preview-320.jpg", cloud: true, paymentId: 9 }),
    { id: 1, name: "a.jpg", mime: "", size: null, local: false, path: "f/1/receipts/x/a.jpg", preview: "f/1/receipts/x/preview-320.jpg", billId: null, paymentId: 9, version: null });
  assert.equal(fileOf({ path: "p", preview: "q", storage: "cloud" }).preview, "q", "repo/ledger.js's receipts");
  assert.equal(fileOf({ storage_path: "s", preview_path: "t", payment_id: 4 }).paymentId, 4, "a files row");
  assert.equal(kindOf({ name: "a.JPG", path: "x" }), "image");
  assert.equal(kindOf({ name: "IMG_1.HEIC", mime: "image/heic", path: "x" }), "heic");
  assert.equal(kindOf({ name: "a.pdf", path: "x" }), "pdf");
  assert.equal(kindOf({ name: "a.dwg", path: "x" }), "file");
  assert.equal(kindOf({ name: "a.pdf", cloud: false, storagePath: "x" }), "local");
});

/* ── the repository: FILE_COLS and setDocument over the demo database ── */

test("loadBill: the bill's files carry payment_id, the preview and the version (FILE_COLS)", { skip }, async () => {
  await setup();
  for (const c of ["payment_id", "preview_path", "version"]) assert.ok(books.FILE_COLS.split(", ").includes(c), c);
  as("accountant");
  const b = billOf("Footings and stem wall, phase 1");
  const d = await books.loadBill(b.id, me("accountant"));
  assert.ok(d.files.length >= 1);
  const f = d.files[0];
  assert.ok("paymentId" in f && "previewPath" in f && "version" in f && f.version >= 1, JSON.stringify(f));
  assert.equal(f.primary, true);
});

test("setDocument: a blocked bill gets its document (books_desk: waiting); an approved one loses its approval; entered or paid refused; PT409 sent again", { skip }, async () => {
  await setup();
  as("accountant");
  const blocked = billOf("Roof framing package (back order)");
  const { q, done } = queueAs("accountant");
  await q.enqueue({ projectId: blocked.project_id, file: fileNamed("Marlow back order.pdf", "application/pdf"), kind: "bill", billId: blocked.id, name: "Marlow back order.pdf", tag: "document", takenAt: WHEN });
  await q.drain();
  assert.equal(done.length, 1);
  assert.equal(done[0].item.tag, "document");
  const desk0 = E.select({ uid: uid("accountant") }, "books_desk", { columns: "id, state", filters: [{ col: "id", op: "eq", val: blocked.id }] }).data[0];
  assert.equal(desk0.state, "blocked");
  const before = (await books.loadBill(blocked.id, me("accountant"))).bill;
  const row = await books.setDocument(before, done[0].row.id);
  assert.equal(row.document_file_id, done[0].row.id);
  const desk1 = E.select({ uid: uid("accountant") }, "books_desk", { columns: "id, state", filters: [{ col: "id", op: "eq", val: blocked.id }] }).data[0];
  assert.equal(desk1.state, "waiting", "the bill moves from blocked to waiting");

  // an approved bill: the new document withdraws the approval (the database clears it)
  const appr = billOf("-10% retainage held until the final walk");
  assert.ok(appr.approved_at);
  const a = await queueAs("accountant");
  await a.q.enqueue({ projectId: appr.project_id, file: fileNamed("Rosewell corrected.pdf", "application/pdf"), kind: "bill", billId: appr.id, name: "Rosewell corrected.pdf", takenAt: WHEN });
  await a.q.drain();
  const ab = (await books.loadBill(appr.id, me("accountant"))).bill;
  // the bill changed meanwhile (someone else) and it is approved: not sent again without the person's yes
  E.update({ uid: uid("admin") }, "bills", { description: "Retainage per the contract (checked)" }, { filters: [{ col: "id", op: "eq", val: appr.id }] });
  await refused(() => books.setDocument(ab, a.done[0].row.id), "PT409");
  const back = await books.setDocument(ab, a.done[0].row.id, { withdraw: true });
  assert.equal(back.document_file_id, a.done[0].row.id, "sent again at the new version");
  assert.equal(back.approved_at, null, "the approval is withdrawn");
  assert.ok(E.rows.files.find((f) => f.id === ab.documentFileId && !f.deleted_at), "the old document stays, an extra (only re-pointed)");

  // entered in QuickBooks, or paid: the bills trigger refuses (the page refuses before upload: documentProblem)
  const entered = billOf("Porch footings");
  const eb = (await books.loadBill(entered.id, me("accountant"))).bill;
  assert.match(documentProblem(eb), /entered in QuickBooks/);
  const e = queueAs("accountant");
  await e.q.enqueue({ projectId: entered.project_id, file: fileNamed("Brightwater corrected.pdf", "application/pdf"), kind: "bill", billId: entered.id, name: "Brightwater corrected.pdf", takenAt: WHEN });
  await e.q.drain();
  assert.equal(e.done.length, 1, "an extra on an entered bill is fine: only its document stays");
  await refused(() => books.setDocument(eb, e.done[0].row.id), "23514", /marked entered in QuickBooks/);
});

test("the queue's money kinds over the demo database: \"name (2)\", a payment's file, the safe shape, who may", { skip }, async () => {
  await setup();
  const b = billOf("Footings and stem wall, phase 1");
  const { q, store, done } = queueAs("accountant");
  for (let i = 0; i < 2; i++) {
    await q.enqueue({ projectId: b.project_id, file: fileNamed("INV-4101.pdf", "application/pdf", 900 + i), kind: "bill", billId: b.id, name: "INV-4101.pdf", takenAt: WHEN });
  }
  // two pastes in the same second: the queue's own -n
  await q.enqueue({ projectId: b.project_id, file: blob(500, "image/png"), kind: "bill", billId: b.id, takenAt: WHEN });
  await q.enqueue({ projectId: b.project_id, file: blob(510, "image/png"), kind: "bill", billId: b.id, takenAt: WHEN });
  await q.drain();
  assert.deepEqual(done.map((e) => e.row.name), ["INV-4101.pdf", "INV-4101 (2).pdf", "Bill 2026-10-19 10.30.12.png", "Bill 2026-10-19 10.30.12-2.png"]);
  assert.ok(done.every((e) => e.row.version_no === 1 && e.row.previous_id === null && e.row.bill_id === b.id && e.row.payment_id === null && e.row.folder === "receipts"),
    "own rows, never versions");
  assert.ok(done.slice(2).every((e) => /\/preview-320\.jpg$/.test(e.row.preview_path || "")), "a picture's preview goes up first, as today");
  assert.equal(store.size, 0);

  // a payment's file: the payment's own bill and the payment
  const paid = billOf("Telehandler, one week");
  const pay = E.rows.payments.find((p) => p.bill_id === paid.id);
  const p1 = queueAs("accountant");
  await p1.q.enqueue({ projectId: paid.project_id, file: blob(700, "image/jpeg"), kind: "payment", billId: paid.id, paymentId: pay.id, takenAt: WHEN });
  await p1.q.drain();
  assert.deepEqual([p1.done[0].row.bill_id, p1.done[0].row.payment_id, p1.done[0].row.name], [paid.id, pay.id, "Payment 2026-10-19 10.30.12.jpg"]);
  // the payment of another bill: refused at the row (the database's sentence on the item)
  const p2 = queueAs("accountant");
  await p2.q.enqueue({ projectId: b.project_id, file: blob(700, "image/jpeg"), kind: "payment", billId: b.id, paymentId: pay.id, takenAt: WHEN });
  await p2.q.drain();
  const bad = Array.from(p2.store.values())[0];
  assert.equal(bad.state, "failed");
  assert.match(bad.error, /The payment belongs to another bill\.|belongs to another/);

  // a type DCR Desktop 2 would not open: the database's 22023 sentence on the line
  const x = queueAs("accountant");
  await x.q.enqueue({ projectId: b.project_id, file: fileNamed("setup.exe", "application/octet-stream"), kind: "bill", billId: b.id, name: "setup.exe", takenAt: WHEN });
  await x.q.drain();
  const ex = Array.from(x.store.values())[0];
  assert.equal(ex.state, "failed");
  assert.match(ex.error, /This kind of file can't be attached to money: save it as a PDF or a picture/);

  // without the money switches: Storage refuses the f/ object - the line says so, nothing is in files
  for (const k of ["manager", "lead", "field"]) {
    const n = queueAs(k);
    await n.q.enqueue({ projectId: b.project_id, file: fileNamed("INV-9.pdf", "application/pdf"), kind: "bill", billId: b.id, name: "INV-9.pdf", takenAt: WHEN });
    await n.q.drain();
    const it = Array.from(n.store.values())[0];
    assert.equal(it.state, "failed", k);
    assert.match(it.error, /permission/, k);
  }
  assert.ok(!E.rows.files.some((f) => f.name === "INV-9.pdf"), "no row for them");
});

test("removing money files: any money editor removes an extra (I4); the approved, paid or entered document stays - for an admin too", { skip }, async () => {
  await setup();
  const b = billOf("-10% retainage held until the final walk");
  const { q, done } = queueAs("admin");
  await q.enqueue({ projectId: b.project_id, file: fileNamed("wrong paste.png", "image/png"), kind: "bill", billId: b.id, name: "wrong paste.png", takenAt: WHEN });
  await q.drain();
  const extra = done[0].row;
  as("accountant");
  await filesRepo.removeFile({ id: extra.id, version: extra.version });
  assert.ok(E.rows.files.find((f) => f.id === extra.id).deleted_at, "the accountant removed the admin's wrong paste (a soft delete)");
  for (const k of ["accountant", "admin"]) {
    as(k);
    const doc = E.rows.files.find((f) => f.id === b.document_file_id);
    await refused(() => filesRepo.removeFile({ id: doc.id, version: doc.version }), "23514", /approved document of a bill: replace the document first/);
  }
  const entered = billOf("Porch footings");
  const edoc = E.rows.files.find((f) => f.id === entered.document_file_id);
  as("admin");
  await refused(() => filesRepo.removeFile({ id: edoc.id, version: edoc.version }), "23514", /entered in QuickBooks/);
  as("manager");
  await refused(() => filesRepo.removeFile({ id: extra.id }), "PT404");
});

/* ── the pages' own rules, read from their source ── */

test("the bill page: the paperwork for money editors only, the Remove never on the document, refused before upload, asked on an approved bill", () => {
  const js = code(read("js/pages/bill.js"));
  assert.match(js, /return !!\(d && d\.can && d\.can\.pay && !d\.bill\.void && !d\.bill\.deleted\);/, "editsPaper: money editors, a live bill");
  assert.match(js, /if \(edit\) wirePaper\(hasDoc\);/);
  assert.match(js, /if \(f\.role === "document" && kindOf\(f\) !== "local"\) barButton\(bar, "Replace…"/);
  assert.match(js, /if \(f\.role === "extra"\) barButton\(bar, "Make this the bill's document"/);
  assert.match(js, /if \(f\.role !== "document"\) barButton\(bar, "Remove"/);
  assert.match(js, /async function removeFile\(f\) \{\s+if \(f\.role === "document"\) return;/, "never the document");
  // refused before any byte moves: the problem is asked first, before the picker or the queue
  const rep = js.slice(js.indexOf("function replaceDocument("));
  assert.ok(rep.indexOf("documentProblem(") < rep.indexOf(".click()"), "Replace: the rule before the picker");
  const add = js.slice(js.indexOf("async function addFiles("));
  assert.ok(add.indexOf("documentProblem(") < add.indexOf("queueAll("), "the first document: the rule before the queue");
  assert.ok(add.indexOf("agreeWithdraw(") < add.indexOf("queueAll("), "the approved bill: asked before the queue");
  assert.match(js, /return confirmBox\(WITHDRAW_TEXT, \{ title: "This bill is approved", okText: "Change the document" \}\);/);
  // the link after the upload: the queue's tag; a replaced document removed after the bill points at the new one
  assert.match(js, /if \(row && row\.id != null && \/\^document!\?\$\/\.test\(tag\)\) return link\(row\.id, tag === "document!", null, true, row\.name \|\| item\.name\);/);
  const link = js.slice(js.indexOf("function link("));
  assert.ok(link.indexOf("books.setDocument(") < link.indexOf("filesRepo.removeFile({ id: oldId })"), "point first, then remove the old one");
  // nothing approves here that did not before, and the approve button is still the approvers'
  assert.equal((js.match(/books\.approve\(/g) || []).length, 1);
  for (const f of ["js/pages/file-drop.js", "js/pages/file-viewer.js"]) assert.ok(!/approve_bill|\.approve\(/.test(code(read(f))), f + ": no approve call");
  // a file name is data: in the page's markup only through h()
  const marks = js.match(/\+ (f|it|x)\.name\b/g) || [];
  assert.ok(!/innerHTML[^;]*\+ f\.name/.test(js) && !/'[^']*' \+ f\.name \+ '/.test(js), "no raw name in markup: " + marks.join(","));
  assert.ok(/h\(f\.name\)/.test(js), "names through h()");
  // the files' look: the page's wording points at the web now
  assert.match(js, /attach it here \(or in DCR Desktop 2\)/);
  assert.ok(!/It cannot be approved until one is \(in DCR Desktop 2\)/.test(js));
});

/* ── review fixes (release A): races and the void, read from the source and run over the demo database ── */

test("\"Make this the bill's document\" withdraws an approval only when the person was asked: a bill approved after the page was drawn is refused (PT409), the approval kept", { skip }, async () => {
  const js = code(read("js/pages/bill.js"));
  const mk = js.slice(js.indexOf("async function makeDocument("), js.indexOf("async function removeFile("));
  assert.match(mk, /if \(!\(await agreeWithdraw\(b\)\)\) return;\s+await link\(f\.id, withdrawsApproval\(b\), null\);/, "withdraw = what the person was asked");
  assert.ok(!/link\(f\.id, true/.test(mk), "never a literal yes");
  // what that call does when an approver approves meanwhile (the bill on screen still says "waiting")
  await setup();
  as("accountant");
  const b = billOf("Footings and stem wall, phase 1");
  const { q, done } = queueAs("accountant");
  await q.enqueue({ projectId: b.project_id, file: fileNamed("Quarryman corrected.pdf", "application/pdf"), kind: "bill", billId: b.id, name: "Quarryman corrected.pdf", takenAt: WHEN });
  await q.drain();
  const shown = (await books.loadBill(b.id, me("accountant"))).bill;
  assert.equal(shown.approved, false);
  E.rpc({ uid: uid("admin") }, "approve_bill", { id: b.id, pay_method: "check", version: E.rows.bills.find((x) => x.id === b.id).version, note: null });
  assert.ok(E.rows.bills.find((x) => x.id === b.id).approved_at, "approved behind the page");
  await refused(() => books.setDocument(shown, done[0].row.id, { withdraw: withdrawsApproval(shown) }), "PT409");
  const now = E.rows.bills.find((x) => x.id === b.id);
  assert.ok(now.approved_at, "the approval is kept");
  assert.equal(now.document_file_id, b.document_file_id, "the document is the one the approver saw");
});

test("the first file to land is the bill's document: a later batch queued before it landed stays an extra (checked inside the one-at-a-time chain); two Replace… in a row end on the newest", () => {
  const js = code(read("js/pages/bill.js"));
  const link = js.slice(js.indexOf("function link("), js.indexOf("function paintQueue("));
  const guard = link.indexOf("if (onlyIfNone) await load();");
  assert.ok(guard !== -1 && guard < link.indexOf("books.setDocument("), "the guard runs before the bill is pointed at the file");
  assert.ok(link.indexOf("state.chain = state.chain.then(") < guard, "inside the chain: after the file before it has been linked and the page read again");
  assert.match(link.slice(guard), /^if \(onlyIfNone\) await load\(\);\s+const why = landingProblem\(state\.data\.bill, state\.files, \{ first: !!onlyIfNone, agreed: !!agreed \}\);\s+if \(why === "has"\) \{[\s\S]*?return;/,
    "read again; a live document already there wins (judged on the paperwork drawn from that read)");
  assert.match(js, /return link\(row\.id, tag === "document!", null, true, /, "a \"document\" tag links only while the bill has none");
  assert.match(js, /return link\(row\.id, m\[1\] === "!", m\[2\]\);/, "a replace is not that guard");
  // a replace removes the old document only while it is still the bill's document
  assert.match(link, /const replaces = oldId != null && String\(state\.data\.bill\.documentFileId\) === String\(oldId\);/);
  assert.match(link, /if \(replaces\) \{\s+try \{ await filesRepo\.removeFile\(\{ id: oldId \}\);/);
  // the words of a refused link are written after the page is drawn again (a redraw would wipe them)
  const caught = link.slice(link.indexOf("} catch (e) {"));
  assert.ok(caught.indexOf("await load();") < caught.indexOf("sayFile(conflict"), "load, then say");
});

/* ── review fixes 2 (release A): a write that matches a version read AFTER an approval; a pointer to a removed file ── */

test("landingProblem: a first file loses to a LIVE document only; nobody asked and the bill approved -> kept an extra; a yes goes on", () => {
  assert.equal(typeof FV.landingProblem, "function", "file-viewer.js decides what a landed file may do");
  const L = FV.landingProblem;
  assert.equal(L({ approved: false }, [], {}), "");
  assert.equal(L({ approved: false, documentFileId: 9 }, [{ id: 3, role: "extra" }], { first: true }), "", "a pointer to a removed file is no document");
  assert.equal(L({ approved: false, documentFileId: 9 }, [{ id: 9, role: "document" }], { first: true }), "has");
  assert.equal(L({ approved: true, documentFileId: 9 }, [{ id: 9, role: "document" }], { first: true }), "has", "the first file to land wins first");
  assert.equal(L({ approved: true }, [], { agreed: false }), "approved", "never a silent withdrawal");
  assert.equal(L({ approved: true }, [], { agreed: true }), "", "the person was asked and said yes");
  assert.equal(L({ approved: false }, [{ id: 9, role: "document" }], { agreed: false }), "", "a replace on a waiting bill");
});

test("a Replace… queued on a waiting bill (nobody asked: \"replace:<id>\"), approved before it landed and read again: the file stays an extra - the approval, the document and the old file kept", { skip }, async () => {
  // the page's rule, read from its source: judged on the bill as the page holds it now, before any write
  const js = code(read("js/pages/bill.js"));
  const link = js.slice(js.indexOf("function link("), js.indexOf("function paintQueue("));
  const judged = link.indexOf("const why = landingProblem(state.data.bill, state.files, ");
  const kept = link.indexOf('if (why === "approved") {');
  assert.ok(judged !== -1 && kept > judged && kept < link.indexOf("books.setDocument(") && kept < link.indexOf("const replaces = "), "judged before the bill is pointed at the file or the old one removed");
  assert.match(link.slice(kept), /^if \(why === "approved"\) \{\s+if \(!onlyIfNone\) await load\(\);\s+sayFile\("The bill was approved meanwhile: the file is kept as another file of the bill\.[^"]*", true\);\s+return;\s+\}/,
    "drawn again (the landed file shows as an extra), then said");
  assert.match(js, /return link\(row\.id, m\[1\] === "!", m\[2\]\);/, "a replace's yes is the one stored in its tag");
  // over the demo database: what the page holds when the file lands
  await setup();
  as("accountant");
  const b = billOf("Footings and stem wall, phase 1");
  const docId = b.document_file_id;
  const shown = (await books.loadBill(b.id, me("accountant"))).bill;
  assert.equal(withdrawsApproval(shown), false, "waiting when Replace… is pressed: nothing asked");
  const tag = (withdrawsApproval(shown) ? "replace!:" : "replace:") + shown.documentFileId;
  const { q, done } = queueAs("accountant");
  await q.enqueue({ projectId: b.project_id, file: fileNamed("Quarryman corrected invoice.pdf", "application/pdf"), kind: "bill", billId: b.id,
    name: "Quarryman corrected invoice.pdf", tag, takenAt: WHEN });
  // an approver approves it while the file waits on the device; the page reads the bill again (reopened over the
  // durable queue, another file landing, a Remove, an approve): it now holds the approved row at its new version
  E.rpc({ uid: uid("admin") }, "approve_bill", { id: b.id, pay_method: "check", version: E.rows.bills.find((x) => x.id === b.id).version, note: null });
  const held = await books.loadBill(b.id, me("accountant"));
  assert.equal(held.bill.approved, true);
  await q.drain();
  assert.equal(done.length, 1);
  const m = /^replace(!?):(\d+)$/.exec(done[0].item.tag);
  assert.ok(m && m[1] === "" && m[2] === String(docId), done[0].item.tag);
  // landed() -> link(row.id, m[1] === "!", m[2]): no read first, so the bill and its paperwork as held
  const why = FV.landingProblem(held.bill, paperwork(held.bill, held.files, held.payments), { first: false, agreed: m[1] === "!" });
  assert.equal(why, "approved", "kept an extra: nothing is written");
  const now = E.rows.bills.find((x) => x.id === b.id);
  assert.ok(now.approved_at && now.document_file_id === docId, "the approval and the document the approver saw are kept");
  assert.ok(!E.rows.files.find((f) => f.id === docId).deleted_at, "the old document is not removed");
  assert.ok(!E.rows.files.find((f) => f.id === done[0].row.id).deleted_at, "the new file is there, another file of the bill");
  // the trap: that write at the version held matches (no PT409) and the database withdraws the approval
  const sent = await books.setDocument(held.bill, done[0].row.id, { withdraw: false });
  assert.equal(sent.approved_at, null, "why the page must not send it");
});

test("a bill whose document was removed (the pointer left behind) takes the first file dropped on it as its document: judged on the live paperwork, not the bare pointer", { skip }, async () => {
  const js = code(read("js/pages/bill.js"));
  const link = js.slice(js.indexOf("function link("), js.indexOf("function paintQueue("));
  assert.ok(!/state\.data\.bill\.documentFileId != null/.test(link), "never the bare pointer");
  assert.match(js, /const hasDoc = state\.files\.some\(\(f\) => f\.role === "document"\);/, "the drop tags its first file by the same paperwork");
  await setup();
  as("accountant");
  const b = billOf("Concrete pump rental (not estimated)");
  assert.ok(!b.approved_at && b.document_file_id != null);
  const old = E.rows.files.find((f) => f.id === b.document_file_id);
  // an unapproved, unpaid bill: the database lets its document go (Desktop's Files page, an old tab's Remove)
  await filesRepo.removeFile({ id: old.id, version: old.version });
  const d = await books.loadBill(b.id, me("accountant"));
  assert.equal(String(d.bill.documentFileId), String(old.id), "the pointer stays behind");
  assert.ok(!paperwork(d.bill, d.files, d.payments).some((f) => f.role === "document"), "no live document: the drop's first file is tagged \"document\"");
  const { q, done } = queueAs("accountant");
  await q.enqueue({ projectId: b.project_id, file: fileNamed("Hillside pump invoice.pdf", "application/pdf"), kind: "bill", billId: b.id,
    name: "Hillside pump invoice.pdf", tag: "document", takenAt: WHEN });
  await q.drain();
  // landed() -> link(row.id, false, null, true, name): read again inside the chain, then judged
  const again = await books.loadBill(b.id, me("accountant"));
  assert.equal(FV.landingProblem(again.bill, paperwork(again.bill, again.files, again.payments), { first: true, agreed: false }), "", "it becomes the document");
  const row = await books.setDocument(again.bill, done[0].row.id, { withdraw: false });
  assert.equal(row.document_file_id, done[0].row.id, "the bill is documented again (approve_bill takes it)");
});

test("the bill page lists a voided payment as Void with its reason (no amount), and only live payments settle how it is paid", { skip }, async () => {
  const js = code(read("js/pages/bill.js"));
  assert.match(js, /const livePays = \(d\.payments \|\| \[\]\)\.filter\(\(p\) => p\.live !== false\);/);
  assert.match(js, /if \(can\.approve && !livePays\.length\) \{/);
  assert.match(js, /\} else if \(can\.approve && livePays\.length\) \{/);
  assert.ok(!/d\.payments\.length\) \{/.test(js.slice(js.indexOf("const livePays"), js.indexOf("if (d.payments.length) {"))), "no raw count left in the decision");
  assert.match(js, /\(p\.live === false\s+\? '<\/span><span><b class="bl-void">Void<\/b>' \+ \(p\.voidReason \? '<br><span class="t">' \+ h\(p\.voidReason\) \+ "<\/span>" : ""\)/);
  // what loadBill answers for a voided check (the demo database with the check register's columns)
  await setup();
  as("accountant");
  const b = billOf("Telehandler, one week");
  const pay = E.rows.payments.find((p) => p.bill_id === b.id);
  Object.assign(pay, { voided_at: "2026-10-18T17:00:00Z", voided_by: uid("admin"), void_reason: "Made-up: written to the wrong payee" });
  const d = await books.loadBill(b.id, me("accountant"));
  const p = d.payments.find((x) => x.id === pay.id);
  assert.deepEqual([p.live, p.voided, p.voidReason], [false, true, "Made-up: written to the wrong payee"]);
  assert.equal(d.bill.paid, 0, "paid against nothing");
});

/* a small DOM for js/pages/file-viewer.js (node has none): elements with children and ids, and document's keydown
   listeners run as a browser runs them - the capture phase first, then the bubble phase */
function tinyDom() {
  const listeners = [];
  function el(tag) {
    const n = { tagName: String(tag).toUpperCase(), children: [], style: {}, className: "", id: "", hidden: false, attrs: {}, _t: "",
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; }, addEventListener() {}, focus() { doc.activeElement = this; } };
    Object.defineProperty(n, "textContent", { get() { return this._t + this.children.map((c) => c.textContent || "").join(""); },
      set(v) { this._t = String(v); this.children = []; } });
    return n;
  }
  const find = (n, id) => { if (!n || !n.children) return null; if (n.id === id) return n; for (const c of n.children) { const x = find(c, id); if (x) return x; } return null; };
  const doc = {
    createElement: el, createTextNode: (t) => ({ textContent: String(t) }), head: el("head"), body: el("body"), documentElement: el("html"), activeElement: null,
    getElementById: (id) => find(doc.head, id) || find(doc.body, id),
    addEventListener(type, fn, capture) { listeners.push({ type, fn, capture: capture === true || !!(capture && capture.capture) }); },
    key(key) {
      let stopped = false, now = false;
      const ev = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { stopped = true; },
        stopImmediatePropagation() { stopped = true; now = true; } };
      for (const phase of [true, false]) {
        for (const l of listeners.filter((x) => x.type === "keydown" && x.capture === phase)) { if (now) break; l.fn(ev); }
        if (stopped) break;
      }
      return ev;
    },
  };
  return doc;
}
const settle = () => new Promise((r) => setImmediate(r));
async function withDom(fn) {
  const had = { document: globalThis.document, window: globalThis.window };
  const doc = tinyDom();
  globalThis.document = doc;
  try { return await fn(doc); } finally {
    if (had.document === undefined) delete globalThis.document; else globalThis.document = had.document;
    if (had.window === undefined) delete globalThis.window; else globalThis.window = had.window;
    useClient(null);
  }
}

test("showIn: the last file asked for wins - a picture whose signed link answers late never covers the file picked after it", async () => {
  const { showIn } = await import("../site/js/pages/file-viewer.js");
  await withDom(async (doc) => {
    const answer = {};
    useClient({ storage: { from: () => ({ createSignedUrl: (path) => new Promise((res) => { answer[path] = (url) => res({ data: { signedUrl: url }, error: null }); }) }) } });
    const A = { id: 1, name: "made-up extra.png", storagePath: "f/9/receipts/" + "a".repeat(32) + "/extra.png" };
    const B = { id: 2, name: "made-up doc.png", storagePath: "f/9/receipts/" + "b".repeat(32) + "/doc.png" };
    const stage = doc.createElement("div");
    const a = showIn(stage, A);
    const b = showIn(stage, B);
    await settle();
    answer[B.storagePath]("https://x.example/b");
    await b;
    answer[A.storagePath]("https://x.example/a");
    await a;
    const imgs = stage.children.filter((c) => c.tagName === "IMG");
    assert.deepEqual(imgs.map((i) => [i.src, i.alt]), [["https://x.example/b", "made-up doc.png"]], "the stage shows the file picked last");
    // a picture, then a PDF (drawn at once): the picture's late link is dropped
    const A2 = { id: 3, name: "made-up photo.jpg", storagePath: "f/9/receipts/" + "c".repeat(32) + "/photo.jpg" };
    const C = { id: 4, name: "made-up invoice.pdf", storagePath: "f/9/receipts/" + "d".repeat(32) + "/invoice.pdf" };
    const a2 = showIn(stage, A2);
    await settle();
    await showIn(stage, C);
    answer[A2.storagePath]("https://x.example/a2");
    await a2;
    assert.ok(!stage.children.some((c) => c.tagName === "IMG"), "no picture over the PDF's words");
    assert.match(stage.textContent, /made-up invoice\.pdf/);
  });
});

test("openTab answers whether the file was sent to its tab (a refused link: false, the tab closed, onError told)", async () => {
  const { openTab } = await import("../site/js/pages/file-viewer.js");
  await withDom(async () => {
    const tabs = [];
    globalThis.window = { open: () => { const w = { closed: false, close() { this.closed = true; }, location: {} }; tabs.push(w); return w; } };
    let fail = true;
    useClient({ storage: { from: () => ({ createSignedUrl: async (path) => (fail ? { data: null, error: { message: "JWT expired", status: 401 } } : { data: { signedUrl: "https://x.example/" + path }, error: null }) }) } });
    const f = { id: 5, name: "Telehandler rental.pdf", storagePath: "f/9/receipts/" + "e".repeat(32) + "/Telehandler_rental.pdf" };
    const said = [];
    assert.equal(await openTab(f, (e) => said.push(e.message)), false);
    assert.deepEqual([tabs[0].closed, said], [true, ["JWT expired"]]);
    fail = false;
    assert.equal(await openTab(f, (e) => said.push(e.message)), true);
    assert.equal(tabs[1].location.href, "https://x.example/" + f.storagePath);
    assert.equal(await openTab({ id: 6, name: "on the office computers.pdf", cloud: false, storagePath: "x" }, (e) => said.push(e.message)), false);
    assert.match(said[1], /on the office computers/);
  });
});

test("the payment panel's box (#ckViewer): the last paperwork button pressed wins - a PDF's words over a late picture, a picture over a PDF's late words, a refused link's words kept", async () => {
  const pp = await import("../site/js/pages/pay-panel.js");
  assert.equal(typeof pp.showDoc, "function", "the panel's paperwork buttons, run as the page runs them");
  assert.equal(typeof FV.claimStage, "function", "one turn for whoever writes on the box");
  await withDom(async (doc) => {
    const answer = {};
    useClient({ storage: { from: () => ({ createSignedUrl: (path) => new Promise((res) => {
      answer[path] = (url) => res(url ? { data: { signedUrl: url }, error: null } : { data: null, error: { message: "JWT expired", status: 401 } });
    }) }) } });
    const tabs = [];
    globalThis.window = { open: () => { const w = { closed: false, close() { this.closed = true; }, location: {} }; tabs.push(w); return w; } };
    const box = doc.createElement("div");
    box.id = "ckViewer";
    doc.body.appendChild(box);
    const at = (c, n) => "f/9/receipts/" + c.repeat(32) + "/" + n;
    const detail = { files: [
      { id: 31, name: "made-up photo.jpg", storagePath: at("1", "photo.jpg") },
      { id: 32, name: "made-up invoice.pdf", storagePath: at("2", "invoice.pdf") },
      { id: 33, name: "made-up quote.pdf", storagePath: at("3", "quote.pdf") },
      { id: 34, name: "made-up slip.png", storagePath: at("4", "slip.png") },
      { id: 35, name: "made-up statement.pdf", storagePath: at("5", "statement.pdf") },
      { id: 36, name: "made-up yard.jpg", storagePath: at("6", "yard.jpg") },
    ] };
    const sign = async (i, url) => {
      const p = detail.files[i].storagePath;
      for (let k = 0; k < 50 && !answer[p]; k++) await settle();
      answer[p](url);
    };
    const imgs = () => box.children.filter((c) => c.tagName === "IMG").map((i) => i.src);
    // a picture (its link slow), then a PDF: the PDF's line stays when the picture's link answers late
    const a = pp.showDoc(0, detail);
    const b = pp.showDoc(1, detail);
    await sign(1, "https://x.example/invoice");
    await b;
    assert.equal(box.textContent, "made-up invoice.pdf opened in a new tab.");
    await sign(0, "https://x.example/photo");
    await a;
    assert.deepEqual(imgs(), [], "no late picture over the PDF's line");
    assert.equal(box.textContent, "made-up invoice.pdf opened in a new tab.");
    // a PDF (its link slow), then a picture: the picture stays when the PDF's "opened" comes back late
    const c = pp.showDoc(2, detail);
    const d = pp.showDoc(3, detail);
    await sign(3, "https://x.example/slip");
    await d;
    await sign(2, "https://x.example/quote");
    await c;
    assert.deepEqual(imgs(), ["https://x.example/slip"], "the picture picked last");
    assert.ok(!/opened in a new tab/.test(box.textContent), box.textContent);
    assert.equal(tabs.filter((w) => w.location.href).length, 2, "each PDF still went to its own tab");
    // a picture (slow), then a PDF whose link is refused: the refusal's words stay
    const e = pp.showDoc(5, detail);
    const f = pp.showDoc(4, detail);
    await sign(4, null);
    await f;
    const said = box.textContent;
    assert.ok(said && !/opened in a new tab/.test(said), said);
    await sign(5, "https://x.example/yard");
    await e;
    assert.deepEqual(imgs(), [], "no late picture over the refusal");
    assert.equal(box.textContent, said);
  });
});

test("the viewer's Esc closes the viewer only: a dialog under it (the expense dialog closes on Esc) never hears that key", async () => {
  const { openViewer } = await import("../site/js/pages/file-viewer.js");
  await withDom(async (doc) => {
    let dialogClosed = 0;
    // the expense dialog's own listener (js/pages/expense-dialog.js), heard on document and set up before the viewer's
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape") dialogClosed++; });
    openViewer([{ id: 7, name: "Yard receipt.pdf", storagePath: "f/9/receipts/" + "f".repeat(32) + "/Yard_receipt.pdf" }], 0, {});
    await new Promise((r) => setTimeout(r, 5));               // the viewer puts the focus on its ✕
    const host = doc.getElementById("fvView");
    assert.equal(host.hidden, false);
    const ev = doc.key("Escape");
    assert.equal(host.hidden, true, "the viewer closed");
    assert.equal(ev.defaultPrevented, true);
    assert.equal(dialogClosed, 0, "the dialog stays open, with what was typed in it");
    doc.key("Escape");
    assert.equal(dialogClosed, 1, "the next Esc is the dialog's");
  });
});

test("the cost dialog's Esc ignores an Esc a question over it already handled (\"Remove the receipt\": the common2 modal, heard first, preventDefault only)", async () => {
  const dlg = code(read("js/pages/expense-dialog.js"));
  const on = /document\.addEventListener\("keydown", \(e\) => \{ (if \(.*?\)) close\(\); \}\);/.exec(dlg);
  assert.ok(on, "the dialog's own Esc listener");
  assert.match(on[1], /^if \(e\.key === "Escape" && !e\.defaultPrevented && /, "an Esc already handled is not the dialog's");
  assert.match(dlg, /const ask = st\.ctx\.confirm \|\|/, "the ✕ asks over the dialog");
  // the same order a browser runs them in: the modal's capture listener (common2.js onKey), then this one
  await withDom(async (doc) => {
    let closed = 0, asked = true;
    doc.addEventListener("keydown", (e) => { if (asked && e.key === "Escape") { e.preventDefault(); asked = false; } }, true);
    const cond = new Function("e", "h", "st", "close", on[1] + " close();");
    doc.addEventListener("keydown", (e) => cond(e, { classList: { contains: () => true } }, { busy: false }, () => { closed++; }));
    doc.key("Escape");
    assert.deepEqual([asked, closed], [false, 0], "the question closed, the dialog and what was typed stay");
    doc.key("Escape");
    assert.equal(closed, 1, "the next Esc closes the dialog");
  });
});

test("several receipts: the expense dialog's file-drop, the Expenses tab's and the ledger's rows (＋📎 several, drop, Ctrl+V on a selected row)", () => {
  const dlg = code(read("js/pages/expense-dialog.js"));
  assert.match(dlg, /st\.drop = mountFileDrop\(\$\("cfFiles"\)/);
  assert.match(dlg, /const files = st\.drop \? st\.drop\.files\(\) : \[\];/);
  assert.match(dlg, /if \(files\.length && saved && saved\.id != null\) await attachReceipts\(ctx, saved\.id, files\);/);
  assert.match(dlg, /if \(st\.drop\) \{ st\.drop\.destroy\(\); st\.drop = null; \}/, "the dialog's paste listener goes with it");
  assert.ok(!/id="cfFile"/.test(dlg), "the single input is gone");
  const tab = code(read("js/pages/project-expenses.js"));
  assert.match(tab, /id="exAttachIn" accept="' \+ RECEIPT_ACCEPT \+ '" multiple hidden>/);
  assert.match(tab, /st\.drops = rowDrops\(host, "tr\[data-drop\]"/);
  assert.match(tab, /<tr data-drop="' \+ esc\(r\.id\) \+ '" tabindex="0"/);
  assert.match(tab, /receipts: row \? row\.receipts \|\| \[\] : \[\]/, "an edit lists the cost's receipts");
  const led = code(read("js/pages/ledger.js"));
  assert.match(led, /rowDrops\(el\("lgBody"\), "tr\[data-drop\]"/);
  assert.match(led, /data-attach="' \+ esc\(r\.id\) \+ '"/);
  assert.match(led, /kind: "receipt", costId: r\.id/);
  assert.match(led, /state\.can\.tag \? ' data-drop="' \+ esc\(r\.id\) \+ '" tabindex="0"/, "only a money editor's rows take files");
  assert.match(read("ledger.html"), /<input type="file" id="lgAttachIn" accept="[^"]+" multiple hidden \/>/);
  // the ledger's own viewer stays (tools/e2e-p5b-ledger.mjs walks it)
  assert.match(read("ledger.html"), /id="lgView"/);
});

test("the money modules stay out of the offline list, and no shell module imports them statically", () => {
  const sw = read("sw.js");
  for (const f of ["js/pages/file-drop.js", "js/pages/file-viewer.js", "js/pages/bill.js", "js/pages/ledger.js", "bill.html", "ledger.html"]) {
    assert.ok(!sw.includes('"' + f + '"'), f + " is not kept on phones");
  }
  for (const f of ["js/upload-queue2.js", "js/pages/uploads.js"]) {
    assert.ok(!/from "[^"]*(file-drop|file-viewer|books)\.js"/.test(read(f)), f + ": no static import of the new modules");
  }
});
