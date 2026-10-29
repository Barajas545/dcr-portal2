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
  assert.match(js, /if \(row && row\.id != null && \/\^document!\?\$\/\.test\(tag\)\) return link\(row\.id, tag === "document!", null\);/);
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
