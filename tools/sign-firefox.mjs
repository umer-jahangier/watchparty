// Signs the WatchParty Firefox build as an UNLISTED add-on via the AMO API (v5).
// Usage: node sign-firefox.mjs <firefox.zip> <out.xpi>
// Credentials: /root/.amo-credentials with AMO_JWT_ISSUER=... and AMO_JWT_SECRET=...
import fs from "node:fs";
import crypto from "node:crypto";

const env = Object.fromEntries(
  fs.readFileSync("/root/.amo-credentials", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  })
);
const ISS = env.AMO_JWT_ISSUER;
const SECRET = env.AMO_JWT_SECRET;
if (!ISS || !SECRET) throw new Error("AMO_JWT_ISSUER / AMO_JWT_SECRET missing in /root/.amo-credentials");
const API = "https://addons.mozilla.org/api/v5";
const GUID = "watchparty@praivox.com";
const [, , zipPath, outPath] = process.argv;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
function jwt() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iss: ISS, jti: crypto.randomUUID(), iat: now, exp: now + 240 });
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
async function api(path, opts = {}) {
  const res = await fetch(path.startsWith("http") ? path : API + path, { ...opts, headers: { ...(opts.headers || {}), Authorization: `JWT ${jwt()}` } });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${res.status} ${path}: ${text.slice(0, 600)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (obj) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

console.log("uploading", zipPath);
const form = new FormData();
form.append("upload", new Blob([fs.readFileSync(zipPath)]), "watchparty.zip");
form.append("channel", "unlisted");
let up = await api("/addons/upload/", { method: "POST", body: form });
for (let i = 0; i < 60 && !up.processed; i += 1) {
  await sleep(5000);
  up = await api(`/addons/upload/${up.uuid}/`);
}
if (!up.valid) {
  const errors = (up.validation?.messages || []).filter((m) => m.type === "error").map((m) => `${m.message} (${m.file || ""})`);
  throw new Error(`Mozilla validation failed:\n- ${errors.join("\n- ") || JSON.stringify(up).slice(0, 600)}`);
}
const warns = (up.validation?.messages || []).filter((m) => m.type === "warning");
console.log(`validated; ${warns.length} warning(s)`);
warns.forEach((m) => console.log(`  - ${m.message} (${m.file || ""}${m.line ? ":" + m.line : ""})`));

let version;
try {
  version = await api(`/addons/addon/${encodeURIComponent(GUID)}/versions/`, json({ upload: up.uuid }));
} catch (err) {
  if (err.status !== 404) throw err;
  const created = await api(`/addons/addon/${encodeURIComponent(GUID)}/`, { ...json({ version: { upload: up.uuid } }), method: "PUT" });
  version = created.latest_unlisted_version || created.current_version;
}
console.log("waiting for Mozilla to sign version", version?.version);

for (let i = 0; i < 90; i += 1) {
  const v = await api(`/addons/addon/${encodeURIComponent(GUID)}/versions/${version.id}/`);
  const file = v.file || {};
  if (file.status === "public" && file.url) {
    const res = await fetch(file.url, { headers: { Authorization: `JWT ${jwt()}` } });
    if (!res.ok) throw new Error(`download failed ${res.status}`);
    fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
    console.log("signed", v.version, "->", outPath);
    process.exit(0);
  }
  if (file.status === "disabled") throw new Error("Mozilla rejected this version");
  await sleep(10000);
}
throw new Error("Timed out waiting for Mozilla to sign");
