// P5c sales: the data module (site/js/repo/sales.js) over the DEMO database (tools/fake/p5c-sales.js: M5c's sales tables,
// the Sales estimates switch, the price rows made with every comp and estimate, the gallery rule and the sales-media
// bucket). Per role: who reads (the switch), who sees amounts (the prices switch too), who writes (app.can_edit('sales'):
// an admin, or a manager with the switch), versioned writes and 409s, the bucket's names and its one replace-in-place,
// and P5 check 5 (no activity line, no outbox row). tools/schema-check-p5c-sales.mjs runs the same module on the REAL
// migration. Made-up people, comps and clients only.
import test from "node:test";
import assert from "node:assert/strict";

import { available, freshEngine, person, clientAs } from "./pages-engine.mjs";
import { useClient } from "../site/js/repo/_db.js";
import * as repo from "../site/js/repo/sales.js";
import * as M from "../site/js/map/sales.js";

const skip = !available;

/** the test client, with Storage uploads into the demo engine (as the browser stand-in does) */
function client(e, uid) {
  const c = clientAs(e, uid);
  const base = c.storage.from;
  c.storage = {
    from: (b) => Object.assign({}, base(b), {
      async upload(path, body, o) {
        try {
          e.storage.upload({ uid }, path, (body && body.size) || 1, (o && o.contentType) || "application/octet-stream", null, !!(o && o.upsert));
          return { data: { path }, error: null };
        } catch (x) { return { data: null, error: { message: x.message, statusCode: String(x.statusCode || x.status || 400) } }; }
      },
    }),
  };
  return c;
}
async function as(key, engine) {
  const e = engine || await freshEngine();
  const who = await person(key);
  const me = e.rows.profiles.find((p) => p.id === who.id);
  useClient(client(e, who.id));
  repo.forgetMedia();
  return { e, me: Object.assign({}, me, { name: me.full_name }), uid: who.id };
}
const code = async (fn) => { try { await fn(); return "ok"; } catch (x) { return x.code || String(x.status); } };
const blob = (type) => ({ type: type || "image/jpeg", size: 1234 });

test("who reads (Q10): the switch — the admin, the managers it was given to and the accountant; nobody else, the agents account included", { skip }, async () => {
  const engine = await freshEngine();
  const expect = { admin: true, manager_prices: true, sales: true, accountant: true, manager: false, lead: false, field: false, viewer: false, agents: false };
  for (const [key, sales] of Object.entries(expect)) {
    const { me } = await as(key, engine);
    assert.equal((await repo.salesAccess(me)).sales, sales, key + ": the switch");
    const refs = await repo.listRefs({ all: true }).catch(() => []);
    const ests = await repo.listEstimates().catch(() => []);
    const mats = await repo.listMaterials().catch(() => []);
    assert.equal(refs.length > 0 && ests.length > 0 && mats.length > 0, sales, key + ": the sales rows");
  }
});

test("amounts need the prices switch too: Sasha (a sales manager without prices) reads no price, benchmark or range", { skip }, async () => {
  const engine = await freshEngine();
  for (const [key, prices] of [["admin", true], ["manager_prices", true], ["accountant", true], ["sales", false]]) {
    await as(key, engine);
    const refs = await repo.listRefs({ all: true });
    const ests = await repo.listEstimates();
    const sent = ests.find((x) => x.estimateRef === "EST-DEMO1");
    const full = await repo.getEstimate(sent.id);
    assert.equal(refs.some((r) => r.referencePrice !== null), prices, key + ": the comps' prices");
    assert.equal(sent.benchmarkTotal !== null, prices, key + ": the benchmark");
    assert.equal(full.pricing !== null && full.output !== null, prices, key + ": the rates and the output");
    if (!prices) assert.ok(refs.every((r) => r.pricesHidden && r.costPerPrimaryUnit === null), key + ": hidden, not zero");
  }
});

test("writing is app.can_edit('sales'): the accountant (the switch, not a sales editor) is refused every write", { skip }, async () => {
  const { e } = await as("accountant");
  const est = e.rows.sales_estimates[0];
  assert.equal(await code(() => repo.saveEstimate(est.id, est.version, { notes: "x" }, null, null)), "42501");
  assert.equal(await code(() => repo.saveRef(null, null, M.refFields({ projectName: "Nope", pictures: [] }), null, null)), "42501");
  assert.equal(await code(() => repo.saveMaterial(null, null, M.materialFields({ itemKind: "product", itemName: "Nope", itemId: "nope", pictures: [] }, null))), "42501");
  assert.equal(await code(() => repo.deleteEstimate(est.id, est.version)), "42501");
  assert.equal(await code(() => repo.uploadMedia("estimates", "EST-X", blob(), "a.jpg")), "42501", "an upload");
});

test("a sales manager without prices: a comp saved, its price row (made with it) empty, his price write refused; his estimate save leaves the prices alone", { skip }, async () => {
  const { e } = await as("sales");
  const r = await repo.saveRef(null, null, M.refFields({ projectRef: "T-1", projectName: "Test Deck", primaryAreaSF: 300, pictures: [] }), null, null);
  const p = e.rows.sales_reference_prices.find((x) => x.reference_id === r.id);
  assert.deepEqual([p.reference_price, p.cost_per_primary_unit, p.version], [null, null, 1]);
  assert.equal(await code(() => repo.saveRef(r.id, r.version, { notes: "x" }, M.refPriceFields({ referencePrice: 30000, primaryAreaSF: 300 }), 1)), "42501");
  const est = e.rows.sales_estimates.find((x) => x.estimate_ref === "EST-DEMO1");
  const before = JSON.stringify(e.rows.sales_estimate_prices.find((x) => x.estimate_id === est.id));
  const s = await repo.saveEstimate(est.id, est.version, { status: "reviewed" }, null, null);
  assert.equal(s.version, est.version + 1);
  assert.equal(JSON.stringify(e.rows.sales_estimate_prices.find((x) => x.estimate_id === est.id)), before, "the prices untouched");
  assert.equal(await code(() => repo.saveEstimate(est.id, est.version, { status: "sent" }, null, null)), "PT409", "a stale version: 409");
});

test("a comp's cost per SF follows its decking area - also when a sales manager WITHOUT prices changes it (M5c's t21 recomputes, as the old page did on every save): every benchmark from it stays right", { skip }, async () => {
  const { e } = await as("admin");
  const r = await repo.saveRef(null, null, M.refFields({ projectRef: "T-2", projectName: "Probe Deck", primaryAreaSF: 410, pictures: [] }),
    M.refPriceFields({ referencePrice: 47800, primaryAreaSF: 410 }), null);
  const cps = () => Number(e.rows.sales_reference_prices.find((x) => x.reference_id === r.id).cost_per_primary_unit);
  assert.equal(Math.round(cps() * 100) / 100, 116.59);
  await as("sales", e);
  const cur = e.rows.sales_reference_projects.find((x) => x.id === r.id);
  await repo.saveRef(r.id, cur.version, { primary_area_sf: 205 }, null, null);
  assert.deepEqual([Number(e.rows.sales_reference_prices.find((x) => x.reference_id === r.id).reference_price), cps()], [47800, 233.17], "halved area, doubled $/SF");
  const again = e.rows.sales_reference_projects.find((x) => x.id === r.id);
  await repo.saveRef(r.id, again.version, { notes: "edited" }, null, null);
  assert.equal(cps(), 233.17, "another edit leaves it");
});

test("an editor with prices: a new estimate and its money (a versioned PATCH of the row M5c made with it); a stale price version is 409; a delete takes it along", { skip }, async () => {
  const { e } = await as("manager_prices");
  const st = { estimateRef: "EST-TEST1", estStatus: "draft", estVersion: 1, referenceId: "DEMO-DECK-101",
    project: { clientName: "Ivo Made-up", address: "1 Sandbox Rd", projectType: "new-deck", deckingArea: 400, framingArea: 400, complexity: "standard" },
    sel: { primary: null, alternative: null, options: [] }, showRefs: [], media: { photos: [], audioNotes: [] },
    output: { benchmark: { present: true, total: 46636 }, range: { st: "single", loTotal: 46636, hiTotal: 46636 }, sourceRows: [], pricing: null } };
  const refs = await repo.listRefs({ all: true });
  const s = await repo.saveEstimate(null, null, M.estimateFields(st, { refs, withSelection: true, isNew: true }), M.estimatePriceFields(st.output, { rates: { framingSF: "18" }, items: [] }), null);
  const row = e.rows.sales_estimates.find((x) => x.id === s.id);
  const p = e.rows.sales_estimate_prices.find((x) => x.estimate_id === s.id);
  assert.deepEqual([row.reference_project_id, row.status, p.benchmark_total, p.pricing.rates.framingSF, s.pricesVersion], [1, "draft", 46636, "18", 2]);
  assert.equal(await code(() => repo.saveEstimate(s.id, s.version, { notes: "x" }, { benchmark_total: 1 }, 1)), "PT409", "a stale price version");
  const cur = e.rows.sales_estimates.find((x) => x.id === s.id);
  await repo.deleteEstimate(s.id, cur.version);
  assert.ok(!e.rows.sales_estimates.some((x) => x.id === s.id) && !e.rows.sales_estimate_prices.some((x) => x.estimate_id === s.id), "both gone");
});

test("the gallery rule: a new 'cad' value is refused (23514); 'cme' is the drawing's key", { skip }, async () => {
  const { e } = await as("admin");
  const est = e.rows.sales_estimates.find((x) => x.estimate_ref === "EST-DEMO2");
  const cme = { photos: est.media.photos.concat([{ path: "estimates/EST-DEMO2/cme/cme-abcdef12.png", name: "d.png", cme: { version: 1, project: { id: "abcdef12" } } }]), audioNotes: [] };
  const s = await repo.saveEstimate(est.id, est.version, { media: cme }, null, null);
  const cad = { photos: cme.photos.concat([{ path: "estimates/x/y/z.png", name: "z.png", cad: { v: 1 } }]), audioNotes: [] };
  assert.equal(await code(() => repo.saveEstimate(est.id, s.version, { media: cad }, null, null)), "23514");
});

test("sales-media: M5c's names; an editor adds, a reader with the switch opens, nobody else; only a drawing's own name is replaced in place", { skip }, async () => {
  const { e } = await as("sales");
  const a = await repo.uploadMedia("estimates", "EST-TEST2", blob(), "Back yard.jpg");
  assert.match(a.path, /^estimates\/EST-TEST2\/[0-9a-f]{32}\/Back_yard\.jpg$/);
  const d1 = await repo.uploadMedia("estimates", "EST-TEST2", blob("image/png"), "cme-abcdef12-34.png", { stable: true });
  const d2 = await repo.uploadMedia("estimates", "EST-TEST2", blob("image/png"), "cme-abcdef12-34.png", { stable: true });
  assert.deepEqual([d1.path, d2.path], ["estimates/EST-TEST2/cme/cme-abcdef12-34.png", "estimates/EST-TEST2/cme/cme-abcdef12-34.png"]);
  const n1 = await repo.uploadMedia("estimates", "EST-TEST2", blob("text/plain"), "notes.txt", { stable: true });
  const n2 = await repo.uploadMedia("estimates", "EST-TEST2", blob("text/plain"), "notes.txt", { stable: true });
  assert.notEqual(n1.path, n2.path, "not a drawing: a fresh object, never over the first");
  assert.notEqual(await code(() => repo.uploadMedia("legacy", "x", blob(), "a.jpg")), "ok", "only the three folders");
  await as("accountant", e);
  assert.ok(await repo.mediaUrl(a.path), "the accountant (the switch) opens it");
  await as("lead", e);
  assert.equal(await repo.mediaUrl(a.path), null, "the lead does not");
});

test("P5 check 5: nothing the sales pages write adds an activity line or an outbox row", { skip }, async () => {
  const { e } = await as("admin");
  const a0 = e.rows.activity.length, o0 = (e.rows.notifications_outbox || []).length;
  const r = await repo.saveRef(null, null, M.refFields({ projectRef: "T-9", projectName: "Quiet Deck", primaryAreaSF: 200, pictures: [] }), M.refPriceFields({ referencePrice: 20000, primaryAreaSF: 200 }), null);
  const m = await repo.saveMaterial(null, null, M.materialFields({ itemKind: "product", itemName: "Quiet Line", itemId: "quiet-line", materialId: "quiet-line", pictures: [] }, null));
  await repo.deleteMaterial(m.id, m.version);
  await repo.deleteRef(r.id, r.version);
  assert.deepEqual([e.rows.activity.length, (e.rows.notifications_outbox || []).length], [a0, o0]);
});
