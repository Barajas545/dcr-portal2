/* The 📐 plan buttons of Search and the project page (owner decisions 2026-10-26; js/map/plans.js).

   A page draws an empty, hidden slot where a project's button may go:
     <span data-plans="<project id>" data-plans-style="icon | button" hidden></span>
   paintPlans() then asks the broker once for every slot on the page (js/repo/onedrive.js plansFor, op plans_for) and
   fills the slots of the projects whose takeoff folder holds at least one .takeoff file: a link to takeoff-web at the
   project's number, in a new tab (a navigation: nothing new in the security policy). Everyone who can see the project
   sees it (decision 2). When no answer comes (the takeoff folder not set up, the function not deployed, the broker
   busy, offline) nothing is said and the slots stay hidden: the page works as before. */

import * as onedrive from "../repo/onedrive.js";
import { planButtonHtml } from "../map/plans.js";

/** Fill the plan slots under `root` for `me`; `still()` false (the page moved on: a newer search) draws nothing.
    -> how many buttons were drawn. Never throws. */
export async function paintPlans(root, me, still) {
  if (!root || typeof root.querySelectorAll !== "function" || !onedrive.plansShownFor(me)) return 0;
  const slots = Array.prototype.slice.call(root.querySelectorAll("[data-plans]"));
  const ids = slots.map(function (s) { return s.getAttribute("data-plans"); }).filter(Boolean);
  if (!ids.length) return 0;
  let got = {};
  try { got = await onedrive.plansFor(ids); } catch (e) { return 0; }
  if (typeof still === "function" && !still()) return 0;
  let drawn = 0;
  slots.forEach(function (s) {
    const html = planButtonHtml(got[s.getAttribute("data-plans")], s.getAttribute("data-plans-style"));
    s.innerHTML = html;
    s.hidden = !html;
    if (html) drawn++;
  });
  return drawn;
}
