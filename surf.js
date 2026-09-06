"use strict";

// Compatibility for old shared links; all play begins at canonical Surf entry.
(() => {
  const value = new URLSearchParams(window.location.search).get("src");
  const src = ["bar", "direct", "shared", "scubarc"].includes(value) ? value : "direct";
  window.location.replace("/commonwealth/surf/?src=" + encodeURIComponent(src));
})();
