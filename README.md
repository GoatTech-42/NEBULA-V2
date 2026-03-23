# NEBULA V2

## Project Overview
- **Name**: Nebula V2
- **Goal**: A private, invite-only social platform for chat, gaming, and GoatCoin economy
- **Features**: Multi-channel chat, DMs, game vault, GoatCoin gambling/economy, user profiles & badges, admin tools

---

## 🌐 URLs
- **Production**: Hosted via Firebase Hosting
- **Entry Point**: `index.html` → Nebula Historians page (secret portal to main app via Konami Code on Louisiana Purchase article)
- **Main App**: `main.html` (launched from the Konami Code easter egg)
- **RTDB Migration Tool**: `migrate-to-rtdb.html` (admin use only)

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: Vanilla JS with ES Modules
- **Backend**: Firebase (Firestore + Realtime Database + Auth + App Check)
- **Hosting**: Firebase Hosting
- **No framework**: Pure HTML/CSS/JS for minimal bundle size

### Firebase Services Used
| Service | Usage |
|---|---|
| Firestore | User profiles, messages, DMs, channels, GoatCoin docs |
| Realtime Database (RTDB) | Presence (online status), typing indicators, visit counter |
| Firebase Auth | Email/password authentication |
| App Check (reCAPTCHA v3) | Bot protection |

### Why RTDB for Presence/Typing?
Firestore charges per document read/write. With 10 users, presence heartbeats and typing indicators were exhausting the free quota. RTDB uses a persistent connection model — one listener covers all users' presence for fractions of the Firestore cost.

---

## 📁 File Structure

```
public/
├── index.html              # Nebula Historians (light theme website, secret portal)
├── main.html               # Main app shell
├── migrate-to-rtdb.html    # One-time migration tool (admin only)
├── css/
│   ├── layout.css          # Main layout & component styles
│   └── themes/             # 16 color themes (og, dark, light, aurora, etc.)
└── js/
    ├── firebase.js         # Firebase init & exports
    ├── app.js              # Core app logic (auth, chat, DMs, admin, nav)
    ├── goatcoin.js         # GoatCoin economy, blackjack, leaderboard
    ├── games.js            # Game vault (lazy-loaded)
    └── profile.js          # Profiles, badges, adblocker notice
```

---

## 🔐 Authentication & Ranks

| Rank | Access |
|---|---|
| `earthbound` | Blocked (can't use app) |
| `planetary` | Default approved rank; full chat/DM access |
| `solar` | Same as planetary + higher-tier channels |
| `galactic` | Higher visibility |
| `universal` | Moderation: approve/ban users, change ranks of lower users |
| `goat` | Full admin: all moderation + rank changes + DB cleanup |

### Auth Flow
1. User registers → status `pending`
2. Admin approves → status `approved`, rank `planetary`
3. User logs in → sees main app

---

## 💬 Chat System

### Channels
- Two hardcoded channels: `general` (all users) and `admin` (universal+ only)
- Custom channels can be created by moderators
- Password-protected channels, announcement-only channels supported
- Messages pruned to 100, trimmed to 80 when exceeded (Firestore quota protection)

### Typing Indicators
- Uses RTDB (cheap): `typing/{channelId}/{uid}` and `typing_dm/{dmId}/{uid}`
- Auto-expires after 4 seconds via client-side `setTimeout` + RTDB `remove()`

### Direct Messages
- Firestore `dms/{dmId}/messages` subcollection
- Typing indicators via RTDB `typing_dm/` path

---

## 🟡 GoatCoin Economy

### Earning
- 1 GC per minute of active use (must interact every 3 min, 3+ interactions)
- Tracks `weekChatMins`, `weekGameMins`, `weekSiteMins` separately
- Weekly reset (Sunday-based) with automatic badge awards

### Blackjack (Multiplayer)
- Challenge 1-2 players, set stake and best-of rounds
- **No dealer**: Pure player-vs-player comparison after both draw
- **Tie handling**: If series ends tied, extra tiebreaker round is played (no push/coin return)
- Stakes transferred at series end based on net win delta
- Identity hidden until challenge accepted (mystery opponent)

### Weekly Badges (Auto-awarded on week reset)
| Badge | Criteria |
|---|---|
| `champion` | Most GoatCoins earned that week |
| `sweat` | Most game minutes that week |
| `social` | Most chat minutes that week |
| `lucky` | Most blackjack wins that week |

### Permanent Badges
| Badge | Criteria |
|---|---|
| `veteran` | Member for 30+ days |
| `og` | One of the first members (admin-awarded) |
| `customized` | Customized avatar (admin-awarded) |

---

## 👤 Profiles & Badges

- Custom avatar: 40+ SVG icons or initial letter
- 16 avatar colors to choose from
- Username change cooldown: 7 days
- Badges render in chat messages, profile modal, and own profile page
- Badge deduplication runs on every write to prevent duplicate badges from appearing

---

## 🛡️ Admin Panel (`/admin` section)

Only visible to `universal`+ ranks.

### Tabs
1. **Pending** — Approve or deny account requests with search
2. **Members** — View all approved users, change ranks, ban — with live search
3. **Banned** — View banned users, unban, or permanently delete (goat only)
4. **DB Cleanup** (goat only) — See below

### DB Cleanup Panel
| Action | Description |
|---|---|
| Wipe All GoatCoin | Reset every user's balance and stats to 0 |
| Reset Weekly Stats | Reset only weekly fields (coins, mins, BJ wins) |
| Delete User GC | Remove a specific user's GoatCoin document |
| Wipe Channel | Delete all messages in a channel |
| Wipe All DMs | Delete all DM threads and messages |
| Clear Offline Presence | Remove Firestore presence docs (RTDB is auto-managed) |
| Purge Stale BJ Games | Delete stuck/old blackjack games |
| Clear BJ Challenges | Delete all pending challenges |
| Reset Visit Counter | Set visits to 0 in both RTDB and Firestore |

---

## 🔄 RTDB Migration (`migrate-to-rtdb.html`)

Run **once** after deploying to move existing Firestore presence data and visit counter to RTDB:

1. Navigate to `migrate-to-rtdb.html`
2. Sign in with a Goat-rank account
3. Click "Migrate Presence → RTDB"
4. Click "Migrate Visits Counter → RTDB"
5. Verify with "Verify RTDB Data"
6. Delete old Firestore docs with "Delete Old Firestore Presence Docs"

After migration, app.js automatically uses RTDB for all presence/typing/visits.

---

## 🎮 Game Vault

- Games loaded from external CDN (`gn-math/assets` on jsDelivr)
- Lazy-loaded images, infinite scroll
- Favorites stored in cookies
- Ad injection cleaned from game HTML before display

---

## 🏛️ Nebula Historians (index.html)

The public-facing entry point — styled as a real academic history website.

- **Light theme** with parchment/ink aesthetic
- **9 pages**: Overview, 6 articles, References, Key Figures, About NHS
- **Did You Know** rotating facts panel
- **Search** across all articles (client-side)
- **Navigation**: Top nav bar, sidebar with article list + stats, breadcrumbs
- **Konami Code easter egg** on the Louisiana Purchase page (`↑↑↓↓←→←→BA`) — reveals hidden portal to main app

---

## ⚙️ Settings

### Themes (16 total)
OG, Dark, Light, Aurora, Synthwave, Crimson, Midnight, Slate, Forest, Ocean, Rose, Solar, Void, Neon, Blush, Ice

### Display Options
- Layout: Left sidebar, Right sidebar, Top bar, Bottom bar
- Font size: XS–XL
- Compact mode, timestamps on hover, message animations
- Background blur intensity, parallax speed
- Focus mode, high contrast, reduce motion

---

## 🚀 Deployment

```bash
# Deploy to Firebase Hosting
firebase deploy

# Or just the hosting
firebase deploy --only hosting
```

**Firebase project**: `nebulav2`
**RTDB URL**: `https://nebulav2-default-rtdb.firebaseio.com`

---

## 🔧 Recent Changes (March 2025)

### Major Features
- ✅ **Presence in members sidebar**: RTDB presence now correctly shows online (green dot) / offline members in real time
- ✅ **Channel list unread badges**: Fixed `data-cid` attribute lookup bug
- ✅ **Blackjack tie fix**: Removed dealer entirely; tied series → extra tiebreaker round played
- ✅ **Admin panel overhaul**: Dynamic HTML build, stats pills, member search, DB cleanup tab
- ✅ **DB Cleanup Panel**: Full Goat-rank tool to wipe/modify all database collections
- ✅ **RTDB migration**: Visits counter now reads/writes to RTDB; migrator script provided
- ✅ **Badge rendering fix**: Badge row now in proper wrapper in chat messages; deduplicated
- ✅ **Nebula Historians**: Full rewrite — proper light-theme website with 9 pages, search, team page, Did You Know panel, key figures grid, navigation bar
- ✅ **RTDB `databaseURL`**: Added to firebase config so RTDB initializes correctly

### Bug Fixes
- Fixed `membersUnsub` not being set in RTDB branch (missing `renderTimer`)
- Fixed channel list badge selector using wrong attribute (`data-chid` → `data-cid`)
- Fixed BJ `bjNextRound` to allow continuation when `gameDone` but no winner (tiebreaker)
- Fixed RTDB visit counter to keep the higher value during migration

---

*Nebula V2 — Beyond The Stars*
