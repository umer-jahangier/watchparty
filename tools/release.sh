#!/bin/sh
# Usage: release.sh <version> "<notes>" [--zip]   (--zip also replaces the WatchParty.zip download)
set -e
VER="$1"; NOTES="$2"; ZIP="$3"
W=/tmp/wp-work; SRC=$W/ext4; OUT=$W/out/$VER
rm -rf "$OUT" && mkdir -p "$OUT/files" "$OUT/zip/WatchParty"
python3 - "$SRC/manifest.json" "$VER" <<'PY'
import json,sys
p,v=sys.argv[1],sys.argv[2]; d=json.load(open(p)); d['version']=v
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
PY
cd "$SRC"
for f in manifest.json background.js content popup icons lib; do cp -R "$f" "$OUT/files/"; cp -R "$f" "$OUT/zip/WatchParty/"; done
FILES=$(cd "$OUT/files" && find . -type f ! -name '.DS_Store' | sed 's|^\./||' | sort)
python3 - "$VER" "$NOTES" "$OUT/update.json" $FILES <<'PY'
import json,sys
v,notes,out=sys.argv[1],sys.argv[2],sys.argv[3]
json.dump({"version":v,"notes":notes,"base":f"https://cp.praivox.com/watchparty/ext/{v}/","files":sys.argv[4:]},open(out,'w'),indent=1)
PY
(cd "$OUT/zip" && zip -qr -X ../WatchParty.zip WatchParty)
node $W/sign-update.mjs "$OUT/files" "$VER" "https://cp.praivox.com/watchparty/ext/$VER/" "$NOTES" "$OUT/update-signed.json"
# Firefox build: same code, Firefox manifest (event-page background, gecko id, no self-updater perms)
mkdir -p "$OUT/firefox" && cp -R "$OUT/files/." "$OUT/firefox/"
python3 - "$OUT/firefox/manifest.json" <<'PY'
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d['background']={'scripts':['background.js']}
d['permissions']=[x for x in d['permissions'] if x not in ('downloads','downloads.ui')]
d['browser_specific_settings']={'gecko':{'id':'watchparty@praivox.com','strict_min_version':'140.0','update_url':'https://cp.praivox.com/watchparty/firefox/updates.json','data_collection_permissions':{'required':['personalCommunications']}},'gecko_android':{'strict_min_version':'142.0'}}
json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
PY
rm -f "$OUT/firefox/popup/updater.js" "$OUT/firefox/popup/update-core.js"
sed -i '' '/update-core.js\|updater.js/d' "$OUT/firefox/popup/popup.html"
(cd "$OUT/firefox" && zip -qr -X "../WatchParty-firefox-$VER.zip" .)
# Web app with versioned asset URLs
mkdir -p "$OUT/web" && cp -R $W/web/. "$OUT/web/" && sed -i '' "s/{{VERSION}}/$VER/g" "$OUT/web/index.html"
D=/home/cp.praivox.com/public_html/watchparty
ssh cp.praivox.com "mkdir -p $D/ext/$VER"
rsync -a --delete "$OUT/files/" "cp.praivox.com:$D/ext/$VER/"
scp -q "$OUT/WatchParty.zip" "cp.praivox.com:$D/WatchParty-$VER.zip"
scp -q "$OUT/update.json" "cp.praivox.com:$D/update.json"
scp -q "$OUT/update-signed.json" "cp.praivox.com:$D/update-signed.json"
if [ "$ZIP" = "--zip" ]; then
  sed "s/{{VERSION}}/$VER/g" $W/index.template.html > "$OUT/index.html"
  scp -q "$OUT/index.html" "cp.praivox.com:$D/index.html"
  scp -q "$OUT/WatchParty.zip" "cp.praivox.com:$D/WatchParty.zip"
  scp -q "$OUT/WatchParty-firefox-$VER.zip" "cp.praivox.com:$D/WatchParty-firefox.zip"
  ssh cp.praivox.com "mkdir -p $D/web"
  rsync -a --delete "$OUT/web/" "cp.praivox.com:$D/web/"
  rsync -a --delete "$SRC/" cp.praivox.com:/home/watchparty-extension/
fi
if [ "$ZIP" = "--zip" ] && ssh cp.praivox.com 'test -s /root/.amo-credentials'; then
  echo "signing Firefox build with Mozilla (takes a few minutes)…"
  scp -q "$OUT/WatchParty-firefox-$VER.zip" cp.praivox.com:/root/watchparty-release/firefox-$VER.zip
  ssh cp.praivox.com "set -e; mkdir -p $D/firefox; cd /root/watchparty-release; node sign-firefox.mjs firefox-$VER.zip $D/firefox/WatchParty-$VER.xpi; cp $D/firefox/WatchParty-$VER.xpi $D/firefox/WatchParty.xpi; printf '%s' '{\"addons\":{\"watchparty@praivox.com\":{\"updates\":[{\"version\":\"$VER\",\"update_link\":\"https://cp.praivox.com/watchparty/firefox/WatchParty-$VER.xpi\"}]}}}' > $D/firefox/updates.json; chown -R cppra3348:nobody $D/firefox; chmod -R a+rX $D/firefox"
  echo "Firefox build signed"
fi
ssh cp.praivox.com "chown -R cppra3348:nobody $D/ext $D/update.json $D/update-signed.json $D/WatchParty*.zip $D/index.html $D/web $D/fonts 2>/dev/null; chmod -R a+rX $D/ext $D/web $D/fonts"
echo "released $VER ($(echo $FILES | wc -w | tr -d ' ') files) zip=$ZIP"
