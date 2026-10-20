/* Project tab Mailing (MODULES §3 "Mailing"): mailto: drafts (quote, follow-up, blank) that open in
   the person's own mail app, and a contact search (rpc search, the contacts list). The old "E-mail
   notes" field is not carried (Q23). Nothing is sent from here. */

import { searchContacts } from "../repo/search.js";

function company() {
  const c = (typeof window !== "undefined" && window.DCR2_CONFIG) || {};
  return (c.COMPANY && c.COMPANY.name) || c.COMPANY_NAME || "DCR Framing";
}

export function mailto(to, subject, body) {
  return "mailto:" + encodeURIComponent(to || "") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body);
}

export function drafts(p, co) {
  const full = (p.internalIDNumber ? p.internalIDNumber + " — " : "") + (p.projectName || "");
  const addr = [p.projectAddress, p.projectCity].filter(Boolean).join(", ");
  const hello = "Hello " + (p.projectClientName || "") + ",\n\n";
  const what = (p.projectName || "the project") + (addr ? " at " + addr : "");
  const sign = "\n\nBest regards,\n" + co;
  return {
    quote: mailto(p.projectEmailAddress, "Estimate — " + full,
      hello + "Please find attached our estimate for " + what + ".\n\nLet us know if you have any questions." + sign),
    follow: mailto(p.projectEmailAddress, "Following up — " + full,
      hello + "Just following up on the estimate we sent for " + what + ". We'd be happy to answer any questions." + sign),
    blank: mailto(p.projectEmailAddress, full, ""),
  };
}

export function render(ctx, host) {
  const p = ctx.project, esc = ctx.esc;
  const d = drafts(p, company());
  host.innerHTML =
    '<div class="pj-sec"><h3>Client</h3><div class="pj-client">' +
      "<b>" + esc(p.projectClientName || "—") + "</b><br>" +
      (p.projectEmailAddress ? '<a href="mailto:' + esc(p.projectEmailAddress) + '">' + esc(p.projectEmailAddress) + "</a><br>" : "") +
      (p.projectPhoneNumber ? '<a href="tel:' + esc(String(p.projectPhoneNumber).replace(/[^\d+]/g, "")) + '">' + esc(p.projectPhoneNumber) + "</a>" : "") +
    "</div>" +
    '<div class="pj-links" style="margin-top:10px">' +
      '<a class="pj-btn pj-btn-sm" href="' + esc(d.quote) + '">✉️ Quote email</a>' +
      '<a class="pj-btn pj-btn-sm" href="' + esc(d.follow) + '">✉️ Follow-up email</a>' +
      '<a class="pj-btn pj-btn-sm" href="' + esc(d.blank) + '">✉️ Blank email</a></div>' +
    '<div class="pj-sub" style="margin-top:8px">The draft opens in your own mail app; attach the estimate there.' +
      (p.projectEmailAddress ? "" : " This project has no client e-mail yet.") + "</div></div>" +
    '<div class="pj-sec"><h3>Find a contact</h3><input class="pj-search" id="ctSearch" type="search" placeholder="Search contacts (name, company, trade, phone)…" autocomplete="off">' +
      '<div id="ctResults" style="margin-top:10px"></div></div>';

  let timer = null, seq = 0;
  host.querySelector("#ctSearch").addEventListener("input", function () {
    const q = this.value.trim();
    clearTimeout(timer);
    const out = host.querySelector("#ctResults");
    if (q.length < 2) { out.innerHTML = ""; return; }
    timer = setTimeout(async function () {
      const my = ++seq;
      out.innerHTML = '<span class="pj-sub">Searching…</span>';
      try {
        const list = await searchContacts(q);
        if (my !== seq) return;
        out.innerHTML = list.length ? '<div class="pj-tblwrap"><table class="pj-tbl"><tbody>' + list.slice(0, 12).map(function (c) {
          const trades = Array.isArray(c.trades) && c.trades.length ? c.trades.map(function (t) { return t.name; }).join(", ") : (c.trade || "");
          return "<tr><td><b>" + esc(c.name || "") + '</b><br><span class="pj-sub">' + esc([c.company, trades, c.city].filter(Boolean).join(" · ")) + "</span></td>" +
            "<td>" + (c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "") +
            '<br><span class="pj-sub">' + (c.phone ? '<a href="tel:' + esc(String(c.phone).replace(/[^\d+]/g, "")) + '">' + esc(c.phone) + "</a>" : "") + "</span></td></tr>";
        }).join("") + "</tbody></table></div>" : '<span class="pj-sub">No matches.</span>';
      } catch (e) {
        if (my !== seq) return;
        out.innerHTML = '<span class="pj-sub">' + esc(ctx.errorText(e)) + "</span>";
      }
    }, 300);
  });
}
