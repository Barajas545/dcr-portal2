/* DCR Portal 2 — DEMO MODE ONLY: P5a's estimates, change orders and takeoffs in the in-memory database (DCR
   Desktop 2's tables, read by Portal 2's Estimate and Takeoffs tabs and the printed Estimate, Change Order,
   Material List and Material Quote, and written by the web estimate editor). Loaded BEFORE engine.js
   (NS.extTables is read when engine.js loads) and installed into each engine (NS.extInstall). Never published
   (tools/ is not part of the site).

   The same tables, columns and read rules as DCR Desktop 2's migrations (20261007000300 estimates, takeoffs,
   catalog; 20261007000600 policies; 20261007001400 the estimate_item_totals view; 20261012000100 group_order
   and archived_at; 20261013000100 item_type):
   * estimates, estimate_items — every active person reads live rows of a visible project (an admin also
     the deleted ones); no money column;
   * estimate_item_prices, takeoff_row_prices, material_prices — the prices switch only (admin, or
     can_see_prices), and only for a row the person may read;
   * estimate_item_totals — a security-invoker view: one row per item the person may read, the money
     (labor_total, material_total, total, per area) NULL without the prices switch, rounded half away from
     zero to cents exactly as the database does (DESIGN-v2 §3: men_hours = guys × days × 8; labor =
     men_hours × rate × (1 + lm%) + labor_qty × labor_unit_price × (1 + lm%); material = qty × unit price ×
     (1 + mm%));
   * takeoffs, takeoff_rows, materials, purposes — every active person;
   * the DCR Agents 2 account reads none of them (is_active() refuses it);
   * rpc estimate_print and takeoff_print (M5a): the same answers, money keys only with prices, the words
     scrubbed (app.scrub_money, NS.p6ScrubMoney) without them.

   Writes (owner 2026-10-24: Q12 reversed — estimators edit on the web; migration 20261028000100_estimator.sql,
   DCR Desktop 2 docs/DATABASE.md §27): estimates, change orders and their items are written by an admin or a
   manager with the Estimator switch (profiles.can_estimate; tools/fake/engine.js canEdit('estimates')), price rows
   also need the prices switch; takeoffs by admin, manager, lead (the office's own writers - the demo's "someone in
   the office changes it" goes through the same rules). The triggers, for a caller without the prices switch:
   * t05 approval gate: never Approved in or out; an approved one's dates, kind, archive and deletion stay; t05
     approved lock: no item added, deleted or moved in or out of a live approved one, its type and quantities stay;
   * t06 words guard (only the columns a write changes): item notes and the terms never; Rule A — a text that quotes
     an amount is not changed (42501); Rule B — a changed text never holds "[amount]" / "amount hidden" (22023);
     Rule C — a changed text never quotes an amount (22023); the group order keeps every amount name as it is and
     adds none;
   and for everyone: the numbers (tg_estimates_before: number over the project's estimates, deleted ones too; the
   change-order number), the sent / approved dates, the tidy group order (500 names of 200 characters), the archive
   moment, an item's project and sort, its group name's size, the price row with the project's labor rate (t20), the
   hidden prices a type switch clears for a caller without prices (t25), the log lines, the soft delete (estimates and
   items: rpc soft_delete; an estimate's items go with it) with its tombstones.
   RPCs: estimate_edit_read, save_estimate_item, add_estimate_item, reorder_estimate, move_estimate_items,
   duplicate_estimate — the same argument names, answers (no money key, notes or terms without prices; D7), PT409 /
   PT404 details ({"table", "id", "version"} as JSON text) and all or nothing: every rule is checked before the first
   row is written.
   Made-up data only (sandbox A267 and one more job): the estimates' words carry a typed amount or two so
   the masking shows; the Estimator switch's people (unless Part 3's tools/fake/p7-web.js, loaded after this file,
   seeds the same switch and the same person): the admin, Quinn Manager (prices) and Robin Estimator (…013, a
   manager with the switch and without prices: quantities only). */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const TABLES = ["estimates", "estimate_items", "estimate_item_prices", "estimate_item_totals", "materials", "material_prices",
    "purposes", "takeoffs", "takeoff_rows", "takeoff_row_prices"];

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
    soft: ["estimates", "estimate_items"],      // rpc soft_delete and a DELETE hide them (tools/fake/engine.js SOFT)
    cols: {
      estimates: { id: null, project_id: null, number: null, kind: "estimate", co_number: null, name: "", description: null, status: "draft",
        sent_date: null, approved_date: null, client_notes: null, group_order: [], archived_at: null, deleted_at: null },
      estimate_items: { id: null, estimate_id: null, project_id: null, group_name: null, group_code: null, sort: null, name: "", description: null,
        labor_area: null, labor_guys: null, labor_days: null, labor_qty: 1, material_description: null, material_qty: 1, material_area: null,
        assigned_contact_id: null, assigned_text: null, notes: null, item_type: "both", deleted_at: null },
      estimate_item_prices: { item_id: null, labor_rate: null, labor_unit_price: null, labor_markup_pct: 0, material_unit_price: null,
        material_markup_pct: 0, quoted_price: null },
      estimate_item_totals: { item_id: null, estimate_id: null, project_id: null, men_hours: null, labor_total: null, material_total: null,
        total: null, labor_per_area: null, material_per_area: null, archived: false, priced: false },
      materials: { id: null, name: null, code: null, category: null, subcategory: null, unit: null, active: true },
      material_prices: { material_id: null, unit_price: null },
      purposes: { id: null, code: null, name: null, sort: 0 },
      takeoffs: { id: null, project_id: null, estimate_item_id: null, name: "", description: null, takeoff_date: null, notes: null },
      takeoff_rows: { id: null, takeoff_id: null, project_id: null, sort: null, level: null, category: null, subcategory: null, material_id: null,
        item_name: null, purpose: null, qty: null, unit: null, formula: null, notes: null },
      takeoff_row_prices: { row_id: null, unit_price: null },
    },
    pk: { estimate_item_prices: "item_id", estimate_item_totals: "item_id", material_prices: "material_id", takeoff_row_prices: "row_id" },
    uuid: [],
    noAudit: ["estimate_item_totals"],
    fks: [
      ["estimates", "project_id", "projects"],
      ["estimate_items", "estimate_id", "estimates"],
      ["estimate_items", "project_id", "projects"],
      ["estimate_item_prices", "item_id", "estimate_items", true],
      ["material_prices", "material_id", "materials", true],
      ["takeoffs", "project_id", "projects"],
      ["takeoffs", "estimate_item_id", "estimate_items"],
      ["takeoff_rows", "takeoff_id", "takeoffs"],
      ["takeoff_rows", "project_id", "projects"],
      ["takeoff_rows", "material_id", "materials"],
      ["takeoff_row_prices", "row_id", "takeoff_rows", true],
    ],
  });

  /* ── exact decimals (Postgres numeric and round(x, 2)) ───────────────── */
  function dec(v) {
    if (v === null || v === undefined || v === "") return { n: 0n, s: 0 };
    const t = typeof v === "number" ? (/e/i.test(String(v)) ? v.toFixed(12) : String(v)) : String(v).trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(t);
    if (!m) return { n: 0n, s: 0 };
    const frac = m[3] || "";
    return { n: BigInt((m[2] || "0") + frac) * (m[1] === "-" ? -1n : 1n), s: frac.length };
  }
  const p10 = (k) => { let p = 1n; for (let i = 0; i < k; i++) p *= 10n; return p; };
  const up = (a, s) => a.n * p10(s - a.s);
  function add(a, b) { const s = Math.max(a.s, b.s); return { n: up(a, s) + up(b, s), s }; }
  function mul(a, b) { return { n: a.n * b.n, s: a.s + b.s }; }
  function factor(pct) { const d = dec(pct); return add({ n: 1n, s: 0 }, { n: d.n, s: d.s + 2 }); }   // 1 + pct / 100
  function round2(a) {
    if (a.s <= 2) return Number(up(a, 2)) / 100;
    const d = p10(a.s - 2), q = a.n / d, r = a.n % d;
    const c = (r < 0n ? -r : r) * 2n >= d ? (a.n < 0n ? q - 1n : q + 1n) : q;
    return Number(c) / 100;
  }
  function div(a, b) {             // a / b, 12 places (then round2: the per-area figures)
    const k = 12;
    return { n: (a.n * p10(b.s + k)) / b.n, s: a.s + k };
  }
  function asNum(a) { return Number(a.n) / Math.pow(10, a.s); }

  NS.p5aDec = { dec, add, mul, factor, round2 };

  /** One item's math, as the estimate_item_totals view. */
  function itemMath(i, p) {
    const pr = p || {};
    const men = mul(mul(dec(i.labor_guys), dec(i.labor_days)), { n: 8n, s: 0 });
    const lf = factor(pr.labor_markup_pct), mf = factor(pr.material_markup_pct);
    const labor = add(mul(mul(men, dec(pr.labor_rate)), lf), mul(mul(dec(i.labor_qty), dec(pr.labor_unit_price)), lf));
    const material = mul(mul(dec(i.material_qty), dec(pr.material_unit_price)), mf);
    const total = add(labor, material);
    const perArea = (x, area) => {
      const a = dec(area);
      return a.n === 0n ? null : round2(div(x, a));
    };
    return { men_hours: asNum(men), labor: round2(labor), material: round2(material), total: round2(total),
      labor_per_area: perArea(labor, i.labor_area), material_per_area: perArea(material, i.material_area) };
  }
  NS.p5aItemMath = itemMath;

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, projectVisible } = E;
    const tables = new Set(TABLES);
    // the Estimator switch's column (migration 20261028000100): NOT NULL, the role's default - an admin's on
    if (E.COLS.profiles && !("can_estimate" in E.COLS.profiles)) E.COLS.profiles.can_estimate = false;
    const itemRead = (w, id) => {
      const it = rows.estimate_items.find((x) => x.id === id);
      return !!it && canRead(w, "estimate_items", it);
    };
    const rowRead = (w, id) => {
      const r = rows.takeoff_rows.find((x) => x.id === id);
      return !!r && canRead(w, "takeoff_rows", r);
    };
    function canWrite(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "estimates": case "estimate_items": return E.canEdit(w, "estimates") && (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
        case "estimate_item_prices": return w.prices && E.canEdit(w, "estimates") && itemRead(w, r.item_id);
        case "takeoffs": case "takeoff_rows": return E.canEdit(w, "takeoffs") && projectVisible(w, r.project_id);
        case "takeoff_row_prices": return w.prices && E.canEdit(w, "takeoffs") && rowRead(w, r.row_id);
        default: return false;
      }
    }
    function canRead(w, table, r) {
      if (!w.active) return false;
      switch (table) {
        case "estimates": case "estimate_items": return (!r.deleted_at || w.admin) && projectVisible(w, r.project_id);
        case "estimate_item_prices": return w.prices && itemRead(w, r.item_id);
        case "estimate_item_totals": return itemRead(w, r.item_id);
        case "materials": case "purposes": return true;
        case "material_prices": return w.prices;
        case "takeoffs": case "takeoff_rows": return projectVisible(w, r.project_id);
        case "takeoff_row_prices": return w.prices && rowRead(w, r.row_id);
        default: return false;
      }
    }
    // the view's row of one item (security invoker: the money NULL without the switch; "priced" for every reader)
    function totalsRow(w, i) {
      const p = w && w.prices ? rows.estimate_item_prices.find((x) => x.item_id === i.id) : null;
      const m = itemMath(i, p);
      const ok = !!(w && w.prices);
      // "priced" (M5a, app.item_priced - a definer): the item's own prices, whoever reads it - a yes / no, no amount
      const raw = rows.estimate_item_prices.find((x) => x.item_id === i.id) || null;
      const all = itemMath(i, raw);
      const priced = !!(w && w.active) && (all.total > 0 || Number((raw && raw.quoted_price) || 0) > 0);
      return { item_id: i.id, estimate_id: i.estimate_id, project_id: i.project_id, men_hours: m.men_hours,
        labor_total: ok ? m.labor : null, material_total: ok ? m.material : null, total: ok ? m.total : null,
        labor_per_area: ok ? m.labor_per_area : null, material_per_area: ok ? m.material_per_area : null,
        archived: rows.estimates.some((e) => e.id === i.estimate_id && !!e.archived_at),   // as the view (…_estimate_order_archive.sql)
        priced };
    }
    function totals(w) {
      return rows.estimate_items.map((i) => totalsRow(w, i));
    }
    /* ── M5a's read functions for the print and view pages (security invoker: the caller's rows) ── */
    const { PgErr, clone, deny, rule } = E;
    const scrub = (t) => (t === null || t === undefined ? null : (NS.p6ScrubMoney ? NS.p6ScrubMoney(t) : String(t).replace(/\$\s?\d[\d,]*(\.\d+)?/g, "[amount]")));
    const tidy = (v) => String(v === null || v === undefined ? "" : v).split(/[\s\x1c-\x1f\x85\xa0]+/).filter(Boolean).join(" ");
    const gkey = (v) => tidy(v).toLowerCase();
    // app.natural_key: digit runs as numbers ("9" < "10"), letters lower case, an empty value last
    const natKey = (v) => {
      const s = String(v || "").trim();
      if (!s) return "1";
      return "0" + (s.match(/[0-9]+|[^0-9]+/g) || []).map((m) => /^[0-9]+$/.test(m)
        ? "0" + (m.replace(/^0+/, "") || "0").padStart(40, "0") : "1" + m.toLowerCase()).join(String.fromCharCode(1));
    };
    const cleanOrder = (names) => {
      const out = [], seen = new Set();
      for (const n of names || []) { const c = tidy(n), k = c.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(c); } }
      return out;
    };
    const label = (kind, number, co) => (kind === "change_order" ? "Change order #" + co : "Estimate #" + number);
    const cmpNum = (a, b) => (a === null || a === undefined ? (b === null || b === undefined ? 0 : 1) : b === null || b === undefined ? -1 : Number(a) - Number(b));
    // app.print_project: the project's words amount-free for a caller without prices (M5a review)
    function printProject(pid, prices) {
      const p = rows.projects.find((x) => x.id === pid);
      const T = (s) => (prices ? s : scrub(s));
      return p ? { id: p.id, number: p.number, name: T(p.name), address: T(p.address), city: T(p.city), state: p.state, zip: p.zip,
        client_name: T(p.client_name), client_phone: p.client_phone, client_email: p.client_email, status: p.status } : null;
    }
    function itemsOf(w, estimateId) {
      return rows.estimate_items.filter((i) => i.estimate_id === estimateId && !i.deleted_at && canRead(w, "estimate_items", i))
        .slice().sort((a, b) => cmpNum(a.sort, b.sort) || a.id - b.id);
    }
    function estimateTotal(w, e) {
      return itemsOf(w, e.id).reduce((s, i) => s + Math.round(itemMath(i, rows.estimate_item_prices.find((x) => x.item_id === i.id)).total * 100), 0) / 100;
    }
    /** the groups of these items (in item order) in DCR Desktop 2's screen order: the group order, then by code
        naturally, then by name ("" last) - estimate_print and estimate_edit_read share it */
    function groupsOf(items, groupOrder) {
      const listed = {};
      cleanOrder(groupOrder).forEach((n, k) => { if (!(gkey(n) in listed)) listed[gkey(n)] = k + 1; });
      const groups = [];
      const byKey = {};
      for (const i of items) {
        const k = gkey(i.group_name);
        let g = byKey[k];
        if (!g) { g = byKey[k] = { gk: k, name: tidy(i.group_name), code: null, items: [] }; groups.push(g); }
        if (g.code === null && String(i.group_code || "").trim()) g.code = String(i.group_code).trim();
        g.items.push(i);
      }
      return groups.sort((x, y) => {
        const lx = listed[x.gk], ly = listed[y.gk];
        if ((lx === undefined) !== (ly === undefined)) return lx === undefined ? 1 : -1;
        if (lx !== undefined && lx !== ly) return lx - ly;
        const nx = natKey(x.code), ny = natKey(y.code);
        if (nx !== ny) return nx < ny ? -1 : 1;
        if ((x.name === "") !== (y.name === "")) return x.name === "" ? 1 : -1;
        const a1 = x.name.toLowerCase(), b1 = y.name.toLowerCase();
        return a1 < b1 ? -1 : a1 > b1 ? 1 : 0;
      });
    }
    function estimatePrint(w, a) {
      if (!w.active) throw new PgErr("42501", "not allowed", 403);
      const prices = w.prices;
      const e = rows.estimates.find((x) => x.id === Number(a.p_estimate_id) && !x.deleted_at);
      if (!e || !canRead(w, "estimates", e)) throw new PgErr("PT404", "estimate not found", 404);
      const items = itemsOf(w, e.id);
      const T = (s) => (prices ? s : scrub(s));
      const shaped = new Map(items.map((i) => {
        const p = rows.estimate_item_prices.find((x) => x.item_id === i.id);
        const m = itemMath(i, prices ? p : null);
        const j = { id: i.id, estimate_id: i.estimate_id, sort: i.sort, group_name: T(i.group_name), group_code: T(i.group_code),
          name: T(i.name), description: T(i.description), item_type: i.item_type, labor_area: i.labor_area, labor_guys: i.labor_guys,
          labor_days: i.labor_days, labor_qty: i.labor_qty, men_hours: m.men_hours, material_description: T(i.material_description),
          material_qty: i.material_qty, material_area: i.material_area, assigned_contact_id: i.assigned_contact_id,
          assigned_name: null, assigned_text: T(i.assigned_text), version: i.version };
        if (prices) {
          j.notes = i.notes;
          j.prices = p ? { labor_rate: p.labor_rate, labor_unit_price: p.labor_unit_price, labor_markup_pct: p.labor_markup_pct,
            material_unit_price: p.material_unit_price, material_markup_pct: p.material_markup_pct, quoted_price: p.quoted_price } : null;
          j.totals = { labor: m.labor, material: m.material, total: m.total, labor_per_area: m.labor_per_area, material_per_area: m.material_per_area };
        }
        return [i.id, { total: m.total, men: m.men_hours, j }];
      }));
      const outGroups = groupsOf(items, e.group_order).map((g) => {
        const total = g.items.reduce((s, i) => Math.round((s + shaped.get(i.id).total) * 100) / 100, 0);
        return Object.assign({
          key: prices ? g.gk : gkey(scrub(g.name)), name: prices ? g.name : scrub(g.name),
          title: g.name === "" ? "General" : prices ? g.name : scrub(g.name), code: (prices ? g.code : scrub(g.code)) || "",
          items: g.items.map((i) => shaped.get(i.id).j),
        }, prices ? { total } : {});
      });
      const all = Array.from(shaped.values());
      const totals = { men_hours: all.reduce((s, x) => s + x.men, 0) };
      if (prices) {
        totals.labor = Math.round(all.reduce((s, x) => s + (x.j.totals.labor || 0) * 100, 0)) / 100;
        totals.material = Math.round(all.reduce((s, x) => s + (x.j.totals.material || 0) * 100, 0)) / 100;
        totals.total = Math.round(all.reduce((s, x) => s + x.total * 100, 0)) / 100;
      }
      const out = { prices, project: printProject(e.project_id, prices), estimate: Object.assign({
        id: e.id, project_id: e.project_id, number: e.number, kind: e.kind, co_number: e.co_number, label: label(e.kind, e.number, e.co_number),
        name: T(e.name), description: T(e.description), status: e.status, sent_date: e.sent_date, approved_date: e.approved_date,
        archived_at: e.archived_at, group_order: prices ? clone(e.group_order || []) : (e.group_order || []).map(scrub),
        version: e.version, updated_at: e.updated_at }, prices ? { client_notes: e.client_notes } : {}), groups: outGroups, totals };
      if (prices && e.kind === "change_order") {
        const est = rows.estimates.filter((x) => x.project_id === e.project_id && !x.deleted_at && !x.archived_at && canRead(w, "estimates", x))
          .map((x) => ({ x, total: estimateTotal(w, x) }));
        const sum = (l) => Math.round(l.reduce((s, y) => s + y.total * 100, 0)) / 100;
        const appr = est.filter((y) => y.x.kind === "estimate" && y.x.status === "approved");
        const notDeclined = est.filter((y) => y.x.kind === "estimate" && y.x.status !== "declined");
        const original = appr.length ? sum(appr) : notDeclined.length ? sum(notDeclined) : null;
        const key = (x) => [x.co_number === null || x.co_number === undefined ? 1e9 : x.co_number, x.number, x.id];
        const before = (p, q) => { const a1 = key(p), b1 = key(q); for (let k = 0; k < 3; k++) if (a1[k] !== b1[k]) return a1[k] < b1[k]; return false; };
        const previous = sum(est.filter((y) => y.x.kind === "change_order" && y.x.id !== e.id && y.x.status === "approved" && before(y.x, e)));
        out.contract = { original, previous, this: totals.total, new_total: Math.round(((original || 0) + previous + totals.total) * 100) / 100 };
      }
      return out;
    }
    function takeoffPrint(w, a) {
      if (!w.active) throw new PgErr("42501", "not allowed", 403);
      const tid = a.p_takeoff_id === null || a.p_takeoff_id === undefined ? null : Number(a.p_takeoff_id);
      const pid = a.p_project_id === null || a.p_project_id === undefined ? null : Number(a.p_project_id);
      if ((tid === null) === (pid === null)) throw new PgErr("22023", "give a takeoff or a project", 400);
      const prices = w.prices;
      let project = null;
      if (tid !== null) {
        const t = rows.takeoffs.find((x) => x.id === tid && canRead(w, "takeoffs", x));
        project = t ? t.project_id : null;
      } else {
        const p = rows.projects.find((x) => x.id === pid && !x.deleted_at);
        project = p && projectVisible(w, p.id) ? p.id : null;
      }
      if (project === null) throw new PgErr("PT404", tid !== null ? "takeoff not found" : "project not found", 404);
      const T = (s) => (prices ? s : scrub(s));
      const tks = rows.takeoffs.filter((t) => (tid !== null ? t.id === tid : t.project_id === project) && canRead(w, "takeoffs", t))
        .slice().sort((x, y) => x.id - y.id);
      let grand = 0;
      const list = tks.map((t) => {
        const rs = rows.takeoff_rows.filter((r) => r.takeoff_id === t.id && canRead(w, "takeoff_rows", r))
          .slice().sort((x, y) => cmpNum(x.sort, y.sort) || x.id - y.id);
        let sub = 0;
        const outRows = rs.map((r) => {
          const m = r.material_id ? rows.materials.find((x) => x.id === r.material_id) : null;
          const j = { id: r.id, takeoff_id: r.takeoff_id, sort: r.sort, level: T(r.level), category: T(r.category), subcategory: T(r.subcategory),
            material_id: r.material_id, material_code: m ? T(m.code) : null, item_name: T(r.item_name), purpose: T(r.purpose), qty: r.qty,
            unit: T(r.unit), formula: T(r.formula), notes: T(r.notes), version: r.version };
          if (prices) {
            const p = rows.takeoff_row_prices.find((x) => x.row_id === r.id);
            const up = p ? p.unit_price : null;
            const line = up === null || up === undefined ? 0 : NS.p5aDec.round2(NS.p5aDec.mul(NS.p5aDec.dec(r.qty), NS.p5aDec.dec(up)));
            j.unit_price = up === undefined ? null : up;
            j.line_total = line;
            sub = Math.round((sub + line) * 100) / 100;
          }
          return j;
        });
        grand = Math.round((grand + sub) * 100) / 100;
        const it = t.estimate_item_id ? rows.estimate_items.find((x) => x.id === t.estimate_item_id && canRead(w, "estimate_items", x)) : null;
        const est = it ? rows.estimates.find((x) => x.id === it.estimate_id) : null;
        return Object.assign({
          takeoff: { id: t.id, project_id: t.project_id, estimate_item_id: t.estimate_item_id, name: T(t.name), description: T(t.description),
            takeoff_date: t.takeoff_date, notes: T(t.notes), version: t.version, updated_at: t.updated_at },
          item: it ? { id: it.id, estimate_id: it.estimate_id, name: T(it.name), estimate_label: est ? label(est.kind, est.number, est.co_number) : null } : null,
          rows: outRows,
        }, prices ? { subtotal: sub } : {});
      });
      if (tid !== null && !list.length) throw new PgErr("PT404", "takeoff not found", 404);
      if (!prices) return { prices: false, project: printProject(project, false), takeoffs: list };
      const s = rows.settings.find((x) => x.id === 1);
      const rate = Math.max(Number(s && s.tax_rate) || 0, 0);
      const tax = NS.p5aDec.round2(NS.p5aDec.mul(NS.p5aDec.dec(grand), { n: NS.p5aDec.dec(rate).n, s: NS.p5aDec.dec(rate).s + 2 }));
      return { prices: true, project: printProject(project, true), takeoffs: list,
        totals: { subtotal: grand, tax_rate: rate, tax, total: Math.round((grand + tax) * 100) / 100 } };
    }

    /* ── the write rules (migrations 20261007000300 / 20261012000100 / 20261013000100 / 20261028000100) ── */
    const ITEM_TYPES = ["both", "labor", "material", "sub"];
    const EST_STATUSES = ["draft", "sent", "approved", "declined"];
    const QTY = ["labor_area", "labor_guys", "labor_days", "labor_qty", "material_qty", "material_area"];      // numeric(12,3)
    const MONEY = ["labor_rate", "labor_unit_price", "material_unit_price", "quoted_price"];                    // numeric(12,2)
    const PCT = ["labor_markup_pct", "material_markup_pct"];                                                    // numeric(6,2) not null
    const ITEM_WORDS = ["name", "description", "material_description", "group_name", "group_code", "assigned_text"];
    const SAVE_KEYS = ["name", "item_type", "description", "labor_area", "labor_guys", "labor_days", "labor_qty",
      "material_description", "material_qty", "material_area", "assigned_contact_id", "assigned_text", "notes"];
    const ADD_KEYS = ["group_name", "group_code", "sort"].concat(SAVE_KEYS);
    const PRICE_KEYS = ["labor_rate", "labor_unit_price", "labor_markup_pct", "material_unit_price", "material_markup_pct", "quoted_price"];
    const LOCK_COLS = ["estimate_id", "item_type", "labor_area", "labor_guys", "labor_days", "labor_qty", "material_qty", "material_area"];
    const MASK = /\[amount\]|amount hidden/i;
    const txt = (v) => (v === null || v === undefined ? "" : String(v));
    const quotes = (v) => v !== null && v !== undefined && scrub(String(v)) !== String(v);       // app.quotes_amount
    const holdsMask = (v) => MASK.test(txt(v));                                                   // app.holds_amount_mask
    const nil = (v) => v === null || v === undefined;
    /** `is not distinct from` for a stored value (numbers as numbers: 4 and "4.0" are one numeric) */
    function same(a, b) {
      if (nil(a) || nil(b)) return nil(a) && nil(b);
      if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
      return String(a) === String(b);
    }
    const detail = (table, field) => JSON.stringify({ table, field });
    /** a numeric column as the database takes it: text that is a number, at most `whole` (the precision), rounded
        to `scale` places; anything else 22P02 / 22003 */
    function numeric(v, whole, scale) {
      if (nil(v)) return null;
      const ok = typeof v === "number" ? Number.isFinite(v) : typeof v === "string" && /^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(v);
      if (!ok) throw rule("22P02", 'invalid input syntax for type numeric: "' + String(v) + '"');
      const p = Math.pow(10, scale);
      const n = Math.round(Number(v) * p) / p;
      if (Math.abs(n) >= whole) throw rule("22003", "numeric field overflow");
      return n;
    }
    const bigint = (v) => {
      if (nil(v) || v === "") return null;
      if (!/^\s*\d{1,18}\s*$/.test(String(v))) throw rule("22P02", 'invalid input syntax for type bigint: "' + String(v) + '"');
      return Number(v);
    };
    function estimateApproved(id) {
      const e = rows.estimates.find((x) => x.id === Number(id));
      return !!e && !e.deleted_at && e.status === "approved";
    }

    // t05_estimates_approval_gate (a caller without prices; op INSERT | UPDATE | DELETE)
    function approvalGate(w, op, r, old) {
      if (w.prices) return;
      if (op === "INSERT") {
        if (r.status === "approved" || !nil(r.approved_date)) throw deny("only someone who sees prices can mark an estimate or change order approved");
        return;
      }
      if (op === "DELETE") {
        if (old.status === "approved" && !old.deleted_at) throw deny("an approved estimate or change order is deleted only by someone who sees prices");
        return;
      }
      if ((r.status === "approved") !== (old.status === "approved")) {
        throw deny("only someone who sees prices can mark an estimate or change order approved, or take the approval back");
      }
      if (old.status === "approved" && ["approved_date", "sent_date", "kind", "archived_at", "deleted_at"].some((k) => !same(r[k], old[k]))) {
        throw deny("this estimate or change order is approved: its dates, kind and archive are changed by someone who sees prices");
      }
    }
    // t05_estimate_items_approved_lock
    function approvedLock(w, op, r, old) {
      if (w.prices) return;
      if (op === "INSERT") {
        if (estimateApproved(r.estimate_id)) throw deny("this estimate or change order is approved: items are added to it by someone who sees prices");
        return;
      }
      if (op === "DELETE") {
        if (!old.deleted_at && estimateApproved(old.estimate_id)) throw deny("this estimate or change order is approved: its items are deleted by someone who sees prices");
        return;
      }
      if ((estimateApproved(old.estimate_id) || estimateApproved(r.estimate_id)) && LOCK_COLS.some((k) => !same(r[k], old[k]))) {
        throw deny("this estimate or change order is approved: its items' type and quantities, and moves in or out, are changed by someone who sees prices");
      }
    }
    // t06_*_text_guard: only the columns this write changes ('' and NULL the same text)
    const GUARD = { estimates: [["name", "description"], ["client_notes"]], estimate_items: [ITEM_WORDS, ["notes"]] };
    function textGuard(w, table, r, old) {
      if (w.prices) return;
      const [cols, fixed] = GUARD[table];
      const was = old || {};
      for (const c of fixed) {
        if (txt(r[c]) !== txt(was[c])) throw new PgErr("42501", "item notes and the terms are written by someone who sees prices", 403, detail(table, c));
      }
      for (const c of cols) {
        if (txt(r[c]) === txt(was[c])) continue;
        if (quotes(was[c])) throw new PgErr("42501", "this text quotes an amount: someone who sees prices changes it", 403, detail(table, c));
        if (holdsMask(r[c])) {
          throw new PgErr("22023", "this is the hidden copy of an amount ([amount] / amount hidden), not the words: someone who sees prices writes them", 400, detail(table, c));
        }
        if (quotes(r[c])) throw new PgErr("22023", "amounts go in the price boxes: without the prices switch the words cannot quote an amount", 400, detail(table, c));
      }
      if (table === "estimates") {
        const now = (r.group_order || []).map(String), before = (old ? old.group_order || [] : []).map(String);
        if (JSON.stringify(now) !== JSON.stringify(before)) {
          if (before.some((g) => quotes(g) && !now.includes(g))) {
            throw new PgErr("42501", "a group name that quotes an amount is changed by someone who sees prices", 403, detail(table, "group_order"));
          }
          if (now.some((g) => !before.includes(g) && (quotes(g) || holdsMask(g)))) {
            throw new PgErr("22023", "amounts go in the price boxes: without the prices switch a group name cannot quote an amount", 400, detail(table, "group_order"));
          }
        }
      }
    }
    /** every rule of an estimate row as it will be (the gate and the words first, as t05 / t06 run before t10) */
    function estimateRules(w, op, r, old) {
      if (op === "INSERT") {
        const p = rows.projects.find((x) => x.id === Number(r.project_id));
        if (!p) throw rule("23503", 'insert or update on table "estimates" violates foreign key constraint "estimates_project_id_fkey"');
        r.project_id = p.id;
      } else if (!same(r.project_id, old.project_id)) {
        throw rule("23514", "an estimate cannot move to another project");
      }
      if (!["estimate", "change_order"].includes(r.kind)) throw rule("23514", 'new row for relation "estimates" violates check constraint "estimates_kind_check"');
      if (!EST_STATUSES.includes(r.status)) throw rule("23514", 'new row for relation "estimates" violates check constraint "estimates_status_check"');
      if (nil(r.name)) throw rule("23502", 'null value in column "name" of relation "estimates" violates not-null constraint');
      approvalGate(w, op, r, old);
      textGuard(w, "estimates", r, old);
      // t10 (tg_estimates_before): the numbers - a number counts every estimate of the project, deleted ones too
      const mine = rows.estimates.filter((x) => x.project_id === r.project_id);
      if (op === "INSERT") {
        r.number = mine.reduce((m, x) => Math.max(m, Number(x.number) || 0), 0) + 1;
        r.co_number = null;
      } else {
        r.number = old.number;
        r.co_number = r.kind === old.kind ? old.co_number : null;
      }
      if (r.kind === "change_order" && nil(r.co_number)) {
        r.co_number = mine.filter((x) => x.kind === "change_order").reduce((m, x) => Math.max(m, Number(x.co_number) || 0), 0) + 1;
      } else if (r.kind === "estimate") r.co_number = null;
      if (r.status === "sent" && nil(r.sent_date)) r.sent_date = E.today();
      if (r.status === "approved" && nil(r.approved_date)) r.approved_date = E.today();
      if (op === "INSERT" || JSON.stringify(r.group_order || []) !== JSON.stringify(old.group_order || [])) {
        r.group_order = cleanOrder(r.group_order || []);
        if (r.group_order.length > 500 || r.group_order.some((g) => g.length > 200)) {
          throw rule("22023", "the group order holds at most 500 group names of at most 200 characters");
        }
      }
      if (op === "INSERT") r.archived_at = null;
      else if (!same(r.archived_at, old.archived_at) && !nil(r.archived_at)) r.archived_at = old.archived_at || E.nowIso();
    }
    /** every rule of an item row as it will be */
    function itemRules(w, op, r, old) {
      if (op === "INSERT" || !same(r.estimate_id, old.estimate_id)) {
        const e = rows.estimates.find((x) => x.id === Number(r.estimate_id) && !x.deleted_at);
        approvedLock(w, op, r, old);
        if (!e) throw rule("23503", "estimate not found");
        if (op === "UPDATE" && e.project_id !== old.project_id) throw rule("23514", "an item can only move to an estimate of the same project");
        r.estimate_id = e.id;
        r.project_id = e.project_id;
      } else {
        approvedLock(w, op, r, old);
        r.project_id = old.project_id;
      }
      if (nil(r.name)) throw rule("23502", 'null value in column "name" of relation "estimate_items" violates not-null constraint');
      if (!ITEM_TYPES.includes(r.item_type)) throw rule("23514", 'new row for relation "estimate_items" violates check constraint "estimate_items_item_type_check"');
      QTY.forEach((k) => { r[k] = numeric(r[k], 1e9, 3); });
      r.assigned_contact_id = bigint(r.assigned_contact_id);
      if (!nil(r.assigned_contact_id) && !rows.contacts.some((c) => c.id === r.assigned_contact_id)) {
        throw rule("23503", 'insert or update on table "estimate_items" violates foreign key constraint "estimate_items_assigned_contact_id_fkey"');
      }
      textGuard(w, "estimate_items", r, old);
      if ((op === "INSERT" || txt(r.group_name) !== txt(old.group_name)) && tidy(r.group_name).length > 200) {
        throw rule("22023", "a group name has at most 200 characters");
      }
      if (nil(r.sort)) {
        r.sort = rows.estimate_items.filter((x) => x.estimate_id === r.estimate_id).reduce((m, x) => Math.max(m, Number(x.sort) || 0), 0) + 1;
      } else r.sort = numeric(r.sort, 1e15, 6);
    }
    function priceRules(r, old) {
      if (!same(r.item_id, old.item_id)) throw deny("a price row stays with its item");
      MONEY.forEach((k) => { r[k] = numeric(r[k], 1e10, 2); });
      PCT.forEach((k) => {
        if (nil(r[k])) throw rule("23502", 'null value in column "' + k + '" of relation "estimate_item_prices" violates not-null constraint');
        r[k] = numeric(r[k], 1e4, 2);
        if (r[k] <= -100) throw rule("23514", 'new row for relation "estimate_item_prices" violates check constraint "estimate_item_prices_' + k + '_check"');
      });
      if (!nil(r.labor_rate) && r.labor_rate < 0) {
        throw rule("23514", 'new row for relation "estimate_item_prices" violates check constraint "estimate_item_prices_labor_rate_check"');
      }
    }

    let copiedFrom = null;           // duplicate_estimate hands the source's label to the "created" line (as dcr.estimate_copied_from)
    const nameSuffix = (r) => (String(r.name || "").trim() ? ": " + r.name : "");
    function afterInsert(w, table, r) {
      if (table === "estimates") {
        E.logActivity(w, r.project_id, "system", label(r.kind, r.number, r.co_number) + " created" + nameSuffix(r) +
          (copiedFrom ? " — copied from " + copiedFrom : ""));
      } else if (table === "estimate_items" && !rows.estimate_item_prices.some((x) => x.item_id === r.id)) {
        // t20 (a definer): the price row, with the project's labor rate
        const pp = rows.project_prices.find((x) => x.project_id === r.project_id);
        const pr = Object.assign(clone(E.COLS.estimate_item_prices), { item_id: r.id, labor_rate: pp ? pp.labor_rate : null });
        E.auditInsert(w, "estimate_item_prices", pr);
        E.commitInsert("estimate_item_prices", pr);
      }
    }
    function afterUpdate(w, table, old, r) {
      if (table === "estimates") {
        if (r.status !== old.status) E.logActivity(w, r.project_id, "system", label(r.kind, r.number, r.co_number) + " " + r.status + nameSuffix(r));
        if (!old.archived_at && r.archived_at) E.logActivity(w, r.project_id, "system", label(r.kind, r.number, r.co_number) + " archived" + nameSuffix(r));
        else if (old.archived_at && !r.archived_at) E.logActivity(w, r.project_id, "system", label(r.kind, r.number, r.co_number) + " taken out of the archive" + nameSuffix(r));
      } else if (table === "estimate_items" && r.item_type !== old.item_type && r.item_type !== "both" && !w.prices) {
        // t25 (a definer): a caller without prices switches the type - the prices the new type hides are cleared
        const p = rows.estimate_item_prices.find((x) => x.item_id === r.id);
        const material = r.item_type === "material";
        if (p && (material ? Number(p.labor_unit_price || 0) !== 0 || Number(p.labor_markup_pct) !== 0
          : Number(p.material_unit_price || 0) !== 0 || Number(p.material_markup_pct) !== 0)) {
          const next = Object.assign(clone(p), material ? { labor_unit_price: 0, labor_markup_pct: 0 } : { material_unit_price: 0, material_markup_pct: 0 });
          E.auditUpdate(w, "estimate_item_prices", next, p);
          E.commitUpdate("estimate_item_prices", p, next);
        }
      }
    }
    function tombstone(w, table, r) {
      E.commitInsert("deletions", { id: E.nextId("deletions"), table_name: table, row_id: r.id, project_id: r.project_id ?? null,
        deleted_at: r.deleted_at, deleted_by: w.uid || null });
    }
    // the soft delete (engine.js softDelete): the DELETE event's rules first, then what tg_estimates_after does
    function beforeSoftDelete(w, table, old) {
      if (table === "estimates") approvalGate(w, "DELETE", null, old);
      else if (table === "estimate_items") approvedLock(w, "DELETE", null, old);
    }
    function afterSoftDelete(w, table, old, r) {
      if (table !== "estimates") return;
      for (const it of rows.estimate_items.filter((x) => x.estimate_id === r.id && !x.deleted_at)) {
        const next = Object.assign(clone(it), { deleted_at: r.deleted_at });
        E.auditUpdate(w, "estimate_items", next, it);
        E.commitUpdate("estimate_items", it, next);
        tombstone(w, "estimate_items", next);
      }
      E.logActivity(w, r.project_id, "system", label(r.kind, r.number, r.co_number) + " deleted" + nameSuffix(r));
    }

    /* ── the RPCs of the web editor (SECURITY INVOKER: the caller's RLS and every trigger above) ── */
    function assertKeys(obj, allowed, what) {
      if (nil(obj)) return null;
      if (typeof obj !== "object" || Array.isArray(obj)) throw rule("22023", (what || "fields") + " must be a JSON object");
      const bad = Object.keys(obj).filter((k) => !allowed.includes(k));
      if (bad.length) throw rule("22023", "unknown or read-only fields: " + bad.join(", "));
      return Object.keys(obj).length ? obj : null;
    }
    const conflictErr = (table, id, version, msg) => new PgErr("PT409", msg, 409, JSON.stringify({ table, id, version }));
    const goneErr = (table, id, msg) => new PgErr("PT404", msg, 404, JSON.stringify({ table, id }));
    const liveItem = (w, id) => rows.estimate_items.find((i) => i.id === Number(id) && !i.deleted_at && canRead(w, "estimate_items", i)) || null;
    // app.estimate_item_answer / app.estimate_answer (D7): with prices the row (+ "prices"); without, no money key,
    // no notes, no terms, the words amount-free
    function itemAnswer(w, it) {
      const r = clone(it);
      if (w.prices) {
        const p = rows.estimate_item_prices.find((x) => x.item_id === it.id);
        r.prices = p ? clone(p) : null;
        return r;
      }
      delete r.notes;
      ITEM_WORDS.forEach((k) => { r[k] = scrub(r[k]); });
      return r;
    }
    function estimateAnswer(w, e) {
      const r = clone(e);
      if (w.prices) return r;
      delete r.client_notes;
      r.name = scrub(r.name);
      r.description = scrub(r.description);
      r.group_order = (r.group_order || []).map(scrub);
      return r;
    }
    /** a row written by an RPC, after every rule passed (nothing is written before all of them did) */
    function writeUpdate(w, table, old, next) {
      E.auditUpdate(w, table, next, old);
      E.commitUpdate(table, old, next);
      afterUpdate(w, table, old, next);
      return next;
    }
    function writeInsert(w, table, r) {
      r.id = E.nextId(table);
      E.auditInsert(w, table, r);
      E.commitInsert(table, r);
      afterInsert(w, table, r);
      return r;
    }
    /** a new item as add_estimate_item and duplicate_estimate insert it: RLS, then every rule (-> the row, not written) */
    function planItemInsert(w, f) {
      const r = Object.assign(clone(E.COLS.estimate_items), f);
      const e = rows.estimates.find((x) => x.id === Number(r.estimate_id));
      if (!canWrite(w, "estimate_items", { project_id: e ? e.project_id : null, deleted_at: null })) {
        throw new PgErr("42501", 'new row violates row-level security policy for table "estimate_items"', 403);
      }
      itemRules(w, "INSERT", r, null);
      return r;
    }

    // estimate_edit_read(p_project_id): the web editor's read (docs/DATABASE.md §27.5)
    function editRead(w, a) {
      if (!w.active) throw deny("not allowed");
      const pid = nil(a.p_project_id) ? null : Number(a.p_project_id);
      const proj = pid === null ? null : rows.projects.find((p) => p.id === pid && !p.deleted_at && projectVisible(w, p.id));
      if (!proj) throw goneErr("projects", pid, "project not found");
      const prices = w.prices;
      const T = (s) => (prices ? s : scrub(s));
      const lockedOf = (row, cols) => cols.filter((c) => quotes(row[c]) || holdsMask(row[c]));
      const contactName = (id) => {
        const c = nil(id) ? null : rows.contacts.find((x) => x.id === Number(id));
        return c ? (String(c.company || "").trim() || c.name) : null;
      };
      const list = rows.estimates.filter((e) => e.project_id === pid && !e.deleted_at && canRead(w, "estimates", e))
        .sort((x, y) => ((x.kind !== "estimate") - (y.kind !== "estimate")) || (Number(x.co_number || 0) - Number(y.co_number || 0)) ||
          (Number(x.number) - Number(y.number)) || x.id - y.id);
      return { project_id: pid, prices, can_edit: E.canEdit(w, "estimates"), estimates: list.map((e) => {
        const items = itemsOf(w, e.id);
        const groups = groupsOf(items, e.group_order);
        const outItems = [];
        let hours = 0, labor = 0, material = 0, total = 0;
        const outGroups = groups.map((g, n) => {
          const gid = "g" + (n + 1);
          g.items.forEach((i) => {
            const t = totalsRow(w, i);
            hours += t.men_hours;
            const j = { id: i.id, estimate_id: i.estimate_id, version: i.version, gid, sort: i.sort, group_name: T(i.group_name),
              group_code: T(i.group_code), name: T(i.name), item_type: i.item_type, description: T(i.description), labor_area: i.labor_area,
              labor_guys: i.labor_guys, labor_days: i.labor_days, labor_qty: i.labor_qty, men_hours: t.men_hours,
              material_description: T(i.material_description), material_qty: i.material_qty, material_area: i.material_area,
              assigned_contact_id: i.assigned_contact_id, assigned_name: contactName(i.assigned_contact_id), assigned_text: T(i.assigned_text),
              priced: t.priced, updated_at: i.updated_at, updated_by: i.updated_by };
            if (prices) {
              const p = rows.estimate_item_prices.find((x) => x.item_id === i.id);
              j.notes = i.notes;
              j.prices = p ? { labor_rate: p.labor_rate, labor_unit_price: p.labor_unit_price, labor_markup_pct: p.labor_markup_pct,
                material_unit_price: p.material_unit_price, material_markup_pct: p.material_markup_pct, quoted_price: p.quoted_price,
                version: p.version } : null;
              j.totals = { labor: t.labor_total || 0, material: t.material_total || 0, total: t.total || 0,
                labor_per_area: t.labor_per_area, material_per_area: t.material_per_area };
              labor += Math.round((t.labor_total || 0) * 100);
              material += Math.round((t.material_total || 0) * 100);
              total += Math.round((t.total || 0) * 100);
            } else {
              j.locked = lockedOf(i, ["name", "description", "material_description", "assigned_text", "group_name", "group_code"]);
            }
            outItems.push(j);
          });
          return Object.assign({ gid, name: T(g.name), code: T(g.code) || "", title: g.name === "" ? "General" : T(g.name) },
            prices ? {} : { locked: g.items.some((i) => lockedOf(i, ["group_name", "group_code"]).length > 0) });
        });
        return Object.assign({
          id: e.id, project_id: e.project_id, number: e.number, kind: e.kind, co_number: e.co_number, label: label(e.kind, e.number, e.co_number),
          name: T(e.name), description: T(e.description), status: e.status, sent_date: e.sent_date, approved_date: e.approved_date,
          archived: !!e.archived_at, archived_at: e.archived_at, version: e.version, updated_at: e.updated_at, updated_by: e.updated_by,
          group_order: prices ? clone(e.group_order || []) : (e.group_order || []).map((g) => scrub(g)),
          groups: outGroups, items: outItems,
          totals: Object.assign({ men_hours: hours }, prices ? { labor: labor / 100, material: material / 100, total: total / 100 } : {}),
        }, prices ? { client_notes: e.client_notes } : {
          locked: lockedOf(e, ["name", "description"]),
          group_order_locked: (e.group_order || []).some((g) => quotes(g) || holdsMask(g)),
        });
      }) };
    }

    // save_estimate_item(p_item_id, p_item_version, p_fields, p_prices, p_price_version) (docs/DATABASE.md §27.5)
    function saveItem(w, a) {
      if (!E.canEdit(w, "estimates")) throw deny("not allowed to edit estimates");
      if (nil(a.p_item_id)) throw rule("22023", "say which item is saved");
      const fields = assertKeys(a.p_fields, SAVE_KEYS, "p_fields");
      const prices = assertKeys(a.p_prices, PRICE_KEYS, "p_prices");
      const iv = nil(a.p_item_version) ? null : Number(a.p_item_version);
      const pv = nil(a.p_price_version) ? null : Number(a.p_price_version);
      if (!fields && !prices && iv === null && pv === null) throw rule("22023", "nothing to save");
      if ((prices || pv !== null) && !w.prices) throw deny("not allowed to set prices");
      if (fields && iv === null) throw rule("22023", "a change of the item needs the item's version that was shown");
      if (prices && pv === null) throw rule("22023", "a change of the prices needs the prices' version that was shown");
      if (fields && "item_type" in fields && !ITEM_TYPES.includes(fields.item_type)) throw rule("22023", "an item is both, labor, material or sub");
      const id = Number(a.p_item_id);
      const cur = liveItem(w, id);
      if (!cur) throw goneErr("estimate_items", id, "estimate item not found");
      if (iv !== null && cur.version !== iv) throw conflictErr("estimate_items", id, cur.version, "the item was changed by someone else");
      let pc = null;
      if (pv !== null) {
        pc = rows.estimate_item_prices.find((x) => x.item_id === id && canRead(w, "estimate_item_prices", x)) || null;
        if (!pc) throw deny("not allowed to set prices");
        if (pc.version !== pv) throw conflictErr("estimate_item_prices", id, pc.version, "the prices were changed by someone else");
      }
      // every rule first: the item, then its prices (nothing is written when one refuses)
      let nextItem = null, nextPrice = null;
      if (fields) {
        const r = Object.assign(clone(cur), clone(fields));
        if (nil(r.name)) r.name = "";
        const probe = clone(r);
        QTY.forEach((k) => { probe[k] = numeric(probe[k], 1e9, 3); });
        probe.assigned_contact_id = bigint(probe.assigned_contact_id);
        if (SAVE_KEYS.some((k) => !same(probe[k], cur[k]))) {
          if (!canWrite(w, "estimate_items", cur)) throw deny("not allowed to change this item");
          itemRules(w, "UPDATE", r, cur);
          nextItem = r;
        }
      }
      if (prices) {
        const r = Object.assign(clone(pc), clone(prices));
        priceRules(r, pc);
        if (PRICE_KEYS.some((k) => !same(r[k], pc[k]))) {
          if (!canWrite(w, "estimate_item_prices", pc)) throw deny("not allowed to set prices");
          nextPrice = r;
        }
      }
      if (nextItem) writeUpdate(w, "estimate_items", cur, nextItem);
      if (nextPrice) writeUpdate(w, "estimate_item_prices", pc, nextPrice);
      const now = rows.estimate_items.find((i) => i.id === id);
      const out = itemAnswer(w, now);
      if (w.prices) {
        const t = totalsRow(w, now);
        delete t.item_id; delete t.estimate_id; delete t.project_id;
        out.totals = t;
      }
      return out;
    }

    // add_estimate_item(estimate_id, fields, prices): the item and its prices in one transaction
    function addItem(w, a) {
      const f = assertKeys(a.fields, ADD_KEYS, "fields") || {};
      let prices = a.prices;
      if (!nil(prices)) {
        prices = assertKeys(prices, PRICE_KEYS, "prices");
        if (prices && !w.prices) throw deny("not allowed to set prices");
      } else prices = null;
      const r = planItemInsert(w, { estimate_id: nil(a.estimate_id) ? null : Number(a.estimate_id), group_name: f.group_name ?? null,
        group_code: f.group_code ?? null, sort: f.sort ?? null, name: nil(f.name) ? "" : f.name, description: f.description ?? null,
        labor_area: f.labor_area ?? null, labor_guys: f.labor_guys ?? null, labor_days: f.labor_days ?? null,
        labor_qty: "labor_qty" in f ? f.labor_qty : 1, material_description: f.material_description ?? null,
        material_qty: "material_qty" in f ? f.material_qty : 1, material_area: f.material_area ?? null,
        assigned_contact_id: f.assigned_contact_id ?? null, assigned_text: f.assigned_text ?? null, notes: f.notes ?? null,
        item_type: nil(f.item_type) ? "both" : f.item_type });
      if (prices) {
        // the price row the insert will make (the project's rate) with these prices: checked before anything is written
        const pp = rows.project_prices.find((x) => x.project_id === r.project_id);
        const base = Object.assign(clone(E.COLS.estimate_item_prices), { item_id: null, labor_rate: pp ? pp.labor_rate : null });
        priceRules(Object.assign(clone(base), clone(prices)), base);
      }
      writeInsert(w, "estimate_items", r);
      if (prices) {
        const p = rows.estimate_item_prices.find((x) => x.item_id === r.id);
        const next = Object.assign(clone(p), clone(prices));
        priceRules(next, p);
        writeUpdate(w, "estimate_item_prices", p, next);
      }
      return itemAnswer(w, rows.estimate_items.find((i) => i.id === r.id));
    }

    function checkMoveList(moves, max, keys, where) {
      if (!Array.isArray(moves) || moves.length > max) throw rule("22023", "moves must be a list of " + (where ? "1 to " : "at most ") + max + " items");
      for (const m of moves) {
        if (!m || typeof m !== "object" || Array.isArray(m)) throw rule("22023", "each move must be an object");
        assertKeys(m, ["id", "version"].concat(keys), "a move");
        if (nil(m.id) || m.id === "" || nil(m.version) || m.version === "") throw rule("22023", "each move needs the item id and the version that was shown");
      }
      if (new Set(moves.map((m) => String(m.id))).size !== moves.length) throw rule("22023", "each item may be moved once per call");
    }
    /** the items of these moves, locked in id order and compared with the versions shown */
    function lockItems(w, moves) {
      for (const m of moves.slice().sort((x, y) => Number(x.id) - Number(y.id))) {
        const it = liveItem(w, m.id);
        if (!it) throw goneErr("estimate_items", Number(m.id), "estimate item not found");
        if (it.version !== Number(m.version)) throw conflictErr("estimate_items", it.id, it.version, "the item was changed by someone else");
      }
    }

    // move_estimate_items(moves): several items moved, reordered or regrouped, every one on its version
    const MOVE_KEYS = ["estimate_id", "group_name", "group_code", "sort"];
    function moveItems(w, a) {
      if (!E.canEdit(w, "estimates")) throw deny("not allowed to move estimate items");
      const moves = a.moves;
      if (!Array.isArray(moves) || !moves.length || moves.length > 500) throw rule("22023", "moves must be a list of 1 to 500 items");
      checkMoveList(moves, 500, MOVE_KEYS, true);
      for (const m of moves) if (!MOVE_KEYS.some((k) => k in m)) throw rule("22023", "say where the item goes");
      lockItems(w, moves);
      const plan = moves.map((m) => {
        const old = liveItem(w, m.id);
        const r = clone(old);
        MOVE_KEYS.forEach((k) => { if (k in m) r[k] = k === "estimate_id" ? Number(m[k]) : m[k]; });
        if (!canWrite(w, "estimate_items", old)) throw deny("not allowed to move this item");
        itemRules(w, "UPDATE", r, old);
        return { old, r };
      });
      plan.forEach((x) => writeUpdate(w, "estimate_items", x.old, x.r));
      return plan.map((x) => itemAnswer(w, rows.estimate_items.find((i) => i.id === x.r.id)));
    }

    // reorder_estimate(estimate_id, estimate_version, group_order, moves): one drop in one transaction
    function reorder(w, a) {
      if (!E.canEdit(w, "estimates")) throw deny("not allowed to rearrange estimates");
      if (nil(a.estimate_id)) throw rule("22023", "say which estimate is rearranged");
      const moves = nil(a.moves) ? [] : a.moves;
      const order = nil(a.group_order) ? null : a.group_order;
      if (order !== null && !Array.isArray(order)) throw rule("22P02", "malformed array literal");
      if (!Array.isArray(moves) || moves.length > 2000) throw rule("22023", "moves must be a list of at most 2000 items");
      if (order === null && !moves.length) throw rule("22023", "nothing to rearrange");
      if (order !== null && nil(a.estimate_version)) throw rule("22023", "a new group order needs the version of the estimate that was shown");
      checkMoveList(moves, 2000, ["group_name", "group_code", "sort"], false);
      for (const m of moves) {
        if (("sort" in m && !["number", "string"].includes(typeof m.sort)) || ("group_name" in m && !(nil(m.group_name) || typeof m.group_name === "string")) ||
          ("group_code" in m && !(nil(m.group_code) || typeof m.group_code === "string"))) {
          throw rule("22023", "a sort is a number; a group name and code are text");
        }
      }
      const eid = Number(a.estimate_id);
      const est = rows.estimates.find((x) => x.id === eid && canRead(w, "estimates", x));
      if (!est || est.deleted_at) throw goneErr("estimates", eid, "estimate not found");
      if (!nil(a.estimate_version) && est.version !== Number(a.estimate_version)) throw conflictErr("estimates", eid, est.version, "the estimate was changed by someone else");
      lockItems(w, moves);
      for (const m of moves) {
        if (liveItem(w, m.id).estimate_id !== eid) {
          throw rule("22023", "every item rearranged must be on this estimate (another estimate: move_estimate_items)");
        }
      }
      // the groups as they stand before the moves: key -> the code of its first coded item (or none)
      const codes = {};
      rows.estimate_items.filter((i) => i.estimate_id === eid && !i.deleted_at)
        .sort((x, y) => (!String(x.group_code || "").trim() - !String(y.group_code || "").trim()) || cmpNum(x.sort, y.sort) || x.id - y.id)
        .forEach((i) => { const k = gkey(i.group_name); if (!(k in codes)) codes[k] = String(i.group_code || "").trim() ? i.group_code : null; });
      const plan = [];
      for (const m of moves) {
        const old = liveItem(w, m.id);
        const name = "group_name" in m ? m.group_name : old.group_name;
        let code;
        if ("group_code" in m) code = m.group_code;
        else if (gkey(name) !== gkey(old.group_name) && gkey(name) in codes) code = codes[gkey(name)];
        else code = old.group_code;
        const sort = "sort" in m ? numeric(m.sort, 1e15, 6) : old.sort;
        if (same(name, old.group_name) && same(code, old.group_code) && same(sort, old.sort)) continue;
        const r = Object.assign(clone(old), { group_name: name, group_code: code, sort });
        if (!canWrite(w, "estimate_items", old)) throw deny("not allowed to move this item");
        itemRules(w, "UPDATE", r, old);
        plan.push({ table: "estimate_items", old, r });
      }
      if (order !== null && JSON.stringify(cleanOrder(order).map(gkey)) !== JSON.stringify((est.group_order || []).map(gkey))) {
        const r = Object.assign(clone(est), { group_order: order.slice() });
        if (!canWrite(w, "estimates", est)) throw deny("not allowed to rearrange this estimate");
        estimateRules(w, "UPDATE", r, est);
        plan.push({ table: "estimates", old: est, r });
      }
      plan.forEach((x) => writeUpdate(w, x.table, x.old, x.r));
      return { estimate: estimateAnswer(w, rows.estimates.find((x) => x.id === eid)),
        items: moves.map((m) => itemAnswer(w, rows.estimate_items.find((i) => i.id === Number(m.id)))) };
    }

    // duplicate_estimate(estimate_id, new_name): a draft copy with its items and their prices (prices people only)
    function duplicate(w, a) {
      if (!E.canEdit(w, "estimates")) throw deny("not allowed to duplicate estimates");
      if (!w.prices) throw deny("a copy of an estimate carries its prices: only people who may see prices can duplicate one");
      const sid = Number(a.estimate_id);
      const s = rows.estimates.find((x) => x.id === sid && !x.deleted_at && canRead(w, "estimates", x));
      if (!s) throw goneErr("estimates", sid, "estimate not found");
      let name = tidy(a.new_name);
      if (!name) {
        const base = String(s.name || "").trim() || label(s.kind, s.number, s.co_number);
        const taken = (n) => rows.estimates.some((x) => x.project_id === s.project_id && x.kind === s.kind && !x.deleted_at && gkey(x.name) === gkey(n));
        name = base + " (copy)";
        for (let k = 2; taken(name); k++) name = base + " (copy " + k + ")";
      }
      const e = Object.assign(clone(E.COLS.estimates), { project_id: s.project_id, kind: s.kind, name, description: s.description,
        client_notes: s.client_notes, group_order: clone(s.group_order || []) });
      if (!canWrite(w, "estimates", e)) throw new PgErr("42501", 'new row violates row-level security policy for table "estimates"', 403);
      estimateRules(w, "INSERT", e, null);
      copiedFrom = label(s.kind, s.number, s.co_number);
      try { writeInsert(w, "estimates", e); } finally { copiedFrom = null; }
      itemsOf(w, s.id).forEach((it) => {
        const n = planItemInsert(w, { estimate_id: e.id, group_name: nil(it.group_name) ? null : String(it.group_name).slice(0, 200),
          group_code: it.group_code, sort: it.sort, name: it.name, description: it.description, labor_area: it.labor_area, labor_guys: it.labor_guys,
          labor_days: it.labor_days, labor_qty: it.labor_qty, material_description: it.material_description, material_qty: it.material_qty,
          material_area: it.material_area, assigned_contact_id: it.assigned_contact_id, assigned_text: it.assigned_text, notes: it.notes,
          item_type: it.item_type });
        writeInsert(w, "estimate_items", n);
        const src = rows.estimate_item_prices.find((x) => x.item_id === it.id);
        const cur = rows.estimate_item_prices.find((x) => x.item_id === n.id);
        if (src && cur) {
          writeUpdate(w, "estimate_item_prices", cur, Object.assign(clone(cur), PRICE_KEYS.reduce((o, k) => { o[k] = src[k]; return o; }, {})));
        }
      });
      return Object.assign(clone(rows.estimates.find((x) => x.id === e.id)), {
        items: itemsOf(w, e.id).map((i) => itemAnswer(w, i)) });
    }

    const RPCS = {
      estimate_print: { args: ["p_estimate_id"], required: ["p_estimate_id"], fn: estimatePrint },
      takeoff_print: { args: ["p_takeoff_id", "p_project_id"], required: [], fn: takeoffPrint },
      estimate_edit_read: { args: ["p_project_id"], required: ["p_project_id"], fn: editRead },
      save_estimate_item: { args: ["p_item_id", "p_item_version", "p_fields", "p_prices", "p_price_version"], required: ["p_item_id"], fn: saveItem },
      add_estimate_item: { args: ["estimate_id", "fields", "prices"], required: ["estimate_id"], fn: addItem },
      move_estimate_items: { args: ["moves"], required: ["moves"], fn: moveItems },
      reorder_estimate: { args: ["estimate_id", "estimate_version", "group_order", "moves"], required: ["estimate_id"], fn: reorder },
      duplicate_estimate: { args: ["estimate_id", "new_name"], required: ["estimate_id"], fn: duplicate },
    };
    const WRITES = new Set(["estimates", "estimate_items", "estimate_item_prices"]);
    return {
      name: "p5a-est", tables, canRead, views: { estimate_item_totals: totals },
      // the policies: estimates and their items by an estimates editor (the web editor, DCR Desktop 2, the demo's "someone
      // in the office changes it" - DCR2Demo.remoteEdit), prices with the switch too; takeoffs by the takeoffs writers
      canUpdate: (w, table, r) => canWrite(w, table, r),
      canInsert: (w, table, r) => canWrite(w, table, r),
      canDelete: (w, table, r) => (table === "estimates" || table === "estimate_items") && canWrite(w, table, r),
      // the triggers
      beforeInsert(w, table, r) {
        if (table === "estimates") estimateRules(w, "INSERT", r, null);
        else if (table === "estimate_items") itemRules(w, "INSERT", r, null);
      },
      guardUpdate(w, table, old, r) {
        if (table === "estimates") estimateRules(w, "UPDATE", r, old);
        else if (table === "estimate_items") itemRules(w, "UPDATE", r, old);
        else if (table === "estimate_item_prices") priceRules(r, old);
      },
      afterInsert: (w, table, r) => { if (WRITES.has(table)) afterInsert(w, table, r); },
      afterUpdate: (w, table, old, r) => { if (WRITES.has(table)) afterUpdate(w, table, old, r); },
      beforeSoftDelete, afterSoftDelete,
      handles: (name) => Object.prototype.hasOwnProperty.call(RPCS, name),
      checkArgs(name, args) {
        const sig = RPCS[name];
        const keys = Object.keys(args || {});
        if (keys.some((k) => !sig.args.includes(k)) || sig.required.some((k) => !keys.includes(k))) {
          throw new PgErr("PGRST202", "Could not find the function public." + name + "(" + keys.join(", ") + ") in the schema cache", 404);
        }
      },
      rpc: (w, name, args) => clone(RPCS[name].fn(w, args)),
    };
  });

  /* ── made-up data ───────────────────────────────────────────────────── */
  // the quantities-only Estimator (migration 20261028000100: a manager with the Estimator switch, no prices) - the same
  // made-up person as Part 3's tools/fake/p7-web.js, which seeds the switch itself when it is loaded
  const ESTIMATOR = { key: "estimator", id: "00000000-0000-4000-8000-000000000013", full_name: "Robin Estimator", email: "estimator@demo.test",
    role: "manager", color: "#9c4dcc", phone: "(805) 555-0113" };
  function seedEstimators(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    (out.profiles || []).forEach((p) => { p.can_estimate = p.role === "admin"; });     // the role's default: an admin's only
    const row = (id) => (out.profiles || []).find((p) => p.id === id);
    if (row(P.manager_prices)) row(P.manager_prices).can_estimate = true;              // Quinn: an Estimator with prices
    if (out.profiles && !row(ESTIMATOR.id)) {
      const at = new Date(now.getTime() - 120 * 86400000).toISOString();
      out.profiles.push({ id: ESTIMATOR.id, full_name: ESTIMATOR.full_name, email: ESTIMATOR.email, phone: ESTIMATOR.phone, role: ESTIMATOR.role,
        color: ESTIMATOR.color, can_see_prices: false, can_see_financials: false, can_approve_payments: false, can_sales_estimates: false,
        can_estimate: true, active: true, must_change_password: false, created_at: at, created_by: P.admin, updated_at: at, updated_by: null, version: 1 });
    }
    if (Array.isArray(NS.PEOPLE) && !NS.PEOPLE.some((p) => p.key === ESTIMATOR.key || p.id === ESTIMATOR.id)) {
      NS.PEOPLE.push({ key: ESTIMATOR.key, id: ESTIMATOR.id, email: ESTIMATOR.email, name: ESTIMATOR.full_name, role: ESTIMATOR.role,
        note: "Estimator switched on (no prices)" });
    }
    P.estimator = ESTIMATOR.id;
  }

  (NS.extSeed = NS.extSeed || []).push(function seedP5a(out, h) {
    const P = h.P;
    const iso = (d) => new Date(d).toISOString();
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    const addDays = (ymd, n) => {
      const [y, m, d] = ymd.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, d + n));
      return t.toISOString().slice(0, 10);
    };
    const at = (days) => iso(now.getTime() - days * 86400000);
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.admin, updated_at: at(days), updated_by: null, version: 1 });
    const byNumber = (n) => out.projects.find((p) => p.number === n);
    const sandbox = byNumber("A267");
    const other = byNumber("A304") || out.projects[out.projects.length - 2];
    // Part 3's tools/fake/p7-web.js (Access switches) seeds the Estimator switch and the same person when it is loaded
    if (typeof NS.p7RoleDefaults !== "function") seedEstimators(out, h);
    Object.assign(out, { estimates: [], estimate_items: [], estimate_item_prices: [], materials: [], material_prices: [], purposes: [],
      takeoffs: [], takeoff_rows: [], takeoff_row_prices: [] });
    const ids = { e: 0, i: 0, m: 0, t: 0, r: 0, p: 0 };

    // the catalog
    const MATS = [
      ["2x6x8 stud", "LB-268", "Lumber", "Studs", "ea", 6.85], ["2x6x16 plate", "LB-616", "Lumber", "Plates", "ea", 14.2],
      ["2x4x8 stud", "LB-248", "Lumber", "Studs", "ea", 4.1], ["TJI 230 x 20'", "EW-230", "Engineered", "I-joists", "ea", 62.5],
      ["3/4 T&G OSB", "SH-34T", "Sheathing", "Floor", "sheet", 48.75], ["1/2 CDX plywood", "SH-12C", "Sheathing", "Roof", "sheet", 32.5],
      ["Hold-down HDU5", "HW-HDU5", "Hardware", "Hold-downs", "ea", 38.4], ["PT 2x8x12", "PT-2812", "Lumber", "Treated", "ea", 18.4],
      ["PT 4x4x10 post", "PT-4410", "Lumber", "Treated", "ea", 21.9], ["Joist hanger LUS28", "HW-LUS28", "Hardware", "Hangers", "ea", 2.35],
      ["16d sinker nails (50 lb)", "FS-16D", "Fasteners", "Nails", "box", 74],
    ];
    const mat = {};
    MATS.forEach(([name, code, category, subcategory, unit, price]) => {
      const id = ++ids.m;
      mat[name] = id;
      out.materials.push(Object.assign({ id, name, code, category, subcategory, unit, active: true }, audit(300)));
      out.material_prices.push(Object.assign({ material_id: id, unit_price: price }, audit(300)));
    });
    ["Exterior walls", "Interior partitions", "Floor joists", "Subfloor", "Roof sheathing", "Shear walls", "Framing"].forEach((name, i) => {
      out.purposes.push(Object.assign({ id: ++ids.p, code: "FR", name, sort: i + 1 }, audit(300)));
    });

    // estimates and change orders
    const est = (project, f, days) => {
      const id = ++ids.e;
      const number = out.estimates.filter((e) => e.project_id === project.id).length + 1;
      const co = f.kind === "change_order" ? out.estimates.filter((e) => e.project_id === project.id && e.kind === "change_order").length + 1 : null;
      const e = Object.assign({ id, project_id: project.id, number, kind: "estimate", co_number: co, name: "", description: null, status: "draft",
        sent_date: null, approved_date: null, client_notes: null, group_order: [], archived_at: null, deleted_at: null }, f, audit(days, P.manager_prices));
      out.estimates.push(e);
      return e;
    };
    const item = (e, f, prices) => {
      const id = ++ids.i;
      const sort = out.estimate_items.filter((x) => x.estimate_id === e.id).length + 1;
      out.estimate_items.push(Object.assign({ id, estimate_id: e.id, project_id: e.project_id, group_name: null, group_code: null, sort,
        name: "", description: null, labor_area: null, labor_guys: null, labor_days: null, labor_qty: 1, material_description: null,
        material_qty: 1, material_area: null, assigned_contact_id: null, assigned_text: null, notes: null, item_type: "both",
        deleted_at: e.deleted_at }, f, audit(20, P.manager_prices)));
      out.estimate_item_prices.push(Object.assign({ item_id: id, labor_rate: 90, labor_unit_price: null, labor_markup_pct: 10,
        material_unit_price: null, material_markup_pct: 15, quoted_price: null }, prices || {}, audit(20, P.manager_prices)));
      return id;
    };

    if (sandbox) {
      const main = est(sandbox, { name: "Main house framing", status: "approved", sent_date: addDays(today, -30), approved_date: addDays(today, -21),
        description: "Framing per plan set rev C. Hold-downs and hardware supplied by the GC.",
        client_notes: "Price good for 30 days. Includes an allowance of $2,500 for framing hardware.\nWork starts within two weeks of the signed copy.",
        group_order: ["Floor system", "Walls", "Roof"] }, 34);
      item(main, { group_name: "Floor system", group_code: "06.11.00", name: "Floor joists and subfloor",
        description: "TJI 230 at 16\" o.c., blocking at bearing walls", labor_guys: 4, labor_days: 3, labor_area: 1450,
        material_description: "3/4\" T&G OSB subfloor, glued and nailed", material_qty: 64, material_area: 1450 },
        { material_unit_price: 48.75, material_markup_pct: 15 });
      item(main, { group_name: "Walls", group_code: "06.11.00", name: "Exterior walls 2x6 at 16\" o.c.",
        description: "Includes shear nailing per S-2. The client asked about a $1,200 credit for owner-supplied windows.",
        labor_guys: 5, labor_days: 6, material_description: "2x6 studs and plates", material_qty: 420, notes: "Yard quoted $6.85 a stud on the 12th." },
        { material_unit_price: 6.85, material_markup_pct: 12 });
      item(main, { group_name: "  walls ", name: "Interior walls 2x4", labor_guys: 3, labor_days: 4, material_description: "2x4 studs and plates",
        material_qty: 260 }, { material_unit_price: 4.1, material_markup_pct: 12 });
      item(main, { group_name: "Roof", group_code: "06.17.00", name: "Crane for the truss set", item_type: "sub",
        description: "Crane and operator, half day (sub-contractor)", labor_qty: 1, material_qty: 0, notes: "Crane quote $1,850 - confirm the date with the GC." },
        { labor_rate: null, labor_unit_price: 1850, labor_markup_pct: 0 });
      item(main, { group_name: "Roof", group_code: "06.17.00", name: "Set trusses and sheath the roof", labor_guys: 4, labor_days: 2,
        material_description: "1/2\" CDX plywood", material_qty: 96 }, { material_unit_price: 32.5, material_markup_pct: 15 });
      item(main, { name: "Cleanup and haul-off", labor_qty: 1, material_qty: 0 }, { labor_rate: null, labor_unit_price: 650, labor_markup_pct: 0 });

      const deck = est(sandbox, { name: "Deck option", status: "sent", sent_date: addDays(today, -5),
        description: "Optional rear deck, 12' x 16', pressure-treated." }, 9);
      const deckItem = item(deck, { group_name: "Deck", name: "Deck framing 12x16", labor_guys: 2, labor_days: 3,
        material_description: "PT 2x8 joists and rim", material_qty: 22 }, { material_unit_price: 18.4 });
      item(deck, { group_name: "Deck", name: "Stairs, 4 risers", labor_guys: 2, labor_days: 1, material_qty: 0 });

      const co1 = est(sandbox, { kind: "change_order", name: "Extra window on the north wall", status: "approved",
        sent_date: addDays(today, -12), approved_date: addDays(today, -10), description: "New rough opening with header, per the client's request." }, 13);
      item(co1, { name: "Frame the new rough opening", labor_guys: 2, labor_days: 1, material_description: "Header 4x12, king and jack studs",
        material_qty: 1 }, { material_unit_price: 86 });
      const co2 = est(sandbox, { kind: "change_order", name: "Covered porch", status: "draft",
        description: "Waiting on the client's decision (they mentioned a budget of $9,000)." }, 3);
      item(co2, { group_name: "Porch", name: "Posts and beam", labor_guys: 3, labor_days: 2, material_description: "6x6 posts, 4x10 beam",
        material_qty: 1 }, { material_unit_price: 410 });
      item(co2, { group_name: "Porch", name: "Porch roof framing", labor_guys: 3, labor_days: 2 });
      const old = est(sandbox, { name: "Old layout (superseded)", status: "declined", archived_at: at(25) }, 60);
      item(old, { name: "Framing per the first layout", labor_guys: 4, labor_days: 10 });
      const gone = est(sandbox, { name: "Deleted draft", deleted_at: at(40) }, 45);
      item(gone, { name: "Never priced" });

      // takeoffs
      const tk = (project, f, days) => {
        const id = ++ids.t;
        out.takeoffs.push(Object.assign({ id, project_id: project.id, estimate_item_id: null, name: "", description: null,
          takeoff_date: addDays(today, -days), notes: null }, f, audit(days, P.manager_prices)));
        return id;
      };
      const row = (takeoff, project, f, price) => {
        const id = ++ids.r;
        const sort = out.takeoff_rows.filter((x) => x.takeoff_id === takeoff).length + 1;
        const m = f.material ? mat[f.material] : null;
        const r = Object.assign({ id, takeoff_id: takeoff, project_id: project.id, sort, level: null, category: null, subcategory: null,
          material_id: m, item_name: null, purpose: null, qty: null, unit: null, formula: null, notes: null }, f, audit(20, P.manager_prices));
        delete r.material;
        out.takeoff_rows.push(r);
        const catalog = m ? out.material_prices.find((x) => x.material_id === m) : null;
        out.takeoff_row_prices.push(Object.assign({ row_id: id, unit_price: price !== undefined ? price : catalog ? catalog.unit_price : null }, audit(20, P.manager_prices)));
      };
      const t1 = tk(sandbox, { name: "Main house framing", description: "From plan set rev C (sheets S-1 to S-4)" }, 25);
      row(t1, sandbox, { level: "Main Level", category: "Walls", subcategory: "Exterior", material: "2x6x8 stud", item_name: "2x6x8 stud", qty: 180, unit: "ea", purpose: "Exterior walls" });
      row(t1, sandbox, { level: "Main Level", category: "Walls", subcategory: "Exterior", material: "2x6x16 plate", item_name: "2x6x16 plate", qty: 24, unit: "ea", purpose: "Top and bottom plates" });
      row(t1, sandbox, { level: "Main Level", category: "Walls", subcategory: "Exterior", material: "Hold-down HDU5", item_name: "Hold-down HDU5", qty: 12, unit: "ea", purpose: "Shear walls", notes: "Simpson, about $38 each at the yard" });
      row(t1, sandbox, { level: "Main Level", category: "Walls", subcategory: "Interior", material: "2x4x8 stud", item_name: "2x4x8 stud", qty: 140, unit: "ea", purpose: "Interior partitions" });
      row(t1, sandbox, { level: "Main Level", category: "Floor", material: "TJI 230 x 20'", item_name: "TJI 230 x 20'", qty: 38, unit: "ea", purpose: "Floor joists" });
      row(t1, sandbox, { level: "Main Level", category: "Floor", material: "3/4 T&G OSB", item_name: "3/4 T&G OSB", qty: 64, unit: "sheet", purpose: "Subfloor" });
      row(t1, sandbox, { level: "Second Level", category: "Walls", material: "2x6x8 stud", item_name: "2x6x9 stud (cut from 10')", qty: 120, unit: "ea", purpose: "Exterior walls" }, 8.95);
      row(t1, sandbox, { level: "Roof", material: "1/2 CDX plywood", item_name: "1/2 CDX plywood", qty: 96, unit: "sheet", purpose: "Roof sheathing" });
      row(t1, sandbox, { level: "Roof", item_name: "Truss package (by the supplier)", qty: 0, unit: "ls", purpose: "Trusses" }, null);
      row(t1, sandbox, { material: "16d sinker nails (50 lb)", item_name: "16d sinker nails (50 lb)", qty: 6, unit: "box", purpose: "Framing" });
      const t2 = tk(sandbox, { name: "Deck framing", estimate_item_id: deckItem, description: "For the deck option" }, 5);
      row(t2, sandbox, { level: "Deck", category: "Framing", material: "PT 2x8x12", item_name: "PT 2x8x12", qty: 22, unit: "ea", purpose: "Joists and rim" });
      row(t2, sandbox, { level: "Deck", category: "Framing", material: "PT 4x4x10 post", item_name: "PT 4x4x10 post", qty: 6, unit: "ea", purpose: "Posts" });
      row(t2, sandbox, { level: "Deck", category: "Hardware", material: "Joist hanger LUS28", item_name: "Joist hanger LUS28", qty: 44, unit: "ea", purpose: "Joist hangers" });
      tk(sandbox, { name: "Garage (not started)" }, 1);
    }

    if (other && other !== sandbox) {
      const e = est(other, { name: "Framing", status: "sent", sent_date: addDays(today, -8), description: "Framing and sheathing per plans." }, 15);
      item(e, { group_name: "Walls", name: "Walls and plates", labor_guys: 4, labor_days: 5, material_description: "2x6 package", material_qty: 300 },
        { material_unit_price: 6.85 });
      item(e, { group_name: "Roof", name: "Roof framing", labor_guys: 4, labor_days: 4 });
      const t = ++ids.t;
      out.takeoffs.push(Object.assign({ id: t, project_id: other.id, estimate_item_id: null, name: "Framing package", description: null,
        takeoff_date: addDays(today, -14), notes: null }, audit(14, P.manager_prices)));
      const r = ++ids.r;
      out.takeoff_rows.push(Object.assign({ id: r, takeoff_id: t, project_id: other.id, sort: 1, level: "Main Level", category: "Walls", subcategory: null,
        material_id: mat["2x6x8 stud"], item_name: "2x6x8 stud", purpose: "Walls", qty: 300, unit: "ea", formula: null, notes: null }, audit(14, P.manager_prices)));
      out.takeoff_row_prices.push(Object.assign({ row_id: r, unit_price: 6.85 }, audit(14, P.manager_prices)));
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
