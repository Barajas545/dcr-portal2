// PROJECT-PAGES: the pages' side of the upload queue (site/js/pages/uploads.js): what is shown for
// each queued file, one project's summary, and the names of notes. Made-up data only.
import test from "node:test";
import assert from "node:assert/strict";
import { progressItems, summaryOf, itemLabel, noteName, isVideoFile } from "../site/js/pages/uploads.js";

test("uploads: the queue's items become what the pages draw", () => {
  const items = progressItems([
    { id: "a", projectId: 7, name: "IMG 2026-10-19 14.30.12.jpg", state: "uploading", pct: 47.4, size: 10 },
    { id: "b", projectId: "7", name: "IMG 2026-10-19 14.30.12-2.jpg", state: "failed", error: "Storage did not answer (503)." },
    { id: "c", projectId: 8, name: "VID x.mov", state: "held", pendingEntry: "jrn:8:abc" },
    { id: "d", projectId: 7, name: "Note y.txt", state: "waiting", pct: 140 },
  ]);
  assert.equal(items[0].pct, 47);
  assert.equal(items[0].projectId, "7");
  assert.equal(items[3].pct, 100);
  assert.equal(items[2].pendingEntry, "jrn:8:abc");
  assert.deepEqual(summaryOf(items, 7), { total: 3, failed: 1, held: 0, uploading: 1, waiting: 1 });
  assert.deepEqual(summaryOf(items, "8"), { total: 1, failed: 0, held: 1, uploading: 0, waiting: 0 });
  assert.equal(itemLabel(items[0], true), "47%");
  assert.equal(itemLabel(items[0], false), "held on this device");
  assert.equal(itemLabel(items[1], true), "Storage did not answer (503). — retry");
  assert.equal(itemLabel(items[2], true), "waits for its entry");
  assert.equal(itemLabel(items[3], true), "waiting…");
  assert.equal(itemLabel(null, true), "saved");
  assert.deepEqual(progressItems(null), []);
});

test("uploads: a note's name carries a file-safe title, in company time", () => {
  const when = new Date("2026-10-19T21:30:12Z");
  assert.equal(noteName("Note", when, "Gate code: 4512 / back", ".txt"), "Note 2026-10-19 14.30.12 - Gate code 4512 back.txt");
  assert.equal(noteName("Voice note", when, "", ".webm"), "Voice note 2026-10-19 14.30.12.webm");
  assert.equal(noteName("Note", when, "  ends with dots... ", ".txt"), "Note 2026-10-19 14.30.12 - ends with dots.txt");
  assert.equal(isVideoFile({ type: "video/quicktime", name: "image.mov" }), true);
  assert.equal(isVideoFile({ type: "", name: "clip.MP4" }), true);
  assert.equal(isVideoFile({ type: "image/jpeg", name: "image.jpg" }), false);
});
