// ═══════════════════════════════════════════════════
//  app.js — Core app logic
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs,
  onSnapshot, orderBy, limit, serverTimestamp, increment, deleteDoc, addDoc,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from './firebase.js';
import { updateEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initGoatCoin, setActivity, cleanupGoatCoin, getGoatCoinData, renderGoatCoinTab } from './goatcoin.js';
import { renderBadgeRow, openProfileModal, renderOwnProfile, checkAutoAwards, BADGE_DEFS, checkAdblocker } from './profile.js';

// ── State ──
let currentUser = null;
let currentUserData = null;
let currentChannel = null;
let currentDM = null;
let channelUnsub = null;
let dmUnsub = null;
let membersUnsub = null;
let typingTimeout = null;
let editingMsgId = null;
let visitsUnsub = null;
let _pendingSignup = false;
const _userCache = {}; // uid -> userData, short-lived cache
const _unreadChannels = {}; // channelId -> count
const _unreadDMs = {};      // dmId -> count
let _unreadEnabled = true;  // setting toggle

// ── Rank utils ──
export const RANKS = { earthbound:0, planetary:1, solar:2, galactic:3, universal:4, goat:5 };
export const rankOf = r => RANKS[r] ?? -1;
export const canModerate = r => rankOf(r) >= rankOf('universal');
export const canChat = r => rankOf(r) >= rankOf('planetary');
export const RANK_COLORS = {
  earthbound:'#6ee7b7', planetary:'#38bdf8', solar:'#f59e0b',
  galactic:'#a855f7', universal:'#e2e8f0', goat:'#fde68a'
};

// ── Avatar colors ──
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

  // Respect theme-anim setting
  const themeAnimOn = localStorage.getItem('neb_notif_theme-anim') !== 'false';

  // On boot (no animation), just swap the href directly
  if (!animate || _themeTransitioning || !themeAnimOn) {
    let link = document.getElementById('theme-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'theme-stylesheet';
      document.head.appendChild(link);
    }
    link.href = `css/themes/${file}?v=${Date.now()}`;
    return;
  }

  // Check if theme animation is disabled
  const themeAnimOff = localStorage.getItem('neb_notif_theme-anim') === 'false';
  if(themeAnimOff) {
    let link = document.getElementById('theme-stylesheet');
    if(!link) { link = document.createElement('link'); link.rel='stylesheet'; link.id='theme-stylesheet'; document.head.appendChild(link); }
    link.href = `css/themes/${file}?v=${Date.now()}`;
    return;
  }

  _themeTransitioning = true;

  // Create overlay that covers the whole screen
  const overlay = document.createElement('div');
  overlay.id = 'theme-transition-overlay';
  document.body.appendChild(overlay);

  // Force reflow so the initial state is painted before animating
  overlay.getBoundingClientRect();

  // Animate in (cover)
  overlay.classList.add('tto-in');

  // Once covered, swap the stylesheet
  overlay.addEventListener('animationend', () => {
    let link = document.getElementById('theme-stylesheet');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.id = 'theme-stylesheet';
      document.head.appendChild(link);
    }

    // When new stylesheet loads, animate out (reveal)
    const revealAndClean = () => {
      overlay.classList.remove('tto-in');
      overlay.classList.add('tto-out');
      overlay.addEventListener('animationend', () => {
        overlay.remove();
        _themeTransitioning = false;
      }, { once: true });
    };

    link.onload = revealAndClean;
    link.href = `css/themes/${file}?v=${Date.now()}`;
    // Fallback if onload doesn't fire (already cached)
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
function loadLayout() {
  return localStorage.getItem('neb_layout') || 'default';
}
function applyLayout(name) {
  LAYOUTS.forEach(l => document.body.classList.remove('layout-'+l));
  if(name !== 'default') document.body.classList.add('layout-'+name);
  localStorage.setItem('neb_layout', name);

  const isSidebar = name === 'default' || name === 'sidebar-right';

  if(!isSidebar) {
    // Top/bottom: force labels off — sidebar becomes a horizontal bar
    document.body.classList.add('hide-nav-labels');
    // Also remove compact-sidebar class — doesn't apply to horizontal bars
    document.body.classList.remove('compact-sidebar');
  } else {
    // Restore user's real nav-labels preference (default ON)
    // Note: nav-labels is never saved as 'false' by layout changes, only by user toggle
    const labelsStored = localStorage.getItem('neb_notif_nav-labels');
    const labelsOn = labelsStored === null || labelsStored === 'true';
    document.body.classList.toggle('hide-nav-labels', !labelsOn);

    // Sync the toggle checkbox to match
    const labelsToggle = document.querySelector('.notif-toggle[data-key="nav-labels"]');
    if(labelsToggle) labelsToggle.checked = labelsOn;

    // Restore compact-sidebar preference (default OFF)
    const compactStored = localStorage.getItem('neb_notif_compact-sidebar');
    document.body.classList.toggle('compact-sidebar', compactStored === 'true');

    // Restore saved sidebar width explicitly — clears any inline override
    const savedW = localStorage.getItem('neb_sidebar_w') || '224';
    document.documentElement.style.setProperty('--sidebar-w', savedW + 'px');
  }
}

// ── Notification Permission ──
function requestNotifPermission() {
  if(!('Notification' in window)) return;
  if(Notification.permission === 'default') {
    // Slight delay so it doesn't fire immediately on login
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
  // Password visibility toggle
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
        // Flag prevents onAuthStateChanged from running initApp before doc is written
        _pendingSignup = true;
        let cred;
        try {
          cred = await createUserWithEmailAndPassword(auth, email, pass);
        } catch(ex2) {
          _pendingSignup = false;
          throw ex2;
        }
        // Check username uniqueness (now authenticated for the Firestore query)
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
        // Manually call initApp now that the Firestore doc is guaranteed written
        await initApp(cred.user);
        return; // prevent onAuthStateChanged from double-firing initApp
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
  // If a signup write is still in flight, bail — the signup handler calls us manually once done
  if(_pendingSignup) return;
  const snap = await getDoc(doc(db,'users',user.uid));
  if(!snap.exists()) {
    // Doc may not exist yet for brand new accounts — wait briefly and retry once
    await new Promise(r => setTimeout(r, 1200));
    const snap2 = await getDoc(doc(db,'users',user.uid));
    if(!snap2.exists()) { await signOut(auth); showAuth(); return; }
    return initApp(user); // retry with fresh read
  }
  const data = snap.data();
  currentUser = user; currentUserData = data;

  if(data.status === 'pending') {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('pending-screen').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');
    // Sign out but stay on pending screen
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
  initGoatCoin(user, data);
  // Refresh profile stats whenever goatcoin data updates
  window._onGCUpdate = () => {
    const sec = document.getElementById('section-profile');
    if(sec?.classList.contains('active')) {
      renderOwnProfile(currentUser, currentUserData, window._getGCData?.());
      setTimeout(() => renderProfileEdit(), 0);
    }
  };
  checkAutoAwards(user.uid, data);
  setTimeout(checkAdblocker, 2000);
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

  // Show/hide admin nav
  const adminNav = document.getElementById('nav-admin');
  if(adminNav) adminNav.classList.toggle('hidden', !canModerate(d.rank));

  document.getElementById('sp-signout').addEventListener('click', async () => {
    if(channelUnsub) { channelUnsub(); channelUnsub=null; }
    if(dmUnsub)      { dmUnsub();      dmUnsub=null; }
    if(membersUnsub) { membersUnsub(); membersUnsub=null; }
    cleanupGoatCoin();
    // Reset all state
    currentUser=null; currentUserData=null; currentChannel=null; currentDM=null;
    // Hide app, show auth
    document.getElementById('app').classList.add('hidden');
    document.getElementById('pending-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    // Clear auth form
    const ef=document.getElementById('auth-err'); if(ef) ef.textContent='';
    const pf=document.getElementById('auth-pass'); if(pf) pf.value='';
    // Sign out from Firebase (won't reload page)
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
  // Track activity context for GoatCoin earning
  setActivity(section === 'chat' ? 'chat' : section === 'games' ? 'game' : 'site');
  // GoatCoin tab needs an explicit render trigger since Firestore won't re-fire
  if(section === 'goatcoin') renderGoatCoinTab();

  // Close mobile drawer if open
  document.getElementById('mobile-drawer-overlay')?.remove();
  document.getElementById('mobile-drawer')?.remove();
}

// ── Home / Visits ──
const TOOLTIPS_RAW = [
  "nebula never dies", "disable your adblocker for goatcoin", "lock in gng", "stfu fleece", "dm me for tooltip suggestions", "now with more customization", "plz dont hack", "find the tabernacle", "is ts peak", "goattech is better", "proxies dont take the internet", "no goofy ahh minecraft kids", "defenitley not vibe coded", "join hackclub", "67 67 676767 hahahhahahah", "great uncle tup tup never dies", "lightsped", "why are you reading this", "in the big 26", "touch grass gng", "lets go gambling", "all on red", "ask not what nebula can do for you", "imagine not having the goat rank", "goatcoin > bitcoin",
];

// Fisher-Yates shuffle
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
  // Tooltips with shuffle
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

    // Fix tooltip overlap on tab return — clear any stale elements
    document.addEventListener('visibilitychange', () => {
      if(!document.hidden) {
        wrap.querySelectorAll('.tt-el').forEach((el, i) => { if(i > 0) el.remove(); });
      }
    });
  }

  // Real parallax — layers move with mouse
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

  // FPS
  setupFPS();
  // Battery
  setupBattery();

  // Nav card clicks
  document.querySelectorAll('.home-card[data-goto]').forEach(c => {
    c.addEventListener('click', () => navigate(c.dataset.goto));
  });
}

function setupFPS() {
  let frames=0, last=performance.now(), fps=0;
  const el = document.getElementById('fps-val');
  const meter = document.getElementById('home-fps');
  function tick(t) {
    frames++;
    if(t-last>=1000) {
      fps = Math.round(frames*1000/(t-last));
      frames=0; last=t;
      if(el) el.textContent = fps;
      if(meter) {
        meter.className = fps>=55?'fps-good':fps>=30?'fps-warn':'fps-bad';
      }
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
      const svgId = charging?'batt-charging':pct>60?'batt-full':pct>20?'batt-mid':'batt-low';
      el.innerHTML = `
        <svg id="${svgId}" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          ${charging ? `<path d="M5 18H3a2 2 0 01-2-2V8a2 2 0 012-2h3.19M15 6h2a2 2 0 012 2v8a2 2 0 01-2 2h-3.19M23 13v-2M11 6l-4 6h6l-4 6"/>` :
          `<rect x="2" y="7" width="18" height="10" rx="2"/><line x1="22" y1="11" x2="22" y2="13"/><rect x="4" y="9" width="${Math.round(pct/100*13)}" height="6" rx="1" fill="currentColor" stroke="none"/>`}
        </svg>
        <span style="font-size:.78rem;font-weight:700;color:${pct<=20?'var(--danger)':pct<=50?'var(--warn)':'var(--success)'};">${charging?'⚡':''} ${pct}%</span>
      `;
    }
    updateBatt();
    batt.addEventListener('levelchange', updateBatt);
    batt.addEventListener('chargingchange', updateBatt);
  } catch(e) {
    el.innerHTML = `<span style="font-size:.7rem;color:var(--text-faint)">No battery API</span>`;
  }
}

// ── Presence ──
let _presenceInterval = null;
function setupPresence() {
  const uid = currentUser.uid;
  const ref = doc(db, 'presence', uid);
  function beat() {
    setDoc(ref, {
      uid, username: currentUserData.username,
      color: currentUserData.color||avatarColor(uid),
      rank: currentUserData.rank,
      lastSeen: serverTimestamp(), online: true
    }, { merge: true }).catch(()=>{});
  }
  beat();
  if(_presenceInterval) clearInterval(_presenceInterval);
  _presenceInterval = setInterval(beat, 30000); // heartbeat every 30s

  // Mark offline on unload
  window.addEventListener('beforeunload', () => {
    setDoc(ref, { online: false, lastSeen: serverTimestamp() }, { merge: true }).catch(()=>{});
    clearInterval(_presenceInterval);
  });

  // Pause heartbeat when tab hidden, resume on focus
  document.addEventListener('visibilitychange', () => {
    if(document.hidden) { clearInterval(_presenceInterval); }
    else { beat(); _presenceInterval = setInterval(beat, 30000); }
  });
}

function trackVisits() {
  const el = document.getElementById('visits-count');
  if(!el) return;
  const ref = doc(db,'meta','visits');
  // Increment on every page load
  updateDoc(ref, { count: increment(1) }).catch(() => setDoc(ref, { count: 1 }, { merge: true }));
  // Live listener
  visitsUnsub = onSnapshot(ref, snap => {
    if(snap.exists()) el.textContent = (snap.data().count || 0).toLocaleString();
  });
}

// ── Award a badge to current user ──
async function awardBadge(key) {
  if(!currentUser || !currentUserData) return;
  const existing = currentUserData.badges || [];
  if(existing.includes(key)) return;
  const newBadges = [...existing, key];
  currentUserData.badges = newBadges;
  await updateDoc(doc(db,'users',currentUser.uid), { badges: newBadges }).catch(()=>{});
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

  // Build from hardcoded + db
  let channels = [...HARDCODED_CHANNELS];
  const customSnap = await getDocs(query(collection(db,'channels'), orderBy('createdAt','asc')));
  customSnap.forEach(s => channels.push({id:s.id, ...s.data()}));

  // Filter by access
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

  // Add channel button for universal+
  if(canModerate(d.rank)) {
    const addBtn = document.getElementById('ts-add-channel');
    if(addBtn) { addBtn.classList.remove('hidden'); addBtn.addEventListener('click', showCreateChannelModal); }
  }
}

async function openChannel(ch) {
  // Password check for protected channels
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

  const msgsWrap = document.getElementById('messages-wrap');
  msgsWrap.innerHTML = '<div class="messages" id="messages"></div>';
  if(channelUnsub) channelUnsub();

  loadMembers(ch);
  subscribeChannel(ch.id);
  // Clear unread for this channel
  _unreadChannels[ch.id] = 0;
  _updateChatBadge();
  _updateChannelListBadges();

  // Announce-only input lock
  const isAnnounce = ch.announce && !canModerate(currentUserData.rank);
  document.getElementById('chat-input').disabled = isAnnounce;
  document.getElementById('chat-send-btn').disabled = isAnnounce;
  document.getElementById('chat-input').placeholder = isAnnounce ? 'Announcements only' : `Message #${ch.name}`;
}

function subscribeChannel(channelId) {
  const msgsRef = collection(db, `channels/${channelId}/messages`);
  let initialized = false;
  // Reset group tracking per channel
  lastMsgSender = null; lastMsgTime = null;
  channelUnsub = onSnapshot(
    query(msgsRef, orderBy('ts','asc'), limit(100)),
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
            // Count unread if not currently viewing this channel
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

  // Typing listener
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

let lastMsgSender = null, lastMsgTime = null;
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
    el.innerHTML = `
      <div class="msg-ava-wrap"><div class="msg-ava" style="background:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${avatarHtml(data.icon,data.username,"60%")}</div></div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-name" style="color:${color};cursor:pointer" onclick="window._openProfile('${data.uid}')">${escHtml(data.username)}</span>
          <span class="rbadge ${data.rank||'planetary'}">${data.rank||'planetary'}</span>
          ${renderBadgeRow(data.badges||[], true)}
          <span class="msg-ts">${tsStr}</span>
        </div>
        <div class="msg-text">${formatMsg(data.text||'')}</div>
        ${data.edited?'<span class="msg-edited">(edited)</span>':''}
        <div class="msg-reactions" id="reacts-${id}"></div>
      </div>
      <div class="msg-actions">
        <button class="mab" onclick="window.addReaction('${id}')">+</button>
        ${canEdit?`<button class="mab" onclick="window.editMsg('${id}','${encodeURIComponent(data.text||'')}')">Edit</button>`:''}
        ${canDelete?`<button class="mab d" onclick="window.deleteMsg('${id}')">Del</button>`:''}
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
        <button class="mab" onclick="window.addReaction('${id}')">+</button>
        ${canEdit?`<button class="mab" onclick="window.editMsg('${id}','${encodeURIComponent(data.text||'')}')">Edit</button>`:''}
        ${canDelete?`<button class="mab d" onclick="window.deleteMsg('${id}')">Del</button>`:''}
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
  // Dynamically refresh avatar icon, rank badge, badges row
  if(el.classList.contains('first-in-group')) {
    const ava = el.querySelector('.msg-ava');
    if(ava) ava.innerHTML = avatarHtml(data.icon, data.username, '60%');
    const rankEl = el.querySelector('.rbadge');
    if(rankEl && data.rank) { rankEl.className=`rbadge ${data.rank}`; rankEl.textContent=data.rank; }
    // Refresh badge row — remove old, insert new after rank badge
    el.querySelectorAll('.msg-badges').forEach(b=>b.remove());
    const bRow = renderBadgeRow(data.badges||[], true);
    if(bRow && rankEl) {
      const span = document.createElement('span');
      span.className = 'msg-badges';
      span.innerHTML = bRow;
      rankEl.insertAdjacentElement('afterend', span);
    }
  }
}

function renderReactions(container, reactions, msgId) {
  if(!container) return;
  container.innerHTML = '';
  Object.entries(reactions).forEach(([emoji, uids]) => {
    if(!uids||!uids.length) return;
    const mine = uids.includes(currentUser.uid);
    const chip = document.createElement('span');
    chip.className = `rchip${mine?' mine':''}`;
    chip.innerHTML = `${emoji} <span class="rcnt">${uids.length}</span>`;
    chip.addEventListener('click', () => toggleReaction(msgId, emoji));
    container.appendChild(chip);
  });
}

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
  // linkify URLs (after escaping so we don't double-escape)
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

// ── Unread badge helpers ──
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
    const item = document.querySelector(`#channel-list .titem[data-chid="${chId}"]`);
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
    const ref = doc(db, `channels/${currentChannel.id}/typing`,'status');
    await setDoc(ref, { [currentUser.uid]: { username: currentUserData.username, ts: serverTimestamp() } }, {merge:true});
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
  try { await addDoc(collection(db, `channels/${currentChannel.id}/messages`), {
    uid: currentUser.uid, username: currentUserData.username,
    rank: currentUserData.rank, color: currentUserData.color,
    icon: currentUserData.icon||'',
    badges: currentUserData.badges||[],
    text, ts: serverTimestamp(), edited: false, reactions: {}
  }); } catch(e) { toast('Message failed to send.','error'); input.value = text; }
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
const EMOJI_OPTS = ['👍','👎','❤️','😂','😮','😢','🔥','🎉','⭐','💯'];
window.addReaction = function(msgId) {
  const el = document.getElementById('msg-'+msgId);
  if(!el) return;
  const picker = document.createElement('div');
  picker.className = 'epicker';
  const rect = el.getBoundingClientRect();
  picker.style.top = (rect.bottom+4)+'px';
  picker.style.left = rect.left+'px';
  EMOJI_OPTS.forEach(em => {
    const opt = document.createElement('span');
    opt.className='eopt'; opt.textContent=em;
    opt.addEventListener('click', ()=>{ toggleReaction(msgId,em); picker.remove(); });
    picker.appendChild(opt);
  });
  document.body.appendChild(picker);
  setTimeout(()=>document.addEventListener('click',()=>picker.remove(),{once:true}),10);
};

// ── Members ──
let _presenceData = {}; // uid -> {lastSeen, online}
function loadMembers(ch) {
  const list = document.getElementById('members-list');
  if(!list) return;
  if(membersUnsub) membersUnsub();

  let users = [], presenceMap = {};
  const ACTIVE_THRESHOLD = 75000; // 75s - covers 30s heartbeat + slack

  function renderMembers() {
    const now = Date.now();
    const online = [], offline = [];
    users.forEach(u => {
      if(!ch.adminOnly && !canChat(u.rank)) return;
      if(ch.adminOnly && !canModerate(u.rank)) return;
      const p = presenceMap[u.uid];
      const lastSeen = p?.lastSeen?.toMillis ? p.lastSeen.toMillis() : 0;
      const isOnline = p?.online && (now - lastSeen) < ACTIVE_THRESHOLD;
      (isOnline ? online : offline).push({ ...u, isOnline });
    });
    online.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
    offline.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
    let html = '';
    if(online.length) html += `<div class="ms-section-label">Active — ${online.length}</div>`;
    online.forEach(u => {
      html += `<div class="ms-item" onclick="window._openProfile('${u.uid}')" style="cursor:pointer"><div class="ms-ava ms-ava-online" style="background:${u.color||avatarColor(u.uid)}">${avatarHtml(u.icon,u.username,"60%")}</div><span class="ms-name">${escHtml(u.username)}</span><span class="rbadge ${u.rank}" style="flex-shrink:0">${u.rank[0].toUpperCase()}</span></div>`;
    });
    if(offline.length) html += `<div class="ms-section-label">Members — ${offline.length}</div>`;
    offline.forEach(u => {
      html += `<div class="ms-item ms-item-offline" onclick="window._openProfile('${u.uid}')" style="cursor:pointer"><div class="ms-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarHtml(u.icon,u.username,"60%")}</div><span class="ms-name">${escHtml(u.username)}</span><span class="rbadge ${u.rank}" style="flex-shrink:0">${u.rank[0].toUpperCase()}</span></div>`;
    });
    list.innerHTML = html || '<div class="ms-section-label">No members</div>';
  }

  // Users snapshot
  const userUnsub = onSnapshot(
    query(collection(db,'users'), where('status','==','approved')),
    snap => { users = snap.docs.map(d=>d.data()); renderMembers(); }
  );
  // Presence snapshot
  const presUnsub = onSnapshot(collection(db,'presence'), snap => {
    snap.docs.forEach(d => { presenceMap[d.id] = d.data(); });
    renderMembers();
  });
  // Re-render every 30s to catch stale presences
  const renderTimer = setInterval(renderMembers, 30000);

  membersUnsub = () => { userUnsub(); presUnsub(); clearInterval(renderTimer); };
}

// ── Create Channel Modal ──
function showCreateChannelModal() {
  showModal(`
    <h3>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      New Channel
    </h3>
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
      item.innerHTML = `<div class="ms-ava" style="background:${u.color||avatarColor(u.uid)};width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:#fff;flex-shrink:0">${avatarInitial(u.username)}</div><span>${escHtml(u.username)}</span><span class="rbadge ${u.rank}" style="margin-left:auto">${u.rank}</span>`;
      item.addEventListener('click', () => { openDM(u); searchInp.value=''; searchResults.remove(); searchResults=null; });
      searchResults.appendChild(item);
    });
  });

  // Load existing DM conversations
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
    const ava = document.createElement('div'); ava.className='titem-ava'; ava.style.background=other.color||avatarColor(other.uid||''); ava.innerHTML=avatarHtml(other.icon,other.username,'60%'); item.appendChild(ava); const nm=document.createElement('span'); nm.className='titem-name'; nm.textContent=other.username; item.appendChild(nm);
    item.addEventListener('click', ()=>openDM(other, d.id));
    list.appendChild(item);
  }
}

async function openDM(otherUser, existingDmId) {
  // Find or create DM
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
      // Refresh DM list to show the new conversation
      await loadDMList();
    }
  }
  currentDM = {id:dmId, otherUser};
  // Clear unread for this DM
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
            // Count unread if DM not focused
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
  // Don't reload DM list — just update active state
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

function renderProfileDisplay() {
  // Profile display is now handled by renderOwnProfile() from profile.js
  // This stub updates just the dynamic parts after an edit
  const d = currentUserData;
  const gc = getGoatCoinData();
  renderOwnProfile(currentUser, d, gc);
  // Re-inject edit panels since renderOwnProfile clears them
  setTimeout(() => renderProfileEdit(), 0);
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
    lion:    '<circle cx="12" cy="12" r="4"/><path d="M12 2a10 10 0 000 20"/><path d="M12 2a10 10 0 010 20"/><path d="M2 12h20"/>',
    wolf:    '<path d="M10.5 2.5c-.4 1.5-1 3-2 4L4 9l2 4-4 3 5-1 1 4 4-3 4 3 1-4 5 1-4-3 2-4-4.5-2.5c-1-.5-1.5-1.5-2-3l-2-1z"/>',
    shield:  '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    crown:   '<path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7z"/><path d="M5 20h14"/>',
    skull:   '<circle cx="12" cy="11" r="5"/><path d="M9 11v2"/><path d="M15 11v2"/><path d="M9 16c0 1 .5 1.5 1.5 1.5h3c1 0 1.5-.5 1.5-1.5v-1H9v1z"/><path d="M7 8c-1-2 0-5 3-5s3 2 3 2 1-2 3-2 4 3 3 5"/>',
    sword:   '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/>',
    trophy:  '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4H4v7a8 8 0 0016 0V4h-3"/><path d="M7 4h10"/><path d="M7 4c0 6-3 8-3 8"/><path d="M17 4c0 6 3 8 3 8"/>',
    controller:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1" fill="currentColor"/><circle cx="17" cy="13" r="1" fill="currentColor"/>',
    dice:    '<rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="1.5" fill="currentColor"/><circle cx="16" cy="16" r="1.5" fill="currentColor"/><circle cx="8" cy="16" r="1.5" fill="currentColor"/><circle cx="16" cy="8" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
    planet:  '<circle cx="12" cy="12" r="7"/><path d="M21.17 8.17C22.87 5.52 23.1 3.16 22 2.06c-1.1-1.1-3.46-.87-6.11.83"/><path d="M2.83 15.83C1.13 18.48.9 20.84 2 21.94c1.1 1.1 3.46.87 6.11-.83"/>',
    galaxy:  '<path d="M12 2a10 10 0 010 20"/><path d="M12 2a10 10 0 000 20"/><circle cx="12" cy="12" r="2"/><line x1="2" y1="12" x2="22" y2="12"/>',
    snowflake:'<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7l-5 5-5-5"/><path d="M17 17l-5-5-5 5"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M7 7l5 5 5-5"/><path d="M7 17l5-5 5 5"/>',
    clover:  '<path d="M12 2a4 4 0 000 8 4 4 0 000-8z"/><path d="M12 14a4 4 0 000 8 4 4 0 000-8z"/><path d="M6 8a4 4 0 00-4 4 4 4 0 004 4"/><path d="M18 8a4 4 0 014 4 4 4 0 01-4 4"/><line x1="12" y1="2" x2="12" y2="22"/>',
    crystal: '<polygon points="12 2 20 8 20 16 12 22 4 16 4 8 12 2"/>',
    eye:     '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    infinity:'<path d="M12 12c-2-2.5-4-4-6-4a4 4 0 000 8c2 0 4-1.5 6-4z"/><path d="M12 12c2 2.5 4 4 6 4a4 4 0 000-8c-2 0-4 1.5-6 4z"/>',
    heart:   '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>',
    ghost:   '<path d="M9 10h.01M15 10h.01M12 2C6.48 2 2 6.48 2 12v10l3-3 2 2 2-2 2 2 2-2 2 2 3-3V12c0-5.52-4.48-10-10-10z"/>',
    feather: '<path d="M20.24 12.24a6 6 0 00-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',
    music:   '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    compass: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    zap2:    '<circle cx="12" cy="12" r="10"/><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    lock:    '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
    key:     '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    anchor:  '<circle cx="12" cy="5" r="3"/><line x1="12" y1="22" x2="12" y2="8"/><path d="M5 12H2a10 10 0 0020 0h-3"/>',
    aperture:'<circle cx="12" cy="12" r="10"/><line x1="14.31" y1="8" x2="20.05" y2="17.94"/><line x1="9.69" y1="8" x2="21.17" y2="8"/><line x1="7.38" y1="12" x2="13.12" y2="2.06"/><line x1="9.69" y1="16" x2="3.95" y2="6.06"/><line x1="14.31" y1="16" x2="2.83" y2="16"/><line x1="16.62" y1="12" x2="10.88" y2="21.94"/>',
    activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
};

// Helper: render avatar inner HTML for any user
export function avatarHtml(iconKey, username, size='100%') {
  if(!iconKey) return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
  const paths = SVG_ICONS[iconKey];
  if(paths) return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  // goat SVG
  if(iconKey === 'goat') return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 9V7a2 2 0 0 0-2-2h-1a2 2 0 0 0-2 2v1"/><path d="M4 9V7a2 2 0 0 1 2-2h1a2 2 0 0 1 2 2v1"/><path d="M8 9h8"/><ellipse cx="12" cy="13" rx="5" ry="4"/><path d="M9 17v2"/><path d="M15 17v2"/></svg>`;
  return `<span style="font-weight:900">${avatarInitial(username)}</span>`;
}

function renderProfileEdit() {
  const d = currentUserData;
  const section = document.getElementById('prof-edit-section');
  if(!section) return;

  // Username cooldown check
  const lastChange = d.lastUsernameChange?.toDate ? d.lastUsernameChange.toDate() : null;
  const canChangeUsername = !lastChange || (Date.now() - lastChange.getTime()) > 7*24*60*60*1000;
  const cooldownDays = lastChange ? Math.ceil((7*24*60*60*1000 - (Date.now()-lastChange.getTime())) / (24*60*60*1000)) : 0;


  section.innerHTML = `
    <div class="prof-panel" id="prof-color-section">
      <div class="prof-panel-hdr">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Avatar
      </div>
      <div class="prof-panel-sub">Choose an icon or use your initial. Then pick a color.</div>
      <div class="ava-icon-grid" id="ava-icon-grid"></div>
      <div class="prof-panel-sub" style="margin-top:.9rem">Color</div>
      <div class="color-swatches" id="color-swatches"></div>
    </div>

    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Username
        ${!canChangeUsername ? '<span class="prof-panel-badge">Available in '+cooldownDays+' day'+(cooldownDays!==1?'s':'')+'</span>' : ''}
      </div>
      <div class="prof-row">
        <input id="prof-username-inp" class="field-input" type="text" value="${escHtml(d.username)}" maxlength="20" placeholder="Username" ${canChangeUsername?'':'disabled'}>
        <button class="btn btn-sm" id="prof-username-btn" ${canChangeUsername?'':'disabled'}>Save</button>
      </div>
      ${!canChangeUsername ? '<div class="prof-cooldown">Username can be changed once every 7 days.</div>' : ''}
      <div class="merr" id="prof-username-err"></div>
    </div>

    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
        Email Address
      </div>
      <div class="prof-row">
        <input id="prof-email-inp" class="field-input" type="email" value="${escHtml(d.email||auth.currentUser?.email||'')}" placeholder="your@email.com">
        <button class="btn btn-sm" id="prof-email-btn">Update</button>
      </div>
      <div class="merr" id="prof-email-err"></div>
    </div>

    <div class="prof-panel">
      <div class="prof-panel-hdr">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
        Change Password
      </div>
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
    sw.title = color;
    sw.addEventListener('click', async () => {
      document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected'));
      sw.classList.add('selected');
      await updateDoc(doc(db,'users',currentUser.uid), {color});
      currentUserData.color = color;
      // Update sidebar avatar + profile avatar
      const spAva = document.getElementById('sp-ava');
      if(spAva) spAva.style.background = color;
      const profAva = document.getElementById('prof-ava');
      if(profAva) profAva.style.background = color;
      // Update all visible message avatars and names for this user
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-ava`).forEach(el => el.style.background = color);
      document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-name`).forEach(el => el.style.color = color);
      toast('Avatar color updated.','success');
      awardBadge('customized');
    });
    swatchWrap.appendChild(sw);
  });

  // Icon grid — SVG icons
  const iconGrid = document.getElementById('ava-icon-grid');
  if(iconGrid) {
    // Letter/initial option first
    const letterOpt = document.createElement('div');
    letterOpt.className = 'ava-icon-opt' + (!d.icon ? ' selected' : '');
    letterOpt.title = 'Use your initial';
    letterOpt.innerHTML = `<span style="font-weight:900;font-size:1rem">${avatarInitial(d.username)}</span>`;
    letterOpt.addEventListener('click', async () => {
      iconGrid.querySelectorAll('.ava-icon-opt').forEach(x=>x.classList.remove('selected'));
      letterOpt.classList.add('selected');
      await updateDoc(doc(db,'users',currentUser.uid), {icon:''});
      currentUserData.icon = '';
      _updateAvaDisplay('', d.color||avatarColor(d.uid));
      toast('Looking good.','success');
    });
    iconGrid.appendChild(letterOpt);

    // Goat icon — exclusive to goat rank
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
        _updateAvaDisplay('goat', d.color||avatarColor(d.uid));
        toast('Looking good.','success');
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
        _updateAvaDisplay(key, d.color||avatarColor(d.uid));
        toast('Looking good.','success');
      });
      iconGrid.appendChild(opt);
    });
  }

  function _updateAvaDisplay(iconKey, color) {
    const html = avatarHtml(iconKey, d.username, '60%');
    document.getElementById('sp-ava').innerHTML = html;
    const profAva = document.getElementById('prof-ava');
    if(profAva) profAva.innerHTML = avatarHtml(iconKey, d.username, '55%');
    document.querySelectorAll(`.msg[data-uid="${currentUser.uid}"] .msg-ava`).forEach(el => { el.innerHTML = svgContent; });
  }

  function _isLight(hex) {
    const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
    return (r*299+g*587+b*114)/1000 > 160;
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
    // Check taken
    const snap = await getDocs(query(collection(db,'users'), where('username','==',newName)));
    if(!snap.empty) { err.textContent='Username already taken'; return; }
    try {
      await updateDoc(doc(db,'users',currentUser.uid), { username: newName, lastUsernameChange: serverTimestamp() });
      currentUserData.username = newName;
      _userCache[currentUser.uid] = currentUserData;
      document.getElementById('sp-name').textContent = newName;
      const pn=document.getElementById('prof-name'); if(pn) pn.textContent=newName;
      const pu=document.getElementById('prof-username'); if(pu) pu.textContent='@'+newName;
      toast('Username updated.','success');
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
  // Tab switching
  document.querySelectorAll('.stab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.stab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('sp-' + t.dataset.tab)?.classList.add('active');
    });
  });

  // Themes
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

  // ── Defaults for every toggle key ──
  const DEFAULTS = {
    compact: false, parallax: true, 'ts-hover': false, 'msg-anim': true,
    'compact-sidebar': false, 'show-rank': true, 'reduce-motion': false,
    'nav-labels': true, 'nav-glow': true, chat: true, dm: true, mentions: true,
    'chat-sound': false, 'dm-sound': true, 'chat-ranks': true, 'link-previews': true,
    'enter-send': true, 'char-counter': true, 'typing-indicators': true,
    'theme-anim': true, 'high-contrast': false, 'line-spacing': false, 'focus-mode': false,
  };

  // ── Restore all saved values ──
  document.querySelectorAll('.notif-toggle').forEach(toggle => {
    const k = toggle.dataset.key;
    const stored = localStorage.getItem('neb_notif_' + k);
    const def = DEFAULTS[k] ?? true;
    toggle.checked = stored !== null ? stored === 'true' : def;
  });

  // ── Apply all on boot ──
  applyAllToggles();
  syncDepSettings();

  // ── Wire change events (single source of truth) ──
  document.querySelectorAll('.notif-toggle').forEach(toggle => {
    toggle.addEventListener('change', () => {
      const k = toggle.dataset.key;
      localStorage.setItem('neb_notif_' + k, toggle.checked);
      applyToggle(k, toggle.checked);
      syncDepSettings();
    });
  });

  // ── Pickers ──

  // Font size
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

  // Blur
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

  // Sidebar width
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

  // Parallax speed
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

  // Message grouping time
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

  // Layout picker — also handles auto-disabling nav-labels for top/bottom
  const currentLayout = loadLayout();
  document.querySelectorAll('.layout-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.layout === currentLayout);
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layout-opt').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const layout = btn.dataset.layout;
      applyLayout(layout);
      // Auto-force nav labels off for top/bottom (layout side-effect, NOT saved as user pref)
      const noLabels = layout === 'topbar' || layout === 'bottombar';
      const labelsToggle = document.querySelector('.notif-toggle[data-key="nav-labels"]');
      if(labelsToggle) {
        if(noLabels) {
          labelsToggle.checked = false;
          // Do NOT save to localStorage — this is forced by layout, not user choice
          applyToggle('nav-labels', false);
        } else {
          // Restore actual user pref when going back to sidebar layout
          const stored = localStorage.getItem('neb_notif_nav-labels');
          const on = stored === null || stored === 'true';
          labelsToggle.checked = on;
          applyToggle('nav-labels', on);
        }
      }
      // Sidebar width + labels card only relevant for left/right
      const isSidebar = layout === 'default' || layout === 'sidebar-right';
      document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebar);
      document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebar);
      document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabels);
      syncDepSettings();
    });
  });
  // Apply on load
  const noLabelsOnLoad = currentLayout === 'topbar' || currentLayout === 'bottombar';
  const isSidebarOnLoad = currentLayout === 'default' || currentLayout === 'sidebar-right';
  document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebarOnLoad);
  document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebarOnLoad);
  document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabelsOnLoad);

  // Channel notification list
  buildChannelNotifList();
}

// ── Apply a single toggle key to DOM ──
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
    'link-previews':      () => { /* future */ },
    'char-counter':       () => { const c = document.getElementById('char-ctr'); if(c) c.style.display = val ? '' : 'none'; },
    'theme-anim':         () => { /* handled in applyTheme */ },
  };
  map[k]?.();
}

// ── Apply all toggles from localStorage on boot ──
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
    // nav-labels is managed by applyLayout for horizontal layouts — skip it here
    if(k === 'nav-labels' && (layout === 'topbar' || layout === 'bottombar')) continue;
    const stored = get(k);
    const val = stored !== null ? stored === 'true' : def;
    applyToggle(k, val);
  }
}

// ── Show/hide dependent settings based on parent toggle state ──
function syncDepSettings() {
  // data-requires="key" → visible only if that key is ON
  document.querySelectorAll('.setting-dep[data-requires]').forEach(el => {
    const key = el.dataset.requires;
    const toggle = document.querySelector(`.notif-toggle[data-key="${key}"]`);
    const on = toggle ? toggle.checked : (localStorage.getItem('neb_notif_' + key) !== 'false');
    el.classList.toggle('setting-hidden', !on);
  });
  // data-requires-off="key" → visible only if that key is OFF
  document.querySelectorAll('.setting-dep[data-requires-off]').forEach(el => {
    const key = el.dataset['requires-off'] || el.getAttribute('data-requires-off');
    const toggle = document.querySelector(`.notif-toggle[data-key="${key}"]`);
    const on = toggle ? toggle.checked : (localStorage.getItem('neb_notif_' + key) !== 'false');
    el.classList.toggle('setting-hidden', on);
  });
  // Compact sidebar toggle only makes sense in left/right layouts
  const layout = loadLayout();
  const isSidebar = layout === 'default' || layout === 'sidebar-right';
  document.getElementById('setting-compact-sidebar-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('setting-show-rank-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('sidebar-width-card')?.classList.toggle('setting-hidden', !isSidebar);
  document.getElementById('sidebar-options-label')?.classList.toggle('setting-hidden', !isSidebar);

  // nav-labels-card grayed when top/bottom
  const noLabels = layout === 'topbar' || layout === 'bottombar';
  document.getElementById('nav-labels-card')?.classList.toggle('setting-grayed', noLabels);
}
// ── Channel Notification Preferences ──
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
  const title = document.getElementById('admin-page-title');
  if(title) title.textContent = d.rank==='goat' ? 'Goat Console' : 'Mod Panel';

  document.querySelectorAll('.adm-tab').forEach(t => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.adm-tab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.adm-panel').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('ap-'+t.dataset.tab)?.classList.add('active');
      loadAdminPanel(t.dataset.tab);
    });
  });

  loadAdminPanel('pending');
}

async function loadAdminPanel(tab) {
  const container = document.getElementById('ap-'+tab);
  if(!container) return;
  container.innerHTML = '<div style="color:var(--text-faint);font-size:.78rem">Loading...</div>';

  const snap = await getDocs(collection(db,'users'));
  const users = snap.docs.map(d=>d.data());

  if(tab==='pending') {
    const pending = users.filter(u=>u.status==='pending');
    if(!pending.length) { container.innerHTML='<div class="adm-empty">No pending accounts</div>'; return; }
    container.innerHTML = pending.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')" title="View profile">${avatarHtml(u.icon,u.username,"60%")}</div>
        <div class="adm-info">
          <span class="adm-name">${escHtml(u.username)}</span>
          <span class="adm-email">${u.email||''}</span>
          <span class="adm-meta">Joined ${u.createdAt?.toDate?u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'?'}</span>
        </div>
        <div class="adm-actions">
          <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')">Profile</button>
          <button class="ta-btn ta-green" onclick="window.approveUser('${u.uid}')">Approve</button>
          <button class="ta-btn ta-red" onclick="window.denyUser('${u.uid}','${escHtml(u.username)}')">Deny</button>
        </div>
      </div>`).join('');
  } else if(tab==='members') {
    const members = users.filter(u=>u.status==='approved');
    members.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
    container.innerHTML = members.length ? members.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')" title="View profile">${avatarHtml(u.icon,u.username,"60%")}</div>
        <div class="adm-info">
          <span class="adm-name">${escHtml(u.username)}</span>
          <span class="adm-email">${u.email||''}</span>
        </div>
        <div class="adm-actions">
          <span class="rbadge ${u.rank}">${u.rank}</span>
          <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')">Profile</button>
          ${canChangeRank(u) ? `<button class="ta-btn ta-blue" onclick="window.changeRank('${u.uid}','${u.rank}','${escHtml(u.username)}')">Rank</button>` : ''}
          ${canBan(u) ? `<button class="ta-btn ta-red" onclick="window.banUser('${u.uid}','${escHtml(u.username)}')">Ban</button>` : ''}
        </div>
      </div>`).join('') : '<div class="adm-empty">No members</div>';
  } else if(tab==='banned') {
    const banned = users.filter(u=>u.status==='banned');
    container.innerHTML = banned.length ? banned.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}" onclick="window._openProfile('${u.uid}')" title="View profile">${avatarHtml(u.icon,u.username,"60%")}</div>
        <div class="adm-info">
          <span class="adm-name">${escHtml(u.username)}</span>
          <span class="adm-email">${u.email||''}</span>
        </div>
        <div class="adm-actions">
          <button class="ta-btn ta-ghost" onclick="window._openProfile('${u.uid}')">Profile</button>
          <button class="ta-btn ta-green" onclick="window.unbanUser('${u.uid}')">Unban</button>
        </div>
      </div>`).join('') : '<div class="adm-empty">No banned accounts</div>';
  }
}

function canChangeRank(targetUser) {
  const me = currentUserData;
  if(me.rank==='goat') return targetUser.uid !== me.uid;
  // Universal can't touch universal/goat, can't change self
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
    // Also delete their goatcoin doc if it exists
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

window.changeRank = function(uid, currentRank, username) {
  const me = currentUserData;
  const availableRanks = ['earthbound','planetary','solar','galactic'];
  if(me.rank==='goat') availableRanks.push('universal'); // Goat can promote to universal
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
// cleanHTML mirrors script.js ad/injector removal
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
  document.body.classList.add('game-cursor-hidden');
  setActivity('game');

  // Use fetch+write so we can clean ads and avoid X-Frame-Options blocks
  frame.src = 'about:blank';
  fetch(url + '?t=' + Date.now())
    .then(r => r.text())
    .then(html => {
      html = cleanHTML(html);
      const doc = frame.contentDocument || frame.contentWindow?.document;
      if(doc) { doc.open(); doc.write(html); doc.close(); }
      // Store url for close/reload
      frame._gameUrl = url;
      frame._gameName = name;
    })
    .catch(() => {
      // Fallback to direct src if fetch fails (e.g. CORS)
      frame.src = url;
    });

  // Track for GoatCoin
  if(currentUser && currentUserData) {
    updateDoc(doc(db,'users',currentUser.uid), { gamesPlayed: increment(1) }).catch(()=>{});
  }
};
window.closeGameVault = function() {
  const vault = document.getElementById('game-vault');
  vault.style.display='none';
  setActivity('site');
  const frame = document.getElementById('game-frame');
  // Revoke blob URL to free memory immediately
  if(frame._blobURL) { URL.revokeObjectURL(frame._blobURL); frame._blobURL = null; }
  frame.src='about:blank';
  document.body.classList.remove('game-cursor-hidden');
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

// ── Open DM with uid (called from profile modal) ──
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
    // Skip if signup is still writing the Firestore doc — signup handler calls initApp directly
    if(_pendingSignup) return;
    if(user) await initApp(user);
    else showAuth();
  });
}

document.addEventListener('DOMContentLoaded', boot);