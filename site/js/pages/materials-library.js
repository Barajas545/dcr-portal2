/* Materials Library (port of the old materials-library.html / materials-library.js; BLUEPRINT 3.3.11 "Sales
   estimates and materials library": sales_materials, no money).

   One table (sales_materials) organized Division -> Category -> Sub-category -> name, one row per product AND one
   row per color (the kind tells them apart; a color points at its product by material id). Every item carries a
   picture gallery (pictures: entries {path, …} in the private sales-media bucket, opened with signed URLs); the
   first entry is the cover shown on cards and in the deck estimate wizard.

   Who (Q10): the Sales estimates switch reads it; app.can_edit('sales') — an admin, or a manager with the switch —
   writes it (the database decides; the page only hides what it would refuse: a reader opens an item read only).
   Nothing here is money.

   What changed from the old page:
   * the rows are Desktop 2's database (repo/sales.js), saved with the version read (409: someone else changed it,
     the library is read again);
   * the "URL" picture intake is gone (the site's security policy shows no picture from another site); an old link
     entry is kept as a link tile;
   * deleting a product with colors says how many colors it has, and deletes them with it (one call each,
     colors first), instead of leaving orphan colors behind. */

import { boot, el, esc, toast, confirmBox, errorText } from "./shell.js";
import * as repo from "../repo/sales.js";
import * as gallery from "../sales/gallery.js";
import { materialFields, slugId, salesEditor } from "../map/sales.js";

const CSI_DIVISIONS = [
  "01 - General Requirements", "02 - Existing Conditions", "03 - Concrete",
  "04 - Masonry", "05 - Metals", "06 - Wood, Plastics & Composites",
  "07 - Thermal & Moisture Protection", "08 - Openings", "09 - Finishes",
  "10 - Specialties", "11 - Equipment", "12 - Furnishings",
  "13 - Special Construction", "14 - Conveying Equipment", "22 - Plumbing",
  "23 - HVAC", "26 - Electrical", "27 - Communications",
  "28 - Electronic Safety & Security", "31 - Earthwork",
  "32 - Exterior Improvements", "33 - Utilities",
];

const state = { me: null, edit: false, rows: [], editing: null, editingKind: "product", parentMaterialId: null, galleryHandle: null };

function products() { return state.rows.filter((r) => r.itemKind === "product"); }
function colorsOf(materialId) { return state.rows.filter((r) => r.itemKind === "color" && r.materialId === materialId); }
function pics(r) { return gallery.parse(r).filter(gallery.showable); }

/* ══ grouped catalog view ══ */
function render() {
  const q = (el("mlSearch").value || "").trim().toLowerCase();
  const list = products().filter((p) => {
    if (!q) return true;
    const hay = [p.itemName, p.brandName, p.description, p.marketTier, p.division, p.category, p.subCategory]
      .concat(colorsOf(p.materialId).map((c) => c.itemName)).join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  });
  if (!list.length) {
    el("mlGroups").innerHTML = '<div class="ml-empty">' + (state.rows.length ? "Nothing matches your search." : "No materials yet — add your first one.") + "</div>";
    return;
  }
  // Division -> Category -> SubCategory (alphabetical at each level, names within)
  const tree = {};
  list.forEach((p) => {
    const d = p.division || "Unassigned division";
    const c = p.category || "Uncategorized";
    const s = p.subCategory || "General";
    ((tree[d] = tree[d] || {})[c] = tree[d][c] || {})[s] = (tree[d][c][s] || []).concat([p]);
  });
  let html = "";
  Object.keys(tree).sort().forEach((d) => {
    html += '<div class="ml-div">' + esc(d) + "</div>";
    Object.keys(tree[d]).sort().forEach((c) => {
      html += '<div class="ml-cat">' + esc(c) + "</div>";
      Object.keys(tree[d][c]).sort().forEach((s) => {
        html += '<div class="ml-subcat">' + esc(s) + "</div>" + '<div class="ml-grid">';
        tree[d][c][s].sort((a, b) => String(a.itemName).localeCompare(b.itemName)).forEach((p) => { html += productCard(p); });
        html += "</div>";
      });
    });
  });
  el("mlGroups").innerHTML = html;
  hydrateCards();
  wireCards();
}

function productCard(p) {
  const cols = colorsOf(p.materialId);
  const g = pics(p);
  return '<div class="ml-card">' +
    '<div class="ml-pic" data-edit="' + esc(p.id) + '" role="button" tabindex="0" aria-label="Edit ' + esc(p.itemName) + '">' +
    '<img style="display:none" data-picfor="' + esc(p.id) + '" alt=""><span class="ph">🪵</span>' +
    (p.marketTier ? '<span class="tier">' + esc(p.marketTier) + "</span>" : "") +
    (p.itemStatus !== "active" ? '<span class="stat">' + esc(String(p.itemStatus || "").replace(/_/g, " ")) + "</span>" : "") +
    (g.length > 1 ? '<span class="pcount">📷 ' + g.length + "</span>" : "") +
    "</div>" +
    '<div class="ml-body">' +
    '<div class="ml-name">' + esc(p.itemName) + "</div>" +
    '<div class="ml-desc">' + esc(p.description || "") + "</div>" +
    '<div style="font-size:11px;color:var(--text-muted)">' +
    [p.brandName, p.warrantySummary, (p.selectable === false ? "not offered" : "offered in estimates")].filter(Boolean).map(esc).join(" · ") + "</div>" +
    '<div class="ml-colors">' +
    cols.map((cc) => '<span class="ml-swatch" title="' + esc(cc.itemName) + '" data-editcolor="' + esc(cc.id) + '" role="button" tabindex="0" aria-label="Edit color ' + esc(cc.itemName) + '">' +
      '<img style="display:none" data-picfor="' + esc(cc.id) + '" alt=""><span class="cn">' + esc((cc.itemName || "").slice(0, 10)) + "</span></span>").join("") +
    (state.edit ? '<span class="ml-swatch addc" title="Add color" data-addcolor="' + esc(p.materialId) + '" role="button" tabindex="0" aria-label="Add a color">＋</span>' : "") +
    "</div>" +
    '<div class="ml-actions"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(p.id) + '">' + (state.edit ? "✏️ Edit" : "Open") + "</button></div>" +
    "</div></div>";
}

function hydrateCards() {
  state.rows.forEach((r) => {
    const g = pics(r);
    if (!g.length) return;
    const img = el("mlGroups").querySelector('img[data-picfor="' + CSS.escape(String(r.id)) + '"]');
    if (!img) return;
    img.addEventListener("load", () => {
      img.style.display = "";
      const ph = img.parentElement.querySelector(".ph, .cn");
      if (ph) ph.style.display = "none";
    });
    gallery.srcInto(img, g[0]);
  });
}

function onTap(n, fn) {
  n.addEventListener("click", fn);
  n.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(e); } });
}
function wireCards() {
  el("mlGroups").querySelectorAll("[data-edit]").forEach((n) => onTap(n, () => {
    const row = state.rows.find((r) => String(r.id) === n.dataset.edit);
    if (row) openModal(row, "product");
  }));
  el("mlGroups").querySelectorAll("[data-editcolor]").forEach((n) => onTap(n, (ev) => {
    ev.stopPropagation();
    const row = state.rows.find((r) => String(r.id) === n.dataset.editcolor);
    if (row) openModal(row, "color");
  }));
  el("mlGroups").querySelectorAll("[data-addcolor]").forEach((n) => onTap(n, (ev) => {
    ev.stopPropagation();
    state.parentMaterialId = n.dataset.addcolor;
    openModal(null, "color");
  }));
}

/* ══ editor modal ══ */
function buildDatalists() {
  const divs = {}, cats = {}, subs = {};
  CSI_DIVISIONS.forEach((d) => { divs[d] = 1; });
  state.rows.forEach((r) => {
    if (r.division) divs[r.division] = 1;
    if (r.category) cats[r.category] = 1;
    if (r.subCategory) subs[r.subCategory] = 1;
  });
  const fill = (id, obj) => { el(id).innerHTML = Object.keys(obj).sort().map((v) => '<option value="' + esc(v) + '">').join(""); };
  fill("dlDivisions", divs); fill("dlCategories", cats); fill("dlSubCats", subs);
}

function openModal(row, kind) {
  state.editing = row;
  state.editingKind = kind;
  if (row && kind === "color") state.parentMaterialId = row.materialId;
  const parent = kind === "color" ? products().find((p) => p.materialId === state.parentMaterialId) : null;
  el("mTitle").textContent = kind === "color"
    ? (row ? "Edit color — " + row.itemName : "Add color" + (parent ? " — " + parent.itemName : ""))
    : (row ? "Edit material" : "Add material");
  el("mName").value = row ? row.itemName || "" : "";
  el("mDivision").value = row ? row.division || "" : (parent ? parent.division || "" : "06 - Wood, Plastics & Composites");
  el("mCategory").value = row ? row.category || "" : (parent ? parent.category || "" : "");
  el("mSubCat").value = row ? row.subCategory || "" : (parent ? parent.subCategory || "" : "");
  el("mBrand").value = row ? row.brandName || "" : (parent ? parent.brandName || "" : "");
  el("mTier").value = row && row.marketTier ? row.marketTier : "Mid";
  el("mStatus").value = row && row.itemStatus ? row.itemStatus : "active";
  el("mSelectable").value = row && row.selectable === false ? "false" : "true";
  el("mDesc").value = row ? row.description || "" : "";
  el("mHigh").value = row ? row.salesHighlights || "" : "";
  el("mWarranty").value = row ? row.warrantySummary || "" : "";
  el("mManUrl").value = row ? row.manufacturerUrl || "" : "";
  el("mMsg").textContent = "";
  el("mDelete").style.display = row && state.edit ? "" : "none";
  el("mSave").style.display = state.edit ? "" : "none";
  el("mCancel").textContent = state.edit ? "Cancel" : "Close";
  document.querySelectorAll("#mlModal input, #mlModal select, #mlModal textarea").forEach((n) => { n.disabled = !state.edit; });
  if (!state.edit) el("mTitle").textContent = row ? row.itemName : "";
  ["mTierWrap", "mDescWrap", "mHighWrap", "mWarrWrap"].forEach((id) => { el(id).style.display = kind === "color" ? "none" : ""; });
  if (state.galleryHandle) state.galleryHandle.destroy();
  state.galleryHandle = gallery.mount(el("mGallery"), { initial: gallery.parse(row), readOnly: !state.edit });
  el("mlModal").classList.add("open");
  el("mName").focus();
}
function closeModal() {
  el("mlModal").classList.remove("open");
  if (state.galleryHandle) { state.galleryHandle.destroy(); state.galleryHandle = null; }
  state.editing = null;
}

/* ══ save / delete / load ══ */
async function save() {
  const kind = state.editingKind, row = state.editing;
  const name = el("mName").value.trim();
  if (!name) { el("mMsg").textContent = "Name is required."; return; }
  const man = el("mManUrl").value.trim();
  if (man && !gallery.safeUrl(man)) { el("mMsg").textContent = "The manufacturer page must start with https://"; return; }
  if (state.galleryHandle && state.galleryHandle.uploading()) { el("mMsg").textContent = "Still uploading photos — one moment…"; return; }
  const form = {
    itemKind: kind, trade: "deck", itemName: name,
    division: el("mDivision").value.trim(), category: el("mCategory").value.trim(), subCategory: el("mSubCat").value.trim(),
    brandName: el("mBrand").value.trim(), itemStatus: el("mStatus").value, selectable: el("mSelectable").value === "true",
    warrantySummary: el("mWarranty").value.trim(), manufacturerUrl: man,
    pictures: state.galleryHandle ? state.galleryHandle.get() : [],
  };
  if (kind === "product") {
    form.marketTier = el("mTier").value;
    form.description = el("mDesc").value;
    form.salesHighlights = el("mHigh").value;
    form.materialId = row ? row.materialId : slugId(name);
    if (!row) form.itemId = form.materialId;
  } else {
    form.materialId = state.parentMaterialId;
    if (!row) form.itemId = state.parentMaterialId + "-" + slugId(name);
  }
  el("mSave").disabled = true;
  el("mMsg").textContent = "Saving…";
  try {
    await repo.saveMaterial(row ? row.id : null, row ? row.version : null, materialFields(form, row));
    closeModal();
    await load();
    toast("Saved.", "ok");
  } catch (e) {
    el("mMsg").textContent = errorText(e);
    if (e && (e.code === "PT409" || e.status === 409)) await load();
  }
  el("mSave").disabled = false;
}

async function remove() {
  const row = state.editing;
  if (!row) return;
  const kids = state.editingKind === "product" ? colorsOf(row.materialId) : [];
  const warn = state.editingKind === "product"
    ? (kids.length ? "Its " + kids.length + " color" + (kids.length === 1 ? " is" : "s are") + " deleted with it. This cannot be undone." : "This cannot be undone.")
    : "This cannot be undone.";
  if (!(await confirmBox(warn, { title: state.editingKind === "product" ? "Delete this material?" : "Delete this color?", danger: true, okText: "Delete" }))) return;
  try {
    for (const c of kids) await repo.deleteMaterial(c.id, c.version);
    await repo.deleteMaterial(row.id, row.version);
    closeModal();
    await load();
  } catch (e) {
    el("mMsg").textContent = errorText(e);
    await load();
  }
}

async function load() {
  try {
    state.rows = await repo.listMaterials();
    buildDatalists();
    render();
  } catch (e) {
    el("mlGroups").innerHTML = '<div class="ml-empty">' + esc(errorText(e)) + "</div>";
  }
}

function denied(text) {
  el("mlAdd").hidden = true;
  el("mlSearch").hidden = true;
  el("mlSub").hidden = true;
  el("mlGroups").innerHTML = '<div class="ml-empty">' + esc(text) + "</div>";
}

async function main() {
  try { state.me = await boot("sales"); } catch (e) { return; }
  let access;
  try { access = await repo.salesAccess(state.me); } catch (e) { denied(errorText(e)); return; }
  if (!access.sales) {
    denied(access.missing
      ? "The database does not have Sales Estimates yet. Reload the page; if it keeps happening, tell the office."
      : "The Materials Library belongs to Sales Estimates, which needs the Sales estimates switch. Ask an admin to turn it on (DCR Desktop 2, Users).");
    return;
  }
  gallery.useStore(repo.mediaStore("materials"));
  state.edit = salesEditor(state.me, access);
  if (!state.edit) {
    el("mlAdd").hidden = true;
    el("mlSub").textContent = "Organized by construction division → category → sub-category. Open a card or a color square to see it. " +
      "Changing the library is for an admin, or a manager with the Sales estimates switch.";
  }
  el("mlSearch").addEventListener("input", render);
  el("mlAdd").addEventListener("click", () => { state.parentMaterialId = null; openModal(null, "product"); });
  el("mCancel").addEventListener("click", closeModal);
  el("mlModal").addEventListener("click", (e) => { if (e.target === el("mlModal")) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && el("mlModal").classList.contains("open")) closeModal(); });
  el("mSave").addEventListener("click", save);
  el("mDelete").addEventListener("click", remove);
  await load();
}

main();
