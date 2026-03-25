// ═══════════════════════════════════════════════════
//  profile.js — Profiles, badges, adblocker notice
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, updateDoc, collection, getDocs, serverTimestamp
} from './firebase.js';
import { toast, avatarColor, avatarInitial, escHtml, canModerate, RANK_COLORS, avatarHtml } from './app.js';
import { getGoatCoinData } from './goatcoin.js';

// ── Badge definitions ──
export const BADGE_DEFS = {
  champion:   { label:'Champion',  desc:'Most GoatCoins earned this week',   color:'#fbbf24', emoji:'🏆' },
  sweat:      { label:'Sweat',     desc:'Most games played this week',        color:'#f97316', emoji:'🎮' },
  social:     { label:'Social',    desc:'Most time in chat this week',        color:'#38bdf8', emoji:'💬' },
  lucky:      { label:'Lucky',     desc:'Most blackjack wins this week',      color:'#4ade80', emoji:'🍀' },
  veteran:    { label:'Veteran',   desc:'Member for 30+ days',                color:'#fde68a', emoji:'⭐' },
  og:         { label:'OG',        desc:'One of the first members',           color:'#67e8f9', emoji:'🌟' },
};

const fmtTime = mins => {
  if(!mins||mins<1) return '0m';
  if(mins<60) return `${mins}m`;
  const h=Math.floor(mins/60), m=mins%60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

// ── Render badge row — returns HTML string ──
// IMPORTANT: deduplicate badges before rendering to prevent visual duplication
export function renderBadgeRow(badges, compact=false) {
  if(!badges?.length) return '';
  // Deduplicate while preserving order
  const seen = new Set();
  const unique = badges.filter(b => { if(seen.has(b)) return false; seen.add(b); return true; });
  if(!unique.length) return '';

  return unique.map(b => {
    const def = BADGE_DEFS[b] || { label: b, color:'var(--accent)', emoji:'🏅' };
    const emojiEl = `<span class="badge-emoji">${def.emoji || '🏅'}</span>`;
    if(compact) {
      return `<span class="badge-chip badge-compact" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${emojiEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
    }
    return `<span class="badge-chip" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${emojiEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
  }).join('');
}

// ── Adblocker detection + notice ──
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
      <div class="adblock-icon">🛡️</div>
      <div class="adblock-text">
        <strong>Ad blocker detected</strong>
        <span>GoatCoin time tracking may not work correctly. Please disable your ad blocker for this site.</span>
      </div>
      <button class="adblock-dismiss" id="adblock-dismiss" style="font-size:1rem">✕</button>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('adblock-dismiss')?.addEventListener('click', () => {
    banner.classList.add('adblock-banner-hide');
    setTimeout(() => banner.remove(), 400);
  });
}

// ── Open profile modal for any uid ──
export async function openProfileModal(uid, currentUserData) {
  const modal = document.getElementById('modal-box-main');
  const ov = document.getElementById('modal-overlay');
  if(!modal || !ov) return;
  ov.classList.remove('hidden');
  document.getElementById('modal-wrap')?.classList.remove('hidden');
  modal.classList.remove('hidden');
  modal.innerHTML = `<div class="prof-modal-loading">Loading profile…</div>`;
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
    const joinedDate = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    // Deduplicate badges before rendering
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
              <span class="rbadge ${u.rank}">${u.rank}</span>
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
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.weekCoins||0).toLocaleString()}</div><div class="pst-key">Coins (week)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.totalChatMins||0)}</div><div class="pst-key">Chat (total)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekChatMins||0)}</div><div class="pst-key">Chat (week)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.totalGameMins||0)}</div><div class="pst-key">Games (total)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekGameMins||0)}</div><div class="pst-key">Games (week)</div></div>
          </div>

          ${canAdmin ? `
          <div class="prof-modal-admin" id="pm-admin-section">
            <div class="prof-section-label" style="margin-top:1rem">Admin — Manage Badges</div>
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
                  <button class="badge-admin-btn bab-active bab-custom" data-badge="${b}" data-uid="${uid}" style="--bc:var(--accent)">${escHtml(b)} <span class="bab-remove">×</span></button>
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

    // Wire admin badge toggles
    if(canAdmin) {
      modal.querySelectorAll('.badge-admin-btn:not(.bab-custom)').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.badge;
          const uref = doc(db,'users',uid);
          const snap = await getDoc(uref);
          if(!snap.exists()) return;
          const existing = snap.data().badges || [];
          // Always deduplicate when writing
          const deduped = [...new Set(existing)];
          if(deduped.includes(key)) {
            const updated = deduped.filter(b=>b!==key);
            await updateDoc(uref, { badges: updated });
            btn.classList.remove('bab-active');
            toast(`Removed "${key}"`, 'info');
          } else {
            const updated = [...deduped, key];
            await updateDoc(uref, { badges: updated });
            btn.classList.add('bab-active');
            toast(`Awarded "${key}"`, 'success');
            // Also propagate badges to messages
            if(window.propagateProfileToMessages) {
              window.propagateProfileToMessages(uid, { badges: updated }).catch(()=>{});
            }
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
          const updated = [...new Set(snap.data().badges)].filter(b=>b!==key);
          await updateDoc(uref, { badges: updated });
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
        // Deduplicate before adding
        const existing = [...new Set(snap.data().badges || [])];
        if(existing.includes(label)) { toast('Badge already exists', 'warning'); return; }
        const updated = [...existing, label];
        const color = colorInp?.value || '#38bdf8';
        await updateDoc(uref, {
          badges: updated,
          [`customBadges.${label}`]: { label, color }
        });
        toast(`Added "${label}"`, 'success');
        if(labelInp) labelInp.value = '';
        const customEl = modal.querySelector('#pm-custom-badges');
        if(customEl) {
          const btn2 = document.createElement('button');
          btn2.className = 'badge-admin-btn bab-active bab-custom';
          btn2.dataset.badge = label;
          btn2.dataset.uid = uid;
          btn2.style.setProperty('--bc', color);
          btn2.innerHTML = `${escHtml(label)} <span class="bab-remove">×</span>`;
          btn2.querySelector('.bab-remove')?.addEventListener('click', async e => {
            e.stopPropagation();
            const s = await getDoc(doc(db,'users',uid));
            if(s.exists()) await updateDoc(doc(db,'users',uid), { badges: [...new Set(s.data().badges)].filter(b=>b!==label) });
            btn2.remove();
          });
          customEl.appendChild(btn2);
        }
        const s2 = await getDoc(uref);
        const pm = modal.querySelector('#pm-badge-display');
        if(pm) pm.innerHTML = renderBadgeRow([...new Set(s2.data().badges||[])]) || '<span class="prof-no-badges">No badges yet</span>';
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

// ── Own profile page ──
export function renderOwnProfile(user, userData, gcData) {
  const container = document.getElementById('section-profile');
  if(!container) return;
  const d = userData;
  const gc = gcData || {};
  const color = d.color || avatarColor(user.uid);
  const joinedDate = d.createdAt?.toDate ? d.createdAt.toDate().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : '';
  // Deduplicate badges before rendering — this is the root fix for the badge duplication bug
  const rawBadges = d.badges || [];
  const seen = new Set();
  const badges = rawBadges.filter(b => { if(seen.has(b)) return false; seen.add(b); return true; });

  container.innerHTML = `
  <div class="prof-page">
    <div class="prof-hero-card">
      <div class="prof-hero-banner" style="background:linear-gradient(135deg,${color}55,${color}11)"></div>
      <div class="prof-hero-body">
        <div class="prof-hero-ava" id="prof-ava" style="background:${color}">${avatarHtml(d.icon, d.username, '52%')}</div>
        <div class="prof-hero-info">
          <div class="prof-hero-name" id="prof-name">${escHtml(d.username)}</div>
          <div class="prof-hero-sub">
            <span class="rbadge ${d.rank}" id="prof-rank">${d.rank}</span>
            ${joinedDate ? `<span class="prof-hero-joined">Member since ${joinedDate}</span>` : ''}
          </div>
          <div class="prof-hero-badges" id="prof-badges">
            ${renderBadgeRow(badges) || '<span class="prof-no-badges">No badges yet</span>'}
          </div>
        </div>
      </div>
    </div>
    <div class="prof-panels" id="prof-edit-section"></div>
  </div>`;
}

// ── Auto-award non-weekly badges ──
export async function checkAutoAwards(uid, userData) {
  const rawBadges = userData.badges || [];
  // Always deduplicate first when checking/writing
  // Also remove deprecated badges (customized/stylist)
  const DEPRECATED = new Set(['customized']);
  const existing = [...new Set(rawBadges)].filter(b => !DEPRECATED.has(b));
  const newBadges = [...existing];
  let changed = existing.length !== rawBadges.length; // changed if we removed deprecated

  // Auto-award veteran badge for accounts 30+ days old
  if(!existing.includes('veteran') && userData.createdAt?.toDate) {
    const accountAgeMs = Date.now() - userData.createdAt.toDate().getTime();
    if(accountAgeMs > 30*24*60*60*1000) {
      newBadges.push('veteran'); changed = true;
    }
  }

  // If we found duplicates or changes, write back
  if(changed) {
    const dedupedNew = [...new Set(newBadges)];
    await updateDoc(doc(db,'users',uid), { badges: dedupedNew }).catch(()=>{});
  }
}