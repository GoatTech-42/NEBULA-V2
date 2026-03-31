# NEBULA V2

> A private, invite-only social platform with real-time chat, gaming, and its own in-app economy.

---

## Overview

Nebula V2 is a zero-framework web app built with vanilla HTML/CSS/JS and Firebase. It features multi-channel chat, direct messages, a game vault with 100+ titles, a full GoatCoin currency and gambling system, rich user profiles with badges, 29 color themes, and a comprehensive admin panel. The entry point is disguised as a legitimate academic history website with a hidden Konami Code portal.

---

## Quick Start

```bash
# Install Firebase CLI
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

Firestore charges per document read/write. With active users, presence heartbeats and typing indicators burn through the free tier fast. RTDB uses a persistent WebSocket, so one listener covers all users at a fraction of the cost.

---

## File Structure

```
public/
+-- index.html                # Disguised entry -- Nebula Historical Society
+-- main.html                 # Main app shell
+-- construction.html         # Maintenance page
+-- css/
|   +-- layout.css            # Core layout & component styles
|   +-- themes/               # 29 color themes
|       +-- og.css            # Default theme
|       +-- dark.css, light.css, aurora.css, synthwave.css,
|       +-- crimson.css, midnight.css, slate.css, forest.css,
|       +-- ocean.css, rose.css, solar.css, void.css, neon.css,
|       +-- blush.css, ice.css, candy.css, vapor.css, copper.css,
|       +-- lavender.css, arctic.css, ember.css, moss.css, dusk.css,
|       +-- pearl.css, cyberpunk.css, sakura.css, rust.css, glacier.css
+-- js/
    +-- firebase.js           # Firebase config, init & re-exports
    +-- app.js                # Core: auth, chat, DMs, admin, nav, settings
    +-- icons.js              # SVG icon library for command palette
    +-- goatcoin.js           # GoatCoin economy, blackjack, leaderboard
    +-- games.js              # Game vault (lazy-loaded, infinite scroll)
    +-- profile.js            # Profiles, badges, auto-awards
    +-- shop.js               # GoatCoin shop
```

---

## Ranks & Permissions

| Rank | Level | Abilities |
|---|---|---|
| `earthbound` | 0 | Blocked -- cannot access the app |
| `planetary` | 1 | Default after approval -- chat, DMs, games, GoatCoin |
| `solar` | 2 | Access to higher-tier channels |
| `galactic` | 3 | Increased visibility |
| `universal` | 4 | Moderation: approve/ban users, manage ranks |
| `goat` | 5 | Full admin: everything + DB cleanup |

### Auth Flow

1. User signs up with email/password -- Firestore doc created with `status: 'pending'`
2. Admin (Universal+) approves -- `status: 'approved'`, `rank: 'planetary'`
3. User logs in -- full app access

---

## Features

### Chat System
- **Channels**: Two built-in (`general`, `admin`) + unlimited custom channels
- **Options**: Password-protected, announcement-only, minimum rank requirement
- **Auto-pruning**: Trims to 80 messages when a channel exceeds 100
- **Typing indicators**: Real-time via RTDB, auto-expire after 4s
- **Reactions**: 12 emoji reactions per message with toggle
- **Editing**: Authors can edit their own messages inline
- **Moderation**: Admins delete any message; Goat rank wipes entire threads

### Direct Messages
- Search any approved user to start a conversation
- Real-time via Firestore `dms/{dmId}/messages` subcollection
- Typing indicators via RTDB `typing_dm/` path
- Unread badges in sidebar and nav

### Game Vault
- 100+ games from external CDN (jsDelivr)
- Lazy-loaded thumbnails with infinite scroll
- Favorites stored in cookies
- Ad injection stripped from game HTML
- Fullscreen support

### GoatCoin Economy
- **Earning**: 1 GC per minute of active use (requires interaction every 3 min)
- **Tracking**: Separate weekly counters for chat, game, and site activity
- **Blackjack**: 1v1 (no dealer), hidden identity until accepted, tiebreaker rounds
- **Weekly badges**: Auto-awarded on Sunday reset
- **Leaderboard**: Real-time ranking by multiple metrics

### GoatCoin Shop
- Profile icons, name flair, and badges purchasable with GC
- Locked tiers gated by rank or total spend
- Equip/unequip system for icons and flair
- Ownership stored in RTDB

### Profiles & Badges
- 30+ SVG avatar icons or initial letter
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
| `pioneer` | Shop | First shop purchase |
| `whale` | Shop | Big spender |
| `chatterbox` | Shop | Chat enthusiast badge |
| `gamer` | Shop | Dedicated gamer badge |
| `shopkeeper` | Shop | Serious shop investor |

### Command Palette (Ctrl+K)
- Quick-jump to any section with fuzzy search
- Custom SVG icons for every item
- Keyboard shortcut hints (1-8, or 1-9 for admins)
- Arrow keys + Enter navigation

### Settings (7 tabs)
- **Themes**: 29 themes with animated preview cards
- **Display**: Layout (left/right/top/bottom), sidebar width, font size, nav labels
- **Chat**: Compact mode, timestamps, animations, rank badges, typing, message grouping, input behavior
- **Background**: Parallax toggle/speed, blur intensity, theme transitions, nav glow
- **Alerts**: Chat/DM/mention notifications, per-channel control
- **Accessibility**: Reduce motion, high contrast, wider lines, focus mode, hide typing bar, rank visibility
- **Credits**: Developer and technology credits

---

## Admin Panel

Visible to `universal`+ ranks. Goat rank gets additional DB cleanup tools.

### Tabs
1. **Pending** -- Approve or deny account requests
2. **Members** -- View all users, change ranks, ban (with live search)
3. **Banned** -- Unban users or permanently delete accounts
4. **DB Cleanup** (Goat only) -- Bulk data operations with activity log:

| Action | Description |
|---|---|
| Orphan Scan | Find Firestore users with invalid status |
| Wipe GoatCoin | Reset all balances and stats to zero |
| Reset Weekly | Clear weekly counters, keep balances |
| Delete User GC | Remove a specific user's GoatCoin doc |
| Wipe Channel | Delete all messages in a channel |
| Wipe All DMs | Delete every DM thread and message |
| Purge Stale BJ | Remove completed or expired blackjack games |
| Reset Visits | Set visit counter back to zero |

---

## Nebula Historians (index.html)

The public-facing disguise -- a convincing academic history website.

- Light parchment/ink theme
- 9 pages: Overview, 6 articles, References, Key Figures, About NHS
- Client-side search across all articles
- Rotating "Did You Know" facts panel
- **Konami Code** on the Louisiana Purchase page reveals the hidden portal

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `Escape` | Close palette / modal / game vault |
| `1` - `8` | Jump to section |
| `9` | Jump to Admin (admins only) |

---

## Changelog

### March 2026 (Latest)
- Settings split into 7 tabs: Themes, Display, Chat, Background, Alerts, Accessibility, Credits
- Settings and Admin pages now use full horizontal width
- Fixed theme card empty space under preview images
- Fixed garbled checkmark character on selected theme indicator
- Fixed mojibake/encoding issues in CSS comments
- Admin cleanup tab redesigned with categorized operations and activity log
- All code comments rewritten for clarity across all JS files
- README updated to reflect 29 themes and current feature set
- Added Chat settings tab with message grouping, input behavior
- Added Background settings tab with parallax speed/blur controls
- Added Accessibility tab with focus mode, reduce motion, contrast settings

### March 2026
- Command palette icons replaced with custom SVGs (moved to `icons.js`)
- Keyboard shortcut numbering now role-aware (1-8 for regular users, 1-9 for admins)
- Fixed tooltip overlap bug when switching tabs
- Added `icons.js` module for centralized icon management

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

*Nebula V2 -- Beyond The Stars*
