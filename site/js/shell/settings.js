/* Your settings: details, phone reminders, appearance, password (ported from the old settings.js).

   Three independent things, each saving on its own: a password change and a phone number fail for
   different reasons. Details are a versioned PATCH of the person's own profiles row (name, phone,
   colour: the only columns people change themselves; Desktop 2's users.update_me). A person linked to
   an employee record also keeps its phone (where reminders are texted) and address up to date, through
   rpc update_my_contact (only those two columns of their own row: the old profile.js allow-list). */
import { sb, me, changePassword, passwordProblem, authStorage } from "../sb.js";
import { requireAuth, topbar, theme, errorText, roleLabel, logout, toast, DCR2 } from "../common2.js";
import { mountSettings } from "../push2.js";
import * as employees from "../repo/employees.js";

const $ = (id) => document.getElementById(id);
const COLORS = ["#c8371f", "#d4652f", "#b8860b", "#1f9d55", "#0f8b7d", "#2f80d8", "#7b5cd6", "#c2185b", "#6b7a8c", "#3d4a5c"];
const state = { p: null, color: "", emp: null };

function say(node, text, cls) {
  node.textContent = text || "";
  node.className = "st-msg" + (cls ? " " + cls : "");
}

function fill(p) {
  state.p = p;
  state.color = p.color || "";
  $("stName").value = p.full_name || "";
  $("stEmail").value = p.email || "";
  $("stPwUser").value = p.email || "";
  $("stRole").value = roleLabel(p.role) + (p.can_see_prices ? " · sees prices" : "") + (p.can_see_financials ? " · financials" : "");
  $("stPhone").value = p.phone || "";
  paintColors();
}

function paintColors() {
  const box = $("stColors");
  box.innerHTML = "";
  for (const c of COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.style.background = c;
    b.title = c;
    b.setAttribute("aria-label", "Colour " + c);
    b.setAttribute("aria-pressed", c.toLowerCase() === String(state.color).toLowerCase() ? "true" : "false");
    b.addEventListener("click", () => { state.color = c; paintColors(); });
    box.appendChild(b);
  }
}

async function saveDetails() {
  const msg = $("stMsg"), btn = $("stSave");
  const p = state.p;
  const patch = {};
  const name = $("stName").value.trim();
  const phone = $("stPhone").value.trim();
  if (name !== (p.full_name || "")) patch.full_name = name;
  if (phone !== (p.phone || "")) patch.phone = phone || null;
  if (state.color && state.color !== (p.color || "")) patch.color = state.color;
  if (!Object.keys(patch).length) { say(msg, "Nothing has changed.", ""); return; }
  btn.disabled = true;
  say(msg, "Saving…", "");
  try {
    const { data, error, status } = await sb().from("profiles").update(patch).eq("id", p.id).eq("version", p.version).select();
    if (error) { error.status = status; throw error; }
    if (!data || !data.length) {
      // nothing matched: changed meanwhile (another device, an admin) or not allowed
      const fresh = await me({ fresh: true });
      if (fresh && fresh.version !== p.version) {
        fill(fresh);
        say(msg, "Your details were changed somewhere else meanwhile. They are shown now; make your change again.", "err");
      } else {
        say(msg, "You don't have permission to change that.", "err");
      }
    } else {
      const fresh = await me({ fresh: true });
      fill(fresh || p);
      DCR2.profile = fresh || DCR2.profile;
      const pill = $("userPill");
      if (pill && fresh) pill.textContent = fresh.name + " · " + roleLabel(fresh.role);
      say(msg, "Saved.", "ok");
    }
  } catch (e) {
    say(msg, errorText(e), "err");
  }
  btn.disabled = false;
}

function paintTheme() {
  const now = theme.get();
  document.querySelectorAll("#stTheme button").forEach((b) => {
    b.setAttribute("aria-pressed", b.getAttribute("data-theme") === now ? "true" : "false");
  });
}

async function savePassword(e) {
  e.preventDefault();
  const msg = $("stPwMsg"), btn = $("stPwSave");
  const cur = $("stCur").value, a = $("stNew").value, b = $("stNew2").value;
  const bad = !cur ? "Enter your current password."
    : passwordProblem(a) || (a !== b ? "The two new passwords don't match." : "")
    || (a === cur ? "That is already your password. Pick a different one." : "");
  if (bad) { say(msg, bad, "err"); return; }
  btn.disabled = true;
  say(msg, "Changing…", "");
  try {
    await changePassword(a, cur);
    $("stCur").value = $("stNew").value = $("stNew2").value = "";
    say(msg, "Changed. Your other devices are signed out; use the new password there.", "ok");
    toast("Password changed.", "ok");
  } catch (ex) {
    say(msg, errorText(ex), "err");
  }
  btn.disabled = false;
}

function fillEmployee(e) {
  state.emp = e;
  $("stEmpSec").hidden = !e;
  if (!e) return;
  $("stEmpName").textContent = e.full_name + (e.employee_no ? " · " + e.employee_no : "");
  $("stEmpPhone").value = e.phone || "";
  $("stEmpAddress").value = e.address || "";
  $("stEmpText").textContent = e.phone ? (e.phone_e164 ? "Reminders are texted to " + e.phone_e164 + "." : "This is not a number DCR Agents can text: write it as (805) 555-0123.") : "";
}

async function saveEmployee() {
  const msg = $("stEmpMsg"), btn = $("stEmpSave");
  const e = state.emp;
  if (!e) return;
  const phone = $("stEmpPhone").value.trim(), address = $("stEmpAddress").value.trim();
  if (phone === (e.phone || "") && address === (e.address || "")) { say(msg, "Nothing has changed.", ""); return; }
  btn.disabled = true;
  say(msg, "Saving…", "");
  try {
    await employees.updateMyContact(phone, address);
    fillEmployee(await employees.mine(state.p.id));
    say(msg, "Saved.", "ok");
  } catch (ex) {
    say(msg, errorText(ex), "err");
  }
  btn.disabled = false;
}

async function start() {
  const p = await requireAuth();
  topbar("settings");
  fill(p);
  $("stSave").addEventListener("click", saveDetails);
  document.querySelectorAll("#stTheme button").forEach((b) => {
    b.addEventListener("click", () => { theme.set(b.getAttribute("data-theme")); paintTheme(); });
  });
  paintTheme();
  $("stPwForm").addEventListener("submit", savePassword);
  $("stKept").innerHTML = authStorage.mode() === "session"
    ? "Signed in <b>for this browser session only</b>: closing the browser signs you out."
    : "<b>Kept signed in</b> on this device until you sign out.";
  $("stSignOut").addEventListener("click", () => logout());
  mountSettings("stPushBox");             // phone reminders (P3): switch, iPhone steps, test notice
  $("stEmpSave").addEventListener("click", saveEmployee);
  // the employee record arrives with P2 (migration M2); before it the section simply stays hidden
  employees.mine(p.id).then(fillEmployee).catch(() => fillEmployee(null));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
else start();
