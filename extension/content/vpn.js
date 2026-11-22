// VPN check without any extra permissions.
// The relay reports the IP it sees for normal web traffic; a WebRTC (STUN) probe reports the IP the
// browser uses for calls. A VPN/proxy browser extension makes them differ, or blocks WebRTC entirely.
// Nothing is sent anywhere: the two addresses are only compared in this browser.
(() => {
  if (globalThis.WP_VPN) return;
  function stunIps(timeoutMs = 2500) {
    return new Promise((resolve) => {
      let pc;
      const ips = new Set();
      const done = () => {
        try {
          pc?.close();
        } catch {
          /* ignore */
        }
        resolve([...ips]);
      };
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:cp.praivox.com:3478" }] });
      } catch {
        resolve([]);
        return;
      }
      const timer = setTimeout(done, timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          done();
          return;
        }
        const m = String(e.candidate.candidate || "").match(/ (\d{1,3}(?:\.\d{1,3}){3}) \d+ typ srflx/);
        if (m) ips.add(m[1]);
      };
      pc.createDataChannel("probe");
      pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(() => {
        clearTimeout(timer);
        done();
      });
    });
  }
  async function check() {
    const seen = await fetch("https://cp.praivox.com/wp-api/whoami", { cache: "no-store", credentials: "omit" })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (!seen?.ip) return { vpn: false, unknown: true };
    const ips = await stunIps();
    if (!ips.length) return { vpn: true, reason: "WebRTC is restricted in this browser, which VPN extensions often do" };
    if (!ips.includes(seen.ip)) return { vpn: true, reason: "this browser's web traffic goes through a VPN or proxy" };
    return { vpn: false };
  }
  globalThis.WP_VPN = { check };
})();
