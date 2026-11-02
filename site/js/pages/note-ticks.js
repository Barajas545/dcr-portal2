/* The box on a project note in the three log views — the project's Log tab, the Board's panel and Log History
   (DCR Desktop 2.26, migration 20261103000100_activity_checkoff; the owner's request of 2026-11-02).

   Anyone who may write notes (admin, manager, accountant, lead — can(me, "activity")) ticks any note off and
   takes a tick off again; the database adds the date and the name (rpc set_note_done through
   repo/activity.js setDone). The pages draw the box with map/activity.js checkHtml (a button carrying the
   note's id, version and state) and hand their list here once: a tap asks for the other state, the box
   waits (disabled) for the answer, and the page reads its lines again (changed). Someone else first: said
   in a toast and the page reads again. Nothing typed is logged. */

import * as activityRepo from "../repo/activity.js";

/** host: the list element; o: {me() -> the person, mask() -> the page's amount mask, changed(line),
    toast(text, kind), errorText(err)}. */
export function wireTicks(host, o) {
  if (!host || host.getAttribute("data-ticks") === "1") return;
  host.setAttribute("data-ticks", "1");
  host.addEventListener("click", async function (e) {
    const b = e.target.closest && e.target.closest("[data-tick]");
    if (!b || !host.contains(b) || b.disabled) return;
    e.preventDefault();
    const was = b.getAttribute("data-done") === "1";
    const me = o.me ? o.me() : null;
    b.disabled = true;
    b.classList.add("busy");
    try {
      const line = await activityRepo.setDone({ id: b.getAttribute("data-tick"), version: Number(b.getAttribute("data-v")), done: was },
        !was, { mask: o.mask ? o.mask() : null, me: me && me.id });
      if (line && line.already) {
        const who = (line.done ? line.doneByName : "").split(/\s+/)[0] || "Someone";
        o.toast(line.done ? who + " already ticked that off." : "That tick was already taken off.", "info");
      } else if (line) {
        o.toast(line.done ? "✓ Ticked off" : "The tick is off", "ok");
      }
      o.changed(line);
    } catch (err) {
      b.disabled = false;
      b.classList.remove("busy");
      o.toast(o.errorText(err), "error");
      if (err && (err.code === "PT404" || err.status === 404)) o.changed(null);
    }
  });
}
