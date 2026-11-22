// WatchParty end-to-end encryption (shared by the extension and WatchParty Web).
// Full party code = 6-char room code (seen by the server) + 10-char secret (never sent to it).
// Key = PBKDF2-SHA256(secret, salt "watchparty-e2e:" + code, 210000 rounds) -> AES-256-GCM.
// The relay only ever sees ciphertext for chat, voice notes, reactions and love.
(() => {
  if (globalThis.WP_E2E) return;
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const ROUNDS = 210000;
  const SECRET_LEN = 10;

  function randomChars(n) {
    const out = [];
    const buf = new Uint8Array(1);
    while (out.length < n) {
      crypto.getRandomValues(buf);
      if (buf[0] < 256 - (256 % ALPHABET.length)) out.push(ALPHABET[buf[0] % ALPHABET.length]);
    }
    return out.join("");
  }

  // Accepts "K7Q2MX-9F4TB-2W8QH", "K7Q2MX9F4TB2W8QH" or a plain old 6-char code.
  function parse(input) {
    const clean = String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length === 6 + SECRET_LEN) return { code: clean.slice(0, 6), secret: clean.slice(6) };
    if (clean.length >= 4 && clean.length <= 10) return { code: clean, secret: null };
    return null;
  }

  function format(code, secret) {
    return secret ? `${code}-${secret.slice(0, 5)}-${secret.slice(5)}` : code;
  }

  function validSecret(s) {
    return typeof s === "string" && new RegExp(`^[${ALPHABET}]{${SECRET_LEN}}$`).test(s);
  }

  function toB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function deriveKey(code, secret) {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(`watchparty-e2e:${code}`), iterations: ROUNDS },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  // kind is bound into the ciphertext (AAD) so a "react" can't be replayed as a "chat".
  async function seal(key, kind, obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(kind) }, key, data));
    return { iv: toB64(iv), ct: toB64(ct) };
  }

  async function open(key, kind, iv, ct) {
    try {
      if (typeof iv !== "string" || typeof ct !== "string" || iv.length > 24 || ct.length > 480000) return null;
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv), additionalData: new TextEncoder().encode(kind) }, key, fromB64(ct));
      const obj = JSON.parse(new TextDecoder().decode(pt));
      return obj && typeof obj === "object" ? obj : null;
    } catch {
      return null; // wrong key or tampered: ignore
    }
  }

  globalThis.WP_E2E = { randomChars, parse, format, validSecret, deriveKey, seal, open, SECRET_LEN };
})();
