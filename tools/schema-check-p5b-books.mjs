/* DCR Portal 2 — The Books' queries against the REAL database rules (development only): P5b's books part of
   tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/books.js (and the pure
   map/books.js it feeds) runs over PGlite loaded with every DCR Desktop 2 migration, M5b 20261026000100_books_ledger.sql
   included, as each role:

   * the names the pages use exist: books_desk's columns (DESK_COLS), bills.kind and the QuickBooks marker, the
     invoices' marker, the payments' payee / memo / pick-up stamp, and the RPCs' argument names - approve_bill(id,
     pay_method, version, note), set_bill_pay_method(p_id, p_method, p_version), mark_bills_entered(p_ids, p_ref),
     unmark_bills_entered(p_ids), mark_invoices_entered(p_ids, p_ref), unmark_invoices_entered(p_ids),
     payment_told(p_id, p_how, p_version);
   * The Books as the accountant, the admin and a manager with approve: the piles as the database judges them
     (books_desk's state and reason), the check desk's cap from the frozen approved amount, the CSV;
   * P5 check 2: approve - an accountant, a manager without approve and a manager with prices only are refused
     (42501); no pay method 22023; a stale version PT409; no document 23514; the approver approves; an amount edit
     clears the approval; a payment above the approved amount is refused (23514); set_bill_pay_method for approvers,
     refused once paid;
   * the check desk: a payment with payee and memo, payment_told by phone, and a told payment cannot be deleted;
   * bank transfer and card (owner decision 2026-10-21): the five pay methods the bill page offers are the database's;
     a bill approved for a bank transfer is paid by ACH or wire with its confirmation and no check number, one for card
     by card - anything else refused in the database's words; both on "Pay by bank transfer or card" (books_desk
     pay_pile transfer_card, to_tell 0), never on the check desk, and nobody told about them;
   * P5 check 3: mark_bills_entered marks only the ready bill and lists the others in refused[] with the database's
     reasons (shown by refusedLines); a marked bill is locked; unmark; the invoices' marker (a draft "Not sent yet.");
   * nobody without financials (a manager - Q1 -, a manager with prices, a lead, field, view-only) and not the agents
     account is answered a bill, a payment, an invoice or a books_desk row, and the module asks for nothing for them;
   * P5 check 5: none of these writes adds an activity row or an outbox row;
   * drift: the demo database (tools/fake/p5b-books.js) has books_desk's columns and the RPCs' arguments, and the money
     tables (bills, payments, invoices and their lines, client payments, files, current_files) have exactly the real columns.
   Made-up people and jobs only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const HAS = !!(catalog.tables.books_desk && catalog.functions.mark_bills_entered && catalog.functions.set_bill_pay_method &&
    catalog.tables.bills && catalog.tables.bills.cols.qbo_entered_at);
  if (!HAS) {
    results.push({ section, name: "M5b (20261026000100_books_ledger) is not in DCR Desktop 2 yet: the P5b books checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const books = await site("repo/books.js");
  const M = await site("map/books.js");
  const sbm = await site("sb.js");
  const today = (await one("select app.today()::text as d")).d;

  /* every table / RPC the module asked for, and every answer: [{table, data}] */
  const rec = [];
  const origFrom = client.from.bind(client);
  const origRpc = client.rpc.bind(client);
  client.from = function (t) {
    const b = origFrom(t);
    const then0 = b.then.bind(b);
    b.then = function (res, rej) { return then0(function (r) { rec.push({ table: t, data: r && r.data }); return res ? res(r) : r; }, rej); };
    return b;
  };
  client.rpc = function (n, a) { rec.push({ table: "rpc:" + n }); return origRpc(n, a); };
  const me = async () => sbm.me({ fresh: true });

  /* a made-up approver: a manager with the approve and financials switches, no prices (Q1) */
  PEOPLE.approver = { id: "c2000000-0000-4000-8000-0000000005b1", name: "Abe Approver", role: "manager" };
  await sql("reset role");
  await sql("insert into auth.users (id, email) values ($1, 'approver@schema-check.test') on conflict do nothing", [PEOPLE.approver.id]);
  await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
  await sql("set role authenticated");
  await sql(`insert into public.profiles (id, full_name, email, role, can_see_prices, can_see_financials, can_approve_payments)
             values ($1, 'Abe Approver', 'approver@schema-check.test', 'manager', false, true, true)`, [PEOPLE.approver.id]);
  await sql("reset role");
  await sql("select set_config('request.jwt.claims', '', false)");

  /* ── a made-up job: a vendor, documents, bills in every state, an invoice sent and a draft ── */
  const B = {};
  B.project = await one("insert into public.projects (name, city, status) values ('Books Schema Garage', 'Sandbox', 'in_progress') returning id, number");
  B.vendor = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Rory Madeup', 'Madeup Framing LLC', 'subcontractor', 'rory@example.com', '(805) 555-0199') returning id")).id;
  const leaf = (n) => (900 + n).toString(16).padStart(32, "0");
  const doc = async (n, name) => (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size) values ($1, 'receipts', $2, $3, 'application/pdf', 1000) returning id`,
    [B.project.id, name, "f/" + B.project.id + "/receipts/" + leaf(n) + "/" + name])).id;
  const bill = async (f) => (await one(`insert into public.bills (project_id, vendor_contact_id, vendor_name, invoice_number, amount, due_date, description, document_file_id, kind)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [B.project.id, f.vendor === false ? null : B.vendor, f.name || "Madeup Framing LLC", f.no, f.amount, f.due || today, f.description || null, f.doc || null, f.kind || null])).id;
  const approveAsAdmin = async (id, method) => {
    await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = amount, pay_method = $3 where id = $1", [id, PEOPLE.admin.id, method]);
  };
  B.waiting = await bill({ no: "S-1", amount: 3850, doc: await doc(1, "s1.pdf"), kind: "Subcontractor", description: "Footings" });
  B.nodoc = await bill({ no: "S-2", amount: 1264.18, kind: "Material supplier", vendor: false, name: "Madeup Lumber" });
  B.ready = await bill({ no: "S-3", amount: 2400, doc: await doc(3, "s3.pdf"), kind: "Subcontractor", description: "-10% retainage held" });
  await approveAsAdmin(B.ready, "check");
  B.either = await bill({ no: "S-4", amount: 1200, doc: await doc(4, "s4.pdf"), kind: "Equipment" });
  await approveAsAdmin(B.either, "both");
  await sql("insert into public.payments (bill_id, amount, method, reference, payee, memo) values ($1, 400, 'cash', 'slip 18', 'Madeup Rentals', 'deposit')", [B.either]);
  B.entered = await bill({ no: "S-5", amount: 812.4, doc: await doc(5, "s5.pdf"), kind: "Material supplier" });
  await approveAsAdmin(B.entered, "check");
  await sql("update public.bills set qbo_entered_at = now(), qbo_entered_by = $2, qbo_ref = 'QB-77' where id = $1", [B.entered, PEOPLE.admin.id]);
  B.inv = (await one("insert into public.invoices (project_id, status, sent_date, due_date) values ($1, 'sent', $2, $2) returning id", [B.project.id, today])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Garage framing', 1, 8400)", [B.inv]);
  B.draft = (await one("insert into public.invoices (project_id, status) values ($1, 'draft') returning id", [B.project.id])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Option', 1, 900)", [B.draft]);
  const counts = async () => one(`select (select count(*) from public.activity where project_id = $1)::int as act,
                                         (select count(*) from public.notifications_outbox)::int as outbox`, [B.project.id]);
  const before = await counts();
  const row = async (id) => one("select * from public.bills where id = $1", [id]);

  await check("P5b books: the names the pages use - books_desk's columns, the markers, the payments' columns, the RPCs' arguments", async () => {
    for (const c of books.DESK_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.books_desk.cols[c], "books_desk." + c);
    for (const c of books.BILL_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.bills.cols[c], "bills." + c);
    for (const c of books.PAYMENT_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.payments.cols[c], "payments." + c);
    for (const c of ["qbo_entered_at", "qbo_entered_by", "qbo_ref", "sent_date", "status"]) ok(catalog.tables.invoices.cols[c], "invoices." + c);
    const args = (f) => (catalog.functions[f] || []).map((x) => x.args.map((a) => a.name));
    same(args("approve_bill"), [["id", "pay_method", "version", "note"]], "approve_bill");
    same(args("set_bill_pay_method"), [["p_id", "p_method", "p_version"]], "set_bill_pay_method");
    same(args("mark_bills_entered"), [["p_ids", "p_ref"]], "mark_bills_entered");
    same(args("unmark_bills_entered"), [["p_ids"]], "unmark_bills_entered");
    same(args("mark_invoices_entered"), [["p_ids", "p_ref"]], "mark_invoices_entered");
    same(args("unmark_invoices_entered"), [["p_ids"]], "unmark_invoices_entered");
    same(args("payment_told"), [["p_id", "p_how", "p_version"]], "payment_told");
    same((await sql("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'bills_kind_check'"))[0].d.match(/'[^']+'/g),
      M.KINDS.map((k) => "'" + k.label + "'"), "bills.kind: the four words the page labels");
    same((await sql("select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'bills_pay_method_check'"))[0].d.match(/'[^']+'/g),
      M.PAY_METHODS.map((m) => "'" + m.id + "'"), "bills.pay_method: the five ways the bill page offers (check, cash, both, transfer, card)");
    for (const m of M.PAY_METHODS.map((x) => x.id)) {
      same((await sql("select array(select x from unnest(array['check', 'cash', 'ach', 'wire', 'card', 'other']) x where app.pay_method_allows($1, x)) as a", [m]))[0].a,
        M.allowedMethods(m), m + ": what the page lets the accountant record is what the database allows");
    }
  });

  await check("P5b books: The Books for the accountant, the admin and the approver - the piles as books_desk judges them, the cap from the approved amount, the CSV", async () => {
    for (const k of ["accountant", "admin", "approver"]) {
      await as(k);
      const d = await books.loadDesk(await me(), { today });
      const ids = (list) => list.filter((b) => b.projectId === B.project.id).map((b) => b.id).sort((a, b) => a - b);
      same(ids(d.ready), [B.ready, B.either].sort((a, b) => a - b), k + ": ready");
      same(ids(d.waiting), [B.waiting], k + ": waiting");
      same(ids(d.blocked), [B.nodoc], k + ": blocked");
      same(ids(d.entered), [B.entered], k + ": entered");
      same(d.blocked.find((b) => b.id === B.nodoc).reason, "No invoice attached, so it cannot be approved.", k + ": the database's reason");
      const e = d.checks.toPay.find((b) => b.id === B.either);
      same([e.owed, e.partial, e.allowed], [800, true, ["check", "cash"]], k + ": the cap");
      same(d.can.approve, k !== "accountant", k + ": approve");
      ok(rec.some((x) => x.table === "books_desk"), k + ": read through books_desk");
      const csv = M.toCsv(d.ready.filter((b) => b.projectId === B.project.id), M.BILL_COLUMNS);
      ok(csv.startsWith("﻿") && csv.includes("\"'-10% retainage held\"") && csv.includes('"Subcontractor"'), k + ": the CSV");
    }
  });

  await check("P5b books: nobody without financials (Q1), and not the agents account, is answered a bill, payment, invoice or desk row - and the pages ask for nothing", async () => {
    for (const k of ["manager", "manager2", "lead", "field", "viewer", "agents"]) {
      await as(k);
      if (k !== "agents") {
        const m = await me();
        rec.length = 0;
        await refused(() => books.loadDesk(m), "42501", k + " desk");
        await refused(() => books.loadBill(B.ready, m), "42501", k + " bill");
        same(await books.approvals(m), null, k + " approvals");
        same(rec.length, 0, k + ": asked for nothing");
      }
      for (const t of ["books_desk", "bills", "payments", "invoices"]) {
        const r = await origFrom(t).select("*");
        ok(!r.error ? (r.data || []).length === 0 : r.error.code === "42501", k + ": " + t + " " + JSON.stringify(r.error || (r.data || []).length));
      }
    }
  });

  await check("P5b books - acceptance check 2: approve only as an admin or a manager with approve; pay method required; version as shown; document required", async () => {
    let b = await row(B.waiting);
    for (const k of ["accountant", "manager", "manager2"]) {
      await as(k);
      await refused(() => books.approve({ id: B.waiting, version: b.version }, "check"), "42501", k);
    }
    await as("approver");
    await refused(() => books.approve({ id: B.waiting, version: b.version }, null), "22023", "no pay method");
    await refused(() => books.approve({ id: B.waiting, version: b.version - 1 }, "check"), "PT409", "a stale version");
    const nd = await row(B.nodoc);
    await refused(() => books.approve({ id: B.nodoc, version: nd.version }, "check"), "23514", "no document");
    const a = await books.approve({ id: B.waiting, version: b.version }, "check", "Matches the quote");
    same([a.approved_by, Number(a.approved_amount), a.pay_method, a.approval_note], [PEOPLE.approver.id, 3850, "check", "Matches the quote"], "approved");
    // an amount edit clears it (a money editor's versioned update)
    await as("accountant");
    const ed = await origFrom("bills").update({ amount: 3900 }).eq("id", B.waiting).eq("version", a.version).select("approved_at, pay_method");
    same(ed.data && ed.data[0], { approved_at: null, pay_method: null }, "the approval is cleared");
    await as("admin");
    b = await row(B.waiting);
    await books.approve({ id: B.waiting, version: b.version }, "cash");
    // a payment above the approved amount
    await as("accountant");
    await refused(() => books.recordPayment({ id: B.waiting, projectId: B.project.id }, { amount: 3900.01, method: "cash" }), "23514", "above the approved amount");
    await refused(() => books.recordPayment({ id: B.waiting, projectId: B.project.id }, { amount: 10, method: "check", checkNumber: "1" }), "23514", "not the approved method");
  });

  await check("P5b books: set_bill_pay_method for approvers, an approved bill with no payment, as shown", async () => {
    let b = await row(B.waiting);
    await as("accountant");
    await refused(() => books.setPayMethod({ id: B.waiting, version: b.version }, "both"), "42501", "an accountant");
    await as("approver");
    const r = await books.setPayMethod({ id: B.waiting, version: b.version }, "both");
    same(r.pay_method, "both", "set");
    await refused(() => books.setPayMethod({ id: B.waiting, version: b.version }, "check"), "PT409", "stale");
    b = await row(B.either);
    await refused(() => books.setPayMethod({ id: B.either, version: b.version }, "check"), "23514", "a part-paid bill");
  });

  await check("P5b books: the check desk - a payment with payee and memo, told by phone (payment_told), a told payment cannot be deleted", async () => {
    await as("accountant");
    const p = await books.recordPayment({ id: B.waiting, projectId: B.project.id },
      { amount: 1000, method: "check", checkNumber: "5401", payee: "Madeup Framing LLC", memo: "A Garage · Inv S-1 · Footings" });
    same([p.payee, p.memo, p.method, p.checkNumber, p.amount], ["Madeup Framing LLC", "A Garage · Inv S-1 · Footings", "check", "5401", 1000], "the row");
    const d = await books.loadDesk(await me(), { today });
    const t = d.checks.toTell.find((x) => x.paymentId === p.id);
    ok(t && t.amount === 1000 && t.version === p.version, "to tell");
    const who = M.resolvePayee(t, d.links);
    same([who.source, who.email], ["contact", "rory@example.com"], "reached through the bill's vendor contact");
    const told = await books.markTold(t, "phone");
    same([told.ok, told.toldHow], [true, "phone"], "told");
    const del = await origFrom("payments").delete().eq("id", p.id).select("id");
    same(del.error && del.error.code, "23514", "a told payment stays");
    await as("lead");
    await refused(() => books.markTold({ paymentId: p.id, version: told.version }, null), "42501", "a lead cannot clear it");
  });

  await check("P5b books: bank transfer and card (owner decision 2026-10-21) on the real rules - the approver approves one bill for a bank transfer and one for card; the accountant records an ACH payment with its confirmation and no check number, and a card payment (a check, cash, a card or 'other' on the transfer bill and ACH on the card bill refused in the database's words); the desk lists both on 'Pay by bank transfer or card' (books_desk pay_pile transfer_card, to_tell 0), never on the check desk; nobody is told about them (payment_told refuses)", async () => {
    // set-up as the owner (documents and bills); what they log is not the books' writes (acceptance check 5 below)
    const s0 = await counts();
    await as(null);
    B.transfer = await bill({ no: "S-8", amount: 4120, doc: await doc(8, "s8.pdf"), kind: "Subcontractor", description: "Moment frame" });
    B.card = await bill({ no: "S-9", amount: 386.5, doc: await doc(9, "s9.pdf"), kind: "Equipment", description: "Plate compactor" });
    const s1 = await counts();
    before.act += s1.act - s0.act;
    before.outbox += s1.outbox - s0.outbox;
    await as("approver");
    const t = await books.approve({ id: B.transfer, version: (await row(B.transfer)).version }, "transfer", "Wire or ACH");
    const c = await books.approve({ id: B.card, version: (await row(B.card)).version }, "card");
    same([t.pay_method, c.pay_method, t.approved_by], ["transfer", "card", PEOPLE.approver.id], "approved by the approver");
    const nv = (await row(B.nodoc)).version;
    await refused(() => books.approve({ id: B.nodoc, version: nv }, "ach"), "22023", "ACH is a payment method, not a pay method");
    await as("accountant");
    const wv = (await row(B.waiting)).version;
    await refused(() => books.approve({ id: B.waiting, version: wv }, "transfer"), "42501", "never the accountant");
    for (const [m, words] of [["check", "the bill is approved for bank transfer payment"], ["cash", "the bill is approved for bank transfer payment"],
                              ["card", "the bill was approved to be paid by bank transfer (ACH or wire)"], ["other", "the bill was approved to be paid by bank transfer (ACH or wire)"]]) {
      const e = await refused(() => books.recordPayment({ id: B.transfer, projectId: B.project.id }, { amount: 10, method: m, checkNumber: "77" }), "23514", m + " on a transfer bill");
      ok(String(e.message).indexOf(words) === 0, m + ": " + e.message);
    }
    const p = await books.recordPayment({ id: B.transfer, projectId: B.project.id },
      { amount: 2000, method: "ach", checkNumber: "ACH 0041-7781", payee: "Madeup Framing LLC", memo: "first half" });
    same([p.method, p.checkNumber, p.reference, p.collectable], ["ach", "", "ACH 0041-7781", false], "the ACH payment: its confirmation, no check number");
    const e2 = await refused(() => books.recordPayment({ id: B.card, projectId: B.project.id }, { amount: 10, method: "ach" }), "23514", "no ACH on a card bill");
    ok(String(e2.message).indexOf("the bill was approved to be paid by card") === 0, e2.message);
    const cp = await books.recordPayment({ id: B.card, projectId: B.project.id }, { amount: 86.5, method: "card", checkNumber: "AUTH 448120" });
    same([cp.method, cp.reference, cp.checkNumber], ["card", "AUTH 448120", ""], "a card payment");
    const d = await books.loadDesk(await me(), { today });
    const byId = (x, y) => x[0] - y[0];
    same(d.checks.toSend.filter((b) => b.projectId === B.project.id).map((b) => [b.id, b.payMethod, b.pile, b.owed]).sort(byId),
      [[B.transfer, "transfer", "transfer_card", 2120], [B.card, "card", "transfer_card", 300]].sort(byId), "their own list, what is still owed");
    ok(!d.checks.toPay.some((b) => b.id === B.transfer || b.id === B.card), "never on the check desk");
    ok(!d.checks.toTell.some((x) => x.paymentId === p.id || x.paymentId === cp.id), "nobody to tell");
    const desk = await origFrom("books_desk").select("id, pay_pile, to_tell").in("id", [B.transfer, B.card, B.ready]);
    same(desk.data.map((r) => [r.id, r.pay_pile, r.to_tell]).sort(byId),
      [[B.ready, "check_desk", 0], [B.transfer, "transfer_card", 0], [B.card, "transfer_card", 0]].sort(byId), "books_desk.pay_pile and to_tell");
    await refused(() => books.markTold({ paymentId: p.id, version: p.version }, "phone"), "22023", "an ACH payment is never picked up");
    same(d.todo.filter((x) => x.kind === "transfer" || x.kind === "card").map((x) => [x.kind, x.to]), [["transfer", "secSend"], ["card", "secSend"]], "the to-do lines");
    same(M.toCsv(d.ready.filter((b) => b.id === B.transfer), M.BILL_COLUMNS).split("\r\n")[1].split('","')[10], "Bank transfer", "the CSV's pay method");
  });

  await check("P5b books - acceptance check 3: mark entered only the ready bill (refused[] with the database's reasons); locked while marked; unmark; invoices", async () => {
    await as("accountant");
    const d = await books.loadDesk(await me(), { today });
    const r = await books.markBillsEntered([B.ready, B.nodoc, B.entered, 999999999], "  QB   batch 9 ");
    same(r.marked, [B.ready], "marked");
    same(r.refused.map((x) => [x.id, x.reason]), [[B.nodoc, "No invoice attached, so it cannot be approved."], [B.entered, "Already entered as QB-77."],
      [999999999, "No such bill."]], "refused");
    same(M.refusedLines(r.refused, d.byId)[1], "Madeup Framing LLC #S-5: Already entered as QB-77.", "said in the accountant's words");
    const m = await row(B.ready);
    same([m.qbo_entered_by, m.qbo_ref], [PEOPLE.accountant.id, "QB batch 9"], "the stamp");
    const ed = await origFrom("bills").update({ amount: 1 }).eq("id", B.ready).eq("version", m.version).select("id");
    same(ed.error && ed.error.code, "23514", "a marked bill is locked");
    const direct = await origFrom("bills").update({ qbo_ref: "x" }).eq("id", B.nodoc).select("id");
    same(direct.error && direct.error.code, "42501", "the marker is never a person's write");
    await as("manager");
    await refused(() => books.markBillsEntered([B.ready], null), "42501", "a manager without financials");
    await as("accountant");
    const u = await books.unmarkBillsEntered([B.ready, B.nodoc]);
    same([u.marked, u.refused], [[B.ready], [{ id: B.nodoc, reason: "It was not marked as entered." }]], "unmarked");
    const iv = await books.markInvoicesEntered([B.inv, B.draft], "INV-9");
    same([iv.marked, iv.refused], [[B.inv], [{ id: B.draft, reason: "Not sent yet." }]], "invoices");
    same((await books.unmarkInvoicesEntered([B.inv])).marked, [B.inv], "invoice unmarked");
  });

  await check("P5b books - acceptance check 5: none of the books' writes added an activity row or an outbox row", async () => {
    same(await counts(), before, "activity and outbox");
  });

  await check("P5b books: drift - the demo database (tools/fake/p5b-books.js) has books_desk's columns and the RPCs' arguments; the demo's money tables have exactly the real columns", async () => {
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p5b-books.js")).href);
    const NS = globalThis.DCR2Fake;
    const ext = NS.extTables.find((x) => (x.tables || []).includes("books_desk"));
    same(Object.keys(ext.cols.books_desk).sort(), Object.keys(catalog.tables.books_desk.cols).sort(), "books_desk columns");
    for (const [name, want] of Object.entries(NS.p5bBooksSigs)) {
      same(want, (catalog.functions[name] || [])[0] ? catalog.functions[name][0].args.map((a) => a.name) : null, name);
    }
    // the demo's money tables have the real columns, no more and no fewer (a column only the demo has would let a
    // page read something the database never answers)
    const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["bills", "payments", "invoices", "invoice_lines", "client_payments", "files", "current_files"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
    }
  });

  client.from = origFrom;
  client.rpc = origRpc;
}
