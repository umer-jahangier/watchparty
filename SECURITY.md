# Security

Please report vulnerabilities privately by email (umer.jahangier@gmail.com) rather than in a public issue. I aim to reply within a few days.

## Design summary

- **End-to-end encryption:** full party codes carry a 10-character secret that never reaches the server. Keys are derived with PBKDF2-SHA256 (210,000 rounds, salted with the room code) and used with AES-256-GCM; the message kind is bound as additional data. The relay forwards ciphertext and refuses plaintext chat in encrypted parties.
- **Calls:** WebRTC (DTLS-SRTP). Calls are only answered from peers in your party. TURN over UDP/TCP 3478 and TLS 5349; behind a VPN, calls are relay-only.
- **Signed updates (direct-download build):** releases are signed with an offline ECDSA P-256 key; the extension verifies the signature, version, every file's SHA-256 and a permission allowlist before writing anything. Store builds are updated by their store and ship without the updater.
- **Extension hardening:** no `innerHTML` with dynamic data; buttons ignore synthetic clicks; party state lives in extension-only session storage; invite links ask before joining; redirects only go to public http(s) pages.
- **Relay:** runs unprivileged with systemd sandboxing; validates and rate-limits every message; per-IP connection and party limits.
