/* Project tab Takeoffs (P5a, MODULES §3 "Takeoffs"; BLUEPRINT 3.3.11; owner answers Q12 — view and print only,
   the takeoff grid stays in DCR Desktop 2 — and Q20 — the old .takeoff plan files stay on the old portal).

   The project's takeoffs, newest first, each a fold-out card: its name, date, the estimate item it belongs
   to, its rows by level, category and sub-category (L#, quantity, unit, item, purpose; with prices the
   unit price and the line total), and "Material list" (everybody) / "Material quote" (prices) opening
   report-takeoff.html. Without the prices switch the database sends no price (rpc takeoff_print). Live: the
   project's takeoffs and rows (and, with prices, the row prices). */

import * as estRepo from "../repo/estimates.js";
import { takeoffCardsHtml, esc } from "./est-render.js";

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
  host.querySelector("#tkoBar").innerHTML = (list.length > 1
    ? '<a class="pj-btn pj-btn-sm pj-btn-primary" href="' + all + '">🖨 All takeoffs (material list)</a>' +
      (priced ? '<a class="pj-btn pj-btn-sm" href="' + all + '&amp;kind=quote">🖨 All (material quote)</a>' : "") : "") +
    '<button class="pj-btn pj-btn-sm" id="tkoReload" type="button" title="Read again">↻</button>' +
    '<span class="es-count">' + list.length + " takeoff" + (list.length === 1 ? "" : "s") + " · " + lines + " line" + (lines === 1 ? "" : "s") +
    " · edited in DCR Desktop 2" + (ctx.prices ? "" : " · prices hidden") + "</span>";
  host.querySelector("#tkoList").innerHTML = list.length ? takeoffCardsHtml(list, { show: state.prices, pid: ctx.pid, open: state.open })
    : '<div class="pj-empty">No takeoffs yet. Takeoffs are made in DCR Desktop 2; the old .takeoff plan files stay on the old portal.</div>';
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
