// Builds update-signed.json: a payload listing every file with its SHA-256, signed with
// ECDSA P-256 (IEEE P1363 encoding, as WebCrypto verifies). The private key never leaves the Mac.
// Usage: node sign-update.mjs <filesDir> <version> <base> <notes> <out.json>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";

const [, , dir, version, base, notes, out] = process.argv;
const key = crypto.createPrivateKey(fs.readFileSync(path.join(os.homedir(), ".watchparty/update-signing-key.pem")));
const files = [];
(function walk(rel) {
  for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
    if (name === ".DS_Store") continue;
    const r = rel ? `${rel}/${name}` : name;
    const st = fs.statSync(path.join(dir, r));
    if (st.isDirectory()) walk(r);
    else files.push({ path: r, sha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, r))).digest("hex"), size: st.size });
  }
})("");
const payload = JSON.stringify({ app: "watchparty", version, base, notes, files, issued: new Date().toISOString() });
const sig = crypto.sign("sha256", Buffer.from(payload), { key, dsaEncoding: "ieee-p1363" }).toString("base64");
fs.writeFileSync(out, JSON.stringify({ payload, sig }));
console.log(`signed ${version}: ${files.length} files`);
