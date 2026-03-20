# ✦ NEBULA V2

> A private, invite-only chat and gaming platform. Beyond the stars.

![Nebula V2](https://img.shields.io/badge/version-2.0-blue?style=flat-square&color=4fc9ea)
![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%2B%20Auth-orange?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/Built%20with-Vanilla%20JS-yellow?style=flat-square)

---

## Features

**Chat**
- Real-time channels and direct messages powered by Firestore
- Message grouping, reactions, editing, and deletion
- Typing indicators, mentions (`@username`), and URL linkification
- Announcement-only channels
- Password-protected channels
- Per-channel notification preferences

**Game Vault**
- Hundreds of browser games with cover art
- Featured carousel with daily rotation
- Search, sort by popularity / name / newest
- Favorites (saved via cookie)
- In-app game viewer with fullscreen support

**Accounts & Ranks**
- Invite-only — new accounts require moderator approval
- Six rank tiers: `earthbound` → `planetary` → `solar` → `galactic` → `universal` → `goat`
- Rank-gated channel access
- Username cooldown (7-day change limit)
- Custom avatar colors

**Themes**
- 16 built-in themes with animated circular transition on switch
- OG · Dark · Light · Aurora · Synthwave · Crimson · Midnight · Slate · Forest · Ocean · Rose · Solar · Void · Neon · Blush · Ice

**Misc**
- Parallax nebula background with mouse tracking
- Live visit counter
- FPS meter + battery indicator on home screen
- Fully responsive, mobile-friendly layout

---

## Project Structure

```
Nebula V2/
├── public/
│   ├── index.html          # App shell & all sections
│   ├── js/
│   │   ├── app.js          # Core app logic
│   │   ├── firebase.js     # Firebase init & exports
│   │   ├── games.js        # Game vault logic
│   │   └── tooltips.json   # Home screen tooltip pool
│   └── css/
│       ├── layout.css      # Structure, spacing, animations
│       └── themes/         # One CSS file per theme
│           ├── og.css
│           ├── dark.css
│           └── ...
└── README.md
```

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/GoatTech-42/NEBULA-V2.git
cd NEBULA-V2
```

### 2. Firebase

This project uses Firebase for auth and Firestore. The config is in `public/js/firebase.js`.

To use your own Firebase project:

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project
3. Enable **Authentication → Email/Password**
4. Enable **Firestore Database**
5. Replace the `firebaseConfig` object in `firebase.js` with your own credentials

### 3. Firestore Rules

Set your Firestore rules to require authentication:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Serve

No build step required. Just serve the `public/` folder with any static file server:

```bash
# Using VS Code Live Server, or:
npx serve public
```

> ⚠️ Must be served over HTTP/HTTPS — Firebase Auth won't work from `file://`.

---

## Rank System

| Rank | Level | Access |
|------|-------|--------|
| `earthbound` | 0 | Pending / no chat access |
| `planetary` | 1 | Standard chat access |
| `solar` | 2 | — |
| `galactic` | 3 | — |
| `universal` | 4 | Moderator — approve users, manage channels |
| `goat` | 5 | Full admin |

New signups start as `earthbound` with status `pending`. A `universal+` user must approve them from the Admin panel, which promotes them to `planetary`.

---

## Built With

- **Firebase** — Auth + Firestore realtime database
- **Vanilla JS** — No frameworks, no build tools
- **CSS custom properties** — Full theming system via CSS variables
- **jsDelivr CDN** — Game assets and covers

---

*Made by GoatTech. GoatTech Never Dies.*