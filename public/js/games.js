// games.js — Game vault
//
// Loads the game list from one of multiple sources, selectable via the
// source dropdown:
//   1. NEBULA-CDN  — our self-hosted catalog on jsDelivr (default).
//   2. LuminSDK    — luminsdk.com 1k+ games, loaded via headless mode.
//
// Each source has its own load flow, category map, and play handler so
// the two libraries stay cleanly separated. The active source is stored
// in a cookie so it persists across visits.

// ── Source registry ──
const SOURCES = {
  nebula: {
    id: 'nebula',
    label: 'Nebula CDN',
    desc: 'Self-hosted catalog',
  },
  lumin: {
    id: 'lumin',
    label: 'LuminSDK',
    desc: '1k+ games via luminsdk.com',
  },
};

const NEBULA_CDN_BASE = "https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@main";
const NEBULA_CATALOG_URL = NEBULA_CDN_BASE + "/games.json";
const LUMIN_SDK_URL = "https://cdn.jsdelivr.net/gh/luminsdk/script@latest/lumin.min.js";

let activeSource = 'nebula';
let allGames = [];       // full catalog after parsing — uniform shape
let zones = [];           // currently displayed (after category filter)
let showFavsOnly = false;
let activeCategory = 'all';
let _luminReady = false;  // whether Lumin.init() has been called this session
let _luminLoading = null; // in-flight load promise so concurrent loads dedupe

// ── Cookie helpers ──
function getCookie(name) {
  const c = document.cookie.split(';').find(x => x.trim().startsWith(name + '='));
  return c ? decodeURIComponent(c.split('=').slice(1).join('=')) : '';
}
function setCookie(name, value, days = 365) {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${days * 86400}`;
}

// ── Favorites — persisted per-source so a Lumin "snake-classic" doesn't
//    collide with a Nebula "snake.html". ──
function favsKey() { return `neb_favs_${activeSource}`; }
function getFavs() {
  try { return JSON.parse(getCookie(favsKey()) || '[]'); } catch { return []; }
}
function setFavs(arr) { setCookie(favsKey(), JSON.stringify(arr)); }

// ── Init ──
export async function initGames() {
  // Restore the last-used source. Default to nebula.
  const saved = getCookie('neb_game_source');
  if (saved && SOURCES[saved]) activeSource = saved;

  // Build the source dropdown UI before loading anything so the user gets
  // immediate feedback even if the source is slow to fetch.
  setupVaultEvents();
  renderSourceDropdown();

  await loadActiveSource();
}

async function loadActiveSource() {
  const grid = document.getElementById('game-grid');
  if (grid) grid.innerHTML = '<div class="vault-loading">Loading games...</div>';

  // Reset state so categories from the previous source don't bleed in.
  allGames = [];
  zones = [];
  activeCategory = 'all';

  try {
    if (activeSource === 'nebula') {
      await loadNebula();
    } else if (activeSource === 'lumin') {
      await loadLumin();
    }
    applyCategoryFilter();
    renderCategoryTabs();
  } catch (e) {
    console.error(`Games init error (${activeSource}):`, e);
    if (grid) grid.innerHTML = `<div class="vault-empty"><span>Failed to load ${SOURCES[activeSource]?.label || activeSource} — ${escapeText(e.message)}</span></div>`;
  }
}

// ── NEBULA-CDN loader ──
async function loadNebula() {
  let catalogURL = NEBULA_CATALOG_URL;
  // Try to get latest commit SHA for cache busting via jsDelivr purge
  try {
    const shaResp = await fetch("https://api.github.com/repos/GoatTech-42/NEBULA-CDN/commits?per_page=1&t=" + Date.now());
    if (shaResp.status === 200) {
      const shajson = await shaResp.json();
      const sha = shajson[0]?.sha;
      if (sha) catalogURL = `https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@${sha}/games.json`;
    }
  } catch { }

  const resp = await fetch(catalogURL);
  let text = await resp.text();
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const catalog = JSON.parse(text);

  // Convert NEBULA-CDN games.json format to internal format
  allGames = (catalog.games || []).map(g => ({
    source: 'nebula',
    id: g.id || g.slug,
    name: g.name || g.slug,
    slug: g.slug,
    file: g.file,
    url: `${NEBULA_CDN_BASE}/${g.file}`,
    category: g.category || 'Other',
    tags: g.tags || [],
    description: g.description || '',
    size: g.size || 0,
    image: '',
  }));
}

// ── LuminSDK loader ──
// Loads the SDK on demand (only when the user actually selects this source)
// so visitors who only want Nebula's catalog don't pay the script-load cost.
async function loadLumin() {
  await ensureLuminLoaded();

  // Fetch the full catalog. Lumin paginates server-side so we ask for a
  // generous limit; if the SDK silently caps it, we'll just see fewer games.
  let games = [];
  let page = 1;
  const limit = 200;
  let pages = 1;
  // Defensive: cap to 20 pages (4k games) so a misbehaving server can't
  // freeze the browser.
  while (page <= pages && page <= 20) {
    const res = await window.Lumin.getGames({ page, limit });
    if (!res || !Array.isArray(res.games)) break;
    games = games.concat(res.games);
    pages = res.pages || 1;
    if (!res.games.length) break;
    page++;
  }

  // Lumin returns image_token, not a URL. We resolve images lazily on render
  // (one async call per visible card) so we don't block the initial paint.
  allGames = games.map(g => ({
    source: 'lumin',
    id: g.id,
    name: g.name || g.id,
    slug: g.id,
    file: '',
    url: '',                       // resolved on click via Lumin.getGameUrl()
    category: g.category || 'Other',
    tags: [],
    description: g.description || '',
    size: 0,
    image_token: g.image_token || '',
    image: '',                     // populated lazily by getLazyObserver
  }));
}

// Loads & initializes the Lumin SDK exactly once per session.
function ensureLuminLoaded() {
  if (_luminReady) return Promise.resolve();
  if (_luminLoading) return _luminLoading;

  _luminLoading = new Promise((resolve, reject) => {
    // If a previous session already injected the script (e.g. swapping
    // sources twice), reuse it instead of double-injecting.
    let scriptEl = document.querySelector(`script[src="${LUMIN_SDK_URL}"]`);
    const onReady = async () => {
      try {
        if (!window.Lumin) throw new Error('Lumin global not found');
        if (!_luminReady) {
          await window.Lumin.init({ headless: true });
          _luminReady = true;
        }
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    if (scriptEl) {
      // If it's still loading, wait for it; otherwise proceed.
      if (window.Lumin) onReady();
      else scriptEl.addEventListener('load', onReady, { once: true });
      scriptEl.addEventListener('error', () => reject(new Error('Lumin SDK failed to load')), { once: true });
      return;
    }
    scriptEl = document.createElement('script');
    scriptEl.src = LUMIN_SDK_URL;
    scriptEl.async = true;
    scriptEl.onload = onReady;
    scriptEl.onerror = () => reject(new Error('Lumin SDK failed to load — check network or adblocker'));
    document.head.appendChild(scriptEl);
  }).catch(err => {
    // Reset the cached promise so a retry can try again.
    _luminLoading = null;
    throw err;
  });
  return _luminLoading;
}

// ── Source dropdown ──
function renderSourceDropdown() {
  const topbar = document.querySelector('.vault-topbar');
  if (!topbar) return;

  // Replace any existing dropdown so re-init is idempotent.
  topbar.querySelector('.vault-source-select-wrap')?.remove();

  const wrap = document.createElement('div');
  wrap.className = 'vault-source-select-wrap';
  // Inline styles keep the dropdown working even if the deployed CSS
  // hasn't updated yet — the layout.css update is best-effort cosmetic.
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:.4rem;flex-shrink:0';

  const label = document.createElement('span');
  label.style.cssText = 'font-size:.7rem;font-weight:700;color:var(--text-muted);letter-spacing:.04em;text-transform:uppercase';
  label.textContent = 'Source';

  const sel = document.createElement('select');
  sel.id = 'vault-source-select';
  sel.className = 'vault-source-select';
  sel.title = 'Switch game source';
  // Match the existing #vault-sort styling — same height, padding, etc.
  sel.style.cssText = 'min-width:140px';

  Object.values(SOURCES).forEach(src => {
    const opt = document.createElement('option');
    opt.value = src.id;
    opt.textContent = src.label;
    if (src.id === activeSource) opt.selected = true;
    sel.appendChild(opt);
  });

  sel.addEventListener('change', async () => {
    const newSource = sel.value;
    if (!SOURCES[newSource] || newSource === activeSource) return;
    activeSource = newSource;
    setCookie('neb_game_source', activeSource);
    await loadActiveSource();
  });

  wrap.appendChild(label);
  wrap.appendChild(sel);

  // Insert right after the search box so it sits next to the sort dropdown.
  const sort = topbar.querySelector('#vault-sort');
  if (sort) topbar.insertBefore(wrap, sort);
  else topbar.appendChild(wrap);
}

// ── Category filtering ──
function applyCategoryFilter() {
  if (activeCategory === 'all') {
    zones = [...allGames];
  } else {
    zones = allGames.filter(g => g.category === activeCategory);
  }
  handleSearch();
}

function renderCategoryTabs() {
  const topbar = document.querySelector('.vault-topbar');
  if (!topbar) return;

  // Remove existing source tabs if any
  topbar.querySelector('.vault-source-tabs')?.remove();

  // Build category list sorted by game count (descending)
  const catCounts = {};
  allGames.forEach(g => {
    catCounts[g.category] = (catCounts[g.category] || 0) + 1;
  });

  const sortedCats = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => cat);

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'vault-source-tabs';

  // "All" tab first
  const allBtn = document.createElement('button');
  allBtn.className = 'vault-src-tab active';
  allBtn.dataset.source = 'all';
  allBtn.textContent = 'All Games';
  const allBadge = document.createElement('span');
  allBadge.className = 'vault-src-count';
  allBadge.textContent = allGames.length.toLocaleString();
  allBtn.appendChild(allBadge);
  allBtn.addEventListener('click', () => {
    activeCategory = 'all';
    tabsWrap.querySelectorAll('.vault-src-tab').forEach(b => b.classList.remove('active'));
    allBtn.classList.add('active');
    applyCategoryFilter();
  });
  tabsWrap.appendChild(allBtn);

  // Category tabs
  sortedCats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'vault-src-tab';
    btn.dataset.source = cat;
    btn.textContent = cat;
    const badge = document.createElement('span');
    badge.className = 'vault-src-count';
    badge.textContent = (catCounts[cat] || 0).toLocaleString();
    btn.appendChild(badge);
    btn.addEventListener('click', () => {
      activeCategory = cat;
      tabsWrap.querySelectorAll('.vault-src-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyCategoryFilter();
    });
    tabsWrap.appendChild(btn);
  });

  topbar.appendChild(tabsWrap);
}

// ── Search / Sort / Filter ──
function handleSearch() {
  const q = (document.getElementById('vault-search')?.value || '').toLowerCase();
  const sort = document.getElementById('vault-sort')?.value || 'name';
  let filtered = zones.filter(z => {
    const matchSearch = z.name.toLowerCase().includes(q)
      || (z.slug && z.slug.toLowerCase().includes(q))
      || (z.tags && z.tags.some(t => t.toLowerCase().includes(q)))
      || (z.category && z.category.toLowerCase().includes(q));
    const matchFav = showFavsOnly ? getFavs().includes(z.id) : true;
    return matchSearch && matchFav;
  });
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'id') filtered.sort((a, b) => (b.slug || '').localeCompare(a.slug || ''));
  else if (sort === 'popular') filtered.sort((a, b) => (b.size || 0) - (a.size || 0));
  else filtered.sort((a, b) => a.name.localeCompare(b.name));
  renderGrid(filtered);
}

// ── Lazy load observer ──
let _lazyObserver = null;
function getLazyObserver() {
  if (_lazyObserver) return _lazyObserver;
  _lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const img = e.target;
        if (img.dataset.src) {
          img.src = img.dataset.src;
          delete img.dataset.src;
        }
        // Lumin: resolve image_token → blob URL on first viewport entry.
        if (img.dataset.luminToken) {
          const token = img.dataset.luminToken;
          delete img.dataset.luminToken;
          if (window.Lumin?.getImageUrl) {
            window.Lumin.getImageUrl(token).then(src => {
              if (src) img.src = src;
            }).catch(() => {});
          }
        }
        _lazyObserver.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  return _lazyObserver;
}

// ── Grid rendering (paginated) ──
const PAGE_SIZE = 48;
let _gridPage = 0, _gridData = [], _gridLoading = false;

// Generate a color from game name for placeholder covers
function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 25%)`;
}

// Category badge colors
const CAT_COLORS = {
  Shooter: '#ef4444', Racing: '#f97316', Puzzle: '#eab308', Platformer: '#22c55e',
  Strategy: '#14b8a6', Fighting: '#3b82f6', Sports: '#8b5cf6', Horror: '#ec4899',
  RPG: '#06b6d4', Simulation: '#84cc16', Pokemon: '#f43f5e', Mario: '#a855f7',
  Sonic: '#38bdf8', Minecraft: '#10b981', Zelda: '#0ea5e9', Other: '#64748b',
  // Lumin common categories
  Action: '#ef4444', Adventure: '#22c55e', Arcade: '#f97316', Casual: '#14b8a6',
};

function renderGrid(data) {
  const grid = document.getElementById('game-grid');
  if (!grid) return;
  _gridData = data;
  _gridPage = 0;
  grid.innerHTML = '';
  if (!data.length) {
    grid.innerHTML = `<div class="vault-empty" style="grid-column:1/-1"><div class="vault-empty-ico"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><span style="font-size:.85rem;font-weight:600">No games found</span></div>`;
    return;
  }
  renderGridPage();
  // Infinite scroll sentinel
  let sentinel = grid.parentElement.querySelector('.grid-sentinel');
  if (!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'grid-sentinel';
    grid.parentElement.appendChild(sentinel);
    new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !_gridLoading) renderGridPage();
    }, { rootMargin: '300px' }).observe(sentinel);
  }
}

function renderGridPage() {
  const grid = document.getElementById('game-grid');
  if (!grid || _gridLoading) return;
  const start = _gridPage * PAGE_SIZE;
  const slice = _gridData.slice(start, start + PAGE_SIZE);
  if (!slice.length) return;
  _gridLoading = true;
  _gridPage++;
  const favs = getFavs();
  const frag = document.createDocumentFragment();

  slice.forEach(file => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => openZone(file);

    const favBtn = document.createElement('button');
    favBtn.className = `game-fav-btn${favs.includes(file.id) ? ' active' : ''}`;
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    favBtn.onclick = e => { e.stopPropagation(); toggleFav(file.id, card, favBtn); };

    // Cover area — Lumin games get a lazy-loaded thumbnail; Nebula games
    // fall back to the styled gradient placeholder.
    const coverDiv = document.createElement('div');
    coverDiv.className = 'game-card-cover';
    const bgColor = nameColor(file.name);
    coverDiv.style.cssText = `background:${bgColor};display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;position:relative;overflow:hidden;`;

    if (file.source === 'lumin' && file.image_token) {
      // Lumin thumbnail — start with placeholder, swap on intersect.
      const img = document.createElement('img');
      img.alt = file.name;
      img.loading = 'lazy';
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
      img.dataset.luminToken = file.image_token;
      // Tiny placeholder so the layout is stable until the blob URL resolves.
      img.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"/>';
      img.addEventListener('error', () => {
        // If the image fails to load, fall back to the SVG placeholder.
        img.remove();
        coverDiv.innerHTML = _placeholderCover(file);
      });
      coverDiv.appendChild(img);
      getLazyObserver().observe(img);
    } else {
      coverDiv.innerHTML = _placeholderCover(file);
    }

    // Category badge
    if (file.category && file.category !== 'Other') {
      const catBadge = document.createElement('span');
      catBadge.className = 'game-src-badge';
      const catColor = CAT_COLORS[file.category] || '#64748b';
      catBadge.style.cssText = `position:absolute;top:6px;left:6px;font-size:.55rem;font-weight:700;padding:.15rem .4rem;border-radius:4px;background:${catColor};color:#fff;z-index:2;text-transform:uppercase;letter-spacing:.5px;`;
      catBadge.textContent = file.category;
      coverDiv.appendChild(catBadge);
    }

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const name = document.createElement('div');
    name.className = 'game-card-name';
    name.textContent = file.name;
    body.appendChild(name);

    // Size info (Nebula only) or source label (Lumin)
    if (file.size) {
      const sizeEl = document.createElement('div');
      sizeEl.className = 'game-card-author';
      sizeEl.textContent = formatSize(file.size);
      sizeEl.style.cssText = 'font-size:.65rem;color:var(--text-faint);margin-top:.15rem';
      body.appendChild(sizeEl);
    }

    card.append(favBtn, coverDiv, body);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  _gridLoading = false;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function _placeholderCover(file) {
  // Pick an icon based on category
  const catIcons = {
    Shooter: '<circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    Racing: '<circle cx="12" cy="17" r="3"/><path d="M12 14V3"/><path d="M7 8l5-5 5 5"/>',
    Puzzle: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
    Platformer: '<rect x="3" y="13" width="4" height="7"/><rect x="10" y="9" width="4" height="11"/><rect x="17" y="5" width="4" height="15"/>',
    Horror: '<circle cx="12" cy="12" r="10"/><path d="M8 15c1.5 1.5 4.5 1.5 6 0"/><circle cx="9" cy="10" r="1.5" fill="currentColor"/><circle cx="15" cy="10" r="1.5" fill="currentColor"/>',
    Fighting: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/>',
    Mario: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/>',
  };
  const iconPaths = catIcons[file.category] || '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/>';

  return `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${iconPaths}</svg>
    <div style="position:absolute;bottom:8px;left:8px;right:8px;font-size:.65rem;font-weight:700;color:rgba(255,255,255,.7);text-shadow:0 1px 3px rgba(0,0,0,.5);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeText(file.name)}</div>
  `;
}

function toggleFav(id, card, btn) {
  let favs = getFavs();
  if (favs.includes(id)) { favs = favs.filter(f => f !== id); btn.classList.remove('active'); }
  else { favs.push(id); btn.classList.add('active'); }
  setFavs(favs);
  if (showFavsOnly) handleSearch();
}

// ── Open game ──
async function openZone(file) {
  if (file.source === 'lumin') {
    // Lumin returns a single-use signed URL — fetch it fresh on each launch.
    try {
      await ensureLuminLoaded();
      const result = await window.Lumin.getGameUrl(file.id);
      const url = result?.url;
      if (!url) throw new Error('Lumin returned no URL');
      // Reuse the existing Nebula game vault. Sandbox needs to allow a few
      // extra permissions for some Lumin titles (gamepad/pointer-lock) but
      // the vault iframe already inherits those from the Lumin docs example.
      window.openGameVault({ url, name: file.name, isMultiFile: true });
    } catch (e) {
      console.error('Lumin loadGame error:', e);
      // Last-ditch fallback to the built-in Lumin player.
      try { await window.Lumin.loadGame(file.id); }
      catch { alert('Failed to launch game: ' + (e.message || 'unknown error')); }
    }
    return;
  }
  // Nebula — delegate to app.js's openGameVault.
  window.openGameVault(file);
}

function setupVaultEvents() {
  document.getElementById('vault-search')?.addEventListener('input', handleSearch);
  document.getElementById('vault-sort')?.addEventListener('change', handleSearch);
  document.getElementById('fav-filter-btn')?.addEventListener('click', () => {
    showFavsOnly = !showFavsOnly;
    document.getElementById('fav-filter-btn').classList.toggle('active', showFavsOnly);
    handleSearch();
  });
}

// Tiny helper — used only inside this module for placeholder cover text and
// error messages. We don't import escHtml from app.js because games.js can
// be loaded before app.js's exports are ready in some browsers.
function escapeText(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
