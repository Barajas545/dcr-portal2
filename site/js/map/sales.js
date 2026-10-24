/* Sales estimating: Desktop 2 rows <-> the shapes the old sales pages use (BLUEPRINT 3.3.11 "Sales estimates and
   materials library", migration M5c 20261027000100_office_lists; Q10 owner 2026-10-21). Pure module.

   The tables, as M5c names them (the column lists are in COLS below and nowhere else):
   * sales_reference_projects   the comps (no money) + sales_reference_prices (reference_price,
                                cost_per_primary_unit: the Sales estimates switch AND the prices switch);
   * sales_estimates            a saved estimate (the client's name, phone, e-mail and address: personal data, the
                                Sales estimates switch) + sales_estimate_prices (the benchmark, the range, the
                                estimator's rates and the money part of the output: the prices switch too);
   * sales_materials            the Materials Library, one row per product and one per color (no money);
   * sales-media                the private bucket of their pictures, drawings and voice notes.

   Money never travels in a no-money table: the estimator's rates and the computed benchmark / range / priced scope
   go only into sales_estimate_prices (estimatePriceFields); sales_estimates keeps the scope, the selection and the
   media (estimateFields) — whose words a person typed may still quote an amount, masked on screen for anyone
   without the prices switch (masked / hasAmount, display only: BLUEPRINT 2.1 principle 8). */

import { maskAmounts } from "../money-mask.js";
import { fmtDay as pacificDay } from "./pacific.js";

/** profile + the database's own answer (repo/sales.js salesAccess) -> may this person see sales amounts? */
export function seesSalesPrices(me, access) {
  if (!access || !access.sales) return false;
  return !!me && (me.role === "admin" || !!me.can_see_prices);
}
/** the Sales estimates switch as the profiles row has it (an admin's default is on: Q10) */
export function salesSwitch(row) {
  return !!row && (row.role === "admin" || row.can_sales_estimates === true);
}
/** app.can_edit('sales'): an admin, or a manager with the switch (the other roles with it only read) */
export function salesEditor(me, access) {
  return !!access && !!access.sales && !!me && (me.role === "admin" || me.role === "manager");
}

export function fmtDay(v) { return v ? pacificDay(v) : ""; }
export function masked(t) { return maskAmounts(t == null ? "" : String(t)); }
export function hasAmount(t) { const s = t == null ? "" : String(t); return masked(s) !== s; }

/** price / area, 2 decimals; null when either is missing */
export function costPerSf(price, sf) {
  const p = Number(price), a = Number(sf);
  return p > 0 && a > 0 ? Math.round((p / a) * 100) / 100 : null;
}

function n(v) { return v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v); }
function t(v) { const s = v === null || v === undefined ? "" : String(v).trim(); return s || null; }
function day(v) { const s = t(v); return s && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) ? s.slice(0, 10) : null; }
function json(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return null; } }
  return v;
}
function arr(v) { const j = json(v); return Array.isArray(j) ? j : []; }
function one(v) { return Array.isArray(v) ? (v[0] || null) : (v || null); }

/* ── the column names (M5c) ─────────────────────────────────────────── */
export const COLS = Object.freeze({
  refs: "id, legacy_sp_id, project_ref, project_name, trade, ref_status, city, state_code, project_type, complexity, terrain, " +
    "site_access, primary_area_sf, secondary_area_sf, railing_lf, stairs, levels, decking_manufacturer, product_line, color_name, " +
    "framing_type, total_man_hours, labor, scope, estimate_date, approved_date, start_date, completed_date, notes, " +
    "active_as_reference, is_sample, thumbnail_url, pictures, project_id, created_at, updated_at, version",
  refPrices: "reference_id, reference_price, cost_per_primary_unit, version",
  estimatesLite: "id, estimate_ref, trade, status, revision, client_name, site_address, city, project_type, complexity, " +
    "primary_area_sf, reference_project_id, author_name, created_by, created_at, updated_at, version",
  estimates: "id, estimate_ref, trade, status, revision, client_name, client_phone, client_email, site_address, city, " +
    "project_type, complexity, primary_area_sf, secondary_area_sf, railing_lf, stairs, scope, selection, media, " +
    "reference_project_id, author_name, notes, project_id, created_by, created_at, updated_at, version",
  estPricesLite: "estimate_id, benchmark_total, range_low_total, range_high_total, version",
  estPrices: "estimate_id, benchmark_total, range_low_total, range_high_total, pricing, output, version",
  materials: "id, legacy_sp_id, item_key, item_kind, trade, material_key, item_name, brand_name, item_status, division, category, " +
    "sub_category, market_tier, price_tier, description, sales_highlights, best_for, board_profiles, warranty_summary, " +
    "manufacturer_url, picture_url, pictures, sort_order, selectable, details, version",
});
export const TABLES = Object.freeze({
  refs: "sales_reference_projects", refPrices: "sales_reference_prices",
  estimates: "sales_estimates", estPrices: "sales_estimate_prices", materials: "sales_materials",
});
export const BUCKET = "sales-media";
/** the embed aliases (a row of the prices-only table, or null without the switches) */
export const REF_EMBED = "prices:sales_reference_prices(" + COLS.refPrices + ")";
export const EST_EMBED_LITE = "prices:sales_estimate_prices(" + COLS.estPricesLite + ")";
export const EST_EMBED = "prices:sales_estimate_prices(" + COLS.estPrices + ")";

/* ── reference projects (comps) ─────────────────────────────────────── */
export function toRef(row) {
  const p = one(row.prices);
  return {
    id: row.id, version: row.version, legacyId: row.legacy_sp_id ?? null,
    projectRef: row.project_ref || ("REF-" + row.id), projectName: row.project_name || "",
    trade: row.trade || "deck", refStatus: row.ref_status || "", city: row.city || "", stateCode: row.state_code || "",
    projectType: row.project_type || "", complexity: row.complexity || "", terrain: row.terrain || "", siteAccess: row.site_access || "",
    primaryAreaSF: n(row.primary_area_sf), secondaryAreaSF: n(row.secondary_area_sf), railingLF: n(row.railing_lf),
    stairs: n(row.stairs), levels: n(row.levels),
    deckingManufacturer: row.decking_manufacturer || "", productLine: row.product_line || "", colorName: row.color_name || "",
    framingType: row.framing_type || "", totalManHours: n(row.total_man_hours),
    labor: json(row.labor), scope: json(row.scope),
    estimateDate: row.estimate_date || "", approvedDate: row.approved_date || "", startDate: row.start_date || "", completedDate: row.completed_date || "",
    notes: row.notes || "", activeAsReference: row.active_as_reference !== false, isSample: row.is_sample === true,
    pictures: arr(row.pictures),
    // money: only with the Sales estimates and prices switches (the embed is null otherwise)
    referencePrice: p ? n(p.reference_price) : null,
    costPerPrimaryUnit: p ? n(p.cost_per_primary_unit) : null,
    pricesVersion: p ? p.version : null,
    pricesHidden: !p,
  };
}
/** the comp editor's form -> the sales_reference_projects patch (no money). `existing` keeps what the form lacks. */
export function refFields(form, existing) {
  const f = form || {};
  const out = {
    project_ref: t(f.projectRef), project_name: t(f.projectName), trade: t(f.trade) || (existing && existing.trade) || "deck",
    ref_status: t(f.refStatus) || (existing && existing.refStatus) || "completed",
    state_code: t(f.stateCode) || (existing && existing.stateCode) || "CA",
    city: t(f.city), project_type: t(f.projectType), complexity: t(f.complexity), completed_date: day(f.completedDate),
    primary_area_sf: n(f.primaryAreaSF), secondary_area_sf: n(f.secondaryAreaSF), railing_lf: n(f.railingLF), stairs: n(f.stairs),
    total_man_hours: n(f.totalManHours), decking_manufacturer: t(f.deckingManufacturer), product_line: t(f.productLine),
    active_as_reference: f.activeAsReference !== false,
    pictures: Array.isArray(f.pictures) ? f.pictures : [],
  };
  if ("notes" in f) out.notes = t(f.notes);
  return out;
}
/** the comp's money row (prices only): the final price and its cost per decking SF */
export function refPriceFields(f) {
  const price = n(f.referencePrice);
  return { reference_price: price, cost_per_primary_unit: costPerSf(price, f.primaryAreaSF) };
}

/* ── saved estimates ────────────────────────────────────────────────── */
export function toEstimateLite(row) {
  const p = one(row.prices);
  return {
    id: row.id, version: row.version, estimateRef: row.estimate_ref || "", trade: row.trade || "deck", estStatus: row.status || "draft",
    estVersion: n(row.revision) || 0, clientName: row.client_name || "", siteAddress: row.site_address || "", city: row.city || "",
    projectType: row.project_type || "", complexity: row.complexity || "", primaryAreaSF: n(row.primary_area_sf),
    referenceProjectId: row.reference_project_id ?? null, createdBy: row.created_by || null, authorName: row.author_name || "",
    lastModified: row.updated_at || row.created_at || null,
    benchmarkTotal: p ? n(p.benchmark_total) : null, rangeLowTotal: p ? n(p.range_low_total) : null, rangeHighTotal: p ? n(p.range_high_total) : null,
    pricesHidden: !p,
  };
}
export function toEstimate(row, refsById) {
  const lite = toEstimateLite(row);
  const p = one(row.prices);
  const sel = json(row.selection) || {};
  const ref = row.reference_project_id != null && refsById ? refsById[String(row.reference_project_id)] : null;
  return Object.assign(lite, {
    clientPhone: row.client_phone || "", clientEmail: row.client_email || "",
    secondaryAreaSF: n(row.secondary_area_sf), railingLF: n(row.railing_lf), stairs: n(row.stairs),
    notes: row.notes || "",
    scope: json(row.scope) || {},
    selection: sel,
    media: json(row.media) || { photos: [], audioNotes: [] },
    referenceRef: (ref && ref.project_ref) || sel.referenceRef || null,
    pricing: p ? json(p.pricing) : null,
    output: p ? json(p.output) : null,
    pricesVersion: p ? p.version : null,
  });
}

/** "EST-" + a time and a random tail: minted once per estimate, the folder of its media and its drawings' scope */
export function newEstimateRef(now, rand) {
  const t0 = now === undefined ? Date.now() : Number(now);
  const r = rand === undefined ? Math.floor(Math.random() * 1296) : Number(rand);
  return "EST-" + t0.toString(36).toUpperCase() + r.toString(36).toUpperCase().padStart(2, "0");
}

/** The wizard's state -> the sales_estimates row (no money). opts.refs (the comps read) resolve the chosen
    reference to its id; opts.withSelection: the final save (the status and the selection snapshot). */
export function estimateFields(st, opts) {
  const o = opts || {};
  const p = st.project || {};
  const refRow = st.referenceId ? (o.refs || []).find((r) => r.projectRef === st.referenceId) : null;
  const out = {
    estimate_ref: st.estimateRef, trade: "deck", status: st.estStatus || "draft", revision: Math.max(0, Math.min(10000, Number(st.estVersion) || 0)),
    client_name: t(p.clientName), client_phone: t(p.clientPhone), client_email: t(p.clientEmail),
    site_address: t(p.address), city: t(p.city), project_type: t(p.projectType), complexity: t(p.complexity),
    primary_area_sf: n(p.deckingArea), secondary_area_sf: n(p.framingArea), railing_lf: n(p.railing), stairs: n(p.stairs),
    scope: scopeWithoutMoney(p),
    media: mediaForSave(st.media),
    notes: t(p.notes),
    selection: { sel: st.sel || null, showRefs: st.showRefs || [], referenceRef: st.referenceId || null,
      snapshot: st.output ? st.output.selectionSnapshot || null : null },
  };
  if (refRow) out.reference_project_id = refRow.id;
  else if (!st.referenceId) out.reference_project_id = null;
  if (!o.withSelection && !o.isNew) delete out.status;
  return out;
}
/** the scope as saved: what the client conversation recorded (drawing numbers kept; nothing priced is in it) */
export function scopeWithoutMoney(p) {
  const out = {};
  ["clientName", "clientPhone", "clientEmail", "address", "city", "projectType", "deckingArea", "framingArea", "railing", "stairs",
    "complexity", "terrain", "access", "notes", "drawingNumbers"].forEach((k) => { if (p && p[k] !== undefined) out[k] = p[k]; });
  return out;
}
/** media as saved: the in-memory parts (a recording waiting to upload, a pending flag) never travel */
export function mediaForSave(m) {
  const media = m || {};
  return {
    photos: (media.photos || []).map((e) => Object.assign({}, e)),
    audioNotes: (media.audioNotes || []).map((x) => {
      const c = { audioPath: x.audioPath || null, txtPath: x.txtPath || null, name: x.name || "", when: x.when || null, transcript: x.transcript || "" };
      if (x.failed) c.failed = true;
      return c;
    }),
  };
}
/** The output and the estimator's rates -> the sales_estimate_prices row (prices only). */
export function estimatePriceFields(output, pricing) {
  const o = output || {};
  const b = o.benchmark || {}, r = o.range || {};
  return {
    benchmark_total: b.present && b.total != null ? Number(b.total) : null,
    range_low_total: r.st && r.st !== "none" ? Number(r.loTotal) : null,
    range_high_total: r.st && r.st !== "none" ? Number(r.hiTotal) : null,
    pricing: pricing ? JSON.parse(JSON.stringify(pricing)) : {},
    output: { generatedAt: o.generatedAt || null, benchmark: o.benchmark || null, range: o.range || null,
      sourceRows: o.sourceRows || [], pricing: o.pricing || null, anySample: !!o.anySample },
  };
}

/* ── the Materials Library ──────────────────────────────────────────── */
export function toMaterial(row) {
  return {
    id: row.id, version: row.version, legacyId: row.legacy_sp_id ?? null,
    itemId: row.item_key || "", itemKind: row.item_kind === "color" ? "color" : "product", trade: row.trade || "deck",
    materialId: row.material_key || "", itemName: row.item_name || "", brandName: row.brand_name || "", itemStatus: row.item_status || "active",
    division: row.division || "", category: row.category || "", subCategory: row.sub_category || "",
    marketTier: row.market_tier || "", priceTier: row.price_tier || "", description: row.description || "",
    salesHighlights: row.sales_highlights || "", bestFor: row.best_for || "", profiles: arr(row.board_profiles),
    warrantySummary: row.warranty_summary || "", manufacturerUrl: row.manufacturer_url || "", pictureUrl: row.picture_url || "",
    sortOrder: n(row.sort_order), selectable: row.selectable !== false, details: json(row.details) || {}, pictures: arr(row.pictures),
  };
}
/** the editor's form -> the sales_materials patch (item_key is set once, when the row is made) */
export function materialFields(f, existing) {
  const out = {
    item_kind: f.itemKind === "color" ? "color" : "product", trade: t(f.trade) || "deck", item_name: t(f.itemName),
    division: t(f.division), category: t(f.category), sub_category: t(f.subCategory), brand_name: t(f.brandName),
    item_status: t(f.itemStatus) || "active", selectable: f.selectable !== false, warranty_summary: t(f.warrantySummary),
    manufacturer_url: t(f.manufacturerUrl), material_key: t(f.materialId),
    pictures: Array.isArray(f.pictures) ? f.pictures : [],
  };
  if (!existing) out.item_key = t(f.itemId) || slugId(f.itemName);
  if (out.item_kind === "product") {
    out.market_tier = t(f.marketTier);
    out.description = t(f.description);
    out.sales_highlights = t(f.salesHighlights);
  }
  return out;
}
export function slugId(name) {
  return String(name || "").toLowerCase().normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

/** The library rows -> the wizard's catalog ({products: [{…, colors, profiles}]}), retired rows left out, in the
    library's order (sort order, then name) — the shape deck-materials.json has. */
export function catalogFromRows(rows) {
  const list = (rows || []).map((r) => (r.itemKind ? r : toMaterial(r)))
    .sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || String(a.itemName || "").localeCompare(b.itemName || ""));
  const prods = list.filter((r) => r.itemKind === "product" && r.itemStatus !== "retired");
  return {
    source: "library",
    products: prods.map((pr) => {
      const det = pr.details || {};
      const colors = list.filter((c) => c.itemKind === "color" && c.materialId === pr.materialId && c.itemStatus !== "retired")
        .map((c) => ({ colorId: c.itemId, name: c.itemName, status: c.itemStatus, manufacturerUrl: c.manufacturerUrl, pictures: c.pictures }));
      let profiles = Array.isArray(det.profiles) ? det.profiles : [];
      if (!profiles.length) profiles = pr.profiles || [];
      return {
        materialId: pr.materialId, brandName: pr.brandName, officialName: pr.itemName,
        status: pr.itemStatus, marketTier: pr.marketTier, priceTier: pr.priceTier,
        shortDescription: pr.description, warrantySummary: pr.warrantySummary,
        selectable: pr.selectable !== false && pr.itemStatus === "active",
        pictures: pr.pictures, manufacturerUrl: pr.manufacturerUrl,
        salesHighlights: pr.salesHighlights, bestFor: pr.bestFor,
        colors, profiles,
      };
    }),
  };
}

/* ── sales-media object names ───────────────────────────────────────── */
/** Every estimate's media at most this much JSON (sent whole with each save) */
export const MEDIA_LIMIT = 1900000;
/** sales-media's first folder, as M5c's policies name them (app.sales_media_path_ok) */
export const MEDIA_KINDS = Object.freeze(["estimates", "references", "materials"]);
/** The name as Storage keys take it: accents folded, anything but letters, digits, dot, dash and underscore made
    "_", at most 120 characters (the rule of upload-queue2.js asciiSlug, without its module's imports). */
export function keyName(name, fallback) {
  const fb = fallback || "file";
  const folded = String(name || "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  const s = folded.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[ ._]+|[ ._]+$/g, "");
  return (s || fb).slice(0, 120);
}
/** sales-media object name: {kind}/{key}/{uuid}/{name}, or {kind}/{key}/{folder}/{name} for a stable name (one
    drawing owns one file: cme-<drawing id>.png, the only name M5c lets a sales editor replace in place).
    kind: estimates (key = the estimate's EST- ref), references (the comps), materials (the library). */
export function mediaKey(kind, key, name, uid, folder) {
  if (MEDIA_KINDS.indexOf(kind) === -1) throw new Error("unknown media kind " + kind);
  const k = keyName(key || "new", "new");
  return kind + "/" + k + "/" + (folder ? keyName(folder) : keyName(uid || "x")) + "/" + keyName(name);
}
