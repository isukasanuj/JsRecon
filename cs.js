// cs.js — content script. Reads the page's inline scripts, external script URLs,
// and storage keys, then hands them to the background worker for mining.
(function () {
  try {
    var scripts = Array.prototype.slice.call(document.scripts);
    var inline = scripts.filter(function (s) { return !s.src; })
      .map(function (s) { return s.textContent || ""; }).join("\n\n").slice(0, 600000);
    var scriptUrls = scripts.filter(function (s) { return s.src; }).map(function (s) { return s.src; });
    function keys(store) { var o = []; try { for (var i = 0; i < store.length; i++) o.push(store.key(i)); } catch (e) {} return o; }
    chrome.runtime.sendMessage({
      type: "PAGE",
      url: location.href,
      host: location.host,
      origin: location.origin,
      inline: inline,
      scriptUrls: scriptUrls,
      localKeys: keys(window.localStorage),
      sessionKeys: keys(window.sessionStorage),
      cookies: document.cookie || ""
    });
  } catch (e) { /* ignore */ }
})();
