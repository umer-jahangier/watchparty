import fs from "node:fs"; import crypto from "node:crypto";
const env = Object.fromEntries(fs.readFileSync("/root/.amo-credentials", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = () => { const n = Math.floor(Date.now() / 1000), h = b64({ alg: "HS256", typ: "JWT" }), p = b64({ iss: env.AMO_JWT_ISSUER, jti: crypto.randomUUID(), iat: n, exp: n + 240 }); return `${h}.${p}.${crypto.createHmac("sha256", env.AMO_JWT_SECRET).update(h + "." + p).digest("base64url")}`; };
const BASE = "https://addons.mozilla.org/api/v5/addons/addon/watchparty%40praivox.com/";
for (const slug of ["watchparty", "watchparty-together", "watchparty-sync"]) {
  const r = await fetch(BASE, { method: "PATCH", headers: { Authorization: "JWT " + jwt(), "Content-Type": "application/json" }, body: JSON.stringify({ slug }) });
  const j = await r.json();
  if (r.ok) { console.log("slug set:", j.url); process.exit(0); }
  console.log(slug, "->", JSON.stringify(j).slice(0, 160));
}
