// The photo files' rules for the phone (the photographer screen program, P5, the OneDrive edition; DCR Desktop 2
// docs/PHOTO-FILES-ONEDRIVE.md §3.2.8, §3.3, §6.6, §8.4, §10, cited OD; site/js/map/photo-files.js, the generated
// site/js/map/photo-words.js) held to the contract's shared cases: tests/vectors/photo_files_cases.json - a byte copy
// of DCR Desktop 2's tools/pglite_check/photo_files_cases.json (version 31), its SHA-256 the one DCR Desktop 2 records
// beside the source (pinned in tools/photo-words.mjs; compared with the record and the file itself when
// DCR_DESKTOP2_DIR names Desktop 2) - whose sections bytes_words, files_words, moments, link_ok, told_line, files_line
// (EVERY case: Portal 2's viewer and Desktop 2's, the reference tools/photo_lines/lines.mjs ported whole), ready_card,
// access_line, share_list (the Access tab's line), qx (site/js/quickxor.js) and chunks (map/onedrive.js chunkBytes /
// chunkPlan) are Portal 2's to answer. Then what the phone draws from them: every line filled (no {placeholder} left),
// the fillers through the money masks, nobody's gender, a status without mode not available, the refusals in words,
// Mark done… widened to bring a skipped shoot back, and the Access tab's account field and sharing line. Made-up values
// only.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as F from "../site/js/map/photo-files.js";
import { WORDS, CASES_VERSION } from "../site/js/map/photo-words.js";
import { moduleText, pickWords, GROUPS, PICK, CASES_SHA256, CASES_VERSION as WANT_VERSION } from "../tools/photo-words.mjs";
import * as M from "../site/js/map/photo.js";
import * as A from "../site/js/map/access.js";
import { chunkBytes, chunkPlan, CHUNK_UNIT, MAX_CHUNK } from "../site/js/map/onedrive.js";
import { ONEDRIVE_HOST } from "../site/js/repo/onedrive.js";
import { STREET, find } from "../tools/publish-check.mjs";

await import("../site/js/quickxor.js");
const { QuickXorHash } = globalThis.DCR2QuickXor;

const FILE = new URL("./vectors/photo_files_cases.json", import.meta.url);
const RAW = readFileSync(FILE);
const C = JSON.parse(RAW.toString("utf8"));
const NOW = Date.parse(C.now);
const TODAY = C.now.slice(0, 10);
const D2 = process.env.DCR_DESKTOP2_DIR || "";
const D2_CASES = D2 ? path.join(D2, "tools", "pglite_check", "photo_files_cases.json") : "";
const D2_RECORD = D2 ? path.join(D2, "tools", "pglite_check", "photo_files_cases.sha256") : "";
const GENDER = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
const sha256 = (b) => createHash("sha256").update(b).digest("hex");

test("the shared cases: version 31, LF only, the SHA-256 DCR Desktop 2 recorded, made-up values only (the example OneDrive host and office account, FAKE ids, addresses at example.com / example.test)", () => {
  assert.equal(C.version, 31);
  assert.equal(WANT_VERSION, 31, "tools/photo-words.mjs pins the version");
  assert.equal(CASES_VERSION, 31, "the generated words are of the same version");
  assert.equal(sha256(RAW), CASES_SHA256, "the copy is the one DCR Desktop 2 recorded (photo_files_cases.sha256): copy it again");
  assert.equal(RAW.indexOf(13), -1, "no CR (.gitattributes keeps the file as it is)");
  const text = RAW.toString("utf8");
  assert.deepEqual(find(text), [], "no drive id, personal-site path of a real account, OneDrive host but the example one, or street");
  for (const m of text.matchAll(/https:\/\/([a-z0-9.-]+)\/personal\//gi)) assert.match(m[1].toLowerCase(), /^example(-my)?\.sharepoint\.com(\.example\.test)?$/, m[0]);
  for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) {
    const host = m[1].toLowerCase();
    assert.ok(host === "example.com" || host.endsWith(".example.com") || host === "example.test" || host.endsWith(".example.test"), m[0]);
  }
  assert.ok(!/drive\.google\.com|Google Drive/.test(text.replace(/"(sync_root|_about)": "[^"]*"/g, "")), "nothing of Google Drive is left (but the sync roots' names)");
  assert.ok(readFileSync(new URL("../.gitattributes", import.meta.url), "utf8").includes("tests/vectors/photo_files_cases.json -text"));
});

test("no real-looking value in the photo files' files: no numbered street, drive id, personal-site path of an account, or OneDrive host but the example one and the one already published", () => {
  const long = C.push.find((c) => c.name.startsWith("help: a long job label"));
  assert.equal(long.in.job, "A267 0000 Sampleton Canyon Avenue Residence", "A267 is DCR's test job");
  const root = new URL("../", import.meta.url);
  const list = (dir, re) => readdirSync(new URL(dir, root)).filter((n) => re.test(n)).map((n) => dir + n);
  const files = ["tests/vectors/photo_files_cases.json", "tools/fake/p10-photo-files.js", "tools/fake/p10-photo.js", "site/js/map/photo-words.js",
    "site/js/map/photo-files.js", "site/js/repo/photo-files.js", "site/js/pages/shoots.js", "site/js/pages/shoots-files.js", "site/js/map/access.js",
    "site/js/pages/admin.js", "tools/photo-words.mjs", "tools/pglite-p10-photo-files.mjs", "tools/publish-check.mjs",
    ...list("tools/", /^(e2e|schema-check)-p10-photo.*\.mjs$/), ...list("tests/", /^p10-photo.*\.test\.mjs$/), "tests/console/console-photo-page.test.mjs"];
  assert.ok(files.length > 15, "the scan sees the photo files' fakes, tests and checks");
  for (const f of files) {
    const src = readFileSync(new URL(f, root), "utf8");
    const hit = src.match(STREET);
    assert.equal(hit, null, f + ": " + (hit && hit[0]));
    assert.deepEqual(find(src, { hosts: [ONEDRIVE_HOST] }), [], f);
  }
});

test("the shared cases are DCR Desktop 2's, byte for byte, and its record's SHA-256 is the one pinned here (DCR_DESKTOP2_DIR)", { skip: !(D2_CASES && existsSync(D2_CASES)) && "DCR_DESKTOP2_DIR does not name DCR Desktop 2" }, () => {
  assert.ok(Buffer.compare(RAW, readFileSync(D2_CASES)) === 0, "tests/vectors/photo_files_cases.json differs from " + D2_CASES + ": copy it again");
  const rec = /^([0-9a-f]{64}) [ *]photo_files_cases\.json\n$/.exec(readFileSync(D2_RECORD, "utf8"));
  assert.ok(rec, "DCR Desktop 2's record: one sha256sum line");
  assert.equal(rec[1], CASES_SHA256, "tools/photo-words.mjs pins DCR Desktop 2's record");
});

test("the words: site/js/map/photo-words.js is what tools/photo-words.mjs makes of the cases, group by group, word by word", () => {
  const have = readFileSync(new URL("../site/js/map/photo-words.js", import.meta.url), "utf8");
  assert.equal(have, moduleText(C), "run node tools/photo-words.mjs");
  const want = pickWords(C);
  for (const g of GROUPS) {
    assert.deepEqual(Object.keys(WORDS[g]), Object.keys(C.words[g]).filter((k) => k !== "_about"), g);
    for (const k of Object.keys(WORDS[g])) assert.equal(WORDS[g][k], C.words[g][k], g + "." + k);
  }
  for (const g of Object.keys(PICK)) assert.deepEqual(WORDS[g], want[g], g);
  for (const [g, words] of Object.entries(WORDS)) {
    for (const [k, t] of Object.entries(words)) {
      assert.ok(!GENDER.test(t), g + "." + k + ": nobody's gender");
      assert.ok(!/\$\d/.test(t), g + "." + k + ": no amount");
      assert.ok(!/Google Drive|Drive for desktop/.test(t), g + "." + k + ": OneDrive's words");
      if (k.endsWith("_one")) assert.equal(typeof words[k.slice(0, -4)], "string", g + "." + k + ": its plural");
    }
  }
});

test("bytes_words, files_words, moments, link_ok: every case (the fillers; link_ok gates every OneDrive href)", () => {
  for (const c of C.bytes_words) assert.equal(F.sizeWords(c.in), c.out, String(c.in));
  for (const c of C.files_words) assert.equal(F.filesWords(c.in), c.out, c.name);
  for (const c of C.moments) {
    if (c.out.day !== undefined) assert.equal(F.dayText(c.in.day, c.in.today), c.out.day, c.name);
    if (c.out.time !== undefined) assert.equal(F.momentText(c.in.at, c.in.today), c.out.time, c.name);
  }
  assert.ok(C.link_ok.some((c) => c.out === true) && C.link_ok.some((c) => c.out === false));
  for (const c of C.link_ok) assert.equal(F.linkOk(c.in), c.out, String(c.in).slice(0, 120));
  assert.equal(F.filesWords({ photos: 2, videos: 0, others: 1 }), "2 photos and 1 other file", "a status's `others` too");
  assert.equal(F.momentText(null, TODAY), "");
  assert.equal(F.dayOfMoment("2026-11-13T07:59:00Z"), "2026-11-12", "the company's day (America/Los_Angeles)");
});

test("the e-mail cases' Files line is files_words + bytes_words (the Ready card's {files} ({size}))", () => {
  for (const c of C.email) {
    const i = c.in || {};
    const line = F.filesWords({ photos: i.photos, videos: i.videos, other: i.other }) + " (" + F.sizeWords(i.bytes) + ")";
    const files = c.out.body.split(/\r?\n/).find((l) => /^Files:/.test(l)) || "";
    assert.ok(files.replace(/^Files:\s+/, "").startsWith(line), c.name + ": " + line + " | " + files);
  }
});

test("told_line: every case - the sentence from the words, phone first, \"a, b and c\", an empty name \"Someone\"", () => {
  for (const c of C.told_line) assert.equal(F.toldLine(c.in), c.out, c.name);
  for (const c of C.told) {
    assert.equal(typeof WORDS.told["email_" + c.out.email], "string", c.name + ": email_" + c.out.email);
    assert.equal(typeof WORDS.told["push_" + c.out.push], "string", c.name + ": push_" + c.out.push);
  }
});

test("files_line: EVERY case (Portal 2's viewer and Desktop 2's: the reference ported whole), each code with its words", () => {
  assert.ok(C.files_line.length >= 60);
  assert.ok(C.files_line.filter((c) => c.in.viewer.app === "portal2").length >= 15, "Portal 2's own cases");
  for (const c of C.files_line) {
    const got = F.filesLine(c.in.status, c.in.viewer, NOW);
    assert.deepEqual(got, c.out, c.name);
    for (const code of got) assert.equal(typeof WORDS.files[code], "string", c.name + ": files." + code);
  }
  assert.ok(C.files_line.some((c) => c.out[0] === "not_available"), "rule 0: a status without mode");
});

test("ready_card and access_line: every case (the chip, the warnings in their order, the buttons by who acts; Open in OneDrive or the line in its place), each with its words", () => {
  for (const c of C.ready_card) {
    const got = F.readyCard(c.in.item, c.in.me);
    assert.deepEqual(got, c.out, c.name);
    for (const code of [got.chip, ...got.warnings, ...got.buttons]) assert.equal(typeof WORDS.ready[code], "string", c.name + ": ready." + code);
  }
  for (const c of C.access_line) {
    assert.deepEqual(F.accessLine(c.in.access, c.in.link_ok), c.out, c.name);
    if (c.out.line) for (const g of ["files", "ready"]) assert.equal(typeof WORDS[g][c.out.line], "string", g + "." + c.out.line);
  }
});

test("share_list: every member's line on the Access tab (memberLine, OD §8.4), filled from the entry ({account}, {by}, {day}) with the cases' words", () => {
  let n = 0;
  for (const c of C.share_list) {
    for (const e of c.out.list) {
      const want = c.out.lines[e.profile_id] === undefined ? null : c.out.lines[e.profile_id];
      assert.equal(F.memberLine(e, c.in.domains), want, c.name + ": " + e.first_name);
      const t = F.memberText(e, c.in.domains, { today: TODAY });
      if (!want) { assert.equal(t, null); continue; }
      n += 1;
      assert.equal(t.code, want);
      assert.ok(t.text && !/\{[a-z_]+\}/.test(t.text) && !GENDER.test(t.text), t.text);
      if (want === "to_give" || want === "not_company") assert.ok(t.text.includes(e.account), t.text);
    }
  }
  assert.ok(n >= 5, "lines said");
  const shared = F.memberText({ profile_id: "p", account: "ana@example.com", wanted: true, marked: "shared", marked_at: "2026-11-12T11:00:00Z", marked_by: "Olive" },
    ["example.com"], { today: "2026-11-12" });
  assert.deepEqual(shared, { code: "shared", text: "Shoot folders: shared (marked by Olive, Thu Nov 12)." });
  assert.equal(F.memberText({ account: "pat$12@example.test", not_company: true, wanted: true }, ["example.com"]).text.indexOf("$12"), -1, "the account through the masks");
});

/** The cases' made-up bytes (tools/photo_lines/qx_cases.py: hex, pattern (a k + c), lcg) */
function bytesOf(b) {
  if (b.kind === "hex") return Uint8Array.from(b.hex.match(/../g) || [], (x) => parseInt(x, 16));
  if (b.kind === "pattern") return Uint8Array.from({ length: b.n }, (_, k) => (b.a * k + b.c) & 255);
  const out = new Uint8Array(b.n);
  let x = b.seed >>> 0;
  for (let k = 0; k < b.n; k++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; out[k] = (x >>> 16) & 255; }
  return out;
}
test("qx: site/js/quickxor.js (the phone's hash worker's) gives every vector's quickXorHash, in every slicing (pieces in turn, a 0 an empty update)", () => {
  assert.ok(C.qx.length >= 9);
  for (const v of C.qx) {
    const data = bytesOf(v.bytes);
    assert.equal(data.length, v.size, v.name);
    assert.equal(new QuickXorHash().update(data).base64(), v.hash, v.name);
    for (const pieces of v.slicings) {
      const h = new QuickXorHash();
      let at = 0, k = 0;
      while (at < data.length) { const n = pieces[k % pieces.length]; h.update(data.subarray(at, at + n)); at += n; k += 1; }
      assert.equal(h.base64(), v.hash, v.name + " " + JSON.stringify(pieces));
    }
  }
});

test("chunks: map/onedrive.js chunkBytes / chunkPlan (the uploader the phone's hand-in reuses unchanged) give every case's chunk size and Content-Ranges", () => {
  assert.equal(C.chunks.constants.chunk_multiple, CHUNK_UNIT);
  assert.equal(C.chunks.constants.max_chunk_bytes, MAX_CHUNK, "191 x 320 KiB");
  assert.equal(C.chunks.constants.phone_chunk_bytes % CHUNK_UNIT, 0);
  for (const c of C.chunks.cases) {
    assert.equal(c.in.chunk_multiple, CHUNK_UNIT, c.name);
    const size = chunkBytes({ chunk_bytes: c.in.chunk_bytes, max_chunk_bytes: c.in.max_chunk_bytes });
    assert.equal(size, c.out.chunk_bytes, c.name);
    const ranges = [];
    let at = c.in.from || 0;
    for (let p = chunkPlan(c.in.size, at, size); p; p = chunkPlan(c.in.size, at, size)) { ranges.push(p.range); at = p.end; if (p.last) break; }
    assert.equal(ranges.length, c.out.count, c.name);
    assert.equal(ranges[0], c.out.first, c.name);
    assert.equal(ranges[ranges.length - 1], c.out.last, c.name);
    if (c.out.ranges) assert.deepEqual(ranges, c.out.ranges, c.name);
  }
});

test("a Mark done waiting (v14, §13.1, §37): not_done, closed_files and closed_old_pc read completion.done_sent and offer no bring-back; every other line stays", () => {
  const st = (completion, extra) => Object.assign({ root: { state: "found" }, mode: "on", folder: { drive_state: "found", link: null }, files: { state: "confirmed", counted: 3, confirmed: 3 },
    can: {}, completion, closed: completion === "closed_files" || completion === "closed_old_pc" ? "skipped" : null, shoot_status: "skipped" }, extra || {});
  assert.deepEqual([...F.DONE_SENT_FOR], ["not_done", "closed_files", "closed_old_pc"]);
  for (const code of F.DONE_SENT_FOR) {
    assert.deepEqual(F.completionLine(st(code), { doneSent: true }), { code: "done_sent", text: WORDS.completion.done_sent }, code);
    assert.notEqual(F.completionLine(st(code), {}).code, "done_sent", code + ": nothing waiting");
    assert.equal(F.filesView(st(code), { doneSent: true }).completion.code, "done_sent", code);
  }
  assert.equal(F.filesView(st("closed_files"), {}).bringBack, true);
  assert.equal(F.filesView(st("closed_files"), { doneSent: true }).bringBack, false, "no second Mark done…");
  assert.equal(F.filesView(st("closed_old_pc"), { doneSent: true }).bringBack, false);
  const helped = st("closed_files", { help: ["closed_files", "late"] });
  assert.deepEqual(F.filesView(helped, {}).help, [WORDS.help.closed_files, WORDS.help.late]);
  assert.deepEqual(F.filesView(helped, { doneSent: true }).help, [WORDS.help.late], "no Bring the shoot back? chip beside the Mark done just pressed");
  for (const code of ["ready", "done_waiting", "closed_plan", "no_hand_in", "root_problem"]) {
    const v = F.completionLine(st(code), { doneSent: true });
    assert.equal(v.code, code, code + ": not a line that asks for Mark done");
  }
  assert.equal(F.completionLine(st("use_drive"), {}), null, "Use what's in Drive is gone (OD §15): no words, no line");
  assert.equal(F.completionLine(st(null), { doneSent: true }), null, "no code, no line");
  assert.ok(!GENDER.test(WORDS.completion.done_sent));
});

test("reopenAsk (v14, §13.5, §37): Not posted yet asks when where, a link or a note would be cleared; Back on the list always; nothing else asks", () => {
  assert.equal(F.reopenAsk({ state: "posted", posted: { where: ["instagram"], link: null, note: null } }), "reopen_ask");
  assert.equal(F.reopenAsk({ state: "posted", posted: { where: [], link: "https://www.example.com/p/1", note: null } }), "reopen_ask");
  assert.equal(F.reopenAsk({ state: "posted", posted: { where: [], link: null, note: "Carousel" } }), "reopen_ask");
  assert.equal(F.reopenAsk({ state: "posted", posted: { where: [], link: null, note: null } }), null, "nothing written: nothing to clear");
  assert.equal(F.reopenAsk({ state: "posted", posted: { where: [], link: "  ", note: "" } }), null);
  assert.equal(F.reopenAsk({ state: "posted", posted: null }), null);
  assert.equal(F.reopenAsk({ state: "passed", passed: { reason: "Too dark" } }), "reopen_passed_ask");
  assert.equal(F.reopenAsk({ state: "passed", passed: null }), "reopen_passed_ask", "always");
  for (const state of ["ready", "claimed", "withdrawn"]) assert.equal(F.reopenAsk({ state }), null, state);
  assert.equal(F.reopenAsk(null), null);
  for (const k of ["reopen_ask", "reopen_passed_ask"]) assert.ok(typeof WORDS.ready[k] === "string" && !GENDER.test(WORDS.ready[k]), k);
  assert.equal(WORDS.copy.cancel_keep, "Keep it", "the question's Keep it");
});

test("completion: every code the database answers has its words; every hint the phone can meet too", () => {
  for (const c of C.completion) if (c.out) assert.equal(typeof WORDS.completion[c.out], "string", c.name);
  for (const code of ["forbidden", "no_shoot", "not_connected", "no_folder", "rate", "changed", "taken", "too_late", "reason_needed", "bad_link", "withdrawn",
    "busy", "not_configured", "root_lost", "folder_gone", "not_authorized", "uploads_off", "uploads_test", "phone_off", "not_this_device", "not_same_file",
    "not_waiting", "too_large", "onedrive_full", "onedrive_failed", "no_item", "not_now", "bad_where", "copying", "no_answer", "other"]) {
    assert.equal(typeof WORDS.hint[code], "string", "hint." + code);
  }
});

/* ── what the shoot sheet draws ── */

test("filesView: every Portal 2 case is filled whole (no {placeholder}, nobody's gender), each line with its tone; Open in OneDrive only with can.open_folder and a link that passes", () => {
  F.setStrict(true);
  try {
    for (const c of C.files_line.filter((x) => x.in.viewer.app === "portal2")) {
      const v = F.filesView(c.in.status, { today: TODAY, now: NOW, viewer: c.in.viewer });
      assert.deepEqual(v.lines.map((l) => l.code), c.out, c.name);
      for (const l of v.lines) {
        assert.ok(l.text && !/\{[a-z_]+\}/.test(l.text), c.name + ": " + l.text);
        assert.ok(!GENDER.test(l.text), c.name + ": " + l.text);
        assert.ok(Object.prototype.hasOwnProperty.call({ ok: 1, wait: 1, warn: 1, problem: 1, "": 1 }, l.tone), c.name + ": " + l.tone);
      }
      const st = c.in.status;
      assert.equal(!!v.open, !!(st.can && st.can.open_folder && st.folder && F.linkOk(st.folder.link)), c.name + ": Open in OneDrive only with can.open_folder");
    }
  } finally { F.setStrict(false); }
});

const LINK = "https://example-my.sharepoint.com/personal/office_example_com/Documents/DCR%20Photo%20%26%20Video/A267%20Sample%20Street,%20Los%20Angeles%20[DCR-7KQ2MX]/2026-11-12%20Delivery%20day%20[DCR-K7QXM2]";
const ST = () => ({
  shoot_id: 51, shoot_status: "announced", mode: "on", mode_codes: [],
  root: { state: "found", name: "DCR Photo & Video", link: null },
  folder: { id: 12, tag: "K7QXM2", name: "2026-11-12 Delivery day [DCR-K7QXM2]", drive_state: "found", drive_name: "Delivery day $12,400 extra [DCR-K7QXM2]", link: LINK },
  files: { state: "waiting", counted: 300, confirmed: 262, waiting: 38, mismatch: 0, missing: 0, culled: 0, drive_only: 1, to_send: 0, committed: 0,
    busy: false, bytes: 11811160064, bytes_confirmed: 9663676416, late: false, stalled: false, stalled_checking: false,
    checked_at: "2026-11-12T20:00:00Z", next_check_at: "2026-11-12T20:30:00Z", last_code: null },
  uploads: [{ id: 7, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", sealed_at: "2026-11-12T19:30:00Z", files: 300, recorded_files: 300,
    can_decide: true, sent_files: 300, bytes: 11811160064, bytes_sent: 11811160064, to_send: 0, send_state: "done", seen_at: null, rate_bps: null }],
  retired: null, closed: null, plan_status: "active", completion: null,
  marketing: null, me: { drive_access: "shared" }, help: ["late"],
  can: { hand_in: true, add_files: true, add_from_phone: true, check: true, resolve: true, open_folder: true },
});
const phone = (o) => Object.assign({ id: 9, state: "open", source: "phone", pc: "iPhone", pc_id: 7, by: "Lou", can_decide: true, running: true, files: 16,
  recorded_files: 16, sent_files: 5, to_send: 11, send_state: "sending", seen_at: "2026-11-12T20:59:40Z", rate_bps: 900000, started_at: "2026-11-12T20:40:00Z" }, o || {});

test("filesView fills the fillers: {waiting} and {pc} of the device holding them, OneDrive's name MASKED, help titles, Open in OneDrive, Check again, Add photos and videos", () => {
  F.setStrict(true);
  try {
    const v = F.filesView(ST(), { today: "2026-11-12", now: NOW });
    assert.equal(v.available, true);
    assert.deepEqual(v.lines.map((l) => [l.code, l.text, l.tone]), [["waiting", "38 files are waiting to go to OneDrive from PHOTO-PC.", "wait"],
      ["drive_only", "1 file was added in OneDrive without DCR.", ""]], "the _one twin");
    assert.deepEqual(v.help, ["Upload not moving"]);
    assert.equal(v.open, LINK);
    assert.equal(v.check, true);
    assert.equal(v.addPhone, true, "can.add_from_phone, nothing open");
    // a link that is not OneDrive's personal-site shape never becomes a button
    const bad = ST(); bad.folder.link = "https://example-my.sharepoint.com.example.test/personal/office_example_com/Documents/x";
    assert.equal(F.filesView(bad, { today: "2026-11-12" }).open, null);
    // no access for this viewer: the line, no button
    const none = ST(); none.can.open_folder = false; none.me.drive_access = "none";
    const vn = F.filesView(none, { today: "2026-11-12", now: NOW });
    assert.equal(vn.open, null);
    assert.deepEqual(vn.lines.map((l) => [l.code, l.text]).pop(), ["no_access", WORDS.files.no_access]);
    // waiting for OneDrive's hash: checking (its _one twin), and after 14 days stalled_checking
    const chk = ST(); Object.assign(chk.files, { committed: 1, waiting: 1, confirmed: 299 });
    assert.equal(F.filesView(chk, { now: NOW }).lines[0].text, "All the files are in OneDrive - checking the last one…");
    chk.files.committed = 3;
    assert.equal(F.filesView(chk, { now: NOW }).lines[0].text, "All the files are in OneDrive - checking the last 3…");
    chk.files.stalled_checking = true;
    assert.deepEqual(F.filesView(chk, { now: NOW }).lines[0], { code: "stalled_checking", text: "OneDrive still hasn't finished checking 3 files after 14 days - the office asks the developer to look.", tone: "problem" });
    // a check never offered without a folder or a root; nothing added while another hand-in is open
    const nofolder = ST(); nofolder.folder = null; nofolder.files.state = "none";
    assert.equal(F.filesView(nofolder, { today: "2026-11-12" }).check, false);
    const open = ST(); open.uploads.push(phone({ pc_id: 8 }));
    assert.equal(F.filesView(open, { now: NOW }).addPhone, false, "one open hand-in per shoot");
    const off = ST(); off.can.add_from_phone = false;
    assert.equal(F.filesView(off, { now: NOW }).addPhone, false, "phone uploads off, or the mode not on for the job: the database's can");
  } finally { F.setStrict(false); }
});

test("a phone's hand-in on the Files line (OD §3.3): this phone sending (its own counts when the page passes them), another phone sending, stopped on this phone with Hand in what's there's find, stopped elsewhere ({by}'s phone)", () => {
  F.setStrict(true);
  try {
    const st = ST(); Object.assign(st.files, { state: "copying", counted: 0, waiting: 0, confirmed: 0, drive_only: 0 });
    st.uploads = [phone()];
    const mine = { device_id: 7, running_here: true, phone_found: 0 };
    let v = F.filesView(st, { now: NOW, viewer: mine });
    assert.deepEqual(v.lines.map((l) => [l.code, l.text, l.tone]), [["sending_this_phone",
      "Sending 5 of 16 files to OneDrive - keep this screen on and this page open until it's done.", "wait"]]);
    assert.equal(F.filesView(st, { now: NOW, viewer: mine, sending: { sent: 6, total: 16 } }).lines[0].text.slice(0, 22), "Sending 6 of 16 files ", "the page's own counts");
    assert.equal(F.filesView(Object.assign(ST(), { files: st.files, uploads: [phone({ files: 1, recorded_files: 1, sent_files: 0 })] }), { now: NOW, viewer: mine }).lines[0].text,
      WORDS.files.sending_this_phone_one);
    // another phone (or this one's page not sending): {by}'s phone
    v = F.filesView(st, { now: NOW, viewer: { device_id: 8 } });
    assert.equal(v.lines[0].text, "Sending from Lou's phone: 5 of 16 files - keep DCR open on that phone until it's done.");
    // stopped (reloaded) on this phone: its three choices are the sheet's; Hand in what's there found files unchecked
    st.uploads = [phone({ running: false })];
    v = F.filesView(st, { now: NOW, viewer: { device_id: 7, running_here: false, phone_found: 2 } });
    assert.deepEqual(v.lines.map((l) => l.text), ["Your upload from this phone stopped at 5 of 16 files.",
      "2 files are in OneDrive but not checked yet - pick them again to check them."]);
    assert.equal(F.filesView(st, { now: NOW, viewer: { device_id: 7, phone_found: 1 } }).lines[1].text, WORDS.files.not_checked_phone_one);
    // this phone's own stopped upload picks its twin by {done}, its files already in OneDrive (OD §10.2, review round 4):
    // at 1 "stopped at 1 of {total}", never "before its one file was in" beside Hand in what's there; at 0 its _none
    const here = (u, o) => F.filesView(Object.assign(ST(), { files: st.files, uploads: [phone(Object.assign({ running: false }, u))] }),
      Object.assign({ now: NOW, viewer: { device_id: 7, running_here: false } }, o)).lines[0].text;
    assert.equal(here({ sent_files: 1 }), "Your upload from this phone stopped at 1 of 16 files.");
    assert.equal(here({ files: 1, recorded_files: 1, sent_files: 1 }), "Your upload from this phone stopped at 1 of 1 files.", "its one file IS in OneDrive");
    assert.equal(here({ sent_files: 0 }), "Your upload from this phone stopped before any file was in.");
    assert.equal(here({ files: 1, recorded_files: 1, sent_files: 0 }), WORDS.files.stopped_this_phone_none);
    assert.equal(here({ files: 0, recorded_files: 0, sent_files: 0 }), WORDS.files.stopped_this_phone_none, "nothing recorded: its _none, never no line");
    // the page's own counts while it draws the buttons (pages/shoots.js passes them only then): its {done} and twin too
    assert.equal(here({ sent_files: 0 }, { sending: { sent: 1, total: 16 } }), "Your upload from this phone stopped at 1 of 16 files.");
    assert.equal(here({ sent_files: 3 }, { sending: { sent: 0, total: 16 } }), WORDS.files.stopped_this_phone_none);
    // stopped, seen elsewhere: finish it on that phone - its twin by {done}, the files already in OneDrive (OD §3.3
    // step 9, review round 3): at 0 "…before any file reached OneDrive - … or cancel it", never "stopped at 0 of 16 files
    // - … or hand in what's there" (Hand in what's there is not offered then)
    v = F.filesView(st, { now: NOW, viewer: { device_id: 8 } });
    assert.equal(v.lines[0].text, "The upload from Lou's phone stopped at 5 of 16 files - finish it on that phone, or hand in what's there.");
    st.uploads = [phone({ running: false, sent_files: 0 })];
    assert.equal(F.filesView(st, { now: NOW, viewer: { device_id: 8 } }).lines[0].text,
      "The upload from Lou's phone stopped before any file reached OneDrive - finish it on that phone, or cancel it.", "16 recorded, none in OneDrive");
    st.uploads = [phone({ running: false, sent_files: 1 })];
    assert.equal(F.filesView(st, { now: NOW, viewer: { device_id: 8 } }).lines[0].text,
      "The upload from Lou's phone stopped at 1 of 16 files - finish it on that phone, or hand in what's there.");
    st.uploads = [phone({ running: false, files: 1, recorded_files: 1, sent_files: 0 })];
    assert.equal(F.filesView(st, { now: NOW, viewer: { device_id: 8 } }).lines[0].text, WORDS.files.stopped_upload_phone_none.replace("{by}", "Lou"),
      "its one file not in OneDrive: never \"stopped at 1 of 1 files\"");
    st.uploads = [phone({ running: false, files: 0, recorded_files: 0, sent_files: 0, can_decide: false })];
    v = F.filesView(st, { now: NOW, viewer: { device_id: 8 } });
    assert.deepEqual(v.lines.map((l) => l.text), ["The upload from Lou's phone stopped before any file reached OneDrive - finish it on that phone, or cancel it.",
      "Only Lou or an admin can finish or cancel it."]);
    // a starter with no name: Someone's phone (never an empty {by})
    st.uploads = [phone({ by: "", running: false })];
    assert.match(F.filesView(st, { now: NOW, viewer: { device_id: 8 } }).lines[0].text, /^The upload from Someone's phone stopped/);
  } finally { F.setStrict(false); }
});

test("a sealed hand-in sending (OD §3.2.8): the time left from its beat ({left}, never a number that cannot be true), working it out, paused when the beat is old, queued, full, OneDrive stopped, waiting for the internet; uploads off or tested elsewhere", () => {
  F.setStrict(true);
  try {
    const st = ST();
    Object.assign(st.files, { to_send: 301, waiting: 301, confirmed: 120, counted: 421, drive_only: 0 });
    const u = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 421, sent_files: 120, to_send: 301,
      bytes: 33715493273, bytes_sent: 9663676416, send_state: "sending", seen_at: "2026-11-12T20:59:30Z", rate_bps: 2500000, behind: null };
    st.uploads = [u];
    const line = () => F.filesView(st, { now: NOW, today: "2026-11-12" }).lines[0];
    assert.deepEqual(line(), { code: "sending", text: "Sending to OneDrive from PHOTO-PC: 120 of 421 files (9 GB of 31.4 GB) - about 2 h 50 min left.", tone: "wait" });
    u.rate_bps = 0;
    assert.equal(line().text, "Sending to OneDrive from PHOTO-PC: 120 of 421 files (9 GB of 31.4 GB) - working out the time left.");
    u.seen_at = "2026-11-12T20:57:00Z";
    assert.deepEqual([line().code, line().text], ["paused_pc",
      "Sending paused on PHOTO-PC - DCR Desktop isn't open there, or the computer is asleep or offline. It goes on by itself once it's back."], "a beat over 2 minutes old");
    Object.assign(u, { seen_at: "2026-11-12T20:59:30Z", send_state: "waiting_net" });
    assert.equal(line().text, "Waiting for the internet on PHOTO-PC - nothing is lost, it goes on by itself.");
    Object.assign(u, { send_state: "queued", behind: "Site walk $9,999 day" });
    assert.match(line().text, /^Waiting on PHOTO-PC behind Site walk .* day - it goes on by itself\.$/);
    assert.ok(!/\$\s?9,999/.test(line().text), "the other shoot's name through the masks");
    Object.assign(u, { send_state: "onedrive_full", to_send: 1 });
    assert.equal(line().text, WORDS.files.full_one.replace("{pc}", "PHOTO-PC"));
    u.send_state = "onedrive_stopped";
    assert.deepEqual([line().code, line().tone], ["stopped_od", "problem"]);
    Object.assign(u, { send_state: "sending", to_send: 301 });
    st.mode = "off";
    assert.equal(line().code, "uploads_off");
    Object.assign(st, { mode: "test", mode_codes: ["A267", "A301"] });
    assert.equal(line().text, "Photo uploads are being tested on A267, A301 - not on for this job yet.");
    // the disk that holds the PC's outbox not there (OD §3.2.6, review round 1): nothing lost, it waits - while its beat
    // is fresh; an old beat is DCR Desktop not open there
    Object.assign(st, { mode: "on" });
    Object.assign(u, { send_state: "outbox_away", rate_bps: null });
    assert.deepEqual(line(), { code: "outbox_away", text: "The disk that holds the files waiting on PHOTO-PC isn't there - plug it back in and DCR goes on by itself.", tone: "warn" });
    u.seen_at = "2026-11-12T20:55:00Z";
    assert.equal(line().code, "paused_pc");
    // a phone's SEALED hand-in still holding rows to send: a check sent them back after the phone let its files go - only
    // that phone picking them again sends them (resend_phone, OD §3.5; review round 1), "{by}'s phone" (files.pc_phone)
    Object.assign(u, { source: "phone", pc: "iPhone", send_state: "done", seen_at: "2026-11-12T19:10:00Z", rate_bps: 0, to_send: 1 });
    st.files.to_send = 1;
    assert.deepEqual(line(), { code: "resend_phone", tone: "warn",
      text: "1 file from Lou's phone didn't reach OneDrive whole - pick it again on that phone (Add photos and videos) to send it again, or leave it out." });
    Object.assign(u, { to_send: 3 });
    assert.match(line().text, /^3 files from Lou's phone didn't reach OneDrive whole - pick them again on that phone/);
    st.files.late = true;
    assert.equal(line().code, "resend_phone", "never 'is iPhone on, with DCR Desktop open'");
    assert.equal(F.pcName({ source: "phone", by: "" }), "Someone's phone", "files.pc_phone with no name: Someone");
    assert.equal(F.pcName({ source: "phone", by: "Lou", pc: "iPhone" }), WORDS.files.pc_phone.replace("{by}", "Lou"));
  } finally { F.setStrict(false); }
  // {left}: minutes rounded up to 5 under an hour (at least 5), hours and tens of minutes above it - DCR Desktop 2's
  // left_words number for number (domain/photo_files_view.py)
  for (const [sec, want] of [[0, "5 min"], [1, "5 min"], [60, "5 min"], [301, "10 min"], [21 * 60, "25 min"], [3300, "55 min"], [3301, "1 h"], [3600, "1 h"],
    [3601, "1 h 10 min"], [130 * 60, "2 h 10 min"], [7200, "2 h"], [7201, "2 h 10 min"], [181 * 60, "3 h 10 min"], [179 * 60 + 1, "3 h"], [9620.73, "2 h 50 min"],
    [-5, "5 min"], [NaN, "5 min"]]) {
    assert.equal(F.leftWords(sec), want, String(sec));
  }
  assert.equal(F.secondsLeft({ bytes: 1000, bytes_sent: 400, rate_bps: 100 }), 6);
  assert.equal(F.secondsLeft({ bytes: 1000, bytes_sent: 1200, rate_bps: 100 }), 0, "never below 0");
  assert.equal(F.secondsLeft({ bytes: 1000, bytes_sent: 0, rate_bps: 0 }), 0, "no rate: no time (sending_starting says so)");
});

test("not available (OD §5.7): a status without mode - the Google edition after the OneDrive roll back - says files.not_available alone and offers nothing", () => {
  const st = ST(); delete st.mode;
  const v = F.filesView(st, { now: NOW, admin: true });
  assert.equal(F.available(st), false);
  assert.deepEqual([v.available, v.lines.map((l) => [l.code, l.text]), v.help, v.completion, v.told, v.open, v.check, v.addPhone, v.bringBack],
    [false, [["not_available", WORDS.files.not_available]], [], null, null, null, false, false, false]);
  assert.equal(F.available(ST()), true);
  assert.equal(F.available(null), false);
  assert.deepEqual(F.filesLine(Object.assign(ST(), { mode: null }), { app: "portal2" }, NOW), ["not_available"], "never a default of on");
});

test("OD §10.6 rules 1-3 on the phone: the root not seen or lost, the shoot folder moved out or in the recycle bin - the settled line alone; nothing to open or add; Check again on a gone folder's line, never while the root is lost", () => {
  F.setStrict(true);
  try {
    const gone = {
      not_connected: (s) => { s.root = null; s.can.check = false; },
      root_lost: (s) => { s.root.state = "missing"; s.can.check = false; },
      moved_out: (s) => { s.folder.drive_state = "missing"; },
      moved_out_trashed: (s) => { s.folder.drive_state = "trashed"; },
    };
    for (const [name, make] of Object.entries(gone)) {
      const st = ST();
      st.can.open_folder = false;                     // the database's: never for a folder that is not there to open
      make(st);
      const code = name.replace(/_trashed$/, "");
      const v = F.filesView(st, { today: "2026-11-12", now: NOW });
      assert.deepEqual(v.lines.map((l) => l.code), [code], name + ": the line alone");
      assert.equal(v.lines[0].text, C.words.files[code], name + ": DCR Desktop 2's settled words, byte for byte");
      assert.equal(v.open, null, name);
      assert.equal(v.addPhone, false, name + ": nothing added while the folder or the root is gone");
      assert.equal(v.check, !name.startsWith("not_connected") && !name.startsWith("root_lost"), name + ": Check again on the folder's line, never while the root is lost");
    }
    for (const c of C.files_line) {
      const codes = F.filesLine(c.in.status, { app: "portal2" }, NOW);
      if (codes.length && F.GONE_LINES.indexOf(codes[0]) !== -1) assert.equal(codes.length, 1, c.name);
    }
  } finally { F.setStrict(false); }
});

test("rule 3b (OD §2.3, §10.6; review round 1): the JOB folder gone while the shoot's folder is not in OneDrive - job_moved_out alone, naming the job folder (the status's job, masked), nothing to add, open or check; a shoot folder its last check found keeps its own line", () => {
  F.setStrict(true);
  try {
    const job = { id: 7, name: "A267 Sample Street $1,200 [DCR-7KQ2MX]", drive_state: "missing", drive_state_at: "2026-11-12T18:00:00Z" };
    const fresh = ST();
    Object.assign(fresh, { folder: null, job, uploads: [] });
    Object.assign(fresh.files, { state: "none", counted: 0, confirmed: 0, waiting: 0, drive_only: 0 });
    Object.assign(fresh.can, { add_files: false, add_from_phone: false, open_folder: false });
    let v = F.filesView(fresh, { today: "2026-11-12", now: NOW, viewer: { device_id: 7 } });
    assert.deepEqual(v.lines.map((l) => [l.code, l.tone]), [["job_moved_out", "problem"]], "alone, a problem");
    assert.ok(v.lines[0].text.startsWith("The job folder 'A267 Sample Street ") && !/\$\s?1,200/.test(v.lines[0].text), v.lines[0].text);
    assert.deepEqual([v.open, v.addPhone, v.check], [null, false, false]);
    // a shoot folder row never made under it, its hand-in sealed and late: never "waiting" or "is PHOTO-PC on"
    const made = ST();
    Object.assign(made, { job: Object.assign({}, job, { drive_state: "trashed" }) });
    Object.assign(made.folder, { drive_state: "not_seen", link: null });
    Object.assign(made.files, { to_send: 38, late: true });
    made.can.add_from_phone = true;                    // (an older database's can: the line alone still offers nothing)
    v = F.filesView(made, { today: "2026-11-12", now: NOW });
    assert.deepEqual([v.lines.map((l) => l.code), v.addPhone, v.check, v.open], [["job_moved_out"], false, false, null]);
    // no name answered: Someone, never an empty ''
    const bare = ST(); Object.assign(bare, { folder: null, job: { id: 7, name: null, drive_state: "missing" } });
    assert.equal(F.filesView(bare, { now: NOW }).lines[0].text, WORDS.files.job_moved_out.replace("{name}", WORDS.completion.someone));
    // the shoot folder found by its last check: its own line until the next check says where it is
    const found = ST(); found.job = job;
    assert.equal(F.filesLine(found, { app: "portal2" }, NOW)[0], "waiting");
    // the job folder there (or no job answered: an older database): the rules as before
    const ok = ST(); Object.assign(ok, { folder: null, job: Object.assign({}, job, { drive_state: "found" }) });
    Object.assign(ok.files, { state: "none" });
    assert.deepEqual(F.filesLine(ok, { app: "portal2" }, NOW), ["none_add_phone"]);
    assert.ok(F.GONE_LINES.includes("job_moved_out"));
  } finally { F.setStrict(false); }
});

test("the count rule on the phone (§34): a copy that recorded nothing says so (_none twins) and names only Copy the rest and Cancel it; a count of 0 with no twin shows no line", () => {
  F.setStrict(true);
  try {
    const stop = ST(); stop.files.state = "copying"; stop.files.counted = 0;
    stop.uploads = [{ id: 8, state: "open", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", beat_at: "2026-11-12T21:05:00Z", recorded_files: 0, running: false, can_decide: true }];
    const vs = F.filesView(stop, { today: "2026-11-12", now: NOW });
    assert.deepEqual(vs.lines.map((l) => l.code).slice(0, 2), ["stopped", "stopped_phone"]);
    assert.deepEqual(vs.lines.map((l) => l.text).slice(0, 2), ["A copy into this shoot stopped on PHOTO-PC Thu Nov 12, 1:05 pm, before any file was recorded.",
      "Finish it in DCR Desktop: Copy the rest or Cancel it."]);
    stop.uploads[0].state = "abandoned";
    assert.equal(F.filesView(stop, { today: "2026-11-12", now: NOW }).lines[1].text, WORDS.files.stopped_phone_none);
    stop.uploads[0].recorded_files = 1;
    assert.deepEqual(F.filesView(stop, { today: "2026-11-12", now: NOW }).lines.map((l) => l.text).slice(0, 2),
      ["A copy into this shoot stopped on PHOTO-PC Thu Nov 12, 1:05 pm, after 1 file.", WORDS.files.stopped_phone]);
    stop.uploads[0].can_decide = false;
    assert.equal(F.filesView(stop, { today: "2026-11-12", now: NOW }).lines[1].text, "Only Lou or an admin can finish or cancel it.");
    const run = ST(); run.files.state = "copying"; run.files.counted = 0;
    run.uploads = [{ id: 9, state: "open", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", beat_at: "2026-11-12T21:05:00Z", recorded_files: 0, running: true, can_decide: true }];
    assert.equal(F.filesView(run, { today: "2026-11-12", now: NOW }).lines[0].text, "Lou is copying into this shoot on PHOTO-PC.");
    run.uploads[0].recorded_files = 120;
    assert.equal(F.filesView(run, { today: "2026-11-12", now: NOW }).lines[0].text, "Lou is copying into this shoot on PHOTO-PC - 120 files so far.");
  } finally { F.setStrict(false); }
  assert.equal(F.word("files", "stopped", { pc: "PHOTO-PC", when: "today", done: 0 }), WORDS.files.stopped_none.replace("{pc}", "PHOTO-PC").replace("{when}", "today"));
  assert.equal(F.word("files", "stopped_phone", { done: 0 }), WORDS.files.stopped_phone_none);
  assert.equal(F.word("files", "stopped_phone", { done: 4 }), WORDS.files.stopped_phone);
  assert.equal(F.word("files", "stopped_phone", {}), WORDS.files.stopped_phone, "no count given: the word itself");
  assert.equal(F.word("files", "drive_only", { n: 0 }), "", "a count of 0 with no _none twin shows no line");
  assert.equal(F.word("ready", "home_badge", { n: 0 }), "");
  assert.equal(F.word("files", "none_phone", { n: 0 }), WORDS.files.none_phone, "a word without the count is never hidden by it");
  for (const [g, words] of Object.entries(WORDS)) {
    for (const k of Object.keys(words)) {
      if (!k.endsWith("_none") || g === "told") continue;
      assert.equal(typeof words[k.slice(0, -5)], "string", g + "." + k + ": its plural");
    }
  }
});

test("the completion line and who was told: the codes' fillers, names masked, an empty name \"Someone\"", () => {
  const st = ST();
  st.completion = "claimed";
  st.marketing = { id: 4, state: "claimed", by: "Sam", at: "2026-11-12T21:05:00Z", ready_at: "2026-11-12T20:00:00Z", told: [{ name: "Sam", email: "sent", push: "phone" }] };
  let v = F.filesView(st, { today: "2026-11-12", admin: true });
  assert.equal(v.completion.text, "Sam is on it.");
  assert.equal(v.told, "Told Sam (phone, e-mail).", "an admin reads who was told and how");
  st.completion = "ready";
  assert.equal(F.filesView(st, { today: "2026-11-12" }).completion.text, "Sent to marketing Thu Nov 12, 12:00 pm.");
  st.completion = "posted"; st.marketing.state = "posted"; st.marketing.by = "";
  assert.equal(F.filesView(st, { today: "2026-11-12" }).completion.text, "Posted Thu Nov 12 by Someone.");
  st.completion = "passed"; st.marketing.reason = "Paid $1,200 to the crew";
  const passed = F.filesView(st, { today: "2026-11-12" }).completion.text;
  assert.ok(/^Not for posting: /.test(passed) && !/\$\s?1,200/.test(passed), passed);
  st.completion = "closed_files"; st.closed = "skipped";
  assert.equal(F.filesView(st, { today: "2026-11-12" }).completion.text,
    "This shoot was marked skipped, but its files are in OneDrive - mark it done to bring it back and send it to marketing.");
  assert.equal(F.bringBack(st), true);
  st.completion = "closed_plan";
  assert.equal(F.bringBack(st), false, "never for a closed plan");
  st.completion = "closed_old_pc";
  assert.equal(F.bringBack(st), true, "offered again: DCR Agents 2 2.3.0 applies it later");
  assert.equal(F.filesView(st, { today: "2026-11-12" }).completion.text,
    "DCR Agents 2 on the office computer can't bring this shoot back yet - press Mark done again once DCR Agents 2 is updated, or ask the office to mark it done there.");
});

test("who was told and how is an admin's line in the Files section too (P5b review round 8, §41): never for the marketing member it names, nor anyone else who is not an admin", () => {
  const st = ST();
  st.completion = "ready";
  st.marketing = { id: 4, state: "ready", by: "", at: null, ready_at: "2026-11-12T20:00:00Z",
    told: [{ name: "Sam", email: "sent", push: "phone" }, { name: "Ana", email: "queued", push: "queued" }] };
  assert.equal(F.filesView(st, { today: "2026-11-12", admin: true }).told,
    "Told Sam (phone, e-mail) and Ana (phone: waiting, e-mail: waiting).", "an admin: did the notices go out?");
  for (const o of [{}, { admin: false }, { admin: undefined }, { admin: 0 }]) {
    const v = F.filesView(st, Object.assign({ today: "2026-11-12" }, o));
    assert.equal(v.told, null, "not an admin: no told line - " + JSON.stringify(o));
    assert.equal(v.completion.text, "Sent to marketing Thu Nov 12, 12:00 pm.", "the completion line stays");
  }
  assert.equal(F.filesView(st).told, null, "no o: no told line");
});

test("marketing's culls after Ready (PF §42): a calm line of their own - confirmed_culled in confirmed's place, culled after a problem or the upload - never problem_missing, which counts the photographer's missing files alone", () => {
  F.setStrict(true);
  try {
    const st = () => {
      const s = ST();
      Object.assign(s.files, { state: "problem", counted: 10, confirmed: 7, waiting: 0, missing: 3, culled: 3, drive_only: 0 });
      s.help = [];
      s.completion = "claimed";
      s.marketing = { id: 4, state: "claimed", by: "Sam", at: "2026-11-12T21:05:00Z", ready_at: "2026-11-12T19:00:00Z", told: [] };
      return s;
    };
    const all = F.filesView(st(), { today: "2026-11-12", now: NOW });
    assert.deepEqual(all.lines.map((l) => [l.code, l.text, l.tone]), [["confirmed_culled",
      "All the files left in the folder are in OneDrive ✓ (checked Thu Nov 12, 12:00 pm). 3 were deleted or moved out of it after the shoot went to marketing.", "ok"]]);
    const one = st(); one.files.missing = 1; one.files.culled = 1; one.files.confirmed = 9;
    assert.equal(F.filesView(one, { today: "2026-11-12", now: NOW }).lines[0].text,
      "All the files left in the folder are in OneDrive ✓ (checked Thu Nov 12, 12:00 pm). 1 was deleted or moved out of it after the shoot went to marketing.", "the _one twin");
    const lost = st(); Object.assign(lost.files, { counted: 13, confirmed: 9, missing: 4 });
    assert.deepEqual(F.filesView(lost, { today: "2026-11-12", now: NOW }).lines.map((l) => [l.code, l.text, l.tone]), [
      ["problem_missing", "1 file is missing in OneDrive (deleted, or moved out of the shoot's folder).", "problem"],
      ["culled", "3 files were deleted in OneDrive or moved out of the folder after the shoot went to marketing.", ""]]);
    const up = st(); Object.assign(up.files, { state: "waiting", counted: 13, confirmed: 7, waiting: 3 });
    assert.deepEqual(F.filesView(up, { today: "2026-11-12", now: NOW }).lines.map((l) => l.code), ["waiting", "culled"]);
    const gone = st(); Object.assign(gone.files, { counted: 3, confirmed: 0, missing: 3 });
    assert.deepEqual(F.filesView(gone, { today: "2026-11-12", now: NOW }).lines.map((l) => l.code), ["culled"]);
    assert.equal(F.culledOf({ culled: 5, missing: 2 }), 2);
    assert.equal(F.culledOf({ culled: -1, missing: 2 }), 0);
    assert.equal(F.culledOf({ missing: 2 }), 0);
    assert.equal(F.culledOf(null), 0);
    const off = st(); delete off.files.culled;
    assert.deepEqual(F.filesView(off, { today: "2026-11-12", now: NOW }).lines.map((l) => [l.code, l.text]),
      [["problem_missing", "3 files are missing in OneDrive (deleted, or moved out of the shoot's folder)."]]);
  } finally { F.setStrict(false); }
});

test("Mark done… (map/photo.js shootActions): a skipped or missed shoot with files is brought back (closed_files, closed_old_pc), never closed_plan; Move… stays refused", () => {
  const plan = M.toPlan({ id: 1, rev: 5, status: "active", milestones: {}, shoot_days: [0, 1, 2, 3, 4, 5] });
  const access = { ready: true, canRead: true, canEdit: true, photographer: true };
  const shoot = (status) => M.toShoot({ id: 9, plan_id: 1, key: "progress-2", name: "Framing progress #2", status, planned_date: "2026-11-02" });
  for (const status of ["skipped", "missed"]) {
    for (const completion of ["closed_files", "closed_old_pc"]) {
      const a = M.shootActions(shoot(status), plan, access, { files: { completion } });
      assert.equal(a.done.ok, true, status + " " + completion);
      assert.equal(a.move.ok, false);
    }
    assert.equal(M.shootActions(shoot(status), plan, access, { files: { completion: "closed_plan" } }).done.ok, false);
    assert.equal(M.shootActions(shoot(status), plan, access, {}).done.ok, false, "no files: P3's rule");
  }
  assert.equal(M.shootActions(shoot("done"), plan, access, { files: { completion: "closed_files" } }).done.ok, false, "a done shoot is done");
  assert.equal(M.shootActions(shoot("skipped"), plan, { ready: true, canRead: true, canEdit: false, marketing: true }, { files: { completion: "closed_files" } }).done.ok, false,
    "marketing never marks done");
});

/* ── the Ready card ── */

const ITEM = () => ({ id: 4, state: "claimed", version: 7, shoot_id: 51, shoot_name: "Delivery day", job_label: "A267 Sample Street", city: "Los Angeles",
  shoot_day: "2026-11-12", by: "Lou", files: { photos: 248, videos: 12, other: 3, bytes: 11811160064 }, ready_at: "2026-11-12T20:00:00Z",
  waiting_long: false, files_missing: 0, files_added: 2, files_added_at: "2026-11-13T18:00:00Z", claimed: { name: "Sam", at: "2026-11-12T21:05:00Z", you: false },
  taken_from: null, posted: null, passed: null, told: [{ name: "Sam", email: "sent", push: "phone" }],
  folder: { drive_state: "found", last_code: null }, link: LINK, can: { open: true, reopen: false } });

test("readyView: ready.row's fillers, the chip, the warnings with their {n} and {day}, the buttons in words, the link only when ok, the open tip beside it", () => {
  F.setStrict(true);
  try {
    const v = F.readyView(ITEM(), { can_act: true, admin: false }, { today: "2026-11-12" });
    assert.equal(v.row, "Delivery day · A267 Sample Street · shot Thu Nov 12 · 248 photos, 12 videos and 3 other files · 11 GB · by Lou");
    assert.equal(v.title, "Delivery day");
    assert.equal(v.rest, "A267 Sample Street · shot Thu Nov 12 · 248 photos, 12 videos and 3 other files · 11 GB · by Lou");
    assert.equal(v.chip.text, "Sam is on it");
    assert.deepEqual(v.warnings.map((w) => w.text), ["2 more files since Fri Nov 13"]);
    assert.deepEqual(v.buttons.map((b) => b.text), ["Open in OneDrive", "Take it over…"]);
    assert.equal(v.link, LINK);
    assert.equal(v.tip, WORDS.ready.open_tip, "open it on the web or in the OneDrive app (OD §8.4)");
    assert.equal(v.told, null, "a marketing member was told themselves: no told line names them in the third person (round 7)");
    const admin = F.readyView(ITEM(), { can_act: true, admin: true }, { today: "2026-11-12" });
    assert.deepEqual(admin.buttons.map((b) => b.code), ["btn_open", "btn_take_over", "btn_posted", "btn_pass"]);
    assert.equal(admin.told, "Told Sam (phone, e-mail).", "an admin reads who was told and how (DCR Desktop 2's ReadyCard)");
    const photographer = F.readyView(ITEM(), { can_act: false, admin: false }, { today: "2026-11-12" });
    assert.deepEqual(photographer.buttons.map((b) => b.code), ["btn_open"], "the photographer sees the state, no act");
    assert.equal(F.readyView(ITEM(), null, { today: "2026-11-12" }).told, null, "no me: no told line");
    const bad = ITEM(); bad.link = "https://example.com/personal/office_example_com/Documents/x";
    const bv = F.readyView(bad, { can_act: true }, { today: "2026-11-12" });
    assert.deepEqual([bv.buttons.some((b) => b.code === "btn_open"), bv.link, bv.tip], [false, null, null], "a link that is not OneDrive's: no button, no tip");
    const posted = Object.assign(ITEM(), { state: "posted", claimed: null, posted: { name: "Sam", at: "2026-11-14T18:00:00Z", where: ["instagram", "website", "evil"],
      link: "javascript:alert(1)", note: "Carousel - cost $1,200", you: true }, can: { open: true, reopen: true } });
    const pv = F.readyView(posted, { can_act: true }, { today: "2026-11-12" });
    assert.equal(pv.chip.text, "Posted Sat Nov 14 by Sam");
    assert.deepEqual(pv.posted.where, ["Instagram", "Website"]);
    assert.equal(pv.posted.link, null, "only an https link is shown");
    assert.ok(!/\$\s?1,200/.test(pv.posted.note));
    assert.deepEqual(pv.buttons.map((b) => b.text), ["Open in OneDrive", "Not posted yet"]);
    const name = Object.assign(ITEM(), { shoot_name: "Kitchen $12,400 reveal", by: "" });
    const nv = F.readyView(name, { can_act: true }, { today: "2026-11-12" });
    assert.ok(!/\$\s?12,400/.test(nv.row) && /by Someone$/.test(nv.row), nv.row);
    const gone = Object.assign(ITEM(), { folder: { drive_state: "trashed", last_code: null }, can: { open: false, reopen: false } });
    assert.deepEqual(F.readyView(gone, { can_act: true, drive_access: "shared" }, { today: "2026-11-12" }).warnings.map((w) => [w.code, w.text]),
      [["folder_gone", WORDS.ready.folder_gone], ["more_files", "2 more files since Fri Nov 13"]]);
  } finally { F.setStrict(false); }
});

test("readyView (OD §8.4): when only the viewer's access stops Open in OneDrive, the card says why in its place - calmer than the shoot's own warnings, never the row's; DCR never claims access it cannot see", () => {
  F.setStrict(true);
  try {
    const noOpen = () => Object.assign(ITEM(), { state: "ready", claimed: null, files_added: 0, can: { open: false, reopen: false } });
    const want = {
      waiting: ["access_waiting", "wait", "The office hasn't given your Microsoft account access to DCR Photo & Video yet - Open in OneDrive shows here once they have."],
      not_company: ["access_not_company", "warn", "Your Microsoft account isn't a DCR Framing account - ask the office to fix it on the Photo team."],
      none: ["no_access", "info", "Ask the office for access to DCR Photo & Video."],
      [String(null)]: ["no_access", "info", WORDS.ready.no_access],
    };
    for (const [access, [code, tone, words]] of Object.entries(want)) {
      const me = { can_act: access !== "none", admin: false, drive_access: access === "null" ? null : access };
      const v = F.readyView(noOpen(), me, { today: "2026-11-12" });
      assert.deepEqual(v.warnings, [{ code, text: words, tone, access: true }], access);
      assert.equal(v.buttons.some((b) => b.code === "btn_open"), false, access + ": no Open in OneDrive");
      assert.equal(v.link, null);
      assert.ok(!/few minutes/.test(words), "never 'in a few minutes'");
    }
    const both = Object.assign(noOpen(), { files_added: 2, waiting_long: true });
    assert.deepEqual(F.readyView(both, { can_act: true, drive_access: "waiting" }, { today: "2026-11-12" }).warnings.map((w) => [w.code, w.tone, w.access]),
      [["more_files", "warn", false], ["waiting_long", "warn", false], ["access_waiting", "wait", true]]);
    assert.deepEqual(F.readyView(ITEM(), { can_act: true, drive_access: "waiting" }, { today: "2026-11-12" }).warnings.map((w) => w.code), ["more_files"], "can.open");
    const gone = Object.assign(noOpen(), { folder: { drive_state: "missing", last_code: null } });
    assert.deepEqual(F.readyView(gone, { can_act: true, drive_access: "waiting" }, { today: "2026-11-12" }).warnings.map((w) => w.code), ["folder_gone"],
      "the folder gone: its own warning, never the access line");
    assert.deepEqual(F.readyView(Object.assign(noOpen(), { link: null }), { can_act: true, drive_access: "waiting" }, { today: "2026-11-12" }).warnings, [], "no link");
    assert.deepEqual(F.readyView(noOpen(), { can_act: true, drive_access: "shared" }, { today: "2026-11-12" }).warnings, [], "shared: no line of its own");
  } finally { F.setStrict(false); }
});

test("Home's badge for marketing (ready plus claimed by me) and the first view for someone only on marketing", () => {
  assert.deepEqual(F.homeBadge({ ready: 3, claimed: 2, mine: 1 }), { cls: "", text: "4 ready for marketing", n: 4 });
  assert.equal(F.homeBadge({ ready: 0, claimed: 2, mine: 0 }), null);
  assert.equal(F.marketingOnly({ marketing: true }), true);
  assert.equal(F.marketingOnly({ marketing: true, photographer: true }), false);
  assert.equal(F.marketingOnly({ marketing: true, admin: true }), false);
});

/* ── refusals in words ── */

test("hintText / filesText / actText: every refusal in the contract's words; a code nobody named reads hint.other", () => {
  assert.equal(F.hintText("rate"), WORDS.hint.rate);
  assert.equal(F.hintText("bad_filter"), WORDS.hint.other);
  assert.equal(F.hintText("uploads_test", { codes: "A267" }), "Photo uploads are being tested on A267 - not on for this job yet.");
  assert.equal(F.filesText({ code: "offline", status: 0 }), WORDS.files.read_failed);
  assert.equal(F.filesText({ code: "not_deployed", status: 404 }), WORDS.hint.not_configured);
  assert.equal(F.filesText({ code: "root_lost", status: 409 }), null, "409 reads the status again (its root_lost line)");
  assert.equal(F.filesText({ code: "not_connected", status: 409 }), null, "409 not_connected (no root row yet, OD §4.7) reads the status again (its not_connected line)");
  assert.equal(F.filesText({ code: "folder_gone", status: 409 }), WORDS.hint.folder_gone);
  assert.equal(F.filesText({ code: "busy", status: 503 }), WORDS.hint.busy);
  assert.equal(F.filesText({ code: "not_authorized", status: 503 }), WORDS.hint.not_authorized);
  assert.equal(F.filesText({ code: "not_configured", status: 503 }), WORDS.hint.not_configured);
  assert.equal(F.filesText({ code: "uploads_off", status: 503 }), WORDS.hint.uploads_off);
  assert.equal(F.filesText({ code: "uploads_test", status: 503 }, { codes: ["A267"] }), "Photo uploads are being tested on A267 - not on for this job yet.");
  assert.equal(F.filesText({ code: "failed", status: 503 }), WORDS.hint.busy);
  assert.equal(F.filesText({ code: "failed", status: 502 }), WORDS.hint.onedrive_failed);
  assert.equal(F.filesText({ code: "onedrive_full", status: 507 }), WORDS.hint.onedrive_full);
  assert.equal(F.filesText({ code: "failed", status: 507 }), WORDS.hint.onedrive_full);
  assert.equal(F.filesText({ code: "rate", status: 429 }), WORDS.hint.rate);
  assert.equal(F.filesText({ code: "no_folder", status: 404 }), WORDS.hint.no_folder);
  assert.equal(F.filesText({ code: "forbidden", status: 403 }), WORDS.hint.forbidden);
  assert.equal(F.filesText({ code: "too_large", status: 413, info: { max_bytes: 268435456000 } }), "That file is bigger than OneDrive takes (250 GB).");
  assert.equal(F.filesText({ code: "server_error", status: 500 }), WORDS.hint.other);
  assert.equal(F.filesText({ code: "path_too_long", status: 400 }), WORDS.hint.other, "a word with a {name} the call cannot fill: never a half-filled line");
  assert.equal(F.actText({ hint: "not_yours" }, "release", "claimed"), WORDS.ready.not_yours);
  assert.equal(F.actText({ hint: "not_yours" }, "reopen", "posted"), WORDS.ready.not_yours_reopen);
  assert.equal(F.actText({ hint: "too_late" }, "reopen", "passed"), WORDS.ready.too_late_passed);
  assert.equal(F.actText({ hint: "too_late" }, "reopen", "posted"), WORDS.hint.too_late);
  assert.equal(F.actText({ hint: "taken", detail: { by: "Sam", at: "2026-11-12T21:05:00Z" } }, "claim", "ready", { today: "2026-11-12" }),
    "Sam is already on it (since Thu Nov 12, 1:05 pm).");
  assert.equal(F.actText({ hint: "changed" }, "claim", "ready"), WORDS.hint.changed);
  assert.equal(F.actText({ hint: "withdrawn" }, "claim", "ready"), WORDS.hint.withdrawn);
  assert.equal(F.actText({ retryable: true }, "claim", "ready"), WORDS.hint.no_answer, "no answer: hint.no_answer, never 'ask an admin' (round 12)");
  assert.equal(F.gdriveText, undefined, "the Google function's words are gone");
  assert.equal(F.leftOut, undefined, "Use what's in Drive is gone");
});

test("a Ready act that got no answer (P5b review round 12, §45): hint.no_answer - press it again, it is never done twice - for no signal, a timeout and a gateway's 5xx, never hint.other's 'ask an admin'; an answer the database gave keeps its own words", async () => {
  const { PhotoError } = await import("../site/js/repo/photo.js");
  assert.equal(WORDS.hint.no_answer, C.words.hint.no_answer);
  assert.match(WORDS.hint.no_answer, /never done twice/);
  for (const src of [new TypeError("Failed to fetch"), { status: 503, message: "Service Unavailable" }, { status: 504, message: "Gateway Timeout" },
    { message: "The request timed out." }]) {
    const e = new PhotoError(src);
    assert.equal(e.retryable, true, JSON.stringify(src));
    for (const [action, state] of [["claim", "ready"], ["posted", "claimed"], ["pass", "claimed"], ["reopen", "passed"], ["claim", "claimed"]]) {
      assert.equal(F.actText(e, action, state), WORDS.hint.no_answer, action + " " + JSON.stringify(src));
    }
  }
  const rate = new PhotoError({ code: "PT429", hint: "rate", message: "Too many tries - wait a minute." });
  assert.equal(rate.retryable, false);
  assert.equal(F.actText(rate, "posted", "claimed"), WORDS.hint.rate, "the database answered: its own words");
  const odd = new PhotoError({ code: "P0001", message: "something nobody named" });
  assert.equal(F.actText(odd, "posted", "claimed"), WORDS.hint.other, "a code nobody named is still hint.other");
});

test("the Access tab (OD §8.2, §8.4): the Microsoft account field's label and tip and the removal question are the contract's; each member's sharing line from the share list; nothing shares by itself", () => {
  assert.equal(A.ACCOUNT_LABEL, WORDS.share.field_label);
  assert.equal(A.ACCOUNT_LABEL, "Microsoft account (if not their DCR e-mail)");
  assert.equal(A.ACCOUNT_TIP, WORDS.share.field_tip);
  assert.equal(A.marketingOffAsk("Sam"), "Take Sam off marketing? Then remove their access to DCR Photo & Video in OneDrive and press Mark as removed.");
  assert.equal(A.marketingOffAsk(""), "Take them off marketing? Then remove their access to DCR Photo & Video in OneDrive and press Mark as removed.");
  assert.ok(!/Google/.test(A.MARKETING_TIP + A.ACCOUNT_TIP + A.PHOTO_BAD_EMAIL), "no Google word left");
  assert.equal(A.sharesChange, undefined, "no share sync (the office shares by hand, OD §8.1)");
  assert.equal(A.EMAIL_TIP, undefined);
  const ov = { company_domains: ["example.com"], share_todo: true, share_list: [
    { profile_id: "00000000-0000-4000-8000-000000000161", first_name: "Sam", account: "sam@example.com", wanted: true, not_company: false, marked: null, todo: "give" },
    { profile_id: "00000000-0000-4000-8000-000000000162", first_name: "Ana", account: "ana@example.com", wanted: true, not_company: false, marked: "shared",
      marked_at: "2026-11-12T11:00:00Z", marked_by: "Olive", todo: null },
    { profile_id: "00000000-0000-4000-8000-000000000163", first_name: "Pat", account: "pat@example.test", wanted: true, not_company: true, marked: null, todo: null },
    { profile_id: "00000000-0000-4000-8000-000000000164", first_name: "Kim", account: "kim@example.com", wanted: false, not_company: false, marked: "shared", todo: "remove" }] };
  const row = (id) => ({ id, name: "x", active: true, row: { profileId: id, marketing: true } });
  assert.deepEqual(A.shareLine(row("00000000-0000-4000-8000-000000000161"), ov, "2026-11-12"), { code: "to_give", tone: "warn",
    text: "Shoot folders: not shared yet - share DCR Photo & Video with sam@example.com in OneDrive, then press Mark as shared." });
  assert.deepEqual(A.shareLine(row("00000000-0000-4000-8000-000000000162"), ov, "2026-11-12"), { code: "shared", tone: "", text: "Shoot folders: shared (marked by Olive, Thu Nov 12)." });
  assert.equal(A.shareLine(row("00000000-0000-4000-8000-000000000163"), ov, "2026-11-12").code, "not_company");
  assert.equal(A.shareLine(row("00000000-0000-4000-8000-000000000164"), ov, "2026-11-12").text, WORDS.share.to_remove);
  assert.equal(A.shareLine(row("00000000-0000-4000-8000-000000000165"), ov, "2026-11-12"), null, "not on the share list: no line");
  assert.equal(A.shareLine({ id: "00000000-0000-4000-8000-000000000161", row: null }, ov), null, "not saved on the team yet: no line");
  assert.equal(A.shareLine(row("00000000-0000-4000-8000-000000000161"), null), null, "no overview (not an admin, or the Google edition): no line");
  assert.equal(A.shareLine(row("00000000-0000-4000-8000-000000000161"), Object.assign({}, ov, { company_domains: [] })).text, WORDS.share.no_domain);
});

test("the device's own evidence before late (OD §6.6, §10.6; review round 2): a fresh outbox_away says the disk, and its starter signed out says who and where - even once the tick stamped late; an outbox_away beat over 2 minutes old is late (DCR Desktop may be closed there)", () => {
  const st = ST();
  Object.assign(st.files, { to_send: 301, waiting: 301, confirmed: 120, counted: 421, drive_only: 0, late: true });
  const u = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 421, sent_files: 120, to_send: 301,
    send_state: "outbox_away", seen_at: "2026-11-12T20:59:30Z", rate_bps: null, behind: null };
  st.uploads = [u];
  const line = () => F.filesView(st, { now: NOW, today: "2026-11-12", viewer: { device_id: 4 } }).lines[0];
  assert.deepEqual([line().code, line().text], ["outbox_away", "The disk that holds the files waiting on PHOTO-PC isn't there - plug it back in and DCR goes on by itself."]);
  u.seen_at = "2026-11-12T20:55:00Z";
  assert.equal(line().code, "late", "an old beat: no evidence DCR Desktop is open there");
  Object.assign(u, { send_state: "paused", seen_at: "2026-11-12T20:40:00Z", rate_bps: 2500000 });
  assert.equal(line().code, "paused_signed_out");
  assert.ok(!/is PHOTO-PC on|Check that PHOTO-PC/i.test(line().text), line().text);
  assert.ok(line().text.includes("Lou") && line().text.includes("PHOTO-PC"), line().text);
  // (the full line still comes first: the cause is the office's)
  u.send_state = "onedrive_full";
  assert.equal(line().code, "full");
  u.send_state = "sending";
  assert.equal(line().code, "late", "no evidence of its own: late");
});

test("this computer's disk full while it sends (OD §3.2.5, §6.6, §10.6, §28; review round 10): a fresh disk_full beat says so with {pc} filled - free some space there, nothing is lost - even once the tick stamped late, ahead of another computer's send; its beat over 2 minutes old is paused_pc, or late once stamped", () => {
  const st = ST();
  Object.assign(st.files, { to_send: 301, waiting: 301, confirmed: 120, counted: 421, drive_only: 0, late: true });
  const u = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 421, sent_files: 120, to_send: 301,
    send_state: "disk_full", seen_at: "2026-11-12T20:59:30Z", rate_bps: null, behind: null };
  // (another computer's hand-in into the same shoot, sending now and listed first: the full disk is what holds this
  // shoot's files there, so its line comes first - SEND_ORDER, as lines.mjs)
  const other = { id: 22, state: "sealed", source: "pc", pc: "OFFICE-PC", pc_id: 5, by: "Sam", can_decide: true, files: 10, sent_files: 2, to_send: 8,
    send_state: "sending", seen_at: "2026-11-12T20:59:40Z", rate_bps: 2500000, behind: null };
  st.uploads = [other, u];
  const line = () => F.filesView(st, { now: NOW, today: "2026-11-12", viewer: { device_id: 4 } }).lines[0];
  assert.deepEqual(line(), { code: "disk_full", tone: "warn",
    text: "PHOTO-PC is out of disk space - free some space there and DCR goes on by itself. Nothing is lost." });
  assert.ok(!/is PHOTO-PC on|isn't open there/i.test(line().text), line().text);
  st.files.late = false;
  assert.equal(line().code, "disk_full");
  // (an old beat: no evidence DCR Desktop is open there)
  u.seen_at = "2026-11-12T20:55:00Z";
  st.uploads = [u];
  assert.deepEqual([line().code, line().text], ["paused_pc", WORDS.files.paused_pc.replace("{pc}", "PHOTO-PC")]);
  st.files.late = true;
  assert.equal(line().code, "late");
});

test("files lost on the copying PC (OD §6.6, §10.6, L51; review round 5): lost_here - the memory card and Copy them again - before stalled, also 14 days after the seal; stalled again once the beat no longer says lost; the help chip \"Memory card needed\"", () => {
  const st = ST();
  Object.assign(st.files, { to_send: 301, waiting: 301, confirmed: 120, counted: 421, drive_only: 0, late: true, stalled: true });
  const u = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 421, sent_files: 120, to_send: 301,
    send_state: "lost", seen_at: "2026-11-12T20:59:30Z", rate_bps: null, behind: null };
  st.uploads = [u];
  st.help = ["stalled", "lost"];
  const view = () => F.filesView(st, { now: NOW, today: "2026-11-12", viewer: { device_id: 4 } });
  assert.deepEqual([view().lines[0].code, view().lines[0].text, view().lines[0].tone],
    ["lost_here", "301 files are no longer on PHOTO-PC, or can't be read there - put the memory card back in and press Copy them again.", "problem"]);
  assert.ok(!/Open DCR Desktop/.test(view().lines.map((l) => l.text).join(" ")), "never \"open DCR Desktop\" on a PC that is open and needs the card");
  // the chip of the help event lost, in the cases' words
  assert.equal(WORDS.help.lost, "Memory card needed");
  assert.deepEqual(view().help, [WORDS.help.stalled, "Memory card needed"]);
  // an old lost beat is still the hand-in's last word (the card): lost_here, as the reference says
  u.seen_at = "2026-10-29T23:40:00Z";
  assert.equal(view().lines[0].code, "lost_here");
  // the beat no longer says lost: the 14 days' stalled line again
  u.send_state = "sending";
  assert.equal(view().lines[0].code, "stalled");
  u.send_state = "lost";
  st.files.stalled = false;
  assert.equal(view().lines[0].code, "lost_here");
  // one file: the _one twin
  Object.assign(u, { to_send: 1 });
  Object.assign(st.files, { to_send: 1, waiting: 1 });
  assert.equal(view().lines[0].text, "1 file is no longer on PHOTO-PC, or can't be read there - put the memory card back in and press Copy it again.");
});

test("the stalled line counts the stalled rows alone and names their computer (OD §6.6, §10.6, §25; review round 7, DCR Desktop 2's line_count): the status's uploads[].stalled over the sealed hand-ins - never a fresher hand-in's files still sending; no button on it, nor on lost_here", () => {
  F.setStrict(true);
  try {
    const st = ST();
    Object.assign(st.files, { to_send: 43, waiting: 43, confirmed: 257, counted: 300, drive_only: 0, stalled: true });
    // (the status's order: the newest hand-in first) B sealed today on OFFICE-PC, still sending; A sealed 20 days ago on
    // PHOTO-PC, its 3 rows never sent
    const B = { id: 22, state: "sealed", source: "pc", pc: "OFFICE-PC", pc_id: 5, by: "Sam", can_decide: true, files: 40, sent_files: 0, to_send: 40, stalled: 0,
      bytes: 40e6, bytes_sent: 1e6, send_state: "sending", seen_at: "2026-11-12T20:59:40Z", rate_bps: 2500000, behind: null, sealed_at: "2026-11-12T20:00:00Z" };
    const A = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 260, sent_files: 257, to_send: 3, stalled: 3,
      send_state: null, seen_at: null, rate_bps: null, behind: null, sealed_at: "2026-10-23T19:30:00Z" };
    st.uploads = [B, A];
    st.help = ["stalled"];
    const view = () => F.filesView(st, { now: NOW, today: "2026-11-12", viewer: { device_id: 4 } });
    const line = () => view().lines[0];
    assert.deepEqual([line().code, line().text, line().tone], ["stalled",
      "Checks stopped after 14 days - 3 files never reached OneDrive. Open DCR Desktop on PHOTO-PC and let it send them. If PHOTO-PC lost them, copy the card again there, or leave them out.",
      "problem"], "3 (A's stalled rows), never 43 (B's 40 still sending with them); PHOTO-PC, never OFFICE-PC (the hand-in sending)");
    assert.deepEqual(Object.keys(line()).sort(), ["code", "text", "tone"], "no button on the phone's stalled line (OD §10.6, §25)");
    // one stalled file: the _one twin, of the stalled count
    A.stalled = 1;
    assert.equal(line().text, "Checks stopped after 14 days - 1 file never reached OneDrive. Open DCR Desktop on PHOTO-PC and let it send it. If PHOTO-PC lost it, copy the card again there, or leave it out.");
    // two stalled hand-ins: their rows summed, {pc} the first of them in the status's order
    const C = Object.assign({}, A, { id: 20, pc: "LAPTOP", pc_id: 6, to_send: 2, stalled: 2, sealed_at: "2026-10-20T19:30:00Z" });
    st.uploads = [B, A, C];
    assert.ok(line().text.startsWith("Checks stopped after 14 days - 3 files never reached OneDrive. Open DCR Desktop on PHOTO-PC "), line().text);
    // a hand-in that is not sealed never counts (app.photo_row_stalled holds only under a sealed one)
    st.uploads = [B, Object.assign({}, A, { state: "abandoned", stalled: 4 }), C];
    assert.match(line().text, /^Checks stopped after 14 days - 2 files never reached OneDrive\. Open DCR Desktop on LAPTOP /);
    // a status whose hand-ins carry no stalled count (an older answer): the rows still to send, the hand-in sending's
    // computer, as before
    st.uploads = [B, A].map((u) => { const x = Object.assign({}, u); delete x.stalled; return x; });
    assert.ok(line().text.startsWith("Checks stopped after 14 days - 43 files never reached OneDrive. Open DCR Desktop on OFFICE-PC "), line().text);
    // the stalled hand-in's files lost on its PC: lost_here, its own count and computer - no button either
    st.uploads = [B, Object.assign({}, A, { send_state: "lost", seen_at: "2026-11-12T20:59:30Z" })];
    assert.deepEqual([line().code, line().text], ["lost_here", "3 files are no longer on PHOTO-PC, or can't be read there - put the memory card back in and press Copy them again."]);
    assert.deepEqual(Object.keys(line()).sort(), ["code", "text", "tone"], "no button on the phone's lost_here line (OD §10.6, §24, §25)");
  } finally { F.setStrict(false); }
});

test("the sending line's totals are the files that still count (OD §3.2.8, §10.6, §26; review round 8, DCR Desktop 2's files_view): {total}, {total_size} and the time left from uploads[].send_files / send_bytes - a file left out during the send out of them - the seal's files / bytes only without them; the sent figures never over them", () => {
  F.setStrict(true);
  try {
    const st = ST();
    Object.assign(st.files, { to_send: 2, waiting: 2, confirmed: 419, counted: 421, drive_only: 0 });
    // a 2 GB video left out during the send: the seal's 421 files stay its history line's, the send's 420 are its line's
    const u = { id: 21, state: "sealed", source: "pc", pc: "PHOTO-PC", pc_id: 3, by: "Lou", can_decide: true, files: 421, bytes: 33715493273,
      send_files: 420, send_bytes: 31568009625, sent_files: 419, bytes_sent: 31565000000, to_send: 1, send_state: "sending",
      seen_at: "2026-11-12T20:59:30Z", rate_bps: 2500000, behind: null };
    st.uploads = [u];
    const line = () => F.filesView(st, { now: NOW, today: "2026-11-12" }).lines[0];
    assert.deepEqual([line().code, line().text], ["sending", "Sending to OneDrive from PHOTO-PC: 419 of 420 files (29.4 GB of 29.4 GB) - about 5 min left."],
      "never \"419 of 421 files (29.4 GB of 31.4 GB) - about 15 min left\" with seconds to go");
    assert.equal(F.secondsLeft(u), (31568009625 - 31565000000) / 2500000, "the time left over send_bytes");
    // working it out: the same totals
    u.rate_bps = 0;
    assert.equal(line().text, "Sending to OneDrive from PHOTO-PC: 419 of 420 files (29.4 GB of 29.4 GB) - working out the time left.");
    // the sent figures never over the totals (a file another hand-in recorded over after this one sent it leaves them)
    Object.assign(u, { rate_bps: 2500000, sent_files: 425, bytes_sent: 33715493273 });
    assert.equal(line().text, "Sending to OneDrive from PHOTO-PC: 420 of 420 files (29.4 GB of 29.4 GB) - about 5 min left.");
    assert.equal(F.secondsLeft(u), 0, "never below 0");
    assert.deepEqual(F.sendFigures(u), { files: 420, bytes: 31568009625, sent: 420, bytes_sent: 31568009625 });
    // a server without them (an older answer): the seal's files / bytes, as before
    const old = Object.assign({}, u, { sent_files: 120, bytes_sent: 9663676416 });
    delete old.send_files; delete old.send_bytes;
    st.uploads = [old];
    assert.equal(line().text, "Sending to OneDrive from PHOTO-PC: 120 of 421 files (9 GB of 31.4 GB) - about 2 h 50 min left.");
    st.uploads = [Object.assign({}, old, { send_files: null, send_bytes: null })];
    assert.equal(line().text, "Sending to OneDrive from PHOTO-PC: 120 of 421 files (9 GB of 31.4 GB) - about 2 h 50 min left.", "null reads as missing");
    // no seal figures either (an open hand-in's recorded files): recorded_files
    assert.deepEqual(F.sendFigures({ recorded_files: 7, sent_files: 2 }), { files: 7, bytes: 0, sent: 2, bytes_sent: 0 });
    assert.deepEqual(F.sendFigures(null), { files: 0, bytes: 0, sent: 0, bytes_sent: 0 });
    // send_files 0 is a figure, never the seal's
    assert.deepEqual(F.sendFigures({ files: 421, bytes: 5, send_files: 0, send_bytes: 0, sent_files: 3, bytes_sent: 5 }), { files: 0, bytes: 0, sent: 0, bytes_sent: 0 });
  } finally { F.setStrict(false); }
});
