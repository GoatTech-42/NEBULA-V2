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
import { toast, avatarColor, escHtml, avatarHtml } from './app.js';
import { getGoatCoinData } from './goatcoin.js';

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
    emoji: '👑',
    iconKey: 'crown',
    price: 150,
    type: 'icon',
  },
  {
    id: 'icon_rocket',
    category: 'icons',
    name: 'Rocket',
    desc: 'Blast off with a rocket icon.',
    emoji: '🚀',
    iconKey: 'rocket',
    price: 120,
    type: 'icon',
  },
  {
    id: 'icon_diamond',
    category: 'icons',
    name: 'Diamond',
    desc: 'Shine bright with a diamond.',
    emoji: '💎',
    iconKey: 'diamond',
    price: 200,
    type: 'icon',
  },
  {
    id: 'icon_flame',
    category: 'icons',
    name: 'Flame',
    desc: 'Stay lit.',
    emoji: '🔥',
    iconKey: 'flame',
    price: 100,
    type: 'icon',
  },
  {
    id: 'icon_skull',
    category: 'icons',
    name: 'Skull',
    desc: 'Edgy skull icon.',
    emoji: '💀',
    iconKey: 'skull',
    price: 100,
    type: 'icon',
  },
  {
    id: 'icon_ghost',
    category: 'icons',
    name: 'Ghost',
    desc: 'Boo! A spooky ghost.',
    emoji: '👻',
    iconKey: 'ghost',
    price: 80,
    type: 'icon',
  },
  {
    id: 'icon_music',
    category: 'icons',
    name: 'Music Note',
    desc: 'For the music lovers.',
    emoji: '🎵',
    iconKey: 'music',
    price: 80,
    type: 'icon',
  },
  {
    id: 'icon_planet',
    category: 'icons',
    name: 'Planet',
    desc: 'Out of this world.',
    emoji: '🪐',
    iconKey: 'planet',
    price: 130,
    type: 'icon',
  },
  {
    id: 'icon_heart',
    category: 'icons',
    name: 'Heart',
    desc: 'Spread some love.',
    emoji: '❤️',
    iconKey: 'heart',
    price: 60,
    type: 'icon',
  },
  {
    id: 'icon_eye',
    category: 'icons',
    name: 'Eye',
    desc: 'Always watching.',
    emoji: '👁️',
    iconKey: 'eye',
    price: 120,
    type: 'icon',
  },
  {
    id: 'icon_trophy',
    category: 'icons',
    name: 'Trophy',
    desc: 'For the true champions.',
    emoji: '🏆',
    iconKey: 'trophy',
    price: 250,
    type: 'icon',
  },
  {
    id: 'icon_controller',
    category: 'icons',
    name: 'Controller',
    desc: 'Game on.',
    emoji: '🎮',
    iconKey: 'controller',
    price: 90,
    type: 'icon',
  },
  {
    id: 'icon_moon',
    category: 'icons',
    name: 'Moon',
    desc: 'Late night vibes.',
    emoji: '🌙',
    iconKey: 'moon',
    price: 70,
    type: 'icon',
  },
  {
    id: 'icon_sun',
    category: 'icons',
    name: 'Sun',
    desc: 'Rise and shine.',
    emoji: '☀️',
    iconKey: 'sun',
    price: 70,
    type: 'icon',
  },
  {
    id: 'icon_compass',
    category: 'icons',
    name: 'Compass',
    desc: 'Find your direction.',
    emoji: '🧭',
    iconKey: 'compass',
    price: 90,
    type: 'icon',
  },
  {
    id: 'icon_infinity',
    category: 'icons',
    name: 'Infinity',
    desc: 'Endless possibilities.',
    emoji: '∞',
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
    emoji: '🌈',
    price: 400,
    type: 'flair',
    flairKey: 'rainbow_name',
  },
  {
    id: 'flair_glow',
    category: 'flair',
    name: 'Name Glow',
    desc: 'Your username glows with your avatar color in chat messages.',
    emoji: '✨',
    price: 300,
    type: 'flair',
    flairKey: 'name_glow',
  },
  {
    id: 'flair_wave',
    category: 'flair',
    name: 'Wave Animation',
    desc: 'A subtle wave animation on your avatar in the members list.',
    emoji: '🌊',
    price: 350,
    type: 'flair',
    flairKey: 'wave_avatar',
  },
  // ── Badges ──
  {
    id: 'badge_rich',
    category: 'badges',
    name: 'Whale 🐳',
    desc: 'Flex your wealth. Awarded for spending 500+ GC in the shop.',
    emoji: '🐳',
    price: 500,
    type: 'badge',
    badgeKey: 'whale',
  },
  {
    id: 'badge_early',
    category: 'badges',
    name: 'Pioneer 🧭',
    desc: 'Proof you were here before the shop existed.',
    emoji: '🧭',
    price: 200,
    type: 'badge',
    badgeKey: 'pioneer',
  },
];

const CATEGORIES = [
  { id: 'all',    label: '🛍️ All' },
  { id: 'icons',  label: '🎨 Icons' },
  { id: 'flair',  label: '✨ Flair' },
  { id: 'badges', label: '🏅 Badges' },
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
          <div class="shop-card-emoji">${item.emoji}</div>
          <div class="shop-card-name">${escHtml(item.name)}</div>
          <div class="shop-card-desc">${escHtml(item.desc)}</div>
          <div class="shop-card-price">
            ${owned
              ? `<span class="shop-owned-tag">✅ Owned</span>`
              : `<span class="shop-price-tag">🪙 ${item.price.toLocaleString()} GC</span>`
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
          <div class="shop-title">🛍️ Shop</div>
          <div class="shop-sub">Spend your GoatCoin on cool cosmetics</div>
        </div>
        <div class="shop-balance-chip">
          <span style="font-size:.85rem">🪙</span>
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

    toast(`${item.emoji} ${item.name} purchased!`, 'success');
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
      toast(`${item.emoji} ${item.name} equipped!`, 'success');
    } else if(item.type === 'flair') {
      const flairs = [...new Set([...(_shopData.shopFlair || []), item.flairKey])];
      await updateDoc(userRef, { shopFlair: flairs });
      _shopData = { ..._shopData, shopFlair: flairs };
      toast(`${item.emoji} ${item.name} activated!`, 'success');
    } else if(item.type === 'badge') {
      // Badges are auto-equipped on purchase, just toast
      toast(`${item.emoji} Badge is already active!`, 'info');
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
