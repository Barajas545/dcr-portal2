/* Project tab Overview (MODULES §3 "Redesign"): Desktop 2's project fields only (Q23 — the old
   portal's links, Check* scope checklist and estimate wording stay in the old portal).

   Sections: Project (name, address, city, state, ZIP, start, completed, status note), Client
   (name, phone, e-mail), Estimating (labor rate — only with the prices switch —, plans link, tags,
   scope) and the quick links (Plans, Maps, Old portal, Day report).

   Editing: admin and manager (can_edit projects). Every field saves by itself through DCR2.live
   (common2.js: one write in flight per record, 800 ms debounce, retries, the version carried; an
   empty answer or PT409 re-reads, merges someone else's OTHER fields, and keeps theirs — saying so —
   when they changed the same field). Two records: the project row, and its project_prices row (the
   labor rate) with its own version, for prices people only.

   Free text people typed may quote an amount: for people without the prices switch such a field is
   shown masked and read-only, and never saves (Desktop 2's rule; display only, Q28). The rule is
   checked every time a value is painted — first draw, a live change from someone else, a conflict,
   "Use mine" — through DCR2.live's mask hook: a field that gains an amount turns masked and
   read-only at once, and editable again when the amount is gone. */

import { PROJECT_FIELDS, KNOWN_TAGS, fieldValue, parseTags, fieldDef } from "../map/projects.js";
import * as projectsRepo from "../repo/projects.js";
import { nameBook } from "../repo/people.js";
import { oldPortalUrl } from "../map/legacy.js";
import { D } from "./shell.js";

const SECTIONS = [["project", "Project"], ["client", "Client"], ["estimating", "Estimating"]];
const ROW_KEYS = PROJECT_FIELDS.filter(function (f) { return !f.price; }).map(function (f) { return f.key; });
let pane = null, rowRec = null, priceRec = null, latest = null;

function pricesShown(ctx) {
  return !!(ctx.prices && ctx.project && ctx.project.prices && typeof ctx.project.prices === "object");
}

function visibleFields(ctx) {
  return PROJECT_FIELDS.filter(function (f) { return !f.price || pricesShown(ctx); });
}

function hasAmount(ctx, text) { return !!text && ctx.mask(text) !== text; }

function isMasked(ctx, f, v) {
  return !ctx.prices && (f.type === "text" || f.type === "area") && hasAmount(ctx, v);
}

/** DCR2.live's mask hook: the masked text of a field this person may not see, else null. */
export function maskedText(ctx, key, value) {
  const f = fieldDef(key);
  return f && isMasked(ctx, f, value) ? ctx.mask(value) : null;
}

/** The project as the saver holds it: {id, version, <old key>: form value …} (row fields only). */
function rowRecord(p) {
  const r = { id: p.id, version: p.version };
  ROW_KEYS.forEach(function (k) { r[k] = fieldValue(p, k); });
  return r;
}
function priceRecord(p) {
  return { id: p.id, version: p.prices ? p.prices.version : undefined, projectLaborRate: fieldValue(p, "projectLaborRate") };
}

function inputHtml(ctx, f) {
  const esc = ctx.esc;
  const v = fieldValue(ctx.project, f.key);
  const masked = isMasked(ctx, f, v);
  const dis = !ctx.canWrite || masked ? " disabled" : "";
  const shown = masked ? ctx.mask(v) : v;
  // the labor rate is its own record (project_prices): bound separately (data-pkey -> data-key);
  // a masked field is bound too: DCR2.live's mask hook keeps it read-only while it has an amount
  const keyAttr = (f.price ? ' data-pkey="' + f.key + '"' : ' data-key="' + f.key + '"') + (masked ? ' data-masked="' + f.key + '"' : "");
  const title = masked ? ' title="Contains an amount — hidden for you"' : "";
  const clash = '<div class="pj-clash" data-clash="' + f.key + '" hidden></div>';
  if (f.type === "area") {
    return '<div class="pj-f full"><label for="ov_' + f.key + '">' + esc(f.label) + "</label>" +
      '<textarea id="ov_' + f.key + '"' + keyAttr + ' data-type="area"' + dis + title + ">" + esc(shown) + "</textarea>" + clash + "</div>";
  }
  if (f.type === "tags") {
    const on = parseTags(v);
    const extra = on.filter(function (t) { return KNOWN_TAGS.indexOf(t) === -1; });
    const chips = KNOWN_TAGS.concat(extra).map(function (t) {
      const isOn = on.some(function (x) { return x.toLowerCase() === t.toLowerCase(); });
      return '<button type="button" class="pj-tag' + (isOn ? " on" : "") + (ctx.canWrite ? "" : " disabled") +
        '" data-tag="' + esc(t) + '" aria-pressed="' + (isOn ? "true" : "false") + '"' + (ctx.canWrite ? "" : " disabled") + ">" + esc(t) + "</button>";
    }).join("");
    return '<div class="pj-f full"><label>' + esc(f.label) + '</label><div class="pj-tagwrap" id="pjTagWrap">' + chips + "</div>" + clash + "</div>";
  }
  const type = f.type === "date" ? "date" : f.type === "money" ? "number" : f.key === "projectEmailAddress" ? "email" : "text";
  const extraAttr = f.type === "money" ? ' step="0.01" min="0" inputmode="decimal" data-type="num"' :
    f.type === "date" ? ' data-type="date"' : f.key === "projectPhoneNumber" ? ' inputmode="tel"' : "";
  return '<div class="pj-f"><label for="ov_' + f.key + '">' + esc(f.label + (f.required ? " *" : "")) + "</label>" +
    '<input id="ov_' + f.key + '" type="' + type + '"' + keyAttr + ' value="' + esc(shown == null ? "" : shown) + '"' +
    extraAttr + dis + title + ">" + clash + "</div>";
}

function linksHtml(ctx) {
  const p = ctx.project, esc = ctx.esc;
  const where = [p.projectAddress, p.projectCity, p.projectState].filter(Boolean).join(", ");
  const old = oldPortalUrl(p);
  return [
    p.projectPlansURL && /^https?:\/\//i.test(p.projectPlansURL)
      ? '<a class="pj-btn pj-btn-sm" target="_blank" rel="noopener" href="' + esc(p.projectPlansURL) + '">Plans ↗</a>' : "",
    where ? '<a class="pj-btn pj-btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(where) + '">Maps ↗</a>' : "",
    old ? '<a class="pj-btn pj-btn-sm" target="_blank" rel="noopener" href="' + esc(old) +
      '" title="The estimates, change orders, expenses and documents of this project are in the old portal">Old portal ↗</a>' : "",
    '<a class="pj-btn pj-btn-sm" href="report-journal.html?id=' + encodeURIComponent(p.id) + '">📄 Day report</a>',
  ].filter(Boolean).join("");
}

export function render(ctx, host) {
  pane = host;
  const fields = visibleFields(ctx);
  const role = ctx.me && ctx.me.role;
  host.innerHTML =
    '<div class="pj-sec"><h3>Quick links</h3><div class="pj-links">' + linksHtml(ctx) + "</div></div>" +
    (ctx.canWrite ? "" : '<div class="pj-ro">Read only — ' + (role === "viewer" ? "a view-only account." : "project details are edited by the office (admin, manager).") + "</div>") +
    SECTIONS.map(function (s) {
      const list = fields.filter(function (f) { return f.section === s[0]; });
      return '<div class="pj-sec"><h3>' + ctx.esc(s[1]) + (s[0] === "project" && ctx.canWrite ? ' <span class="pj-auto">saves by itself</span>' : "") +
        '</h3><div class="pj-grid">' + list.map(function (f) { return inputHtml(ctx, f); }).join("") + "</div></div>";
    }).join("") +
    '<div class="pj-sub">' + ctx.esc(ctx.project.internalIDNumber) + " · created " + ctx.esc(String(ctx.project.projectDate || "").slice(0, 10)) +
      (ctx.project.folderName ? " · folder on the office PCs: " + ctx.esc(ctx.project.folderName) : "") + "</div>";

  host.querySelectorAll("textarea").forEach(function (ta) { grow(ta); ta.addEventListener("input", function () { grow(ta); }); });
  if (!ctx.canWrite) return;

  const live = D().live;
  if (typeof live !== "function") return;
  latest = ctx.project;
  rowRec = live(rowRecord(ctx.project), {
    key: "project:" + ctx.project.id,
    status: "pjMsg",
    save: async function (fields, version) {
      if ("projectName" in fields && !String(fields.projectName || "").trim()) {
        throw Object.assign(new Error("The project needs a name."), { code: "local_rule", status: 400 });
      }
      const base = Object.assign({}, latest, { version: version });
      const p = await projectsRepo.updateProject(base, fields);
      latest = p;
      return rowRecord(p);
    },
    reread: async function () {
      const p = await projectsRepo.getProject(ctx.project.id);
      latest = p;
      return rowRecord(p);
    },
    onSaved: function () { ctx.setProject(latest); ctx.setEditing(rowRec.busy() || (priceRec && priceRec.busy())); },
    onConflict: function (c) { showClash(ctx, c); if (latest) ctx.setProject(latest); },
    mask: function (key, value) { return maskedText(ctx, key, value); },
  });
  rowRec.bind(host);
  if (pricesShown(ctx)) {
    priceRec = live(priceRecord(ctx.project), {
      key: "prices:" + ctx.project.id,
      status: "pjMsg",
      save: async function (fields, version) {
        const base = Object.assign({}, latest, { prices: Object.assign({}, latest.prices, { version: version }) });
        const p = await projectsRepo.updateProject(base, fields);
        latest = p;
        return priceRecord(p);
      },
      reread: async function () {
        const p = await projectsRepo.getProject(ctx.project.id);
        latest = p;
        return priceRecord(p);
      },
      onSaved: function () { ctx.setProject(latest); },
      onConflict: function (c) { showClash(ctx, c); },
    });
    // the price input is bound to its own record only
    const inp = host.querySelector('[data-pkey="projectLaborRate"]');
    if (inp) { inp.setAttribute("data-key", "projectLaborRate"); priceRec.bind(inp.parentNode); }
  }
  host.querySelectorAll("[data-key]").forEach(function (inp) {
    inp.addEventListener("input", function () { hideClash(inp.getAttribute("data-key")); ctx.setEditing(true); });
  });
  const tw = host.querySelector("#pjTagWrap");
  if (tw) tw.addEventListener("click", function (e) {
    const b = e.target.closest && e.target.closest("[data-tag]");
    if (!b || b.disabled) return;
    b.classList.toggle("on");
    b.setAttribute("aria-pressed", b.classList.contains("on") ? "true" : "false");
    const on = Array.prototype.map.call(tw.querySelectorAll(".pj-tag.on"), function (x) { return x.getAttribute("data-tag"); });
    hideClash("checkTagNames");
    rowRec.set("checkTagNames", on, { now: true });       // a chip is complete the moment it is clicked
  });
}

function grow(ta) { ta.style.height = "auto"; ta.style.height = (ta.scrollHeight + 4) + "px"; }

function hideClash(key) {
  const c = pane && pane.querySelector('[data-clash="' + key + '"]');
  if (c) c.hidden = true;
}

async function showClash(ctx, c) {
  const nameOf = await nameBook();
  const who = (nameOf(latest && latest.updatedBy) || "Someone").split(/\s+/)[0];
  (c.fields || []).forEach(function (key) {
    const f = fieldDef(key);
    paintTags(key, c.current && c.current[key]);
    const box = pane && pane.querySelector('[data-clash="' + key + '"]');
    if (!box) return;
    const mineV = c.mine ? c.mine[key] : "";
    const mine = Array.isArray(mineV) ? mineV.join(", ") : String(mineV == null ? "" : mineV);
    box.hidden = false;
    box.innerHTML = ctx.esc(who + " changed " + (f ? f.label.toLowerCase() : "this") + " while you were typing — theirs is shown. Yours was “" +
      (ctx.prices ? mine : ctx.mask(mine)) + "”.") + ' <button type="button" class="pj-btn pj-btn-sm" data-mine="1">Use mine</button>';
    box.querySelector("[data-mine]").addEventListener("click", function () {
      box.hidden = true;
      const rec = f && f.price ? priceRec : rowRec;
      paintTags(key, mineV);
      rec.set(key, mineV, { now: true });
      rec.showField(key, mineV);                 // through the mask, like every other value shown
    });
  });
}

function paintTags(key, value) {
  if (key !== "checkTagNames" || !pane) return;
  const on = parseTags(value || []).map(function (t) { return t.toLowerCase(); });
  pane.querySelectorAll("#pjTagWrap .pj-tag").forEach(function (b) {
    const isOn = on.indexOf(b.getAttribute("data-tag").toLowerCase()) !== -1;
    b.classList.toggle("on", isOn);
    b.setAttribute("aria-pressed", isOn ? "true" : "false");
  });
}

/** A newer copy of the project (live, or a status move here): untouched fields take it. */
export function adopt(ctx, p) {
  if (!pane || !p) return;
  latest = Number(p.version || 0) >= Number((latest && latest.version) || 0) ? p : latest;
  if (rowRec) {
    const pend = rowRec.pend || {};
    rowRec.baseline(rowRecord(p));
    if (!("checkTagNames" in pend)) paintTags("checkTagNames", fieldValue(p, "checkTagNames"));
  } else {
    // read-only: repaint every field
    visibleFields(ctx).forEach(function (f) {
      if (f.type === "tags") { paintTags(f.key, fieldValue(p, f.key)); return; }
      const inp = pane.querySelector('[data-key="' + f.key + '"],[data-masked="' + f.key + '"]');
      const v = fieldValue(p, f.key);
      if (inp) inp.value = isMasked(ctx, f, v) ? ctx.mask(v) : (v == null ? "" : v);
    });
  }
  if (priceRec && p.prices) priceRec.baseline(priceRecord(p));
}

export function flush() {
  const all = [];
  if (rowRec) all.push(rowRec.flush());
  if (priceRec) all.push(priceRec.flush());
  return Promise.all(all);
}
export function busy() { return !!((rowRec && rowRec.busy()) || (priceRec && priceRec.busy())); }
