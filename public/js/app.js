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

  // On boot (no animation), just swap the href directly
  if (!animate || _themeTransitioning) {
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
          err.textContent='Username already taken'; btn.disabled=false; btn.textContent='REQUEST ACCESS'; return;
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
        'auth/too-many-requests':'Too many attempts — try again later',
        'auth/operation-not-allowed':'Sign-up is currently disabled. Contact an admin.',
        'auth/network-request-failed':'Network error — check your connection',
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
    document.getElementById('auth-err').textContent = 'Your account has been banned.';
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
  initHome();
  initChat();
  initDMs();
  setupProfile();
  setupSettings();
  if(canModerate(data.rank)) setupAdmin();
  trackVisits();
  hideSkeleton();
}

// ── Sidebar ──
function buildSidebar() {
  const d = currentUserData;
  const ava = document.getElementById('sp-ava');
  const name = document.getElementById('sp-name');
  const rank = document.getElementById('sp-rank');
  ava.style.background = d.color || avatarColor(d.uid);
  ava.textContent = avatarInitial(d.username);
  name.textContent = d.username;
  rank.textContent = d.rank.toUpperCase();
  rank.className = 'sp-rank';
  rank.style.color = RANK_COLORS[d.rank] || '#38bdf8';

  // Show/hide admin nav
  const adminNav = document.getElementById('nav-admin');
  if(adminNav) adminNav.classList.toggle('hidden', !canModerate(d.rank));

  document.getElementById('sp-signout').addEventListener('click', async () => {
    if(channelUnsub) channelUnsub();
    if(dmUnsub) dmUnsub();
    if(membersUnsub) membersUnsub();
    await signOut(auth);
    location.reload();
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

  // Close mobile drawer if open
  document.getElementById('mobile-drawer-overlay')?.remove();
  document.getElementById('mobile-drawer')?.remove();
}

// ── Home / Visits ──
const TOOLTIPS_RAW = [
"unbock gams unbock gams unbock gams",
"hoooooooly addicted",
"skill issue ahh",
"dont leak this",
"make sure you're in an about:blank",
"sniff sniff",
"E-Liquid",
"Find The Tabernacle",
"Mr Tupper Never Dies",
"stfu fleece",
"GoatTech Never Dies",
"idk bro",
"how do people come up with these tooltips",
"is this aura",
"in the big 26",
"im bored",
"Made by GoatTech",
"Proxies don't brick the internet gng",
"STOP HACKING",
"who keeps sliming the links out",
"Lightspeed sucks",
"I wonder what the meaning of life is",
"GoatTech is Goated",
"The original site used to be GoatedGames"
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

function initHome() {
  // Tooltips with shuffle
  const wrap = document.getElementById('tt-wrap');
  if(wrap) {
    wrap.innerHTML = '';
    let tips = shuffleArray(TOOLTIPS_RAW);
    let idx = 0;
    // Also try loading custom tooltips from file
    fetch('/js/tooltips.json')
      .then(r => r.ok ? r.json() : null)
      .then(custom => { if(Array.isArray(custom) && custom.length) tips = shuffleArray(custom); })
      .catch(() => {});
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
    setInterval(cycle, 4200);
  }

  // Real parallax — layers move with mouse
  const layers = [
    document.getElementById('neb-1'),
    document.getElementById('neb-2'),
    document.getElementById('neb-3'),
  ];
  const depths = [0.018, 0.032, 0.012];
  let tX = 0, tY = 0, cX = 0, cY = 0;
  const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
  window.addEventListener('mousemove', e => {
    tX = (e.clientX - cx) / cx;
    tY = (e.clientY - cy) / cy;
  });
  function animateParallax() {
    cX += (tX - cX) * 0.04;
    cY += (tY - cY) * 0.04;
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

function trackVisits() {
  const el = document.getElementById('visits-count');
  if(!el) return;
  const ref = doc(db,'meta','visits');
  // Increment on visit
  updateDoc(ref, { count: increment(1) }).catch(()=> setDoc(ref,{count:1},{merge:true}));
  // Live listener
  visitsUnsub = onSnapshot(ref, snap => {
    if(snap.exists()) el.textContent = (snap.data().count||0).toLocaleString();
  });
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
        scrollToBottom();
      } else {
        snap.docChanges().forEach(change => {
          if(change.type==='added') {
            appendMsg(change.doc.id, change.doc.data(), msgs);
            scrollToBottom();
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
    const typists = Object.entries(data).filter(([uid,ts]) => uid!==currentUser.uid && (Date.now()-ts.toMillis())<4000).map(([_,v])=>v.username);
    const bar = document.getElementById('typing-bar');
    if(typists.length && bar) {
      bar.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div><span>${typists.join(', ')} ${typists.length===1?'is':'are'} typing...</span>`;
    } else if(bar) bar.innerHTML='';
  });
}

let lastMsgSender = null, lastMsgTime = null;
function appendMsg(id, data, container) {
  const isFirst = data.uid !== lastMsgSender || !lastMsgTime || (data.ts?.toMillis() - lastMsgTime) > 300000;
  lastMsgSender = data.uid; lastMsgTime = data.ts?.toMillis()||Date.now();

  const el = document.createElement('div');
  el.className = `msg${isFirst?' first-in-group':''}`;
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
      <div class="msg-ava-wrap"><div class="msg-ava" style="background:${color}">${avatarInitial(data.username)}</div></div>
      <div class="msg-content">
        <div class="msg-header">
          <span class="msg-name" style="color:${color}">${escHtml(data.username)}</span>
          <span class="rbadge ${data.rank||'planetary'}">${data.rank||'planetary'}</span>
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

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
  if(text.length > 500) { toast('Message too long (500 chars max)', 'warning'); return; }
  if(btn.disabled) return;

  input.value = '';
  document.getElementById('char-ctr').textContent = '500';
  btn.disabled = true;
  try { await addDoc(collection(db, `channels/${currentChannel.id}/messages`), {
    uid: currentUser.uid, username: currentUserData.username,
    rank: currentUserData.rank, color: currentUserData.color,
    text, ts: serverTimestamp(), edited: false, reactions: {}
  }); } catch(e) { toast('Failed to send','error'); input.value = text; }
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
function loadMembers(ch) {
  const list = document.getElementById('members-list');
  if(!list) return;
  if(membersUnsub) membersUnsub();

  membersUnsub = onSnapshot(
    query(collection(db,'users'), where('status','==','approved')),
    snap => {
      const onlineLabel = `<div class="ms-section-label">Online</div>`;
      const offlineLabel = `<div class="ms-section-label">Members</div>`;
      let html = onlineLabel;
      const users = snap.docs.map(d=>d.data());
      // Filter by rank access
      const visible = users.filter(u => {
        if(ch.adminOnly) return canModerate(u.rank);
        return canChat(u.rank);
      });
      visible.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
      visible.forEach(u => {
        html += `<div class="ms-item">
          <div class="ms-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarInitial(u.username)}</div>
          <span class="ms-name">${escHtml(u.username)}</span>
          <span class="rbadge ${u.rank}" style="flex-shrink:0">${u.rank[0].toUpperCase()}</span>
        </div>`;
      });
      list.innerHTML = html;
    }
  );
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
      <button class="btn btn-sm" onclick="window.createChannel()">Create</button>
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
    closeModal(()=>{ loadChannelsList(); toast('Channel created!','success'); });
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
    const otherSnap = await getDoc(doc(db,'users',otherId));
    if(!otherSnap.exists()) continue;
    const other = otherSnap.data();
    const item = document.createElement('div');
    item.className = 'titem';
    item.dataset.dmid = d.id;
    item.innerHTML = `<div style="width:22px;height:22px;border-radius:50%;background:${other.color||avatarColor(other.uid)};display:flex;align-items:center;justify-content:center;font-size:.6rem;font-weight:800;color:#fff;flex-shrink:0">${avatarInitial(other.username)}</div><span class="titem-name">${escHtml(other.username)}</span>`;
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
    }
  }
  currentDM = {id:dmId, otherUser};

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
    query(collection(db,`dms/${dmId}/messages`), orderBy('ts','asc'), limit(100)),
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
          } else if(change.type==='removed') {
            document.getElementById('msg-'+change.doc.id)?.remove();
          }
        });
      }
    }
  );

  document.getElementById('dm-input').placeholder = `Message ${otherUser.username}`;
  loadDMList();
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
    el.innerHTML=`<div class="msg-ava-wrap"><div class="msg-ava" style="background:${color}">${avatarInitial(data.username)}</div></div><div class="msg-content"><div class="msg-header"><span class="msg-name" style="color:${color}">${escHtml(data.username)}</span><span class="msg-ts">${tsStr}</span></div><div class="msg-text">${formatMsg(data.text||'')}</div></div><div class="msg-actions">${canDelete?`<button class="mab d" onclick="window.deleteDM('${id}')">Del</button>`:''}</div>`;
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
  if(text.length>500) { toast('Too long','warning'); return; }
  input.value = '';
  await addDoc(collection(db,`dms/${currentDM.id}/messages`),{
    uid:currentUser.uid, username:currentUserData.username,
    color:currentUserData.color, text, ts:serverTimestamp()
  });
  await updateDoc(doc(db,'dms',currentDM.id),{lastTs:serverTimestamp()});
}

// ── Profile ──
const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#a855f7','#10b981','#0ea5e9','#f59e0b','#64748b'];

function setupProfile() {
  renderProfileDisplay();
  renderProfileEdit();
}

function renderProfileDisplay() {
  const d = currentUserData;
  const ava = document.getElementById('prof-ava');
  if(ava) {
    ava.style.background = d.color || avatarColor(d.uid);
    ava.textContent = avatarInitial(d.username);
    ava.title = 'Click to change color';
    ava.onclick = () => document.getElementById('prof-color-section')?.scrollIntoView({behavior:'smooth'});
  }
  const name = document.getElementById('prof-name');
  const uname = document.getElementById('prof-username');
  const rank = document.getElementById('prof-rank');
  const joined = document.getElementById('prof-joined');
  if(name) name.textContent = d.username;
  if(uname) { uname.textContent = '@'+d.username; uname.style.color = 'var(--text-muted)'; }
  if(rank) { rank.className = `rbadge ${d.rank}`; rank.textContent = d.rank; }
  if(joined) joined.textContent = d.createdAt?.toDate ? 'Joined '+d.createdAt.toDate().toLocaleDateString() : '';
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
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="13.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
        Avatar Color
      </div>
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
      toast('Color updated!','success');
    });
    swatchWrap.appendChild(sw);
  });

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
      document.getElementById('sp-name').textContent = newName;
      document.getElementById('prof-name').textContent = newName;
      document.getElementById('prof-username').textContent = '@'+newName;
      toast('Username updated!','success');
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
      document.querySelectorAll('.stab').forEach(x=>x.classList.remove('active'));
      document.querySelectorAll('.settings-panel').forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      document.getElementById('sp-'+t.dataset.tab)?.classList.add('active');
    });
  });

  // Themes
  const currentTheme = loadTheme();
  document.querySelectorAll('.theme-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.theme === currentTheme);
    card.addEventListener('click', () => {
      document.querySelectorAll('.theme-card').forEach(c=>c.classList.remove('selected'));
      card.classList.add('selected');
      applyTheme(card.dataset.theme);
      toast('Theme applied!','success');
    });
  });

  // Notification toggles (compact is OFF by default)
  document.querySelectorAll('.notif-toggle').forEach(toggle => {
    const key = 'neb_notif_'+toggle.dataset.key;
    const stored = localStorage.getItem(key);
    // compact defaults to false, others default to true
    const defaultVal = toggle.dataset.key === 'compact' ? 'false' : 'true';
    toggle.checked = stored !== null ? stored === 'true' : defaultVal === 'true';
    // Apply compact immediately on load
    if(toggle.dataset.key === 'compact') {
      document.body.classList.toggle('compact-mode', toggle.checked);
      toggle.addEventListener('change', () => {
        localStorage.setItem(key, toggle.checked);
        document.body.classList.toggle('compact-mode', toggle.checked);
      });
    } else if(toggle.dataset.key === 'parallax') {
      const pr = document.getElementById('parallax-root');
      if(pr) pr.style.display = toggle.checked ? '' : 'none';
      toggle.addEventListener('change', () => {
        localStorage.setItem(key, toggle.checked);
        if(pr) pr.style.display = toggle.checked ? '' : 'none';
      });
    } else {
      toggle.addEventListener('change', () => localStorage.setItem(key, toggle.checked));
    }
  });

  // Apply compact mode on load
  const compactStored = localStorage.getItem('neb_notif_compact');
  if(compactStored === 'true') document.body.classList.add('compact-mode');

  // Apply parallax pref on load
  const parStored = localStorage.getItem('neb_notif_parallax');
  if(parStored === 'false') {
    const pr = document.getElementById('parallax-root');
    if(pr) pr.style.display = 'none';
  }

  // Channel notification list
  buildChannelNotifList();
}

// ── Channel Notification Preferences ──
async function buildChannelNotifList() {
  const container = document.getElementById('sp-channel-notifs');
  if(!container) return;
  container.innerHTML = '<div style="font-size:.72rem;color:var(--text-faint)">Loading channels...</div>';

  let channels = [
    { id:'general', name:'general' },
    { id:'admin', name:'admin' }
  ];
  try {
    const snap = await getDocs(collection(db,'channels'));
    snap.forEach(s => channels.push({id:s.id, name:s.data().name}));
  } catch(e) {}

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
  if(title) title.textContent = d.rank==='goat' ? 'Goat Console' : 'Moderator Panel';

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
    if(!pending.length) { container.innerHTML='<div style="color:var(--text-faint);font-size:.78rem">No pending accounts.</div>'; return; }
    container.innerHTML = pending.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarInitial(u.username)}</div>
        <span class="adm-name">${escHtml(u.username)}</span>
        <span style="font-size:.65rem;color:var(--text-faint)">${u.email}</span>
        <button class="ta-btn ta-green" onclick="window.approveUser('${u.uid}')">Approve</button>
        <button class="ta-btn ta-red" onclick="window.banUser('${u.uid}','${escHtml(u.username)}')">Deny</button>
      </div>`).join('');
  } else if(tab==='members') {
    const members = users.filter(u=>u.status==='approved');
    members.sort((a,b)=>rankOf(b.rank)-rankOf(a.rank));
    container.innerHTML = members.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarInitial(u.username)}</div>
        <span class="adm-name">${escHtml(u.username)}</span>
        <span class="rbadge ${u.rank}">${u.rank}</span>
        ${canChangeRank(u) ? `<button class="ta-btn ta-blue" onclick="window.changeRank('${u.uid}','${u.rank}','${escHtml(u.username)}')">Rank</button>` : ''}
        ${canBan(u) ? `<button class="ta-btn ta-red" onclick="window.banUser('${u.uid}','${escHtml(u.username)}')">Ban</button>` : ''}
      </div>`).join('');
  } else if(tab==='banned') {
    const banned = users.filter(u=>u.status==='banned');
    container.innerHTML = banned.length ? banned.map(u=>`
      <div class="adm-row">
        <div class="adm-ava" style="background:${u.color||avatarColor(u.uid)}">${avatarInitial(u.username)}</div>
        <span class="adm-name">${escHtml(u.username)}</span>
        <button class="ta-btn ta-green" onclick="window.unbanUser('${u.uid}')">Unban</button>
      </div>`).join('') : '<div style="color:var(--text-faint);font-size:.78rem">No banned accounts.</div>';
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

window.banUser = async function(uid, username) {
  if(!confirm(`Ban ${username}?`)) return;
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
window.openGameVault = function(url, name) {
  const vault = document.getElementById('game-vault');
  vault.style.display='flex';
  const frame = document.getElementById('game-frame');
  document.getElementById('game-name').textContent = name;
  frame.src = url;
  document.body.classList.add('game-cursor-hidden');
};
window.closeGameVault = function() {
  const vault = document.getElementById('game-vault');
  vault.style.display='none';
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