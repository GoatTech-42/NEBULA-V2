// games.js — Game vault
//
// Loads the game list from NEBULA-CDN games.json via jsDelivr, renders the grid
// with category filtering, search/sort/favorites, and opens games in the iframe.

const CDN_BASE = "https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@main";
const CATALOG_URL = CDN_BASE + "/games.json";

let allGames = [];       // full catalog after parsing
let zones = [];           // currently displayed (after category filter)
let showFavsOnly = false;
let activeCategory = 'all';
let _categories = [];     // populated from games.json

// ── Favorites (cookie-persisted) ──
function getFavs() {
  const c = document.cookie.split(';').find(x => x.trim().startsWith('neb_favs='));
  if (!c) return [];
  try { return JSON.parse(decodeURIComponent(c.split('=').slice(1).join('='))); } catch { return []; }
}
function setFavs(arr) {
  document.cookie = `neb_favs=${encodeURIComponent(JSON.stringify(arr))};path=/;max-age=31536000`;
}

// ── Init ──
export async function initGames() {
  try {
    // Fetch games.json from NEBULA-CDN via jsDelivr
    let catalogURL = CATALOG_URL;

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
    // Handle BOM
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const catalog = JSON.parse(text);

    // Extract categories from catalog
    _categories = catalog.categories || [];

    // Convert NEBULA-CDN games.json format to internal format
    // Each game: { id, name, slug, file, filename, category, tags, description, size }
    allGames = (catalog.games || []).map(g => ({
      id: g.id || g.slug,
      name: g.name || g.slug,
      slug: g.slug,
      file: g.file,
      url: `${CDN_BASE}/${g.file}`,
      category: g.category || 'Other',
      tags: g.tags || [],
      description: g.description || '',
      size: g.size || 0,
      image: '', // games.json doesn't have images — we generate placeholders
    }));

    // Apply category filter and render
    applyCategoryFilter();
    setupVaultEvents();
    renderCategoryTabs();
  } catch (e) {
    console.error('Games init error:', e);
    const grid = document.getElementById('game-grid');
    if (grid) grid.innerHTML = `<div class="vault-empty"><span>Failed to load games — ${e.message}</span></div>`;
  }
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
      || z.slug.toLowerCase().includes(q)
      || (z.tags && z.tags.some(t => t.toLowerCase().includes(q)))
      || (z.category && z.category.toLowerCase().includes(q));
    const matchFav = showFavsOnly ? getFavs().includes(z.id) : true;
    return matchSearch && matchFav;
  });
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'id') filtered.sort((a, b) => b.slug.localeCompare(a.slug));
  else if (sort === 'popular') filtered.sort((a, b) => (b.size || 0) - (a.size || 0)); // largest as proxy for popular
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

    // Cover area — styled placeholder with gradient + icon
    const coverDiv = document.createElement('div');
    coverDiv.className = 'game-card-cover';
    const bgColor = nameColor(file.name);
    coverDiv.style.cssText = `background:${bgColor};display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;position:relative;overflow:hidden;`;
    coverDiv.innerHTML = _placeholderCover(file);

    // Category badge
    if (file.category && file.category !== 'Other') {
      const catBadge = document.createElement('span');
      catBadge.className = 'game-src-badge';
      const catColor = CAT_COLORS[file.category] || '#64748b';
      catBadge.style.cssText = `position:absolute;top:6px;right:6px;font-size:.55rem;font-weight:700;padding:.15rem .4rem;border-radius:4px;background:${catColor};color:#fff;z-index:2;text-transform:uppercase;letter-spacing:.5px;`;
      catBadge.textContent = file.category;
      coverDiv.appendChild(catBadge);
    }

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const name = document.createElement('div');
    name.className = 'game-card-name';
    name.textContent = file.name;
    body.appendChild(name);

    // Size info
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
    <div style="position:absolute;bottom:8px;left:8px;right:8px;font-size:.65rem;font-weight:700;color:rgba(255,255,255,.7);text-shadow:0 1px 3px rgba(0,0,0,.5);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</div>
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
function openZone(file) {
  // Delegate to app.js openGameVault
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
