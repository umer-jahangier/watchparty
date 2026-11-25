// WatchParty Web: same relay protocol as the extension, so web and extension users can
// share one party. Plays YouTube (IFrame API) and direct video files.
(() => {
  const WS_URL = "wss://cp.praivox.com/wp-ws/ws";
  const API = "https://cp.praivox.com/wp-api/party/";
  const ROOM_BASE = `${location.origin}/watchparty/web/?room=`;
  const QUICK = ["😂", "❤️", "🥰", "🔥", "👏", "😮", "😭", "🎉", "🍿", "👑"];
  // Emojis offered when customizing quick reactions (any other emoji can be typed or pasted too).
  const EMOJI_SETS = [
    ["Faces", "😀 😁 😂 🤣 😊 😇 🙂 😉 😍 🥰 😘 😋 😜 🤪 😎 🤩 🥳 😏 😅 😬 🙄 😮 😲 😱 🤯 😳 🥺 😢 😭 😤 😡 🤬 🤔 🤫 🤭 😴 🤤 🤮 💀 👻 🤡 😈 🫠 🫣 🫢 🥹 😶 🫡"],
    ["Love", "❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🩷 💖 💕 💞 💓 💗 💘 💝 💌 💋 😻 🌹 💐 💍 🫶 👑"],
    ["Hands", "👏 🙌 👍 👎 👌 🤌 🤞 ✌️ 🤟 🤘 👊 🙏 💪 🫡 👀 🤝 👋 🫰"],
    ["Fun", "🔥 ✨ 🎉 🎊 💯 ⭐ 🌟 💫 ⚡ 💥 🍿 🎬 🎮 🎵 🎶 🏆 🥇 🎯 💎 🚀 🌈 ☀️ 🌙 ❄️"],
    ["Animals & food", "🐶 🐱 🐻 🐼 🦊 🐰 🐨 🐯 🦁 🐸 🐵 🦄 🐝 🦋 🐢 🐙 🍕 🍔 🍟 🍩 🍪 🍫 🍦 ☕ 🧋 🍷 🍻 🍓 🍉 🥑"],
  ].map(([label, list]) => [label, list.split(" ")]);
  // One real emoji (flags, keycaps, skin tones and ZWJ sequences included), nothing else.
  function isEmoji(value) {
    if (typeof value !== "string" || !value || value.length > 16) return false;
    if (!/^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\u20e3]+$/u.test(value)) return false;
    if (!/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3]/u.test(value)) return false;
    try {
      return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].length === 1;
    } catch {
      return true;
    }
  }
  function firstEmoji(text) {
    try {
      for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(String(text || ""))) {
        if (isEmoji(segment)) return segment;
      }
    } catch {
      /* ignore */
    }
    return "";
  }
  const CHAT_EMOJIS = ["😀", "😁", "😂", "🤣", "😊", "😍", "😘", "😎", "🤩", "😅", "😢", "😭", "😡", "👍", "👎", "🙏", "👏", "🔥", "❤️", "💯", "🎉", "🍿", "🎬", "💀", "😮", "🤔", "😴", "🤝", "✨", "💜", "🥰", "👑", "🥺", "😻", "💕", "🌸"];
  const LOVE = ["❤️", "🥰", "💕", "💖", "💜"];
  const SYNC_MS = 1400;
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {
        /* private mode */
      }
    },
  };

  // ---------- identity ----------
  const me = {
    name: (store.get("wpw.name") || "").slice(0, 24),
    icon: store.get("wpw.icon") || "fox",
    queen: store.get("wpw.queen") === "1",
  };
  const CID = (() => {
    let c = null;
    try {
      c = sessionStorage.getItem("wpw.cid");
    } catch {
      /* ignore */
    }
    if (!c || !/^[a-z0-9]{8,40}$/.test(c)) {
      const buf = new Uint8Array(12);
      crypto.getRandomValues(buf);
      c = [...buf].map((n) => n.toString(36).padStart(2, "0")).join("").slice(0, 20);
      try {
        sessionStorage.setItem("wpw.cid", c);
      } catch {
        /* ignore */
      }
    }
    return c;
  })();
  const iconOk = (id) => (globalThis.WP_ICONS?.ok(id) ? id : "fox");
  me.icon = iconOk(me.icon);

  function setSvg(el, svg) {
    el.replaceChildren(document.importNode(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement, true));
  }

  function faceEl(id) {
    const el = document.createElement("span");
    el.className = "wp-face";
    const svg = globalThis.WP_ICONS?.svg(iconOk(id));
    if (svg) el.appendChild(document.importNode(new DOMParser().parseFromString(svg, "image/svg+xml").documentElement, true));
    return el;
  }

  function paintFaces(boxId) {
    const box = $(boxId);
    if (!box) return;
    box.replaceChildren();
    (globalThis.WP_ICONS?.ids || []).forEach((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = id === me.icon ? "on" : "";
      b.setAttribute("aria-label", `Avatar ${id}`);
      b.setAttribute("aria-pressed", id === me.icon ? "true" : "false");
      b.appendChild(faceEl(id));
      b.addEventListener("click", () => {
        me.icon = id;
        store.set("wpw.icon", id);
        ["me-faces", "gate-faces", "room-faces"].forEach(paintFaces);
        if (party.code) {
          send({ t: "rename", name: me.name, icon: me.icon });
          setPerson("me", { name: me.name, icon: me.icon, queen: me.queen });
          paintPeople();
        }
      });
      box.appendChild(b);
    });
  }

  function setName(raw) {
    const next = String(raw || "").trim().slice(0, 24);
    if (!next || next === me.name) return;
    const prev = me.name;
    me.name = next;
    store.set("wpw.name", next);
    ["me-name", "room-name", "gate-name"].forEach((id) => {
      if ($(id) && $(id).value !== next) $(id).value = next;
    });
    if (party.code) {
      send({ t: "rename", name: next, icon: me.icon });
      setPerson("me", { name: next, icon: me.icon, queen: me.queen });
      paintPeople();
      if (prev) sysLine(`${prev} is now ${next}`);
    }
  }

  // ---------- media ----------
  function parseMedia(raw) {
    let u;
    try {
      u = new URL(String(raw || "").trim());
    } catch {
      return null;
    }
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    let id = null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") id = u.searchParams.get("v");
      else if (/^\/(shorts|embed|live)\//.test(u.pathname)) id = u.pathname.split("/")[2];
    } else if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
    if (id && /^[A-Za-z0-9_-]{6,20}$/.test(id)) {
      return { kind: "yt", id, url: `https://www.youtube.com/watch?v=${id}`, key: `yt:${id}` };
    }
    if (/\.(mp4|webm|ogv|ogg|m4v|mov)$/i.test(u.pathname)) {
      return { kind: "file", url: u.toString(), key: `${u.origin}${u.pathname}` };
    }
    return { kind: "other", url: u.toString(), host: u.hostname.replace(/^www\./, ""), key: `${u.origin}${u.pathname}` };
  }

  let ytReady = null;
  function loadYouTubeApi() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve, reject) => {
      if (window.YT?.Player) return resolve();
      const fail = () => {
        ytReady = null;
        reject(new Error("The YouTube player couldn't load. Check your connection or ad blocker, then reload."));
      };
      const timer = setTimeout(fail, 12000);
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timer);
        prev?.();
        resolve();
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.onerror = () => {
        clearTimeout(timer);
        fail();
      };
      document.head.appendChild(s);
    });
    return ytReady;
  }

  const player = {
    media: null,
    yt: null,
    ready: false,
    video: $("player-video"),
    async load(media, startAt = 0, paused = true) {
      this.media = media;
      this.ready = false;
      $("player-msg").classList.add("hidden");
      if (!media) return;
      if (media.kind === "other") {
        this.showMsg(media);
        return;
      }
      if (media.kind === "file") {
        this.destroyYt();
        this.video.classList.remove("hidden");
        this.video.src = media.url;
        this.video.currentTime = startAt || 0;
        this.ready = true;
        return;
      }
      this.video.classList.add("hidden");
      this.video.removeAttribute("src");
      await loadYouTubeApi();
      if (this.yt) {
        this.yt.cueVideoById({ videoId: media.id, startSeconds: startAt || 0 });
        this.ready = true;
        if (!paused) this.play();
        return;
      }
      await new Promise((resolve) => {
        this.yt = new YT.Player("player-yt", {
          videoId: media.id,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(startAt || 0), origin: location.origin },
          events: {
            onReady: () => {
              this.ready = true;
              resolve();
            },
            onStateChange: (e) => onYtState(e.data),
            onError: (e) => {
              const code = Number(e?.data);
              sysLine(code === 101 || code === 150 ? "This video's owner doesn't allow it to play inside other sites. Pick another video." : "YouTube couldn't play this video.");
              resolve();
            },
          },
        });
      });
    },
    showMsg(media) {
      this.destroyYt();
      this.video.classList.add("hidden");
      const box = $("player-msg");
      box.replaceChildren();
      const inner = document.createElement("div");
      const b = document.createElement("b");
      b.textContent = `The host is watching on ${media.host}.`;
      const p = document.createElement("p");
      p.append("That site only works with the ");
      const a = document.createElement("a");
      a.href = "../";
      a.textContent = "WatchParty extension";
      p.append(a, " on a computer. You can still chat, react and send love here.");
      inner.append(b, p);
      box.appendChild(inner);
      box.classList.remove("hidden");
    },
    destroyYt() {
      if (!this.yt) return;
      try {
        this.yt.destroy();
      } catch {
        /* ignore */
      }
      this.yt = null;
      if (!$("player-yt")) {
        const d = document.createElement("div");
        d.id = "player-yt";
        $("player-box").prepend(d);
      }
    },
    usable() {
      return this.ready && this.media && this.media.kind !== "other";
    },
    time() {
      if (this.media?.kind === "file") return this.video.currentTime || 0;
      return this.yt?.getCurrentTime?.() || 0;
    },
    paused() {
      if (this.media?.kind === "file") return this.video.paused;
      const s = this.yt?.getPlayerState?.();
      return !(s === 1 || s === 3);
    },
    rate() {
      if (this.media?.kind === "file") return this.video.playbackRate || 1;
      return this.yt?.getPlaybackRate?.() || 1;
    },
    play() {
      if (this.media?.kind === "file") return this.video.play();
      this.yt?.playVideo?.();
      return Promise.resolve();
    },
    pause() {
      if (this.media?.kind === "file") this.video.pause();
      else this.yt?.pauseVideo?.();
    },
    seek(t) {
      if (this.media?.kind === "file") this.video.currentTime = Math.max(0, t);
      else this.yt?.seekTo?.(Math.max(0, t), true);
    },
    setRate(r) {
      if (this.media?.kind === "file") this.video.playbackRate = r;
      else this.yt?.setPlaybackRate?.(r);
    },
  };

  // ---------- sync ----------
  let applyingUntil = 0;
  // What a remote command last told the player to do. Player events that match it are echoes, not user actions.
  let expect = { paused: null, time: 0, at: 0, until: 0 };
  function isEcho(kind) {
    if (Date.now() > expect.until) return false;
    if (kind === "play") return expect.paused === false;
    if (kind === "pause") return expect.paused === true;
    if (kind === "seek") {
      const target = expect.paused ? expect.time : expect.time + (Date.now() - expect.at) / 1000;
      return Math.abs(player.time() - target) < 3;
    }
    return false;
  }
  let lastTick = { t: 0, at: 0, paused: true };
  let needTap = false;
  const applying = () => Date.now() < applyingUntil;

  function snapshot() {
    return { paused: player.paused(), time: player.time(), rate: player.rate(), url: player.media?.url || "", at: Date.now() };
  }

  function fmt(t) {
    const total = Math.max(0, Math.floor(Number(t) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  function announce(text) {
    sysLine(text);
    send({ t: "chat", name: "", text, system: true });
  }

  function localAction(kind) {
    if (!party.code || !player.usable() || applying() || isEcho(kind)) return;
    const snap = snapshot();
    send(party.role === "host" ? { t: "state", ...snap } : { t: "control", ...snap });
    if (kind === "play") announce(`${me.name} played from ${fmt(snap.time)}`);
    else if (kind === "pause") announce(`${me.name} paused at ${fmt(snap.time)}`);
    else if (kind === "seek") announce(`${me.name} skipped to ${fmt(snap.time)}`);
  }

  function onYtState(s) {
    if (s === 1 || s === 2) {
      lastTick = { t: player.time(), at: Date.now(), paused: s === 2 };
      if (s === 1) {
        needTap = false;
        $("tap-sync").classList.add("hidden");
      }
      if (!applying()) localAction(s === 1 ? "play" : "pause");
    }
  }

  ["play", "pause"].forEach((ev) =>
    player.video.addEventListener(ev, () => {
      if (ev === "play") $("tap-sync").classList.add("hidden");
      if (!applying()) localAction(ev);
    })
  );
  player.video.addEventListener("seeked", () => {
    if (!applying()) localAction("seek");
  });

  // YouTube has no seek event: detect jumps between ticks.
  setInterval(() => {
    if (!player.usable() || player.media.kind !== "yt") return;
    const now = Date.now();
    const t = player.time();
    const paused = player.paused();
    const expected = lastTick.paused ? lastTick.t : lastTick.t + ((now - lastTick.at) / 1000) * player.rate();
    if (lastTick.at && Math.abs(t - expected) > 2 && !applying()) localAction("seek");
    lastTick = { t, at: now, paused };
  }, 500);

  function applyRemote(msg) {
    if (!msg || typeof msg.time !== "number") return;
    const media = msg.url ? parseMedia(msg.url) : null;
    if (media && media.key !== player.media?.key) {
      applyingUntil = Date.now() + 2500;
      player.load(media, msg.time, !!msg.paused).then(() => applyRemote({ ...msg, url: "" })).catch((err) => sysLine(err.message));
      return;
    }
    if (!player.usable()) return;
    let target = Number(msg.time) || 0;
    if (!msg.paused && typeof msg.at === "number") {
      const extra = (Date.now() - msg.at) / 1000;
      if (extra > 0 && extra < 2.5) target += extra;
    }
    const drift = Math.abs(player.time() - target) > 1.2;
    const pauseChanged = !!msg.paused !== player.paused();
    const rate = Math.min(4, Math.max(0.25, Number(msg.rate) || 1));
    const rateChanged = Math.abs(player.rate() - rate) > 0.05;
    if (!drift && !pauseChanged && !rateChanged) return;
    applyingUntil = Date.now() + 1500;
    expect = { paused: !!msg.paused, time: target, at: Date.now(), until: Date.now() + 5000 };
    if (rateChanged) player.setRate(rate);
    if (drift) player.seek(target);
    if (msg.paused) player.pause();
    else {
      Promise.resolve(player.play()).catch(() => showTap());
      // Mobile browsers block playback without a tap; check shortly after.
      setTimeout(() => {
        if (!msg.paused && player.paused()) showTap();
      }, 1500);
    }
    lastTick = { t: target, at: Date.now(), paused: !!msg.paused };
  }

  function showTap() {
    if (!player.usable()) return;
    needTap = true;
    $("tap-sync").classList.remove("hidden");
  }

  $("tap-sync").addEventListener("click", async () => {
    $("tap-sync").classList.add("hidden");
    needTap = false;
    applyingUntil = Date.now() + 1200;
    try {
      await player.play();
    } catch {
      /* ignore */
    }
    try {
      const r = await fetch(API + party.code);
      if (r.ok) applyRemote(await r.json());
    } catch {
      /* ignore */
    }
  });

  setInterval(() => {
    if (party.role !== "host" || !player.usable() || applying()) return;
    send({ t: "state", beat: true, ...snapshot() });
  }, SYNC_MS);

  // ---------- connection ----------
  const E2E = globalThis.WP_E2E;
  const crypt = { secret: null, key: null };
  async function setSecret(code, secret) {
    crypt.secret = secret && E2E.validSecret(secret) ? secret : null;
    crypt.key = crypt.secret ? await E2E.deriveKey(code, crypt.secret) : null;
    $("lock").classList.toggle("hidden", !crypt.key);
  }
  async function sendSecure(kind, obj, plain) {
    if (crypt.key) send({ t: "e2e", kind, ...(await E2E.seal(crypt.key, kind, obj)) });
    else send(plain);
  }
  const party = { code: null, role: null, socket: null, wanted: false, tries: 0, timer: null, lastRx: 0, conn: "offline" };
  const people = new Map();

  function send(payload) {
    if (party.socket?.readyState === 1) party.socket.send(JSON.stringify(payload));
  }

  function setConn(state) {
    const wasDown = party.conn === "reconnecting";
    party.conn = state;
    const el = $("conn");
    el.dataset.state = state;
    el.querySelector("span").textContent = { live: "Live", connecting: "Connecting", reconnecting: "Reconnecting", offline: "Offline" }[state];
    const banner = $("banner");
    if (state === "reconnecting") {
      banner.textContent = "Connection lost. Reconnecting…";
      banner.dataset.kind = "warn";
      banner.classList.remove("hidden");
    } else if (state === "live" && wasDown) {
      banner.textContent = "Back in the party.";
      banner.dataset.kind = "ok";
      banner.classList.remove("hidden");
      setTimeout(() => banner.classList.add("hidden"), 2400);
    } else if (state !== "reconnecting") banner.classList.add("hidden");
  }

  function connect(resume) {
    party.wanted = true;
    if (!resume) setConn("connecting");
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      let opened = false;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error("Couldn't reach the WatchParty server."));
      }, 8000);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timer);
        if (party.socket && party.socket !== ws) {
          party.socket.onclose = null;
          try {
            party.socket.close();
          } catch {
            /* ignore */
          }
        }
        party.socket = ws;
        party.lastRx = Date.now();
        // Only treat the connection as healthy once it has stayed up for a while.
        clearTimeout(party.stable);
        party.stable = setTimeout(() => (party.tries = 0), 10000);
        const snap = player.usable() ? snapshot() : { time: 0, paused: true, rate: 1, url: player.media?.url || "" };
        ws.send(JSON.stringify({ t: "hello", code: party.code, name: me.name, icon: me.icon, cid: CID, resume: !!resume, queen: me.queen, role: party.role, e2e: !!crypt.key && party.role === "host", ...snap }));
        setConn("live");
        resolve();
      };
      ws.onmessage = (ev) => {
        party.lastRx = Date.now();
        onMessage(ev.data);
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        clearTimeout(party.stable);
        if (party.socket === ws) party.socket = null;
        if (!opened) reject(new Error("Couldn't reach the WatchParty server."));
        if (ev.code === 4001) {
          party.wanted = false;
          setConn("offline");
          sysLine("This party is open in another tab, so this one disconnected.");
          return;
        }
        if (party.wanted && (opened || resume)) reconnectLater();
      };
    });
  }

  function reconnectLater(now) {
    if (!party.wanted) return;
    clearTimeout(party.timer);
    setConn("reconnecting");
    const delay = now ? 0 : Math.min(15000, 1000 * 2 ** Math.min(party.tries, 4)) + Math.random() * 600;
    party.tries += 1;
    party.timer = setTimeout(() => connect(true).catch(() => {}), delay);
  }

  setInterval(() => {
    if (!party.socket || party.socket.readyState !== 1) return;
    if (Date.now() - party.lastRx > 65000) party.socket.close();
    else send({ t: "hb" });
  }, 20000);
  const wake = () => {
    if (party.wanted && (!party.socket || party.socket.readyState > 1)) reconnectLater(true);
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") wake();
  });

  // ---------- people ----------
  function setPerson(key, row) {
    people.set(key, row);
  }

  function setRoster(list) {
    const rows = (list || []).filter(Boolean).map((r) => ({ name: String(r.name || "Friend").slice(0, 24), icon: iconOk(r.icon), queen: !!r.queen }));
    const mine = rows.findIndex((r) => r.name === me.name);
    if (mine >= 0) rows.splice(mine, 1);
    people.clear();
    rows.forEach((r, i) => people.set(`u${i}`, r));
    people.set("me", { name: me.name, icon: me.icon, queen: me.queen });
    paintPeople();
  }

  function queenFor(name) {
    if (name === me.name) return me.queen;
    for (const r of people.values()) if (r.name === name) return r.queen;
    return false;
  }

  function iconFor(name) {
    if (name === me.name) return me.icon;
    for (const r of people.values()) if (r.name === name) return r.icon;
    return "fox";
  }

  function crownEl() {
    const c = document.createElement("span");
    c.className = "crown";
    c.title = "Queen";
    c.textContent = "👑";
    return c;
  }

  let peopleFrame = 0;
  function paintPeople() {
    if (peopleFrame) return;
    peopleFrame = requestAnimationFrame(() => {
      peopleFrame = 0;
      paintPeopleNow();
    });
  }
  function paintPeopleNow() {
    const box = $("people");
    box.replaceChildren();
    const list = [...people.values()];
    if (!list.length) list.push({ name: me.name, icon: me.icon, queen: me.queen });
    list.forEach((p) => {
      const chip = document.createElement("span");
      chip.className = p.name === me.name ? "chip me" : "chip";
      const label = document.createElement("span");
      label.textContent = p.name;
      chip.append(faceEl(p.icon), label);
      if (p.queen) chip.appendChild(crownEl());
      box.appendChild(chip);
    });
  }

  // ---------- chat ----------
  const EMOJI_RE = /(\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*)/gu;
  const clock = () => new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  function bubbleFor(text) {
    const b = document.createElement("div");
    const count = (text.match(EMOJI_RE) || []).length;
    const only = count > 0 && count <= 6 && text.replace(EMOJI_RE, "").trim() === "";
    b.className = only ? `bubble jumbo${count === 1 ? " jumbo1" : ""}` : "bubble";
    if (only) {
      b.textContent = text.replace(/\s+/g, "");
      return b;
    }
    text.split(EMOJI_RE).forEach((part, i) => {
      if (!part) return;
      if (i % 2) {
        const em = document.createElement("span");
        em.className = "em";
        em.textContent = part;
        b.appendChild(em);
      } else b.appendChild(document.createTextNode(part));
    });
    return b;
  }

  function metaFor(name, mine, queen) {
    const m = document.createElement("div");
    m.className = "meta";
    const b = document.createElement("b");
    b.textContent = mine ? "You" : name || "Friend";
    m.appendChild(b);
    if (queen) m.appendChild(crownEl());
    const t = document.createElement("time");
    t.textContent = clock();
    m.appendChild(t);
    return m;
  }

  function pushRow(row) {
    const box = $("chat");
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.appendChild(row);
    while (box.children.length > 300) {
      box.firstElementChild._release?.();
      box.firstElementChild.remove();
    }
    if (stick) box.scrollTop = box.scrollHeight;
  }

  function sysLine(text) {
    const row = document.createElement("div");
    row.className = "sys";
    row.textContent = text;
    pushRow(row);
  }

  function chatLine(name, text, queen, icon) {
    const mine = name === me.name;
    const isQueen = mine ? me.queen : !!queen || queenFor(name);
    const row = document.createElement("div");
    row.className = `msg ${mine ? "mine" : "theirs"}${isQueen ? " royal" : ""}`;
    const col = document.createElement("div");
    col.append(metaFor(name, mine, isQueen), bubbleFor(String(text)));
    row.append(faceEl(icon || iconFor(name)), col);
    pushRow(row);
  }

  function voiceLine(name, audio, mime) {
    if (!/^[A-Za-z0-9+/=]+$/.test(audio || "") || audio.length > 300000) return;
    const safe = /^audio\/(webm|ogg|mp4|mpeg)/.test(mime || "") ? String(mime).split(";")[0] : "audio/webm";
    const mine = name === me.name;
    const row = document.createElement("div");
    row.className = `msg ${mine ? "mine" : "theirs"}${queenFor(name) ? " royal" : ""}`;
    const col = document.createElement("div");
    const clip = document.createElement("div");
    clip.className = "clip";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-label", "Play voice message");
    setSvg(btn, '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>');
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("i");
    bar.appendChild(fill);
    const time = document.createElement("time");
    time.textContent = "0:00";
    const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0));
    const blobUrl = URL.createObjectURL(new Blob([bytes], { type: safe }));
    const a = new Audio(blobUrl);
    row.dataset.voice = "1";
    row._release = () => URL.revokeObjectURL(blobUrl);
    a.preload = "metadata";
    a.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(a.duration)) time.textContent = fmt(a.duration);
    });
    a.addEventListener("timeupdate", () => {
      if (a.duration) fill.style.width = `${(a.currentTime / a.duration) * 100}%`;
    });
    a.addEventListener("ended", () => {
      fill.style.width = "0%";
      setSvg(btn, '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>');
    });
    btn.addEventListener("click", () => {
      if (a.paused) {
        a.play().catch(() => {});
        setSvg(btn, '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>');
      } else {
        a.pause();
        setSvg(btn, '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>');
      }
    });
    clip.append(btn, bar, time);
    const notes = $("chat").querySelectorAll('[data-voice="1"]');
    if (notes.length >= 20) {
      notes[0]._release?.();
      notes[0].remove();
    }
    col.append(metaFor(name, mine, mine ? me.queen : queenFor(name)), clip);
    row.append(faceEl(iconFor(name)), col);
    pushRow(row);
  }

  // ---------- effects ----------
  const FX_MAX = 80;
  function burst(emoji, from) {
    const fx = $("fx");
    if (fx.childElementCount > FX_MAX) return;
    const el = document.createElement("div");
    el.className = "burst";
    const e = document.createElement("span");
    e.textContent = emoji;
    el.appendChild(e);
    if (from) {
      const w = document.createElement("span");
      w.className = "who";
      w.textContent = from;
      el.appendChild(w);
    }
    const x = 6 + Math.random() * 80;
    el.style.left = `${x}%`;
    fx.appendChild(el);
    setTimeout(() => el.remove(), 2300);
    if (LOVE.includes(emoji)) {
      for (let i = 0; i < 6; i += 1) {
        const h = document.createElement("div");
        h.className = "burst heart";
        const s = document.createElement("span");
        s.textContent = ["💗", "💕", "💖"][i % 3];
        s.style.fontSize = "20px";
        h.appendChild(s);
        h.style.left = `${Math.max(2, Math.min(94, x + Math.random() * 16 - 8))}%`;
        h.style.animationDelay = `${120 + i * 110}ms`;
        fx.appendChild(h);
        setTimeout(() => h.remove(), 4000);
      }
    }
  }

  let lastBuzz = 0;
  function loveShower(incoming, from) {
    const fx = $("fx");
    if (fx.childElementCount > FX_MAX) return;
    const hearts = ["💖", "💗", "💕", "❤️", "💘", "💞"];
    const n = incoming ? 24 : 10;
    for (let i = 0; i < n; i += 1) {
      const el = document.createElement("div");
      el.className = "burst heart";
      const s = document.createElement("span");
      s.textContent = hearts[i % hearts.length];
      s.style.fontSize = `${(incoming ? 24 : 18) + Math.random() * (incoming ? 30 : 14)}px`;
      el.appendChild(s);
      el.style.left = `${2 + Math.random() * 94}%`;
      el.style.animationDelay = `${Math.random() * (incoming ? 1400 : 600)}ms`;
      fx.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    }
    if (!incoming) return;
    const note = document.createElement("div");
    note.className = "love-note";
    note.textContent = `${from} sent you love 💖`;
    fx.appendChild(note);
    setTimeout(() => note.remove(), 3600);
    if (navigator.vibrate && Date.now() - lastBuzz > 10000) {
      lastBuzz = Date.now();
      navigator.vibrate([60, 60, 60]);
    }
  }

  // ---------- incoming ----------
  const loveFrom = new Map();
  function onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    if (msg.t === "e2e") {
      if (!crypt.key) return;
      const from = String(msg.from || "Friend").slice(0, 24);
      E2E.open(crypt.key, msg.kind, msg.iv, msg.ct).then((obj) => {
        if (!obj) return;
        if (msg.kind === "chat") onMessage(JSON.stringify({ t: "chat", name: from, icon: msg.icon, queen: !!msg.queen, text: String(obj.text || "") }));
        else if (msg.kind === "voice") onMessage(JSON.stringify({ t: "voice", name: from, audio: String(obj.audio || ""), mime: String(obj.mime || "") }));
        else if (msg.kind === "react") onMessage(JSON.stringify({ t: "react", name: from, emoji: String(obj.emoji || "") }));
        else if (msg.kind === "love") onMessage(JSON.stringify({ t: "love", name: from }));
      });
      return;
    }
    switch (msg.t) {
      case "hb":
        return;
      case "full":
        party.wanted = false;
        return;
      case "welcome":
        if (msg.e2e && !crypt.key) sysLine("This party is end-to-end encrypted. Rejoin with the full code to read messages.");
        setRoster(msg.people);
        if (msg.url && party.role !== "host") applyRemote(msg);
        return;
      case "roster":
        setRoster(msg.people);
        return;
      case "joined":
        sysLine(`${msg.name} joined`);
        return;
      case "left":
        sysLine(`${msg.name} left`);
        return;
      case "rename":
        if (msg.from && msg.name && msg.from !== msg.name) sysLine(`${msg.from} is now ${msg.name}`);
        if (Array.isArray(msg.people)) setRoster(msg.people);
        return;
      case "sync":
      case "control":
        applyRemote(msg);
        return;
      case "chat":
        if (msg.system) sysLine(String(msg.text || ""));
        else chatLine(String(msg.name || "Friend").slice(0, 24), String(msg.text || "").slice(0, 240), msg.queen, msg.icon);
        return;
      case "react":
        if (isEmoji(msg.emoji)) burst(msg.emoji, String(msg.name || "").slice(0, 24));
        return;
      case "love": {
        const from = String(msg.name || "Someone").slice(0, 24);
        const last = loveFrom.get(from) || 0;
        if (Date.now() - last < 4000) return; // one shower per person every few seconds
        loveFrom.set(from, Date.now());
        if (loveFrom.size > 50) loveFrom.clear();
        loveShower(true, from);
        sysLine(`${from} sent you love 💖`);
        return;
      }
      case "voice":
        voiceLine(String(msg.name || "Friend").slice(0, 24), msg.audio, msg.mime);
        return;
      default:
    }
  }

  // ---------- room lifecycle ----------
  function makeCode() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const buf = new Uint8Array(6);
    crypto.getRandomValues(buf);
    return [...buf].map((n) => a[n % a.length]).join("");
  }

  function inviteLink() {
    return ROOM_BASE + party.code + (crypt.secret ? `#k=${crypt.secret}` : "");
  }

  function enterRoom() {
    $("landing").classList.add("hidden");
    $("name-gate").classList.add("hidden");
    $("room").classList.remove("hidden");
    $("code-text").textContent = party.code;
    $("room-name").value = me.name;
    paintFaces("room-faces");
    document.querySelectorAll(".host-only").forEach((el) => el.classList.toggle("hidden", party.role !== "host"));
    $("queen-ask").classList.toggle("hidden", me.queen);
    setPerson("me", { name: me.name, icon: me.icon, queen: me.queen });
    paintPeople();
    history.replaceState(null, "", `?room=${party.code}${crypt.secret ? `#k=${crypt.secret}` : ""}`);
    try {
      sessionStorage.setItem("wpw.role", JSON.stringify({ code: party.code, role: party.role }));
    } catch {
      /* ignore */
    }
  }

  async function startParty(url) {
    const media = parseMedia(url);
    if (!media || media.kind === "other") throw new Error("Paste a YouTube link or a direct video file (.mp4, .webm).");
    party.code = makeCode();
    party.role = "host";
    await setSecret(party.code, E2E.randomChars(E2E.SECRET_LEN));
    enterRoom();
    player.media = media; // so the hello already carries the link
    await connect(false);
    await player.load(media, 0, true).catch((err) => sysLine(err.message));
    sysLine("Your party is live. Tap the code at the top to copy the invite link.");
  }

  async function joinParty(input, resume, hashSecret) {
    const parsed = E2E.parse(input);
    const clean = parsed?.code || "";
    if (clean.length < 4) throw new Error("That code looks too short.");
    const secret = parsed?.secret || hashSecret || null;
    const r = await fetch(API + clean).catch(() => null);
    if (!r || !r.ok) throw new Error("That party isn't live. Ask the host to start it again.");
    const info = await r.json();
    if (info.e2e && !secret) throw new Error("This party is end-to-end encrypted. Ask the host for the full code, like K7Q2MX-9F4TB-2W8QH, or the invite link.");
    party.code = clean;
    await setSecret(clean, secret);
    if (!(resume && party.role === "host")) party.role = "guest";
    enterRoom();
    const media = parseMedia(info.url);
    await connect(!!resume);
    await player.load(media, Number(info.time) || 0, true).catch((err) => sysLine(err.message));
    if (party.role === "guest") {
      applyRemote(info);
      if (!info.paused) showTap();
    }
  }

  function leave() {
    party.wanted = false;
    clearTimeout(party.timer);
    if (party.socket) {
      party.socket.onclose = null;
      try {
        if (party.socket.readyState === 1) party.socket.send(JSON.stringify({ t: "leave" }));
        party.socket.close();
      } catch {
        /* ignore */
      }
    }
    try {
      sessionStorage.removeItem("wpw.role");
    } catch {
      /* ignore */
    }
    location.href = location.pathname;
  }

  // ---------- UI wiring ----------
  function wire() {
    ["me-faces", "gate-faces"].forEach(paintFaces);
    $("me-name").value = me.name;
    $("gate-name").value = me.name;
    $("me-name").addEventListener("change", (e) => setName(e.target.value));
    $("room-name").addEventListener("change", (e) => setName(e.target.value));

    $("start-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      setName($("me-name").value || me.name || "Host");
      if (!me.name) setName("Host");
      const err = $("start-err");
      err.classList.add("hidden");
      try {
        await startParty($("start-url").value);
      } catch (ex) {
        $("room").classList.add("hidden");
        $("landing").classList.remove("hidden");
        err.textContent = ex.message;
        err.classList.remove("hidden");
      }
    });

    $("join-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!me.name) setName($("me-name").value || "Friend");
      const err = $("join-err");
      err.classList.add("hidden");
      try {
        await joinParty($("join-code").value);
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove("hidden");
      }
    });

    $("gate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      setName($("gate-name").value || "Friend");
      const err = $("gate-err");
      err.classList.add("hidden");
      try {
        await joinParty($("gate-form").dataset.code, false, roomSecret);
      } catch (ex) {
        err.textContent = ex.message;
        err.classList.remove("hidden");
      }
    });

    $("code-btn").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(inviteLink());
        $("code-btn").classList.add("copied");
        setTimeout(() => $("code-btn").classList.remove("copied"), 1400);
      } catch {
        prompt("Copy this invite link:", inviteLink());
      }
    });
    $("share-btn").addEventListener("click", async () => {
      const data = { title: "Watch with me 💜", text: `Join my WatchParty (code ${crypt.secret ? E2E.format(party.code, crypt.secret) : party.code})`, url: inviteLink() };
      if (navigator.share) {
        try {
          await navigator.share(data);
        } catch {
          /* cancelled */
        }
      } else $("code-btn").click();
    });
    $("more-btn").addEventListener("click", () => {
      const open = $("more").classList.toggle("hidden") === false;
      $("more-btn").setAttribute("aria-expanded", open ? "true" : "false");
    });
    $("leave-btn").addEventListener("click", leave);

    $("queen-ask").addEventListener("click", () => {
      $("queen").classList.remove("hidden");
      $("queen-ask").classList.add("hidden");
    });
    $("queen-no").addEventListener("click", () => {
      $("queen").classList.add("hidden");
      $("queen-ask").classList.remove("hidden");
    });
    $("queen-yes").addEventListener("click", () => {
      me.queen = true;
      store.set("wpw.queen", "1");
      $("queen").classList.add("hidden");
      setPerson("me", { name: me.name, icon: me.icon, queen: true });
      paintPeople();
      send({ t: "rename", name: me.name, icon: me.icon, queen: true });
      sendSecure("react", { emoji: "👑" }, { t: "react", name: me.name, emoji: "👑" });
      ["👑", "💖", "✨", "💜", "👑", "💕"].forEach((em, i) => setTimeout(() => burst(em, i ? "" : me.name), i * 140));
      sysLine("Welcome, your majesty 👑");
    });

    $("change-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const media = parseMedia($("change-url").value);
      if (!media || media.kind === "other") {
        sysLine("Paste a YouTube link or a direct video file.");
        return;
      }
      await player.load(media, 0, true);
      $("change-url").value = "";
      send({ t: "state", paused: true, time: 0, rate: 1, url: media.url, at: Date.now() });
      announce(`${me.name} changed the video`);
    });

    const reacts = $("reacts");
    const quickEdit = $("quick-edit");
    let quick = QUICK.slice();
    let quickSlot = -1; // slot being customized, -1 when not editing
    try {
      const saved = JSON.parse(store.get("wpw.quick") || "null");
      if (Array.isArray(saved) && saved.length === QUICK.length && saved.every(isEmoji)) quick = saved;
    } catch {
      /* ignore */
    }
    const slotBtns = QUICK.map((_, slot) => {
      const b = document.createElement("button");
      b.type = "button";
      b.addEventListener("click", () => {
        if (quickSlot >= 0) {
          quickSlot = slot;
          paintQuick();
          return;
        }
        const em = quick[slot];
        burst(em, me.name);
        sendSecure("react", { emoji: em }, { t: "react", name: me.name, emoji: em });
      });
      reacts.appendChild(b);
      return b;
    });
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "quick-edit-btn";
    editBtn.setAttribute("aria-label", "Customize quick reactions");
    editBtn.title = "Choose your own reactions";
    editBtn.append(new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="m14.5 7.5 3 3"/></svg>', "image/svg+xml").documentElement);
    editBtn.addEventListener("click", () => toggleQuickEdit(quickSlot < 0));
    reacts.appendChild(editBtn);
    const grid = quickEdit.querySelector(".qe-grid");
    const pickBtns = [];
    EMOJI_SETS.forEach(([label, list]) => {
      const l = document.createElement("div");
      l.className = "qe-label";
      l.textContent = label;
      grid.appendChild(l);
      list.forEach((em) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = em;
        b.setAttribute("aria-label", `Use ${em}`);
        b.addEventListener("click", () => pickQuick(em));
        grid.appendChild(b);
        pickBtns.push(b);
      });
    });
    function paintQuick() {
      const editing = quickSlot >= 0;
      slotBtns.forEach((b, slot) => {
        b.textContent = quick[slot];
        b.classList.toggle("picking", slot === quickSlot);
        b.title = editing ? "Change this reaction" : "React on the video";
        b.setAttribute("aria-pressed", editing ? String(slot === quickSlot) : "false");
      });
      reacts.classList.toggle("editing", editing);
      quickEdit.classList.toggle("hidden", !editing);
      editBtn.classList.toggle("on", editing);
      editBtn.setAttribute("aria-expanded", String(editing));
      pickBtns.forEach((b) => b.classList.toggle("in-use", quick.includes(b.textContent)));
    }
    function toggleQuickEdit(open) {
      quickSlot = open ? 0 : -1;
      if (open) $("picker").classList.add("hidden");
      paintQuick();
    }
    function pickQuick(em) {
      if (quickSlot < 0 || !isEmoji(em)) return;
      const next = quick.slice();
      const already = next.indexOf(em);
      if (already >= 0 && already !== quickSlot) next[already] = next[quickSlot]; // swap instead of duplicating
      next[quickSlot] = em;
      quick = next;
      store.set("wpw.quick", JSON.stringify(next));
      const pop = slotBtns[quickSlot];
      pop.classList.remove("swapped");
      void pop.offsetWidth;
      pop.classList.add("swapped");
      quickSlot = (quickSlot + 1) % QUICK.length;
      paintQuick();
    }
    quickEdit.querySelector(".qe-done").addEventListener("click", () => toggleQuickEdit(false));
    quickEdit.querySelector(".qe-reset").addEventListener("click", () => {
      quick = QUICK.slice();
      store.set("wpw.quick", JSON.stringify(quick));
      quickSlot = 0;
      paintQuick();
    });
    const own = quickEdit.querySelector(".qe-own");
    own.addEventListener("input", () => {
      const em = firstEmoji(own.value);
      if (em) {
        pickQuick(em);
        own.value = "";
      }
    });
    own.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
      if (e.key === "Escape") toggleQuickEdit(false);
    });
    paintQuick();
    const picker = $("picker");
    CHAT_EMOJIS.forEach((em) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = em;
      b.addEventListener("click", () => {
        const input = $("chat-input");
        const at = input.selectionStart ?? input.value.length;
        input.value = input.value.slice(0, at) + em + input.value.slice(input.selectionEnd ?? at);
        input.focus();
      });
      picker.appendChild(b);
    });
    $("emoji-btn").addEventListener("click", () => {
      if (quickSlot >= 0) toggleQuickEdit(false);
      picker.classList.toggle("hidden");
    });

    $("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const text = $("chat-input").value.trim();
      if (!text) return;
      $("chat-input").value = "";
      picker.classList.add("hidden");
      chatLine(me.name, text, me.queen, me.icon);
      sendSecure("chat", { text }, { t: "chat", name: me.name, text });
    });

    let lastLove = 0;
    $("love-btn").addEventListener("click", () => {
      if (Date.now() - lastLove < 2000) return;
      lastLove = Date.now();
      sendSecure("love", {}, { t: "love", name: me.name });
      loveShower(false);
      sysLine("You sent love 💖");
      const b = $("love-btn");
      b.classList.remove("sent");
      void b.offsetWidth;
      b.classList.add("sent");
    });

    // voice notes (iPhone records audio/mp4, others webm)
    let rec = null;
    let recStream = null;
    let recTimer = null;
    $("voice-btn").addEventListener("click", async () => {
      if (rec?.state === "recording") {
        rec.stop();
        return;
      }
      try {
        recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
        const chunks = [];
        rec = new MediaRecorder(recStream, type ? { mimeType: type } : undefined);
        rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
        rec.onstop = async () => {
          clearTimeout(recTimer);
          $("voice-btn").classList.remove("rec");
          recStream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
          if (blob.size < 700) return;
          if (blob.size > 180000) {
            sysLine("That voice message is too long. Keep it under 20 seconds.");
            return;
          }
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let bin = "";
          for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
          const audio = btoa(bin);
          const mime = (blob.type || "audio/webm").split(";")[0];
          voiceLine(me.name, audio, mime);
          sendSecure("voice", { audio, mime }, { t: "voice", name: me.name, audio, mime });
        };
        rec.start();
        $("voice-btn").classList.add("rec");
        recTimer = setTimeout(() => rec?.state === "recording" && rec.stop(), 20000);
      } catch (ex) {
        recStream?.getTracks().forEach((t) => t.stop());
        sysLine(`Couldn't record: ${ex.message}`);
      }
    });

    $("join-code").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase();
    });
  }

  // ---------- boot ----------
  if (new URLSearchParams(location.search).has("debug")) window.__watchparty = { player, party };
  wire();
  const params = new URLSearchParams(location.search);
  const room = (params.get("room") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const hashKey = (new URLSearchParams(location.hash.slice(1)).get("k") || "").toUpperCase();
  const roomSecret = E2E.validSecret(hashKey) ? hashKey : null;
  if (room) {
    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem("wpw.role") || "null");
    } catch {
      /* ignore */
    }
    if (saved?.code === room && me.name) {
      party.role = saved.role;
      joinParty(room, true, roomSecret).catch((ex) => {
        $("landing").classList.remove("hidden");
        $("join-code").value = room;
        $("join-err").textContent = ex.message;
        $("join-err").classList.remove("hidden");
      });
    } else {
      $("gate-form").dataset.code = room;
      $("gate-title").textContent = `Joining party ${room}`;
      $("name-gate").classList.remove("hidden");
      $("landing").classList.remove("hidden");
      setTimeout(() => $("gate-name").focus(), 50);
    }
  } else {
    $("landing").classList.remove("hidden");
  }
})();
