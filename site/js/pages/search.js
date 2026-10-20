/* Global search (port of the old search.html / search.js; MODULES §3 "search.html").

   rpc search (through the caller's own RLS: what a person may not read never comes back), grouped as
   the old page drew it — Projects (with their pictures through signed URLs), Contacts (e-mail and
   phone links), Estimate items, Tasks, Files — each linking into the project. The old plan-files
   (.takeoff) menu is not ported (Q20: the Plans Library stays on the old portal). */

import { boot, el, esc, errorText, qs, setQs, maskFor } from "./shell.js";
import * as searchRepo from "../repo/search.js";
import * as projectsRepo from "../repo/projects.js";
import * as filesRepo from "../repo/files.js";

let timer = null, seq = 0, numbers = {}, list = [], listReady = null, mask = function (t) { return t; };

async function loadNumbers() {
  try {
    list = await projectsRepo.loadProjects();
    numbers = {};
    list.forEach(function (p) { numbers[String(p.id)] = p.internalIDNumber; });
  } catch (e) { /* the numbers are a nicety */ }
}

function itemHtml(it) {
  const sub = it.sub ? '<div class="se-sub">' + esc(it.sub) + "</div>" : "";
  if (it.href && it.thumbId != null) {
    return '<a class="se-item thumbed" href="' + esc(it.href) + '">' +
      '<span class="se-thumb" data-thumb="' + esc(it.thumbId) + '"><span class="ph">🏠</span></span>' +
      '<span class="se-txt"><div class="se-title">' + esc(it.title) + "</div>" + sub + "</span></a>";
  }
  if (it.href) return '<a class="se-item" href="' + esc(it.href) + '"><div class="se-title">' + esc(it.title) + "</div>" + sub + "</a>";
  const contact = [];
  if (it.email) contact.push('<a href="mailto:' + esc(it.email) + '">' + esc(it.email) + "</a>");
  if (it.phone) contact.push('<a href="tel:' + esc(String(it.phone).replace(/[^\d+]/g, "")) + '">' + esc(it.phone) + "</a>");
  return '<div class="se-item"><div class="se-title">' + esc(it.title) + "</div>" +
    (it.sub || contact.length ? '<div class="se-sub">' + [esc(it.sub || "")].concat(contact).filter(Boolean).join(" · ") + "</div>" : "") + "</div>";
}

async function paintThumbs(my) {
  if (listReady) await listReady;
  if (my !== seq) return;
  const boxes = Array.prototype.slice.call(el("seResults").querySelectorAll("[data-thumb]"));
  if (!boxes.length) return;
  const byId = {};
  list.forEach(function (p) { byId[String(p.id)] = p; });
  const want = boxes.map(function (b) { return byId[b.getAttribute("data-thumb")]; }).filter(Boolean);
  let urls = {};
  try { urls = await filesRepo.thumbnailUrls(want); } catch (e) { return; }
  if (my !== seq) return;
  boxes.forEach(function (b) {
    const u = urls[b.getAttribute("data-thumb")];
    if (u) b.innerHTML = '<img src="' + esc(u) + '" alt="">';
  });
}

async function run(q) {
  const my = ++seq;
  if (q.length < 2) {
    el("seNote").textContent = "";
    el("seResults").innerHTML = '<div class="se-empty">Type at least 2 characters to search.</div>';
    return;
  }
  el("seNote").textContent = "Searching…";
  const ph = el("seResults").querySelector(".se-empty");
  if (ph) ph.remove();
  try {
    const groups = await searchRepo.search(q, { numberOf: function (id) { return numbers[String(id)] || ""; }, mask: mask });
    if (my !== seq) return;
    const total = groups.reduce(function (n, g) { return n + g.total; }, 0);
    el("seNote").textContent = total ? total + " result" + (total === 1 ? "" : "s") + " for “" + q + "”" : "";
    if (!groups.length) {
      el("seResults").innerHTML = '<div class="se-empty">No results for “' + esc(q) + "”.</div>";
      return;
    }
    el("seResults").innerHTML = groups.map(function (g) {
      return '<div class="se-grp"><h3>' + esc(g.label) + ' <span class="se-count">' + g.total + (g.more ? "+" : "") + "</span></h3>" +
        g.items.map(itemHtml).join("") +
        (g.more ? '<div class="se-more">Showing the first ' + g.total + " — refine your search</div>" : "") + "</div>";
    }).join("");
    paintThumbs(my);
  } catch (e) {
    if (my !== seq) return;
    el("seNote").textContent = "";
    el("seResults").innerHTML = '<div class="se-empty">' + esc(errorText(e)) + "</div>";
  }
}

async function init() {
  mask = maskFor(await boot("search"));
  listReady = loadNumbers();
  const q0 = qs("q") || "";
  const box = el("seInput");
  box.value = q0;
  box.addEventListener("input", function () {
    const q = this.value.trim();
    setQs("q", q);
    clearTimeout(timer);
    timer = setTimeout(function () { run(q); }, 300);
  });
  if (q0) run(q0.trim());
  box.focus();
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const r = document.getElementById("seResults");
  if (r) r.innerHTML = '<div class="se-empty">' + esc(errorText(e)) + "</div>";
});
