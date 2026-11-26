// Chromium-only one-click updater (Firefox updates signed add-ons natively; this file and
// update-core.js are left out of the Firefox build).
// The extension lives in <downloads folder>/WatchParty. A release is verified first
// (signature, versions, permissions, every file's SHA-256) and only then written,
// from the verified bytes in memory, one file over the other, manifest.json last.

// Chrome renames a download to match its MIME type (an untyped Blob becomes ".txt"),
// so every file is handed over with its real type.
const MIME = { js: "text/javascript", json: "application/json", css: "text/css", html: "text/html", png: "image/png", svg: "image/svg+xml", txt: "text/plain" };
function mimeFor(path) {
  return MIME[path.split(".").pop().toLowerCase()] || "application/octet-stream";
}

function waitDownload(id) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error("A download timed out."))), 45000);
    const onChange = (delta) => {
      if (delta.id === id) check();
    };
    function finish(fn) {
      clearTimeout(timer);
      chrome.downloads.onChanged.removeListener(onChange);
      fn();
    }
    async function check() {
      const [d] = await chrome.downloads.search({ id });
      if (!d) return finish(() => reject(new Error("A download disappeared.")));
      if (d.state === "complete") return finish(() => resolve(d));
      if (d.state === "interrupted") return finish(() => reject(new Error(`Download failed (${d.error || "interrupted"}).`)));
      if (d.danger && d.danger !== "safe" && d.danger !== "accepted") {
        chrome.downloads.cancel(id).catch?.(() => {});
        finish(() => reject(new Error("Chrome flagged an update file, so the update was stopped.")));
      }
    }
    chrome.downloads.onChanged.addListener(onChange);
    check();
  });
}

// Where WatchParty may live inside the Downloads folder. Windows "Extract All" on WatchParty.zip
// creates WatchParty\WatchParty, so that is tried too.
const FOLDERS = ["WatchParty", "WatchParty/WatchParty"];
const PROMPT_MS = 2500; // a tiny file that takes longer than this was almost surely a "Save as" dialog
let promptWarned = false;

async function saveFile(relPath, buf, mime) {
  const url = URL.createObjectURL(new Blob([buf], { type: mime }));
  try {
    const id = await chrome.downloads.download({ url, filename: relPath, conflictAction: "overwrite", saveAs: false });
    const done = await waitDownload(id);
    return { id, saved: String(done?.filename || "") };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function forget(id, removeFromDisk) {
  if (removeFromDisk) chrome.downloads.removeFile(id).catch?.(() => {});
  chrome.downloads.erase({ id }).catch?.(() => {});
}

function folderOf(fullPath) {
  return fullPath.replace(/[\\/][^\\/]*$/, "");
}

class UpdateStop extends Error {
  constructor(message, action) {
    super(message);
    this.action = action;
  }
}

// Writes one small file, then reads it back through the extension itself. Only the folder
// Chrome actually runs WatchParty from serves it back, so this finds the right folder and
// reveals a "Save as" dialog before any real file is touched.
async function findInstallFolder() {
  const token = crypto.randomUUID();
  const body = new TextEncoder().encode(`WatchParty update check ${token}\n`);
  let firstSaved = "";
  for (let i = 0; i < FOLDERS.length; i += 1) {
    const started = Date.now();
    let probe;
    try {
      probe = await saveFile(`${FOLDERS[i]}/wp-update-check.txt`, body, "text/plain");
    } catch (err) {
      if (i === 0 && /USER_CANCELED|interrupted/i.test(String(err?.message))) throw promptStop();
      throw err;
    }
    if (i === 0 && !promptWarned && Date.now() - started > PROMPT_MS) {
      forget(probe.id, true);
      throw promptStop();
    }
    if (i === 0) firstSaved = folderOf(probe.saved);
    let served = "";
    try {
      served = await fetch(`${chrome.runtime.getURL("wp-update-check.txt")}?t=${Date.now()}`, { cache: "no-store" }).then((r) => (r.ok ? r.text() : ""));
    } catch {
      /* not this folder */
    }
    forget(probe.id, true);
    if (served.includes(token)) return FOLDERS[i];
  }
  throw new UpdateStop(
    `Chrome saves updates to "${firstSaved || "Downloads\\WatchParty"}", but WatchParty is running from a different folder, ` +
      "so it can't update itself. Fix it once: download WatchParty.zip again, extract it into your Downloads folder, " +
      "then in chrome://extensions remove WatchParty and use Load unpacked on the new WatchParty folder (the one with manifest.json inside).",
    { label: "Download WatchParty.zip", url: "https://cp.praivox.com/watchparty/" }
  );
}

function promptStop() {
  promptWarned = true;
  return new UpdateStop(
    "Your browser is set to ask where to save every download, so updating would open a Save dialog for each file. " +
      "Turn off \"Ask where to save each file before downloading\" in download settings, then click Try again. " +
      "(If no dialog appeared, just click Try again.)",
    { label: "Open download settings", url: "chrome://settings/downloads" }
  );
}

function showUpdate(rel) {
  $("update").classList.remove("hidden");
  $("update-title").textContent = `WatchParty ${rel.version} is ready`;
  $("update-notes").textContent = String(rel.notes || "A new version is available.").slice(0, 300);
}

async function applyUpdate() {
  const btn = $("update-now");
  const bar = $("update-bar");
  const help = $("update-help");
  const fill = (r) => (bar.querySelector("i").style.width = `${Math.round(r * 100)}%`);
  btn.disabled = true;
  help.classList.add("hidden");
  bar.classList.remove("hidden");
  btn.textContent = "Checking the update…";
  try {
    const rel = await wpVerifiedRelease(VERSION);
    if (!rel) throw new Error("You're already up to date.");
    const files = await wpFetchRelease(rel, fill);
    btn.textContent = "Installing…";
    try {
      chrome.downloads.setUiOptions?.({ enabled: false })?.catch?.(() => {});
    } catch {
      /* older Chrome */
    }
    const folder = await findInstallFolder();
    const ordered = files.filter((f) => f.path !== "manifest.json").concat(files.filter((f) => f.path === "manifest.json"));
    for (let i = 0; i < ordered.length; i += 1) {
      const path = ordered[i].path;
      const { id, saved } = await saveFile(`${folder}/${path}`, ordered[i].buf, mimeFor(path));
      // Make sure Chrome saved it under exactly the right name; otherwise remove the stray copy and stop.
      if (!saved.replace(/\\/g, "/").endsWith(`/${folder}/${path}`)) {
        forget(id, true);
        throw new Error(`Chrome saved ${path} under a different name, so the update stopped safely before installing it.`);
      }
      forget(id, false);
      fill(0.5 + ((i + 1) / ordered.length) * 0.5);
    }
    const disk = await fetch(`${chrome.runtime.getURL("manifest.json")}?t=${Date.now()}`, { cache: "no-store" }).then((r) => r.json());
    if (disk.version !== rel.version) {
      throw new Error(
        "The update was saved, but this copy of WatchParty is loaded from a different folder. " +
          "In chrome://extensions, remove WatchParty and use Load unpacked on the WatchParty folder inside your Downloads folder."
      );
    }
    await chrome.storage.local.set({ wpUpdate: null, wpJustUpdated: rel.version });
    btn.textContent = "Updated! Restarting…";
    setTimeout(() => chrome.runtime.reload(), 500);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Try again";
    help.textContent = err.message || String(err);
    if (err instanceof UpdateStop && err.action) {
      const link = document.createElement("button");
      link.type = "button";
      link.className = "update-fix";
      link.textContent = err.action.label;
      link.addEventListener("click", () => chrome.tabs.create({ url: err.action.url }));
      help.append(document.createElement("br"), link);
    }
    help.classList.remove("hidden");
  } finally {
    try {
      chrome.downloads.setUiOptions?.({ enabled: true })?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }
}

async function initUpdates() {
  const { wpJustUpdated } = await chrome.storage.local.get(["wpJustUpdated"]);
  if (wpJustUpdated && wpJustUpdated === VERSION) {
    $("updated").textContent = `Updated to ${VERSION}. Reload your video tabs to use it.`;
    $("updated").classList.remove("hidden");
    chrome.storage.local.remove("wpJustUpdated");
    chrome.action.setBadgeText({ text: "" });
  }
  try {
    const rel = await wpVerifiedRelease(VERSION);
    if (rel) showUpdate(rel);
  } catch {
    /* no update shown if it can't be verified */
  }
  $("update-now").onclick = (e) => {
    if (e.isTrusted) applyUpdate();
  };
}

initUpdates();
