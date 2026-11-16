/* DCR Portal 2 — the photo files' Edge Function over PGlite (development only), the OneDrive edition: an option of
   tools/pglite-serve.mjs (startPgliteServer({photoFiles: true})) for tools/e2e-p10-photo-files-pglite.mjs.

   The function "photo-files" the phone calls ([Check again]: op check, DCR Desktop 2 docs/PHOTO-FILES-ONEDRIVE.md §4.5,
   cited OD) is played here by its OWN service-role SQL over this database - DCR Desktop 2's migrations, both photo files
   migrations in order: the caller's right to read the shoot (photo_drive_status AS THE CALLER), the folder (404
   no_folder), the root (409 not_connected before any root row, else 409 root_lost: handler.ts's order, OD §4.7), the
   20 s per shoot (the folder's checked_at), then app.gdrive_check_apply with what the made-up OneDrive below holds:
   the folder's listing and a read by id of every row whose item landed. The SQL decides; the stand-in only hands it
   the facts, as handler.ts does. Each statement runs as the service role with no JWT on the connection, in turn with
   the pages' calls. Nothing leaves this process: there is no Microsoft here (made-up items FAKEITEM..., quickXorHash-
   shaped made-up hashes FAKEqx...=, the made-up host example-my.sharepoint.com).

   setupPhotoFiles({db, client, sql, asPerson}) -> {photoFiles(uid, body) -> {status, body, headers}, world, drains}. The
   world helpers play the other apps (DCR Desktop 2 on the photographer's PC, photo-files' health and its sends, DCR
   Desktop 2's setup card): connect() - the root seen and uploads on; handIn(uid, shootId, names) - a PC hand-in begun,
   recorded with its hashes, sealed, its folders made and a session per file, its beat; landed(uploadId) - every file's
   last chunk in, read by id before OneDrive has its hash (checking); hashed() - OneDrive's hashes there (the next check
   confirms); markShared(adminUid, profileId) - an admin's Mark as shared. */

const ITEM = (n) => "FAKEITEM" + String(n).padStart(14, "0");
const QX = (n) => "FAKEqx" + String(n).padStart(21, "0") + "=";
const ROOT_LINK = "https://example-my.sharepoint.com/personal/office_example_com/Documents/DCR%20Photo%20%26%20Video";
const link = (...parts) => [ROOT_LINK].concat(parts.map((p) => encodeURIComponent(p).replace(/%5B/g, "[").replace(/%5D/g, "]"))).join("/");
const DEVICE = "pk_E2ePhotoPc000000000001";
const CACHE_MS = 20000;

export async function setupPhotoFiles({ db, client, sql, asPerson }) {
  const drains = [];
  /** photo-files' sql.ts: one statement as the service role, no JWT on the connection, in turn with the pages' calls */
  const svc = (fn, args) => client.run(async () => {
    const run = async (t, p) => (await db.query(t, p || [])).rows;
    await run("set role service_role");
    try {
      const text = "select app." + fn + "(" + args.map((a, i) => "$" + (i + 1) + "::" + a[1]).join(", ") + ") as v";
      return (await run(text, args.map((a) => (a[0] === null || a[0] === undefined ? null : a[1] === "jsonb" ? JSON.stringify(a[0]) : a[0]))))[0].v;
    } finally { await run("reset role"); }
  }, "owner");
  const rpc = async (uid, name, a) => {
    const keys = Object.keys(a || {});
    const rows = await asPerson(uid, "select public." + name + "(" + keys.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as r",
      keys.map((k) => (a[k] !== null && typeof a[k] === "object" ? JSON.stringify(a[k]) : a[k])));
    return rows[0].r;
  };

  /* the made-up OneDrive: what is in each shoot folder (by folder row id) - {id, path, size, md5 (OneDrive's hash, or
     null until it has made it), file_id} */
  const drive = new Map();
  let itemN = 100, folderN = 0;
  const itemsOf = (folderId) => drive.get(Number(folderId)) || [];

  /** the shoot's job and shoot folders made in OneDrive (each with its lease), as photo-files' first session makes them */
  async function foldersMade(shootId) {
    const f = (await sql("select id, parent_id, name, drive_id from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot' and retired_at is null", [shootId]))[0];
    const j = (await sql("select id, name, drive_id from public.photo_drive_folders where id = $1", [f.parent_id]))[0];
    const made = [];
    if (!j.drive_id) {
      await svc("gdrive_folder_lease", [[j.id, "bigint"], [120, "integer"]]);
      made.push({ folder_id: Number(j.id), drive_id: ITEM(9000 + (++folderN)), name: j.name, path: j.name, link: link(j.name) });
    }
    if (!f.drive_id) {
      await svc("gdrive_folder_lease", [[f.id, "bigint"], [120, "integer"]]);
      made.push({ folder_id: Number(f.id), drive_id: ITEM(9500 + (++folderN)), name: f.name, path: j.name + "/" + f.name, link: link(j.name, f.name) });
    }
    if (made.length) await svc("gdrive_folders_seen", [[made, "jsonb"]]);
    return Number(f.id);
  }
  /** an item read by id (OD §4.5 done's $select): DCR's, in the shoot folder, a plain file */
  const read = (it) => ({ status: "ok", id: it.id, file: true, in_folder: true, by_app: true, size: it.size, md5: it.md5, ctag: "FAKEctag-" + it.id.slice(-4), path: it.path });

  const answer = (status, body, headers) => ({ status, body, headers: headers || {} });
  const fail = (status, code, message) => answer(status, { error: code, message });

  /** op check {shoot_id} (OD §4.5, §6.2) */
  async function check(uid, body) {
    const shoot = Number(body.shoot_id);
    if (!Number.isSafeInteger(shoot) || shoot < 1) return fail(400, "invalid", "That request is not one photo-files takes.");
    let st;
    try { st = await rpc(uid, "photo_drive_status", { p_shoot: shoot }); } catch (e) {
      if (String(e.code) === "42501") return fail(403, "forbidden", "You don't have the right to do that.");
      if (String(e.code) === "PT404") return fail(404, "no_shoot", "That shoot isn't on the schedule any more.");
      throw e;
    }
    const f = (await sql("select id, checked_at from public.photo_drive_folders where shoot_id = $1 and kind = 'shoot' and retired_at is null order by id desc limit 1", [shoot]))[0];
    if (!f) return fail(404, "no_folder", "This shoot has no folder yet.");
    if (!st.root || st.root.state === "not_seen") return fail(409, "not_connected", "OneDrive isn't connected yet - an admin opens Settings -> Photo & Video.");
    if (st.root.state !== "found") return fail(409, "root_lost", "DCR can't reach DCR Photo & Video in OneDrive right now.");
    if (f.checked_at && Date.now() - Date.parse(f.checked_at) < CACHE_MS) {
      return answer(200, Object.assign(st, { complete: true, cached: true, code: st.files && st.files.last_code, became_ready: false }));
    }
    // the listing and a read by id of every row whose item landed (committed: waiting for OneDrive's hash; confirmed)
    const rows = await sql("select id, drive_file_id, upload_step, state from public.photo_shoot_files where folder_id = $1 and drive_file_id is not null and state <> 'removed'", [f.id]);
    const items = itemsOf(f.id);
    const reads = rows.map((r) => {
      const it = items.find((x) => x.id === r.drive_file_id);
      return { file_id: Number(r.id), item: it ? read(it) : { status: "gone" } };
    });
    const a = await svc("gdrive_check_apply", [[f.id, "bigint"], [{ complete: true, folder: { state: "found" }, items: items.map((x) => ({ id: x.id, size: x.size, md5: x.md5 })),
      reads }, "jsonb"], [uid, "uuid"]]);
    if (a && a.became_ready) drains.push(uid);
    return answer(200, a);
  }

  /** One call of the function as person `uid` (the gateway hands it on with the caller's JWT). */
  async function photoFiles(uid, body) {
    if (!uid) return fail(401, "unauthorized", "Sign in first.");
    const b = body && typeof body === "object" ? body : {};
    if (b.op === "check") return check(uid, b);
    if (["health", "sessions", "done", "find", "tick"].indexOf(b.op) !== -1) return fail(403, "forbidden", "You don't have the right to do that.");
    return fail(400, "invalid", "That request is not one photo-files takes.");
  }

  const world = {
    /** photo-files' health finds the root (that IS connect, OD §4.5); an admin turns uploads on (DCR Desktop 2's setup card) */
    async connect(adminUid) {
      const seen = await svc("gdrive_root_seen", [[{ state: "found", drive_id: ITEM(1), name: "DCR Photo & Video", link: ROOT_LINK }, "jsonb"]]);
      if (!seen || !seen.ok) throw new Error("root_seen: " + JSON.stringify(seen).slice(0, 200));
      await rpc(adminUid, "photo_files_set_mode", { p_mode: "on", p_phone: false });
      return seen;
    },
    /** DCR Desktop 2 on the photographer's PC: a hand-in begun, every file recorded with its hash, sealed; photo-files'
        first sessions make the folders, a session per file; the sender's beat (sending) -> {upload, folder, files} */
    async handIn(uid, shootId, names) {
      const b = await rpc(uid, "photo_upload_begin", { p_shoot: shootId, p_client_key: "e2e-pc-" + shootId + "-" + (++itemN), p_device_key: DEVICE,
        p_device_label: "PHOTO-PC", p_source: "pc", p_replaces: null });
      const up = Number(b.upload.id);
      const list = names.map((p, k) => ({ path: p, size: (k + 1) * 1048576, md5: QX(itemN * 10 + k) }));
      const r = await rpc(uid, "photo_upload_files", { p_upload: up, p_files: list });
      await rpc(uid, "photo_upload_seal", { p_upload: up, p_files: list.length, p_bytes: list.reduce((t, f) => t + f.size, 0) });
      const folder = await foldersMade(shootId);
      const ids = r.files.map((f) => Number(f.file_id));
      await svc("gdrive_sessions_made", [[uid, "uuid"], [up, "bigint"], [ids.map((id) => ({ file_id: id, step: "session" })), "jsonb"]]);
      await rpc(uid, "photo_upload_beat", { p_upload: up, p_state: "sending", p_bytes_sent: 262144, p_sent_files: 0, p_rate_bps: 1500000 });
      world.files.set(up, { uid, folder, ids, list });
      return { upload: up, folder, files: ids };
    },
    files: new Map(),
    /** every file's last chunk in OneDrive (the sender's), read by id by its done before OneDrive has its hash: checking */
    async landed(upload) {
      const h = world.files.get(upload);
      const items = h.ids.map((id, k) => ({ id: ITEM(500 + id), path: h.list[k].path, size: h.list[k].size, md5: null, later: h.list[k].md5, file_id: id }));
      drive.set(h.folder, itemsOf(h.folder).concat(items));
      return svc("gdrive_items_seen", [[h.uid, "uuid"], [upload, "bigint"], [items.map((it) => ({ file_id: it.file_id, item: read(it) })), "jsonb"]]);
    },
    /** OneDrive has made its hashes of what landed: the next check reads them by id */
    hashed() {
      for (const list of drive.values()) for (const it of list) if (!it.md5 && it.later) it.md5 = it.later;
    },
    /** an admin marks a marketing member's account shared (DCR Desktop 2's Photo team lines, OD §8.3) */
    markShared(adminUid, profileId) {
      return rpc(adminUid, "photo_share_mark", { p_profile: profileId, p_marked: "shared", p_version: null });
    },
    /** the company's e-mail domains (DCR Desktop 2's setup card) */
    domains(adminUid, list) { return rpc(adminUid, "photo_drive_set_domains", { p_domains: list }); },
  };
  return { photoFiles, world, drains };
}
