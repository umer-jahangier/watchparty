# WatchParty Privacy Policy

_Last updated: 22 November 2026_

WatchParty is free, open-source software by Umer Jahangier. It has no ads, no analytics and no tracking, and it never sells or shares data.

## What WatchParty handles, and why

| Data | Why | Where it goes | Kept |
|---|---|---|---|
| Display name and avatar you choose | So friends see who is who | Your browser storage; sent to the party relay while you are in a party | Relay: only while the party is live |
| Chat messages, voice notes, reactions, "love" | The party features | Encrypted parties (full codes like `K7Q2MX-9F4TB-2W8QH`): end-to-end encrypted in your browser; the relay only forwards ciphertext it cannot read | Never stored; forwarded in memory only |
| Video page address, play/pause position and speed | To keep everyone in sync and let guests open the same video | Party relay (`cp.praivox.com`) | Only while the party is live |
| Voice/video calls (only if you start or join one) | Calling | Peer-to-peer WebRTC, encrypted end-to-end (DTLS-SRTP). If a direct connection is not possible, the encrypted media passes through the WatchParty TURN relay, which cannot decrypt it | Never recorded or stored |
| IP address | Required to connect; used for abuse limits (connections and new parties per address) | Relay memory; standard web server logs on `cp.praivox.com` | Rate-limit counters: minutes; server logs: rotated |

## What stays on your device

- Your name, avatar, the optional "queen" crown and your settings (browser storage).
- Party codes and keys for the current tab (extension-only session storage, cleared when the tab closes).

## Optional permissions

**VPN-friendly mode** is off by default. If you turn it on, WatchParty asks for permission to *read* your browser's proxy and WebRTC settings, only to tell whether a VPN or proxy extension is active. It never changes them and never sends them anywhere. Turning the mode off removes the permission.

## Microphone and camera

Used only when you record a voice note, turn on your mic, or turn on your camera, and only after your browser asks you.

## Children

WatchParty is not directed at children under 13.

## Contact

Questions or requests: open an issue at https://github.com/umer-jahangier/watchparty/issues or email umer.jahangier@gmail.com.
