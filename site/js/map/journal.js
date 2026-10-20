/* Journal entries (journal_entries) <-> the old journal's shape (BLUEPRINT 3.3.3):

     journalDate <- entry_date ("YYYY-MM-DD", the Pacific day)   journalCategory <- category label
     title <- title   journalEntry <- body   journalWeather <- weather   journalCrewSize <- crew_size
     journalHours <- hours   journalFollowUp <- follow_up   journalAuthor <- the author's name

   Media is no longer a JSON column: each photo / video is a files row (folder 'journal',
   journal_entry_id, subpath = the entry's date, description = its caption, preview_path).
   toMedia() turns those rows into the {name, desc, video, ...} items the old page drew.

   Pure module. */

export const CATEGORIES = Object.freeze(["progress", "delay", "issue", "safety", "inspection", "delivery",
  "visitor", "weather", "change_order", "other"]);
export const CATEGORY_LABELS = Object.freeze({
  progress: "Progress", delay: "Delay", issue: "Issue", safety: "Safety", inspection: "Inspection",
  delivery: "Delivery", visitor: "Visitor", weather: "Weather", change_order: "Change order", other: "Other",
});

export function categoryLabel(c) {
  return CATEGORY_LABELS[String(c || "")] || "Other";
}
/** A label or a database word -> the database word ("Change order" -> change_order). */
export function categoryKey(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, "_");
  return CATEGORIES.indexOf(s) !== -1 ? s : "progress";
}

const VIDEO_EXT = /\.(mp4|mov|m4v|avi|3gp|webm)$/i;
export function isVideo(row) {
  return String((row && (row.mime || row.mimeType)) || "").indexOf("video/") === 0 || VIDEO_EXT.test(String((row && row.name) || ""));
}

export function toMedia(fileRow) {
  return {
    fileId: fileRow.id,
    name: fileRow.name,
    desc: fileRow.description || "",
    video: isVideo(fileRow),
    mime: fileRow.mime || "",
    storage: fileRow.storage || "cloud",
    storagePath: fileRow.storage_path || null,
    previewPath: fileRow.preview_path || null,
    journalEntryId: fileRow.journal_entry_id == null ? null : fileRow.journal_entry_id,
    version: fileRow.version == null ? 1 : Number(fileRow.version),
    createdBy: fileRow.created_by || null,
  };
}

export function toEntry(row, nameOf, files) {
  if (!row) return null;
  let author = "";
  if (row.created_by && typeof nameOf === "function") {
    try { author = nameOf(row.created_by) || ""; } catch (e) { author = ""; }
  }
  return {
    id: row.id,
    projectId: row.project_id,
    journalDate: row.entry_date || "",
    category: row.category || "progress",
    journalCategory: categoryLabel(row.category),
    title: row.title || "",
    journalEntry: row.body || "",
    journalWeather: row.weather || "",
    journalCrewSize: row.crew_size == null ? null : Number(row.crew_size),
    journalHours: row.hours == null ? null : Number(row.hours),
    journalFollowUp: !!row.follow_up,
    journalAuthor: author,
    createdBy: row.created_by || null,
    createdAt: row.created_at || null,
    version: row.version == null ? 1 : Number(row.version),
    media: (files || []).filter(function (f) { return String(f.journal_entry_id) === String(row.id); }).map(toMedia),
  };
}

function numOrNull(v, int) {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return int ? Math.round(n) : Math.round(n * 1000) / 1000;
}

/** The phone's draft {date, cat, wx, crew, hrs, title, body, follow} -> journal_entries columns.
    An empty headline takes the first line of the write-up (80 characters), as the old page did. */
export function fromDraft(d) {
  d = d || {};
  const body = String(d.body == null ? "" : d.body);
  const title = String(d.title || "").trim() || (body.split("\n")[0] || "").trim().slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || "")) ? String(d.date) : null;
  const out = {
    category: categoryKey(d.cat),
    title: title,
    body: body.trim() ? body : null,
    weather: String(d.wx || "").trim() || null,
    crew_size: numOrNull(d.crew, true),
    hours: numOrNull(d.hrs, false),
    follow_up: !!d.follow,
  };
  if (date) out.entry_date = date;
  return out;
}

/** Worth a row on the server? Only once there is something a person would be upset to lose
    (the old page's rule). */
export function worthKeeping(d, mediaCount) {
  d = d || {};
  return String(d.body || "").trim().length >= 3 || String(d.title || "").trim().length >= 3 || (mediaCount || 0) > 0;
}

/** The entry's facts line: "Clear, 78F · 4 on site · 8 hrs". */
export function factsLine(e, hoursWord) {
  const bits = [];
  if (e.journalWeather) bits.push(e.journalWeather);
  if (e.journalCrewSize) bits.push(e.journalCrewSize + " on site");
  if (e.journalHours) bits.push(e.journalHours + " " + (hoursWord || "hrs"));
  return bits;
}
