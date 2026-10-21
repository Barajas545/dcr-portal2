/* DCR Portal 2 — tools/schema-check.mjs's last P5a section (development only): the P5 acceptance check 1 as a
   SWEEP of raw REST answers against the REAL database rules (every DCR Desktop 2 migration, M5a
   20261025000100_office_pm.sql included), after the progress-chart and estimates sections have made their
   made-up jobs (quotes with prices, bills, payments, an invoice, costs, estimates, change orders, takeoffs with
   row prices, item flags).

   What a curious person could ask the Data API for directly - not only what Portal 2's pages ask - is asked for
   every table and view that holds an amount or that names a quote, an estimate or a takeoff, plus the two print
   RPCs for every estimate and takeoff the person reads, and search:

   * without prices (a manager - Q1 -, a lead, field, view-only): every price table and view answers no row (or no
     amount: estimate_item_totals' money is NULL), the money tables (financials) answer no row, quotes and the
     estimate / takeoff tables carry no amount column at all (and quotes no notes: they name the price), and no print
     answer has a money key or a typed amount - not in a group code, a level, a category, a sub-category, a unit, a
     formula, a material code or the project's own words either;
   * a manager with financials but WITHOUT prices: the bills are theirs to read (financials), but no price table
     answers, and quote_commitments' committed (the agreed price is a price) and what is worked out from it are NULL;
   * the admin and the accountant (positive control): every table answers with its amounts, so the sweep is not
     passing on empty tables;
   * P5 check 5 for what M5a writes to the project log: an estimate named with an amount, its status change and an
     item flag on an item named with one leave no amount in any activity line;
   * drift: the demo database the browser walks run on (tools/fake/p5a-est.js, p5a-pm.js) answers in the REAL shapes -
     the same columns for the P5a tables and views, the same keys in the print RPCs' answers, with and without prices.
   Made-up people and jobs only. */

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DOLLARS = /\$\s?\d/;
// the price tables (the prices switch) and the money tables (financials)
const PRICE_TABLES = ["quote_prices", "estimate_item_prices", "takeoff_row_prices", "material_prices", "project_prices", "settings_prices"];
const MONEY_TABLES = ["bills", "payments", "invoices", "invoice_lines", "client_payments", "costs"];
// tables everyone (or the crew) reads that name a quote, an estimate or a takeoff: never an amount column
const WORD_TABLES = ["quotes", "estimates", "estimate_items", "estimate_item_flags", "takeoffs", "takeoff_rows", "materials", "purposes", "projects"];
// the quote's own words that name its price (M5a review: quote_prices.notes) - never in a quotes answer
const QUOTE_PRICE_WORDS = ["notes"];
const AMOUNT_COLS = ["amount", "document_url", "unit_price", "line_total", "total", "subtotal", "quoted_price", "labor_rate", "labor_unit_price",
  "material_unit_price", "labor_markup_pct", "material_markup_pct", "approved_amount", "committed", "billed", "paid", "labor_total", "material_total"];
// the print answers' money keys (absent, not null, without prices)
const PRINT_MONEY_KEYS = ["labor", "material", "total", "labor_total", "material_total", "labor_per_area", "material_per_area", "contract", "client_notes",
  "unit_price", "line_total", "subtotal", "amount", "labor_rate", "labor_unit_price", "material_unit_price", "quoted_price", "tax", "tax_rate", "prices_row"];
// estimate_item_totals: the money columns (NULL without prices); men_hours is not money
const TOTALS_MONEY = /(total|per_area|price|rate|amount)$/;
// quote_commitments: worked out from the agreed price (NULL with financials but no prices)
const FROM_PRICE = ["committed", "remaining", "pct_billed", "pct_paid", "over_billed", "over_billed_by"];

function keysDeep(v, out) {
  out = out || new Set();
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => { out.add(k); keysDeep(v[k], out); });
  return out;
}

/** Every key path of a JSON answer ("groups[].items[].prices.labor_rate"); array positions folded together. */
function paths(v, out, at) {
  out = out || new Set();
  at = at || "";
  if (Array.isArray(v)) v.forEach((x) => paths(x, out, at + "[]"));
  else if (v && typeof v === "object") Object.keys(v).forEach((k) => { const p = at ? at + "." + k : k; out.add(p); paths(v[k], out, p); });
  return out;
}
const diff = (a, b) => ({ onlyReal: [...a].filter((x) => !b.has(x)).sort(), onlyDemo: [...b].filter((x) => !a.has(x)).sort() });

/** h: {check, results, section, as, client, sql, one, PEOPLE, ok, same, catalog} */
export async function run(h) {
  const { check, results, section, as, client, sql, one, PEOPLE, ok, same, catalog } = h;
  if (!(catalog.tables.quote_prices && catalog.tables.quote_commitments && catalog.functions.estimate_print)) {
    results.push({ section, name: "M5a (20261025000100_office_pm) is not in DCR Desktop 2 yet: the P5a sweep waits for it", ok: true });
    return;
  }
  const read = async (t) => {
    const r = await client.from(t).select("*").range(0, 4999);
    return r.error ? { error: r.error, rows: [] } : { error: null, rows: r.data || [] };
  };

  await check("set-up (made-up): a catalog material with its price (its CODE quoting one), a client payment, a takeoff whose NAME quotes an amount with a row of that material whose level, category, sub-category, unit and formula quote amounts, an item whose group code quotes one, a quote whose notes do (the print RPCs scrub every word; quotes carry no notes)", async () => {
    await sql("reset role");
    const m = await one("insert into public.materials (name, code, unit) values ('2x4x8 stud (sweep)', 'SW-248 $4.25', 'ea') returning id");
    await sql("update public.material_prices set unit_price = 4.25 where material_id = $1", [m.id]);
    const p = await one("select id from public.projects where deleted_at is null and name = 'Estimates Check Job'");
    const t = await one("insert into public.takeoffs (project_id, name) values ($1, 'Garage ($2,200 of lumber)') returning id", [p.id]);
    const r = await one(`insert into public.takeoff_rows (takeoff_id, material_id, item_name, qty, unit, level, category, subcategory, formula)
      values ($1, $2, '2x4x8 stud', 40, '$12/ea', 'L1 $3,100', 'Walls $1,250', 'Sub $640', '=40*$12') returning id`, [t.id, m.id]);
    const e = await one("select id from public.estimates where project_id = $1 and deleted_at is null order by id limit 1", [p.id]);
    await sql("insert into public.estimate_items (estimate_id, name, group_name, group_code) values ($1, 'Hardware allowance', 'Hardware', 'Allowance $2,500')", [e.id]);
    const q = await one("insert into public.quotes (project_id, vendor_name, status) values ($1, 'Sweep Truss Co', 'received') returning id", [p.id]);
    await sql("update public.quote_prices set amount = 4850, notes = 'Their price $4,850 incl. delivery; crane $350 extra' where quote_id = $1", [q.id]);
    same(Number((await one("select unit_price from public.takeoff_row_prices where row_id = $1", [r.id])).unit_price), 4.25, "the row's price from the catalog");
    // a client's payment on the progress-chart job's invoice (the money tables all hold a row)
    const inv = await one("select i.id from public.invoices i join public.projects p on p.id = i.project_id where p.name = 'PM Schema Barn' limit 1");
    await sql("insert into public.client_payments (invoice_id, amount, method, reference) values ($1, 2500, 'check', '1188')", [inv.id]);
  });

  await check("the sweep's tables exist as named, and quotes / the estimate and takeoff tables have no amount column (Q11: the amount and the priced document are in quote_prices)", async () => {
    for (const t of PRICE_TABLES.concat(MONEY_TABLES, WORD_TABLES, ["estimate_item_totals", "quote_commitments"])) ok(catalog.tables[t], "missing: " + t);
    for (const t of WORD_TABLES) {
      const bad = AMOUNT_COLS.filter((c) => catalog.tables[t].cols[c]);
      same(bad, [], t + ": amount columns");
    }
  });

  await check("positive control (admin, accountant): every price and money table answers with its amounts - the sweep is not passing on empty tables", async () => {
    for (const k of ["admin", "accountant"]) {
      await as(k);
      for (const t of PRICE_TABLES.concat(MONEY_TABLES, ["quote_commitments"])) {
        const r = await read(t);
        ok(!r.error && r.rows.length > 0, k + " " + t + ": " + (r.error ? r.error.code + " " + r.error.message : "no row"));
      }
      const tot = await read("estimate_item_totals");
      ok(tot.rows.some((x) => Number(x.total) > 0), k + ": estimate_item_totals carries totals");
      ok((await read("quote_prices")).rows.some((x) => Number(x.amount) > 0), k + ": a quote amount");
    }
  });

  // a manager with financials but no prices: switched on for this check only, as the database's owner
  const mgr = await one("select can_see_prices, can_see_financials from public.profiles where id = $1", [PEOPLE.manager.id]);
  const cases = [
    { key: "manager", label: "a manager without prices (Q1)" },
    { key: "lead", label: "a lead" },
    { key: "field", label: "field" },
    { key: "viewer", label: "view-only" },
    { key: "manager", label: "a manager with financials but no prices", fin: true },
  ];
  for (const c of cases) {
    await check(c.label + ": no price table answers, " + (c.fin ? "the bills do (financials) but committed is NULL" : "no money table answers") +
      ", no amount column anywhere, no money key in any print answer", async () => {
      if (c.fin) {
        await sql("reset role");
        await sql("update public.profiles set can_see_financials = true where id = $1", [PEOPLE.manager.id]);
      }
      try {
        await as(c.key);
        const leaks = [];
        for (const t of PRICE_TABLES) {
          const r = await read(t);
          if (r.rows.length) leaks.push(t + ": " + r.rows.length + " row(s)");
        }
        for (const t of MONEY_TABLES) {
          const r = await read(t);
          if (c.fin) { if (t === "bills" && !r.rows.length) leaks.push("bills: none read with financials (the check would prove nothing)"); }
          else if (r.rows.length) leaks.push(t + ": " + r.rows.length + " row(s)");
        }
        const tot = await read("estimate_item_totals");
        ok(tot.rows.length > 0, "estimate_item_totals: the items are read (their money is NULL)");
        const moneyCols = Object.keys(catalog.tables.estimate_item_totals.cols).filter((x) => TOTALS_MONEY.test(x));
        ok(moneyCols.length >= 3, "estimate_item_totals money columns: " + moneyCols.join(","));
        tot.rows.forEach((x) => moneyCols.forEach((m) => { if (x[m] !== null && x[m] !== undefined) leaks.push("estimate_item_totals." + m + " = " + x[m]); }));
        const qc = await read("quote_commitments");
        if (c.fin) {
          ok(qc.rows.length > 0, "quote_commitments: rows with financials");
          qc.rows.forEach((x) => FROM_PRICE.forEach((m) => { if (x[m] !== null) leaks.push("quote_commitments." + m + " = " + x[m]); }));
        } else if (qc.rows.length) leaks.push("quote_commitments: " + qc.rows.length + " row(s)");
        let quoteRows = 0;
        for (const t of WORD_TABLES) {
          const r = await read(t);
          if (t === "quotes") {
            quoteRows = r.rows.length;
            QUOTE_PRICE_WORDS.filter((k) => keysDeep(r.rows).has(k)).forEach((k) => leaks.push("quotes." + k + " in the answer (it names the price)"));
            if (JSON.stringify(r.rows).includes("4,850")) leaks.push("quotes: the price words of a quote's notes");
          }
          const keys = keysDeep(r.rows);
          AMOUNT_COLS.filter((k) => keys.has(k)).forEach((k) => leaks.push(t + "." + k + " in the answer"));
        }
        ok(quoteRows > 0, "quotes are read by everyone (Q11) - the check needs some");
        // the embed a page would try: prices come back null / empty, never the amount
        const emb = await client.from("quotes").select("id, prices:quote_prices(amount, document_url, notes)");
        if (!emb.error) (emb.data || []).forEach((q) => { const p = Array.isArray(q.prices) ? q.prices[0] : q.prices; if (p) leaks.push("quotes -> quote_prices embed: " + JSON.stringify(p)); });
        // every estimate and takeoff this person reads, through the print RPCs
        const ests = (await read("estimates")).rows.filter((e) => !e.deleted_at);
        ok(ests.length > 0, "estimates read");
        for (const e of ests) {
          const r = await client.rpc("estimate_print", { p_estimate_id: e.id });
          if (r.error) { leaks.push("estimate_print " + e.id + ": " + r.error.code + " " + r.error.message); continue; }
          if (r.data.prices !== false) leaks.push("estimate_print " + e.id + ": prices " + r.data.prices);
          const keys = keysDeep(r.data);
          PRINT_MONEY_KEYS.filter((k) => keys.has(k)).forEach((k) => leaks.push("estimate_print " + e.id + ": key " + k));
          if (keys.has("notes")) leaks.push("estimate_print " + e.id + ": the items' internal notes");
          if (DOLLARS.test(JSON.stringify(r.data))) leaks.push("estimate_print " + e.id + ": a typed amount " + (JSON.stringify(r.data).match(/.{20}\$\s?\d.{8}/) || [""])[0]);
        }
        const pids = Array.from(new Set((await read("takeoffs")).rows.map((t) => t.project_id)));
        ok(pids.length > 0, "takeoffs read");
        for (const pid of pids) {
          const r = await client.rpc("takeoff_print", { p_takeoff_id: null, p_project_id: pid });
          if (r.error) { leaks.push("takeoff_print " + pid + ": " + r.error.code + " " + r.error.message); continue; }
          const keys = keysDeep(r.data);
          PRINT_MONEY_KEYS.filter((k) => keys.has(k)).forEach((k) => leaks.push("takeoff_print " + pid + ": key " + k));
          if (DOLLARS.test(JSON.stringify(r.data))) leaks.push("takeoff_print " + pid + ": a typed amount " + (JSON.stringify(r.data).match(/.{20}\$\s?\d.{8}/) || [""])[0]);
        }
        // search finds the items; it never carries an amount column
        const s = await client.rpc("search", { q: "framing" });
        ok(!s.error, "search: " + JSON.stringify(s.error));
        AMOUNT_COLS.filter((k) => keysDeep(s.data).has(k)).forEach((k) => leaks.push("search: " + k));
        same(leaks, [], c.label + ": what reached the browser");
      } finally {
        if (c.fin) {
          await sql("reset role");
          await sql("update public.profiles set can_see_financials = $2 where id = $1", [PEOPLE.manager.id, mgr.can_see_financials]);
        }
      }
    });
  }

  await check("P5 check 5 (what M5a writes to the log): an estimate named with an amount, its status change, the copied-from words and a flag on an item named with one - no amount in any activity line", async () => {
    await as("admin");
    const made = await client.rpc("create_project", { fields: { name: "Sweep Check Job", city: "Templeton" } });
    ok(!made.error, "create_project: " + JSON.stringify(made.error));
    const pid = (Array.isArray(made.data) ? made.data[0] : made.data).id;
    await sql("reset role");
    await sql("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: PEOPLE.admin.id, role: "authenticated" })]);
    await sql("set role authenticated");
    const e = await one("insert into public.estimates (project_id, name) values ($1, 'Deck $4,400 option') returning id, version", [pid]);
    await sql("update public.estimates set status = 'sent' where id = $1", [e.id]);
    const it = await one("insert into public.estimate_items (estimate_id, name) values ($1, 'Rail ($38/ft)') returning id", [e.id]);
    await sql("insert into public.estimate_item_flags (item_id, state, note, due_date) values ($1, 'important', 'Rail quote $1,850', current_date + 2)", [it.id]);
    await sql("update public.estimate_item_flags set state = 'blocked' where item_id = $1", [it.id]);
    await sql("delete from public.estimate_item_flags where item_id = $1", [it.id]);
    const copy = await client.rpc("duplicate_estimate", { estimate_id: e.id, new_name: null });       // "copied from" words
    await sql("reset role");
    const lines = await sql("select kind, text from public.activity where project_id = $1 and kind <> 'note' order by id", [pid]);
    ok(!copy.error, "duplicate_estimate: " + JSON.stringify(copy.error));
    ok(lines.length >= 6, "the log lines: " + lines.length);
    const bad = lines.filter((l) => DOLLARS.test(l.text)).map((l) => l.text);
    same(bad, [], "lines with an amount");
    ok(lines.some((l) => /created: Deck \[amount\] option/.test(l.text)) && lines.some((l) => /flagged important/.test(l.text)) &&
      lines.some((l) => /flag cleared$/.test(l.text)), "the lines as written: " + lines.map((l) => l.text).join(" | "));
  });

  /* ── drift: the demo database against the real one ── */
  const harness = path.join(h.SITE, "..", "tests", "pages-engine.mjs");
  if (!existsSync(harness)) return;
  await check("drift: the demo database (tools/fake/p5a-est.js, p5a-pm.js) answers in the REAL shapes - the P5a tables' and views' columns, and every key of estimate_print / takeoff_print with and without prices", async () => {
    const H = await import(pathToFileURL(harness).href);
    const engine = await H.freshEngine(new Date());
    const demo = async (key) => H.clientAs(engine, (await H.person(key)).id);
    const out = [];
    // the columns of select * (the demo's rows against the database's catalog)
    const fadmin = await demo("admin");
    for (const t of ["quotes", "quote_prices", "estimate_item_flags", "quote_commitments", "estimate_item_totals", "estimates", "estimate_items",
      "takeoffs", "takeoff_rows", "takeoff_row_prices", "estimate_item_prices"]) {
      const r = await fadmin.from(t).select("*").range(0, 0);
      if (r.error) { out.push(t + ": the demo answers " + r.error.code + " " + r.error.message); continue; }
      if (!r.data || !r.data.length) { out.push(t + ": no demo row to compare"); continue; }
      const d = diff(new Set(Object.keys(catalog.tables[t].cols)), new Set(Object.keys(r.data[0])));
      if (d.onlyReal.length || d.onlyDemo.length) out.push(t + ": " + JSON.stringify(d));
    }
    // the print RPCs: the union of key paths over a job's estimates (a change order included) and its takeoffs
    const realPid = (await one("select id from public.projects where deleted_at is null and name = 'Estimates Check Job'")).id;
    const demoPid = engine.rows.projects.find((x) => x.number === "A267").id;
    const shapes = async (cl, pid) => {
      const e = await cl.from("estimates").select("id, deleted_at").eq("project_id", pid);
      const est = new Set();
      for (const x of (e.data || []).filter((x) => !x.deleted_at)) {
        const r = await cl.rpc("estimate_print", { p_estimate_id: x.id });
        if (!r.error) paths(r.data, est);
      }
      const tk = new Set();
      const r = await cl.rpc("takeoff_print", { p_takeoff_id: null, p_project_id: pid });
      if (!r.error) paths(r.data, tk);
      return { est, tk };
    };
    for (const [realKey, demoKey] of [["admin", "admin"], ["lead", "lead"], ["manager", "manager"]]) {
      await as(realKey);
      const real = await shapes(client, realPid);
      const dem = await shapes(await demo(demoKey), demoPid);
      const a = diff(real.est, dem.est), b = diff(real.tk, dem.tk);
      if (a.onlyReal.length || a.onlyDemo.length) out.push(realKey + " estimate_print: " + JSON.stringify(a));
      if (b.onlyReal.length || b.onlyDemo.length) out.push(realKey + " takeoff_print: " + JSON.stringify(b));
      if (!real.est.size || !dem.est.size || !real.tk.size || !dem.tk.size) out.push(realKey + ": an empty answer to compare");
    }
    same(out, [], "the demo against the database");
  });
}
