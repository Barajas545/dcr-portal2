// P5c sales: what the four sales pages and the drawing tool must be, read from the files (BLUEPRINT 2.2.1 the security
// policy and no inline script, Appendix C Portal 2's own browser names, 3.3.11 CME output under "cme"): estimates.html,
// estimate-deck.html, materials-library.html, cme.html and the CME tree copied from the old portal (site/cme).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = fileURLToPath(new URL("../site/", import.meta.url));
const read = (p) => readFileSync(join(SITE, p), "utf8");
function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) out.push(...walk(p)); else out.push(p); }
  return out;
}
const rel = (p) => relative(SITE, p).replace(/\\/g, "/");

const PAGES = { "estimates.html": "js/pages/sales-estimates.js", "estimate-deck.html": "js/pages/estimate-deck.js",
  "materials-library.html": "js/pages/materials-library.js" };

test("the three sales pages: config.js, the pinned supabase-js, then their one module; the top bar; their own stylesheet", () => {
  for (const [page, mod] of Object.entries(PAGES)) {
    const h = read(page);
    const scripts = [...h.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, ["js/config.js", "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js", mod], page);
    assert.match(h, /<script type="module" src="[^"]+"><\/script>/, page + ": a module");
    assert.match(h, /id="dcr2Topbar"/, page + ": the Portal 2 top bar");
    assert.ok(existsSync(join(SITE, mod)), mod);
    for (const css of [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1])) assert.ok(existsSync(join(SITE, css)), css);
  }
});

test("cme.html: no inline script (the old page's error listener is cme/boot-guard.js), then CME's boot module; its own dark stylesheet only", () => {
  const h = read("cme.html");
  const scripts = [...h.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1].trim());
  assert.deepEqual(scripts, ['src="js/config.js"', 'defer src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js" crossorigin="anonymous"',
    'src="cme/boot-guard.js"', 'type="module" src="cme/boot.js"']);
  assert.ok(!/css\/styles\.css/.test(h), "the portal's stylesheet would fight CME's over :root");
  assert.match(h, /href="cme\/src\/ui\/styles\.css"/);
});

test("the CME tree: the engine's source and stylesheet only (no tests, no docs, no standalone page); every relative import resolves", () => {
  const files = walk(join(SITE, "cme")).map(rel);
  for (const f of files) assert.match(f, /^cme\/(boot\.js|boot-guard\.js|portal-bridge\.js|src\/.+\.(js|css))$/, f);
  assert.ok(files.includes("cme/src/ui/app.js") && files.includes("cme/src/tools/takeoff/takeoff.js"));
  const seen = new Set();
  function graph(f) {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(join(SITE, f), "utf8");
    for (const m of src.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?:[^'"]*?from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      const spec = m[1] || m[2];
      if (!spec.startsWith(".")) continue;
      const target = rel(resolve(dirname(join(SITE, f)), spec));
      assert.ok(existsSync(join(SITE, target)), f + " imports " + spec + " (missing)");
      graph(target);
    }
  }
  graph("cme/boot.js");
  assert.ok(seen.has("cme/src/ui/app.js") && seen.has("cme/portal-bridge.js") && seen.has("js/repo/sales.js"), "boot loads the app, the bridge and the switch check");
});

test("Appendix C: the drawing library, the hand-over and the wizard's draft are Portal 2's own names, per person", () => {
  const boot = read("cme/boot.js"), launcher = read("js/sales/cme-launcher.js"), deck = read("js/pages/estimate-deck.js");
  assert.match(boot, /export const HANDOFF_PREFIX = "dcr2:cmeHandoff:";/);
  assert.match(launcher, /export const HANDOFF_PREFIX = "dcr2:cmeHandoff:";/);
  // the client's name (personal data) never in the drawing frame's URL: handed over in sessionStorage like the drawing
  assert.ok(!/params\.set\(\s*["']clientName["']/.test(launcher), "the launcher puts no client name in the URL");
  assert.ok(!/qs\.get\(\s*["']clientName["']/.test(boot), "the drawing page reads no client name from its URL");
  assert.match(launcher, /params\.set\("cmeContext", key\)/);
  assert.match(boot, /qs\.get\("cmeContext"\)/);
  assert.match(boot, /window\.CME_STORAGE_SCOPE = "dcr2-" \+ profile\.id \+ "-" \+ \(estimateId \? "estimate-" \+ estimateId : "standalone"\);/);
  assert.match(boot, /salesHubOrigins: \[\]/, "no other site receives a sketch");
  assert.match(deck, /"dcr2:deckEstDraft:" \+/);
  for (const f of ["cme/boot.js", "js/sales/cme-launcher.js", "js/pages/estimate-deck.js", "js/pages/sales-estimates.js", "js/pages/materials-library.js",
    "js/sales/gallery.js", "js/sales/photo-annotate.js", "js/repo/sales.js", "cme/portal-bridge.js"]) {
    const src = read(f);
    assert.ok(!/dcrDeckEstDraft|["']cmeHandoff:|\/api\/portal|DCR\.api|DCR\.blobUrl|DCRCad|cad-sketch|barajas545/.test(src), f + ": an old portal name");
  }
});

test("the drawing launcher takes a save only from its own frame on this site, and writes CME output under 'cme', never 'cad'", () => {
  const src = read("js/sales/cme-launcher.js");
  assert.match(src, /if \(event\.origin !== location\.origin\) return;/);
  assert.match(src, /event\.source !== frame\.contentWindow/);
  assert.match(src, /if \("cad" in patch\) throw new Error\("refusing to overwrite a legacy drawing"\);/);
  const bridge = read("cme/portal-bridge.js");
  assert.match(bridge, /target\.postMessage\(\{ type: 'dcr\.cme\.save', payload \}, location\.origin\);/, "the bridge posts to this site only");
  assert.match(read("cme/boot.js"), /framedByAnotherSite\(\)/, "a frame from another site is refused");
});

test("cme/boot.js hooks the bridge BEFORE it imports the app: a quick tap on 'Save to Step 1' never runs app.js's own download", () => {
  const boot = read("cme/boot.js");
  const bridge = boot.indexOf('await import("./portal-bridge.js");');
  const install = boot.indexOf("window.CME_BRIDGE.install(");
  const app = boot.indexOf('await import("./src/ui/app.js");');
  assert.ok(bridge > 0 && install > bridge && app > install, JSON.stringify({ bridge, install, app }));
  assert.match(boot, /window\.CME_BRIDGE\.install\(\(\) => window\.CME_CURRENT_DOCUMENT\(\)\);/, "the document is read at the tap, not at install");
});

test("the shipped materials catalog (the wizard's fallback) carries no amount", () => {
  const raw = read("deck-materials.json");
  const j = JSON.parse(raw);
  assert.ok(Array.isArray(j.products) && j.products.length > 0);
  assert.ok(!/\$\s?\d/.test(raw), "no dollar amount");
  for (const p of j.products) assert.ok(!Object.keys(p).some((k) => /^(price|cost)$/i.test(k)), p.materialId);
});

test("every money column the hub and the wizard show is gated on the prices switch in the page (the database already hides them)", () => {
  const hub = read("js/pages/sales-estimates.js"), deck = read("js/pages/estimate-deck.js");
  assert.match(hub, /\(P \? "<th class='num'>Benchmark<\/th><th class='num'>Range<\/th>" : ""\)/);
  assert.match(hub, /\(P \? "<th class='num'>Price<\/th><th class='num'>\$\/SF<\/th>" : ""\)/);
  assert.match(deck, /const prices = state\.prices && o\.full && state\.output \? estimatePriceFields\(state\.output, state\.pricing\) : null;/,
    "only someone with prices sends the money row");
  assert.match(deck, /if \(P\) wireRateEditor\(\);/);
});
