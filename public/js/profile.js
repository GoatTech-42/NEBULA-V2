// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
//  profile.js â€” Profiles, badges, adblocker notice
//  REDESIGNED: New profile page layout
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
import {
  db, auth,
  doc, getDoc, updateDoc, collection, getDocs, serverTimestamp
} from './firebase.js';
import { toast, avatarColor, avatarInitial, escHtml, canModerate, RANK_COLORS, avatarHtml, renderRankBadge } from './app.js';
import { getGoatCoinData } from './goatcoin.js';

// â”€â”€ Badge definitions â”€â”€
export const BADGE_DEFS = {
  champion:    { label:'Champion',   desc:'Most GoatCoins earned this week',   color:'#fbbf24' },
  sweat:       { label:'Sweat',      desc:'Most games played this week',        color:'#f97316' },
  social:      { label:'Social',     desc:'Most time in chat this week',        color:'#38bdf8' },
  lucky:       { label:'Lucky',      desc:'Most blackjack wins this week',      color:'#4ade80' },
  veteran:     { label:'Veteran',    desc:'Member for 30+ days',                color:'#fde68a' },
  og:          { label:'OG',         desc:'One of the first members',           color:'#67e8f9' },
  pioneer:     { label:'Pioneer',    desc:'Purchased from the GC Shop',         color:'#a78bfa' },
  whale:       { label:'Whale',      desc:'Big spender in the GC Shop',         color:'#38bdf8' },
  chatterbox:  { label:'Chatterbox', desc:'A dedicated conversationalist',      color:'#34d399' },
  gamer:       { label:'Gamer',      desc:'A dedicated gamer of Nebula',        color:'#f97316' },
  shopkeeper:  { label:'Shopkeeper', desc:'Serious GC Shop investor',           color:'#fbbf24' },
};

const BADGE_ICON_SVGS = {
  champion: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v3a5 5 0 0 1-10 0V4z"/><path d="M7 6H5a2 2 0 0 0 0 4h2"/><path d="M17 6h2a2 2 0 0 1 0 4h-2"/></svg>',
  sweat: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="4"/><path d="M7 12h3"/><path d="M8.5 10.5v3"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>',
  social: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
  lucky: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3"/><path d="M12 11v10"/></svg>',
  veteran: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z"/></svg>',
  og: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l1.8 3.8L18 7.2l-3 2.9.7 4.2-3.7-2-3.7 2 .7-4.2-3-2.9 4.2-1.4L12 2z"/><path d="M5 19h14"/></svg>',
  pioneer: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 2v4"/><path d="M12 18v4"/><path d="M2 12h4"/><path d="M18 12h4"/><polygon points="12 9 14.8 14.8 9 12" fill="currentColor" stroke="none"/></svg>',
  whale: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14c1.8-3.6 5.8-6 10-6 4 0 7.3 2.1 8 5.2-.8.8-1.9 1.4-3.1 1.4-1.2 0-2.4-.5-3.2-1.5-.9 1-2.1 1.5-3.3 1.5-1.2 0-2.4-.5-3.2-1.5-.7.9-1.7 1.4-2.8 1.4-.9 0-1.7-.2-2.4-.5z"/><path d="M16 7c0-1.5 1-2.5 2.5-2.5"/></svg>',
  chatterbox: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v9H8l-4 4V6z"/></svg>',
  gamer: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="4"/><path d="M7 12h3"/><path d="M8.5 10.5v3"/><circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none"/><circle cx="17.5" cy="13.5" r="1" fill="currentColor" stroke="none"/></svg>',
  shopkeeper: '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/><path d="M3 5h2l2 10h11l2-7H7"/></svg>'
};

function badgeIconSvg(key) {
  return BADGE_ICON_SVGS[key]
    || '<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l7 4v6c0 5-3.4 8.6-7 10-3.6-1.4-7-5-7-10V6l7-4z"/></svg>';
}

const fmtTime = mins => {
  if(!mins||mins<1) return '0m';
  if(mins<60) return `${mins}m`;
  const h=Math.floor(mins/60), m=mins%60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

export function renderBadgeRow(badges, compact=false) {
  if(!badges?.length) return '';
  const seen = new Set();
  const unique = badges.filter(b => { if(seen.has(b)) return false; seen.add(b); return true; });
  if(!unique.length) return '';
  return unique.map(b => {
    const def = BADGE_DEFS[b] || { label: b, color:'var(--accent)' };
    const iconEl = `<span class="badge-icon" aria-hidden="true">${badgeIconSvg(b)}</span>`;
    if(compact) {
      return `<span class="badge-chip badge-compact" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${iconEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
    }
    return `<span class="badge-chip" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${iconEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
  }).join('');
}

// â”€â”€ Adblocker detection â”€â”€
export function checkAdblocker() {
  const bait = document.createElement('div');
  bait.className = 'ad pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads';
  bait.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;';
  document.body.appendChild(bait);
  requestAnimationFrame(() => {
    const blocked = !bait.offsetParent && (bait.offsetHeight === 0 || bait.clientHeight === 0);
    bait.remove();
    if(blocked) _showAdblockerBanner();
  });
}

function _showAdblockerBanner() {
  if(document.getElementById('adblock-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'adblock-banner';
  banner.className = 'adblock-banner';
  banner.innerHTML = `
    <div class="adblock-banner-inner">
      <div class="adblock-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></div>
      <div class="adblock-text">
        <strong>Ad blocker detected</strong>
        <span>GoatCoin time tracking may not work correctly. Please disable your ad blocker for this site.</span>
      </div>
      <button class="adblock-dismiss" id="adblock-dismiss"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('adblock-dismiss')?.addEventListener('click', () => {
    banner.classList.add('adblock-banner-hide');
    setTimeout(() => banner.remove(), 400);
  });
}

// â”€â”€ Open profile modal for any uid â”€â”€
export async function openProfileModal(uid, currentUserData) {
  const modal = document.getElementById('modal-box-main');
  const ov = document.getElementById('modal-overlay');
  if(!modal || !ov) return;
  ov.classList.remove('hidden');
  document.getElementById('modal-wrap')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  modal.innerHTML = `<div style="padding:2rem;color:var(--text-muted);font-size:.82rem">Loading profileâ€¦</div>`;
  ov.onclick = e => { if(e.target===ov) _closeProfileModal(); };

  try {
    const [userSnap, gcSnap] = await Promise.all([
      getDoc(doc(db,'users',uid)),
      getDoc(doc(db,'goatcoin',uid))
    ]);

    if(!userSnap.exists()) {
      modal.innerHTML = `<div style="padding:2rem;color:var(--danger)">User not found</div>`;
      return;
    }

    const u = userSnap.data();
    const gc = gcSnap.exists() ? gcSnap.data() : {};
    const isOwn = auth.currentUser?.uid === uid;
    const canAdmin = currentUserData && currentUserData.rank === 'goat';
    const color = u.color || avatarColor(uid);
    const joinedDate = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'â€”';
    const rawBadges = u.badges || [];
    const seen = new Set();
    const badges = rawBadges.filter(b => { if(seen.has(b)) return false; seen.add(b); return true; });

    modal.innerHTML = `
      <div class="prof-modal">
        <div class="prof-modal-hero" style="background:linear-gradient(135deg,${color}44,${color}11)">
          <div class="prof-modal-ava" style="background:${color}">${avatarHtml(u.icon, u.username, '52%')}</div>
        </div>
        <div class="prof-modal-body">
          <div class="prof-modal-identity">
            <div class="prof-modal-name">${escHtml(u.username)}</div>
            <div class="prof-modal-sub">
              ${renderRankBadge(u.rank)}
              <span class="prof-modal-joined">Joined ${joinedDate}</span>
            </div>
          </div>

          <div class="prof-modal-badges-section">
            <div class="prof-section-label">Badges</div>
            <div class="prof-modal-badges" id="pm-badge-display">
              ${renderBadgeRow(badges) || '<span class="prof-no-badges">No badges yet</span>'}
            </div>
          </div>

          <div class="prof-section-label" style="margin-top:1rem">Stats</div>
          <div class="prof-modal-stats">
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.coins||0).toLocaleString()}</div><div class="pst-key">Coins</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.weekCoins||0).toLocaleString()}</div><div class="pst-key">This Week</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekChatMins||0)}</div><div class="pst-key">Chat (wk)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekGameMins||0)}</div><div class="pst-key">Games (wk)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.totalBJWins||0)}</div><div class="pst-key">BJ Wins</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.totalCoins||0).toLocaleString()}</div><div class="pst-key">All-Time GC</div></div>
          </div>

          ${canAdmin ? `
          <div class="prof-modal-admin" id="pm-admin-section">
            <div class="prof-section-label" style="margin-top:1rem">Admin â€” Manage Badges</div>
            <div class="prof-admin-preset-badges">
              ${Object.entries(BADGE_DEFS).map(([key, def]) => {
                const has = badges.includes(key);
                return `<button class="badge-admin-btn${has?' bab-active':''}" data-badge="${key}" data-uid="${uid}" style="--bc:${def.color}">${escHtml(def.label)}</button>`;
              }).join('')}
            </div>
            <div class="prof-admin-custom">
              <div class="prof-section-label" style="margin-top:.75rem">Custom Badge</div>
              <div class="prof-admin-custom-row">
                <input id="custom-badge-label" class="field-input" type="text" placeholder="Badge name" maxlength="20" style="flex:1">
                <input id="custom-badge-color" type="color" value="#38bdf8" class="badge-color-picker" title="Badge color">
                <button class="btn btn-sm" id="add-custom-badge-btn">Add</button>
              </div>
              <div id="pm-custom-badges" class="prof-admin-preset-badges" style="margin-top:.5rem">
                ${badges.filter(b=>!BADGE_DEFS[b]).map(b=>`
                  <button class="badge-admin-btn bab-active bab-custom" data-badge="${b}" data-uid="${uid}" style="--bc:var(--accent)">${escHtml(b)} <span class="bab-remove">Ã—</span></button>
                `).join('')}
              </div>
            </div>
          </div>` : ''}

          <div class="modal-actions" style="margin-top:1.2rem">
            ${!isOwn ? `<button class="btn btn-ghost btn-sm" id="prof-dm-btn">Message</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Close</button>
          </div>
        </div>
      </div>`;

    if(canAdmin) {
      modal.querySelectorAll('.badge-admin-btn:not(.bab-custom)').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.badge;
          const uref = doc(db,'users',uid);
          const snap = await getDoc(uref);
          if(!snap.exists()) return;
          const existing = [...new Set(snap.data().badges||[])];
          if(existing.includes(key)) {
            await updateDoc(uref, { badges: existing.filter(b=>b!==key) });
            btn.classList.remove('bab-active');
            toast(`Removed "${key}"`, 'info');
          } else {
            await updateDoc(uref, { badges: [...existing, key] });
            btn.classList.add('bab-active');
            toast(`Awarded "${key}"`, 'success');
            if(window.propagateProfileToMessages) window.propagateProfileToMessages(uid, { badges: [...existing, key] }).catch(()=>{});
          }
          const snap2 = await getDoc(uref);
          const freshBadges = [...new Set(snap2.data().badges||[])];
          const pm = modal.querySelector('#pm-badge-display');
          if(pm) pm.innerHTML = renderBadgeRow(freshBadges) || '<span class="prof-no-badges">No badges yet</span>';
        });
      });

      modal.querySelectorAll('.bab-custom').forEach(btn => {
        btn.querySelector('.bab-remove')?.addEventListener('click', async e => {
          e.stopPropagation();
          const key = btn.dataset.badge;
          const uref = doc(db,'users',uid);
          const snap = await getDoc(uref);
          if(!snap.exists()) return;
          await updateDoc(uref, { badges: [...new Set(snap.data().badges)].filter(b=>b!==key) });
          btn.remove();
          toast(`Removed "${key}"`, 'info');
        });
      });

      modal.querySelector('#add-custom-badge-btn')?.addEventListener('click', async () => {
        const labelInp = modal.querySelector('#custom-badge-label');
        const colorInp = modal.querySelector('#custom-badge-color');
        const label = labelInp?.value.trim().toLowerCase().replace(/\s+/g,'-');
        if(!label) { toast('Enter a badge name', 'warning'); return; }
        const uref = doc(db,'users',uid);
        const snap = await getDoc(uref);
        if(!snap.exists()) return;
        const existing = [...new Set(snap.data().badges||[])];
        if(existing.includes(label)) { toast('Badge already exists', 'warning'); return; }
        const updated = [...existing, label];
        await updateDoc(uref, { badges: updated, [`customBadges.${label}`]: { label, color: colorInp?.value||'#38bdf8' } });
        toast(`Added "${label}"`, 'success');
        if(labelInp) labelInp.value = '';
        const snap2 = await getDoc(uref);
        const pm = modal.querySelector('#pm-badge-display');
        if(pm) pm.innerHTML = renderBadgeRow([...new Set(snap2.data().badges||[])]) || '<span class="prof-no-badges">No badges yet</span>';
      });
    }

    modal.querySelector('#prof-dm-btn')?.addEventListener('click', () => {
      _closeProfileModal();
      window._openDMWithUid?.(uid);
    });

  } catch(e) {
    modal.innerHTML = `<div style="padding:2rem;color:var(--danger)">Failed to load profile</div>`;
    console.error(e);
  }
}

function _closeProfileModal() {
  const ov = document.getElementById('modal-overlay');
  const wrap = document.getElementById('modal-wrap');
  const box = document.getElementById('modal-box-main');
  ov?.classList.add('closing');
  setTimeout(() => {
    ov?.classList.add('hidden'); ov?.classList.remove('closing');
    wrap?.classList.add('hidden');
    box?.classList.add('hidden');
    if(box) box.innerHTML = '';
  }, 200);
}

// â”€â”€ REDESIGNED Own Profile Page â”€â”€
const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#f43f5e','#a855f7','#10b981','#0ea5e9','#f59e0b','#64748b'];

export function renderOwnProfile(user, userData, gcData) {
  const container = document.getElementById('section-profile');
  if(!container) return;
  const d = userData;
  const gc = gcData || {};
  const color = d.color || avatarColor(user.uid);
  const joinedDate = d.createdAt?.toDate
    ? d.createdAt.toDate().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
    : '';
  const rawBadges = d.badges || [];
  const seen = new Set();
  const badges = rawBadges.filter(b => { if(seen.has(b)) return false; seen.add(b); return true; });
  const coins = Math.floor(gc.coins||0);
  const wCoins = Math.floor(gc.weekCoins||0);
  const totalCoins = Math.floor(gc.totalCoins||0);
  const bjWins = Math.floor(gc.totalBJWins||0);

  container.innerHTML = `
  <div class="prof-redesign-wrap">
    <!-- â”€â”€ Hero banner â”€â”€ -->
    <div class="prof-banner-card">
      <div class="prof-banner-bg" style="background:linear-gradient(135deg,${color}60,${color}22,var(--bg))">
        <div class="prof-banner-stars"></div>
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,${color}40,transparent 55%)"></div>
      </div>
      <div class="prof-banner-body">
        <div class="prof-banner-ava" id="prof-ava" style="background:${color}">
          ${avatarHtml(d.icon, d.username, '52%')}
          <div class="prof-banner-ava-hint">Change</div>
        </div>
        <div class="prof-banner-info">
          <div class="prof-banner-name" id="prof-name">${escHtml(d.username)}</div>
          <div class="prof-banner-meta">
            <span id="prof-rank">${renderRankBadge(d.rank)}</span>
            ${joinedDate ? `<span class="prof-banner-joined">Member since ${joinedDate}</span>` : ''}
          </div>
          <div class="prof-banner-badges" id="prof-badges">
            ${renderBadgeRow(badges, true) || '<span style="font-size:.68rem;color:var(--text-faint);font-style:italic">No badges yet</span>'}
          </div>
        </div>
      </div>
      <!-- Stats strip -->
      <div class="prof-stats-strip">
        <div class="prof-stat-cell">
          <div class="prof-stat-cell-val">${coins.toLocaleString()}</div>
          <div class="prof-stat-cell-key">Balance</div>
        </div>
        <div class="prof-stat-cell">
          <div class="prof-stat-cell-val">${wCoins.toLocaleString()}</div>
          <div class="prof-stat-cell-key">This Week</div>
        </div>
        <div class="prof-stat-cell">
          <div class="prof-stat-cell-val">${totalCoins.toLocaleString()}</div>
          <div class="prof-stat-cell-key">All-Time GC</div>
        </div>
        <div class="prof-stat-cell">
          <div class="prof-stat-cell-val">${bjWins}</div>
          <div class="prof-stat-cell-key">BJ Wins</div>
        </div>
      </div>
    </div>

    <!-- â”€â”€ Edit Panels â”€â”€ -->
    <div class="prof-panels-grid" id="prof-edit-section">
      <!-- populated by renderProfileEdit() -->
    </div>
  </div>`;
}

// â”€â”€ Auto-award badges â”€â”€
export async function checkAutoAwards(uid, userData) {
  const rawBadges = userData.badges || [];
  const DEPRECATED = new Set(['customized', 'stylist']);
  const existing = [...new Set(rawBadges)].filter(b => !DEPRECATED.has(b));
  const newBadges = [...existing];
  let changed = existing.length !== rawBadges.length;

  if(!existing.includes('veteran') && userData.createdAt?.toDate) {
    const accountAgeMs = Date.now() - userData.createdAt.toDate().getTime();
    if(accountAgeMs > 30*24*60*60*1000) {
      newBadges.push('veteran'); changed = true;
    }
  }

  if(changed) {
    const dedupedNew = [...new Set(newBadges)];
    await updateDoc(doc(db,'users',uid), { badges: dedupedNew }).catch(()=>{});
  }
}