// ═══════════════════════════════════════════════════
//  shop.js — GoatCoin Shop
//  Buy cosmetic items: profile icons, name colours,
//  special badges, chat flair, etc.
//  Purchases stored in RTDB (user's owned items) and
//  applied to their Firestore user document.
// ═══════════════════════════════════════════════════
import {
  db, auth,
  doc, getDoc, updateDoc, collection, getDocs, serverTimestamp
} from './firebase.js';
import { getDatabase, ref as rtRef, set as rtSet, get as rtGet, update as rtUpdate } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { toast, avatarColor, escHtml, avatarHtml, SVG_ICONS } from './app.js';
import { getGoatCoinData } from './goatcoin.js';

// Helper to get a shop item's SVG preview icon
function _shopItemSvg(item) {
  if(item.iconKey && SVG_ICONS[item.iconKey]) {
    return `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${SVG_ICONS[item.iconKey]}</svg>`;
  }
  // Flair / badge icons
  const fallbacks = {
    flair_rainbow: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 17a10 10 0 00-20 0"/><path d="M6 17a6 6 0 0112 0"/><path d="M10 17a2 2 0 014 0"/></svg>`,
    flair_glow:    `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
    flair_wave:    `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/><path d="M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1"/></svg>`,
    badge_rich:    `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    badge_early:   `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  };
  return fallbacks[item.id] || `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>`;
}

// ── Module state ──
let _shopUser   = null;
let _shopData   = null; // Firestore user doc data
let _rtdb       = null;
let _ownedItems = {}; // { itemId: true }

// ══════════════════════════════════════════
//  SHOP CATALOGUE
// ══════════════════════════════════════════
export const SHOP_ITEMS = [
  // ── Profile Icons ──
  {
    id: 'icon_crown',
    category: 'icons',
    name: 'Crown',
    desc: 'A regal crown for your avatar.',
    iconKey: 'crown',
    price: 150,
    type: 'icon',
  },
  {
    id: 'icon_rocket',
    category: 'icons',
    name: 'Rocket',
    desc: 'Blast off with a rocket icon.',
    iconKey: 'rocket',
    price: 120,
    type: 'icon',
  },
  {
    id: 'icon_diamond',
    category: 'icons',
    name: 'Diamond',
    desc: 'Shine bright with a diamond.',
    iconKey: 'diamond',
    price: 200,
    type: 'icon',
  },
  {
    id: 'icon_flame',
    category: 'icons',
    name: 'Flame',
    desc: 'Stay lit.',
    iconKey: 'flame',
    price: 100,
    type: 'icon',
  },
  {
    id: 'icon_skull',
    category: 'icons',
    name: 'Skull',
    desc: 'Edgy skull icon.',
    iconKey: 'skull',
    price: 100,
    type: 'icon',
  },
  {
    id: 'icon_ghost',
    category: 'icons',
    name: 'Ghost',
    desc: 'Boo! A spooky ghost.',
    iconKey: 'ghost',
    price: 80,
    type: 'icon',
  },
  {
    id: 'icon_music',
    category: 'icons',
    name: 'Music Note',
    desc: 'For the music lovers.',
    iconKey: 'music',
    price: 80,
    type: 'icon',
  },
  {
    id: 'icon_planet',
    category: 'icons',
    name: 'Planet',
    desc: 'Out of this world.',
    iconKey: 'planet',
    price: 130,
    type: 'icon',
  },
  {
    id: 'icon_heart',
    category: 'icons',
    name: 'Heart',
    desc: 'Spread some love.',
    iconKey: 'heart',
    price: 60,
    type: 'icon',
  },
  {
    id: 'icon_eye',
    category: 'icons',
    name: 'Eye',
    desc: 'Always watching.',
    iconKey: 'eye',
    price: 120,
    type: 'icon',
  },
  {
    id: 'icon_trophy',
    category: 'icons',
    name: 'Trophy',
    desc: 'For the true champions.',
    iconKey: 'trophy',
    price: 250,
    type: 'icon',
  },
  {
    id: 'icon_controller',
    category: 'icons',
    name: 'Controller',
    desc: 'Game on.',
    iconKey: 'controller',
    price: 90,
    type: 'icon',
  },
  {
    id: 'icon_moon',
    category: 'icons',
    name: 'Moon',
    desc: 'Late night vibes.',
    iconKey: 'moon',
    price: 70,
    type: 'icon',
  },
  {
    id: 'icon_sun',
    category: 'icons',
    name: 'Sun',
    desc: 'Rise and shine.',
    iconKey: 'sun',
    price: 70,
    type: 'icon',
  },
  {
    id: 'icon_compass',
    category: 'icons',
    name: 'Compass',
    desc: 'Find your direction.',
    iconKey: 'compass',
    price: 90,
    type: 'icon',
  },
  {
    id: 'icon_infinity',
    category: 'icons',
    name: 'Infinity',
    desc: 'Endless possibilities.',
    iconKey: 'infinity',
    price: 180,
    type: 'icon',
  },
  // ── Flair / Cosmetics ──
  {
    id: 'flair_rainbow',
    category: 'flair',
    name: 'Rainbow Name',
    desc: 'Your username shows with a rainbow gradient in chat. Makes you stand out.',
    price: 400,
    type: 'flair',
    flairKey: 'rainbow_name',
  },
  {
    id: 'flair_glow',
    category: 'flair',
    name: 'Name Glow',
    desc: 'Your username glows with your avatar color in chat messages.',
    price: 300,
    type: 'flair',
    flairKey: 'name_glow',
  },
  {
    id: 'flair_wave',
    category: 'flair',
    name: 'Wave Animation',
    desc: 'A subtle wave animation on your avatar in the members list.',
    price: 350,
    type: 'flair',
    flairKey: 'wave_avatar',
  },
  // ── Badges ──
  {
    id: 'badge_rich',
    category: 'badges',
    name: 'Whale',
    desc: 'Flex your wealth. Awarded for spending 500+ GC in the shop.',
    price: 500,
    type: 'badge',
    badgeKey: 'whale',
  },
  {
    id: 'badge_early',
    category: 'badges',
    name: 'Pioneer',
    desc: 'Proof you were here before the shop existed.',
    price: 200,
    type: 'badge',
    badgeKey: 'pioneer',
  },
];

const CATEGORIES = [
  { id: 'all',    label: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> All' },
  { id: 'icons',  label: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Icons' },
  { id: 'flair',  label: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> Flair' },
  { id: 'badges', label: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Badges' },
];

// ══════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════
export function initShop(user, userData, rtdb) {
  _shopUser = user;
  _shopData = userData;
  _rtdb = rtdb || null;
  _loadOwnedItems();
}

async function _loadOwnedItems() {
  if(!_shopUser) return;
  try {
    if(_rtdb) {
      const snap = await rtGet(rtRef(_rtdb, `shop_owned/${_shopUser.uid}`));
      _ownedItems = snap.val() || {};
    } else {
      const snap = await getDoc(doc(db, 'shop_owned', _shopUser.uid));
      _ownedItems = snap.exists() ? snap.data() : {};
    }
  } catch(e) {
    _ownedItems = {};
  }
}

async function _saveOwnedItems() {
  if(!_shopUser) return;
  try {
    if(_rtdb) {
      await rtSet(rtRef(_rtdb, `shop_owned/${_shopUser.uid}`), _ownedItems);
    } else {
      // fallback Firestore
    }
  } catch(e) {}
}

// ══════════════════════════════════════════
//  TAB RENDER
// ══════════════════════════════════════════
export async function renderShopTab() {
  const container = document.getElementById('section-shop');
  if(!container) return;

  // Re-load owned items fresh
  await _loadOwnedItems();

  const gcData = getGoatCoinData();
  const coins = gcData ? Math.floor(gcData.coins || 0) : 0;

  let activeCategory = 'all';

  function _renderGrid() {
    const items = activeCategory === 'all'
      ? SHOP_ITEMS
      : SHOP_ITEMS.filter(i => i.category === activeCategory);

    return items.map(item => {
      const owned = !!_ownedItems[item.id];
      const canAfford = coins >= item.price;
      const isEquipped = _isEquipped(item);

      return `
        <div class="shop-card${owned ? ' shop-card-owned' : ''}${!canAfford && !owned ? ' shop-card-cant-afford' : ''}">
          <div class="shop-card-icon">${_shopItemSvg(item)}</div>
          <div class="shop-card-name">${escHtml(item.name)}</div>
          <div class="shop-card-desc">${escHtml(item.desc)}</div>
          <div class="shop-card-price">
            ${owned
              ? `<span class="shop-owned-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Owned</span>`
              : `<span class="shop-price-tag"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> ${item.price.toLocaleString()} GC</span>`
            }
          </div>
          <div class="shop-card-actions">
            ${owned
              ? (isEquipped
                  ? `<button class="btn btn-sm shop-unequip-btn" data-itemid="${item.id}">Unequip</button>`
                  : `<button class="btn btn-sm shop-equip-btn" data-itemid="${item.id}">Equip</button>`)
              : `<button class="btn btn-sm${!canAfford ? ' btn-disabled' : ''} shop-buy-btn" data-itemid="${item.id}" ${!canAfford ? 'disabled' : ''}>
                  ${canAfford ? 'Buy' : 'Not enough GC'}
                </button>`
            }
          </div>
        </div>`;
    }).join('');
  }

  function _render() {
    const freshGC = getGoatCoinData();
    const freshCoins = freshGC ? Math.floor(freshGC.coins || 0) : 0;
    const grid = document.getElementById('shop-grid');
    if(grid) grid.innerHTML = _renderGrid();
    const balEl = document.getElementById('shop-balance');
    if(balEl) balEl.textContent = freshCoins.toLocaleString() + ' GC';
    _wireButtons();
  }

  container.innerHTML = `
    <div class="shop-page">
      <div class="shop-topbar">
        <div class="shop-topbar-left">
          <div class="shop-title"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg> Shop</div>
          <div class="shop-sub">Spend your GoatCoin on cool cosmetics</div>
        </div>
        <div class="shop-balance-chip">
          <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg></span>
          <span id="shop-balance">${coins.toLocaleString()} GC</span>
        </div>
      </div>

      <div class="shop-cats">
        ${CATEGORIES.map(c => `
          <button class="shop-cat-btn${c.id === activeCategory ? ' active' : ''}" data-cat="${c.id}">${c.label}</button>
        `).join('')}
      </div>

      <div class="shop-grid" id="shop-grid">
        ${_renderGrid()}
      </div>
    </div>`;

  // Category buttons
  container.querySelectorAll('.shop-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.shop-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeCategory = btn.dataset.cat;
      _render();
    });
  });

  _wireButtons();

  function _wireButtons() {
    const grid = document.getElementById('shop-grid');
    if(!grid) return;

    // Buy
    grid.querySelectorAll('.shop-buy-btn:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.itemid;
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if(!item) return;
        await _purchaseItem(item, _render);
      });
    });

    // Equip
    grid.querySelectorAll('.shop-equip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.itemid;
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if(!item) return;
        await _equipItem(item);
        _render();
      });
    });

    // Unequip
    grid.querySelectorAll('.shop-unequip-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const itemId = btn.dataset.itemid;
        const item = SHOP_ITEMS.find(i => i.id === itemId);
        if(!item) return;
        await _unequipItem(item);
        _render();
      });
    });
  }
}

// ══════════════════════════════════════════
//  PURCHASE LOGIC
// ══════════════════════════════════════════
async function _purchaseItem(item, onDone) {
  if(!_shopUser) return;
  const gcData = getGoatCoinData();
  const coins = gcData ? Math.floor(gcData.coins || 0) : 0;
  if(coins < item.price) { toast('Not enough GoatCoin!', 'error'); return; }
  if(_ownedItems[item.id]) { toast('You already own this!', 'warning'); return; }

  try {
    // Deduct coins from goatcoin doc
    const gcRef = doc(db, 'goatcoin', _shopUser.uid);
    const gcSnap = await getDoc(gcRef);
    if(!gcSnap.exists()) { toast('GoatCoin data not found.', 'error'); return; }
    const currentCoins = Math.floor(gcSnap.data().coins || 0);
    if(currentCoins < item.price) { toast('Not enough GoatCoin!', 'error'); return; }
    await updateDoc(gcRef, { coins: currentCoins - item.price });

    // Record purchase in RTDB
    _ownedItems[item.id] = true;
    await _saveOwnedItems();

    // If it's a badge, award it automatically
    if(item.type === 'badge' && item.badgeKey) {
      const userRef = doc(db, 'users', _shopUser.uid);
      const userSnap = await getDoc(userRef);
      if(userSnap.exists()) {
        const existing = [...new Set(userSnap.data().badges || [])];
        if(!existing.includes(item.badgeKey)) {
          await updateDoc(userRef, { badges: [...existing, item.badgeKey] });
          _shopData = { ..._shopData, badges: [...existing, item.badgeKey] };
        }
      }
    }

    // If it's a flair, apply it
    if(item.type === 'flair' && item.flairKey) {
      const userRef = doc(db, 'users', _shopUser.uid);
      const flairs = _shopData?.shopFlair || [];
      if(!flairs.includes(item.flairKey)) {
        const updated = [...flairs, item.flairKey];
        await updateDoc(userRef, { shopFlair: updated });
        _shopData = { ..._shopData, shopFlair: updated };
      }
    }

    toast(`${item.name} purchased!`, 'success');
    if(onDone) onDone();
  } catch(e) {
    toast('Purchase failed: ' + e.message, 'error');
  }
}

// ══════════════════════════════════════════
//  EQUIP / UNEQUIP
// ══════════════════════════════════════════
function _isEquipped(item) {
  if(!_shopData) return false;
  if(item.type === 'icon') return _shopData.icon === item.iconKey;
  if(item.type === 'flair') return (_shopData.shopFlair || []).includes(item.flairKey);
  if(item.type === 'badge') return (_shopData.badges || []).includes(item.badgeKey);
  return false;
}

async function _equipItem(item) {
  if(!_shopUser || !_ownedItems[item.id]) return;
  try {
    const userRef = doc(db, 'users', _shopUser.uid);
    if(item.type === 'icon') {
      await updateDoc(userRef, { icon: item.iconKey });
      _shopData = { ..._shopData, icon: item.iconKey };
      // Update sidebar avatar
      const sp = document.getElementById('sp-ava');
      if(sp) sp.innerHTML = avatarHtml(item.iconKey, _shopData.username, '60%');
      // Propagate
      if(window.propagateProfileToMessages) {
        window.propagateProfileToMessages(_shopUser.uid, { icon: item.iconKey }).catch(()=>{});
      }
      toast(`${item.name} equipped!`, 'success');
    } else if(item.type === 'flair') {
      const flairs = [...new Set([...(_shopData.shopFlair || []), item.flairKey])];
      await updateDoc(userRef, { shopFlair: flairs });
      _shopData = { ..._shopData, shopFlair: flairs };
      toast(`${item.name} activated!`, 'success');
    } else if(item.type === 'badge') {
      // Badges are auto-equipped on purchase, just toast
      toast(`Badge is already active!`, 'info');
    }
  } catch(e) {
    toast('Failed to equip: ' + e.message, 'error');
  }
}

async function _unequipItem(item) {
  if(!_shopUser) return;
  try {
    const userRef = doc(db, 'users', _shopUser.uid);
    if(item.type === 'icon') {
      await updateDoc(userRef, { icon: '' });
      _shopData = { ..._shopData, icon: '' };
      const sp = document.getElementById('sp-ava');
      if(sp) sp.innerHTML = avatarHtml('', _shopData.username, '60%');
      if(window.propagateProfileToMessages) {
        window.propagateProfileToMessages(_shopUser.uid, { icon: '' }).catch(()=>{});
      }
      toast('Icon removed.', 'info');
    } else if(item.type === 'flair') {
      const flairs = (_shopData.shopFlair || []).filter(f => f !== item.flairKey);
      await updateDoc(userRef, { shopFlair: flairs });
      _shopData = { ..._shopData, shopFlair: flairs };
      toast(`${item.name} deactivated.`, 'info');
    }
  } catch(e) {
    toast('Failed to unequip: ' + e.message, 'error');
  }
}
