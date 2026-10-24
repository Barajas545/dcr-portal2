/* cme.html: a failed module import is otherwise a silent blank screen (the old page's inline script, moved into
   a file for the security policy: no inline script runs on Portal 2). Classic script, before boot.js. */
(function () {
  window.addEventListener("error", function (e) {
    if (!e || !e.target || e.target.tagName !== "SCRIPT") return;
    var box = document.getElementById("cmeBootError");
    var why = document.getElementById("cmeBootWhy");
    if (why) why.textContent = "Could not load " + (e.target.src || "a required file") + ".";
    if (box) box.style.display = "block";
  }, true);
})();
