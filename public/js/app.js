import {
  db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc, addDoc,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, writeBatch
} from './firebase.js';
import { getDatabase, ref as rtRef, set as rtSet, get as rtGet, onValue, remove as rtRemove, serverTimestamp as rtServerTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initGoatCoin, setActivity, cleanupGoatCoin, getGoatCoinData, renderGoatCoinTab } from './goatcoin.js';
import { renderBadgeRow, openProfileModal, renderOwnProfile, checkAutoAwards, BADGE_DEFS, checkAdblocker } from './profile.js';
import { renderShopTab, initShop } from './shop.js';
import { CMD_ICONS } from './icons.js';

// ---- State ----
let currentUser = null;
let currentUserData = null;
let currentChannel = null;
let currentDM = null;
let channelUnsub = null;
let dmUnsub = null;
let _typingUnsub = null; // RTDB typing listener unsub
let membersUnsub = null;
let typingTimeout = null;
let editingMsgId = null;
let visitsUnsub = null;
let _pendingSignup = false;
let _rtdb = null; // Realtime Database instance
const _userCache = {};
const _unreadChannels = {};
const _unreadDMs = {};
let _unreadEnabled = true;

// Channel message limit  -- prune when exceeded
const CHANNEL_MSG_LIMIT = 100;
const CHANNEL_MSG_PRUNE_TO = 80;

// ---- Rank utils ----
const RANKS = { earthbound:0, planetary:1, solar:2, galactic:3, universal:4, goat:5 };
const rankOf = r => RANKS[r] ?? -1;
const canModerate = r => rankOf(r) >= rankOf('universal');
const canChat = r => rankOf(r) >= rankOf('planetary');
const RANK_COLORS = {
  earthbound:'#6ee7b7', planetary:'#38bdf8', solar:'#f59e0b',
  galactic:'#a855f7', universal:'#e2e8f0', goat:'#fde68a'
};

const AV_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16'];
function avatarColor(uid) { let h=0; for(let c of uid) h=(h<<5)-h+c.charCodeAt(0); return AV_COLORS[Math.abs(h)%AV_COLORS.length]; }
function avatarInitial(u) { return (u||'?')[0].toUpperCase(); }

// ---- Toast ----
function toast(msg, type='info', dur=3000) {
  const stack = document.getElementById('notif-stack');
  const el = document.createElement('div');
  el.className = `notif ${type}`;
  el.innerHTML = `<div class="notif-dot"></div><span class="nmsg">${msg}</span>`;
  el.style.cursor = 'pointer';
  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    el.style.transition = 'opacity .3s ease, transform .3s cubic-bezier(.4,0,.2,1)';
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px) scale(.92)';
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 350); // fallback
  };
  el.addEventListener('click', dismiss);
  stack.appendChild(el);
  setTimeout(dismiss, dur);
}

// ---- Modal ----
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
  if(ov.classList.contains('hidden')) { if(cb) cb(); return; }
  ov.classList.add('closing');
  if(box) { box.style.transition='opacity .2s ease, transform .2s cubic-bezier(.4,0,.2,1)'; box.style.opacity='0'; box.style.transform='translateY(8px) scale(.96)'; }
  setTimeout(()=>{
    ov.classList.add('hidden'); ov.classList.remove('closing');
    if(wrap) wrap.classList.add('hidden');
    if(box) { box.classList.add('hidden'); box.innerHTML=''; box.style.opacity=''; box.style.transform=''; box.style.transition=''; }
    if(cb) cb();
  },220);
}

// ---- Theme ----
const THEME_FILES = { 'og':'og.css','dark':'dark.css','light':'light.css','synthwave':'synthwave.css','aurora':'aurora.css','crimson':'crimson.css','midnight':'midnight.css','slate':'slate.css','forest':'forest.css','ocean':'ocean.css','rose':'rose.css','solar':'solar.css','void':'void.css','neon':'neon.css','blush':'blush.css','ice':'ice.css','candy':'candy.css','vapor':'vapor.css','copper':'copper.css','lavender':'lavender.css','arctic':'arctic.css','ember':'ember.css','moss':'moss.css','dusk':'dusk.css','pearl':'pearl.css','cyberpunk':'cyberpunk.css','sakura':'sakura.css','rust':'rust.css','glacier':'glacier.css' };
let _themeTransitioning = false;

function loadTheme() {
  const match = document.cookie.match(/nebula_theme=(\w+)/);
  return match ? match[1] : 'og';
}

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

// -- Layout --
const LAYOUTS = ['default','sidebar-right','topbar','bottombar'];

function loadLayout() {
  return localStorage.getItem('neb_layout') || 'default';
}

function applyLayout(layout) {
  if(!LAYOUTS.includes(layout)) layout = 'default';
  localStorage.setItem('neb_layout', layout);
  document.body.classList.remove(...LAYOUTS.map(l => 'layout-' + l));
  document.body.classList.add('layout-' + layout);
}

// ---- Notification Permission ----
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

// ---- Auth Screen ----
function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('pending-screen').classList.add('hidden');
  document.getElementById('app').classList.add('hidden');
  hideSkeleton();
}

function hideSkeleton() {
  const sk = document.querySelector('.skeleton-screen');
  if(sk) { sk.classList.add('fade-out'); setTimeout(()=>{ if(sk.parentNode) sk.remove(); },600); }
}

function setupAuth() {
  document.getElementById('auth-pass-toggle')?.addEventListener('click', () => {
    const inp = document.getElementById('auth-pass');
    const icon = document.querySelector('#auth-pass-toggle svg');
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
        'auth/firebase-app-check-token-is-invalid':'Security verification failed. Try refreshing the page. If this keeps happening, clear your browser cache.',
        'appCheck/throttled':'Security verification is temporarily blocked. Please wait a few minutes and refresh the page.',
      };
      // Also handle App Check errors that may not have a .code property
      const errMsg = msgs[ex.code]
        || (ex.message && ex.message.includes('app-check') ? 'Security verification issue. Please refresh the page and try again.' : null)
        || (ex.message && ex.message.includes('throttled') ? 'Too many security check failures. Please wait a few minutes and refresh.' : null)
        || ex.message;
      err.textContent = errMsg;
      btn.disabled = false;
      btn.textContent = mode==='login' ? 'ENTER' : 'REQUEST ACCESS';
    }
  });
}

// ---- Main App Init ----
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
  // Check for global announcements (show once per user)
  setTimeout(checkAndShowAnnouncement, 1500);
}

// ---- Sidebar ----
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
    if(_dmListUnsub) { _dmListUnsub(); _dmListUnsub=null; }
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

// ---- Nav ----
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
  setActivity(section === 'chat' ? 'chat' : section === 'games' ? 'game' : section === 'ai' ? 'site' : 'site');
  if(section === 'goatcoin') renderGoatCoinTab();
  if(section === 'shop') renderShopTab();
  document.getElementById('mobile-drawer-overlay')?.remove();
  document.getElementById('mobile-drawer')?.remove();
}

// ---- Home / Visits ----
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
        // Tab lost focus  -- immediately remove ALL tooltip elements to prevent overlap on return
        wrap.querySelectorAll('.tt-el').forEach(el => el.remove());
        if(_tooltipInterval) { clearInterval(_tooltipInterval); _tooltipInterval = null; }
      } else {
        // Tab regained focus  -- clean start with a single fresh tooltip
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
    c.addEventListener('mousemove', e => {
      const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
      c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
    });
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

// ---- Presence  -- REMOVED to save Firebase quota ----
// Typing indicators are kept per-channel via RTDB.
function setupPresence() {
  // No-op: presence system removed to conserve RTDB/Firestore quota
}

function trackVisits() {
  const el = document.getElementById('visits-count');
  if(!el) return;
  // Use RTDB for visit counter  -- much cheaper than Firestore
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

// ---- Channel message pruning ----
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

// ---- Chat ----
const HARDCODED_CHANNELS = [
  { id:'general', name:'general', icon:'#', announce:false, passwordProtected:false, minRank:'planetary' },
  { id:'admin', name:'admin', icon:'⚙', announce:false, passwordProtected:false, minRank:'universal', adminOnly:true }
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

  // Wipe thread button  -- goat only
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
  _unreadChannels[ch.id] = 0;
  _updateChatBadge();
  _updateChannelListBadges();

  const isAnnounce = ch.announce && !canModerate(currentUserData.rank);
  document.getElementById('chat-input').disabled = isAnnounce;
  document.getElementById('chat-send-btn').disabled = isAnnounce;
  document.getElementById('chat-input').placeholder = isAnnounce ? 'Announcements only' : `Message #${ch.name}`;

  // Prune in background  -- won't block UI
  setTimeout(() => pruneChannelIfNeeded(ch.id), 2000);
}

function subscribeChannel(channelId) {
  const msgsRef = collection(db, `channels/${channelId}/messages`);
  let initialized = false;
  lastMsgSender = null; lastMsgTime = null;

  // Use typing from RTDB if available, else Firestore  -- unsub previous listener first
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
        bar.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' + typists.join(', ') + ' ' + (typists.length===1?'is':'are') + ' typing...</span>';
      } else if(bar) bar.innerHTML = '';
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
      } else {
        snap.docChanges().forEach(change => {
          if(change.type==='added') {
            appendMsg(change.doc.id, change.doc.data(), msgs);
            scrollToBottom();
            const isActive = document.getElementById('section-chat')?.classList.contains('active');
            if(!isActive && _unreadEnabled) {
              _unreadChannels[channelId] = (_unreadChannels[channelId]||0)+1;
              _updateChatBadge(); _updateChannelListBadges();
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
        bar.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div><span>' + typists.join(', ') + ' ' + (typists.length===1?'is':'are') + ' typing...</span>';
      } else if(bar) bar.innerHTML = '';
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
    planetary: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M2 12c2-4 5-6 9-6s7 2 9 6c-2 4-5 6-9 6s-7-2-9-6z"/></svg>',
    solar: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="m19.1 4.9-2.1 2.1"/><path d="m7 17-2.1 2.1"/></svg>',
    galactic: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="2"/><path d="M3 12c2-4 5-6 9-6s7 2 9 6c-2 4-5 6-9 6s-7-2-9-6z"/><path d="M12 3v3"/><path d="M12 18v3"/></svg>',
    universal: '<svg class="rbadge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.4 5 5.6.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.6-.8L12 2z"/></svg>',
    goat: '<svg class="rbadge-icon goat-badge-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>'
  };
  return icons[rank] || icons.planetary;
}

function renderRankBadge(rank) {
  const safeRank = rank || 'planetary';
    return `<span class="rbadge ${safeRank}">${rankIconSvg(safeRank)}${RANK_LABELS[safeRank] || String(safeRank).toUpperCase()}</span>`; // Updated to remove export
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

function escHtml(s) {
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

// ---- Chat Input ----
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
      // Use RTDB for typing  -- much cheaper
      const typRef = rtRef(_rtdb, `typing/${currentChannel.id}/${currentUser.uid}`);
      rtSet(typRef, { username: currentUserData.username, ts: Date.now() }).catch(()=>{});
      // Auto-clear after 4s
      setTimeout(() => rtRemove(typRef).catch(()=>{}), 4000);
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
  if(text.length > 500) { toast('That message is too long  -- 500 chars max.', 'warning'); return; }
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

// ---- Edit/Delete ----
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

// ── Emoji reactions ──
// Each message can have up to 12 different emoji, stored as a subcollection.

// Reaction definitions — label shown in the picker, emoji for the chip.
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

// addReaction — opens a floating emoji picker anchored to the reaction button.
window.addReaction = function(msgId) {
  // Only one picker can be open at a time — close any stale one first.
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

// renderReactions — rebuilds the row of emoji chips below a message.
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

// ---- Members  -- simple list sorted by rank (no presence) ----

async function loadMembers(ch) {
  const sidebar = document.querySelector('.members-sidebar');
  const headerEl = document.querySelector('.ms-header');
  const list = document.getElementById('members-list');
  if(!list) return;
  if(membersUnsub) { membersUnsub(); membersUnsub = null; }

  // Update header to show channel info
  if(headerEl) {
    const hdrTitle = (ch && ch.adminOnly) ? 'Admins' : 'Members';
    headerEl.innerHTML = `
      <div class="ms-header-title">${hdrTitle}</div>
      <div class="ms-channel-info">
        <span class="ms-channel-hash">#</span>
        <span class="ms-channel-label" id="ms-channel-label">${escHtml(ch.name)}</span>
      </div>`;
  }

  list.innerHTML = '<div class="ms-loading"><div class="ms-loading-dot"></div><div class="ms-loading-dot"></div><div class="ms-loading-dot"></div></div>';
  try {
    const snap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
    let members = snap.docs.map(d => d.data()).sort((a,b) => rankOf(b.rank) - rankOf(a.rank));

    // If this channel is admin-only (e.g. #admin), only show moderator/admin ranks
    if(ch && ch.adminOnly) {
      members = members.filter(u => canModerate(u.rank));
    }

    // Group by rank tier
    const tiers = [
      { key: 'goat',      label: 'Goat',      uids: [] },
      { key: 'universal', label: 'Universal',  uids: [] },
      { key: 'galactic',  label: 'Galactic',   uids: [] },
      { key: 'solar',     label: 'Solar',      uids: [] },
      { key: 'planetary', label: 'Planetary',  uids: [] },
      { key: 'earthbound',label: 'Earthbound', uids: [] },
    ];
    members.forEach(u => {
      const t = tiers.find(t => t.key === u.rank);
      if(t) t.uids.push(u);
    });

    list.innerHTML = '';
    let totalShown = 0;
    tiers.forEach(tier => {
      if(!tier.uids.length) return;
      const hdr = document.createElement('div');
      hdr.className = 'ms-tier-hdr';
      hdr.innerHTML = `<span class="ms-tier-name" style="color:${RANK_COLORS[tier.key]||'var(--text-faint)'}">${tier.label}</span><span class="ms-tier-count">${tier.uids.length}</span>`;
      list.appendChild(hdr);
      tier.uids.forEach(u => {
        const el = document.createElement('div');
        el.className = 'ms-item';
        el.innerHTML = `
          <div class="ms-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarHtml(u.icon,u.username,'60%')}</div>
          <div class="ms-info">
            <div class="ms-name" style="color:${u.color||avatarColor(u.uid)}">${escHtml(u.username)}</div>
            <div class="ms-rank" style="color:${RANK_COLORS[u.rank]||'var(--text-faint)'}">${(u.rank||'').toUpperCase()}</div>
          </div>`;
        el.addEventListener('click', () => window._openProfile(u.uid));
        list.appendChild(el);
        totalShown++;
      });
    });

    // Footer count
    const footer = document.createElement('div');
    footer.className = 'ms-footer';
    footer.textContent = `${totalShown} member${totalShown !== 1 ? 's' : ''}`;
    list.appendChild(footer);
  } catch(e) {
    list.innerHTML = '<div class="ms-error">Failed to load members</div>';
  }
}

async function loadAdminPanel(tab) {
  const c = document.getElementById('ap-'+tab);
  if(!c) return;
  c.innerHTML = '<div class="adm-loading"><div class="adm-spinner"></div><span>Loading…</span></div>';

  if(tab === 'pending') {
    try {
      const snap = await getDocs(query(collection(db,'users'), where('status','==','pending')));
      if(snap.empty) {
        c.innerHTML = '<div class="adm-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No pending requests</p></div>';
        return;
      }
      let html = '<div class="adm-list">';
      snap.forEach(s => {
        const d = s.data();
        // Show real name (fullName) in approval panel only
        const realName = d.fullName ? `<div class="adm-row-realname" title="Real name (approval only)">👤 ${escHtml(d.fullName)}</div>` : '';
        html += `
          <div class="adm-row" data-uid="${s.id}">
            <div class="adm-row-ava" style="background:${d.color||'#38bdf8'}">${avatarHtml(d.icon,d.username,'55%')}</div>
            <div class="adm-row-info">
              <div class="adm-row-name">${escHtml(d.username)}</div>
              ${realName}
              <div class="adm-row-email">${escHtml(d.email||'')}</div>
              <div class="adm-row-meta">Pending approval</div>
            </div>
            <div class="adm-row-actions">
              <button class="adm-btn adm-btn-approve" onclick="approveUser('${s.id}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Approve
              </button>
              <button class="adm-btn adm-btn-deny" onclick="denyUser('${s.id}','${escHtml(d.username)}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Deny
              </button>
            </div>
          </div>`;
      });
      html += '</div>';
      c.innerHTML = html;
    } catch(e) { c.innerHTML = `<div class="adm-error">Failed to load: ${escHtml(e.message)}</div>`; }

  } else if(tab === 'members') {
    try {
      const snap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
      const members = snap.docs.map(s => ({id:s.id,...s.data()})).sort((a,b) => {
        const RANKS = {goat:5,universal:4,galactic:3,solar:2,planetary:1,earthbound:0};
        return (RANKS[b.rank]||0) - (RANKS[a.rank]||0);
      });
      if(!members.length) {
        c.innerHTML = '<div class="adm-empty"><p>No approved members yet</p></div>';
        return;
      }
      let html = '<div class="adm-list">';
      members.forEach(d => {
        const rankColor = {'goat':'#fde68a','universal':'#e2e8f0','galactic':'#a855f7','solar':'#f59e0b','planetary':'#38bdf8','earthbound':'#6ee7b7'}[d.rank]||'#38bdf8';
        html += `
          <div class="adm-row" data-uid="${d.id}">
            <div class="adm-row-ava" style="background:${d.color||rankColor}">${avatarHtml(d.icon,d.username,'55%')}</div>
            <div class="adm-row-info">
              <div class="adm-row-name">${escHtml(d.username)}</div>
              <div class="adm-row-email">${escHtml(d.email||'')}</div>
              <div class="adm-row-meta"><span class="adm-rank-badge" style="color:${rankColor}">${(d.rank||'').toUpperCase()}</span></div>
            </div>
            <div class="adm-row-actions">
              <button class="adm-btn adm-btn-rank" onclick="changeRank('${d.id}','${d.rank}','${escHtml(d.username)}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg>
                Rank
              </button>
              <button class="adm-btn adm-btn-ban" onclick="banUser('${d.id}','${escHtml(d.username)}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
                Ban
              </button>
              <button class="adm-btn adm-btn-delete" onclick="deleteAccount('${d.id}','${escHtml(d.username)}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
              </button>
            </div>
          </div>`;
      });
      html += '</div>';
      c.innerHTML = html;
    } catch(e) { c.innerHTML = `<div class="adm-error">Failed to load: ${escHtml(e.message)}</div>`; }

  } else if(tab === 'banned') {
    try {
      const snap = await getDocs(query(collection(db,'users'), where('status','==','banned')));
      if(snap.empty) {
        c.innerHTML = '<div class="adm-empty"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:.3"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg><p>No banned users</p></div>';
        return;
      }
      let html = '<div class="adm-list">';
      snap.forEach(s => {
        const d = s.data();
        html += `
          <div class="adm-row adm-row-banned" data-uid="${s.id}">
            <div class="adm-row-ava" style="background:#ef4444;opacity:.7">${avatarHtml(d.icon,d.username,'55%')}</div>
            <div class="adm-row-info">
              <div class="adm-row-name">${escHtml(d.username)}</div>
              <div class="adm-row-email">${escHtml(d.email||'')}</div>
              <div class="adm-row-meta adm-row-banned-label">Banned</div>
            </div>
            <div class="adm-row-actions">
              <button class="adm-btn adm-btn-approve" onclick="unbanUser('${s.id}')">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Unban
              </button>
              <button class="adm-btn adm-btn-delete" onclick="deleteAccount('${s.id}','${escHtml(d.username)}')">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                Delete
              </button>
            </div>
          </div>`;
      });
      html += '</div>';
      c.innerHTML = html;
    } catch(e) { c.innerHTML = `<div class="adm-error">Failed to load: ${escHtml(e.message)}</div>`; }

  } else if(tab === 'cleanup') {
    renderDBCleanup(c);
  } else if(tab === 'announce') {
    renderAnnouncementPanel(c);
  }
}

// ── Create channel modal ──
// Universal+ can create channels with optional password and announce mode.
function showCreateChannelModal() {
  showModal(`
    <div>
      <div class="field-group"><label class="field-label">Channel Name</label><input id="m-chname" class="field-input" placeholder="my-channel" maxlength="32" /></div>
      <div class="field-group"><label class="field-label">Minimum Rank</label>
        <select id="m-chrank" class="field-input">
          <option value="planetary">Planetary</option>
          <option value="solar">Solar</option>
          <option value="galactic">Galactic</option>
          <option value="universal">Universal+</option>
        </select>
      </div>
      <div class="field-group" style="display:flex;align-items:center;gap:.5rem">
        <input type="checkbox" id="m-chann" /> <label for="m-chann" style="font-size:.78rem">Announce only (Universal+ posts, others view)</label>
      </div>
      <div class="field-group" style="display:flex;align-items:center;gap:.5rem">
        <input type="checkbox" id="m-chpwd" onchange="document.getElementById('m-pwdfield').classList.toggle('hidden',!this.checked)" />
        <label for="m-chpwd" style="font-size:.78rem">Password protected</label>
      </div>
      <div id="m-pwdfield" class="field-group hidden"><label class="field-label">Password</label><input id="m-chpwdval" class="field-input" type="text" placeholder="Channel password" /></div>
      <div class="merr" id="m-cherr"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
        <button class="btn btn-sm" onclick="window.createChannel()">Create Channel</button>
      </div>
    </div>
  `);
}

// ── Wipe thread (goat-only) ──
// Deletes all messages in a channel. The channel itself is preserved.
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

// ── DB Cleanup Panel (Goat-only) ──
function renderDBCleanup(container) {
  container.innerHTML = `
    <div class="cleanup-wrap-v2">
      <div class="cleanup-left-col">

        <!-- Live stats row -->
        <div class="cleanup-stats-row" id="cleanup-stats-row">
          <div class="cleanup-stat-tile" id="cst-users">
            <div class="cleanup-stat-num" id="cst-users-num">…</div>
            <div class="cleanup-stat-label">Total Users</div>
          </div>
          <div class="cleanup-stat-tile" id="cst-gc">
            <div class="cleanup-stat-num" id="cst-gc-num">…</div>
            <div class="cleanup-stat-label">GC Docs</div>
          </div>
          <div class="cleanup-stat-tile" id="cst-bj">
            <div class="cleanup-stat-num" id="cst-bj-num">…</div>
            <div class="cleanup-stat-label">BJ Games</div>
          </div>
          <div class="cleanup-stat-tile" id="cst-dms">
            <div class="cleanup-stat-num" id="cst-dms-num">…</div>
            <div class="cleanup-stat-label">DM Threads</div>
          </div>
        </div>

        <!-- Two-column category grid -->
        <div class="cleanup-cat-grid">

          <!-- Left column: Users & Economy -->
          <div class="cleanup-cat">
            <div class="cleanup-cat-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
              Users &amp; Economy
            </div>

            <div class="cleanup-op-card" id="cop-orphan">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Scan User States</div>
                  <div class="cleanup-op-sub">Find users with unexpected status values</div>
                </div>
                <button class="cleanup-op-btn" id="btn-scan-orphans">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  Scan
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.2 14.6h4.5c1.2 0 2-.7 2-1.7 0-1-.7-1.5-1.9-1.7l-2.4-.3c-1-.2-1.4-.5-1.4-1.1 0-.7.6-1.2 1.7-1.2h3.9" stroke-width="1.5"/><path d="M12 7.5v9" stroke-width="1.5"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Wipe All GoatCoin</div>
                  <div class="cleanup-op-sub">Reset every user's balance and all stats to zero</div>
                </div>
                <button class="cleanup-op-btn cleanup-op-btn-danger" onclick="window.cleanupWipeAllCoins()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Wipe
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Reset Weekly Stats</div>
                  <div class="cleanup-op-sub">Clear weekly counters — keeps balances intact</div>
                </div>
                <button class="cleanup-op-btn" onclick="window.cleanupResetWeeklyStats()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                  Reset
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Delete GC by UID</div>
                  <div class="cleanup-op-sub">Remove one user's GoatCoin document</div>
                  <input id="cleanup-gc-uid" class="cleanup-input" placeholder="Paste user UID…" />
                </div>
                <button class="cleanup-op-btn cleanup-op-btn-danger" onclick="window.cleanupDeleteUserGC()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Delete
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Reset Visit Counter</div>
                  <div class="cleanup-op-sub">Set the global page visit count to zero</div>
                </div>
                <button class="cleanup-op-btn" onclick="window.cleanupResetVisits()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                  Reset
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Reset All Profile Pics</div>
                  <div class="cleanup-op-sub">Remove custom icon from every user's profile (reverts to initials)</div>
                </div>
                <button class="cleanup-op-btn cleanup-op-btn-danger" onclick="window.cleanupResetAllProfilePics()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                  Reset
                </button>
              </div>
            </div>
          </div>

          <!-- Right column: Messages & Games -->
          <div class="cleanup-cat">
            <div class="cleanup-cat-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
              Messages &amp; Games
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Wipe All DMs</div>
                  <div class="cleanup-op-sub">Delete every DM thread and all messages permanently</div>
                </div>
                <button class="cleanup-op-btn cleanup-op-btn-danger" onclick="window.cleanupWipeDMs()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Wipe
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-warn">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Wipe Channel Messages</div>
                  <div class="cleanup-op-sub">Delete all messages in a specific channel</div>
                  <select id="cleanup-ch-sel" class="cleanup-select">
                    <option value="">Select a channel…</option>
                  </select>
                </div>
                <button class="cleanup-op-btn cleanup-op-btn-danger" onclick="window.cleanupWipeChannel()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Wipe
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Purge Stale BJ Games</div>
                  <div class="cleanup-op-sub">Remove completed or 24h+ old blackjack sessions</div>
                </div>
                <button class="cleanup-op-btn" onclick="window.cleanupPurgeBJGames()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Purge
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Clear BJ Challenges</div>
                  <div class="cleanup-op-sub">Delete all pending or cancelled blackjack challenges</div>
                </div>
                <button class="cleanup-op-btn" onclick="window.cleanupClearBJChallenges()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
                  Clear
                </button>
              </div>
            </div>

            <div class="cleanup-op-card">
              <div class="cleanup-op-hdr">
                <div class="cleanup-op-icon cleanup-op-icon-info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                </div>
                <div style="flex:1;min-width:0">
                  <div class="cleanup-op-title">Clear Offline Presence</div>
                  <div class="cleanup-op-sub">Remove stale presence documents from Firestore</div>
                </div>
                <button class="cleanup-op-btn" onclick="window.cleanupClearPresence()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Activity log (sticky right column) -->
      <div class="cleanup-log-v2">
        <div class="cleanup-log-hdr">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
          Activity Log
          <button class="cleanup-log-clear" id="btn-clear-cleanup-log">Clear</button>
        </div>
        <div class="cleanup-log" id="cleanup-log">
          <div class="cleanup-log-entry cleanup-log-info">Ready — select an operation.</div>
        </div>
      </div>
    </div>
  `;

  // Clear log button
  document.getElementById('btn-clear-cleanup-log')?.addEventListener('click', () => {
    const log = document.getElementById('cleanup-log');
    if(log) log.innerHTML = '<div class="cleanup-log-entry cleanup-log-info">Log cleared.</div>';
  });

  // Load live stats
  _loadCleanupStats();

  // Populate channel select
  getDocs(collection(db,'channels')).then(snap => {
    const sel = document.getElementById('cleanup-ch-sel');
    if(!sel) return;
    snap.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = '#' + escHtml(s.data().name || s.id);
      sel.appendChild(opt);
    });
  }).catch(() => {});

  // Scan orphan/bad-status users
  document.getElementById('btn-scan-orphans')?.addEventListener('click', async () => {
    _cleanupLog('Scanning for users with unexpected status values…', 'info');
    try {
      const snap = await getDocs(collection(db,'users'));
      const weird = [];
      snap.forEach(d => {
        const st = d.data().status;
        if(!['approved','pending','banned'].includes(st)) {
          weird.push({id: d.id, username: d.data().username, status: st});
        }
      });
      if(!weird.length) {
        _cleanupLog('All users have valid statuses. Nothing to fix.', 'success');
      } else {
        _cleanupLog(`Found ${weird.length} user(s) with unexpected status:`, 'warn');
        weird.forEach(u => _cleanupLog(`  • ${u.username || u.id} — status: "${u.status || 'undefined'}"`, 'warn'));
      }
    } catch(e) { _cleanupLog('Scan failed: ' + e.message, 'error'); }
  });
}

// Load live counts into the stats tiles
async function _loadCleanupStats() {
  try {
    const [users, gc, bj, dms] = await Promise.all([
      getDocs(collection(db,'users')),
      getDocs(collection(db,'goatcoin')),
      getDocs(collection(db,'bj_games')),
      getDocs(collection(db,'dms')),
    ]);
    const setNum = (id, val) => { const el = document.getElementById(id); if(el) el.textContent = val; };
    setNum('cst-users-num', users.size);
    setNum('cst-gc-num', gc.size);
    setNum('cst-bj-num', bj.size);
    setNum('cst-dms-num', dms.size);
  } catch(e) {
    ['cst-users-num','cst-gc-num','cst-bj-num','cst-dms-num'].forEach(id => {
      const el = document.getElementById(id); if(el) el.textContent = '?';
    });
  }
}

function _cleanupLog(msg, type='info') {
  const wrap = document.getElementById('cleanup-log');
  if(!wrap) return;
  const el = document.createElement('div');
  el.className = `cleanup-log-entry cleanup-log-${type}`;
  const time = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
  el.innerHTML = `<span class="cleanup-log-time">${time}</span><span>${typeof msg === 'string' ? msg : JSON.stringify(msg)}</span>`;
  wrap.appendChild(el);
  wrap.scrollTop = wrap.scrollHeight;
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
  if(!chId) { toast('Pick a channel from the dropdown first.','warning'); return; }
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

window.cleanupResetAllProfilePics = function() {
  showModal(`
    <h3>Reset All Profile Pics?</h3>
    <p class="modal-p">This will remove the custom icon from <strong>every user's profile</strong>, reverting them to their letter initials. This is permanent.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-reset-pics">Reset All Pics</button>
    </div>`);
  document.getElementById('confirm-reset-pics').onclick = async () => {
    closeModal();
    _cleanupLog('Resetting all profile icons…', 'info');
    try {
      const snap = await getDocs(collection(db,'users'));
      const batch = writeBatch(db);
      let count = 0;
      snap.docs.forEach(d => {
        if(d.data().icon) { batch.update(d.ref, {icon:''}); count++; }
      });
      if(!count) { _cleanupLog('No users with custom icons found.', 'info'); return; }
      await batch.commit();
      _cleanupLog(`Reset profile icons for ${count} user(s).`, 'success');
    } catch(e) { _cleanupLog('Failed: '+e.message, 'error'); }
  };
};

window.cleanupClearPresence = async function() {
  try {
    const snap = await getDocs(collection(db,'presence'));
    if(!snap.size) { _cleanupLog('No presence documents found.', 'info'); return; }
    const batch = writeBatch(db);
    snap.docs.forEach(d => batch.delete(d.ref));
    await batch.commit();
    _cleanupLog(`Cleared ${snap.size} presence document(s).`, 'success');
  } catch(e) { _cleanupLog('Failed: ' + e.message, 'error'); }
};

// ── Announcement Panel (Goat-only) ──
// Stores an announcement in RTDB. Each user sees it once on next app open, then it's marked seen.
// When all users have seen it, it auto-deletes from RTDB.
function renderAnnouncementPanel(container) {
  container.innerHTML = `
    <div class="announce-wrap">
      <div class="announce-form-card">
        <div class="announce-card-hdr">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17H2a3 3 0 000 4h20v-4z"/><path d="M14 9v8M9 9v8"/><path d="M12 4C10 4 8 6 8 9h8c0-3-2-5-4-5z"/></svg>
          Send Update to All Users
        </div>
        <div class="announce-card-sub">This message will appear as a popup the next time each user opens the app. Once everyone has seen it, it auto-deletes.</div>
        <div class="field-group" style="margin-top:1rem">
          <label class="field-label">Heading</label>
          <input id="ann-heading" class="field-input" type="text" placeholder="e.g. New feature dropped!" maxlength="80">
        </div>
        <div class="field-group">
          <label class="field-label">Message</label>
          <textarea id="ann-body" class="field-input" rows="4" placeholder="Write your announcement here..." maxlength="500" style="resize:vertical;min-height:80px"></textarea>
        </div>
        <div class="announce-actions">
          <button class="btn btn-sm" id="btn-send-announce">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send Announcement
          </button>
          <button class="btn btn-ghost btn-sm" id="btn-cancel-announce">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Cancel Active
          </button>
        </div>
        <div class="merr" id="ann-err"></div>
      </div>
      <div class="announce-current-card" id="ann-current">
        <div class="announce-current-hdr">Current Active Announcement</div>
        <div id="ann-current-content"><div style="color:var(--text-faint);font-size:.78rem">No active announcement.</div></div>
      </div>
    </div>
  `;

  // Announcement storage lives in Firestore to avoid RTDB rule conflicts.
  const annDocRef = doc(db, 'meta', 'announcement_active');

  // Load current announcement from Firestore
  async function loadCurrentAnnouncement() {
    const el = document.getElementById('ann-current-content');
    if(!el) return;
    try {
      const snap = await getDoc(annDocRef);
      const data = snap.exists() ? snap.data() : null;
      if(!data) { el.innerHTML='<div style="color:var(--text-faint);font-size:.78rem">No active announcement.</div>'; return; }
      const seen = Object.keys(data.seenBy||{}).length;
      el.innerHTML = `
        <div class="ann-preview">
          <div class="ann-preview-heading">${escHtml(data.heading||'')}</div>
          <div class="ann-preview-body">${escHtml(data.body||'')}</div>
          <div class="ann-preview-meta">Created ${new Date(data.createdAt||Date.now()).toLocaleString()} · Seen by ${seen} user(s)</div>
        </div>`;
    } catch(e) { el.innerHTML=`<div style="color:var(--danger);font-size:.78rem">Error: ${escHtml(e.message)}</div>`; }
  }
  loadCurrentAnnouncement();

  document.getElementById('btn-send-announce')?.addEventListener('click', async () => {
    const heading = document.getElementById('ann-heading')?.value.trim();
    const body = document.getElementById('ann-body')?.value.trim();
    const err = document.getElementById('ann-err');
    if(!heading) { if(err) err.textContent='Enter a heading'; return; }
    if(!body) { if(err) err.textContent='Enter a message'; return; }
    try {
      await setDoc(annDocRef, {
        heading, body, seenBy: {}, createdAt: Date.now(), createdBy: currentUser.uid
      });
      if(err) err.textContent='';
      toast('Announcement sent!', 'success');
      loadCurrentAnnouncement();
    } catch(e) { if(err) err.textContent='Failed: '+e.message; }
  });

  document.getElementById('btn-cancel-announce')?.addEventListener('click', async () => {
    if(!confirm('Cancel the active announcement?')) return;
    try {
      await deleteDoc(annDocRef).catch(()=>{});
      toast('Announcement cancelled.', 'info');
      loadCurrentAnnouncement();
    } catch(e) { toast('Failed: '+e.message, 'error'); }
  });
}

// Check and show announcement popup on app load (shown once per user)
async function checkAndShowAnnouncement() {
  if(!currentUser) return;
  const annDocRef = doc(db, 'meta', 'announcement_active');
  try {
    const snap = await getDoc(annDocRef);
    const data = snap.exists() ? snap.data() : null;
    if(!data) return;
    const uid = currentUser.uid;
    // Already seen?
    if(data.seenBy && data.seenBy[uid]) return;
    // Show popup
    showModal(`
      <div class="ann-popup">
        <div class="ann-popup-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17H2a3 3 0 000 4h20v-4z"/><path d="M14 9v8M9 9v8"/><path d="M12 4C10 4 8 6 8 9h8c0-3-2-5-4-5z"/></svg>
        </div>
        <h3>${escHtml(data.heading||'Update')}</h3>
        <div class="ann-popup-divider"></div>
        <div class="ann-popup-body">${escHtml(data.body||'')}</div>
        <div class="modal-actions" style="justify-content:center">
          <button class="btn btn-sm" id="ann-dismiss-btn">Got it</button>
        </div>
      </div>`);
    document.getElementById('ann-dismiss-btn')?.addEventListener('click', async () => {
      closeModal();
      // Mark as seen
      try {
        await updateDoc(annDocRef, { [`seenBy.${uid}`]: true }).catch(()=>{});
        // Check if all approved users have seen it — if so, delete
        const allUsersSnap = await getDocs(query(collection(db,'users'), where('status','==','approved')));
        const allUids = allUsersSnap.docs.map(d=>d.id);
        const updatedSnap = await getDoc(annDocRef);
        const updatedData = updatedSnap.exists() ? updatedSnap.data() : null;
        if(updatedData) {
          const seenCount = Object.keys(updatedData.seenBy||{}).length;
          if(seenCount >= allUids.length) {
            await deleteDoc(annDocRef).catch(()=>{});
          }
        }
      } catch(e) {}
    });
  } catch(e) {}
}

// ── Admin panel setup ──
// Dynamically builds the admin UI based on the current user's rank.
// Goat rank gets an extra DB Cleanup tab.
async function setupAdmin() {
  const d = currentUserData;
  const isGoat = d.rank === 'goat';

  const adminSection = document.getElementById('section-admin');
  if(!adminSection) return;

  adminSection.innerHTML = `
  <div class="admin-page">
    <div class="admin-header">
      <div class="admin-header-left">
        <div class="admin-header-icon">
          ${isGoat
            ? '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>'
            : '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'}
        </div>
        <div>
          <div class="admin-header-title">${isGoat ? 'Goat Console' : 'Mod Panel'}</div>
          <div class="admin-header-sub">${isGoat ? 'Full system access — users, data, moderation' : 'Approve members and moderate the community'}</div>
        </div>
      </div>
      <div class="admin-stats-row" id="admin-stats-row">
        <div class="admin-stat-card" id="adm-stat-pending">
          <div class="admin-stat-num" id="adm-cnt-pending">…</div>
          <div class="admin-stat-label">Pending</div>
        </div>
        <div class="admin-stat-card" id="adm-stat-members">
          <div class="admin-stat-num" id="adm-cnt-members">…</div>
          <div class="admin-stat-label">Members</div>
        </div>
        <div class="admin-stat-card" id="adm-stat-banned">
          <div class="admin-stat-num" id="adm-cnt-banned">…</div>
          <div class="admin-stat-label">Banned</div>
        </div>
      </div>
    </div>

    <div class="admin-nav">
      <button class="adm-tab active" data-tab="pending">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Pending
        <span class="adm-tab-badge hidden" id="adm-tab-badge-pending"></span>
      </button>
      <button class="adm-tab" data-tab="members">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        Members
      </button>
      <button class="adm-tab" data-tab="banned">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
        Banned
      </button>
      ${isGoat ? `<button class="adm-tab" data-tab="cleanup">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/><path d="M8 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        DB Cleanup
      </button>
      <button class="adm-tab" data-tab="announce">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17H2a3 3 0 000 4h20v-4z"/><path d="M14 9v8M9 9v8"/><path d="M12 4C10 4 8 6 8 9h8c0-3-2-5-4-5z"/></svg>
        Announce
      </button>` : ''}
    </div>

    <div class="admin-body">
      <div class="adm-panel active" id="ap-pending"></div>
      <div class="adm-panel" id="ap-members"></div>
      <div class="adm-panel" id="ap-banned"></div>
      ${isGoat ? '<div class="adm-panel" id="ap-cleanup"></div><div class="adm-panel" id="ap-announce"></div>' : ''}
    </div>
  </div>`;

  document.querySelectorAll('.adm-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('ap-'+t.dataset.tab)?.classList.add('active');
      loadAdminPanel(t.dataset.tab);
    });
  });

  loadAdminCounts();
  loadAdminPanel('pending');
}

async function loadAdminCounts() {
  try {
    const snap = await getDocs(collection(db,'users'));
    let p=0,m=0,b=0;
    snap.forEach(d => {
      const st = d.data().status;
      if(st === 'pending') p++;
      else if(st === 'banned') b++;
      else if(st === 'approved') m++;
    });
    const pEl = document.getElementById('adm-cnt-pending');
    const mEl = document.getElementById('adm-cnt-members');
    const bEl = document.getElementById('adm-cnt-banned');
    if(pEl) pEl.textContent = p;
    if(mEl) mEl.textContent = m;
    if(bEl) bEl.textContent = b;
    document.getElementById('adm-stat-pending')?.classList.toggle('admin-stat-alert', p>0);
    document.getElementById('adm-stat-banned')?.classList.toggle('admin-stat-alert', b>0);
    const badgeEl = document.getElementById('adm-tab-badge-pending');
    if(badgeEl) {
      badgeEl.textContent = p;
      badgeEl.classList.toggle('hidden', p === 0);
    }
  } catch(e) {}
}


// ---- DMs ----
let _dmListUnsub = null;

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

  // Use realtime listener so recipient sees new DMs without needing to start first
  subscribeDMList();
}

function subscribeDMList() {
  if(_dmListUnsub) { _dmListUnsub(); _dmListUnsub = null; }
  const list = document.getElementById('dm-list');
  if(!list) return;

  _dmListUnsub = onSnapshot(
    query(collection(db,'dms'), where('participants','array-contains',currentUser.uid), orderBy('lastTs','desc')),
    async snap => {
      list.innerHTML = '';
      for(const d of snap.docs) {
        const data = d.data();
        const otherId = data.participants.find(x=>x!==currentUser.uid);
        if(!otherId) continue;
        let other = _userCache[otherId];
        if(!other) {
          try {
            const otherSnap = await getDoc(doc(db,'users',otherId));
            if(!otherSnap.exists()) continue;
            other = otherSnap.data();
            _userCache[otherId] = other;
          } catch(e) { continue; }
        }
        // Check if this is a new DM thread the current user hasn't opened yet
        const isNew = !currentDM || currentDM.id !== d.id;
        const existingEl = list.querySelector(`[data-dmid="${d.id}"]`);
        if(existingEl) continue; // already rendered
        const item = document.createElement('div');
        item.className = 'titem';
        item.dataset.dmid = d.id;
        const ava = document.createElement('div'); ava.className='titem-ava'; ava.style.background=other.color||avatarColor(other.uid||''); ava.innerHTML=avatarHtml(other.icon,other.username,'60%'); item.appendChild(ava);
        const nm=document.createElement('span'); nm.className='titem-name'; nm.textContent=other.username; item.appendChild(nm);
        item.addEventListener('click', ()=>openDM(other, d.id));
        list.appendChild(item);
        // Auto-update unread badge for new DM threads not currently open
        if(isNew && !list.classList.contains('active-listener-set')) {
          const isDMSectionActive = document.getElementById('section-dms')?.classList.contains('active');
          if(!isDMSectionActive) {
            _unreadDMs[d.id] = (_unreadDMs[d.id]||0);
            _updateDMBadge();
          }
        }
      }
    },
    err => console.warn('DM list listener error:', err)
  );
}

async function loadDMList() {
  // Kept for backward compat — just re-subscribe
  subscribeDMList();
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
              _unreadDMs[dmId] = (_unreadDMs[dmId]||0)+1;
              _updateDMBadge(); _updateDMListBadges();
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
  // DM typing indicator (RTDB)  -- per DM thread
  let dmTypingDebounce = null;
  input.addEventListener('input', () => {
    if(!currentDM || !_rtdb) return;
    clearTimeout(dmTypingDebounce);
    dmTypingDebounce = setTimeout(() => {
      const typRef = rtRef(_rtdb, 'typing_dm/' + currentDM.id + '/' + currentUser.uid);
      rtSet(typRef, { username: currentUserData.username, ts: Date.now() }).catch(()=>{});
      setTimeout(() => rtRemove(typRef).catch(()=>{}), 4000);
    }, 300);
  });
}

async function sendDM() {
  const input = document.getElementById('dm-input');
  const text = input.value.trim();
  if(!text || !currentDM) return;
  if(text.length>500) { toast('Message is too long (max 500 chars).', 'warning'); return; }
  input.value = '';
  try {
    await addDoc(collection(db,`dms/${currentDM.id}/messages`),{
      uid:currentUser.uid, username:currentUserData.username,
      color:currentUserData.color, icon:currentUserData.icon||'',
      badges:currentUserData.badges||[], text, ts:serverTimestamp()
    });
    // Update lastTs to trigger realtime list listener on recipient's side
    await updateDoc(doc(db,'dms',currentDM.id),{lastTs:serverTimestamp()});
  } catch(e) {
    toast('Failed to send message.', 'error');
    input.value = text; // restore on failure
  }
}

// ---- Profile ----
const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#a855f7','#10b981','#0ea5e9','#f59e0b','#64748b'];


function setupProfile() {
  renderOwnProfile(currentUser, currentUserData, getGoatCoinData());
  renderProfileEdit();
}

const SVG_ICONS = {
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

function avatarHtml(iconKey, username, size='100%') {
  if(!iconKey) return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
  const paths = SVG_ICONS[iconKey];
  if(paths) return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  if(iconKey === 'goat') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>`;
  return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
}

// ---- Propagate profile changes (username/color/icon/badges) to all existing messages ----
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

  section.innerHTML = `
    <!-- Avatar Card -->
    <div class="prof-edit-card">
      <div class="prof-edit-card-hdr">
        <div class="prof-edit-card-hdr-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 011.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>
        </div>
        <div class="prof-edit-card-title">Avatar & Color</div>
      </div>
      <div class="prof-edit-card-body">
        <div class="prof-ava-section">
          <div class="prof-ava-preview-wrap">
            <div class="prof-ava-preview" id="prof-ava-live" style="background:${d.color||avatarColor(d.uid)}">${avatarHtml(d.icon,d.username,'55%')}</div>
            <div class="prof-ava-preview-label">Preview</div>
          </div>
          <div class="prof-ava-picker-cols">
            <div>
              <div class="prof-subsection-label">Icon</div>
              <div class="ava-icon-grid" id="ava-icon-grid"></div>
            </div>
            <div>
              <div class="prof-subsection-label" style="margin-top:.6rem">Color</div>
              <div class="color-swatch-grid" id="color-swatches"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Username Card -->
    <div class="prof-edit-card">
      <div class="prof-edit-card-hdr">
        <div class="prof-edit-card-hdr-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </div>
        <div class="prof-edit-card-title">Username</div>
        ${!canChangeUsername ? `<div class="prof-edit-card-badge">Changes in ${cooldownDays}d</div>` : ''}
      </div>
      <div class="prof-edit-card-body">
        <div class="prof-row">
          <input id="prof-username-inp" class="field-input" type="text" value="${escHtml(d.username)}" maxlength="20" placeholder="Username" ${canChangeUsername?'':'disabled'}>
          <button class="btn btn-sm" id="prof-username-btn" ${canChangeUsername?'':'disabled'}>Save</button>
        </div>
        ${!canChangeUsername ? '<div class="prof-cooldown">Usernames can be changed once every 7 days.</div>' : ''}
        <div class="merr" id="prof-username-err"></div>
      </div>
    </div>

    <!-- Email Card -->
    <div class="prof-edit-card">
      <div class="prof-edit-card-hdr">
        <div class="prof-edit-card-hdr-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        </div>
        <div class="prof-edit-card-title">Email Address</div>
      </div>
      <div class="prof-edit-card-body">
        <div class="prof-row">
          <input id="prof-email-inp" class="field-input" type="email" value="${escHtml(d.email||auth.currentUser?.email||'')}" placeholder="your@email.com">
          <button class="btn btn-sm" id="prof-email-btn">Update</button>
        </div>
        <div class="merr" id="prof-email-err"></div>
      </div>
    </div>

    <!-- Password Card -->
    <div class="prof-edit-card">
      <div class="prof-edit-card-hdr">
        <div class="prof-edit-card-hdr-icon">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        </div>
        <div class="prof-edit-card-title">Change Password</div>
      </div>
      <div class="prof-edit-card-body">
        <div class="prof-fields">
          <input id="prof-pass-cur"  class="field-input" type="password" placeholder="Current password">
          <input id="prof-pass-new"  class="field-input" type="password" placeholder="New password (min 6 chars)">
          <input id="prof-pass-conf" class="field-input" type="password" placeholder="Confirm new password">
        </div>
        <button class="btn btn-sm" id="prof-pass-btn" style="margin-top:.5rem">Change Password</button>
        <div class="merr" id="prof-pass-err"></div>
      </div>
    </div>
  `;

  // ---- Color swatches ----
  const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#a855f7','#10b981','#0ea5e9','#f59e0b','#64748b'];
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
      // Update all avatar displays
      ['sp-ava','prof-ava','prof-ava-live'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.background = color;
      });
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-ava`).forEach(el => el.style.background = color);
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-name`).forEach(el => el.style.color = color);
      // Update banner background
      const bannerBg = document.querySelector('.prof-banner-bg');
      if(bannerBg) bannerBg.style.background = `linear-gradient(135deg,${color}60,${color}22,var(--bg))`;
      propagateProfileToMessages(currentUser.uid, { color }).catch(()=>{});
      toast('Avatar color updated.','success');
    });
    swatchWrap.appendChild(sw);
  });

  // ---- Icon grid ----
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
    const previewHtml = avatarHtml(iconKey, d.username, '55%');
    ['sp-ava','prof-ava'].forEach(id => {
      const el = document.getElementById(id);
      if(el) el.innerHTML = html;
    });
    const live = document.getElementById('prof-ava-live');
    if(live) live.innerHTML = previewHtml;
  }

  // ---- Username save ----
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
      toast('Username updated.','success');
      propagateProfileToMessages(currentUser.uid, { username: newName }).catch(()=>{});
      renderProfileEdit();
    } catch(e) { err.textContent = e.message; }
  });

  // ---- Email update ----
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
      </div>`);
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

  // ---- Password change ----
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

// ---- Settings ----
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

  // Sound volume slider
  const volSlider = document.getElementById('master-vol');
  const volVal = document.getElementById('master-vol-val');
  function updateSliderFill(slider) {
    const pct = ((slider.value - slider.min) / (slider.max - slider.min) * 100).toFixed(1) + '%';
    slider.style.setProperty('--slider-fill', pct);
  }
  if(volSlider) {
    const savedVol = localStorage.getItem('neb_sound_vol') || '70';
    volSlider.value = savedVol;
    updateSliderFill(volSlider);
    if(volVal) volVal.textContent = savedVol + '%';
    volSlider.addEventListener('input', () => {
      updateSliderFill(volSlider);
      if(volVal) volVal.textContent = volSlider.value + '%';
      localStorage.setItem('neb_sound_vol', volSlider.value);
    });
  }

  // Bubble style buttons
  const savedBubble = localStorage.getItem('neb_bubble_style') || 'cozy';
  document.querySelectorAll('.bubble-style-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.bubble === savedBubble);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bubble-style-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      localStorage.setItem('neb_bubble_style', btn.dataset.bubble);
      // Apply bubble class to body for future CSS use
      document.body.dataset.bubbleStyle = btn.dataset.bubble;
    });
  });
  document.body.dataset.bubbleStyle = savedBubble;

  // Accent color swatches
  const savedAccent = localStorage.getItem('neb_accent_override') || 'theme';
  document.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.accent === savedAccent);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const accent = btn.dataset.accent;
      localStorage.setItem('neb_accent_override', accent);
      applyAccentOverride(accent);
    });
  });
  applyAccentOverride(savedAccent);

  // Reset all settings button
  document.getElementById('btn-reset-settings')?.addEventListener('click', () => {
    showModal(`
      <h3>Reset All Settings?</h3>
      <p class="modal-p">This clears every saved preference and reloads with defaults. Your account data is not affected.</p>
      <div class="modal-actions">
        <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
        <button class="btn btn-danger btn-sm" id="confirm-reset-prefs">Reset Everything</button>
      </div>`);
    document.getElementById('confirm-reset-prefs').onclick = () => {
      // Clear all neb_ keys from localStorage
      const keys = Object.keys(localStorage).filter(k => k.startsWith('neb_'));
      keys.forEach(k => localStorage.removeItem(k));
      closeModal(() => { toast('Settings reset — reloading…', 'info'); setTimeout(() => location.reload(), 800); });
    };
  });

  // Panic URL
  const panicInput = document.getElementById('panic-url-input');
  if(panicInput) {
    const savedPanic = localStorage.getItem('neb_panic_url') || 'https://clever.com/in/northshore/student/portal';
    panicInput.value = savedPanic;
    panicInput.addEventListener('input', () => {
      localStorage.setItem('neb_panic_url', panicInput.value.trim());
    });
    const promptBtn = document.getElementById('btn-panic-prompt');
    if(promptBtn) {
      promptBtn.onclick = () => {
        const url = prompt('Enter a new Panic Redirect URL:', panicInput.value);
        if(url !== null) {
          panicInput.value = url.trim();
          localStorage.setItem('neb_panic_url', url.trim());
        }
      };
    }
  }

  buildChannelNotifList();
}

// Apply a CSS variable override for the accent color
function applyAccentOverride(accent) {
  if(!accent || accent === 'theme') {
    document.documentElement.style.removeProperty('--accent-override');
    document.documentElement.classList.remove('has-accent-override');
  } else {
    document.documentElement.style.setProperty('--accent-override', accent);
    document.documentElement.classList.add('has-accent-override');
  }
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
    <p class="modal-p">This removes all data for <strong>${escHtml(username)}</strong>: profile, GoatCoin balance, and all history. The Firebase Auth account will remain (you'll need to delete it from the Firebase console). This cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Cancel</button>
      <button class="btn btn-danger btn-sm" id="confirm-delacc-btn">Delete Everything</button>
    </div>
  `);
  document.getElementById('confirm-delacc-btn').onclick = async () => {
    try {
      await deleteDoc(doc(db,'users',uid)).catch(()=>{});
      await deleteDoc(doc(db,'goatcoin',uid)).catch(()=>{});
      await deleteDoc(doc(db,'presence',uid)).catch(()=>{});
      closeModal(() => { loadAdminPanel('banned'); toast(`Account data for ${username} deleted.`, 'success'); });
    } catch(e) { toast('Failed to delete: '+e.message, 'error'); }
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

// ---- Game Vault ----
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
  // Reset frame first
  frame.removeAttribute('srcdoc');
  frame.src = 'about:blank';

  // Determine if this is a multi-file game (directory-based, e.g. goattech/)
  // Multi-file games should be loaded via src directly so relative paths work
  const isMultiFile = url.includes('/goattech/') || url.endsWith('/index.html');

  if (isMultiFile) {
    // Multi-file games: load directly via src — jsDelivr serves all assets
    frame.src = url;
  } else {
    // Single-file HTML games: fetch, clean, inject <base> tag, use srcdoc
    const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    fetch(url + '?t=' + Date.now())
      .then(r => r.text())
      .then(html => {
        html = cleanHTML(html);
        // Inject <base> tag so relative resources resolve from jsDelivr
        if (html.includes('<head>')) {
          html = html.replace('<head>', `<head><base href="${baseUrl}">`);
        } else if (html.includes('<HEAD>')) {
          html = html.replace('<HEAD>', `<HEAD><base href="${baseUrl}">`);
        } else {
          html = `<base href="${baseUrl}">` + html;
        }
        frame.srcdoc = html;
        frame._gameUrl = url;
        frame._gameName = name;
      })
      .catch(() => {
        // Fallback: load URL directly
        frame.removeAttribute('srcdoc');
        frame.src = url;
      });
  }

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
  frame.removeAttribute('srcdoc');
  frame.src='about:blank';
};
window.fullscreenGame = function() {
  const frame = document.getElementById('game-frame');
  if(frame.requestFullscreen) frame.requestFullscreen();
  else if(frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
};

// ---- Profile click handler ----
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

// ---- Boot ----
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

// ---- Keyboard Shortcuts ----
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Don't trigger shortcuts when typing in inputs
    const tag = document.activeElement?.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;

    // Ctrl+K / Cmd+K  -- command palette (always works)
    if((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }

    // Escape  -- close things
    if(e.key === 'Escape') {
      const cmd = document.getElementById('cmd-palette');
      if(cmd && !cmd.classList.contains('hidden')) {
        cmd.classList.add('hidden');
        return;
      }
      const ov = document.getElementById('modal-overlay');
      if(ov && !ov.classList.contains('hidden')) {
        ov.click();
        return;
      }
      const vault = document.getElementById('game-vault');
      if(vault && vault.style.display === 'flex') {
        window.closeGameVault();
        return;
      }
      return;
    }

    // Panic Button (\)
    if(e.key === '\\') {
      const panicUrl = localStorage.getItem('neb_panic_url') || 'https://clever.com/in/northshore/student/portal';
      window.location.href = panicUrl;
      return;
    }

    if(isInput) return;

    // Number keys  -- navigate sections (1-9 for regular, admin via command palette)
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
  const base = ['home','chat','dms','games','goatcoin','shop','ai','profile','settings'];
  if(currentUserData && canModerate(currentUserData.rank)) {
    base.push('admin');
  }
  return base;
}

// ---- Command Palette ----
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
      { label: 'AI Chat',         desc: 'Ask the AI anything',    action: () => navigate('ai'),        svgKey: 'ai',       keys: '7' },
      { label: 'Profile',         desc: 'Your identity',          action: () => navigate('profile'),   svgKey: 'profile',  keys: '8' },
      { label: 'Settings',        desc: 'Themes & display',       action: () => navigate('settings'),  svgKey: 'settings', keys: '9' },
    ];
    if(isAdmin) {
      cmds.push({ label: 'Admin', desc: 'Moderation & management', action: () => navigate('admin'), svgKey: 'admin' });
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

// ---- DM char counter ----
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

// ---- Exports for other modules ----
export { toast, avatarColor, avatarInitial, escHtml, avatarHtml, canModerate, RANK_COLORS, RANKS, rankOf, SVG_ICONS, renderRankBadge };