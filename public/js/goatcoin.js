// ═══════════════════════════════════════════════════
//  goatcoin.js — GoatCoin currency, multiplayer blackjack,
//  leaderboard, weekly badge awards
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where,
  getDocs, onSnapshot, orderBy, limit, serverTimestamp, increment, addDoc, deleteDoc
} from './firebase.js';
import { toast, avatarColor, avatarInitial, escHtml, avatarHtml } from './app.js';

// ── Constants ──
const COIN_PER_MINUTE = 1;       // flat 1 gc/min everywhere
const COIN_TICK_MS    = 60_000;

// ── Module state ──
let _gcUser    = null;
let _gcData    = null;
let _gcUnsub   = null;
let _gcTimer   = null;
let _activity  = 'site'; // 'site' | 'chat' | 'game'

// Multiplayer BJ
let _mpGame        = null;
let _mpGameId      = null;
let _mpGameUnsub   = null;
let _mpChallengeId = null;
let _mpChalOpp1 = null; // persisted for waiting state restore
let _mpChalOpp2 = null;
let _mpChalStake = 0;
let _mpChalBestOf = 3;
let _mpChalUnsub2 = null; // outbound challenge watcher
let _cachedIncoming = []; // last known incoming challenges — survives tab switches
let _mpChalUnsub   = null;
let _myRole        = null; // 'p1' | 'p2'

// ──────────────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────────────
export function initGoatCoin(user, userData) {
  _gcUser = user;
  window._getGCData = () => _gcData;
  _gcData = null;
  _subscribeCoins();
  _startEarning();
  _listenIncomingChallenges();
  // Sweep stale docs in the background
  setTimeout(_cleanupStaleData, 3000);
}

async function _cleanupStaleData() {
  if(!_gcUser) return;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago

    // Delete challenges sent by or to this user that are no longer pending or are old
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

    // Delete finished games involving this user
    const [g1, g2] = await Promise.all([
      getDocs(query(collection(db,'bj_games'), where('p1uid','==',_gcUser.uid), where('phase','==','gameDone'))),
      getDocs(query(collection(db,'bj_games'), where('p2uid','==',_gcUser.uid), where('phase','==','gameDone')))
    ]);
    await Promise.all([...g1.docs, ...g2.docs].map(d => deleteDoc(d.ref).catch(()=>{})));

  } catch(e) { /* non-critical, runs silently */ }
}

export function setActivity(mode) {
  _activity = mode; // 'site' | 'chat' | 'game'
}

// ──────────────────────────────────────────────────
//  COINS
// ──────────────────────────────────────────────────
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

function _weekKey() {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
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
      if((data.weekCoins||0)   > topCoins.val) topCoins={uid:d.id,val:data.weekCoins||0};
      if((data.weekGameMins||0)> topGames.val) topGames={uid:d.id,val:data.weekGameMins||0};
      if((data.weekChatMins||0)> topChat.val)  topChat ={uid:d.id,val:data.weekChatMins||0};
      if((data.weekBJWins||0)  > topBJ.val)    topBJ   ={uid:d.id,val:data.weekBJWins||0};
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
  if(_gcTimer) clearInterval(_gcTimer);
  // Jitter ±15s to prevent predictable timing exploits
  function scheduleNext() {
    const jitter = (Math.random() * 30000) - 15000; // ±15s
    _gcTimer = setTimeout(async () => {
      await _earnTick();
      scheduleNext();
    }, COIN_TICK_MS + jitter);
  }
  scheduleNext();
}

// Track user activity — only real interactions count
let _lastActivity = Date.now();
let _interactionCount = 0; // require N interactions before earning starts
const _IDLE_MS = 3 * 60 * 1000; // 3 min idle = stop earning (tightened from 5)
const _MIN_INTERACTIONS = 3;    // need at least 3 real interactions per session

// Only meaningful events reset idle (excludes scroll which can be automated)
['mousedown','keydown','touchstart','click'].forEach(ev => {
  document.addEventListener(ev, () => {
    _lastActivity = Date.now();
    _interactionCount = Math.min(_interactionCount + 1, _MIN_INTERACTIONS + 1);
  }, {passive:true});
});

async function _earnTick() {
  if(!_gcUser || !_gcData || document.hidden) return;
  if(Date.now() - _lastActivity > _IDLE_MS) return; // idle
  if(_interactionCount < _MIN_INTERACTIONS) return; // hasn't interacted enough yet
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
  // Re-render stats row if tab is visible; full re-render only if no live game
  if(container.classList.contains('active')) {
    if(_mpGameId) {
      const balEl = document.getElementById('gc-bal-display');
      if(balEl) balEl.textContent = (_gcData ? Math.floor(_gcData.coins||0) : 0).toLocaleString();
    } else {
      _renderTab();
    }
  }
}

// ──────────────────────────────────────────────────
//  TAB RENDER
// ──────────────────────────────────────────────────
export function renderGoatCoinTab() { _renderTab(); }

function _renderTab() {
  const container = document.getElementById('section-goatcoin');
  if(!container) return;
  const coins  = _gcData ? Math.floor(_gcData.coins||0) : 0;
  const wCoins = _gcData ? Math.floor(_gcData.weekCoins||0) : 0;
  const wChat  = _gcData ? Math.floor(_gcData.weekChatMins||0) : 0;
  const wGame  = _gcData ? Math.floor(_gcData.weekGameMins||0) : 0;

  container.innerHTML = `
    <div class="pad gc-page">

      <div class="gc-header-row">
        <div>
          <div class="pg-title">GoatCoin</div>
          <div class="pg-sub">earn coins for being here, bet them in blackjack, climb the weekly board.</div>
        </div>
        <div class="gc-balance-badge">
          <div class="gc-balance-num gc-balance" id="gc-bal-display">${coins.toLocaleString()}</div>
          <div class="gc-balance-tag">GC</div>
        </div>
      </div>

      <div class="settings-section-label">This Week</div>
      <div class="gc-stats-row">
        <div class="notif-section-card gc-stat-card">
          <div class="gc-stat-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div>
          <div class="gc-stat-val">${wCoins.toLocaleString()}</div>
          <div class="gc-stat-label">Coins Earned</div>
        </div>
        <div class="notif-section-card gc-stat-card">
          <div class="gc-stat-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
          <div class="gc-stat-val">${wChat}m</div>
          <div class="gc-stat-label">Chat Time</div>
        </div>
        <div class="notif-section-card gc-stat-card">
          <div class="gc-stat-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="12" y1="9" x2="12" y2="15"/></svg></div>
          <div class="gc-stat-val">${wGame}m</div>
          <div class="gc-stat-label">Game Time</div>
        </div>
      </div>

      <!-- Side by side: BJ left, Leaderboard right -->
      <div class="gc-main-layout">
        <div class="gc-bj-col" id="gc-bj-col">${_renderBJLobby()}</div>
        <div class="gc-lb-col">
          <div class="gc-lb-hdr">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
            Leaderboard
          </div>
          <div id="gc-leaderboard-content"><div class="gc-lb-loading">Loading…</div></div>
        </div>
      </div>
    </div>`;

  _wireBJLobby();
  _renderLeaderboard();
  if(_mpGameId && _mpGame) { _renderBJTable(); return; }
  // Restore outbound waiting state
  if(_mpChallengeId && _mpChalOpp1) _restoreWaitingState();
  // Replay cached incoming immediately (no blank flash on tab return)
  if(_cachedIncoming.length) _renderPendingChallenges(_cachedIncoming);
  // Fresh fetch to catch anything that arrived while tab was away
  _fetchIncomingNow();
}

// ──────────────────────────────────────────────────
//  LOBBY UI
// ──────────────────────────────────────────────────
function _renderBJLobby() {
  return `<div class="bj-lobby">
    <div class="bj-lobby-card">

      <div class="bj-lobby-intro">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M12 7v10M7 12h10"/></svg>
        <div>
          <div class="bj-lobby-title">Multiplayer Blackjack</div>
          <div class="bj-lobby-sub">pick up to 2 opponents, set your stake, and play. most round wins takes the pot.</div>
        </div>
      </div>

      <div class="bj-form-section">
        <div class="bj-form-label">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          Opponents (up to 2)
        </div>
        <div class="bj-opp-slots">
          <div class="bj-opp-slot" id="bj-opp-slot-1">
            <div class="bj-opp-search-wrap">
              <input class="bj-opp-inp" data-slot="1" type="text" placeholder="Search player 1..." autocomplete="off">
              <div class="bj-search-results hidden" id="bj-search-results-1"></div>
            </div>
            <div class="bj-selected-pill hidden" id="bj-selected-1"></div>
          </div>
          <div class="bj-opp-slot" id="bj-opp-slot-2">
            <div class="bj-opp-search-wrap">
              <input class="bj-opp-inp" data-slot="2" type="text" placeholder="Search player 2 (optional)..." autocomplete="off">
              <div class="bj-search-results hidden" id="bj-search-results-2"></div>
            </div>
            <div class="bj-selected-pill hidden" id="bj-selected-2"></div>
          </div>
        </div>
      </div>

      <div class="bj-form-row-inline">
        <div class="bj-form-section" style="flex:1">
          <div class="bj-form-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v2m0 8v2M9.5 9.5h3a1.5 1.5 0 010 3H10m0 0h2.5a1.5 1.5 0 010 3H9.5"/></svg>
            Stake per round (GC)
          </div>
          <div class="bj-chips-row">
            <button class="bj-chip" data-bet="10">10</button>
            <button class="bj-chip" data-bet="25">25</button>
            <button class="bj-chip" data-bet="50">50</button>
            <button class="bj-chip" data-bet="100">100</button>
            <button class="bj-chip" data-bet="250">250</button>
          </div>
          <input id="bj-stake-input" class="field-input" type="number" min="1" placeholder="Custom..." style="margin-top:.5rem;max-width:160px">
        </div>
        <div class="bj-form-section" style="flex:0 0 auto">
          <div class="bj-form-label">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
            Best of
          </div>
          <div class="bj-chips-row">
            <button class="bj-chip bj-bo-chip" data-bo="1">1</button>
            <button class="bj-chip bj-bo-chip active" data-bo="3">3</button>
            <button class="bj-chip bj-bo-chip" data-bo="5">5</button>
            <button class="bj-chip bj-bo-chip" data-bo="7">7</button>
          </div>
        </div>
      </div>

      <button class="btn bj-challenge-btn" id="bj-send-challenge">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
        Send Challenge
      </button>
      <div class="merr" id="bj-challenge-err"></div>
    </div>

    <div class="bj-pending-section" id="bj-pending-section"></div>
  </div>`;
}

// Track selected opponents per slot
const _selectedOpponents = {1: null, 2: null};

async function _updateStakeMax() {
  // Fetch all selected opponents' balances and cap the stake input
  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  let minCoins = myCoins;
  for(const opp of [_selectedOpponents[1], _selectedOpponents[2]].filter(Boolean)) {
    try {
      const snap = await getDoc(doc(db,'goatcoin',opp.uid));
      const c = snap.exists() ? Math.floor(snap.data().coins||0) : 0;
      if(c < minCoins) minCoins = c;
    } catch(e) {}
  }
  const stakeInp = document.getElementById('bj-stake-input');
  if(stakeInp) {
    stakeInp.max = minCoins;
    stakeInp.placeholder = `Max: ${minCoins.toLocaleString()} GC`;
    // If current value exceeds max, clamp it
    const cur = parseInt(stakeInp.value||'0');
    if(cur > minCoins) stakeInp.value = minCoins;
  }
  // Gray out chips that exceed the max
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

  // Wire each opponent search slot
  [1, 2].forEach(slot => {
    const inp = panel.querySelector(`.bj-opp-inp[data-slot="${slot}"]`);
    if(!inp) return;
    let t;
    inp.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => _searchOpponentsSlot(inp.value.trim(), slot), 250);
    });
    document.addEventListener('click', e => {
      if(!e.target.closest(`#bj-search-results-${slot}`) && !e.target.closest(`.bj-opp-inp[data-slot="${slot}"]`))
        document.getElementById(`bj-search-results-${slot}`)?.classList.add('hidden');
    }, {passive:true});
  });

  panel.querySelector('#bj-send-challenge')?.addEventListener('click', _sendChallengeMulti);
  _updateStakeMax();



  _renderPendingChallenges();
}

async function _searchOpponentsSlot(q, slot) {
  const resultsEl = document.getElementById(`bj-search-results-${slot}`);
  if(!resultsEl) return;
  if(!q) { resultsEl.innerHTML=''; resultsEl.classList.add('hidden'); return; }
  try {
    const snap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
    const otherSlot = slot === 1 ? 2 : 1;
    const otherUid = _selectedOpponents[otherSlot]?.uid;
    const users = snap.docs.map(d=>d.data())
      .filter(u => u.uid !== _gcUser.uid && u.uid !== otherUid && u.username?.toLowerCase().includes(q.toLowerCase()))
      .slice(0,8);
    if(!users.length) { resultsEl.innerHTML='<div class="bj-sr-empty">No users found</div>'; resultsEl.classList.remove('hidden'); return; }
    resultsEl.innerHTML = users.map(u => `
      <div class="bj-sr-item" data-uid="${u.uid}" data-username="${escHtml(u.username)}" data-color="${u.color||avatarColor(u.uid)}">
        <div class="bj-sr-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarHtml(u.icon,u.username,'60%')}</div>
        <span class="bj-sr-name">${escHtml(u.username)}</span>
        <span class="rbadge ${u.rank}" style="font-size:.55rem">${u.rank}</span>
      </div>`).join('');
    resultsEl.classList.remove('hidden');
    resultsEl.querySelectorAll('.bj-sr-item').forEach(item => {
      item.addEventListener('click', () => {
        _selectedOpponents[slot] = { uid:item.dataset.uid, username:item.dataset.username, color:item.dataset.color };
        const inp = document.querySelector(`.bj-opp-inp[data-slot="${slot}"]`);
        if(inp) inp.value = '';
        resultsEl.innerHTML=''; resultsEl.classList.add('hidden');
        const pill = document.getElementById(`bj-selected-${slot}`);
        if(pill) {
          pill.innerHTML = `
            <div class="bj-sr-ava" style="background:${_selectedOpponents[slot].color}">${avatarInitial(_selectedOpponents[slot].username)}</div>
            <span>${escHtml(_selectedOpponents[slot].username)}</span>
            <button class="bj-clear-btn" data-clear="${slot}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
          pill.classList.remove('hidden');
          pill.querySelector(`[data-clear="${slot}"]`)?.addEventListener('click', () => {
            _selectedOpponents[slot] = null;
            pill.classList.add('hidden');
            _updateStakeMax();
          });
          _updateStakeMax();
        }
      });
    });
  } catch(e) { console.error(e); }
}


async function _sendChallengeMulti() {
  const err = document.getElementById('bj-challenge-err');
  if(err) err.textContent='';
  const opp1 = _selectedOpponents[1];
  const opp2 = _selectedOpponents[2];
  if(!opp1) { if(err) err.textContent='Select at least one opponent'; return; }
  const stake = parseInt(document.getElementById('bj-stake-input')?.value||'0');
  if(!stake||stake<1) { if(err) err.textContent='Set a stake amount'; return; }
  const boBtn = document.querySelector('.bj-bo-chip.active');
  const bestOf = parseInt(boBtn?.dataset.bo||'3');

  // Gather all balances — stake must not exceed ANY player's balance
  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  const balances = [{ name:'You', coins: myCoins }];
  for(const opp of [opp1, opp2].filter(Boolean)) {
    const oppGC = await getDoc(doc(db,'goatcoin',opp.uid));
    const oppCoins = oppGC.exists() ? Math.floor(oppGC.data().coins||0) : 0;
    balances.push({ name: opp.username, coins: oppCoins });
  }
  const lowestBalance = Math.min(...balances.map(b=>b.coins));
  // Max a player can lose = stake * rounds needed to win series
  const maxLoss = stake * Math.ceil(bestOf/2);
  if(maxLoss > lowestBalance) {
    const poorest = balances.find(b=>b.coins===lowestBalance);
    if(err) err.textContent=`Stake too high — ${poorest.name} only has ${poorest.coins.toLocaleString()} GC (need ${maxLoss.toLocaleString()} to cover worst-case losses)`;
    return;
  }

  if(_mpChallengeId) {
    await updateDoc(doc(db,'bj_challenges',_mpChallengeId),{status:'cancelled'}).catch(()=>{});
    _mpChallengeId=null;
  }

  // Send challenge to opp1 (primary game partner)
  const _selectedOpponent = opp1;
  const ref = await addDoc(collection(db,'bj_challenges'), {
    fromUid: _gcUser.uid,
    fromUsername: _gcData?.username||'',
    fromColor: _gcData?.color||avatarColor(_gcUser.uid),
    toUid: opp1.uid,
    toUsername: opp1.username,
    toUid2: opp2?.uid||null,
    toUsername2: opp2?.username||null,
    stake, bestOf,
    status: 'pending',
    createdAt: serverTimestamp()
  });
  _mpChallengeId = ref.id;
  _mpChalOpp1 = opp1; _mpChalOpp2 = opp2||null;
  _mpChalStake = stake; _mpChalBestOf = bestOf;
  toast(`Challenge sent to ${opp1.username}${opp2?` & ${opp2.username}`:''}!`,'success');

  _showWaitingState(opp1, opp2, stake, bestOf);

  if(_mpChalUnsub2) _mpChalUnsub2();
  _mpChalUnsub2 = onSnapshot(doc(db,'bj_challenges',ref.id), snap => {
    if(!snap.exists()) { _mpChalUnsub2?.(); return; }
    const data = snap.data();
    if(data.status==='accepted'&&data.gameId) {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null;
      _joinGame(data.gameId,'p1');
    } else if(data.status==='declined') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null;
      toast(`${opp1?.username||'Opponent'} declined`,'warning'); _renderTab();
    } else if(data.status==='cancelled') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null; _renderTab();
    }
  });
}

function _showWaitingState(opp1, opp2, stake, bestOf) {
  const col = document.getElementById('gc-bj-col');
  if(!col) return;
  const names = [opp1.username, opp2?.username].filter(Boolean).map(n=>`<strong>${escHtml(n)}</strong>`).join(' & ');
  col.innerHTML = `
    <div class="bj-lobby-card bj-waiting-card">
      <div class="bj-waiting-header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>Challenge Sent</span>
      </div>
      <div class="bj-waiting-opps">
        <div class="bj-waiting-opp" style="background:${opp1.color||avatarColor(opp1.uid)}">${avatarHtml(opp1.icon,opp1.username,'55%')}</div>
        ${opp2 ? `<div class="bj-waiting-opp" style="background:${opp2.color||avatarColor(opp2.uid)}">${avatarHtml(opp2.icon,opp2.username,'55%')}</div>` : ''}
      </div>
      <div class="bj-waiting-text">Waiting for ${names} to accept…</div>
      <div class="bj-waiting-meta">${stake} GC per round · Best of ${bestOf}</div>
      <button class="btn btn-ghost btn-sm" id="bj-cancel-challenge">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Cancel Challenge
      </button>
    </div>`;
  document.getElementById('bj-cancel-challenge')?.addEventListener('click', _cancelChallenge);
}

function _restoreWaitingState() {
  if(!_mpChallengeId || !_mpChalOpp1) return;
  _showWaitingState(_mpChalOpp1, _mpChalOpp2, _mpChalStake, _mpChalBestOf);
  // Re-attach the snapshot watcher
  if(_mpChalUnsub2) _mpChalUnsub2();
  _mpChalUnsub2 = onSnapshot(doc(db,'bj_challenges',_mpChallengeId), snap => {
    if(!snap.exists()) { _mpChalUnsub2?.(); return; }
    const data = snap.data();
    if(data.status==='accepted'&&data.gameId) {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null;
      _joinGame(data.gameId,'p1');
    } else if(data.status==='declined') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null;
      toast('Challenge declined','warning'); _renderTab();
    } else if(data.status==='cancelled') {
      _mpChalUnsub2?.(); _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null;
      _renderTab();
    }
  });
}

async function _cancelChallenge() {
  if(!_mpChallengeId) return;
  await updateDoc(doc(db,'bj_challenges',_mpChallengeId),{status:'cancelled'}).catch(()=>{});
  _mpChallengeId=null; _mpChalOpp1=null; _mpChalOpp2=null; _mpChalStake=0; _renderTab();
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

// One-shot getDocs — used on tab return to catch any snapshots that fired while away
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
  } catch(e) { /* silent — persistent listener will recover */ }
}

function _renderPendingChallenges(challenges) {
  // Always update cache so re-renders on tab return have fresh data
  if(challenges) _cachedIncoming = challenges;
  const el = document.getElementById('bj-pending-section');
  if(!el||!challenges?.length) { if(el) el.innerHTML=''; return; }
  el.innerHTML = `<div class="bj-incoming-hdr">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      Incoming Challenges
    </div>
    ${challenges.map(c=>`
      <div class="bj-challenge-row" data-cid="${c.id}">
        <div class="bj-sr-ava bj-mystery-ava">?</div>
        <div class="bj-chal-info">
          <span class="bj-chal-from bj-mystery-name">Someone</span>
          <span class="bj-chal-meta">${c.stake} GC/round \u00B7 Best of ${c.bestOf} \u00B7 <span style="color:var(--warn);font-weight:700">Identity hidden until accepted</span></span>
        </div>
        <button class="ta-btn ta-green bj-accept-btn" data-cid="${c.id}" data-from="${escHtml(c.fromUsername)}" data-color="${c.fromColor||avatarColor(c.fromUid)}">Accept</button>
        <button class="ta-btn ta-red bj-decline-btn" data-cid="${c.id}">Decline</button>
      </div>`).join('')}`;
  el.querySelectorAll('.bj-accept-btn').forEach(btn=>btn.addEventListener('click',()=>_acceptChallenge(btn.dataset.cid)));
  el.querySelectorAll('.bj-decline-btn').forEach(btn=>btn.addEventListener('click',()=>_declineChallenge(btn.dataset.cid)));
}

async function _acceptChallenge(cid) {
  const snap = await getDoc(doc(db,'bj_challenges',cid));
  if(!snap.exists()||snap.data().status!=='pending') { toast('Challenge expired','warning'); return; }
  const c = snap.data();
  // Max you can lose = stake * rounds needed to win series (ceil(bestOf/2))
  const maxLoss = (c.stake||0) * Math.ceil((c.bestOf||1)/2);
  const myCoins = _gcData ? Math.floor(_gcData.coins||0) : 0;
  if(!_gcData || myCoins < maxLoss) {
    toast(`Not enough GC — need ${maxLoss.toLocaleString()} to cover worst-case losses (you have ${myCoins.toLocaleString()})`, 'error');
    return;
  }
  // Re-check sender still has enough too
  const senderGC = await getDoc(doc(db,'goatcoin',c.fromUid));
  const senderCoins = senderGC.exists() ? Math.floor(senderGC.data().coins||0) : 0;
  if(senderCoins < maxLoss) {
    toast('Challenger no longer has enough GC to cover this bet', 'warning');
    await updateDoc(doc(db,'bj_challenges',cid),{status:'cancelled'}).catch(()=>{});
    return;
  }
  const deck = _newDeck();
  const gameRef = await addDoc(collection(db,'bj_games'), {
    p1uid:c.fromUid, p1name:c.fromUsername, p1color:c.fromColor||avatarColor(c.fromUid),
    p2uid:_gcUser.uid, p2name:_gcData?.username||'', p2color:_gcData?.color||avatarColor(_gcUser.uid),
    stake:c.stake, bestOf:c.bestOf,
    scores:{p1:0,p2:0}, currentRound:1,
    deck:_deckToStr(deck), p1hand:[], p2hand:[], dealerHand:[],
    phase:'dealing', p1action:null, p2action:null,
    p1double:false, p2double:false,
    winner:null, roundResults:[],
    createdAt:serverTimestamp(), updatedAt:serverTimestamp()
  });
  // Store gameId briefly so challenger can join, then delete
  await updateDoc(doc(db,'bj_challenges',cid),{status:'accepted',gameId:gameRef.id});
  await _dealRound(gameRef.id);
  _joinGame(gameRef.id,'p2');
  // Clean up challenge doc after a short delay (challenger needs to read gameId first)
  setTimeout(() => deleteDoc(doc(db,'bj_challenges',cid)).catch(()=>{}), 5000);
}

async function _declineChallenge(cid) {
  await deleteDoc(doc(db,'bj_challenges',cid)).catch(()=>{});
}

// ──────────────────────────────────────────────────
//  GAME LOGIC
// ──────────────────────────────────────────────────
async function _dealRound(gameId) {
  const snap = await getDoc(doc(db,'bj_games',gameId));
  if(!snap.exists()) return;
  const deck = _strToDeck(snap.data().deck);
  await updateDoc(doc(db,'bj_games',gameId), {
    deck: _deckToStr(deck),
    p1hand: [deck.pop(),deck.pop()],
    p2hand: [deck.pop(),deck.pop()],
    dealerHand: [deck.pop(),deck.pop()],
    phase: 'p1turn', p1action:null, p2action:null,
    p1double:false, p2double:false,
    updatedAt: serverTimestamp()
  });
  // Need to save the modified deck after dealing
  const newDeck = [...deck];
  await updateDoc(doc(db,'bj_games',gameId), { deck:_deckToStr(newDeck) });
}

function _joinGame(gameId, role) {
  _mpGameId=gameId; _myRole=role;
  if(_mpGameUnsub) _mpGameUnsub();
  _mpGameUnsub = onSnapshot(doc(db,'bj_games',gameId), snap => {
    if(!snap.exists()) { _leaveGame(); return; }
    _mpGame = snap.data();
    // Only p1 drives dealer phase to avoid double-resolve
    if(_mpGame.phase==='dealer'&&_myRole==='p1') _resolveRound();
    else _renderBJTable();
  });
  document.querySelectorAll('[data-section="goatcoin"]').forEach(el=>el.click());
}

function _leaveGame() {
  if(_mpGameUnsub) { _mpGameUnsub(); _mpGameUnsub=null; }
  document.getElementById('bj-fullscreen-overlay')?.remove();
  // Delete finished game doc — no need to keep it
  if(_mpGameId && _mpGame?.phase === 'gameDone') {
    deleteDoc(doc(db,'bj_games',_mpGameId)).catch(()=>{});
  }
  _mpGameId=null; _mpGame=null; _myRole=null;
  _renderTab();
}

export async function bjHit() {
  if(!_mpGame||!_mpGameId) return;
  const g = _mpGame;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  if(g.phase!==myPhase) return;
  const deck = _strToDeck(g.deck);
  const hand = [...(g[`${_myRole}hand`]||[]), deck.pop()];
  const total = _handTotal(hand);
  const updates = {[`${_myRole}hand`]:hand, deck:_deckToStr(deck), updatedAt:serverTimestamp()};
  if(total>=21) {
    updates[`${_myRole}action`]='stand';
    updates.phase = _myRole==='p1'?'p2turn':'dealer';
  }
  await updateDoc(doc(db,'bj_games',_mpGameId), updates);
}

export async function bjStand() {
  if(!_mpGame||!_mpGameId) return;
  const g = _mpGame;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  if(g.phase!==myPhase) return;
  await updateDoc(doc(db,'bj_games',_mpGameId), {
    [`${_myRole}action`]:'stand',
    phase: _myRole==='p1'?'p2turn':'dealer',
    updatedAt: serverTimestamp()
  });
}

export async function bjDouble() {
  if(!_mpGame||!_mpGameId) return;
  const g = _mpGame;
  const myPhase = _myRole==='p1'?'p1turn':'p2turn';
  if(g.phase!==myPhase||(g[`${_myRole}hand`]||[]).length!==2) return;
  const deck = _strToDeck(g.deck);
  const hand = [...(g[`${_myRole}hand`]||[]), deck.pop()];
  await updateDoc(doc(db,'bj_games',_mpGameId), {
    [`${_myRole}hand`]:hand,
    [`${_myRole}double`]:true,
    deck:_deckToStr(deck),
    [`${_myRole}action`]:'stand',
    phase: _myRole==='p1'?'p2turn':'dealer',
    updatedAt: serverTimestamp()
  });
}

async function _resolveRound() {
  const g = _mpGame;
  if(!g||g.phase!=='dealer'||_myRole!=='p1') return;
  const deck = _strToDeck(g.deck);
  const dealerHand = [...g.dealerHand];
  while(_handTotal(dealerHand)<17) dealerHand.push(deck.pop());
  const dt=_handTotal(dealerHand), p1t=_handTotal(g.p1hand||[]), p2t=_handTotal(g.p2hand||[]);

  const rr = (pt, isDouble) => {
    const s = isDouble ? (g.stake||0)*2 : (g.stake||0);
    if(pt>21)    return {result:'lose',delta:-s,win:false};
    if(dt>21)    return {result:'win', delta:s, win:true};
    if(pt>dt)    return {result:'win', delta:s, win:true};
    if(pt===dt)  return {result:'push',delta:0, win:false};
                 return {result:'lose',delta:-s,win:false};
  };
  const r1=rr(p1t,g.p1double), r2=rr(p2t,g.p2double);

  let p1rs=0, p2rs=0;
  if(r1.win&&!r2.win) p1rs=1;
  if(r2.win&&!r1.win) p2rs=1;

  const newScores={p1:(g.scores?.p1||0)+p1rs, p2:(g.scores?.p2||0)+p2rs};
  const roundResults=[...(g.roundResults||[]),{
    round:g.currentRound||1,
    p1:{hand:g.p1hand,total:p1t,result:r1.result},
    p2:{hand:g.p2hand,total:p2t,result:r2.result},
    dealer:{hand:dealerHand,total:dt}
  }];

  const bestOf=g.bestOf||3, winsNeeded=Math.ceil(bestOf/2);
  const gameOver = newScores.p1>=winsNeeded || newScores.p2>=winsNeeded || (g.currentRound||1)>=bestOf;
  const winner = gameOver ? (newScores.p1>newScores.p2?'p1':newScores.p2>newScores.p1?'p2':'push') : null;

  await updateDoc(doc(db,'bj_games',_mpGameId), {
    dealerHand, deck:_deckToStr(deck), scores:newScores, roundResults,
    phase: gameOver?'gameDone':'roundDone',
    winner: winner||null, p1double:false, p2double:false,
    updatedAt: serverTimestamp()
  });

  // Apply coin changes to both players
  await updateDoc(doc(db,'goatcoin',g.p1uid),{coins:increment(r1.delta),weekCoins:increment(r1.delta),totalCoins:increment(r1.delta)}).catch(()=>{});
  await updateDoc(doc(db,'goatcoin',g.p2uid),{coins:increment(r2.delta),weekCoins:increment(r2.delta),totalCoins:increment(r2.delta)}).catch(()=>{});

  if(gameOver&&winner&&winner!=='push') {
    const winUid = winner==='p1'?g.p1uid:g.p2uid;
    await updateDoc(doc(db,'goatcoin',winUid),{weekBJWins:increment(1),totalBJWins:increment(1)}).catch(()=>{});
  }
  _renderBJTable();
}

export async function bjNextRound() {
  if(!_mpGameId||!_mpGame||_mpGame.phase!=='roundDone'||_myRole!=='p1') return;
  const g = _mpGame;
  const deck = _newDeck();
  const p1h=[deck.pop(),deck.pop()], p2h=[deck.pop(),deck.pop()], dh=[deck.pop(),deck.pop()];
  await updateDoc(doc(db,'bj_games',_mpGameId), {
    deck:_deckToStr(deck), p1hand:p1h, p2hand:p2h, dealerHand:dh,
    phase:'p1turn', p1action:null, p2action:null, p1double:false, p2double:false,
    currentRound:(g.currentRound||1)+1, updatedAt:serverTimestamp()
  });
}

// ──────────────────────────────────────────────────
//  BLACKJACK TABLE UI
// ──────────────────────────────────────────────────
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

  const myH=g[`${_myRole}hand`]||[], oppRole=_myRole==='p1'?'p2':'p1', oppH=g[`${oppRole}hand`]||[];
  const myName=g[`${_myRole}name`]||'You', oppName=g[`${oppRole}name`]||'Opponent';
  const myColor=g[`${_myRole}color`]||'var(--accent)', oppColor=g[`${oppRole}color`]||'var(--text-muted)';
  const myTotal=_handTotal(myH), oppTotal=_handTotal(oppH);
  const phase=g.phase, myTurn=(phase==='p1turn'&&_myRole==='p1')||(phase==='p2turn'&&_myRole==='p2');
  const done=['dealer','roundDone','gameDone'].includes(phase);
  const scores=g.scores||{p1:0,p2:0};
  const dh=g.dealerHand||[];
  const dealerCards=done?dh.map(c=>_renderCard(c)).join(''):(dh.length?_renderCard(dh[0])+_renderCard(null,true):'');
  const dealerTotal=done?`<span class="bj-total ${_handTotal(dh)>21?'bust':''}">${_handTotal(dh)}</span>`:'';

  let roundMsg='', gameOverMsg='';
  if(done) {
    const lr=(g.roundResults||[]).slice(-1)[0];
    if(lr) {
      const mr=lr[_myRole]?.result, or=lr[oppRole]?.result;
      roundMsg=`<div class="bj-round-result"><span>You: ${mr==='win'?'Won':mr==='push'?'Push':'Lost'}</span><span>${escHtml(oppName)}: ${or==='win'?'Won':or==='push'?'Push':'Lost'}</span></div>`;
    }
  }
  if(phase==='gameDone') {
    const w=g.winner;
    gameOverMsg=w==='push'?`<div class="bj-result bj-result-push">Tie — coins returned.</div>`
      :w===_myRole?`<div class="bj-result bj-result-win">You won the series. GC transferred.</div>`
      :`<div class="bj-result bj-result-lose">${escHtml(oppName)} won this one. Better luck next time.</div>`;
  }

  panel.innerHTML = `
  <div class="bj-fullscreen-inner">
    <div class="bj-fullscreen-topbar">
      <span class="bj-fs-title">Blackjack</span>
      <button class="bj-fs-close" id="bj-fs-close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Leave game
      </button>
    </div>
  <div class="bj-mp-table" id="bj-mp-table">
    <div class="bj-mp-header">
      <div class="bj-mp-scores">
        <div class="bj-mp-player"><div class="bj-mp-ava" style="background:${myColor}">${avatarInitial(myName)}</div><span>${escHtml(myName)} (You)</span><span class="bj-mp-score">${scores[_myRole]||0}</span></div>
        <div class="bj-mp-vs">vs \u00B7 Round ${g.currentRound||1}/${g.bestOf||3} \u00B7 ${g.stake}GC/rd</div>
        <div class="bj-mp-player"><div class="bj-mp-ava" style="background:${oppColor}">${avatarInitial(oppName)}</div><span>${escHtml(oppName)}</span><span class="bj-mp-score">${scores[oppRole]||0}</span></div>
      </div>
    </div>
    <div class="bj-mp-area">
      <div class="bj-side"><div class="bj-side-label">Dealer ${dealerTotal}</div><div class="bj-hand">${dealerCards}</div></div>
      <div class="bj-sides-row">
        <div class="bj-side bj-my-side ${myTurn?'bj-active-side':''}">
          <div class="bj-side-label">You <span class="bj-total ${myTotal>21?'bust':''}">${myTotal}</span>${myTurn?'<span class="bj-your-turn-badge">your move</span>':''}</div>
          <div class="bj-hand">${myH.map(c=>_renderCard(c)).join('')}</div>
        </div>
        <div class="bj-side bj-opp-side">
          <div class="bj-side-label">${escHtml(oppName)} ${done?`<span class="bj-total ${oppTotal>21?'bust':''}">${oppTotal}</span>`:'<span class="bj-total">?</span>'}${phase===`${oppRole}turn`?'<span class="bj-their-turn-badge">waiting...</span>':''}</div>
          <div class="bj-hand">${done?oppH.map(c=>_renderCard(c)).join(''):oppH.map(()=>_renderCard(null,true)).join('')}</div>
        </div>
      </div>
      ${roundMsg}${gameOverMsg}
      <div class="bj-mp-actions">
        ${myTurn&&phase!=='gameDone'?('<button class="btn bj-btn" id="bj-mp-hit">Hit</button><button class="btn bj-btn" id="bj-mp-stand">Stand</button>'+(myH.length===2&&Math.floor(_gcData?.coins||0)>=(g.stake||0)*2?'<button class="btn bj-btn bj-double" id="bj-mp-double">Double</button>':'')):''}

        ${phase==='roundDone'?(_myRole==='p1'?'<button class="btn bj-btn" id="bj-mp-next">Next Round \u25B6</button>':`<div class="bj-wait-msg">${escHtml(g.p1name)} is starting the next round...</div>`):''}
        ${phase==='gameDone'?'<button class="btn btn-ghost bj-btn" id="bj-mp-leave">Leave</button>':''}
        ${phase==='p1turn'&&_myRole==='p2'?`<div class="bj-wait-msg">${escHtml(g.p1name)} is thinking...</div>`:''}
        ${phase==='p2turn'&&_myRole==='p1'?`<div class="bj-wait-msg">${escHtml(g.p2name)} is thinking...</div>`:''}
        ${phase==='dealer'?'<div class="bj-wait-msg">Dealer drawing...</div>':''}
        ${phase==='dealing'?'<div class="bj-wait-msg">Dealing...</div>':''}
      </div>
    </div>
  </div>`;

  _updateBJNavBadge();
  document.getElementById('bj-mp-hit')?.addEventListener('click', bjHit);
  document.getElementById('bj-mp-stand')?.addEventListener('click', bjStand);
  document.getElementById('bj-mp-double')?.addEventListener('click', bjDouble);
  document.getElementById('bj-mp-next')?.addEventListener('click', bjNextRound);
  document.getElementById('bj-mp-leave')?.addEventListener('click', _leaveGame);

}

// ──────────────────────────────────────────────────
//  CARD UTILS
// ──────────────────────────────────────────────────
const SUITS=['♠','♥','♦','♣'], VALUES=['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
function _newDeck() {
  const deck=[];
  for(const s of SUITS) for(const v of VALUES) deck.push({s,v});
  for(let i=deck.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [deck[i],deck[j]]=[deck[j],deck[i]]; }
  return deck;
}
function _deckToStr(deck) { return deck.map(c=>`${c.v}${c.s}`).join(','); }
function _strToDeck(str) {
  if(!str) return _newDeck();
  return str.split(',').filter(Boolean).map(s=>({v:s.slice(0,-1),s:s.slice(-1)}));
}
function _cardValue(c) { if(['J','Q','K'].includes(c.v)) return 10; if(c.v==='A') return 11; return parseInt(c.v)||0; }
function _handTotal(hand) {
  let t=0,a=0;
  for(const c of hand){t+=_cardValue(c);if(c.v==='A')a++;}
  while(t>21&&a>0){t-=10;a--;}
  return t;
}
function _renderCard(card,hidden=false) {
  if(hidden||!card) return '<div class="bj-card bj-hidden"><span>?</span></div>';
  const red=card.s==='♥'||card.s==='♦';
  return `<div class="bj-card${red?' red':''}"><span class="bj-cv">${card.v}</span><span class="bj-cs">${card.s}</span></div>`;
}

// ──────────────────────────────────────────────────
//  LEADERBOARD
// ──────────────────────────────────────────────────
async function _renderLeaderboard() {
  const el=document.getElementById('gc-leaderboard-content');
  if(!el) return;
  el.innerHTML='<div style="color:var(--text-faint);font-size:.78rem">Loading\u2026</div>';
  try {
    const [gcSnap,usersSnap]=await Promise.all([getDocs(collection(db,'goatcoin')),getDocs(collection(db,'users'))]);
    const userMap={};
    usersSnap.docs.forEach(d=>{userMap[d.id]=d.data();});
    const rows=gcSnap.docs.map(d=>{
      const gc=d.data(),u=userMap[d.id]||{};
      return {uid:d.id,username:u.username||'Unknown',color:u.color||avatarColor(d.id),
        coins:Math.floor(gc.coins||0),weekCoins:Math.floor(gc.weekCoins||0),totalCoins:Math.floor(gc.totalCoins||0),
        weekChatMins:Math.floor(gc.weekChatMins||0),weekGameMins:Math.floor(gc.weekGameMins||0),
        weekBJWins:Math.floor(gc.weekBJWins||0),totalBJWins:Math.floor(gc.totalBJWins||0)};
    }).filter(r=>userMap[r.uid]?.status==='approved');
    const tabs=[
      {key:'weekCoins',   label:'This Week GC',  fmt:v=>v+' GC'},
      {key:'coins',       label:'Balance GC',    fmt:v=>v+' GC'},
      {key:'weekBJWins',  label:'BJ Wins (week)',   fmt:v=>v+' wins'},
      {key:'totalBJWins', label:'BJ Wins (all)',    fmt:v=>v+' wins'},
      {key:'weekChatMins',label:'Chat (week)',      fmt:v=>v+'m'},
      {key:'weekGameMins',label:'Games (week)',     fmt:v=>v+'m'},
      {key:'totalCoins',  label:'All-Time GC',   fmt:v=>v+' GC'},
    ];
    let activeTab='weekCoins';
    const render=()=>{
      const sorted=[...rows].sort((a,b)=>(b[activeTab]||0)-(a[activeTab]||0));
      el.innerHTML=`<div class="lb-tabs">${tabs.map(t=>`<button class="lb-tab${t.key===activeTab?' active':''}" data-lbkey="${t.key}">${t.label}</button>`).join('')}</div>
        <div class="lb-table">${sorted.slice(0,20).map((r,i)=>`<div class="lb-row${r.uid===_gcUser?.uid?' lb-me':''}"><span class="lb-rank">${i===0?'1st':i===1?'2nd':i===2?'3rd':'#'+(i+1)}</span><div class="lb-ava" style="background:${r.color}">${avatarHtml(r.icon||'',r.username,"60%")}</div><span class="lb-name">${escHtml(r.username)}</span><span class="lb-val">${tabs.find(t=>t.key===activeTab)?.fmt(r[activeTab]||0)}</span></div>`).join('')}</div>`;
      el.querySelectorAll('.lb-tab').forEach(btn=>btn.addEventListener('click',()=>{activeTab=btn.dataset.lbkey;render();}));
    };
    render();
  } catch(e) { if(el) el.innerHTML='<div style="color:var(--danger)">Failed to load leaderboard</div>'; }
}

// ──────────────────────────────────────────────────
//  EXPORTS
// ──────────────────────────────────────────────────
export function getGoatCoins()    { return _gcData?Math.floor(_gcData.coins||0):0; }
export function getGoatCoinData() { return _gcData; }

export function cleanupGoatCoin() {
  if(_gcUnsub)     { _gcUnsub(); _gcUnsub=null; }
  if(_gcTimer)     { clearInterval(_gcTimer); _gcTimer=null; }
  if(_mpGameUnsub) { _mpGameUnsub(); _mpGameUnsub=null; }
  if(_mpChalUnsub) { _mpChalUnsub(); _mpChalUnsub=null; }
  if(_mpChalUnsub2){ _mpChalUnsub2(); _mpChalUnsub2=null; }
}