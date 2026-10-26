/* Project tab Takeoffs (P5a, MODULES §3 "Takeoffs"; BLUEPRINT 3.3.11; owner answer Q12 — the takeoff grid stays in
   DCR Desktop 2, view and print here — and Q20 as the owner updated it on 2026-10-24 (D13): the floor plans are in
   the project's OneDrive Floor Plans folder (a floor-plan PDF added in the Files tab goes there — said only once
   that tab's OneDrive part is out: repo/onedrive.js LIVE) and the .takeoff files stay in the Plans Archive, which
   takeoff-web opens: the bar always links to it, at this project's number).

   The project's takeoffs, newest first, each a fold-out card: its name, date, the estimate item it belongs
   to, its rows by level, category and sub-category (L#, quantity, unit, item, purpose; with prices the
   unit price and the line total), and "Material list" (everybody) / "Material quote" (prices) opening
   report-takeoff.html. Without the prices switch the database sends no price (rpc takeoff_print). Live: the
   project's takeoffs and rows (and, with prices, the row prices). */

import * as estRepo from "../repo/estimates.js";
import { LIVE as ONEDRIVE_LIVE } from "../repo/onedrive.js";
import { takeoffCardsHtml, esc } from "./est-render.js";
// the link is built in one place (map/plans.js: the plan buttons of Search and the project header use it too)
import { TAKEOFF_WEB, plansLink } from "../map/plans.js";

export { TAKEOFF_WEB, plansLink };

let host = null, seq = 0, timer = null;
const state = { list: [], open: undefined, prices: false };

export function render(ctx, el) {
  host = el;
  host.classList.add("tk-pane");
  host.innerHTML = '<div class="es-bar" id="tkoBar"></div><div id="tkoList"><div class="pj-empty">Loading takeoffs…</div></div>';
  host.addEventListener("toggle", function (e) {
    const d = e.target;
    if (d && d.matches && d.matches("details[data-tk]") && d.open) state.open = d.getAttribute("data-tk");
  }, true);
  host.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest("#tkoReload")) load(ctx);
  });
  load(ctx);
}

async function load(ctx) {
  if (!host) return;
  const my = ++seq;
  try {
    const res = await estRepo.listTakeoffs(ctx.pid);
    if (my !== seq) return;
    state.list = res.takeoffs;
    state.prices = !!(ctx.prices && res.prices);
    draw(ctx);
  } catch (e) {
    if (my !== seq) return;
    host.querySelector("#tkoList").innerHTML = '<div class="pj-empty">' + esc(ctx.errorText(e)) + "</div>";
  }
}

function draw(ctx) {
  const list = state.list;
  const lines = list.reduce(function (s, t) { return s + t.lines; }, 0);
  const priced = state.prices && list.length && list.every(function (t) { return t.priced; }) && lines > 0;
  const all = "report-takeoff.html?id=" + encodeURIComponent(ctx.pid) + "&amp;tk=all";
  const number = ctx.project && ctx.project.internalIDNumber;
  host.querySelector("#tkoBar").innerHTML = '<a class="pj-btn pj-btn-sm" target="_blank" rel="noopener" href="' + esc(plansLink(number)) +
    '" title="The floor plans and .takeoff files of this project in takeoff-web (on a computer, in Chrome or Edge)">📐 Plans Archive (takeoff-web) ↗</a>' +
    (list.length > 1
    ? '<a class="pj-btn pj-btn-sm pj-btn-primary" href="' + all + '">🖨 All takeoffs (material list)</a>' +
      (priced ? '<a class="pj-btn pj-btn-sm" href="' + all + '&amp;kind=quote">🖨 All (material quote)</a>' : "") : "") +
    '<button class="pj-btn pj-btn-sm" id="tkoReload" type="button" title="Read again">↻</button>' +
    '<span class="es-count">' + list.length + " takeoff" + (list.length === 1 ? "" : "s") + " · " + lines + " line" + (lines === 1 ? "" : "s") +
    " · edited in DCR Desktop 2" + (ctx.prices ? "" : " · prices hidden") + "</span>";
  host.querySelector("#tkoList").innerHTML = list.length ? takeoffCardsHtml(list, { show: state.prices, pid: ctx.pid, open: state.open })
    : '<div class="pj-empty">No takeoffs yet. Takeoffs are made in DCR Desktop 2; floor plans and .takeoff files are in the Plans Archive ' +
      "(takeoff-web opens it on a computer, in Chrome or Edge). " +
      (ONEDRIVE_LIVE ? "Floor-plan PDFs added in the Files tab go to the project's OneDrive Floor Plans folder."
        : "Floor-plan PDFs are kept in the project's OneDrive Floor Plans folder.") + "</div>";
}

export function reload(ctx) {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(function () { load(ctx); }, 300);
}

/** Whether a changed row belongs to what this tab shows (its price rows carry only the row id). */
export function hasRow(id) {
  return state.list.some(function (t) { return t.rows.some(function (r) { return String(r.id) === String(id); }); });
}
