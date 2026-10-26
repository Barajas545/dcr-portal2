/* The plan buttons and the Floor Plans card (owner decisions 2026-10-26). The owner's .takeoff files live in his
   OneDrive folder "Projects-Takeoff-Files" (a folder per project, its name starting with the project's number), and
   takeoff-web opens them from each person's own Plans Archive on their computer (or the plans kept on that device):
   the bytes never pass through the portal or the broker. The broker only COUNTS them (op plans_for, read only:
   js/repo/onedrive.js plansFor) - no file or folder name, no item id, no link comes back.

   (1) a project whose takeoff folder(s) hold at least one .takeoff file shows 📐 in Search and on its page, opening
       takeoff-web at its number (#plans=<number>) in a new tab;
   (2) EVERYONE who can see the project sees the button (the owner's choice: the price gate stays the OneDrive
       sharing of the folder - takeoff-web opens only what that person's computer has);
   (4) the home page's Floor Plans card (takeoff-web's #plans) for the people who see prices (an admin, Sees prices).

   * plansLink(number)            takeoff-web at a project's plans ("#plans=A249"), or the archive itself ("#plans");
   * PLANS_HOME                   takeoff-web's plans: the Floor Plans card;
   * planEntry(v)                 one project of a plans_for answer as the pages use it ({number, plans}), or null;
   * planLabel / planTitle        the button's accessible name and its tooltip (the count);
   * planButtonHtml(entry, style) the button ("icon": Search's square beside the result; "button": the project
                                  header's), or "" for a project without a takeoff file (plans 0) or without a number;
   * plansCardFor(me)             whether the home page shows the Floor Plans card.

   Pure module (node tests import it). */

export const TAKEOFF_WEB = "https://barajas545.github.io/takeoff-web/index.html";
export const PLANS_HOME = TAKEOFF_WEB + "#plans";
/** A project number as the broker answers one (A068, A024-B, A000T1): short text without control characters. */
const NUMBER = /^[^\u0000-\u001f\u007f]{1,40}$/;

function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** takeoff-web's Plans Archive at this project's plans ("#plans=A249"), or the archive itself without a number. */
export function plansLink(number) {
  const n = String(number == null ? "" : number).trim();
  return TAKEOFF_WEB + (n ? "#plans=" + encodeURIComponent(n) : "#plans");
}

/** {number, plans} from one project of the broker's answer; anything else (a malformed answer) is null. */
export function planEntry(v) {
  if (!v || typeof v !== "object") return null;
  const number = typeof v.number === "string" ? v.number.trim() : "";
  if (!NUMBER.test(number)) return null;
  if (typeof v.plans !== "number" || !Number.isSafeInteger(v.plans) || v.plans < 0) return null;
  return { number, plans: v.plans };
}

export function planLabel(number) {
  return "Plans for " + number + " — open in the takeoff app";
}

export function planTitle(number, plans) {
  return plans + " takeoff file" + (plans === 1 ? "" : "s") + " for " + number +
    " — opens its plans in the takeoff app (your Plans Archive, or the plans kept on this device)";
}

/** The 📐 button of a project with at least one takeoff file, or "" (no button). */
export function planButtonHtml(entry, style) {
  const e = planEntry(entry);
  if (!e || e.plans < 1) return "";
  const attrs = ' href="' + esc(plansLink(e.number)) + '" target="_blank" rel="noopener" aria-label="' + esc(planLabel(e.number)) +
    '" title="' + esc(planTitle(e.number, e.plans)) + '"';
  if (style === "button") return '<a class="pj-btn"' + attrs + '><span aria-hidden="true">📐 Plans ↗</span></a>';
  return '<a class="se-plan-go"' + attrs + '><span class="ic" aria-hidden="true">📐</span><span class="tx" aria-hidden="true">Plans</span></a>';
}

/** The home page's Floor Plans card: the people who see prices (an admin, or Sees prices) - decision 4. */
export function plansCardFor(me) {
  return !!me && me.active !== false && me.role !== "agents" && (me.role === "admin" || !!me.can_see_prices);
}
