// The Books program, release B part 2b (P5): the vendor list's words, filters and CSV (site/js/map/vendors.js) - the
// math is the database's (books_vendor_balances, books_1099: DCR Desktop 2 migration 20261030000500_books_reports), so
// this checks the shaping only: the 1099 threshold the page shows (and may override for one view), the certificate
// colours, the filters, the CSV with no amount column without the prices switch (S4), and the vendor details as
// vendor_profiles takes them (never a tax id: S12). Made-up vendors only.
import test from "node:test";
import assert from "node:assert/strict";
import * as V from "../site/js/map/vendors.js";
import { toCsv } from "../site/js/map/books.js";

const BAL = {
  vendor_contact_id: 41, vendor_key: "c41", vendor_name: "Madeup Framing Co", contact_kind: "subcontractor", bills: "3", open_bills: 2,
  billed: "5400.00", approved: "4000.00", paid: "1500.00", owed: "3900.00", past_due: "600.00", waiting_approval: "1400.00", paid_ytd: "1500.00",
  paid_last_year: "250.50", last_paid_date: "2026-10-20", last_paid_amount: "1500.00", tax_1099: true, legal_name: "Madeup Framing LLC",
  w9_received_on: "2026-02-03", w9_missing: false, insurance_expires_on: "2026-11-10", insurance_expired: false, workers_comp_expires_on: "2026-10-01",
  workers_comp_exempt: false, workers_comp_expired: true, license_number: "C-0000001", profile_version: 4,
};
const TODAY = "2026-10-29";

test("the 1099 threshold: $600 through 2025, $2,000 from 2026 (the database's default) - shown, and a typed one for this view only", () => {
  assert.equal(V.threshold1099(2024), 600);
  assert.equal(V.threshold1099(2025), 600);
  assert.equal(V.threshold1099(2026), 2000);
  assert.equal(V.threshold1099(2031), 2000);
  assert.equal(V.threshold1099(1999), null);
  assert.equal(V.threshold1099("x"), null);
  assert.equal(V.thresholdWords(2026, null), "$2,000 is the default for 2026 — confirm it with the CPA.");
  assert.equal(V.thresholdWords(2026, 2000), "$2,000 is the default for 2026 — confirm it with the CPA.");
  assert.equal(V.thresholdWords(2025, 1500), "$1,500 for this view only (the default for 2025 is $600).");
  assert.equal(V.parseThreshold(""), null);
  assert.equal(V.parseThreshold(" $1,500.00 "), 1500);
  assert.equal(V.parseThreshold("600"), 600);
  assert.ok(Number.isNaN(V.parseThreshold("-5")));
  assert.ok(Number.isNaN(V.parseThreshold("12abc")));
  assert.deepEqual(V.years1099(TODAY), [2026, 2025, 2024, 2023]);
});

test("toVendor: the database's own sums and flags, shaped (amounts as numbers, the profile's version for the save)", () => {
  const v = V.toVendor(BAL);
  assert.equal(v.key, "c41");
  assert.equal(v.contactId, 41);
  assert.ok(v.linked && v.hasMoney);
  assert.equal(v.kindLabel, "Subcontractor");
  assert.deepEqual([v.bills, v.openBills, v.billed, v.owed, v.pastDue, v.waiting, v.paidYtd, v.paidLastYear], [3, 2, 5400, 3900, 600, 1400, 1500, 250.5]);
  assert.deepEqual([v.tax1099, v.legalName, v.w9On, v.w9Missing, v.insuranceOn, v.wcOn, v.wcExpired, v.license, v.profileVersion],
    [true, "Madeup Framing LLC", "2026-02-03", false, "2026-11-10", "2026-10-01", true, "C-0000001", 4]);
  // a vendor nobody linked to a contact (a public-form bill): its name, no facts
  const n = V.toVendor({ vendor_contact_id: null, vendor_key: "nmadeup walk-in", vendor_name: "Madeup Walk-in", owed: 120, tax_1099: false, w9_missing: true, profile_version: null });
  assert.ok(!n.linked && n.contactId === null && n.profileVersion === null && n.owed === 120);
});

test("factsVendor: WITHOUT the prices switch no amount at all; the flags on the company's today, as the database words them", () => {
  const c = { id: 7, name: "Sam Madeup", company: "Madeup Supply", kind: "supplier" };
  const v = V.factsVendor(c, { contact_id: 7, tax_1099: false, insurance_expires_on: "2026-10-28", workers_comp_expires_on: null, workers_comp_exempt: true, version: 2, notes: "n" }, TODAY);
  assert.equal(v.hasMoney, false);
  for (const k of ["owed", "paid", "paidYtd", "billed", "pastDue", "lastPaidAmount"]) assert.ok(!(k in v), "no " + k);
  assert.deepEqual([v.name, v.kindLabel, v.w9Missing, v.insuranceExpired, v.wcExpired, v.wcExempt, v.profileVersion, v.notes], ["Madeup Supply", "Supplier", true, true, false, true, 2, "n"]);
  // on the day itself it is still good
  assert.equal(V.factsVendor(c, { insurance_expires_on: TODAY }, TODAY).insuranceExpired, false);
  assert.equal(V.factsVendor(c, null, TODAY).profileVersion, null);
});

test("the certificates' colours: red once run out, gold within 30 days, the year said when it is not this one", () => {
  assert.equal(V.expiry(null, TODAY), "none");
  assert.equal(V.expiry("2026-10-28", TODAY), "expired");
  assert.equal(V.expiry(TODAY, TODAY), "soon");
  assert.equal(V.expiry("2026-11-28", TODAY), "soon");
  assert.equal(V.expiry("2026-11-29", TODAY), "ok");
  const v = V.toVendor(BAL);
  assert.deepEqual(V.insuranceText(v, TODAY), { cls: "soon", text: "expires Nov 10" });
  assert.deepEqual(V.wcText(v, TODAY), { cls: "expired", text: "expired Oct 1" });
  assert.deepEqual(V.wcText(Object.assign({}, v, { wcExempt: true }), TODAY), { cls: "ok", text: "exempt" });
  assert.deepEqual(V.insuranceText(Object.assign({}, v, { insuranceOn: "2027-03-05" }), TODAY), { cls: "ok", text: "expires Mar 5, 2027" });
  assert.deepEqual(V.w9Text(v, TODAY), { cls: "ok", text: "on file Feb 3" });
  assert.deepEqual(V.w9Text(Object.assign({}, v, { w9On: "" }), TODAY), { cls: "missing", text: "missing" });
});

test("filters and counts: We owe them (amounts only), 1099, W-9 missing (linked vendors), insurance to renew; the search", () => {
  const a = V.toVendor(BAL);
  const b = V.toVendor({ vendor_contact_id: 42, vendor_key: "c42", vendor_name: "Madeup Concrete", contact_kind: "subcontractor", owed: 0, tax_1099: false,
    w9_missing: true, insurance_expires_on: "2027-06-01", workers_comp_exempt: true });
  const c = V.toVendor({ vendor_contact_id: null, vendor_key: "nmadeup walk-in", vendor_name: "Madeup Walk-in", owed: 50, w9_missing: true });
  const rows = V.sortVendors([a, b, c]);
  assert.deepEqual(rows.map((v) => v.name), ["Madeup Concrete", "Madeup Framing Co", "Madeup Walk-in"]);
  const names = (f) => V.filterVendors(rows, f, TODAY).map((v) => v.name);
  assert.deepEqual(names({ show: "owed" }), ["Madeup Framing Co", "Madeup Walk-in"]);
  assert.deepEqual(names({ show: "1099" }), ["Madeup Framing Co"]);
  assert.deepEqual(names({ show: "w9" }), ["Madeup Concrete"], "a vendor with no contact has no W-9 to keep");
  assert.deepEqual(names({ show: "coi" }), ["Madeup Framing Co"]);
  assert.deepEqual(names({ q: "llc" }), ["Madeup Framing Co"], "the W-9 name is searched");
  assert.deepEqual(names({ q: "C-0000001" }), ["Madeup Framing Co"], "the license too");
  assert.deepEqual(V.vendorCounts(rows, TODAY), { "": 3, owed: 2, 1099: 1, w9: 1, coi: 1 });
  assert.deepEqual(V.FILTERS.map((f) => f.label), ["All", "We owe them", "1099", "W-9 missing", "Insurance to renew"]);
});

test("the vendor CSV: every cell quoted, the formula guard, a BOM, CRLF - and NO amount column without the prices switch (S4)", () => {
  const evil = V.toVendor(Object.assign({}, BAL, { vendor_name: "=HYPERLINK(\"http://x.example\")", legal_name: "+cmd" }));
  const priced = toCsv([evil], V.vendorColumns(true));
  const plain = toCsv([evil], V.vendorColumns(false));
  assert.ok(priced.startsWith("﻿") && priced.endsWith("\r\n") && !/[^\r]\n/.test(priced));
  const head = (t) => t.replace(/^﻿/, "").split("\r\n")[0];
  assert.match(head(priced), /"Owed","Past Due","Waiting Approval","Paid This Year","Paid Last Year","Last Paid"/);
  assert.match(priced, /"3900\.00","600\.00","1400\.00","1500\.00","250\.50","2026-10-20"/);
  assert.ok(!/Owed|Paid|\b3900\b|1500/.test(plain), "no amount without prices: " + plain);
  assert.ok(plain.includes("\"'=HYPERLINK(\"\"http://x.example\"\")\"") && plain.includes("\"'+cmd\""), "the formula guard");
  assert.equal(head(plain), '"Vendor","Kind","Gets a 1099","Legal Name (W-9)","W-9 Received","Insurance Expires","Workers Comp","License","Portal Contact ID"');
});

test("the 1099 worksheet: a books_1099 row shaped, its CSV (card and materials apart, reportable and needs a W-9)", () => {
  const r = V.to1099({ year: 2026, vendor_contact_id: 41, vendor_key: "c41", vendor_name: "Madeup Framing Co", legal_name: null, tax_1099: true, w9_received_on: null,
    paid_check: "2400.00", paid_cash: "0", paid_transfer: "100", paid_other: "0", card_excluded: "75.25", materials_excluded: "0", reportable_total: "2500.00",
    payments: 3, threshold: "2000.00", reportable: true, needs_w9: true });
  assert.deepEqual([r.check, r.transfer, r.card, r.total, r.threshold, r.reportable, r.needsW9, r.payments], [2400, 100, 75.25, 2500, 2000, true, true, 3]);
  const csv = toCsv([r], V.COLUMNS_1099).replace(/^﻿/, "").split("\r\n");
  assert.equal(csv[0], '"Year","Vendor","Legal Name (W-9)","Gets a 1099","W-9 Received","Check","Cash","Transfer","Other","Reportable Total","Card (Excluded)","Materials (Excluded)","Threshold","Reportable","Needs W-9","Portal Contact ID"');
  assert.equal(csv[1], '"2026","Madeup Framing Co","","Yes","","2400.00","0.00","100.00","0.00","2500.00","75.25","0.00","2000.00","Yes","Yes","41"');
});

test("the vendor details as vendor_profiles takes them: dates and flags only (S12), blank -> NULL, exempt OR a date, the sizes", () => {
  assert.equal(V.profileProblem({ legalName: "x".repeat(201) }), "The legal name is at most 200 characters.");
  assert.equal(V.profileProblem({ license: "x".repeat(41) }), "The license number is at most 40 characters.");
  assert.equal(V.profileProblem({ notes: "x".repeat(1001) }), "The notes are at most 1,000 characters.");
  assert.equal(V.profileProblem({ w9On: "10/02/2026" }), "Pick the W-9 date from the calendar.");
  assert.match(V.profileProblem({ wcExempt: true, wcOn: "2026-12-01" }), /either exempt or has a date/);
  assert.equal(V.profileProblem({ tax1099: true, w9On: "2026-10-02", insuranceOn: "2027-01-01", wcExempt: true }), "");
  const body = V.profileBody({ tax1099: 1, legalName: "  Madeup   Framing LLC ", w9On: "2026-10-02", insuranceOn: "", wcOn: "2026-12-01", wcExempt: true,
    license: " ", notes: "  line one\r\nline two  " });
  assert.deepEqual(body, { tax_1099: true, legal_name: "Madeup Framing LLC", w9_received_on: "2026-10-02", insurance_expires_on: null,
    workers_comp_expires_on: null, workers_comp_exempt: true, license_number: null, notes: "line one\nline two" });
  assert.deepEqual(Object.keys(body).filter((k) => /tin|ssn|ein|tax_id|bank|account/i.test(k)), [], "never a tax id or a bank detail");
});

test("withProfiles: each vendor its own row's notes and version (for the edit sheet)", () => {
  const list = V.withProfiles([V.toVendor(BAL), V.toVendor({ vendor_contact_id: null, vendor_key: "nx", vendor_name: "X" })],
    [{ contact_id: 41, notes: "call first", version: 5 }]);
  assert.deepEqual([list[0].notes, list[0].profileVersion, list[1].notes === undefined || list[1].notes === ""], ["call first", 5, true]);
});
