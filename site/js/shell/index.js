/* The sign-in page (BLUEPRINT 2.2.4): Supabase sign-in with the DCR Desktop 2 account,
   "Keep me signed in on this device", ?next= (only a bare page of this site), the temporary-password
   page, "This account is not active", and network errors that never sign anyone out.
   One attempt per press: Supabase allows 30 sign-ins per 5 minutes per address, and the office PCs
   share the same address. */
import { signIn, session, me, signOut, isNetworkError } from "../sb.js";
import { safeNext, scrubbedSearch, errorText, company, companyInfo } from "../common2.js";
import "../install.js";

const $ = (id) => document.getElementById(id);

function rawNext() {
  const m = /[?&]next=([^&]+)/.exec(location.search);
  return m ? m[1] : "";
}
const next = safeNext(rawNext());
const nextAfterPassword = (p) => (p && p.must_change_password
  ? "change-password.html?next=" + encodeURIComponent(next)
  : next);

function showError(text) {
  const err = $("err");
  err.textContent = text || "";
  err.classList.toggle("show", !!text);
}

function paintBrand() {
  $("companyName").textContent = company + " Portal";
  if (companyInfo.logo) $("companyLogo").src = companyInfo.logo;
  if (/^my-tasks\.html/.test(next)) {
    $("subtitle").textContent = "Sign in to see your tasks and send an update.";
    $("noAccount").hidden = false;
  }
  if (/[?&]inactive=1/.test(location.search)) showError("This account is not active. Ask the office.");
}

/* Already signed in on this device: straight on (replace, so this page is no back-target).
   Only a real "signed out" answer keeps them here; a connection problem keeps the stored sign-in. */
async function alreadyIn() {
  let s;
  try { s = await session(); } catch (e) { return; }
  if (!s) return;
  let p;
  try { p = await me(); } catch (e) {
    if (!isNetworkError(e)) showError(errorText(e));
    return;
  }
  if (!p || !p.active || p.role === "agents") {
    await signOut();
    showError("This account is not active. Ask the office.");
    return;
  }
  location.replace(nextAfterPassword(p));
}

async function submit(e) {
  e.preventDefault();
  const btn = $("submitBtn");
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { showError("Enter your e-mail address and your password."); return; }
  showError("");
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const p = await signIn(email, password, $("remember").checked);
    location.replace(nextAfterPassword(p));
  } catch (ex) {
    showError(errorText(ex));
    btn.disabled = false;
    btn.textContent = "Sign In";
    $("password").select();
  }
}

/* A sign-in typed before this script took over (an older page, a browser that submitted the form
   itself) must not stay in the address bar or the history: only ?next= and ?inactive= are kept. */
function scrubAddress() {
  const clean = scrubbedSearch(location.search);
  if (clean === location.search) return;
  try { history.replaceState(history.state, "", location.pathname + clean + location.hash); } catch (e) { /* not important */ }
}

function start() {
  scrubAddress();
  paintBrand();
  $("loginForm").addEventListener("submit", submit);
  // the form ships disabled (index.html): only now can Enter or Sign In do anything
  $("loginFields").disabled = false;
  $("authLoading").hidden = true;
  alreadyIn();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
