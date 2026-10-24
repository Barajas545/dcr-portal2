/* Sales Estimates — the hub (port of the old estimates.html / estimates.js; BLUEPRINT 3.3.11 "Sales estimates
   and materials library", Appendix A "sales": the sales tables plus the sales-media bucket).

   Saved estimates (sales_estimates) and the reference-project comps library (sales_reference_projects); the trade
   wizards launch from the trade cards (deck live; the others still "coming next", as in the old portal).

   Who (Q10, owner 2026-10-21): the Sales estimates switch (profiles.can_sales_estimates; on for admins by
   default). Anyone else is told so and the page asks the database for nothing more. The amounts — an estimate's
   benchmark and range (sales_estimate_prices) and a comp's final price and cost per SF (sales_reference_prices) —
   need the prices switch as well: without it they never reach the browser (the embeds come back null) and the
   columns say so. Writing is app.can_edit('sales'): an admin, or a manager with the switch; anyone else with it
   reads (the comps open read only, no New or Delete); a price also needs the prices switch to be written. The
   database decides every write (BLUEPRINT 2.1); the page only hides what it would refuse.

   What changed from the old page:
   * the data is Desktop 2's database (repo/sales.js), not SharePoint lists; there is no "set up the lists" step;
   * a comp's photos are in the private sales-media bucket (js/sales/gallery.js, signed URLs);
   * a delete and every save carry the version read (409 = someone else changed it: the list is read again);
   * notes that quote an amount are masked for someone without the prices switch (display only, BLUEPRINT 2.1
     principle 8) and are then not editable here, so a masked copy can never be saved over the words. */

import { boot, el, esc, toast, confirmBox, errorText } from "./shell.js";
import * as repo from "../repo/sales.js";
import * as gallery from "../sales/gallery.js";
import { money } from "../sales/deck-engine.js";
import { seesSalesPrices, salesEditor, fmtDay, masked, hasAmount, refFields, refPriceFields, costPerSf } from "../map/sales.js";

const state = { me: null, access: null, prices: false, edit: false, estimates: [], refs: [], editingRef: null, refGallery: null };

function cps(v) { return v !== null && v !== undefined && isFinite(Number(v)) ? "$" + Number(v).toFixed(2) : "—"; }

/* ── saved estimates ── */
function renderEstimates() {
  const q = (el("seSearch").value || "").trim().toLowerCase();
  const rows = state.estimates.filter((e2) => {
    if (!q) return true;
    return [e2.clientName, e2.siteAddress, e2.city, e2.estStatus, e2.trade, e2.projectType, e2.estimateRef]
      .join(" ").toLowerCase().indexOf(q) !== -1;
  });
  if (!rows.length) {
    el("seList").innerHTML = '<div class="se-empty">' +
      (state.estimates.length ? "No estimates match your search." : "No estimates saved yet — start one with a trade card above.") + "</div>";
    return;
  }
  const P = state.prices;
  el("seList").innerHTML =
    '<div style="overflow-x:auto"><table class="se-tbl"><thead><tr>' +
    "<th>Client / address</th><th>Trade</th><th>Type</th><th class='num'>SF</th>" +
    (P ? "<th class='num'>Benchmark</th><th class='num'>Range</th>" : "") +
    "<th>Status</th><th>Updated</th><th></th>" +
    "</tr></thead><tbody>" +
    rows.map((e2) => {
      const range = (e2.rangeLowTotal || e2.rangeHighTotal)
        ? money(e2.rangeLowTotal) + (e2.rangeHighTotal && e2.rangeHighTotal !== e2.rangeLowTotal ? " – " + money(e2.rangeHighTotal) : "")
        : "—";
      return '<tr class="row" data-id="' + esc(e2.id) + '" tabindex="0">' +
        "<td><b>" + (e2.clientName ? esc(e2.clientName) : '<span style="color:var(--text-muted);font-weight:400">(untitled draft)</span>') +
        "</b><br><span style='font-size:11.5px;color:var(--text-muted)'>" +
        esc([e2.siteAddress, e2.city].filter(Boolean).join(", ")) + "</span></td>" +
        "<td>" + esc(e2.trade || "") + "</td><td>" + esc(e2.projectType || "") + "</td>" +
        "<td class='num'>" + esc(e2.primaryAreaSF || "") + "</td>" +
        (P ? "<td class='num'>" + money(e2.benchmarkTotal) + "</td><td class='num'>" + range + "</td>" : "") +
        "<td><span class='se-status st-" + esc(e2.estStatus || "draft") + "'>" + esc(e2.estStatus || "draft") + "</span></td>" +
        "<td style='white-space:nowrap'>" + esc(fmtDay(e2.lastModified)) + "</td>" +
        (!state.edit ? "<td></td>" :
          "<td><button type='button' class='btn btn-ghost btn-sm delEst' data-id='" + esc(e2.id) + "' title='Delete' aria-label='Delete this estimate'>🗑</button></td>") +
        "</tr>";
    }).join("") + "</tbody></table></div>";

  el("seList").querySelectorAll("tr.row").forEach((tr) => {
    const go = (ev) => {
      if (ev.target.closest(".delEst")) return;
      location.href = "estimate-deck.html?id=" + encodeURIComponent(tr.dataset.id);
    };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(ev); });
  });
  el("seList").querySelectorAll(".delEst").forEach((b) => {
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const row = state.estimates.find((x) => String(x.id) === b.dataset.id);
      if (!row) return;
      if (!(await confirmBox("This cannot be undone.", { title: "Delete this estimate?", danger: true, okText: "Delete" }))) return;
      try {
        await repo.deleteEstimate(row.id, row.version);
        state.estimates = state.estimates.filter((x) => x !== row);
        renderEstimates();
        toast("Estimate deleted.", "ok");
      } catch (e2) {
        toast(errorText(e2), "error");
        await loadEstimates();
      }
    });
  });
}

/* ── reference projects ── */
function renderRefs() {
  if (!state.refs.length) {
    el("refList").innerHTML = '<div class="se-empty">No past projects in the comps library yet.</div>';
    return;
  }
  const P = state.prices;
  el("refList").innerHTML =
    '<div style="overflow-x:auto"><table class="se-tbl"><thead><tr>' +
    "<th>Project</th><th>Type</th><th class='num'>SF</th><th class='num'>Rail LF</th>" +
    (P ? "<th class='num'>Price</th><th class='num'>$/SF</th>" : "") + "<th>Active</th>" +
    "</tr></thead><tbody>" +
    state.refs.map((r) => {
      const g = gallery.parse(r).filter(gallery.showable);
      const thumb = g.length
        ? '<span style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:var(--surface-2);flex-shrink:0;display:inline-flex">' +
          '<img style="display:none;width:100%;height:100%;object-fit:cover" data-refpic="' + esc(r.id) + '" alt=""></span>'
        : "";
      return '<tr class="row" data-id="' + esc(r.id) + '" tabindex="0"><td><div style="display:flex;gap:10px;align-items:center">' + thumb +
        "<div><b>" + esc(r.projectName || r.projectRef) + "</b>" +
        (r.isSample ? ' <span class="se-badge-sample">sample</span>' : "") +
        (g.length ? ' <span style="font-size:10.5px;color:var(--text-muted)">📷 ' + g.length + "</span>" : "") +
        "<br><span style='font-size:11.5px;color:var(--text-muted)'>" +
        esc([r.projectRef, r.city, r.completedDate].filter(Boolean).join(" · ")) + "</span></div></div></td>" +
        "<td>" + esc(r.projectType || "") + "</td>" +
        "<td class='num'>" + esc(r.primaryAreaSF || 0) + "</td>" +
        "<td class='num'>" + esc(r.railingLF || 0) + "</td>" +
        (P ? "<td class='num'>" + money(r.referencePrice) + "</td><td class='num'>" + cps(r.costPerPrimaryUnit) + "</td>" : "") +
        "<td>" + (r.activeAsReference === false ? "No" : "Yes") + "</td></tr>";
    }).join("") + "</tbody></table></div>";

  el("refList").querySelectorAll("tr.row").forEach((tr) => {
    const go = () => {
      const r = state.refs.find((x) => String(x.id) === tr.dataset.id);
      if (r) openRefModal(r);
    };
    tr.addEventListener("click", go);
    tr.addEventListener("keydown", (ev) => { if (ev.key === "Enter") go(); });
  });
  // the cover thumbnails (signed URLs)
  state.refs.forEach((r) => {
    const img = el("refList").querySelector('img[data-refpic="' + CSS.escape(String(r.id)) + '"]');
    if (!img) return;
    img.addEventListener("load", () => { img.style.display = ""; });
    gallery.srcInto(img, gallery.parse(r).filter(gallery.showable)[0]);
  });
}

function openRefModal(r) {
  state.editingRef = r || null;
  const P = state.prices;
  el("refTitle").textContent = r ? "Edit past project" : "Add past project";
  el("refMsg").textContent = "";
  el("r_ref").value = r ? r.projectRef || "" : "";
  el("r_name").value = r ? r.projectName || "" : "";
  el("r_city").value = r ? r.city || "" : "";
  el("r_type").value = r && r.projectType ? r.projectType : "new-deck";
  el("r_cx").value = r && r.complexity ? r.complexity : "standard";
  el("r_done").value = r ? r.completedDate || "" : "";
  el("r_sf").value = r ? r.primaryAreaSF ?? "" : "";
  el("r_frame").value = r ? r.secondaryAreaSF ?? "" : "";
  el("r_rail").value = r ? r.railingLF ?? "" : "";
  el("r_stairs").value = r ? r.stairs ?? "" : "";
  el("r_price").value = P && r ? r.referencePrice ?? "" : "";
  el("r_hours").value = r ? r.totalManHours ?? "" : "";
  el("r_mfr").value = r ? r.deckingManufacturer || "" : "";
  el("r_line").value = r ? r.productLine || "" : "";
  // notes quoting an amount: masked and read only without the prices switch (a masked copy is never saved)
  const notes = r ? r.notes || "" : "";
  const lockNotes = !P && hasAmount(notes);
  el("r_notes").value = P ? notes : masked(notes);
  el("r_notes").disabled = lockNotes;
  el("r_notes").title = lockNotes ? "These notes quote an amount, so they are shown masked and cannot be edited without the prices switch." : "";
  el("r_active").value = r && r.activeAsReference === false ? "false" : "true";
  el("refDelete").style.display = r && state.edit ? "" : "none";
  el("refSave").style.display = state.edit ? "" : "none";
  el("refCancel").textContent = state.edit ? "Cancel" : "Close";
  document.querySelectorAll("#refModal input, #refModal select, #refModal textarea").forEach((n) => {
    if (n.id === "r_cps") return;
    if (!state.edit) n.disabled = true;
    else if (n.id !== "r_notes") n.disabled = false;
  });
  if (!state.edit) el("refTitle").textContent = "Past project";
  document.querySelectorAll("#refModal .se-money").forEach((n) => { n.hidden = !P; });
  el("r_noPrice").hidden = P;
  updateCps();
  if (state.refGallery) state.refGallery.destroy();
  state.refGallery = gallery.mount(el("refGallery"), { initial: gallery.parse(r), readOnly: !state.edit });
  el("refModal").classList.add("open");
  el("r_name").focus();
}
function closeRefModal() {
  el("refModal").classList.remove("open");
  if (state.refGallery) { state.refGallery.destroy(); state.refGallery = null; }
}
function updateCps() {
  const v = costPerSf(el("r_price").value, el("r_sf").value);
  el("r_cps").value = v === null ? "" : "$" + v.toFixed(2);
}

async function saveRef() {
  const P = state.prices;
  const sf = Number(el("r_sf").value) || 0, price = Number(el("r_price").value) || 0;
  const form = {
    projectRef: el("r_ref").value.trim() || ("DCR-DECK-" + Date.now()),
    projectName: el("r_name").value.trim(),
    city: el("r_city").value.trim(),
    projectType: el("r_type").value, complexity: el("r_cx").value,
    completedDate: el("r_done").value,
    primaryAreaSF: sf, secondaryAreaSF: Number(el("r_frame").value) || 0,
    railingLF: Number(el("r_rail").value) || 0, stairs: Number(el("r_stairs").value) || 0,
    totalManHours: Number(el("r_hours").value) || 0,
    deckingManufacturer: el("r_mfr").value.trim(), productLine: el("r_line").value.trim(),
    activeAsReference: el("r_active").value === "true",
    pictures: state.refGallery ? state.refGallery.get() : [],
  };
  if (!el("r_notes").disabled) form.notes = el("r_notes").value;
  if (!form.projectName) { el("refMsg").textContent = "Project name is required."; return; }
  if (!(sf > 0)) { el("refMsg").textContent = "Decking area is required."; return; }
  if (P && !(price > 0)) { el("refMsg").textContent = "Final price is required — it drives the cost history."; return; }
  if (state.refGallery && state.refGallery.uploading()) { el("refMsg").textContent = "Still uploading photos — one moment…"; return; }
  el("refSave").disabled = true;
  el("refMsg").textContent = "Saving…";
  try {
    const r = state.editingRef;
    await repo.saveRef(r ? r.id : null, r ? r.version : null, refFields(form, r),
      P ? refPriceFields({ referencePrice: price, primaryAreaSF: sf }) : null, r ? r.pricesVersion : null);
    closeRefModal();
    await loadRefs();
    toast("Saved.", "ok");
  } catch (e2) {
    el("refMsg").textContent = errorText(e2);
    if (e2 && (e2.code === "PT409" || e2.status === 409)) await loadRefs();
  }
  el("refSave").disabled = false;
}

async function deleteRef() {
  const r = state.editingRef;
  if (!r) return;
  if (!(await confirmBox("Delete this reference project?", { title: "Delete reference", danger: true, okText: "Delete" }))) return;
  try {
    await repo.deleteRef(r.id, r.version);
    closeRefModal();
    await loadRefs();
  } catch (e2) { el("refMsg").textContent = errorText(e2); }
}

async function loadRefs() {
  try {
    state.refs = await repo.listRefs({ all: true });
    renderRefs();
  } catch (e2) {
    el("refList").innerHTML = '<div class="se-empty">' + esc(errorText(e2)) + "</div>";
  }
}
async function loadEstimates() {
  try {
    state.estimates = await repo.listEstimates();
    renderEstimates();
  } catch (e2) {
    el("seList").innerHTML = '<div class="se-empty">' + esc(errorText(e2)) + "</div>";
  }
}

function denied(text) {
  el("seMain").hidden = true;
  el("seIntro").hidden = true;          // "Start with a trade:" over a page that offers none
  const box = el("seDenied");
  box.textContent = text;
  box.hidden = false;
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
  gallery.useStore(repo.mediaStore("references"));
  el("seMain").hidden = false;
  el("seNoPrices").hidden = state.prices;
  if (!state.edit) {
    // a reader: no new estimate, no new comp (the database would refuse them); the saved ones open to read
    el("seNew").hidden = true;
    el("refAdd").hidden = true;
    el("seTradeDeck").classList.add("off");
    el("seTradeDeck").setAttribute("aria-disabled", "true");
    el("seReadOnly").hidden = false;
  }

  el("seSearch").addEventListener("input", renderEstimates);
  el("seReload").addEventListener("click", loadEstimates);
  el("seNew").addEventListener("click", () => { location.href = "estimate-deck.html?new=1"; });
  document.querySelectorAll(".se-trade.soon").forEach((a) => a.addEventListener("click", (e) => e.preventDefault()));
  el("refAdd").addEventListener("click", () => openRefModal(null));
  el("refCancel").addEventListener("click", closeRefModal);
  el("refModal").addEventListener("click", (e2) => { if (e2.target === el("refModal")) closeRefModal(); });
  document.addEventListener("keydown", (e2) => { if (e2.key === "Escape" && el("refModal").classList.contains("open")) closeRefModal(); });
  el("refSave").addEventListener("click", saveRef);
  el("r_sf").addEventListener("input", updateCps);
  el("r_price").addEventListener("input", updateCps);
  el("refDelete").addEventListener("click", deleteRef);

  await Promise.all([loadEstimates(), loadRefs()]);
}

main();
