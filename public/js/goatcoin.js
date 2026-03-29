// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  goatcoin.js â€” GoatCoin currency, 1v1 blackjack,
//  leaderboard, weekly badge awards
//  NOTE: Blackjack is STRICTLY 2-player (you vs one opponent).
//        Games stored in RTDB for speed/cost.
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
import {
  db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where,
  getDocs, onSnapshot, orderBy, limit, serverTimestamp, increment, addDoc, deleteDoc
} from './firebase.js';
import { getDatabase, ref as rtRef, set as rtSet, get as rtGet, onValue, push as rtPush, remove as rtRemove, update as rtUpdate, onDisconnect } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { toast, avatarColor, avatarInitial, escHtml, avatarHtml } from './app.js';

// â”€â”€ Constants â”€â”€
const COIN_PER_MINUTE = 1;
const COIN_TICK_MS    = 60_000;

// â”€â”€ Module state â”€â”€
let _gcUser    = null;
let _gcData    = null;
let _gcUnsub   = null;
let _gcTimer   = null;
let _activity  = 'site';

// Multiplayer BJ (1v1 only)
let _mpGame        = null;
let _mpGameId      = null;
let _mpGameUnsub   = null; // RTDB listener off-fn
let _mpChallengeId = null;
let _mpChalOpp     = null;
let _mpChalStake   = 0;
let _mpChalBestOf  = 3;
let _mpChalUnsub   = null; // Firestore challenges listener
let _mpChalUnsub2  = null; // Firestore sent-challenge listener
let _cachedIncoming = [];
let _myRole        = null;
let _bjDocClickBound = false;

let _rtdb = null;

const GOATCOIN_ICON_SVG = '<svg class="gc-title-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><defs><linearGradient id="gcCoinGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fde68a"/><stop offset="55%" stop-color="#f59e0b"/><stop offset="100%" stop-color="#d97706"/></linearGradient></defs><circle cx="12" cy="12" r="9" fill="url(#gcCoinGrad)"/><circle cx="12" cy="12" r="6.5" fill="none" stroke="rgba(255,255,255,.45)" stroke-width="1.2"/><path d="M9.2 14.6h4.5c1.2 0 2-.7 2-1.7 0-1-.7-1.5-1.9-1.7l-2.4-.3c-1-.2-1.4-.5-1.4-1.1 0-.7.6-1.2 1.7-1.2h3.9" stroke="#4a2b00" stroke-width="1.5" stroke-linecap="round"/><path d="M12 7.1v9.8" stroke="#4a2b00" stroke-width="1.5" stroke-linecap="round"/></svg>';
const BJ_DECK_ICON_SVG = '<svg class="bj-lobby-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="12" height="15" rx="2"/><path d="M8 9h4"/><path d="M10 7v4"/><path d="M9 15l2-2 2 2"/><path d="M9 13h4"/><path d="M10 16h2"/><rect x="9" y="3" width="11" height="15" rx="2" opacity=".6"/></svg>';
const BJ_COIN_ICON_SVG = '<svg class="bj-inline-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="currentColor" opacity=".14"/><circle cx="12" cy="12" r="8" stroke="currentColor" stroke-width="1.8"/><path d="M10 14h3.2c1 0 1.7-.5 1.7-1.3 0-.8-.6-1.2-1.6-1.3l-1.7-.2c-.9-.1-1.3-.4-1.3-.9 0-.6.5-1 1.4-1h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 8.2v7.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  WEEK KEY
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _weekKey() {
  const now = new Date();
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  sunday.setDate(now.getDate() - now.getDay());
  const y = sunday.getFullYear();
  const m = String(sunday.getMonth() + 1).padStart(2, '0');
  const d = String(sunday.getDate()).padStart(2, '0');
  return `${y}-W-${m}${d}`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  INIT
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function initGoatCoin(user, userData, rtdb) {
  _gcUser = user;
  _rtdb = rtdb || null;
  window._getGCData = () => _gcData;
  _gcData = null;
  _subscribeCoins();
  _startEarning();
  _listenIncomingChallenges();
  setTimeout(_cleanupStaleData, 3000);
}

async function _cleanupStaleData() {
  if(!_gcUser) return;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [sentSnap, recvSnap] = await Promise.all([
      getDocs(query(collection(db,'bj_challenges'), where('fromUid','==',_gcUser.uid))),
      getDocs(query(collection(db,'bj_challenges'), where('toUid','==',_gcUser.uid)))
    ]);
    const toDel = [];
    [...sentSnap.docs, ...recvSnap.docs].forEach(d => {
      const data = d.data();
      if(data.status !== 'pending') toDel.push(d.ref);
      else if(data.createdAt?.toDate && data.createdAt.toDate() < cutoff) toDel.push(d.ref);
    });
    await Promise.all(toDel.map(r => deleteDoc(r).catch(()=>{})));
    // Clean up stale RTDB games
    if(_rtdb) {
      const gamesSnap = await rtGet(rtRef(_rtdb, 'bj_games'));
      if(gamesSnap.val()) {
        const now = Date.now();
        Object.entries(gamesSnap.val()).forEach(([gid, g]) => {
          if(g.phase === 'gameDone' || (g.createdAt && (now - g.createdAt) > 24*60*60*1000)) {
            rtRemove(rtRef(_rtdb, `bj_games/${gid}`)).catch(()=>{});
          }
        });
      }
    }
  } catch(e) {}
}

export function setActivity(mode) {
  _activity = mode;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  COINS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _subscribeCoins() {
  if(_gcUnsub) _gcUnsub();
  const ref = doc(db, 'goatcoin', _gcUser.uid);
  _gcUnsub = onSnapshot(ref, snap => {
    _gcData = snap.exists() ? snap.data() : _defaultCoins();
    if(!snap.exists()) setDoc(ref, _gcData).catch(()=>{});
    _checkWeekReset();
    _updateCoinDisplay();
    _refreshTabIfOpen();
    if(window._onGCUpdate) window._onGCUpdate();
  });
}

function _defaultCoins() {
  return {
    coins: 0, weekCoins: 0, totalCoins: 0,
    weekSiteMins: 0, weekChatMins: 0, weekGameMins: 0,
    totalSiteMins: 0, totalChatMins: 0, totalGameMins: 0,
    weekBJWins: 0, totalBJWins: 0,
    lastWeekReset: _weekKey()
  };
}

async function _checkWeekReset() {
  if(!_gcData) return;
  const current = _weekKey();
  if(_gcData.lastWeekReset === current) return;
  await _awardWeeklyBadges();
  await updateDoc(doc(db,'goatcoin',_gcUser.uid), {
    weekCoins: 0, weekSiteMins: 0, weekChatMins: 0,
    weekGameMins: 0, weekBJWins: 0, lastWeekReset: current
  }).catch(()=>{});
}

async function _awardWeeklyBadges() {
  try {
    const snap = await getDocs(collection(db,'goatcoin'));
    if(snap.empty) return;
    let topCoins={uid:null,val:0}, topGames={uid:null,val:0},
        topChat={uid:null,val:0},  topBJ={uid:null,val:0};
    snap.docs.forEach(d => {
      const data = d.data();
      if((data.weekCoins||0)    > topCoins.val) topCoins={uid:d.id,val:data.weekCoins||0};
      if((data.weekGameMins||0) > topGames.val) topGames={uid:d.id,val:data.weekGameMins||0};
      if((data.weekChatMins||0) > topChat.val)  topChat ={uid:d.id,val:data.weekChatMins||0};
      if((data.weekBJWins||0)   > topBJ.val)    topBJ   ={uid:d.id,val:data.weekBJWins||0};
    });
    const allUsers = await getDocs(collection(db,'users'));
    await Promise.all(allUsers.docs.map(d => {
      const badges = (d.data().badges||[]).filter(b=>!['champion','sweat','social','lucky'].includes(b));
      return updateDoc(doc(db,'users',d.id),{badges});
    })).catch(()=>{});
    const awards = [];
    if(topCoins.uid && topCoins.val>0) awards.push([topCoins.uid,'champion']);
    if(topGames.uid && topGames.val>0) awards.push([topGames.uid,'sweat']);
    if(topChat.uid  && topChat.val>0)  awards.push([topChat.uid, 'social']);
    if(topBJ.uid    && topBJ.val>0)    awards.push([topBJ.uid,   'lucky']);
    for(const [uid, badge] of awards) {
      const ref = doc(db,'users',uid);
      const usnap = await getDoc(ref);
      if(!usnap.exists()) continue;
      const existing = usnap.data().badges||[];
      if(!existing.includes(badge))
        await updateDoc(ref,{badges:[...existing,badge]}).catch(()=>{});
    }
  } catch(e) { console.warn('Badge award error',e); }
}

function _startEarning() {
  if(_gcTimer) clearTimeout(_gcTimer);
  function scheduleNext() {
    const jitter = (Math.random() * 30000) - 15000;
    _gcTimer = setTimeout(async () => {
      await _earnTick();
      scheduleNext();
    }, COIN_TICK_MS + jitter);
  }
  scheduleNext();
}

let _lastActivity = Date.now();
let _interactionCount = 0;
const _IDLE_MS = 3 * 60 * 1000;
const _MIN_INTERACTIONS = 3;

['mousedown','keydown','touchstart','click'].forEach(ev => {
  document.addEventListener(ev, () => {
    _lastActivity = Date.now();
    _interactionCount = Math.min(_interactionCount + 1, _MIN_INTERACTIONS + 1);
  }, {passive:true});
});

async function _earnTick() {
  if(!_gcUser || !_gcData || document.hidden) return;
  if(Date.now() - _lastActivity > _IDLE_MS) return;
  if(_interactionCount < _MIN_INTERACTIONS) return;
  const minField      = _activity === 'game' ? 'weekGameMins'  : _activity === 'chat' ? 'weekChatMins'  : 'weekSiteMins';
  const totalMinField = _activity === 'game' ? 'totalGameMins' : _activity === 'chat' ? 'totalChatMins' : 'totalSiteMins';
  await updateDoc(doc(db,'goatcoin',_gcUser.uid), {
    coins:           increment(COIN_PER_MINUTE),
    weekCoins:       increment(COIN_PER_MINUTE),
    totalCoins:      increment(COIN_PER_MINUTE),
    [minField]:      increment(1),
    [totalMinField]: increment(1)
  }).catch(()=>{});
}

function _updateCoinDisplay() {
  const v = _gcData ? Math.floor(_gcData.coins||0) : 0;
  document.querySelectorAll('.gc-balance').forEach(el => {
    el.textContent = v.toLocaleString() + ' GC';
  });
}

function _refreshTabIfOpen() {
  const container = document.getElementById('section-goatcoin');
  if(!container) return;
  if(container.classList.contains('active')) {
    if(_mpGameId) {
      const balEl = document.getElementById('gc-bal-display');
      if(balEl) balEl.textContent = (_gcData ? Math.floor(_gcData.coins||0) : 0).toLocaleString();
    } else {
      _renderTab();
    }
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  TAB RENDER
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function renderGoatCoinTab() { _renderTab(); }

function _renderTab() {
  const container = document.getElementById('section-goatcoin');
  if(!container) return;
  const coins      = _gcData ? Math.floor(_gcData.coins||0) : 0;
  const totalCoins = _gcData ? Math.floor(_gcData.totalCoins||0) : 0;
  const wCoins     = _gcData ? Math.floor(_gcData.weekCoins||0) : 0;
  const wChat      = _gcData ? Math.floor(_gcData.weekChatMins||0) : 0;
  const wGame      = _gcData ? Math.floor(_gcData.weekGameMins||0) : 0;
  const wBJ        = _gcData ? Math.floor(_gcData.weekBJWins||0) : 0;

  const now = new Date();
  const sunday = new Date(now);
  sunday.setDate(now.getDate() - now.getDay());
  sunday.setHours(0,0,0,0);
  const saturday = new Date(sunday);
  saturday.setDate(sunday.getDate() + 6);
  const weekLabel = `${sunday.toLocaleDateString('en-US',{month:'short',day:'numeric'})} — ${saturday.toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;

  container.innerHTML = `
    <div class="pad gc-page">
      <!-- Hero Banner -->
      <div class="gc-hero-banner">
        <div class="gc-hero-bg"><div class="gc-hero-glow"></div></div>
        <div class="gc-hero-content">
          <div class="gc-hero-left">
            <div class="gc-hero-icon">${GOATCOIN_ICON_SVG}</div>
            <div>
              <div class="gc-hero-title">GoatCoin</div>
              <div class="gc-hero-sub">Earn coins for being here. Bet in blackjack. Climb the board.</div>
            </div>
          </div>
          <div class="gc-hero-right">
            <div class="gc-hero-balance">
              <div class="gc-hero-bal-amount gc-balance" id="gc-bal-display">${coins.toLocaleString()}</div>
              <div class="gc-hero-bal-label">GC</div>
            </div>
            <div class="gc-hero-alltime">All-Time: ${totalCoins.toLocaleString()} GC</div>
          </div>
        </div>
      </div>

      <!-- Week header -->
      <div class="gc-week-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>Week of ${weekLabel}</span>
      </div>

      <!-- Redesigned stat tiles -->
      <div class="gc-stats-strip">
        <div class="gc-stat-tile gc-stat-earned">
          <div class="gc-stat-tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
          </div>
          <div class="gc-stat-tile-num">${wCoins.toLocaleString()}</div>
          <div class="gc-stat-tile-label">Earned</div>
        </div>
        <div class="gc-stat-tile gc-stat-chat">
          <div class="gc-stat-tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </div>
          <div class="gc-stat-tile-num">${wChat}<span style="font-size:.65em;font-weight:600;opacity:.7">m</span></div>
          <div class="gc-stat-tile-label">Chat Time</div>
        </div>
        <div class="gc-stat-tile gc-stat-games">
          <div class="gc-stat-tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="17" cy="13" r="1" fill="currentColor"/></svg>
          </div>
          <div class="gc-stat-tile-num">${wGame}<span style="font-size:.65em;font-weight:600;opacity:.7">m</span></div>
          <div class="gc-stat-tile-label">Game Time</div>
        </div>
        <div class="gc-stat-tile gc-stat-bj">
          <div class="gc-stat-tile-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
          </div>
          <div class="gc-stat-tile-num">${wBJ}</div>
          <div class="gc-stat-tile-label">BJ Wins</div>
        </div>
      </div>

      <!-- Main Layout: BJ + Leaderboard -->
      <div class="gc-main-layout">
        <div class="gc-bj-col" id="gc-bj-col">${_renderBJLobby()}</div>
        <div class="gc-lb-col">
          <div class="gc-lb-card">
            <div class="gc-lb-card-hdr">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
              Leaderboard
            </div>
            <div id="gc-leaderboard-content"><div class="gc-lb-loading">Loading…</div></div>
          </div>
        </div>
      </div>
    </div>`;

  _wireBJLobby();
  _renderLeaderboard();
  if(_mpGameId && _mpGame) { _renderBJTable(); return; }
  if(_mpChallengeId && _mpChalOpp) _restoreWaitingState();
  if(_cachedIncoming.length) _renderPendingChallenges(_cachedIncoming);
  _fetchIncomingNow();
}

function _renderBJLobby() {
  return `<div class="bj-lobby">
    <div class="bj-lobby-card">
      <div class="bj-lobby-intro">
        ${BJ_DECK_ICON_SVG}
        <div>
          <div class="bj-lobby-title">1v1 Blackjack</div>
          <div class="bj-lobby-sub">Challenge one opponent. Closest to 21 wins each round â€” no dealer advantage. Most round wins takes the pot.</div>
        </div>
      </div>

      <div class="bj-form-section">
        <div class="bj-form-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          Opponent
        </div>
        <div class="bj-opp-search-wrap">
          <input class="bj-opp-inp" id="bj-opp-inp" type="text" placeholder="Search for a player..." autocomplete="off">
          <div class="bj-search-results hidden" id="bj-search-results"></div>
        </div>
        <div class="bj-selected-pill hidden" id="bj-selected"></div>
      </div>

      <div class="bj-form-row-inline">
        <div class="bj-form-section" style="flex:1">
          <div class="bj-form-label">${BJ_COIN_ICON_SVG} Stake per round (GC)</div>
          <div class="bj-chips-row">
            <button class="bj-chip" data-bet="10">10</button>
            <button class="bj-chip" data-bet="25">25</button>
            <button class="bj-chip" data-bet="50">50</button>
            <button class="bj-chip" data-bet="100">100</button>
            <button class="bj-chip" data-bet="250">250</button>
          </div>
          <input id="bj-stake-input" class="field-input" type="number" min="1" placeholder="Custom amount..." style="margin-top:.5rem;max-width:160px">
        </div>
        <div class="bj-form-section" style="flex:0 0 auto">
          <div class="bj-form-label"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> Best of</div>
          <div class="bj-chips-row">
            <button class="bj-chip bj-bo-chip" data-bo="1">1</button>
            <button class="bj-chip bj-bo-chip active" data-bo="3">3</button>
            <button class="bj-chip bj-bo-chip" data-bo="5">5</button>
            <button class="bj-chip bj-bo-chip" data-bo="7">7</button>
          </div>
        </div>
      </div>

      <button class="btn bj-challenge-btn" id="bj-send-challenge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send Challenge
      </button>
      <div class="merr" id="bj-challenge-err"></div>
    </div>
    <div class="bj-pending-section" id="bj-pending-section"></div>
  </div>`;
}

let _selectedOpp = null;

async function _updateStakeMax() {
  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  let minCoins = myCoins;
  if(_selectedOpp) {
    try {
      const snap = await getDoc(doc(db,'goatcoin',_selectedOpp.uid));
      const c = snap.exists() ? Math.floor(snap.data().coins||0) : 0;
      if(c < minCoins) minCoins = c;
    } catch(e) {}
  }
  const stakeInp = document.getElementById('bj-stake-input');
  if(stakeInp) {
    stakeInp.max = minCoins;
    stakeInp.placeholder = `Max: ${minCoins.toLocaleString()} GC`;
    const cur = parseInt(stakeInp.value||'0');
    if(cur > minCoins) stakeInp.value = minCoins;
  }
  document.querySelectorAll('.bj-chip:not(.bj-bo-chip)').forEach(btn => {
    const val = parseInt(btn.dataset.bet||'0');
    btn.disabled = val > minCoins;
    btn.style.opacity = val > minCoins ? '.35' : '';
  });
}

function _wireBJLobby() {
  const panel = document.getElementById('gc-bj-col');
  if(!panel) return;

  panel.querySelectorAll('.bj-chip:not(.bj-bo-chip)').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.bj-chip:not(.bj-bo-chip)').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const inp = panel.querySelector('#bj-stake-input');
      if(inp) inp.value = btn.dataset.bet;
    });
  });

  panel.querySelectorAll('.bj-bo-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('.bj-bo-chip').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const inp = panel.querySelector('#bj-opp-inp');
  if(inp) {
    let t;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => _searchOpponents(inp.value.trim()), 250);
    });
    if(!_bjDocClickBound) {
      document.addEventListener('click', e => {
        if(!e.target.closest('#bj-search-results') && !e.target.closest('#bj-opp-inp')) {
          document.getElementById('bj-search-results')?.classList.add('hidden');
        }
      }, { passive: true });
      _bjDocClickBound = true;
    }
  }

  panel.querySelector('#bj-send-challenge')?.addEventListener('click', _sendChallenge);
  _updateStakeMax();
  _renderPendingChallenges();
}

async function _searchOpponents(q) {
  const resultsEl = document.getElementById('bj-search-results');
  if(!resultsEl) return;
  if(!q) { resultsEl.innerHTML=''; resultsEl.classList.add('hidden'); return; }
  try {
    const snap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
    const users = snap.docs.map(d=>d.data())
      .filter(u => u.uid !== _gcUser.uid && u.username?.toLowerCase().includes(q.toLowerCase()))
      .slice(0,8);
    if(!users.length) { resultsEl.innerHTML='<div class="bj-sr-empty">No users found</div>'; resultsEl.classList.remove('hidden'); return; }
    resultsEl.innerHTML = users.map(u => `
      <div class="bj-sr-item" data-uid="${u.uid}" data-username="${escHtml(u.username)}" data-color="${u.color||avatarColor(u.uid)}" data-icon="${u.icon||''}">
        <div class="bj-sr-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarHtml(u.icon,u.username,'60%')}</div>
        <span class="bj-sr-name">${escHtml(u.username)}</span>
        <span class="rbadge ${u.rank}" style="font-size:.55rem">${u.rank}</span>
      </div>`).join('');
    resultsEl.classList.remove('hidden');
    resultsEl.querySelectorAll('.bj-sr-item').forEach(item => {
      item.addEventListener('click', () => {
        _selectedOpp = { uid:item.dataset.uid, username:item.dataset.username, color:item.dataset.color, icon:item.dataset.icon||'' };
        const oppInp = document.getElementById('bj-opp-inp');
        if(oppInp) oppInp.value = '';
        resultsEl.innerHTML=''; resultsEl.classList.add('hidden');
        const pill = document.getElementById('bj-selected');
        if(pill) {
          pill.innerHTML = `
            <div class="bj-sr-ava" style="background:${_selectedOpp.color}">${avatarHtml(_selectedOpp.icon,_selectedOpp.username,'60%')}</div>
            <span>${escHtml(_selectedOpp.username)}</span>
            <button class="bj-clear-btn" id="bj-clear-opp">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
          pill.classList.remove('hidden');
          document.getElementById('bj-clear-opp')?.addEventListener('click', () => {
            _selectedOpp = null;
            pill.classList.add('hidden');
            _updateStakeMax();
          });
          _updateStakeMax();
        }
      });
    });
  } catch(e) { console.error(e); }
}

async function _sendChallenge() {
  const err = document.getElementById('bj-challenge-err');
  if(err) err.textContent='';
  if(!_selectedOpp) { if(err) err.textContent='Select an opponent'; return; }
  const stake = parseInt(document.getElementById('bj-stake-input')?.value||'0');
  if(!stake||stake<1) { if(err) err.textContent='Set a stake amount'; return; }
  const boBtn = document.querySelector('.bj-bo-chip.active');
  const bestOf = parseInt(boBtn?.dataset.bo||'3');

  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  const maxLoss = stake * Math.ceil(bestOf/2);

  if(maxLoss > myCoins) {
    if(err) err.textContent=`You don't have enough GC â€” need ${maxLoss.toLocaleString()} to cover worst-case losses (you have ${myCoins.toLocaleString()})`;
    return;
  }
  const oppGC = await getDoc(doc(db,'goatcoin',_selectedOpp.uid));
  const oppCoins = oppGC.exists() ? Math.floor(oppGC.data().coins||0) : 0;
  if(maxLoss > oppCoins) {
    if(err) err.textContent=`${_selectedOpp.username} doesn't have enough GC (they have ${oppCoins.toLocaleString()}, need ${maxLoss.toLocaleString()})`;
    return;
  }

  if(_mpChallengeId) {
    await updateDoc(doc(db,'bj_challenges',_mpChallengeId),{status:'cancelled'}).catch(()=>{});
    _mpChallengeId=null;
  }

  const ref = await addDoc(collection(db,'bj_challenges'), {
    fromUid: _gcUser.uid,
    fromUsername: _gcData?.username||'',
    fromColor: _gcData?.color||avatarColor(_gcUser.uid),
    fromIcon: _gcData?.icon||'',
    toUid: _selectedOpp.uid,
    toUsername: _selectedOpp.username,
    stake, bestOf,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  _mpChallengeId = ref.id;
  _mpChalOpp = _selectedOpp;
  _mpChalStake = stake; _mpChalBestOf = bestOf;
  toast(`Challenge sent to ${_selectedOpp.username}!`,'success');
  _showWaitingState(_selectedOpp, stake, bestOf);

  if(_mpChalUnsub2) _mpChalUnsub2();
  _mpChalUnsub2 = onSnapshot(doc(db,'bj_challenges',ref.id), snap => {
    if(!snap.exists()) { _mpChalUnsub2?.(); return; }
    const data = snap.data();
    if(data.status==='accepted'&&data.gameId) {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null;
      _joinGame(data.gameId,'p1');
    } else if(data.status==='declined') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null;
      toast(`${_selectedOpp?.username||'Opponent'} declined`,'warning'); _renderTab();
    } else if(data.status==='cancelled') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null; _renderTab();
    }
  });
}

function _showWaitingState(opp, stake, bestOf) {
  const col = document.getElementById('gc-bj-col');
  if(!col) return;
  col.innerHTML = `
    <div class="bj-lobby-card bj-waiting-card">
      <div class="bj-waiting-header">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Challenge Sent</span>
      </div>
      <div class="bj-waiting-opps">
        <div class="bj-waiting-opp" style="background:${opp.color||avatarColor(opp.uid)}">${avatarHtml(opp.icon||'',opp.username,'55%')}</div>
      </div>
      <div class="bj-waiting-text">Waiting for <strong>${escHtml(opp.username)}</strong> to acceptâ€¦</div>
      <div class="bj-waiting-meta">${stake} GC per round Â· Best of ${bestOf}</div>
      <button class="btn btn-ghost btn-sm" id="bj-cancel-challenge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Cancel
      </button>
    </div>`;
  document.getElementById('bj-cancel-challenge')?.addEventListener('click', _cancelChallenge);
}

function _restoreWaitingState() {
  if(!_mpChallengeId || !_mpChalOpp) return;
  _showWaitingState(_mpChalOpp, _mpChalStake, _mpChalBestOf);
  if(_mpChalUnsub2) _mpChalUnsub2();
  _mpChalUnsub2 = onSnapshot(doc(db,'bj_challenges',_mpChallengeId), snap => {
    if(!snap.exists()) { _mpChalUnsub2?.(); return; }
    const data = snap.data();
    if(data.status==='accepted'&&data.gameId) {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null;
      _joinGame(data.gameId,'p1');
    } else if(data.status==='declined') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null;
      toast('Challenge declined','warning'); _renderTab();
    } else if(data.status==='cancelled') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp=null; _renderTab();
    }
  });
}

async function _cancelChallenge() {
  if(!_mpChallengeId) return;
  await updateDoc(doc(db,'bj_challenges',_mpChallengeId),{status:'cancelled'}).catch(()=>{});
  _mpChallengeId=null; _mpChalOpp=null; _mpChalStake=0; _selectedOpp=null; _renderTab();
}

function _updateBJNavBadge() {
  const incomingCount = _cachedIncoming.length;
  const yourTurn = _mpGame && _mpGameId && (
    (_mpGame.phase==='p1turn' && _myRole==='p1') ||
    (_mpGame.phase==='p2turn' && _myRole==='p2') ||
    (_mpGame.phase==='roundDone' && _myRole==='p1')
  );
  const total = incomingCount + (yourTurn ? 1 : 0);
  let badge = document.getElementById('bj-nav-badge');
  if(!badge) {
    const navItem = document.querySelector('[data-section="goatcoin"]');
    if(navItem) {
      badge = document.createElement('span');
      badge.id = 'bj-nav-badge';
      badge.className = 'snav-badge';
      navItem.appendChild(badge);
    }
  }
  if(badge) {
    if(total > 0) { badge.textContent = total; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  }
}

function _listenIncomingChallenges() {
  if(_mpChalUnsub) _mpChalUnsub();
  _mpChalUnsub = onSnapshot(
    query(collection(db,'bj_challenges'), where('toUid','==',_gcUser.uid), where('status','==','pending')),
    snap => {
      _cachedIncoming = snap.docs.map(d=>({id:d.id,...d.data()}));
      _renderPendingChallenges(_cachedIncoming);
      _updateBJNavBadge();
    }
  );
}

async function _fetchIncomingNow() {
  if(!_gcUser) return;
  try {
    const snap = await getDocs(
      query(collection(db,'bj_challenges'), where('toUid','==',_gcUser.uid), where('status','==','pending'))
    );
    const fresh = snap.docs.map(d=>({id:d.id,...d.data()}));
    const ids = arr => arr.map(c=>c.id).sort().join(',');
    if(ids(fresh) !== ids(_cachedIncoming)) {
      _cachedIncoming = fresh;
      _renderPendingChallenges(_cachedIncoming);
    }
  } catch(e) {}
}

function _renderPendingChallenges(challenges) {
  if(challenges) _cachedIncoming = challenges;
  const el = document.getElementById('bj-pending-section');
  if(!el||!challenges?.length) { if(el) el.innerHTML=''; return; }
  el.innerHTML = `<div class="bj-incoming-hdr">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      Incoming Challenges
    </div>
    ${challenges.map(c=>`
      <div class="bj-challenge-row" data-cid="${c.id}">
        <div class="bj-sr-ava bj-mystery-ava">?</div>
        <div class="bj-chal-info">
          <span class="bj-chal-from bj-mystery-name">Someone challenges you</span>
          <span class="bj-chal-meta">${c.stake} GC/round Â· Best of ${c.bestOf} Â· <span style="color:var(--warn);font-weight:700">Identity hidden until accepted</span></span>
        </div>
        <button class="ta-btn ta-green bj-accept-btn" data-cid="${c.id}">Accept</button>
        <button class="ta-btn ta-red bj-decline-btn" data-cid="${c.id}">Decline</button>
      </div>`).join('')}`;
  el.querySelectorAll('.bj-accept-btn').forEach(btn=>btn.addEventListener('click',()=>_acceptChallenge(btn.dataset.cid)));
  el.querySelectorAll('.bj-decline-btn').forEach(btn=>btn.addEventListener('click',()=>_declineChallenge(btn.dataset.cid)));
}

async function _acceptChallenge(cid) {
  const snap = await getDoc(doc(db,'bj_challenges',cid));
  if(!snap.exists()||snap.data().status!=='pending') { toast('Challenge expired','warning'); return; }
  const c = snap.data();
  const maxLoss = (c.stake||0) * Math.ceil((c.bestOf||1)/2);
  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  if(!_gcData || myCoins < maxLoss) {
    toast(`Not enough GC â€” need ${maxLoss.toLocaleString()} to cover worst-case losses`, 'error');
    return;
  }
  const senderGC = await getDoc(doc(db,'goatcoin',c.fromUid));
  const senderCoins = senderGC.exists() ? Math.floor(senderGC.data().coins||0) : 0;
  if(senderCoins < maxLoss) {
    toast('Challenger no longer has enough GC', 'warning');
    await updateDoc(doc(db,'bj_challenges',cid),{status:'cancelled'}).catch(()=>{});
    return;
  }

  // Create game in RTDB for fast, cheap updates
  const deck = _newDeck();
  const gameId = `bj_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const gameData = {
    p1uid: c.fromUid, p1name: c.fromUsername, p1color: c.fromColor||avatarColor(c.fromUid), p1icon: c.fromIcon||'',
    p2uid: _gcUser.uid, p2name: _gcData?.username||'', p2color: _gcData?.color||avatarColor(_gcUser.uid), p2icon: _gcData?.icon||'',
    stake: c.stake, bestOf: c.bestOf,
    scores: {p1:0, p2:0}, currentRound: 1,
    deck: _deckToStr(deck), p1hand: '', p2hand: '', dealerHand: '',
    phase: 'dealing', p1action: '', p2action: '',
    p1double: false, p2double: false,
    winner: '', roundResults: JSON.stringify([]),
    createdAt: Date.now(), updatedAt: Date.now()
  };

  if(_rtdb) {
    await rtSet(rtRef(_rtdb, `bj_games/${gameId}`), gameData);
  } else {
    // Fallback to Firestore if RTDB unavailable
    const fsRef = await addDoc(collection(db,'bj_games'), {...gameData, createdAt: serverTimestamp()});
    await updateDoc(doc(db,'bj_challenges',cid), {status:'accepted', gameId: fsRef.id});
    await _dealRound(fsRef.id, false);
    _joinGame(fsRef.id, 'p2', false);
    setTimeout(() => deleteDoc(doc(db,'bj_challenges',cid)).catch(()=>{}), 5000);
    return;
  }

  await updateDoc(doc(db,'bj_challenges',cid), {status:'accepted', gameId});
  await _dealRound(gameId, true);
  _joinGame(gameId, 'p2', true);
  setTimeout(() => deleteDoc(doc(db,'bj_challenges',cid)).catch(()=>{}), 5000);
}

async function _declineChallenge(cid) {
  await deleteDoc(doc(db,'bj_challenges',cid)).catch(()=>{});
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  GAME LOGIC â€” RTDB-backed
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function _getGame(gameId, useRTDB) {
  if(useRTDB && _rtdb) {
    const snap = await rtGet(rtRef(_rtdb, `bj_games/${gameId}`));
    return snap.val();
  } else {
    const snap = await getDoc(doc(db,'bj_games',gameId));
    return snap.exists() ? snap.data() : null;
  }
}

async function _updateGame(gameId, useRTDB, updates) {
  updates.updatedAt = Date.now();
  if(useRTDB && _rtdb) {
    await rtUpdate(rtRef(_rtdb, `bj_games/${gameId}`), updates);
  } else {
    await updateDoc(doc(db,'bj_games',gameId), updates);
  }
}

async function _dealRound(gameId, useRTDB) {
  const g = await _getGame(gameId, useRTDB);
  if(!g) return;
  const deck = _strToDeck(g.deck);
  const p1h=[deck.pop(),deck.pop()], p2h=[deck.pop(),deck.pop()], dh=[deck.pop(),deck.pop()];
  await _updateGame(gameId, useRTDB, {
    deck: _deckToStr(deck),
    p1hand: _handToStr(p1h),
    p2hand: _handToStr(p2h),
    dealerHand: _handToStr(dh),
    phase: 'p1turn', p1action: '', p2action: '',
    p1double: false, p2double: false,
  });
}

let _useRTDB = true;

function _joinGame(gameId, role, useRtdb=true) {
  _mpGameId=gameId; _myRole=role; _useRTDB=useRtdb;
  if(_mpGameUnsub) { _mpGameUnsub(); _mpGameUnsub=null; }

  if(useRtdb && _rtdb) {
    const off = onValue(rtRef(_rtdb, `bj_games/${gameId}`), snap => {
      if(!snap.val()) { _leaveGame(); return; }
      _mpGame = snap.val();
      // Normalize hand fields
      _mpGame.p1hand = _strToHand(_mpGame.p1hand||'');
      _mpGame.p2hand = _strToHand(_mpGame.p2hand||'');
      _mpGame.dealerHand = _strToHand(_mpGame.dealerHand||'');
      _mpGame.roundResults = typeof _mpGame.roundResults === 'string' ? JSON.parse(_mpGame.roundResults||'[]') : (_mpGame.roundResults||[]);
      _mpGame.scores = _mpGame.scores || {p1:0,p2:0};
      if(_mpGame.phase==='dealer'&&_myRole==='p1') _resolveRound();
      else _renderBJTable();
    });
    _mpGameUnsub = () => off();
  } else {
    const unsub = onSnapshot(doc(db,'bj_games',gameId), snap => {
      if(!snap.exists()) { _leaveGame(); return; }
      _mpGame = snap.data();
      if(_mpGame.phase==='dealer'&&_myRole==='p1') _resolveRound();
      else _renderBJTable();
    });
    _mpGameUnsub = unsub;
  }

  // Navigate to goatcoin tab
  document.querySelectorAll('[data-section="goatcoin"]').forEach(el=>el.click());
}

function _leaveGame() {
  if(_mpGameUnsub) { _mpGameUnsub(); _mpGameUnsub=null; }
  document.getElementById('bj-fullscreen-overlay')?.remove();
  if(_mpGameId && _mpGame?.phase === 'gameDone') {
    if(_useRTDB && _rtdb) rtRemove(rtRef(_rtdb,`bj_games/${_mpGameId}`)).catch(()=>{});
    else deleteDoc(doc(db,'bj_games',_mpGameId)).catch(()=>{});
  }
  _mpGameId=null; _mpGame=null; _myRole=null;
  _renderTab();
}

export async function bjHit() {
  if(!_mpGame||!_mpGameId) return;
  const g = _mpGame;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  if(g.phase!==myPhase) return;
  const deck = _strToDeck(typeof g.deck==='string'?g.deck:'');
  const currentHand = Array.isArray(g[`${_myRole}hand`]) ? g[`${_myRole}hand`] : [];
  const hand = [...currentHand, deck.pop()];
  const total = _handTotal(hand);
  const updates = {[`${_myRole}hand`]: _handToStr(hand), deck: _deckToStr(deck)};
  if(total>=21) {
    updates[`${_myRole}action`]='stand';
    updates.phase = _myRole==='p1'?'p2turn':'dealer';
  }
  await _updateGame(_mpGameId, _useRTDB, updates);
}

export async function bjStand() {
  if(!_mpGame||!_mpGameId) return;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  if(_mpGame.phase!==myPhase) return;
  await _updateGame(_mpGameId, _useRTDB, {
    [`${_myRole}action`]: 'stand',
    phase: _myRole==='p1'?'p2turn':'dealer',
  });
}

export async function bjDouble() {
  if(!_mpGame||!_mpGameId) return;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  const myHand = Array.isArray(_mpGame[`${_myRole}hand`]) ? _mpGame[`${_myRole}hand`] : [];
  if(_mpGame.phase!==myPhase||myHand.length!==2) return;
  const deck = _strToDeck(typeof _mpGame.deck==='string'?_mpGame.deck:'');
  const hand = [...myHand, deck.pop()];
  await _updateGame(_mpGameId, _useRTDB, {
    [`${_myRole}hand`]: _handToStr(hand),
    [`${_myRole}double`]: true,
    deck: _deckToStr(deck),
    [`${_myRole}action`]: 'stand',
    phase: _myRole==='p1'?'p2turn':'dealer',
  });
}

async function _resolveRound() {
  const g = _mpGame;
  if(!g||g.phase!=='dealer'||_myRole!=='p1') return;
  const deck = _strToDeck(typeof g.deck==='string'?g.deck:'');
  const dealerHand = Array.isArray(g.dealerHand) ? [...g.dealerHand] : [];
  while(_handTotal(dealerHand)<17) dealerHand.push(deck.pop());

  const dt=_handTotal(dealerHand);
  const p1h = Array.isArray(g.p1hand) ? g.p1hand : [];
  const p2h = Array.isArray(g.p2hand) ? g.p2hand : [];
  const p1t=_handTotal(p1h), p2t=_handTotal(p2h);

  // 1v1: whoever is closer to 21 without busting wins the round
  // If both bust, neither wins. If tied, push.
  const p1bust = p1t>21, p2bust = p2t>21;
  let p1rs=0, p2rs=0;
  if(p1bust && p2bust) { /* nobody */ }
  else if(p1bust) { p2rs=1; }
  else if(p2bust) { p1rs=1; }
  else if(p1t > p2t) { p1rs=1; }
  else if(p2t > p1t) { p2rs=1; }
  // tie = no points

  const newScores={p1:(g.scores?.p1||0)+p1rs, p2:(g.scores?.p2||0)+p2rs};
  const prevResults = Array.isArray(g.roundResults) ? g.roundResults : [];
  const roundResults=[...prevResults, {
    round: g.currentRound||1,
    p1:{hand:p1h, total:p1t, bust:p1bust, result:p1rs>0?'win':p1bust?'bust':'lose'},
    p2:{hand:p2h, total:p2t, bust:p2bust, result:p2rs>0?'win':p2bust?'bust':'lose'},
    dealer:{hand:dealerHand, total:dt}
  }];

  const bestOf=g.bestOf||3, winsNeeded=Math.ceil(bestOf/2);
  const currentRound = g.currentRound||1;
  const p1Won = newScores.p1 >= winsNeeded;
  const p2Won = newScores.p2 >= winsNeeded;
  const maxRoundsReached = currentRound >= bestOf;
  const isTied = newScores.p1 === newScores.p2;
  const gameOver = p1Won || p2Won || (maxRoundsReached && !isTied);
  const winner = gameOver
    ? (newScores.p1 > newScores.p2 ? 'p1' : newScores.p2 > newScores.p1 ? 'p2' : '')
    : '';

  await _updateGame(_mpGameId, _useRTDB, {
    dealerHand: _handToStr(dealerHand),
    deck: _deckToStr(deck),
    scores: newScores,
    roundResults: JSON.stringify(roundResults),
    phase: gameOver ? 'gameDone' : 'roundDone',
    winner: winner,
    p1double: false, p2double: false,
  });

  if(gameOver && winner) {
    const winnerUid = winner==='p1'?g.p1uid:g.p2uid;
    const loserUid = winner==='p1'?g.p2uid:g.p1uid;
    const totalWins = winner==='p1'?newScores.p1:newScores.p2;
    const totalLosses = winner==='p1'?newScores.p2:newScores.p1;
    const netDelta = (totalWins - totalLosses) * (g.stake||0);
    if(netDelta > 0) {
      await updateDoc(doc(db,'goatcoin',winnerUid),{coins:increment(netDelta),weekCoins:increment(netDelta),totalCoins:increment(netDelta)}).catch(()=>{});
      await updateDoc(doc(db,'goatcoin',loserUid),{coins:increment(-netDelta),weekCoins:increment(-netDelta),totalCoins:increment(-netDelta)}).catch(()=>{});
      await updateDoc(doc(db,'goatcoin',winnerUid),{weekBJWins:increment(1),totalBJWins:increment(1)}).catch(()=>{});
    }
  }
  _renderBJTable();
}

export async function bjNextRound() {
  if(!_mpGameId||!_mpGame) return;
  const g = _mpGame;
  if((g.phase!=='roundDone' && !(g.phase==='gameDone'&&!g.winner))||_myRole!=='p1') return;
  const deck = _newDeck();
  const p1h=[deck.pop(),deck.pop()], p2h=[deck.pop(),deck.pop()], dh=[deck.pop(),deck.pop()];
  await _updateGame(_mpGameId, _useRTDB, {
    deck: _deckToStr(deck),
    p1hand: _handToStr(p1h),
    p2hand: _handToStr(p2h),
    dealerHand: _handToStr(dh),
    phase: 'p1turn', p1action: '', p2action: '',
    p1double: false, p2double: false,
    winner: '',
    currentRound: (g.currentRound||1)+1,
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  BJ TABLE UI
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function _getBJContainer() {
  let ov = document.getElementById('bj-fullscreen-overlay');
  if(!ov) {
    ov = document.createElement('div');
    ov.id = 'bj-fullscreen-overlay';
    ov.className = 'bj-fullscreen-overlay';
    document.body.appendChild(ov);
  }
  return ov;
}

function _renderBJTable() {
  const panel = _getBJContainer();
  if(!panel) return;
  const g = _mpGame;
  if(!g) return;

  const myH=Array.isArray(g[`${_myRole}hand`])?g[`${_myRole}hand`]:[];
  const oppRole=_myRole==='p1'?'p2':'p1';
  const oppH=Array.isArray(g[`${oppRole}hand`])?g[`${oppRole}hand`]:[];
  const myName=g[`${_myRole}name`]||'You', oppName=g[`${oppRole}name`]||'Opponent';
  const myColor=g[`${_myRole}color`]||'var(--accent)', oppColor=g[`${oppRole}color`]||'var(--text-muted)';
  const myIcon=g[`${_myRole}icon`]||'', oppIcon=g[`${oppRole}icon`]||'';
  const myTotal=_handTotal(myH), oppTotal=_handTotal(oppH);
  const phase=g.phase;
  const myTurn=(phase==='p1turn'&&_myRole==='p1')||(phase==='p2turn'&&_myRole==='p2');
  const done=['dealer','roundDone','gameDone'].includes(phase);
  const scores=g.scores||{p1:0,p2:0};
  const dh=Array.isArray(g.dealerHand)?g.dealerHand:[];

  let roundMsg='', gameOverMsg='';
  if(done) {
    const rr = Array.isArray(g.roundResults) ? g.roundResults : [];
    const lr=rr.slice(-1)[0];
    if(lr) {
      const mr=lr[_myRole]?.result, or=lr[oppRole]?.result;
      const resultIcon = (r) => r==='win'?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4H4v7a8 8 0 0016 0V4h-3"/><path d="M7 4h10"/></svg>':r==='bust'?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>':'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      roundMsg=`<div class="bj-round-result">
        <span>You: ${resultIcon(mr)} ${mr}</span>
        <span>${escHtml(oppName)}: ${resultIcon(or)} ${or}</span>
      </div>`;
    }
  }
  if(phase==='gameDone') {
    const w=g.winner;
    gameOverMsg = !w
      ? `<div class="bj-result bj-result-push">Tiebreaker round needed!</div>`
      : w===_myRole
        ? `<div class="bj-result bj-result-win">You won the series! GC transferred.</div>`
        : `<div class="bj-result bj-result-lose">${escHtml(oppName)} won this one. Better luck next time.</div>`;
  }

  panel.innerHTML = `
  <div class="bj-fullscreen-inner">
    <div class="bj-fullscreen-topbar">
      <span class="bj-fs-title">1v1 Blackjack</span>
      <button class="bj-fs-close" id="bj-fs-close">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Leave
      </button>
    </div>
    <div class="bj-mp-table">
      <div class="bj-mp-header">
        <div class="bj-mp-scores">
          <div class="bj-mp-player">
            <div class="bj-mp-ava" style="background:${myColor}">${avatarHtml(myIcon,myName,'60%')}</div>
            <span>${escHtml(myName)} (You)</span>
            <span class="bj-mp-score">${scores[_myRole]||0}</span>
          </div>
          <div class="bj-mp-vs">vs Â· Round ${g.currentRound||1} of ${g.bestOf||3} Â· ${g.stake}GC/rd</div>
          <div class="bj-mp-player">
            <div class="bj-mp-ava" style="background:${oppColor}">${avatarHtml(oppIcon,oppName,'60%')}</div>
            <span>${escHtml(oppName)}</span>
            <span class="bj-mp-score">${scores[oppRole]||0}</span>
          </div>
        </div>
      </div>
      <div class="bj-mp-area">
        <div class="bj-sides-row bj-sides-row-full">
          <div class="bj-side bj-my-side ${myTurn?'bj-active-side':''}">
            <div class="bj-side-label">
              You <span class="bj-total ${myTotal>21?'bust':''}">${myH.length?myTotal:'â€”'}</span>
              ${myTurn?'<span class="bj-your-turn-badge">your move</span>':''}
            </div>
            <div class="bj-hand">${myH.map(c=>_renderCard(c)).join('')}</div>
          </div>
          <div class="bj-side bj-opp-side">
            <div class="bj-side-label">
              ${escHtml(oppName)}
              ${done?`<span class="bj-total ${oppTotal>21?'bust':''}">${oppH.length?oppTotal:'â€”'}</span>`:'<span class="bj-total">?</span>'}
              ${phase===`${oppRole}turn`?'<span class="bj-their-turn-badge">thinkingâ€¦</span>':''}
            </div>
            <div class="bj-hand">${done?oppH.map(c=>_renderCard(c)).join(''):oppH.map(()=>_renderCard(null,true)).join('')}</div>
          </div>
        </div>
        ${done&&dh.length ? `<div class="bj-dealer-reveal">Reference hand: <span class="bj-total ${_handTotal(dh)>21?'bust':''}">${_handTotal(dh)}</span> <span class="bj-dealer-cards">${dh.map(c=>_renderCard(c)).join('')}</span></div>` : ''}
        ${roundMsg}${gameOverMsg}
        <div class="bj-mp-actions">
          ${myTurn&&phase!=='gameDone'?`
            <button class="btn bj-btn" id="bj-mp-hit">Hit</button>
            <button class="btn bj-btn" id="bj-mp-stand">Stand</button>
            ${myH.length===2&&Math.floor(_gcData?.coins||0)>=(g.stake||0)*2?'<button class="btn bj-btn bj-double" id="bj-mp-double">Double Down</button>':''}
          `:''}
          ${phase==='roundDone'?(_myRole==='p1'?'<button class="btn bj-btn" id="bj-mp-next">Next Round</button>':`<div class="bj-wait-msg">${escHtml(g.p1name)} is dealing next roundâ€¦</div>`):''}
          ${phase==='gameDone'&&g.winner?'<button class="btn btn-ghost bj-btn" id="bj-mp-leave">Back to Lobby</button>':''}
          ${phase==='gameDone'&&!g.winner?(_myRole==='p1'?'<button class="btn bj-btn" id="bj-mp-next">Tiebreaker Round</button>':`<div class="bj-wait-msg">${escHtml(g.p1name)} is starting the tiebreakerâ€¦</div>`):''}
          ${phase==='p1turn'&&_myRole==='p2'?`<div class="bj-wait-msg">${escHtml(g.p1name)} is taking their turnâ€¦</div>`:''}
          ${phase==='p2turn'&&_myRole==='p1'?`<div class="bj-wait-msg">${escHtml(g.p2name)} is taking their turnâ€¦</div>`:''}
          ${phase==='dealer'?'<div class="bj-wait-msg">Resolving roundâ€¦</div>':''}
          ${phase==='dealing'?'<div class="bj-wait-msg">Dealing cardsâ€¦</div>':''}
        </div>
      </div>
    </div>
  </div>`;

  _updateBJNavBadge();
  document.getElementById('bj-mp-hit')?.addEventListener('click', bjHit);
  document.getElementById('bj-mp-stand')?.addEventListener('click', bjStand);
  document.getElementById('bj-mp-double')?.addEventListener('click', bjDouble);
  document.getElementById('bj-mp-next')?.addEventListener('click', bjNextRound);
  document.getElementById('bj-mp-leave')?.addEventListener('click', _leaveGame);
  document.getElementById('bj-fs-close')?.addEventListener('click', _leaveGame);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  CARD UTILS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SUITS=['â™ ','â™¥','â™¦','â™£'], VALUES=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function _newDeck() {
  const deck=[];
  for(const s of SUITS) for(const v of VALUES) deck.push({s,v});
  for(let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
function _deckToStr(deck) { return deck.map(c=>`${c.v}${c.s}`).join(','); }
function _handToStr(hand) { return hand.map(c=>`${c.v}${c.s}`).join(','); }
function _strToDeck(str) {
  if(!str) return _newDeck();
  return str.split(',').filter(Boolean).map(s=>({v:s.slice(0,-1),s:s.slice(-1)}));
}
function _strToHand(str) {
  if(!str) return [];
  return str.split(',').filter(Boolean).map(s=>({v:s.slice(0,-1),s:s.slice(-1)}));
}
function _cardValue(c) { if(['J','Q','K'].includes(c.v)) return 10; if(c.v==='A') return 11; return parseInt(c.v)||0; }
function _handTotal(hand) {
  if(!hand||!hand.length) return 0;
  let t=0,a=0;
  for(const c of hand){t+=_cardValue(c);if(c.v==='A')a++;}
  while(t>21&&a>0){t-=10;a--;}
  return t;
}
function _renderCard(card,hidden=false) {
  if(hidden||!card) return '<div class="bj-card bj-hidden"><span>?</span></div>';
  const red=card.s==='â™¥'||card.s==='â™¦';
  return `<div class="bj-card${red?' red':''}"><span class="bj-cv">${card.v}</span><span class="bj-cs">${card.s}</span></div>`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  LEADERBOARD
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function _renderLeaderboard() {
  const el=document.getElementById('gc-leaderboard-content');
  if(!el) return;
  el.innerHTML='<div style="color:var(--text-faint);font-size:.78rem;padding:.5rem 0">Loadingâ€¦</div>';
  try {
    const [gcSnap,usersSnap]=await Promise.all([
      getDocs(collection(db,'goatcoin')),
      getDocs(collection(db,'users'))
    ]);
    const userMap={};
    usersSnap.docs.forEach(d=>{userMap[d.id]=d.data();});

    const rows=gcSnap.docs.map(d=>{
      const gc=d.data(),u=userMap[d.id]||{};
      return {
        uid:d.id, username:u.username||'Unknown',
        color:u.color||avatarColor(d.id), icon:u.icon||'', rank:u.rank||'planetary',
        coins:Math.floor(gc.coins||0), weekCoins:Math.floor(gc.weekCoins||0),
        totalCoins:Math.floor(gc.totalCoins||0), weekChatMins:Math.floor(gc.weekChatMins||0),
        weekGameMins:Math.floor(gc.weekGameMins||0), weekBJWins:Math.floor(gc.weekBJWins||0),
        totalBJWins:Math.floor(gc.totalBJWins||0)
      };
    }).filter(r=>userMap[r.uid]?.status==='approved');

    const tabs=[
      {key:'weekCoins',   label:'Week GC',    fmt:(v)=>`${v.toLocaleString()} GC`},
      {key:'coins',       label:'Balance',    fmt:(v)=>`${v.toLocaleString()} GC`},
      {key:'totalCoins',  label:'All-Time',   fmt:(v)=>`${v.toLocaleString()} GC`},
      {key:'weekBJWins',  label:'BJ Wins',    fmt:(v)=>`${v} wins`},
      {key:'weekChatMins',label:'Chat',       fmt:(v)=>_fmtMins(v)},
      {key:'weekGameMins',label:'Games',      fmt:(v)=>_fmtMins(v)},
    ];
    let activeTab='weekCoins';

    const render=()=>{
      const sorted=[...rows].sort((a,b)=>(b[activeTab]||0)-(a[activeTab]||0));
      const tabDef = tabs.find(t=>t.key===activeTab);
      const medals = ['<span class="lb-medal gold">#1</span>','<span class="lb-medal silver">#2</span>','<span class="lb-medal bronze">#3</span>'];
      el.innerHTML=`
        <div class="lb-tabs">
          ${tabs.map(t=>`<button class="lb-tab${t.key===activeTab?' active':''}" data-lbkey="${t.key}">${t.label}</button>`).join('')}
        </div>
        <div class="lb-table">
          ${sorted.slice(0,20).map((r,i)=>{
            const isMe = r.uid===_gcUser?.uid;
            const medal = medals[i] || `<span class="lb-rank-num">#${i+1}</span>`;
            const val = tabDef?.fmt(r[activeTab]||0) || 'â€”';
            return `<div class="lb-row${isMe?' lb-me':''}">
              <span class="lb-rank">${medal}</span>
              <div class="lb-ava" style="background:${r.color}">${avatarHtml(r.icon,r.username,'60%')}</div>
              <div class="lb-name-col">
                <span class="lb-name">${escHtml(r.username)}</span>
                <span class="rbadge ${r.rank}" style="font-size:.48rem">${r.rank}</span>
              </div>
              <span class="lb-val">${val}</span>
            </div>`;
          }).join('')}
          ${sorted.length===0?'<div class="gc-lb-loading">No data yet</div>':''}
        </div>`;
      el.querySelectorAll('.lb-tab').forEach(btn=>btn.addEventListener('click',()=>{activeTab=btn.dataset.lbkey;render();}));
    };
    render();
  } catch(e) {
    if(el) el.innerHTML='<div style="color:var(--danger);font-size:.75rem">Failed to load leaderboard</div>';
  }
}

function _fmtMins(mins) {
  if(!mins||mins<1) return '0m';
  if(mins<60) return `${mins}m`;
  const h=Math.floor(mins/60), m=mins%60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//  EXPORTS
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function getGoatCoins()    { return _gcData?Math.floor(_gcData.coins||0):0; }
export function getGoatCoinData() { return _gcData; }

export function cleanupGoatCoin() {
  if(_gcUnsub)     { _gcUnsub(); _gcUnsub=null; }
  if(_gcTimer)     { clearTimeout(_gcTimer); _gcTimer=null; }
  if(_mpGameUnsub) { _mpGameUnsub(); _mpGameUnsub=null; }
  if(_mpChalUnsub) { _mpChalUnsub(); _mpChalUnsub=null; }
  if(_mpChalUnsub2){ _mpChalUnsub2(); _mpChalUnsub2=null; }
}