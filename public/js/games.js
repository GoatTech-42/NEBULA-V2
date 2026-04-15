// games.js — Game vault
//
// Loads the game list from NEBULA-CDN manifest via jsDelivr, renders the grid
// with thumbnails / source tabs, handles search/sort/favorites, and opens
// games in the iframe.  Supports both single-file HTML games and multi-file
// games (like Construct 2 exports under games/goattech/).

const CDN_BASE = "https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@main";
const MANIFEST_URL = CDN_BASE + "/manifest.json";

function resolveCdnAsset(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return `${CDN_BASE}/${path.replace(/^\/+/, '')}`;
}

let allGames = [];       // full manifest after filtering
let zones = [];           // currently displayed (after source filter)
let popularityData = {};
let showFavsOnly = false;
let activeSource = 'all'; // 'all' | 'GN-MATH' | 'GoatTech Games' | 'Ultimate Game Stash'

// Source definitions for the filter tabs
const SOURCES = [
  { key: 'all',                label: 'All Games',   icon: '' },
  { key: 'GN-MATH',           label: 'GN-MATH',     icon: '' },
  { key: 'GoatTech Games',    label: 'GoatTech',     icon: '' },
  { key: 'Ultimate Game Stash', label: 'UGS',        icon: '' },
];

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
    // Fetch manifest from NEBULA-CDN via jsDelivr
    let manifestURL = MANIFEST_URL + "?t=" + Date.now();

    // Try to get latest commit SHA for cache busting
    try {
      const shaResp = await fetch("https://api.github.com/repos/GoatTech-42/NEBULA-CDN/commits?per_page=1&t=" + Date.now());
      if (shaResp.status === 200) {
        const shajson = await shaResp.json();
        const sha = shajson[0]?.sha;
        if (sha) manifestURL = `https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@${sha}/manifest.json`;
      }
    } catch { }

    const resp = await fetch(manifestURL);
    let text = await resp.text();
    // Handle BOM in manifest
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const manifest = JSON.parse(text);

    // Convert NEBULA-CDN manifest format to internal format
    allGames = manifest
      .filter(g => g.game && g.file && !g.game.startsWith('[!]'))
      .map((g, i) => ({
        id: g.manifestKey || `game-${i}`,
        name: g.game,
        file: g.file,
        url: resolveCdnAsset(g.file),
        image: resolveCdnAsset(g.image || ''),
        author: g.author || '',
        authorLink: g.authorLink || '',
        manifestKey: g.manifestKey || '',
        source: g.source || 'GN-MATH',
        // Detect multi-file games (directory-based, e.g. goattech/ovo/)
        isMultiFile: g.file.includes('/goattech/') || (g.file.split('/').length > 2),
      }));

    // Apply source filter and render
    applySourceFilter();
    setupVaultEvents();
    renderSourceTabs();
    updateSourceCounts();
  } catch (e) {
    console.error('Games init error:', e);
    const grid = document.getElementById('game-grid');
    if (grid) grid.innerHTML = `<div class="vault-empty"><span>Failed to load games</span></div>`;
  }
}

// ── Source filtering ──
function applySourceFilter() {
  if (activeSource === 'all') {
    zones = [...allGames];
  } else {
    zones = allGames.filter(g => g.source === activeSource);
  }
  handleSearch();
}

function renderSourceTabs() {
  const topbar = document.querySelector('.vault-topbar');
  if (!topbar) return;

  // Remove existing source tabs if any
  topbar.querySelector('.vault-source-tabs')?.remove();

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'vault-source-tabs';
  SOURCES.forEach(s => {
    const btn = document.createElement('button');
    btn.className = `vault-src-tab${s.key === activeSource ? ' active' : ''}`;
    btn.dataset.source = s.key;
    btn.textContent = s.label;
    const count = s.key === 'all' ? allGames.length : allGames.filter(g => g.source === s.key).length;
    const badge = document.createElement('span');
    badge.className = 'vault-src-count';
    badge.textContent = count.toLocaleString();
    btn.appendChild(badge);
    btn.addEventListener('click', () => {
      activeSource = s.key;
      tabsWrap.querySelectorAll('.vault-src-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applySourceFilter();
    });
    tabsWrap.appendChild(btn);
  });

  topbar.appendChild(tabsWrap);
}

function updateSourceCounts() {
  document.querySelectorAll('.vault-src-tab').forEach(btn => {
    const key = btn.dataset.source;
    const count = key === 'all' ? allGames.length : allGames.filter(g => g.source === key).length;
    const badge = btn.querySelector('.vault-src-count');
    if (badge) badge.textContent = count.toLocaleString();
  });
}

// ── Search / Sort / Filter ──
function handleSearch() {
  const q = (document.getElementById('vault-search')?.value || '').toLowerCase();
  const sort = document.getElementById('vault-sort')?.value || 'name';
  let filtered = zones.filter(z => {
    const matchSearch = z.name.toLowerCase().includes(q) || (z.author && z.author.toLowerCase().includes(q));
    const matchFav = showFavsOnly ? getFavs().includes(z.id) : true;
    return matchSearch && matchFav;
  });
  if (sort === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'id') filtered.sort((a, b) => b.id.localeCompare?.(a.id) || 0); // newest
  else filtered.sort((a, b) => a.name.localeCompare(b.name)); // default: A-Z
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
const PAGE_SIZE = 40;
let _gridPage = 0, _gridData = [], _gridLoading = false;

// Generate a color from game name for placeholder covers
function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 25%)`;
}

// Source badge color
function sourceColor(source) {
  switch (source) {
    case 'GN-MATH': return '#3b82f6';
    case 'GoatTech Games': return '#f59e0b';
    case 'Ultimate Game Stash': return '#8b5cf6';
    default: return 'var(--text-faint)';
  }
}

function sourceLabel(source) {
  switch (source) {
    case 'GN-MATH': return 'GN';
    case 'GoatTech Games': return 'GT';
    case 'Ultimate Game Stash': return 'UGS';
    default: return '';
  }
}

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
  const observer = getLazyObserver();
  const frag = document.createDocumentFragment();

  slice.forEach(file => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => openZone(file);

    const favBtn = document.createElement('button');
    favBtn.className = `game-fav-btn${favs.includes(file.id) ? ' active' : ''}`;
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    favBtn.onclick = e => { e.stopPropagation(); toggleFav(file.id, card, favBtn); };

    // Cover area — use manifest image if available, else generate placeholder
    const coverDiv = document.createElement('div');
    coverDiv.className = 'game-card-cover';

    if (file.image) {
      // Use the real thumbnail from the manifest
      const bgColor = nameColor(file.name);
      coverDiv.style.cssText = `background:${bgColor};position:relative;overflow:hidden;aspect-ratio:4/3;`;
      const img = document.createElement('img');
      img.className = 'game-card-img';
      img.alt = file.name;
      img.loading = 'lazy';
      img.dataset.src = file.image;
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
      img.onerror = function () {
        // Fallback to placeholder on image load error
        this.style.display = 'none';
        coverDiv.innerHTML = _placeholderCover(file);
      };
      observer.observe(img);
      coverDiv.appendChild(img);
    } else {
      // Styled placeholder with gradient + icon
      const bgColor = nameColor(file.name);
      coverDiv.style.cssText = `background:${bgColor};display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;position:relative;overflow:hidden;`;
      coverDiv.innerHTML = _placeholderCover(file);
    }

    // Source badge (when viewing "All Games")
    if (activeSource === 'all' && file.source) {
      const srcBadge = document.createElement('span');
      srcBadge.className = 'game-src-badge';
      srcBadge.style.cssText = `position:absolute;top:6px;right:6px;font-size:.55rem;font-weight:700;padding:.15rem .4rem;border-radius:4px;background:${sourceColor(file.source)};color:#fff;z-index:2;text-transform:uppercase;letter-spacing:.5px;`;
      srcBadge.textContent = sourceLabel(file.source);
      coverDiv.appendChild(srcBadge);
    }

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const name = document.createElement('div');
    name.className = 'game-card-name';
    name.textContent = file.name;
    body.appendChild(name);
    if (file.author) {
      const author = document.createElement('div');
      author.className = 'game-card-author';
      author.textContent = file.author;
      author.style.cssText = 'font-size:.65rem;color:var(--text-faint);margin-top:.15rem';
      body.appendChild(author);
    }
    card.append(favBtn, coverDiv, body);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  _gridLoading = false;
}

function _placeholderCover(file) {
  return `
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>
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
  if (file.name.includes("SUGGEST")) { window.open("https://discord.com/invite/dKs2sUNUXd", "_blank"); return; }
  // Delegate to app.js openGameVault which handles single-file and multi-file games
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
