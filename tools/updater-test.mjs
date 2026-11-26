// Real-Chrome test of the self-updater. Usage: node updater-test.mjs <case> where case is
// normal | nested | elsewhere | prompt. Uses a throwaway profile and downloads folder.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
const CASE = process.argv[2];
const SRC = process.env.HOME + "/WatchParty-dev/ext4";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = `/tmp/wpup-${CASE}`;
execSync(`rm -rf ${base} && mkdir -p ${base}/dl ${base}/profile/Default ${base}/other`);
const extDir = CASE === "nested" ? `${base}/dl/WatchParty/WatchParty` : CASE === "elsewhere" ? `${base}/other/WatchParty` : `${base}/dl/WatchParty`;
execSync(`mkdir -p "${extDir}" && cp -R ${SRC}/. "${extDir}/"`);
const m = JSON.parse(fs.readFileSync(`${extDir}/manifest.json`)); m.version = "4.6.4"; fs.writeFileSync(`${extDir}/manifest.json`, JSON.stringify(m, null, 2));
fs.writeFileSync(`${base}/profile/Default/Preferences`, JSON.stringify({ download: { default_directory: `${base}/dl`, prompt_for_download: CASE === "prompt", directory_upgrade: true } }));
const proc = spawn(CHROME, ["--headless=new", "--remote-debugging-pipe", "--enable-unsafe-extension-debugging", `--user-data-dir=${base}/profile`, "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = proc.stdio[3], inn = proc.stdio[4];
let id = 0, buf = ""; const pending = new Map();
inn.on("data", (d) => { buf += d.toString(); let k; while ((k = buf.indexOf("\0")) >= 0) { const msg = JSON.parse(buf.slice(0, k)); buf = buf.slice(k + 1); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } } });
const raw = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); out.write(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0"); });
await sleep(1500);
const loaded = await raw("Extensions.loadUnpacked", { path: extDir });
const extId = loaded.result?.id;
if (!extId) { console.log("load failed", JSON.stringify(loaded).slice(0, 200)); proc.kill(); process.exit(1); }
const { result: { targetId } } = await raw("Target.createTarget", { url: "about:blank" });
const { result: { sessionId } } = await raw("Target.attachToTarget", { targetId, flatten: true });
const cdp = (method, params = {}) => raw(method, params, sessionId);
const ev = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cdp("Page.navigate", { url: `chrome-extension://${extId}/popup/popup.html` });
let ready = false;
for (let i = 0; i < 40 && !ready; i++) { await sleep(300); ready = await ev(`!document.getElementById("update").classList.contains("hidden")`); }
if (!ready) { console.log(CASE, "update card never showed", await ev(`(async()=>{try{const r=await wpVerifiedRelease(VERSION);return "VERSION="+VERSION+" rel="+JSON.stringify(r)?.slice(0,120)}catch(e){return location.href+" VERSION="+(typeof VERSION!=="undefined"?VERSION:"?")+" err "+e.message}})()`)); proc.kill(); process.exit(1); }
const box = await ev(`(() => { const r = document.getElementById("update-now").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
for (const type of ["mousePressed", "mouseReleased"]) await cdp("Input.dispatchMouseEvent", { type, x: box[0], y: box[1], button: "left", clickCount: 1 });
let state = "";
for (let i = 0; i < 120; i++) {
  await sleep(500);
  state = await ev(`document.getElementById("update-now").textContent + " | " + (document.getElementById("update-help").classList.contains("hidden") ? "" : document.getElementById("update-help").innerText)`);
  if (/Updated!|Try again/.test(state || "")) break;
  if (state === undefined) { state = "popup reloaded (extension restarted)"; break; }
}
await sleep(800);
const onDisk = JSON.parse(fs.readFileSync(`${extDir}/manifest.json`)).version;
const stray = execSync(`find ${base}/dl -name wp-update-check.txt | wc -l`).toString().trim();
console.log(`${CASE}: ${state.replace(/\s+/g, " ").slice(0, 260)}\n   manifest on disk: ${onDisk}, leftover probes: ${stray}`);
proc.kill(); process.exit(0);
