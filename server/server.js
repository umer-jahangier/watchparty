const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const { WebSocketServer } = require("ws");

let TURN_SECRET = "";
try {
  TURN_SECRET = fs.readFileSync("/home/watchparty-server/turn.secret", "utf8").trim();
} catch {
  console.error("watchparty turn secret missing");
}
const AWAY_GRACE_MS = 20 * 1000; // how long a dropped connection may come back before "left" is shown
const TURN_TTL = 4 * 3600;

const ICONS = new Set(["fox", "cat", "panda", "frog", "bear", "bunny", "owl", "bot", "alien", "ghost", "star", "moon", "pop", "crown", "dino", "comet"]);

function cleanName(raw) {
  const name = String(raw || "Friend").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
  return name || "Friend";
}

function cleanIcon(raw) {
  const id = String(raw || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 12);
  return ICONS.has(id) ? id : "fox";
}

function tooFast(ws, key, limit, windowMs) {
  const now = Date.now();
  const bucket = ws.rate || (ws.rate = {});
  const list = bucket[key] || (bucket[key] = []);
  while (list.length && now - list[0] > windowMs) list.shift();
  if (list.length >= limit) return true;
  list.push(now);
  return false;
}

function turnGrant() {
  if (!TURN_SECRET) return null;
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL;
  const username = `${expiry}:wp`;
  const credential = crypto.createHmac("sha1", TURN_SECRET).update(username).digest("base64");
  return {
    t: "turn",
    urls: ["turn:cp.praivox.com:3478?transport=udp", "turn:cp.praivox.com:3478?transport=tcp", "turns:cp.praivox.com:5349?transport=tcp"],
    username,
    credential,
    ttl: TURN_TTL,
  };
}

function peerIds(room) {
  return [...room.members].map((member) => member.peerId).filter(Boolean);
}

const rooms = new Map();
// Keep empty rooms alive this long so a host/guest can reload or reconnect.
const ROOM_GRACE_MS = 2 * 60 * 1000;
// Server -> client keepalive (WebSocket ping + small app-level heartbeat).
const PING_MS = 25 * 1000;

function cleanUrl(raw) {
  try {
    const u = new URL(String(raw || ""));
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    if (u.username || u.password) return "";
    u.searchParams.delete("wp_party");
    return u.toString().slice(0, 2000);
  } catch {
    return "";
  }
}

// Names are unique inside a room so nobody can pose as someone else.
function uniqueName(room, wanted, self) {
  const taken = new Set([...room.members].filter((m) => m !== self).map((m) => (m.name || "").toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let i = 2; i < 20; i += 1) {
    const next = `${wanted.slice(0, 20)} ${i}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${wanted.slice(0, 16)} ${Math.floor(Math.random() * 9000 + 1000)}`;
}

const SYSTEM_LINE = /^(played from|paused at|skipped to) \d{1,2}(:\d{2}){1,2}$|^set speed to \d(\.\d{1,2})?x$|^changed the video$|^(played|paused)$/;

function getRoom(code) {
  const key = String(code || "").toUpperCase();
  let room = rooms.get(key);
  if (!room) {
    room = { code: key, url: "", time: 0, paused: true, rate: 1, members: new Set(), updated: Date.now() };
    rooms.set(key, room);
  }
  return room;
}

function names(room) {
  return [...room.members].map((c) => c.name).filter(Boolean);
}

function roster(room) {
  return [...room.members].map((c) => ({ name: c.name || "Friend", icon: c.icon || "fox", queen: !!c.queen }));
}

function broadcast(room, msg, except) {
  const raw = JSON.stringify(msg);
  for (const client of room.members) {
    if (client === except || client.readyState !== 1) continue;
    client.send(raw);
  }
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(JSON.stringify(body));
}

function joinPage(code, nonce) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Join WatchParty ${code}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0c0812">
<style nonce="${nonce}">
@font-face{font-family:"Bricolage";src:url("/watchparty/fonts/bricolage.woff2") format("woff2");font-weight:500 800}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.55 ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f4effc;background:radial-gradient(700px 500px at 80% -10%,rgba(139,92,246,.25),transparent 60%),#0c0812;-webkit-font-smoothing:antialiased}
main{width:min(420px,100% - 32px);text-align:center}
.mark{width:52px;height:52px;margin:0 auto 18px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(135deg,#8b5cf6,#d946ef 55%,#ec4899)}
h1{font:800 32px/1.05 "Bricolage",system-ui,sans-serif;letter-spacing:-.03em;margin:0 0 10px}
p{color:#c0b5d6;margin:0 0 22px}a{color:#dcc8ff}
.btn{display:inline-block;padding:14px 22px;border-radius:13px;background:linear-gradient(135deg,#8b5cf6,#d946ef 55%,#ec4899);color:#fff;font:700 16px/1 "Bricolage",system-ui,sans-serif;text-decoration:none}
</style></head><body><main>
<div class="mark"><svg viewBox="0 0 24 24" width="24" height="24"><path d="M8 5.5v13l10.5-6.5z" fill="#fff"/></svg></div>
<h1>Party ${code}</h1>
<p id="msg">Getting your seat ready…</p>
<div id="act"></div>
</main>
<script nonce="${nonce}">
const code = ${JSON.stringify(code)};
const web = "/watchparty/web/?room=" + code;
const msg = document.getElementById("msg");
function hasExt() { return document.documentElement.hasAttribute("data-wp-ext"); }
function waitExt(ms) {
  return new Promise((res) => {
    const t0 = Date.now();
    (function tick() { if (hasExt()) return res(true); if (Date.now() - t0 > ms) return res(false); setTimeout(tick, 100); })();
  });
}
fetch("/wp-api/party/" + code).then(r => r.ok ? r.json() : Promise.reject()).then(async (p) => {
  const ext = await waitExt(1200);
  if (ext) {
    const u = new URL(p.url);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("bad url");
    u.searchParams.set("wp_party", code);
    msg.textContent = "Opening the video…";
    location.replace(u.toString());
  } else {
    msg.textContent = "Opening WatchParty in your browser…";
    location.replace(web + (location.hash || ""));
  }
}).catch(() => {
  msg.textContent = "This party isn't live right now. Ask the host to start it again.";
  const a = document.createElement("a");
  a.className = "btn";
  a.href = "/watchparty/";
  a.textContent = "Get WatchParty";
  document.getElementById("act").appendChild(a);
});
</script></body></html>`;
}
const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    json(res, 204, {});
    return;
  }
  const path = (req.url || "/").split("?")[0];
  const party = path.match(/^\/(?:wp-api|api)\/party\/([A-Za-z0-9]{4,10})$/);
  if (req.method === "GET" && party) {
    if (ipTooFast(clientIp(req), "api", 30, 60000)) {
      json(res, 429, { error: "Too many requests" });
      return;
    }
    const room = rooms.get(party[1].toUpperCase());
    if (!room || !room.url) {
      json(res, 404, { error: "Party is not live" });
      return;
    }
    json(res, 200, {
      code: room.code,
      url: room.url,
      time: room.time,
      paused: room.paused,
      rate: room.rate,
      e2e: !!room.e2e,
    });
    return;
  }
  // Lets a browser compare the address we see with the one WebRTC reports (VPN-friendly mode).
  if (req.method === "GET" && /^\/(?:wp-api|api)\/whoami$/.test(path)) {
    if (ipTooFast(clientIp(req), "whoami", 20, 60000)) {
      json(res, 429, { error: "Too many requests" });
      return;
    }
    json(res, 200, { ip: clientIp(req) });
    return;
  }
  const join = path.match(/^\/join\/([A-Za-z0-9]{4,10})$/);
  if (req.method === "GET" && join) {
    const nonce = crypto.randomBytes(16).toString("base64");
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; font-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    });
    res.end(joinPage(join[1].toUpperCase(), nonce));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 480000 });
// Public-use limits: a few sockets per IP and a ceiling on live parties.
const MAX_PER_IP = 16;
const MAX_ROOMS = 3000;
const perIp = new Map();
function clientIp(req) {
  const parts = String(req.headers["x-forwarded-for"] || "").split(",").map((v) => v.trim()).filter(Boolean);
  return parts[parts.length - 1] || req.socket.remoteAddress || "unknown";
}
const MAX_CLIENTS = 4000;
// Sliding-window counters keyed by IP (party creation, API lookups).
const ipBuckets = new Map();
function ipTooFast(ip, key, limit, windowMs) {
  const k = `${key}:${ip}`;
  const now = Date.now();
  const list = (ipBuckets.get(k) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    ipBuckets.set(k, list);
    return true;
  }
  list.push(now);
  ipBuckets.set(k, list);
  return false;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of ipBuckets) if (!list.length || now - list[list.length - 1] > 15 * 60 * 1000) ipBuckets.delete(k);
}, 60000);
const num = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};
server.on("upgrade", (req, socket, head) => {
  const ip = clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_PER_IP || wss.clients.size >= MAX_CLIENTS) {
    socket.write("HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.ip = ip;
    perIp.set(ip, (perIp.get(ip) || 0) + 1);
    ws.on("close", () => {
      const n = (perIp.get(ip) || 1) - 1;
      if (n <= 0) perIp.delete(ip);
      else perIp.set(ip, n);
    });
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });
  ws.on("error", () => {});
  ws.on("message", (data, isBinary) => {
    try {
      handleFrame(data, isBinary);
    } catch (err) {
      console.error("frame error:", err && err.message);
    }
  });
  function handleFrame(data, isBinary) {
    ws.isAlive = true;
    if (isBinary) return;
    const now = Date.now();
    if (!ws.frameWindow || now - ws.frameWindow > 1000) {
      ws.frameWindow = now;
      ws.frameCount = 0;
    }
    ws.frameCount += 1;
    if (ws.frameCount > 40) {
      ws.terminate();
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg) || typeof msg.t !== "string") return;
    if (msg.t === "hb") return;
    if (msg.t === "hello") {
      if (ws.room) return; // one hello per socket
      const wanted = String(msg.code || "").toUpperCase();
      if (!/^[A-Z0-9]{4,10}$/.test(wanted)) {
        ws.close();
        return;
      }
      if (!rooms.has(wanted) && ipTooFast(ws.ip || "?", "newroom", 12, 10 * 60 * 1000)) {
        ws.close(4029, "too many new parties");
        return;
      }
      if (!rooms.has(wanted) && rooms.size >= MAX_ROOMS) {
        ws.send(JSON.stringify({ t: "chat", system: true, text: "WatchParty is very busy right now. Try again in a few minutes." }));
        ws.close();
        return;
      }
      const room = getRoom(wanted);
      const cid = /^[a-z0-9]{8,40}$/i.test(String(msg.cid || "")) ? String(msg.cid) : "";
      let replaced = null;
      if (cid) {
        for (const member of room.members) {
          if (member !== ws && member.cid === cid) replaced = member;
        }
      }
      let returning = null;
      if (cid && room.away && room.away.has(cid)) {
        // Back within the grace period (network blip, VPN switch, page reload): nobody "left".
        returning = room.away.get(cid);
        clearTimeout(returning.timer);
        room.away.delete(cid);
        if (!ws.peerId && returning.peerId) ws.peerId = returning.peerId;
      }
      if (replaced) {
        // Same browser tab reconnecting: drop its stale socket quietly.
        replaced.replaced = true;
        room.members.delete(replaced);
        if (room.buffers) room.buffers.delete(replaced);
        if (!ws.peerId && replaced.peerId) ws.peerId = replaced.peerId;
        try {
          // 4001 = "this party was opened in another tab": the old tab stops reconnecting.
          replaced.close(4001, "replaced");
        } catch {
          /* ignore */
        }
      }
      if (room.members.size >= 8) {
        ws.send(JSON.stringify({ t: "full" }));
        ws.send(JSON.stringify({ t: "chat", system: true, text: "This party is full." }));
        ws.close();
        return;
      }
      ws.cid = cid;
      ws.room = room;
      ws.name = cleanName(msg.name);
      ws.icon = cleanIcon(msg.icon);
      ws.queen = !!msg.queen;
      // Host is whoever created the room (by tab id); anyone else asking for host becomes a guest.
      const wantsHost = msg.role === "host";
      if (wantsHost && !room.hostCid && cid) room.hostCid = cid;
      ws.role = wantsHost && cid && room.hostCid === cid ? "host" : "guest";
      ws.name = uniqueName(room, ws.name, ws);
      room.members.add(ws);
      if (ws.role === "host") {
        if (msg.e2e === true) room.e2e = true;
        room.url = cleanUrl(msg.url) || room.url;
        room.time = num(msg.time, 0, 864000, 0);
        room.paused = !!msg.paused;
        room.rate = num(msg.rate, 0.25, 4, 1);
      }
      room.updated = Date.now();
      ws.send(JSON.stringify({
        t: "welcome",
        url: room.url,
        time: room.time,
        paused: room.paused,
        rate: room.rate,
        e2e: !!room.e2e,
        people: roster(room),
      }));
      if (!replaced && !returning && !msg.resume) broadcast(room, { t: "joined", name: ws.name, icon: ws.icon }, ws);
      broadcast(room, { t: "roster", people: roster(room) });
      return;
    }
    if (!ws.room) return;
    const room = ws.room;
    if (msg.t === "leave") {
      ws.leaving = true; // a real goodbye: announce it right away when the socket closes
      return;
    }
    if ((msg.t === "state" || msg.t === "sync") && ws.role === "host" && msg.beat) {
      if (tooFast(ws, "beat", 4, 1000)) return;
      if (Date.now() < (room.actionUntil || 0)) return;
      if (!!msg.paused !== !!room.paused) return;
      room.url = cleanUrl(msg.url) || room.url;
      room.time = num(msg.time, 0, 864000, 0);
      room.rate = num(msg.rate, 0.25, 4, room.rate || 1);
      room.updated = Date.now();
      broadcast(room, { t: "sync", time: room.time, paused: room.paused, rate: room.rate, url: room.url, at: Number(msg.at) || Date.now(), name: ws.name }, ws);
      return;
    }
    if (msg.t === "control" || ((msg.t === "state" || msg.t === "sync") && ws.role === "host" && !msg.beat)) {
      if (tooFast(ws, "control", 12, 2000)) return;
      if (ws.role === "host") room.url = cleanUrl(msg.url) || room.url;
      room.time = num(msg.time, 0, 864000, 0);
      room.paused = !!msg.paused;
      room.rate = num(msg.rate, 0.25, 4, room.rate || 1);
      room.pausedByBuffer = false;
      if (room.buffers) room.buffers.clear();
      room.actionUntil = Date.now() + 3500;
      room.updated = Date.now();
      broadcast(room, { t: "sync", time: room.time, paused: room.paused, rate: room.rate, url: room.url, at: Number(msg.at) || Date.now(), name: ws.name }, ws);
      return;
    }
    if (msg.t === "buffer") {
      if (tooFast(ws, "buffer", 8, 10000)) return;
      room.buffers = room.buffers || new Set();
      const time = Number(msg.time) || room.time || 0;
      const rate = Number(msg.rate) || room.rate || 1;
      if (msg.waiting) {
        const fresh = !room.buffers.has(ws);
        room.buffers.add(ws);
        if (!room.paused) room.pausedByBuffer = true;
        room.paused = true;
        room.time = time;
        room.rate = rate;
        room.actionUntil = Date.now() + 5000;
        room.updated = Date.now();
        if (fresh) broadcast(room, { t: "chat", system: true, name: "", text: `${ws.name} is buffering` }, ws);
        broadcast(room, { t: "sync", time, paused: true, rate, url: room.url, at: Date.now(), name: ws.name, buffer: true }, ws);
        return;
      }
      room.buffers.delete(ws);
      if (room.buffers.size || !room.pausedByBuffer) return;
      room.pausedByBuffer = false;
      room.paused = false;
      room.time = time;
      room.rate = rate;
      room.actionUntil = Date.now() + 2200;
      room.updated = Date.now();
      broadcast(room, { t: "chat", system: true, name: "", text: "Playback resumed" }, ws);
      broadcast(room, { t: "sync", time, paused: false, rate, url: room.url, at: Date.now(), name: ws.name }, ws);
      return;
    }
    if (msg.t === "turn") {
      if (tooFast(ws, "turn", 6, 60000)) return;
      if (ipTooFast(ws.ip || "?", "turn", 30, 60 * 60 * 1000)) return;
      const grant = turnGrant();
      if (!grant) return;
      ws.send(JSON.stringify(grant));
      return;
    }
    if (msg.t === "peer") {
      if (tooFast(ws, "peer", 8, 10000)) return;
      const id = String(msg.id || "");
      if (!/^wp[a-z0-9]{8,24}$/.test(id)) return;
      ws.peerId = id;
      const ids = peerIds(room);
      const packet = JSON.stringify({ t: "peers", ids });
      ws.send(packet);
      broadcast(room, { t: "peers", ids }, ws);
      return;
    }
    if (msg.t === "av" || msg.t === "recall") {
      if (tooFast(ws, "av", 10, 10000)) return;
      const peerId = String(msg.peerId || ws.peerId || "");
      if (peerId && !/^wp[a-z0-9]{8,24}$/.test(peerId)) return;
      broadcast(room, { t: msg.t, name: ws.name, peerId, audio: !!msg.audio, video: !!msg.video }, ws);
      return;
    }
    if (msg.t === "rename") {
      if (tooFast(ws, "rename", 3, 10000)) return;
      const next = uniqueName(room, cleanName(msg.name || ws.name), ws);
      const icon = cleanIcon(msg.icon || ws.icon);
      if (!next) return;
      const from = ws.name || "Friend";
      const queen = typeof msg.queen === "boolean" ? msg.queen : !!ws.queen;
      if (from === next && icon === ws.icon && queen === !!ws.queen) return;
      ws.name = next;
      ws.icon = icon;
      ws.queen = queen;
      room.updated = Date.now();
      broadcast(room, { t: "rename", from, name: next, icon, people: roster(room) }, ws);
      return;
    }
    if (msg.t === "e2e") {
      const kind = ["chat", "voice", "react", "love"].includes(msg.kind) ? msg.kind : null;
      if (!kind || typeof msg.iv !== "string" || typeof msg.ct !== "string") return;
      if (!/^[A-Za-z0-9+/=]{16,24}$/.test(msg.iv) || !/^[A-Za-z0-9+/=]+$/.test(msg.ct)) return;
      const limits = { chat: [8, 5000, 4000], voice: [4, 20000, 470000], react: [12, 5000, 400], love: [3, 6000, 200] }[kind];
      if (msg.ct.length > limits[2] || tooFast(ws, `e2e-${kind}`, limits[0], limits[1])) return;
      broadcast(room, { t: "e2e", kind, from: ws.name, icon: ws.icon || "fox", queen: !!ws.queen, iv: msg.iv, ct: msg.ct }, ws);
      return;
    }
    // In an encrypted party, plaintext chat/voice/reactions are refused so nothing leaks by accident.
    if (room.e2e && (msg.t === "voice" || msg.t === "react" || msg.t === "love" || (msg.t === "chat" && !msg.system))) return;
    if (msg.t === "voice") {
      if (tooFast(ws, "voice", 4, 20000)) return;
      const audio = String(msg.audio || "");
      if (audio.length < 40 || audio.length > 260000) return;
      if (!/^[A-Za-z0-9+/=]+$/.test(audio)) return;
      const mime = String(msg.mime || "audio/webm").slice(0, 40);
      if (!/^audio\/(webm|ogg|mp4)/.test(mime)) return;
      broadcast(room, { t: "voice", name: ws.name, audio, mime }, ws);
      return;
    }
    if (msg.t === "chat") {
      if (tooFast(ws, "chat", 8, 5000)) return;
      const text = String(msg.text || "")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
        .slice(0, 240)
        .replace(/[\uD800-\uDBFF]$/g, "");
      if (!text) return;
      if (msg.system) {
        if (tooFast(ws, "sys", 6, 5000)) return;
        const who = `${ws.name} `;
        if (!text.startsWith(who) || !SYSTEM_LINE.test(text.slice(who.length))) return;
        broadcast(room, { t: "chat", name: "", text, system: true }, ws);
        return;
      }
      broadcast(room, { t: "chat", name: cleanName(ws.name), icon: ws.icon || "fox", queen: !!ws.queen, text, system: false }, ws);
      return;
    }
    if (msg.t === "love") {
      if (tooFast(ws, "love", 3, 6000)) return;
      broadcast(room, { t: "love", name: cleanName(ws.name), queen: !!ws.queen }, ws);
      return;
    }
    if (msg.t === "react") {
      if (tooFast(ws, "react", 12, 5000)) return;
      const emoji = String(msg.emoji || "").slice(0, 8);
      if (!emoji) return;
      broadcast(room, { t: "react", name: cleanName(ws.name), emoji }, ws);
      return;
    }
    if (msg.t === "invite" || msg.t === "accept" || msg.t === "decline" || msg.t === "hang") {
      if (tooFast(ws, "call", 10, 10000)) return;
      const peerId = String(msg.peerId || "");
      if (peerId && !/^wp[a-z0-9]{8,24}$/.test(peerId)) return;
      broadcast(room, { t: msg.t, name: cleanName(ws.name), video: !!msg.video, peerId }, ws);
    }
  }

  ws.on("close", () => {
    if (!ws.room || ws.replaced) return;
    const room = ws.room;
    if (room.buffers) room.buffers.delete(ws);
    room.members.delete(ws);
    broadcast(room, { t: "roster", people: roster(room) });
    const gone = () => {
      // Still away (or they really said goodbye): now tell the others, and end their call link.
      broadcast(room, { t: "left", name: ws.name || "Someone" });
      if (ws.peerId && ![...room.members].some((m) => m.peerId === ws.peerId)) {
        broadcast(room, { t: "hang", name: ws.name || "Someone", peerId: ws.peerId, video: false });
        broadcast(room, { t: "peers", ids: peerIds(room) });
      }
    };
    if (ws.leaving || !ws.cid) {
      gone();
    } else {
      // Connection dropped without a goodbye: wait a little before announcing it.
      if (!room.away) room.away = new Map();
      const prev = room.away.get(ws.cid);
      if (prev) clearTimeout(prev.timer);
      if (room.away.size < 32) {
        const timer = setTimeout(() => {
          if (room.away.get(ws.cid)?.timer !== timer) return;
          room.away.delete(ws.cid);
          gone();
        }, AWAY_GRACE_MS);
        room.away.set(ws.cid, { timer, peerId: ws.peerId || "" });
      } else gone();
    }
    if (room.members.size === 0) {
      ws.room.updated = Date.now();
      setTimeout(() => {
        if (ws.room.members.size === 0 && rooms.get(ws.room.code) === ws.room) rooms.delete(ws.room.code);
      }, ROOM_GRACE_MS);
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 && now - room.updated > ROOM_GRACE_MS) rooms.delete(code);
  }
}, 30000);

const hb = JSON.stringify({ t: "hb" });
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
      if (ws.readyState === 1) ws.send(hb);
    } catch {
      /* ignore */
    }
  }
}, PING_MS);

server.listen(9010, "127.0.0.1", () => {
  console.log("watchparty server on 127.0.0.1:9010");
});

// Last line of defence: log and keep serving instead of dropping every party.
process.on("uncaughtException", (err) => console.error("uncaught:", err && err.stack));
process.on("unhandledRejection", (err) => console.error("unhandled:", err));
