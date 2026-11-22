#!/bin/sh
# Builds store packages from an already-built release (run after release.sh <ver>).
#   Edge Add-ons + Opera Add-ons: Chromium build without the self-updater (the store updates it)
#   Firefox Add-ons (AMO, listed): Firefox build without update_url
set -e
VER="$1"; W=/tmp/wp-work; OUT=$W/out/$VER
[ -d "$OUT/files" ] || { echo "build $VER with release.sh first"; exit 1; }
strip_updater() {
  rm -f "$1/popup/updater.js" "$1/popup/update-core.js"
  sed -i '' '/update-core.js\|updater.js/d' "$1/popup/popup.html"
}
rm -rf "$OUT/store-chromium" "$OUT/store-firefox"
mkdir -p "$OUT/store-chromium" && cp -R "$OUT/files/." "$OUT/store-chromium/"
strip_updater "$OUT/store-chromium"
python3 - "$OUT/store-chromium/manifest.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['permissions']=[x for x in d['permissions'] if x not in ('downloads','downloads.ui','alarms')]
d['homepage_url']='https://github.com/umer-jahangier/watchparty'
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
PY
(cd "$OUT/store-chromium" && rm -f "../WatchParty-$VER-edge-opera.zip" && zip -qr -X "../WatchParty-$VER-edge-opera.zip" .)
mkdir -p "$OUT/store-firefox" && cp -R "$OUT/firefox/." "$OUT/store-firefox/"
python3 - "$OUT/store-firefox/manifest.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['browser_specific_settings']['gecko'].pop('update_url', None)
d['permissions']=[x for x in d['permissions'] if x != 'alarms']
d['homepage_url']='https://github.com/umer-jahangier/watchparty'
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
PY
(cd "$OUT/store-firefox" && rm -f "../WatchParty-$VER-firefox-amo.zip" && zip -qr -X "../WatchParty-$VER-firefox-amo.zip" .)
ls -la "$OUT"/WatchParty-$VER-*.zip
