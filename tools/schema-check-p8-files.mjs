/* DCR Portal 2 — the money files' calls against the REAL database rules (development only): the Books program's
   release A, P1 part of tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own upload queue
   (site/js/upload-queue2.js createQueue + filesDb, over the Storage stand-in that writes storage.objects under its
   policies), repo/books.js (FILE_COLS, loadBill, setDocument) and repo/files.js removeFile run over PGlite loaded with
   every DCR Desktop 2 migration - 20261030000100_money_files (M1) included - as each made-up role:

   * kind "bill" (the bill's id) and kind "payment" (the payment's bill and the payment): the receipts folder, an f/ key
     that t14_files_money_shape takes, bill_id (and payment_id) on the row, never a version: the same name twice is
     "INV-77 (2).pdf" - the database's name, which the row the queue answers carries; a paste named "Bill <time>"; a
     picture's preview first; current_files and loadBill expose payment_id, the preview and the version;
   * setDocument (a versioned PATCH of bills.document_file_id): a blocked bill gets its document (books_desk: blocked ->
     waiting); an approved bill's approval is withdrawn; a bill marked entered in QuickBooks is refused (23514, its
     sentence); a stale version is sent once more at the new one - but not over an approval unless the person agreed;
   * the shape (I37): an .exe or an .html "receipt" is refused with the database's sentence, which the queue's line
     keeps;
   * who: a manager without financials, a lead, field and view-only cannot put a money object in Storage (the queue's
     line fails), cannot insert a payment's file (42501); the payment of another bill is 23514;
   * removing (I4): the accountant removes the admin's wrong paste (a soft delete); the approved document, and an entered
     bill's, stay - for the admin too (23514, t40_files_money_guard's sentences);
   * drift: the demo database (tools/fake/p8-files.js over engine.js) has the files and current_files columns of the
     real ones.
   Made-up people and jobs only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  if (!(catalog.tables.files && catalog.tables.files.cols.payment_id && catalog.tables.books_desk)) {
    results.push({ section, name: "The Books program's M1 (20261030000100_money_files) is not in DCR Desktop 2 yet: the money-file checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const uq = await site("upload-queue2.js");
  const books = await site("repo/books.js");
  const filesRepo = await site("repo/files.js");
  const common2 = await site("common2.js");
  const WHEN = "2026-10-19T17:30:12Z";            // 10:30:12 am, company time
  const J = {};

  const me = async (key) => {
    const p = await one("select id, role, active, coalesce(can_see_prices, false) as can_see_prices, coalesce(can_see_financials, false) as can_see_financials, " +
      "coalesce(can_approve_payments, false) as can_approve_payments from public.profiles where id = $1", [PEOPLE[key].id]);
    return Object.assign({}, p, { can_see_financials: p.role === "admin" || p.can_see_financials });
  };
  /* the page's queue, as `key` (the client acts as whoever as() made it) */
  function queueAs(key) {
    const store = new Map();
    const done = [];
    const q = uq.createQueue({
      store: { put: async (v) => { store.set(v.id, Object.assign({}, v)); }, del: async (id) => { store.delete(id); },
        all: async () => Array.from(store.values()).map((v) => Object.assign({}, v)) },
      send: async (req) => {
        const r = await client.storageHttp(req.method, new URL(req.url).pathname, req.headers, req.body);
        if (req.onProgress && r.status < 300 && req.body) req.onProgress(req.body.size);
        return { status: r.status, header: (n) => (r.headers[n.toLowerCase()] ?? null), text: () => r.text };
      },
      auth: async () => ({ url: "https://pglite.invalid", apikey: "sb_publishable_schema_check", token: "pglite-" + PEOPLE[key].id }),
      owner: () => PEOPLE[key].id,
      db: uq.filesDb(() => client),
      setTimeout: () => 0, clearTimeout: () => {},
      makePreview: async (_f, mime) => (/^image\//.test(mime) ? new Blob([new Uint8Array(700)], { type: "image/jpeg" }) : null),
    });
    q.onProgress((items, evt) => { if (evt && evt.type === "done") done.push(evt); });
    return { q, store, done, left: () => Array.from(store.values()).filter((r) => r.kind) };
  }
  const file = (name, type, n) => new File([new Uint8Array(n || 900)], name, { type });

  /* ── a made-up job: a bill with no document, an approved bill with its document and a check, a bill entered in QuickBooks ── */
  await sql("reset role");
  J.project = await one("insert into public.projects (name, city, status) values ('Money Files Schema Barn', 'Sandbox', 'in_progress') returning id, number");
  const pid = J.project.id;
  const leaf = (n) => (0x8f00 + n).toString(16).padStart(32, "0");
  const docOf = async (billId, n, name) => (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, bill_id)
     values ($1, 'receipts', $2, $3, 'application/pdf', 900, $4) returning id`, [pid, name, "f/" + pid + "/receipts/" + leaf(n) + "/" + name, billId])).id;
  const billRow = async (vendor, number, amount) => (await one(`insert into public.bills (project_id, vendor_name, invoice_number, amount, kind, due_date)
     values ($1, $2, $3, $4, 'Subcontractor', app.today()) returning id`, [pid, vendor, number, amount])).id;
  J.blocked = await billRow("Made-up Sheathing Co", "S-1", 640);
  J.approved = await billRow("Made-up Framing Sub", "F-9", 900);
  J.approvedDoc = await docOf(J.approved, 1, "framing sub bill.pdf");
  await sql("update public.bills set document_file_id = $2 where id = $1", [J.approved, J.approvedDoc]);
  await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = 900, pay_method = 'check' where id = $1", [J.approved, PEOPLE.admin.id]);
  J.pay = (await one(`insert into public.payments (bill_id, amount, method, check_number, payee, memo) values ($1, 400, 'check', '880171', 'Made-up Framing Sub', 'Barn framing, part')
     returning id`, [J.approved])).id;
  J.waiting = await billRow("Made-up Trusses", "T-4", 300);
  J.waitingDoc = await docOf(J.waiting, 2, "truss quote.pdf");
  await sql("update public.bills set document_file_id = $2 where id = $1", [J.waiting, J.waitingDoc]);
  await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = 300, pay_method = 'check' where id = $1", [J.waiting, PEOPLE.admin.id]);
  J.entered = await billRow("Made-up Lumber Yard", "L-2", 210);
  J.enteredDoc = await docOf(J.entered, 3, "lumber yard bill.pdf");
  await sql("update public.bills set document_file_id = $2 where id = $1", [J.entered, J.enteredDoc]);
  await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = 210, pay_method = 'check', qbo_entered_at = now(), qbo_entered_by = $2 where id = $1",
    [J.entered, PEOPLE.admin.id]);
  const deskState = async (id) => (await one("select state from public.books_desk where id = $1", [id])).state;

  await check("P8 files: the accountant's bill files through the queue - receipts + bill_id, an f/ key the shape rule takes, never a version (\"INV-77 (2).pdf\" is the database's), a paste named \"Bill <time>\", a picture's preview first", async () => {
    await as("accountant");
    const { q, done, left } = queueAs("accountant");
    await q.enqueue({ projectId: pid, file: file("INV-77.pdf", "application/pdf", 900), kind: "bill", billId: J.blocked, name: "INV-77.pdf", tag: "document", takenAt: WHEN });
    await q.enqueue({ projectId: pid, file: file("INV-77.pdf", "application/pdf", 901), kind: "bill", billId: J.blocked, name: "INV-77.pdf", takenAt: WHEN });
    await q.enqueue({ projectId: pid, file: file("image.png", "image/png", 950), kind: "bill", billId: J.blocked, takenAt: WHEN });
    await q.drain();
    same(left().map((r) => [r.state, r.error]), [], "nothing left in the queue");
    same(done.map((e) => [e.row.name, e.row.folder, Number(e.row.bill_id), e.row.payment_id, e.row.previous_id, e.row.version_no]), [
      ["INV-77.pdf", "receipts", Number(J.blocked), null, null, 1],
      ["INV-77 (2).pdf", "receipts", Number(J.blocked), null, null, 1],
      ["Bill 2026-10-19 10.30.12.png", "receipts", Number(J.blocked), null, null, 1]], "the rows (the done event carries the database's name)");
    same(done[0].item.tag, "document", "the page's tag rides on the item");
    ok(done.every((e) => /^f\/\d+\/receipts\/[0-9a-f]{32}\/[A-Za-z0-9._ ()-]{1,120}$/.test(e.row.storage_path)), "the keys: " + done.map((e) => e.row.storage_path).join(" "));
    ok(/\/preview-320\.jpg$/.test(done[2].row.preview_path || ""), "the picture's preview: " + done[2].row.preview_path);
    ok(!done[0].row.preview_path, "a PDF: no preview");
    J.newDoc = done[0].row;
    J.extra = done[1].row;
  });

  await check("P8 files: a payment's file - its bill's and the payment's (bill_id + payment_id); current_files exposes payment_id; loadBill shows paymentId, the preview and the version", async () => {
    await as("accountant");
    const { q, done, left } = queueAs("accountant");
    await q.enqueue({ projectId: pid, file: file("image.jpg", "image/jpeg", 980), kind: "payment", billId: J.approved, paymentId: J.pay, takenAt: WHEN });
    await q.drain();
    same(left().length, 0, "nothing left");
    const row = done[0].row;
    same([Number(row.bill_id), Number(row.payment_id), row.name, row.folder], [Number(J.approved), Number(J.pay), "Payment 2026-10-19 10.30.12.jpg", "receipts"], "the row");
    const cur = (await client.from("current_files").select("id, payment_id").eq("id", row.id)).data;
    same(cur.map((f) => Number(f.payment_id)), [Number(J.pay)], "current_files.payment_id");
    const d = await books.loadBill(J.approved, await me("accountant"));
    const f = d.files.find((x) => String(x.id) === String(row.id));
    ok(f && Number(f.paymentId) === Number(J.pay) && /preview-320\.jpg$/.test(f.previewPath || "") && f.version >= 1, "loadBill's file: " + JSON.stringify(f));
    ok(d.files.find((x) => x.primary && String(x.id) === String(J.approvedDoc)), "the document first, marked");
    for (const c of books.FILE_COLS.split(",").map((s) => s.trim())) ok(c in catalog.tables.files.cols, "files." + c);
  });

  await check("P8 files: setDocument - the blocked bill gets its document (books_desk blocked -> waiting); an approved bill's approval is withdrawn; an entered bill is refused; a stale version is sent again", async () => {
    same(await deskState(J.blocked), "blocked", "before");
    await as("accountant");
    let b = (await books.loadBill(J.blocked, await me("accountant"))).bill;
    const r1 = await books.setDocument(b, J.newDoc.id);
    same(Number(r1.document_file_id), Number(J.newDoc.id), "pointed at");
    same(await deskState(J.blocked), "waiting", "after: waiting for an approval");
    // the old document of an approved bill stays (only re-pointed); the approval goes
    b = (await books.loadBill(J.waiting, await me("accountant"))).bill;
    await sql("reset role");
    await sql("update public.bills set description = 'Trusses, checked' where id = $1", [J.waiting]);      // someone else, meanwhile
    await as("accountant");
    const { q, done } = queueAs("accountant");
    await q.enqueue({ projectId: pid, file: file("truss quote v2.pdf", "application/pdf"), kind: "bill", billId: J.waiting, name: "truss quote v2.pdf", takenAt: WHEN });
    await q.drain();
    await refused(() => books.setDocument(b, done[0].row.id), "PT409", "approved and changed meanwhile, the person did not agree: not sent again");
    const r2 = await books.setDocument(b, done[0].row.id, { withdraw: true });
    same([Number(r2.document_file_id), r2.approved_at, r2.pay_method], [Number(done[0].row.id), null, null], "the new document, the approval withdrawn");
    same((await one("select deleted_at from public.files where id = $1", [J.waitingDoc])).deleted_at, null, "the old document stays, an extra");
    // marked entered in QuickBooks: the database refuses
    const e = (await books.loadBill(J.entered, await me("accountant"))).bill;
    const x = queueAs("accountant");
    await x.q.enqueue({ projectId: pid, file: file("lumber corrected.pdf", "application/pdf"), kind: "bill", billId: J.entered, name: "lumber corrected.pdf", takenAt: WHEN });
    await x.q.drain();
    same(x.done.length, 1, "an extra on an entered bill is fine");
    const err = await refused(() => books.setDocument(e, x.done[0].row.id), "23514", "an entered bill keeps its document");
    ok(/marked entered in QuickBooks/.test(common2.errorText(err)), "the sentence: " + common2.errorText(err));
  });

  await check("P8 files: the shape (I37) - an .exe or an .html \"receipt\" is refused with the database's sentence, kept on the queue's line", async () => {
    await as("accountant");
    for (const [name, type] of [["setup.exe", "application/octet-stream"], ["invoice.html", "text/html"]]) {
      const { q, left } = queueAs("accountant");
      await q.enqueue({ projectId: pid, file: file(name, type), kind: "bill", billId: J.blocked, name, takenAt: WHEN });
      await q.drain();
      const it = left()[0];
      ok(it && it.state === "failed" && /This kind of file can't be attached to money: save it as a PDF or a picture/.test(it.error), name + ": " + JSON.stringify(it && [it.state, it.error]));
    }
    same(Number((await one("select count(*) as n from public.files where project_id = $1 and name in ('setup.exe', 'invoice.html')", [pid])).n), 0, "no rows");
  });

  await check("P8 files: who - without the money switches Storage refuses the f/ object and a payment's file is 42501; the payment of another bill is 23514", async () => {
    for (const k of ["manager", "lead", "field", "viewer"]) {
      await as(k);
      const { q, left } = queueAs(k);
      await q.enqueue({ projectId: pid, file: file("INV-9.pdf", "application/pdf"), kind: "bill", billId: J.blocked, name: "INV-9.pdf", takenAt: WHEN });
      await q.drain();
      const it = left()[0];
      ok(it && it.state === "failed", k + ": " + JSON.stringify(it && [it.state, it.error]));
      const key = "f/" + pid + "/receipts/" + leaf(40) + "/x.jpg";
      const r = await client.from("files").insert({ project_id: pid, folder: "receipts", subpath: "", name: "x.jpg", storage_path: key, size: 10, mime: "image/jpeg",
        bill_id: J.approved, payment_id: J.pay, source: "portal2" }).select();
      same(r.error && r.error.code, "42501", k + ": a payment's file");
    }
    await as("accountant");
    const key = "f/" + pid + "/receipts/" + leaf(41) + "/check.jpg";
    const r = await client.from("files").insert({ project_id: pid, folder: "receipts", subpath: "", name: "check.jpg", storage_path: key, size: 10, mime: "image/jpeg",
      bill_id: J.blocked, payment_id: J.pay, source: "portal2" }).select();
    same([r.error && r.error.code, r.error && /the payment belongs to another bill/.test(r.error.message)], ["23514", true], "the payment of another bill");
  });

  await check("P8 files: removing (I4) - the accountant removes the admin's wrong paste; the approved document and an entered bill's stay, for the admin too", async () => {
    await as("admin");
    const { q, done } = queueAs("admin");
    await q.enqueue({ projectId: pid, file: file("wrong paste.png", "image/png"), kind: "bill", billId: J.approved, name: "wrong paste.png", takenAt: WHEN });
    await q.drain();
    const paste = done[0].row;
    await as("accountant");
    await filesRepo.removeFile({ id: paste.id, version: paste.version });
    ok((await one("select deleted_at from public.files where id = $1", [paste.id])).deleted_at, "soft-deleted");
    for (const k of ["accountant", "admin"]) {
      await as(k);
      const e1 = await refused(() => filesRepo.removeFile({ id: J.approvedDoc }), "23514", k + ": the approved document");
      ok(/approved document of a bill|document of a paid bill/.test(e1.message), k + ": " + e1.message);
      const e2 = await refused(() => filesRepo.removeFile({ id: J.enteredDoc }), "23514", k + ": an entered bill's document");
      ok(/entered in QuickBooks/.test(e2.message), k + ": " + e2.message);
    }
    await as("manager");
    await refused(() => filesRepo.removeFile({ id: J.extra.id }), null, "a manager without financials removes nothing");
    same((await one("select deleted_at from public.files where id = $1", [J.extra.id])).deleted_at, null, "the extra stays");
  });

  await check("P8 files: a removed document is no document - loadBill, The Books (books_desk.documented) and the approvals card count only a LIVE file, as approve_bill does", async () => {
    await sql("reset role");
    const id = await billRow("Made-up Siding Crew", "SC-3", 450);
    const doc = await docOf(id, 4, "siding crew bill.pdf");
    await sql("update public.bills set document_file_id = $2 where id = $1", [id, doc]);
    await as("accountant");
    same((await books.loadBill(id, await me("accountant"))).bill.hasDocument, true, "documented while its file is live");
    // an unapproved, unpaid bill: the database lets its document go (t40 guards only an approved, paid or entered one)
    const v = (await one("select version from public.files where id = $1", [doc])).version;
    await filesRepo.removeFile({ id: doc, version: v });
    same(Number((await one("select document_file_id from public.bills where id = $1", [id])).document_file_id), Number(doc), "the pointer stays behind");
    same((await one("select documented, state from public.books_desk where id = $1", [id])), { documented: false, state: "blocked" }, "the database: not documented");
    const b = (await books.loadBill(id, await me("accountant"))).bill;
    same([b.hasDocument, b.state, b.reason], [false, "blocked", "No invoice attached, so it cannot be approved."], "loadBill");
    const desk = await books.loadDesk(await me("accountant"));
    const onDesk = desk.blocked.find((x) => String(x.id) === String(id));
    ok(onDesk && onDesk.hasDocument === false, "The Books: blocked, no document - " + JSON.stringify(onDesk && [onDesk.state, onDesk.hasDocument]));
    await as("admin");
    const q = await books.approvals(await me("admin"));
    const card = q.queue.find((x) => String(x.id) === String(id));
    ok(card && card.hasDocument === false, "the approvals card: needs the invoice attached - " + JSON.stringify(card));
    const bill = await one("select version from public.bills where id = $1", [id]);
    const r = await client.rpc("approve_bill", { id, pay_method: "check", version: bill.version, note: null });
    ok(r.error, "approve_bill refuses it too: " + JSON.stringify(r.error && [r.error.code, r.error.message]));
  });

  await check("P8 files: drift - the demo database (tools/fake/p8-files.js) has the real files and current_files columns", async () => {
    const harness = path.join(SITE, "..", "tests", "pages-engine.mjs");
    if (!existsSync(harness)) return;
    const H = await import(pathToFileURL(harness).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["files", "current_files"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
    }
    const F = globalThis.DCR2Fake;
    // the extensions a money file may have: the demo's list is the migration's (t14_files_money_shape)
    const fn = (await one("select pg_get_functiondef('app.tg_files_money_shape()'::regprocedure) as d")).d;
    const list = /v_ext = any \(array\[([\s\S]*?)\]\)/.exec(fn);
    ok(list, "the migration's list of extensions");
    const real = Array.from(list[1].matchAll(/'([a-z0-9]+)'/g)).map((m) => m[1]).sort();
    same((F.p8FilesOpenable || []).slice().sort(), real, "the demo's openable extensions");
    same(F.uniqueFileName("image.jpg", ["IMAGE.JPG", "image (2).jpg"]), (await one("select app.unique_file_name('image.jpg', array['IMAGE.JPG', 'image (2).jpg']) as n")).n,
      "app.unique_file_name and the demo's agree");
    same(F.uniqueFileName("archive.tar.gz", ["archive.tar.gz"]), (await one("select app.unique_file_name('archive.tar.gz', array['archive.tar.gz']) as n")).n, "an inner dot");
    same(F.uniqueFileName(".bashrc", [".bashrc"]), (await one("select app.unique_file_name('.bashrc', array['.bashrc']) as n")).n, "no extension");
  });
}
