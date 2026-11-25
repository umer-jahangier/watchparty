(() => {
  // Firefox exposes promise-based `browser`; Chromium browsers expose `chrome`.
  const chrome = globalThis.browser?.runtime ? globalThis.browser : globalThis.chrome;
  const VERSION = chrome.runtime.getManifest?.()?.version || "4";
  const IS_TOP = window === window.top;
  const SIDEBAR_W = 360;
  const PEER_PREFIX = "wp";
  const DRIFT = 0.55;
  const SYNC_MS = 1400;
  const STUN = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const SIGNAL_SERVERS = [
    { host: "cp.praivox.com", port: 443, path: "/peerjs/", secure: true, proxied: true },
  ];

  let peer = null;
  let role = null;
  let code = null;
  let name = "Friend";
  let icon = "fox";
  let conns = [];
  let applying = false;
  let quietUntil = 0;
  let lastMedia = null;
  let mediaPick = { score: 0, at: 0, href: "" };
  let lastNotedTime = null;
  let noteTimer = null;
  let fsDocked = false;
  let fsWasPop = false;
  let fsWasMin = false;
  let syncTimer = null;
  let boundVideo = null;
  let overlay = null;
  let people = new Map();
  let localStream = null;
  let wantMic = false;
  let wantCam = false;
  let calls = new Map();
  let knownIds = new Set();
  let inCall = false;
  let pendingInvite = null;
  let ringTimer = null;
  const SVG = (d, extra = "") => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
  const ICON = {
    logo: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`,
    sliders: SVG('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
    right: SVG('<path d="m9 6 6 6-6 6"/>'),
    expand: SVG('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    pop: SVG('<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11" width="7" height="6" rx="1.2" fill="currentColor" stroke="none"/>'),
    video: SVG('<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="m15.5 10.5 5.5-3v9l-5.5-3z"/>'),
    user: SVG('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5"/>'),
    smile: SVG('<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14.2c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2M9.2 9.6h.01M14.8 9.6h.01"/>'),
    mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3"/>'),
    cam: SVG('<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="m15.5 10.5 5.5-3v9l-5.5-3z"/>'),
    hang: SVG('<path d="M3.5 13.5c4.7-4 12.3-4 17 0l-1.8 2.6-3.4-1.3v-2.3a10 10 0 0 0-6.6 0v2.3l-3.4 1.3z"/>'),
    send: SVG('<path d="M5 12h13M13 6l6 6-6 6"/>'),
    play: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>`,
    phone: SVG('<path d="M5 4h3.5l1.5 4.5-2.2 1.4a11 11 0 0 0 6.3 6.3l1.4-2.2L20 15.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4z"/>'),
    link: SVG('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  };
  // Build DOM from our own constant markup with DOMParser (it never runs scripts).
  const markupParser = new DOMParser();
  function setMarkup(el, markup) {
    const doc = markupParser.parseFromString(`<body>${markup}</body>`, "text/html");
    el.replaceChildren(...doc.body.childNodes);
  }
  // After an update/reload, content scripts left in open tabs lose their extension context.
  function extAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }
  function safeSet(obj) {
    if (!extAlive()) return;
    try {
      safeSet(obj);
    } catch {
      /* context gone */
    }
  }
  function bg(message, timeoutMs = 3000) {
    if (!extAlive()) return Promise.resolve(null);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(null), timeoutMs);
      try {
        Promise.resolve(chrome.runtime.sendMessage(message))
          .then((r) => {
            clearTimeout(t);
            resolve(r || null);
          })
          .catch(() => {
            clearTimeout(t);
            resolve(null);
          });
      } catch {
        clearTimeout(t);
        resolve(null);
      }
    });
  }
  async function storageGet(keys) {
    if (!extAlive()) return {};
    try {
      return (await chrome.storage.local.get(keys)) || {};
    } catch {
      return {};
    }
  }
  // Only ever navigate to ordinary public web pages.
  function safeTarget(raw) {
    try {
      const u = new URL(String(raw || ""));
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      if (u.username || u.password) return null;
      const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || h === "::1") return null;
      if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return null;
      if (/^(fc|fd|fe80)/.test(h) && h.includes(":")) return null;
      return u;
    } catch {
      return null;
    }
  }
  // Peer ids never go into the page's DOM (a site could read them and call in); elements carry opaque tokens.
  const peerTok = new Map();
  const tokPeer = new Map();
  function tok(id) {
    if (!peerTok.has(id)) {
      const t = `p${crypto.getRandomValues(new Uint32Array(2)).join("")}`;
      peerTok.set(id, t);
      tokPeer.set(t, id);
    }
    return peerTok.get(id);
  }
  const peerOf = (t) => tokPeer.get(t);
  const QUICK = ["😂", "❤️", "🥰", "🔥", "👏", "😮", "😭", "🎉", "🍿", "👑"];
  const CHAT_EMOJIS = ["😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "😅", "😢", "😭", "😡", "👍", "👎", "🙏", "👏", "🔥", "❤️", "💯", "🎉", "🍿", "🎬", "💀", "😮", "🤔", "😴", "🤝", "✨", "💜", "🥰", "👑", "🥺", "😻", "💕", "🌸"];
  let voiceRec = null;
  let voiceChunks = [];
  let voiceStream = null;
  let voiceTimer = null;
  let callAudioOn = false;
  let callVideoOn = false;
  let selfView = false;
  let callStarted = false;
  let remoteAv = new Map();
  let remoteStreams = new Map();
  let pendingCalls = [];
  let heardPeers = new Set();
  // Peers whose media path (ICE) is actually up; only these count as "connected".
  const iceLive = new Set();
  const iceRetries = new Map();
  let forceRelay = false;
  let turnCred = null;
  let turnWaiters = [];
  let videoPopHidden = false;
  let hiddenCams = new Set();
  let bufferTimer = null;
  let buffering = false;
  let gestureUntil = 0;
  let hold = null;
  let holdUntil = 0;
  let remoteHold = null;
  let relockAt = 0;

  function collectVideos(root, out) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll("video").forEach((v) => {
      if (isCallVideo(v)) return;
      out.push(v);
    });
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) collectVideos(el.shadowRoot, out);
    });
  }

  function isPartyMedia(v) {
    return !!(v && v.closest && v.closest("#watchparty-root, #watchparty-cams, #watchparty-movie-ui, #watchparty-voice"));
  }

  function isCallVideo(v) {
    if (!v || isPartyMedia(v)) return true;
    try {
      if (v.srcObject) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function videoScore(v) {
    const r = v.getBoundingClientRect();
    return r.width > 160 && r.height > 90 && r.bottom > 0 && r.top < innerHeight + 80
      ? r.width * r.height
      : 0;
  }

  function findVideo() {
    const all = [];
    collectVideos(document, all);
    let best = null;
    let bestScore = 0;
    for (const v of all) {
      const s = videoScore(v);
      if (s > bestScore) {
        best = v;
        bestScore = s;
      }
    }
    if (best) return best;
    return (
      all
        .filter((v) => !v.ended)
        .sort((a, b) => (b.readyState || 0) - (a.readyState || 0) || (b.videoWidth || 0) - (a.videoWidth || 0))[0] ||
      null
    );
  }

  function reportFrame() {
    if (!extAlive() || !findVideo()) return;
    try {
      chrome.runtime.sendMessage({ type: "WP_FRAME_READY", href: location.href })?.catch?.(() => {});
    } catch {
      /* extension was reloaded; this tab keeps the old script until refresh */
    }
  }

  function makeCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    return [...buf].map((n) => alphabet[n % alphabet.length]).join("");
  }

  let socket = null;
  // --- Relay connection lifecycle (auto-reconnect + resume after reload) ---
  const WS_URL = "wss://cp.praivox.com/wp-ws/ws";
  const PARTY_KEY = "__watchparty_party";
  const CID_KEY = "__watchparty_cid";
  const RESUME_MAX_AGE = 10 * 60 * 1000;
  const STALE_MS = 65000;
  let socketWanted = false;
  let socketRole = null;
  let reconnectTimer = null;
  let reconnectTries = 0;
  let lastRx = 0;
  let keepTimer = null;
  let connState = "offline"; // offline | connecting | live | reconnecting
  const connListeners = new Set();

  function setConnState(next) {
    if (connState === next) return;
    connState = next;
    connListeners.forEach((fn) => {
      try {
        fn(next);
      } catch {
        /* ignore */
      }
    });
  }

  function makeCid() {
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return [...buf].map((n) => n.toString(36).padStart(2, "0")).join("").slice(0, 20);
  }

  let CID = makeCid();
  // End-to-end encryption for chat, voice notes, reactions and love.
  let vpnActive = false;
  let vpnNoted = false;
  let vpnOffStreak = 0;
  async function refreshVpn() {
    const { wpVpnMode } = await storageGet(["wpVpnMode"]);
    if (!wpVpnMode || !globalThis.WP_VPN) {
      vpnActive = false;
      return;
    }
    const r = await globalThis.WP_VPN.check();
    vpnActive = !!r?.vpn;
    // Re-arm the notice only once the VPN is really off, so it shows once per VPN session.
    vpnOffStreak = vpnActive ? 0 : vpnOffStreak + 1;
    if (vpnOffStreak >= 2) vpnNoted = false;
    if (vpnActive && role && !vpnNoted) {
      vpnNoted = true;
      addChat("", "VPN detected. Your party stays connected, and calls go through WatchParty's encrypted relay.", true);
    }
  }
  let e2eKey = null;
  let e2eSecret = null;
  let savedKeys = {};
  const E2E = globalThis.WP_E2E;
  async function setSecret(partyCode, secret) {
    e2eSecret = secret && E2E?.validSecret(secret) ? secret : null;
    e2eKey = e2eSecret ? await E2E.deriveKey(partyCode, e2eSecret) : null;
  }
  function fullCode() {
    return E2E && e2eSecret ? E2E.format(code, e2eSecret) : code;
  }
  function inviteLink() {
    return `https://cp.praivox.com/watchparty/${code}${e2eSecret ? `#k=${e2eSecret}` : ""}`;
  }
  // Send a message sealed for the party when the party is encrypted; plaintext otherwise.
  async function sendSecure(kind, obj, plain) {
    if (e2eKey) {
      const box = await E2E.seal(e2eKey, kind, obj);
      sendAll({ t: "e2e", kind, ...box });
    } else sendAll(plain);
  }
  let savedState = null;
  const tabStateReady = IS_TOP
    ? bg({ type: "WP_TAB_LOAD" }).then((r) => {
        if (r?.cid && /^[a-z0-9]{8,40}$/.test(r.cid)) CID = r.cid;
        savedState = r?.party || null;
        savedKeys = r?.keys && typeof r.keys === "object" ? r.keys : {};
        return savedState;
      })
    : Promise.resolve(null);

  let queenOk = false;
  try {
    storageGet(["wpQueen"]).then((r) => {
      queenOk = !!r?.wpQueen;
      if (queenOk && people.has("me")) people.set("me", { name, icon, queen: true });
    });
  } catch {
    /* ignore */
  }

  function queenFor(who) {
    if (who && who === name) return queenOk;
    for (const row of people.values()) {
      if (row && typeof row === "object" && row.name === who) return !!row.queen;
    }
    return false;
  }

  function crownEl() {
    const c = document.createElement("span");
    c.className = "wp-crown";
    c.title = "Queen";
    c.textContent = "👑";
    return c;
  }

  function clockNow() {
    return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  const EMOJI_RE = /(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)/gu;

  // Emoji-only messages show big; emoji inside text are bumped up so they read clearly.
  function bubbleFor(text) {
    const bubble = document.createElement("div");
    const count = (String(text).match(EMOJI_RE) || []).length;
    const onlyEmoji = count > 0 && count <= 6 && String(text).replace(EMOJI_RE, "").trim() === "";
    bubble.className = onlyEmoji ? "wp-bubble wp-jumbo" : "wp-bubble";
    if (onlyEmoji) {
      bubble.textContent = String(text).replace(/\s+/g, "");
      if (count === 1) bubble.classList.add("wp-jumbo-1");
      return bubble;
    }
    String(text)
      .split(EMOJI_RE)
      .forEach((part, i) => {
        if (!part) return;
        if (i % 2 === 1) {
          const em = document.createElement("span");
          em.className = "wp-em";
          em.textContent = part;
          bubble.appendChild(em);
        } else bubble.appendChild(document.createTextNode(part));
      });
    return bubble;
  }

  function metaFor(from, mine, queen) {
    const meta = document.createElement("div");
    meta.className = "wp-meta";
    const b = document.createElement("b");
    b.textContent = mine ? "You" : from || "Friend";
    meta.appendChild(b);
    if (queen) meta.appendChild(crownEl());
    const time = document.createElement("time");
    time.textContent = clockNow();
    meta.appendChild(time);
    return meta;
  }

  function saveParty() {
    if (window !== window.top || !role || !code) return;
    bg({ type: "WP_TAB_SAVE", party: { code, role, name, icon, secret: e2eSecret, at: Date.now() } });
  }

  function clearSavedParty() {
    if (window !== window.top) return;
    bg({ type: "WP_TAB_SAVE", party: null });
  }

  function readSavedParty() {
    const raw = savedState;
    if (!raw || !/^[A-Z0-9]{4,10}$/.test(String(raw.code || ""))) return null;
    if (raw.role !== "host" && raw.role !== "guest") return null;
    if (!(Date.now() - Number(raw.at) < RESUME_MAX_AGE)) return null;
    return raw;
  }

  function startKeepalive() {
    if (keepTimer) return;
    keepTimer = setInterval(() => {
      if (!socket || socket.readyState !== 1) return;
      if (Date.now() - lastRx > STALE_MS) {
        // Half-open socket: the relay has gone quiet, force a reconnect.
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        return;
      }
      sendAll({ t: "hb" });
      saveParty();
    }, 20000);
  }

  function stopKeepalive() {
    if (keepTimer) clearInterval(keepTimer);
    keepTimer = null;
  }

  function scheduleReconnect(immediate) {
    if (!socketWanted || !role) return;
    if (reconnectTimer) {
      if (!immediate) return;
      clearTimeout(reconnectTimer);
    }
    const delay = immediate ? 0 : Math.min(15000, 1000 * 2 ** Math.min(reconnectTries, 4)) + Math.random() * 600;
    setConnState("reconnecting");
    reconnectTries += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (!socketWanted || !role) return;
      openSocket(socketRole, true)
        .then(() => {
          if (inCall) broadcastAv();
        })
        .catch(() => {
          /* onclose schedules the next attempt */
        });
    }, delay);
  }

  function wakeSocket() {
    if (socketWanted && role && (!socket || socket.readyState > 1)) scheduleReconnect(true);
  }

  if (window === window.top) {
    window.addEventListener("online", wakeSocket);
    let vpnCheckTimer = null;
    let vpnCheckedAt = 0;
    navigator.connection?.addEventListener?.("change", () => {
      wakeSocket(); // VPN on/off, Wi-Fi switch
      // This event fires constantly on some networks (bandwidth estimates); check at most every 30s.
      if (!role || vpnCheckTimer) return;
      const wait = Math.max(0, 30000 - (Date.now() - vpnCheckedAt));
      vpnCheckTimer = setTimeout(() => {
        vpnCheckTimer = null;
        vpnCheckedAt = Date.now();
        if (role) refreshVpn();
      }, Math.max(wait, 3000));
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") wakeSocket();
    });
    window.addEventListener("pagehide", saveParty);
  }

  function cleanUrl(href) {
    const u = new URL(href);
    u.searchParams.delete("wp_party");
    return u.toString();
  }

  function sameVideo(a, b) {
    try {
      const ua = new URL(a);
      const ub = new URL(b);
      ua.searchParams.delete("wp_party");
      ub.searchParams.delete("wp_party");
      ua.hash = "";
      ub.hash = "";
      return ua.toString() === ub.toString();
    } catch {
      return false;
    }
  }

  function partyLink(raw, partyCode) {
    const u = safeTarget(raw);
    if (!u) throw new Error("That party points to an address WatchParty won't open.");
    u.searchParams.set("wp_party", partyCode);
    return u.toString();
  }

  function iconOr(id) {
    const key = String(id || "").toLowerCase();
    return globalThis.WP_ICONS?.ok(key) ? key : "fox";
  }

  function iconEl(id) {
    const el = document.createElement("span");
    el.className = "wp-face";
    setMarkup(el, globalThis.WP_ICONS?.svg(iconOr(id)) || "");
    return el;
  }

  function iconFor(personName) {
    if (personName && personName === name) return icon;
    for (const row of people.values()) {
      if (row && typeof row === "object" && row.name === personName && row.icon) return iconOr(row.icon);
    }
    return "fox";
  }

  function sendAll(payload) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  function snapshot() {
    const v = findVideo();
    if (v && (videoScore(v) > 0 || v.readyState > 0)) {
      return { paused: v.paused, time: v.currentTime || 0, rate: v.playbackRate || 1 };
    }
    if (lastMedia) return { paused: !!lastMedia.paused, time: Number(lastMedia.time) || 0, rate: Number(lastMedia.rate) || 1 };
    return null;
  }

  function formatClock(t) {
    const total = Math.max(0, Math.floor(Number(t) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function announce(text) {
    addChat("", text, true);
    sendAll({ t: "chat", name: "", text, system: true });
  }

  function noteAction(kind, body) {
    if (kind === "seek") {
      const prev = lastNotedTime;
      lastNotedTime = body.time;
      if (prev == null || Math.abs(body.time - prev) < 2) return;
      clearTimeout(noteTimer);
      noteTimer = null;
      announce(`${name} skipped to ${formatClock(body.time)}`);
      return;
    }
    if (kind === "rate") {
      announce(`${name} set speed to ${Number(body.rate) || 1}x`);
      return;
    }
    if (kind !== "play" && kind !== "pause") return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => {
      noteTimer = null;
      announce(kind === "play" ? `${name} played from ${formatClock(body.time)}` : `${name} paused at ${formatClock(body.time)}`);
    }, 320);
  }

  function fanoutApply(msg) {
    const packet = {
      source: "wp-apply",
      time: Number(msg.time) || 0,
      paused: !!msg.paused,
      rate: Number(msg.rate) || 1,
      at: msg.at || Date.now(),
    };
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow.postMessage(packet, "*");
      } catch {
        /* ignore */
      }
    });
  }

  function videoKey(raw) {
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\.|^m\./, "");
      if (host === "youtube.com" && u.pathname === "/watch") return `yt:${u.searchParams.get("v")}`;
      if (host === "youtu.be") return `yt:${u.pathname.slice(1)}`;
      if (host === "youtube.com" && u.pathname.startsWith("/shorts/")) return `yt:${u.pathname.split("/")[2]}`;
      return `${u.origin}${u.pathname}`;
    } catch {
      return "";
    }
  }

  // Guests follow the host to a new video (next episode, YouTube autoplay, SPA navigation).
  function followHost(url) {
    if (role !== "guest" || !code || typeof url !== "string" || !safeTarget(url)) return false;
    if (Date.now() - (followHost.last || 0) < 10000) return false;
    const target = videoKey(url);
    if (!target || target === videoKey(location.href)) return false;
    const guard = `__watchparty_follow_${target}`;
    try {
      if (Number(sessionStorage.getItem(guard)) > Date.now() - 20000) return false;
      sessionStorage.setItem(guard, String(Date.now()));
    } catch {
      /* ignore */
    }
    followHost.last = Date.now();
    saveParty();
    addChat("", "Following the host to the next video…", true);
    const next = partyLink(url, code);
    // Tell the extension this navigation is ours, so the next page joins without asking.
    bg({ type: "WP_TRUST_SET", code }).then(() => {
      location.href = next;
    });
    return true;
  }

  function adPlaying() {
    return !!document.querySelector("#movie_player.ad-showing, .html5-video-player.ad-showing");
  }

  function applySync(msg) {
    if (!msg || typeof msg.time !== "number" || Number.isNaN(msg.time)) return;
    if (adPlaying()) return;
    if (typeof msg.rate === "number") msg = { ...msg, rate: Math.min(4, Math.max(0.25, msg.rate)) };
    if (hold && Date.now() < holdUntil) {
      const pauseClash = !!msg.paused !== !!hold.paused;
      const seekClash = Math.abs((Number(msg.time) || 0) - hold.time) > 2.5;
      if (pauseClash || seekClash) return;
    }
    remoteHold = { paused: !!msg.paused, until: Date.now() + 8000 };
    let target = Number(msg.time) || 0;
    if (!msg.paused && typeof msg.at === "number") {
      const extra = (Date.now() - msg.at) / 1000;
      if (extra > 0 && extra < 2.5) target += extra;
    }
    const rate = Number(msg.rate) || 1;
    const v = findVideo();
    let changed = false;
    if (v) {
      const drift = Math.abs((v.currentTime || 0) - target) > 1.15;
      const pauseChanged = !!msg.paused !== !!v.paused;
      const rateChanged = typeof msg.rate === "number" && Math.abs((v.playbackRate || 1) - msg.rate) > 0.05;
      if (drift || pauseChanged || rateChanged) {
        quietUntil = Date.now() + 900;
        applying = true;
        changed = true;
        boundVideo = v;
        try {
          if (rateChanged) v.playbackRate = msg.rate;
          if (drift) v.currentTime = Math.max(0, target);
          if (msg.paused && !v.paused) v.pause();
          if (!msg.paused && v.paused) {
            const play = v.play();
            if (play && play.catch) play.catch(() => {});
          }
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          applying = false;
        }, 900);
      }
    }
    lastMedia = { time: target, paused: !!msg.paused, rate };
    lastNotedTime = target;
    fanoutApply({ ...msg, time: target, paused: !!msg.paused, rate });
    if (changed) {
      try {
        window.postMessage({ action: "seek", time: target }, "*");
        window.postMessage({ action: msg.paused ? "pause" : "play" }, "*");
        if (msg.rate) window.postMessage({ action: "setSpeed", speed: msg.rate }, "*");
      } catch {
        /* ignore */
      }
      nudgePlayer(msg, target);
      const wantPaused = !!msg.paused;
      setTimeout(() => {
        const again = findVideo();
        if (!again || isPartyMedia(again) || !!again.paused === wantPaused) return;
        applying = true;
        quietUntil = Date.now() + 800;
        try {
          if (wantPaused) again.pause();
          else {
            const play = again.play();
            if (play && play.catch) play.catch(() => {});
          }
        } catch {
          /* ignore */
        }
        nudgePlayer({ paused: wantPaused, rate: msg.rate }, again.currentTime || target);
        setTimeout(() => {
          applying = false;
        }, 500);
      }, 500);
    }
  }

  function nudgePlayer(msg, target) {
    document.querySelectorAll("iframe").forEach((frame) => {
      try {
        frame.contentWindow.postMessage({ action: "seek", time: target }, "*");
        frame.contentWindow.postMessage({ action: msg.paused ? "pause" : "play" }, "*");
        if (msg.rate) frame.contentWindow.postMessage({ action: "setSpeed", speed: msg.rate }, "*");
      } catch {
        /* ignore */
      }
    });
  }

  function publishLocal(kind, gestured) {
    if (!IS_TOP && document.documentElement.getAttribute("data-wp-party") !== "1") return;
    const command = kind === "play" || kind === "pause" || kind === "seek" || kind === "rate";
    const user = !!(command && gestured);
    if (!user && Date.now() < quietUntil) return;
    const v = findVideo();
    if (!v || isCallVideo(v)) return;
    if (user) {
      hold = { paused: !!v.paused, time: v.currentTime || 0 };
      holdUntil = Date.now() + 3000;
      remoteHold = null;
    }
    const packet = {
      source: "wp-media",
      kind: user ? kind : "tick",
      user,
      time: v.currentTime || 0,
      paused: !!v.paused,
      rate: v.playbackRate || 1,
      score: videoScore(v) || v.videoWidth * v.videoHeight || 1,
      href: location.origin + location.pathname,
    };
    if (IS_TOP) ingestMedia(packet, false);
    else {
      try {
        window.parent.postMessage(packet, "*");
      } catch {
        /* ignore */
      }
    }
  }

  function ingestMedia(d, fromChild) {
    const local = findVideo();
    const localScore = local && !isCallVideo(local) ? videoScore(local) : 0;
    if (fromChild && localScore > 0) return;
    if (fromChild) {
      const score = Number(d.score) || 0;
      const fresh = Date.now() - mediaPick.at < 2500;
      if (fresh && score + 1 < mediaPick.score && d.href !== mediaPick.href) return;
      mediaPick = { score, at: Date.now(), href: d.href || "" };
    }
    const user = !!d.user && (d.kind === "play" || d.kind === "pause" || d.kind === "seek" || d.kind === "rate");
    if (adPlaying()) return;
    if (!user && Date.now() < quietUntil) return;
    const body = { paused: !!d.paused, time: Number(d.time) || 0, rate: Number(d.rate) || 1 };
    if (!user && hold && Date.now() < holdUntil && !!body.paused !== !!hold.paused) return;
    lastMedia = body;
    if (!user) lastNotedTime = body.time;
    if (!role) return;
    const wire = { ...body, url: cleanUrl(location.href), at: Date.now() };
    if (!user) {
      if (role === "host") sendAll({ t: "state", beat: true, ...wire });
      return;
    }
    quietUntil = Date.now() + 1800;
    hold = body;
    holdUntil = Date.now() + 3000;
    sendAll(role === "host" ? { t: "state", ...wire } : { t: "control", ...wire });
    noteAction(d.kind, body);
  }

  function onVideoEvent(ev) {
    if (applying || isCallVideo(ev.currentTarget)) return;
    const kind = ev.type === "seeked" ? "seek" : ev.type === "ratechange" ? "rate" : ev.type;
    const gestured = !!ev.isTrusted || Date.now() < gestureUntil;
    if (!gestured && remoteHold && Date.now() < remoteHold.until && remoteHold.paused && kind === "play") {
      if (Date.now() > relockAt) {
        relockAt = Date.now() + 600;
        applying = true;
        try {
          ev.currentTarget.pause();
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          applying = false;
        }, 400);
      }
      return;
    }
    publishLocal(kind, gestured);
  }

  function reportBuffer(d) {
    if (!IS_TOP) {
      try {
        window.parent.postMessage(d, "*");
      } catch {
        /* ignore */
      }
      return;
    }
    if (!role) return;
    const waiting = !!d.waiting;
    quietUntil = Date.now() + (waiting ? 2000 : 1200);
    sendAll({
      t: "buffer",
      waiting,
      time: Number(d.time) || 0,
      paused: waiting,
      rate: Number(d.rate) || 1,
    });
    addChat("", waiting ? `${name} is buffering` : "Playback resumed", true);
  }

  function noteBuffer(waiting, v) {
    if (applying || !v || isCallVideo(v)) return;
    if (waiting) {
      if (bufferTimer || buffering) return;
      bufferTimer = setTimeout(() => {
        bufferTimer = null;
        if (!v || (v.readyState >= 3 && !v.seeking)) return;
        buffering = true;
        reportBuffer({ source: "wp-buffer", waiting: true, time: v.currentTime || 0, rate: v.playbackRate || 1 });
      }, 400);
      return;
    }
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      bufferTimer = null;
    }
    if (!buffering) return;
    buffering = false;
    reportBuffer({ source: "wp-buffer", waiting: false, time: v.currentTime || 0, rate: v.playbackRate || 1 });
  }

  function onBufferEvent(ev) {
    const waiting = ev.type === "waiting" || ev.type === "stalled";
    noteBuffer(waiting, ev.currentTarget);
  }

  function bindVideo(v) {
    if (!v || isPartyMedia(v)) return;
    if (v === boundVideo) return;
    unbindVideo();
    boundVideo = v;
    ["play", "pause", "seeked", "ratechange"].forEach((ev) => v.addEventListener(ev, onVideoEvent, true));
    ["waiting", "stalled", "playing", "canplay"].forEach((ev) => v.addEventListener(ev, onBufferEvent, true));
  }

  function unbindVideo() {
    if (!boundVideo) return;
    ["play", "pause", "seeked", "ratechange"].forEach((ev) => boundVideo.removeEventListener(ev, onVideoEvent, true));
    ["waiting", "stalled", "playing", "canplay"].forEach((ev) => boundVideo.removeEventListener(ev, onBufferEvent, true));
    boundVideo = null;
  }

  let stageEl = null;
  let fsPrevOpen = true;
  let layoutKey = "";
  let selfResize = false;

  function fsEl() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function railWidth() {
    if (!overlay || overlay.classList.contains("wp-min") || overlay.classList.contains("wp-pop") || overlay.classList.contains("wp-infs")) return 0;
    return SIDEBAR_W;
  }

  function clearFitMarks() {
    document.querySelectorAll("[data-wp-fit]").forEach((el) => el.removeAttribute("data-wp-fit"));
  }

  function restoreReframe() {
    const html = document.documentElement;
    html.classList.remove("wp-reflow");
    clearFitMarks();
  }

  // Never touch the site's <video>: only mark wide/pinned ancestors so a stylesheet
  // (not inline styles) narrows them. Removing the attribute restores the site exactly.
  function markFit(v) {
    let el = v?.parentElement;
    for (let i = 0; i < 12 && el && el !== document.body && el !== document.documentElement; i += 1, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const pinned = cs.position === "fixed";
      const wide = r.width > innerWidth - SIDEBAR_W - 4;
      if (pinned) el.setAttribute("data-wp-fit", "pin");
      else if (wide) el.setAttribute("data-wp-fit", "1");
    }
  }

  function nudgeLayout(key) {
    if (key === layoutKey) return;
    layoutKey = key;
    requestAnimationFrame(() => {
      selfResize = true;
      try {
        window.dispatchEvent(new Event("resize"));
      } finally {
        selfResize = false;
      }
    });
  }

  function applyReframe() {
    if (!IS_TOP) return;
    const html = document.documentElement;
    if (!overlay || !role) {
      restoreReframe();
      html.style.removeProperty("--wp-rail");
      return;
    }
    const rail = railWidth();
    html.style.setProperty("--wp-rail", `${rail}px`);
    const host = fsEl();
    if (stageEl || (host && host !== html) || !rail) {
      restoreReframe();
      nudgeLayout(`${rail}|${stageEl ? "stage" : host ? "fs" : "page"}`);
      return;
    }
    html.classList.add("wp-reflow");
    clearFitMarks();
    markFit(findVideo());
    nudgeLayout(`${rail}|page`);
  }

  function partyNodes() {
    return [overlay, document.getElementById("watchparty-cams"), document.getElementById("watchparty-voice")].filter(Boolean);
  }

  function mountShell() {
    if (!overlay) return;
    const host = fsEl();
    const home = document.documentElement;
    const inside = host && host !== home && host.tagName !== "VIDEO" && host.tagName !== "IFRAME";
    const parent = inside ? host : home;
    partyNodes().forEach((node) => {
      try {
        if (node.parentElement !== parent) parent.appendChild(node);
      } catch {
        home.appendChild(node);
      }
    });
    applyReframe();
  }

  function playerRoot(v) {
    if (!v) return null;
    const known = v.closest("#movie_player, .html5-video-player, .video-js, .jwplayer, .plyr, .shaka-video-container, .vjs-player, [data-testid='video-player']");
    if (known) return known;
    const vr = v.getBoundingClientRect();
    let best = v.parentElement || v;
    for (let el = v.parentElement, i = 0; i < 8 && el && el !== document.body; i += 1, el = el.parentElement) {
      const r = el.getBoundingClientRect();
      if (r.width > vr.width * 1.2 + 40 || r.height > vr.height * 1.3 + 80) break;
      best = el;
    }
    return best;
  }

  function biggestIframe() {
    let best = null;
    let area = 0;
    document.querySelectorAll("iframe").forEach((f) => {
      const r = f.getBoundingClientRect();
      if (r.width > 240 && r.height > 135 && r.width * r.height > area) {
        area = r.width * r.height;
        best = f;
      }
    });
    return best;
  }

  function stageTarget() {
    const v = findVideo();
    if (v && videoScore(v) > 0) return playerRoot(v);
    return document.querySelector("iframe[data-testid='player-iframe'], iframe#vidup-player") || biggestIframe() || (v ? playerRoot(v) : null);
  }

  function frameFsState(on) {
    if (stageEl?.tagName !== "IFRAME") return;
    try {
      stageEl.contentWindow.postMessage({ source: "wp-fs-state", on: !!on }, "*");
    } catch {
      /* ignore */
    }
  }

  // "Fullscreen with chat": fullscreen the page, pin the site's whole player (with its
  // own controls) to the left, and keep the party panel docked on the right.
  function enterStage(target) {
    if (!IS_TOP) return;
    target = target || stageTarget();
    if (!target) {
      addChat("", "No video found on this page yet. Press play first.", true);
      return;
    }
    if (stageEl && stageEl !== target) stageEl.removeAttribute("data-wp-stage");
    stageEl = target;
    target.setAttribute("data-wp-stage", "");
    document.documentElement.classList.add("wp-stage");
    if (overlay?.classList.contains("wp-pop")) setChatPop(false);
    const html = document.documentElement;
    if (fsEl() !== html) {
      const req = html.requestFullscreen || html.webkitRequestFullscreen;
      try {
        const pending = req?.call(html);
        if (pending?.catch) pending.catch(() => exitStage(false));
      } catch {
        exitStage(false);
        return;
      }
    }
    mountShell();
    refreshOverlay();
  }

  function exitStage(leaveFullscreen) {
    if (!stageEl && !document.documentElement.classList.contains("wp-stage")) return;
    frameFsState(false);
    stageEl?.removeAttribute("data-wp-stage");
    stageEl = null;
    document.documentElement.classList.remove("wp-stage");
    if (leaveFullscreen && fsEl()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      try {
        const pending = exit?.call(document);
        if (pending?.catch) pending.catch(() => {});
      } catch {
        /* ignore */
      }
    }
    mountShell();
    refreshOverlay();
  }

  function toggleStage() {
    if (stageEl) exitStage(true);
    else enterStage();
  }

  function clampBox(x, y, w, h) {
    const m = 8;
    return [
      Math.min(Math.max(m, x), Math.max(m, window.innerWidth - w - m)),
      Math.min(Math.max(m, y), Math.max(m, window.innerHeight - h - m)),
    ];
  }

  function placePill(x, y) {
    const pill = overlay?.querySelector(".wp-pill");
    if (!pill) return;
    pill.classList.add("wp-placed");
    const r = pill.getBoundingClientRect();
    const [cx, cy] = clampBox(x, y, r.width || 50, r.height || 50);
    pill.style.left = `${cx}px`;
    pill.style.top = `${cy}px`;
    pill._pos = { x: cx, y: cy };
  }

  // After the window shrinks, pull the float chat and the button back into view.
  function keepInView() {
    if (!overlay) return;
    if (overlay.classList.contains("wp-pop")) {
      const r = overlay.getBoundingClientRect();
      const w = Math.min(r.width, window.innerWidth - 16);
      const h = Math.min(r.height, window.innerHeight - 16);
      const [x, y] = clampBox(r.left, r.top, w, h);
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
      overlay.style.left = `${x}px`;
      overlay.style.top = `${y}px`;
    }
    const pill = overlay.querySelector(".wp-pill");
    if (pill?._pos) placePill(pill._pos.x, pill._pos.y);
  }

  function setChatPop(on) {
    if (!overlay) return;
    overlay.classList.toggle("wp-pop", !!on);
    if (on) {
      if (!overlay.style.width) overlay.style.width = "380px";
      if (!overlay.style.height) overlay.style.height = "540px";
      if (!overlay.style.left) {
        overlay.style.left = `${Math.max(16, window.innerWidth - 420)}px`;
        overlay.style.top = "24px";
      }
      overlay.style.right = "auto";
      overlay.style.bottom = "auto";
    } else {
      ["left", "top", "width", "height", "right", "bottom"].forEach((k) => (overlay.style[k] = ""));
    }
    if (on) keepInView();
    const pop = overlay.querySelector(".wp-popbtn");
    pop?.classList.toggle("on", !!on);
    pop?.setAttribute("aria-pressed", on ? "true" : "false");
    applyReframe();
  }

  // Site fullscreen (YouTube's own button, F key, etc.): leave the site's player alone and
  // float the party inside the fullscreen element as a collapsible drawer.
  function syncFullscreenChrome() {
    if (!IS_TOP || !overlay) return;
    const host = fsEl();
    const html = document.documentElement;
    if (stageEl && host !== html) exitStage(false);
    const inSite = !!host && host !== html && host.tagName !== "VIDEO" && host.tagName !== "IFRAME";
    const was = overlay.classList.contains("wp-infs");
    if (inSite && !was) {
      fsPrevOpen = !overlay.classList.contains("wp-min");
      fsWasPop = overlay.classList.contains("wp-pop");
      if (fsWasPop) setChatPop(false);
      overlay.classList.add("wp-infs");
      setPanelOpen(false);
    } else if (!inSite && was) {
      overlay.classList.remove("wp-infs");
      if (fsWasPop) setChatPop(true);
      setPanelOpen(fsWasPop ? true : fsPrevOpen);
    }
    mountShell();
  }

  function setPanelOpen(open) {
    if (!overlay) return;
    overlay.classList.toggle("wp-min", !open);
    if (open) {
      unread = 0;
      paintUnread();
      overlay.querySelectorAll(".wp-toast").forEach((t) => t.remove());
    }
    mountShell();
  }

  function focusChat() {
    setPanelOpen(true);
    overlay?.querySelector(".wp-input input")?.focus();
  }

  // ---------- unread + toasts ----------
  let unread = 0;
  function panelVisible() {
    return !!overlay && !overlay.classList.contains("wp-min") && document.visibilityState === "visible";
  }

  function paintUnread() {
    const b = overlay?.querySelector(".wp-badge");
    if (!b) return;
    b.textContent = unread > 9 ? "9+" : String(unread);
    b.classList.toggle("hidden", !unread);
  }

  function bumpUnread(from, text, face) {
    if (panelVisible()) return;
    unread += 1;
    paintUnread();
    if (!overlay?.classList.contains("wp-min")) return;
    const box = overlay.querySelector(".wp-toasts");
    if (!box) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "wp-toast";
    const body = document.createElement("span");
    const b = document.createElement("b");
    b.textContent = from || "Friend";
    const t = document.createElement("span");
    t.textContent = text;
    body.append(b, t);
    el.append(iconEl(face || iconFor(from)), body);
    el.addEventListener("click", () => focusChat());
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 260);
    }, 5200);
  }

  function paintConn() {
    const el = overlay?.querySelector(".wp-conn");
    if (!el) return;
    const label = { live: "Live", connecting: "Connecting", reconnecting: "Reconnecting", offline: "Offline" }[connState] || "Offline";
    el.dataset.state = connState;
    el.querySelector(".wp-conn-text").textContent = label;
    const banner = overlay.querySelector(".wp-banner");
    if (!banner) return;
    clearTimeout(paintConn.t);
    if (connState === "reconnecting") {
      banner.textContent = "Connection lost. Reconnecting… your video keeps playing.";
      banner.dataset.kind = "warn";
      banner.classList.remove("hidden");
    } else if (connState === "live" && paintConn.wasDown) {
      banner.textContent = "Back in the party.";
      banner.dataset.kind = "ok";
      banner.classList.remove("hidden");
      paintConn.t = setTimeout(() => banner.classList.add("hidden"), 2400);
    } else banner.classList.add("hidden");
    paintConn.wasDown = connState === "reconnecting";
  }
  connListeners.add(paintConn);

  function ensureOverlay() {
    if (!IS_TOP) return null;
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "watchparty-root";
    setMarkup(overlay, `
      <div class="wp-float" aria-hidden="true"></div>
      <div class="wp-toasts" aria-live="polite"></div>
      <button class="wp-pill" type="button" aria-label="Open WatchParty" title="Open WatchParty (${/Mac/i.test(navigator.platform) ? "⌥⇧W" : "Alt+Shift+W"})">
        <span class="wp-pill-mark">${ICON.logo}</span><span class="wp-badge hidden"></span>
      </button>
      <div class="wp-panel" role="complementary" aria-label="WatchParty">
        <div class="wp-head">
          <span class="wp-mark" aria-hidden="true">${ICON.logo}</span>
          <span class="wp-brand">
            <span class="wp-title">WatchParty</span>
            <span class="wp-conn" data-state="offline"><i></i><span class="wp-conn-text">Offline</span></span>
          </span>
          <button class="wp-code" type="button" title="Copy invite link"><span class="wp-lock hidden" title="End-to-end encrypted: only people with the full code can read chat, voice notes and reactions" aria-label="End-to-end encrypted">🔒</span><span class="wp-code-text">------</span><span class="wp-code-hint">${ICON.link}</span></button>
          <button class="wp-icon-btn wp-morebtn" type="button" aria-expanded="false" aria-label="Party settings" title="Settings">${ICON.sliders}</button>
          <button class="wp-icon-btn wp-collapse" type="button" aria-label="Hide panel" title="Hide panel (${/Mac/i.test(navigator.platform) ? "⌥⇧W" : "Alt+Shift+W"})">${ICON.right}</button>
        </div>
        <div class="wp-banner hidden" role="status"></div>
        <div class="wp-more hidden">
          <div class="wp-sec">
            <div class="wp-sec-title">You</div>
            <label class="wp-name"><input class="wp-name-input" maxlength="24" placeholder="Your name" autocomplete="nickname" aria-label="Your name" /></label>
            <div class="wp-faces" role="group" aria-label="Avatar"></div>
          </div>
          <div class="wp-sec">
            <div class="wp-sec-title">View</div>
            <div class="wp-tools">
              <button type="button" data-act="full" aria-pressed="false">${ICON.expand}<span>Fullscreen with chat</span></button>
              <button class="wp-popbtn" type="button" aria-pressed="false">${ICON.pop}<span>Float chat</span></button>
              <button type="button" data-act="floatvid">${ICON.video}<span>Video call</span></button>
              <button type="button" class="wp-selfbtn" data-act="self" aria-pressed="false">${ICON.user}<span>Show my camera</span></button>
            </div>
            <div class="wp-queen hidden" role="group" aria-label="Queen check">
              <div class="wp-queen-crown" aria-hidden="true">👑</div>
              <div class="wp-queen-title">Royal mirror</div>
              <p>Seeing yourself on screen is reserved for the queen. Are you her?</p>
              <button type="button" data-act="queen">Yes, I'm the queen 👑</button>
              <button type="button" data-act="queen-no">Not now</button>
            </div>
          </div>
          <button type="button" class="wp-leave-party" data-act="leave-party">Leave party</button>
        </div>
        <div class="wp-people" aria-label="People in the party"></div>
        <div class="wp-ring hidden" role="alert">
          <span class="wp-ring-icon">${ICON.phone}</span>
          <span class="wp-ring-text">Incoming call</span>
          <button type="button" data-act="accept">Join</button>
          <button type="button" data-act="decline">Decline</button>
        </div>
        <div class="wp-body">
          <div class="wp-call idle"><span class="wp-live"></span><span class="wp-call-text"></span></div>
          <div class="wp-meet">
            <button type="button" data-act="mic"><span class="wp-ico">${ICON.mic}</span><span class="wp-lbl">Mic</span></button>
            <button type="button" data-act="cam"><span class="wp-ico">${ICON.cam}</span><span class="wp-lbl">Camera</span></button>
            <button type="button" data-act="hang"><span class="wp-ico">${ICON.hang}</span><span class="wp-lbl">End call</span></button>
          </div>
        </div>
        <div class="wp-chat" role="log" aria-live="polite"></div>
        <div class="wp-compose">
          <button type="button" class="wp-love" aria-label="Send love" title="Send love">
            <span class="wp-love-heart" aria-hidden="true">💖</span><span>Send love</span>
          </button>
          <div class="wp-emojis">${QUICK.map((_, i) => `<button type="button" class="wp-emo" data-react="${i}" title="React on the video"></button>`).join("")}</div>
          <div class="wp-picker hidden">${CHAT_EMOJIS.map((_, i) => `<button type="button" class="wp-emo" data-insert="${i}"></button>`).join("")}</div>
          <form class="wp-input">
            <button type="button" class="wp-tool wp-emoji-btn" aria-label="Insert emoji" title="Emoji">${ICON.smile}</button>
            <input maxlength="240" placeholder="Message the party" aria-label="Message the party" />
            <button type="button" class="wp-tool wp-voice-btn" aria-label="Record a voice message" title="Voice message (up to 20s)">${ICON.mic}</button>
            <button type="submit" class="wp-send" aria-label="Send">${ICON.send}</button>
          </form>
        </div>
        <div class="wp-resize" title="Resize" aria-hidden="true"></div>
      </div>`);
    document.documentElement.appendChild(overlay);
    // Ignore clicks the website fakes with scripts: only real user clicks reach our buttons.
    ["click", "pointerdown", "submit"].forEach((ev) =>
      overlay.addEventListener(
        ev,
        (e) => {
          if (!e.isTrusted) {
            e.stopImmediatePropagation();
            e.preventDefault();
          }
        },
        true
      )
    );
    // Keep the site's own keyboard shortcuts from firing while typing in the party.
    ["keydown", "keyup", "keypress"].forEach((ev) =>
      overlay.addEventListener(ev, (e) => {
        if (e.target.closest?.("input, textarea")) e.stopPropagation();
      })
    );
    overlay.querySelector(".wp-code").addEventListener("click", async () => {
      if (!code) return;
      const link = inviteLink();
      try {
        await navigator.clipboard.writeText(link);
      } catch {
        return;
      }
      const btn = overlay.querySelector(".wp-code");
      btn.classList.remove("copied");
      void btn.offsetWidth;
      btn.classList.add("copied");
      clearTimeout(btn._t);
      btn._t = setTimeout(() => btn.classList.remove("copied"), 1600);
    });
    overlay.querySelector(".wp-morebtn").addEventListener("click", () => {
      const more = overlay.querySelector(".wp-more");
      const btn = overlay.querySelector(".wp-morebtn");
      const open = more.classList.toggle("hidden") === false;
      btn.classList.toggle("on", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    overlay.querySelector(".wp-collapse").addEventListener("click", () => setPanelOpen(false));
    const pill = overlay.querySelector(".wp-pill");
    pill.addEventListener("click", () => {
      if (pill._dragged) {
        pill._dragged = false;
        return;
      }
      setPanelOpen(true);
    });
    pill.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const r = pill.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const sx = e.clientX;
      const sy = e.clientY;
      let dragging = false;
      pill.setPointerCapture(e.pointerId);
      const move = (ev) => {
        if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        dragging = true;
        placePill(ev.clientX - ox, ev.clientY - oy);
      };
      const up = (ev) => {
        pill.removeEventListener("pointermove", move);
        pill.removeEventListener("pointerup", up);
        pill.removeEventListener("pointercancel", up);
        try {
          pill.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        if (dragging) {
          pill._dragged = true;
          safeSet({ wpPill: pill._pos });
        }
      };
      pill.addEventListener("pointermove", move);
      pill.addEventListener("pointerup", up);
      pill.addEventListener("pointercancel", up);
    });
    const grip = overlay.querySelector(".wp-resize");
    grip.addEventListener("pointerdown", (e) => {
      if (!overlay.classList.contains("wp-pop")) return;
      e.preventDefault();
      e.stopPropagation();
      grip.setPointerCapture(e.pointerId);
      const r = overlay.getBoundingClientRect();
      const move = (ev) => {
        const w = Math.min(Math.max(300, ev.clientX - r.left), window.innerWidth - r.left - 8);
        const h = Math.min(Math.max(360, ev.clientY - r.top), window.innerHeight - r.top - 8);
        overlay.style.width = `${w}px`;
        overlay.style.height = `${h}px`;
      };
      const up = (ev) => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        try {
          grip.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    overlay.querySelector(".wp-popbtn").addEventListener("click", () => {
      const next = !overlay.classList.contains("wp-pop");
      overlay.dataset.userPop = next ? "1" : "0";
      if (next && stageEl) exitStage(true);
      setChatPop(next);
    });
    const head = overlay.querySelector(".wp-head");
    head.addEventListener("pointerdown", (e) => {
      if (!overlay.classList.contains("wp-pop") || e.target.closest("button")) return;
      e.preventDefault();
      head.setPointerCapture(e.pointerId);
      const r = overlay.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const move = (ev) => {
        const [x, y] = clampBox(ev.clientX - ox, ev.clientY - oy, r.width, r.height);
        overlay.style.left = `${x}px`;
        overlay.style.top = `${y}px`;
        overlay.style.right = "auto";
        overlay.style.bottom = "auto";
      };
      const up = (ev) => {
        head.removeEventListener("pointermove", move);
        head.removeEventListener("pointerup", up);
        try {
          head.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      head.addEventListener("pointermove", move);
      head.addEventListener("pointerup", up);
    });
    mountShell();
    applyReframe();
    overlay.querySelector("form").addEventListener("submit", (e) => {
      e.preventDefault();
      const input = overlay.querySelector(".wp-input input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      sendChat(text);
    });
    overlay.querySelector(".wp-name-input").addEventListener("change", (e) => publishName(e.target.value));
    overlay.querySelector(".wp-name-input").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      publishName(e.target.value);
    });
    storageGet(["wpName", "wpIcon", "wpPill"]).then(({ wpName, wpIcon, wpPill }) => {
      if (wpPill && Number.isFinite(wpPill.x) && Number.isFinite(wpPill.y)) placePill(wpPill.x, wpPill.y);
      const input = overlay.querySelector(".wp-name-input");
      if (wpName && input && !input.value) input.value = wpName;
      if (wpName && !role) name = wpName;
      if (wpIcon) icon = iconOr(wpIcon);
      paintFaces();
      paintPeople();
    });
    overlay.querySelector('[data-act="mic"]').addEventListener("click", () => toggleMic());
    overlay.querySelector('[data-act="cam"]').addEventListener("click", () => toggleCam());
    overlay.querySelector('[data-act="self"]').addEventListener("click", () => toggleSelf());
    overlay.querySelector('[data-act="leave-party"]').addEventListener("click", () => leaveParty());
    overlay.querySelector('[data-act="queen"]').addEventListener("click", () => acceptQueen());
    overlay.querySelector('[data-act="queen-no"]').addEventListener("click", () => {
      overlay.querySelector(".wp-queen")?.classList.add("hidden");
    });
    overlay.querySelector('[data-act="hang"]').addEventListener("click", () => {
      if (inCall) hangUp(true);
    });
    overlay.querySelector('[data-act="floatvid"]').addEventListener("click", () => toggleFloatVideo());
    overlay.querySelector('[data-act="full"]').addEventListener("click", () => toggleStage());
    overlay.querySelector('[data-act="accept"]').addEventListener("click", () => acceptCall());
    overlay.querySelector('[data-act="decline"]').addEventListener("click", () => declineCall());
    overlay.querySelector(".wp-emoji-btn").addEventListener("click", () => {
      overlay.querySelector(".wp-picker").classList.toggle("hidden");
    });
    overlay.querySelector(".wp-voice-btn").addEventListener("click", () => toggleVoiceNote());
    overlay.querySelector(".wp-love").addEventListener("click", () => sendLove());
    overlay.querySelectorAll("[data-react]").forEach((btn) => {
      const emoji = QUICK[Number(btn.dataset.react)];
      btn.textContent = emoji;
      btn.addEventListener("click", () => sendReact(emoji));
    });
    overlay.querySelectorAll("[data-insert]").forEach((btn) => {
      const emoji = CHAT_EMOJIS[Number(btn.dataset.insert)];
      btn.textContent = emoji;
      btn.addEventListener("click", () => insertChatEmoji(emoji));
    });
    paintConn();
    syncFullscreenChrome();
    return overlay;
  }

  function refreshOverlay() {
    if (!overlay || !code) return;
    const badge = overlay.querySelector(".wp-code-text");
    if (badge) badge.textContent = code || "------";
    overlay.querySelector(".wp-lock")?.classList.toggle("hidden", !e2eKey);
    const full = overlay.querySelector('[data-act="full"]');
    if (full) {
      full.classList.toggle("on", !!stageEl);
      full.setAttribute("aria-pressed", stageEl ? "true" : "false");
      full.querySelector("span").textContent = stageEl ? "Exit fullscreen" : "Fullscreen with chat";
    }
    paintConn();
    paintPeople();
    paintFaces();
    paintControl("mic", !inCall ? "Mic" : callAudioOn ? "Mic on" : "Muted", !inCall ? "" : callAudioOn ? "on" : "off");
    paintControl("cam", !inCall ? "Camera" : callVideoOn ? "Cam on" : "Cam off", !inCall ? "" : callVideoOn ? "on" : "off");
    paintControl("hang", "End call", inCall ? "hot" : "");
    const hang = overlay.querySelector('[data-act="hang"]');
    if (hang) hang.disabled = !inCall;
    const callLine = overlay.querySelector(".wp-call");
    const callText = overlay.querySelector(".wp-call-text");
    if (callLine && callText) {
      let mode = "idle";
      let text = selfView ? "Your camera preview is on." : "Talk or turn on your camera. Nothing is shared until you do.";
      if (inCall) {
        const phase = voicePhase();
        if (phase === "live") {
          mode = "live";
          text = callAudioOn ? "Voice connected" : "Voice connected · you are muted";
        } else if (knownIds.size > 1) {
          mode = "wait";
          text = "Connecting voice…";
        } else {
          mode = "wait";
          text = "Waiting for a friend to join the call";
        }
        if (callVideoOn) text += " · camera on for them";
      }
      callLine.classList.remove("idle", "live", "wait");
      callLine.classList.add(mode);
      callText.textContent = text;
    }
    const selfBtn = overlay.querySelector('[data-act="self"]');
    if (selfBtn) {
      selfBtn.querySelector("span").textContent = selfView ? "Hide my camera" : "Show my camera";
      selfBtn.classList.toggle("on", selfView);
      selfBtn.setAttribute("aria-pressed", selfView ? "true" : "false");
    }
    const floatBtn = overlay.querySelector('[data-act="floatvid"]');
    if (floatBtn) {
      const showing = friendPopupsOpen();
      floatBtn.querySelector("span").textContent = !inCall ? "Start video call" : showing ? "Hide call video" : "Show call video";
      floatBtn.classList.toggle("on", showing);
    }
    paintVoiceBadge();
    const nameInput = overlay.querySelector(".wp-name-input");
    if (nameInput && document.activeElement !== nameInput && nameInput.value !== name) nameInput.value = name;
  }

  function paintControl(act, label, mode) {
    const btn = overlay?.querySelector(`[data-act="${act}"]`);
    if (!btn) return;
    const lbl = btn.querySelector(".wp-lbl");
    if (lbl) lbl.textContent = label;
    btn.classList.toggle("on", mode === "on");
    btn.classList.toggle("off", mode === "off");
    btn.classList.toggle("hot", mode === "hot");
    if (act !== "hang") btn.setAttribute("aria-pressed", mode === "on" ? "true" : "false");
  }

  function paintPeople() {
    const box = overlay?.querySelector(".wp-people");
    if (!box) return;
    box.replaceChildren();
    const list = [...people.values()].map((entry) =>
      entry && typeof entry === "object"
        ? { name: entry.name || "Friend", icon: iconOr(entry.icon), queen: !!entry.queen }
        : { name: String(entry || "Friend"), icon: "fox" }
    );
    if (!list.length) list.push({ name: name || "You", icon });
    list.forEach((person) => {
      const chip = document.createElement("span");
      chip.className = person.name === name ? "wp-chip me" : "wp-chip";
      const label = document.createElement("span");
      label.textContent = person.name;
      chip.append(iconEl(person.icon), label);
      if (person.queen) chip.appendChild(crownEl());
      box.appendChild(chip);
    });
  }

  function paintFaces() {
    const box = overlay?.querySelector(".wp-faces");
    if (!box) return;
    box.replaceChildren();
    (globalThis.WP_ICONS?.ids || []).forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wp-face-btn" + (id === icon ? " on" : "");
      btn.title = id;
      btn.setAttribute("aria-label", `Avatar ${id}`);
      btn.setAttribute("aria-pressed", id === icon ? "true" : "false");
      btn.appendChild(iconEl(id));
      btn.addEventListener("click", () => chooseIcon(id));
      box.appendChild(btn);
    });
  }

  function chooseIcon(next) {
    const picked = iconOr(next);
    if (picked === icon) return;
    icon = picked;
    safeSet({ wpIcon: icon });
    const me = people.get("me");
    if (me && typeof me === "object") me.icon = icon;
    else people.set("me", { name, icon, queen: queenOk });
    if (role) sendAll({ t: "rename", name, icon });
    refreshOverlay();
  }

  function voicePhase() {
    if (!inCall) return "off";
    if (iceLive.size) return "live";
    return "wait";
  }

  function friendVideoLive() {
    for (const [id, stream] of remoteStreams) {
      if (!id || id === "local") continue;
      const info = remoteAv.get(id);
      if (info && !info.video) continue;
      if (stream.getVideoTracks().some((track) => track.readyState === "live")) return true;
    }
    return false;
  }

  function friendPopupsOpen() {
    return !!(inCall && !videoPopHidden && friendVideoLive());
  }

  function paintVoiceBadge() {
    let el = document.getElementById("watchparty-voice");
    if (!el) {
      el = document.createElement("div");
      el.id = "watchparty-voice";
      el.className = "hidden";
      setMarkup(el, `<span class="wp-mic-dot"></span><span class="wp-voice-text"></span>`);
      document.documentElement.appendChild(el);
    }
    const show = inCall && !friendPopupsOpen() && !document.querySelector("#watchparty-cams .wp-cam-bubble");
    el.classList.toggle("hidden", !show);
    enableVoiceDrag(el);
    el.classList.remove("live", "wait");
    if (!show) return;
    const phase = voicePhase();
    const text = el.querySelector(".wp-voice-text");
    if (phase === "live") {
      el.classList.add("live");
      const who = [...remoteAv.values()].map((info) => info?.name).filter(Boolean);
      if (text) text.textContent = who.length ? `Voice connected · ${who.join(", ")}` : "Voice connected";
    } else {
      el.classList.add("wait");
      if (text) text.textContent = knownIds.size > 1 ? "Connecting voice…" : "Voice on · waiting for a friend";
    }
  }

  function enableVoiceDrag(el) {
    if (!el || el.dataset.drag === "1") return;
    el.dataset.drag = "1";
    el.addEventListener("pointerdown", (e) => {
      if (el.classList.contains("hidden")) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const move = (ev) => {
        const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, ev.clientX - ox));
        const top = Math.min(window.innerHeight - rect.height - 8, Math.max(8, ev.clientY - oy));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = "auto";
      };
      const up = (ev) => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        try {
          el.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }

  function refreshCallWindows() {
    remoteStreams.forEach((stream, id) => {
      if (id !== "local") presentCall(id, stream, false);
    });
    if (localStream) presentCall("local", localStream, true);
  }

  async function enableSelfView() {
    selfView = true;
    if (!inCall) await joinCall(true, true);
    else if (!callVideoOn) await toggleCam();
    else if (localStream) presentCall("local", localStream, true);
    const live = localStream?.getVideoTracks().some((track) => track.readyState === "live" && track.enabled);
    if (!live) {
      selfView = false;
      dropTile("local");
    }
    refreshOverlay();
  }

  function acceptQueen() {
    queenOk = true;
    safeSet({ wpQueen: true });
    overlay?.querySelector(".wp-queen")?.classList.add("hidden");
    people.set("me", { name, icon, queen: true });
    if (role) {
      sendAll({ t: "rename", name, icon, queen: true });
      sendSecure("react", { emoji: "👑" }, { t: "react", name, emoji: "👑" });
    }
    royalBurst();
    addChat("", "Welcome, your majesty 👑", true);
    refreshOverlay();
    enableSelfView();
  }

  function royalBurst() {
    ["👑", "💖", "✨", "💜", "👑", "💕", "✨"].forEach((emoji, i) => {
      setTimeout(() => floatEmoji(emoji, i === 0 ? name : ""), i * 140);
    });
  }

  function toggleSelf() {
    if (!role) {
      addChat("", "Start or join a party before using the camera.", true);
      return;
    }
    if (selfView) {
      selfView = false;
      dropTile("local");
      refreshOverlay();
      return;
    }
    if (!queenOk) {
      const more = overlay?.querySelector(".wp-more");
      more?.classList.remove("hidden");
      overlay?.querySelector(".wp-morebtn")?.setAttribute("aria-expanded", "true");
      overlay?.querySelector(".wp-queen")?.classList.remove("hidden");
      overlay?.querySelector('[data-act="queen"]')?.focus();
      return;
    }
    enableSelfView();
  }

  let audioCtx = null;
  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    const pending = audioCtx.resume?.();
    if (pending?.catch) pending.catch(() => {});
  }

  async function toggleFloatVideo() {
    unlockAudio();
    if (!role) {
      addChat("", "Start or join a party before opening video.", true);
      return;
    }
    if (!inCall) {
      videoPopHidden = false;
      await joinCall(true, true);
      return;
    }
    if (friendPopupsOpen()) {
      videoPopHidden = true;
      refreshCallWindows();
      refreshOverlay();
      return;
    }
    videoPopHidden = false;
    const friendHasVideo = friendVideoLive() || [...remoteAv.values()].some((info) => info?.video);
    if (!callVideoOn && !friendHasVideo) {
      await toggleCam();
      if (callVideoOn) addChat("", "Your camera is on. Only your friend sees it.", true);
      return;
    }
    refreshCallWindows();
    refreshOverlay();
  }

  function publishName(raw) {
    const next = String(raw || "").trim().slice(0, 24);
    if (!next) return;
    const prev = name;
    name = next;
    safeSet({ wpName: next });
    const input = overlay?.querySelector(".wp-name-input");
    if (input && input.value !== next) input.value = next;
    people.set("me", { name, icon, queen: queenOk });
    refreshOverlay();
    if (!role || next === prev) return;
    sendAll({ t: "rename", name: next, icon });
    addChat("", `${prev} is now ${next}`, true);
  }

  function setRoster(list) {
    const rows = (list || [])
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === "string") return { name: entry, icon: "fox" };
        return { name: String(entry.name || "Friend").slice(0, 24), icon: iconOr(entry.icon), queen: !!entry.queen };
      })
      .filter(Boolean);
    const mine = rows.findIndex((row) => row.name === name);
    if (mine >= 0) rows.splice(mine, 1);
    people = new Map();
    rows.forEach((row, i) => people.set(`u${i}`, row));
    people.set("me", { name, icon, queen: queenOk });
  }

  function sendChat(text) {
    addChat(name, text, false);
    sendSecure("chat", { text }, { t: "chat", name, text });
  }

  let lastLove = 0;
  function sendLove() {
    if (!role) return;
    const now = Date.now();
    if (now - lastLove < 2000) return;
    lastLove = now;
    sendSecure("love", {}, { t: "love", name });
    loveShower(false);
    const btn = overlay?.querySelector(".wp-love");
    if (btn) {
      btn.classList.remove("sent");
      void btn.offsetWidth;
      btn.classList.add("sent");
    }
    addChat("", "You sent love 💖", true);
  }

  // A full-width rain of hearts. Bigger and longer when love arrives than when you send it.
  function loveShower(incoming, from) {
    ensureOverlay();
    const layer = overlay?.querySelector(".wp-float");
    if (!layer || layer.childElementCount > 120) return;
    const hearts = ["💖", "💗", "💕", "❤️", "💘", "💞"];
    const count = incoming ? 26 : 10;
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement("div");
      el.className = "wp-burst wp-heart";
      const h = document.createElement("span");
      h.textContent = hearts[i % hearts.length];
      h.style.fontSize = `${(incoming ? 26 : 20) + Math.random() * (incoming ? 34 : 16)}px`;
      el.appendChild(h);
      el.style.left = `${2 + Math.random() * 94}%`;
      el.style.animationDelay = `${Math.random() * (incoming ? 1400 : 600)}ms`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    }
    if (!incoming) return;
    const note = document.createElement("div");
    note.className = "wp-love-note";
    note.textContent = `${from || "Someone"} sent you love 💖`;
    layer.appendChild(note);
    setTimeout(() => note.remove(), 3600);
  }

  function sendReact(emoji) {
    if (!emoji) return;
    floatEmoji(emoji, name);
    sendSecure("react", { emoji }, { t: "react", name, emoji });
  }

  function insertChatEmoji(emoji) {
    const input = overlay?.querySelector(".wp-input input");
    if (!input || !emoji) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.value = input.value.slice(0, start) + emoji + input.value.slice(end);
    const pos = start + emoji.length;
    input.focus();
    input.setSelectionRange(pos, pos);
  }

  function floatEmoji(emoji, from) {
    ensureOverlay();
    const layer = overlay?.querySelector(".wp-float");
    if (!layer || layer.childElementCount > 120) return;
    const el = document.createElement("div");
    el.className = "wp-burst";
    const emo = document.createElement("span");
    emo.textContent = emoji;
    el.appendChild(emo);
    if (from) {
      const who = document.createElement("span");
      who.className = "wp-burst-name";
      who.textContent = from;
      el.appendChild(who);
    }
    const x = 8 + Math.random() * 70;
    el.style.left = `${x}%`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 2300);
    if (["❤️", "🥰", "💕", "💖", "💜"].includes(emoji)) {
      for (let i = 0; i < 6; i += 1) {
        const mini = document.createElement("div");
        mini.className = "wp-burst wp-mini";
        const h = document.createElement("span");
        h.textContent = ["💗", "💕", "💖"][i % 3];
        mini.appendChild(h);
        mini.style.left = `${Math.max(2, Math.min(94, x + (Math.random() * 16 - 8)))}%`;
        mini.style.animationDelay = `${120 + i * 110}ms`;
        layer.appendChild(mini);
        setTimeout(() => mini.remove(), 2700 + i * 110);
      }
    }
  }

  function safeAudioMime(mime) {
    const base = String(mime || "audio/webm").split(";")[0].trim().toLowerCase();
    return /^audio\/(webm|ogg|mp4|mpeg|wav)$/.test(base) ? base : "audio/webm";
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function voiceClock(seconds) {
    const n = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
  }

  function addVoice(from, audio, mime) {
    ensureOverlay();
    const box = overlay?.querySelector(".wp-chat");
    if (!box || !/^[A-Za-z0-9+/=]+$/.test(audio || "") || audio.length > 300000) return;
    if (from && from !== name) bumpUnread(from, "Voice message", iconFor(from));
    const row = document.createElement("div");
    row.className = from === name ? "wp-msg wp-voice wp-mine" : "wp-msg wp-voice wp-theirs";
    const who = metaFor(from || name, from === name, from === name ? queenOk : queenFor(from));
    const player = document.createElement("audio");
    player.preload = "metadata";
    player.dataset.wpClip = "1";
    player.src = `data:${safeAudioMime(mime)};base64,${audio}`;
    const clip = document.createElement("div");
    clip.className = "wp-clip";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "wp-clip-play";
    setMarkup(play, ICON.play);
    const track = document.createElement("div");
    track.className = "wp-clip-track";
    const bars = document.createElement("div");
    bars.className = "wp-clip-bars";
    for (let i = 0; i < 26; i += 1) {
      const bar = document.createElement("i");
      bar.style.height = `${7 + ((i * 13) % 15)}px`;
      bars.appendChild(bar);
    }
    const fill = document.createElement("div");
    fill.className = "wp-clip-fill";
    track.append(bars, fill);
    const time = document.createElement("span");
    time.className = "wp-clip-time";
    time.textContent = "0:00";
    const body = document.createElement("div");
    body.append(who, clip);
    clip.append(play, track, time);
    row.append(iconEl(from === name ? icon : iconFor(from)), body, player);
    const paint = () => {
      const duration = player.duration;
      const ratio = duration ? player.currentTime / duration : 0;
      fill.style.width = `${Math.min(100, ratio * 100)}%`;
      time.textContent = voiceClock(player.paused && player.currentTime < 0.05 ? duration : player.currentTime || duration);
    };
    player.addEventListener("loadedmetadata", paint);
    player.addEventListener("timeupdate", paint);
    player.addEventListener("ended", () => {
      setMarkup(play, ICON.play);
      player.currentTime = 0;
      fill.style.width = "0%";
      time.textContent = voiceClock(player.duration);
    });
    play.addEventListener("click", () => {
      document.querySelectorAll("audio[data-wp-clip]").forEach((other) => {
        if (other !== player) other.pause();
      });
      if (player.paused) {
        player.play()?.catch(() => {});
        play.textContent = "II";
      } else {
        player.pause();
        setMarkup(play, ICON.play);
      }
    });
    track.addEventListener("click", (e) => {
      if (!player.duration) return;
      const rect = track.getBoundingClientRect();
      player.currentTime = Math.min(player.duration, Math.max(0, ((e.clientX - rect.left) / rect.width) * player.duration));
    });
    box.appendChild(row);
    const notes = box.querySelectorAll(".wp-voice");
    if (notes.length > 20) notes[0].remove();
    box.scrollTop = box.scrollHeight;
  }

  async function toggleVoiceNote() {
    const btn = overlay?.querySelector(".wp-voice-btn");
    if (voiceRec && voiceRec.state === "recording") {
      voiceRec.stop();
      return;
    }
    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      voiceChunks = [];
      voiceRec = new MediaRecorder(voiceStream, { mimeType: mime });
      voiceRec.ondataavailable = (e) => {
        if (e.data && e.data.size) voiceChunks.push(e.data);
      };
      voiceRec.onstop = async () => {
        clearTimeout(voiceTimer);
        voiceTimer = null;
        btn?.classList.remove("on");
        btn?.setAttribute("aria-label", "Record a voice message");
        voiceStream?.getTracks().forEach((track) => track.stop());
        voiceStream = null;
        const blob = new Blob(voiceChunks, { type: voiceRec.mimeType || "audio/webm" });
        voiceChunks = [];
        if (blob.size < 700) return;
        if (blob.size > 180000) {
          addChat("", "That voice message is too long. Keep it under 20 seconds.", true);
          return;
        }
        const audio = bufToB64(await blob.arrayBuffer());
        const type = safeAudioMime(blob.type);
        addVoice(name, audio, type);
        sendSecure("voice", { audio, mime: type }, { t: "voice", name, audio, mime: type });
      };
      voiceRec.start();
      btn?.classList.add("on");
      btn?.setAttribute("aria-label", "Stop and send voice message");
      voiceTimer = setTimeout(() => {
        if (voiceRec && voiceRec.state === "recording") voiceRec.stop();
      }, 20000);
    } catch (err) {
      voiceStream?.getTracks().forEach((track) => track.stop());
      voiceStream = null;
      addChat("", `Could not record: ${err.message}`, true);
    }
  }

  let ringCtx = null;
  let ringStop = null;
  function beep() {
    try {
      ringCtx = ringCtx || new AudioContext();
      const ctx = ringCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch {
      /* ignore */
    }
  }

  function showRing(from, video) {
    ensureOverlay();
    setPanelOpen(true);
    const ring = overlay.querySelector(".wp-ring");
    ring.classList.remove("hidden");
    overlay.querySelector(".wp-ring-text").textContent = `${from} is starting a ${video ? "video" : "voice"} call`;
    beep();
    clearInterval(ringTimer);
    ringTimer = setInterval(beep, 1600);
    clearTimeout(ringStop);
    ringStop = setTimeout(() => {
      if (!ringTimer) return;
      hideRing();
      addChat("", `Missed call from ${from}`, true);
    }, 30000);
  }

  function hideRing() {
    clearInterval(ringTimer);
    ringTimer = null;
    clearTimeout(ringStop);
    overlay?.querySelector(".wp-ring")?.classList.add("hidden");
    pendingInvite = null;
  }

  function makePeerId() {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const buf = new Uint8Array(12);
    crypto.getRandomValues(buf);
    return "wp" + [...buf].map((n) => alphabet[n % alphabet.length]).join("");
  }

  function iceConfig() {
    const iceServers = STUN.slice();
    if (turnCred?.urls?.length && turnCred.username && turnCred.credential && turnCred.exp > Date.now()) {
      iceServers.push({
        urls: turnCred.urls,
        username: turnCred.username,
        credential: turnCred.credential,
      });
    }
    // Behind a VPN, direct peer connections usually fail (and would bypass the VPN):
    // route calls only through the encrypted TURN relay instead.
    return (vpnActive || forceRelay) && turnCred ? { iceServers, iceTransportPolicy: "relay" } : { iceServers };
  }

  // PeerJS reads peer.options.config for every new connection, so refresh it before each
  // call/answer: relay credentials that arrived later are then used too.
  function applyIce() {
    if (peer?.options) peer.options.config = iceConfig();
  }

  function acceptTurn(msg) {
    const urls = Array.isArray(msg?.urls)
      ? msg.urls.filter((url) => /^turn:cp\.praivox\.com:3478\?transport=(udp|tcp)$/.test(url) || url === "turns:cp.praivox.com:5349?transport=tcp")
      : [];
    const username = String(msg?.username || "");
    const credential = String(msg?.credential || "");
    if (!urls.length) return;
    if (!/^\d{10}:wp$/.test(username)) return;
    if (!/^[A-Za-z0-9+/=]{20,88}$/.test(credential)) return;
    const expiry = Number(username.split(":")[0]) * 1000;
    if (expiry < Date.now() || expiry > Date.now() + 8 * 3600 * 1000) return;
    turnCred = { urls, username, credential, exp: expiry - 60000 };
  }

  function deliverTurn(msg) {
    acceptTurn(msg);
    const waiters = turnWaiters.splice(0);
    waiters.forEach((fn) => fn(turnCred));
  }

  function requestTurn() {
    if (turnCred && turnCred.exp > Date.now()) return Promise.resolve(turnCred);
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(turnCred), 4000);
      function finish(value) {
        clearTimeout(timer);
        resolve(value || null);
      }
      turnWaiters.push(finish);
      sendAll({ t: "turn" });
    });
  }

  async function ensureCallPeer() {
    if (peer && !peer.destroyed && peer.open) return peer;
    await requestTurn();
    const id = makePeerId();
    const signal = SIGNAL_SERVERS[0];
    peer = await newPeer(id, {
      host: signal.host,
      port: signal.port,
      path: signal.path,
      secure: signal.secure,
      config: iceConfig(),
    });
    wireIncomingCalls(peer);
    peer.on("disconnected", () => {
      try {
        peer.reconnect();
      } catch {
        /* ignore */
      }
    });
    return peer;
  }

  function broadcastAv() {
    if (!peer?.id) return;
    sendAll({ t: "av", peerId: peer.id, audio: !!callAudioOn, video: !!callVideoOn, name });
  }

  async function openCallMedia() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: callVideoOn ? { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: "user" } : false,
    });
    stream.getAudioTracks().forEach((track) => {
      track.enabled = callAudioOn;
    });
    localStream?.getTracks().forEach((track) => {
      if (!stream.getTracks().includes(track)) track.stop();
    });
    localStream = stream;
    wantMic = callAudioOn;
    wantCam = callVideoOn;
    presentCall("local", localStream, true);
  }

  async function joinCall(audio, video) {
    unlockAudio();
    callAudioOn = !!audio;
    callVideoOn = !!video;
    inCall = true;
    try {
      await openCallMedia();
      await ensureCallPeer();
      await requestTurn();
      applyIce();
      sendAll({ t: "peer", id: peer.id });
      if (!callStarted) {
        callStarted = true;
        sendAll({ t: "invite", name, video: callVideoOn });
        addChat("", "You joined the call. Mic and camera can each be turned off.", true);
      }
      broadcastAv();
      flushPendingCalls();
      meshCallAll();
      refreshOverlay();
    } catch (err) {
      inCall = false;
      callAudioOn = false;
      callVideoOn = false;
      refreshOverlay();
      addChat("", `Call failed: ${err.message}`, true);
    }
  }

  async function toggleMic() {
    unlockAudio();
    if (!role) {
      addChat("", "Start or join a party before using the mic.", true);
      return;
    }
    if (!inCall) {
      await joinCall(true, false);
      return;
    }
    callAudioOn = !callAudioOn;
    wantMic = callAudioOn;
    const track = localStream?.getAudioTracks()[0];
    if (track) track.enabled = callAudioOn;
    else if (callAudioOn) await openCallMedia();
    broadcastAv();
    refreshOverlay();
  }

  async function toggleCam() {
    unlockAudio();
    if (!role) {
      addChat("", "Start or join a party before using the camera.", true);
      return;
    }
    if (!inCall) {
      await joinCall(true, true);
      return;
    }
    callVideoOn = !callVideoOn;
    wantCam = callVideoOn;
    try {
      if (!callVideoOn) {
        localStream?.getVideoTracks().forEach((track) => {
          track.enabled = false;
          track.stop();
          localStream.removeTrack(track);
        });
        calls.forEach((call) => {
          call.peerConnection?.getSenders?.().forEach((sender) => {
            if (sender.track?.kind === "video") sender.replaceTrack(null).catch(() => {});
          });
        });
        dropTile("local");
        broadcastAv();
        refreshOverlay();
        return;
      }
      await openCallMedia();
      const videoTrack = localStream?.getVideoTracks()[0];
      let needsRedo = !videoTrack;
      if (videoTrack) {
        calls.forEach((call) => {
          const sender = call.peerConnection?.getSenders?.().find((item) => item.track?.kind === "video");
          if (sender) sender.replaceTrack(videoTrack).catch(() => {});
          else needsRedo = true;
        });
      }
      if (needsRedo) renegotiateCalls();
      broadcastAv();
      refreshOverlay();
    } catch (err) {
      callVideoOn = false;
      wantCam = false;
      refreshOverlay();
      addChat("", `Camera failed: ${err.message}`, true);
    }
  }

  async function acceptCall() {
    const invite = pendingInvite || { video: false };
    hideRing();
    await joinCall(true, !!invite.video);
    if (inCall) sendAll({ t: "accept", name });
  }

  function declineCall() {
    hideRing();
    sendAll({ t: "decline", name });
  }

  async function hangUp(broadcast) {
    hideRing();
    const peerId = peer?.id || "";
    inCall = false;
    callStarted = false;
    callAudioOn = false;
    callVideoOn = false;
    wantMic = false;
    wantCam = false;
    calls.forEach((call) => {
      try {
        call.close();
      } catch {
        /* ignore */
      }
    });
    calls.clear();
    pendingCalls = [];
    localStream?.getTracks().forEach((track) => track.stop());
    localStream = null;
    videoPopHidden = false;
    dropTile("local");
    remoteStreams.forEach((_stream, id) => {
      dropTile(id);
      dropCallAudio(id);
    });
    remoteStreams.clear();
    remoteAv.clear();
    heardPeers.clear();
    iceLive.clear();
    iceRetries.clear();
    forceRelay = false;
    document.querySelectorAll("audio[data-call]").forEach((el) => el.remove());
    refreshOverlay();
    if (broadcast) {
      sendAll({ t: "hang", name, peerId });
      addChat("", "You left the call", true);
    }
  }

  function addChat(from, text, sys, face, queen) {
    ensureOverlay();
    if (!overlay) return;
    const box = overlay.querySelector(".wp-chat");
    if (!box) return;
    const row = document.createElement("div");
    if (sys) {
      row.className = "wp-msg wp-sys";
      row.textContent = text;
    } else {
      const mine = !!from && from === name;
      const isQueen = mine ? queenOk : !!queen || queenFor(from);
      row.className = (mine ? "wp-msg wp-mine" : "wp-msg wp-theirs") + (isQueen ? " wp-royal" : "");
      const col = document.createElement("div");
      col.append(metaFor(from, mine, isQueen), bubbleFor(text));
      row.append(iconEl(face || iconFor(from)), col);
      if (from && !mine) bumpUnread(from, text, face);
    }
    box.appendChild(row);
    while (box.children.length > 300) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function camsLayer() {
    let layer = document.getElementById("watchparty-cams");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "watchparty-cams";
      ["click", "pointerdown"].forEach((ev) =>
        layer.addEventListener(
          ev,
          (e) => {
            if (!e.isTrusted) {
              e.stopImmediatePropagation();
              e.preventDefault();
            }
          },
          true
        )
      );
      layer.style.zIndex = "2147483647";
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function clampCam(wrap, left, top) {
    const w = wrap.offsetWidth || 220;
    const h = wrap.offsetHeight || 160;
    const maxL = Math.max(8, window.innerWidth - 48);
    const maxT = Math.max(8, window.innerHeight - 48);
    wrap.style.left = `${Math.min(maxL, Math.max(-w + 64, left))}px`;
    wrap.style.top = `${Math.min(maxT, Math.max(-h + 48, top))}px`;
    wrap.style.right = "auto";
    wrap.style.bottom = "auto";
  }

  function enableCamWindow(wrap) {
    const bar = wrap.querySelector(".wp-cam-bar");
    bar.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      bar.setPointerCapture(e.pointerId);
      const r = wrap.getBoundingClientRect();
      const ox = e.clientX - r.left;
      const oy = e.clientY - r.top;
      const move = (ev) => clampCam(wrap, ev.clientX - ox, ev.clientY - oy);
      const up = (ev) => {
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", up);
        try {
          bar.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", up);
    });
    const resize = wrap.querySelector(".wp-cam-resize");
    resize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resize.setPointerCapture(e.pointerId);
      const r = wrap.getBoundingClientRect();
      const move = (ev) => {
        wrap.classList.remove("wp-cam-min");
        wrap.style.width = `${Math.max(140, Math.min(window.innerWidth - 16, ev.clientX - r.left))}px`;
        wrap.style.height = `${Math.max(100, Math.min(window.innerHeight - 16, ev.clientY - r.top))}px`;
      };
      const up = (ev) => {
        resize.removeEventListener("pointermove", move);
        resize.removeEventListener("pointerup", up);
        try {
          resize.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
      };
      resize.addEventListener("pointermove", move);
      resize.addEventListener("pointerup", up);
    });
    wrap.querySelectorAll("[data-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        wrap.classList.remove("wp-cam-min");
        const map = { s: [160, 120], m: [220, 164], l: [340, 240] };
        const size = map[btn.dataset.size] || map.m;
        wrap.style.width = `${size[0]}px`;
        wrap.style.height = `${size[1]}px`;
      });
    });
    wrap.addEventListener("pointerdown", (e) => {
      if (!wrap.classList.contains("wp-cam-bubble")) return;
      if (e.target.closest("button")) return;
      e.preventDefault();
      e.stopPropagation();
      wrap.setPointerCapture(e.pointerId);
      const rect = wrap.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      const move = (ev) => {
        if (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4) moved = true;
        const left = Math.min(window.innerWidth - rect.width - 8, Math.max(8, ev.clientX - ox));
        const top = Math.min(window.innerHeight - rect.height - 8, Math.max(8, ev.clientY - oy));
        wrap.style.left = `${left}px`;
        wrap.style.top = `${top}px`;
        wrap.style.right = "auto";
        wrap.style.bottom = "auto";
      };
      const up = (ev) => {
        wrap.removeEventListener("pointermove", move);
        wrap.removeEventListener("pointerup", up);
        try {
          wrap.releasePointerCapture(ev.pointerId);
        } catch {
          /* ignore */
        }
        if (!moved) restoreCam(peerOf(wrap.dataset.peer));
      };
      wrap.addEventListener("pointermove", move);
      wrap.addEventListener("pointerup", up);
    });
    wrap.querySelector("[data-close]").addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = peerOf(wrap.dataset.peer);
      if (!id) return;
      if (id === "local") {
        selfView = false;
        dropTile("local");
        refreshOverlay();
        return;
      }
      hiddenCams.add(id);
      setCamBubble(id, true);
      const stream = remoteStreams.get(id);
      if (stream) playCallAudio(id, stream);
      paintVoiceBadge();
    });
  }

  function setCamBubble(id, on) {
    const wrap = document.querySelector(`#watchparty-cams [data-peer="${tok(id)}"]`);
    if (!wrap) return;
    wrap.classList.toggle("wp-cam-bubble", on);
    const video = wrap.querySelector("video");
    if (video) video.muted = on;
    const pip = wrap.querySelector(".wp-cam-pip");
    if (pip) {
      const who = remoteAv.get(id)?.name || "Friend";
      pip.replaceChildren(iconEl(iconFor(who)));
      pip.title = on ? "Drag anywhere · click to open" : "";
    }
  }

  function restoreCam(id) {
    if (!id) return;
    if (videoPopHidden) {
      remoteStreams.forEach((_stream, other) => {
        if (other !== id && other !== "local") hiddenCams.add(other);
      });
      videoPopHidden = false;
    }
    hiddenCams.delete(id);
    refreshCallWindows();
    refreshOverlay();
  }

  function tileEl(id, stream, mine) {
    ensureOverlay();
    const layer = camsLayer();
    let wrap = layer.querySelector(`[data-peer="${tok(id)}"]`);
    if (!wrap) {
      const n = layer.children.length;
      wrap = document.createElement("div");
      wrap.className = "wp-cam";
      wrap.dataset.peer = tok(id);
      wrap.style.left = `${24 + (n % 3) * 40}px`;
      wrap.style.top = id === "local" ? `${Math.max(24, window.innerHeight - 220)}px` : `${24 + (n % 3) * 40}px`;
      if (id === "local") wrap.classList.add("wp-self");
      setMarkup(wrap, `
        <div class="wp-cam-bar">
          <span>Friend</span>
          <button type="button" data-close title="Close camera">×</button>
        </div>
        <video autoplay playsinline></video>
        <div class="wp-cam-pip"></div>
        <div class="wp-cam-resize"></div>`);
      layer.appendChild(wrap);
      enableCamWindow(wrap);
    }
    const label = wrap.querySelector(".wp-cam-bar span");
    if (label) {
      if (mine) label.replaceChildren(iconEl(icon), document.createTextNode(queenOk ? " You 👑" : " You"));
      else {
        const who = remoteAv.get(id)?.name || "Friend";
        label.replaceChildren(iconEl(iconFor(who)), document.createTextNode(` ${who}`));
      }
    }
    const el = wrap.querySelector("video");
    if (el.srcObject !== stream) el.srcObject = stream;
    el.muted = !!mine;
    el.play?.().catch(() => {});
  }

  function dropTile(id) {
    document.querySelector(`#watchparty-cams [data-peer="${tok(id)}"]`)?.remove();
  }

  function dropCallAudio(id) {
    document.querySelector(`audio[data-call="${tok(id)}"]`)?.remove();
  }

  function playCallAudio(id, stream) {
    ensureOverlay();
    let audio = overlay.querySelector(`audio[data-call="${tok(id)}"]`);
    if (!audio) {
      audio = document.createElement("audio");
      audio.dataset.call = tok(id);
      audio.dataset.wpClip = "1";
      audio.autoplay = true;
      audio.style.display = "none";
      overlay.appendChild(audio);
    }
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.muted = false;
    audio.volume = 1;
    const played = audio.play?.();
    if (played?.catch) played.catch(() => {});
  }

  function presentCall(id, stream, mine) {
    if (mine || id === "local") {
      const live = !!(selfView && stream?.getVideoTracks().some((track) => track.readyState === "live" && track.enabled));
      if (live) tileEl("local", stream, true);
      else dropTile("local");
      paintVoiceBadge();
      return;
    }
    remoteStreams.set(id, stream);
    const info = remoteAv.get(id);
    const remoteVideo = info ? !!info.video : stream.getVideoTracks().some((track) => track.readyState === "live");
    if (info && !info.video) hiddenCams.delete(id);
    const showVideo = !videoPopHidden && !hiddenCams.has(id) && remoteVideo && stream.getVideoTracks().length > 0;
    if (showVideo) {
      dropCallAudio(id);
      tileEl(id, stream, false);
      setCamBubble(id, false);
    } else if (hiddenCams.has(id) || videoPopHidden) {
      tileEl(id, stream, false);
      setCamBubble(id, true);
      playCallAudio(id, stream);
    } else {
      dropTile(id);
      playCallAudio(id, stream);
    }
    paintVoiceBadge();
  }

  function forgetIce(id) {
    iceLive.delete(id);
  }

  function watchIce(call, tries = 0) {
    const pc = call.peerConnection;
    if (!pc) {
      if (tries < 20) setTimeout(() => watchIce(call, tries + 1), 250);
      return;
    }
    let lostTimer = null;
    const onState = () => {
      if (calls.get(call.peer) !== call) return;
      const state = pc.iceConnectionState;
      clearTimeout(lostTimer);
      if (state === "connected" || state === "completed") {
        const first = !iceLive.has(call.peer);
        iceLive.add(call.peer);
        iceRetries.delete(call.peer);
        if (first) refreshOverlay();
      } else if (state === "failed") {
        forgetIce(call.peer);
        refreshOverlay();
        callFailed(call);
      } else if (state === "disconnected") {
        // Often recovers by itself; give it a moment before rebuilding the call.
        forgetIce(call.peer);
        refreshOverlay();
        lostTimer = setTimeout(() => {
          if (calls.get(call.peer) === call && pc.iceConnectionState !== "connected" && pc.iceConnectionState !== "completed") callFailed(call);
        }, 8000);
      } else if (state === "closed") {
        forgetIce(call.peer);
        refreshOverlay();
      }
    };
    pc.addEventListener("iceconnectionstatechange", onState);
    onState();
  }

  // The direct path did not work: rebuild the call through the encrypted relay.
  async function callFailed(call) {
    const id = call.peer;
    if (calls.get(id) === call) calls.delete(id);
    try {
      call.close();
    } catch {
      /* ignore */
    }
    if (!inCall || !peer?.open) return;
    const n = iceRetries.get(id) || 0;
    const who = remoteAv.get(id)?.name || "your friend";
    if (n >= 3) {
      if (n === 3) addChat("", `Could not connect audio with ${who}. Try leaving and rejoining the call.`, true);
      iceRetries.set(id, n + 1);
      return;
    }
    iceRetries.set(id, n + 1);
    if (n === 0) addChat("", `Reconnecting the call with ${who} through the secure relay…`, true);
    forceRelay = true;
    await requestTurn();
    if (!inCall || !peer?.open) return;
    applyIce();
    if (String(peer.id) < String(id)) {
      meshCallAll();
    } else {
      // The other side places the call; nudge it in case it did not notice the failure.
      setTimeout(() => {
        if (inCall && !calls.has(id)) sendAll({ t: "recall", peerId: peer?.id || "" });
      }, 1500 + Math.random() * 1000);
    }
  }

  function bindCall(call) {
    if (!call) return;
    calls.set(call.peer, call);
    watchIce(call);
    call.on("stream", (stream) => {
      const first = !heardPeers.has(call.peer);
      heardPeers.add(call.peer);
      presentCall(call.peer, stream, false);
      if (first) {
        const who = remoteAv.get(call.peer)?.name || "Friend";
        addChat("", `${who} is in the call.`, true);
      }
    });
    call.on("close", () => {
      if (calls.get(call.peer) !== call) return;
      calls.delete(call.peer);
      forgetIce(call.peer);
      dropTile(call.peer);
      dropCallAudio(call.peer);
      refreshOverlay();
    });
    call.on("error", () => {
      if (calls.get(call.peer) !== call) return;
      calls.delete(call.peer);
      forgetIce(call.peer);
      dropTile(call.peer);
      dropCallAudio(call.peer);
      refreshOverlay();
    });
  }

  function flushPendingCalls() {
    const queued = pendingCalls.splice(0);
    applyIce();
    queued.forEach((call) => {
      try {
        call.answer(localStream);
      } catch {
        try {
          call.answer();
        } catch {
          /* ignore */
        }
      }
      bindCall(call);
    });
  }

  function meshCallAll() {
    if (!peer?.open || !localStream || !inCall) return;
    applyIce();
    knownIds.forEach((id) => {
      if (!id || id === peer.id || calls.has(id)) return;
      if (String(peer.id) > String(id)) return;
      try {
        const call = peer.call(id, localStream);
        bindCall(call);
      } catch (err) {
        addChat("", `Could not open the call: ${err.message || err}`, true);
      }
    });
  }

  function renegotiateCalls() {
    calls.forEach((call) => {
      try {
        call.close();
      } catch {
        /* ignore */
      }
    });
    calls.clear();
    sendAll({ t: "recall", peerId: peer?.id || "" });
    meshCallAll();
  }

  function rememberIds(ids) {
    (Array.isArray(ids) ? ids : []).slice(0, 16).forEach((id) => {
      if (typeof id === "string" && /^wp[a-z0-9]{8,24}$/.test(id) && knownIds.size < 16) knownIds.add(id);
    });
    if (peer?.id) knownIds.add(peer.id);
    if (inCall && localStream) meshCallAll();
  }

  function broadcastPeers() {
    if (!peer?.id) return;
    sendAll({ t: "peer", id: peer.id });
  }

  async function ensureLocalStream() {
    if (!inCall) return;
    await openCallMedia();
  }

  async function toggleMedia(kind) {
    if (kind === "audio") await toggleMic();
    else await toggleCam();
  }

  function wireIncomingCalls(p) {
    p.on("call", async (call) => {
      // The party relay announces peer ids; a call can race ahead of that message.
      for (let i = 0; i < 12 && !knownIds.has(call.peer); i++) await new Promise((r) => setTimeout(r, 250));
      if (!knownIds.has(call.peer)) {
        try {
          call.close();
        } catch {
          /* ignore */
        }
        return;
      }
      const old = calls.get(call.peer);
      if (old && old !== call) {
        calls.delete(call.peer);
        try {
          old.close();
        } catch {
          /* ignore */
        }
      }
      applyIce();
      if (!localStream) {
        pendingCalls.push(call);
        return;
      }
      try {
        call.answer(localStream);
      } catch {
        try {
          call.answer();
        } catch {
          /* ignore */
        }
      }
      bindCall(call);
    });
  }

  const loveSeen = new Map();
  function handlePayload(raw, conn) {
    let msg;
    try {
      msg = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "hb") return;
    if (msg.t === "e2e") {
      if (!e2eKey) return;
      const from = String(msg.from || "Friend").slice(0, 24);
      E2E.open(e2eKey, msg.kind, msg.iv, msg.ct).then((obj) => {
        if (!obj) return;
        if (msg.kind === "chat") handlePayload({ t: "chat", name: from, icon: msg.icon, queen: !!msg.queen, text: String(obj.text || "") }, null);
        else if (msg.kind === "voice") handlePayload({ t: "voice", name: from, audio: String(obj.audio || ""), mime: String(obj.mime || "") }, null);
        else if (msg.kind === "react") handlePayload({ t: "react", name: from, emoji: String(obj.emoji || "") }, null);
        else if (msg.kind === "love") handlePayload({ t: "love", name: from }, null);
      });
      return;
    }
    if (msg.t === "full") {
      socketWanted = false;
      return;
    }
    if (msg.t === "turn") {
      deliverTurn(msg);
      return;
    }
    if (msg.t === "hello") {
      if (!conn) return;
      people.set(conn.peer, msg.name || "Friend");
      knownIds.add(conn.peer);
      refreshOverlay();
      addChat("", `${msg.name} joined`, true);
      if (role === "host") {
        conn.send(JSON.stringify({ t: "roster", people: [...people.values()] }));
        const snap = snapshot();
        if (snap) conn.send(JSON.stringify(snap));
        broadcastPeers();
      }
    } else if (msg.t === "roster") {
      setRoster(msg.people);
      refreshOverlay();
    } else if (msg.t === "peers") {
      rememberIds(msg.ids);
    } else if (msg.t === "sync") {
      if (followHost(msg.url)) return;
      applySync(msg);
    } else if (msg.t === "control") {
      if (followHost(msg.url)) return;
      applySync(msg);
    } else if (msg.t === "welcome") {
      if (msg.e2e && !e2eKey) addChat("", "This party is end-to-end encrypted. Rejoin with the full code (like K7Q2MX-9F4TB-2W8QH) to read messages.", true);
      setRoster(msg.people);
      refreshOverlay();
      if (followHost(msg.url)) return;
      if (typeof msg.time === "number") applySync(msg);
    } else if (msg.t === "joined") {
      addChat("", `${msg.name} joined`, true);
    } else if (msg.t === "left") {
      addChat("", `${msg.name} left`, true);
    } else if (msg.t === "chat") {
      if (msg.system) addChat("", String(msg.text || "").slice(0, 240), true);
      else {
        if (msg.name && msg.icon) {
          for (const row of people.values()) {
            if (row?.name === msg.name) row.icon = iconOr(msg.icon);
          }
        }
        addChat(String(msg.name || "Friend").slice(0, 24), String(msg.text || "").slice(0, 240), false, msg.icon, !!msg.queen);
      }
    } else if (msg.t === "love") {
      const from = String(msg.name || "Someone").slice(0, 24);
      if (Date.now() - (loveSeen.get(from) || 0) < 4000) return;
      loveSeen.set(from, Date.now());
      if (loveSeen.size > 50) loveSeen.clear();
      loveShower(true, from);
      addChat("", `${from} sent you love 💖`, true);
      if (!panelVisible()) bumpUnread(from, "sent you love 💖");
    } else if (msg.t === "react") {
      if (!QUICK.includes(msg.emoji) && !CHAT_EMOJIS.includes(msg.emoji)) return;
      floatEmoji(msg.emoji, String(msg.name || "").slice(0, 24));
      if (!panelVisible()) bumpUnread(String(msg.name || "Friend").slice(0, 24), `reacted ${msg.emoji}`);
    } else if (msg.t === "voice") {
      addVoice(msg.name, msg.audio, msg.mime);
    } else if (msg.t === "rename") {
      if (msg.from && msg.name && msg.from !== msg.name) addChat("", `${msg.from} is now ${msg.name}`, true);
      if (Array.isArray(msg.people)) setRoster(msg.people);
      refreshOverlay();
    } else if (msg.t === "av") {
      if (msg.peerId) {
        remoteAv.set(msg.peerId, { name: msg.name || "Friend", audio: !!msg.audio, video: !!msg.video });
        const stream = remoteStreams.get(msg.peerId);
        if (stream) presentCall(msg.peerId, stream, false);
        else if (!msg.video) dropTile(msg.peerId);
        refreshOverlay();
      }
    } else if (msg.t === "recall") {
      if (!inCall || !localStream) return;
      const existing = calls.get(msg.peerId);
      if (existing) {
        calls.delete(msg.peerId);
        try {
          existing.close();
        } catch {
          /* ignore */
        }
      }
      meshCallAll();
    } else if (msg.t === "invite") {
      if (inCall) {
        meshCallAll();
        addChat("", `${msg.name} is in the call`, true);
        return;
      }
      pendingInvite = msg;
      showRing(msg.name || "Friend", msg.video);
      addChat("", `${msg.name} started a call`, true);
    } else if (msg.t === "accept") {
      addChat("", `${msg.name} joined the call`, true);
      meshCallAll();
    } else if (msg.t === "decline") {
      addChat("", `${msg.name} declined the call`, true);
    } else if (msg.t === "hang") {
      hideRing();
      if (msg.peerId) {
        remoteAv.delete(msg.peerId);
        remoteStreams.delete(msg.peerId);
        heardPeers.delete(msg.peerId);
        iceLive.delete(msg.peerId);
        dropTile(msg.peerId);
        dropCallAudio(msg.peerId);
        const existing = calls.get(msg.peerId);
        if (existing) {
          calls.delete(msg.peerId);
          try {
            existing.close();
          } catch {
            /* ignore */
          }
        }
      }
      addChat("", `${msg.name} left the call`, true);
      refreshOverlay();
    } else if (msg.t === "bye") {
      if (!conn) return;
      people.delete(conn.peer);
      knownIds.delete(conn.peer);
      refreshOverlay();
      addChat("", `${msg.name || "Someone"} left`, true);
    }
  }

  function attachConn(conn) {
    conn.on("open", () => {
      if (!conns.includes(conn)) conns.push(conn);
      knownIds.add(conn.peer);
      conn.send(JSON.stringify({ t: "hello", name }));
      if (role === "host") {
        const snap = snapshot();
        if (snap) conn.send(JSON.stringify(snap));
        broadcastPeers();
      }
    });
    conn.on("data", (raw) => handlePayload(raw, conn));
    conn.on("close", () => {
      people.delete(conn.peer);
      knownIds.delete(conn.peer);
      conns = conns.filter((c) => c !== conn);
      refreshOverlay();
      if (role === "host") broadcastPeers();
    });
  }

  function startSyncLoop() {
    stopSyncLoop();
    syncTimer = setInterval(() => {
      bindVideo(findVideo());
      if (role !== "host" || Date.now() < quietUntil || adPlaying()) return;
      const snap = snapshot();
      if (!snap) return;
      sendAll({
        t: "state",
        beat: true,
        paused: snap.paused,
        time: snap.time,
        rate: snap.rate,
        url: cleanUrl(location.href),
        at: Date.now(),
      });
    }, SYNC_MS);
  }

  function stopSyncLoop() {
    if (syncTimer) clearInterval(syncTimer);
    syncTimer = null;
  }

  function destroyPeer() {
    if (stageEl) exitStage(true);
    tellFrames(false);
    if (voiceRec && voiceRec.state === "recording") {
      try {
        voiceRec.onstop = null;
        voiceRec.stop();
      } catch {
        /* ignore */
      }
    }
    voiceStream?.getTracks().forEach((t) => t.stop());
    voiceStream = null;
    callStarted = false;
    selfView = false;
    remoteStreams.clear();
    remoteAv.clear();
    heardPeers.clear();
    iceLive.clear();
    iceRetries.clear();
    forceRelay = false;
    hiddenCams.clear();
    pendingCalls = [];
    unread = 0;
    layoutKey = "";
    e2eKey = null;
    e2eSecret = null;
    socketWanted = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectTries = 0;
    stopKeepalive();
    clearSavedParty();
    setConnState("offline");
    stopSyncLoop();
    unbindVideo();
    try {
      if (socket) socket.onclose = null;
      // A real goodbye, so the others see "left" right away (dropped connections get a grace period).
      if (socket?.readyState === 1) socket.send(JSON.stringify({ t: "leave" }));
      socket?.close();
    } catch {
      /* ignore */
    }
    socket = null;
    conns.forEach((c) => {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    });
    calls.forEach((c) => {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    });
    localStream?.getTracks().forEach((t) => t.stop());
    conns = [];
    calls.clear();
    knownIds.clear();
    localStream = null;
    wantMic = false;
    wantCam = false;
    inCall = false;
    hideRing();
    if (peer) {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    }
    peer = null;
    role = null;
    code = null;
    people = new Map();
    overlay?.remove();
    overlay = null;
    document.getElementById("watchparty-cams")?.remove();
    document.getElementById("watchparty-voice")?.remove();
    restoreReframe();
    document.documentElement.style.removeProperty("--wp-rail");
  }

  function errText(err) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    return err.message || err.type || String(err);
  }

  function newPeer(id, opts) {
    return new Promise((resolve, reject) => {
      let opened = false;
      const p = id ? new Peer(id, opts) : new Peer(opts);
      const timer = setTimeout(() => {
        if (opened) return;
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
        reject(new Error("Signaling timed out."));
      }, 10000);
      p.on("open", () => {
        opened = true;
        clearTimeout(timer);
        resolve(p);
      });
      p.on("error", (err) => {
        if (opened) return;
        clearTimeout(timer);
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
        reject(new Error(errText(err)));
      });
    });
  }

  async function connectPeer(id) {
    let lastErr;
    for (const server of SIGNAL_SERVERS) {
      try {
        return await newPeer(id, server);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("Could not reach WatchParty signaling.");
  }

  function openSocket(asRole, resume = false) {
    socketWanted = true;
    socketRole = asRole;
    if (!resume) setConnState("connecting");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      let opened = false;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error("Could not reach the WatchParty server."));
      }, 8000);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        if (socket && socket !== ws) {
          try {
            socket.onclose = null;
            socket.close();
          } catch {
            /* ignore */
          }
        }
        socket = ws;
        lastRx = Date.now();
        reconnectTries = 0;
        const snap = snapshot();
        ws.send(JSON.stringify({
          t: "hello",
          code,
          name,
          icon,
          cid: CID,
          resume: !!resume,
          queen: !!queenOk,
          e2e: !!e2eKey && asRole === "host",
          role: asRole,
          url: cleanUrl(location.href),
          time: snap ? snap.time : 0,
          paused: snap ? snap.paused : true,
          rate: snap ? snap.rate : 1,
          at: Date.now(),
        }));
        setConnState("live");
        startKeepalive();
        resolve();
      };
      ws.onmessage = (ev) => {
        lastRx = Date.now();
        handlePayload(ev.data, null);
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        if (socket === ws) socket = null;
        if (!opened) reject(new Error("Could not reach the WatchParty server."));
        if (socketWanted && role && (opened || resume)) scheduleReconnect(false);
        else if (!socketWanted) setConnState("offline");
      };
    });
  }


  function showParty(asRole) {
    role = asRole;
    people.set("me", { name, icon, queen: queenOk });
    bindVideo(findVideo());
    ensureOverlay();
    const nameInput = overlay?.querySelector(".wp-name-input");
    if (nameInput) nameInput.value = name;
    refreshOverlay();
    applyReframe();
    const link = inviteLink();
    tellFrames(true);
    refreshVpn();
    startSyncLoop();
    return { ok: true, code, full: fullCode(), encrypted: !!e2eKey, role, link };
  }

  function tellFrames(on) {
    for (let i = 0; i < window.frames.length; i += 1) {
      try {
        window.frames[i].postMessage({ source: "wp-party", on: !!on }, "*");
      } catch {
        /* ignore */
      }
    }
  }

  function leaveParty() {
    destroyPeer();
  }

  async function createParty(userName, userIcon) {
    destroyPeer();
    name = userName || "Host";
    if (userIcon) icon = iconOr(userIcon);
    code = makeCode();
    await setSecret(code, E2E ? E2E.randomChars(E2E.SECRET_LEN) : null);
    await openSocket("host");
    const result = showParty("host");
    saveParty();
    return result;
  }

  async function joinParty(userName, joinCode, force, userIcon, resume = false) {
    const parsed = E2E?.parse(joinCode) || null;
    const next = parsed?.code || "";
    if (next.length < 4) throw new Error("That code looks too short.");
    const secret = parsed?.secret || savedKeys[next] || null;
    const info = await fetch(`https://cp.praivox.com/wp-api/party/${next}`).then(async (r) => {
      if (!r.ok) throw new Error("That party is not live. The host needs to press Start a party.");
      return r.json();
    });
    if (info.e2e && !secret) {
      throw new Error("This party is end-to-end encrypted. Ask the host for the full code, like K7Q2MX-9F4TB-2W8QH.");
    }
    if (!force && info.url && !sameVideo(location.href, info.url)) {
      if (secret) await bg({ type: "WP_KEY_SET", code: next, secret });
      return { ok: true, redirect: partyLink(info.url, next), code: next, role: "guest" };
    }
    destroyPeer();
    name = userName || "Friend";
    if (userIcon) icon = iconOr(userIcon);
    code = next;
    await setSecret(next, secret);
    await openSocket("guest", resume);
    const result = showParty("guest");
    saveParty();
    if (typeof info.time === "number") applySync(info);
    return result;
  }

  async function resumeParty(saved, wpName, wpIcon) {
    const who = saved.name || wpName || (saved.role === "host" ? "Host" : "Friend");
    const face = saved.icon || wpIcon;
    if (saved.secret) savedKeys[saved.code] = saved.secret;
    if (saved.role === "guest") return joinParty(who, saved.code, true, face, true);
    destroyPeer();
    name = who;
    if (face) icon = iconOr(face);
    code = saved.code;
    await setSecret(code, saved.secret || null);
    await openSocket("host", true);
    const result = showParty("host");
    saveParty();
    return result;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg?.type === "WP_GET_STATE") {
        return sendResponse({ active: !!role, code, full: role ? fullCode() : null, link: role ? inviteLink() : null, encrypted: !!e2eKey, role, name, icon, conn: connState, people: people.size || 1, video: !!findVideo() || !!document.querySelector("iframe") });
      }
      if (msg?.type === "WP_PROFILE") {
        if (msg.icon) chooseIcon(msg.icon);
        if (msg.name) publishName(msg.name);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "WP_CREATE") {
        try {
          sendResponse(await createParty(msg.name, msg.icon));
        } catch (err) {
          sendResponse({ ok: false, error: err.message || String(err) });
        }
        return;
      }
      if (msg?.type === "WP_JOIN") {
        try {
          sendResponse(await joinParty(msg.name, msg.code, false, msg.icon));
        } catch (err) {
          sendResponse({ ok: false, error: err.message || String(err) });
        }
        return;
      }
      if (msg?.type === "WP_LEAVE") {
        destroyPeer();
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "WP_COMMAND") {
        handleCommand(msg.command);
        sendResponse({ ok: true });
      }
    })();
    return true;
  });

  function handleCommand(command) {
    if (!IS_TOP) return;
    if (command === "toggle-panel") {
      if (role && overlay) setPanelOpen(overlay.classList.contains("wp-min"));
    } else if (command === "toggle-mic") {
      if (role) toggleMedia("audio");
    } else if (command === "toggle-cam") {
      if (role) toggleMedia("video");
    } else if (command === "focus-chat") {
      if (role) focusChat();
    }
  }

  let frameReportTimer = null;
  const obs = new MutationObserver(() => {
    if (frameReportTimer) return;
    frameReportTimer = setTimeout(() => {
      frameReportTimer = null;
      if (findVideo()) reportFrame();
    }, 1500);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  reportFrame();
  setInterval(reportFrame, 4000);

  if (window.top === window && location.hostname === "cp.praivox.com") {
    (async () => {
      const m = location.pathname.match(/^\/watchparty\/([A-Za-z0-9]{4,10})\/?$/);
      const k = new URLSearchParams(location.hash.slice(1)).get("k");
      if (m && k && E2E?.validSecret(k.toUpperCase())) await bg({ type: "WP_KEY_SET", code: m[1].toUpperCase(), secret: k.toUpperCase() });
      document.documentElement.setAttribute("data-wp-ext", VERSION);
    })();
  }

  // Ask before joining a party from a link a website (or anyone) put in the address bar.
  function askToJoin(partyCode, onYes) {
    document.getElementById("watchparty-invite")?.remove();
    const box = document.createElement("div");
    box.id = "watchparty-invite";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Join WatchParty");
    const title = document.createElement("b");
    title.textContent = `Join WatchParty ${partyCode}?`;
    const p = document.createElement("span");
    p.textContent = "Someone shared a party link. Only join if you know who sent it.";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "Join party";
    const no = document.createElement("button");
    no.type = "button";
    no.className = "no";
    no.textContent = "No thanks";
    yes.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      box.remove();
      onYes();
    });
    no.addEventListener("click", (e) => {
      if (!e.isTrusted) return;
      box.remove();
    });
    box.append(title, p, yes, no);
    document.documentElement.appendChild(box);
  }

  if (window.top === window) {
    (async () => {
      await tabStateReady;
      const incoming = (new URLSearchParams(location.search).get("wp_party") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
      const { wpName, wpIcon } = await storageGet(["wpName", "wpIcon"]);
      const join = async () => {
        try {
          await joinParty(wpName || "Friend", incoming, true, wpIcon);
        } catch (err) {
          ensureOverlay();
          addChat("", err.message || String(err), true);
        }
      };
      if (incoming.length >= 4) {
        const trust = await bg({ type: "WP_TRUST_CHECK", code: incoming });
        const resuming = readSavedParty()?.code === incoming;
        if (trust?.trusted || resuming) join();
        else askToJoin(incoming, join);
        return;
      }
      const saved = readSavedParty();
      if (!saved) return;
      try {
        await resumeParty(saved, wpName, wpIcon);
      } catch (err) {
        clearSavedParty();
        ensureOverlay();
        addChat("", err.message || String(err), true);
      }
    })();
  }

  const frameRate = new WeakMap();
  function fromChildFrame(src) {
    if (!src) return false;
    for (let i = 0; i < window.frames.length; i += 1) {
      if (window.frames[i] === src) return true;
    }
    return false;
  }

  function iframeFor(src) {
    for (const f of document.querySelectorAll("iframe")) {
      try {
        if (f.contentWindow === src) return f;
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || typeof d.source !== "string") return;
    const child = fromChildFrame(e.source);
    const parent = !IS_TOP && e.source === window.parent;
    if (child) {
      const now = Date.now();
      const win = frameRate.get(e.source) || { at: now, n: 0 };
      if (now - win.at > 1000) {
        win.at = now;
        win.n = 0;
      }
      win.n += 1;
      frameRate.set(e.source, win);
      if (win.n > 8) return; // a chatty frame (ad, tracker) can't flood the party
    }
    if (d.source === "wp-buffer" && child) {
      reportBuffer(d);
      return;
    }
    if (d.source === "wp-media" && child) {
      if (IS_TOP) ingestMedia(d, true);
      else {
        try {
          window.parent.postMessage(d, "*");
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (d.source === "wp-apply" && parent) {
      applySync(d);
      return;
    }
    if (d.source === "wp-party" && parent) {
      if (d.on) document.documentElement.setAttribute("data-wp-party", "1");
      else document.documentElement.removeAttribute("data-wp-party");
      for (let i = 0; i < window.frames.length; i += 1) {
        try {
          window.frames[i].postMessage({ source: "wp-party", on: !!d.on }, "*");
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (d.source === "wp-fs-state" && parent) {
      window.dispatchEvent(new CustomEvent("wp-fs-state", { detail: d.on ? "on" : "off" }));
      for (let i = 0; i < window.frames.length; i += 1) {
        try {
          window.frames[i].postMessage({ source: "wp-fs-state", on: !!d.on }, "*");
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (d.source === "wp-fs" && child) {
      if (!IS_TOP) {
        try {
          window.parent.postMessage({ source: "wp-fs", enter: !!d.enter }, "*");
        } catch {
          /* ignore */
        }
        return;
      }
      if (!role) return;
      if (d.enter) enterStage(iframeFor(e.source) || undefined);
      else exitStage(true);
    }
  });

  setInterval(() => {
    const v = findVideo();
    if (v) bindVideo(v);
    if (!IS_TOP && v && document.documentElement.getAttribute("data-wp-party") === "1") publishLocal("tick");
    if (IS_TOP && role) tellFrames(true);
  }, 1000);

  ["pointerdown", "keydown", "click"].forEach((ev) => {
    window.addEventListener(ev, () => {
      gestureUntil = Date.now() + 3000;
    }, true);
  });

  ["fullscreenchange", "webkitfullscreenchange"].forEach((ev) => {
    document.addEventListener(ev, () => {
      if (IS_TOP) syncFullscreenChrome();
    });
  });
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!IS_TOP || selfResize) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyReframe();
      keepInView();
    }, 120);
  });
  if (IS_TOP) {
    // YouTube is a single-page app: re-fit after its own navigations.
    ["yt-navigate-finish", "yt-page-data-updated"].forEach((ev) =>
      window.addEventListener(ev, () => {
        layoutKey = "";
        setTimeout(applyReframe, 300);
      })
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && panelVisible()) {
        unread = 0;
        paintUnread();
      }
    });
  }

  window.addEventListener(
    "keydown",
    (e) => {
      if (!IS_TOP) return;
      const typing =
        e.target &&
        (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable);
      if (!(e.altKey && e.shiftKey) || typing) return;
      const map = { KeyW: "toggle-panel", KeyM: "toggle-mic", KeyC: "toggle-cam", KeyY: "focus-chat" };
      const cmd = map[e.code];
      if (!cmd) return;
      e.preventDefault();
      handleCommand(cmd);
    },
    true
  );
})();
