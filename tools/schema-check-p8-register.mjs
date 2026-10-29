/* DCR Portal 2 — the check register's and the payment panel's calls against the REAL database rules (development
   only): the Books program's release A, P3 part of tools/schema-check.mjs (it calls run() with its own helpers).
   site/js/repo/checks.js (loadRegister, the register RPCs, the void switch), repo/books.js (PAYMENT_COLS, recordPayment
   with paidDate) and map/checks.js (checkKey, buildRegister, clashText) run over PGlite loaded with every DCR Desktop 2
   migration - 20261030000300_check_register (M3) included - as each made-up role:

   * names: every column the modules select (check_register, payments, settings, current_files) and every RPC argument
     they send exist; checkKey equals app.check_key on every vector;
   * who: the register reads and the next number for the financials switch only (a manager without it, a lead, field
     and view-only are refused before anything is read; the RPCs refuse them 42501); the writes for money editors;
   * the payment panel: paidDate today - 400 to today + 31 (22023 outside), a check number used once (23505 in the
     database's own words, which clashText keeps), one check for several bills of the same payee on the same day, the
     next number (the last recorded all-digit check + 1, a TEST- check never moves it), check_number_info;
   * the register: one line per physical check, picked up (told "in person" when nobody was), clear_payments with its
     refused lines and undo, spoil / unspoil, the void switch (55000 while off; a settings PATCH an admin's only), a void
     FINAL - owed again in books_desk, the number never written again; without the prices switch no amount is asked;
   * drift: the demo database (tools/fake/p8-register.js, p5b-books.js) has the real check_register, spoiled_checks and
     payments columns, books_desk's tail, settings.payments_void_enabled and the RPCs' arguments.
   Made-up people and jobs only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  if (!(catalog.tables.check_register && catalog.tables.payments && catalog.tables.payments.cols.voided_at && catalog.functions.void_payment)) {
    results.push({ section, name: "The Books program's M3 (20261030000300_check_register) is not in DCR Desktop 2 yet: the check register checks wait for it", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const books = await site("repo/books.js");
  const checks = await site("repo/checks.js");
  const C = await site("map/checks.js");
  const M = await site("map/books.js");
  const today = (await one("select app.today()::text as d")).d;
  const J = {};

  const me = async (key) => {
    const p = await one("select id, full_name as name, role, active, coalesce(can_see_prices, false) as can_see_prices, coalesce(can_see_financials, false) as can_see_financials, " +
      "coalesce(can_approve_payments, false) as can_approve_payments from public.profiles where id = $1", [PEOPLE[key].id]);
    return Object.assign({}, p, { can_see_financials: p.role === "admin" || p.can_see_financials, can_see_prices: p.role === "admin" || p.can_see_prices });
  };
  /* every select's columns, as `as()` made the client act */
  const asked = [];
  const origFrom = client.from.bind(client);
  const origRpc = client.rpc.bind(client);
  client.from = function (t) {
    const b = origFrom(t);
    const sel = b.select.bind(b);
    b.select = (cols, o) => { asked.push(t + ":" + (cols || "*")); return sel(cols, o); };
    asked.push(t);
    return b;
  };
  client.rpc = function (n, a) { asked.push("rpc:" + n); return origRpc(n, a); };

  /* ── a made-up job: three made-up vendors, bills approved for check ── */
  await sql("reset role");
  J.project = await one("insert into public.projects (name, city, status) values ('Register Schema Barn', 'Sandbox', 'in_progress') returning id, number");
  const pid = J.project.id;
  const vendor = async (company) => (await one("insert into public.contacts (name, company, kind, email, phone) values ($1, $2, 'subcontractor', $3, '(805) 555-0177') returning id",
    ["Sam " + company.split(" ")[1], company, "register." + company.split(" ")[1].toLowerCase() + "@example.com"])).id;
  J.oak = await vendor("Madeup Oak Framing");
  J.elm = await vendor("Madeup Elm Concrete");
  const leaf = (n) => (0x7e00 + n).toString(16).padStart(32, "0");
  let n = 0;
  const bill = async (contact, company, no, amount) => {
    const id = (await one(`insert into public.bills (project_id, vendor_contact_id, vendor_name, invoice_number, amount, kind, due_date)
       values ($1, $2, $3, $4, $5, 'Subcontractor', app.today()) returning id`, [pid, contact, company, no, amount])).id;
    const doc = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, bill_id)
       values ($1, 'receipts', $2, $3, 'application/pdf', 900, $4) returning id`, [pid, no + ".pdf", "f/" + pid + "/receipts/" + leaf(++n) + "/" + no + ".pdf", id])).id;
    await sql("update public.bills set document_file_id = $2 where id = $1", [id, doc]);
    await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = amount, pay_method = 'check' where id = $1", [id, PEOPLE.admin.id]);
    return { id, projectId: pid };
  };
  J.b1 = await bill(J.oak, "Madeup Oak Framing", "OAK-1", 1000);
  J.b2 = await bill(J.oak, "Madeup Oak Framing", "OAK-2", 400);
  J.b3 = await bill(J.elm, "Madeup Elm Concrete", "ELM-1", 900);
  J.b4 = await bill(null, "Madeup Walk-in Sub", "WALK-1", 300);
  const N = (k) => String(880600 + k);           // made-up check numbers far from any other section's
  const pay = async (key, f) => {
    await as(key);
    return books.recordPayment(f.bill, { amount: f.amount, method: "check", checkNumber: f.number, payee: f.payee, memo: "Barn", paidDate: f.date });
  };
  const addDays = (k, d) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + d)).toISOString().slice(0, 10);

  await check("P8 register: the names - check_register's, the payments' and settings' columns the modules select, the RPCs' arguments; checkKey = app.check_key", async () => {
    for (const c of (checks.REGISTER_COLS + ", " + checks.REGISTER_AMOUNT_COLS).split(",").map((x) => x.trim())) ok(catalog.tables.check_register.cols[c], "check_register." + c);
    for (const c of books.PAYMENT_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.payments.cols[c], "payments." + c);
    for (const c of (checks.REGISTER_PAYMENT_COLS + ", amount").split(",").map((x) => x.trim())) ok(catalog.tables.payments.cols[c], "payments." + c);
    for (const c of checks.SETTINGS_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.settings.cols[c], "settings." + c);
    for (const c of books.FILE_COLS.split(",").map((x) => x.trim())) ok(catalog.tables.current_files.cols[c], "current_files." + c);
    const args = (f) => (catalog.functions[f] || []).map((x) => x.args.map((a) => a.name));
    same(args("void_payment"), [["p_id", "p_reason", "p_version"]], "void_payment");
    same(args("payment_picked_up"), [["p_id", "p_on", "p_version", "p_note", "p_date"]], "payment_picked_up");
    same(args("clear_payments"), [["p_ids", "p_on", "p_on_date"]], "clear_payments");
    same(args("spoil_check"), [["p_number", "p_reason"]], "spoil_check");
    same(args("unspoil_check"), [["p_id"]], "unspoil_check");
    same(args("next_check_number"), [[]], "next_check_number");
    same(args("check_number_info"), [["p_number", "p_payment_id"]], "check_number_info");
    for (const v of ["#1043", " 1043", "01043", "1043", "TEST-1", "test-1", "0", "000", "00a7", "5-3-1", "#", "", "  ", "1043b", "é1", "１２"]) {
      const db = (await one("select app.check_key($1) as k", [v])).k;
      same(C.checkKey(v), db, "checkKey(" + JSON.stringify(v) + ")");
    }
  });

  await check("P8 register: who - the financials switch reads (a manager without it, a lead, field, view-only refused before any read); the RPCs say 42501", async () => {
    for (const k of ["admin", "accountant"]) {
      await as(k);
      const raw = await checks.loadRegister(await me(k));
      ok(Array.isArray(raw.rows) && raw.next && "next" in raw.next, k + ": the register and the next number");
      same(raw.can.money, true, k + ": a money editor");
    }
    for (const k of ["manager", "lead", "field", "viewer"]) {
      await as(k);
      const who = await me(k);
      asked.length = 0;
      await refused(() => checks.loadRegister(who), "42501", k);
      same(asked, [], k + ": nothing asked");
      await refused(() => checks.nextCheckNumber(), "42501", k + ": next_check_number");
      await refused(() => checks.spoilCheck("880999", "torn up"), "42501", k + ": spoil_check");
      const rows = (await client.from("check_register").select("check_number").limit(5)).data || [];
      same(rows.length, 0, k + ": the view shows nothing");
    }
  });

  await check("P8 register: the payment panel - paidDate within today - 400 / + 31, a number used once in the database's words, one check for several bills of one payee on one day", async () => {
    J.p1 = await pay("accountant", { bill: J.b1, amount: 600, number: N(1), payee: "Madeup Oak Framing", date: addDays(today, -2) });
    same([J.p1.paidDate, J.p1.checkNumber], [addDays(today, -2), N(1)], "dated two days back");
    J.p2 = await pay("accountant", { bill: J.b2, amount: 400, number: N(1), payee: "Madeup Oak Framing", date: addDays(today, -2) });
    ok(J.p2 && J.p2.id, "the same check pays the payee's second bill, the same day");
    const e = await refused(() => pay("accountant", { bill: J.b3, amount: 100, number: "0" + N(1), payee: "Madeup Elm Concrete" }), "23505", "another payee");
    ok(/^Check 880601 is already in the check register \(Madeup Oak Framing, [A-Z][a-z]{2} \d{1,2}, \d{4}\): a check number is used once/.test(C.clashText(e)), "the database's words: " + e.message);
    await refused(() => pay("accountant", { bill: J.b1, amount: 10, number: N(1), payee: "Madeup Oak Framing", date: today }), "23505", "the payee's, another day");
    await refused(() => pay("accountant", { bill: J.b3, amount: 10, number: N(9), date: addDays(today, 32) }), "22023", "32 days ahead");
    await refused(() => pay("accountant", { bill: J.b3, amount: 10, number: N(9), date: addDays(today, -401) }), "22023", "401 days back");
    J.post = await pay("accountant", { bill: J.b3, amount: 100, number: N(3), payee: "Madeup Elm Concrete", date: addDays(today, 31) });
    same(J.post.paidDate, addDays(today, 31), "post-dated 31 days");
    // a bill with no contact (a public-form bill) is known by its name
    J.walk = await pay("accountant", { bill: J.b4, amount: 300, number: N(4), payee: "Madeup Walk-in Sub" });
    await as("accountant");
    const nx = await checks.nextCheckNumber();
    same(nx.next, N(5), "the last recorded check + 1");
    J.test1 = await pay("accountant", { bill: J.b3, amount: 1, number: "TEST-" + N(0), payee: "Madeup Elm Concrete" });
    await as("accountant");
    same((await checks.nextCheckNumber()).next, N(5), "a TEST- check never moves it");
    const info = await checks.checkNumberInfo(N(1), null);
    same([info.free, info.clash && info.clash.payee, info.next], [false, "Madeup Oak Framing", N(5)], "check_number_info");
    same((await checks.checkNumberInfo(N(7), null)).free, true, "a free one");
  });

  await check("P8 register: one line per physical check; picked up (told in person when nobody was), its bounds and undo; the stamps system code's only", async () => {
    await as("accountant");
    const raw = await checks.loadRegister(await me("accountant"));
    const d = C.buildRegister(raw, { today: raw.today });
    const line = (num) => d.rows.find((r) => r.number === num);
    same(line(N(1)).paymentIds.length, 2, "the shared check is one line");
    same([line(N(1)).status, line(N(1)).payee, line(N(1)).amount], ["written", "Madeup Oak Framing", 1000], "its status, payee and live amount");
    const p = line(N(1)).live[0];
    await refused(() => checks.pickedUp(p, true, { date: addDays(today, 1) }), "22023", "tomorrow");
    const r = await checks.pickedUp(p, true, { note: "their foreman" });
    same([r.toldHow, r.pickedUpNote, !!r.pickedUpAt], ["in person", "their foreman", true], "picked up and told in person");
    await checks.pickedUp(line(N(1)).live[1], true, {});
    const raw2 = await checks.loadRegister(await me("accountant"));
    const l2 = C.buildRegister(raw2, { today: raw2.today }).rows.find((x) => x.number === N(1));
    same(l2.status, "picked_up", "both payments picked up: the check is");
    await checks.pickedUp(l2.live[1], false);
    const row = await one("select id, version from public.payments where id = $1", [J.p1.id]);
    const bad = await client.from("payments").update({ cleared_on: today }).eq("id", row.id).eq("version", row.version).select("id");
    same(bad.error && bad.error.code, "42501", "a person cannot stamp it by an update");
  });

  await check("P8 register: clear_payments - a statement date (a post-dated check from the day it was recorded), the refused lines, undo; a cleared check is never deleted", async () => {
    await as("accountant");
    const res = await checks.clearPayments([J.p1.id, J.walk.id, J.post.id], true, today);
    // a post-dated check may clear from the day it was recorded (docs/DATABASE.md §33.9, decision 2)
    same(res.changed.slice().sort((x, y) => x - y), [J.p1.id, J.walk.id, J.post.id].map(Number).sort((x, y) => x - y), "cleared");
    ok(res.refused.length === 0 || res.refused.every((x) => x.reason), "refusals carry a reason");
    const early = await checks.clearPayments([J.p2.id], true, addDays(today, -30));
    same(early.refused.map((x) => x.reason), ["It was written after that day."], "before its first day");
    const undo = await checks.clearPayments(res.changed, false);
    same(undo.changed.slice().sort(), res.changed.slice().sort(), "undo");
    await checks.clearPayments([J.walk.id], true, today);
    await refused(async () => { const r = await client.from("payments").delete().eq("id", J.walk.id); if (r.error) throw r.error; }, "23514", "a cleared payment stays");
  });

  await check("P8 register: spoil a blank (never a written number), unspoil; the next number moves past a spoiled one", async () => {
    await as("accountant");
    await refused(() => checks.spoilCheck(N(1), "torn up"), "23505", "a written number");
    const s = await checks.spoilCheck(N(5), "Torn in the printer");
    same([s.number, s.reason], [N(5), "Torn in the printer"], "spoiled");
    same((await checks.nextCheckNumber()).next, N(6), "past the spoiled one");
    await refused(() => pay("accountant", { bill: J.b3, amount: 10, number: N(5) }), "23505", "a spoiled number");
    await as("accountant");
    await checks.unspoilCheck(s.id);
    await refused(() => checks.unspoilCheck(s.id), "PT404", "gone");
  });

  await check("P8 register: void - 55000 while off; the switch is an admin's settings PATCH; then FINAL: owed again, never changed or deleted, the number never written again", async () => {
    await as("accountant");
    const p = await one("select id, version from public.payments where id = $1", [J.post.id]);
    await refused(() => checks.voidPayment(p, "lost in the mail"), "55000", "off");
    const sw = await checks.voidSwitch();
    same([sw.on, sw.ready], [false, true], "off, and readable");
    await refused(() => checks.setVoidEnabled(true, sw.version), "42501", "the accountant cannot turn it on");
    await as("admin");
    const on = await checks.setVoidEnabled(true, sw.version);
    same(on.on, true, "the admin turns it on");
    await as("accountant");
    await refused(() => checks.voidPayment(p, "no"), "22023", "a reason of 3 to 300");
    const v = await checks.voidPayment(p, "Lost in the mail");
    ok(v.voidedAt && v.voidReason === "Lost in the mail", JSON.stringify(v));
    const desk = await one("select owed, paid_total, voided_count from public.books_desk where id = $1", [J.b3.id]);
    same([Number(desk.paid_total), Number(desk.voided_count)], [1, 1], "the void counts in no sum (the TEST- check's 1 is live)");
    const raw = await checks.loadRegister(await me("accountant"));
    const l = C.buildRegister(raw, { today: raw.today }).rows.find((x) => x.number === N(3));
    same([l.status, l.amount, l.writtenAmount, l.voidReason], ["void", 0, 100, "Lost in the mail"], "the register's line");
    await refused(() => pay("accountant", { bill: J.b3, amount: 50, number: N(3), payee: "Madeup Elm Concrete", date: addDays(today, 31) }), "23505", "never written again");
    const after = await one("select version from public.payments where id = $1", [J.post.id]);
    const upd = await client.from("payments").update({ memo: "x" }).eq("id", J.post.id).eq("version", after.version).select("id");
    same(upd.error && upd.error.code, "23514", "a void is frozen");
    await as("admin");
    const s2 = await checks.voidSwitch();
    await checks.setVoidEnabled(false, s2.version);
  });

  await check("P8 register: without the prices switch (S4) the register asks for no amount - neither the view's nor the payments'", async () => {
    if (!PEOPLE.approver) { ok(true, "no approver in this run"); return; }
    await as("approver");
    asked.length = 0;
    const raw = await checks.loadRegister(await me("approver"));
    ok(raw.rows.length > 0, "read");
    for (const s of asked.filter((x) => /^(check_register|payments):/.test(x))) ok(!/\bamount\b|written_amount/.test(s), "no amount column: " + s);
    ok(raw.rows.every((r) => !("amount" in r) && !("written_amount" in r)), "no amount in the answer");
    const csv = M.toCsv(C.buildRegister(raw, { today: raw.today }).rows, C.checkColumns(false));
    ok(!/Amount/.test(csv), "no amount column in the CSV");
  });

  await check("P8 register: drift - the demo database (tools/fake/p8-register.js, p5b-books.js) has the real columns and the RPCs' arguments", async () => {
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p5b-books.js")).href);
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p8-register.js")).href);
    const NS = globalThis.DCR2Fake;
    for (const [name, want] of Object.entries(NS.p8RegisterSigs)) {
      same(want, (catalog.functions[name] || [])[0] ? catalog.functions[name][0].args.map((a) => a.name) : null, name);
    }
    const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["check_register", "spoiled_checks", "payments", "books_desk"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
    }
    ok("payments_void_enabled" in engine.COLS.settings, "settings.payments_void_enabled");
  });

  client.from = origFrom;
  client.rpc = origRpc;
}
