/* DCR Portal 2 — the expense ledger's queries against the REAL database rules (development only): P5b's ledger part of
   tools/schema-check.mjs (it calls run() with its own helpers). Portal 2's own site/js/repo/ledger.js runs over PGlite
   loaded with every DCR Desktop 2 migration, M5b 20261026000100_books_ledger.sql included, as each role:

   * the names the ledger reads exist and answer: costs' card / card_by / card_at / reconciled_by / reconciled_at /
     employee_id / employee_source, files.cost_id (a receipt and a replaced version of it), the bills' kind and the
     payments' payee / memo / pick-up stamp embedded in the bills, the invoices with their lines and client payments,
     the timesheet hours by employee;
   * the database infers a labour row's crew member (one employee named by its words) and the page reads it as
     "inferred"; confirm_cost_employee(p_ids, p_employee_id) makes it "confirmed" (or nobody);
   * tag_costs(p_ids, p_card) and reconcile_costs(p_ids, p_on) as Portal 2 calls them: {changed, unchanged, refused}
     read back by repo.outcome; the stamp is the caller's; "untagged" takes the stamp off; a reconciled row whose card
     changes is not reconciled any more; a card outside the 8 ids is 22023;
   * who: the accountant and the admin read and write; a manager without financials, a manager with prices, a lead,
     field, view-only and the agents account are answered no cost, bill, payment or invoice and are refused every
     write (42501) — no answer they receive carries an amount column;
   * P5 check 5: none of the ledger's writes adds an activity row;
   * drift: the demo database (tools/fake/p5b-ledger.js) has the same costs columns and RPC arguments as the real one.
   Made-up people and jobs only. */
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const HAS = !!(catalog.functions.tag_costs && catalog.functions.reconcile_costs && catalog.functions.confirm_cost_employee &&
    catalog.tables.costs && catalog.tables.costs.cols.card && catalog.tables.files.cols.cost_id);
  if (!HAS) {
    results.push({ section, name: "M5b (20261026000100_books_ledger) is not in DCR Desktop 2 yet: the P5b ledger checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const repo = await site("repo/ledger.js");
  const L = await site("map/ledger.js");
  const P5 = await site("map/payments.js");
  const today = (await one("select app.today()::text as d")).d;

  /* every answer the module received: [{table, data}] */
  const rec = [];
  const origFrom = client.from.bind(client);
  client.from = function (t) {
    const b = origFrom(t);
    const then0 = b.then.bind(b);
    b.then = function (res, rej) {
      return then0(function (r) { rec.push({ table: t, data: r && r.data }); return res ? res(r) : r; }, rej);
    };
    return b;
  };
  const MONEY_TABLES = ["costs", "bills", "payments", "invoices", "invoice_lines", "client_payments"];

  /* ── a made-up job ── */
  const J = {};
  await sql("reset role");
  J.project = await one("insert into public.projects (name, city, status) values ('Ledger Schema Shed', 'Sandbox', 'in_progress') returning id, number");
  J.emp = (await one("insert into public.employees (full_name, employee_no) values ('Quill Ledgerton', 'E-9101') returning id")).id;
  J.emp2 = (await one("insert into public.employees (full_name, employee_no) values ('Wren Tallymark', 'E-9102') returning id")).id;
  J.est = (await one("insert into public.estimates (project_id, name, status) values ($1, 'Shed framing', 'approved') returning id", [J.project.id])).id;
  J.item = (await one("insert into public.estimate_items (estimate_id, name, group_name) values ($1, 'Rafters', 'Roof') returning id", [J.est])).id;
  const cost = async (f) => (await one(`insert into public.costs (project_id, estimate_item_id, cost_date, kind, description, vendor, amount, hours, rate)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [J.project.id, f.item || null, f.date || today, f.kind, f.description || null, f.vendor || null, f.amount === undefined ? null : f.amount, f.hours || null, f.rate || null])).id;
  J.mat = await cost({ kind: "material", description: "Rafter lumber", vendor: "Made-up Lumber Yard", amount: 512.4, item: J.item });
  J.lab = await cost({ kind: "labor", description: "Quill - cut rafters", hours: 4, rate: 50 });
  J.sub = await cost({ kind: "subcontractor", description: "Roofer, half day", vendor: "Made-up Roofing", amount: 900 });
  J.eq = await cost({ kind: "equipment", description: "Lift rental", amount: 120 });
  J.credit = await cost({ kind: "material", description: "Returned blocks", amount: -40.5 });
  const leaf = (n) => n.toString(16).padStart(32, "0");
  J.r1 = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, cost_id)
     values ($1, 'receipts', 'yard receipt.jpg', $2, 'image/jpeg', 1000, $3) returning id`, [J.project.id, "f/" + J.project.id + "/receipts/" + leaf(1) + "/yard receipt.jpg", J.mat])).id;
  J.r2 = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, cost_id)
     values ($1, 'receipts', 'yard receipt.jpg', $2, 'image/jpeg', 1200, $3) returning id, previous_id`, [J.project.id, "f/" + J.project.id + "/receipts/" + leaf(2) + "/yard receipt.jpg", J.mat]));
  J.r3 = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, cost_id)
     values ($1, 'receipts', 'roofer invoice.pdf', $2, 'application/pdf', 900, $3) returning id`, [J.project.id, "f/" + J.project.id + "/receipts/" + leaf(3) + "/roofer invoice.pdf", J.sub])).id;
  J.doc = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size)
     values ($1, 'receipts', 'roofer bill.pdf', $2, 'application/pdf', 900) returning id`, [J.project.id, "f/" + J.project.id + "/receipts/" + leaf(4) + "/roofer bill.pdf"])).id;
  J.bill = (await one(`insert into public.bills (project_id, vendor_name, invoice_number, amount, document_file_id, kind, due_date)
     values ($1, 'Made-up Roofing', 'R-77', 900, $2, 'Subcontractor', $3) returning id`, [J.project.id, J.doc, today])).id;
  await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = 900, pay_method = 'check' where id = $1", [J.bill, PEOPLE.admin.id]);
  J.pay = (await one(`insert into public.payments (bill_id, amount, method, check_number, payee, memo) values ($1, 400, 'check', '7001', 'Made-up Roofing LLC', 'Shed roof, part')
     returning id`, [J.bill])).id;
  J.inv = (await one("insert into public.invoices (project_id, status, sent_date, due_date) values ($1, 'sent', $2, $2) returning id", [J.project.id, today])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price) values ($1, 'Shed framing', 1, 3200)", [J.inv]);
  await sql("insert into public.client_payments (invoice_id, amount, method) values ($1, 1000, 'check')", [J.inv]);
  const actCount = async () => Number((await one("select count(*) as n from public.activity where project_id = $1", [J.project.id])).n);

  await check("P5b ledger: the accountant reads every cost with its line, kind columns, the database's inferred employee and its receipts (files.cost_id, the newest version)", async () => {
    await as("accountant");
    rec.length = 0;
    const got = await repo.loadLedger();
    const mine = got.rows.filter((r) => r.projectId === J.project.id);
    same(mine.length, 5, "five costs");
    const lab = mine.find((r) => r.id === J.lab);
    same([lab.amount, lab.labor, lab.cost, lab.employeeName, lab.employeeSource], [200, 200, 200, "Quill Ledgerton", "inferred"], "labour: hours x rate, the inferred crew member");
    const mat = mine.find((r) => r.id === J.mat);
    same([mat.group, mat.receipts.length, Number(mat.receipts[0].id)], ["Roof — Rafters", 1, Number(J.r2.id)], "the line; one receipt (the replaced version dropped)");
    same(Number(J.r2.previous_id), Number(J.r1), "the second upload of the same name for the same cost is a new version of the first");
    const eq = mine.find((r) => r.id === J.eq);
    same([eq.cost, eq.other], [0, 120], "equipment: listed, not in cost");
    same(mine.every((r) => r.card === "untagged"), true, "the column's default: untagged");
    ok(got.employees.some((e) => e.full_name === "Quill Ledgerton"), "the employees (names only)");
    ok(got.invoices.some((i) => i.id === J.inv && i.invoice_lines.length === 1), "the invoices with their lines (billed out)");
    const t = L.summarize(mine);
    same([t.cost, t.other], [1571.9, 120], "cost = materials + subcontractor + labour (a credit included)");
  });

  await check("P5b ledger: tag_costs / reconcile_costs / confirm_cost_employee as Portal 2 calls them — answers, stamps, the reconciled mark cleared by a card change, no activity row", async () => {
    await as("accountant");
    const a0 = await actCount();
    same(await repo.tagCosts([J.mat, J.sub, 999999999], "card-amex"), { changed: 2, unchanged: 0, refused: [{ id: 999999999, reason: "No such cost." }] }, "tag");
    const m = await one("select card, card_by, card_at from public.costs where id = $1", [J.mat]);
    same([m.card, m.card_by, !!m.card_at], ["card-amex", PEOPLE.accountant.id, true], "stamped with the caller");
    same((await repo.tagCosts([J.mat], "card-amex")).unchanged, 1, "already so");
    same(await repo.reconcileCosts([J.mat, J.sub], true), { changed: 2, unchanged: 0, refused: [] }, "reconcile");
    same((await one("select reconciled_by from public.costs where id = $1", [J.sub])).reconciled_by, PEOPLE.accountant.id, "reconciled by the caller");
    await repo.tagCosts([J.sub], "check");
    same((await one("select reconciled_at from public.costs where id = $1", [J.sub])).reconciled_at, null, "a different card is not what was reconciled");
    await repo.tagCosts([J.mat], "untagged");
    const u = await one("select card, card_by, card_at from public.costs where id = $1", [J.mat]);
    same([u.card, u.card_by, u.card_at], ["untagged", null, null], "untagged: no stamp");
    await refused(() => repo.tagCosts([J.mat], "Amex 1007"), "22023", "the card vocabulary is the client's check too");
    const direct = await client.rpc("tag_costs", { p_ids: [J.mat], p_card: "amex-1007" });
    same(direct.error && direct.error.code, "22023", "the database's check");
    same(await repo.confirmEmployee([J.lab], J.emp), { changed: 1, unchanged: 0, refused: [] }, "confirm");
    const rows = (await repo.loadLedger()).rows;
    same(rows.find((r) => r.id === J.lab).employeeSource, "confirmed", "confirmed");
    await repo.confirmEmployee([J.lab], J.emp2);
    const e2 = await one("select employee_id, employee_source from public.costs where id = $1", [J.lab]);
    same([Number(e2.employee_id), e2.employee_source], [Number(J.emp2), "confirmed"], "another employee");
    await refused(() => repo.confirmEmployee([J.lab], 999999999), "22023", "not on the employee list");
    await repo.confirmEmployee([J.lab], null);
    same((await one("select employee_id, employee_source from public.costs where id = $1", [J.lab])), { employee_id: null, employee_source: null }, "nobody");
    await repo.reconcileCosts([J.mat], false);
    same(await actCount(), a0, "no activity row (P5 check 5)");
  });

  await check("P5b ledger: the project's Expenses and Payments reads — the bill's kind, its payments with payee, memo and pick-up stamp; invoices with lines and client payments; the hours", async () => {
    await as("admin");
    const ex = await repo.projectExpenses(J.project.id);
    same(ex.length, 5, "the project's costs");
    const pay = await repo.projectPayments(J.project.id);
    const b = pay.bills.find((x) => x.id === J.bill);
    ok(b && b.kind === "Subcontractor" && b.payments.length === 1 && b.payments[0].payee === "Made-up Roofing LLC" && b.payments[0].memo === "Shed roof, part" &&
      "pickup_told_at" in b.payments[0], "the bill: " + JSON.stringify(b));
    const d = P5.decorateBill(b, today);
    same([d.state, d.paid, d.owed, d.kind], ["part_paid", 400, 500, "Subcontractor"], "Desktop 2's state");
    const iv = P5.decorateInvoice(pay.invoices.find((x) => x.id === J.inv), today);
    same([iv.total, iv.paid, iv.balance], [3200, 1000, 2200], "the invoice");
    const hours = await repo.hoursBetween(null, null);
    ok(Array.isArray(hours.rows) && typeof hours.total === "number", "timesheet hours read");
  });

  await check("P5b ledger: without financials (a manager — Q1 —, a manager with prices, a lead, field, view-only, the agents account): no cost, bill, payment or invoice in any answer; every write refused", async () => {
    for (const k of ["manager", "manager2", "lead", "field", "viewer", "agents"]) {
      await as(k);
      rec.length = 0;
      const got = await repo.loadLedger().catch(() => ({ rows: [], invoices: [] }));
      same([got.rows.length, got.invoices.length], [0, 0], k + ": nothing");
      const pay = await repo.projectPayments(J.project.id).catch(() => ({ bills: [], invoices: [] }));
      same(pay.bills.length + pay.invoices.length, 0, k + ": no bill, no invoice");
      for (const x of rec.filter((r) => MONEY_TABLES.includes(r.table))) same((x.data || []).length, 0, k + ": " + x.table + " answered nothing");
      ok(!rec.some((x) => x.table === "files" && (x.data || []).length), k + ": no receipt row");
      await refused(() => repo.tagCosts([J.mat], "cash"), "42501", k + " tag");
      await refused(() => repo.reconcileCosts([J.mat], true), "42501", k + " reconcile");
      await refused(() => repo.confirmEmployee([J.lab], J.emp), "42501", k + " confirm");
    }
  });

  await check("P5b ledger: the RPCs' argument names are the database's (catalog), and the demo database's costs columns are the real ones", async () => {
    const args = (n) => (catalog.functions[n] || [])[0].args.map((a) => a.name);
    same(args("tag_costs"), Object.keys(repo.RPC.tag.args([1], "cash")), "tag_costs");
    same(args("reconcile_costs"), Object.keys(repo.RPC.reconcile.args([1], true)), "reconcile_costs");
    same(args("confirm_cost_employee"), Object.keys(repo.RPC.confirm.args([1], 1)), "confirm_cost_employee");
    for (const c of repo.COST_COLS.split(",").map((s) => s.trim())) ok(c in catalog.tables.costs.cols, "costs." + c);
    for (const c of repo.RECEIPT_COLS.split(",").map((s) => s.trim())) ok(c in catalog.tables.files.cols, "files." + c);
    const harness = path.join(SITE, "..", "tests", "pages-engine.mjs");
    if (!existsSync(harness)) return;
    const H = await import(pathToFileURL(harness).href);
    const engine = await H.freshEngine(new Date());
    const demo = Object.keys(engine.COLS.costs).sort();
    const real = Object.keys(catalog.tables.costs.cols).sort();
    same(demo, real, "the demo's costs columns");
    ok("cost_id" in engine.COLS.files, "the demo's files.cost_id");
  });
}
