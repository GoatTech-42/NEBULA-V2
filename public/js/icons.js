// ═══════════════════════════════════════════════════
//  icons.js — SVG icon library for command palette & UI
// ═══════════════════════════════════════════════════

/**
 * Returns an inline SVG string for a given icon key.
 * All icons are 20x20 viewBox with consistent stroke styling.
 */

const CMD_ICONS = {
  home: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 12L12 4l8 8"/>
    <path d="M6 10.5V19a1 1 0 001 1h3.5v-5a1.5 1.5 0 013 0v5H17a1 1 0 001-1v-8.5"/>
  </svg>`,

  chat: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6a2 2 0 012-2h12a2 2 0 012 2v9a2 2 0 01-2 2H8.5L4 21V6z"/>
    <line x1="9" y1="9" x2="15" y2="9" opacity=".5"/>
    <line x1="9" y1="12" x2="13" y2="12" opacity=".5"/>
  </svg>`,

  dms: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="2" y="4" width="20" height="14" rx="2"/>
    <path d="M2 7l10 6 10-6"/>
  </svg>`,

  games: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M6 11h4M8 9v4"/>
    <circle cx="15" cy="10" r=".75" fill="currentColor" stroke="none"/>
    <circle cx="17.5" cy="12.5" r=".75" fill="currentColor" stroke="none"/>
    <rect x="2" y="6" width="20" height="12" rx="3"/>
  </svg>`,

  goatcoin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <path d="M12 7v2"/>
    <path d="M9.5 10.5C9.5 9.67 10.62 9 12 9s2.5.67 2.5 1.5S13.38 12 12 12c-1.38 0-2.5.67-2.5 1.5S10.62 15 12 15s2.5-.67 2.5-1.5"/>
    <path d="M12 15v2"/>
  </svg>`,

  shop: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 7h16l-1.5 9a2 2 0 01-2 1.5H7.5a2 2 0 01-2-1.5L4 7z"/>
    <path d="M8 7V5a4 4 0 018 0v2"/>
    <line x1="4" y1="7" x2="20" y2="7"/>
  </svg>`,

  profile: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="8" r="4"/>
    <path d="M5 20a7 7 0 0114 0"/>
  </svg>`,

  settings: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
  </svg>`,

  admin: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2L4 5.5v5c0 5.55 3.42 10.74 8 12 4.58-1.26 8-6.45 8-12v-5L12 2z"/>
    <polyline points="9 12 11 14 15 10" opacity=".7"/>
  </svg>`,

  signout: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>`,
};

export { CMD_ICONS };
