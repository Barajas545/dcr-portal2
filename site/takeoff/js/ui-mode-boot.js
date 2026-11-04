/* The UI-mode boot of takeoff-web's index.html at f4994359c194c9384fd7c6b683ccf77791157834, moved out of the page word for word by
   DCR Portal 2's tools/vendor-takeoff.mjs --allow-inline-boot (the portal's page policy allows no inline script).
   takeoff-web's own iPad package (P2) makes this file itself; vendor that commit without the flag. */
/* The layout must be decided BEFORE the stylesheet paints, or the app flashes
   the wrong one on every launch. Inline, tiny, and duplicated from
   resolveUiMode() in js/ui/settings.js on purpose: a module import cannot run
   this early, and the two are one line each. Touch unless standard was chosen. */
try {
  var st = JSON.parse(localStorage.getItem('ptt.settings.v1') || '{}');
  document.documentElement.dataset.ui = st.ui_mode === 'standard' ? 'standard' : 'touch';
} catch (e) {
  document.documentElement.dataset.ui = 'touch';
}
