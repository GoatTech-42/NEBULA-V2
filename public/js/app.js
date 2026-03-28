// ═══════════════════════════════════════════════════
//  app.js — Core app logic
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc, addDoc,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, writeBatch
} from './firebase.js';
import { getDatabase, ref as rtRef, set as rtSet, get as rtGet, onValue, serverTimestamp as rtServerTimestamp, remove, update as rtUpdate } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initGoatCoin, setActivity, cleanupGoatCoin, getGoatCoinData, renderGoatCoinTab } from './goatcoin.js';
import { renderBadgeRow, openProfileModal, renderOwnProfile, checkAutoAwards, BADGE_DEFS, checkAdblocker } from './profile.js';
import { renderShopTab, initShop } from './shop.js';
import { CMD_ICONS } from './icons.js';

// ── State ──
let currentUser = null;
let currentUserData = null;
let currentChannel = null;
let currentDM = null;
let channelUnsub = null;
let dmUnsub = null;
let _typingUnsub = null;
let membersUnsub = null;
let typingTimeout = null;
let editingMsgId = null;
let visitsUnsub = null;
let _pendingSignup = false;
let _rtdb = null;
const _userCache = {};
const _unreadChannels = {};
const _unreadDMs = {};
let _unreadEnabled = true;

// ── Cookie-based unread persistence ──
// Stores the last-seen message timestamp per channel/DM in a cookie
// so unread counts survive page refreshes.
const COOKIE_PREFIX = 'neb_seen_';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function _setCookie(key, value) {
  document.cookie = `${COOKIE_PREFIX}${key}=${encodeURIComponent(value)};path=/;max-age=${COOKIE_MAX_AGE};SameSite=Lax`;
}
function _getCookie(key) {
  const name = COOKIE_PREFIX + key + '=';
  const parts = document.cookie.split(';');
  for(let p of parts) {
    p = p.trim();
    if(p.startsWith(name)) return decodeURIComponent(p.substring(name.length));
  }
  return null;
}
// Get the timestamp (ms) of the last message the user has "seen" in a channel/DM
function _getSeenTs(id) {
  const v = _getCookie(id);
  return v ? parseInt(v, 10) : 0;
}
// Mark all messages in a channel/DM as seen up to `ts` (ms)
function _markSeen(id, ts) {
  _setCookie(id, String(ts));
}
// Count how many messages in a snapshot came after the last-seen timestamp
function _countUnread(docs, id) {
  const seenTs = _getSeenTs(id);
  if(!seenTs) return 0;
  return docs.filter(d => {
    const ts = d.data().ts?.toMillis ? d.data().ts.toMillis() : 0;
    return ts > seenTs && d.data().uid !== currentUser?.uid;
  }).length;
}

// Channel message limit — prune when exceeded
const CHANNEL_MSG_LIMIT = 100;
const CHANNEL_MSG_PRUNE_TO = 80;

// ── Rank utils ──
export const RANKS = { earthbound:0, planetary:1, solar:2, galactic:3, universal:4, goat:5 };
export const rankOf = r => RANKS[r] ?? -1;
export const canModerate = r => rankOf(r) >= rankOf('universal');
export const canChat = r => rankOf(r) >= rankOf('planetary');
export const RANK_COLORS = {
  earthbound:'#6ee7b7', planetary:'#38bdf8', solar:'#f59e0b',
  galactic:'#a855f7', universal:'#e2e8f0', goat:'#fde68a'
};

const AV_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
export function avatarColor(uid) { let h=0; for(let c of uid) h=(h<<5)-h+c.charCodeAt(0); return AV_COLORS[Math.abs(h)%AV_COLORS.length]; }
export function avatarInitial(u) { return (u||'?')[0].toUpperCase(); }

// ── Toast ──
export function toast(msg, type='info', dur=3000) {
  const stack = document.getElementById('notif-stack');
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.innerHTML = `<div class="notif-dot"></div><span class="nmsg">${msg}</span>`;
  el.style.cursor = 'pointer';
  el.addEventListener('click', () => { el.style.animation='fadeOut .25s ease forwards'; setTimeout(()=>el.remove(),250); });
  stack.appendChild(el);
  setTimeout(()=>{ el.style.animation='fadeOut .3s ease forwards'; setTimeout(()=>el.remove(),300); }, dur);
}

// ── Modal ──
function showModal(html, onClose) {
  const ov = document.getElementById('modal-overlay');
  const wrap = document.getElementById('modal-wrap');
  const box = document.getElementById('modal-box-main');
  ov.classList.remove('hidden');
  if(wrap) wrap.classList.remove('hidden');
  box.classList.remove('hidden');
  box.innerHTML = html;
  ov.onclick = e => { if(e.target===ov) closeModal(onClose); };
  return box;
}
function closeModal(cb) {
  const ov = document.getElementById('modal-overlay');
  const wrap = document.getElementById('modal-wrap');
  const box = document.getElementById('modal-box-main');
  ov.classList.add('closing');
  setTimeout(()=>{
    ov.classList.add('hidden'); ov.classList.remove('closing');
    if(wrap) wrap.classList.add('hidden');
    box.classList.add('hidden');
    box.innerHTML='';
    if(cb) cb();
  },200);
}

// ── Theme ──
const THEME_FILES = { 'og':'og.css','dark':'dark.css','light':'light.css','synthwave':'synthwave.css','aurora':'aurora.css','crimson':'crimson.css','midnight':'midnight.css','slate':'slate.css','forest':'forest.css','ocean':'ocean.css','rose':'rose.css','solar':'solar.css','void':'void.css','neon':'neon.css','blush':'blush.css','ice':'ice.css' };
let _themeTransitioning = false;

function applyTheme(name, animate = true) {
  const file = THEME_FILES[name] || 'og.css';
  document.cookie = `nebula_theme=${name};path=/;max-age=31536000`;
  const themeAnimOn = localStorage.getItem('neb_notif_theme-anim') !== 'false';
  if (!animate || _themeTransitioning || !themeAnimOn) {
    let link = document.getElementById('theme-stylesheet');
    if (!link) { link = document.createElement('link'); link.rel='stylesheet'; link.id='theme-stylesheet'; document.head.appendChild(link); }
    link.href = `css/themes/${file}?v=${Date.now()}`;
    return;
  }
  _themeTransitioning = true;
  const overlay = document.createElement('div');
  overlay.id = 'theme-transition-overlay';
  document.body.appendChild(overlay);
  overlay.getBoundingClientRect();
  overlay.classList.add('tto-in');
  overlay.addEventListener('animationend', () => {
    let link = document.getElementById('theme-stylesheet');
    if (!link) { link = document.createElement('link'); link.rel='stylesheet'; link.id='theme-stylesheet'; document.head.appendChild(link); }
    const revealAndClean = () => {
      overlay.classList.remove('tto-in');
      overlay.classList.add('tto-out');
      overlay.addEventListener('animationend', () => { overlay.remove(); _themeTransitioning = false; }, { once: true });
    };
    link.onload = revealAndClean;
    link.href = `css/themes/${file}?v=${Date.now()}`;
    setTimeout(revealAndClean, 300);
  }, { once: true });
}
function loadTheme() {
  const c = document.cookie.split(';').find(x=>x.trim().startsWith('nebula_theme='));
  const t = c ? c.split('=')[1].trim() : 'og';
  return THEME_FILES[t] ? t : 'og';
}

// ── Layout ──
const LAYOUTS = ['default', 'sidebar-right', 'topbar', 'bottombar'];
function loadLayout() { return localStorage.getItem('neb_layout') || 'default'; }
function applyLayout(name) {
  LAYOUTS.forEach(l => document.body.classList.remove('layout-'+l));
  if(name !== 'default') document.body.classList.add('layout-'+name);
  localStorage.setItem('neb_layout', name);
  const isSidebar = name === 'default' || name === 'sidebar-right';
  if(!isSidebar) {
    document.body.classList.add('hide-nav-labels');
    document.body.classList.remove('compact-sidebar');
  } else {
    const labelsStored = localStorage.getItem('neb_notif_nav-labels');
    const labelsOn = labelsStored === null || labelsStored === 'true';
    document.body.classList.toggle('hide-nav-labels', !labelsOn);
    const labelsToggle = document.querySelector('.notif-toggle[data-key="nav-labels"]');
    if(labelsToggle) labelsToggle.checked = labelsOn;
    const compactStored = localStorage.getItem('neb_notif_compact-sidebar');
    document.body.classList.toggle('compact-sidebar', compactStored === 'true');
    const savedW = localStorage.getItem('neb_sidebar_w') || '224';
    document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
  }
}

// ── Notification Permission ──
function requestNotifPermission() {
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default') {
    setTimeout(() => {
      Notification.requestPermission().then(perm => {
        if(perm === 'granted') toast('Notifications are on.', 'success');
      });
    }, 3000);
  }
}

// ── Auth Screen ──
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('pending-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  hideSkeleton();
}

function hideSkeleton() {
  const sk = document.querySelector('.skeleton-screen');
  if(sk) { sk.classList.add('fade-out'); setTimeout(()=>sk.remove(),400); }
}

function setupAuth() {
  document.getElementById('auth-pass-eye')?.addEventListener('click', () => {
    const inp = document.getElementById('auth-pass');
    const icon = document.getElementById('eye-icon');
    if(!inp) return;
    const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password';
    if(icon) icon.innerHTML = show
      ? '<path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22"/><circle cx="12" cy="12" r="3"/>'
      : '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  });

  const tabs = document.querySelectorAll('.auth-tab');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    const mode = t.dataset.tab;
    document.getElementById('auth-signup-fields').classList.toggle('hidden', mode!=='signup');
    document.getElementById('auth-btn').textContent = mode==='signup' ? 'REQUEST ACCESS' : 'ENTER';
    document.getElementById('auth-err').textContent = '';
  }));

  document.getElementById('auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const mode = document.querySelector('.auth-tab.active').dataset.tab;
    const email = document.getElementById('auth-email').value.trim();
    const pass = document.getElementById('auth-pass').value;
    const btn = document.getElementById('auth-btn');
    const err = document.getElementById('auth-err');
    err.textContent = '';
    btn.disabled = true; btn.textContent = '...';

    try {
      if(mode === 'login') {
        await signInWithEmailAndPassword(auth, email, pass);
      } else {
        const username = document.getElementById('auth-username').value.trim();
        const fullName = document.getElementById('auth-fullname').value.trim();
        const confirm = document.getElementById('auth-pass-confirm').value;
        if(pass !== confirm) { err.textContent='Passwords do not match'; btn.disabled=false; btn.textContent='REQUEST ACCESS'; return; }
        if(!username || username.length < 3) { err.textContent='Username too short (min 3)'; btn.disabled=false; btn.textContent='REQUEST ACCESS'; return; }
        if(username.length > 20) { err.textContent='Username too long (max 20)'; btn.disabled=false; btn.textContent='REQUEST ACCESS'; return; }
        if(!/^[a-zA-Z0-9_]+$/.test(username)) { err.textContent='Username: letters, numbers, underscores only'; btn.disabled=false; btn.textContent='REQUEST ACCESS'; return; }
        _pendingSignup = true;
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(auth, email, pass);
        } catch(ex2) {
          _pendingSignup = false;
          throw ex2;
        }
        const usnap = await getDocs(query(collection(db,'users'), where('username','==',username)));
        if(!usnap.empty) {
          _pendingSignup = false;
          await cred.user.delete();
          await signOut(auth);
          err.textContent='Username already taken'; btn.disabled=false; btn.textContent='REQUEST ACCESS';
          return;
        }
        await setDoc(doc(db,'users',cred.user.uid), {
          uid: cred.user.uid, username, email,
          fullName,
          rank: 'earthbound', status: 'pending',
          createdAt: serverTimestamp(), color: avatarColor(cred.user.uid)
        });
        _pendingSignup = false;
        await initApp(cred.user);
        return;
      }
    } catch(ex) {
      const msgs = {
        'auth/user-not-found':'Account not found',
        'auth/wrong-password':'Wrong password',
        'auth/invalid-credential':'Wrong email or password',
        'auth/email-already-in-use':'Email already in use',
        'auth/invalid-email':'Invalid email address',
        'auth/weak-password':'Password too weak (min 6 chars)',
        'auth/too-many-requests':'Too many tries. Give it a minute and try again.',
        'auth/operation-not-allowed':'Sign-ups are closed right now. Ask an admin for access.',
        'auth/network-request-failed':'Connection issue. Check your internet and try again.',
      };
      err.textContent = msgs[ex.code] || ex.message;
      btn.disabled = false;
      btn.textContent = mode==='login' ? 'ENTER' : 'REQUEST ACCESS';
    }
  });
}

// ── Main App Init ──
async function initApp(user) {
  if(_pendingSignup) return;
  const snap = await getDoc(doc(db,'users',user.uid));
  if(!snap.exists()) {
    await new Promise(r => setTimeout(r, 1200));
    const snap2 = await getDoc(doc(db,'users',user.uid));
    if(!snap2.exists()) { await signOut(auth); showAuth(); return; }
    return initApp(user);
  }
  const data = snap.data();
  currentUser = user; currentUserData = data;

  if(data.status === 'pending') {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('pending-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    return;
  }
  if(data.status === 'banned') {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-err').textContent = 'Your account has been banned. Contact an admin if you think this is wrong.';
    await signOut(auth);
    return;
  }
  if(!canChat(data.rank)) {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('app').classList.add('hidden');
    document.getElementById('auth-err').textContent = 'Your rank does not permit access.';
    await signOut(auth);
    return;
  }

  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('pending-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  // Init Realtime Database
  try {
    _rtdb = getDatabase();
  } catch(e) {
    console.warn('RTDB init failed, falling back to Firestore for presence/typing:', e);
    _rtdb = null;
  }

  buildSidebar();
  setupNav();
  applyLayout(loadLayout());
  requestNotifPermission();
  initHome();
  initChat();
  initDMs();
  setupProfile();
  setupSettings();
  if(canModerate(data.rank)) setupAdmin();
  trackVisits();
  setupPresence();
  initGoatCoin(user, data, _rtdb);
  initShop(user, data, _rtdb);
  window._onGCUpdate = () => {
    const sec = document.getElementById('section-profile');
    if(sec?.classList.contains('active')) {
      renderOwnProfile(currentUser, currentUserData, window._getGCData?.());
      setTimeout(() => renderProfileEdit(), 0);
    }
  };
  checkAutoAwards(user.uid, data);
  setTimeout(checkAdblocker, 2000);
  setupKeyboardShortcuts();
  setupCommandPalette();
  hideSkeleton();
}

// ── Sidebar ──
function buildSidebar() {
  const d = currentUserData;
  const ava = document.getElementById('sp-ava');
  const name = document.getElementById('sp-name');
  const rank = document.getElementById('sp-rank');
  ava.style.background = d.color || avatarColor(d.uid);
  ava.innerHTML = avatarHtml(d.icon, d.username, '60%');
  name.textContent = d.username;
  rank.textContent = d.rank.toUpperCase();
  rank.className = 'sp-rank';
  rank.style.color = RANK_COLORS[d.rank] || '#38bdf8';

  const adminNav = document.getElementById('nav-admin');
  if(adminNav) adminNav.classList.toggle('hidden', !canModerate(d.rank));

  document.getElementById('sp-signout').addEventListener('click', async () => {
    if(channelUnsub) { channelUnsub(); channelUnsub=null; }
    if(dmUnsub)      { dmUnsub();      dmUnsub=null; }
    if(membersUnsub) { membersUnsub(); membersUnsub=null; }
    cleanupGoatCoin();
    currentUser=null; currentUserData=null; currentChannel=null; currentDM=null;
    document.getElementById('app').classList.add('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    const ef=document.getElementById('auth-err'); if(ef) ef.textContent='';
    const pf=document.getElementById('auth-pass'); if(pf) pf.value='';
    await signOut(auth);
  });
}

// ── Nav ──
function setupNav() {
  document.querySelectorAll('[data-section]').forEach(item => {
    item.addEventListener('click', () => navigate(item.dataset.section));
  });
}

function navigate(section) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('[data-section]').forEach(i=>i.classList.remove('active'));
  const sec = document.getElementById('section-'+section);
  if(sec) sec.classList.add('active');
  document.querySelectorAll(`[data-section="${section}"]`).forEach(i=>i.classList.add('active'));
  setActivity(section === 'chat' ? 'chat' : section === 'games' ? 'game' : 'site');
  if(section === 'goatcoin') renderGoatCoinTab();
  if(section === 'shop') renderShopTab();
  document.getElementById('mobile-drawer-overlay')?.remove();
  document.getElementById('mobile-drawer')?.remove();

  // When navigating to chat/dms while a channel/DM is open, mark as seen
  if(section === 'chat' && currentChannel) {
    _unreadChannels[currentChannel.id] = 0;
    _markSeen(currentChannel.id, Date.now());
    _updateChatBadge(); _updateChannelListBadges();
  }
  if(section === 'dms' && currentDM) {
    _unreadDMs[currentDM.id] = 0;
    _markSeen('dm_' + currentDM.id, Date.now());
    _updateDMBadge(); _updateDMListBadges();
  }
}

// ── Home / Visits ──
const TOOLTIPS_RAW = [
  "nebula never dies", "disable your adblocker for goatcoin", "lock in gng", "stfu fleece", "dm me for tooltip suggestions", "now with more customization", "plz dont hack", "find the tabernacle", "is ts peak", "goattech is better", "proxies dont take the internet", "no goofy ahh minecraft kids", "definitely not vibe coded", "join hackclub", "67 67 676767 hahahhahahah", "great uncle tup tup never dies", "lightspeed", "why are you reading this", "in the big 26", "touch grass gng", "lets go gambling", "all on red", "ask not what nebula can do for you", "imagine not having the goat rank", "goatcoin > bitcoin", "ctrl+k to search anything", "new features every week", "the stars are watching",
];

function shuffleArray(arr) {
  const a = [...arr];
  for(let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

let _tooltipInterval = null;
function initHome() {
  const wrap = document.getElementById('tt-wrap');
  if(wrap) {
    wrap.innerHTML = '';
    let tips = shuffleArray(TOOLTIPS_RAW);
    let idx = 0;
    function nextTip() {
      if(idx >= tips.length) { tips = shuffleArray(tips); idx = 0; }
      return tips[idx++];
    }
    function cycle() {
      const old = wrap.querySelector('.tt-el');
      if(old) {
        old.classList.add('exit');
        setTimeout(() => { if(old.parentNode) old.remove(); }, 500);
      }
      setTimeout(() => {
        const el = document.createElement('div');
        el.className = 'tt-el enter';
        el.textContent = nextTip();
        wrap.appendChild(el);
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('vis')));
      }, old ? 200 : 0);
    }
    cycle();
    if(_tooltipInterval) clearInterval(_tooltipInterval);
    _tooltipInterval = setInterval(cycle, 4200);
    document.addEventListener('visibilitychange', () => {
      if(document.hidden) {
        // Tab lost focus — immediately remove ALL tooltip elements to prevent overlap on return
        wrap.querySelectorAll('.tt-el').forEach(el => el.remove());
        if(_tooltipInterval) { clearInterval(_tooltipInterval); _tooltipInterval = null; }
      } else {
        // Tab regained focus — clean start with a single fresh tooltip
        wrap.querySelectorAll('.tt-el').forEach(el => el.remove());
        cycle();
        if(!_tooltipInterval) _tooltipInterval = setInterval(cycle, 4200);
      }
    });
  }

  const layers = [
    document.getElementById('neb-1'),
    document.getElementById('neb-2'),
    document.getElementById('neb-3'),
  ];
  const depths = [0.018, 0.032, 0.012];
  window._parallaxSpeed = parseFloat(localStorage.getItem('neb_parallax_speed') || '0.03');
  let tX = 0, tY = 0, cX = 0, cY = 0;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  window.addEventListener('mousemove', e => {
    tX = (e.clientX - cx) / cx;
    tY = (e.clientY - cy) / cy;
  });
  function animateParallax() {
    const speed = window._parallaxSpeed ?? 0.03;
    cX += (tX - cX) * speed;
    cY += (tY - cY) * speed;
    layers.forEach((l, i) => {
      if(l) l.style.transform = `translate(${cX*depths[i]*100}px, ${cY*depths[i]*100}px)`;
    });
    requestAnimationFrame(animateParallax);
  }
  animateParallax();

  setupFPS();
  setupBattery();
  setupUptime();

  document.querySelectorAll('.home-card[data-goto]').forEach(c => {
    c.addEventListener('click', () => navigate(c.dataset.goto));
  });
}

// Session uptime counter
let _uptimeStart = Date.now();
function setupUptime() {
  const el = document.getElementById('uptime-val');
  if(!el) return;
  function updateUptime() {
    const elapsed = Math.floor((Date.now() - _uptimeStart) / 1000);
    const hrs = Math.floor(elapsed / 3600);
    const mins = Math.floor((elapsed % 3600) / 60);
    const secs = elapsed % 60;
    el.textContent = hrs > 0
      ? `${hrs}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`
      : `${mins}:${String(secs).padStart(2,'0')}`;
    requestAnimationFrame(()=>setTimeout(updateUptime, 1000));
  }
  updateUptime();
}

function setupFPS() {
  let frames=0, last=performance.now(), fps=0;
  const el = document.getElementById('fps-val');
  function tick(t) {
    frames++;
    if(t-last>=1000) {
      fps = Math.round(frames*1000/(t-last));
      frames=0; last=t;
      if(el) el.textContent = fps;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

async function setupBattery() {
  const el = document.getElementById('battery-wrap');
  if(!el) return;
  try {
    const batt = await navigator.getBattery();
    function updateBatt() {
      const pct = Math.round(batt.level*100);
      const charging = batt.charging;
      el.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          ${charging ? `<path d="M5 18H3a2 2 0 01-2-2V8a2 2 0 012-2h3.19M15 6h2a2 2 0 012 2v8a2 2 0 01-2 2h-3.19M23 13v-2M11 6l-4 6h6l-4 6"/>` :
          `<rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><rect x="4" y="9" width="${Math.round(pct/100*13)}" height="6" rx="1" fill="currentColor" stroke="none"/>`}
        </svg>
        <span style="font-size:.78rem;font-weight:700;color:${pct<=20?'var(--danger)':pct<=50?'var(--warn)':'var(--success)'};">${charging?'<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>':''} ${pct}%</span>
      `;
    }
    updateBatt();
    batt.addEventListener('levelchange', updateBatt);
    batt.addEventListener('chargingchange', updateBatt);
  } catch(e) {
    el.innerHTML = `<span style="font-size:.7rem;color:var(--text-faint)">No battery API</span>`;
  }
}

// ── Presence removed — typing indicators only via RTDB ──
function setupPresence() { /* no-op: presence system removed */ }

function trackVisits() {
  const el = document.getElementById('visits-count');
  if(!el) return;
  // Use RTDB for visit counter — much cheaper than Firestore
  if(_rtdb) {
    const visitsRef = rtRef(_rtdb, 'meta/visits');
    rtGet(visitsRef).then(snap => {
      const cur = (snap.val() || 0) + 1;
      rtSet(visitsRef, cur).catch(()=>{});
      el.textContent = cur.toLocaleString();
    }).catch(() => {
      // fallback to Firestore if RTDB fails
      const ref = doc(db,'meta','visits');
      updateDoc(ref, { count: increment(1) }).catch(() => setDoc(ref, { count: 1 }, { merge: true }));
      visitsUnsub = onSnapshot(ref, snap => {
        if(snap.exists()) el.textContent = (snap.data().count || 0).toLocaleString();
      });
    });
    // Listen for realtime updates
    onValue(visitsRef, snap => {
      if(snap.val() !== null) el.textContent = (snap.val() || 0).toLocaleString();
    });
  } else {
    const ref = doc(db,'meta','visits');
    updateDoc(ref, { count: increment(1) }).catch(() => setDoc(ref, { count: 1 }, { merge: true }));
    visitsUnsub = onSnapshot(ref, snap => {
      if(snap.exists()) el.textContent = (snap.data().count || 0).toLocaleString();
    });
  }
}

// ── Channel message pruning ──
async function pruneChannelIfNeeded(channelId) {
  try {
    const msgsRef = collection(db, `channels/${channelId}/messages`);
    const countSnap = await getDocs(query(msgsRef, orderBy('ts','asc')));
    if(countSnap.size <= CHANNEL_MSG_LIMIT) return;
    // Delete oldest messages to bring count down to CHANNEL_MSG_PRUNE_TO
    const toDelete = countSnap.docs.slice(0, countSnap.size - CHANNEL_MSG_PRUNE_TO);
    const batch = writeBatch(db);
    toDelete.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch(e) {
    console.warn('Prune failed:', e);
  }
}

// ── Chat ──
const HARDCODED_CHANNELS = [
  { id:'general', name:'general', icon:'#', announce:false, passwordProtected:false, minRank:'planetary' },
  { id:'admin', name:'admin', icon:'#', announce:false, passwordProtected:false, minRank:'universal', adminOnly:true }
];

function initChat() {
  loadChannelsList();
}

async function loadChannelsList() {
  const d = currentUserData;
  const list = document.getElementById('channel-list');
  if(!list) return;

  let channels = [...HARDCODED_CHANNELS];
  const customSnap = await getDocs(query(collection(db,'channels'), orderBy('createdAt','asc')));
  customSnap.forEach(s => channels.push({id:s.id, ...s.data()}));

  channels = channels.filter(ch => {
    if(ch.adminOnly) return canModerate(d.rank);
    return rankOf(d.rank) >= rankOf(ch.minRank||'planetary');
  });

  list.innerHTML = '';
  channels.forEach(ch => {
    const el = document.createElement('div');
    el.className = 'titem';
    el.dataset.cid = ch.id;
    const isCustom = !HARDCODED_CHANNELS.find(h=>h.id===ch.id);
    el.innerHTML = `<span class="titem-icon">${ch.icon||'#'}</span><span class="titem-name">${ch.name}</span><div class="titem-meta"></div>${isCustom && canModerate(d.rank) ? `<button class="titem-del" title="Delete channel" onclick="event.stopPropagation();window.deleteChannel('${ch.id}','${ch.name}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>` : ''}`;
    el.addEventListener('click', () => openChannel(ch));
    list.appendChild(el);
  });

  if(canModerate(d.rank)) {
    const addBtn = document.getElementById('ts-add-channel');
    if(addBtn) { addBtn.classList.remove('hidden'); addBtn.addEventListener('click', showCreateChannelModal); }
  }
}

async function openChannel(ch) {
  if(ch.passwordProtected && ch.password) {
    const isGoat = currentUserData.rank === 'goat';
    if(!isGoat) {
      const entered = prompt(`This channel is password protected.\nEnter password:`);
      if(entered !== ch.password) { toast('Wrong password', 'error'); return; }
    }
  }

  currentChannel = ch;
  document.querySelectorAll('#channel-list .titem').forEach(i => {
    i.classList.toggle('active', i.dataset.cid === ch.id);
  });

  const win = document.getElementById('chat-window');
  const noSel = document.getElementById('chat-no-select');
  win.classList.remove('hidden');
  noSel.classList.add('hidden');

  document.getElementById('chat-channel-name').textContent = ch.name;
  const annBadge = document.getElementById('chat-announce-badge');
  annBadge.classList.toggle('hidden', !ch.announce);

  // Wipe thread button — goat only
  const ctbRight = document.querySelector('#chat-window .ctb-right');
  if(ctbRight) {
    const existingWipe = ctbRight.querySelector('.wipe-thread-btn');
    if(existingWipe) existingWipe.remove();
    if(currentUserData.rank === 'goat') {
      const wipeBtn = document.createElement('button');
      wipeBtn.className = 'wipe-thread-btn btn btn-danger btn-sm';
      wipeBtn.style.cssText = 'font-size:.62rem;padding:.28rem .6rem;gap:.3rem;display:flex;align-items:center';
      wipeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg> Wipe Thread`;
      wipeBtn.addEventListener('click', () => wipeThread(ch.id, ch.name));
      ctbRight.appendChild(wipeBtn);
    }
  }

  const msgsWrap = document.getElementById('messages-wrap');
  msgsWrap.innerHTML = '<div class="messages" id="messages"></div>';
  if(channelUnsub) channelUnsub();

  loadMembers(ch);
  subscribeChannel(ch.id);
  // Clear unread count for this channel and update seen timestamp
  _unreadChannels[ch.id] = 0;
  _markSeen(ch.id, Date.now());
  _updateChatBadge();
  _updateChannelListBadges();

  const isAnnounce = ch.announce && !canModerate(currentUserData.rank);
  document.getElementById('chat-input').disabled = isAnnounce;
  document.getElementById('chat-send-btn').disabled = isAnnounce;
  document.getElementById('chat-input').placeholder = isAnnounce ? 'Announcements only' : `Message #${ch.name}`;

  // Prune in background — won't block UI
  setTimeout(() => pruneChannelIfNeeded(ch.id), 2000);
}

function subscribeChannel(channelId) {
  const msgsRef = collection(db, `channels/${channelId}/messages`);
  let initialized = false;
  lastMsgSender = null; lastMsgTime = null;

  // Use typing from RTDB if available, else Firestore — unsub previous listener first
  if(_typingUnsub) { _typingUnsub(); _typingUnsub = null; }
  if(_rtdb) {
    const typingRef = rtRef(_rtdb, `typing/${channelId}`);
    const rtTypingOff = onValue(typingRef, snap => {
      const data = snap.val() || {};
      const typists = Object.entries(data).filter(([uid, v]) => {
        if(uid === currentUser.uid) return false;
        return (Date.now() - (v?.ts || 0)) < 4000;
      }).map(([_, v]) => v.username);
      const bar = document.getElementById('typing-bar');
      if(typists.length && bar) {
        bar.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${typists.join(', ')} ${typists.length===1?'is':'are'} typing...</span>`;
      } else if(bar) bar.innerHTML='';
    });
    _typingUnsub = () => rtTypingOff();
  }

  channelUnsub = onSnapshot(
    query(msgsRef, orderBy('ts','asc'), limit(CHANNEL_MSG_LIMIT)),
    snap => {
      const msgs = document.getElementById('messages');
      if(!msgs) return;
      if(!initialized) {
        msgs.innerHTML = '';
        snap.docs.forEach(d => appendMsg(d.id, d.data(), msgs));
        initialized = true;
        scrollToBottom(true);
        // On initial load: mark all as seen (we're looking at them now)
        const lastDoc = snap.docs[snap.docs.length - 1];
        if(lastDoc) {
          const ts = lastDoc.data().ts?.toMillis ? lastDoc.data().ts.toMillis() : Date.now();
          _markSeen(channelId, ts);
        }
      } else {
        snap.docChanges().forEach(change => {
          if(change.type==='added') {
            appendMsg(change.doc.id, change.doc.data(), msgs);
            scrollToBottom();
            const isActive = document.getElementById('section-chat')?.classList.contains('active');
            const isThisChannel = currentChannel?.id === channelId;
            if((!isActive || !isThisChannel) && _unreadEnabled) {
              // Only count messages from others, not self
              if(change.doc.data().uid !== currentUser?.uid) {
                _unreadChannels[channelId] = (_unreadChannels[channelId]||0)+1;
                _updateChatBadge(); _updateChannelListBadges();
              }
            } else {
              // We're actively viewing — mark as seen
              const ts = change.doc.data().ts?.toMillis ? change.doc.data().ts.toMillis() : Date.now();
              _markSeen(channelId, ts);
            }
          } else if(change.type==='modified') {
            const el = document.getElementById('msg-'+change.doc.id);
            if(el) updateMsgEl(el, change.doc.data());
          } else if(change.type==='removed') {
            const el = document.getElementById('msg-'+change.doc.id);
            if(el) el.remove();
          }
        });
      }
    }
  );

  // Firestore typing fallback
  if(!_rtdb) {
    onSnapshot(doc(db, `channels/${channelId}/typing`, 'status'), snap => {
      if(!snap.exists()) return;
      const data = snap.data();
      const typists = Object.entries(data).filter(([uid,v]) => {
        if(uid === currentUser.uid) return false;
        const ms = v?.ts?.toMillis ? v.ts.toMillis() : (typeof v?.ts === 'number' ? v.ts : 0);
        return (Date.now() - ms) < 4000;
      }).map(([_,v]) => v.username);
      const bar = document.getElementById('typing-bar');
      if(typists.length && bar) {
        bar.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${typists.join(', ')} ${typists.length===1?'is':'are'} typing...</span>`;
      } else if(bar) bar.innerHTML='';
    });
  }
}

let lastMsgSender = null, lastMsgTime = null;

const RANK_LABELS = {
  earthbound:'EARTHBOUND',
  planetary:'PLANETARY',
  solar:'SOLAR',
  galactic:'GALACTIC',
  universal:'UNIVERSAL',
  goat:'GOAT'
};

function rankIconSvg(rank) {
  const icons = {
    earthbound: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 0 20"/><path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>',
    planetary: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M2 12c2.5-2 6.3-3 10-3s7.5 1 10 3c-2.5 2-6.3 3-10 3s-7.5-1-10-3z"/></svg>',
    solar: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="m19.1 4.9-2.1 2.1"/><path d="m7 17-2.1 2.1"/></svg>',
    galactic: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M3 12c2-4 5-6 9-6s7 2 9 6c-2 4-5 6-9 6s-7-2-9-6z"/><path d="M12 3v3"/><path d="M12 18v3"/></svg>',
    universal: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8L12 2z"/></svg>',
    goat: '<svg class="rbadge-icon goat-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>'
  };
  return icons[rank] || icons.planetary;
}

export function renderRankBadge(rank) {
  const safeRank = rank || 'planetary';
  return `<span class="rbadge ${safeRank}">${rankIconSvg(safeRank)}${RANK_LABELS[safeRank] || String(safeRank).toUpperCase()}</span>`;
}

function appendMsg(id, data, container) {
  const groupMs = (window._groupMins ?? 5) * 60000;
  const isFirst = data.uid !== lastMsgSender || !lastMsgTime || (data.ts?.toMillis() - lastMsgTime) > groupMs;
  lastMsgSender = data.uid; lastMsgTime = data.ts?.toMillis()||Date.now();

  const el = document.createElement('div');
  el.className = `msg msg-new${isFirst?' first-in-group':''}`;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('msg-new')));
  el.id = 'msg-'+id;
  el.dataset.uid = data.uid;
  el.dataset.mid = id;

  const ts = data.ts?.toDate ? data.ts.toDate() : new Date();
  const tsStr = ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const color = data.color || avatarColor(data.uid||'');
  const canEdit = data.uid === currentUser.uid;
  const canDelete = data.uid === currentUser.uid || canModerate(currentUserData.rank);

  if(isFirst) {
    const badgeHtml = renderBadgeRow(data.badges||[], true);
    el.innerHTML = `
      <div class="msg-ava-wrap"><div class="msg-ava" style="background:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${avatarHtml(data.icon,data.username,"60%")}</div></div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-name" style="color:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${escHtml(data.username)}</span>
          ${renderRankBadge(data.rank)}
          ${badgeHtml ? `<span class="msg-badge-row">${badgeHtml}</span>` : ''}
          <span class="msg-ts">${tsStr}</span>
        </div>
        <div class="msg-text">${formatMsg(data.text||'')}</div>
        ${data.edited?'<span class="msg-edited">(edited)</span>':''}
        <div class="msg-reactions" id="reacts-${id}"></div>
      </div>
      <div class="msg-actions">
        <button class="mab" onclick="window.addReaction('${id}')" title="React"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
        ${canEdit?`<button class="mab" onclick="window.editMsg('${id}','${encodeURIComponent(data.text||'')}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}
        ${canDelete?`<button class="mab d" onclick="window.deleteMsg('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>`:''}
      </div>`;
  } else {
    el.innerHTML = `
      <div class="msg-ava-wrap"><div class="msg-ava-spacer"></div></div>
      <div class="msg-content">
        <div class="msg-text">${formatMsg(data.text||'')}</div>
        ${data.edited?'<span class="msg-edited">(edited)</span>':''}
        <div class="msg-reactions" id="reacts-${id}"></div>
      </div>
      <div class="msg-actions">
        <span class="msg-ts-inline">${tsStr}</span>
        <button class="mab" onclick="window.addReaction('${id}')" title="React"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg></button>
        ${canEdit?`<button class="mab" onclick="window.editMsg('${id}','${encodeURIComponent(data.text||'')}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`:''}
        ${canDelete?`<button class="mab d" onclick="window.deleteMsg('${id}')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>`:''}
      </div>`;
  }

  renderReactions(el.querySelector('#reacts-'+id), data.reactions||{}, id);
  container.appendChild(el);
  return el;
}

function updateMsgEl(el, data) {
  const textEl = el.querySelector('.msg-text');
  if(textEl) textEl.innerHTML = formatMsg(data.text||'');
  const reactEl = el.querySelector('[id^="reacts-"]');
  if(reactEl) renderReactions(reactEl, data.reactions||{}, el.dataset.mid);
  const editEl = el.querySelector('.msg-edited');
  if(data.edited && !editEl) {
    el.querySelector('.msg-text').insertAdjacentHTML('afterend','<span class="msg-edited">(edited)</span>');
  }
  if(el.classList.contains('first-in-group')) {
    const ava = el.querySelector('.msg-ava');
    if(ava) ava.innerHTML = avatarHtml(data.icon, data.username, '60%');
    const rankEl = el.querySelector('.rbadge');
    if(rankEl && data.rank) {
      const newBadgeHtml = renderRankBadge(data.rank);
      const tmp = document.createElement('div');
      tmp.innerHTML = newBadgeHtml;
      const newEl = tmp.firstElementChild;
      if(newEl) rankEl.replaceWith(newEl);
    }
    // Remove old badge row
    el.querySelector('.msg-badge-row')?.remove();
    const bHtml = renderBadgeRow(data.badges||[], true);
    if(bHtml && rankEl) {
      const span = document.createElement('span');
      span.className = 'msg-badge-row';
      span.innerHTML = bHtml;
      rankEl.insertAdjacentElement('afterend', span);
    }
  }
}

// ...existing code...

async function toggleReaction(msgId, emoji) {
  const chId = currentChannel?.id;
  if(!chId) return;
  const ref = doc(db, `channels/${chId}/messages`, msgId);
  const snap = await getDoc(ref);
  if(!snap.exists()) return;
  const reactions = snap.data().reactions||{};
  const uids = reactions[emoji]||[];
  if(uids.includes(currentUser.uid)) {
    reactions[emoji] = uids.filter(x=>x!==currentUser.uid);
  } else {
    reactions[emoji] = [...uids, currentUser.uid];
  }
  await updateDoc(ref, {reactions});
}

function formatMsg(text) {
  const escaped = escHtml(text);
  const linked = escaped.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="msg-link">$1</a>'
  );
  return linked
    .replace(/@(\w+)/g,'<span class="mention">@$1</span>')
    .replace(/\n/g,'<br>');
}

export function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _updateChatBadge() {
  if(!_unreadEnabled) { document.getElementById('chat-badge')?.classList.add('hidden'); return; }
  const total = Object.values(_unreadChannels).reduce((a,b)=>a+b,0);
  const el = document.getElementById('chat-badge');
  if(!el) return;
  if(total > 0) { el.textContent = total > 99 ? '99+' : total; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}
function _updateDMBadge() {
  if(!_unreadEnabled) { document.getElementById('dm-badge')?.classList.add('hidden'); return; }
  const total = Object.values(_unreadDMs).reduce((a,b)=>a+b,0);
  const el = document.getElementById('dm-badge');
  if(!el) return;
  if(total > 0) { el.textContent = total > 99 ? '99+' : total; el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}
function _updateDMListBadges() {
  Object.entries(_unreadDMs).forEach(([dmId, count]) => {
    const item = document.querySelector(`#dm-list .titem[data-dmid="${dmId}"]`);
    if(!item) return;
    let badge = item.querySelector('.titem-badge');
    if(count > 0) {
      if(!badge) { badge = document.createElement('span'); badge.className='titem-badge'; item.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : count;
    } else if(badge) badge.remove();
  });
}
function _updateChannelListBadges() {
  Object.entries(_unreadChannels).forEach(([chId, count]) => {
    const item = document.querySelector(`#channel-list .titem[data-cid="${chId}"]`);
    if(!item) return;
    let badge = item.querySelector('.titem-badge');
    if(count > 0) {
      if(!badge) { badge = document.createElement('span'); badge.className='titem-badge'; item.appendChild(badge); }
      badge.textContent = count > 99 ? '99+' : count;
    } else if(badge) badge.remove();
  });
}

function scrollToBottom(force=false) {
  const wrap = document.getElementById('messages-wrap');
  if(!wrap) return;
  const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
  if(force || nearBottom) wrap.scrollTop = wrap.scrollHeight;
}

// ── Chat Input ──
function setupChatInput() {
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const charCtr = document.getElementById('char-ctr');

  input.addEventListener('input', () => {
    const len = input.value.length;
    charCtr.textContent = 500-len;
    charCtr.className = 'char-ctr'+(len>450?' warn':'')+(len>490?' danger':'');
    if(currentChannel) sendTyping();
  });

  input.addEventListener('keydown', e => {
    if(e.key==='Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  sendBtn.addEventListener('click', sendMessage);
}

let typingDebounce = null;
async function sendTyping() {
  clearTimeout(typingDebounce);
  typingDebounce = setTimeout(async ()=>{
    if(_rtdb && currentChannel) {
      // Use RTDB for typing — much cheaper
      const typRef = rtRef(_rtdb, `typing/${currentChannel.id}/${currentUser.uid}`);
      rtSet(typRef, { username: currentUserData.username, ts: Date.now() }).catch(()=>{});
      // Auto-clear after 4s
      setTimeout(() => remove(typRef).catch(()=>{}), 4000);
    } else if(currentChannel) {
      const ref = doc(db, `channels/${currentChannel.id}/typing`,'status');
      await setDoc(ref, { [currentUser.uid]: { username: currentUserData.username, ts: serverTimestamp() } }, {merge:true});
    }
  }, 300);
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const btn = document.getElementById('chat-send-btn');
  const text = input.value.trim();
  if(!text || !currentChannel) return;
  if(text.length > 500) { toast('That message is too long — 500 chars max.', 'warning'); return; }
  if(btn.disabled) return;

  input.value = '';
  document.getElementById('char-ctr').textContent = '500';
  btn.disabled = true;
  try {
    await addDoc(collection(db, `channels/${currentChannel.id}/messages`), {
      uid: currentUser.uid, username: currentUserData.username,
      rank: currentUserData.rank, color: currentUserData.color,
      icon: currentUserData.icon||'',
      badges: currentUserData.badges||[],
      text, ts: serverTimestamp(), edited: false, reactions: {}
    });
    // Check if pruning needed after send
    pruneChannelIfNeeded(currentChannel.id);
  } catch(e) { toast('Message failed to send.','error'); input.value = text; }
  finally { btn.disabled = false; }
}

// ── Edit/Delete ──
window.editMsg = function(id, encodedText) {
  const text = decodeURIComponent(encodedText);
  const el = document.getElementById('msg-'+id);
  const textEl = el?.querySelector('.msg-text');
  if(!textEl) return;
  editingMsgId = id;
  textEl.innerHTML = `<div class="edit-wrap"><input class="edit-inp" value="${escHtml(text)}" maxlength="500"><button class="esave" onclick="window.saveEdit('${id}')">Save</button><button class="ecancel" onclick="window.cancelEdit('${id}')">Cancel</button></div>`;
};
window.saveEdit = async function(id) {
  const inp = document.getElementById('msg-'+id)?.querySelector('.edit-inp');
  if(!inp||!currentChannel) return;
  const newText = inp.value.trim();
  if(!newText) return;
  await updateDoc(doc(db,`channels/${currentChannel.id}/messages`,id),{text:newText,edited:true});
  editingMsgId = null;
};
window.cancelEdit = async function(id) {
  if(!currentChannel) return;
  const snap = await getDoc(doc(db,`channels/${currentChannel.id}/messages`,id));
  if(snap.exists()) {
    const el = document.getElementById('msg-'+id);
    if(el) { const textEl=el.querySelector('.msg-text'); if(textEl) textEl.innerHTML=formatMsg(snap.data().text||''); }
  }
  editingMsgId = null;
};
window.deleteMsg = function(id) {
  if(!currentChannel) return;
  showModal(`
    <h3>Delete Message</h3>
    <p class="modal-p">This message will be permanently removed. This can't be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-del-btn">Delete</button>
    </div>
  `);
  document.getElementById('confirm-del-btn').onclick = async () => {
    await deleteDoc(doc(db,`channels/${currentChannel.id}/messages`,id));
    closeModal();
  };
};

// ── Reactions ──

// Emoji Reaction System
const REACTION_DEFS = {
  thumbsup:    { label: '👍 Like',         emoji: '👍' },
  thumbsdown:  { label: '👎 Dislike',      emoji: '👎' },
  fire:        { label: '🔥 Fire',         emoji: '🔥' },
  wilted:      { label: '🥀 Wilted',       emoji: '🥀' },
  heartbreak:  { label: '💔 Heartbreak',   emoji: '💔' },
  skull:       { label: '💀 Skull',        emoji: '💀' },
  laugh:       { label: '😂 LOL',          emoji: '😂' },
  mindblown:   { label: '🤯 Mind Blown',   emoji: '🤯' },
  wave:        { label: '👋 Wave',         emoji: '👋' },
  star:        { label: '⭐ Star',         emoji: '⭐' },
  party:       { label: '🎉 Party',        emoji: '🎉' },
  goat:        { label: '🐐 GOAT',         emoji: '🐐' },
};

const REACTION_KEYS = Object.keys(REACTION_DEFS);

// window.addReaction — emoji picker
window.addReaction = function(msgId) {
  // Remove any existing picker
  document.querySelectorAll('.epicker').forEach(p=>p.remove());
  const el = document.getElementById('msg-'+msgId);
  if(!el) return;
  const picker = document.createElement('div');
  picker.className = 'epicker';
  const rect = el.getBoundingClientRect();
  const top = Math.min(rect.bottom + 4, window.innerHeight - 200);
  const left = Math.min(rect.left, window.innerWidth - 270);
  picker.style.top = (window.scrollY + top) + 'px';
  picker.style.left = left + 'px';

  REACTION_KEYS.forEach(key => {
    const def = REACTION_DEFS[key];
    const opt = document.createElement('button');
    opt.className = 'eopt';
    opt.title = def.label;
    opt.style.cssText = 'font-size:1.25rem;width:38px;height:38px';
    opt.textContent = def.emoji;
    opt.addEventListener('click', () => { toggleReaction(msgId, key); picker.remove(); });
    picker.appendChild(opt);
  });

  document.body.appendChild(picker);
  setTimeout(() => {
    function onOutside(e) {
      if(!picker.contains(e.target)) { picker.remove(); document.removeEventListener('click', onOutside); }
    }
    document.addEventListener('click', onOutside, false);
  }, 10);
};

// renderReactions — emoji chips
function renderReactions(container, reactions, msgId) {
  if(!container) return;
  container.innerHTML = '';
  Object.entries(reactions).forEach(([key, uids]) => {
    if(!uids||!uids.length) return;
    const mine = typeof currentUser !== 'undefined' && uids.includes(currentUser.uid);
    const def = REACTION_DEFS[key];
    const emoji = def?.emoji || key;
    const chip = document.createElement('span');
    chip.className = `rchip${mine?' mine':''}`;
    chip.title = def?.label || key;
    chip.innerHTML = `<span style="font-size:.95rem;line-height:1">${emoji}</span><span class="rcnt">${uids.length}</span>`;
    chip.addEventListener('click', () => toggleReaction(msgId, key));
    container.appendChild(chip);
  });
}

// ── Members — sorted by rank, no presence, no count in header ──
function loadMembers(ch) {
  const list = document.getElementById('members-list');
  if(!list) return;
  if(membersUnsub) membersUnsub();

  function _memberItemHtml(u) {
    const avaHtml = avatarHtml(u.icon, u.username, '60%');
    const color = u.color || avatarColor(u.uid);
    return `<div class="ms-item" onclick="window._openProfile('${u.uid}')" title="${escHtml(u.username)} · ${u.rank}">
      <div class="ms-ava" style="background:${color}">${avaHtml}</div>
      <span class="ms-name">${escHtml(u.username)}</span>
      <span class="rbadge ${u.rank}" style="flex-shrink:0;font-size:.45rem">${u.rank.toUpperCase()}</span>
    </div>`;
  }

  const userUnsub = onSnapshot(
    query(collection(db,'users'), where('status','==','approved')),
    snap => {
      let users = snap.docs.map(d=>d.data());
      users = users.filter(u => {
        if(ch.adminOnly) return canModerate(u.rank);
        return canChat(u.rank);
      });
      users.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
      // Update header with count (no "Members — N" remnant, just count in pill)
      const msHeader = document.querySelector('.ms-header');
      if(msHeader) {
        // Keep the icon + "Members" text, add/update count pill
        let pill = msHeader.querySelector('.ms-count');
        if(!pill) {
          pill = document.createElement('span');
          pill.className = 'ms-count';
          msHeader.appendChild(pill);
        }
        pill.textContent = users.length;
      }
      let html = '';
      users.forEach(u => { html += _memberItemHtml(u); });
      list.innerHTML = html || '<div class="ms-empty">No members</div>';
    }
  );

  membersUnsub = () => { userUnsub(); };
}

// ── Create Channel Modal ──
function showCreateChannelModal() {
  showModal(`
    <h3>New Channel</h3>
    <p class="modal-p">Create a new custom channel.</p>
    <div class="field-group"><label class="field-label">Channel Name</label><input id="m-chname" class="field-input" placeholder="my-channel" maxlength="32"></div>
    <div class="field-group"><label class="field-label">Minimum Rank</label>
      <select id="m-chrank" class="field-input">
        <option value="planetary">Planetary</option>
        <option value="solar">Solar</option>
        <option value="galactic">Galactic</option>
        <option value="universal">Universal+</option>
      </select>
    </div>
    <div class="field-group" style="display:flex;align-items:center;gap:.5rem">
      <input type="checkbox" id="m-chann"> <label for="m-chann" style="font-size:.78rem">Announce only (Universal+ posts, others view)</label>
    </div>
    <div class="field-group" style="display:flex;align-items:center;gap:.5rem">
      <input type="checkbox" id="m-chpwd" onchange="document.getElementById('m-pwdfield').classList.toggle('hidden',!this.checked)">
      <label for="m-chpwd" style="font-size:.78rem">Password protected</label>
    </div>
    <div id="m-pwdfield" class="field-group hidden"><label class="field-label">Password</label><input id="m-chpwdval" class="field-input" type="text" placeholder="Channel password"></div>
    <div class="merr" id="m-cherr"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-sm" onclick="window.createChannel()">Create Channel</button>
    </div>
  `);
}

// ── Wipe Thread (goat only) ──
window.wipeThread = function(channelId, channelName) {
  if(currentUserData?.rank !== 'goat') return;
  showModal(`
    <h3>Wipe #${channelName}?</h3>
    <p class="modal-p">This permanently deletes <strong>all messages</strong> in this channel. The channel itself stays. This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-wipe-btn">Wipe All Messages</button>
    </div>
  `);
  document.getElementById('confirm-wipe-btn').onclick = async () => {
    try {
      const msgsRef = collection(db, 'channels/' + channelId + '/messages');
      const snap = await getDocs(msgsRef);
      if(snap.empty) { closeModal(); toast('No messages to wipe.', 'info'); return; }
      // Firestore batches max 500 ops
      const batchSize = 499;
      let batch = writeBatch(db);
      let count = 0;
      for(const d of snap.docs) {
        batch.delete(d.ref);
        count++;
        if(count % batchSize === 0) { await batch.commit(); batch = writeBatch(db); }
      }
      if(count % batchSize !== 0) await batch.commit();
      closeModal(() => toast('Wiped ' + snap.size + ' messages from #' + channelName + '.', 'success'));
    } catch(e) { toast('Wipe failed: '+e.message, 'error'); }
  };
};

window.deleteChannel = function(id, name) {
  showModal(`
    <h3>Delete #${name}</h3>
    <p class="modal-p">This will permanently delete the channel and all its messages. This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-delch-btn">Delete Channel</button>
    </div>
  `);
  document.getElementById('confirm-delch-btn').onclick = async () => {
    try {
      await deleteDoc(doc(db,'channels',id));
      closeModal(() => { loadChannelsList(); toast(`#${name} deleted`,'success'); });
    } catch(e) { toast('Failed to delete channel','error'); }
  };
};

window.createChannel = async function() {
  const name = document.getElementById('m-chname')?.value.trim().toLowerCase().replace(/\s+/g,'-');
  const minRank = document.getElementById('m-chrank')?.value;
  const announce = document.getElementById('m-chann')?.checked;
  const pwdProt = document.getElementById('m-chpwd')?.checked;
  const pwd = document.getElementById('m-chpwdval')?.value;
  const err = document.getElementById('m-cherr');
  if(!name||name.length<2) { if(err) err.textContent='Name too short'; return; }
  try {
    await addDoc(collection(db,'channels'),{
      name, icon:'#', announce, passwordProtected:pwdProt, password:pwdProt?pwd:'',
      minRank, adminOnly:false, createdAt:serverTimestamp(), createdBy:currentUser.uid
    });
    closeModal(()=>{ loadChannelsList(); toast('Channel created.','success'); });
  } catch(e) { if(err) err.textContent=e.message; }
};

// ── DMs ──
function initDMs() {
  const searchInp = document.getElementById('dm-search-input');
  const searchWrap = document.getElementById('dm-search-wrap');
  if(!searchInp || !searchWrap) return;

  let searchResults = null;

  searchInp.addEventListener('input', async () => {
    const q = searchInp.value.trim().toLowerCase();
    if(!q) { if(searchResults) { searchResults.remove(); searchResults=null; } return; }
    const snap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
    const matches = snap.docs.map(d=>d.data()).filter(u=>u.uid!==currentUser.uid && u.username.toLowerCase().includes(q));
    if(!searchResults) { searchResults=document.createElement('div'); searchResults.className='dm-search-results'; searchWrap.style.position='relative'; searchWrap.appendChild(searchResults); }
    searchResults.innerHTML = '';
    matches.slice(0,6).forEach(u => {
      const item = document.createElement('div');
      item.className = 'dm-search-result-item';
      item.innerHTML = `<div class="ms-ava" style="background:${u.color||avatarColor(u.uid)};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;flex-shrink:0">${avatarHtml(u.icon,u.username,'60%')}</div><span>${escHtml(u.username)}</span><span class="rbadge ${u.rank}" style="margin-left:auto">${u.rank}</span>`;
      item.addEventListener('click', () => { openDM(u); searchInp.value=''; searchResults.remove(); searchResults=null; });
      searchResults.appendChild(item);
    });
  });

  loadDMList();
}

async function loadDMList() {
  const list = document.getElementById('dm-list');
  if(!list) return;
  const snap = await getDocs(query(collection(db,'dms'), where('participants','array-contains',currentUser.uid), orderBy('lastTs','desc')));
  list.innerHTML = '';
  for(const d of snap.docs) {
    const data = d.data();
    const otherId = data.participants.find(x=>x!==currentUser.uid);
    let other = _userCache[otherId];
    if(!other) {
      const otherSnap = await getDoc(doc(db,'users',otherId));
      if(!otherSnap.exists()) continue;
      other = otherSnap.data();
      _userCache[otherId] = other;
    }
    const item = document.createElement('div');
    item.className = 'titem';
    item.dataset.dmid = d.id;
    const ava = document.createElement('div'); ava.className='titem-ava'; ava.style.background=other.color||avatarColor(other.uid||''); ava.innerHTML=avatarHtml(other.icon,other.username,'60%'); item.appendChild(ava);
    const nm=document.createElement('span'); nm.className='titem-name'; nm.textContent=other.username; item.appendChild(nm);
    item.addEventListener('click', ()=>openDM(other, d.id));
    list.appendChild(item);
  }
}

async function openDM(otherUser, existingDmId) {
  let dmId = existingDmId;
  if(!dmId) {
    const q1 = query(collection(db,'dms'), where('participants','array-contains',currentUser.uid));
    const snap = await getDocs(q1);
    const existing = snap.docs.find(d => d.data().participants.includes(otherUser.uid));
    if(existing) dmId = existing.id;
    else {
      const ref = await addDoc(collection(db,'dms'),{
        participants:[currentUser.uid,otherUser.uid], lastTs:serverTimestamp()
      });
      dmId = ref.id;
      await loadDMList();
    }
  }
  currentDM = {id:dmId, otherUser};
  _unreadDMs[dmId] = 0;
  _markSeen('dm_' + dmId, Date.now());
  _updateDMBadge(); _updateDMListBadges();

  document.querySelectorAll('#dm-list .titem').forEach(i=>i.classList.toggle('active',i.dataset.dmid===dmId));

  const win = document.getElementById('dm-window');
  const noSel = document.getElementById('dm-no-select');
  win.classList.remove('hidden');
  noSel.classList.add('hidden');
  document.getElementById('dm-channel-name').textContent = otherUser.username;

  const msgsWrap = document.getElementById('dm-messages-wrap');
  msgsWrap.innerHTML = '<div class="messages" id="dm-messages"></div>';

  if(dmUnsub) dmUnsub();
  // Unsub previous DM typing listener and set up per-DM typing via RTDB
  if(_typingUnsub) { _typingUnsub(); _typingUnsub = null; }
  if(_rtdb) {
    const dmTypingRef = rtRef(_rtdb, 'typing_dm/' + dmId);
    const rtDmOff = onValue(dmTypingRef, snap => {
      const data = snap.val() || {};
      const typists = Object.entries(data).filter(([uid, v]) => {
        if(uid === currentUser.uid) return false;
        return (Date.now() - (v?.ts || 0)) < 4000;
      }).map(([_, v]) => v.username);
      const bar = document.getElementById('dm-typing-bar');
      if(typists.length && bar) {
        bar.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' + typists.join(', ') + ' ' + (typists.length===1?'is':'are') + ' typing...</span>';
      } else if(bar) bar.innerHTML = '';
    });
    _typingUnsub = () => rtDmOff();
  }
  let dmInitialized = false;
  let dmLastSender = null, dmLastTime = null;
  dmUnsub = onSnapshot(
    query(collection(db,`dms/${dmId}/messages`), orderBy('ts','asc'), limit(50)),
    snap => {
      const msgs = document.getElementById('dm-messages');
      if(!msgs) return;
      if(!dmInitialized) {
        msgs.innerHTML = '';
        dmLastSender = null; dmLastTime = null;
        snap.docs.forEach(d => {
          const el = appendDMMsg(d.id, d.data(), msgs, dmLastSender, dmLastTime);
          dmLastSender = d.data().uid; dmLastTime = d.data().ts?.toMillis()||Date.now();
        });
        dmInitialized = true;
        scrollToDMBottom(true);
      } else {
        snap.docChanges().forEach(change => {
          if(change.type==='added') {
            appendDMMsg(change.doc.id, change.doc.data(), msgs, dmLastSender, dmLastTime);
            dmLastSender = change.doc.data().uid; dmLastTime = change.doc.data().ts?.toMillis()||Date.now();
            scrollToDMBottom();
            const isDMActive = document.getElementById('section-dms')?.classList.contains('active');
            const isThisDM = currentDM?.id === dmId;
            if((!isDMActive || !isThisDM) && _unreadEnabled) {
              if(change.doc.data().uid !== currentUser?.uid) {
                _unreadDMs[dmId] = (_unreadDMs[dmId]||0)+1;
                _updateDMBadge(); _updateDMListBadges();
              }
            } else {
              const ts = change.doc.data().ts?.toMillis ? change.doc.data().ts.toMillis() : Date.now();
              _markSeen('dm_' + dmId, ts);
            }
          } else if(change.type==='removed') {
            document.getElementById('msg-'+change.doc.id)?.remove();
          }
        });
      }
    }
  );

  document.getElementById('dm-input').placeholder = `Message ${otherUser.username}`;
}

function appendDMMsg(id, data, container, prevSender=null, prevTime=null) {
  const isFirst = data.uid !== prevSender || !prevTime || (data.ts?.toMillis()-prevTime)>300000;
  const ts = data.ts?.toDate?data.ts.toDate():new Date();
  const tsStr = ts.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  const color = data.color||avatarColor(data.uid||'');
  const canDelete = data.uid===currentUser.uid || canModerate(currentUserData.rank);
  const el = document.createElement('div');
  el.className=`msg${isFirst?' first-in-group':''}`;
  el.id='msg-'+id;
  if(isFirst) {
    el.innerHTML=`<div class="msg-ava-wrap"><div class="msg-ava" style="background:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${avatarHtml(data.icon,data.username,"60%")}</div></div><div class="msg-content"><div class="msg-header"><span class="msg-name" style="color:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${escHtml(data.username)}</span><span class="msg-ts">${tsStr}</span></div><div class="msg-text">${formatMsg(data.text||'')}</div></div><div class="msg-actions">${canDelete?`<button class="mab d" onclick="window.deleteDM('${id}')">Del</button>`:''}</div>`;
  } else {
    el.innerHTML=`<div class="msg-ava-wrap"><div class="msg-ava-spacer"></div></div><div class="msg-content"><div class="msg-text">${formatMsg(data.text||'')}</div></div><div class="msg-actions"><span class="msg-ts-inline">${tsStr}</span>${canDelete?`<button class="mab d" onclick="window.deleteDM('${id}')">Del</button>`:''}</div>`;
  }
  container.appendChild(el);
}

window.deleteDM = function(id) {
  if(!currentDM) return;
  showModal(`
    <h3>Delete Message</h3>
    <p class="modal-p">This message will be permanently removed.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-del-dm-btn">Delete</button>
    </div>
  `);
  document.getElementById('confirm-del-dm-btn').onclick = async () => {
    await deleteDoc(doc(db,`dms/${currentDM.id}/messages`,id));
    closeModal();
  };
};

function scrollToDMBottom(force=false) {
  const wrap = document.getElementById('dm-messages-wrap');
  if(!wrap) return;
  const nearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
  if(force || nearBottom) wrap.scrollTop = wrap.scrollHeight;
}

function setupDMInput() {
  const input = document.getElementById('dm-input');
  const sendBtn = document.getElementById('dm-send-btn');
  if(!input||!sendBtn) return;
  input.addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey) { e.preventDefault(); sendDM(); } });
  sendBtn.addEventListener('click', sendDM);
  // DM typing indicator (RTDB) — per DM thread
  let dmTypingDebounce = null;
  input.addEventListener('input', () => {
    if(!currentDM || !_rtdb) return;
    clearTimeout(dmTypingDebounce);
    dmTypingDebounce = setTimeout(() => {
      const typRef = rtRef(_rtdb, 'typing_dm/' + currentDM.id + '/' + currentUser.uid);
      rtSet(typRef, { username: currentUserData.username, ts: Date.now() }).catch(()=>{});
      setTimeout(() => remove(typRef).catch(()=>{}), 4000);
    }, 300);
  });
}

async function sendDM() {
  const input = document.getElementById('dm-input');
  const text = input.value.trim();
  if(!text || !currentDM) return;
  if(text.length>500) { toast('Message is too long (max 500 chars).', 'warning'); return; }
  input.value = '';
  await addDoc(collection(db,`dms/${currentDM.id}/messages`),{
    uid:currentUser.uid, username:currentUserData.username,
    color:currentUserData.color, icon:currentUserData.icon||'',
    badges:currentUserData.badges||[], text, ts:serverTimestamp()
  });
  await updateDoc(doc(db,'dms',currentDM.id),{lastTs:serverTimestamp()});
}

// ── Profile ──
const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#a855f7','#10b981','#0ea5e9','#f59e0b','#64748b'];

function setupProfile() {
  renderOwnProfile(currentUser, currentUserData, getGoatCoinData());
  renderProfileEdit();
}

export const SVG_ICONS = {
    star:    '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    bolt:    '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    flame:   '<path d="M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 01-7 7 7 7 0 01-7-7c0-1.53.4-2.973 1.1-4.2.31-.477.63-.913.9-1.3"/>',
    diamond: '<path d="M2.7 10.3a2.41 2.41 0 000 3.41l7.59 7.59a2.41 2.41 0 003.41 0l7.59-7.59a2.41 2.41 0 000-3.41L13.7 2.71a2.41 2.41 0 00-3.41 0z"/>',
    target:  '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    rocket:  '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
    wave:    '<path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/>',
    moon:    '<path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>',
    sun:     '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
    rainbow: '<path d="M22 17a10 10 0 00-20 0"/><path d="M6 17a6 6 0 0112 0"/><path d="M10 17a2 2 0 014 0"/>',
    skull:   '<circle cx="12" cy="11" r="5"/><path d="M9 11v2"/><path d="M15 11v2"/><path d="M9 16c0 1 .5 1.5 1.5 1.5h3c1 0 1.5-.5 1.5-1.5v-1H9v1z"/><path d="M7 8c-1-2 0-5 3-5s3 2 3 2 1-2 3-2 4 3 3 5"/>',
    shield:  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    crown:   '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>',
    trophy:  '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4H4v7a8 8 0 0016 0V4h-3"/><path d="M7 4h10"/>',
    controller:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/>',
    dice:    '<rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5"/><circle cx="16" cy="16" r="1.5"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="8" r="1.5"/><circle cx="12" cy="12" r="1.5"/>',
    planet:  '<circle cx="12" cy="12" r="7"/><path d="M21.17 8.17C22.87 5.52 23.1 3.16 22 2.06c-1.1-1.1-3.46-.87-6.11.83"/><path d="M2.83 15.83C1.13 18.48.9 20.84 2 21.94c1.1 1.1 3.46.87 6.11-.83"/>',
    heart:   '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>',
    eye:     '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    infinity:'<path d="M12 12c-2-2.5-4-4-6-4a4 4 0 000 8c2 0 4-1.5 6-4z"/><path d="M12 12c2 2.5 4 4 6 4a4 4 0 000-8c-2 0-4 1.5-6 4z"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    feather: '<path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',
    music:   '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    ghost:   '<path d="M9 10h.01M15 10h.01M12 2C6.48 2 2 6.48 2 12v10l3-3 2 2 2-2 2 2 2-2 2 2 3-3V12c0-5.52-4.48-10-10-10z"/>',
    anchor:  '<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0020 0h-3"/>',
    activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    lock:    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    key:     '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
};

export function avatarHtml(iconKey, username, size='100%') {
  if(!iconKey) return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
  const paths = SVG_ICONS[iconKey];
  if(paths) return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  if(iconKey === 'goat') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>`;
  return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
}

// ── Propagate profile changes (username/color/icon/badges) to all existing messages ──
window.propagateProfileToMessages = propagateProfileToMessages;
async function propagateProfileToMessages(uid, updates) {
  // Update channel messages
  try {
    const channelDocs = [...Object.keys(Object.fromEntries(
      (await getDocs(collection(db,'channels'))).docs.map(d=>[d.id,true])
    ))];
    const hardcoded = ['general','admin'];
    const allChannels = [...new Set([...hardcoded, ...channelDocs])];

    for(const chId of allChannels) {
      const msgsSnap = await getDocs(
        query(collection(db,`channels/${chId}/messages`), where('uid','==',uid))
      );
      if(msgsSnap.empty) continue;
      const batch = writeBatch(db);
      msgsSnap.docs.forEach(d => batch.update(d.ref, updates));
      await batch.commit();
    }
  } catch(e) {
    console.warn('Propagate to channels failed:', e);
  }

  // Update DM messages
  try {
    const dmsSnap = await getDocs(
      query(collection(db,'dms'), where('participants','array-contains',uid))
    );
    for(const dm of dmsSnap.docs) {
      const msgsSnap = await getDocs(
        query(collection(db,`dms/${dm.id}/messages`), where('uid','==',uid))
      );
      if(msgsSnap.empty) continue;
      const batch = writeBatch(db);
      msgsSnap.docs.forEach(d => batch.update(d.ref, updates));
      await batch.commit();
    }
  } catch(e) {
    console.warn('Propagate to DMs failed:', e);
  }
}

function renderProfileEdit() {
  const d = currentUserData;
  const section = document.getElementById('prof-edit-section');
  if(!section) return;

  const lastChange = d.lastUsernameChange?.toDate ? d.lastUsernameChange.toDate() : null;
  const canChangeUsername = !lastChange || (Date.now() - lastChange.getTime()) > 7*24*60*60*1000;
  const cooldownDays = lastChange ? Math.ceil((7*24*60*60*1000 - (Date.now()-lastChange.getTime())) / (24*60*60*1000)) : 0;

  const memberSince = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString('en-US',{month:'long',year:'numeric'}) : 'Unknown';

  section.innerHTML = `
    <!-- Avatar & Customization -->
    <div class="prof-panel" id="prof-color-section">
      <div class="prof-panel-hdr">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
        Avatar &amp; Color
      </div>
      <div class="prof-panel-sub">Pick an icon and color for your avatar across Nebula.</div>
      <div class="prof-avatar-preview-row">
        <div class="prof-ava-preview" id="prof-ava-preview" style="background:${d.color||avatarColor(d.uid)}">${avatarHtml(d.icon, d.username, '55%')}</div>
        <div class="prof-ava-preview-info">
          <div class="prof-ava-preview-name">${escHtml(d.username)}</div>
          <div class="prof-ava-preview-meta">Member since ${memberSince}</div>
          <div class="prof-ava-preview-rank">${renderRankBadge(d.rank)}</div>
        </div>
      </div>
      <div class="prof-panel-sub" style="margin-top:1rem">Icon</div>
      <div class="ava-icon-grid" id="ava-icon-grid"></div>
      <div class="prof-panel-sub" style="margin-top:1rem">Color</div>
      <div class="color-swatches" id="color-swatches"></div>
    </div>

    <!-- Username -->
    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        Username
        ${!canChangeUsername ? `<span class="prof-panel-badge">Cooldown: ${cooldownDays}d</span>` : '<span class="prof-panel-badge prof-panel-badge-ok">Available</span>'}
      </div>
      <div class="prof-panel-sub">${canChangeUsername ? 'Choose your display name (3–20 chars, letters/numbers/underscores).' : `Username changes are on cooldown. Available in ${cooldownDays} day${cooldownDays!==1?'s':''}.`}</div>
      <div class="prof-row">
        <input id="prof-username-inp" class="field-input" type="text" value="${escHtml(d.username)}" maxlength="20" placeholder="Username" ${canChangeUsername?'':'disabled'}>
        <button class="btn btn-sm" id="prof-username-btn" ${canChangeUsername?'':'disabled'}>Save</button>
      </div>
      <div class="merr" id="prof-username-err"></div>
    </div>

    <!-- Email -->
    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Email Address
      </div>
      <div class="prof-panel-sub">Your login email. Changing it requires re-authentication.</div>
      <div class="prof-row">
        <input id="prof-email-inp" class="field-input" type="email" value="${escHtml(d.email||auth.currentUser?.email||'')}" placeholder="your@email.com">
        <button class="btn btn-sm" id="prof-email-btn">Update</button>
      </div>
      <div class="merr" id="prof-email-err"></div>
    </div>

    <!-- Password -->
    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Change Password
      </div>
      <div class="prof-panel-sub">Must be at least 6 characters. Current password required.</div>
      <div class="prof-fields">
        <input id="prof-pass-cur"  class="field-input" type="password" placeholder="Current password">
        <input id="prof-pass-new"  class="field-input" type="password" placeholder="New password (min 6 chars)">
        <input id="prof-pass-conf" class="field-input" type="password" placeholder="Confirm new password">
      </div>
      <button class="btn btn-sm" id="prof-pass-btn">Change Password</button>
      <div class="merr" id="prof-pass-err"></div>
    </div>
  `;

  // Color swatches
  const swatchWrap = document.getElementById('color-swatches');
  AVATAR_COLORS.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch' + (color === (d.color||avatarColor(d.uid)) ? ' selected' : '');
    sw.style.background = color;
    sw.addEventListener('click', async () => {
      document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      await updateDoc(doc(db,'users',currentUser.uid), {color});
      currentUserData.color = color;
      const spAva = document.getElementById('sp-ava');
      if(spAva) spAva.style.background = color;
      const profAva = document.getElementById('prof-ava');
      if(profAva) profAva.style.background = color;
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-ava`).forEach(el => el.style.background = color);
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-name`).forEach(el => el.style.color = color);
      // Propagate to old messages in background
      propagateProfileToMessages(currentUser.uid, { color }).catch(()=>{});
      toast('Avatar color updated.','success');
    });
    swatchWrap.appendChild(sw);
  });

  // Icon grid
  const iconGrid = document.getElementById('ava-icon-grid');
  if(iconGrid) {
    const letterOpt = document.createElement('div');
    letterOpt.className = 'ava-icon-opt' + (!d.icon ? ' selected' : '');
    letterOpt.title = 'Use your initial';
    letterOpt.innerHTML = `<span style="font-weight:900;font-size:1rem">${avatarInitial(d.username)}</span>`;
    letterOpt.addEventListener('click', async () => {
      iconGrid.querySelectorAll('.ava-icon-opt').forEach(x=>x.classList.remove('selected'));
      letterOpt.classList.add('selected');
      await updateDoc(doc(db,'users',currentUser.uid), {icon:''});
      currentUserData.icon = '';
      _updateAvaDisplay('');
      propagateProfileToMessages(currentUser.uid, { icon: '' }).catch(()=>{});
      toast('Avatar updated.','success');
    });
    iconGrid.appendChild(letterOpt);

    if(d.rank === 'goat') {
      const goatPaths = '<path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/>';
      const goatOpt = document.createElement('div');
      goatOpt.className = 'ava-icon-opt ava-icon-goat' + (d.icon === 'goat' ? ' selected' : '');
      goatOpt.title = 'Goat (exclusive)';
      goatOpt.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${goatPaths}</svg>`;
      goatOpt.addEventListener('click', async () => {
        iconGrid.querySelectorAll('.ava-icon-opt').forEach(x=>x.classList.remove('selected'));
        goatOpt.classList.add('selected');
        await updateDoc(doc(db,'users',currentUser.uid), {icon:'goat'});
        currentUserData.icon = 'goat';
        _updateAvaDisplay('goat');
        propagateProfileToMessages(currentUser.uid, { icon: 'goat' }).catch(()=>{});
        toast('Avatar updated.','success');
      });
      iconGrid.appendChild(goatOpt);
    }

    Object.entries(SVG_ICONS).forEach(([key, paths]) => {
      const opt = document.createElement('div');
      opt.className = 'ava-icon-opt' + (d.icon === key ? ' selected' : '');
      opt.title = key;
      opt.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
      opt.addEventListener('click', async () => {
        iconGrid.querySelectorAll('.ava-icon-opt').forEach(x=>x.classList.remove('selected'));
        opt.classList.add('selected');
        await updateDoc(doc(db,'users',currentUser.uid), {icon:key});
        currentUserData.icon = key;
        _updateAvaDisplay(key);
        propagateProfileToMessages(currentUser.uid, { icon: key }).catch(()=>{});
        toast('Avatar updated.','success');
      });
      iconGrid.appendChild(opt);
    });
  }

  function _updateAvaDisplay(iconKey) {
    const html = avatarHtml(iconKey, d.username, '60%');
    const sp = document.getElementById('sp-ava');
    if(sp) sp.innerHTML = html;
    const profAva = document.getElementById('prof-ava');
    if(profAva) profAva.innerHTML = avatarHtml(iconKey, d.username, '55%');
    // Also update the inline preview in profile edit section
    const preview = document.getElementById('prof-ava-preview');
    if(preview) preview.innerHTML = avatarHtml(iconKey, d.username, '55%');
  }

  // Username save
  document.getElementById('prof-username-btn')?.addEventListener('click', async () => {
    const inp = document.getElementById('prof-username-inp');
    const err = document.getElementById('prof-username-err');
    const newName = inp.value.trim();
    err.textContent = '';
    if(!newName || newName.length < 3) { err.textContent='Min 3 characters'; return; }
    if(newName.length > 20) { err.textContent='Max 20 characters'; return; }
    if(!/^[a-zA-Z0-9_]+$/.test(newName)) { err.textContent='Letters, numbers, underscores only'; return; }
    if(newName === d.username) { err.textContent='Same as current username'; return; }
    const snap = await getDocs(query(collection(db,'users'), where('username','==',newName)));
    if(!snap.empty) { err.textContent='Username already taken'; return; }
    try {
      await updateDoc(doc(db,'users',currentUser.uid), { username: newName, lastUsernameChange: serverTimestamp() });
      currentUserData.username = newName;
      _userCache[currentUser.uid] = currentUserData;
      document.getElementById('sp-name').textContent = newName;
      const pn=document.getElementById('prof-name'); if(pn) pn.textContent=newName;
      toast('Username updated. Propagating to messages...','success');
      // Propagate username change to all old messages
      propagateProfileToMessages(currentUser.uid, { username: newName }).catch(()=>{});
      renderProfileEdit();
    } catch(e) { err.textContent = e.message; }
  });

  // Email update
  document.getElementById('prof-email-btn')?.addEventListener('click', async () => {
    const err = document.getElementById('prof-email-err');
    const newEmail = document.getElementById('prof-email-inp').value.trim();
    err.textContent = '';
    if(!newEmail) { err.textContent='Enter an email'; return; }
    showModal(`
      <h3>Confirm Identity</h3>
      <p class="modal-p">Enter your current password to update your email address.</p>
      <div class="field-group"><label class="field-label">Current Password</label><input id="m-reauth-pass" class="field-input" type="password" placeholder="••••••••" autocomplete="current-password"></div>
      <div class="merr" id="m-reauth-err"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
        <button class="btn btn-sm" id="m-reauth-btn">Confirm & Update</button>
      </div>
    `);
    setTimeout(()=>document.getElementById('m-reauth-pass')?.focus(),80);
    document.getElementById('m-reauth-btn').onclick = async () => {
      const pass = document.getElementById('m-reauth-pass').value;
      const merr = document.getElementById('m-reauth-err');
      if(!pass) { merr.textContent='Enter your password'; return; }
      try {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, pass);
        await reauthenticateWithCredential(auth.currentUser, cred);
        await updateEmail(auth.currentUser, newEmail);
        await updateDoc(doc(db,'users',currentUser.uid), { email: newEmail });
        currentUserData.email = newEmail;
        closeModal(() => toast('Email updated!','success'));
      } catch(e) {
        const msgs = { 'auth/wrong-password':'Wrong password','auth/email-already-in-use':'Email already in use','auth/invalid-email':'Invalid email' };
        if(merr) merr.textContent = msgs[e.code] || e.message;
      }
    };
  });

  // Password change
  document.getElementById('prof-pass-btn')?.addEventListener('click', async () => {
    const err = document.getElementById('prof-pass-err');
    const cur = document.getElementById('prof-pass-cur').value;
    const newP = document.getElementById('prof-pass-new').value;
    const conf = document.getElementById('prof-pass-conf').value;
    err.textContent = '';
    if(!cur) { err.textContent='Enter current password'; return; }
    if(!newP || newP.length < 6) { err.textContent='New password must be at least 6 characters'; return; }
    if(newP !== conf) { err.textContent='Passwords do not match'; return; }
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, cur);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newP);
      document.getElementById('prof-pass-cur').value = '';
      document.getElementById('prof-pass-new').value = '';
      document.getElementById('prof-pass-conf').value = '';
      toast('Password changed!','success');
    } catch(e) {
      const msgs = { 'auth/wrong-password':'Wrong password','auth/weak-password':'Password too weak' };
      err.textContent = msgs[e.code] || e.message;
    }
  });
}

// ── Settings ──
function setupSettings() {
  document.querySelectorAll('.stab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('sp-' + t.dataset.tab)?.classList.add('active');
    });
  });

  const currentTheme = loadTheme();
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.theme === currentTheme);
    card.addEventListener('click', () => {
      document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      applyTheme(card.dataset.theme);
      toast('Theme applied!', 'success');
    });
  });

  const DEFAULTS = {
    compact: false, parallax: true, 'ts-hover': false, 'msg-anim': true,
    'compact-sidebar': false, 'show-rank': true, 'reduce-motion': false,
    'nav-labels': true, 'nav-glow': true, chat: true, dm: true, mentions: true,
    'chat-sound': false, 'dm-sound': true, 'chat-ranks': true, 'link-previews': true,
    'enter-send': true, 'char-counter': true, 'typing-indicators': true,
    'theme-anim': true, 'high-contrast': false, 'line-spacing': false, 'focus-mode': false,
  };

  document.querySelectorAll('.notif-toggle').forEach(toggle => {
    const k = toggle.dataset.key;
    const stored = localStorage.getItem('neb_notif_' + k);
    const def = DEFAULTS[k] ?? true;
    toggle.checked = stored !== null ? stored === 'true' : def;
  });

  applyAllToggles();
  syncDepSettings();

  document.querySelectorAll('.notif-toggle').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const k = toggle.dataset.key;
      localStorage.setItem('neb_notif_' + k, toggle.checked);
      applyToggle(k, toggle.checked);
      syncDepSettings();
    });
  });

  const savedSize = localStorage.getItem('neb_fontsize') || '15';
  document.querySelectorAll('.size-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.size === savedSize);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.size-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.style.setProperty('--base-font-size', btn.dataset.size + 'px');
      localStorage.setItem('neb_fontsize', btn.dataset.size);
    });
  });
  document.documentElement.style.setProperty('--base-font-size', savedSize + 'px');

  const savedBlur = localStorage.getItem('neb_blur') || '20';
  document.querySelectorAll('.blur-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.blur === savedBlur);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.blur-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.style.setProperty('--ui-blur', btn.dataset.blur + 'px');
      localStorage.setItem('neb_blur', btn.dataset.blur);
    });
  });
  document.documentElement.style.setProperty('--ui-blur', savedBlur + 'px');

  const savedSidebarW = localStorage.getItem('neb_sidebar_w') || '224';
  document.querySelectorAll('.sidebar-w-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.w === savedSidebarW);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sidebar-w-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.documentElement.style.setProperty('--sidebar-w', btn.dataset.w + 'px');
      localStorage.setItem('neb_sidebar_w', btn.dataset.w);
    });
  });
  document.documentElement.style.setProperty('--sidebar-w', savedSidebarW + 'px');

  const savedSpeed = localStorage.getItem('neb_parallax_speed') || '0.03';
  document.querySelectorAll('.parallax-speed-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.speed === savedSpeed);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.parallax-speed-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window._parallaxSpeed = parseFloat(btn.dataset.speed);
      localStorage.setItem('neb_parallax_speed', btn.dataset.speed);
    });
  });
  window._parallaxSpeed = parseFloat(savedSpeed);

  const savedGroup = localStorage.getItem('neb_group_mins') || '5';
  window._groupMins = parseInt(savedGroup);
  document.querySelectorAll('.group-time-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mins === savedGroup);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.group-time-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      window._groupMins = parseInt(btn.dataset.mins);
      localStorage.setItem('neb_group_mins', btn.dataset.mins);
    });
  });

  const currentLayout = loadLayout();
  document.querySelectorAll('.layout-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === currentLayout);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const layout = btn.dataset.layout;
      applyLayout(layout);
      const noLabels = layout === 'topbar' || layout === 'bottombar';
      const labelsToggle = document.querySelector('.notif-toggle[data-key="nav-labels"]');
      if(labelsToggle) {
        if(noLabels) {
          labelsToggle.checked = false;
          applyToggle('nav-labels', false);
        } else {
          const stored = localStorage.getItem('neb_notif_nav-labels');
          const on = stored === null || stored === 'true';
          labelsToggle.checked = on;
          applyToggle('nav-labels', on);
        }
      }
      const isSidebar = layout === 'default' || layout === 'sidebar-right';
      document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebar);
      document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebar);
      document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabels);
      syncDepSettings();
    });
  });
  const noLabelsOnLoad = currentLayout === 'topbar' || currentLayout === 'bottombar';
  const isSidebarOnLoad = currentLayout === 'default' || currentLayout === 'sidebar-right';
  document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebarOnLoad);
  document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebarOnLoad);
  document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabelsOnLoad);

  buildChannelNotifList();
}

function applyToggle(k, val) {
  if(k === 'unread-badges') {
    _unreadEnabled = val;
    if(!val) { document.getElementById('chat-badge')?.classList.add('hidden'); document.getElementById('dm-badge')?.classList.add('hidden'); }
    return;
  }
  const pr = document.getElementById('parallax-root');
  const map = {
    'compact':            () => document.body.classList.toggle('compact-mode', val),
    'parallax':           () => { if(pr) pr.style.display = val ? '' : 'none'; },
    'compact-sidebar':    () => document.body.classList.toggle('compact-sidebar', val),
    'show-rank':          () => document.body.classList.toggle('hide-rank', !val),
    'nav-labels':         () => document.body.classList.toggle('hide-nav-labels', !val),
    'nav-glow':           () => document.body.classList.toggle('no-nav-glow', !val),
    'reduce-motion':      () => document.body.classList.toggle('reduce-motion', val),
    'ts-hover':           () => document.body.classList.toggle('ts-hover-mode', val),
    'msg-anim':           () => document.body.classList.toggle('no-msg-anim', !val),
    'high-contrast':      () => document.body.classList.toggle('high-contrast', val),
    'line-spacing':       () => document.body.classList.toggle('wider-lines', val),
    'focus-mode':         () => document.body.classList.toggle('focus-mode', val),
    'chat-ranks':         () => document.body.classList.toggle('hide-chat-ranks', !val),
    'typing-indicators':  () => document.body.classList.toggle('hide-typing', !val),
    'link-previews':      () => { },
    'char-counter':       () => { const c = document.getElementById('char-ctr'); if(c) c.style.display = val ? '' : 'none'; },
    'theme-anim':         () => { },
  };
  map[k]?.();
}

function applyAllToggles() {
  const get = k => localStorage.getItem('neb_notif_' + k);
  const layout = loadLayout();
  const DEFAULTS = {
    compact: false, parallax: true, 'ts-hover': false, 'msg-anim': true,
    'compact-sidebar': false, 'show-rank': true, 'reduce-motion': false,
    'nav-labels': true, 'nav-glow': true, 'theme-anim': true,
    'high-contrast': false, 'line-spacing': false, 'focus-mode': false,
    'chat-ranks': true, 'char-counter': true, 'unread-badges': true,
  };
  for(const [k, def] of Object.entries(DEFAULTS)) {
    if(k === 'nav-labels' && (layout === 'topbar' || layout === 'bottombar')) continue;
    const stored = get(k);
    const val = stored !== null ? stored === 'true' : def;
    applyToggle(k, val);
  }
}

function syncDepSettings() {
  document.querySelectorAll('.setting-dep[data-requires]').forEach(el => {
    const key = el.dataset.requires;
    const toggle = document.querySelector(`.notif-toggle[data-key="${key}"]`);
    const on = toggle ? toggle.checked : (localStorage.getItem('neb_notif_' + key) !== 'false');
    el.classList.toggle('setting-hidden', !on);
  });
  document.querySelectorAll('.setting-dep[data-requires-off]').forEach(el => {
    const key = el.dataset['requires-off'] || el.getAttribute('data-requires-off');
    const toggle = document.querySelector(`.notif-toggle[data-key="${key}"]`);
    const on = toggle ? toggle.checked : (localStorage.getItem('neb_notif_' + key) !== 'false');
    el.classList.toggle('setting-hidden', on);
  });
  const layout = loadLayout();
  const isSidebar = layout === 'default' || layout === 'sidebar-right';
  document.getElementById('setting-compact-sidebar-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('setting-show-rank-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebar);
  const noLabels = layout === 'topbar' || layout === 'bottombar';
  document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabels);
}

async function buildChannelNotifList() {
  const container = document.getElementById('sp-channel-notifs');
  if(!container) return;
  container.innerHTML = '<div style="font-size:.72rem;color:var(--text-faint)">Loading channels...</div>';

  let channels = [];
  try {
    const snap = await getDocs(collection(db,'channels'));
    snap.forEach(s => channels.push({id:s.id, name:s.data().name}));
    channels.sort((a,b)=>a.name.localeCompare(b.name));
  } catch(e) { channels = [{id:'general',name:'general'}]; }

  container.innerHTML = '';
  channels.forEach(ch => {
    const key = 'neb_chnotif_'+ch.id;
    const enabled = localStorage.getItem(key) !== 'false';
    const row = document.createElement('div');
    row.className = 'notif-channel-row';
    row.innerHTML = `
      <span class="notif-channel-name"># ${escHtml(ch.name)}</span>
      <label class="toggle-switch">
        <input type="checkbox" ${enabled?'checked':''} data-chkey="${ch.id}">
        <div class="toggle-track"></div>
      </label>`;
    row.querySelector('input').addEventListener('change', function() {
      localStorage.setItem(key, this.checked);
    });
    container.appendChild(row);
  });
}

// ── Admin Panel ──
async function setupAdmin() {
  const d = currentUserData;
  const isGoat = d.rank === 'goat';

  // Rebuild the entire admin section HTML
  const adminSection = document.getElementById('section-admin');
  if(!adminSection) return;

  adminSection.innerHTML = `
  <div class="admin-fullpage">
    <div class="admin-topbar">
      <div class="admin-topbar-left">
        <span class="admin-topbar-icon">${isGoat ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>' : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'}</span>
        <div>
          <div class="admin-topbar-title">${isGoat ? 'Goat Console' : 'Mod Panel'}</div>
          <div class="admin-topbar-sub">${isGoat ? 'Full system access — user management, data cleanup, moderation' : 'Approve members and manage the community'}</div>
        </div>
      </div>
      <div class="admin-stats-row" id="admin-stats-row">
        <div class="admin-stat-pill" id="adm-stat-pending"><span id="adm-cnt-pending">…</span> Pending</div>
        <div class="admin-stat-pill" id="adm-stat-members"><span id="adm-cnt-members">…</span> Members</div>
        <div class="admin-stat-pill" id="adm-stat-banned"><span id="adm-cnt-banned">…</span> Banned</div>
      </div>
    </div>
    <div class="admin-tabs" id="admin-tabs">
      <button class="adm-tab active" data-tab="pending"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Pending</button>
      <button class="adm-tab" data-tab="members"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> Members</button>
      <button class="adm-tab" data-tab="banned"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Banned</button>
      ${isGoat ? `<button class="adm-tab" data-tab="cleanup"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> DB Cleanup</button>` : ''}
    </div>
    <div class="admin-panel-area">
      <div class="adm-panel active" id="ap-pending"><div class="adm-loading">Loading…</div></div>
      <div class="adm-panel" id="ap-members"><div class="adm-loading">Loading…</div></div>
      <div class="adm-panel" id="ap-banned"><div class="adm-loading">Loading…</div></div>
      ${isGoat ? '<div class="adm-panel" id="ap-cleanup"><div class="adm-loading">Loading…</div></div>' : ''}
    </div>
  </div>`;

  document.querySelectorAll('.adm-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('ap-'+t.dataset.tab)?.classList.add('active');
      loadAdminPanel(t.dataset.tab);
    });
  });

  // Load counts + first tab
  loadAdminCounts();
  loadAdminPanel('pending');
}

async function loadAdminCounts() {
  try {
    const snap = await getDocs(collection(db,'users'));
    const users = snap.docs.map(d=>d.data());
    const pending = users.filter(u=>u.status==='pending').length;
    const members = users.filter(u=>u.status==='approved').length;
    const banned = users.filter(u=>u.status==='banned').length;
    const pendEl = document.getElementById('adm-cnt-pending');
    const membEl = document.getElementById('adm-cnt-members');
    const banEl = document.getElementById('adm-cnt-banned');
    if(pendEl) { pendEl.textContent = pending; document.getElementById('adm-stat-pending')?.classList.toggle('adm-stat-alert', pending > 0); }
    if(membEl) membEl.textContent = members;
    if(banEl) banEl.textContent = banned;
  } catch(e) {}
}

async function loadAdminPanel(tab) {
  const container = document.getElementById('ap-'+tab);
  if(!container) return;
  container.innerHTML = '<div class="adm-loading">Loading…</div>';

  if(tab === 'cleanup') {
    renderDBCleanup(container);
    return;
  }

  const snap = await getDocs(collection(db,'users'));
  const users = snap.docs.map(d=>d.data());

  if(tab==='pending') {
    const pending = users.filter(u=>u.status==='pending');
    if(!pending.length) { container.innerHTML='<div class="adm-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.5"><polyline points="20 6 9 17 4 12"/></svg><span>All caught up! No pending accounts.</span></div>'; return; }
    container.innerHTML = pending.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')">${avatarHtml(u.icon,u.username,"60%")}</div>
        <div class="adm-info">
          <div class="adm-name">${escHtml(u.username)}${u.fullName?` <span style="font-weight:400;color:var(--text-faint);font-size:.72rem">(${escHtml(u.fullName)})</span>`:''}</div>
          <div class="adm-meta">${u.email||'No email'} · Requested ${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'Unknown'}</div>
        </div>
        <div class="adm-actions">
          <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')">Profile</button>
          <button class="ta-btn ta-green" onclick="window.approveUser('${u.uid}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Approve</button>
          <button class="ta-btn ta-red" onclick="window.denyUser('${u.uid}','${escHtml(u.username)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Deny</button>
        </div>
      </div>`).join('');
  } else if(tab==='members') {
    const members = users.filter(u=>u.status==='approved');
    members.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
    if(!members.length) { container.innerHTML='<div class="adm-empty">No approved members yet</div>'; return; }

    // Add search bar
    container.innerHTML = `
      <div class="adm-search-row">
        <input type="text" id="adm-member-search" class="field-input" placeholder="Search by username or email…" style="max-width:340px">
      </div>
      <div id="adm-members-list"></div>`;

    const renderMemberList = (filter='') => {
      const filtered = members.filter(u => !filter || u.username?.toLowerCase().includes(filter) || u.email?.toLowerCase().includes(filter));
      const listEl = document.getElementById('adm-members-list');
      if(!listEl) return;
      listEl.innerHTML = filtered.length ? filtered.map(u=>`
        <div class="adm-row">
          <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')">${avatarHtml(u.icon,u.username,"60%")}</div>
          <div class="adm-info">
            <div class="adm-name">${escHtml(u.username)}</div>
            <div class="adm-meta">${u.email||'No email'} · Joined ${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'?'}</div>
          </div>
          <div class="adm-actions">
            <span class="rbadge ${u.rank}">${u.rank}</span>
            <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Profile</button>
            ${canChangeRank(u) ? `<button class="ta-btn ta-blue" onclick="window.changeRank('${u.uid}','${u.rank}','${escHtml(u.username)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Rank</button>` : ''}
            ${canBan(u) ? `<button class="ta-btn ta-red" onclick="window.banUser('${u.uid}','${escHtml(u.username)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Ban</button>` : ''}
          </div>
        </div>`).join('') : '<div class="adm-empty">No members match search</div>';
    };
    renderMemberList();
    setTimeout(() => {
      document.getElementById('adm-member-search')?.addEventListener('input', e => renderMemberList(e.target.value.trim().toLowerCase()));
    }, 50);
  } else if(tab==='banned') {
    const banned = users.filter(u=>u.status==='banned');
    container.innerHTML = banned.length ? banned.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')">${avatarHtml(u.icon,u.username,"60%")}</div>
        <div class="adm-info">
          <div class="adm-name">${escHtml(u.username)}</div>
          <div class="adm-meta">${u.email||'No email'}</div>
        </div>
        <div class="adm-actions">
          <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Profile</button>
          <button class="ta-btn ta-green" onclick="window.unbanUser('${u.uid}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Unban</button>
          ${currentUserData.rank==='goat'?`<button class="ta-btn ta-red" onclick="window.deleteAccount('${u.uid}','${escHtml(u.username)}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg> Delete</button>`:''}
        </div>
      </div>`).join('') : '<div class="adm-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.5"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg><span>No banned users</span></div>';
  }
}

// ── DB Cleanup Panel (Goat-only) — with live stats ──
async function renderDBCleanup(container) {
  container.innerHTML = `
  <div class="cleanup-panel">

    <!-- Live DB Stats Dashboard -->
    <div class="cleanup-stats-grid" id="cleanup-stats-grid">
      <div class="cleanup-stat-card" id="cstat-users">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></div>
        <div class="csc-val" id="cstat-users-val">…</div>
        <div class="csc-label">Total Users</div>
        <div class="csc-sub" id="cstat-users-sub"></div>
      </div>
      <div class="cleanup-stat-card" id="cstat-msgs">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
        <div class="csc-val" id="cstat-msgs-val">…</div>
        <div class="csc-label">Channel Messages</div>
        <div class="csc-sub" id="cstat-msgs-sub"></div>
      </div>
      <div class="cleanup-stat-card" id="cstat-dms">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg></div>
        <div class="csc-val" id="cstat-dms-val">…</div>
        <div class="csc-label">DM Threads</div>
        <div class="csc-sub" id="cstat-dms-sub"></div>
      </div>
      <div class="cleanup-stat-card" id="cstat-gc">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9 14h6M9 10h6M12 6v2M12 16v2"/></svg></div>
        <div class="csc-val" id="cstat-gc-val">…</div>
        <div class="csc-label">Total GoatCoins</div>
        <div class="csc-sub" id="cstat-gc-sub"></div>
      </div>
      <div class="cleanup-stat-card" id="cstat-games">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg></div>
        <div class="csc-val" id="cstat-games-val">…</div>
        <div class="csc-label">Active BJ Games</div>
        <div class="csc-sub" id="cstat-games-sub"></div>
      </div>
      <div class="cleanup-stat-card" id="cstat-channels">
        <div class="csc-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></div>
        <div class="csc-val" id="cstat-channels-val">…</div>
        <div class="csc-label">Custom Channels</div>
        <div class="csc-sub" id="cstat-channels-sub"></div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" id="cleanup-refresh-stats" style="margin-bottom:1.2rem;font-size:.72rem" onclick="window.cleanupRefreshStats()">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
      Refresh Stats
    </button>

    <div class="cleanup-warning">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
      <span><strong>Danger Zone</strong> — Destructive actions are irreversible. Review the stats above before wiping anything.</span>
    </div>

    <div class="cleanup-section">
      <div class="cleanup-section-hdr">GoatCoin</div>
      <div class="cleanup-actions">
        <div class="cleanup-action-card">
          <div class="cac-title">Wipe All GoatCoin Balances</div>
          <div class="cac-desc">Resets every user's coin balance, weekly stats, and BJ win counts to zero. Keeps documents.</div>
          <button class="btn btn-danger btn-sm" onclick="window.cleanupWipeAllCoins()">Wipe All Coins</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Reset Weekly Stats Only</div>
          <div class="cac-desc">Resets weekCoins, weekChatMins, weekGameMins, weekBJWins for all users without touching balances.</div>
          <button class="btn btn-danger btn-sm" onclick="window.cleanupResetWeeklyStats()">Reset Weekly Stats</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Delete GoatCoin Document</div>
          <div class="cac-desc">Remove a specific user's GoatCoin document entirely. Enter their UID below.</div>
          <div style="display:flex;gap:6px;margin-top:.6rem">
            <input id="cleanup-gc-uid" class="field-input" placeholder="User UID…" style="flex:1;font-size:.78rem">
            <button class="btn btn-danger btn-sm" onclick="window.cleanupDeleteUserGC()">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <div class="cleanup-section">
      <div class="cleanup-section-hdr">Messages</div>
      <div class="cleanup-actions">
        <div class="cleanup-action-card">
          <div class="cac-title">Wipe Channel Messages</div>
          <div class="cac-desc">Delete all messages in a specific channel. The channel itself remains.</div>
          <div style="display:flex;gap:6px;margin-top:.6rem">
            <select id="cleanup-ch-sel" class="field-input" style="flex:1;font-size:.78rem"><option value="">Loading channels…</option></select>
            <button class="btn btn-danger btn-sm" onclick="window.cleanupWipeChannel()">Wipe</button>
          </div>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Wipe All DMs</div>
          <div class="cac-desc">Delete all direct message threads and their messages. Affects every user.</div>
          <button class="btn btn-danger btn-sm" onclick="window.cleanupWipeDMs()">Wipe All DMs</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Prune Old Channel Messages</div>
          <div class="cac-desc">In each channel, delete messages beyond the last 100. Keeps channels lean.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupPruneAllChannels()">Prune All Channels</button>
        </div>
      </div>
    </div>

    <div class="cleanup-section">
      <div class="cleanup-section-hdr">Stale Data</div>
      <div class="cleanup-actions">
        <div class="cleanup-action-card">
          <div class="cac-title">Purge Stale BJ Games</div>
          <div class="cac-desc">Delete all blackjack games in gameDone phase or older than 24 hours.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupPurgeBJGames()">Purge Stale Games</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Clear BJ Challenges</div>
          <div class="cac-desc">Delete all pending, declined, and cancelled blackjack challenge documents.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupClearBJChallenges()">Clear Challenges</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Remove Orphaned GoatCoin Docs</div>
          <div class="cac-desc">Delete GoatCoin documents for UIDs that have no matching user profile.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupOrphanedGC()">Remove Orphans</button>
        </div>
      </div>
    </div>

    <div class="cleanup-section">
      <div class="cleanup-section-hdr">Counters &amp; Meta</div>
      <div class="cleanup-actions">
        <div class="cleanup-action-card">
          <div class="cac-title">Reset Visit Counter</div>
          <div class="cac-desc">Set the total visit count back to 0 in both RTDB and Firestore.</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupResetVisits()">Reset Visits</button>
        </div>
        <div class="cleanup-action-card">
          <div class="cac-title">Export User List</div>
          <div class="cac-desc">Download a JSON export of all user profiles (uid, username, email, rank, status).</div>
          <button class="btn btn-ghost btn-sm" onclick="window.cleanupExportUsers()">Export Users JSON</button>
        </div>
      </div>
    </div>

    <div id="cleanup-log" class="cleanup-log"></div>
  </div>`;

  // Load channels into dropdown and fetch live stats
  try {
    const snap = await getDocs(collection(db,'channels'));
    const sel = document.getElementById('cleanup-ch-sel');
    if(sel) {
      sel.innerHTML = '<option value="">-- Select channel --</option>' +
        ['general','admin'].map(id=>`<option value="${id}">#${id} (built-in)</option>`).join('') +
        snap.docs.map(d=>`<option value="${d.id}">#${escHtml(d.data().name||d.id)}</option>`).join('');
    }
  } catch(e) {}

  // Auto-load stats on open
  window.cleanupRefreshStats();
}

window.cleanupRefreshStats = async function() {
  const set = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };

  try {
    // Users
    const usersSnap = await getDocs(collection(db,'users'));
    const users = usersSnap.docs.map(d=>d.data());
    set('cstat-users-val', users.length);
    const approved = users.filter(u=>u.status==='approved').length;
    const pending = users.filter(u=>u.status==='pending').length;
    const banned = users.filter(u=>u.status==='banned').length;
    set('cstat-users-sub', `${approved} approved · ${pending} pending · ${banned} banned`);

    // Channels
    const channelsSnap = await getDocs(collection(db,'channels'));
    set('cstat-channels-val', channelsSnap.size);
    set('cstat-channels-sub', channelsSnap.docs.map(d=>d.data().name||d.id).slice(0,3).join(', ') + (channelsSnap.size > 3 ? '…' : ''));

    // Channel messages
    let totalMsgs = 0;
    const allChannels = ['general','admin', ...channelsSnap.docs.map(d=>d.id)];
    const msgCounts = [];
    for(const chId of allChannels) {
      try {
        const msgsSnap = await getDocs(collection(db,`channels/${chId}/messages`));
        totalMsgs += msgsSnap.size;
        if(msgsSnap.size > 0) msgCounts.push(`#${chId}: ${msgsSnap.size}`);
      } catch(e) {}
    }
    set('cstat-msgs-val', totalMsgs.toLocaleString());
    set('cstat-msgs-sub', msgCounts.slice(0,3).join(' · ') || 'No messages');

    // DMs
    const dmsSnap = await getDocs(collection(db,'dms'));
    set('cstat-dms-val', dmsSnap.size);
    let dmMsgs = 0;
    for(const dm of dmsSnap.docs) {
      try {
        const mSnap = await getDocs(collection(db,`dms/${dm.id}/messages`));
        dmMsgs += mSnap.size;
      } catch(e) {}
    }
    set('cstat-dms-sub', `${dmMsgs.toLocaleString()} messages total`);

    // GoatCoin
    const gcSnap = await getDocs(collection(db,'goatcoin'));
    let totalCoins = 0;
    gcSnap.docs.forEach(d => { totalCoins += (d.data().coins||0); });
    set('cstat-gc-val', totalCoins.toLocaleString());
    const richest = gcSnap.docs.map(d=>d.data()).sort((a,b)=>(b.coins||0)-(a.coins||0))[0];
    set('cstat-gc-sub', richest ? `Richest: ${(richest.coins||0).toLocaleString()} coins` : 'No data');

    // BJ Games
    const gamesSnap = await getDocs(collection(db,'bj_games'));
    const activeGames = gamesSnap.docs.filter(d=>d.data().phase !== 'gameDone');
    set('cstat-games-val', activeGames.length);
    const staleGames = gamesSnap.size - activeGames.length;
    set('cstat-games-sub', `${staleGames} stale (gameDone) · ${gamesSnap.size} total`);

    _cleanupLog('Stats refreshed.', 'success');
  } catch(e) {
    _cleanupLog('Stats refresh failed: ' + e.message, 'error');
  }
};

function _cleanupLog(msg, type='info') {
  const log = document.getElementById('cleanup-log');
  if(!log) { toast(msg, type); return; }
  const entry = document.createElement('div');
  entry.className = `cleanup-log-entry cleanup-log-${type}`;
  entry.innerHTML = `<span class="cleanup-log-ts">${new Date().toLocaleTimeString()}</span> ${escHtml(msg)}`;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  toast(msg, type);
}

window.cleanupWipeAllCoins = function() {
  showModal(`
    <h3>Wipe ALL GoatCoin Balances?</h3>
    <p class="modal-p">This will set <strong>every user's</strong> coins, weekCoins, totalCoins, and all stats to 0. This is permanent.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-wipe-coins">Yes, Wipe All Coins</button>
    </div>`);
  document.getElementById('confirm-wipe-coins').onclick = async () => {
    closeModal();
    try {
      const snap = await getDocs(collection(db,'goatcoin'));
      let count = 0;
      const batch = writeBatch(db);
      const reset = { coins:0, weekCoins:0, totalCoins:0, weekSiteMins:0, weekChatMins:0, weekGameMins:0, totalSiteMins:0, totalChatMins:0, totalGameMins:0, weekBJWins:0, totalBJWins:0 };
      snap.docs.forEach(d => { batch.update(d.ref, reset); count++; });
      await batch.commit();
      _cleanupLog(`Wiped GoatCoin balances for ${count} users.`, 'success');
    } catch(e) { _cleanupLog('Failed: '+e.message, 'error'); }
  };
};

window.cleanupResetWeeklyStats = function() {
  showModal(`
    <h3>Reset Weekly Stats?</h3>
    <p class="modal-p">Resets weekCoins, weekChatMins, weekGameMins, and weekBJWins for all users. Does not touch balances.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-reset-weekly">Reset Weekly Stats</button>
    </div>`);
  document.getElementById('confirm-reset-weekly').onclick = async () => {
    closeModal();
    try {
      const snap = await getDocs(collection(db,'goatcoin'));
      let count = 0;
      const batch = writeBatch(db);
      const reset = { weekCoins:0, weekSiteMins:0, weekChatMins:0, weekGameMins:0, weekBJWins:0 };
      snap.docs.forEach(d => { batch.update(d.ref, reset); count++; });
      await batch.commit();
      _cleanupLog(`Reset weekly stats for ${count} users.`, 'success');
    } catch(e) { _cleanupLog('Failed: '+e.message, 'error'); }
  };
};

window.cleanupDeleteUserGC = async function() {
  const uid = document.getElementById('cleanup-gc-uid')?.value.trim();
  if(!uid) { toast('Enter a UID','warning'); return; }
  showModal(`<h3>Delete GoatCoin for UID?</h3><p class="modal-p">UID: <code>${escHtml(uid)}</code><br>This permanently removes their GoatCoin document.</p><div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button><button class="btn btn-danger btn-sm" id="confirm-del-gc">Delete</button></div>`);
  document.getElementById('confirm-del-gc').onclick = async () => {
    closeModal();
    try { await deleteDoc(doc(db,'goatcoin',uid)); _cleanupLog(`Deleted GoatCoin doc for ${uid}.`, 'success'); }
    catch(e) { _cleanupLog('Failed: '+e.message, 'error'); }
  };
};

window.cleanupWipeChannel = function() {
  const chId = document.getElementById('cleanup-ch-sel')?.value;
  if(!chId) { toast('Select a channel first','warning'); return; }
  showModal(`<h3>Wipe #${chId}?</h3><p class="modal-p">Deletes all messages in <strong>#${escHtml(chId)}</strong>. Cannot be undone.</p><div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button><button class="btn btn-danger btn-sm" id="confirm-wipe-ch">Wipe Channel</button></div>`);
  document.getElementById('confirm-wipe-ch').onclick = async () => {
    closeModal();
    try {
      const snap = await getDocs(collection(db, `channels/${chId}/messages`));
      if(!snap.size) { _cleanupLog(`#${chId} is already empty.`,'info'); return; }
      const batchSize = 499; let batch = writeBatch(db), count = 0;
      for(const d of snap.docs) { batch.delete(d.ref); count++; if(count%batchSize===0){await batch.commit();batch=writeBatch(db);} }
      if(count%batchSize!==0) await batch.commit();
      _cleanupLog(`Wiped ${snap.size} messages from #${chId}.`,'success');
    } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
  };
};

window.cleanupWipeDMs = function() {
  showModal(`<h3>Wipe ALL Direct Messages?</h3><p class="modal-p">This deletes every DM thread and all messages inside them, for every user. Permanent.</p><div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button><button class="btn btn-danger btn-sm" id="confirm-wipe-dms">Wipe All DMs</button></div>`);
  document.getElementById('confirm-wipe-dms').onclick = async () => {
    closeModal();
    try {
      const dmsSnap = await getDocs(collection(db,'dms'));
      let totalMsgs = 0;
      for(const dmDoc of dmsSnap.docs) {
        const msgsSnap = await getDocs(collection(db,`dms/${dmDoc.id}/messages`));
        if(msgsSnap.size) { const batch=writeBatch(db); msgsSnap.docs.forEach(d=>batch.delete(d.ref)); await batch.commit(); totalMsgs+=msgsSnap.size; }
        await deleteDoc(dmDoc.ref);
      }
      _cleanupLog(`Wiped ${dmsSnap.size} DM threads (${totalMsgs} messages).`,'success');
    } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
  };
};

// Legacy offline presence cleanup (presence system removed, but doc may still exist)
window.cleanupClearOfflinePresence = async function() {
  try {
    // Try to clear old presence collection (may be empty/non-existent since system removed)
    const snap = await getDocs(collection(db,'presence')).catch(()=>({docs:[],size:0}));
    if(!snap.size) { _cleanupLog('No presence docs found (system already removed).','info'); return; }
    const batch = writeBatch(db);
    snap.docs.forEach(d=>batch.delete(d.ref));
    await batch.commit();
    _cleanupLog(`Cleared ${snap.size} stale presence docs.`,'success');
  } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
};

window.cleanupPurgeBJGames = async function() {
  try {
    const cutoff = Date.now() - 24*60*60*1000;
    const snap = await getDocs(collection(db,'bj_games'));
    const toDel = snap.docs.filter(d => {
      const data = d.data();
      if(data.phase==='gameDone') return true;
      const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : 0;
      return ts && ts < cutoff;
    });
    if(!toDel.length) { _cleanupLog('No stale BJ games found.','info'); return; }
    await Promise.all(toDel.map(d=>deleteDoc(d.ref)));
    _cleanupLog(`Purged ${toDel.length} stale BJ game(s).`,'success');
  } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
};

window.cleanupClearBJChallenges = async function() {
  try {
    const snap = await getDocs(collection(db,'bj_challenges'));
    if(!snap.size) { _cleanupLog('No BJ challenges found.','info'); return; }
    await Promise.all(snap.docs.map(d=>deleteDoc(d.ref)));
    _cleanupLog(`Cleared ${snap.size} BJ challenge(s).`,'success');
  } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
};

window.cleanupResetVisits = async function() {
  try {
    if(_rtdb) { await rtSet(rtRef(_rtdb,'meta/visits'), 0).catch(()=>{}); }
    await setDoc(doc(db,'meta','visits'), { count: 0 }, { merge: true }).catch(()=>{});
    _cleanupLog('Visit counter reset to 0.','success');
    const el = document.getElementById('visits-count');
    if(el) el.textContent = '0';
  } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
};

window.cleanupPruneAllChannels = async function() {
  showModal(`<h3>Prune All Channels?</h3><p class="modal-p">Keeps the last 100 messages per channel and deletes older ones. This helps reduce Firestore usage.</p><div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button><button class="btn btn-sm" id="confirm-prune-all">Prune</button></div>`);
  document.getElementById('confirm-prune-all').onclick = async () => {
    closeModal();
    try {
      const channelsSnap = await getDocs(collection(db,'channels'));
      const allChannels = ['general','admin', ...channelsSnap.docs.map(d=>d.id)];
      let totalDeleted = 0;
      for(const chId of allChannels) {
        try {
          const msgsSnap = await getDocs(query(collection(db,`channels/${chId}/messages`), orderBy('ts','asc')));
          if(msgsSnap.size <= 100) continue;
          const toDelete = msgsSnap.docs.slice(0, msgsSnap.size - 100);
          const batch = writeBatch(db);
          toDelete.forEach(d => batch.delete(d.ref));
          await batch.commit();
          totalDeleted += toDelete.length;
        } catch(e) {}
      }
      _cleanupLog(`Pruned ${totalDeleted} old messages across ${allChannels.length} channels.`, 'success');
      window.cleanupRefreshStats();
    } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
  };
};

window.cleanupOrphanedGC = async function() {
  showModal(`<h3>Remove Orphaned GoatCoin Docs?</h3><p class="modal-p">Finds and deletes GoatCoin documents for UIDs with no matching user profile. This is safe to run.</p><div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button><button class="btn btn-sm" id="confirm-orphan">Remove</button></div>`);
  document.getElementById('confirm-orphan').onclick = async () => {
    closeModal();
    try {
      const [usersSnap, gcSnap] = await Promise.all([
        getDocs(collection(db,'users')),
        getDocs(collection(db,'goatcoin'))
      ]);
      const validUids = new Set(usersSnap.docs.map(d=>d.id));
      const orphans = gcSnap.docs.filter(d=>!validUids.has(d.id));
      if(!orphans.length) { _cleanupLog('No orphaned GoatCoin docs found.','info'); return; }
      await Promise.all(orphans.map(d=>deleteDoc(d.ref)));
      _cleanupLog(`Removed ${orphans.length} orphaned GoatCoin document(s).`,'success');
      window.cleanupRefreshStats();
    } catch(e) { _cleanupLog('Failed: '+e.message,'error'); }
  };
};

window.cleanupExportUsers = async function() {
  try {
    const snap = await getDocs(collection(db,'users'));
    const users = snap.docs.map(d => {
      const u = d.data();
      return { uid: u.uid, username: u.username, email: u.email||'', rank: u.rank, status: u.status, createdAt: u.createdAt?.toDate?.()?.toISOString()||'' };
    });
    const json = JSON.stringify(users, null, 2);
    const blob = new Blob([json], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `nebula-users-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    _cleanupLog(`Exported ${users.length} users.`,'success');
  } catch(e) { _cleanupLog('Export failed: '+e.message,'error'); }
};

function canChangeRank(targetUser) {
  const me = currentUserData;
  if(me.rank==='goat') return targetUser.uid !== me.uid;
  if(me.rank==='universal') return !canModerate(targetUser.rank) && targetUser.uid !== me.uid;
  return false;
}

function canBan(targetUser) {
  const me = currentUserData;
  if(me.rank==='goat') return targetUser.uid !== me.uid;
  if(me.rank==='universal') return !canModerate(targetUser.rank) && targetUser.uid !== me.uid;
  return false;
}

window.approveUser = async function(uid) {
  await updateDoc(doc(db,'users',uid),{status:'approved',rank:'planetary'});
  toast('Account approved','success');
  loadAdminPanel('pending');
};

window.denyUser = async function(uid, username) {
  if(!confirm(`Remove ${username}'s account? This can't be undone.`)) return;
  try {
    await deleteDoc(doc(db,'users',uid));
    await deleteDoc(doc(db,'goatcoin',uid)).catch(()=>{});
    toast(`${username}'s application deleted`,'info');
    loadAdminPanel('pending');
  } catch(e) { toast('Failed to delete: '+e.message,'error'); }
};

window.banUser = async function(uid, username) {
  if(!confirm(`Ban ${username}? They won't be able to log in.`)) return;
  await updateDoc(doc(db,'users',uid),{status:'banned'});
  toast(`${username} banned`,'warning');
  loadAdminPanel('members');
};

window.unbanUser = async function(uid) {
  await updateDoc(doc(db,'users',uid),{status:'approved'});
  toast('User unbanned','success');
  loadAdminPanel('banned');
};

window.deleteAccount = async function(uid, username) {
  showModal(`
    <h3>Permanently Delete Account</h3>
    <p class="modal-p">This removes <strong>all data</strong> for <strong>${escHtml(username)}</strong>: Firestore profile, GoatCoin, DMs, and their Firebase Auth account. This <strong>cannot be undone</strong>.</p>
    <div class="field-group" style="margin-top:.8rem">
      <label class="field-label">Type the username to confirm</label>
      <input id="del-acc-confirm-inp" class="field-input" type="text" placeholder="${escHtml(username)}" autocomplete="off">
    </div>
    <div class="merr" id="del-acc-err"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-delacc-btn">Delete Everything</button>
    </div>
  `);
  document.getElementById('confirm-delacc-btn').onclick = async () => {
    const inp = document.getElementById('del-acc-confirm-inp');
    const err = document.getElementById('del-acc-err');
    if(inp.value.trim() !== username) { err.textContent = 'Username does not match. Type it exactly.'; return; }
    const btn = document.getElementById('confirm-delacc-btn');
    btn.disabled = true; btn.textContent = 'Deleting…';
    try {
      // 1. Delete Firestore documents
      await deleteDoc(doc(db,'users',uid)).catch(()=>{});
      await deleteDoc(doc(db,'goatcoin',uid)).catch(()=>{});
      // 2. Remove from DM participants (just leave DMs orphaned — cleanup panel handles this)
      // 3. Call Firebase Auth deletion via a secure callable or direct Admin SDK
      //    Since we can't call Admin SDK from client, we use a Cloud Function endpoint
      //    Fallback: mark user as deleted in DB so they can't log in
      try {
        // Try to delete via Firebase Auth callable function if available
        const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
        const functions = getFunctions(window._firebaseApp);
        const deleteUser = httpsCallable(functions, 'deleteUser');
        await deleteUser({ uid });
      } catch(funcErr) {
        // Cloud function not available — the user is already banned so they can't log in
        // Log the intent for manual cleanup
        console.warn('Cloud function deleteUser not available — Firestore data removed, Auth account may need manual deletion for UID:', uid);
      }
      closeModal(() => { loadAdminPanel('banned'); toast(`Account for ${username} permanently deleted.`, 'success'); });
    } catch(e) { 
      btn.disabled = false; btn.textContent = 'Delete Everything';
      if(err) err.textContent = 'Failed: ' + e.message; 
    }
  };
};

window.changeRank = function(uid, currentRank, username) {
  const me = currentUserData;
  const availableRanks = ['earthbound','planetary','solar','galactic'];
  if(me.rank==='goat') availableRanks.push('universal');
  showModal(`
    <h3>Change Rank: ${escHtml(username)}</h3>
    <p class="modal-p">Select a new rank for this user.</p>
    ${availableRanks.map(r=>`<button class="rank-btn ${r}" onclick="window.applyRank('${uid}','${r}')">${r.toUpperCase()}</button>`).join('')}
    <div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button></div>
  `);
};

window.applyRank = async function(uid, rank) {
  await updateDoc(doc(db,'users',uid),{rank});
  closeModal(()=>{ loadAdminPanel('members'); toast('Rank updated','success'); });
};

// ── Game Vault ──
function cleanHTML(html) {
  html = html.replace(/#sidebarad1\s*,\s*\n?#sidebarad2[\s\S]*?\.sidebar-frame\s*\{[\s\S]*?\}/g, '');
  html = html.replace(/<div\s+id=["']sidebarad[12]["'][^>]*>[\s\S]*?<\/div>\s*(<\/div>)?/g, '');
  html = html.replace(/<script>\s*\(function\(_0x[a-f0-9]+[\s\S]*?duplace\.ne[\s\S]*?<\/script>/g, '');
  html = html.replace(/<style>[^<]*#sidebarad[\s\S]*?<\/style>/g, '');
  return html;
}

window.openGameVault = function(url, name) {
  const vault = document.getElementById('game-vault');
  vault.style.display = 'flex';
  const frame = document.getElementById('game-frame');
  document.getElementById('game-name').textContent = name;
  setActivity('game');
  frame.src = 'about:blank';
  fetch(url + '?t=' + Date.now())
    .then(r => r.text())
    .then(html => {
      html = cleanHTML(html);
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if(doc) { doc.open(); doc.write(html); doc.close(); }
      frame._gameUrl = url;
      frame._gameName = name;
    })
    .catch(() => { frame.src = url; });
  if(currentUser && currentUserData) {
    updateDoc(doc(db,'users',currentUser.uid), { gamesPlayed: increment(1) }).catch(()=>{});
  }
};
window.closeGameVault = function() {
  const vault = document.getElementById('game-vault');
  vault.style.display='none';
  setActivity('site');
  const frame = document.getElementById('game-frame');
  if(frame._blobURL) { URL.revokeObjectURL(frame._blobURL); frame._blobURL = null; }
  frame.src='about:blank';
};
window.fullscreenGame = function() {
  const frame = document.getElementById('game-frame');
  if(frame.requestFullscreen) frame.requestFullscreen();
  else if(frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
};

// ── Profile click handler ──
window._openProfile = function(uid) {
  openProfileModal(uid, currentUserData);
};

window._openDMWithUid = async function(uid) {
  let other = _userCache[uid];
  if(!other) {
    const snap = await getDoc(doc(db,'users',uid));
    if(!snap.exists()) return;
    other = snap.data();
    _userCache[uid] = other;
  }
  navigate('dms');
  setTimeout(()=>openDM(other), 100);
};

// ── Boot ──
function boot() {
  applyTheme(loadTheme(), false);
  setupAuth();
  setupChatInput();
  setupDMInput();

  onAuthStateChanged(auth, async user => {
    if(_pendingSignup) return;
    if(user) await initApp(user);
    else showAuth();
  });
}

document.addEventListener('DOMContentLoaded', boot);

// ── Keyboard Shortcuts ──
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Don't trigger shortcuts when typing in inputs
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;

    // Ctrl+K / Cmd+K — command palette (always works)
    if((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }

    // Escape — close overlays then navigate home
    if(e.key === 'Escape') {
      // 1. Close command palette
      const cmd = document.getElementById('cmd-palette');
      if(cmd && !cmd.classList.contains('hidden')) {
        cmd.classList.add('hidden');
        return;
      }
      // 2. Close modal
      const ov = document.getElementById('modal-overlay');
      if(ov && !ov.classList.contains('hidden')) {
        ov.click();
        return;
      }
      // 3. Close game vault
      const vault = document.getElementById('game-vault');
      if(vault && vault.style.display === 'flex') {
        window.closeGameVault();
        return;
      }
      // 4. Close profile modal if open
      const profModal = document.querySelector('.profile-modal-overlay');
      if(profModal) {
        profModal.click();
        return;
      }
      // 5. If on a non-home section, navigate home
      const activeSection = document.querySelector('.section.active');
      if(activeSection && activeSection.id !== 'section-home') {
        navigate('home');
        return;
      }
      return;
    }

    if(isInput) return;

    // Number keys — navigate sections (1-8 for regular, 1-9 if admin)
    const navSections = _getNavSections();
    if(e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if(idx < navSections.length) {
        e.preventDefault();
        navigate(navSections[idx]);
      }
    }
  });
}

/** Returns the ordered nav sections, including 'admin' only for moderators */
function _getNavSections() {
  const base = ['home','chat','dms','games','goatcoin','shop','profile','settings'];
  if(currentUserData && canModerate(currentUserData.rank)) {
    base.push('admin');
  }
  return base;
}

// ── Command Palette ──
function setupCommandPalette() {
  const palette = document.getElementById('cmd-palette');
  const overlay = document.getElementById('cmd-overlay');
  const input = document.getElementById('cmd-input');
  const results = document.getElementById('cmd-results');
  if(!palette || !input || !results) return;

  overlay?.addEventListener('click', () => palette.classList.add('hidden'));

  function _buildCommands() {
    const isAdmin = currentUserData && canModerate(currentUserData.rank);
    const cmds = [
      { label: 'Home',            desc: 'Go to home page',        action: () => navigate('home'),      svgKey: 'home',     keys: '1' },
      { label: 'Chat',            desc: 'Open channels',          action: () => navigate('chat'),      svgKey: 'chat',     keys: '2' },
      { label: 'Direct Messages', desc: 'Open DMs',               action: () => navigate('dms'),       svgKey: 'dms',      keys: '3' },
      { label: 'Games',           desc: 'Game vault',             action: () => navigate('games'),     svgKey: 'games',    keys: '4' },
      { label: 'GoatCoin',        desc: 'Currency & blackjack',   action: () => navigate('goatcoin'),  svgKey: 'goatcoin', keys: '5' },
      { label: 'Shop',            desc: 'Spend your GoatCoin',    action: () => navigate('shop'),      svgKey: 'shop',     keys: '6' },
      { label: 'Profile',         desc: 'Your identity',          action: () => navigate('profile'),   svgKey: 'profile',  keys: '7' },
      { label: 'Settings',        desc: 'Themes & display',       action: () => navigate('settings'),  svgKey: 'settings', keys: '8' },
    ];
    if(isAdmin) {
      cmds.push({ label: 'Admin', desc: 'Moderation & management', action: () => navigate('admin'), svgKey: 'admin', keys: '9' });
    }
    cmds.push({ label: 'Sign Out', desc: 'Log out of Nebula', action: () => document.getElementById('sp-signout')?.click(), svgKey: 'signout' });
    return cmds;
  }

  function renderResults(filter = '') {
    const COMMANDS = _buildCommands();
    const q = filter.toLowerCase();
    const filtered = q
      ? COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q))
      : COMMANDS;
    results.innerHTML = filtered.map((c, i) => `
      <div class="cmd-item${i === 0 ? ' active' : ''}" data-idx="${i}">
        <span class="cmd-icon cmd-icon-svg">${CMD_ICONS[c.svgKey] || ''}</span>
        <div class="cmd-item-info">
          <div class="cmd-item-label">${c.label}</div>
          <div class="cmd-item-desc">${c.desc}</div>
        </div>
        ${c.keys ? `<kbd class="cmd-key">${c.keys}</kbd>` : ''}
      </div>
    `).join('') || '<div class="cmd-empty">No results</div>';

    results.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        filtered[i]?.action();
        palette.classList.add('hidden');
      });
    });
  }

  input.addEventListener('input', () => renderResults(input.value));
  input.addEventListener('keydown', e => {
    const items = results.querySelectorAll('.cmd-item');
    const active = results.querySelector('.cmd-item.active');
    let idx = [...items].indexOf(active);

    if(e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx+1, items.length-1); }
    else if(e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx-1, 0); }
    else if(e.key === 'Enter') {
      e.preventDefault();
      active?.click();
      return;
    } else return;

    items.forEach(i => i.classList.remove('active'));
    items[idx]?.classList.add('active');
    items[idx]?.scrollIntoView({ block: 'nearest' });
  });

  renderResults();
}

function toggleCommandPalette() {
  const p = document.getElementById('cmd-palette');
  const inp = document.getElementById('cmd-input');
  if(!p) return;
  const isHidden = p.classList.contains('hidden');
  p.classList.toggle('hidden', !isHidden);
  if(isHidden) {
    inp.value = '';
    inp.focus();
    // Re-render default results
    inp.dispatchEvent(new Event('input'));
  }
}

// ── DM char counter ──
(function() {
  const dmInput = document.getElementById('dm-input');
  const dmCtr = document.getElementById('dm-char-ctr');
  if(dmInput && dmCtr) {
    dmInput.addEventListener('input', () => {
      const len = dmInput.value.length;
      dmCtr.textContent = 500 - len;
      dmCtr.className = 'char-ctr' + (len > 450 ? ' warn' : '') + (len > 490 ? ' danger' : '');
    });
  }
})();