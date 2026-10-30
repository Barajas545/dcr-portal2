/* DCR Portal 2 — Advanced mode's vendor list and reports against the REAL database rules (development only): the Books
   program's release B part 2b, P5 part of tools/schema-check.mjs (it calls run() with its own helpers).
   site/js/repo/vendors.js, repo/books-reports.js, map/vendors.js and map/books-reports.js run over PGlite loaded with
   every DCR Desktop 2 migration - 20261030000500_books_reports (M5) included: point DCR_DESKTOP2_DIR at a checkout of
   the branch books-messages - as each made-up role:

   * names: every column the modules select (vendor_profiles, contacts, bills, projects, payments, money_events,
     money_messages) and every RPC argument they send exist; every column the map modules read is in the four report
     functions' answers;
   * who (S3, S4): the accountant and an admin read every report; the demo approver (financials, NO prices) is refused
     every report function (42501) and the Reports page's reads ask the database nothing; the vendor list gives them
     the vendors' facts only - books_vendor_balances is not even asked, nor any amount; a manager without financials, a
     lead, field and view-only are refused before any read; the agents account and anon are refused;
   * the math is the database's (I25): the vendor list's owed equals books_desk's, vendor by vendor; AP aging on a day
     counts what was approved and paid BY that day only; the 1099 worksheet uses $600 through 2025 and $2,000 from
     2026 unless the page sends a threshold for its view, and leaves card payments and materials suppliers' bills out;
     payments by month never says cash cleared;
   * vendor_profiles (S12): the save is an upsert at the version shown - new, then at its version, PT409 when stale or
     added meanwhile; a money editor writes (a manager with financials too), a manager without financials and a lead
     are refused; nobody deletes; no tax id column;
   * the approval log and the money history are read for the reports' people only;
   * drift: the demo database (tools/fake/p8-advanced.js) has the real columns and the functions' arguments.
   Made-up people and jobs only. */
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, refused, catalog, SITE } = h;
  const F = catalog.functions;
  if (!(F.books_ap_aging && F.books_vendor_balances && F.books_1099 && F.books_payments_by_month && catalog.tables.vendor_profiles && catalog.tables.money_events)) {
    results.push({ section, name: "The Books program's M5 (20261030000500_books_reports) is not in DCR Desktop 2 yet: the vendor list and reports checks wait for it (DCR_DESKTOP2_DIR)", ok: true });
    return;
  }
  const site = (p) => import(pathToFileURL(path.join(SITE, "js", p)).href);
  const vendors = await site("repo/vendors.js");
  const reports = await site("repo/books-reports.js");
  const mm = await site("repo/money-messages.js");
  const V = await site("map/vendors.js");
  const R = await site("map/books-reports.js");
  const B = await site("map/books.js");
  const today = (await one("select app.today()::text as d")).d;
  const year = Number(today.slice(0, 4));
  const addDays = (k, d) => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10) + d)).toISOString().slice(0, 10);
  const J = {};

  const me = async (key) => {
    const p = await one("select id, full_name as name, role, active, coalesce(can_see_prices, false) as can_see_prices, coalesce(can_see_financials, false) as can_see_financials, " +
      "coalesce(can_approve_payments, false) as can_approve_payments from public.profiles where id = $1", [PEOPLE[key].id]);
    return Object.assign({}, p, { can_see_financials: p.role === "admin" || p.can_see_financials, can_see_prices: p.role === "admin" || p.can_see_prices });
  };
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
  const raw = async (n, a) => { const r = await origRpc(n, a); if (r.error) throw Object.assign(new Error(r.error.message), r.error); return r.data; };

  /* ── a made-up job: a subcontractor with three bills (one paid in part by check and cash), a materials supplier paid
     by check, a vendor with no contact paid by card ── */
  await sql("reset role");
  if (!PEOPLE.approver) {
    PEOPLE.approver = { id: "c2000000-0000-4000-8000-0000000008b1", name: "Abe Approver", role: "manager" };
    await sql("insert into auth.users (id, email) values ($1, 'approver@schema-check.test') on conflict do nothing", [PEOPLE.approver.id]);
    await sql(`insert into public.profiles (id, full_name, email, role, can_see_prices, can_see_financials, can_approve_payments)
               values ($1, 'Abe Approver', 'approver@schema-check.test', 'manager', false, true, true) on conflict do nothing`, [PEOPLE.approver.id]);
  }
  J.project = await one("insert into public.projects (name, city, status) values ('Advanced Schema Barn', 'Sandbox', 'in_progress') returning id, number");
  const pid = J.project.id;
  J.aspen = (await one("insert into public.contacts (name, company, kind, email, phone) values ('Ada Aspenmade', 'Madeup Aspenmade Framing', 'subcontractor', 'ada.aspenmade@example.com', '(805) 555-0185') returning id")).id;
  J.birch = (await one("insert into public.contacts (name, company, kind) values ('Bo Birchmade', 'Madeup Birchmade Lumber', 'supplier') returning id")).id;
  const leaf = (n) => (0x8c00 + n).toString(16).padStart(32, "0");
  let n = 0;
  const bill = async (contact, company, no, amount, kind, due, method) => {
    const id = (await one(`insert into public.bills (project_id, vendor_contact_id, vendor_name, invoice_number, amount, kind, due_date, invoice_date)
       values ($1, $2, $3, $4, $5, $6, $7::date, app.today() - 50) returning id`, [pid, contact, company, no, amount, kind, due])).id;
    const doc = (await one(`insert into public.files (project_id, folder, name, storage_path, mime, size, bill_id)
       values ($1, 'receipts', $2, $3, 'application/pdf', 900, $4) returning id`, [pid, no + ".pdf", "f/" + pid + "/receipts/" + leaf(++n) + "/" + no + ".pdf", id])).id;
    await sql("update public.bills set document_file_id = $2 where id = $1", [id, doc]);
    if (method) await sql("update public.bills set approved_by = $2, approved_at = now(), approved_amount = amount, pay_method = $3 where id = $1", [id, PEOPLE.admin.id, method]);
    return id;
  };
  J.a1 = await bill(J.aspen, "Madeup Aspenmade Framing", "ASP-1", 1000, "Subcontractor", addDays(today, 10), "both");
  J.a2 = await bill(J.aspen, "Madeup Aspenmade Framing", "ASP-2", 500, "Subcontractor", addDays(today, -45), "check");
  J.a3 = await bill(J.aspen, "Madeup Aspenmade Framing", "ASP-3", 300, "Subcontractor", addDays(today, 5), null);
  J.b1 = await bill(J.birch, "Madeup Birchmade Lumber", "BIR-1", 800, "Material supplier", addDays(today, -5), "check");
  J.c1 = await bill(null, "Madeup Cedarmade Walk-in", "CED-1", 250, "Other", null, "card");
  const pay = async (billId, amount, method, number, payee) => (await one(`insert into public.payments (bill_id, project_id, amount, method, check_number, reference, payee, paid_date)
     values ($1, $2, $3, $4, $5, $6, $7, app.today() - 2) returning id`, [billId, pid, amount, method, method === "check" ? number : null, method === "check" ? null : number, payee])).id;
  J.p1 = await pay(J.a1, 600, "check", "TEST-8C1", "Madeup Aspenmade Framing");
  J.p2 = await pay(J.a1, 100, "cash", "slip 8c2", "Madeup Aspenmade Framing");
  J.p3 = await pay(J.b1, 800, "check", "TEST-8C3", "Madeup Birchmade Lumber");
  J.p4 = await pay(J.c1, 250, "card", "card 8c4", "Madeup Cedarmade Walk-in");
  const sameYear = addDays(today, -2).slice(0, 4) === today.slice(0, 4);

  await check("P8 advanced: the names - every column the vendor list and the reports select, the report functions' arguments, and every column the maps read in their answers", async () => {
    const cols = (s) => s.split(",").map((x) => x.trim());
    for (const c of cols(vendors.PROFILE_COLS)) ok(catalog.tables.vendor_profiles.cols[c], "vendor_profiles." + c);
    for (const c of cols(vendors.CONTACT_COLS)) ok(catalog.tables.contacts.cols[c], "contacts." + c);
    for (const c of cols(reports.BILL_COLS)) ok(catalog.tables.bills.cols[c], "bills." + c);
    for (const c of cols(reports.PROJECT_COLS)) ok(catalog.tables.projects.cols[c], "projects." + c);
    for (const c of cols(reports.LINE_COLS).concat(["voided_at"])) ok(catalog.tables.payments.cols[c], "payments." + c);
    for (const c of cols(reports.EVENT_COLS)) ok(catalog.tables.money_events.cols[c], "money_events." + c);
    for (const c of cols(reports.CONTACT_COLS)) ok(catalog.tables.contacts.cols[c], "contacts." + c + " (the money history's vendors)");
    for (const c of cols(mm.MESSAGE_COLS)) ok(catalog.tables.money_messages.cols[c], "money_messages." + c);
    const args = (f) => (F[f] || [])[0] ? F[f][0].args.map((a) => a.name) : null;
    same(args("books_ap_aging"), ["p_as_of"], "books_ap_aging");
    same(args("books_vendor_balances"), [], "books_vendor_balances");
    same(args("books_1099"), ["p_year", "p_threshold"], "books_1099");
    same(args("books_payments_by_month"), ["p_from", "p_to"], "books_payments_by_month");
    await as("accountant");
    const keysOf = async (fn, a, want) => {
      const rows = await raw(fn, a);
      ok(Array.isArray(rows) && rows.length, fn + ": rows");
      for (const k of want) ok(k in rows[0], fn + " answers " + k);
    };
    await keysOf("books_ap_aging", { p_as_of: today }, ["as_of", "vendor_contact_id", "vendor_key", "vendor_name", "open_bills", "current", "d1_30", "d31_60", "d61_90", "d90_plus",
      "no_due", "waiting_approval", "total", "oldest_due_date", "bill_ids"]);
    await keysOf("books_vendor_balances", {}, ["vendor_contact_id", "vendor_key", "vendor_name", "contact_kind", "bills", "open_bills", "billed", "approved", "paid", "owed",
      "past_due", "waiting_approval", "paid_ytd", "paid_last_year", "last_paid_date", "last_paid_amount", "tax_1099", "legal_name", "w9_received_on", "w9_missing",
      "insurance_expires_on", "insurance_expired", "workers_comp_expires_on", "workers_comp_exempt", "workers_comp_expired", "license_number", "profile_version"]);
    await keysOf("books_1099", { p_year: Number(addDays(today, -2).slice(0, 4)) }, ["year", "vendor_contact_id", "vendor_key", "vendor_name", "legal_name", "tax_1099", "w9_received_on",
      "paid_check", "paid_cash", "paid_transfer", "paid_other", "card_excluded", "materials_excluded", "reportable_total", "payments", "threshold", "reportable", "needs_w9"]);
    await keysOf("books_payments_by_month", { p_from: addDays(today, -2), p_to: today }, ["month", "method", "payments", "total", "voided", "voided_total", "cleared",
      "cleared_total", "not_cleared", "not_cleared_total"]);
  });

  await check("P8 advanced: who - the accountant and an admin read every report; the approver (no prices) is refused every one and the Reports page asks nothing; a manager without financials, a lead, field, view-only, the agents account and anon are refused", async () => {
    for (const k of ["accountant", "admin"]) {
      await as(k);
      const who = await me(k);
      ok((await reports.apAging(who, today)).length > 0 && (await reports.vendorBalances(who)).length > 0, k + ": aging, balances");
      ok(Array.isArray(await reports.worksheet1099(who, year, null)) && Array.isArray(await reports.paymentsByMonth(who, addDays(today, -30), today)), k + ": 1099, months");
      const hist = await reports.moneyHistory(who, addDays(today, -1), today);
      ok(hist.events.some((e) => e.bill_id === J.a1 && e.kind === "bill_added") && hist.events.some((e) => e.payment_id === J.p1 && e.kind === "payment_recorded"), k + ": the money history of the made-up job");
      ok(Array.isArray((await reports.approvalLog(who, addDays(today, -1), today)).messages), k + ": the approval log");
    }
    await as("approver");
    const ap = await me("approver");
    same([ap.can_see_financials, ap.can_see_prices], [true, false], "the approver: financials, no prices");
    for (const [fn, a] of [["books_ap_aging", {}], ["books_vendor_balances", {}], ["books_1099", { p_year: year }], ["books_payments_by_month", { p_from: today, p_to: today }]]) {
      const e = await refused(() => raw(fn, a), "42501", "approver: " + fn);
      same(e.message, "the Books reports need the financials and prices switches", fn + ": the database's words");
    }
    asked.length = 0;
    for (const fn of [() => reports.apAging(ap, today), () => reports.moneyHistory(ap, today, today), () => reports.approvalLog(ap, today, today), () => reports.paymentLines(ap, today, today)]) {
      await refused(fn, "42501", "approver: the Reports page");
    }
    same(asked, [], "the approver: the Reports page asked the database nothing");
    for (const k of ["manager", "lead", "field", "viewer", "agents"]) {
      await as(k);
      await refused(() => raw("books_vendor_balances", {}), "42501", k + ": books_vendor_balances");
      await refused(() => raw("books_1099", { p_year: year }), "42501", k + ": books_1099");
      if (k !== "agents") {
        const who = await me(k);
        asked.length = 0;
        await refused(() => vendors.loadVendors(who), "42501", k + ": the vendor list");
        same(asked, [], k + ": nothing asked");
      }
      same(((await origFrom("money_events").select("id").limit(3)).data || []).length, 0, k + ": money_events shows nothing");
      same(((await origFrom("vendor_profiles").select("contact_id").limit(3)).data || []).length, 0, k + ": vendor_profiles shows nothing");
    }
    await as(null);
    await refused(() => raw("books_ap_aging", {}), null, "anon");
  });

  await check("P8 advanced: S4 - the vendor list for the approver (financials, no prices) is the facts only: books_vendor_balances not asked, no amount column, no amount in the answer", async () => {
    await as("approver");
    const ap = await me("approver");
    asked.length = 0;
    const d = await vendors.loadVendors(ap);
    ok(!d.prices && d.vendors.some((v) => v.contactId === J.aspen), "the made-up subcontractor is listed");
    ok(!asked.includes("rpc:books_vendor_balances"), "the priced function is not asked: " + asked.join(" | "));
    for (const s of asked.filter((x) => x.includes(":"))) ok(!/\bamount\b|owed|paid/.test(s), "no amount asked: " + s);
    for (const v of d.vendors) ok(!("owed" in v) && !("paid" in v) && !("paidYtd" in v), "no amount in " + v.name);
    const csv = B.toCsv(d.vendors, V.vendorColumns(false));
    ok(!/Owed|Paid/.test(csv), "the CSV carries no amount column");
  });

  await check("P8 advanced: the math is the database's - the vendor list's owed equals books_desk's; AP aging on a day; the 1099 threshold and exclusions; cash never clears", async () => {
    await as("accountant");
    const who = await me("accountant");
    const d = await vendors.loadVendors(who);
    const aspen = d.vendors.find((v) => v.contactId === J.aspen);
    const desk = await one("select sum(owed)::numeric as owed, sum(paid_total)::numeric as paid from public.books_desk where vendor_contact_id = $1", [J.aspen]);
    same([aspen.owed, aspen.paid, aspen.bills, aspen.pastDue, aspen.waiting], [Number(desk.owed), Number(desk.paid), 3, 500, 300], "owed as books_desk; past due; waiting");
    same([aspen.owed, aspen.paidYtd], [1100, sameYear ? 700 : 0], "1000 - 700 + 500 + 300; paid this year");
    const walk = d.vendors.find((v) => v.key === "nmadeup cedarmade walk-in");
    ok(walk && !walk.linked && walk.paid === 250, "a vendor with no contact, by its name");
    const ag = (await reports.apAging(who, today)).map(R.toAging).find((r) => r.contactId === J.aspen);
    same([ag.current, ag.d31_60, ag.waiting, ag.total, ag.openBills], [600, 500, 300, 1100, 3], "aging today");
    // three days back: nothing was approved by then, and the payment two days back does not count
    const back = (await reports.apAging(who, addDays(today, -3))).map(R.toAging).find((r) => r.contactId === J.aspen);
    same([back.total, back.waiting, back.d31_60, back.current], [1800, 1800, 500, 1300], "aging three days back");
    // the 1099 worksheet of the payments' year
    const y = Number(addDays(today, -2).slice(0, 4));
    const def = y <= 2025 ? 600 : 2000;
    same(V.threshold1099(y), def, "the page's default is the database's");
    const w0 = (await reports.worksheet1099(who, y, null)).map(V.to1099);
    const a0 = w0.find((r) => r.contactId === J.aspen);
    same([a0.check, a0.cash, a0.total, a0.threshold, a0.reportable, a0.needsW9], [600, 100, 700, def, false, false], "under the default threshold");
    const birch = w0.find((r) => r.contactId === J.birch), cedar = w0.find((r) => r.key === "nmadeup cedarmade walk-in");
    same([birch.total, birch.materials], [0, 800], "a materials supplier's bill does not count");
    same([cedar.total, cedar.card], [0, 250], "a card payment does not count (the card company's 1099-K)");
    const w1 = (await reports.worksheet1099(who, y, 500)).map(V.to1099).find((r) => r.contactId === J.aspen);
    same([w1.threshold, w1.reportable, w1.needsW9], [500, false, true], "a threshold for this view: over it, no W-9 - but not flagged 1099 yet");
    await refused(() => reports.worksheet1099(who, 1999, null), "22023", "a year out of range");
    await refused(() => reports.worksheet1099(who, y, -1), "22023", "a negative threshold");
    const months = (await reports.paymentsByMonth(who, addDays(today, -2), addDays(today, -2))).map(R.toMonth);
    const cash = months.find((m) => m.method === "cash");
    ok(cash && cash.cleared === null && cash.notCleared === null && cash.total >= 100, "cash never clears: " + JSON.stringify(cash));
    const chk = months.find((m) => m.method === "check");
    ok(chk && chk.total >= 1400 && chk.cleared !== null, "checks: live, cleared or not");
    await refused(() => reports.paymentsByMonth(who, today, addDays(today, -1)), "22023", "to before from");
    // the Bill payments CSV of the period
    const lines = await reports.paymentLines(who, addDays(today, -2), addDays(today, -2));
    const mine = lines.payments.map((p) => R.toPaymentLine(p, lines)).filter((l) => [J.p1, J.p2, J.p3, J.p4].includes(Number(l.id)));
    same(mine.map((l) => [l.vendor, l.invoiceNumber, l.amount, l.method, l.ref]).sort(), [
      ["Madeup Aspenmade Framing", "ASP-1", 100, "cash", "slip 8c2"], ["Madeup Aspenmade Framing", "ASP-1", 600, "check", "TEST-8C1"],
      ["Madeup Birchmade Lumber", "BIR-1", 800, "check", "TEST-8C3"], ["Madeup Cedarmade Walk-in", "CED-1", 250, "card", "card 8c4"]].sort(), "one line a payment");
  });

  await check("P8 advanced: vendor_profiles - the save is an upsert at the version shown (PT409 when stale or added meanwhile); money editors write, a manager without financials and a lead are refused; nobody deletes; no tax id", async () => {
    await as("accountant");
    const who = await me("accountant");
    let v = (await vendors.loadVendors(who)).vendors.find((x) => x.contactId === J.aspen);
    same(v.profileVersion, null, "no details yet");
    const r1 = await vendors.saveProfile(v, { tax1099: true, legalName: "  Madeup   Aspenmade LLC ", w9On: "", insuranceOn: addDays(today, 20), wcExempt: true, license: "C-0008C1" });
    same([r1.tax_1099, r1.legal_name, r1.workers_comp_exempt, r1.version], [true, "Madeup Aspenmade LLC", true, 1], "added (the database tidies the words)");
    await refused(() => vendors.saveProfile(v, { tax1099: false }), "PT409", "added meanwhile: the page held no details");
    v = (await vendors.loadVendors(who)).vendors.find((x) => x.contactId === J.aspen);
    same([v.profileVersion, v.tax1099, v.w9Missing, v.legalName], [1, true, true, "Madeup Aspenmade LLC"], "read back");
    const r2 = await vendors.saveProfile(v, { tax1099: true, legalName: "Madeup Aspenmade LLC", w9On: addDays(today, -1), insuranceOn: addDays(today, 20), wcExempt: true, license: "C-0008C1" });
    same([r2.version, r2.w9_received_on], [2, addDays(today, -1)], "changed at its version");
    const e = await refused(() => vendors.saveProfile(v, { tax1099: false }), "PT409", "stale");
    ok(e.current && Number(e.current.version) === 2, "theirs comes back");
    const w = (await reports.worksheet1099(who, Number(addDays(today, -2).slice(0, 4)), 500)).map(V.to1099).find((r) => r.contactId === J.aspen);
    same([w.tax1099, w.reportable, w.needsW9], [true, true, false], "a 1099 vendor over the view's threshold, the W-9 on file");
    // the exempt-or-a-date rule is the database's too
    v = (await vendors.loadVendors(who)).vendors.find((x) => x.contactId === J.aspen);
    const body = { workers_comp_exempt: true, workers_comp_expires_on: addDays(today, 30) };
    const bad = await origFrom("vendor_profiles").update(body).eq("contact_id", J.aspen).eq("version", v.profileVersion).select("contact_id");
    same(bad.error && bad.error.code, "23514", "exempt and a date: refused");
    // a manager who approves and sees financials is a money editor too
    await as("approver");
    const ap = await me("approver");
    const va = (await vendors.loadVendors(ap)).vendors.find((x) => x.contactId === J.birch);
    const rb = await vendors.saveProfile(va, { tax1099: false, insuranceOn: addDays(today, 100) });
    same(rb.version, 1, "the approver adds a supplier's details");
    for (const k of ["manager", "lead"]) {
      await as(k);
      const ins = await origFrom("vendor_profiles").insert({ contact_id: J.aspen, tax_1099: false }).select("contact_id");
      same(ins.error && ins.error.code, "42501", k + ": no insert");
      const upd = await origFrom("vendor_profiles").update({ notes: "x" }).eq("contact_id", J.aspen).select("contact_id");
      ok(upd.error || !(upd.data || []).length, k + ": no update");
    }
    await as("accountant");
    const del = await origFrom("vendor_profiles").delete().eq("contact_id", J.aspen).select("contact_id");
    ok((del.error && del.error.code === "42501") || !(del.data || []).length, "nobody deletes: " + JSON.stringify(del.error || del.data));
    ok(await one("select 1 as x from public.vendor_profiles where contact_id = $1", [J.aspen]), "still there");
    const taxLike = Object.keys(catalog.tables.vendor_profiles.cols).filter((c) => /tin|ssn|ein|tax_?id|bank|routing|account/i.test(c));
    same(taxLike, [], "no tax id or bank column (S12)");
    const ev = await reports.moneyHistory(who, today, today);
    const vc = ev.events.filter((x) => x.kind === "vendor_changed" && Number(x.contact_id) === J.aspen).map((x) => R.toEvent(x, ev));
    ok(vc.length >= 2, "the changes are in the money history");
    same(vc.map((x) => [x.vendor, x.detail]).slice(-2).reverse(), [["Madeup Aspenmade Framing", "added: 1099, legal name, insurance date, workers' comp exempt, license"],
      ["Madeup Aspenmade Framing", "changed: W-9 date"]], "the database's own detail keys in words, with the vendor (oldest first)");
  });

  await check("P8 advanced: drift - the demo database (tools/fake/p8-advanced.js) has the real columns and the report functions' arguments", async () => {
    await import(pathToFileURL(path.join(SITE, "..", "tools", "fake", "p8-advanced.js")).href);
    const NS = globalThis.DCR2Fake;
    for (const [name, want] of Object.entries(NS.p8AdvancedSigs)) {
      same(want, (F[name] || [])[0] ? F[name][0].args.map((a) => a.name) : null, name);
    }
    const H = await import(pathToFileURL(path.join(SITE, "..", "tests", "pages-engine.mjs")).href);
    const engine = await H.freshEngine(new Date());
    for (const t of ["vendor_profiles", "money_events"]) {
      same(Object.keys(engine.COLS[t] || {}).sort(), Object.keys(catalog.tables[t].cols).sort(), "the demo's " + t + " columns");
    }
  });

  client.from = origFrom;
  client.rpc = origRpc;
}
