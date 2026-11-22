// Signed-update verification shared by the background worker and the popup.
// A release is trusted only if its manifest is signed by the WatchParty release key
// (the private half never leaves the developer's computer) and every file matches its SHA-256.
const WP_UPDATE = {
  url: "https://cp.praivox.com/watchparty/update-signed.json",
  base: "https://cp.praivox.com/watchparty/ext/",
  pub: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEvR4JZcSyj5oDPJhP+87EfSX9N4Ra97gPjXP4CDALJCGvhgw1c3oMybhUfWIHyV3Z/LQiqlyr/3ZiO6yJBv1MWQ==",
  // A new version may not quietly gain powers: anything outside these lists is refused.
  allowedPermissions: ["storage", "activeTab", "tabs", "downloads", "downloads.ui", "alarms"],
  allowedHosts: ["https://cp.praivox.com/*"],
  allowedMatches: ["https://*/*", "http://*/*"],
  allowedOptional: ["proxy", "privacy"],
};

function wpBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function wpIsNewer(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function wpSha256(buf) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Returns the verified release description, or null when there is nothing newer.
async function wpVerifiedRelease(currentVersion) {
  const res = await fetch(`${WP_UPDATE.url}?t=${Date.now()}`, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error("Update server unavailable.");
  const doc = await res.json();
  if (typeof doc?.payload !== "string" || typeof doc?.sig !== "string") throw new Error("Malformed update.");
  const key = await crypto.subtle.importKey("spki", wpBytes(WP_UPDATE.pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, wpBytes(doc.sig), new TextEncoder().encode(doc.payload));
  if (!ok) throw new Error("This update isn't signed by WatchParty. It was not installed.");
  const rel = JSON.parse(doc.payload);
  if (rel.app !== "watchparty" || !/^\d+\.\d+\.\d+$/.test(rel.version || "")) throw new Error("Malformed update.");
  if (!wpIsNewer(rel.version, currentVersion)) return null;
  if (rel.base !== `${WP_UPDATE.base}${rel.version}/`) throw new Error("Update points somewhere unexpected.");
  if (!Array.isArray(rel.files) || !rel.files.length || rel.files.length > 200) throw new Error("Malformed update.");
  for (const f of rel.files) {
    if (typeof f?.path !== "string" || !/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+$/.test(f.path) || f.path.includes("..")) throw new Error("Bad file in update.");
    if (!/^[0-9a-f]{64}$/.test(f.sha256 || "") || !(f.size >= 0 && f.size < 4e6)) throw new Error("Bad file in update.");
  }
  if (!rel.files.some((f) => f.path === "manifest.json")) throw new Error("Malformed update.");
  return rel;
}

// Downloads every file of a verified release into memory and checks it byte for byte.
async function wpFetchRelease(rel, onProgress) {
  const out = [];
  for (let i = 0; i < rel.files.length; i += 1) {
    const f = rel.files[i];
    const res = await fetch(`${rel.base}${f.path}?v=${encodeURIComponent(rel.version)}`, { cache: "no-store", credentials: "omit" });
    if (!res.ok) throw new Error(`Couldn't download ${f.path}.`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength !== f.size || (await wpSha256(buf)) !== f.sha256) throw new Error(`${f.path} doesn't match the signed release. Update stopped.`);
    out.push({ path: f.path, buf });
    onProgress?.((i + 1) / rel.files.length / 2);
  }
  const mf = JSON.parse(new TextDecoder().decode(out.find((x) => x.path === "manifest.json").buf));
  const within = (list, allowed) => (list || []).every((x) => allowed.includes(x));
  const matches = (mf.content_scripts || []).flatMap((c) => c.matches || []);
  if (!within(mf.permissions, WP_UPDATE.allowedPermissions) || !within(mf.host_permissions, WP_UPDATE.allowedHosts) || !within(matches, WP_UPDATE.allowedMatches) || !within(mf.optional_permissions, WP_UPDATE.allowedOptional) || mf.version !== rel.version) {
    throw new Error("This update asks for new permissions, so it wasn't installed automatically.");
  }
  return out;
}
