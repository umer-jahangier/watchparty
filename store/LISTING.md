# Store listing (Firefox Add-ons, Microsoft Edge Add-ons, Opera Add-ons)

**Name:** WatchParty
**Category:** Social & Communication (Edge/Opera) · Social & Communication + Photos, Music & Videos (Firefox)
**License:** MIT
**Homepage:** https://cp.praivox.com/watchparty/
**Source code:** https://github.com/umer-jahangier/watchparty
**Support:** https://github.com/umer-jahangier/watchparty/issues · umer.jahangier@gmail.com
**Privacy policy:** https://cp.praivox.com/watchparty/privacy.html

## Short description (max 132 characters)

Watch videos together in sync from anywhere: chat, reactions, voice notes, calls and end-to-end encryption. Free and open-source.

## Full description

WatchParty lets you watch videos with friends and family from different homes, perfectly in sync.

Start a party on any page with a video, share the code or invite link, and everyone's play, pause, seek and speed stay together. When the host moves to the next video, everyone follows.

Right beside the video:
• Chat with names and times, big emojis and floating reactions
• Voice notes (up to 20 seconds)
• Voice and video calls
• "Send love": fill their screen with hearts 💖
• A crown 👑 for the queen of the party

Private by design:
• End-to-end encryption for chat, voice notes and reactions. Full party codes (like K7Q2MX-9F4TB-2W8QH) and invite links carry a key that never reaches the server.
• Calls are encrypted end to end (WebRTC).
• No ads, no analytics, no tracking. Nothing is stored on the server.

Made for real life:
• Reconnects by itself if your internet drops; reloading the page keeps you in the party
• VPN-friendly mode keeps parties connected behind a VPN
• Fullscreen with chat, or a floating, resizable chat window
• Friends without the extension can join from any browser or phone with WatchParty Web

Works on YouTube and most sites that play video in the browser. Some streaming sites block outside control of their player.

Free and open-source (MIT). Built with love by Umer Jahangier.

## Permission justifications (for reviewers)

- **Access to all websites (content scripts on http/https):** the party panel and playback sync run on whatever video page the user opens. Nothing is read from pages except the video element's play state and the page address shared with the party.
- **storage:** your name, avatar and settings.
- **tabs, activeTab:** the popup starts or joins a party in the current tab and opens the host's video page when joining.
- **https://cp.praivox.com/\*:** the party relay (WebSocket), party lookups, and the TURN relay for calls.
- **Microphone/camera (browser prompt only):** voice notes and calls, only when the user presses those buttons.
- **No remote code:** all code ships in the package. `lib/peerjs.min.js` is the unmodified official PeerJS 1.5.4 build (SHA-256 ad5d8870d1e389914f9cba8d35be313c4327c69ee0a221e482e9bf7621136fe5, https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js).

## Test instructions (for reviewers)

1. Open any YouTube video, click the WatchParty button → Start a party.
2. Copy the invite link from the popup and open it in a second browser profile (or https://cp.praivox.com/watchparty/web/ on a phone).
3. Play/pause in one window; the other follows. Chat, reactions and "Send love" appear on both.

## Screenshots

`store-1-chat.png` and `store-2-love.png` (1280×800).
