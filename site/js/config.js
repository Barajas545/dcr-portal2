/* DCR Employee Portal 2: configuration. PUBLIC BY DESIGN: no secret ever goes in this file.

   SUPABASE_URL and SUPABASE_KEY are the DCR Desktop 2 project's address and its *publishable* key
   (the same pair DCR Desktop 2 ships in dcrdesk/backend/project.py). Every protection is in the
   database (row level security, triggers, functions), never in the browser. The service-role key,
   the database password and the VAPID private key never appear here (BLUEPRINT 2.1, principle 2).
   Phone reminders need no key here either: push2.js asks the push function for its public key.

   Loaded as a classic script in each page's <head>, before the page's modules. */
window.DCR2_CONFIG = Object.freeze({
  SUPABASE_URL: "https://nmjoenqkjyhngjvdealh.supabase.co",
  SUPABASE_KEY: "sb_publishable_25rroXT2P3zgJdbacWrIcg_f1tIS7oe",
  SITE_URL: "https://portal.dcrframing.com",
  COMPANY_NAME: "DCR Framing",
  // The old portal, for projects imported from it (old estimates, money and documents stay there).
  OLD_PORTAL_URL: "https://barajas545.github.io/dcr-portal/",
  // Letterhead for printed pages. Empty fields are hidden wherever they would appear.
  COMPANY: Object.freeze({
    name: "DCR Framing",
    legalName: "DCR Framing LLC",
    logo: "icons/logo.jpg",
    address: "7075 Morro Road, Atascadero, CA 93422",
    phone: "(805) 423-8640",
    fax: "",
    email: "",
    website: "www.dcrframing.com",
    license: "CA Lic. #1043050",
  }),
});

/* The theme chosen in Settings, applied before the first paint (an inline script would be refused
   by the page's security policy, and applying it later paints the wrong theme first). Per device. */
(function () {
  try {
    var t = localStorage.getItem("dcr2_theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch (e) { /* storage blocked: the device's own setting applies */ }
})();
