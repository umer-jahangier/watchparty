// Uploads listing screenshots to AMO, waiting out rate limits.
import fs from "node:fs"; import crypto from "node:crypto";
const env = Object.fromEntries(fs.readFileSync("/root/.amo-credentials", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => { const n = Math.floor(Date.now() / 1000), h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iss: env.AMO_JWT_ISSUER, jti: crypto.randomUUID(), iat: n, exp: n + 240 }); return `${h}.${p}.${crypto.createHmac("sha256", env.AMO_JWT_SECRET).update(h + "." + p).digest("base64url")}`; };
const BASE = "https://addons.mozilla.org/api/v5/addons/addon/watchparty%40praivox.com/";
const get = async () => (await fetch(BASE, { headers: { Authorization: "JWT " + jwt() } })).json();
const a = await get();
console.log("existing previews:", (a.previews || []).length);
for (const [i, f] of ["store-1-chat.png", "store-2-love.png"].entries()) {
  if ((a.previews || []).length > i) continue;
  for (let t = 0; t < 8; t++) {
    const fd = new FormData();
    fd.append("image", new Blob([fs.readFileSync(f)], { type: "image/png" }), f);
    fd.append("position", String(i));
    const r = await fetch(BASE + "previews/", { method: "POST", headers: { Authorization: "JWT " + jwt() }, body: fd });
    if (r.ok) { console.log("uploaded", f); break; }
    const txt = await r.text();
    const wait = Number((txt.match(/(\d+) seconds/) || [])[1] || 30);
    console.log(`waiting ${wait}s (${r.status})`);
    await new Promise((x) => setTimeout(x, (wait + 2) * 1000));
  }
  await new Promise((x) => setTimeout(x, 5000));
}
const b = await get();
console.log("previews now:", (b.previews || []).length, "| status:", b.status, "| url:", b.url);
