// P5c sales: the pure parts — the deck estimate's arithmetic (site/js/sales/deck-engine.js, the old wizard's matcher and
// estimate engine), the row mappers and the money split (site/js/map/sales.js), the gallery's entries
// (site/js/sales/gallery.js) and the drawing launcher's rules (site/js/sales/cme-launcher.js). Made-up comps and clients.
import test from "node:test";
import assert from "node:assert/strict";

import * as E from "../site/js/sales/deck-engine.js";
import * as M from "../site/js/map/sales.js";
import { parse, safeUrl, showable } from "../site/js/sales/gallery.js";
import { drawingPatch, drawingName, HANDOFF_PREFIX } from "../site/js/sales/cme-launcher.js";

const comp = (o) => Object.assign({ projectRef: "R", projectName: "Comp", refStatus: "completed", activeAsReference: true, projectType: "new-deck",
  complexity: "standard", primaryAreaSF: 400, secondaryAreaSF: 400, railingLF: 50, stairs: 1, costPerPrimaryUnit: 100, isSample: false }, o);
const scope = (o) => Object.assign(E.blankProject(), { clientName: "Ivo Made-up", address: "1 Sandbox Rd", projectType: "new-deck",
  deckingArea: 400, framingArea: 400, railing: 50, stairs: 1, complexity: "standard" }, o);

test("the matcher (old ProjectMatcher): type 20 + decking 25 + framing 20 + railing 10 + stairs 10 + complexity 15 (5 when it differs)", () => {
  assert.equal(E.matchScore(scope(), comp()), 100);
  assert.equal(E.simScore(0, 0, 25), 25, "both zero is a match");
  assert.equal(E.simScore(200, 400, 20), 10);
  const other = E.matchScore(scope(), comp({ projectType: "resurface", complexity: "complex", primaryAreaSF: 200, secondaryAreaSF: 0, railingLF: 0, stairs: 0 }));
  assert.equal(other, Math.round(0 + 12.5 + 0 + 0 + 0 + 5));
  const ranked = E.rankRefs(scope(), [comp({ projectRef: "B", primaryAreaSF: 300 }), comp({ projectRef: "A" }), comp({ projectRef: "X", activeAsReference: false })]);
  assert.deepEqual(ranked.map((r) => r.projectRef), ["A", "B"], "best first; a comp not active as a reference is left out");
});

test("eligibility, the benchmark, the comparable range and the rows (old EstimateEngine)", () => {
  const ranked = E.rankRefs(scope(), [comp({ projectRef: "A", costPerPrimaryUnit: 110 }), comp({ projectRef: "B", costPerPrimaryUnit: 95, primaryAreaSF: 380 }),
    comp({ projectRef: "C", costPerPrimaryUnit: 120, primaryAreaSF: 420 }), comp({ projectRef: "D", costPerPrimaryUnit: 300, projectType: "resurface" }),
    comp({ projectRef: "S", costPerPrimaryUnit: 105, refStatus: "estimating" })]);
  const b = E.buildBenchmark(400, "new-deck", ranked, "A");
  assert.deepEqual([b.present, b.costPerSF, b.total, b.eligibleForRange], [true, 110, 44000, true]);
  const r = E.buildRange(400, "new-deck", ranked);
  assert.deepEqual([r.st, r.members.length, r.loTotal, r.hiTotal, r.loRef, r.hiRef], ["range", 3, 38000, 48000, "B", "C"]);
  const rows = E.buildRows(b, r);
  assert.equal(rows.filter((x) => x.isAnchor).length, 1);
  const outside = E.buildBenchmark(400, "new-deck", ranked, "D");
  assert.equal(outside.eligibleForRange, false);
  assert.match(outside.exclusionReasons.join(";"), /project type resurface does not match new-deck/);
  assert.equal(E.buildRows(outside, r)[0].inRange, false, "the reference outside the range rides first");
  assert.equal(E.buildRange(400, "deck-expansion", ranked).st, "none");
  assert.equal(E.buildRange(400, "new-deck", [ranked[0]]).st, "single");
  assert.equal(E.buildBenchmark(400, "new-deck", ranked, null).present, false);
  assert.match(E.buildBenchmark(400, "new-deck", ranked, "ZZ").note, /could not be resolved/);
});

test("without the prices switch a comp has no cost per SF: it is never eligible, the benchmark has no total — nothing is invented", () => {
  const ranked = E.rankRefs(scope(), [comp({ projectRef: "A", costPerPrimaryUnit: null }), comp({ projectRef: "B", costPerPrimaryUnit: null })]);
  assert.match(E.eligibility(ranked[0], "new-deck").reasons.join(";"), /no usable historical cost per SF/);
  const b = E.buildBenchmark(400, "new-deck", ranked, "A");
  assert.deepEqual([b.costPerSF, b.total], [null, null]);
  assert.equal(E.buildRange(400, "new-deck", ranked).st, "none");
});

test("the estimator's rates: work lines, crew tasks (guys x days x 8 h x the rate, or the location's rate), priced items with a markup", () => {
  const pricing = { rates: { framingSF: "18", deckingSF: "", railingLF: "65", stairsEach: "0", sidingSF: "4" }, sidingArea: "100", laborRate: "75",
    items: [{ kind: "labor", name: "Demo", guys: "2", days: "1", rate: "" }, { kind: "labor", name: "Haul", guys: "1", days: "0.5", rate: "60" },
      { kind: "priced", name: "Permit", price: "850", markup: 10 }, { kind: "priced", name: "Blank", price: "", markup: 15 }] };
  const t = E.pricingTotals(scope(), pricing);
  assert.deepEqual(t.work.map((l) => [l.label, l.total]), [["Framing", 7200], ["Railing", 3250], ["Siding", 400]]);
  assert.deepEqual(t.items.map((l) => [l.name, Math.round(l.total * 100) / 100, l.ready]), [["Demo", 1200, true], ["Haul", 240, true], ["Permit", 935, true], ["Blank", 0, false]]);
  assert.equal(Math.round(t.total * 100) / 100, 7200 + 3250 + 400 + 1200 + 240 + 935);
  assert.equal(E.pricingTotals(scope(), E.blankPricing()).priced, false, "blank rates: nothing priced");
});

test("buildOutput: the scope, the snapshot, the assumptions (no amount in any of them) and the money parts", () => {
  const cat = { products: [{ materialId: "m1", brandName: "Made-up", officialName: "Made-up Ridge", marketTier: "Mid", status: "active",
    colors: [{ colorId: "c1", name: "Slate" }, { colorId: "c2", name: "Sand" }], profiles: [{ profileId: "p1", profileType: "square_edge", nominalDimensions: "1 x 5.5" }] },
    { materialId: "m2", brandName: "Made-up", officialName: "Made-up Coast", colors: [{ colorId: "c3", name: "Mist" }], profiles: [] }] };
  const sel = { primary: { materialId: "m1", colorId: "c2", profileId: null }, alternative: null, options: [{ materialId: "m2", colorId: "c3", profileId: null }] };
  const ranked = E.rankRefs(scope(), [comp({ projectRef: "A", costPerPrimaryUnit: 110, isSample: true })]);
  const o = E.buildOutput({ project: scope(), ranked, referenceId: "A", sel, catalog: cat, pricing: E.blankPricing(), now: Date.UTC(2026, 9, 21) });
  assert.equal(o.selectionSnapshot.primary.colorName, "Sand");
  assert.equal(o.selectionSnapshot.alternative.officialName, "Made-up Coast");
  assert.equal(o.benchmark.total, 44000);
  assert.equal(o.anySample, true);
  assert.ok(o.assumptions.some((a) => /SAMPLE data/.test(a)));
  for (const a of o.assumptions) assert.ok(!/\$\s?\d/.test(a), "no amount in an assumption: " + a);
  assert.equal(o.generatedAt, "2026-10-21T00:00:00.000Z");
});

test("step rules, the old 'alternative' promoted to options, the drawing's numbers (fill an empty field, offer for a typed one)", () => {
  assert.match(E.step1Problem(scope({ clientName: "" })), /client name/);
  assert.match(E.step1Problem(scope({ deckingArea: 0 })), /decking surface area/);
  assert.equal(E.step1Problem(scope()), null);
  assert.match(E.stepBlockReason(4, scope(), { primary: null }), /decking material/);
  assert.equal(E.stepBlockReason(3, scope(), { primary: null }), null);
  const st = E.normalizeSel({ sel: { primary: { materialId: "a" }, alternative: { materialId: "b", colorId: "x" } } });
  assert.deepEqual(st.sel.options, [{ materialId: "b", colorId: "x", profileId: null }]);
  assert.deepEqual(st.pricing, E.blankPricing());
  const plan = E.drawingNumbersPlan({ deckingArea: 0, railing: 40, stairs: 2 }, { deckSF: 512, railLF: 44.5, stairs: 2 });
  assert.deepEqual(plan.fill.map((m) => [m.key, m.val]), [["deckingArea", 512]]);
  assert.deepEqual(plan.offers.map((m) => [m.key, m.val]), [["railing", 44.5]]);
});

test("map: a comp — its price only from the prices-only row (null without the switches); the editor's row never carries money", () => {
  const row = { id: 7, version: 3, project_ref: "R-1", project_name: "Comp", primary_area_sf: "400.00", pictures: [{ path: "references/a/b/c.jpg", name: "c" }],
    labor: {}, scope: {}, active_as_reference: true, is_sample: false, prices: { reference_price: "47000.00", cost_per_primary_unit: "117.50", version: 2 } };
  const r = M.toRef(row);
  assert.deepEqual([r.referencePrice, r.costPerPrimaryUnit, r.pricesVersion, r.primaryAreaSF, r.pricesHidden], [47000, 117.5, 2, 400, false]);
  const hidden = M.toRef(Object.assign({}, row, { prices: null }));
  assert.deepEqual([hidden.referencePrice, hidden.costPerPrimaryUnit, hidden.pricesHidden], [null, null, true]);
  const f = M.refFields({ projectRef: "R-1", projectName: " Comp ", referencePrice: 1, primaryAreaSF: 400, pictures: [] }, null);
  assert.ok(!("reference_price" in f) && !("cost_per_primary_unit" in f) && !("notes" in f), "no money, notes only when sent");
  assert.deepEqual([f.trade, f.ref_status, f.state_code, f.project_name], ["deck", "completed", "CA", "Comp"]);
  assert.deepEqual(M.refPriceFields({ referencePrice: 47000, primaryAreaSF: 400 }), { reference_price: 47000, cost_per_primary_unit: 117.5 });
  assert.equal(M.costPerSf(0, 400), null);
});

test("map: a saved estimate — the money only in the prices row; the wizard's state saved without it", () => {
  const st = { estimateRef: "EST-ABC", estStatus: "preliminary", estVersion: 4, referenceId: "R-1",
    project: Object.assign(scope({ clientName: "Ivo Made-up", notes: "said $9,500" }), { drawingNumbers: { deckSF: 400 } }),
    sel: { primary: { materialId: "m1" }, alternative: null, options: [] }, showRefs: ["R-2"],
    media: { photos: [{ path: "estimates/EST-ABC/u/a.jpg", name: "a.jpg", ann: { items: [1] } }],
      audioNotes: [{ audioPath: "estimates/EST-ABC/u/n.webm", txtPath: null, name: "n.webm", when: "2026-10-21T17:00:00Z", transcript: "keep the joists", pending: true }] },
    pricing: { rates: { framingSF: "18" }, items: [] },
    output: { selectionSnapshot: { primary: { officialName: "X" } }, benchmark: { present: true, total: 44000 }, range: { st: "range", loTotal: 40000, hiTotal: 48000 },
      sourceRows: [{ total: 44000 }], pricing: { total: 7200 }, anySample: false } };
  const f = M.estimateFields(st, { refs: [{ id: 11, projectRef: "R-1" }], withSelection: true });
  assert.equal(f.reference_project_id, 11);
  assert.equal(f.revision, 4);
  assert.equal(f.status, "preliminary");
  assert.ok(!/rates|benchmark|loTotal|hiTotal|sourceRows|"total"/.test(JSON.stringify(f)), "no money in the estimate row: " + JSON.stringify(f).slice(0, 200));
  assert.deepEqual(f.media.audioNotes[0], { audioPath: "estimates/EST-ABC/u/n.webm", txtPath: null, name: "n.webm", when: "2026-10-21T17:00:00Z", transcript: "keep the joists" }, "no in-memory flags");
  assert.equal(f.scope.drawingNumbers.deckSF, 400);
  const auto = M.estimateFields(Object.assign({}, st, { referenceId: null }), { refs: [], isNew: false });
  assert.ok(!("status" in auto), "an auto-save never changes the status");
  assert.equal(auto.reference_project_id, null, "no reference: cleared");
  const p = M.estimatePriceFields(st.output, st.pricing);
  assert.deepEqual([p.benchmark_total, p.range_low_total, p.range_high_total, p.pricing.rates.framingSF, p.output.benchmark.total], [44000, 40000, 48000, "18", 44000]);
  assert.deepEqual(M.estimatePriceFields({ benchmark: { present: false }, range: { st: "none" } }, null).pricing, {}, "pricing is NOT NULL: {}");
  const lite = M.toEstimateLite({ id: 1, version: 2, estimate_ref: "EST-1", status: "sent", revision: 3, client_name: "Ivo", prices: null });
  assert.deepEqual([lite.benchmarkTotal, lite.rangeLowTotal, lite.pricesHidden, lite.estVersion], [null, null, true, 3]);
  const full = M.toEstimate({ id: 1, version: 2, estimate_ref: "EST-1", reference_project_id: 11, selection: { sel: null }, media: { photos: [] }, scope: {},
    prices: [{ benchmark_total: "44000", pricing: { rates: {} }, output: {}, version: 5 }] }, { 11: { project_ref: "R-1" } });
  assert.deepEqual([full.referenceRef, full.benchmarkTotal, full.pricesVersion], ["R-1", 44000, 5]);
  assert.match(M.newEstimateRef(Date.UTC(2026, 9, 21), 35), /^EST-[0-9A-Z]{8,}$/);
});

test("map: the Materials Library — item_key set once; a catalog for the wizard (retired left out, colors under their line, the library's order)", () => {
  const add = M.materialFields({ itemKind: "product", itemName: "Made-up Ridge", itemId: "made-up-ridge", materialId: "made-up-ridge", marketTier: "Mid", pictures: [] }, null);
  assert.equal(add.item_key, "made-up-ridge");
  const edit = M.materialFields({ itemKind: "color", itemName: "Slate", itemId: "x", materialId: "made-up-ridge", pictures: [] }, { id: 1 });
  assert.ok(!("item_key" in edit) && !("market_tier" in edit), "an edit never sends item_key; a color has no tier");
  assert.equal(M.slugId("Ébène Ridge #2"), "ebene-ridge-2");
  const rows = [
    { id: 1, item_key: "b", item_kind: "product", material_key: "b", item_name: "B line", item_status: "active", sort_order: 20, board_profiles: [{ profileId: "p" }], details: {} },
    { id: 2, item_key: "a", item_kind: "product", material_key: "a", item_name: "A line", item_status: "active", sort_order: 10, selectable: false, details: {} },
    { id: 3, item_key: "z", item_kind: "product", material_key: "z", item_name: "Old", item_status: "retired", sort_order: 5, details: {} },
    { id: 4, item_key: "b-slate", item_kind: "color", material_key: "b", item_name: "Slate", item_status: "active", sort_order: 21, pictures: [{ path: "materials/x/y/s.jpg" }] },
    { id: 5, item_key: "b-old", item_kind: "color", material_key: "b", item_name: "Gone", item_status: "retired", sort_order: 22 },
  ];
  const cat = M.catalogFromRows(rows);
  assert.deepEqual(cat.products.map((p) => [p.materialId, p.selectable, p.colors.map((c) => c.colorId)]), [["a", false, []], ["b", true, ["b-slate"]]]);
  assert.deepEqual(cat.products[1].profiles, [{ profileId: "p" }]);
});

test("map: the switches — the Sales estimates switch reads (an admin always), app.can_edit('sales') writes (an admin, or a manager with it); amounts need prices too", () => {
  assert.equal(M.salesSwitch({ role: "admin", can_sales_estimates: false }), true);
  assert.equal(M.salesSwitch({ role: "lead", can_sales_estimates: true }), true);
  assert.equal(M.salesSwitch({ role: "manager", can_sales_estimates: false }), false);
  const yes = { sales: true }, no = { sales: false };
  assert.equal(M.salesEditor({ role: "manager" }, yes), true);
  assert.equal(M.salesEditor({ role: "accountant" }, yes), false, "an accountant with the switch reads only");
  assert.equal(M.salesEditor({ role: "manager" }, no), false);
  assert.equal(M.seesSalesPrices({ role: "manager", can_see_prices: false }, yes), false);
  assert.equal(M.seesSalesPrices({ role: "accountant", can_see_prices: true }, yes), true);
  assert.equal(M.seesSalesPrices({ role: "accountant", can_see_prices: true }, no), false, "prices without the switch: still nothing");
  assert.equal(M.masked("said $9,500 ok"), "said (amount hidden) ok");
  assert.equal(M.hasAmount("keep the joists"), false);
});

test("sales-media names follow M5c's path rule (estimates|references|materials, 2 to 7 folders); a drawing's own name is the only stable one", () => {
  const RULE = /^(materials|references|estimates)\/[^/]+(\/[^/]+){1,6}$/;
  const DRAW = /\/cme-[0-9a-z-]{8,64}\.(png|jpe?g)$/i;
  const a = M.mediaKey("estimates", "EST-AB12", "Back yard (1).jpg", "0123456789abcdef0123456789abcdef");
  assert.equal(a, "estimates/EST-AB12/0123456789abcdef0123456789abcdef/Back_yard_1_.jpg");
  assert.match(a, RULE);
  const d = M.mediaKey("estimates", "EST-AB12", "cme-3f2a9c1e-77b0.png", null, "cme");
  assert.equal(d, "estimates/EST-AB12/cme/cme-3f2a9c1e-77b0.png");
  assert.match(d, RULE); assert.match(d, DRAW);
  assert.match(M.mediaKey("references", "", "x.png", "u"), /^references\/new\/u\/x\.png$/);
  assert.throws(() => M.mediaKey("legacy", "k", "x.png", "u"), /unknown media kind/);
  assert.equal(M.keyName("../../etc/passwd"), "etc_passwd");
  assert.equal(M.keyName("Ölgemälde été.png"), "Olgemalde_ete.png");
});

test("the gallery's entries: stored objects shown by signed URL; an old link kept as a link (the security policy shows no other site's picture)", () => {
  assert.deepEqual(parse({ pictures: [{ path: "materials/a/b/c.jpg", name: "c" }, null, "x"] }), [{ path: "materials/a/b/c.jpg", name: "c" }]);
  assert.deepEqual(parse({ picturesJson: '[{"url":"https://example.com/p.jpg"}]' }), [{ url: "https://example.com/p.jpg" }]);
  assert.deepEqual(parse({ pictures: [], pictureUrl: "https://example.com/q.jpg" }), [{ url: "https://example.com/q.jpg", name: "photo" }]);
  assert.deepEqual(parse({ pictures: [], pictureUrl: "javascript:alert(1)" }), []);
  assert.deepEqual(parse(null), []);
  assert.equal(showable({ path: "x/y/z" }), true);
  assert.equal(showable({ url: "https://example.com/p.jpg" }), false);
  assert.equal(safeUrl(" https://example.com "), "https://example.com");
  assert.equal(safeUrl("http://example.com"), "");
});

test("the drawing launcher: CME output under 'cme', never 'cad'; one drawing owns one file name; the hand-over key is Portal 2's", () => {
  const p = drawingPatch({ path: "estimates/EST-1/cme/cme-3f2a9c1e.png", name: "cme-3f2a9c1e.png", mime: "image/png" },
    { project: { id: "3f2a9c1e" }, numbers: { deckSF: 400 }, takeoff: [], breakdown: {} }, "2026-10-21T17:00:00.000Z");
  assert.ok(!("cad" in p));
  assert.deepEqual([p.cme.version, p.cme.project.id, p.cme.numbers.deckSF, p.cme.savedAt], [1, "3f2a9c1e", 400, "2026-10-21T17:00:00.000Z"]);
  assert.deepEqual(drawingName("3f2a9c1e-77b0"), { name: "cme-3f2a9c1e-77b0.png", stable: true });
  const odd = drawingName("bad id!");
  assert.equal(odd.stable, false);
  assert.match(odd.name, /^drawing-\d+\.png$/);
  assert.equal(HANDOFF_PREFIX, "dcr2:cmeHandoff:");
});
