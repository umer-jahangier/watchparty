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
    const ordered = files.filter((f) => f.path !== "manifest.json").concat(files.filter((f) => f.path === "manifest.json"));
    for (let i = 0; i < ordered.length; i += 1) {
      const path = ordered[i].path;
      const url = URL.createObjectURL(new Blob([ordered[i].buf], { type: mimeFor(path) }));
      try {
        const id = await chrome.downloads.download({ url, filename: `WatchParty/${path}`, conflictAction: "overwrite", saveAs: false });
        const done = await waitDownload(id);
        // Make sure Chrome saved it under exactly the right name; otherwise remove the stray copy and stop.
        const saved = String(done?.filename || "").replace(/\\/g, "/");
        if (!saved.endsWith(`/WatchParty/${path}`)) {
          await chrome.downloads.removeFile(id).catch?.(() => {});
          chrome.downloads.erase({ id }).catch?.(() => {});
          throw new Error(`Chrome saved ${path} under a different name, so the update stopped safely before installing it.`);
        }
        chrome.downloads.erase({ id }).catch?.(() => {});
      } finally {
        URL.revokeObjectURL(url);
      }
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
