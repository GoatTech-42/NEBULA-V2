// games.js — Game vault
//
// Loads the game list from NEBULA-CDN manifest, renders the grid with
// thumbnails, handles search/sort/favorites, and opens games in the iframe.

const CDN_BASE = "https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@main";
const MANIFEST_URL = CDN_BASE + "/manifest.json";

let zones = [];
let popularityData = {};
let showFavsOnly = false;

// Favorites are stored in a cookie so they survive across sessions.
function getFavs() {
  const c = document.cookie.split(';').find(x=>x.trim().startsWith('neb_favs='));
  if(!c) return [];
  try { return JSON.parse(decodeURIComponent(c.split('=').slice(1).join('='))); } catch { return []; }
}
function setFavs(arr) {
  document.cookie = `neb_favs=${encodeURIComponent(JSON.stringify(arr))};path=/;max-age=31536000`;
}

export async function initGames() {
  try {
    // Fetch manifest from NEBULA-CDN
    let manifestURL = MANIFEST_URL + "?t=" + Date.now();
    
    // Try to get latest commit SHA for cache busting
    try {
      const shaResp = await fetch("https://api.github.com/repos/GoatTech-42/NEBULA-CDN/commits?per_page=1&t="+Date.now());
      if(shaResp.status===200) {
        const shajson = await shaResp.json();
        const sha = shajson[0]?.sha;
        if(sha) manifestURL = `https://cdn.jsdelivr.net/gh/GoatTech-42/NEBULA-CDN@${sha}/manifest.json`;
      }
    } catch {}

    const resp = await fetch(manifestURL);
    let text = await resp.text();
    // Handle BOM in manifest
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const manifest = JSON.parse(text);
    
    // Convert NEBULA-CDN manifest format to zones format
    zones = manifest
      .filter(g => g.game && g.file && !g.game.startsWith('[!]'))
      .map((g, i) => ({
        id: i + 1,
        name: g.game,
        file: g.file,
        url: CDN_BASE + "/" + g.file,
        cover: '', // No cover images in NEBULA-CDN, we'll generate placeholders
        author: g.author || '',
        authorLink: g.authorLink || '',
        manifestKey: g.manifestKey || '',
        source: g.source || 'NEBULA-CDN'
      }));

    handleSearch();
    setupVaultEvents();
  } catch(e) {
    console.error('Games init error:', e);
    const grid = document.getElementById('game-grid');
    if(grid) grid.innerHTML=`<div class="vault-empty"><span>Failed to load games</span></div>`;
  }
}

function handleSearch() {
  const q = (document.getElementById('vault-search')?.value||'').toLowerCase();
  const sort = document.getElementById('vault-sort')?.value||'name';
  let filtered = zones.filter(z => {
    const matchSearch = z.name.toLowerCase().includes(q);
    const matchFav = showFavsOnly ? getFavs().includes(z.id) : true;
    return matchSearch && matchFav;
  });
  if(sort==='name') filtered.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='id') filtered.sort((a,b)=>b.id-a.id);
  else filtered.sort((a,b)=>a.name.localeCompare(b.name)); // default: A-Z
  renderGrid(filtered);
}

// Lazy load observer - reused across renders
let _lazyObserver = null;
function getLazyObserver() {
  if(_lazyObserver) return _lazyObserver;
  _lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if(e.isIntersecting) {
        const img = e.target;
        if(img.dataset.src) { img.src = img.dataset.src; delete img.dataset.src; }
        _lazyObserver.unobserve(img);
      }
    });
  }, { rootMargin: '200px' });
  return _lazyObserver;
}

const PAGE_SIZE = 40;
let _gridPage = 0, _gridData = [], _gridLoading = false;

// Generate a color from game name for placeholder covers
function nameColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffff;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 25%)`;
}

function renderGrid(data) {
  const grid = document.getElementById('game-grid');
  if(!grid) return;
  _gridData = data;
  _gridPage = 0;
  grid.innerHTML='';
  if(!data.length) {
    grid.innerHTML=`<div class="vault-empty" style="grid-column:1/-1"><div class="vault-empty-ico"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><span style="font-size:.85rem;font-weight:600">No games found</span></div>`;
    return;
  }
  renderGridPage();
  // Infinite scroll sentinel
  let sentinel = grid.parentElement.querySelector('.grid-sentinel');
  if(!sentinel) {
    sentinel = document.createElement('div');
    sentinel.className = 'grid-sentinel';
    grid.parentElement.appendChild(sentinel);
    new IntersectionObserver(entries => {
      if(entries[0].isIntersecting && !_gridLoading) renderGridPage();
    }, { rootMargin: '300px' }).observe(sentinel);
  }
}

function renderGridPage() {
  const grid = document.getElementById('game-grid');
  if(!grid || _gridLoading) return;
  const start = _gridPage * PAGE_SIZE;
  const slice = _gridData.slice(start, start + PAGE_SIZE);
  if(!slice.length) return;
  _gridLoading = true;
  _gridPage++;
  const favs = getFavs();
  const frag = document.createDocumentFragment();
  slice.forEach(file => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => openZone(file);
    const favBtn = document.createElement('button');
    favBtn.className = `game-fav-btn${favs.includes(file.id)?' active':''}`;
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    favBtn.onclick = e => { e.stopPropagation(); toggleFav(file.id, card, favBtn); };

    // Create a styled placeholder since NEBULA-CDN doesn't have cover images
    const coverDiv = document.createElement('div');
    coverDiv.className = 'game-card-cover';
    const bgColor = nameColor(file.name);
    coverDiv.style.cssText = `background:${bgColor};display:flex;align-items:center;justify-content:center;aspect-ratio:4/3;position:relative;overflow:hidden;`;
    
    // Add game controller icon + name overlay
    coverDiv.innerHTML = `
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 10v4"/><line x1="5" y1="12" x2="9" y2="12"/><circle cx="15" cy="11" r="1"/><circle cx="17" cy="13" r="1"/></svg>
      <div style="position:absolute;bottom:8px;left:8px;right:8px;font-size:.65rem;font-weight:700;color:rgba(255,255,255,.7);text-shadow:0 1px 3px rgba(0,0,0,.5);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${file.name}</div>
    `;

    const body = document.createElement('div');
    body.className = 'game-card-body';
    const name = document.createElement('div');
    name.className = 'game-card-name';
    name.textContent = file.name;
    if (file.author) {
      const author = document.createElement('div');
      author.className = 'game-card-author';
      author.textContent = file.author;
      author.style.cssText = 'font-size:.65rem;color:var(--text-faint);margin-top:.15rem';
      body.appendChild(name);
      body.appendChild(author);
    } else {
      body.appendChild(name);
    }
    card.append(favBtn, coverDiv, body);
    frag.appendChild(card);
  });
  grid.appendChild(frag);
  _gridLoading = false;
}

function toggleFav(id, card, btn) {
  let favs = getFavs();
  if(favs.includes(id)) { favs=favs.filter(f=>f!==id); btn.classList.remove('active'); }
  else { favs.push(id); btn.classList.add('active'); }
  setFavs(favs);
  if(showFavsOnly) handleSearch();
}

function openZone(file) {
  if(file.name.includes("SUGGEST")) { window.open("https://discord.com/invite/dKs2sUNUXd","_blank"); return; }
  // The singlefile.html approach: games are HTML files in the NEBULA-CDN repo
  const url = file.url;
  window.openGameVault(url, file.name);
}

function setupVaultEvents() {
  document.getElementById('vault-search')?.addEventListener('input', handleSearch);
  document.getElementById('vault-sort')?.addEventListener('change', handleSearch);
  document.getElementById('fav-filter-btn')?.addEventListener('click', ()=>{
    showFavsOnly = !showFavsOnly;
    document.getElementById('fav-filter-btn').classList.toggle('active', showFavsOnly);
    handleSearch();
  });
}
