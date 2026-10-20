/* The change-password page: where a temporary password (profiles.must_change_password, set by the
   office in DCR Desktop 2) sends a person first (BLUEPRINT 2.2.4, Q25). The flag is a page rule,
   not a database rule. On success: rpc password_changed() clears it, the other sessions end, and
   the person goes on to the page they wanted (?next=). */
import { changePassword, passwordProblem } from "../sb.js";
import { requireAuth, safeNext, errorText, logout } from "../common2.js";

const $ = (id) => document.getElementById(id);
const m = /[?&]next=([^&]+)/.exec(location.search);
const next = safeNext(m ? m[1] : "");

function say(text) {
  $("cpErr").textContent = text || "";
  $("cpErr").classList.toggle("show", !!text);
}

async function start() {
  const p = await requireAuth({ allowMustChange: true });
  $("cpForm").hidden = false;
  $("cpWho").textContent = "Signed in as " + p.name + (p.email && p.email !== p.name ? " (" + p.email + ")" : "");
  $("cpEmail").value = p.email || "";
  if (!p.must_change_password) {
    $("cpWhy").textContent = "Change the password you sign in with.";
    $("cpCurLabel").textContent = "Current password";
  }
  $("cpOut").addEventListener("click", () => logout());
  $("cpForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const cur = $("cpCur").value, a = $("cpNew").value, b = $("cpNew2").value;
    const bad = !cur ? "Enter the password you signed in with."
      : passwordProblem(a) || (a !== b ? "The two new passwords don't match." : "")
      || (a === cur ? "That is already your password. Pick a different one." : "");
    if (bad) { say(bad); return; }
    say("");
    const btn = $("cpBtn");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await changePassword(a, cur);
      location.replace(next);
    } catch (ex) {
      say(errorText(ex));
      btn.disabled = false;
      btn.textContent = "Save my password";
    }
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
