(() => {
  const face = (bg, inner) =>
    `<svg viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg"><circle cx="18" cy="18" r="18" fill="${bg}"/>${inner}</svg>`;
  const eyes = `<circle cx="13" cy="16" r="1.8" fill="#1c140c"/><circle cx="23" cy="16" r="1.8" fill="#1c140c"/>`;
  const smile = `<path d="M13 22c1.6 2 8.4 2 10 0" stroke="#1c140c" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;

  const WP_ICONS = {
    fox: face("#f97316", `<path d="M7 12 13 6l5 8 5-8 6 6v12H7z" fill="#fdba74"/>${eyes}<path d="M16 22h4l-2 2z" fill="#1c140c"/>`),
    cat: face("#64748b", `<path d="M9 8 13 14h10l4-6-3 14H12z" fill="#e2e8f0"/>${eyes}<path d="M16 21h4" stroke="#1c140c" stroke-width="1.6" stroke-linecap="round"/>`),
    panda: face("#f8fafc", `<circle cx="11" cy="14" r="5" fill="#111827"/><circle cx="25" cy="14" r="5" fill="#111827"/><circle cx="12" cy="15" r="1.5" fill="#fff"/><circle cx="24" cy="15" r="1.5" fill="#fff"/>${smile}`),
    frog: face("#22c55e", `<circle cx="11" cy="14" r="5" fill="#bbf7d0"/><circle cx="25" cy="14" r="5" fill="#bbf7d0"/><circle cx="11" cy="14" r="1.7" fill="#14532d"/><circle cx="25" cy="14" r="1.7" fill="#14532d"/><path d="M15 23h6" stroke="#14532d" stroke-width="1.6" stroke-linecap="round"/>`),
    bear: face("#b45309", `<circle cx="9" cy="10" r="4" fill="#92400e"/><circle cx="27" cy="10" r="4" fill="#92400e"/>${eyes}<ellipse cx="18" cy="21" rx="3" ry="2" fill="#fde68a"/>`),
    bunny: face("#fb7185", `<ellipse cx="11" cy="8" rx="3" ry="6" fill="#fecdd3"/><ellipse cx="25" cy="8" rx="3" ry="6" fill="#fecdd3"/>${eyes}<path d="M16 22c1 1.4 3 1.4 4 0" stroke="#9f1239" stroke-width="1.5" fill="none" stroke-linecap="round"/>`),
    owl: face("#7c3aed", `<circle cx="12" cy="16" r="5" fill="#ede9fe"/><circle cx="24" cy="16" r="5" fill="#ede9fe"/><circle cx="12" cy="16" r="2" fill="#4c1d95"/><circle cx="24" cy="16" r="2" fill="#4c1d95"/><path d="M17 21h2l-1 2z" fill="#f59e0b"/>`),
    bot: face("#0ea5e9", `<rect x="8" y="10" width="20" height="16" rx="4" fill="#e0f2fe"/><rect x="12" y="15" width="4" height="3" rx="1" fill="#0369a1"/><rect x="20" y="15" width="4" height="3" rx="1" fill="#0369a1"/><rect x="16" y="6" width="4" height="4" rx="1" fill="#e0f2fe"/>`),
    alien: face("#84cc16", `<ellipse cx="18" cy="19" rx="10" ry="11" fill="#ecfccb"/><ellipse cx="13" cy="18" rx="2.4" ry="3.2" fill="#1a2e05"/><ellipse cx="23" cy="18" rx="2.4" ry="3.2" fill="#1a2e05"/><path d="M14 25h8" stroke="#1a2e05" stroke-width="1.4" stroke-linecap="round"/>`),
    ghost: face("#e9d5ff", `<path d="M8 18c0-7 4-12 10-12s10 5 10 12v10l-3-2-3 2-4-2-3 2-4-2-3 2z" fill="#faf5ff"/>${eyes}<circle cx="18" cy="22" r="1.2" fill="#6b21a8"/>`),
    star: face("#facc15", `<path d="M18 6 21 14h8l-6.5 5 2.5 8L18 22l-7 5 2.5-8L7 14h8z" fill="#fff7cc"/>`),
    moon: face("#312e81", `<circle cx="20" cy="16" r="9" fill="#fde68a"/><circle cx="16" cy="14" r="8" fill="#312e81"/>`),
    pop: face("#f59e0b", `<path d="M10 16h16v10a4 4 0 0 1-4 4H14a4 4 0 0 1-4-4z" fill="#ef4444"/><circle cx="12" cy="12" r="3" fill="#fff"/><circle cx="18" cy="9" r="3.2" fill="#fff"/><circle cx="24" cy="13" r="2.6" fill="#fff"/>`),
    crown: face("#7c2d12", `<path d="M8 24h20l-2-12-6 6-4-8-4 8-6-6z" fill="#fbbf24"/><circle cx="8" cy="11" r="1.6" fill="#fde68a"/><circle cx="18" cy="8" r="1.6" fill="#fde68a"/><circle cx="28" cy="11" r="1.6" fill="#fde68a"/>`),
    dino: face("#14b8a6", `<path d="M8 22c2-8 6-12 12-12 4 0 8 3 8 8v6H8z" fill="#99f6e4"/><circle cx="22" cy="16" r="1.6" fill="#134e4a"/><path d="M24 19h5" stroke="#134e4a" stroke-width="1.4" stroke-linecap="round"/>`),
    comet: face("#1e1b4b", `<circle cx="22" cy="18" r="6" fill="#67e8f9"/><path d="M8 14c6 1 8 3 8 4s-2 3-8 4c4-2 6-3 6-4s-2-2-6-4z" fill="#a5b4fc"/>`),
  };

  const api = {
    ids: Object.keys(WP_ICONS),
    svg: (id) => WP_ICONS[id] || WP_ICONS.fox,
    ok: (id) => Object.prototype.hasOwnProperty.call(WP_ICONS, id),
  };
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  root.WP_ICONS = api;
})();
