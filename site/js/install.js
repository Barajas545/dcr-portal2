/* "Install app" hint (ported from the old install.js). Shows a button ONLY when Portal 2 can be
   installed and is not already: Chrome / Edge / Android run the browser's own install prompt; iOS
   Safari (no install API) gets the Add-to-Home-Screen steps. Mounts into #installSlot when the page
   has one. Phones install Portal 2 again: it is a different app from the old portal.

   import "./install.js" from a page module (the sign-in page and the home page do). */

const standalone = typeof window !== "undefined" &&
  ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true);

let deferred = null;
let btnEl = null;
let toastEl = null;

function isIOS() {
  const ua = navigator.userAgent || "";
  return /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function show() {
  if (!btnEl) {
    btnEl = document.createElement("button");
    btnEl.type = "button";
    btnEl.id = "dcr2InstallBtn";
    btnEl.className = "btn btn-ghost btn-sm";
    btnEl.textContent = "📲 Install Portal 2";
    btnEl.title = "Install Portal 2 as an app on this device";
    btnEl.addEventListener("click", onClick);
    const slot = document.getElementById("installSlot");
    if (slot) slot.appendChild(btnEl);
    else {
      btnEl.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;box-shadow:0 3px 14px rgba(0,0,0,.28);";
      document.body.appendChild(btnEl);
    }
  }
  btnEl.style.display = "inline-flex";
}

function onClick() {
  if (deferred) {
    deferred.prompt();
    deferred.userChoice.then(() => { deferred = null; if (btnEl) btnEl.style.display = "none"; });
  } else if (isIOS()) {
    hint("To install: tap the Share button (the square with an arrow) at the bottom of Safari, then choose “Add to Home Screen.”");
  } else {
    hint("Open your browser menu and choose “Install app” or “Add to Home screen.”");
  }
}

function hint(text) {
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.style.cssText = "position:fixed;left:50%;bottom:20px;transform:translateX(-50%);max-width:330px;" +
      "background:#171d25;color:#e6ebf1;border:1px solid #2a333d;border-radius:12px;padding:12px 15px;" +
      "font-size:13px;line-height:1.5;box-shadow:0 6px 24px rgba(0,0,0,.45);z-index:10000;cursor:pointer;text-align:center;";
    toastEl.addEventListener("click", () => { toastEl.style.display = "none"; });
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.style.display = "block";
  clearTimeout(toastEl._t);
  toastEl._t = setTimeout(() => { toastEl.style.display = "none"; }, 9000);
}

if (typeof window !== "undefined" && !standalone) {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    if (document.readyState !== "loading") show();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    if (btnEl) btnEl.style.display = "none";
  });
  const ready = () => { if (deferred || isIOS()) show(); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
}

export const installed = standalone;
