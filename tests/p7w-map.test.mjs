// Part 3 (owner decisions 2026-10-24 D1, D2, D13): the pure parts — the Access tab's switches (site/js/map/access.js),
// the New Project dialog's fields (map/projects.js newProjectFields), the cost form (map/cost-form.js: DCR Desktop 2's
// CostDialog rules and sentences), the project picture's header reading and sizes (site/js/thumb-prep.js), the
// receipt's object key and place (upload-queue2.js), the Takeoffs tab's link and the shell's switch hints. Made-up
// values only.
import test from "node:test";
import assert from "node:assert/strict";

import * as A from "../site/js/map/access.js";
import { newProjectFields, NEW_PROJECT_KEYS, RATE_ZONES } from "../site/js/map/projects.js";
import * as CF from "../site/js/map/cost-form.js";
import * as T from "../site/js/thumb-prep.js";
import { objectKey, placeFor, displayName } from "../site/js/upload-queue2.js";
import { can } from "../site/js/pages/shell.js";
import { plansLink, TAKEOFF_WEB } from "../site/js/pages/project-takeoffs.js";

/* ── the Access tab ── */
test("access: what each role is offered — an admin every switch ticked and fixed, Estimator for managers only, OneDrive for every role but view-only", () => {
  const keys = (acc, ready) => A.offers(acc, ready).map((o) => o.key);
  const admin = A.offers({ role: "admin", can_see_prices: false }, true);
  assert.ok(admin.every((o) => o.on && o.disabled && /always/.test(o.note)), "an admin: all on, fixed");
  assert.ok(keys({ role: "manager" }, true).includes("can_estimate"));
  for (const role of ["lead", "accountant", "field", "viewer"]) assert.ok(!keys({ role }, true).includes("can_estimate"), role + ": no Estimator");
  for (const role of ["manager", "lead", "accountant", "field"]) assert.ok(keys({ role }, true).includes("can_upload_onedrive"), role + ": OneDrive upload");
  assert.ok(!keys({ role: "viewer" }, true).includes("can_upload_onedrive"), "view-only: no OneDrive upload");
  assert.deepEqual(A.offers({ role: "agents" }, true), [], "the agents account: nothing");
  const m = A.offers({ role: "manager", can_see_financials: true, can_estimate: true }, true);
  const by = Object.fromEntries(m.map((o) => [o.key, o]));
  assert.equal(by.can_estimate.on, true);
  assert.equal(by.can_estimate.disabled, false);
  for (const k of ["can_see_financials", "can_approve_payments", "can_sales_estimates"]) {
    assert.equal(by[k].disabled, true, k + " is changed in Desktop 2");
    assert.equal(by[k].note, A.IN_DESKTOP);
  }
  assert.equal(by.can_see_financials.on, true);
  const early = Object.fromEntries(A.offers({ role: "manager" }, false).map((o) => [o.key, o]));
  assert.ok(early.can_estimate.disabled && early.can_upload_onedrive.disabled && early.can_estimate.note === A.NOT_YET, "before the database update");
  assert.equal(early.can_see_prices.disabled, false, "prices can still be set");
});

test("access: ticking Estimator ticks prices too (and says so); unticking prices afterwards stays; diff sends only what changed", () => {
  const acc = { id: "u1", role: "manager", can_see_prices: false, can_estimate: false, can_upload_onedrive: false, version: 4 };
  let t = A.tick(A.stateOf(acc), "can_estimate", true);
  assert.equal(t.state.can_see_prices, true);
  assert.equal(t.hint, A.HINT_PRICES);
  assert.deepEqual(A.diff(acc, t.state), { can_estimate: true, can_see_prices: true });
  t = A.tick(t.state, "can_see_prices", false);
  assert.equal(t.state.can_estimate, true, "a quantities-only estimator");
  assert.equal(t.hint, "");
  assert.deepEqual(A.diff(acc, t.state), { can_estimate: true });
  const priced = A.tick(A.stateOf(Object.assign({}, acc, { can_see_prices: true })), "can_estimate", true);
  assert.equal(priced.hint, "", "prices already on: nothing to say");
  assert.deepEqual(A.diff(acc, A.stateOf(acc)), {}, "nothing changed");
  assert.deepEqual(A.diff({ role: "admin" }, { can_see_prices: false }), {}, "an admin's switches are never sent");
  assert.deepEqual(A.diff({ role: "lead" }, { can_estimate: true, can_upload_onedrive: true }), { can_upload_onedrive: true }, "never a switch the role cannot hold");
  assert.deepEqual(A.diff(acc, { can_see_financials: true }), {}, "only the three editable switches");
});

test("access: the database's refusals in words", () => {
  assert.match(A.saveProblem({ code: "PT409" }), /changed this person meanwhile/);
  assert.equal(A.saveProblem({ code: "23514", message: 'violates check constraint "profiles_estimate_needs_manager"' }), "Estimator is for managers only.");
  assert.equal(A.saveProblem({ code: "23514", message: 'violates check constraint "profiles_onedrive_needs_writer"' }), "View-only accounts can't upload.");
  assert.match(A.saveProblem({ code: "22023", message: "unknown switch: can_estimate" }), /does not have this switch yet/);
  assert.equal(A.saveProblem({ code: "42501" }), null, "the page's usual text");
});

test("shell hints: estimates = an admin or a manager with Estimator; money = canTag; onedrive_upload = the switch (never view-only or the agents account)", () => {
  assert.equal(can({ role: "admin" }, "estimates"), true);
  assert.equal(can({ role: "manager", can_estimate: true }, "estimates"), true);
  assert.equal(can({ role: "manager" }, "estimates"), false);
  assert.equal(can({ role: "lead", can_estimate: true }, "estimates"), false);
  assert.equal(can({ role: "manager", can_see_financials: true }, "money"), true);
  assert.equal(can({ role: "lead", can_see_financials: true }, "money"), false);
  assert.equal(can({ role: "field", can_upload_onedrive: true }, "onedrive_upload"), true);
  assert.equal(can({ role: "viewer", can_upload_onedrive: true }, "onedrive_upload"), false);
  assert.equal(can({ role: "manager", can_estimate: true, active: false }, "estimates"), false);
  assert.equal(can({ role: "agents" }, "files"), false);
  assert.equal(can({ role: "manager" }, "projects"), true, "the role matrix is unchanged");
});

/* ── New Project ── */
const NP = (o) => Object.assign({ name: " Hillside  Residence ", address: "", city: "Oak Vista", state: "ca", zip: "", client_name: "", client_phone: "",
  client_email: "", start_date: "", status: "", scope: "", zone: "auto", rate: "" }, o);

test("newProjectFields: trimmed, blanks left out, the status defaults to New request, nothing but create_project's keys", () => {
  const got = newProjectFields(NP(), false);
  assert.deepEqual(got, { fields: { name: "Hillside Residence", city: "Oak Vista", state: "CA", status: "new_request" } });
  const full = newProjectFields(NP({ address: "1 Sandbox Rd", zip: "93446-1234", client_name: "Ivo Madeup", client_phone: "(805) 555-0199",
    client_email: "ivo@example.com", start_date: "2026-11-02", status: "estimating", scope: "  Deck\nand stairs  ", zone: "local" }), false).fields;
  assert.equal(full.scope, "Deck\nand stairs", "the scope keeps its lines");
  assert.equal(full.rate_source, "local", "a zone alone: no prices needed");
  assert.ok(!("labor_rate" in full));
  for (const k of Object.keys(full)) assert.ok(NEW_PROJECT_KEYS.includes(k), k);
  for (const k of ["tags", "plans_url", "lat", "lng", "client_contact_id"]) assert.ok(!NEW_PROJECT_KEYS.includes(k), k + " is never sent");
  assert.deepEqual(RATE_ZONES.map((z) => z.id), ["auto", "local", "out_of_area", "custom"]);
});

test("newProjectFields: the problems, in plain sentences", () => {
  assert.equal(newProjectFields(NP({ name: "  " }), true).problem, "The project needs a name.");
  assert.match(newProjectFields(NP({ zip: "9344" }), true).problem, /ZIP/);
  assert.match(newProjectFields(NP({ state: "Cal" }), true).problem, /two letters/);
  assert.match(newProjectFields(NP({ client_email: "ivo at example" }), true).problem, /e-mail/);
  assert.match(newProjectFields(NP({ start_date: "11/02/2026" }), true).problem, /start date/);
  assert.match(newProjectFields(NP({ status: "done" }), true).problem, /how the project starts/);
  assert.match(newProjectFields(NP({ rate: "95" }), true).problem, /Custom rate/, "a typed rate without Custom");
  assert.match(newProjectFields(NP({ zone: "local", rate: "95" }), true).problem, /Custom rate/);
  assert.match(newProjectFields(NP({ zone: "custom", rate: "95" }), false).problem, /prices switch/, "custom needs prices");
  assert.match(newProjectFields(NP({ zone: "custom", rate: "" }), true).problem, /labor rate/);
  assert.match(newProjectFields(NP({ zone: "custom", rate: "0" }), true).problem, /more than \$0/);
  assert.match(newProjectFields(NP({ zone: "custom", rate: "1000.01" }), true).problem, /at most \$1,000/);
  assert.match(newProjectFields(NP({ zone: "nearby" }), true).problem, /zone/);
  assert.deepEqual(newProjectFields(NP({ zone: "custom", rate: "$95.555" }), true).fields.labor_rate, 95.56);
  assert.equal(newProjectFields(NP({ zone: "custom", rate: "95" }), true).fields.rate_source, "custom");
});

/* ── the cost form (Desktop 2's CostDialog) ── */
const CF0 = (o) => Object.assign({ kind: "material", cost_date: "2026-10-20", description: "Lumber delivery", vendor: "", hours: "", rate: "", amount: "412.50",
  estimate_item_id: "", card: "untagged" }, o);

test("cost form: Desktop 2's sentences, and 2.5 h × $33.33 = $83.33 (to the cent, half up, as the database works it out)", () => {
  assert.equal(CF.validate(CF0({ cost_date: "" }), false).cost_date, "Pick the date of the cost.");
  assert.equal(CF.validate(CF0({ kind: "labor", hours: "8", rate: "", amount: "" }), false).rate, "Enter the hourly rate.");
  assert.equal(CF.validate(CF0({ kind: "labor", hours: "8", rate: "", amount: "" }), false).amount, "Enter the amount (or hours and rate).");
  assert.equal(CF.validate(CF0({ kind: "labor", hours: "8", rate: "", amount: "300" }), false), null, "hours with an amount: fine");
  assert.equal(CF.validate(CF0({ amount: "" }), false).amount, "Enter the amount (or hours and rate).");
  assert.equal(CF.validate(CF0({ amount: "0" }), true), null, "an edit may be zero");
  assert.equal(CF.validate(CF0({ description: " ", vendor: "" }), false).description, "Say what this cost was.");
  assert.equal(CF.validate(CF0({ description: "", vendor: "Oakfield Lumber" }), false), null, "a vendor is enough");
  assert.match(CF.validate(CF0({ kind: "labor", hours: "-1", rate: "40" }), false).hours, /negative/);
  assert.match(CF.validate(CF0({ kind: "labor", hours: "2", rate: "-40" }), false).rate, /negative/);
  assert.match(CF.validate(CF0({ amount: "12e12" }), false).amount, /a number/);
  assert.match(CF.validate(CF0({ amount: "10000000000" }), false).amount, /too large/);
  assert.match(CF.validate(CF0({ card: "bitcoin" }), false).card, /paid/);
  assert.equal(CF.validate(CF0({ amount: "-120.00", description: "Return of 4 studs" }), false), null, "a credit is a negative amount");
  assert.equal(CF.laborAmount(2.5, 33.33), 83.33);
  assert.equal(CF.costValue(CF0({ kind: "labor", hours: "2.5", rate: "33.33", amount: "" })), 83.33);
  assert.equal(CF.costValue(CF0({ kind: "material", hours: "2.5", rate: "33.33", amount: "10" })), 10, "hours count for labour only");
  assert.equal(CF.byTheHour(CF0({ kind: "labor", hours: "3", rate: "0" })), false);
  assert.equal(CF.num("$1,250.50"), 1250.5);
  assert.ok(Number.isNaN(CF.num("12 bucks")));
  assert.equal(CF.round2(-1.005), -1.01, "half away from zero");
});

test("cost form: what a new cost sends (Desktop 2's submit_new) and what an edit sends (only the changed columns, cleared hours / rate as NULL)", () => {
  assert.deepEqual(CF.payload(CF0(), { projectId: 268 }), { project_id: 268, kind: "material", cost_date: "2026-10-20", amount: 412.5, description: "Lumber delivery" });
  const labor = CF.payload(CF0({ kind: "labor", description: "Felipe - framing", hours: "2.5", rate: "33.33", amount: "", estimate_item_id: "77", card: "card-amex" }), { projectId: 268 });
  assert.deepEqual(labor, { project_id: 268, kind: "labor", cost_date: "2026-10-20", amount: 83.33, description: "Felipe - framing", hours: 2.5, rate: 33.33,
    estimate_item_id: 77, card: "card-amex" });
  for (const k of Object.keys(labor)) assert.ok(["project_id", "kind", "cost_date", "description", "vendor", "amount", "hours", "rate", "estimate_item_id", "card"].includes(k));
  const before = { id: 9, kind: "labor", cost_date: "2026-10-20", description: "Felipe - framing", vendor: null, amount: 83.33, hours: 2.5, rate: 33.33,
    estimate_item_id: 77, card: "card-amex", version: 3 };
  assert.deepEqual(CF.payload(CF0({ kind: "labor", description: "Felipe - framing", hours: "2.5", rate: "33.33", amount: "", estimate_item_id: "77", card: "card-amex" }),
    { editing: true, before }), {}, "nothing changed: nothing sent");
  assert.deepEqual(CF.payload(CF0({ kind: "labor", description: "Felipe - framing", hours: "", rate: "", amount: "90", estimate_item_id: "77", card: "card-amex" }),
    { editing: true, before }), { amount: 90, hours: null, rate: null }, "the hours cleared: sent as NULL, or the database keeps working it out");
  assert.deepEqual(CF.payload(CF0({ kind: "material", description: "Felipe - framing", amount: "83.33", estimate_item_id: "", card: "untagged" }),
    { editing: true, before }), { kind: "material", hours: null, rate: null, estimate_item_id: null, card: "untagged" });
  assert.deepEqual(CF.payload(CF0({ vendor: "  ", description: "x" }), { editing: true, before: { kind: "material", cost_date: "2026-10-20", description: "x", vendor: "Old", amount: 412.5, card: "untagged" } }),
    { vendor: null }, "a blanked vendor is NULL");
});

test("cost form: correcting a cost tied to an estimate line never unties it — no select drawn, or a select not changed, sends no estimate_item_id", () => {
  const before = { id: 9, kind: "material", cost_date: "2026-10-20", description: "Lumber", vendor: "Yard", amount: 120, hours: null, rate: null,
    estimate_item_id: 4411, card: "card-amex", version: 3 };
  const typo = (o) => CF0(Object.assign({ description: "Lumber (fixed typo)", vendor: "Yard", amount: "120.00", card: "card-amex" }, o));
  // no line choices (none live, the read failed): the dialog draws no select and the form says undefined
  assert.deepEqual(CF.payload(typo({ estimate_item_id: undefined }), { editing: true, before }), { description: "Lumber (fixed typo)" });
  assert.deepEqual(CF.payload(typo({ estimate_item_id: undefined }), { editing: true, before, lineShown: undefined }), { description: "Lumber (fixed typo)" });
  // a select that could not show the line (it fell back to "Not tied to a line") and was left alone
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "" }), { editing: true, before, lineShown: "" }), { description: "Lumber (fixed typo)" });
  // the select showed the line and the person left it, or picked it again
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "4411" }), { editing: true, before, lineShown: "4411" }), { description: "Lumber (fixed typo)" });
  // the person changed it: untied, or another line
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "" }), { editing: true, before, lineShown: "4411" }), { description: "Lumber (fixed typo)", estimate_item_id: null });
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "4412" }), { editing: true, before, lineShown: "4411" }), { description: "Lumber (fixed typo)", estimate_item_id: 4412 });
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "4412" }), { editing: true, before, lineShown: "" }), { description: "Lumber (fixed typo)", estimate_item_id: 4412 });
  // a cost with no line: picking one sends it
  assert.deepEqual(CF.payload(typo({ estimate_item_id: "77" }), { editing: true, before: Object.assign({}, before, { estimate_item_id: null }), lineShown: "" }),
    { description: "Lumber (fixed typo)", estimate_item_id: 77 });
  // a new cost without a select: no line
  assert.ok(!("estimate_item_id" in CF.payload(CF0({ estimate_item_id: undefined }), { projectId: 268 })));
});

test("cost form: receipts — a camera's own name is replaced, a picture or a PDF of at most 25 MB", () => {
  for (const n of ["image.jpg", "IMG_4412.JPG", "photo.png", "IMG4412.heic"]) assert.ok(CF.genericName(n), n);
  for (const n of ["Home Depot 10-20.pdf", "receipt lumber.jpg"]) assert.ok(!CF.genericName(n), n);
  assert.equal(CF.receiptProblem({ name: "r.pdf", type: "application/pdf", size: 1000 }), "");
  assert.equal(CF.receiptProblem({ name: "r.heic", type: "", size: 1000 }), "");
  assert.match(CF.receiptProblem({ name: "r.pdf", type: "application/pdf", size: 26 * 1024 * 1024 }), /25 MB/);
  assert.match(CF.receiptProblem({ name: "r.svg", type: "image/svg+xml", size: 10 }), /photo, a scan or a PDF/);
  assert.match(CF.receiptProblem({ name: "r.exe", type: "application/x-msdownload", size: 10 }), /photo, a scan or a PDF/);
  assert.ok(!CF.RECEIPT_ACCEPT.includes("*"), "the accept list names its types");
});

test("receipts in the queue: f/{project}/receipts/{uuid}/{slug} (the files check and the Storage policy), no sub-folder, 'Receipt <time>'", () => {
  assert.match(objectKey(268, "receipts", "Receipt 2026-10-20 09.15.00.jpg"), /^f\/268\/receipts\/[0-9a-f]{32}\/Receipt 2026-10-20 09\.15\.00\.jpg$/);
  assert.match(objectKey(268, "photos", "IMG.jpg"), /^p\/268\/photos\//, "everything else stays under p/");
  assert.deepEqual(placeFor("receipt", {}, "2026-10-20T16:15:00Z"), { folder: "receipts", subpath: "" });
  assert.equal(displayName("receipt", { name: "image.jpg", type: "image/jpeg" }, "2026-10-20T16:15:00Z", 1), "Receipt 2026-10-20 09.15.00.jpg");
});

/* ── the project picture ── */
const bytes = (arr, len) => { const b = new Uint8Array(Math.max(len || 0, arr.length)); b.set(arr); return b; };
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const ascii = (s) => Array.from(s).map((c) => c.charCodeAt(0));

test("thumb-prep: the size a picture's header says, read before anything is decoded (PNG, GIF, JPEG, WebP, HEIC)", () => {
  assert.deepEqual(T.imageSize(bytes([0x89, ...ascii("PNG"), 13, 10, 26, 10, 0, 0, 0, 13, ...ascii("IHDR"), ...be32(4032), ...be32(3024)], 40)),
    { width: 4032, height: 3024, type: "image/png" });
  assert.deepEqual(T.imageSize(bytes([...ascii("GIF89a"), 0x20, 0x03, 0x58, 0x02], 20)), { width: 800, height: 600, type: "image/gif" });
  // JPEG: SOI, an APP1 segment (EXIF) of 16 bytes, then SOF0 with 3024 x 4032
  const app1 = [0xff, 0xe1, 0x00, 0x10].concat(new Array(14).fill(0));
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xd0, 0x0f, 0xc0, 0x03];
  assert.deepEqual(T.imageSize(bytes([0xff, 0xd8, ...app1, ...sof0], 64)), { width: 4032, height: 3024, type: "image/jpeg" });
  assert.equal(T.imageSize(bytes([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04], 32)), null, "image data before a frame header");
  // WebP VP8X: canvas 6000 x 4000 (stored minus one, 24-bit little endian)
  const vp8x = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0, 0x6f, 0x17, 0x00, 0x9f, 0x0f, 0x00];
  assert.deepEqual(T.imageSize(bytes(vp8x, 40)), { width: 6000, height: 4000, type: "image/webp" });
  // WebP VP8 (lossy): 640 x 480 at bytes 26 and 28
  const vp8 = [...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP"), ...ascii("VP8 "), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x80, 0x02, 0xe0, 0x01];
  assert.deepEqual(T.imageSize(bytes(vp8, 40)), { width: 640, height: 480, type: "image/webp" });
  // HEIC: ftyp heic, then the largest ispe (a grid image 8064 x 6048 next to its 512 x 512 tiles)
  const heic = [0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0, ...ascii("mif1heic"),
    0, 0, 0, 20, ...ascii("ispe"), 0, 0, 0, 0, ...be32(512), ...be32(512), 0, 0, 0, 20, ...ascii("ispe"), 0, 0, 0, 0, ...be32(8064), ...be32(6048)];
  assert.deepEqual(T.imageSize(bytes(heic, 120)), { width: 8064, height: 6048, type: "image/heic" });
  assert.ok(8064 * 6048 < T.MAX_PIXELS, "an iPhone's 48 MP photo is fine");
  assert.equal(T.imageSize(bytes(ascii("<svg xmlns='http://www.w3.org/2000/svg'>"), 64)), null);
  assert.equal(T.imageSize(new Uint8Array(4)), null);
});

test("thumb-prep: a JPEG with more than 256 KiB of metadata before its frame header, and a HEIC whose meta box comes after its image data, still say their size", async () => {
  const fileOf = (u8, name, type) => { const b = new Blob([u8], { type }); return { name, type, size: b.size, slice: (x, y) => b.slice(x, y) }; };
  const jpeg = (w, h) => {
    // SOI, five APP2 segments of 65,535 bytes (a large ICC profile / extended XMP: 320 KiB), then SOF0
    const app = 65535 + 2, n = 5;
    const u8 = new Uint8Array(2 + n * app + 10 + 16);
    u8.set([0xff, 0xd8]);
    for (let k = 0; k < n; k++) u8.set([0xff, 0xe2, 0xff, 0xff], 2 + k * app);
    u8.set([0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0x03], 2 + n * app);
    return u8;
  };
  const deep = jpeg(4032, 3024);
  assert.ok(deep.length - 26 > T.HEAD_BYTES, "the frame header lies past the first 256 KiB");
  assert.equal(T.imageSize(deep.subarray(0, T.HEAD_BYTES)), null, "the first bytes alone do not say");
  assert.deepEqual(await T.sizeOf(fileOf(deep, "IMG_1.jpg", "image/jpeg")), { width: 4032, height: 3024, type: "image/jpeg" });
  // prepare goes on to decoding (node cannot decode: "could not be opened"), never "not a picture"
  await assert.rejects(T.prepare(fileOf(deep, "IMG_1.jpg", "image/jpeg")), /could not be opened/);
  await assert.rejects(T.prepare(fileOf(jpeg(10000, 7000), "big.jpg", "image/jpeg")), /60 megapixels/, "refused before decoding, however deep");
  // fill bytes before a marker, past the first bytes
  const fills = new Uint8Array(deep.length + 3);
  fills.set(deep.subarray(0, deep.length - 26));
  fills.set([0xff, 0xff, 0xff], deep.length - 26);
  fills.set(deep.subarray(deep.length - 26), deep.length - 23);
  assert.deepEqual(await T.sizeOf(fileOf(fills, "f.jpg", "image/jpeg")), { width: 4032, height: 3024, type: "image/jpeg" });
  // the image data before any frame header: no size, however far it is walked
  const sos = deep.slice();
  sos.set([0xff, 0xda], deep.length - 26);
  assert.equal(await T.sizeOf(fileOf(sos, "s.jpg", "image/jpeg")), null);
  // HEIC: ftyp, a 300 KiB mdat (the image data first), then the meta box with its ispe
  const ftyp = [0, 0, 0, 24, ...ascii("ftyp"), ...ascii("heic"), 0, 0, 0, 0, ...ascii("mif1heic")];
  const mdatLen = 300 * 1024;
  const ispe = [0, 0, 0, 20, ...ascii("ispe"), 0, 0, 0, 0, ...be32(8064), ...be32(6048)];
  const meta = [...be32(12 + ispe.length), ...ascii("meta"), 0, 0, 0, 0, ...ispe];
  const heic = new Uint8Array(ftyp.length + mdatLen + meta.length);
  heic.set(ftyp);
  heic.set([...be32(mdatLen), ...ascii("mdat")], ftyp.length);
  heic.set(meta, ftyp.length + mdatLen);
  assert.equal(T.imageSize(heic.subarray(0, T.HEAD_BYTES)), null);
  assert.deepEqual(await T.sizeOf(fileOf(heic, "IMG_2.heic", "image/heic")), { width: 8064, height: 6048, type: "image/heic" });
  // a small file read whole: nothing further to walk
  assert.equal(await T.sizeOf(fileOf(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, ...new Array(20).fill(0)]), "t.jpg", "image/jpeg")), null);
});

test("thumb-prep: at most 800 px, never enlarged; never SVG; PNG only for transparency", () => {
  assert.deepEqual(T.fitSize(4032, 3024), { width: 800, height: 600 });
  assert.deepEqual(T.fitSize(3024, 4032), { width: 600, height: 800 });
  assert.deepEqual(T.fitSize(640, 480), { width: 640, height: 480 });
  assert.deepEqual(T.fitSize(10000, 10), { width: 800, height: 1 });
  assert.ok(T.looksLikeSvg('﻿  <?xml version="1.0"?><svg>'));
  assert.ok(T.looksLikeSvg("<svg onload=x>"));
  assert.ok(T.looksLikeSvg("<!DOCTYPE svg PUBLIC>"));
  assert.ok(!T.looksLikeSvg("\u0089PNG"));
  assert.deepEqual(T.outputFor("image/png", true), { mime: "image/png", ext: ".png" });
  assert.deepEqual(T.outputFor("image/png", false), { mime: "image/jpeg", ext: ".jpg" });
  assert.deepEqual(T.outputFor("image/jpeg", true), { mime: "image/jpeg", ext: ".jpg" }, "a JPEG has no transparency");
  assert.deepEqual(T.outputFor("image/heic", false), { mime: "image/jpeg", ext: ".jpg" });
  assert.deepEqual([T.MAX_SIDE, T.MAX_BYTES, T.MAX_PIXELS, T.JPEG_QUALITY], [800, 40 * 1024 * 1024, 60e6, 0.85], "Desktop 2's thumbnails.py");
});

test("thumb-prep: prepare refuses before decoding — empty, over 40 MB, SVG by type, name or content, not a picture, over 60 megapixels", async () => {
  // a File's shape (name, type, size, slice) over a Blob; size may claim more than the bytes
  const file = (parts, name, type, size) => {
    const b = new Blob(parts, { type });
    return { name, type, size: size || b.size, slice: (x, y) => b.slice(x, y) };
  };
  await assert.rejects(T.prepare(file([], "a.jpg", "image/jpeg")), /empty/);
  await assert.rejects(T.prepare(file(["x"], "big.jpg", "image/jpeg", 41 * 1024 * 1024)), /40 MB/);
  await assert.rejects(T.prepare(file(["<svg></svg>"], "x.svg", "image/svg+xml")), /SVG/);
  await assert.rejects(T.prepare(file(["<svg></svg>"], "photo.jpg", "image/jpeg")), /SVG/, "sniffed");
  await assert.rejects(T.prepare(file(["just text, not a picture at all"], "a.jpg", "image/jpeg")), /not a picture/);
  const huge = new Uint8Array(40);
  huge.set([0x89, ...ascii("PNG"), 13, 10, 26, 10, 0, 0, 0, 13, ...ascii("IHDR"), ...be32(20000), ...be32(20000)]);
  await assert.rejects(T.prepare(file([huge], "huge.png", "image/png")), /60 megapixels/);
});

/* ── the Takeoffs tab ── */
test("Takeoffs: the Plans Archive link carries the project number (encoded), or opens the archive itself", () => {
  assert.equal(plansLink("A249"), TAKEOFF_WEB + "#plans=A249");
  assert.equal(plansLink("A024 B&C"), TAKEOFF_WEB + "#plans=A024%20B%26C");
  assert.equal(plansLink(""), TAKEOFF_WEB + "#plans");
  assert.equal(plansLink(null), TAKEOFF_WEB + "#plans");
  assert.equal(TAKEOFF_WEB, "https://barajas545.github.io/takeoff-web/index.html");
});
