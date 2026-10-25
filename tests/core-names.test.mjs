// Upload names and object keys: DCR Desktop 2's safe_name / ascii_slug / object_key (shared vectors),
// and the display names that keep twenty iPhone photos from becoming versions of one another.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  safeName, asciiSlug, objectKey, previewKeyFor, displayName, bumpName, placeFor, extOf, stamp, guessMime, newUid,
} from "../site/js/upload-queue2.js";

const vec = JSON.parse(readFileSync(new URL("./vectors/file-names.json", import.meta.url), "utf8"));

test("safeName and asciiSlug match Desktop 2 on every shared vector", () => {
  assert.ok(vec.names.length >= 20);
  for (const c of vec.names) {
    assert.equal(safeName(c.in, "File"), c.safe, "safe_name " + JSON.stringify(c.in));
    assert.equal(asciiSlug(c.in), c.slug, "ascii_slug " + JSON.stringify(c.in));
  }
});

test("objectKey: p/{project}/{folder}/{32 hex}/{slug}, the shape the files check and Storage policy want", () => {
  const key = objectKey(268, "photos", "IMG 2026-10-19 14.30.12-2.jpg");
  assert.match(key, /^p\/268\/photos\/[0-9a-f]{32}\/IMG 2026-10-19 14\.30\.12-2\.jpg$/);
  assert.match(key, /^[pf]\/[0-9]+\/[a-z]+\/[^/]+\/[^/]+$/);
  assert.equal(objectKey(5, "journal", "Résumé.pdf", "ab".repeat(16)), "p/5/journal/" + "ab".repeat(16) + "/Resume.pdf");
  assert.notEqual(newUid(), newUid());
  assert.match(newUid(), /^[0-9a-f]{32}$/);
  assert.equal(previewKeyFor("p/5/photos/" + "a".repeat(32) + "/IMG.jpg"), "p/5/photos/" + "a".repeat(32) + "/preview-320.jpg");
  assert.equal(previewKeyFor("p/5/photos/x/preview-320.jpg"), "p/5/photos/x/preview-320-b.jpg");
  // a receipt is a financial file: f/ (files_storage_path_shape, app.storage_can_write), never p/
  assert.equal(objectKey(5, "receipts", "Receipt 2026-10-20 09.15.00.jpg", "cd".repeat(16)), "f/5/receipts/" + "cd".repeat(16) + "/Receipt 2026-10-20 09.15.00.jpg");
  assert.equal(previewKeyFor("f/5/receipts/" + "c".repeat(32) + "/r.jpg"), "f/5/receipts/" + "c".repeat(32) + "/preview-320.jpg", "its preview beside it");
});

test("display names: IMG/VID + company time stamp + -n, the device's own extension", () => {
  const when = "2026-10-19T21:30:12Z";                    // 2:30:12 pm PDT
  assert.equal(stamp(when), "2026-10-19 14.30.12");
  assert.equal(stamp("2026-10-20T07:05:09Z"), "2026-10-20 00.05.09", "just after midnight Pacific");
  const jpg = { name: "image.jpg", type: "image/jpeg" };
  assert.equal(displayName("photo", jpg, when, 1), "IMG 2026-10-19 14.30.12.jpg");
  assert.equal(displayName("photo", jpg, when, 2), "IMG 2026-10-19 14.30.12-2.jpg");
  assert.equal(displayName("photo", { name: "IMG_0001.HEIC", type: "image/heic" }, when, 1), "IMG 2026-10-19 14.30.12.heic");
  assert.equal(displayName("photo", { name: "", type: "video/quicktime" }, when, 1), "VID 2026-10-19 14.30.12.mov");
  assert.equal(displayName("voice", { name: "", type: "audio/webm" }, when, 1), "Voice note 2026-10-19 14.30.12.webm");
  assert.equal(displayName("note", { name: "", type: "text/plain" }, when, 1), "Note 2026-10-19 14.30.12.txt");
  assert.equal(extOf({ name: "", type: "image/jpeg" }), ".jpg");
  assert.equal(bumpName("IMG 2026-10-19 14.30.12.jpg", 3), "IMG 2026-10-19 14.30.12-3.jpg");
  assert.equal(bumpName("IMG 2026-10-19 14.30.12-2.jpg", 3), "IMG 2026-10-19 14.30.12-3.jpg");
  assert.equal(bumpName("Notes", 2), "Notes-2");
  assert.equal(guessMime("a.MOV"), "video/quicktime");
  assert.equal(guessMime("a.unknown"), "application/octet-stream");
});

test("placeFor: every upload has a folder AND a sub-folder (but a receipt: the receipts folder itself, as Desktop 2 files it)", () => {
  assert.deepEqual(placeFor("receipt", {}, "2026-10-20T06:30:00Z"), { folder: "receipts", subpath: "" });
  assert.deepEqual(placeFor("receipt", { folder: "photos" }, "2026-10-20T06:30:00Z"), { folder: "receipts", subpath: "" }, "never another folder");
  const when = "2026-10-20T06:30:00Z";                    // 11:30 pm PDT on the 19th
  assert.deepEqual(placeFor("photo", {}, when), { folder: "photos", subpath: "2026-10-19" });
  assert.deepEqual(placeFor("video", {}, when), { folder: "photos", subpath: "2026-10-19" });
  assert.deepEqual(placeFor("journal", { entryDate: "2026-10-18" }, when), { folder: "journal", subpath: "2026-10-18" });
  assert.deepEqual(placeFor("journal", {}, when), { folder: "journal", subpath: "2026-10-19" });
  assert.deepEqual(placeFor("voice", {}, when), { folder: "documents", subpath: "Site Notes" });
  assert.deepEqual(placeFor("note", {}, when), { folder: "documents", subpath: "Site Notes" });
  assert.deepEqual(placeFor("photo", { folder: "plans", subpath: "Markups" }, when), { folder: "plans", subpath: "Markups" });
});
