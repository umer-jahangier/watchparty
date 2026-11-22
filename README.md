# WatchParty 💜

Watch videos together, in sync, from different homes. Chat, react, send voice notes, call each other, and send love, right beside the video.

Free and open-source (MIT) · Built with love by [Umer Jahangier](https://umer-jahangier.github.io)

**Get it:** https://cp.praivox.com/watchparty/ (browser extension, Firefox add-on, or WatchParty Web for phones and any browser)

## Features

- **Synced playback:** play, pause, seek and speed stay in sync for everyone; guests follow the host to the next video.
- **Works on most sites** with an HTML5 video player (extension), and on **any device** with YouTube and video links (WatchParty Web). Extension and web users share the same parties.
- **Chat, emoji reactions, voice notes, "Send love"** heart showers, and the 👑 queen crown.
- **Voice and video calls** (WebRTC).
- **End-to-end encryption:** full party codes like `K7Q2MX-9F4TB-2W8QH` (or invite links) carry a key the server never sees.
- **Survives hiccups:** automatic reconnect, resume after reload, VPN-friendly mode.
- **Fullscreen with chat,** floating resizable chat, draggable collapsed button.

## Repository layout

| Path | What |
|---|---|
| `extension/` | MV3 extension (Chrome, Edge, Brave, Opera, Arc; Firefox build is generated from it) |
| `web/` | WatchParty Web (static, no build step) |
| `server/` | Node.js relay: WebSocket rooms, party API, join page, TURN credentials |
| `site/` | Download page template and privacy policy |
| `tools/` | Release, signing and packaging scripts |

## Run it yourself

```bash
cd server && npm install && node server.js   # listens on 127.0.0.1:9010
```

Put it behind a TLS reverse proxy (`/wp-ws/` WebSocket, `/wp-api/` HTTP), run a [PeerJS server](https://github.com/peers/peerjs-server) at `/peerjs` and optionally [coturn](https://github.com/coturn/coturn) for TURN. Then change `cp.praivox.com` in `extension/content/content.js`, `extension/popup/*`, and `web/app.js` to your domain.

Load the extension: `chrome://extensions` → Developer mode → **Load unpacked** → `extension/`.

## Security and privacy

See [SECURITY.md](SECURITY.md) and [PRIVACY.md](PRIVACY.md). Please report vulnerabilities privately to umer.jahangier@gmail.com.

## Third-party code

- [PeerJS](https://github.com/peers/peerjs) 1.5.4 (MIT), bundled unmodified as `extension/lib/peerjs.min.js` (SHA-256 `ad5d8870d1e389914f9cba8d35be313c4327c69ee0a221e482e9bf7621136fe5`).
- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage) font (SIL Open Font License 1.1), used on the website.

## License

[MIT](LICENSE) © 2026 Umer Jahangier
