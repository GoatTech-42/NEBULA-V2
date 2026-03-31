# NEBULA V2

> A private, invite-only social platform with real-time chat, gaming, and its own in-app economy.

---

## Overview

Nebula V2 is a zero-framework web app built entirely with vanilla HTML/CSS/JS and Firebase. It features multi-channel chat, direct messages, a game vault with 100+ titles, a full GoatCoin currency/gambling system, rich user profiles with badges, 29 color themes, and a comprehensive admin panel. The entry point is disguised as a legitimate academic history website with a hidden Konami Code portal.

---

## Quick Start

```bash
# Install Firebase CLI (if you don't have it)
npm install -g firebase-tools

# Login & deploy
firebase login
firebase deploy --only hosting
```

**Firebase project**: `nebulahistorians`
**RTDB URL**: `https://nebulahistorians-default-rtdb.firebaseio.com`

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | Vanilla JS (ES Modules), no framework |
| Backend | Firebase Firestore + Realtime Database |
| Auth | Firebase Auth (email/password) |
| Security | Firebase App Check (reCAPTCHA v3) |
| Hosting | Firebase Hosting |

### Why RTDB for Presence & Typing?

Firestore bills per document read/write. With even 10 active users, presence heartbeats and typing indicators burned through the free tier fast. RTDB uses a persistent WebSocket connection, so one listener covers all users for a fraction of the cost.

---

## File Structure

```
public/
├── index.html                # Nebula Historians — disguised entry point
├── main.html                 # Main app shell
├── construction.html         # Maintenance page
├── css/
│   ├── layout.css            # Core layout & component styles
│   └── themes/               # 29 color themes
│       ├── og.css            # Default (deep blue)
│       ├── dark.css          # Pure black, purple accent
│       ├── light.css         # Clean white, blue accent
│       ├── aurora.css        # Northern lights, emerald
│       ├── synthwave.css     # Retro neon grid
│       ├── crimson.css       # Deep red dark
│       ├── midnight.css      # Warm amber dark
│       ├── slate.css         # Minimal indigo mono
│       ├── forest.css        # Deep green night
│       ├── ocean.css         # Deep sea cyan
│       ├── rose.css          # Pink & magenta dark
│       ├── solar.css         # Blazing gold dark
│       ├── void.css          # Pure black minimal
│       ├── neon.css          # Electric green hacker
│       ├── blush.css         # Warm pink glow
│       ├── ice.css           # Cool indigo frosted
│       ├── candy.css         # Sweet pastels
│       ├── vapor.css         # Retrowave purple
│       ├── copper.css        # Burnished metal warm
│       ├── lavender.css      # Soft purple dreamy
│       ├── arctic.css        # Frozen blue crystals
│       ├── ember.css         # Smoldering red
│       ├── moss.css          # Deep earth emerald
│       ├── dusk.css          # Twilight sunset haze
│       ├── pearl.css         # Light ivory elegance
│       ├── cyberpunk.css     # Neon matrix digital
│       ├── sakura.css        # Cherry blossom spring
│       ├── rust.css          # Industrial orange forged
│       └── glacier.css       # Icy teal frozen waters
└── js/
    ├── firebase.js           # Firebase init, App Check, config & re-exports
    ├── app.js                # Core app: auth, chat, DMs, admin, nav, settings
    ├── icons.js              # SVG icon library for command palette & UI
    ├── goatcoin.js           # GoatCoin economy, blackjack, leaderboard
    ├── games.js              # Game vault (lazy-loaded, infinite scroll)
    ├── profile.js            # Profiles, badges, auto-awards, adblocker notice
    └── shop.js               # GoatCoin shop
```

---

## Ranks & Permissions

| Rank | Level | Abilities |
|---|---|---|
| `earthbound` | 0 | Blocked — cannot access the app |
| `planetary` | 1 | Default rank after approval — chat, DMs, games, GoatCoin |
| `solar` | 2 | Access to higher-tier channels |
| `galactic` | 3 | Increased visibility |
| `universal` | 4 | Moderation: approve/ban users, manage ranks below own level |
| `goat` | 5 | Full admin: everything above + DB cleanup panel |

### Auth Flow

1. User signs up with email/password &rarr; Firestore doc created with `status: 'pending'`
2. An admin (universal+) approves them &rarr; `status: 'approved'`, `rank: 'planetary'`
3. User logs in &rarr; full app access

---

## Features

### Chat System
- **Channels**: Two built-in (`general`, `admin`) plus unlimited custom channels
- **Channel options**: Password-protected, announcement-only, minimum rank requirement
- **Message pruning**: Auto-trims to 80 messages when a channel exceeds 100 (Firestore quota protection)
- **Typing indicators**: Real-time via RTDB, auto-expire after 4 seconds
- **Reactions**: 12 emoji reactions per message with toggle support
- **Message editing**: Authors can edit their own messages inline
- **Moderation**: Admins can delete any message; Goat rank can wipe entire threads

### Direct Messages
- Search for any approved user to start a conversation
- Real-time updates via Firestore `dms/{dmId}/messages` subcollection
- Typing indicators via RTDB `typing_dm/` path
- Unread badges in sidebar and nav

### Game Vault
- 100+ games loaded from external CDN (jsDelivr)
- Lazy-loaded thumbnails with infinite scroll
- Favorites stored in cookies
- Ad injection stripped from game HTML before rendering
- Fullscreen support

### GoatCoin Economy
- **Earning**: 1 GC per minute of active use (requires interaction every 3 min)
- **Tracking**: Separate weekly counters for chat, game, and site activity minutes
- **Blackjack**: Multiplayer PvP (1v1 or 1v2), hidden identity until accepted, tiebreaker rounds, stake transfers
- **Weekly badges**: Automatically awarded on Sunday reset
- **Leaderboard**: Real-time ranking by balance

### Profiles & Badges
- 40+ SVG avatar icons or initial letter
- 16 avatar colors
- Username change cooldown: 7 days
- Badge deduplication on every write

| Badge | Type | Criteria |
|---|---|---|
| `champion` | Weekly | Most GoatCoins earned |
| `sweat` | Weekly | Most game minutes |
| `social` | Weekly | Most chat minutes |
| `lucky` | Weekly | Most blackjack wins |
| `veteran` | Permanent | Member for 30+ days |
| `og` | Permanent | Early member (admin-awarded) |
| `customized` | Permanent | Custom avatar (admin-awarded) |

### Command Palette (Ctrl+K)
- Quick-jump to any section with fuzzy search
- Custom SVG icons for every item
- Keyboard shortcut hints (1-8 for all users, 1-9 if you're an admin)
- Arrow keys + Enter navigation

### Settings (8 tabs)

| Tab | What's in it |
|---|---|
| **Themes** | 29 color themes, click to apply with animated transition |
| **Alerts** | Chat/DM/mention toggles, per-channel notification control |
| **Display** | Layout (left/right/top/bottom nav), sidebar width, font size, blur, compact mode, parallax, message animations, and more |
| **Sound** | Message/DM/mention sounds, master volume slider, UI feedback sounds |
| **Chat** | Bubble style (Cozy/Compact/Bubbles/Minimal), rank badges, timestamps, typing indicators, grouping window |
| **Keybinds** | Full keyboard shortcut reference |
| **Advanced** | Custom accent color override (12 swatches), parallax speed, reduce motion, high contrast, focus mode, danger-zone reset |
| **Credits** | Team and tech stack |

---

## Admin Panel

Only visible to `universal`+ ranks. Goat-rank users get additional DB cleanup tools.

### Tabs
1. **Pending** — Approve or deny account requests
2. **Members** — View all users, change ranks, ban (with live search)
3. **Banned** — Unban users or permanently delete accounts (Goat only)
4. **DB Cleanup** (Goat only) — Categorized operations with live DB stats:

#### Users & Economy
| Action | What it does |
|---|---|
| Scan User States | Find users with unexpected status values |
| Wipe All GoatCoin | Resets every user's balance and all stats to 0 |
| Reset Weekly Stats | Clears weekly counters without touching balances |
| Delete GC by UID | Removes a specific user's GoatCoin document |
| Reset Visit Counter | Sets the global visit count to 0 in RTDB and Firestore |

#### Messages & Games
| Action | What it does |
|---|---|
| Wipe All DMs | Deletes all DM threads and messages across the platform |
| Wipe Channel Messages | Deletes all messages in a specific channel |
| Purge Stale BJ Games | Deletes stuck or expired blackjack games |
| Clear BJ Challenges | Deletes all pending/cancelled challenges |
| Clear Offline Presence | Removes stale Firestore presence docs |

---

## Nebula Historians (index.html)

The public-facing disguise — a convincing academic history website.

- Light parchment/ink theme
- 9 pages: Overview, 6 articles, References, Key Figures, About NHS
- Client-side search across all articles
- Rotating "Did You Know" facts panel
- **Konami Code** on the Louisiana Purchase page (`Up Up Down Down Left Right Left Right B A`) reveals the hidden portal to the main app

---

## RTDB Migration

One-time migration from Firestore to RTDB for presence and visit data. Only needed on first deploy.

1. Navigate to `migrate-to-rtdb.html`
2. Sign in with a Goat-rank account
3. Run "Migrate Presence" then "Migrate Visits Counter"
4. Verify with "Verify RTDB Data"
5. Clean up with "Delete Old Firestore Presence Docs"

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `Escape` | Close palette / modal / game vault |
| `1` - `8` | Jump to section (Home, Chat, DMs, Games, GoatCoin, Shop, Profile, Settings) |
| `9` | Jump to Admin (admins only) |
| `↑` in chat input | Edit your last message |

---

## Changelog

### March 2026
- **Settings overhaul**: Split into 8 tabs — Themes, Alerts, Display, Sound, Chat, Keybinds, Advanced, Credits
- **New customization**: Custom accent color override (12 swatches), bubble style selector, master volume slider
- **Advanced tab**: Danger-zone reset button, focus mode, high-contrast, parallax controls
- **Admin cleanup redesign**: Two-column category grid (Users & Economy / Messages & Games), live DB stats tiles, activity log
- **New cleanup ops**: Clear BJ Challenges, Clear Offline Presence, separate channel wipe dropdown
- **Full-width settings & admin**: Pages now use the full horizontal space instead of a capped width
- **Theme cards fixed**: Selected checkmark no longer shows garbled umlaut characters; empty space below previews eliminated
- **Comment rewrites**: All JS files have cleaner, clearer inline comments
- Command palette icons replaced with custom SVGs (moved to `icons.js`)
- Keyboard shortcut numbering now role-aware (1-8 for regular users, 1-9 for admins)
- Fixed tooltip overlap bug when switching tabs
- Added `icons.js` module for centralized icon management
- README updated

### March 2025
- RTDB presence system for real-time online/offline status
- Channel list unread badges fix (`data-cid` attribute)
- Blackjack: removed dealer, added tiebreaker rounds for tied series
- Admin panel overhaul with dynamic build, stats pills, member search, DB cleanup
- Nebula Historians full rewrite (9 pages, search, key figures grid)
- RTDB `databaseURL` added to Firebase config
- Badge rendering fix (proper wrapper in chat, deduplication)
- RTDB visit counter migration tool

---

*Nebula V2 — Beyond The Stars*
