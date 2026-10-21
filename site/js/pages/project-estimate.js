/* Project tab Estimate (P5a, MODULES §3 "Estimate"; BLUEPRINT 3.3.11, owner answer Q12: view and print only —
   editing stays in DCR Desktop 2).

   The project's estimates and change orders, read only, the old Estimate tab's look: one card per
   estimate (the name, its number, its status; the Labor / Material / Total of the estimate at the top for
   people who see prices), its groups in the order the office arranged them, each item with its words, the
   crew line and its flags (M5a: blocked, important, complete). A picker shows one estimate or all; archived
   estimates only on request; a contract strip on top (money with prices, counts without). "Print" opens
   report-estimate.html (the full copy with prices, the worksite copy for everybody else).

   Without the prices switch the database sends no amount at all (rpc estimate_print, repo/estimates.js) and
   scrubs the amounts typed into the words. Live: the project's estimates and items (and, with
   prices, their price rows) — a change made in the office lands here. */

import * as estRepo from "../repo/estimates.js";
import { estimateCardsHtml, contractStripHtml, esc } from "./est-render.js";
import { moneyShown, isChangeOrder, wordsFor } from "../map/estimates.js";

let host = null, seq = 0, timer = null;
const state = { list: [], archived: 0, showArchived: false, filter: "*", loaded: false };

export function render(ctx, el) {
  host = el;
  host.classList.add("es-pane");
  host.innerHTML = '<div class="es-bar" id="esBar"></div><div id="esStrip"></div><div id="esList"><div class="pj-empty">Loading estimates…</div></div>';
  host.addEventListener("change", function (e) {
    const t = e.target;
    if (t && t.id === "esFilter") { state.filter = t.value; draw(ctx); }
    else if (t && t.id === "esArchived") { state.showArchived = !!t.checked; load(ctx); }
  });
  host.addEventListener("click", function (e) {
    const r = e.target.closest && e.target.closest("#esReload");
    if (r) load(ctx);
  });
  load(ctx);
}

async function load(ctx) {
  if (!host) return;
  const my = ++seq;
  try {
    const res = await estRepo.listEstimates(ctx.pid, { archived: state.showArchived });
    if (my !== seq) return;
    state.list = res.estimates;
    state.archived = res.archived;
    state.loaded = true;
    draw(ctx);
  } catch (e) {
    if (my !== seq) return;
    host.querySelector("#esList").innerHTML = '<div class="pj-empty">' + esc(ctx.errorText(e)) + "</div>";
  }
}

function draw(ctx) {
  if (!host) return;
  const list = state.list;
  if (state.filter !== "*" && !list.some(function (e) { return String(e.id) === String(state.filter); })) state.filter = "*";
  const shown = state.filter === "*" ? list : list.filter(function (e) { return String(e.id) === String(state.filter); });
  const show = moneyShown(ctx.prices, list);
  const w = wordsFor(show);
  const nEst = list.filter(function (e) { return !isChangeOrder(e); }).length;
  const nCo = list.length - nEst;
  host.querySelector("#esBar").innerHTML =
    (list.length > 1 ? '<select id="esFilter" aria-label="Which estimate"><option value="*">All estimates (' + list.length + ")</option>" +
      list.map(function (e) {
        return '<option value="' + esc(e.id) + '"' + (String(state.filter) === String(e.id) ? " selected" : "") + ">" + esc(w(e.displayName)) + "</option>";
      }).join("") + "</select>" : "") +
    '<a class="pj-btn pj-btn-sm pj-btn-primary" id="esPrint" href="report-estimate.html?id=' + encodeURIComponent(ctx.pid) +
      (state.filter !== "*" ? "&amp;est=" + encodeURIComponent(state.filter) : "") + '">🖨 Print' + (state.filter === "*" && list.length > 1 ? " all" : "") + "</a>" +
    '<button class="pj-btn pj-btn-sm" id="esReload" type="button" title="Read again">↻</button>' +
    (state.archived ? '<label class="pj-check"><input type="checkbox" id="esArchived"' + (state.showArchived ? " checked" : "") + "> Show archived (" + state.archived + ")</label>" : "") +
    '<span class="es-count">' + nEst + " estimate" + (nEst === 1 ? "" : "s") + " · " + nCo + " change order" + (nCo === 1 ? "" : "s") +
      " · edited in DCR Desktop 2" + (ctx.prices ? "" : " · prices hidden") + "</span>";
  host.querySelector("#esStrip").innerHTML = state.filter === "*" ? contractStripHtml(list, show) : "";
  host.querySelector("#esList").innerHTML = shown.length ? estimateCardsHtml(shown, { show, pid: ctx.pid })
    : '<div class="pj-empty">No estimates yet. Estimates and change orders are written in DCR Desktop 2.</div>';
}

/** A change arrived (live): read again, once per burst. */
export function reload(ctx) {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(function () { load(ctx); }, 300);
}

/** Whether a changed item belongs to what this tab shows (its price rows carry only the item id). */
export function hasItem(id) {
  return state.list.some(function (e) { return e.items.some(function (it) { return String(it.id) === String(id); }); });
}
