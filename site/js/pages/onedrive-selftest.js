/* The admin's OneDrive self-test (DCR Desktop 2 docs/ONEDRIVE.md §13): what the owner's read-only probe cannot check -
   the browser's own upload to OneDrive (cross-site, in chunks) and Microsoft's stamp of the app on an uploaded file -
   checked from this page, whose security policy names the OneDrive host. Loaded only when an admin clicks
   "OneDrive self-test" on the test project A000T2 (never kept ahead on a phone: not in sw.js SHELL); it refuses to run
   for anybody else or on any other project.

   The steps, each PASS or FAIL with the broker's error code and nothing else (no name, link or ticket is shown):
     1. status         every check passes; the grant is "folder" (or "site" when the fallback is acknowledged);
     2. ensure_folder  A000T2's folder and Floor Plans, Photos, Documents are made or found;
     3. upload         Documents/DCR self-test/self-test <time>.txt, a made-up text of 400 KB, PUT straight to the
                       upload URL in TWO chunks (Content-Range, no Authorization header): CORS and chunking;
     4. upload_done    recorded: Microsoft stamped the app on the file;
     5. upload_done    again: already (a retried upload never makes a second row);
     6. the same name  once more: renamed (OneDrive's "... 1.txt": nothing is ever replaced);
     7. list + open    both files are listed; a download link; one ranged GET of it (bytes 0-15): 206 and the text;
     8. a refusal      upload_session of self-test.exe: 415 file_type.
   Afterwards (the broker never deletes): the owner deletes Documents/DCR self-test in OneDrive and the two rows in
   DCR Desktop 2. The upload URL stays in this page's memory only; the result is shown, never stored. */

import * as onedrive from "../repo/onedrive.js";
import { xhrTransport } from "../onedrive-upload.js";
import { chunkPlan, parseNext, CHUNK_UNIT } from "../map/onedrive.js";

export const FOLDER = "Documents";
export const REL_DIR = "DCR self-test";
export const SIZE = 400 * 1024;

/** The made-up text the test uploads: SIZE bytes, ASCII, its first 16 bytes "DCR self-test 00". */
export function testText(stampText) {
  let out = "";
  for (let i = 0; out.length < SIZE; i++) out += "DCR self-test " + String(i).padStart(6, "0") + " " + stampText + "\n";
  return out.slice(0, SIZE);
}

function stampOf(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " + p(d.getUTCHours()) + "." + p(d.getUTCMinutes()) + "." + p(d.getUTCSeconds());
}

function codeOf(e) { return String((e && e.code) || (e && e.status) || "error"); }

/** PUT a whole file to an upload URL in chunks of `chunk` bytes -> {chunks, item} (the last answer's driveItem). */
async function putAll(send, url, blob, chunk) {
  let offset = 0, chunks = 0;
  for (;;) {
    const plan = chunkPlan(blob.size, offset, chunk);
    if (!plan) throw Object.assign(new Error("no final answer"), { code: "no_item" });
    const res = await send({ method: "PUT", url, headers: { "Content-Range": plan.range }, body: blob.slice(plan.start, plan.end) });
    chunks++;
    let body = null;
    try { body = JSON.parse(res.text() || "null"); } catch (e) { body = null; }
    if (res.status === 202) {
      const next = body ? parseNext(body.nextExpectedRanges) : null;
      offset = next !== null ? next : plan.end;
      continue;
    }
    if ((res.status === 200 || res.status === 201) && body && typeof body.id === "string") return { chunks, item: body };
    throw Object.assign(new Error("HTTP " + res.status), { code: "http_" + res.status });
  }
}

/** Runs the steps into `box` (parts: {send, fetch, now} for the tests) -> [{step, name, ok, code}]. */
export async function run(ctx, box, parts) {
  const p = Object.assign({ send: xhrTransport(), fetch: (u, o) => fetch(u, o), now: () => new Date() }, parts);
  const esc = ctx.esc;
  if (!onedrive.selfTestFor(ctx.me, ctx.project)) {
    box.innerHTML = '<div class="pj-empty">The OneDrive self-test runs for an admin on the test project ' + esc(onedrive.SELF_TEST_PROJECT) + " only.</div>";
    return [];
  }
  const pid = ctx.pid;
  const out = [];
  const paintSteps = (running) => {
    box.innerHTML = '<div class="od-test"><div class="od-top"><span class="od-title">🧪 OneDrive self-test — ' + esc(onedrive.SELF_TEST_PROJECT) + "</span>" +
      (running ? '<span class="pj-sub">running…</span>' : "") + "</div>" +
      out.map((r) => '<div class="od-step ' + (r.ok ? "ok" : "err") + '"><b>' + (r.ok ? "PASS" : "FAIL") + "</b> " + r.step + ". " + esc(r.name) +
        (r.code ? ' <span class="pj-sub">(' + esc(r.code) + ")</span>" : "") + "</div>").join("") +
      (running ? "" : '<div class="pj-sub od-after">Afterwards: delete the folder Documents\\' + esc(REL_DIR) + " of " + esc(onedrive.SELF_TEST_PROJECT) +
        " in OneDrive, and its two rows in DCR Desktop 2 (the project's Files tab → Delete). The portal never deletes.</div>") + "</div>";
  };
  const step = async (n, name, fn) => {
    let r;
    try {
      const v = await fn();
      r = { step: n, name, ok: v === true || (v && v.ok === true), code: v && v.code ? String(v.code) : "" };
    } catch (e) {
      r = { step: n, name, ok: false, code: codeOf(e) };
    }
    out.push(r);
    paintSteps(true);
    return r.ok;
  };
  paintSteps(true);

  const when = stampOf(p.now());
  const name = "self-test " + when + ".txt";
  const blob = new Blob([testText(when)], { type: "text/plain" });
  let first = null, ticket = null;

  const okStatus = await step(1, "The broker's status: settings, token, the narrow grant, the Projects folder", async () => {
    const s = await onedrive.status();
    const bad = s.checks.filter((c) => !c.ok).map((c) => c.name + (c.code ? ":" + c.code : ""));
    return { ok: s.ok && (s.grant === "folder" || s.grant === "site"), code: s.ok ? "grant " + s.grant : bad.join(", ") || "not ok" };
  });
  const okFolder = okStatus && await step(2, "The project's folder with Floor Plans, Photos and Documents", async () => {
    const r = await onedrive.ensureFolder(pid);
    return { ok: r.state === "made" || r.state === "exists", code: r.state };
  });
  const okUpload = okFolder && await step(3, "An upload straight to OneDrive in two chunks, no sign-in header", async () => {
    const s = await onedrive.uploadSession({ projectId: pid, folder: FOLDER, relDir: REL_DIR, name, size: blob.size });
    ticket = s.ticket;
    const r = await putAll(p.send, s.uploadUrl, blob, CHUNK_UNIT);
    first = r.item;
    return { ok: r.chunks === 2, code: r.chunks + " chunks" };
  });
  if (okUpload) {
    await step(4, "The broker records it (Microsoft stamped the app on the file)", async () => {
      const d = await onedrive.uploadDone(pid, first.id, ticket);
      return { ok: d.recorded && !d.already, code: d.recorded ? "" : d.reason || "not recorded" };
    });
    await step(5, "Asked again: the same row, never a second", async () => {
      const d = await onedrive.uploadDone(pid, first.id, ticket);
      return { ok: d.recorded && d.already, code: d.already ? "" : "not already" };
    });
    let second = null;
    await step(6, "The same name once more: OneDrive renames it, nothing is replaced", async () => {
      const s = await onedrive.uploadSession({ projectId: pid, folder: FOLDER, relDir: REL_DIR, name, size: blob.size });
      const r = await putAll(p.send, s.uploadUrl, blob, CHUNK_UNIT);
      second = r.item;
      const d = await onedrive.uploadDone(pid, r.item.id, s.ticket);
      return { ok: d.recorded && d.renamed, code: d.renamed ? "" : "not renamed" };
    });
    await step(7, "Both are listed; a link opens the first without a sign-in", async () => {
      const page = await onedrive.list(pid, [FOLDER, REL_DIR]);
      const ids = page.entries.map((e) => e.id);
      if (ids.indexOf(first.id) === -1 || (second && ids.indexOf(second.id) === -1)) return { ok: false, code: "not listed" };
      const link = await onedrive.download(pid, first.id);
      const res = await p.fetch(link.url, { headers: { Range: "bytes=0-15" }, credentials: "omit", cache: "no-store" });
      const text = (await res.text()).slice(0, 16);
      return { ok: (res.status === 206 || res.status === 200) && text === testText(when).slice(0, 16), code: "HTTP " + res.status };
    });
  }
  await step(8, "A program is refused (415 file_type)", async () => {
    try {
      await onedrive.uploadSession({ projectId: pid, folder: FOLDER, relDir: REL_DIR, name: "self-test.exe", size: 10 });
      return { ok: false, code: "allowed" };
    } catch (e) {
      const ok = e.code === "file_type" && e.status === 415;
      return { ok, code: ok ? "" : codeOf(e) };
    }
  });
  paintSteps(false);
  return out;
}
