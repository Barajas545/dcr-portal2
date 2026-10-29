// The Books program, release A (P1): the one file picker (site/js/pages/file-drop.js) - its pure rules: what a file
// must be, the same file twice, at most 20 at once, a dropped folder, a paste (files and image items only, never text
// or HTML), the names the queue is handed (a paste or a camera's own name: none, so the queue names it "Receipt <time>";
// a real name kept), and that it carries the receipts' rules without importing the cost dialog's code. Made-up files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptable, dedupe, fileKey, limitText, filesFromTransfer, pasteFiles, uploadName, wasPasted, queueAll, pictureOrPdf, cameraName,
  ACCEPT, MAX_BYTES, MAX_FILES,
} from "../site/js/pages/file-drop.js";
import { RECEIPT_ACCEPT, MAX_RECEIPT_BYTES, receiptProblem, genericName } from "../site/js/map/cost-form.js";

const read = (rel) => readFileSync(new URL("../site/" + rel, import.meta.url), "utf8");
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const file = (name, type, size, mod) => {
  const f = new File([new Uint8Array(size === undefined ? 1000 : size)], name, { type, lastModified: mod || 1700000000000 });
  return f;
};

test("the picker's rules are the receipts' (map/cost-form.js), word for word - without importing the cost dialog's code", () => {
  assert.equal(ACCEPT, RECEIPT_ACCEPT, "the accept list");
  assert.equal(MAX_BYTES, MAX_RECEIPT_BYTES, "25 MB");
  assert.equal(MAX_FILES, 20);
  const cases = [file("a.pdf", "application/pdf"), file("a.jpg", "image/jpeg"), file("IMG_4412.HEIC", "image/heic"), file("x.svg", "image/svg+xml"),
    file("x.svgz", ""), file("notes.txt", "text/plain"), file("scan", "application/pdf"), file("tif.tiff", ""), file("empty.pdf", "application/pdf", 0),
    file("big.pdf", "application/pdf", MAX_BYTES + 1), file("setup.exe", "application/octet-stream"), file("page.html", "text/html")];
  for (const f of cases) assert.equal(pictureOrPdf(f), receiptProblem(f), f.name);
  for (const n of ["image.jpg", "IMG_4412.jpg", "img4412.JPG", "photo.png", "scan.pdf", "document.pdf", "image (2).png", "INV-4101.pdf",
    "Screenshot 2026-10-28.png", "photos.jpg", ""]) assert.equal(cameraName(n), genericName(n), n);
  const raw = read("js/pages/file-drop.js");
  assert.ok(!/^\s*import\s/m.test(raw) && !/import\(/.test(raw), "file-drop.js imports nothing at all (no money module rides along on a page that mounts it)");
});

test("acceptable: empty, too large, the type (an SVG or a web page never), a page's own rule", () => {
  assert.equal(acceptable(file("a.pdf", "application/pdf")), "");
  assert.equal(acceptable(file("a.pdf", "application/pdf", 0)), "That file is empty.");
  assert.equal(acceptable(file("a.pdf", "application/pdf", MAX_BYTES + 1)), "A file can be at most 25 MB.");
  assert.equal(acceptable(file("logo.svg", "image/svg+xml")), "A receipt is a photo, a scan or a PDF.");
  assert.equal(acceptable(file("index.html", "text/html")), "A receipt is a photo, a scan or a PDF.");
  assert.equal(acceptable(file("a.png", "image/png", 3000), { maxBytes: 2000 }), "A file can be at most 0 MB.".replace("0 MB", Math.round(2000 / 1048576) + " MB"));
  assert.equal(acceptable(file("a.png", "image/png"), { problem: (f) => (f.type === "image/png" ? "Not a PNG here." : "") }), "Not a PNG here.");
});

test("dedupe: the same file twice (name + size + last modified) is one; files already held count", () => {
  const a = file("INV-1.pdf", "application/pdf", 100, 1), b = file("INV-1.pdf", "application/pdf", 100, 1), c = file("INV-1.pdf", "application/pdf", 101, 1);
  assert.equal(fileKey(a), fileKey(b));
  assert.deepEqual(dedupe([a, b, c]).map((f) => f.size), [100, 101]);
  assert.deepEqual(dedupe([b, c], [a]).map((f) => f.size), [101], "already held");
  assert.equal(limitText(0), "");
  assert.equal(limitText(1, 20), "At most 20 files at a time: 1 was left out.");
  assert.equal(limitText(3, 20), "At most 20 files at a time: 3 were left out.");
});

test("a drop: its files; a folder is left out and said", () => {
  const pdf = file("INV-4101.pdf", "application/pdf");
  const dir = new File([], "Receipts folder");
  const dt = { files: [pdf, dir], items: [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: false }) }, { kind: "file", webkitGetAsEntry: () => ({ isDirectory: true }) }] };
  const got = filesFromTransfer(dt, false);
  assert.deepEqual(got.files.map((f) => f.name), ["INV-4101.pdf"]);
  assert.equal(got.folder, true);
  assert.equal(wasPasted(pdf), false, "a dropped file is not a paste");
  assert.equal(uploadName(pdf), "INV-4101.pdf", "a real name is kept (the database makes a clash \"INV-4101 (2).pdf\")");
  assert.deepEqual(filesFromTransfer(null), { files: [], folder: false });
});

test("a paste: clipboardData.files or its image items only - never text or HTML; a paste is named by the queue", async () => {
  const shot = file("image.png", "image/png");
  const got = filesFromTransfer({ files: [shot], items: [] }, true);
  assert.deepEqual(got.files, [shot]);
  assert.equal(wasPasted(shot), true);
  assert.equal(uploadName(shot), undefined, "a paste goes to the queue without a name: \"Receipt <time>[-n]\"");
  const named = file("Screenshot 2026-10-28 at 9.41.png", "image/png");
  filesFromTransfer({ files: [named] }, true);
  assert.equal(uploadName(named), undefined, "a pasted file is never kept by its clipboard name");
  const fromItem = file("x.jpg", "image/jpeg");
  const items = [{ kind: "string", type: "text/html", getAsFile: () => null }, { kind: "string", type: "text/plain", getAsFile: () => null },
    { kind: "file", type: "image/jpeg", getAsFile: () => fromItem }];
  assert.deepEqual(filesFromTransfer({ files: [], items }, true).files, [fromItem], "only the image item");
  assert.deepEqual(filesFromTransfer({ files: [], items: items.slice(0, 2) }, true).files, [], "text and HTML: nothing (a text field keeps its paste)");
  // the Paste button: navigator.clipboard.read()'s items
  const blob = new Blob([new Uint8Array(50)], { type: "image/png" });
  const clip = [{ types: ["text/plain"], getType: async () => new Blob(["hello"]) }, { types: ["text/html", "image/png"], getType: async (t) => (t === "image/png" ? blob : null) }];
  const out = await pasteFiles(clip);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "image/png");
  assert.equal(out[0].name, "image.png");
  assert.equal(wasPasted(out[0]), true);
  assert.deepEqual(await pasteFiles([]), []);
});

test("uploadName: a camera's own name goes unnamed; a name without a usable extension gets its type's; control characters go", () => {
  assert.equal(uploadName(file("IMG_4412.jpg", "image/jpeg")), undefined);
  assert.equal(uploadName(file("image.jpg", "image/jpeg")), undefined);
  assert.equal(uploadName(file("Kestrel invoice 77.pdf", "application/pdf")), "Kestrel invoice 77.pdf");
  assert.equal(uploadName(file("scan from the copier", "application/pdf")), "scan from the copier.pdf");
  assert.equal(uploadName(file("receipt.dat", "image/heic")), "receipt.dat.heic");
  assert.equal(uploadName(file("bad\u0007name.pdf", "application/pdf")), "badname.pdf");
  assert.equal(uploadName(file("what", "")), undefined, "no type, no extension: the queue's own name");
  assert.equal(uploadName(null), undefined);
});

test("queueAll: one job per file, the name rule applied, one refusal never stops the others", async () => {
  const a = file("INV-1.pdf", "application/pdf"), b = file("image.jpg", "image/jpeg"), c = file("INV-3.pdf", "application/pdf");
  const jobs = [];
  const enqueue = async (j) => { if (j.file === b) throw new Error("full"); jobs.push(j); return "id"; };
  const res = await queueAll([a, b, c], enqueue, (f) => ({ projectId: 7, kind: "bill", billId: 41, tag: f === a ? "document" : "" }));
  assert.equal(res.queued, 2);
  assert.equal(res.failed.length, 1);
  assert.equal(res.failed[0].file, b);
  assert.deepEqual(jobs.map((j) => [j.name, j.kind, j.billId, j.tag]), [["INV-1.pdf", "bill", 41, "document"], ["INV-3.pdf", "bill", 41, ""]]);
});

test("the box: paste is heard on its dialog (or the box, or the page's card) - never on document; names shown as text, never markup", () => {
  const src = code(read("js/pages/file-drop.js"));
  assert.ok(!/document\.addEventListener\(\s*["']paste/.test(src), "never document");
  assert.match(src, /const pasteHost = o\.pasteOn \|\| \(host\.closest \? host\.closest\('\[role="dialog"\], dialog'\) : null\) \|\| box;/);
  assert.match(src, /pasteHost\.addEventListener\("paste", onPaste\)/);
  assert.match(src, /pasteHost\.removeEventListener\("paste", onPaste\)/, "taken off again when the box goes");
  assert.ok(!/innerHTML/.test(src), "no innerHTML at all: every name with textContent");
  assert.match(src, /if \(!got\.files\.length\) return;\s+\/\/ text into a text field: left alone/);
  assert.match(read("js/pages/file-drop.js"), /cam\.setAttribute\("capture", "environment"\)/, "the camera on a phone");
  // the row drops of the ledger and the Expenses tab: a paste in a text field is left alone, the scope is the table's box
  assert.match(src, /if \(t && t\.closest && t\.closest\("input, textarea, \[contenteditable\]"\)\) return;/);
  for (const f of ["js/pages/bill.js", "js/pages/expense-dialog.js", "js/pages/project-expenses.js", "js/pages/ledger.js", "js/pages/file-viewer.js"]) {
    assert.ok(!/document\.addEventListener\(\s*["']paste/.test(code(read(f))), f + ": no paste listener on document");
  }
});
