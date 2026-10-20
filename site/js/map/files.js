/* Files (current_files) -> the Files tab's folder browser (BLUEPRINT 2.2.5, 3.3.4).

   The old tab walked SharePoint folders. Desktop 2 has a fixed set of top folders (plans,
   photos, documents, ...) with free sub-folders (files.subpath). The tab shows the same
   breadcrumb browser over a virtual tree built from the rows:

     root -> folder (Floor Plans, Photos, ...) -> subpath segments -> files

   Each file says where its bytes are: a cloud row ("Stored in DCR") opens through a signed URL;
   a local row lives in the OneDrive project folder on the office PCs and is listed by name and
   date only ("On the office computers").

   Pure module. */

export const FOLDERS = Object.freeze([
  { key: "plans", label: "Floor Plans", icon: "📐" },
  { key: "photos", label: "Photos", icon: "🖼️" },
  { key: "documents", label: "Documents", icon: "📄" },
  { key: "journal", label: "Journal photos", icon: "📓" },
  { key: "item", label: "Item files", icon: "📎" },
  { key: "estimates", label: "Estimates", icon: "🧾" },
  { key: "invoices", label: "Invoices", icon: "🧾" },
  { key: "receipts", label: "Receipts", icon: "🧾" },
]);
const LABELS = FOLDERS.reduce(function (m, f) { m[f.key] = f; return m; }, {});
export const LOCAL_LABEL = "On the office computers";
export const CLOUD_LABEL = "Stored in DCR";

export function folderLabel(key) { return (LABELS[key] && LABELS[key].label) || String(key || ""); }

export function toFileItem(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name || "",
    folder: row.folder || "",
    subpath: row.subpath || "",
    size: row.size == null ? null : Number(row.size),
    modifiedTime: row.modified_at || row.created_at || null,
    createdAt: row.created_at || null,
    mimeType: row.mime || "",
    storage: row.storage || "cloud",
    cloud: (row.storage || "cloud") === "cloud",
    storagePath: row.storage_path || null,
    previewPath: row.preview_path || null,
    description: row.description || "",
    versionNo: row.version_no == null ? 1 : Number(row.version_no),
    version: row.version == null ? 1 : Number(row.version),
    journalEntryId: row.journal_entry_id == null ? null : row.journal_entry_id,
    source: row.source || null,
    createdBy: row.created_by || null,
    relPath: row.rel_path || null,
  };
}

function segs(subpath) {
  return String(subpath || "").split("/").filter(Boolean);
}

/** What sits at `path` (["photos", "2026-10-19"]): {folders: [{name, path, count}], files: [...]}.
    path [] is the root: one entry per top folder that has files (the project picture is not
    listed: it is changed on the header). */
export function listAt(items, path) {
  path = path || [];
  const live = (items || []).filter(function (f) { return f.folder && f.folder !== "thumbnail"; });
  if (!path.length) {
    const counts = {};
    live.forEach(function (f) { counts[f.folder] = (counts[f.folder] || 0) + 1; });
    const folders = FOLDERS.filter(function (f) { return counts[f.key]; }).map(function (f) {
      return { name: f.label, key: f.key, icon: f.icon, path: [f.key], count: counts[f.key] };
    });
    // a folder Desktop 2 adds later still shows
    Object.keys(counts).forEach(function (k) {
      if (!LABELS[k]) folders.push({ name: k, key: k, icon: "📁", path: [k], count: counts[k] });
    });
    return { folders: folders, files: [] };
  }
  const top = path[0], below = path.slice(1);
  const inFolder = live.filter(function (f) { return f.folder === top; });
  const sub = {}, files = [];
  inFolder.forEach(function (f) {
    const s = segs(f.subpath);
    for (let i = 0; i < below.length; i++) {
      if ((s[i] || "").toLowerCase() !== String(below[i]).toLowerCase()) return;
    }
    if (s.length > below.length) {
      const name = s[below.length];
      const k = name.toLowerCase();
      if (!sub[k]) sub[k] = { name: name, path: path.concat([name]), count: 0 };
      sub[k].count++;
    } else {
      files.push(f);
    }
  });
  const folders = Object.keys(sub).map(function (k) { return sub[k]; });
  // date folders newest first, others by name
  folders.sort(function (a, b) {
    const da = /^\d{4}-\d{2}-\d{2}$/.test(a.name), db = /^\d{4}-\d{2}-\d{2}$/.test(b.name);
    if (da && db) return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
    if (da !== db) return da ? -1 : 1;
    return a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
  });
  files.sort(function (a, b) {
    return String(b.modifiedTime || "").localeCompare(String(a.modifiedTime || "")) ||
      a.name.localeCompare(b.name, "en", { numeric: true, sensitivity: "base" });
  });
  return { folders: folders, files: files };
}

export function crumbs(path) {
  const out = [{ name: "Project files", path: [] }];
  (path || []).forEach(function (p, i) {
    out.push({ name: i === 0 ? folderLabel(p) : p, path: path.slice(0, i + 1) });
  });
  return out;
}

export function fmtSize(n) {
  n = Number(n) || 0;
  if (!n) return "";
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + " GB";
  if (n > 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n > 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}

export function fileIcon(f) {
  const m = String(f.mimeType || f.mime || "");
  const n = String(f.name || "").toLowerCase();
  if (m.indexOf("image") === 0) return "🖼️";
  if (m.indexOf("video") === 0) return "🎬";
  if (m.indexOf("audio") === 0) return "🎙️";
  if (m.indexOf("pdf") !== -1 || /\.pdf$/.test(n)) return "📕";
  if (m.indexOf("sheet") !== -1 || m.indexOf("excel") !== -1 || /\.(xlsx?|csv)$/.test(n)) return "📊";
  if (/\.takeoff$/.test(n)) return "📐";
  return "📄";
}

/** Signed-URL lifetimes (BLUEPRINT 2.2.5): 120 s for a document, up to an hour for a gallery. */
export const SIGNED_DOC_S = 120;
export const SIGNED_GALLERY_S = 3600;
