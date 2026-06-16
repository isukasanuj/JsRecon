// background.js — JS Recon engine: observe API calls (webRequest), mine JS for
// secrets + endpoints (content script feeds), build a live API map.

let collecting = true;
let scope = [];                 // host patterns; empty = all
let data = { hosts: {}, secrets: [] };
const minedScripts = new Set(); // external script URLs already fetched+mined
const secretsSeen = new Set();
let saveTimer = null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRACKERS = /(google-analytics|googletagmanager|doubleclick|facebook\.|fbcdn|hotjar|segment\.|mixpanel|sentry\.|cloudflareinsights|gstatic\.com|fonts\.googleapis|fonts\.gstatic|bing\.com|clarity\.ms)/i;
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|woff2?|ttf|eot|map|mp4|webm|mp3|wasm|avif)(\?|#|$)/i;

const SECRET_RULES = [
  [/AKIA[0-9A-Z]{16}/g, "AWS access key id", "high"],
  [/AIza[0-9A-Za-z_\-]{35}/g, "Google API key", "high"],
  [/ghp_[0-9A-Za-z]{36}/g, "GitHub token", "high"],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/g, "Slack token", "high"],
  [/sk_live_[0-9A-Za-z]{24,}/g, "Stripe secret key", "high"],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, "Private key", "high"],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, "JWT", "info"],
  [/(?:api[_-]?key|apikey|client[_-]?secret|access[_-]?token|secret)["'\s:=]{1,4}["']([A-Za-z0-9_\-]{16,})["']/gi, "Generic secret", "medium"]
];
const ENDPOINT_RE = /["'`](\/[A-Za-z0-9_\-./]{2,}(?:\?[^"'`\s]*)?|https?:\/\/[A-Za-z0-9_\-.:]+\/[A-Za-z0-9_\-./?=&%]*)["'`]/g;

// ---- scope -----------------------------------------------------------------
function hostInScope(host) {
  if (!scope.length) return true;
  return scope.some((p) => {
    const re = "^" + p.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    try { return new RegExp(re, "i").test(host); } catch { return false; }
  });
}

// ---- persistence -----------------------------------------------------------
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ recon: data });
    updateBadge();
  }, 600);
}
async function load() {
  const got = await chrome.storage.local.get(["recon", "collecting", "scope"]);
  if (got.recon) data = got.recon;
  if (typeof got.collecting === "boolean") collecting = got.collecting;
  if (Array.isArray(got.scope)) scope = got.scope;
  for (const s of data.secrets || []) secretsSeen.add(s.sample);
  for (const h of Object.values(data.hosts || {})) for (const u of Object.keys(h.scripts || {})) minedScripts.add(u);
  updateBadge();
}
function counts() {
  let ep = 0; for (const h of Object.values(data.hosts)) ep += Object.keys(h.endpoints).length;
  return { hosts: Object.keys(data.hosts).length, endpoints: ep, secrets: data.secrets.length };
}
function updateBadge() {
  const c = counts();
  chrome.action.setBadgeBackgroundColor({ color: collecting ? "#22d3ee" : "#555" });
  chrome.action.setBadgeText({ text: c.endpoints ? String(c.endpoints > 9999 ? "9k+" : c.endpoints) : "" });
}

// ---- model -----------------------------------------------------------------
function normPath(p) {
  const segs = p.split("/").filter(Boolean).map((s) =>
    (/^\d+$/.test(s) || UUID.test(s) || /^[0-9a-f]{16,}$/i.test(s)) ? "{id}" : s);
  return "/" + segs.join("/");
}
function bucket(host) {
  if (!data.hosts[host]) data.hosts[host] = { endpoints: {}, scripts: {} };
  return data.hosts[host];
}
function addEndpoint(host, method, rawPath, fromJs, sampleFull) {
  if (!host || TRACKERS.test(host)) return;
  let path = rawPath, query = "";
  const qi = rawPath.indexOf("?");
  if (qi > -1) { path = rawPath.slice(0, qi); query = rawPath.slice(qi + 1); }
  if (ASSET.test(path)) return;
  if (path.length < 2) return;
  const pat = normPath(path);
  const b = bucket(host);
  const ep = b.endpoints[pat] || (b.endpoints[pat] = { methods: {}, params: {}, observed: false, fromJs: false, hits: 0, sample: "" });
  if (method) ep.methods[method.toUpperCase()] = true;
  ep.observed = ep.observed || !fromJs;
  ep.fromJs = ep.fromJs || fromJs;
  ep.hits++;
  if (sampleFull && !ep.sample) ep.sample = sampleFull.slice(0, 300);
  if (query) query.split("&").forEach((kv) => { const k = kv.split("=")[0]; if (k) ep.params[k] = true; });
}
function addSecret(type, sev, sample, source) {
  const key = type + "|" + sample;
  if (secretsSeen.has(key)) return;
  secretsSeen.add(key);
  data.secrets.push({ type, sev, sample: sample.slice(0, 80), source });
}

function mineSource(src, pageHost, source) {
  if (!src) return;
  for (const [re, name, sev] of SECRET_RULES) {
    re.lastIndex = 0; let m, n = 0;
    while ((m = re.exec(src)) && n < 30) { addSecret(name, sev, m[1] || m[0], source); n++; }
  }
  ENDPOINT_RE.lastIndex = 0; let m2, c = 0;
  while ((m2 = ENDPOINT_RE.exec(src)) && c < 600) {
    c++;
    const e = m2[1];
    if (/^https?:\/\//i.test(e)) {
      try { const u = new URL(e); addEndpoint(u.host, null, u.pathname + (u.search || ""), true, e); } catch {}
    } else if (e.startsWith("/") && !e.startsWith("//")) {
      addEndpoint(pageHost, null, e, true, e);
    }
  }
}

// ---- observe live requests (no debugger banner) ----------------------------
chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (!collecting) return;
  if (!["xmlhttprequest", "other", "ping", "websocket"].includes(d.type)) return;
  let host; try { host = new URL(d.url).host; } catch { return; }
  if (!hostInScope(host)) return;
  const path = (() => { try { const u = new URL(d.url); return u.pathname + (u.search || ""); } catch { return ""; } })();
  addEndpoint(host, d.method, path, false, d.url);
  save();
}, { urls: ["<all_urls>"] });

// ---- handle page payloads from the content script --------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "PAGE") {
      if (!collecting || !hostInScope(msg.host)) { sendResponse({ ok: true }); return; }
      const pageHost = msg.host;
      mineSource(msg.inline, pageHost, msg.url + " (inline)");
      // scan storage keys + cookies for token-looking values
      mineSource((msg.localKeys || []).join("\n") + "\n" + (msg.sessionKeys || []).join("\n") + "\n" + (msg.cookies || ""), pageHost, msg.url + " (storage)");
      const b = bucket(pageHost);
      const toFetch = (msg.scriptUrls || []).filter((u) => !minedScripts.has(u)).slice(0, 60);
      for (const u of toFetch) {
        minedScripts.add(u); b.scripts[u] = true;
        let uhost; try { uhost = new URL(u).host; } catch { continue; }
        if (TRACKERS.test(uhost)) continue;
        try { const r = await fetch(u); const t = await r.text(); mineSource(t, pageHost, u); }
        catch (e) { /* CORS/network — skip */ }
      }
      save();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === "GET_STATE") { sendResponse({ collecting, scope, ...counts() }); return; }
    if (msg.type === "SET_COLLECTING") { collecting = !!msg.value; await chrome.storage.local.set({ collecting }); updateBadge(); sendResponse({ collecting }); return; }
    if (msg.type === "SET_SCOPE") { scope = msg.scope || []; await chrome.storage.local.set({ scope }); sendResponse({ ok: true }); return; }
    if (msg.type === "GET_DATA") { sendResponse({ data }); return; }
    if (msg.type === "CLEAR") { data = { hosts: {}, secrets: [] }; secretsSeen.clear(); minedScripts.clear(); await chrome.storage.local.set({ recon: data }); updateBadge(); sendResponse({ ok: true }); return; }
    sendResponse({ error: "unknown" });
  })();
  return true;
});

chrome.runtime.onStartup.addListener(load);
chrome.runtime.onInstalled.addListener(load);
load();
