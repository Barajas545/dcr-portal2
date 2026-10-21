/* DCR Portal 2 — DEMO MODE ONLY: P5a's estimates, change orders and takeoffs in the in-memory database (DCR
   Desktop 2's tables, read by Portal 2's read-only Estimate and Takeoffs tabs and the printed Estimate,
   Change Order, Material List and Material Quote). Loaded BEFORE engine.js (NS.extTables is read when
   engine.js loads) and installed into each engine (NS.extInstall). Never published (tools/ is not part of
   the site).

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
   * the DCR Agents 2 account reads none of them (is_active() refuses it); Portal 2 writes none of them (Q12):
     the office's own write policies (estimates: admin, manager; takeoffs: admin, manager, lead; prices with the
     switch) are here only so the demo's "someone in the office changes it" (DCR2Demo.remoteEdit) reaches an
     open page live;
   * rpc estimate_print and takeoff_print (M5a): the same answers, money keys only with prices, the words
     scrubbed (app.scrub_money, NS.p6ScrubMoney) without them.
   Made-up data only (sandbox A267 and one more job): the estimates' words carry a typed amount or two so
   the masking shows. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const TABLES = ["estimates", "estimate_items", "estimate_item_prices", "estimate_item_totals", "materials", "material_prices",
    "purposes", "takeoffs", "takeoff_rows", "takeoff_row_prices"];

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
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
    // security invoker: the caller's own rows, the money NULL without the switch
    function totals(w) {
      return rows.estimate_items.map((i) => {
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
      });
    }
    /* ── M5a's read functions for the print and view pages (security invoker: the caller's rows) ── */
    const { PgErr, clone } = E;
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
    function estimatePrint(w, a) {
      if (!w.active) throw new PgErr("42501", "not allowed", 403);
      const prices = w.prices;
      const e = rows.estimates.find((x) => x.id === Number(a.p_estimate_id) && !x.deleted_at);
      if (!e || !canRead(w, "estimates", e)) throw new PgErr("PT404", "estimate not found", 404);
      const items = itemsOf(w, e.id);
      const T = (s) => (prices ? s : scrub(s));
      const shaped = items.map((i) => {
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
        return { key: gkey(i.group_name), raw: i.group_name, code: i.group_code, total: m.total, men: m.men_hours, j };
      });
      const listed = {};
      cleanOrder(e.group_order).forEach((n, k) => { if (!(gkey(n) in listed)) listed[gkey(n)] = k + 1; });
      const groups = [];
      const byKey = {};
      for (const s of shaped) {
        let g = byKey[s.key];
        if (!g) { g = byKey[s.key] = { gk: s.key, name: tidy(s.raw), code: null, items: [], total: 0 }; groups.push(g); }
        if (g.code === null && String(s.code || "").trim()) g.code = String(s.code).trim();
        g.items.push(s.j);
        g.total = Math.round((g.total + s.total) * 100) / 100;
      }
      groups.sort((x, y) => {
        const lx = listed[x.gk], ly = listed[y.gk];
        if ((lx === undefined) !== (ly === undefined)) return lx === undefined ? 1 : -1;
        if (lx !== undefined && lx !== ly) return lx - ly;
        const nx = natKey(x.code), ny = natKey(y.code);
        if (nx !== ny) return nx < ny ? -1 : 1;
        if ((x.name === "") !== (y.name === "")) return x.name === "" ? 1 : -1;
        const a1 = x.name.toLowerCase(), b1 = y.name.toLowerCase();
        return a1 < b1 ? -1 : a1 > b1 ? 1 : 0;
      });
      const outGroups = groups.map((g) => Object.assign({
        key: prices ? g.gk : gkey(scrub(g.name)), name: prices ? g.name : scrub(g.name),
        title: g.name === "" ? "General" : prices ? g.name : scrub(g.name), code: (prices ? g.code : scrub(g.code)) || "", items: g.items,
      }, prices ? { total: g.total } : {}));
      const totals = { men_hours: shaped.reduce((s, x) => s + x.men, 0) };
      if (prices) {
        totals.labor = Math.round(shaped.reduce((s, x) => s + (x.j.totals.labor || 0) * 100, 0)) / 100;
        totals.material = Math.round(shaped.reduce((s, x) => s + (x.j.totals.material || 0) * 100, 0)) / 100;
        totals.total = Math.round(shaped.reduce((s, x) => s + x.total * 100, 0)) / 100;
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
    const RPCS = {
      estimate_print: { args: ["p_estimate_id"], required: ["p_estimate_id"], fn: estimatePrint },
      takeoff_print: { args: ["p_takeoff_id", "p_project_id"], required: [], fn: takeoffPrint },
    };
    return {
      name: "p5a-est", tables, canRead, views: { estimate_item_totals: totals },
      // DCR Desktop 2's writers (the office edits estimates and takeoffs there; Portal 2 never writes them - Q12): the
      // demo's "someone in the office changes it" (DCR2Demo.remoteEdit) goes through the same policies
      canUpdate: (w, table, r) => canWrite(w, table, r),
      canInsert: (w, table, r) => canWrite(w, table, r),
      canDelete: () => false,
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
