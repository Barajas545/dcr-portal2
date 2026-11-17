/* The jobs' pictures on the shoot schedule (shoots.html; DCR Desktop 2 docs/PHOTO-SHOOT-EDITS.md §1.4): the shoot
   sheet's 64 px picture and the By job header's 48 px one - the project's own picture (projects.thumbnail_file_id).

   The page is left open on site for hours and a signed link lasts an hour, so a signed link is NEVER put in an img:
   each picture's bytes are fetched once per file id from a fresh signed link (repo/files.js thumbnailUrls, signed again
   for every fetch) and shown as a blob: URL kept in memory for the page's life (js/plan-pictures.js's way, without its
   IndexedDB: nothing is kept on the device). A new picture is a new file id, so nothing is ever invalidated.

   * createPictures(deps)   deps (the tests' parts): {sign(fileIds) -> {fileId: link}, fetch, toUrl(blob), revoke(url),
                            now()}
       .url(fileId)         the blob: URL shown for that picture, or null (the page draws the neutral tile)
       .want(fileIds)       fetches the pictures not shown yet (each one at most once at a time) -> true when one came
       .broken(fileId)      an img of it failed to draw: let go, so the next want() signs and fetches it again
       .dispose()           every URL let go
   A picture that cannot be had is not asked for again on every read (step 1's review, round 3: each read of the
   schedule signed and fetched it again): one Storage refused or that is no picture (an answer 400 - 499 but a time-out or
   a rate, bytes that are not an image or too big) is never asked for again in the page's life - a new picture is a new
   file id -; one with no link (a file not readable, gone, or kept on a computer only) or that could not be fetched (no
   signal, a server error, a sign that failed) is asked again after RETRY_MS. Only an https link (Storage's) is fetched;
   the demo's own links (blob: / data:, already in this page's memory) are shown as they are. Nothing here throws, and
   nothing is logged. */

import * as filesRepo from "./repo/files.js";

/** A picture larger than this is not shown (thumb-prep.js makes them at most 800 px: far smaller). */
export const MAX_BYTES = 3 * 1024 * 1024;
/** How long a picture that could not be had for now (no link, no signal, a server error) waits before it is asked again. */
export const RETRY_MS = 10 * 60 * 1000;

/** Fresh signed links for these pictures' file ids: {fileId: link} (a file not readable, or gone, is absent). */
async function signFresh(ids) {
  filesRepo.forgetThumbnails();                // a link that failed or ran out is never used again: signed anew
  return filesRepo.thumbnailUrls(ids.map((id) => ({ id, thumbnailFileId: id })));
}

const fileId = (v) => (/^[1-9][0-9]{0,15}$/.test(String(v === null || v === undefined ? "" : v)) ? String(v) : null);

export function createPictures(deps) {
  const d = Object.assign({
    sign: signFresh,
    fetch: (url, o) => fetch(url, o),
    toUrl: (blob) => URL.createObjectURL(blob),
    revoke: (url) => URL.revokeObjectURL(url),
    now: () => Date.now(),
  }, deps || {});
  const shown = new Map();     // file id -> {url, own}
  const asking = new Set();    // file ids on their way
  const failed = new Map();    // file id -> when it may be asked again (Infinity: never in the page's life)

  function url(id) {
    const k = fileId(id);
    const s = k ? shown.get(k) : null;
    return s ? s.url : null;
  }

  /** The picture's bytes -> {blob} | {never: true} (refused, or no picture) | {} (for now: no signal, a server error). */
  async function bytesOf(link) {
    try {
      const r = await d.fetch(link, { cache: "no-store" });
      const status = Number(r && r.status) || 0;
      if (!r || !r.ok) return status >= 400 && status < 500 && status !== 408 && status !== 429 ? { never: true } : {};
      const blob = await r.blob();
      return blob && /^image\//.test(String(blob.type || "")) && blob.size > 0 && blob.size <= MAX_BYTES ? { blob } : { never: true };
    } catch (e) { return {}; }
  }

  const waiting = (k) => failed.has(k) && d.now() < failed.get(k);
  const fail = (k, never) => { failed.set(k, never ? Infinity : d.now() + RETRY_MS); };

  async function want(ids) {
    const need = Array.from(new Set((ids || []).map(fileId).filter((k) => k && !shown.has(k) && !asking.has(k) && !waiting(k))));
    if (!need.length) return false;
    need.forEach((k) => asking.add(k));
    let got = false;
    try {
      let links = null;
      try { links = (await d.sign(need)) || {}; } catch (e) { links = null; }
      for (const k of need) {
        if (!links) { fail(k, false); continue; }           // the sign failed: for now
        const link = typeof links[k] === "string" ? links[k] : "";
        if (/^https:\/\//.test(link)) {
          const b = await bytesOf(link);
          if (!b.blob) { fail(k, b.never); continue; }
          let u = null;
          try { u = d.toUrl(b.blob); } catch (e) { u = null; }
          if (u) { shown.set(k, { url: u, own: true }); failed.delete(k); got = true; }
        } else if (/^(blob|data):/.test(link)) {
          shown.set(k, { url: link, own: false });           // the demo's: in this page's memory already
          failed.delete(k);
          got = true;
        } else fail(k, false);                               // no link: not readable, gone, or on a computer only
      }
    } finally {
      need.forEach((k) => asking.delete(k));
    }
    return got;
  }

  function broken(id) {
    const k = fileId(id);
    const s = k ? shown.get(k) : null;
    if (!s) return false;
    shown.delete(k);
    if (s.own) { try { d.revoke(s.url); } catch (e) { /* gone */ } }
    return true;
  }

  function dispose() {
    shown.forEach((s) => { if (s.own) { try { d.revoke(s.url); } catch (e) { /* gone */ } } });
    shown.clear();
  }

  return { url, want, broken, dispose };
}
