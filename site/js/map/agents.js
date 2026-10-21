/* DCR Agents 2's PC as the home page shows it to an admin (BLUEPRINT 2.3.5, migration M4
   20261023000100_agents_core): one line from rpc agents_server_status() —

     "DCR Agents 2 PC - last seen 3 min ago"          green: it beat within 3 minutes (12 for an older build)
     "DCR Agents 2 PC - last seen 2 h ago"            amber: it has gone quiet
     "DCR Agents 2 PC - not seen yet"                 grey: no computer has reported

   plus "(in Standby)" / "(paused)" when the server says so, and a tooltip with the computer, its version and
   its last error. Pure: the answer in, the line out (tests/p4-agents.test.mjs). */

const num = (v) => (typeof v === "number" && isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && isFinite(Number(v)) ? Number(v) : null);

/** Minutes since an ISO moment (rounded, as the database counts them), or null. */
export function minutesSince(iso, now) {
  const t = Date.parse(String(iso || ""));
  if (!isFinite(t)) return null;
  const n = now instanceof Date ? now.getTime() : (typeof now === "number" ? now : Date.now());
  return Math.max(0, Math.round((n - t) / 60000));
}

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function agoText(minutes) {
  const m = num(minutes);
  if (m === null) return "";
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 48 * 60) return Math.floor(m / 60) + " h ago";
  return Math.floor(m / 1440) + " days ago";
}

/** The home page's line from rpc agents_server_status (or null when there is no answer to draw):
    {text, cls: "ok" | "warn" | "off", title}. */
export function serverLine(answer, now) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  const s = answer.server;
  if (!s || typeof s !== "object") {
    return { text: "DCR Agents 2 PC - not seen yet", cls: "off", title: "No computer running DCR Agents 2 has reported yet." };
  }
  let minutes = num(s.minutesAgo);
  if (minutes === null) minutes = minutesSince(s.lastSeen, now);
  if (minutes === null) {
    return { text: "DCR Agents 2 PC - not seen yet", cls: "off", title: "No computer running DCR Agents 2 has reported yet." };
  }
  const extra = [];
  if (s.standby === true) extra.push("in Standby");
  if (s.paused === true) extra.push("paused");
  const text = "DCR Agents 2 PC - last seen " + agoText(minutes) + (extra.length ? " (" + extra.join(", ") + ")" : "");
  const title = [String(s.host || "").trim(), s.version ? "DCR Agents " + String(s.version).trim() : "",
    s.lastError ? "last error: " + String(s.lastError).trim() : ""].filter(Boolean).join(" · ");
  return { text: text, cls: s.online === true ? "ok" : "warn", title: title };
}
