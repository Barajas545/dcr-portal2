/* DCR Portal 2 — the Progress Chart's queries against the REAL database rules (development only): P5a's part of
   tools/schema-check.mjs (it calls pmChecks with its own helpers). Portal 2's own site/js/repo/pm.js runs over
   PGlite loaded with every DCR Desktop 2 migration, M5a 20261025000100_office_pm.sql included, as each role:

   * the M5a names the chart reads (estimate_item_flags with by / at, quote_prices with the amount, the priced
     document and the quote's notes, quotes without any of them, estimate_item_totals.priced, quote_follow_up(p_id),
     quote_commitments' columns);
   * a lead, a manager without prices (Q1), field and view-only: the quotes and change orders listed (Q11), the
     flags, and NOT ONE money column in any answer - every answer the module received is checked (acceptance 1);
     no quote notes; the same "priced" (and so the same bidding steps) as the admin's, a draft change order's priced
     item included; the item's log name scrubbed the same way for everyone (the quick note);
   * a manager with prices: the amounts on items and quotes, still no money table; admin and accountant: bills,
     invoices, costs and quote_commitments (a change order billed past its price reported as over-billed);
   * the item flags: a lead sets, changes and clears one (by / at the database's; one amount-free log line each,
     even when the item's name quotes an amount); field, view-only and the accountant refused; a stale version
     is PT409; quote_follow_up: quote editors only, one more on app.today();
   * the agents account reads no quote, price, flag or commitment.
   Made-up people and jobs only. */

export async function pmChecks(h) {
  const { check, as, site, sql, one, PEOPLE, client, sbm, ok, same, refused, results, catalog, section } = h;
  const HAS = !!(catalog.tables.estimate_item_flags && catalog.tables.quote_prices && catalog.functions.quote_follow_up && catalog.tables.quote_commitments);
  if (!HAS) {
    results.push({ section, name: "M5a (20261025000100_office_pm) is not in DCR Desktop 2 yet: the P5a progress-chart checks wait for it", ok: true });
    return;
  }
  const pm = await site("repo/pm.js");
  const C = await site("pm-chart.js");
  const people = await site("repo/people.js");
  const today = (await sql("select app.today()::text as d"))[0].d;

  /* what every call answered: [{table, data}] (the module's own REST answers) */
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
  const keysIn = (v, out) => {
    out = out || new Set();
    if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
    else if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); keysIn(v[k], out); });
    return out;
  };
  const MONEY_TABLES = ["quote_prices", "estimate_item_totals", "estimate_item_prices", "bills", "payments", "invoices", "invoice_lines",
    "client_payments", "costs", "quote_commitments"];
  const MONEY_KEYS = ["amount", "total", "labor_total", "material_total", "quoted_price", "approved_amount", "committed", "billed", "paid",
    "document_url", "labor_rate", "labor_unit_price", "material_unit_price", "unit_price"];
  async function loadAs(key, pid) {
    await as(key);
    people.clearPeople();
    const me = await sbm.me({ fresh: true });
    rec.length = 0;
    const got = await pm.load(pid, me, { today });
    return { me, got, asked: new Set(rec.map((x) => x.table)), keys: keysIn(rec.map((x) => x.data)) };
  }

  /* ── a made-up job: two estimates, a change order, quotes, flags, bills, an invoice ── */
  const P = {};
  await sql("reset role");
  P.project = await one("insert into public.projects (name, city, status) values ('PM Schema Barn', 'Sandbox', 'in_progress') returning id, number");
  P.est = (await one("insert into public.estimates (project_id, name, status) values ($1, 'Main framing', 'approved') returning id", [P.project.id])).id;
  P.co = (await one("insert into public.estimates (project_id, name, status, kind) values ($1, 'Extra window', 'approved', 'change_order') returning id", [P.project.id])).id;
  const item = async (est, name, group) => (await one(
    "insert into public.estimate_items (estimate_id, name, group_name, labor_guys, labor_days, material_qty, description) values ($1, $2, $3, 2, 3, 10, 'Includes the $1,200 credit') returning id",
    [est, name, group])).id;
  P.i1 = await item(P.est, "Floor joists", "Floor");
  P.i2 = await item(P.est, "Walls ($900 allowance)", "Walls");
  P.i3 = await item(P.co, "Rough opening", null);
  await sql("update public.estimate_item_prices set material_unit_price = 48.75, quoted_price = 900 where item_id = $1", [P.i1]);
  const quote = async (itemId, f, amount) => {
    const q = await one(`insert into public.quotes (project_id, estimate_item_id, vendor_name, kind, status, requested_date, received_date)
                         values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [P.project.id, itemId, f.vendor, f.kind || "quote", f.status, f.requested || today, f.received || null]);
    await sql("update public.quote_prices set amount = $2, document_url = $3 where quote_id = $1", [q.id, amount, amount ? "https://example.com/q" + q.id + ".pdf" : null]);
    return q.id;
  };
  P.q1 = await quote(P.i1, { vendor: "Kestrel Lumber Supply", status: "awarded", received: today }, 9150);
  P.q2 = await quote(P.i2, { vendor: "Marlow Concrete", status: "requested" }, null);
  P.q3 = await quote(P.i3, { vendor: "Ashgrove Trim", status: "awarded", kind: "change_order", received: today }, 860);
  // the quote's notes name its price: they live in quote_prices (M5a review) - never in what a person without prices reads
  await sql("update public.quote_prices set notes = 'Their price $4,850 incl. delivery; crane $350 extra' where quote_id = $1", [P.q1]);
  // a DRAFT change order with a priced item: only the database's "priced" tells a person without prices
  P.co2 = (await one("insert into public.estimates (project_id, name, status, kind) values ($1, 'Porch option', 'draft', 'change_order') returning id", [P.project.id])).id;
  P.i4 = await item(P.co2, "Porch posts", null);
  await sql("update public.estimate_item_prices set labor_unit_price = 400 where item_id = $1", [P.i4]);
  // the flag is set by a lead, as people set them (the database fills by / at)
  await as("lead");
  const fl = await client.from("estimate_item_flags").insert({ item_id: P.i1, state: "blocked", note: "Waiting on the $300 permit" }).select("*");
  if (fl.error) throw new Error("setting up the flag: " + fl.error.code + " " + fl.error.message);
  await as(null);
  await sql("reset role");
  const bill = async (f) => (await one(`insert into public.bills (project_id, estimate_item_id, quote_id, vendor_name, amount, due_date, approved_by, approved_at, approved_amount, pay_method)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [P.project.id, f.item || null, f.quote || null, f.vendor, f.amount, f.due || null, f.approved ? PEOPLE.admin.id : null, f.approved ? "2026-10-01T17:00:00Z" : null,
      f.approved ? f.amount : null, f.approved ? "check" : null])).id;
  P.b1 = await bill({ item: P.i1, quote: P.q1, vendor: "Kestrel Lumber Supply", amount: 9150, approved: true });
  await sql("insert into public.payments (bill_id, amount, method, check_number) values ($1, 4000, 'check', '5201')", [P.b1]);
  P.b2 = await bill({ quote: P.q3, vendor: "Ashgrove Trim", amount: 980, approved: true, due: "2026-10-01" });
  P.b3 = await bill({ vendor: "Pump Rental", amount: 650 });
  P.inv = (await one("insert into public.invoices (project_id, status, sent_date, due_date) values ($1, 'sent', $2, $2) returning id", [P.project.id, today])).id;
  await sql("insert into public.invoice_lines (invoice_id, description, qty, unit_price, estimate_id) values ($1, 'Framing draw', 1, 14800, $2)", [P.inv, P.est]);
  await sql("insert into public.costs (project_id, kind, description, amount) values ($1, 'equipment', 'Generator fuel', 86.40)", [P.project.id]);

  await check("the M5a names the chart reads: flags (by, at), quote_prices (amount, document_url), quotes without money, quote_follow_up(p_id), quote_commitments", async () => {
    for (const c of ["item_id", "project_id", "state", "note", "due_date", "by", "at", "version"]) ok(catalog.tables.estimate_item_flags.cols[c], "estimate_item_flags." + c);
    for (const c of ["quote_id", "amount", "document_url", "notes", "version"]) ok(catalog.tables.quote_prices.cols[c], "quote_prices." + c);
    for (const c of ["amount", "document_url", "notes"]) ok(!catalog.tables.quotes.cols[c], "quotes." + c + " is gone (Q11)");
    ok(catalog.tables.estimate_item_totals.cols.priced, "estimate_item_totals.priced (the same yes / no for every reader)");
    for (const c of pm.QUOTE_COLS.split(",").map((s) => s.trim())) ok(catalog.tables.quotes.cols[c], "quotes." + c);
    same(catalog.functions.quote_follow_up.map((f) => f.args.map((a) => a.name)), [["p_id"]], "quote_follow_up(p_id)");
    for (const c of ["quote_id", "project_id", "committed", "billed", "approved", "paid", "waiting_count", "pct_billed", "pct_paid", "over_billed",
      "over_billed_by", "over_paid", "paid_unapproved"]) ok(catalog.tables.quote_commitments.cols[c], "quote_commitments." + c);
    for (const [t, cols] of [["estimate_items", pm.ITEM_COLS], ["estimates", pm.ESTIMATE_COLS], ["tasks", pm.TASK_COLS], ["current_files", pm.FILE_COLS],
      ["costs", pm.COST_COLS]]) {
      for (const c of cols.split(",").map((s) => s.trim())) ok(catalog.tables[t].cols[c], t + "." + c);
    }
  });

  await check("a lead, a manager without prices (Q1), field and view-only: the quotes, change orders and flags - and no money column in any answer (P5 check 1); no quote notes; the admin's 'priced'; the same log name", async () => {
    const admin = await loadAs("admin", P.project.id);
    const pricedByAdmin = admin.got.payload.items.map((i) => [i.itemId, i.priced]);
    ok(admin.got.payload.items.find((i) => i.itemId === P.i4).priced === true, "the admin: the draft change order's item is priced");
    same(admin.got.payload.quotes.find((q) => q.id === P.q1).notes, "Their price $4,850 incl. delivery; crane $350 extra", "the admin reads the quote's notes");
    for (const key of ["lead", "manager", "field", "viewer"]) {
      const r = await loadAs(key, P.project.id);
      for (const t of MONEY_TABLES.filter((x) => x !== "estimate_item_totals")) ok(!r.asked.has(t), key + " asked for " + t);
      for (const k of MONEY_KEYS) ok(!r.keys.has(k), key + ": '" + k + "' in an answer");
      ok(!r.keys.has("notes"), key + ": a quote's notes in an answer");
      const tot = rec.filter((x) => x.table === "estimate_item_totals");
      same(tot.length === 1 ? [...keysIn(tot[0].data)].sort() : [], ["item_id", "priced"], key + ": estimate_item_totals answers item_id and priced only");
      same(r.got.payload.items.map((i) => [i.itemId, i.priced]), pricedByAdmin, key + ": the same 'priced' as the admin's (the database's)");
      same(C.derive(r.got.payload, {}).regions.humanA, C.derive(admin.got.payload, {}).regions.humanA, key + ": the same 'N of M items priced'");
      same(r.got.payload.items.map((i) => i.logName), admin.got.payload.items.map((i) => i.logName), key + ": the same log name as the admin's");
      ok(r.got.payload.items.every((i) => !/\$\s?\d/.test(i.logName)), key + ": no amount in a log name");
      ok(!JSON.stringify(r.got.payload).includes("4,850"), key + ": the quote's notes reached the payload");
      same(r.got.payload.quotes.map((q) => [q.vendor, q.kind, q.status]).sort(), [["Ashgrove Trim", "change_order", "awarded"], ["Kestrel Lumber Supply", "quote", "awarded"],
        ["Marlow Concrete", "quote", "requested"]], key + ": every quote and change order, no amount");
      const names = r.got.payload.items.map((i) => i.name);
      same(names.length, 4, key + ": the lanes");
      ok(names[0] === "Floor joists" && /^Walls \(.*amount hidden.*\)$/.test(names[1]) && !/900/.test(names[1]) && names[2] === "Rough opening" && names[3] === "Porch posts",
        key + ": the lanes in order, a typed amount masked: " + names.join(" | "));
      same(r.got.payload.items[0].flag && r.got.payload.items[0].flag.state, "blocked", key + ": the flag");
      ok(/amount hidden/.test(r.got.payload.items[0].flag.note), key + ": the flag's note masked");
      const m = C.derive(r.got.payload, { expandedA: true, expandedB: true });
      const svg = C.svg(m, C.layout(m, {}), {});
      ok(!/\$\s?\d/.test(svg) && !/\$\s?\d/.test(JSON.stringify(r.got.payload)), key + ": an amount on the chart");
      same(m.bNodes.map((d) => d.key), ["B1"], key + ": no money tile");
    }
  });

  await check("a manager with prices: amounts on items and quotes, the priced document - still no money table; admin and the accountant: bills, invoices, costs, commitments", async () => {
    let r = await loadAs("manager2", P.project.id);
    ok(r.keys.has("amount") && r.asked.has("estimate_item_totals"), "the prices are read");
    for (const t of ["bills", "invoices", "costs", "quote_commitments"]) ok(!r.asked.has(t), "manager2 asked for " + t);
    same(r.got.payload.quotes.find((q) => q.id === P.q1).amount, 9150, "the quote's amount");
    same(r.got.payload.quotes.find((q) => q.id === P.q1).documentUrl, "https://example.com/q" + P.q1 + ".pdf", "the priced document");
    ok(r.got.payload.items.find((i) => i.itemId === P.i1).estTotal > 0, "the item total");
    same(r.got.payload.items.find((i) => i.itemId === P.i1).quotedPrice, 900, "the quoted price");
    for (const key of ["admin", "accountant"]) {
      r = await loadAs(key, P.project.id);
      same(r.got.payload.bills.length, 3, key + " bills");
      same(r.got.payload.bills.find((b) => b.id === P.b1).owed, 5150, key + ": owed after the payment");
      same(r.got.payload.invoices.map((i) => i.estimateIds), [[P.est]], key + ": the invoice carries the estimate");
      same(r.got.payload.items.find((i) => i.itemId === P.i2).logName, "Walls ([amount] allowance)", key + ": the log name, scrubbed as the database does");
      same(r.got.payload.costs.length, 1, key + " costs");
      const co = r.got.payload.commitments.find((c) => c.quoteId === P.q3);
      same([co.committed, co.billed, co.overBilled, co.overBilledBy], [860, 980, true, 120], key + ": over-billing reported, never clamped");
      const m = C.derive(r.got.payload, { expandedA: true, expandedB: true });
      same(m.bNodes.length, 6, key + ": every tile");
      same(m.lanes.find((l) => l.itemId === P.i3).nodes.B2.s, "attention", key + ": billed past the change order");
      same(m.unlinkedBills.length, 1, key + ": the bill no item accounts for");
    }
  });

  await check("item flags (M5a): a lead sets, changes and clears one - by / at the database's, one amount-free log line each; field, view-only and the accountant refused; a stale version is PT409", async () => {
    await as("lead");
    const n0 = (await one("select count(*)::int as n from public.activity where project_id = $1", [P.project.id])).n;
    const made = await pm.setFlag(P.i2, "important", "Order the hold-downs ($38 each)", "2026-11-02", null);
    same([made.state, made.by, made.project_id, made.due_date], ["important", PEOPLE.lead.id, P.project.id, "2026-11-02"], "set");
    ok(made.at, "at stamped");
    const lines = await sql("select kind, text from public.activity where project_id = $1 order by id desc limit 1", [P.project.id]);
    same(lines[0].kind, "system", "a system line");
    ok(/flagged important \(due 2026-11-02\)$/.test(lines[0].text) && !/\$\s?\d|900/.test(lines[0].text), "amount-free: " + lines[0].text);
    const moved = await pm.setFlag(P.i2, "blocked", "Waiting on the yard", null, { version: made.version });
    same(moved.state, "blocked", "changed");
    const e = await refused(() => pm.setFlag(P.i2, "complete", null, null, { version: made.version }), "PT409", "a stale version");
    same(e.current && e.current.state, "blocked", "the conflict carries theirs");
    for (const key of ["field", "viewer", "accountant"]) {
      await as(key);
      await refused(() => pm.setFlag(P.i3, "blocked", "x", null, null), "42501", key + " adds");
      await refused(() => pm.setFlag(P.i2, "complete", null, null, { version: moved.version }), "42501", key + " changes");
      await refused(() => pm.clearFlag(P.i2, { version: moved.version }), "42501", key + " clears");
    }
    await as("manager");
    same(await pm.clearFlag(P.i2, { version: moved.version }), true, "a manager clears it");
    same((await sql("select count(*)::int as n from public.estimate_item_flags where item_id = $1", [P.i2]))[0].n, 0, "gone");
    const last = await sql("select text from public.activity where project_id = $1 order by id desc limit 1", [P.project.id]);
    ok(/flag cleared$/.test(last[0].text), "cleared: " + last[0].text);
    const n1 = (await one("select count(*)::int as n from public.activity where project_id = $1", [P.project.id])).n;
    same(n1 - n0, 3, "one line each: set, changed, cleared");
  });

  await check("quote_follow_up: quote editors only (admin; a manager or accountant with prices), one more on app.today(); the quote row back without money", async () => {
    for (const key of ["manager", "lead", "field", "viewer"]) {
      await as(key);
      await refused(() => pm.followUp(P.q2), "42501", key);
    }
    await as("manager2");
    const r = await pm.followUp(P.q2);
    same([r.follow_ups, r.last_follow_up], [1, today], "counted and stamped");
    ok(!("amount" in r) && !("document_url" in r), "no money in the answer");
    const r2 = await pm.followUp(P.q2);
    same(r2.follow_ups, 2, "counted up, never set");
    await refused(() => pm.followUp(987654321), "PT404", "a quote that is not there");
  });

  await check("the agents account reads no quote, price, flag or commitment of the job", async () => {
    client.as(PEOPLE.agents.id);
    for (const t of ["quotes", "quote_prices", "estimate_item_flags", "quote_commitments"]) {
      const r = await client.from(t).select("*");
      same((r.data || []).length, 0, t);
    }
  });

  client.from = origFrom;
}
