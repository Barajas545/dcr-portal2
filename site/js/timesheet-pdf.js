/* Timesheet -> PDF in the DCR Framing paper form (port of the old timesheet-pdf.js; MODULES §4).

   The person picks one day or the whole Saturday-to-Friday week (any week, not only the last two)
   and whose hours to send (the employees in their scope); each employee gets one PDF with one page
   per day and job. Phones hand the files to the share sheet (e-mail, text…); desks download them.

   jsPDF 2.5.2 and jsPDF-AutoTable 3.8.4 load from jsDelivr on first use, at those exact versions,
   with their integrity hashes; each page that offers the button names the two files in its
   Content-Security-Policy (script-src). Nothing is uploaded anywhere: the rows are the ones the
   database already lets this person read.

   openPdf({ctx, anchor, employeeId}) shows the chooser; renderSheet / renderToBlob are the drawing
   (the tests drive them with a stand-in document). */

import { pdfSheets, pdfFileName, pdfBody, longDate, personLabel } from "./map/timesheets.js";
import { saturdayOfYmd, addDays } from "./map/pacific.js";

export const LIBS = Object.freeze([
  Object.freeze({ src: "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
    integrity: "sha384-en/ztfPSRkGfME4KIm05joYXynqzUgbsG5nMrj/xEFAHXkeZfO3yMK8QQ+mP7p1/" }),
  Object.freeze({ src: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
    integrity: "sha384-Xl/CUCfJbzsngMp0CFxkmF0VW/8C160IsGujqeQlIhaGxKz2+JsIGORFqtCPeldF" }),
]);

const BLUE = [37, 99, 175];     // the form's blue for filled-in values
const BLACK = [20, 20, 20];
const LINE = [140, 140, 140];

let libPromise = null;

function loadScript(lib) {
  return new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = lib.src;
    s.integrity = lib.integrity;
    s.crossOrigin = "anonymous";
    s.addEventListener("load", resolve);
    s.addEventListener("error", function () { reject(new Error("Could not load the PDF tool. Check the internet connection.")); });
    document.head.appendChild(s);
  });
}

/** jsPDF, then its table plugin (which needs jsPDF loaded first). */
export function loadLibs() {
  if (globalThis.jspdf && globalThis.jspdf.jsPDF && globalThis.jspdf.jsPDF.API && globalThis.jspdf.jsPDF.API.autoTable) return Promise.resolve();
  if (!libPromise) {
    libPromise = loadScript(LIBS[0]).then(function () { return loadScript(LIBS[1]); })
      .catch(function (e) { libPromise = null; throw e; });
  }
  return libPromise;
}

/** One page of the form on `doc` (a jsPDF document with autoTable). */
export function renderSheet(doc, sheet, company) {
  const M = 40;
  let y = M + 6;
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
  doc.text(String(company || "DCR").toUpperCase() + " TIMESHEET", M, y);
  y += 34;
  function labelValue(label, value) {
    doc.setFont("helvetica", "normal"); doc.setFontSize(12); doc.setTextColor(BLACK[0], BLACK[1], BLACK[2]);
    doc.text(label, M, y);
    doc.setFont("helvetica", "bold"); doc.setTextColor(BLUE[0], BLUE[1], BLUE[2]);
    doc.text(value || "", M + doc.getTextWidth(label) + 8, y);
    y += 22;
  }
  labelValue("Job Name / Nombre del trabajo:", sheet.job || "—");
  labelValue("Today's date / Fecha:", longDate(sheet.dateKey));
  y += 4;
  const b = pdfBody(sheet);
  const body = b.body.slice();
  body.push([{ content: "Work Completed / trabajo completado:", colSpan: 4, styles: { fontStyle: "bold", textColor: BLACK, halign: "left" } }]);
  body.push([{ content: b.workText, colSpan: 4, styles: { textColor: BLUE, minCellHeight: 86, valign: "top", halign: "left" } }]);
  body.push([{ content: "TOTAL DIARIO", colSpan: 3, styles: { fontStyle: "bold", textColor: BLACK } },
    { content: b.total ? String(b.total) : "", styles: { fontStyle: "bold", textColor: BLUE, halign: "center" } }]);
  doc.autoTable({
    startY: y,
    head: [["Nombre", "Hora de Inicio", "Hora de finalización", "Horas trabajadas"]],
    body: body,
    theme: "grid",
    styles: { fontSize: 11, cellPadding: 5, lineColor: LINE, lineWidth: 0.7, textColor: BLUE, overflow: "linebreak" },
    headStyles: { fillColor: [255, 255, 255], textColor: BLACK, fontStyle: "normal", lineColor: LINE, lineWidth: 0.7, halign: "left" },
    bodyStyles: { minCellHeight: 24 },
    columnStyles: { 1: { halign: "center" }, 2: { halign: "center" }, 3: { halign: "center" } },
    margin: { left: M, right: M },
  });
}

/** Sheets -> a PDF Blob (jsPDF must be loaded). makeDoc is for the tests. */
export function renderToBlob(sheets, company, makeDoc) {
  const doc = makeDoc ? makeDoc() : new globalThis.jspdf.jsPDF({ unit: "pt", format: "letter" });
  sheets.forEach(function (sheet, i) { if (i > 0) doc.addPage(); renderSheet(doc, sheet, company); });
  return doc.output("blob");
}

/** One employee's file, or null when they have no hours in that day / week. */
export function buildEmployeeFile(entries, employee, mode, anchor, company, makeDoc) {
  const mine = (entries || []).filter(function (e) { return String(e.employeeId) === String(employee.id); });
  const sheets = pdfSheets(mine, mode, anchor);
  if (!sheets.length) return null;
  return { blob: renderToBlob(sheets, company, makeDoc), name: pdfFileName(employee.full_name || employee.name, mode, anchor), employee: employee, pages: sheets.length };
}

/** The share sheet when the device can share files, else one download each (staggered). */
async function deliver(built) {
  const files = built.map(function (b) { return new File([b.blob], b.name, { type: "application/pdf" }); });
  if (files.length && navigator.canShare && navigator.canShare({ files: files })) {
    try { await navigator.share({ files: files, title: files.length > 1 ? "Timesheets" : "Timesheet" }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  files.forEach(function (file, i) {
    setTimeout(function () {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, i * 400);
  });
  return "downloaded";
}

function escHtml(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/** The chooser. opts: {ctx (pages/ts-shared context), anchor ("YYYY-MM-DD"), employeeId (preselect),
    list(from, to, {employeeIds}) -> entries, company}. */
export function openPdf(opts) {
  const o = opts || {};
  const ctx = o.ctx;
  const preset = o.employeeId != null ? String(o.employeeId) : ctx && ctx.mine ? String(ctx.mine.id) : "";
  const people = (ctx && ctx.roster || []).filter(function (r) { return r && r.active !== false; });
  // the employee the page is on stays sendable when they have left (their final week)
  if (preset && !people.some(function (r) { return String(r.id) === preset; })) {
    const one = ctx && typeof ctx.byId === "function" ? ctx.byId(preset) : null;
    if (one) people.push(one);
  }
  const ov = document.createElement("div");
  ov.className = "tp-overlay";
  ov.innerHTML =
    '<div class="tp-box" role="dialog" aria-modal="true" aria-labelledby="tpTitle">' +
    '<h3 id="tpTitle">📄 Send timesheet as PDF</h3>' +
    '<p class="tp-sub">Creates a PDF in the DCR form and opens your share options (e-mail, text…).</p>' +
    '<label class="tp-l">What to send</label>' +
    '<div class="tp-scope" id="tpScope">' +
      '<button type="button" data-scope="day" class="btn btn-sm">Just this day</button>' +
      '<button type="button" data-scope="week" class="btn btn-ghost btn-sm">The whole week</button>' +
    "</div>" +
    '<label class="tp-l" for="tpDate" id="tpDateLabel">Date</label>' +
    '<input id="tpDate" type="date" class="tp-in" value="' + escHtml(o.anchor || "") + '">' +
    '<div id="tpNote" class="tp-note" hidden>The whole Saturday–Friday week that contains this date.</div>' +
    '<div class="tp-row"><label class="tp-l" style="margin:0">Whose hours to send</label>' +
      '<button type="button" id="tpToggleAll" class="linkish" hidden>Select all</button></div>' +
    '<div id="tpEmps" class="tp-emps"></div>' +
    '<div id="tpMultiNote" class="tp-note"></div>' +
    '<div id="tpMsg" class="tp-msg" role="status"></div>' +
    '<div class="tp-acts"><button type="button" id="tpCancel" class="btn btn-ghost btn-sm">Cancel</button>' +
    '<button type="button" id="tpGo" class="btn btn-sm">📄 Generate &amp; Send</button></div></div>';
  document.body.appendChild(ov);
  const q = function (sel) { return ov.querySelector(sel); };
  let scope = "day";
  function close() { ov.remove(); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  document.addEventListener("keydown", onKey);
  ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
  q("#tpCancel").addEventListener("click", close);
  ov.querySelectorAll("#tpScope [data-scope]").forEach(function (b) {
    b.addEventListener("click", function () {
      scope = b.getAttribute("data-scope");
      ov.querySelectorAll("#tpScope [data-scope]").forEach(function (x) { x.className = x === b ? "btn btn-sm" : "btn btn-ghost btn-sm"; });
      q("#tpDateLabel").textContent = scope === "week" ? "Any date in the week" : "Date";
      q("#tpNote").hidden = scope !== "week";
    });
  });
  const box = q("#tpEmps");
  if (!people.length) {
    box.textContent = "There is nobody whose hours you can send. Ask the office to link your account to your employee record.";
    q("#tpGo").disabled = true;
  } else if (people.length === 1) {
    box.innerHTML = "<b>" + escHtml(personLabel(people[0])) + "</b>";
  } else {
    box.innerHTML = '<div class="tp-list">' + people.map(function (p) {
      return '<label class="tp-pick"><input type="checkbox" value="' + escHtml(p.id) + '"' + (String(p.id) === preset ? " checked" : "") + "> " +
        escHtml(personLabel(p)) + (p.employee_no ? ' <span class="tp-no">' + escHtml(p.employee_no) + "</span>" : "") + "</label>";
    }).join("") + "</div>";
    const toggle = q("#tpToggleAll");
    toggle.hidden = false;
    toggle.addEventListener("click", function () {
      const boxes = ov.querySelectorAll("#tpEmps input");
      const allOn = Array.prototype.every.call(boxes, function (c) { return c.checked; });
      boxes.forEach(function (c) { c.checked = !allOn; });
      multi();
    });
    box.addEventListener("change", multi);
  }
  function picked() {
    if (people.length <= 1) return people.slice();
    const ids = Array.prototype.map.call(ov.querySelectorAll("#tpEmps input:checked"), function (c) { return c.value; });
    return people.filter(function (p) { return ids.indexOf(String(p.id)) !== -1; });
  }
  function multi() {
    const n = picked().length;
    q("#tpMultiNote").textContent = n > 1 ? "You’ll get " + n + " separate PDFs — one file per employee." : "";
  }
  multi();
  function say(text, kind) { const m = q("#tpMsg"); m.textContent = text; m.className = "tp-msg" + (kind ? " " + kind : ""); }
  q("#tpGo").addEventListener("click", async function () {
    const go = q("#tpGo");
    const anchor = q("#tpDate").value;
    const who = picked();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) { say("Pick a date first.", "err"); return; }
    if (!who.length) { say("Choose at least one employee.", "err"); return; }
    go.disabled = true;
    say("Building " + (who.length > 1 ? who.length + " PDFs…" : "your PDF…"));
    try {
      const from = scope === "week" ? saturdayOfYmd(anchor) : anchor;
      const to = scope === "week" ? addDays(from, 6) : anchor;
      const [entries] = await Promise.all([o.list(from, to, { employeeIds: who.map(function (p) { return p.id; }) }), loadLibs()]);
      const built = [], skipped = [];
      who.forEach(function (p) {
        const f = buildEmployeeFile(entries, p, scope, anchor, o.company);
        if (f) built.push(f); else skipped.push(p.full_name);
      });
      if (!built.length) {
        go.disabled = false;
        say("No hours found for the selected " + (scope === "week" ? "week" : "day") + ".", "err");
        return;
      }
      const res = await deliver(built);
      if (res === "cancelled") { go.disabled = false; say(""); return; }
      const made = built.length + (built.length > 1 ? " PDFs" : " PDF");
      say((res === "shared" ? "✓ Shared " : "✓ Downloaded ") + made + (skipped.length ? " · " + skipped.length + " had no hours" : "") + ".", "ok");
      setTimeout(close, 1700);
    } catch (e) {
      go.disabled = false;
      say((e && e.message) || "Could not create the PDF.", "err");
    }
  });
  return { close: close, el: ov };
}
