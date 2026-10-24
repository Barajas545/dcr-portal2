/* Starts CME (the Construction Modeling Engine, ported unchanged from the old portal) inside DCR Portal 2.

   Order matters here. app.js ends with a bare render() at module scope, so it draws the instant it is imported —
   before an async sign-in check could finish. Importing it dynamically, after requireAuth() resolves and the
   Sales estimates switch is confirmed, is what keeps a visitor without it from seeing a working editor for a
   second.

   Everything the portal offers the app is put on window.CME_PORTAL rather than imported, so the module tree still
   loads with no portal around it.

   What changed from the old boot.js:
   * the sign-in is Portal 2's (common2.js requireAuth), and the drawing tool opens only for someone with the Sales
     estimates switch (Q10: repo/sales.js salesAccess reads the database's own answer);
   * the page opens only on its own or inside a page of this site: a frame from another site is refused (a meta tag
     cannot carry frame-ancestors, BLUEPRINT 2.2.1);
   * the drawing library on this device is Portal 2's own and per account (Appendix C): CME_STORAGE_SCOPE names
     the person and the estimate, so a shared tablet never lists another rep's or another customer's deck;
   * the handed-over drawing travels under a dcr2: sessionStorage key, and so does the client's name (never in this
     page's URL: the static host logs it and every request of this page would carry it as its Referer); no Sales Hub
     origin is allowed (none is deployed: the estimate page gets the drawing through portal-bridge.js on the same
     origin). */
import "../js/common2.js";
import { salesAccess } from "../js/repo/sales.js";

const DCR2 = window.DCR2 || {};
export const HANDOFF_PREFIX = "dcr2:cmeHandoff:";

function fail(why, opts) {
  const box = document.getElementById("cmeBootError");
  const line = document.getElementById("cmeBootWhy");
  const off = document.getElementById("cmeBootOffline");
  if (line) line.textContent = why;
  if (off && opts && opts.noOfflineHint) off.style.display = "none";
  if (box) box.style.display = "block";
}

function framedByAnotherSite() {
  if (window.top === window) return false;
  try { return window.parent.location.origin !== location.origin; } catch (e) { return true; }
}

try {
  if (framedByAnotherSite()) {
    fail("The drawing tool opens only inside DCR Portal 2.", { noOfflineHint: true });
    throw Object.assign(new Error("framed by another site"), { quiet: true });
  }
  if (typeof DCR2.requireAuth !== "function") {
    throw new Error("The portal scripts did not load, so sign-in could not be checked.");
  }

  // Sends a signed-out visitor to the sign-in page (and back here afterwards).
  const profile = await DCR2.requireAuth();
  const access = await salesAccess(profile);
  if (!access.sales) {
    fail(access.missing
      ? "The database does not have Sales Estimates yet. Reload the page; if it keeps happening, tell the office."
      : "Drawings belong to Sales Estimates, which needs the Sales estimates switch. Ask an admin to turn it on (DCR Desktop 2, Users).",
    { noOfflineHint: true });
    throw Object.assign(new Error("no sales switch"), { quiet: true });
  }

  const qs = new URLSearchParams(location.search);

  /* An existing drawing is handed over through sessionStorage, not postMessage or the URL: the integration has no
     inbound message channel at all, a message would race the module boot, and a project document is far past any
     sane URL length. sessionStorage is same-origin, survives the navigation, and is read once and deleted. */
  let incoming = null;
  const handoffKey = qs.get("cmeHandoff");
  if (handoffKey && handoffKey.indexOf(HANDOFF_PREFIX) === 0) {
    try {
      const raw = sessionStorage.getItem(handoffKey);
      sessionStorage.removeItem(handoffKey);
      if (raw) incoming = JSON.parse(raw);
    } catch (error) {
      console.warn("[CME] could not read the handed-over drawing:", error);
    }
  }

  /* The client's name, handed over the same way (read once, deleted). */
  let clientName = "";
  const contextKey = qs.get("cmeContext");
  if (contextKey && contextKey.indexOf(HANDOFF_PREFIX) === 0) {
    try {
      const raw = sessionStorage.getItem(contextKey);
      sessionStorage.removeItem(contextKey);
      const ctx = raw ? JSON.parse(raw) : null;
      clientName = ctx && typeof ctx.clientName === "string" ? ctx.clientName.slice(0, 200) : "";
    } catch (error) {
      console.warn("[CME] could not read the handed-over client name:", error);
    }
  }

  const estimateId = (qs.get("estimateId") || "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 64) || null;

  window.CME_PORTAL = {
    profile,
    estimateId,
    entryId: qs.get("entryId") || null,
    clientName,
    incoming,
    fresh: qs.get("cmeFresh") === "1",
    /* No deployed Sales Hub: a sketch is only ever handed to this site's own estimate page (same origin, which
       the engine always allows). */
    salesHubOrigins: [],
    returnTo: estimateId ? "estimate-deck.html" : "estimates.html",
    /* Read off the global at call time, never captured, so the app still runs with no portal around it. */
    esc: (v) => (window.DCR2 && window.DCR2.h ? window.DCR2.h(v) : String(v == null ? "" : v)),
    confirm: (...args) => window.DCR2.confirm(...args),
    alert: (...args) => window.DCR2.alert(...args),
    ask: (...args) => window.DCR2.ask(...args),
  };

  /* One drawing belongs to one estimate, on one account. CME's own library key is device-wide with an
     activeProjectId, so without this the project switcher on a shared tablet lists — and can silently attach —
     another customer's deck (or another rep's). app.js keys its library "cme.project-library.v1." + this scope. */
  window.CME_STORAGE_SCOPE = "dcr2-" + profile.id + "-" + (estimateId ? "estimate-" + estimateId : "standalone");

  /* The bridge BEFORE the app (the old boot.js put it after): app.js draws "Save to Step 1" the moment it is imported,
     and a tap in the gap before the bridge was hooked ran app.js's own handler, which downloads a JSON file instead
     of saving to the estimate. The bridge reads the document only at the tap (window.CME_CURRENT_DOCUMENT, set by
     app.js), so hooking it first is safe. */
  await import("./portal-bridge.js");
  window.CME_BRIDGE.install(() => window.CME_CURRENT_DOCUMENT());

  await import("./src/ui/app.js");
} catch (error) {
  if (!error || !error.quiet) {
    console.error("[CME] boot failed", error);
    fail((error && error.message) || "Something went wrong starting the drawing tool.");
  }
}
