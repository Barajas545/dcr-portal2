/* The deck estimate's arithmetic (BLUEPRINT 3.3.11 "Sales estimates and materials library"): the old
   estimate-deck.js matcher and estimate engine, ported verbatim (the DCR Sales Hub prototype's
   ProjectMatcher and EstimateEngine) and made pure, so the wizard page and the tests run the same code.

   Flow it serves: 1 Project info -> 2 Similar projects (scored comps, pick a reference) -> 3 Materials
   -> 4 Review (the estimator's own rates) -> 5 Preliminary estimate.

   Pricing honesty rule, kept from the old page: material pricing is never fabricated — the comparable totals
   come only from completed-project cost history, and the priced scope only from the rates the estimator typed.

   Money (Q10): a comp's price and cost per SF reach the browser only with the Sales estimates switch AND the
   prices switch (sales_reference_prices); without them a comp arrives with costPerPrimaryUnit null, so
   eligibility() says "no usable historical cost per SF" and nothing here invents one. The page also hides the
   money steps from such a person (map/sales.js seesSalesPrices); this module never decides who sees what.

   Pure module: no DOM, no network. */

export const PROJECT_TYPES = [
  { id: "new-deck", t: "New deck", d: "Built from the ground up — framing area matches decking." },
  { id: "resurface", t: "Resurface", d: "Existing framing kept; new deck boards only." },
  { id: "deck-expansion", t: "Expansion", d: "Existing deck enlarged — enter only the NEW framing area." },
  { id: "partial-rebuild", t: "Partial rebuild", d: "Some framing replaced — enter the replaced area." },
];
export const COMPLEXITY = [
  { id: "standard", t: "Standard", d: "Rectangular layout, easy access, single level." },
  { id: "moderate", t: "Moderate", d: "Some angles, slope, or elevated sections." },
  { id: "complex", t: "Complex", d: "Multi-level, hillside, difficult access, custom features." },
];
export const TERRAIN = ["flat", "slope", "hillside"];
export const ACCESS = ["easy", "moderate", "difficult"];
export const EST_STATUSES = ["draft", "preliminary", "reviewed", "sent", "won", "lost"];
export const MARKUPS = [0, 5, 10, 15, 20, 25, 30];
export const MIN_MATCH = 60;
export const MAX_COMPS = 3;

export function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }

export function money(n) {
  if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
  return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
export function money2(n) {
  if (n === null || n === undefined || n === "" || !isFinite(Number(n))) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function matchClass(m) { return m >= 75 ? "hi" : m >= 50 ? "md" : "lo"; }

export function blankProject() {
  return { clientName: "", clientPhone: "", clientEmail: "", address: "", city: "",
    projectType: "", deckingArea: "", framingArea: "", railing: "", stairs: "",
    complexity: "", terrain: "", access: "", notes: "" };
}
export function blankPricing() {
  return { rates: { framingSF: "", deckingSF: "", railingLF: "", stairsEach: "", sidingSF: "" },
    sidingArea: "", laborRate: "", items: [] };
}

/* ══ matcher (ported: type 20 + decking 25 + framing 20 + railing 10 + stairs 10 + complexity 15) ══ */
export function simScore(cur, ref, max) {
  const c = Number(cur) || 0, r = Number(ref) || 0;
  if (c === 0 && r === 0) return max;
  return Math.max(0, max * (1 - Math.abs(c - r) / Math.max(c, r, 1)));
}
export function matchScore(p, ref) {
  const s = (p.projectType === ref.projectType ? 20 : 0) +
    simScore(p.deckingArea, ref.primaryAreaSF, 25) +
    simScore(p.framingArea, ref.secondaryAreaSF, 20) +
    simScore(p.railing, ref.railingLF, 10) +
    simScore(p.stairs, ref.stairs, 10) +
    (p.complexity === ref.complexity ? 15 : 5);
  return Math.round(Math.min(100, s));
}
export function rankRefs(p, refs) {
  return (refs || [])
    .filter((r) => r.activeAsReference !== false)
    .map((r) => { const c = Object.assign({}, r); c.match = matchScore(p, r); return c; })
    .sort((a, b) => b.match - a.match);
}

/* ══ estimate engine (ported: benchmark + comparable range + source rows) ══ */
function usableCps(v) { return v !== null && v !== undefined && v !== "" && isFinite(Number(v)) && Number(v) > 0; }

export function eligibility(r, projectType) {
  const reasons = [];
  if (String(r.refStatus || "") !== "completed") reasons.push("not a completed project");
  if (r.activeAsReference === false) reasons.push("not active as a reference");
  if (r.projectType !== projectType) reasons.push("project type " + (r.projectType || "unknown") + " does not match " + projectType);
  if (!usableCps(r.costPerPrimaryUnit)) reasons.push("no usable historical cost per SF");
  if (!isFinite(Number(r.match)) || Number(r.match) < MIN_MATCH) reasons.push("similarity " + r.match + "% is below " + MIN_MATCH + "%");
  return { eligible: reasons.length === 0, reasons };
}

export function buildBenchmark(area, projectType, ranked, refId) {
  if (!refId) return { present: false, note: "No historical reference was selected. Selecting one adds a benchmark for this scope." };
  const sel = (ranked || []).find((r) => r.projectRef === refId);
  if (!sel) return { present: false, note: "The selected reference could not be resolved from the comps library." };
  const cps = usableCps(sel.costPerPrimaryUnit) ? Number(sel.costPerPrimaryUnit) : NaN;
  const elig = eligibility(sel, projectType);
  return {
    present: true, projectRef: sel.projectRef, projectName: sel.projectName,
    projectType: sel.projectType, refAreaSF: sel.primaryAreaSF, currentAreaSF: area,
    match: isFinite(Number(sel.match)) ? Number(sel.match) : null,
    costPerSF: isFinite(cps) ? cps : null,
    total: isFinite(cps) && area > 0 ? Math.round(area * cps) : null,
    isSample: sel.isSample === true,
    eligibleForRange: elig.eligible, exclusionReasons: elig.reasons,
  };
}

export function buildRange(area, projectType, ranked) {
  const eligible = (ranked || []).filter((r) => eligibility(r, projectType).eligible).slice(0, MAX_COMPS);
  const members = eligible.map((r) => ({
    projectRef: r.projectRef, projectName: r.projectName, projectType: r.projectType,
    refAreaSF: r.primaryAreaSF, match: Number(r.match), costPerSF: Number(r.costPerPrimaryUnit),
    isSample: r.isSample === true,
  }));
  if (!members.length) {
    return { st: "none", areaSF: area, members: [],
      note: "No comparable range is available: no completed projects of the same type score at least " + MIN_MATCH + "% similarity." };
  }
  const costs = members.map((m) => m.costPerSF);
  const lo = Math.min.apply(null, costs), hi = Math.max.apply(null, costs);
  if (members.length === 1) {
    return { st: "single", areaSF: area, members, loCps: lo, hiCps: lo,
      loTotal: Math.round(area * lo), hiTotal: Math.round(area * lo),
      note: "Based on one eligible comparable project." };
  }
  return { st: "range", areaSF: area, members, loCps: lo, hiCps: hi,
    loTotal: Math.round(area * lo), hiTotal: Math.round(area * hi),
    loRef: members.find((m) => m.costPerSF === lo).projectRef,
    hiRef: members.find((m) => m.costPerSF === hi).projectRef,
    note: "Range across " + members.length + " eligible comparable projects of the same type." };
}

export function buildRows(benchmark, range) {
  const rows = range.members.map((m) => Object.assign({}, m, {
    total: Math.round(range.areaSF * m.costPerSF),
    isAnchor: benchmark.present && m.projectRef === benchmark.projectRef,
    inRange: true,
  }));
  if (benchmark.present && !rows.some((r) => r.isAnchor)) {
    rows.unshift({ projectRef: benchmark.projectRef, projectName: benchmark.projectName,
      projectType: benchmark.projectType, refAreaSF: benchmark.refAreaSF, match: benchmark.match,
      costPerSF: benchmark.costPerSF, total: benchmark.total, isAnchor: true, inRange: false,
      isSample: benchmark.isSample });
  }
  return rows;
}

export function buildAssumptions(p, snapshot, benchmark, range, anySample) {
  const a = [];
  a.push("Quantities are approximate and provided by the sales conversation; they are not field measurements.");
  if (p.projectType === "new-deck") a.push("New deck: framing area assumed equal to decking area unless entered otherwise.");
  if (p.projectType === "resurface") a.push("Resurface: existing framing is retained and assumed structurally sound (0 SF new framing).");
  if (snapshot) {
    a.push("Material selection is recorded for scope only (" + snapshot.primary.officialName +
      (snapshot.primary.colorName ? " — " + snapshot.primary.colorName : "") + ").");
    a.push("Material pricing is pending approved price records; no draft or research price was used in any calculation.");
  } else {
    a.push("No material selection was confirmed for this estimate version.");
  }
  if (benchmark && benchmark.present) {
    a.push("The Selected Reference Benchmark applies " + benchmark.projectName +
      "'s historical cost per decking SF to the current decking area. It is historical context, not a price for this project.");
    if (!benchmark.eligibleForRange) {
      a.push(benchmark.projectName + " is excluded from the Comparable Project Range: " + benchmark.exclusionReasons.join("; ") + ".");
    }
  } else {
    a.push("No historical reference was selected, so no Selected Reference Benchmark is shown.");
  }
  if (range) {
    if (range.st === "none") a.push(range.note);
    if (range.st === "single") a.push("The comparable value is based on one eligible comparable project, so no range is shown.");
    if (range.st === "range") a.push("The Comparable Project Range reflects completed DCR projects of the same type, not a price for this project.");
  }
  if (anySample) a.push("One or more participating reference projects are SAMPLE data seeded with the app — replace them with real completed projects for production use.");
  a.push("This preliminary estimate requires review by a DCR estimator before it is shared with the client.");
  return a;
}

/* ══ materials ══ */
export function findProduct(catalog, id) {
  return ((catalog && catalog.products) || []).find((x) => x.materialId === id) || null;
}
export function lineName(pr) {
  const short = String(pr.officialName || "").replace(pr.brandName || "", "").trim();
  return short || pr.officialName || "";
}
export function isSelectable(pr) {
  return pr.selectable !== undefined ? pr.selectable !== false : pr.status === "active";
}

/** The selection as the estimate records it: the primary line with its colour and profile, and every other line
    the client is being shown (options; `alternative` = options[0], for readers written before options existed). */
export function buildSnapshot(sel, catalog) {
  if (!sel || !sel.primary) return null;
  const p = findProduct(catalog, sel.primary.materialId);
  if (!p) return null;
  const color = (p.colors || []).find((c) => c.colorId === sel.primary.colorId) || (p.colors || [])[0] || null;
  const profile = (p.profiles || []).find((x) => x.profileId === sel.primary.profileId) || (p.profiles || [])[0] || null;
  const options = (sel.options || []).map((o) => {
    const op = findProduct(catalog, o.materialId);
    if (!op) return null;
    const oc = (op.colors || []).find((c) => c.colorId === o.colorId) || (op.colors || [])[0] || null;
    const of = (op.profiles || []).find((x) => x.profileId === o.profileId) || (op.profiles || [])[0] || null;
    return { materialId: op.materialId, brandName: op.brandName, officialName: op.officialName,
      marketTier: op.marketTier, colorName: oc ? oc.name : "",
      nominalDimensions: of ? of.nominalDimensions : "" };
  }).filter(Boolean);
  return {
    primary: { materialId: p.materialId, brandName: p.brandName, officialName: p.officialName,
      marketTier: p.marketTier, colorId: color ? color.colorId : null, colorName: color ? color.name : "",
      profileId: profile ? profile.profileId : null,
      profileType: profile ? profile.profileType : "", nominalDimensions: profile ? profile.nominalDimensions : "" },
    alternative: options[0] || null,
    options,
    pricingStatus: "pending_admin_pricing",
  };
}

/** An estimate saved before comparisons existed has `alternative` and no `options`: promote it, so the rest of
    the code only ever sees one shape. Also fills the pricing and showRefs defaults. Mutates and returns `st`. */
export function normalizeSel(st) {
  st.sel = st.sel || { primary: null, alternative: null, options: [] };
  if (!st.sel.options) st.sel.options = [];
  if (!st.sel.options.length && st.sel.alternative) {
    st.sel.options = [{ materialId: st.sel.alternative.materialId, colorId: st.sel.alternative.colorId || null, profileId: null }];
  }
  st.pricing = st.pricing || blankPricing();
  if (!st.pricing.rates) st.pricing.rates = blankPricing().rates;
  if (!st.pricing.items) st.pricing.items = [];
  if (!st.showRefs) st.showRefs = [];
  return st;
}

/* ══ priced scope — the estimator's rates, never a guess ══
   Material pricing stays pending, but LABOUR and the work itself are things the estimator knows for this
   location, so they type them and the arithmetic is done here. A blank rate contributes nothing rather than a
   made-up number. */
export function workLines(project, pricing) {
  const p = project || {}, pc = pricing || blankPricing(), r = pc.rates || {}, out = [];
  function add(label, qty, unit, rate) {
    qty = num(qty); rate = num(rate);
    if (qty > 0 && rate > 0) out.push({ label, qty, unit, rate, total: qty * rate });
  }
  add("Framing", p.framingArea, "SF", r.framingSF);
  add("Decking", p.deckingArea, "SF", r.deckingSF);
  add("Railing", p.railing, "LF", r.railingLF);
  add("Stairs", p.stairs, "ea", r.stairsEach);
  add("Siding", pc.sidingArea, "SF", r.sidingSF);
  return out;
}

export function itemLines(pricing) {
  const pc = pricing || blankPricing();
  return (pc.items || []).map((it) => {
    if (it.kind === "labor") {
      const rate = num(it.rate) || num(pc.laborRate);
      const hours = num(it.guys) * num(it.days) * 8;
      return { kind: "labor", name: it.name || "Untitled task", hours, rate,
        detail: num(it.guys) + " × " + num(it.days) + "d (8h) = " + hours + " hrs @ " + money2(rate) + "/hr",
        total: hours * rate, ready: hours > 0 && rate > 0 };
    }
    const base = num(it.price), mk = num(it.markup);
    return { kind: "priced", name: it.name || "Untitled item", base, markup: mk,
      detail: money2(base) + (mk ? " + " + mk + "% markup" : " · no markup"),
      total: base * (1 + mk / 100), ready: base > 0 };
  });
}

export function pricingTotals(project, pricing) {
  const w = workLines(project, pricing), i = itemLines(pricing);
  const wt = w.reduce((a, l) => a + l.total, 0);
  const it = i.reduce((a, l) => a + (l.ready ? l.total : 0), 0);
  return { work: w, items: i, workTotal: wt, itemsTotal: it, total: wt + it,
    priced: w.length > 0 || i.some((l) => l.ready) };
}

/** Step 5: everything the preliminary estimate shows. `ctx` = {project, ranked, referenceId, sel, catalog,
    pricing, now}. The money parts (benchmark, range, sourceRows, pricing) are what map/sales.js splits off into
    the prices-only table. */
export function buildOutput(ctx) {
  const p = ctx.project || blankProject();
  const area = Number(p.deckingArea) || 0;
  const benchmark = buildBenchmark(area, p.projectType, ctx.ranked, ctx.referenceId);
  const range = buildRange(area, p.projectType, ctx.ranked);
  if (benchmark.present) benchmark.inRange = range.members.some((m) => m.projectRef === benchmark.projectRef);
  const rows = buildRows(benchmark, range);
  const anySample = rows.some((r) => r.isSample);
  const snapshot = buildSnapshot(ctx.sel, ctx.catalog);
  return {
    generatedAt: (ctx.now ? new Date(ctx.now) : new Date()).toISOString(),
    scope: Object.assign({}, p),
    selectionSnapshot: snapshot,
    benchmark,
    range,
    sourceRows: rows,
    anySample,
    pricing: pricingTotals(p, ctx.pricing),
    pricingInput: JSON.parse(JSON.stringify(ctx.pricing || blankPricing())),
    materialCost: { amount: null, status: "pending_admin_pricing",
      note: "Material pricing is deferred until approved price records exist — it is not estimated from research data." },
    assumptions: buildAssumptions(p, snapshot, benchmark, range, anySample),
  };
}

/* ══ step rules ══ */
/** null when step 1 has everything the estimate needs, else what is missing. */
export function step1Problem(p) {
  if (!p.clientName) return "Please enter the client name.";
  if (!p.address) return "Please enter the project address.";
  if (!p.projectType) return "Please select the project type.";
  if (!(Number(p.deckingArea) > 0)) return "Please enter a valid decking surface area.";
  if (!isFinite(Number(p.framingArea)) || Number(p.framingArea) < 0) return "Please enter a valid framing area.";
  if (!p.complexity) return "Please select the project complexity.";
  return null;
}
export function stepBlockReason(n, project, sel) {
  if (n <= 1) return null;
  const p1 = step1Problem(project);
  if (p1) return p1;
  if (n >= 4 && !(sel && sel.primary)) return "Pick a decking material on step 3 first.";
  return null;
}

/** Numbers measured on a CME drawing land in step 1: an empty field just fills; a field already typed gets an
    offer instead (the drawing is usually right, but the typed number occasionally came from the homeowner).
    -> {fill: [{key, val}], offers: [{key, val}]} for the fields deck / railing / stairs. */
export function drawingNumbersPlan(project, n) {
  const map = [
    { key: "deckingArea", val: n.deckSF, unit: "SF", what: "deck area" },
    { key: "railing", val: n.railLF, unit: "LF", what: "railing" },
    { key: "stairs", val: n.stairs, unit: "", what: "stairs" },
  ];
  const fill = [], offers = [];
  map.forEach((m) => {
    if (!(m.val > 0)) return;
    const cur = Number(project[m.key]) || 0;
    if (!cur) fill.push(m);
    else if (Math.abs(cur - m.val) > 0.5) offers.push(m);
  });
  return { fill, offers };
}
