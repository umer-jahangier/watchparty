// Firefox exposes promise-based `browser`; Chromium browsers expose `chrome`.
const chrome = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
const IS_FIREFOX = typeof globalThis.browser !== "undefined" && /Firefox\//.test(navigator.userAgent);
const $ = (id) => document.getElementById(id);
const VERSION = chrome.runtime.getManifest().version;
$("ver").textContent = `v${VERSION}`;

let icon = "fox";
let busy = false;
let activeState = null;

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text || "";
  el.className = "status" + (kind ? " " + kind : "");
}

function setBusy(on) {
  busy = on;
  ["create", "join", "leave", "copy-link", "copy"].forEach((id) => ($(id).disabled = on));
}

function showActive(state) {
  activeState = state;
  $("idle").classList.add("hidden");
  $("active").classList.remove("hidden");
  $("active-code").textContent = state.full || state.code;
  $("lock").classList.toggle("hidden", !state.encrypted);
  activeState.link = state.link || `https://cp.praivox.com/watchparty/${state.code}`;
  const n = Number(state.people) || 1;
  $("role").textContent = `${state.role === "host" ? "You're hosting" : "You're a guest"} · ${n} watching`;
  $("link").textContent = `cp.praivox.com/watchparty/${state.code}${state.encrypted ? " (link includes the key)" : ""}`;
  const conn = state.conn || "live";
  $("conn").dataset.state = conn;
  $("conn").querySelector("span").textContent = { live: "Live", reconnecting: "Reconnecting", connecting: "Connecting" }[conn] || "Live";
}

function showIdle(noVideo) {
  activeState = null;
  $("idle").classList.remove("hidden");
  $("active").classList.add("hidden");
  $("novideo").classList.toggle("hidden", !noVideo);
}

async function send(message) {
  const res = await chrome.runtime.sendMessage(message);
  if (!res) throw new Error("No response from WatchParty. Reload the tab and try again.");
  return res;
}

function paintFaces() {
  const box = $("faces");
  box.replaceChildren();
  (globalThis.WP_ICONS?.ids || []).forEach((id) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = id === icon ? "on" : "";
    btn.title = id;
    btn.setAttribute("aria-label", `Avatar ${id}`);
    btn.setAttribute("aria-pressed", id === icon ? "true" : "false");
    const face = document.createElement("span");
    face.className = "wp-face";
    const svg = new DOMParser().parseFromString(globalThis.WP_ICONS.svg(id), "image/svg+xml").documentElement;
    face.replaceChildren(document.importNode(svg, true));
    btn.appendChild(face);
    btn.addEventListener("click", () => {
      icon = id;
      chrome.storage.local.set({ wpIcon: icon });
      paintFaces();
      if (activeState) send({ type: "WP_PROFILE", icon }).catch(() => {});
    });
    box.appendChild(btn);
  });
}

async function restore() {
  const { wpName, wpIcon } = await chrome.storage.local.get(["wpName", "wpIcon"]);
  if (wpName) $("name").value = wpName;
  if (wpIcon && globalThis.WP_ICONS?.ok(wpIcon)) icon = wpIcon;
  paintFaces();
  try {
    const state = await send({ type: "WP_GET_STATE" });
    if (state?.active) showActive(state);
    else if (state?.ok === false) {
      showIdle(false);
      setStatus(state.error, "err");
    } else showIdle(state && state.video === false);
  } catch {
    showIdle(false);
  }
}

$("name").addEventListener("change", () => {
  const name = $("name").value.trim();
  chrome.storage.local.set({ wpName: name });
  if (activeState && name) send({ type: "WP_PROFILE", name }).catch(() => {});
});

$("create").addEventListener("click", async () => {
  if (busy) return;
  const name = $("name").value.trim() || "Host";
  await chrome.storage.local.set({ wpName: name, wpIcon: icon });
  setBusy(true);
  setStatus("Starting your party…");
  try {
    const res = await send({ type: "WP_CREATE", name, icon });
    if (!res?.ok) throw new Error(res?.error || "Could not start the party.");
    showActive({ code: res.code, full: res.full, link: res.link, encrypted: res.encrypted, role: "host", people: 1, conn: "live" });
    setStatus("You're live. Send friends the invite link.", "ok");
  } catch (err) {
    setStatus(err.message || String(err), "err");
  } finally {
    setBusy(false);
  }
});

$("join-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const name = $("name").value.trim() || "Friend";
  const code = $("code").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (code.replace(/-/g, "").length < 4) return setStatus("Enter the party code your friend sent you.", "err");
  await chrome.storage.local.set({ wpName: name, wpIcon: icon });
  setBusy(true);
  setStatus("Joining…");
  try {
    const res = await send({ type: "WP_JOIN", name, code, icon });
    if (!res?.ok) throw new Error(res?.error || "Could not join that party.");
    if (res.redirecting) {
      setStatus("Opening the host's video and joining…", "ok");
      return;
    }
    showActive({ code: res.code, full: res.full, link: res.link, encrypted: res.encrypted, role: "guest", people: 2, conn: "live" });
    setStatus("You're in. Playback follows the host.", "ok");
  } catch (err) {
    setStatus(err.message || String(err), "err");
  } finally {
    setBusy(false);
  }
});

// Visible confirmation on the button itself: it turns green, says "Copied!" and pops.
function flashCopied(btn) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  clearTimeout(btn._copyTimer);
  btn.classList.remove("copied");
  void btn.offsetWidth; // restart the animation on repeated clicks
  btn.classList.add("copied");
  btn.textContent = "✓ Copied!";
  const code = $("active-code");
  code.classList.remove("flash");
  void code.offsetWidth;
  code.classList.add("flash");
  btn._copyTimer = setTimeout(() => {
    btn.classList.remove("copied");
    btn.textContent = btn.dataset.label;
  }, 1600);
}

async function copy(text, okMsg, btn) {
  try {
    await navigator.clipboard.writeText(text);
    flashCopied(btn);
    setStatus(okMsg, "ok");
  } catch {
    setStatus("Couldn't copy. Select the text and copy it yourself.", "err");
  }
}

$("copy").addEventListener("click", () => copy($("active-code").textContent, "Full code copied.", $("copy")));
$("copy-link").addEventListener("click", () => copy(activeState?.link || "", "Invite link copied. It includes the secret key, so share it only with your party.", $("copy-link")));

$("leave").addEventListener("click", async () => {
  setBusy(true);
  try {
    await send({ type: "WP_LEAVE" });
  } catch {
    /* ignore */
  }
  setBusy(false);
  showIdle(false);
  setStatus("You left the party.");
});

// ---------- VPN-friendly mode (no extra permissions) ----------
const VPN_OFF = "Using a VPN? Turn this on and WatchParty checks for it, keeps your party connected and sends calls through its encrypted relay.";
async function paintVpn() {
  const { wpVpnMode } = await chrome.storage.local.get("wpVpnMode");
  $("vpn-toggle").setAttribute("aria-checked", wpVpnMode ? "true" : "false");
  const t = $("vpn-text");
  t.className = "";
  if (!wpVpnMode) {
    t.textContent = VPN_OFF;
    return;
  }
  t.textContent = "Checking…";
  const r = await globalThis.WP_VPN.check();
  if (r.unknown) t.textContent = "On. Couldn't reach WatchParty to check right now.";
  else if (r.vpn) {
    t.className = "warn";
    t.textContent = `VPN detected: ${r.reason}. Your party stays connected and calls use the encrypted relay.`;
  } else {
    t.className = "on";
    t.textContent = "On. No VPN detected in this browser. (A VPN app on your device routes everything the same way, so it's fine as is.)";
  }
}

$("vpn-toggle").addEventListener("click", async (e) => {
  if (!e.isTrusted) return;
  const on = $("vpn-toggle").getAttribute("aria-checked") === "true";
  await chrome.storage.local.set({ wpVpnMode: !on });
  paintVpn();
});

// Shortcut labels in the platform's own words (on a Mac "Alt" is the Option key).
const IS_MAC = /Mac/i.test(navigator.platform || navigator.userAgent);
const combo = (k) => (IS_MAC ? `⌥⇧${k}` : `Alt+Shift+${k}`);
$("keys").textContent = `${combo("W")} panel · ${combo("M")} mic · ${combo("C")} camera · ${combo("Y")} chat`;
$("shortcuts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: IS_FIREFOX ? "about:addons" : "chrome://extensions/shortcuts" });
});

restore();
paintVpn();
