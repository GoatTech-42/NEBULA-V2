// ═══════════════════════════════════════════════════
//  profile.js — Profiles, badges, adblocker notice
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, updateDoc, collection, getDocs, serverTimestamp
} from './firebase.js';
import { toast, avatarColor, avatarInitial, escHtml, canModerate, RANK_COLORS, avatarHtml } from './app.js';
import { getGoatCoinData } from './goatcoin.js';

// ── Badge definitions (no emojis — use text labels + accent colors) ──
export const BADGE_DEFS = {
  champion:   { label:'Champion',  desc:'Most GoatCoins earned this week',   color:'#fbbf24', icon:'C' },
  sweat:      { label:'Sweat',     desc:'Most games played this week',        color:'#f97316', icon:'S' },
  social:     { label:'Social',    desc:'Most time in chat this week',        color:'#38bdf8', icon:'T' },
  lucky:      { label:'Lucky',     desc:'Most blackjack wins this week',      color:'#4ade80', icon:'L' },
  veteran:    { label:'Veteran',   desc:'Member for 30+ days',                color:'#fde68a', icon:'V' },
  og:         { label:'OG',        desc:'One of the first members',           color:'#67e8f9', icon:'O' },
  customized: { label:'Stylist',   desc:'Customized their avatar color',      color:'#a78bfa', icon:'A' },
};

const fmtTime = mins => {
  if(!mins||mins<1) return '0m';
  if(mins<60) return `${mins}m`;
  const h=Math.floor(mins/60), m=mins%60;
  return m ? `${h}h ${m}m` : `${h}h`;
};

// ── Render badge row — no emojis, clean pill style ──
export function renderBadgeRow(badges, compact=false) {
  if(!badges?.length) return '';
  const SVGS = {
    champion: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
    sweat:    '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
    social:   '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
    lucky:    '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    veteran:  '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    og:       '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>',
    customized:'<circle cx="13.5" cy="6.5" r="2.5"/><circle cx="6.5" cy="13.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/>',
  };
  const dflt = '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2"/>';
  return badges.map(b => {
    const def = BADGE_DEFS[b] || { label: b, color:'var(--accent)' };
    const svgInner = SVGS[b] || dflt;
    const svgEl = `<svg class="badge-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>`;
    if(compact) {
      return `<span class="badge-chip badge-compact" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${svgEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
    }
    return `<span class="badge-chip" style="--bc:${def.color}" title="${escHtml(def.desc||b)}">${svgEl}<span class="badge-label">${escHtml(def.label)}</span></span>`;
  }).join('');
}

// ── Adblocker detection + notice ──
export function checkAdblocker() {
  // Try to load a resource that adblockers commonly block
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
      <div class="adblock-icon">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div class="adblock-text">
        <strong>Ad blocker detected</strong>
        <span>GoatCoin time tracking may not work correctly. Please disable your ad blocker for this site.</span>
      </div>
      <button class="adblock-dismiss" id="adblock-dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
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
    const badges = u.badges || [];

    modal.innerHTML = `
      <div class="prof-modal">

        <!-- Banner + avatar -->
        <div class="prof-modal-hero" style="background:linear-gradient(135deg,${color}44,${color}11)">
          <div class="prof-modal-ava" style="background:${color}">${avatarHtml(u.icon, u.username, '52%')}</div>
        </div>

        <div class="prof-modal-body">

          <!-- Identity -->
          <div class="prof-modal-identity">
            <div class="prof-modal-name">${escHtml(u.username)}</div>
            <div class="prof-modal-sub">
              <span class="rbadge ${u.rank}">${u.rank}</span>
              <span class="prof-modal-joined">Joined ${joinedDate}</span>
            </div>
          </div>

          <!-- Badges -->
          <div class="prof-modal-badges-section">
            <div class="prof-section-label">Badges</div>
            <div class="prof-modal-badges" id="pm-badge-display">
              ${renderBadgeRow(badges) || '<span class="prof-no-badges">No badges yet</span>'}
            </div>
          </div>

          <!-- Stats grid -->
          <div class="prof-section-label" style="margin-top:1rem">Stats</div>
          <div class="prof-modal-stats">
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.coins||0).toLocaleString()}</div><div class="pst-key">Coins</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${Math.floor(gc.weekCoins||0).toLocaleString()}</div><div class="pst-key">Coins (week)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.totalChatMins||0)}</div><div class="pst-key">Chat (total)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekChatMins||0)}</div><div class="pst-key">Chat (week)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.totalGameMins||0)}</div><div class="pst-key">Games (total)</div></div>
            <div class="prof-stat-tile"><div class="pst-val">${fmtTime(gc.weekGameMins||0)}</div><div class="pst-key">Games (week)</div></div>
          </div>

          <!-- Admin badge panel -->
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

          <!-- Actions -->
          <div class="modal-actions" style="margin-top:1.2rem">
            ${!isOwn ? `<button class="btn btn-ghost btn-sm" id="prof-dm-btn">Message</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('modal-overlay').click()">Close</button>
          </div>
        </div>
      </div>`;

    // Wire preset badge toggles
    if(canAdmin) {
      modal.querySelectorAll('.badge-admin-btn:not(.bab-custom)').forEach(btn => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.badge;
          const uref = doc(db,'users',uid);
          const snap = await getDoc(uref);
          if(!snap.exists()) return;
          const existing = snap.data().badges || [];
          if(existing.includes(key)) {
            await updateDoc(uref, { badges: existing.filter(b=>b!==key) });
            btn.classList.remove('bab-active');
            toast(`Removed "${key}"`, 'info');
          } else {
            await updateDoc(uref, { badges: [...existing, key] });
            btn.classList.add('bab-active');
            toast(`Awarded "${key}"`, 'success');
          }
          // Refresh badge display in modal
          const snap2 = await getDoc(uref);
          const pm = modal.querySelector('#pm-badge-display');
          if(pm) pm.innerHTML = renderBadgeRow(snap2.data().badges||[]) || '<span class="prof-no-badges">No badges yet</span>';
        });
      });

      // Custom badge remove
      modal.querySelectorAll('.bab-custom').forEach(btn => {
        btn.querySelector('.bab-remove')?.addEventListener('click', async e => {
          e.stopPropagation();
          const key = btn.dataset.badge;
          const uref = doc(db,'users',uid);
          const snap = await getDoc(uref);
          if(!snap.exists()) return;
          await updateDoc(uref, { badges: snap.data().badges.filter(b=>b!==key) });
          btn.remove();
          toast(`Removed "${key}"`, 'info');
        });
      });

      // Add custom badge
      modal.querySelector('#add-custom-badge-btn')?.addEventListener('click', async () => {
        const labelInp = modal.querySelector('#custom-badge-label');
        const colorInp = modal.querySelector('#custom-badge-color');
        const label = labelInp?.value.trim().toLowerCase().replace(/\s+/g,'-');
        if(!label) { toast('Enter a badge name', 'warning'); return; }
        const uref = doc(db,'users',uid);
        const snap = await getDoc(uref);
        if(!snap.exists()) return;
        const existing = snap.data().badges || [];
        if(existing.includes(label)) { toast('Badge already exists', 'warning'); return; }
        await updateDoc(uref, { badges: [...existing, label] });
        const color = colorInp?.value || '#38bdf8';
        // Also store custom badge def in user doc for display
        await updateDoc(uref, { [`customBadges.${label}`]: { label, color, icon: label[0].toUpperCase() } });
        toast(`Added "${label}"`, 'success');
        if(labelInp) labelInp.value = '';
        // Refresh custom badges list
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
            if(s.exists()) await updateDoc(doc(db,'users',uid), { badges: s.data().badges.filter(b=>b!==label) });
            btn2.remove();
          });
          customEl.appendChild(btn2);
        }
        const pm = modal.querySelector('#pm-badge-display');
        if(pm) {
          const s2 = await getDoc(uref);
          pm.innerHTML = renderBadgeRow(s2.data().badges||[]) || '<span class="prof-no-badges">No badges yet</span>';
        }
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
  const badges = d.badges || [];
  const customDefs = d.customBadges || {};

  // Merge custom badge defs into lookup
  Object.entries(customDefs).forEach(([k,v]) => {
    if(!BADGE_DEFS[k]) BADGE_DEFS[k] = v;
  });

  container.innerHTML = `
  <div class="prof-page">

    <!-- Hero card -->
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

    <!-- Edit panels injected by app.js -->
    <div class="prof-panels" id="prof-edit-section"></div>
  </div>`;
}

// ── Auto-award non-weekly badges ──
export async function checkAutoAwards(uid, userData) {
  const badges = userData.badges || [];
  const newBadges = [...badges];
  let changed = false;
  if(!badges.includes('veteran') && userData.createdAt?.toDate) {
    if(Date.now() - userData.createdAt.toDate().getTime() > 30*24*60*60*1000) {
      newBadges.push('veteran'); changed = true;
    }
  }
  if(changed) await updateDoc(doc(db,'users',uid), { badges: newBadges }).catch(()=>{});
}