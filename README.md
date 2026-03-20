# ✦ NEBULA V2

> A private, invite-only chat and gaming platform. Beyond the stars.

![Nebula V2](https://img.shields.io/badge/version-2.0-blue?style=flat-square&color=4fc9ea)
![Firebase](https://img.shields.io/badge/Firebase-Firestore%20%2B%20Auth-orange?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/Built%20with-Vanilla%20JS-yellow?style=flat-square)

---


## Project Overview

**Nebula V2** is a private, invite-only web platform that combines real-time chat, a curated browser game vault, and a dynamic user ranking system—all wrapped in a highly polished, themeable interface.

### Key Components
- **Frontend:** Built with vanilla JavaScript, Nebula V2 features modular code for core app logic, user authentication, game browsing, virtual currency, and user profiles.
  - `app.js`: Manages app state, user sessions, channel/DM logic, and UI utilities.
  - `firebase.js`: Handles Firebase initialization, authentication, and Firestore integration.
  - `games.js`: Powers the game vault, including search, favorites, and in-app game launching.
  - `goatcoin.js`: Implements the GoatCoin virtual currency, multiplayer blackjack, and leaderboards.
  - `profile.js`: Manages user profiles, badges, and adblocker detection.

- **Visual Design:**
  - `layout.css`: Provides the structural and utility styles for a responsive, modern layout.
  - `themes/`: Sixteen unique CSS themes, each with custom fonts, colors, and animated transitions, allow deep personalization.

- **HTML Shell:**
  - `index.html`: The main entry point, styled for a playful, retro look with custom cursors and CRT effects.

### Features
- Real-time chat with advanced features (reactions, editing, mentions, notifications)
- Hundreds of browser games, with search, favorites, and daily featured carousel
- GoatCoin currency system, multiplayer blackjack, and weekly badge awards
- Six user ranks, each unlocking new privileges and channels
- Fully responsive, mobile-friendly design with animated backgrounds and theme transitions

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
│   │   ├── goatcoin.js     # GoatCoin currency & multiplayer
│   │   └── profile.js      # Profiles, badges, adblocker
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


1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Create a project
4. Enable **Firestore Database**
5. Replace the `firebaseConfig` object in `firebase.js` with your own credentials

### 3. Firestore Rules

Set your Firestore rules to require authentication:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
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
