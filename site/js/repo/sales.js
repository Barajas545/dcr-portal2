/* Sales estimating's data (BLUEPRINT 3.3.11 "Sales estimates and materials library"; Appendix A "sales": the sales
   tables plus the sales-media bucket; migration M5c 20261027000100_office_lists; Q10 owner 2026-10-21). Replaces
   the old ?action=sales parts (refs, estimates, materials, image, media, setup): every read is a plain select under
   row level security, so a person without the Sales estimates switch is answered no row at all, and the amounts
   (sales_reference_prices, sales_estimate_prices) come back only with the prices switch too — the embed is null
   otherwise, and the pages treat null as "hidden".

   Reads
   * salesAccess(me)                 {sales, missing}: the person's own Sales estimates switch as the database has it
                                     (profiles.can_sales_estimates; missing: the column is not there yet);
   * listRefs({trade, all})          the comps (map/sales.js toRef), the price row embedded (or null);
   * listEstimates()                 the saved estimates, newest first, without their big JSON parts;
   * getEstimate(id)                 one estimate with its scope, selection, media and (prices) its money row;
   * listMaterials({trade})          the Materials Library rows (map/sales.js toMaterial);
   * mediaUrl(path, seconds)         a signed URL for one sales-media object (an hour: an open gallery), several asked
                                     together in one request.
   Writes (the version read is sent: an empty answer re-reads — still there means 409, gone means 404)
   * saveRef(id, version, fields, prices, pricesVersion)       the comp row, then (prices only) its price row — M5c
                                     makes that row with every comp (t20), so it is always a versioned PATCH on
                                     reference_id; -> {id, version, pricesVersion};
   * saveEstimate(id, version, fields, prices, pricesVersion)  the same for an estimate and sales_estimate_prices
                                     (estimate_id); a person without the prices switch sends no prices, so a save of
                                     theirs never touches what a priced estimator worked out;
   * saveMaterial(id, version, fields);  delete{Ref,Estimate,Material}(id, version);
   * mediaStore(kind, key)           {url(entry), upload(blob, name, {stable})} for js/sales/gallery.js and the drawing
                                     launcher: sales-media/{estimates|references|materials}/{key}/{uuid}/{name}
                                     (map/sales.js mediaKey, M5c app.sales_media_path_ok), never overwritten except a
                                     drawing's own stable name (…/cme/cme-<id>.png, app.sales_media_drawing).

   The table, column and bucket names live in map/sales.js (COLS, TABLES, BUCKET) and nowhere else. */

import { db, must, idOf, pageAll, versioned, notFound } from "./_db.js";
import {
  COLS, TABLES, BUCKET, REF_EMBED, EST_EMBED_LITE, EST_EMBED, toRef, toEstimateLite, toEstimate, toMaterial, mediaKey, salesSwitch,
} from "../map/sales.js";

export const SIGNED_S = 3600;

function isMissingColumn(error) {
  const code = String((error && error.code) || "");
  return code === "42703" || code === "PGRST204" || /can_sales_estimates/.test(String((error && error.message) || ""));
}

/** The Sales estimates switch, as the database has it for the signed-in person. */
export async function salesAccess(me) {
  if (!me || !me.id) return { sales: false, missing: false };
  const c = await db();
  const res = await c.from("profiles").select("role, can_sales_estimates").eq("id", me.id);
  if (res && res.error) {
    if (isMissingColumn(res.error)) return { sales: false, missing: true };
    must(res);
  }
  const row = Array.isArray(res && res.data) ? res.data[0] : (res && res.data);
  return { sales: salesSwitch(row), missing: false };
}

/* ── comps ─────────────────────────────────────────────────────────── */
export async function listRefs(opts) {
  const o = opts || {};
  const rows = await pageAll((c) => {
    let q = c.from(TABLES.refs).select(COLS.refs + ", " + REF_EMBED);
    if (o.trade) q = q.eq("trade", o.trade);
    return q.order("id", { ascending: true });
  });
  const out = rows.map(toRef);
  return o.all ? out : out.filter((r) => r.activeAsReference !== false);
}

async function writeRow(table, id, version, fields, cols) {
  const c = await db();
  if (id !== null && id !== undefined) return versioned(table, idOf(id), version, fields, cols);
  const made = must(await c.from(table).insert(fields).select(cols)) || [];
  if (!made.length) throw Object.assign(new Error("You don't have permission to change this."), { code: "42501", status: 403 });
  return made[0];
}
/* A price row (sales_reference_prices / sales_estimate_prices) is made by the database with its comp or estimate, so a
   write is always a versioned PATCH on its key (M5c: "write it with PATCH ?<key>=eq.X&version=eq.V"). An empty answer
   re-reads: still there at another version = 409, at the same version = the policy refused it (no prices switch). */
async function writePrices(table, keyCol, keyVal, version, fields) {
  const c = await db();
  let v = version;
  if (v === null || v === undefined) {
    const cur = must(await c.from(table).select("version").eq(keyCol, keyVal)) || [];
    if (!cur.length) throw Object.assign(new Error("You don't have permission to change these amounts."), { code: "42501", status: 403 });
    v = cur[0].version;
  }
  const rows = must(await c.from(table).update(fields).eq(keyCol, keyVal).eq("version", v).select(keyCol + ", version")) || [];
  if (rows.length) return rows[0];
  const now = must(await c.from(table).select(keyCol + ", version").eq(keyCol, keyVal)) || [];
  if (now.length && Number(now[0].version) !== Number(v)) {
    throw Object.assign(new Error("Changed by someone else."), { code: "PT409", status: 409, current: now[0] });
  }
  throw Object.assign(new Error("You don't have permission to change these amounts."), { code: "42501", status: 403 });
}

export async function saveRef(id, version, fields, prices, pricesVersion) {
  const isNew = id === null || id === undefined;
  const row = await writeRow(TABLES.refs, id, version, fields, COLS.refs);
  let pv = pricesVersion;
  if (prices) pv = (await writePrices(TABLES.refPrices, "reference_id", row.id, isNew ? null : pricesVersion, prices)).version;
  return { id: row.id, version: row.version, pricesVersion: pv === undefined ? null : pv };
}

async function remove(table, id, version) {
  const c = await db();
  const rows = must(await c.from(table).delete().eq("id", idOf(id)).eq("version", version).select("id")) || [];
  if (rows.length) return true;
  const cur = must(await c.from(table).select("id, version").eq("id", idOf(id))) || [];
  if (cur.length) {
    const e = new Error(Number(cur[0].version) === Number(version) ? "You don't have permission to delete this." : "Changed by someone else.");
    e.code = Number(cur[0].version) === Number(version) ? "42501" : "PT409";
    e.status = Number(cur[0].version) === Number(version) ? 403 : 409;
    throw e;
  }
  throw notFound();
}
export function deleteRef(id, version) { return remove(TABLES.refs, id, version); }

/* ── estimates ─────────────────────────────────────────────────────── */
export async function listEstimates() {
  const rows = await pageAll((c) => c.from(TABLES.estimates).select(COLS.estimatesLite + ", " + EST_EMBED_LITE)
    .order("updated_at", { ascending: false }).order("id", { ascending: false }));
  return rows.map(toEstimateLite);
}

export async function getEstimate(id) {
  const c = await db();
  const row = (must(await c.from(TABLES.estimates).select(COLS.estimates + ", " + EST_EMBED).eq("id", idOf(id))) || [])[0];
  if (!row) return null;
  const refs = {};
  if (row.reference_project_id !== null && row.reference_project_id !== undefined) {
    const r = must(await c.from(TABLES.refs).select("id, project_ref").eq("id", row.reference_project_id)) || [];
    r.forEach((x) => { refs[String(x.id)] = x; });
  }
  return toEstimate(row, refs);
}

export async function saveEstimate(id, version, fields, prices, pricesVersion) {
  const isNew = id === null || id === undefined;
  const row = await writeRow(TABLES.estimates, id, version, fields, "id, version");
  let pv = pricesVersion;
  if (prices) pv = (await writePrices(TABLES.estPrices, "estimate_id", row.id, isNew ? null : pricesVersion, prices)).version;
  return { id: row.id, version: row.version, pricesVersion: pv === undefined ? null : pv };
}
export function deleteEstimate(id, version) { return remove(TABLES.estimates, id, version); }

/* ── the Materials Library ─────────────────────────────────────────── */
export async function listMaterials(opts) {
  const o = opts || {};
  const rows = await pageAll((c) => {
    let q = c.from(TABLES.materials).select(COLS.materials);
    if (o.trade) q = q.eq("trade", o.trade);
    return q.order("sort_order", { ascending: true }).order("id", { ascending: true });
  });
  return rows.map(toMaterial);
}
export async function saveMaterial(id, version, fields) {
  const row = await writeRow(TABLES.materials, id, version, fields, "id, version");
  return { id: row.id, version: row.version };
}
export function deleteMaterial(id, version) { return remove(TABLES.materials, id, version); }

/* ── sales-media ───────────────────────────────────────────────────── */
const urlCache = new Map();          // path -> {url, until}
let pending = null;                  // {paths: Map(path -> [resolve, reject][]), timer}

async function flushUrls() {
  const batch = pending;
  pending = null;
  const paths = Array.from(batch.paths.keys());
  let got = {};
  try {
    const c = await db();
    const b = c.storage.from(BUCKET);
    if (typeof b.createSignedUrls === "function") {
      const d = must(await b.createSignedUrls(paths, SIGNED_S)) || [];
      d.forEach((x) => { if (x && x.path && (x.signedUrl || x.signedURL) && !x.error) got[x.path] = x.signedUrl || x.signedURL; });
    } else {
      await Promise.all(paths.map((p) => b.createSignedUrl(p, SIGNED_S).then((r) => {
        if (r && !r.error && r.data) got[p] = r.data.signedUrl || r.data.signedURL;
      }, () => {})));
    }
  } catch (e) {
    batch.paths.forEach((cbs) => cbs.forEach((cb) => cb[1](e)));
    return;
  }
  const until = Date.now() + (SIGNED_S - 300) * 1000;
  batch.paths.forEach((cbs, p) => {
    if (got[p]) urlCache.set(p, { url: got[p], until });
    cbs.forEach((cb) => cb[0](got[p] || null));
  });
}

/** Forget the signed URLs remembered for this page (another person signed in: the tests). */
export function forgetMedia() { urlCache.clear(); }

/** A signed URL for one object; the URLs asked within the same moment go out as one request. */
export function mediaUrl(path) {
  if (!path) return Promise.resolve(null);
  const hit = urlCache.get(path);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.url);
  return new Promise((resolve, reject) => {
    if (!pending) pending = { paths: new Map(), timer: setTimeout(flushUrls, 25) };
    if (!pending.paths.has(path)) pending.paths.set(path, []);
    pending.paths.get(path).push([resolve, reject]);
  });
}

function uid() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID().replace(/-/g, "");
  let s = "";
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

/** Puts one picture, drawing or voice note into sales-media. opts.stable: the drawing's own name (one drawing, one
    file): it replaces the earlier object when the bucket allows that, else a fresh object is made. -> entry */
export async function uploadMedia(kind, key, blob, name, opts) {
  const o = opts || {};
  const c = await db();
  const b = c.storage.from(BUCKET);
  const mime = (blob && blob.type) || "application/octet-stream";
  const put = async (path, upsert) => b.upload(path, blob, { contentType: mime, upsert: !!upsert, cacheControl: "3600" });
  let path = o.stable ? mediaKey(kind, key, name, null, "cme") : mediaKey(kind, key, name, uid());
  let res = await put(path, !!o.stable);
  if (res && res.error && o.stable) {
    // the bucket keeps every object as it was put (no overwrite): a fresh object then
    path = mediaKey(kind, key, name, uid());
    res = await put(path, false);
  }
  if (res && res.error) {
    // Storage answers {statusCode: "403" | "409" | …}: the same sentences as a refused row
    const se = res.error, st = Number(se.statusCode || se.status || 0);
    throw Object.assign(new Error(st === 403 ? "You don't have permission to add pictures here." : (se.message || "The upload failed.")),
      { code: st === 403 ? "42501" : st === 409 ? "23505" : String(se.code || ""), status: st });
  }
  urlCache.delete(path);
  return { path, name: String(name || "file"), mime, size: (blob && blob.size) || null };
}

export function mediaStore(kind, key) {
  return {
    url: (entry) => mediaUrl(entry && entry.path),
    upload: (blob, name, opts) => uploadMedia(kind, key || "library", blob, name, opts),
    kind, key: key || "library",
  };
}
