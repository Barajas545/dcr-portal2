/* Project tab Log (MODULES §3 "Logs"): the project's activity, newest first (300), with
   "Add log entry" for admin, manager, accountant and lead (RLS decides). Imported lines carry
   their original date and "Juan · old portal"; a long one folds behind "more". Amounts in notes are
   masked for people without the prices switch (on screen only). */

import * as activityRepo from "../repo/activity.js";
import { foldText } from "../map/activity.js";
import { fmtWhen } from "../map/pacific.js";

let host = null, seq = 0, timer = null;

export function render(ctx, el) {
  host = el;
  const esc = ctx.esc;
  host.innerHTML = (ctx.canLog
    ? '<div class="pj-sec"><h3>Add log entry</h3><textarea id="lgText" class="pj-ta" rows="3" maxlength="4000" placeholder="Write a log entry…"></textarea>' +
      '<div class="pj-row"><button class="pj-btn pj-btn-primary pj-btn-sm" id="lgSave" type="button">✓ Save entry</button>' +
      '<span class="pj-msg" id="lgMsg"></span></div></div>'
    : "") + '<div id="lgList"><div class="pj-empty">Loading logs…</div></div>';
  const b = host.querySelector("#lgSave");
  if (b) b.addEventListener("click", async function () {
    const t = host.querySelector("#lgText").value.trim();
    const m = host.querySelector("#lgMsg");
    if (!t) { m.textContent = "Write something first."; m.className = "pj-msg err"; return; }
    b.disabled = true;
    m.textContent = "Saving…"; m.className = "pj-msg";
    try {
      await activityRepo.addNote(ctx.pid, t);
      host.querySelector("#lgText").value = "";
      m.textContent = "✓ Saved"; m.className = "pj-msg ok";
      load(ctx);
    } catch (e) { m.textContent = ctx.errorText(e); m.className = "pj-msg err"; }
    b.disabled = false;
  });
  host.addEventListener("click", function (e) {
    const more = e.target.closest && e.target.closest("[data-more]");
    if (!more) return;
    const t = more.previousElementSibling;
    if (t && t.getAttribute("data-full")) { t.textContent = t.getAttribute("data-full"); more.remove(); }
  });
  load(ctx);
}

async function load(ctx) {
  if (!host) return;
  const my = ++seq;
  const list = host.querySelector("#lgList");
  try {
    const lines = await activityRepo.forProject(ctx.pid, { limit: activityRepo.HISTORY_LIMIT, mask: ctx.mask });
    if (my !== seq) return;
    const esc = ctx.esc;
    list.innerHTML = lines.length ? lines.map(function (l) {
      const f = foldText(l.logDescription);
      return '<div class="pj-log' + (l.kind !== "note" ? " sys" : "") + (l.imported ? " imp" : "") + '">' +
        '<div class="pj-log-date">' + esc(fmtWhen(l.logDate)) + "</div>" +
        '<div class="pj-log-text" data-full="' + (f.more ? esc(l.logDescription) : "") + '">' + esc(f.short) + "</div>" +
        (f.more ? '<button type="button" class="pj-more" data-more="1">more</button>' : "") +
        (l.logUserName ? '<div class="pj-log-user">— ' + esc(l.logUserName) + "</div>" : "") + "</div>";
    }).join("") : '<div class="pj-empty">No log entries yet.</div>';
  } catch (e) {
    if (my !== seq) return;
    list.innerHTML = '<div class="pj-empty">' + ctx.esc(ctx.errorText(e)) + "</div>";
  }
}

/** A change arrived (live, or a status move here): read again, once per burst. */
export function reload(ctx) {
  if (!host) return;
  clearTimeout(timer);
  timer = setTimeout(function () { load(ctx); }, 250);
}
