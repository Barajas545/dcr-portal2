/* Deck Estimate — the trade wizard (port of the old estimate-deck.html / estimate-deck.js; BLUEPRINT 3.3.11
   "Sales estimates and materials library").

   Flow: 1 Project info -> 2 Similar projects (scored comps, pick a reference) -> 3 Materials -> 4 Review (the
   estimator's own rates) -> 5 Preliminary estimate (save / print). The arithmetic is js/sales/deck-engine.js (the
   old matcher and estimate engine, verbatim); the database is reached only through repo/sales.js.

   Who (Q10): the Sales estimates switch reads; app.can_edit('sales') (an admin, or a manager with the switch) writes —
   anyone else with the switch opens an estimate read only (nothing is saved, no upload, no drawing). The amounts also
   need the prices switch. Without prices the wizard still
   does the client conversation — the scope, photos, drawings and voice notes, the similar projects (by match,
   without their price), the materials — and saves it; the money steps (the estimator's rates, the benchmark, the
   comparable range, the priced scope) are not shown, and a save from such a person never touches the estimate's
   prices (sales_estimate_prices: the database refuses it anyway, and the page does not send it), so nothing a
   priced estimator worked out is lost.

   What changed from the old page:
   * saved to sales_estimates (+ sales_estimate_prices, prices only) with the version read: a save that meets
     someone else's newer save is refused (409) and says so instead of writing over it; one write at a time;
   * photos, drawings and voice notes (with their transcripts) go into the private sales-media bucket under the
     estimate's own folder and are opened with signed URLs (js/sales/gallery.js);
   * the drawing tool is CME in an overlay (js/sales/cme-launcher.js); its drawing is kept under the gallery
     entry's `cme` key, never `cad` (an old portal drawing is kept as it is and opened in the old portal);
   * the draft on this device is per account (dcr2:deckEstDraft:<profile>, Appendix C);
   * notes and transcripts that quote an amount are masked without the prices switch (display only) and are then
     read only here, so a masked copy is never saved over the words. */

import { boot, el, esc, toast, confirmBox, errorText, D, store } from "./shell.js";
import * as repo from "../repo/sales.js";
import * as gallery from "../sales/gallery.js";
import * as annotate from "../sales/photo-annotate.js";
import * as cme from "../sales/cme-launcher.js";
import {
  PROJECT_TYPES, COMPLEXITY, TERRAIN, ACCESS, EST_STATUSES, MARKUPS, num, money, money2, matchClass,
  blankProject, blankPricing, rankRefs, buildOutput, buildSnapshot, findProduct, lineName, isSelectable,
  normalizeSel, pricingTotals, step1Problem, stepBlockReason, drawingNumbersPlan,
} from "../sales/deck-engine.js";
import { seesSalesPrices, salesEditor, masked, hasAmount, estimateFields, estimatePriceFields, catalogFromRows, newEstimateRef, MEDIA_LIMIT } from "../map/sales.js";

const qs = new URLSearchParams(location.search);
const EDIT_ID = qs.get("id") || null;      // reopen a saved estimate
const START_NEW = qs.get("new") === "1";   // begin a blank estimate

const state = {
  me: null, access: null, prices: false, edit: false,
  step: 1,
  estimateId: null,          // the database row (sales_estimates.id) once saved
  rowVersion: null,          // its version: every write carries it (BLUEPRINT 2.1 principle 7)
  pricesVersion: null,       // its money row's (sales_estimate_prices), for someone with the prices switch
  estimateRef: "",           // EST-xxxx: minted once, saved with the row; the drawings' and media's folder
  estVersion: 0,             // the estimate's own revision number (v1, v2 …)
  estStatus: "draft",
  createdBy: null,
  project: blankProject(),
  refs: null,                // loaded comps
  ranked: null,
  referenceId: null,         // projectRef of the chosen comp — anchors the benchmark
  showRefs: [],              // extra comps the estimator wants the client to see
  catalog: null,             // materials
  // primary drives colour/profile and the snapshot; options are the other lines the client is being shown side by
  // side. alternative is kept in sync with options[0] so estimates saved before this existed still read back.
  sel: { primary: null, alternative: null, options: [] },
  /* The estimator's own rates for THIS job. Nothing here is invented: a blank rate simply contributes nothing,
     which is why the totals can be trusted. Kept only for someone with the prices switch. */
  pricing: blankPricing(),
  output: null,
  media: { photos: [], audioNotes: [] }, // photos = gallery entries (+.ann markup, +.cme drawing); audio = {audioPath, txtPath, name, when, transcript}
  conflict: false,           // someone else saved this estimate meanwhile: nothing more is saved from here
  _gal: null,                // mounted gallery handle (step 1 only)
  _rec: null,                // in-progress audio recording state
};

function draftKey() { return "dcr2:deckEstDraft:" + (state.me ? state.me.id : "nobody"); }
function shown(t) { return state.prices ? String(t || "") : masked(t); }
function moneyLocked(t) { return !state.prices && hasAmount(t); }

/* ══ materials ══ */
function products() { return (state.catalog && state.catalog.products) || []; }
function prod(id) { return findProduct(state.catalog, id); }
function optIndex(id) { return (state.sel.options || []).findIndex((o) => o.materialId === id); }
function selFor(id) {
  if (state.sel.primary && state.sel.primary.materialId === id) return state.sel.primary;
  const i = optIndex(id);
  return i >= 0 ? state.sel.options[i] : null;
}
/* Estimates written before comparisons existed read `alternative`, and so do the print view and the snapshot. Keep
   it pointing at the first comparison so nothing downstream has to know about the change. */
function syncAlternative() {
  const first = (state.sel.options || [])[0];
  state.sel.alternative = first ? { materialId: first.materialId, colorId: first.colorId } : null;
  saveDraftLocal();
}

/* ══ helpers ══ */
function syncPhotos() { if (state._gal) state.media.photos = state._gal.get(); }
function saveDraftLocal() {
  syncPhotos();
  store.set(draftKey(), JSON.stringify({
    estimateId: state.estimateId, rowVersion: state.rowVersion, pricesVersion: state.pricesVersion, estimateRef: state.estimateRef, estVersion: state.estVersion,
    estStatus: state.estStatus, project: state.project, referenceId: state.referenceId, sel: state.sel,
    showRefs: state.showRefs, pricing: state.prices ? state.pricing : blankPricing(), media: state.media,
  }));
}
function clearDraftLocal() { store.set(draftKey(), null); }

async function loadRefs() {
  if (state.refs) return state.refs;
  state.refs = await repo.listRefs({ trade: "deck" });
  return state.refs;
}
async function loadCatalog() {
  if (state.catalog) return state.catalog;
  // the Materials Library first (managed live, with photos); the shipped deck-materials.json is the fallback
  try {
    const rows = await repo.listMaterials({ trade: "deck" });
    const cat = catalogFromRows(rows);
    if (cat.products.length) { state.catalog = cat; return cat; }
  } catch (e) { /* fall through to the static file */ }
  const r = await fetch("deck-materials.json");
  const raw = await r.json();
  (raw.products || []).forEach((p) => { p.selectable = p.status === "active"; });
  state.catalog = raw;
  return state.catalog;
}

/* Pictures are signed URLs, so they arrive late; images stay hidden until they load. */
function showPic(img, entry, display) {
  if (!img || !entry || !gallery.showable(entry)) return;
  img.addEventListener("load", () => {
    img.style.display = display || "";
    const ph = img.parentElement && img.parentElement.querySelector(".picph");
    if (ph) ph.style.display = "none";
  });
  gallery.srcInto(img, entry);
}

/* ══ product detail viewer ══
   ONE color at a time. Mixing every color's photos into one strip put 20 photos of 10 different colors in front of
   the client on a line like Enhance — the color they are looking at is the only one that sells. */
function galOf(o) { return gallery.parse(o || {}).filter(gallery.showable); }
function colorOf(pr, colorId) { return (pr.colors || []).filter((c) => c.colorId === colorId)[0] || null; }
// The library names its pair "<Color>.jpg" and "<Color> sample.jpg" — the board render and a close-up of the real
// material. Worth saying out loud.
function shotLabel(entry, fallback) {
  const n = String((entry && entry.name) || "").replace(/^\d+-/, "").replace(/\.[a-z0-9]+$/i, "");
  if (/\bsample\b/i.test(n)) return "Sample";
  if (/\bboard\b/i.test(n)) return "Board";
  return fallback || "";
}
// Photos of THIS color; a line's own shots only when the color has none. Never hard-code "two".
function matPhotos(pr, colorId) {
  const col = colorOf(pr, colorId);
  const own = col ? galOf(col) : [];
  if (own.length) {
    return own.map((e, i) => ({ e, cap: col.name, shot: shotLabel(e, own.length > 1 ? (i === 0 ? "Board" : "Sample") : "") }));
  }
  return galOf(pr).map((e) => ({ e, cap: pr.officialName, shot: shotLabel(e, "") }));
}
function linePhotoCount(pr) {
  let n = galOf(pr).length;
  (pr.colors || []).forEach((c) => { n += galOf(c).length; });
  return n;
}
function coverPhoto(pr, colorId) {
  const own = matPhotos(pr, colorId);
  if (own.length) return own[0];
  for (let i = 0; i < (pr.colors || []).length; i++) {
    const g = galOf(pr.colors[i]);
    if (g.length) return { e: g[0], cap: pr.colors[i].name, shot: "" };
  }
  return null;
}
// esc() stops HTML injection but NOT a scheme: links are https-only, and we show the host so the client sees whose
// site it is.
const safeUrl = gallery.safeUrl;
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "manufacturer"; } }

/* The viewer keeps its OWN color while browsing: opening a line the client hasn't chosen shouldn't quietly change
   the selection. "Use this line" commits whatever color is on screen. */
const mv = { materialId: null, colorId: null, idx: 0, photos: [], onKey: null, present: false };
function openMatModal(materialId) {
  const pr = prod(materialId);
  if (!pr) return;
  const isPrimary = state.sel.primary && state.sel.primary.materialId === materialId;
  mv.materialId = materialId;
  mv.colorId = (isPrimary && state.sel.primary.colorId) || ((pr.colors || [])[0] || {}).colorId || null;
  mv.idx = 0;
  el("matModal").hidden = false;
  document.body.style.overflow = "hidden";
  mv.present = false;
  mv.onKey = function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      // in photo view the first Escape steps back out, so a rep with the laptop turned to the client never loses
      // the whole view mid-sentence
      if (mv.present) { mv.present = false; renderMatModal(); } else closeMatModal();
    } else if (e.key === "ArrowRight") { e.preventDefault(); stepColor(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepColor(-1); }
  };
  document.addEventListener("keydown", mv.onKey);
  renderMatModal();
}
function closeMatModal() {
  el("matModal").hidden = true;
  document.body.style.overflow = "";
  if (mv.onKey) document.removeEventListener("keydown", mv.onKey);
  mv.onKey = null;
  mv.materialId = null;
}
// arrows walk the COLORS — with one color's shots all on screen there is nothing left to page through inside one
function stepColor(d) {
  const pr = prod(mv.materialId);
  const cols = (pr && pr.colors) || [];
  if (cols.length < 2) return;
  let at = -1;
  cols.forEach((c, i) => { if (c.colorId === mv.colorId) at = i; });
  const next = cols[((at < 0 ? 0 : at) + d + cols.length) % cols.length];
  pickColor(next.colorId);
}
// one place decides what a color choice means: it always changes what you are LOOKING at, and only changes the
// estimate when this line is the pick
function pickColor(colorId) {
  const pr = prod(mv.materialId);
  mv.colorId = colorId;
  mv.idx = 0;
  const sel = pr ? selFor(pr.materialId) : null;
  if (sel) { sel.colorId = colorId; syncAlternative(); renderStep3(); }
  renderMatModal();
}
function renderMatModal() {
  const pr = prod(mv.materialId);
  if (!pr) { closeMatModal(); return; }
  mv.photos = matPhotos(pr, mv.colorId);
  if (mv.idx >= mv.photos.length) mv.idx = 0;
  const isPrimary = state.sel.primary && state.sel.primary.materialId === pr.materialId;
  const isAlt = optIndex(pr.materialId) >= 0;
  const selectable = isSelectable(pr);
  const colName = (colorOf(pr, mv.colorId) || {}).name || "";

  const stage = mv.photos.length
    ? '<div class="mv-shots n' + Math.min(mv.photos.length, 3) + '">' + mv.photos.map((p, i) =>
        '<figure class="mv-shot"><span class="mv-frame"><img data-shot="' + i + '" alt="' +
        esc(p.cap + (p.shot ? " — " + p.shot : "")) + '"></span>' +
        (p.shot ? "<figcaption>" + esc(p.shot) + "</figcaption>" : "") + "</figure>").join("") + "</div>" +
      (colName ? '<div class="mv-colname">' + esc(colName) + "</div>" : "")
    // client-neutral first line; the how-to-fix link stays small and second
    : '<div class="mv-empty"><span class="ic">🖼️</span>No photo for ' + (colName ? esc(colName) : "this line") + " yet." +
      '<div style="margin-top:8px;font-size:11.5px;opacity:.75">' +
      '<a href="materials-library.html" target="_blank" rel="noopener">Add one →</a></div></div>';

  const lines = (s) => String(s || "").split("\n").map((x) => x.trim()).filter(Boolean);
  const highlights = lines(pr.salesHighlights), best = lines(pr.bestFor);

  const colors = '<div class="mv-colors">' + (pr.colors || []).map((c, ci) => {
    const n = galOf(c).length;
    return '<div class="mv-col' + (c.colorId === mv.colorId ? " on" : "") + '" data-mvcolor="' + esc(c.colorId) + '" role="button" tabindex="0">' +
      '<div class="sw"><img alt="" data-mvsw="' + ci + '"></div>' +
      '<div class="nm">' + esc(c.name) + "</div>" +
      (n ? '<div class="n">' + n + " photo" + (n === 1 ? "" : "s") + "</div>" : "") + "</div>";
  }).join("") + "</div>";

  const profs = (pr.profiles || []).length
    ? '<div class="ed-chips">' + pr.profiles.map((f) => {
        const mvSel = selFor(pr.materialId);
        const on = mvSel && mvSel.profileId === f.profileId;
        return '<span class="ed-chip' + (on ? " on" : "") + '" data-mvprofile="' + esc(f.profileId) + '" role="button" tabindex="0">' +
          esc((f.profileType || "").replace(/_/g, " ") + " · " + (f.nominalDimensions || "")) + "</span>";
      }).join("") + "</div>"
    : "";

  const manUrl = safeUrl(pr.manufacturerUrl) ||
    safeUrl(((pr.colors || []).filter((c) => c.colorId === mv.colorId)[0] || {}).manufacturerUrl);

  document.querySelector(".mv").classList.toggle("present", !!mv.present);
  el("mvBody").innerHTML =
    '<div class="mv-grid">' +
      '<div class="mv-pics">' + stage + "</div>" +
      '<div class="mv-info">' +
        '<div class="mv-eyebrow">' + esc(pr.brandName || "") + "</div>" +
        '<h2 class="mv-title" id="mvTitle">' + esc(lineName(pr)) + "</h2>" +
        '<div class="mv-pills">' +
          (pr.marketTier ? '<span class="ed-tier">' + esc(pr.marketTier) + "</span>" : "") +
          (pr.warrantySummary ? '<span class="ed-badge hi">' + esc(pr.warrantySummary) + "</span>" : "") +
          (selectable ? "" : '<span class="ed-badge sample">quote on request</span>') +
        "</div>" +
        (pr.shortDescription ? '<div class="mv-desc">' + esc(pr.shortDescription) + "</div>" : "") +
        (highlights.length
          ? '<div class="mv-h">Why clients pick it</div><ul class="mv-list">' + highlights.map((h) => "<li>" + esc(h) + "</li>").join("") + "</ul>"
          : "") +
        (best.length
          ? '<div class="mv-h">Best for</div><div class="ed-chips">' +
            best.map((b) => '<span class="ed-chip" style="cursor:default">' + esc(b) + "</span>").join("") + "</div>"
          : "") +
        '<div class="mv-h mv-h-color">Color' + ((pr.colors || []).length ? " · " + pr.colors.length : "") + "</div>" + colors +
        (profs ? '<div class="mv-h">Profile</div>' + profs : "") +
      "</div>" +
    "</div>" +
    '<div class="mv-foot">' +
      // the client can read everything on this screen — no notes-to-self
      (manUrl
        ? '<a class="btn btn-ghost btn-sm" href="' + esc(manUrl) + '" target="_blank" rel="noopener noreferrer">🔗 ' +
          esc(hostOf(manUrl)) + " — official page ↗</a>"
        : "<span></span>") +
      '<div class="right">' +
        (mv.photos.length ? '<button type="button" class="btn btn-ghost btn-sm" id="mvPresent">' +
          (mv.present ? "✕ Exit photo view" : "⛶ Photo view") + "</button>" : "") +
        (selectable
          ? '<button type="button" class="btn btn-ghost btn-sm" id="mvAlt">' + (isAlt ? "✓ Comparing" : "+ Compare") + "</button>" +
            '<button type="button" class="btn btn-sm" id="mvUse"' + (isPrimary ? " disabled" : "") + ">" +
              (isPrimary ? "✓ Selected" : "Use this line →") + "</button>"
          : '<span class="ed-sub" style="margin:0;font-size:12px">We quote this line on request.</span>') +
      "</div>" +
    "</div>";

  // NOTE: "block", not "" — the stylesheet hides these until they load
  el("mvBody").querySelectorAll("img[data-shot]").forEach((img) => {
    const p = mv.photos[+img.getAttribute("data-shot")];
    if (p) showPic(img, p.e, "block");
  });
  // a color's swatch is its own first photo (that is where they live)
  el("mvBody").querySelectorAll("img[data-mvsw]").forEach((img) => {
    const c = (pr.colors || [])[+img.getAttribute("data-mvsw")];
    if (c) showPic(img, galOf(c)[0], "block");
  });
  const onTap = (node, fn) => {
    node.addEventListener("click", fn);
    node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
  };
  el("mvBody").querySelectorAll("[data-mvcolor]").forEach((c) => onTap(c, () => pickColor(c.getAttribute("data-mvcolor"))));
  el("mvBody").querySelectorAll("[data-mvprofile]").forEach((c) => onTap(c, () => {
    const sel = selFor(pr.materialId);
    if (!sel) return;
    sel.profileId = c.getAttribute("data-mvprofile");
    syncAlternative();
    renderStep3();
    renderMatModal();
  }));
  const pres = el("mvPresent");
  if (pres) pres.addEventListener("click", () => { mv.present = !mv.present; renderMatModal(); });
  const useBtn = el("mvUse");
  if (useBtn) useBtn.addEventListener("click", () => {
    const was = optIndex(pr.materialId), old = state.sel.primary;
    state.sel.primary = { materialId: pr.materialId, colorId: mv.colorId,
      profileId: (was >= 0 && state.sel.options[was].profileId) || ((pr.profiles && pr.profiles[0]) ? pr.profiles[0].profileId : null) };
    if (was >= 0) state.sel.options.splice(was, 1);
    // whatever it displaced stays on the table as a comparison
    if (old && old.materialId !== pr.materialId && optIndex(old.materialId) < 0) state.sel.options.unshift(old);
    syncAlternative();
    renderStep3();
    closeMatModal();
  });
  const altBtn = el("mvAlt");
  if (altBtn) altBtn.addEventListener("click", () => {
    const i = optIndex(pr.materialId);
    if (i >= 0) state.sel.options.splice(i, 1);
    else if (!(state.sel.primary && state.sel.primary.materialId === pr.materialId)) {
      state.sel.options.push({ materialId: pr.materialId, colorId: mv.colorId,
        profileId: (pr.profiles && pr.profiles[0]) ? pr.profiles[0].profileId : null });
    }
    syncAlternative();
    renderStep3();
    renderMatModal();
  });
}

/* The estimator's own rates, shown as a plain bill of work. Kept visibly apart from the historical comparables above
   it: one is what past jobs cost, the other is what this estimator says this job costs. */
function pricedScopeHtml(t) {
  if (!t || !t.priced) return "";
  const rows = t.work.map((l) => "<tr><td>" + esc(l.label) + '</td><td class="num">' + l.qty + " " + esc(l.unit) +
      '</td><td class="num">' + money2(l.rate) + '</td><td class="num"><b>' + money2(l.total) + "</b></td></tr>").join("") +
    t.items.filter((l) => l.ready).map((l) => "<tr><td>" + esc(l.name) + '</td><td class="num" colspan="2">' + esc(l.detail) +
      '</td><td class="num"><b>' + money2(l.total) + "</b></td></tr>").join("");
  return '<h3 style="margin:18px 0 4px;font-size:15px">4 · Priced scope — your rates</h3>' +
    '<div style="overflow-x:auto"><table class="ed-tbl"><thead><tr><th>Work</th>' +
    '<th class="num">Quantity</th><th class="num">Rate</th><th class="num">Total</th></tr></thead><tbody>' +
    rows + "</tbody></table></div>" +
    '<div class="ed-kv"><span><b>Priced scope total</b></span><span class="v ed-total">' + money(t.total) + "</span></div>" +
    '<div class="ed-note">These figures come from the rates you entered for this job, not from the comparables above. ' +
    "Decking material is still pending pricing and is <b>not</b> included.</div>";
}

/* ══ step navigation ══
   Steps unlock as their prerequisites are met: fill in step 1 and steps 2-3 open immediately; pick a material and
   4-5 open too. Going back is always allowed. Locked tabs explain what's missing instead of doing nothing. */
function commitStep1() {
  if (!el("f_client")) return;
  const p = state.project;
  p.clientName = el("f_client").value.trim();
  p.clientPhone = el("f_phone").value.trim();
  p.clientEmail = el("f_email").value.trim();
  p.address = el("f_addr").value.trim();
  p.city = el("f_city").value.trim();
  p.deckingArea = Number(el("f_deck").value);
  p.framingArea = Number(el("f_frame").value);
  p.railing = Number(el("f_rail").value) || 0;
  p.stairs = Number(el("f_stairs").value) || 0;
  p.terrain = el("f_terrain").value;
  p.access = el("f_access").value;
  if (!el("f_notes").disabled) p.notes = el("f_notes").value;
}

function paintSteps() {
  document.querySelectorAll(".ed-step").forEach((s) => {
    const n = Number(s.dataset.step);
    const why = stepBlockReason(n, state.project, state.sel);
    const reachable = n < state.step || !why; // back is always open
    s.classList.toggle("on", n === state.step);
    s.classList.toggle("done", n < state.step);
    s.classList.toggle("open", reachable && n !== state.step);
    s.classList.toggle("locked", !reachable);
    s.title = reachable ? "" : why || "";
    s.setAttribute("role", "button");
    s.setAttribute("aria-disabled", reachable ? "false" : "true");
    s.tabIndex = n === state.step ? -1 : 0;
  });
}
/* one listener for the step tabs (drawn once in the page): a tab other than this step tries to go there */
function wireSteps() {
  const go2 = (e) => {
    const s = e.target.closest(".ed-step");
    if (!s) return;
    const n = Number(s.dataset.step);
    if (n !== state.step) tryGo(n);
  };
  el("edSteps").addEventListener("click", go2);
  el("edSteps").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go2(e); } });
}

// Tab navigation: save what's typed first, then either move or say why not.
function tryGo(n) {
  if (state.step === 1) commitStep1();
  const why = n > state.step ? stepBlockReason(n, state.project, state.sel) : null;
  if (why) {
    if (el("s1msg")) el("s1msg").textContent = why;
    paintSteps();
    return;
  }
  if (state.step === 1 && n > 1) state.ranked = null; // scope may have changed — re-rank
  go(n);
}

async function go(step) {
  state.step = step;
  paintSteps();
  saveDraftLocal(); // also syncs photos from the gallery widget
  if (state._gal && step !== 1) { state._gal.destroy(); state._gal = null; }
  window.scrollTo(0, 0);
  if (step === 1) renderStep1();
  if (step === 2) await renderStep2();
  if (step === 3) await renderStep3();
  if (step === 4) await renderStep4();
  if (step === 5) await renderStep5();
}

/* ══ saving ══
   One write at a time, each with the version the previous one handed back. A 409 means someone else saved this
   estimate meanwhile (another tab, another rep): it is said, and nothing more is saved from this page until it is
   reloaded — the old page wrote over the other copy without a word. */
let saveChain = Promise.resolve();
function persist(opts) {
  const o = opts || {};
  const run = async () => {
    if (!state.edit) throw Object.assign(new Error("You can read Sales Estimates; changing them is for an admin or a manager with the Sales estimates switch."), { code: "42501", status: 403 });
    if (state.conflict) throw Object.assign(new Error("Someone else saved this estimate meanwhile. Reload the page to see their version."), { code: "PT409", status: 409 });
    if (!state.estimateRef) state.estimateRef = newEstimateRef();
    syncPhotos();
    const fields = estimateFields(state, { refs: state.refs || [], withSelection: o.full, isNew: !state.estimateId });
    const prices = state.prices && o.full && state.output ? estimatePriceFields(state.output, state.pricing) : null;
    try {
      const saved = await repo.saveEstimate(state.estimateId, state.rowVersion, fields, prices, state.pricesVersion);
      state.estimateId = saved.id;
      state.rowVersion = saved.version;
      if (saved.pricesVersion !== null && saved.pricesVersion !== undefined) state.pricesVersion = saved.pricesVersion;
      saveDraftLocal();
      return saved;
    } catch (e) {
      if (e && (e.code === "PT409" || e.status === 409)) state.conflict = true;
      throw e;
    }
  };
  const p = saveChain.then(run, run);
  saveChain = p.catch(() => {});
  return p;
}

/* ══ project media: photos (annotatable), drawings, voice notes with transcripts ══
   EVERYTHING AUTO-SAVES. Notes upload the moment recording stops; any media change (photo, markup, drawing, note)
   also writes the estimate row (created as a draft on the first change) so nothing lives only in this browser.
   Deleting unused notes beats losing important ones. */
function autoMsg(t, isErr) {
  const n = el("autoSaveMsg");
  if (!n) return;
  n.style.color = isErr ? "var(--err)" : "var(--ok)";
  n.textContent = t || "";
}
function mediaStore() {
  if (!state.estimateRef) state.estimateRef = newEstimateRef();
  return repo.mediaStore("estimates", state.estimateRef);
}

let autoTimer = null;
function autoSaveMedia() {
  saveDraftLocal();
  if (!state.edit) return;
  clearTimeout(autoTimer);
  autoMsg("saving…");
  autoTimer = setTimeout(async () => {
    syncPhotos();
    /* Every drawing and photo of this estimate is one JSON value, sent whole with each save. Past the ceiling every
       future auto-save of this estimate would fail, which reads as "my work stopped saving" with no visible
       reason — so it is said, with the largest items. */
    const size = JSON.stringify(state.media).length;
    if (size > MEDIA_LIMIT) {
      const biggest = (state.media.photos || [])
        .map((m) => ({ name: m.name || "item", size: JSON.stringify(m).length }))
        .sort((a, b) => b.size - a.size).slice(0, 3)
        .map((m) => m.name + " (" + Math.round(m.size / 1024) + " KB)").join(", ");
      autoMsg("too much media to save — remove something", true);
      const a = D().alert;
      if (typeof a === "function") a("This estimate's drawings and photos are close to the 2 MB ceiling, so nothing new can be saved. " +
        "Delete something from the gallery first. Largest items: " + biggest, { title: "Storage full for this estimate" });
      return;
    }
    try {
      await persist({ full: false });
      autoMsg("✓ auto-saved " + new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    } catch (e) {
      autoMsg(state.conflict ? "⚠ someone else saved this estimate — reload to see it" : "⚠ auto-save failed — will retry on the next change", true);
    }
  }, 1500);
}

function cmeOpen(entry, fresh) {
  const st = mediaStore();
  cme.open({
    entry,
    fresh: !!fresh,
    /* state.estimateRef, never the database id: it is minted once and saved with the row, so it is stable across
       sessions and before the first save; the drawing library on this device is scoped by it. */
    estimateId: state.estimateRef,
    clientName: state.project && state.project.clientName,
    title: (state.project.clientName || "Site") + (fresh ? " — new drawing" : " — drawing"),
    upload: (blob, name, o) => st.upload(blob, name, o),
    onNumbers: applyDrawingNumbers,
    onSave: function (patch) {
      if (entry) {
        Object.assign(entry, patch);
        if (state._gal) state._gal.refresh();
        autoSaveMedia();
        return;
      }
      /* One project, one gallery entry. If this drawing was saved before (a reopen, or a fresh flag that failed to
         reach the frame), the existing entry is updated instead of gaining a twin. */
      syncPhotos();
      const existing = (state.media.photos || []).find((m) => m.cme && patch.cme && m.cme.project && patch.cme.project &&
        m.cme.project.id === patch.cme.project.id);
      if (existing) {
        Object.assign(existing, patch);
        if (state._gal) state._gal.refresh();
        autoSaveMedia();
        return;
      }
      if (state._gal) state._gal.add(patch); // fires onChange -> auto-save
      else { state.media.photos.push(patch); autoSaveMedia(); }
    },
  });
}

function mountMedia() {
  if (state._gal) state._gal.destroy();
  gallery.useStore(mediaStore());
  state._gal = gallery.mount(el("edGallery"), {
    initial: state.media.photos,
    readOnly: !state.edit,
    onChange: () => autoSaveMedia(),
    tileAction: {
      title: "Open & edit — markup on photos, the full editor on drawings",
      icon: "✏️",
      show: (p) => state.edit && !!p.path,
      badge: (p) => {
        if (p.cme) return "▣ model";
        if (p.cad) return "📐 old";
        return p.ann && p.ann.items && p.ann.items.length ? "✏️ " + p.ann.items.length : "✏️";
      },
      onClick: function (entry, idx, rerender) {
        /* Branch on the ENTRY, not on the current tool. A drawing made in the old portal's sketch tool stays readable
           only there: its format cannot be read by CME, and converting it would drop half of what it contains. */
        if (entry.cme) { cmeOpen(entry, false); return; }
        if (entry.cad) {
          const a = D().alert;
          if (typeof a === "function") a("This drawing was made with the old portal's sketch tool. Open it in the old portal; it is kept here untouched.", { title: "An old drawing" });
          return;
        }
        annotate.open({
          entry,
          title: state.project.clientName ? state.project.clientName + " — photo " + (idx + 1) : "Photo " + (idx + 1),
          load: (e) => repo.mediaUrl(e.path),
          onSave: function (ann) { entry.ann = ann; rerender(); autoSaveMedia(); },
        });
      },
    },
  });
  el("edNewDrawing").addEventListener("click", () => cmeOpen(null, true));
  if (!state.edit) { el("edNewDrawing").hidden = true; el("edRecBox").hidden = true; }
  renderAudioList();
  el("recStart").addEventListener("click", startRec);
  el("recStop").addEventListener("click", stopRec);
  el("recCancel").addEventListener("click", cancelRec);
}

/* Numbers measured on the drawing land in step 1. An empty field just fills; a field the rep already typed is never
   overwritten silently — it gets a one-tap "use it" next to it. */
function applyDrawingNumbers(n) {
  const ids = { deckingArea: "f_deck", railing: "f_rail", stairs: "f_stairs" };
  if (el("f_client")) commitStep1();
  const plan = drawingNumbersPlan(state.project, n);
  const filled = [];
  plan.fill.forEach((m) => {
    state.project[m.key] = m.val;
    const inp = el(ids[m.key]);
    if (inp) { inp.value = m.val; inp.dispatchEvent(new Event("input", { bubbles: true })); }
    filled.push(m.val + (m.unit ? " " + m.unit : "") + " " + m.what);
  });
  // a new deck frames what it decks — mirror the area unless it was typed
  const fr = el("f_frame");
  if (!(Number(state.project.framingArea) > 0) && n.deckSF > 0 && state.project.projectType === "new-deck" && (!fr || !fr.disabled)) {
    state.project.framingArea = n.deckSF;
    if (fr) fr.value = n.deckSF;
  }
  state.project.drawingNumbers = { deckSF: n.deckSF, railLF: n.railLF, fasciaLF: n.fasciaLF, stairs: n.stairs };
  saveDraftLocal();
  const note = el("edDrawNums");
  if (!note) return;
  note.innerHTML =
    (filled.length ? "✓ From the drawing: " + esc(filled.join(" · ")) + ". " : "") +
    (n.fasciaLF ? "Fascia " + esc(n.fasciaLF) + " LF noted. " : "") +
    plan.offers.map((m) => "Drawing says <b>" + esc(m.val) + (m.unit ? " " + m.unit : "") + "</b> " + esc(m.what) +
      ' — <button type="button" class="btn btn-ghost btn-sm useNum" data-key="' + esc(m.key) + '" data-v="' + esc(m.val) +
      '" style="padding:1px 7px">use it</button> ').join("");
  note.style.display = note.innerHTML ? "" : "none";
  note.querySelectorAll(".useNum").forEach((b) => {
    b.addEventListener("click", () => {
      const inp = el(ids[b.dataset.key]);
      if (inp) { inp.value = b.dataset.v; inp.dispatchEvent(new Event("input", { bubbles: true })); }
      state.project[b.dataset.key] = Number(b.dataset.v);
      b.remove();
      saveDraftLocal();
    });
  });
}

function renderAudioList() {
  const list = state.media.audioNotes || [];
  el("edNotesList").innerHTML = !list.length ? "" : list.map((n, i) => {
    const status = n.pending ? '<span style="color:var(--gold)">⏳ uploading…</span>'
      : n.failed && n._blob ? '<button type="button" class="btn btn-ghost btn-sm retryNote" data-i="' + i + '" style="padding:2px 8px">⚠ retry upload</button>'
      : n.failed ? '<span style="color:var(--gold)">⚠ audio not saved — transcript kept</span>'
      : "🎤 " + esc(new Date(n.when).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) +
        (n.txtPath ? " · 📄 transcript saved" : "");
    const lock = moneyLocked(n.transcript) || !state.edit;
    return '<div style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:8px 10px;margin-top:6px">' +
      '<button type="button" class="btn btn-ghost btn-sm playNote" data-i="' + i + '"' + (n.audioPath ? "" : " disabled") + ' aria-label="Play">▶</button>' +
      '<div style="flex:1;min-width:0"><div style="font-size:11px;color:var(--text-muted)">' + status + "</div>" +
      '<textarea class="noteTxt" data-i="' + i + '" rows="2" style="margin-top:4px;font-size:12.5px" aria-label="Transcript"' +
      (lock ? ' disabled title="This transcript quotes an amount: shown masked, read only without the prices switch."' : "") +
      ' placeholder="(no transcript — type notes here)">' + esc(shown(n.transcript)) + "</textarea></div>" +
      (state.edit ? '<button type="button" class="btn btn-ghost btn-sm delNote" data-i="' + i + '" aria-label="Delete this voice note">🗑</button>' : "") + "</div>";
  }).join("");
  el("edNotesList").querySelectorAll(".playNote").forEach((b) => b.addEventListener("click", () => playNote(list[Number(b.dataset.i)], b)));
  el("edNotesList").querySelectorAll(".delNote").forEach((b) => b.addEventListener("click", async () => {
    const n = list[Number(b.dataset.i)] || {};
    const preview = shown(n.transcript || "").trim().replace(/\s+/g, " ").slice(0, 70);
    if (!(await confirmBox("The recording" +
      (n.transcript ? ' and its transcript ("' + preview + (preview.length >= 70 ? "…" : "") + '")' : "") +
      " will be removed from this estimate. This cannot be undone.",
      { title: "Delete this voice note?", danger: true, okText: "Delete" }))) return;
    list.splice(Number(b.dataset.i), 1);
    renderAudioList();
    autoSaveMedia();
  }));
  el("edNotesList").querySelectorAll(".retryNote").forEach((b) => b.addEventListener("click", () => uploadNote(list[Number(b.dataset.i)])));
  // transcript edits save on blur: update the note, refresh its .txt, auto-save
  el("edNotesList").querySelectorAll(".noteTxt").forEach((t) => t.addEventListener("blur", async () => {
    const n = list[Number(t.dataset.i)];
    if (!n || t.disabled || n.transcript === t.value) return;
    n.transcript = t.value;
    autoSaveMedia();
    if (n.audioPath && n.transcript.trim()) {
      try {
        const up = await mediaStore().upload(new Blob([n.transcript], { type: "text/plain" }),
          (n.name || "voice-note").replace(/\.[^.]+$/, "") + ".txt");
        n.txtPath = up.path;
        autoSaveMedia();
      } catch (e) { /* the transcript stays in the estimate row either way */ }
    }
  }));
}

let audioEl = null;
function playNote(note, btn) {
  if (audioEl) { audioEl.pause(); audioEl = null; document.querySelectorAll(".playNote").forEach((x) => { x.textContent = "▶"; }); }
  if (btn.textContent === "⏸") { btn.textContent = "▶"; return; }
  repo.mediaUrl(note.audioPath)
    .then((u) => {
      audioEl = new Audio(u);
      btn.textContent = "⏸";
      audioEl.addEventListener("ended", () => { btn.textContent = "▶"; });
      return audioEl.play();
    })
    .catch(() => { const a = D().alert; if (typeof a === "function") a("Could not load the audio."); });
}

function setRecPhase(phase) {
  el("edRecIdle").style.display = phase === "idle" ? "" : "none";
  el("edRecLive").style.display = phase === "rec" ? "" : "none";
}

// Recorder — SpeechRecognition first, MediaRecorder after a head start (the proven Android ordering from the
// project voice notes), interim tail kept.
async function startRec() {
  const rec = state._rec = { chunks: [], finals: "", interim: "", sr: null, mr: null, t0: Date.now(), timer: null };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SR) {
    const sr = rec.sr = new SR();
    sr.continuous = true; sr.interimResults = true; sr.lang = "en-US";
    sr.onresult = function (ev) {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) rec.finals += ev.results[i][0].transcript + " ";
        else interim += ev.results[i][0].transcript;
      }
      rec.interim = interim;
      el("recLiveTxt").textContent = (rec.finals + interim).slice(-220) || "Listening…";
    };
    sr.onerror = function () {};
    try { sr.start(); } catch (e) { /* */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = window.MediaRecorder && MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    rec.mime = mime;
    const mr = rec.mr = new MediaRecorder(stream, { mimeType: mime });
    mr.ondataavailable = function (ev) { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    mr.start(1000);
    setRecPhase("rec");
    el("recLiveTxt").textContent = rec.sr ? "Listening…" : "Recording (transcript not supported on this device — audio still saves).";
    rec.timer = setInterval(() => {
      const s = Math.floor((Date.now() - rec.t0) / 1000);
      el("recTime").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
      if (s >= 180) stopRec(); // a 3-minute cap keeps a note a small file
    }, 500);
  } catch (e) {
    if (rec.sr) { try { rec.sr.stop(); } catch (e2) { /* */ } }
    state._rec = null;
    const a = D().alert;
    if (typeof a === "function") a("Microphone unavailable: " + (e.message || e.name || "permission denied"));
  }
}

// Stop = the note is KEPT and uploads immediately (no save/discard gate — notes are never lost; delete from the list
// if unwanted).
function stopRec() {
  const rec = state._rec;
  if (!rec) return;
  clearInterval(rec.timer);
  if (rec.sr) { try { rec.sr.stop(); } catch (e) { /* */ } }
  if (rec.mr && rec.mr.state !== "inactive") {
    rec.mr.onstop = function () {
      rec.mr.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(rec.chunks, { type: rec.mime });
      const note = {
        audioPath: null, txtPath: null,
        name: "voice-note-" + Date.now() + (rec.mime === "audio/mp4" ? ".m4a" : ".webm"),
        when: new Date().toISOString(),
        transcript: (rec.finals + rec.interim).trim(),
        pending: true,
      };
      // keep the blob in memory for a retry, but out of the saved JSON
      Object.defineProperty(note, "_blob", { value: blob, enumerable: false, writable: true });
      state.media.audioNotes.push(note);
      state._rec = null;
      setRecPhase("idle");
      renderAudioList();
      uploadNote(note);
    };
    rec.mr.stop();
  } else {
    state._rec = null;
    setRecPhase("idle");
  }
}

function cancelRec() {
  const rec = state._rec;
  if (!rec) return;
  clearInterval(rec.timer);
  if (rec.sr) { try { rec.sr.stop(); } catch (e) { /* */ } }
  if (rec.mr && rec.mr.state !== "inactive") {
    rec.mr.onstop = function () { rec.mr.stream.getTracks().forEach((t) => t.stop()); };
    rec.mr.stop();
  }
  state._rec = null;
  setRecPhase("idle");
}

async function uploadNote(note) {
  if (!note._blob) { note.failed = true; renderAudioList(); return; }
  note.pending = true; note.failed = false;
  renderAudioList();
  const st = mediaStore();
  try {
    const up = await st.upload(note._blob, note.name);
    note.audioPath = up.path;
    if (note.transcript) {
      try {
        const txt = await st.upload(new Blob([note.transcript], { type: "text/plain" }), note.name.replace(/\.[^.]+$/, "") + ".txt");
        note.txtPath = txt.path;
      } catch (e) { /* the transcript still lives in the estimate row */ }
    }
    note.pending = false;
    renderAudioList();
    autoSaveMedia();
  } catch (e) {
    note.pending = false;
    note.failed = true;
    renderAudioList();
    autoSaveMedia(); // the transcript is kept in the estimate even when the audio upload failed
  }
}

/* ══ STEP 1 — project info ══ */
function pickCards(list, selected, cls) {
  return '<div class="ed-pick" role="radiogroup">' + list.map((c) =>
    '<div class="ed-pick-card ' + cls + (selected === c.id ? " on" : "") + '" data-id="' + esc(c.id) + '" role="radio" tabindex="0" aria-checked="' +
    (selected === c.id ? "true" : "false") + '">' +
    '<div class="t">' + esc(c.t) + '</div><div class="d">' + esc(c.d) + "</div></div>").join("") + "</div>";
}

function renderStep1() {
  const p = state.project;
  const lockNotes = moneyLocked(p.notes);
  el("edApp").innerHTML =
    '<div class="ed-card"><h2>🏗️ Project information</h2>' +
    '<p class="ed-sub">Describe the deck project. Fields marked * are required.</p>' +
    (state.conflict ? '<div class="ed-warn">Someone else saved this estimate meanwhile. Nothing more is saved from this page — reload it to see their version.</div>' : "") +
    (!state.edit ? '<div class="ed-note">Read only: you can read Sales Estimates, and nothing you change here is saved. Making and changing them is for an admin, or a manager with the Sales estimates switch.</div>' : "") +
    '<div class="ed-grid">' +
    '<div><label class="req" for="f_client">Client name</label><input id="f_client" value="' + esc(p.clientName) + '" autocomplete="off"></div>' +
    '<div><label class="req" for="f_addr">Project address</label><input id="f_addr" value="' + esc(p.address) + '" autocomplete="off"></div>' +
    '<div><label for="f_phone">Client phone</label><input id="f_phone" type="tel" value="' + esc(p.clientPhone) + '" autocomplete="off"></div>' +
    '<div><label for="f_email">Client email</label><input id="f_email" type="email" value="' + esc(p.clientEmail) + '" autocomplete="off"></div>' +
    '<div><label for="f_city">City</label><input id="f_city" value="' + esc(p.city) + '"></div>' +
    "<div></div>" +
    '<div class="full"><label class="req">Project type</label>' + pickCards(PROJECT_TYPES, p.projectType, "pt") + "</div>" +
    '<div><label class="req" for="f_deck">Decking surface area (SF)</label><input id="f_deck" type="number" min="0" inputmode="decimal" value="' + esc(p.deckingArea) + '"></div>' +
    '<div><label for="f_frame">New framing area (SF)</label><input id="f_frame" type="number" min="0" inputmode="decimal" value="' + esc(p.framingArea) + '">' +
    '<div style="font-size:11px;color:var(--text-muted);margin-top:3px" id="frameHelp"></div></div>' +
    '<div><label for="f_rail">Railing (LF)</label><input id="f_rail" type="number" min="0" inputmode="decimal" value="' + esc(p.railing) + '"></div>' +
    '<div><label for="f_stairs">Stairs (count)</label><input id="f_stairs" type="number" min="0" inputmode="numeric" value="' + esc(p.stairs) + '"></div>' +
    '<div class="full"><label class="req">Complexity</label>' + pickCards(COMPLEXITY, p.complexity, "cx") + "</div>" +
    '<div><label for="f_terrain">Terrain</label><select id="f_terrain"><option value="">—</option>' +
      TERRAIN.map((t) => "<option" + (p.terrain === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
    '<div><label for="f_access">Site access</label><select id="f_access"><option value="">—</option>' +
      ACCESS.map((t) => "<option" + (p.access === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
    '<div class="full"><label for="f_notes">Notes</label><textarea id="f_notes" rows="2"' +
      (lockNotes ? ' disabled title="These notes quote an amount: shown masked, read only without the prices switch."' : "") + ">" + esc(shown(p.notes)) + "</textarea></div>" +
    '<div class="full"><label>Project photos &amp; drawings <span style="color:var(--text-muted);font-weight:400">— tap ✏️ to mark up a photo or edit a drawing</span>' +
    '<span id="autoSaveMsg" role="status" style="float:right;font-size:11px;font-weight:600"></span></label>' +
    '<div style="margin:2px 0 8px"><button type="button" class="btn btn-ghost btn-sm" id="edNewDrawing">📐 New drawing — sketch the deck plan with real dimensions</button></div>' +
    '<div class="ed-sub" id="edDrawNums" style="display:none;margin:-4px 0 8px;font-size:12px"></div>' +
    '<div id="edGallery"></div></div>' +
    '<div class="full"><label>Voice notes <span style="color:var(--text-muted);font-weight:400">— saved automatically when you stop recording (audio + transcript); delete any you don\'t need</span></label>' +
    '<div id="edNotesList"></div>' +
    '<div id="edRecBox" style="border:1px dashed var(--border);border-radius:10px;padding:10px;margin-top:6px">' +
      '<div id="edRecIdle"><button type="button" class="btn btn-sm" id="recStart">🎤 Record a voice note</button> ' +
      '<span style="font-size:11px;color:var(--text-muted)">Speak your site notes — stopping saves the audio and transcript instantly.</span></div>' +
      '<div id="edRecLive" style="display:none"><span style="color:var(--err);font-weight:700;font-size:12px">● Recording</span> ' +
      '<span id="recTime" style="font-size:12px;font-weight:700"></span>' +
      '<div id="recLiveTxt" style="font-size:12px;color:var(--text-muted);margin:6px 0;min-height:16px"></div>' +
      '<button type="button" class="btn btn-sm" id="recStop">⏹ Stop &amp; save</button> ' +
      '<button type="button" class="btn btn-ghost btn-sm" id="recCancel">✕ Cancel</button></div>' +
    "</div></div>" +
    "</div>" +
    '<div class="ed-msg" id="s1msg" role="status" style="color:var(--err)"></div>' +
    '<div class="ed-nav"><span></span><button type="button" class="btn" id="s1next">Find similar projects →</button></div>' +
    "</div>";

  function applyTypeRules(type) {
    const fr = el("f_frame"), help = el("frameHelp");
    if (type === "new-deck") { fr.disabled = false; fr.value = el("f_deck").value || ""; help.textContent = "New deck: framing area normally matches decking area."; }
    if (type === "resurface") { fr.value = 0; fr.disabled = true; help.textContent = "Resurface: existing framing is retained."; }
    if (type === "deck-expansion") { fr.disabled = false; help.textContent = "Enter only the area requiring new framing."; }
    if (type === "partial-rebuild") { fr.disabled = false; help.textContent = "Enter the approximate area requiring replacement framing."; }
  }
  if (p.projectType) applyTypeRules(p.projectType);

  function wirePick(cls, apply) {
    document.querySelectorAll(".ed-pick-card." + cls).forEach((c) => {
      const pick = () => {
        document.querySelectorAll(".ed-pick-card." + cls).forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
        c.classList.add("on");
        c.setAttribute("aria-checked", "true");
        apply(c.dataset.id);
        commitStep1(); paintSteps();
      };
      c.addEventListener("click", pick);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    });
  }
  wirePick("pt", (id) => { state.project.projectType = id; applyTypeRules(id); });
  wirePick("cx", (id) => { state.project.complexity = id; });
  el("f_deck").addEventListener("input", function () {
    if (state.project.projectType === "new-deck") el("f_frame").value = this.value;
  });
  // keep the step tabs in sync as the form is filled in
  ["f_client", "f_addr", "f_deck", "f_frame"].forEach((id) => {
    el(id).addEventListener("input", () => { commitStep1(); paintSteps(); });
  });
  mountMedia();
  paintSteps();
  el("s1next").addEventListener("click", () => tryGo(2));
}

/* ══ STEP 2 — similar projects ══ */
async function renderStep2() {
  el("edApp").innerHTML = '<div class="ed-card"><h2>🔎 Analyzing similar projects…</h2><p class="ed-sub">Comparing your scope with completed DCR projects.</p></div>';
  try {
    const refs = await loadRefs();
    state.ranked = rankRefs(state.project, refs);
  } catch (e) {
    el("edApp").innerHTML = '<div class="ed-card"><h2>Similar projects</h2><p class="ed-sub" style="color:var(--err)">' + esc(errorText(e)) + "</p>" +
      '<div class="ed-nav"><button type="button" class="btn btn-ghost" id="s2back">← Back</button><span></span></div></div>';
    el("s2back").addEventListener("click", () => go(1));
    return;
  }
  const P = state.prices;
  const cards = state.ranked.map((r) => {
    const isRef = state.referenceId === r.projectRef;
    const isShown = state.showRefs.indexOf(r.projectRef) >= 0;
    const selCls = (isRef ? " sel" : "") + (isShown ? " shown" : "");
    const gal = galOf(r);
    const picHtml = gal.length
      ? '<div class="ed-refpic" data-car="' + esc(r.projectRef) + '" data-idx="0">' +
        '<img style="display:none" alt="' + esc(r.projectName) + '">' +
        (gal.length > 1
          ? '<button type="button" class="nav prev" data-nav="-1" title="Previous photo" aria-label="Previous photo">‹</button>' +
            '<button type="button" class="nav next" data-nav="1" title="Next photo" aria-label="Next photo">›</button>' +
            '<span class="ct">1 / ' + gal.length + "</span>"
          : "") +
        "</div>"
      : "";
    return '<div class="ed-match' + selCls + '" data-ref="' + esc(r.projectRef) + '">' +
      '<div class="hd"><span class="nm">' + esc(r.projectName) + (r.isSample ? ' <span class="ed-badge sample">sample</span>' : "") + "</span>" +
      '<span class="ed-badge ' + matchClass(r.match) + '">' + r.match + "% match</span></div>" +
      picHtml +
      '<div class="ed-facts">' +
      "<span>Type: <b>" + esc(r.projectType || "—") + "</b></span>" +
      "<span>Decking: <b>" + esc(r.primaryAreaSF || 0) + " SF</b></span>" +
      "<span>Railing: <b>" + esc(r.railingLF || 0) + " LF</b></span>" +
      "<span>Stairs: <b>" + esc(r.stairs || 0) + "</b></span>" +
      "<span>Complexity: <b>" + esc(r.complexity || "—") + "</b></span>" +
      (r.city ? "<span>📍 <b>" + esc(r.city) + "</b></span>" : "") +
      "</div>" +
      '<div class="ed-facts">' +
      (P ? "<span>Final price: <b>" + money(r.referencePrice) + "</b></span>" +
        "<span>Cost/SF: <b>" + (r.costPerPrimaryUnit !== null && r.costPerPrimaryUnit !== undefined && isFinite(Number(r.costPerPrimaryUnit)) ? "$" + Number(r.costPerPrimaryUnit).toFixed(2) : "—") + "</b></span>" : "") +
      (r.productLine ? "<span>" + esc(r.deckingManufacturer || "") + " <b>" + esc(r.productLine) + "</b></span>" : "") +
      "</div>" +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">' +
      '<button type="button" class="btn btn-sm ' + (isRef ? "" : "btn-ghost") + ' pickRef" data-ref="' + esc(r.projectRef) + '">' +
      (isRef ? "✓ Reference selected" : "Use as reference →") + "</button>" +
      '<button type="button" class="btn btn-sm ' + (isShown ? "" : "btn-ghost") + ' showRef" data-ref="' + esc(r.projectRef) + '">' +
      (isShown ? "✓ Showing client" : "+ Show client") + "</button>" +
      "</div></div>";
  }).join("");

  el("edApp").innerHTML =
    '<div class="ed-card"><h2>📊 Similar completed projects</h2>' +
    '<p class="ed-sub">Ranked by similarity to your scope. Pick the best historical reference — it anchors the benchmark on the estimate. ' +
    "Tick <b>Show client</b> on as many projects as you like; those ride along to the estimate as examples of work like theirs.</p>" +
    (P ? "" : '<p class="ed-sub">The past prices are not shown: they need the prices switch.</p>') +
    (cards || '<p class="ed-sub">No reference projects in the library yet. You can continue without one, or add past projects from the Sales Estimates page.</p>') +
    '<div class="ed-msg" id="s2msg" style="color:var(--text-muted)">' +
    (state.referenceId ? "Reference: " + esc(state.referenceId) : "No reference selected (optional but recommended).") +
    (state.showRefs.length ? " · Showing the client " + state.showRefs.length + " project" + (state.showRefs.length === 1 ? "" : "s") : "") + "</div>" +
    '<div class="ed-nav"><button type="button" class="btn btn-ghost" id="s2back">← Project</button>' +
    '<button type="button" class="btn" id="s2next">Choose materials →</button></div></div>';

  document.querySelectorAll(".pickRef").forEach((b) => b.addEventListener("click", () => {
    state.referenceId = b.dataset.ref === state.referenceId ? null : b.dataset.ref;
    saveDraftLocal();
    renderStep2();
  }));
  document.querySelectorAll(".showRef").forEach((b) => b.addEventListener("click", () => {
    const i = state.showRefs.indexOf(b.dataset.ref);
    if (i >= 0) state.showRefs.splice(i, 1); else state.showRefs.push(b.dataset.ref);
    saveDraftLocal();
    renderStep2();
  }));
  // photo carousels: load the current photo; ‹ › cycle through that project's gallery
  document.querySelectorAll(".ed-refpic[data-car]").forEach((box) => {
    const ref = state.ranked.find((r) => r.projectRef === box.dataset.car);
    const gal = galOf(ref);
    const img = box.querySelector("img");
    img.addEventListener("load", () => { img.style.display = ""; });
    function show(idx) {
      idx = ((idx % gal.length) + gal.length) % gal.length;
      box.dataset.idx = idx;
      img.style.display = "none";
      gallery.srcInto(img, gal[idx]);
      const ct = box.querySelector(".ct");
      if (ct) ct.textContent = (idx + 1) + " / " + gal.length;
    }
    box.querySelectorAll("[data-nav]").forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      show(Number(box.dataset.idx) + Number(btn.dataset.nav));
    }));
    show(0);
  });
  el("s2back").addEventListener("click", () => go(1));
  el("s2next").addEventListener("click", () => go(3));
}

/* ══ STEP 3 — materials ══ */
async function renderStep3() {
  // only announce loading the FIRST time — otherwise every color tap blanks the step behind an open viewer while the
  // client is looking at it
  if (!state.catalog) el("edApp").innerHTML = '<div class="ed-card">Loading material catalog…</div>';
  try { await loadCatalog(); } catch (e) {
    el("edApp").innerHTML = '<div class="ed-card"><p style="color:var(--err)">Could not load the material catalog.</p></div>';
    return;
  }
  const cards = products().map((pr) => {
    const selectable = isSelectable(pr);
    const isPrimary = state.sel.primary && state.sel.primary.materialId === pr.materialId;
    const oi = optIndex(pr.materialId);
    const isOpt = oi >= 0;
    const cls = "ed-mat" + (isPrimary ? " sel" : "") + (isOpt ? " alt" : "") + (selectable ? "" : " dis");
    // the cover falls back to the selected (or first) color's photo, since that is where photos live for most lines
    const shot = coverPhoto(pr, isPrimary ? state.sel.primary.colorId : null);
    const nPhotos = linePhotoCount(pr);
    const thumb = '<span class="ed-cover' + (shot ? " has-pic" : "") + '">' + (shot ? '<img data-mvpic="' + esc(pr.materialId) + '" alt="">' : "🪵") + "</span>";
    let colorChips = "", profChips = "";
    const chosen = isPrimary ? state.sel.primary : (isOpt ? state.sel.options[oi] : null);
    if (chosen) {
      colorChips = '<div class="ed-chips">' + (pr.colors || []).map((c) => {
        const on = chosen.colorId === c.colorId;
        const sw = galOf(c).length
          ? '<img style="display:none;width:18px;height:18px;border-radius:4px;object-fit:cover;vertical-align:-4px;margin-right:5px" data-swatch="' + esc(c.colorId) + '" alt="">'
          : "";
        return '<span class="ed-chip' + (on ? " on" : "") + '" data-color="' + esc(c.colorId) + '" role="button" tabindex="0">' + sw + esc(c.name) + "</span>";
      }).join("") + "</div>";
      profChips = '<div class="ed-chips">' + (pr.profiles || []).map((f) => {
        const on = chosen.profileId === f.profileId;
        return '<span class="ed-chip' + (on ? " on" : "") + '" data-profile="' + esc(f.profileId) + '" role="button" tabindex="0">' +
          esc((f.profileType || "").replace(/_/g, " ") + " · " + (f.nominalDimensions || "")) + "</span>";
      }).join("") + "</div>";
    }
    return '<div class="' + cls + '" data-mat="' + esc(pr.materialId) + '" data-selectable="' + selectable + '">' +
      '<div class="hd"><div style="display:flex;gap:11px;align-items:center;min-width:0">' + thumb + "<div><b>" + esc(pr.brandName) + " " + esc(lineName(pr)) + "</b>" +
      '<div style="font-size:12px;color:var(--text-muted);margin-top:2px">' + esc(pr.shortDescription || "") + "</div>" +
      '<div class="ed-photos">' + (nPhotos ? "📷 " + nPhotos + " photo" + (nPhotos === 1 ? "" : "s") : "No photos yet") +
        (pr.warrantySummary ? " · " + esc(pr.warrantySummary) : "") + "</div></div></div>" +
      '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><span class="ed-tier">' + esc(pr.marketTier || "") + "</span>" +
      '<button type="button" class="btn btn-sm btn-ghost detBtn" data-mat="' + esc(pr.materialId) + '">Details</button>' +
      (selectable
        ? '<button type="button" class="btn btn-sm ' + (isOpt ? "" : "btn-ghost") + ' altBtn" data-mat="' + esc(pr.materialId) + '">' + (isOpt ? "✓ Comparing" : "+ Compare") + "</button>"
        : '<span class="ed-badge sample">pending approval</span>') +
      "</div></div>" +
      (chosen ? '<div style="font-size:11.5px;font-weight:700;margin-top:8px">Color' +
          (isPrimary ? "" : ' <span style="font-weight:400;color:var(--text-muted)">· comparison ' + (oi + 1) + "</span>") + "</div>" + colorChips +
        '<div style="font-size:11.5px;font-weight:700;margin-top:8px">Profile</div>' + profChips : "") +
      "</div>";
  }).join("");

  el("edApp").innerHTML =
    '<div class="ed-card"><h2>🪵 Decking material</h2>' +
    '<p class="ed-sub">Tap a card to set the <b>primary</b> line, then its color and profile. Tick <b>Compare</b> on as many other lines as you want to put in front of the client — each keeps its own color and profile. ' +
    "Identity data is manufacturer-verified; <b>pricing stays pending</b> until approved price records exist.</p>" +
    '<div class="ed-msg" style="color:var(--text-muted)">' +
      (state.sel.primary ? "Primary set" : "No primary line yet") +
      (state.sel.options.length ? " · comparing " + state.sel.options.length + " other line" + (state.sel.options.length === 1 ? "" : "s") : "") +
    "</div>" +
    cards +
    '<div class="ed-msg" id="s3msg" role="status" style="color:var(--err)"></div>' +
    '<div class="ed-nav"><button type="button" class="btn btn-ghost" id="s3back">← Similar projects</button>' +
    '<button type="button" class="btn" id="s3next">Review →</button></div></div>';

  // card covers and swatches come from the same photo pool the viewer uses
  el("edApp").querySelectorAll("img[data-mvpic]").forEach((img) => {
    const pr2 = prod(img.getAttribute("data-mvpic"));
    if (!pr2) return;
    const isPri = state.sel.primary && state.sel.primary.materialId === pr2.materialId;
    const first = coverPhoto(pr2, isPri ? state.sel.primary.colorId : null);
    if (first) { img.style.display = "none"; showPic(img, first.e, "block"); }
  });
  el("edApp").querySelectorAll("img[data-swatch]").forEach((img) => {
    const mat = img.closest(".ed-mat");
    const pr2 = mat ? prod(mat.dataset.mat) : null;
    const c = pr2 ? colorOf(pr2, img.getAttribute("data-swatch")) : null;
    if (c) showPic(img, galOf(c)[0], "");
  });
  document.querySelectorAll(".detBtn").forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); openMatModal(b.dataset.mat); }));

  document.querySelectorAll(".ed-mat").forEach((card) => {
    card.querySelector(".hd").addEventListener("click", (ev) => {
      if (ev.target.closest(".altBtn") || ev.target.closest(".detBtn")) return;
      if (card.dataset.selectable !== "true") return;
      const id = card.dataset.mat;
      if (state.sel.primary && state.sel.primary.materialId === id) return;
      const pr = prod(id);
      const was = optIndex(id) >= 0 ? state.sel.options[optIndex(id)] : null;
      const old = state.sel.primary;
      state.sel.primary = { materialId: id,
        // promoting a compared line keeps the colour the client was shown
        colorId: (was && was.colorId) || ((pr.colors && pr.colors[0]) ? pr.colors[0].colorId : null),
        profileId: (was && was.profileId) || ((pr.profiles && pr.profiles[0]) ? pr.profiles[0].profileId : null) };
      if (was) state.sel.options.splice(optIndex(id), 1);
      // the line it replaced stays on the table as a comparison
      if (old && old.materialId !== id && optIndex(old.materialId) < 0) state.sel.options.unshift(old);
      syncAlternative();
      renderStep3();
    });
  });
  document.querySelectorAll(".altBtn").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    const id = b.dataset.mat, i = optIndex(id);
    if (i >= 0) state.sel.options.splice(i, 1);
    else {
      if (state.sel.primary && state.sel.primary.materialId === id) return;
      const pr = prod(id);
      state.sel.options.push({ materialId: id,
        colorId: (pr.colors && pr.colors[0]) ? pr.colors[0].colorId : null,
        profileId: (pr.profiles && pr.profiles[0]) ? pr.profiles[0].profileId : null });
    }
    syncAlternative();
    renderStep3();
  }));
  const chipTap = (sel, key) => document.querySelectorAll(".ed-mat [" + sel + "]").forEach((chip) => {
    const fn = () => {
      const s = selFor(chip.closest(".ed-mat").dataset.mat);
      if (!s) return;
      s[key] = chip.getAttribute(sel);
      syncAlternative();
      renderStep3();
    };
    chip.addEventListener("click", fn);
    chip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
  });
  chipTap("data-color", "colorId");
  chipTap("data-profile", "profileId");
  // the viewer is open over this step — keep its contents in step with it
  if (!el("matModal").hidden && mv.materialId) renderMatModal();
  el("s3back").addEventListener("click", () => go(2));
  el("s3next").addEventListener("click", () => {
    if (!state.sel.primary) { el("s3msg").textContent = "Please select a primary material (or go back if you only need the comparison)."; return; }
    // a draft saved while a line was active can be reopened after that line goes back to review — never let it print
    // against something unsellable
    const chosen = prod(state.sel.primary.materialId);
    if (!chosen) { el("s3msg").textContent = "That material is no longer in the catalog — please pick another line."; return; }
    if (!isSelectable(chosen)) {
      el("s3msg").textContent = chosen.brandName + " " + lineName(chosen) + " is not available to quote right now — please pick another line.";
      return;
    }
    go(4);
  });
  paintSteps(); // a just-picked material unlocks steps 4-5 right away
}

/* ══ STEP 4 — review ══ */
async function renderStep4() {
  await loadCatalog();
  const p = state.project, P = state.prices;
  const snap = buildSnapshot(state.sel, state.catalog);
  const ref = state.referenceId && state.ranked ? state.ranked.find((r) => r.projectRef === state.referenceId) : null;
  const kv = (k, v) => '<div class="ed-kv"><span>' + k + '</span><span class="v">' + v + "</span></div>";
  el("edApp").innerHTML =
    '<div class="ed-card"><h2>🧾 Review before generating</h2>' +
    '<p class="ed-sub">Confirm the scope, the reference, and the material selection.</p>' +
    '<h3 style="margin:8px 0 2px;font-size:14px">Project</h3>' +
    kv("Client", esc(p.clientName) + (p.clientPhone ? " · " + esc(p.clientPhone) : "")) +
    kv("Address", esc([p.address, p.city].filter(Boolean).join(", "))) +
    kv("Type / complexity", esc(p.projectType) + " · " + esc(p.complexity)) +
    kv("Decking / framing", esc(p.deckingArea || 0) + " SF / " + esc(p.framingArea || 0) + " SF") +
    kv("Railing / stairs", esc(p.railing || 0) + " LF / " + esc(p.stairs || 0)) +
    (p.terrain || p.access ? kv("Site", esc([p.terrain, p.access].filter(Boolean).join(" · "))) : "") +
    '<h3 style="margin:16px 0 2px;font-size:14px">Historical reference</h3>' +
    (ref ? kv(esc(ref.projectName), ref.match + "% match" + (P ? " · " + money(ref.referencePrice) + " · $" + Number(ref.costPerPrimaryUnit || 0).toFixed(2) + "/SF" : ""))
      : '<p class="ed-sub">None selected — the estimate will show comparables only.</p>') +
    '<h3 style="margin:16px 0 2px;font-size:14px">Materials</h3>' +
    (snap ? kv("Primary", esc(snap.primary.officialName) + " · " + esc(snap.primary.colorName) +
        (snap.primary.nominalDimensions ? " · " + esc(snap.primary.nominalDimensions) : "")) +
        (snap.options || []).map((o, i) => kv("Comparison " + (i + 1), esc(o.officialName) + " · " + esc(o.colorName) +
          (o.nominalDimensions ? " · " + esc(o.nominalDimensions) : ""))).join("")
      : '<p class="ed-sub">No material selected.</p>') +
    (state.showRefs.length
      ? '<h3 style="margin:16px 0 2px;font-size:14px">Projects being shown to the client</h3>' +
        state.showRefs.map((id) => {
          const r2 = (state.ranked || []).find((x) => x.projectRef === id);
          return r2 ? kv(esc(r2.projectName), r2.match + "% match" + (P ? " · " + money(r2.referencePrice) : "")) : "";
        }).join("")
      : "") +
    (P
      ? '<div class="ed-warn">Material <b>pricing</b> is not included yet — the comparable totals come only from completed-project cost history. The rates below are <b>yours</b>, and only what you fill in is counted.</div>' +
        renderRateEditor()
      : '<div class="ed-warn">Your rates, the benchmark and the comparable range need the <b>prices</b> switch. The next step records the scope, the photos and the materials; someone with prices adds the amounts.</div>') +
    '<div class="ed-nav"><button type="button" class="btn btn-ghost" id="s4back">← Materials</button>' +
    '<button type="button" class="btn" id="s4next">' + (P ? "Generate preliminary estimate →" : "Continue →") + "</button></div></div>";
  if (P) wireRateEditor();
  el("s4back").addEventListener("click", () => go(3));
  el("s4next").addEventListener("click", () => go(5));
}

/* ══ the estimator's rates ══
   Five rates against quantities already captured in the scope, plus any number of extra items in the two shapes the
   shop actually quotes in: a crew for so many days, or a price with a markup on it. */
const RATE_FIELDS = [
  { k: "framingSF", label: "Framing", unit: "SF", qty: () => num(state.project.framingArea) },
  { k: "deckingSF", label: "Decking", unit: "SF", qty: () => num(state.project.deckingArea) },
  { k: "railingLF", label: "Railing", unit: "LF", qty: () => num(state.project.railing) },
  { k: "stairsEach", label: "Stairs", unit: "each", qty: () => num(state.project.stairs),
    hint: "per stair — bigger flights can be added as their own item below" },
  { k: "sidingSF", label: "Siding", unit: "SF", qty: () => num(state.pricing.sidingArea), qtyField: "sidingArea" },
];

function renderRateEditor() {
  const pc = state.pricing;
  const rows = RATE_FIELDS.map((f) => {
    const q = f.qty();
    const qtyCell = f.qtyField
      ? '<input type="number" min="0" step="any" class="rateQty" data-qty="' + f.qtyField + '" value="' + esc(pc[f.qtyField]) + '" placeholder="0" aria-label="' + f.label + ' quantity">'
      : '<span class="rq">' + (q || 0) + " " + f.unit + "</span>";
    return '<div class="ed-rate"><span class="lb">' + f.label + (f.hint ? "<small>" + f.hint + "</small>" : "") + "</span>" +
      '<span class="qt">' + qtyCell + "</span>" +
      '<span class="rt">$<input type="number" min="0" step="any" class="rateIn" data-rate="' + f.k +
        '" value="' + esc(pc.rates[f.k]) + '" placeholder="0.00" aria-label="' + f.label + ' rate"><small>/' + f.unit + "</small></span>" +
      '<span class="tt" data-rowtot="' + f.k + '">—</span></div>';
  }).join("");
  const items = (pc.items || []).map((it, i) => renderItemRow(it, i)).join("");
  return '<h3 style="margin:20px 0 2px;font-size:14px">Your rates for this job</h3>' +
    '<p class="ed-sub">Quantities come from the scope. Fill in the rates you are using at this location — leave any blank and it is simply left out.</p>' +
    '<div class="ed-rates"><div class="ed-rate hd"><span class="lb">Work</span><span class="qt">Quantity</span><span class="rt">Rate</span><span class="tt">Total</span></div>' +
    rows + "</div>" +
    '<h3 style="margin:20px 0 2px;font-size:14px">Additional items</h3>' +
    '<p class="ed-sub">Crew tasks are priced as <b>guys × days × 8 hours × your hourly rate</b>. Priced items take a markup.</p>' +
    '<div class="ed-grid" style="max-width:340px"><div><label for="pc_labor">Hourly rate for this location</label>' +
    '<input type="number" min="0" step="any" id="pc_labor" value="' + esc(pc.laborRate) + '" placeholder="0.00"></div></div>' +
    '<div id="edItems">' + (items || '<p class="ed-sub" style="margin:8px 0">No additional items yet.</p>') + "</div>" +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' +
    '<button type="button" class="btn btn-sm btn-ghost" id="addCrew">+ Crew task</button>' +
    '<button type="button" class="btn btn-sm btn-ghost" id="addPriced">+ Priced item</button></div>' +
    '<div id="edPriceTot"></div>';
}

function renderItemRow(it, i) {
  if (it.kind === "labor") {
    return '<div class="ed-item" data-i="' + i + '">' +
      '<input class="itName" data-f="name" value="' + esc(it.name) + '" placeholder="Task name — e.g. demo old deck" aria-label="Task name">' +
      '<span class="f"><input type="number" min="0" step="1" data-f="guys" value="' + esc(it.guys) + '" placeholder="0" aria-label="Guys"><small>guys</small></span>' +
      '<span class="f"><input type="number" min="0" step="any" data-f="days" value="' + esc(it.days) + '" placeholder="0" aria-label="Days"><small>days (8h)</small></span>' +
      '<span class="f">$<input type="number" min="0" step="any" data-f="rate" value="' + esc(it.rate) + '" placeholder="hourly" aria-label="Hourly rate"><small>/hr</small></span>' +
      '<span class="tt" data-itemtot="' + i + '">—</span>' +
      '<button type="button" class="btn btn-sm btn-ghost delItem" data-i="' + i + '" title="Remove" aria-label="Remove">✕</button></div>';
  }
  return '<div class="ed-item" data-i="' + i + '">' +
    '<input class="itName" data-f="name" value="' + esc(it.name) + '" placeholder="Item name — e.g. permit, dumpster" aria-label="Item name">' +
    '<span class="f">$<input type="number" min="0" step="any" data-f="price" value="' + esc(it.price) + '" placeholder="0.00" aria-label="Price"><small>price</small></span>' +
    '<span class="f"><select data-f="markup" aria-label="Markup">' + MARKUPS.map((m) =>
      '<option value="' + m + '"' + (num(it.markup) === m ? " selected" : "") + ">" + m + "%</option>").join("") + "</select><small>markup</small></span>" +
    '<span class="f"></span>' +
    '<span class="tt" data-itemtot="' + i + '">—</span>' +
    '<button type="button" class="btn btn-sm btn-ghost delItem" data-i="' + i + '" title="Remove" aria-label="Remove">✕</button></div>';
}

/* Totals refresh in place. Re-rendering the whole step on every keystroke would throw away focus mid-number, which
   is maddening on a tablet. */
function refreshRateTotals() {
  const t = pricingTotals(state.project, state.pricing);
  RATE_FIELDS.forEach((f) => {
    const cell = document.querySelector('[data-rowtot="' + f.k + '"]');
    if (!cell) return;
    const line = t.work.find((l) => l.label === f.label);
    cell.textContent = line ? money2(line.total) : "—";
  });
  t.items.forEach((l, i) => {
    const cell = document.querySelector('[data-itemtot="' + i + '"]');
    if (cell) cell.textContent = l.ready ? money2(l.total) : "—";
  });
  const box = el("edPriceTot");
  if (!box) return;
  box.innerHTML = t.priced
    ? '<div class="ed-note" style="margin-top:14px">' +
      '<div class="ed-kv"><span>Work at your rates</span><span class="v">' + money2(t.workTotal) + "</span></div>" +
      '<div class="ed-kv"><span>Additional items</span><span class="v">' + money2(t.itemsTotal) + "</span></div>" +
      '<div class="ed-kv"><span><b>Priced scope total</b></span><span class="v ed-total">' + money(t.total) + "</span></div>" +
      '<div style="font-size:11.5px;color:var(--text-muted);margin-top:6px">Your rates only — decking material is still pending pricing and is not in this figure.</div></div>'
    : '<p class="ed-sub" style="margin-top:12px">No rates entered yet — the estimate will show the historical comparables alone.</p>';
  saveDraftLocal();
}

function wireRateEditor() {
  document.querySelectorAll(".rateIn").forEach((i) => i.addEventListener("input", () => { state.pricing.rates[i.dataset.rate] = i.value; refreshRateTotals(); }));
  document.querySelectorAll(".rateQty").forEach((i) => i.addEventListener("input", () => { state.pricing[i.dataset.qty] = i.value; refreshRateTotals(); }));
  const lab = el("pc_labor");
  if (lab) lab.addEventListener("input", () => { state.pricing.laborRate = lab.value; refreshRateTotals(); });
  document.querySelectorAll(".ed-item").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll("[data-f]").forEach((f) => {
      const set = () => { state.pricing.items[i][f.dataset.f] = f.value; refreshRateTotals(); };
      f.addEventListener("input", set);
      f.addEventListener("change", set);
    });
  });
  document.querySelectorAll(".delItem").forEach((b) => b.addEventListener("click", () => { state.pricing.items.splice(Number(b.dataset.i), 1); renderStep4(); }));
  const ac = el("addCrew");
  if (ac) ac.addEventListener("click", () => { state.pricing.items.push({ kind: "labor", name: "", guys: "", days: "", rate: "" }); renderStep4(); });
  const ap = el("addPriced");
  if (ap) ap.addEventListener("click", () => { state.pricing.items.push({ kind: "priced", name: "", price: "", markup: 15 }); renderStep4(); });
  refreshRateTotals();
}

/* ══ STEP 5 — preliminary estimate ══ */
async function renderStep5() {
  await loadRefs(); await loadCatalog();
  if (!state.ranked) state.ranked = rankRefs(state.project, state.refs);
  state.estVersion = (state.estVersion || 0) + 1;
  state.output = buildOutput({ project: state.project, ranked: state.ranked, referenceId: state.referenceId, sel: state.sel,
    catalog: state.catalog, pricing: state.prices ? state.pricing : blankPricing() });
  const o = state.output, p = state.project, P = state.prices;
  if (!state.estimateRef) state.estimateRef = newEstimateRef();

  const bench = o.benchmark, range = o.range;
  let moneyHtml;
  if (P) {
    const benchRef = bench.present && state.ranked ? state.ranked.find((r) => r.projectRef === bench.projectRef) : null;
    const benchGal = benchRef ? galOf(benchRef) : [];
    const benchPic = benchGal.length
      ? '<div style="display:flex;gap:12px;align-items:center;margin:6px 0 2px">' +
        '<span class="ed-benchpic"><img style="display:none" data-bench-pic alt=""></span>' +
        '<span style="font-size:12px;color:var(--text-muted)">' + esc(bench.projectName) +
        " — completed project photo" + (benchGal.length > 1 ? "s (📷 " + benchGal.length + ")" : "") + "</span></div>"
      : "";
    const benchHtml = bench.present
      ? benchPic +
        '<div class="ed-kv"><span>Reference</span><span class="v">' + esc(bench.projectName) + " (" + (bench.match != null ? bench.match + "%" : "—") + ")</span></div>" +
        '<div class="ed-kv"><span>Historical cost/SF × your ' + esc(bench.currentAreaSF) + ' SF</span><span class="v">$' +
          (bench.costPerSF != null ? bench.costPerSF.toFixed(2) : "—") + " × " + esc(bench.currentAreaSF) + "</span></div>" +
        '<div class="ed-kv"><span><b>Benchmark total</b></span><span class="v ed-total">' + money(bench.total) + "</span></div>" +
        (!bench.eligibleForRange ? '<div class="ed-warn">Excluded from the comparable range: ' + esc(bench.exclusionReasons.join("; ")) + ".</div>" : "")
      : '<p class="ed-sub">' + esc(bench.note) + "</p>";
    let rangeHtml;
    if (range.st === "none") rangeHtml = '<div class="ed-warn">' + esc(range.note) + "</div>";
    else if (range.st === "single") rangeHtml =
      '<div class="ed-kv"><span>Single comparable value</span><span class="v ed-total">' + money(range.loTotal) + "</span></div>" +
      '<p class="ed-sub">' + esc(range.note) + "</p>";
    else rangeHtml =
      '<div class="ed-kv"><span>Comparable range for ' + esc(range.areaSF) + " SF</span>" +
      '<span class="v ed-total">' + money(range.loTotal) + " – " + money(range.hiTotal) + "</span></div>" +
      '<div class="ed-kv"><span>Cost per SF range</span><span class="v">$' + range.loCps.toFixed(2) + " – $" + range.hiCps.toFixed(2) + "</span></div>" +
      '<p class="ed-sub">' + esc(range.note) + "</p>";
    const rowsHtml = o.sourceRows.map((r) => "<tr><td>" + esc(r.projectName) +
      (r.isAnchor ? ' <span class="ed-badge hi" style="font-size:10px">reference</span>' : "") +
      (!r.inRange ? ' <span class="ed-badge lo" style="font-size:10px">outside range</span>' : "") +
      (r.isSample ? ' <span class="ed-badge sample" style="font-size:10px">sample</span>' : "") +
      "</td><td>" + esc(r.projectType) + '</td><td class="num">' + esc(r.refAreaSF || 0) + '</td><td class="num">' +
      (r.match != null ? r.match + "%" : "—") + '</td><td class="num">$' + Number(r.costPerSF || 0).toFixed(2) +
      '</td><td class="num"><b>' + money(r.total) + "</b></td></tr>").join("");
    moneyHtml =
      '<h3 style="margin:6px 0 4px;font-size:15px">1 · Selected reference benchmark</h3>' + benchHtml +
      '<h3 style="margin:18px 0 4px;font-size:15px">2 · Comparable project range</h3>' + rangeHtml +
      (o.sourceRows.length
        ? '<div style="overflow-x:auto"><table class="ed-tbl"><thead><tr><th>Project</th><th>Type</th><th class="num">SF</th><th class="num">Match</th><th class="num">$/SF</th><th class="num">At your SF</th></tr></thead><tbody>' +
          rowsHtml + "</tbody></table></div>"
        : "");
    state._benchGal = benchGal;
  } else {
    state._benchGal = [];
    moneyHtml = '<div class="ed-warn">The benchmark, the comparable range and the priced scope need the <b>prices</b> switch, so they are not shown here. ' +
      "Saving keeps the scope, photos, drawings and materials; any amounts already worked out on this estimate stay as they were.</div>" +
      (state.referenceId ? '<div class="ed-kv"><span>Reference</span><span class="v">' + esc(((state.ranked || []).find((r) => r.projectRef === state.referenceId) || {}).projectName || state.referenceId) + "</span></div>" : "");
  }

  const snap = o.selectionSnapshot;
  const assumptions = P ? o.assumptions : o.assumptions.filter((a) => !/Benchmark|Comparable|comparable|reference/.test(a));
  el("edApp").innerHTML =
    '<div class="ed-card"><h2>💵 Preliminary estimate <span style="font-size:12px;color:var(--text-muted)">' +
    esc(state.estimateRef) + " · v" + state.estVersion + "</span></h2>" +
    '<p class="ed-sub">' + esc(p.clientName) + " — " + esc([p.address, p.city].filter(Boolean).join(", ")) + " · " +
    esc(p.projectType) + " · " + esc(p.deckingArea || 0) + " SF</p>" +
    moneyHtml +
    '<h3 style="margin:18px 0 4px;font-size:15px">' + (P ? "3 · " : "") + "Materials</h3>" +
    (snap
      ? '<div class="ed-kv"><span>Primary</span><span class="v">' + esc(snap.primary.officialName) + " · " + esc(snap.primary.colorName) + "</span></div>" +
        (snap.options || []).map((op, i) => '<div class="ed-kv"><span>Option ' + (i + 2) + '</span><span class="v">' +
          esc(op.officialName) + " · " + esc(op.colorName) + "</span></div>").join("") +
        '<div class="ed-note">Material cost: <b>pending</b> — ' + esc(o.materialCost.note) + "</div>"
      : '<p class="ed-sub">No material selection recorded.</p>') +
    (P ? pricedScopeHtml(o.pricing) : "") +
    (state.media.photos.length || state.media.audioNotes.length
      ? '<h3 style="margin:18px 0 4px;font-size:15px">Project documentation</h3>' +
        (state.media.photos.length
          ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">' +
            state.media.photos.slice(0, 8).map((ph, i) =>
              '<span style="width:56px;height:56px;border-radius:8px;overflow:hidden;background:var(--surface-2);position:relative;display:inline-flex">' +
              (ph.path ? '<img style="display:none;width:100%;height:100%;object-fit:cover" data-doc="' + i + '" alt="">' : "") +
              (ph.ann && ph.ann.items && ph.ann.items.length
                ? '<span style="position:absolute;bottom:0;right:0;background:rgba(0,0,0,.65);color:#ffd47f;font-size:9px;font-weight:700;padding:1px 4px;border-radius:6px 0 0 0">✏️</span>' : "") +
              "</span>").join("") +
            (state.media.photos.length > 8 ? '<span style="font-size:11px;color:var(--text-muted);align-self:center">+' + (state.media.photos.length - 8) + " more</span>" : "") +
            "</div>"
          : "") +
        '<p class="ed-sub" style="margin:2px 0 0">📸 ' + state.media.photos.length + " photo" + (state.media.photos.length === 1 ? "" : "s") +
        " · 🎤 " + state.media.audioNotes.length + " voice note" + (state.media.audioNotes.length === 1 ? "" : "s") +
        " — attached to this estimate (edit them on step 1).</p>"
      : "") +
    '<h3 style="margin:18px 0 4px;font-size:15px">Assumptions &amp; notes</h3>' +
    '<ul class="ed-assump">' + assumptions.map((a) => "<li>" + esc(a) + "</li>").join("") + "</ul>" +
    '<div class="ed-warn no-print"><b>Internal preliminary reference.</b> Review by a DCR estimator is required before any number is shared with the client.</div>' +
    '<div class="ed-nav no-print"><button type="button" class="btn btn-ghost" id="s5back">← Review</button>' +
    '<span style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<select id="s5status" aria-label="Estimate status" style="width:auto;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text)">' +
    EST_STATUSES.map((s) => "<option" + (state.estStatus === s ? " selected" : "") + ">" + s + "</option>").join("") + "</select>" +
    '<button type="button" class="btn btn-ghost" id="s5print">🖨️ Print</button>' +
    (state.edit ? '<button type="button" class="btn" id="s5save">💾 Save estimate</button>' : "") + "</span></div>" +
    '<div class="ed-msg" id="s5msg" role="status"></div></div>';

  const benchImg = document.querySelector("img[data-bench-pic]");
  if (benchImg && state._benchGal.length) showPic(benchImg, state._benchGal[0], "");
  el("edApp").querySelectorAll("img[data-doc]").forEach((img) => showPic(img, state.media.photos[Number(img.dataset.doc)], ""));
  el("s5back").addEventListener("click", () => go(4));
  el("s5print").addEventListener("click", () => window.print());
  if (el("s5save")) el("s5save").addEventListener("click", saveEstimate);
  if (!state.edit) el("s5status").disabled = true;
}

async function saveEstimate() {
  const msg = el("s5msg"), btn = el("s5save");
  btn.disabled = true; msg.style.color = "var(--text-muted)"; msg.textContent = "Saving…";
  state.estStatus = el("s5status").value;
  try {
    await persist({ full: true });
    clearDraftLocal();
    msg.style.color = "var(--ok)";
    msg.textContent = "✓ Saved (" + state.estimateRef + " v" + state.estVersion + "). Find it any time on the Sales Estimates page.";
  } catch (e) {
    msg.style.color = "var(--err)";
    msg.textContent = state.conflict
      ? "Someone else saved this estimate meanwhile, so this was not saved over it. Reload the page to see their version."
      : errorText(e);
  }
  btn.disabled = false;
}

/* ══ reopen a saved estimate ══ */
async function loadSaved(id) {
  const est = await repo.getEstimate(id);
  if (!est) throw Object.assign(new Error("That estimate was not found — it may have been deleted."), { code: "PT404" });
  state.estimateId = est.id;
  state.rowVersion = est.version;
  state.pricesVersion = est.pricesVersion === undefined ? null : est.pricesVersion;
  state.estimateRef = est.estimateRef || "";
  state.estVersion = Number(est.estVersion) || 0;
  state.estStatus = est.estStatus || "draft";
  state.createdBy = est.createdBy || null;
  state.project = Object.assign(blankProject(), est.scope || {});
  const s = est.selection || {};
  if (s.sel) state.sel = s.sel;
  if (s.showRefs) state.showRefs = s.showRefs;
  if (state.prices && est.pricing) state.pricing = Object.assign(blankPricing(), est.pricing);
  normalizeSel(state);
  const media = est.media || {};
  state.media = { photos: media.photos || [], audioNotes: media.audioNotes || [] };
  normalizeNotes();
  state.referenceId = est.referenceRef || (s.referenceRef || null);
}

// A restored note can't still be "uploading" — the in-memory audio is gone. Keep the transcript either way; flag
// audio-less notes so the row says so.
function normalizeNotes() {
  (state.media.audioNotes || []).forEach((n) => { n.pending = false; if (!n.audioPath) n.failed = true; });
}

function letterhead() {
  const cfg = (window.DCR2_CONFIG && window.DCR2_CONFIG.COMPANY) || {};
  if (cfg.logo) el("phLogo").src = cfg.logo;
  el("phCo").innerHTML = "<b>" + esc(cfg.legalName || cfg.name || "") + "</b><br>" +
    [cfg.address, [cfg.phone, cfg.license].filter(Boolean).join(" · ")].filter(Boolean).map(esc).join("<br>");
}

function denied(text) {
  el("edSteps").hidden = true;
  el("edApp").innerHTML = '<div class="ed-card"><h2>Deck estimate</h2><p class="ed-sub">' + esc(text) + "</p></div>";
}

async function main() {
  try { state.me = await boot("sales"); } catch (e) { return; }
  try { state.access = await repo.salesAccess(state.me); } catch (e) { denied(errorText(e)); return; }
  if (!state.access.sales) {
    denied(state.access.missing
      ? "The database does not have Sales Estimates yet. Reload the page; if it keeps happening, tell the office."
      : "Sales Estimates needs the Sales estimates switch. Ask an admin to turn it on for you (DCR Desktop 2, Users).");
    return;
  }
  state.prices = seesSalesPrices(state.me, state.access);
  state.edit = salesEditor(state.me, state.access);
  letterhead();

  if (START_NEW) {
    // "+ New estimate" — a blank slate. Anything in progress was auto-saved already, so nothing is lost.
    clearDraftLocal();
    try { history.replaceState(null, "", "estimate-deck.html"); } catch (e) { /* */ }
  } else if (EDIT_ID) {
    try { await loadSaved(EDIT_ID); } catch (e) {
      toast(errorText(e), "error");
    }
  } else {
    try {
      const draft = JSON.parse(store.get(draftKey(), "null"));
      if (draft && draft.project && draft.project.clientName) {
        state.project = Object.assign(blankProject(), draft.project);
        state.referenceId = draft.referenceId || null;
        state.sel = draft.sel || state.sel;
        if (draft.showRefs) state.showRefs = draft.showRefs;
        if (state.prices && draft.pricing) state.pricing = Object.assign(blankPricing(), draft.pricing);
        normalizeSel(state);
        state.estimateId = draft.estimateId || null;
        state.rowVersion = draft.rowVersion === undefined ? null : draft.rowVersion;
        state.pricesVersion = draft.pricesVersion === undefined ? null : draft.pricesVersion;
        state.estimateRef = draft.estimateRef || "";
        state.estVersion = draft.estVersion || 0;
        state.estStatus = draft.estStatus || "draft";
        if (draft.media) {
          state.media = { photos: draft.media.photos || [], audioNotes: draft.media.audioNotes || [] };
          normalizeNotes();
        }
      }
    } catch (e) { /* a broken draft starts fresh */ }
  }
  if (state.estimateId && !EDIT_ID) {
    // the draft names a saved row: the URL says which, so a reload reopens the saved copy
    try { history.replaceState(null, "", "estimate-deck.html?id=" + encodeURIComponent(state.estimateId)); } catch (e) { /* */ }
  }
  wireSteps();
  el("mvClose").addEventListener("click", closeMatModal);
  el("matModal").addEventListener("click", (e) => { if (e.target === el("matModal")) closeMatModal(); });
  go(1);
}

main();

// The pure logic and the state, for the end-to-end checks (same pattern as the old page's window.DeckEstimate).
if (typeof window !== "undefined") window.DCR2DeckEstimate = { state };
