// Publishes WatchParty as a LISTED add-on on addons.mozilla.org (AMO API v5).
// Usage (on the server): node amo-listed.mjs <amo.zip> <shot1.png> <shot2.png>
import fs from "node:fs";
import crypto from "node:crypto";
const env = Object.fromEntries(fs.readFileSync("/root/.amo-credentials", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const API = "https://addons.mozilla.org/api/v5";
const GUID = encodeURIComponent("watchparty@praivox.com");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iss: env.AMO_JWT_ISSUER, jti: crypto.randomUUID(), iat: now, exp: now + 240 });
  return `${h}.${p}.${crypto.createHmac("sha256", env.AMO_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
}
async function api(path, opts = {}) {
  const res = await fetch(API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `JWT ${jwt()}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${opts.method || "GET"} ${path}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : {};
}
const J = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const [, , zip, shot1, shot2] = process.argv;
const L = (s) => ({ "en-US": s });

console.log("1/4 listing details");
await api(`/addons/addon/${GUID}/`, J("PATCH", {
  name: L("WatchParty"),
  summary: L("Watch videos together in sync from anywhere: chat, reactions, voice notes, calls and end-to-end encryption. Free and open-source."),
  description: L(fs.readFileSync("/root/watchparty-release/amo-description.txt", "utf8")),
  categories: ["social-communication", "photos-music-videos"],
  homepage: L("https://cp.praivox.com/watchparty/"),
  support_email: L("umer.jahangier@gmail.com"),
  support_url: L("https://github.com/umer-jahangier/watchparty/issues"),
}));

console.log("2/4 upload (listed)");
const form = new FormData();
form.append("upload", new Blob([fs.readFileSync(zip)]), "watchparty.zip");
form.append("channel", "listed");
let up = await api("/addons/upload/", { method: "POST", body: form });
for (let i = 0; i < 60 && !up.processed; i++) { await sleep(5000); up = await api(`/addons/upload/${up.uuid}/`); }
const msgs = up.validation?.messages || [];
console.log(`   valid=${up.valid} errors=${msgs.filter((m) => m.type === "error").length} warnings=${msgs.filter((m) => m.type === "warning").length}`);
msgs.filter((m) => m.type !== "notice").forEach((m) => console.log(`   - [${m.type}] ${m.message} (${m.file || ""}${m.line ? ":" + m.line : ""})`));
if (!up.valid) process.exit(1);

console.log("3/4 create listed version");
const ver = await api(`/addons/addon/${GUID}/versions/`, J("POST", {
  upload: up.uuid,
  license: "MIT",
  release_notes: L("End-to-end encrypted chat, voice notes and reactions; VPN-friendly mode; cleaner panel; copy confirmations."),
  approval_notes: fs.readFileSync("/root/watchparty-release/amo-reviewer-notes.txt", "utf8"),
}));
console.log(`   version ${ver.version} status: ${ver.file?.status}`);

console.log("4/4 screenshots");
const existing = (await api(`/addons/addon/${GUID}/`)).previews || [];
if (!existing.length) {
  for (const [i, shot] of [shot1, shot2].entries()) {
    const f = new FormData();
    f.append("image", new Blob([fs.readFileSync(shot)], { type: "image/png" }), `watchparty-${i + 1}.png`);
    f.append("position", String(i));
    await api(`/addons/addon/${GUID}/previews/`, { method: "POST", body: f });
  }
}
const addon = await api(`/addons/addon/${GUID}/`);
console.log(`done. listing: ${addon.url}  status: ${addon.status}`);
