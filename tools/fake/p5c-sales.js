/* DCR Portal 2 — DEMO MODE ONLY: P5c's sales estimating of migration M5c (20261027000100_office_lists.sql §1, §2 and
   §6) in the in-memory database — the comps, the saved sales estimates, the Materials Library and the private bucket
   sales-media — read and written by estimates.html, estimate-deck.html, materials-library.html and cme.html. Loaded
   BEFORE engine.js (its column lists are read when the engine loads); installed into each engine (NS.extInstall).
   Never published (tools/ is not part of the site).

   The tables, columns and rules, as M5c has them (Q10, owner 2026-10-21):
   * profiles.can_sales_estimates — the "Sales estimates" switch: an admin always has it, the agents account never;
     app.can_sales() = an active person with it reads every sales table and the bucket;
     app.can_edit('sales') = an admin, or a MANAGER with it, writes them (any other role with it only reads);
   * sales_reference_projects (comps, no money) + sales_reference_prices (reference_id the key: reference_price,
     cost_per_primary_unit) — the price row is made with every comp (t20) and cascades with it; read with the switch
     AND prices, written (a versioned PATCH) by a sales editor with prices;
   * sales_estimates (the client's name, phone, e-mail and address; scope, selection, media; revision) +
     sales_estimate_prices (estimate_id the key: benchmark_total, range_low_total, range_high_total, output, pricing)
     — the same rules;
   * sales_materials (one row per product and one per color: item_key, item_kind, material_key, …; no money);
   * a gallery (pictures, media) never gains a NEW "cad" value (23514: CME output lives under "cme");
     legacy_sp_id is the import's (42501);
   * the bucket sales-media: <estimates|references|materials>/<…>/<file> (2 to 7 folders deep); read with the switch,
     added by a sales editor, and replaced in place only for a drawing's own name (…/cme-<id>.png|jpg);
   * none of them writes an activity line or an outbox row (P5 check 5).
   Made-up data only: comps in made-up towns (one sample, one not active), a made-up materials library (three product
   lines, their colors, pictures), three saved estimates (a draft with photos and a voice note, a sent one with its
   benchmark and range, a won one), and two made-up people for the switch: Sasha Seller (a manager with the Sales
   estimates switch, no prices) — sales@demo.test — and the accountant and Quinn Manager holding it too. */
(function (root) {
  "use strict";
  const NS = (root.DCR2Fake = root.DCR2Fake || {});

  const TABLES = ["sales_reference_projects", "sales_reference_prices", "sales_estimates", "sales_estimate_prices", "sales_materials"];
  const COLS = {
    sales_reference_projects: { id: null, project_ref: null, project_name: null, trade: "deck", ref_status: null, city: null, state_code: null,
      project_type: null, complexity: null, terrain: null, site_access: null, primary_area_sf: null, secondary_area_sf: null, railing_lf: null,
      stairs: null, levels: null, decking_manufacturer: null, product_line: null, color_name: null, framing_type: null, total_man_hours: null,
      labor: {}, scope: {}, estimate_date: null, approved_date: null, start_date: null, completed_date: null, notes: null,
      active_as_reference: true, is_sample: false, thumbnail_url: null, plans_url: null, folder_url: null, pictures: [], project_id: null,
      legacy_sp_id: null },
    sales_reference_prices: { reference_id: null, reference_price: null, cost_per_primary_unit: null },
    sales_estimates: { id: null, estimate_ref: null, trade: "deck", status: "draft", revision: 1, client_name: null, client_phone: null,
      client_email: null, site_address: null, city: null, project_type: null, complexity: null, primary_area_sf: null, secondary_area_sf: null,
      railing_lf: null, stairs: null, scope: {}, selection: {}, media: {}, reference_project_id: null, author_name: null, notes: null,
      project_id: null, legacy_sp_id: null },
    sales_estimate_prices: { estimate_id: null, benchmark_total: null, range_low_total: null, range_high_total: null, output: {}, pricing: {} },
    sales_materials: { id: null, item_key: null, item_kind: "product", trade: "deck", material_key: null, item_name: null, brand_name: null,
      item_status: null, division: null, category: null, sub_category: null, market_tier: null, price_tier: null, description: null,
      sales_highlights: null, best_for: null, board_profiles: [], warranty_summary: null, manufacturer_url: null, picture_url: null,
      pictures: [], sort_order: 0, selectable: true, details: {}, legacy_sp_id: null },
  };
  const STATUSES = ["draft", "preliminary", "reviewed", "sent", "won", "lost"];
  const SALES_PERSON = { key: "sales", id: "00000000-0000-4000-8000-000000000012", full_name: "Sasha Seller", email: "sales@demo.test",
    role: "manager", color: "#c06c1f", phone: "(805) 555-0112" };
  NS.p5cSalesTables = TABLES;

  (NS.extTables = NS.extTables || []).push({
    tables: TABLES,
    cols: COLS,
    pk: { sales_reference_prices: "reference_id", sales_estimate_prices: "estimate_id" },
    uuid: [],
    noAudit: [],
    fks: [
      ["sales_reference_prices", "reference_id", "sales_reference_projects", true],
      ["sales_estimate_prices", "estimate_id", "sales_estimates", true],
      ["sales_estimates", "reference_project_id", "sales_reference_projects"],
      ["sales_reference_projects", "project_id", "projects"],
      ["sales_estimates", "project_id", "projects"],
    ],
  });

  /* app.sales_media_path_ok / app.sales_media_drawing (M5c) */
  const PATH_OK = /^(materials|references|estimates)\/[^/]+(\/[^/]+){1,6}$/;
  const pathOk = (k) => typeof k === "string" && k.length <= 1024 && PATH_OK.test(k) && !/(^|\/)\.\.?(\/|$)/.test(k);
  const drawing = (k) => pathOk(k) && /\/cme-[0-9a-z-]{8,64}\.(png|jpe?g)$/i.test(k);
  NS.p5cSalesMedia = { pathOk, drawing };

  /* app.json_cads: every "cad" value anywhere in a gallery value */
  function cads(v, out) {
    const acc = out || [];
    if (Array.isArray(v)) v.forEach((x) => cads(x, acc));
    else if (v && typeof v === "object") {
      if (Object.prototype.hasOwnProperty.call(v, "cad")) acc.push(JSON.stringify(v.cad));
      Object.keys(v).forEach((k) => cads(v[k], acc));
    }
    return acc;
  }
  function cadKept(nv, ov) { const before = new Set(cads(ov)); return cads(nv).every((c) => before.has(c)); }

  (NS.extInstall = NS.extInstall || []).push(function install(E) {
    const { rows, COLS: ECOLS, deny, rule, clone, auditInsert, auditUpdate, commitInsert, commitUpdate, commitDelete } = E;
    if (ECOLS.profiles && !("can_sales_estimates" in ECOLS.profiles)) ECOLS.profiles.can_sales_estimates = false;
    if (!rows.sales_reference_projects) return null;
    const tables = new Set(TABLES);

    // app.can_sales(), app.can_edit('sales'), app.can_prices()
    const sales = (w) => w.active && (w.admin || !!(w.p && w.p.can_sales_estimates));
    const editor = (w) => sales(w) && (w.admin || w.role === "manager");
    const refOf = (id) => rows.sales_reference_projects.find((r) => r.id === Number(id)) || null;
    const estOf = (id) => rows.sales_estimates.find((r) => r.id === Number(id)) || null;

    function canRead(w, table, r) {
      if (!sales(w)) return false;
      switch (table) {
        case "sales_reference_projects": case "sales_estimates": case "sales_materials": return true;
        case "sales_reference_prices": return w.prices && !!refOf(r.reference_id);
        case "sales_estimate_prices": return w.prices && !!estOf(r.estimate_id);
        default: return false;
      }
    }
    function canInsert(w, table, r) {
      switch (table) {
        case "sales_reference_projects": case "sales_estimates": case "sales_materials": return editor(w);
        case "sales_reference_prices": return editor(w) && w.prices && !!refOf(r.reference_id);
        case "sales_estimate_prices": return editor(w) && w.prices && !!estOf(r.estimate_id);
        default: return false;
      }
    }
    function canUpdate(w, table, r) { return canInsert(w, table, r); }
    // the price rows go with their comp or estimate (on delete cascade); nobody deletes one by itself
    function canDelete(w, table) { return ["sales_reference_projects", "sales_estimates", "sales_materials"].includes(table) && editor(w); }

    const notNull = (table, col) => rule("23502", 'null value in column "' + col + '" of relation "' + table + '" violates not-null constraint');
    const check = (table, col) => rule("23514", 'new row for relation "' + table + '" violates check constraint "' + table + "_" + col + '_check"');
    function tidy(w, table, r, old) {
      // the import's id
      if (w.uid && ((!old && r.legacy_sp_id != null) || (old && r.legacy_sp_id !== old.legacy_sp_id))) {
        throw deny("the old portal's id is written by the import only");
      }
      const line = (v) => { const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim(); return s || null; };
      const nums = {
        sales_reference_projects: ["primary_area_sf", "secondary_area_sf", "railing_lf", "stairs", "levels", "total_man_hours"],
        sales_estimates: ["primary_area_sf", "secondary_area_sf", "railing_lf", "stairs"],
        sales_reference_prices: ["reference_price", "cost_per_primary_unit"],
        sales_estimate_prices: ["benchmark_total", "range_low_total", "range_high_total"],
      }[table] || [];
      nums.forEach((c) => {
        if (r[c] === null || r[c] === undefined || r[c] === "") { r[c] = null; return; }
        const n = Number(r[c]);
        if (!Number.isFinite(n) || n < 0) throw check(table, c);
        r[c] = Math.round(n * 100) / 100;
      });
      const obj = (c) => { if (r[c] === null || r[c] === undefined) throw notNull(table, c); if (typeof r[c] !== "object" || Array.isArray(r[c])) throw check(table, c); };
      const list = (c) => { if (r[c] === null || r[c] === undefined) throw notNull(table, c); if (!Array.isArray(r[c])) throw check(table, c); };
      if (table === "sales_reference_projects") {
        r.project_name = line(r.project_name) || "";
        if (!r.project_name || r.project_name.length > 200) throw check(table, "project_name");
        r.trade = String(line(r.trade) || "deck").toLowerCase();
        obj("labor"); obj("scope"); list("pictures");
        if (w.uid && !cadKept(r.pictures, old && old.pictures)) throw rule("23514", 'a drawing is saved under "cme", never "cad" (the old drafting tool\'s drawings are kept as they are)');
      } else if (table === "sales_estimates") {
        if (!STATUSES.includes(r.status)) throw check(table, "status");
        const rev = Number(r.revision);
        if (!Number.isInteger(rev) || rev < 0 || rev > 10000) throw check(table, "revision");
        r.client_name = line(r.client_name);
        r.client_email = r.client_email ? String(line(r.client_email) || "").toLowerCase() || null : null;
        r.client_phone = line(r.client_phone);
        r.trade = String(line(r.trade) || "deck").toLowerCase();
        obj("scope"); obj("selection");
        if (r.media === null || r.media === undefined) throw notNull(table, "media");
        if (typeof r.media !== "object") throw check(table, "media");
        if (w.uid && !cadKept(r.media, old && old.media)) throw rule("23514", 'a drawing is saved under "cme", never "cad" (the old drafting tool\'s drawings are kept as they are)');
        if (r.reference_project_id !== null && r.reference_project_id !== undefined && !refOf(r.reference_project_id)) {
          throw rule("23503", 'insert or update on table "sales_estimates" violates foreign key constraint "sales_estimates_reference_project_id_fkey"');
        }
      } else if (table === "sales_materials") {
        r.item_key = line(r.item_key) || "";
        r.item_name = line(r.item_name) || "";
        if (!r.item_key) throw check(table, "item_key");
        if (!r.item_name) throw check(table, "item_name");
        if (!["product", "color"].includes(r.item_kind)) throw check(table, "item_kind");
        r.trade = String(line(r.trade) || "deck").toLowerCase();
        list("pictures"); list("board_profiles"); obj("details");
        if (w.uid && !cadKept(r.pictures, old && old.pictures)) throw rule("23514", 'a drawing is saved under "cme", never "cad" (the old drafting tool\'s drawings are kept as they are)');
      } else if (table === "sales_estimate_prices") {
        obj("output");
        if (r.pricing === null || r.pricing === undefined) throw notNull(table, "pricing");
      }
    }
    function beforeInsert(w, table, r) { tidy(w, table, r, null); }
    function guardUpdate(w, table, old, r) {
      if (table === "sales_reference_prices" && r.reference_id !== old.reference_id) throw rule("23514", "a price stays on its comp");
      if (table === "sales_estimate_prices" && r.estimate_id !== old.estimate_id) throw rule("23514", "a price stays on its estimate");
      tidy(w, table, r, old);
    }
    // t20: every comp and every sales estimate has its price row (made as the table owner: no policy asked)
    function afterInsert(w, table, r) {
      const make = (t, key) => {
        if (rows[t].some((x) => x[key] === r.id)) return;
        const p = Object.assign(clone(COLS[t]), { [key]: r.id });
        auditInsert(w, t, p);
        commitInsert(t, p);
      };
      if (table === "sales_reference_projects") make("sales_reference_prices", "reference_id");
      if (table === "sales_estimates") make("sales_estimate_prices", "estimate_id");
    }
    // t21_sales_reference_projects_area: a comp's area changed (by anyone - a sales editor without prices too) -> its cost
    // per SF follows (the price / the area, 2 places) while both are above 0; written as the table owner (no policy asked)
    function afterUpdate(w, table, old, r) {
      if (table !== "sales_reference_projects") return;
      const area = Number(r.primary_area_sf) || 0;
      if (area <= 0 || Number(r.primary_area_sf) === Number(old.primary_area_sf)) return;
      const pr = rows.sales_reference_prices.find((x) => x.reference_id === r.id);
      const price = pr ? Number(pr.reference_price) || 0 : 0;
      if (!pr || price <= 0) return;
      const cps = Math.round((price / area) * 100 + 1e-9) / 100;
      if (Number(pr.cost_per_primary_unit) === cps) return;
      const next = Object.assign(clone(pr), { cost_per_primary_unit: cps });
      auditUpdate(w, "sales_reference_prices", next, pr);
      commitUpdate("sales_reference_prices", pr, next);
    }
    // on delete cascade
    function afterDelete(w, table, old) {
      if (table === "sales_reference_projects") {
        rows.sales_reference_prices.filter((p) => p.reference_id === old.id).forEach((p) => commitDelete("sales_reference_prices", p));
        rows.sales_estimates.filter((e) => e.reference_project_id === old.id).forEach((e) => { e.reference_project_id = null; });
      }
      if (table === "sales_estimates") rows.sales_estimate_prices.filter((p) => p.estimate_id === old.id).forEach((p) => commitDelete("sales_estimate_prices", p));
    }

    return {
      name: "p5c-sales", tables, canRead, canInsert, canUpdate, canDelete, beforeInsert, guardUpdate, afterInsert, afterUpdate, afterDelete,
      handles: () => false,
      // the bucket sales-media (tools/fake/engine.js objectOwner): its objects' names never start like project-files'
      ownsObject: (key) => /^(materials|references|estimates|legacy)\//.test(String(key || "")),
      canUploadObject: (w, key) => editor(w) && pathOk(key),
      canReadObject: (w) => sales(w),
      canReplaceObject: (w, key) => editor(w) && drawing(key),
    };
  });

  /* ── made-up data ── */
  (NS.extSeed = NS.extSeed || []).push(function seedSales(out, h) {
    const P = h.P;
    const now = h.now instanceof Date ? h.now : new Date(h.now || Date.now());
    const today = h.today;
    TABLES.forEach((t) => { out[t] = out[t] || []; });
    out.objects = out.objects || {};
    const [ty, tm, td] = today.split("-").map(Number);
    const day = (days) => new Date(Date.UTC(ty, tm - 1, td - days)).toISOString().slice(0, 10);
    const at = (days, hour) => {
      const t = new Date(Date.UTC(ty, tm - 1, td - days, 16 + (hour || 0), 40, 0));
      return (t.getTime() > now.getTime() ? new Date(now.getTime() - 3600000 * (1 + days)) : t).toISOString();
    };
    const audit = (days, by) => ({ created_at: at(days), created_by: by || P.admin, updated_at: at(days), updated_by: null, version: 1 });

    // the switch (Q10): an admin always; Quinn Manager (prices) and the accountant hold it too; Sasha Seller is a manager
    // with it and no prices; everyone else (Morgan Manager, the lead, field, view-only) does not
    (out.profiles || []).forEach((p) => { p.can_sales_estimates = p.role === "admin"; });
    const profileRow = (id) => (out.profiles || []).find((p) => p.id === id);
    if (profileRow(P.manager_prices)) profileRow(P.manager_prices).can_sales_estimates = true;
    if (profileRow(P.accountant)) profileRow(P.accountant).can_sales_estimates = true;
    if (out.profiles && !out.profiles.some((p) => p.id === SALES_PERSON.id)) {
      out.profiles.push(Object.assign({ id: SALES_PERSON.id, full_name: SALES_PERSON.full_name, email: SALES_PERSON.email, phone: SALES_PERSON.phone,
        role: SALES_PERSON.role, color: SALES_PERSON.color, can_see_prices: false, can_see_financials: false, can_approve_payments: false,
        can_sales_estimates: true, active: true, must_change_password: false },
        { created_at: new Date(now.getTime() - 200 * 86400000).toISOString(), created_by: P.admin, updated_at: new Date(now.getTime() - 200 * 86400000).toISOString(), updated_by: null, version: 1 }));
    }
    if (Array.isArray(NS.PEOPLE) && !NS.PEOPLE.some((p) => p.key === SALES_PERSON.key)) {
      NS.PEOPLE.push({ key: SALES_PERSON.key, id: SALES_PERSON.id, email: SALES_PERSON.email, name: SALES_PERSON.full_name, role: SALES_PERSON.role,
        note: "Sales estimates switched on (no prices)" });
    }
    P.sales = SALES_PERSON.id;

    let pic = 0;
    function picture(kind, key, name, days) {
      pic += 1;
      const hex = (pic.toString(16).padStart(6, "0") + "ab12cd34ef56ab12cd34ef56").slice(0, 32);
      const path = kind + "/" + key + "/" + hex + "/" + name.replace(/[^A-Za-z0-9._-]+/g, "_");
      out.objects[path] = { size: 180000 + pic * 731, mime: "image/jpeg", owner: P.admin, created_at: at(days || 30) };
      return { path, name, mime: "image/jpeg", size: 180000 + pic * 731 };
    }

    /* comps: completed made-up decks in the demo's made-up towns */
    let rid = 0;
    const comps = [];
    function comp(f, price, days) {
      const id = ++rid;
      const row = Object.assign({}, COLS.sales_reference_projects, { id, trade: "deck", ref_status: "completed", state_code: "CA" }, f, audit(days));
      out.sales_reference_projects.push(row);
      const sf = Number(row.primary_area_sf) || 0;
      out.sales_reference_prices.push(Object.assign({}, COLS.sales_reference_prices, { reference_id: id,
        reference_price: price, cost_per_primary_unit: price && sf ? Math.round((price / sf) * 100) / 100 : null }, audit(days)));
      comps.push(row);
      return row;
    }
    comp({ project_ref: "DEMO-DECK-101", project_name: "Juniper Lane Deck", city: "Pine Hollow", project_type: "new-deck", complexity: "moderate",
      terrain: "slope", site_access: "moderate", primary_area_sf: 410, secondary_area_sf: 410, railing_lf: 58, stairs: 1, levels: 1,
      decking_manufacturer: "Brightwood", product_line: "Ridge Composite", color_name: "Driftwood", framing_type: "wood", total_man_hours: 176,
      labor: { framing: 88, decking: 50, railing: 26, stairs: 12 }, completed_date: day(140),
      notes: "Elevated backyard deck on a moderate slope, one stair run.",
      pictures: [picture("references", "DEMO-DECK-101", "Juniper deck finished.jpg", 140), picture("references", "DEMO-DECK-101", "Juniper deck stairs.jpg", 140)] }, 47800, 140);
    comp({ project_ref: "DEMO-DECK-102", project_name: "Cedar Flats Patio Deck", city: "Cedar Flats", project_type: "new-deck", complexity: "standard",
      terrain: "flat", site_access: "easy", primary_area_sf: 300, secondary_area_sf: 300, railing_lf: 34, stairs: 1, levels: 1,
      decking_manufacturer: "Brightwood", product_line: "Ridge Composite", color_name: "Granite", framing_type: "wood", total_man_hours: 92,
      completed_date: day(220), notes: "Simple rectangular deck, easy access.",
      pictures: [picture("references", "DEMO-DECK-102", "Cedar Flats deck.jpg", 220)] }, 31800, 220);
    comp({ project_ref: "DEMO-DECK-103", project_name: "Laurel Bay Two-Level Deck", city: "Laurel Bay", project_type: "new-deck", complexity: "complex",
      terrain: "hillside", site_access: "difficult", primary_area_sf: 505, secondary_area_sf: 505, railing_lf: 80, stairs: 2, levels: 2,
      decking_manufacturer: "Harborline", product_line: "Coastal PVC", color_name: "Sea Salt", framing_type: "wood", total_man_hours: 310,
      completed_date: day(90), notes: "Two levels on a hillside lot; long railing runs." }, 70500, 90);
    comp({ project_ref: "DEMO-DECK-104", project_name: "Oak Vista Resurface", city: "Oak Vista", project_type: "resurface", complexity: "standard",
      terrain: "flat", site_access: "easy", primary_area_sf: 250, secondary_area_sf: 0, railing_lf: 16, stairs: 0, levels: 1,
      decking_manufacturer: "Brightwood", product_line: "Trailhead Composite", color_name: "Walnut", framing_type: "existing-wood", total_man_hours: 55,
      completed_date: day(60), notes: "Existing framing kept; boards replaced." }, 23900, 60);
    comp({ project_ref: "DEMO-DECK-105", project_name: "Mesa Verde Expansion", city: "Mesa Verde", project_type: "deck-expansion", complexity: "moderate",
      terrain: "slope", site_access: "moderate", primary_area_sf: 440, secondary_area_sf: 170, railing_lf: 52, stairs: 1, levels: 1,
      completed_date: day(300), notes: "Old deck enlarged; part of the structure kept.", is_sample: true }, 50600, 300);
    comp({ project_ref: "DEMO-DECK-106", project_name: "Rocky Point Deck (retired comp)", city: "Rocky Point", project_type: "new-deck", complexity: "standard",
      terrain: "flat", site_access: "easy", primary_area_sf: 360, secondary_area_sf: 360, railing_lf: 40, stairs: 1, levels: 1,
      completed_date: day(700), notes: "Older job, kept for the record.", active_as_reference: false }, 29500, 700);

    /* the Materials Library: three made-up product lines, their colors and pictures */
    let mid = 0;
    function material(f, days) {
      const row = Object.assign({}, COLS.sales_materials, { id: ++mid, trade: "deck", item_status: "active", selectable: true,
        division: "06 - Wood, Plastics & Composites", category: "Decking" }, f, audit(days || 200));
      out.sales_materials.push(row);
      return row;
    }
    const prof = (id, type, dims) => ({ profileId: id, profileType: type, nominalDimensions: dims });
    let order = 0;
    function line(key, name, brand, tier, sub, desc, highlights, best, warranty, colors, profiles, status) {
      order += 10;
      const pr = material({ item_key: key, item_kind: "product", material_key: key, item_name: name, brand_name: brand, market_tier: tier,
        price_tier: tier.toLowerCase(), sub_category: sub, description: desc, sales_highlights: highlights.join("\n"), best_for: best.join("\n"),
        warranty_summary: warranty, manufacturer_url: "https://example.com/decking/" + key, board_profiles: profiles, sort_order: order,
        item_status: status || "active", selectable: (status || "active") === "active", details: { profiles } });
      let o = order;
      colors.forEach((c, i) => {
        o += 1;
        const k = key + "-" + c.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        material({ item_key: k, item_kind: "color", material_key: key, item_name: c, brand_name: brand, sub_category: sub, sort_order: o,
          manufacturer_url: "https://example.com/decking/" + key,
          pictures: i < 2 ? [picture("materials", k, c + ".jpg"), picture("materials", k, c + " sample.jpg")] : [] });
      });
      return pr;
    }
    line("brightwood-ridge", "Brightwood Ridge Composite", "Brightwood", "Mid", "Composite Decking",
      "Capped composite boards with a deep wood grain; the everyday choice for family decks.",
      ["Low maintenance capped surface", "Deep grain in eight colors", "Hidden fasteners available"],
      ["Family backyard decks", "Sunny lots"], "25-year limited residential",
      ["Driftwood", "Granite", "Cedar", "Ash"], [prof("br-sq", "square_edge", "1 x 5.5 in"), prof("br-gv", "grooved_edge", "1 x 5.5 in")]);
    line("brightwood-trailhead", "Brightwood Trailhead Composite", "Brightwood", "Entry", "Composite Decking",
      "Lightweight scalloped boards at an entry price.",
      ["Entry composite option", "Neutral colors"], ["Budget-conscious decks", "Straightforward layouts"], "20-year limited residential",
      ["Walnut", "Pebble"], [prof("bt-sc", "scalloped", "0.9 x 5.5 in")]);
    line("harborline-coastal", "Harborline Coastal PVC", "Harborline", "Premium", "PVC Decking",
      "Cellular PVC boards that stay cool and shrug off salt air.",
      ["Stays cooler underfoot", "Moisture and salt resistant", "Lifetime fade warranty"], ["Coastal homes", "Pool surrounds"],
      "Lifetime limited residential", ["Sea Salt", "Harbor Grey", "Teak"], [prof("hc-gv", "grooved_edge", "1 x 5.5 in")]);
    line("harborline-reserve", "Harborline Reserve PVC", "Harborline", "Luxury", "PVC Decking",
      "A wide-board line still being reviewed for estimates.", ["Wide boards"], ["Show decks"], "",
      ["Ebony"], [prof("hr-wd", "wide", "1 x 7.25 in")], "pending_catalog_review");

    /* saved estimates (made-up clients) */
    let eid = 0;
    function estimate(f, money, days, by) {
      const id = ++eid;
      const row = Object.assign({}, COLS.sales_estimates, { id, trade: "deck" }, f, audit(days, by || P.admin));
      row.updated_at = at(Math.max(0, days - 1), 2);
      out.sales_estimates.push(row);
      out.sales_estimate_prices.push(Object.assign({}, COLS.sales_estimate_prices, { estimate_id: id }, money || {}, audit(days, by || P.admin)));
      return row;
    }
    const scope = (o) => Object.assign({ clientName: "", clientPhone: "", clientEmail: "", address: "", city: "", projectType: "new-deck",
      deckingArea: 0, framingArea: 0, railing: 0, stairs: 0, complexity: "standard", terrain: "", access: "", notes: "" }, o);
    const sel1 = { primary: { materialId: "brightwood-ridge", colorId: "brightwood-ridge-driftwood", profileId: "br-gv" }, alternative: { materialId: "harborline-coastal", colorId: "harborline-coastal-sea-salt" },
      options: [{ materialId: "harborline-coastal", colorId: "harborline-coastal-sea-salt", profileId: "hc-gv" }] };
    const c1 = comps[0], c2 = comps[1];
    estimate({ estimate_ref: "EST-DEMO1", status: "sent", revision: 3, client_name: "Rowena Fairbanks", client_phone: "(805) 555-0161",
      client_email: "rowena@example.com", site_address: "18 Quail Run", city: "Pine Hollow", project_type: "new-deck", complexity: "moderate",
      primary_area_sf: 400, secondary_area_sf: 400, railing_lf: 55, stairs: 1,
      scope: scope({ clientName: "Rowena Fairbanks", clientPhone: "(805) 555-0161", clientEmail: "rowena@example.com", address: "18 Quail Run",
        city: "Pine Hollow", projectType: "new-deck", deckingArea: 400, framingArea: 400, railing: 55, stairs: 1, complexity: "moderate",
        terrain: "slope", access: "moderate", notes: "Wants it finished before spring." }),
      selection: { sel: sel1, showRefs: [c2.project_ref], referenceRef: c1.project_ref }, media: { photos: [], audioNotes: [] },
      reference_project_id: c1.id, notes: "Wants it finished before spring." },
    { benchmark_total: 46600, range_low_total: 42400, range_high_total: 46600,
      pricing: { rates: { framingSF: "18", deckingSF: "", railingLF: "65", stairsEach: "", sidingSF: "" }, sidingArea: "", laborRate: "75",
        items: [{ kind: "priced", name: "Permit", price: "850", markup: 10 }] },
      output: { benchmark: { present: true, projectRef: c1.project_ref, projectName: c1.project_name, total: 46600 } } }, 12, P.manager_prices);
    const photos = [picture("estimates", "EST-DEMO2", "Back yard from the porch.jpg", 4), picture("estimates", "EST-DEMO2", "Old deck footing.jpg", 4)];
    photos[1].ann = { items: [{ type: "arrow", pts: [[100, 100], [300, 220]], color: "#e53935", width: 3 }], ppf: null };
    estimate({ estimate_ref: "EST-DEMO2", status: "draft", revision: 0, client_name: "Teodoro Wexley", client_phone: "(805) 555-0162",
      site_address: "7 Hillcrest Ct", city: "Oak Vista", project_type: "resurface", complexity: "standard", primary_area_sf: 260, secondary_area_sf: 0,
      railing_lf: 18, stairs: 0,
      scope: scope({ clientName: "Teodoro Wexley", clientPhone: "(805) 555-0162", address: "7 Hillcrest Ct", city: "Oak Vista", projectType: "resurface",
        deckingArea: 260, framingArea: 0, railing: 18, stairs: 0, complexity: "standard", notes: "Asked whether $9,500 is realistic." }),
      selection: {}, notes: "Asked whether $9,500 is realistic.",
      media: { photos, audioNotes: [{ audioPath: null, txtPath: null, name: "voice-note-demo.webm", when: at(4), transcript: "Boards are soft near the door; keep the joists.", failed: true }] } },
    null, 4, SALES_PERSON.id);
    estimate({ estimate_ref: "EST-DEMO3", status: "won", revision: 2, client_name: "Amara Lindqvist", client_phone: "(805) 555-0163",
      site_address: "301 Madrone Way", city: "Cedar Flats", project_type: "new-deck", complexity: "standard", primary_area_sf: 310, secondary_area_sf: 310,
      railing_lf: 36, stairs: 1,
      scope: scope({ clientName: "Amara Lindqvist", clientPhone: "(805) 555-0163", address: "301 Madrone Way", city: "Cedar Flats", projectType: "new-deck",
        deckingArea: 310, framingArea: 310, railing: 36, stairs: 1, complexity: "standard" }),
      selection: { sel: { primary: { materialId: "brightwood-trailhead", colorId: "brightwood-trailhead-walnut", profileId: "bt-sc" }, alternative: null, options: [] },
        showRefs: [], referenceRef: c2.project_ref },
      media: { photos: [], audioNotes: [] }, reference_project_id: c2.id },
    { benchmark_total: 32860, range_low_total: 32860, range_high_total: 32860, output: {}, pricing: {} }, 30, P.admin);
  });
})(typeof globalThis !== "undefined" ? globalThis : this);
