// legacy.js - fallback if ES modules not supported
(function(){
  var b = document.getElementById("jsStatus");
  if (b) b.textContent = "JS: legacy";
  var m = document.getElementById("micStatus");
  if (m) m.textContent = "Mic: (needs modern Safari)";
})();