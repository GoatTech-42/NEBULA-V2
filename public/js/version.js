// version.js — central build / version metadata for Nebula V2
//
// This file is the SINGLE SOURCE OF TRUTH for "what build is live".
// The Python deploy script (`deploy.py` at the repo root) edits this file
// automatically on every deploy: it bumps APP_VERSION, re-stamps
// BUILD_DATE with the current UTC time, fills in the short git commit
// hash as BUILD_COMMIT, bumps BUILD_NUMBER, and prepends a new entry to
// the CHANGELOG array.
//
// The constants below are also mirrored into `service-worker.js` so that
// old caches are automatically invalidated when a new build ships.
//
// ---------------------------------------------------------------------
//  Field reference
// ---------------------------------------------------------------------
//  APP_VERSION     Semantic version string — shown in UI, SW cache key.
//  APP_CODENAME    Human-friendly name for the release ("Spark", ...).
//  BUILD_DATE      ISO-8601 UTC timestamp of the deploy.
//  BUILD_CHANNEL   'production' | 'beta' | 'dev' | 'nightly'.
//  BUILD_COMMIT    Short git SHA (7 chars) of the deploy. 'local' if none.
//  BUILD_NUMBER    Monotonically increasing integer across deploys.
//  CHANGELOG       Newest-first array of entries the "What's New" modal
//                  renders. Each entry: { version, date, title, items[] }.
//
//  The markers "// @@deploy:..." below are read by deploy.py — do not
//  remove them. The script regex-replaces the line right after each
//  marker, so any formatting changes to this file need to keep those
//  markers intact.
// ---------------------------------------------------------------------

// @@deploy:APP_VERSION
export const APP_VERSION   = '2.4.2';
// @@deploy:APP_CODENAME
export const APP_CODENAME  = 'Polish';
// @@deploy:BUILD_DATE
export const BUILD_DATE    = '2026-04-20T00:45:54Z';
// @@deploy:BUILD_CHANNEL
export const BUILD_CHANNEL = 'production';
// @@deploy:BUILD_COMMIT
export const BUILD_COMMIT  = 'b630759';
// @@deploy:BUILD_NUMBER
export const BUILD_NUMBER  = 11;

// Convenience object — some callers prefer a single import.
export const BUILD_INFO = Object.freeze({
  version:   APP_VERSION,
  codename:  APP_CODENAME,
  date:      BUILD_DATE,
  channel:   BUILD_CHANNEL,
  commit:    BUILD_COMMIT,
  number:    BUILD_NUMBER,
});

// @@deploy:CHANGELOG_BEGIN
// Each entry powers one block in the "What's New" modal. Newest first.
// Keep bullets short & punchy. The deploy script prepends new entries
// right after the "CHANGELOG_BEGIN" marker above, so keep that line as-is.
export const CHANGELOG = [
  {
    version: '2.4.2',
    date: '2026-04-19',
    title: 'Minimal online counter polish',
    items: [
      'Restored the RTDB online counter on the home dashboard',
    ],
  },
  {
    version: '2.4.1',
    date: '2026-04-19',
    title: 'Polish everything for v2.4.1',
    items: [
      'Removed the extra inner chat input highlight box while typing',
      'Refined chat input focus styling for cleaner typing UX',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-04-19',
    title: 'Polish - Release 2.4.0',
    items: [
      'Polish',
    ],
  },
  {
    version: '2.4.0',
    date: '2026-04-20',
    title: 'Polish — declutter & bug-fix release',
    items: [
      'Fixed unclosable modals — every modal now has a dedicated [×] close button',
      'Escape key now reliably closes any open modal, command palette, or game vault',
      'Modal backdrop click and Escape now route through a single, unified close path',
      'Re-opening a modal while another is closing no longer leaves the old one stuck',
      'onClose callbacks now fire exactly once, no matter how the modal was dismissed',
      'Decluttered home dashboard — 6 stat tiles pared back to 3 (Online / Visits / Session)',
      'Compact deploy strip — channel, platform, commit & build # moved into the tooltip',
      'Removed redundant shortcut hints line (press ? anywhere for the cheatsheet)',
      'Replaced "Got it" button wiring with the unified `data-modal-close` attribute',
      'Retired the inline `modal-overlay.click()` pattern across all modules',
      'Global `window.closeModal()` helper so any inline HTML can close modals safely',
    ],
  },
  {
    version: '2.3.6',
    date: '2026-04-19',
    title: 'Launchpad — release 2.3.6',
    items: [
      'Removed GoatCoin stats from the profile page while keeping stats in the profile modal',
    ],
  },
  {
    version: '2.3.5',
    date: '2026-04-19',
    title: 'Launchpad — release 2.3.5',
    items: [
      'Switched new-build notification to modal popup and removed chat input focus highlight glow',
    ],
  },
  {
    version: '2.3.4',
    date: '2026-04-19',
    title: 'Launchpad — release 2.3.4',
    items: [
      'Removed ping card, ? shortcut trigger, and chat input box styling',
    ],
  },
  {
    version: '2.3.3',
    date: '2026-04-19',
    title: 'Launchpad — release 2.3.3',
    items: [
      "Removed What's New, platform/channel chips, and Install App button",
    ],
  },
  {
    version: '2.3.2',
    date: '2026-04-19',
    title: 'Launchpad — release 2.3.2',
    items: [
      'Fixed RTDB rules syntax for delete validation',
    ],
  },
  {
    version: '2.3.1',
    date: '2026-04-19',
    title: 'Nebula V2 - Release 2.3.1',
    items: [
      'Added service worker',
      'Hopefully fixed blackjack',
      'Updated rules for security',
      'Made changes to the github repo',
    ],
  },
  {
    version: '2.5.0',
    date: '2026-04-19',
    title: 'Launchpad — one-command deploys & auto-versioning',
    items: [
      'New `deploy.py` — interactive release tool with version picker (patch / minor / major / custom)',
      'Shows current build and last 5 releases before every deploy',
      'Auto-stamps BUILD_DATE (UTC), BUILD_COMMIT (short SHA) and BUILD_NUMBER on every release',
      'Service worker cache key now derives from APP_VERSION + BUILD_COMMIT — no more stale caches',
      'Multi-line CHANGELOG prompt; items become the "What\'s New" bullets automatically',
      'Channel selector: production / beta / dev / nightly',
      'Dry-run mode (`--dry-run`) previews every file edit without touching disk',
      'Non-interactive mode (`--yes --version 2.5.1 ...`) for CI pipelines',
      'Auto-commit, auto-tag (`v2.5.0`), auto-push, then `firebase deploy` in one flow',
      'New BUILD_COMMIT + BUILD_NUMBER fields exposed to the app for richer deploy strip',
    ],
  },
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
// @@deploy:CHANGELOG_END

// ---------------------------------------------------------------------
//  Time-formatting helpers (exported for app.js & the command palette).
// ---------------------------------------------------------------------

/** "5 minutes ago", "2 days ago", "1 year ago". Safe for bad input. */
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

/** "Apr 19, 2026 · 10:00 PM" — locale-aware, graceful fallback. */
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

/** Full build string — "v2.5.0 · Launchpad · production · a1b2c3d · #42". */
export function buildString() {
  const parts = [
    `v${APP_VERSION}`,
    APP_CODENAME,
    BUILD_CHANNEL,
  ];
  if (BUILD_COMMIT && BUILD_COMMIT !== 'local') parts.push(BUILD_COMMIT);
  if (BUILD_NUMBER)                              parts.push(`#${BUILD_NUMBER}`);
  return parts.join(' · ');
}
