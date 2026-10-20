/* Files (BLUEPRINT 2.2.5, 3.3.4; Appendix A "thumb", "drive"): the Files tab, journal media, project
   pictures. Bytes live in the private bucket project-files (cloud rows) or on the office PCs'
   OneDrive project folders (local rows: listed by name and date, never opened from the web).

   * listCurrent(projectId)       current_files of a project (newest live version of each file; the
                                  database hides receipts and priced folders from people without the
                                  switch);
   * journalMedia(projectId)      its journal photos / videos (folder journal);
   * signedUrl(path, s)           one object, 120 s for a document (map/files SIGNED_DOC_S);
   * signedUrls(paths, s)         many at once ({path: url}); up to an hour for a gallery;
   * thumbnailUrls(projects)      {projectId: url} of the project pictures (projects.thumbnail_file_id),
                                  remembered for the page;
   * setCaption(item, text)       files.description, versioned (the uploader, managers, admins). */

import { db, must, versioned, pageAll, idOf } from "./_db.js";
import { toFileItem, SIGNED_DOC_S, SIGNED_GALLERY_S } from "../map/files.js";

export const BUCKET = "project-files";

export async function listCurrent(projectId) {
  const rows = await pageAll(function (c) {
    return c.from("current_files").select("*").eq("project_id", idOf(projectId)).order("created_at", { ascending: false });
  });
  return rows.map(toFileItem);
}

export async function journalMedia(projectId) {
  const c = await db();
  const rows = must(await c.from("current_files").select("*").eq("project_id", idOf(projectId)).eq("folder", "journal")
    .order("created_at", { ascending: true })) || [];
  return rows;
}

export async function signedUrl(path, seconds) {
  if (!path) return null;
  const c = await db();
  const d = must(await c.storage.from(BUCKET).createSignedUrl(path, seconds || SIGNED_DOC_S));
  return d ? (d.signedUrl || d.signedURL || null) : null;
}

export async function signedUrls(paths, seconds) {
  const list = Array.from(new Set((paths || []).filter(Boolean)));
  const out = {};
  if (!list.length) return out;
  const c = await db();
  const b = c.storage.from(BUCKET);
  if (typeof b.createSignedUrls === "function") {
    const d = must(await b.createSignedUrls(list, seconds || SIGNED_GALLERY_S)) || [];
    d.forEach(function (x) { if (x && x.path && (x.signedUrl || x.signedURL) && !x.error) out[x.path] = x.signedUrl || x.signedURL; });
    return out;
  }
  await Promise.all(list.map(function (p) {
    return b.createSignedUrl(p, seconds || SIGNED_GALLERY_S).then(function (r) {
      if (!r.error && r.data) out[p] = r.data.signedUrl || r.data.signedURL;
    }, function () {});
  }));
  return out;
}

const thumbByFile = new Map();     // file id -> url | "none"

/** {projectId: url} for the projects that have a picture; projects without one are absent. */
export async function thumbnailUrls(projects) {
  const want = (projects || []).filter(function (p) { return p && p.thumbnailFileId != null; });
  const missing = Array.from(new Set(want.map(function (p) { return String(p.thumbnailFileId); })
    .filter(function (id) { return !thumbByFile.has(id); })));
  if (missing.length) {
    const c = await db();
    const rows = [];
    for (let i = 0; i < missing.length; i += 200) {
      const part = must(await c.from("files").select("id, storage_path, preview_path, storage").in("id", missing.slice(i, i + 200).map(idOf))) || [];
      part.forEach(function (r) { rows.push(r); });
    }
    const byPath = {};
    rows.forEach(function (r) { if (r.storage_path && (r.storage || "cloud") === "cloud") byPath[r.preview_path || r.storage_path] = String(r.id); });
    let urls = {};
    try { urls = await signedUrls(Object.keys(byPath), SIGNED_GALLERY_S); } catch (e) { urls = {}; }
    missing.forEach(function (id) { thumbByFile.set(id, "none"); });
    Object.keys(byPath).forEach(function (path) { if (urls[path]) thumbByFile.set(byPath[path], urls[path]); });
  }
  const out = {};
  want.forEach(function (p) {
    const u = thumbByFile.get(String(p.thumbnailFileId));
    if (u && u !== "none") out[String(p.id)] = u;
  });
  return out;
}

export function forgetThumbnails() { thumbByFile.clear(); }

export async function setCaption(item, text) {
  const t = String(text == null ? "" : text).trim().slice(0, 2000);     // files_description_check
  const row = await versioned("files", idOf(item.fileId != null ? item.fileId : item.id), item.version,
    { description: t || null });
  return row;
}
