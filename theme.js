// theme.js — applies light/dark/auto theme across the extension's pages.
(function () {
  function resolve(t) {
    if (t === "auto") return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    return t === "light" ? "light" : "dark";
  }
  function apply(t) { document.documentElement.dataset.theme = resolve(t); }
  try {
    chrome.storage.local.get("theme", ({ theme }) => apply(theme || "dark"));
    chrome.storage.onChanged.addListener((ch, a) => { if (a === "local" && ch.theme) apply(ch.theme.newValue); });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () =>
      chrome.storage.local.get("theme", ({ theme }) => { if ((theme || "dark") === "auto") apply("auto"); }));
  } catch (e) { apply("dark"); }
  window.__setTheme = (t) => { chrome.storage.local.set({ theme: t }); apply(t); };
  window.__theme = () => document.documentElement.dataset.theme || "dark";
})();
