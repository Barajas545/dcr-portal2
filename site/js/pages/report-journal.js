/* The daily report off the project journal (port of the old report-journal.html / .js;
   MODULES §3 "report-journal.html").

   What went on at the site in the chosen day (or range), in the order it happened, with the
   pictures (signed URLs of the journal photos' small previews, else the photos). Print it to PDF
   ("Save as PDF") and send it on: "Email this report" opens a draft in the person's own mail app,
   written and ready for the PDF to be attached — the portal sends no mail itself. */

import { boot, el, esc, errorText, maskFor, qs, D } from "./shell.js";
import * as projectsRepo from "../repo/projects.js";
import * as journalRepo from "../repo/journal.js";
import * as filesRepo from "../repo/files.js";
import { ymd, longDay } from "../map/pacific.js";
import { SIGNED_GALLERY_S } from "../map/files.js";

const state = { project: null, rows: [], urls: {}, mask: function (t) { return t; } };

function co() {
  const c = (D().companyInfo) || ((window.DCR2_CONFIG || {}).COMPANY) || {};
  return Object.assign({ name: "DCR", legalName: "", logo: "icons/logo.jpg", address: "", phone: "", fax: "", license: "" }, c);
}

function coBlock() {
  const c = co();
  const lines = ["<b>" + esc(c.legalName || c.name) + "</b>"];
  if (c.address) lines.push(esc(c.address));
  const pf = [c.phone ? "Ph " + c.phone : "", c.fax ? "Fax " + c.fax : ""].filter(Boolean).join(" · ");
  if (pf) lines.push(esc(pf));
  if (c.license) lines.push(esc(c.license));
  return lines.join("<br>");
}

function inRange(r, from, to) { const d = r.journalDate; return d && d >= from && d <= to; }

function entryHtml(r) {
  const m = state.mask;
  const pics = r.media.map(function (x) {
    const path = x.previewPath || (!x.video ? x.storagePath : null);
    const u = path ? state.urls[path] : null;
    return '<figure class="dr-pic">' + (u ? '<img src="' + esc(u) + '" alt="">' : '<div class="dr-noimg">' + (x.storage === "local" ? "on the office computers" : x.video ? "video" : "") + "</div>") +
      (x.desc ? "<figcaption>" + esc(m(x.desc)) + "</figcaption>" : "") + "</figure>";
  }).join("");
  const facts = [];
  if (r.journalWeather) facts.push(esc(r.journalWeather));
  if (r.journalCrewSize) facts.push(r.journalCrewSize + " on site");
  if (r.journalHours) facts.push(r.journalHours + " hours");
  return '<div class="dr-e"><div class="dr-e-top">' +
      '<span class="dr-cat">' + esc(r.journalCategory) + "</span>" +
      (r.journalFollowUp ? '<span class="dr-cat dr-flag">Follow up</span>' : "") +
      '<span class="dr-who">' + esc(r.journalAuthor || "") + "</span></div>" +
    (r.title ? '<div class="dr-h">' + esc(m(r.title)) + "</div>" : "") +
    (r.journalEntry ? '<div class="dr-body">' + esc(m(r.journalEntry)) + "</div>" : "") +
    (facts.length ? '<div class="dr-facts">' + facts.join(" &middot; ") + "</div>" : "") +
    (pics ? '<div class="dr-pics">' + pics + "</div>" : "") + "</div>";
}

function render(from, to) {
  const p = state.project || {};
  const rows = state.rows.filter(function (r) { return inRange(r, from, to); })
    .sort(function (a, b) { return String(a.journalDate).localeCompare(String(b.journalDate)) || Number(a.id) - Number(b.id); });
  document.title = "DCR Daily Report — " + (p.internalIDNumber || "") + " " + from;
  const byDay = {};
  rows.forEach(function (r) { (byDay[r.journalDate] = byDay[r.journalDate] || []).push(r); });
  const days = Object.keys(byDay).sort();
  let crew = 0, hrs = 0, pics = 0, flags = 0;
  rows.forEach(function (r) {
    crew = Math.max(crew, Number(r.journalCrewSize) || 0);
    hrs += Number(r.journalHours) || 0;
    pics += r.media.length;
    if (r.journalFollowUp) flags++;
  });
  const c = co();
  el("rpSheet").innerHTML =
    '<div class="dr-top"><div class="dr-topl"><div class="dr-h1">Daily Report</div>' +
      '<div class="dr-meta"><b>Project:</b> ' + esc("#" + (p.internalIDNumber || "") + (p.projectName ? " - " + p.projectName : "")) + "<br>" +
        "<b>Address:</b> " + esc([p.projectAddress, p.projectCity].filter(Boolean).join(" - ") || "—") + "<br>" +
        "<b>" + (from === to ? "Date:" : "Dates:") + "</b> " + esc(from === to ? longDay(from) : longDay(from) + "  —  " + longDay(to)) +
      "</div></div>" +
      '<div class="dr-logo"><div class="dr-co">' + coBlock() + "</div>" + (c.logo ? '<img src="' + esc(c.logo) + '" alt="' + esc(c.name) + '">' : "") + "</div></div>" +
    (rows.length
      ? '<div class="dr-sum"><div><span>Entries</span><b>' + rows.length + "</b></div>" +
          "<div><span>Most on site</span><b>" + (crew || "—") + "</b></div>" +
          "<div><span>Hours</span><b>" + (hrs ? Math.round(hrs * 100) / 100 : "—") + "</b></div>" +
          "<div><span>Photos</span><b>" + (pics || "—") + "</b></div>" +
          "<div><span>Needs follow-up</span><b>" + (flags || "—") + "</b></div></div>" +
        days.map(function (d) {
          return (days.length > 1 ? '<div class="dr-day">' + esc(longDay(d)) + "</div>" : "") + byDay[d].map(entryHtml).join("");
        }).join("")
      : '<div class="dr-none">Nothing was written in the journal for ' + esc(from === to ? longDay(from) : "this range") + ".</div>") +
    '<div class="foot"><span>' + esc(c.name) + " &middot; generated " + esc(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })) + "</span>" +
      "<span>" + esc((p.internalIDNumber || "") + " — " + (p.projectName || "")) + "</span></div>";
}

export function mailBody(p, rows, from, to, company) {
  const subj = "Daily report — " + (p.internalIDNumber || "") + (p.projectName ? " " + p.projectName : "") + " — " + longDay(from);
  const lines = ["", p.projectClientName ? p.projectClientName + "," : "Hello,", "",
    "Here is the daily report for " + (p.internalIDNumber || "") + (p.projectName ? " - " + p.projectName : "") + ".", ""];
  if (from !== to) lines.push("Covering " + longDay(from) + " through " + longDay(to), "");
  rows.slice().sort(function (a, b) { return String(a.journalDate).localeCompare(String(b.journalDate)); }).forEach(function (r) {
    const caps = r.media.map(function (m) { return m.desc; }).filter(Boolean);
    const what = r.title || (String(r.journalEntry || "").split("\n")[0] || "").slice(0, 70) || caps[0] ||
      (r.media.length ? r.media.length + " photo" + (r.media.length === 1 ? "" : "s") : "(no detail)");
    lines.push("• [" + r.journalCategory + "] " + what);
  });
  if (!rows.length) lines.push("(no entries for this day)");
  lines.push("", "The full report with photos is attached as a PDF.", "", company.name || "", company.phone || "");
  return { subject: subj, body: lines.join("\r\n") };
}

function mailIt(from, to) {
  const p = state.project || {};
  const rows = state.rows.filter(function (r) { return inRange(r, from, to); }).map(function (r) {
    // everything typed goes through the mask: the headline, the write-up and the captions (the mail
    // draft falls back to the first caption when an entry has no text)
    return Object.assign({}, r, { title: state.mask(r.title), journalEntry: state.mask(r.journalEntry),
      media: (r.media || []).map(function (x) { return Object.assign({}, x, { desc: state.mask(x.desc) }); }) });
  });
  const m = mailBody(p, rows, from, to, co());
  const a = document.createElement("a");
  a.href = "mailto:?subject=" + encodeURIComponent(m.subject) + "&body=" + encodeURIComponent(m.body);
  a.hidden = true;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { a.remove(); }, 0);
}

async function signPictures(from, to) {
  const paths = [];
  state.rows.filter(function (r) { return inRange(r, from, to); }).forEach(function (r) {
    r.media.forEach(function (x) {
      const p = x.previewPath || (!x.video ? x.storagePath : null);
      if (p && x.storage !== "local" && !state.urls[p]) paths.push(p);
    });
  });
  if (!paths.length) return false;
  try {
    const u = await filesRepo.signedUrls(paths, SIGNED_GALLERY_S);
    Object.keys(u).forEach(function (k) { state.urls[k] = u[k]; });
    return true;
  } catch (e) { return false; }
}

async function show(from, to) {
  render(from, to);
  if (await signPictures(from, to)) render(from, to);       // pictures after the text
}

async function init() {
  const me = await boot(null);
  state.mask = maskFor(me);
  const pid = qs("id");
  el("rpPrint").addEventListener("click", function () { window.print(); });
  if (!pid || !/^\d{1,18}$/.test(pid)) { el("rpSheet").innerHTML = '<div class="rp-loading">No project selected.</div>'; return; }
  el("rpBack").href = "project.html?id=" + encodeURIComponent(pid) + "&tab=journal";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(qs("from") || "") ? qs("from") : ymd(new Date());
  const to = /^\d{4}-\d{2}-\d{2}$/.test(qs("to") || "") ? qs("to") : from;
  el("rpDay").value = from;
  el("rpTo").value = to;
  try {
    const res = await Promise.all([projectsRepo.getProject(pid), journalRepo.list(pid)]);
    state.project = res[0];
    state.rows = res[1];
  } catch (e) {
    el("rpSheet").innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
    return;
  }
  show(from, to);
  el("rpApply").addEventListener("click", function () {
    const f = el("rpDay").value || ymd(new Date());
    let t = el("rpTo").value || f;
    if (t < f) { t = f; el("rpTo").value = t; }
    show(f, t);
  });
  el("rpMail").addEventListener("click", function () {
    const f = el("rpDay").value || ymd(new Date());
    mailIt(f, el("rpTo").value || f);
  });
}

init().catch(function (e) {
  if (e && /not signed in|not for this role/.test(e.message || "")) return;
  const s = document.getElementById("rpSheet");
  if (s) s.innerHTML = '<div class="rp-loading">' + esc(errorText(e)) + "</div>";
});
