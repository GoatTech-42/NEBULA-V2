// version.js — central build / version metadata for Nebula V2
//
// This file is the single source of truth for "what build is live".
// Bump APP_VERSION on every meaningful deploy and the "What's New" modal
// on the home screen will automatically show once to each user after the
// new build goes live.
//
// BUILD_DATE is the ISO timestamp of the last time this file was edited.
// Keep them in sync — the home screen shows a relative "Last deployed X
// ago" string computed from BUILD_DATE.
//
// Because we're on the Firebase Spark plan there's no Cloud Functions
// hook to auto-stamp this on deploy, so we just hand-bump it. That's fine
// for a small team and keeps everything purely on Firebase Hosting.

export const APP_VERSION = '2.4.0';
export const APP_CODENAME = 'Spark';
export const BUILD_DATE   = '2026-04-19T21:30:00Z';
export const BUILD_CHANNEL = 'production';

// Each entry powers one line in the "What's New" modal.
// Newest first. Keep it short & punchy.
export const CHANGELOG = [
  {
    version: '2.4.0',
    date: '2026-04-19',
    title: 'Spark — dashboard, PWA, offline support',
    items: [
      'New Home dashboard: live deploy info, online count, network ping, platform badge',
      'Installable PWA — add Nebula to your home screen or desktop',
      'Offline support via service worker; the app shell loads even with no internet',
      'Live connection indicator + real-time Firebase connection status',
      'Upgraded toast system — icons, action buttons, stackable queue',
      '"What\'s New" modal appears once after every version bump',
      'Command palette: new /version, /deploy, /ping, /theme random shortcuts',
      'System colour-scheme auto-detect on first run (honours OS dark/light)',
      'Home stats add Network latency + WebSocket status + Platform detection',
      'Keyboard: press ? anywhere to open the shortcut cheatsheet',
      'Accessibility: skip-to-content link, improved focus rings, ARIA polish',
    ],
  },
  {
    version: '2.3.0',
    date: '2026-03-15',
    title: 'Settings overhaul & admin cleanup redesign',
    items: [
      'Settings split into 8 tabs (Themes, Alerts, Display, Sound, Chat, Keybinds, Advanced, Credits)',
      'Custom accent colour override (12 swatches) + bubble style selector',
      'Admin DB Cleanup: two-column category grid, live DB stats tiles, activity log',
      'Command palette icons moved to a dedicated icons.js module',
      'Role-aware keybind numbering (1-8 users, 1-9 admins)',
    ],
  },
  {
    version: '2.2.0',
    date: '2025-03-01',
    title: 'Realtime presence & game vault',
    items: [
      'RTDB presence & typing system (major Firestore cost savings)',
      'Game vault with 100+ titles, lazy-loaded thumbnails, favourites',
      'Blackjack PvP with tiebreaker rounds',
      'Nebula Historians rewrite — 9 pages, search, Konami portal',
    ],
  },
];

// Tiny utility — "5 minutes ago" / "2 days ago" style formatting.
// Exported so both the home dashboard and the command palette can use it.
export function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';
  const diff = Date.now() - then;
  if (diff < 0) return 'in the future';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  const y = Math.floor(mo / 12);
  return `${y} year${y === 1 ? '' : 's'} ago`;
}

// Absolute date formatter — "Apr 19, 2026 · 9:30 PM"
export function formatDeployDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    });
  } catch {
    return iso;
  }
}
