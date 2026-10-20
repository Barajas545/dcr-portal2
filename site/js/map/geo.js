/* Where projects are, for Site Photos (ported as-is from the old common.js, BLUEPRINT 2.2.3):

   * parseCoords("lat,lng|src") -> {lat, lng, src} | null
   * distanceMi(a, b)           great-circle miles
   * rank(projects, pos)        nearest first; the unlocated after, most recently touched first
   * fmtMi(d)                   "you're here" under ~1000 ft, "2.4 mi", "37 mi"
   * eligible(p)                completed and closed jobs never compete to be "nearest"
   * pinRule(current, next)     the database's write-once rule for set_project_location, mirrored
                                so the page does not even ask when the answer is "no"

   Pure module. */

export const NEAR_MI = 0.19;
export const GPS_MAX_ACCURACY_M = 100;
const HIDDEN = { completed: 1, closed: 1 };

export function parseCoords(s) {
  if (!s) return null;
  const parts = String(s).split("|");
  const n = parts[0].split(/[,;\s]+/).map(parseFloat).filter(function (v) { return !isNaN(v); });
  if (n.length < 2 || Math.abs(n[0]) > 90 || Math.abs(n[1]) > 180) return null;
  return { lat: n[0], lng: n[1], src: (parts[1] || "").trim() || "gps" };
}

export function distanceMi(a, b) {
  const R = 3958.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(dLng / 2), 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function coordsOf(p) {
  if (!p) return null;
  if (p.lat != null && p.lng != null && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))) {
    return { lat: Number(p.lat), lng: Number(p.lng), src: p.locationSource || p.location_source || "geocode" };
  }
  return parseCoords(p.projectCoordinates);
}

export function distanceOf(p, pos) {
  if (!pos) return null;
  const c = coordsOf(p);
  return c ? distanceMi(pos, c) : null;
}

export function fmtMi(d) {
  if (d == null) return "";
  if (d < NEAR_MI) return "you're here";
  if (d < 10) return d.toFixed(1) + " mi";
  return Math.round(d) + " mi";
}

export function eligible(p) {
  return !HIDDEN[String((p && (p.status || "")) || "")];
}

export function rank(list, pos) {
  const withD = [], without = [];
  (list || []).forEach(function (p) {
    const d = distanceOf(p, pos);
    if (d == null) without.push(p); else withD.push({ p: p, d: d });
  });
  withD.sort(function (a, b) { return a.d - b.d; });
  without.sort(function (a, b) {
    return String(b.projectDateLastModified || "").localeCompare(String(a.projectDateLastModified || ""));
  });
  return withD.map(function (x) { return x.p; }).concat(without);
}

/** The top hit gets the spotlight only when GPS put us next to it and nothing else is nearly as
    close. */
export function confidentTop(list, pos, query) {
  if (query || !list || !list.length) return false;
  const a = distanceOf(list[0], pos);
  const b = list[1] ? distanceOf(list[1], pos) : null;
  return a != null && a < NEAR_MI && (b == null || b > a + 0.05);
}

export function matches(p, q) {
  if (!q) return true;
  const hay = [p.internalIDNumber, p.projectName, p.projectAddress, p.projectCity, p.projectClientName]
    .filter(Boolean).join(" ").toLowerCase();
  return String(q).toLowerCase().split(/\s+/).filter(Boolean).every(function (w) { return hay.indexOf(w) !== -1; });
}

/** Would set_project_location store this pin? (mirrors the RPC: an untouched import from the old
    portal takes no automatic point; fill an empty pin, or upgrade a geocode guess to GPS; a GPS pin
    only by admin / manager; GPS needs 0..100 m accuracy).
    -> "store" | "old_portal" | "accuracy" | "exists" | "range". The database decides; this only saves
    a call. dormant: the project is such an import (map/legacy.js dormant). */
export function pinRule(current, next, role, dormant) {
  if (!next || !Number.isFinite(next.lat) || !Number.isFinite(next.lng) ||
      Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180) return "range";
  const src = next.src || "gps";
  if (dormant && src !== "manual") return "old_portal";
  const hasAcc = next.accuracy !== null && next.accuracy !== undefined && next.accuracy !== "";
  const acc = Number(next.accuracy);
  if (src === "gps" && !(hasAcc && acc > 0 && acc <= GPS_MAX_ACCURACY_M)) return "accuracy";
  if (!current) return "store";                                   // an empty point: anyone fills it
  if (src === "geocode") return "exists";                         // a guess never replaces a point
  if (src === "gps" && (current.src || "geocode") === "geocode") return "store";   // a real fix upgrades a guess
  const office = role === "admin" || role === "manager";
  return office ? "store" : "exists";                             // managers and admins move any point
}
