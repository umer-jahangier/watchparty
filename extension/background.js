// Firefox exposes promise-based `browser`; Chromium browsers expose `chrome`.
const chrome = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
const IS_FIREFOX = typeof globalThis.browser !== "undefined" && /Firefox\//.test(navigator.userAgent);
// The self-updater only exists in the direct-download build; store builds (Edge, Opera, Firefox)
// are updated by their store and ship without it.
if (typeof importScripts === "function" && !IS_FIREFOX) {
  try {
    importScripts("popup/update-core.js");
  } catch {
    /* store build: no self-updater */
  }
}

// Shows the NEW badge only for a release that verifies against the WatchParty signing key.
async function checkUpdate() {
  if (IS_FIREFOX || typeof wpVerifiedRelease !== "function") return null;
  try {
    const rel = await wpVerifiedRelease(chrome.runtime.getManifest().version);
    await chrome.storage.local.set({ wpUpdateChecked: Date.now() });
    await chrome.action.setBadgeText({ text: rel ? "NEW" : "" });
    if (rel) await chrome.action.setBadgeBackgroundColor({ color: "#db2777" });
    return rel ? { version: rel.version, notes: rel.notes } : null;
  } catch {
    return null;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms?.create("wp-update", { delayInMinutes: 1, periodInMinutes: 180 });
  checkUpdate();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms?.create("wp-update", { delayInMinutes: 1, periodInMinutes: 180 });
  checkUpdate();
});
chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === "wp-update") checkUpdate();
});

const videoFrames = new Map();

function setFrame(tabId, frameId, href) {
  videoFrames.set(tabId, { frameId, href, at: Date.now() });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  videoFrames.delete(tabId);
  chrome.storage.session?.remove([`tab:${tabId}`, `trust:${tabId}`]).catch?.(() => {});
});

// Per-tab party state and connection id live in extension-only session storage,
// out of reach of the websites the party runs on.
function randomId() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return [...buf].map((n) => n.toString(36).padStart(2, "0")).join("").slice(0, 20);
}
async function tabState(tabId) {
  const key = `tab:${tabId}`;
  const got = (await chrome.storage.session.get(key))[key] || {};
  if (!got.cid) {
    got.cid = randomId();
    await chrome.storage.session.set({ [key]: got });
  }
  return got;
}
function cleanParty(p) {
  if (!p || typeof p !== "object") return null;
  const code = String(p.code || "").toUpperCase();
  if (!/^[A-Z0-9]{4,10}$/.test(code) || (p.role !== "host" && p.role !== "guest")) return null;
  const secret = /^[A-HJ-NP-Z2-9]{10}$/.test(String(p.secret || "")) ? String(p.secret) : null;
  return { code, role: p.role, name: String(p.name || "").slice(0, 24), icon: String(p.icon || "fox").slice(0, 16), secret, at: Number(p.at) || Date.now() };
}
function safeRedirect(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WP_FRAME_READY" && sender.tab?.id != null) {
    setFrame(sender.tab.id, sender.frameId, msg.href || sender.url);
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === "WP_FRAME_GONE" && sender.tab?.id != null) {
    const cur = videoFrames.get(sender.tab.id);
    if (cur && cur.frameId === sender.frameId) videoFrames.delete(sender.tab.id);
    sendResponse({ ok: true });
    return false;
  }

  const tabId = sender.tab?.id;
  if (msg?.type === "WP_TAB_LOAD" && tabId != null && sender.frameId === 0) {
    tabState(tabId).then((st) => sendResponse({ cid: st.cid, party: st.party || null, keys: st.keys || {} }));
    return true;
  }
  if (msg?.type === "WP_TAB_SAVE" && tabId != null && sender.frameId === 0) {
    tabState(tabId)
      .then((st) => chrome.storage.session.set({ [`tab:${tabId}`]: { ...st, party: cleanParty(msg.party) } }))
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  // Party keys for this tab (from a full code or an invite link); extension-only storage.
  if (msg?.type === "WP_KEY_SET" && tabId != null && sender.frameId === 0) {
    const code = String(msg.code || "").toUpperCase();
    const secret = String(msg.secret || "").toUpperCase();
    if (!/^[A-Z0-9]{4,10}$/.test(code) || !/^[A-HJ-NP-Z2-9]{10}$/.test(secret)) {
      sendResponse({ ok: false });
      return false;
    }
    tabState(tabId)
      .then((st) => {
        const keys = { ...(st.keys || {}), [code]: secret };
        const recent = Object.fromEntries(Object.entries(keys).slice(-10));
        return chrome.storage.session.set({ [`tab:${tabId}`]: { ...st, keys: recent } });
      })
      .then(() => sendResponse({ ok: true }));
    return true;
  }
  // One-time permission for the next page in this tab to join a party without asking
  // (set by our own navigations: following the host, or a join from the popup).
  if (msg?.type === "WP_TRUST_SET" && tabId != null && sender.frameId === 0) {
    const code = String(msg.code || "").toUpperCase();
    chrome.storage.session.set({ [`trust:${tabId}`]: { code, until: Date.now() + 60000 } }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "WP_TRUST_CHECK" && tabId != null && sender.frameId === 0) {
    const key = `trust:${tabId}`;
    chrome.storage.session.get(key).then(async (r) => {
      const t = r[key];
      await chrome.storage.session.remove(key);
      sendResponse({ trusted: !!t && t.code === String(msg.code || "").toUpperCase() && t.until > Date.now() });
    });
    return true;
  }

  if (msg?.type === "WP_UPDATE_CHECK") {
    checkUpdate().then((info) => sendResponse({ ok: true, update: info }));
    return true;
  }

  const partyOps = ["WP_CREATE", "WP_JOIN", "WP_LEAVE", "WP_GET_STATE", "WP_PROFILE"];
  if (!partyOps.includes(msg?.type)) return false;

  (async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      sendResponse({ ok: false, error: "No active tab." });
      return;
    }
    if (!tab.url || !/^https?:/.test(tab.url)) {
      sendResponse({ ok: false, error: "Open a video page first." });
      return;
    }
    const opts = { frameId: 0 };
    try {
      const res = await chrome.tabs.sendMessage(tab.id, msg, opts);
      if (res?.redirect) {
        const target = safeRedirect(res.redirect);
        if (!target) {
          sendResponse({ ok: false, error: "That party points to an address WatchParty won't open." });
          return;
        }
        await chrome.storage.session.set({ [`trust:${tab.id}`]: { code: String(res.code || "").toUpperCase(), until: Date.now() + 60000 } });
        await chrome.tabs.update(tab.id, { url: target });
        sendResponse({ ok: true, redirecting: true, code: res.code, role: "guest" });
        return;
      }
      sendResponse(res || { ok: false, error: "Reload this video tab, then try again." });
    } catch {
      // Never broadcast party ops to every frame: each frame would start its own party.
      sendResponse({ ok: false, error: "Reload this video tab, then try again." });
    }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "WP_COMMAND", command }, { frameId: 0 });
  } catch {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "WP_COMMAND", command });
    } catch {
      /* ignore */
    }
  }
});
