/* DCR Agents 2 console: never inside another site's frame. GitHub Pages cannot send X-Frame-Options
   and a meta tag cannot carry frame-ancestors (BLUEPRINT 2.2.1), so a page drawn over the console could
   lead an admin through a confirm: this runs in <head>, before the first paint, and hides the console
   (css/agents-console.css html.c-framed); the shell then offers to open it in its own window. */
(function () {
  "use strict";
  try { if (window.top !== window.self) document.documentElement.className += " c-framed"; }
  catch (e) { document.documentElement.className += " c-framed"; }
})();
