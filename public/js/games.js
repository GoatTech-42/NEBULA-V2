// ═══════════════════════════════════════
//  games.js — Game vault logic
// ═══════════════════════════════════════

const zonesurls = [
  "https://cdn.jsdelivr.net/gh/gn-math/assets@main/zones.json",
  "https://cdn.jsdelivr.net/gh/gn-math/assets@latest/zones.json",
  "https://cdn.jsdelivr.net/gh/gn-math/assets@master/zones.json"
];
const coverURL = "https://cdn.jsdelivr.net/gh/gn-math/covers@main";
const htmlURL = "https://cdn.jsdelivr.net/gh/gn-math/html@main";

let zones = [];
let popularityData = {};
let featuredGames = [];
let carouselIndex = 0;
let carouselTimer;
let isTransitioning = false;
let showFavsOnly = false;

// Favorites use cookies, not localStorage
function getFavs() {
  const c = document.cookie.split(';').find(x=>x.trim().startsWith('neb_favs='));
  if(!c) return [];
  try { return JSON.parse(decodeURIComponent(c.split('=').slice(1).join('='))); } catch { return []; }
}
function setFavs(arr) {
  document.cookie = `neb_favs=${encodeURIComponent(JSON.stringify(arr))};path=/;max-age=31536000`;
}

function cleanHTML(html) {
  html = html.replace(/#sidebarad1\s*,\s*\n?#sidebarad2[\s\S]*?\.sidebar-frame\s*\{[\s\S]*?\}/g, '');
  html = html.replace(/<div\s+id=["']sidebarad[12]["'][^>]*>[\s\S]*?<\/div>\s*(<\/div>)?/g, '');
  html = html.replace(/<script>\s*\(function\(_0x[a-f0-9]+[\s\S]*?duplace\.ne[\s\S]*?<\/script>/g, '');
  html = html.replace(/<style>[^<]*#sidebarad[\s\S]*?<\/style>/g, '');
  return html;
}

export async function initGames() {
  try {
    let zonesURL = zonesurls[Math.floor(Math.random() * zonesurls.length)];
    try {
      const shaResp = await fetch("https://api.github.com/repos/gn-math/assets/commits?t="+Date.now());
      if(shaResp.status===200) {
        const shajson = await shaResp.json();
        const sha = shajson[0]?.sha;
        if(sha) zonesURL = `https://cdn.jsdelivr.net/gh/gn-math/assets@${sha}/zones.json`;
      }
    } catch {}
    const resp = await fetch(zonesURL+"?t="+Date.now());
    zones = await resp.json();
    await fetchPopularity();
    setupFeatured();
    handleSearch();
    setupVaultEvents();
  } catch(e) {
    const grid = document.getElementById('game-grid');
    if(grid) grid.innerHTML=`<div class="vault-empty"><span>Failed to load games</span></div>`;
  }
}

async function fetchPopularity() {
  try {
    const resp = await fetch("https://data.jsdelivr.com/v1/stats/packages/gh/gn-math/html@main/files?period=year");
    const data = await resp.json();
    data.forEach(file => {
      const m = file.name.match(/\/(\d+)\.html$/);
      if(m) popularityData[parseInt(m[1])] = file.hits.total;
    });
  } catch {}
}

function setupFeatured() {
  if(zones.length < 5) return;
  const now = new Date();
  const seed = now.getFullYear()+'-'+now.getMonth()+'-'+now.getDate()+(now.getHours()<12?'AM':'PM');
  let hash = 0;
  for(let c of seed) hash = seed.charCodeAt(seed.indexOf(c)) + ((hash<<5)-hash);
  const rand = () => { hash = Math.sin(hash)*10000; return hash - Math.floor(hash); };

  let pool = zones.filter(z=>!z.name.includes("SUGGEST"));
  featuredGames = [];
  for(let i=0; i<10; i++) {
    const idx = Math.floor(rand()*pool.length);
    featuredGames.push(pool.splice(idx,1)[0]);
  }
  renderFeatured();
  const fw = document.getElementById('feat-wrapper');
  if(fw) fw.classList.remove('hidden');
}

function renderFeatured() {
  const track = document.getElementById('feat-track');
  if(!track) return;
  track.innerHTML = '';
  const visible = window.innerWidth > 800 ? 5 : 2;
  const clonesBefore = featuredGames.slice(-visible);
  const clonesAfter = featuredGames.slice(0, visible);
  [...clonesBefore, ...featuredGames, ...clonesAfter].forEach(file => {
    const div = document.createElement('div');
    div.className = 'feat-item';
    div.onclick = () => openZone(file);
    const img = document.createElement('img');
    img.src = file.cover.replace('{COVER_URL}',coverURL).replace('{HTML_URL}',htmlURL);
    img.alt = file.name;
    const p = document.createElement('div');
    p.textContent = file.name;
    div.append(img, p);
    track.appendChild(div);
  });
  carouselIndex = visible;
  updateCarousel(false);
  startCarousel();
}

function updateCarousel(transition=true) {
  const track = document.getElementById('feat-track');
  if(!track) return;
  const visible = window.innerWidth > 800 ? 5 : 2;
  track.style.transition = transition ? 'transform .6s cubic-bezier(.23,1,.32,1)' : 'none';
  track.style.transform = `translateX(-${carouselIndex*(100/visible)}%)`;
}

function startCarousel() {
  clearInterval(carouselTimer);
  carouselTimer = setInterval(()=>moveCarousel(1), 4500);
}

function moveCarousel(dir) {
  if(isTransitioning) return;
  const visible = window.innerWidth>800?5:2;
  isTransitioning = true;
  carouselIndex += dir;
  updateCarousel(true);
  setTimeout(()=>{
    if(carouselIndex >= featuredGames.length+visible) { carouselIndex=visible; updateCarousel(false); }
    else if(carouselIndex <= 0) { carouselIndex=featuredGames.length; updateCarousel(false); }
    isTransitioning = false;
  }, 600);
}

function handleSearch() {
  const q = (document.getElementById('vault-search')?.value||'').toLowerCase();
  const sort = document.getElementById('vault-sort')?.value||'popular';
  let filtered = zones.filter(z => {
    const matchSearch = z.name.toLowerCase().includes(q);
    const matchFav = showFavsOnly ? getFavs().includes(z.id) : true;
    return matchSearch && matchFav;
  });
  if(sort==='name') filtered.sort((a,b)=>a.name.localeCompare(b.name));
  else if(sort==='id') filtered.sort((a,b)=>b.id-a.id);
  else filtered.sort((a,b)=>(popularityData[b.id]||0)-(popularityData[a.id]||0));
  renderGrid(filtered);
}

function renderGrid(data) {
  const grid = document.getElementById('game-grid');
  if(!grid) return;
  grid.innerHTML='';
  if(!data.length) {
    grid.innerHTML=`<div class="vault-empty" style="grid-column:1/-1"><div class="vault-empty-ico"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></div><span style="font-size:.85rem;font-weight:600">No games found</span></div>`;
    return;
  }
  const favs = getFavs();
  data.forEach(file => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.onclick = () => openZone(file);
    const favBtn = document.createElement('button');
    favBtn.className = `game-fav-btn${favs.includes(file.id)?' active':''}`;
    favBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
    favBtn.onclick = e => { e.stopPropagation(); toggleFav(file.id, card, favBtn); };
    const img = document.createElement('img');
    img.src = file.cover.replace('{COVER_URL}',coverURL).replace('{HTML_URL}',htmlURL);
    img.alt = file.name;
    const body = document.createElement('div');
    body.className = 'game-card-body';
    const name = document.createElement('div');
    name.className = 'game-card-name';
    name.textContent = file.name;
    body.appendChild(name);
    card.append(favBtn, img, body);
    grid.appendChild(card);
  });
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
  if(file.url.startsWith("http")) { window.open(file.url,"_blank"); return; }
  const url = file.url.replace('{COVER_URL}',coverURL).replace('{HTML_URL}',htmlURL);
  fetch(url+"?t="+Date.now()).then(r=>r.text()).then(html=>{
    html = cleanHTML(html);
    window.openGameVault(url, file.name);
    // Write HTML into frame
    const frame = document.getElementById('game-frame');
    frame.onload = () => {}; // Prevent reload loop
    // Use srcdoc instead of writing
    const blob = new Blob([html],{type:'text/html'});
    const blobURL = URL.createObjectURL(blob);
    frame.src = blobURL;
    frame._blobURL = blobURL;
  }).catch(e=>{ if(window.toast) window.toast('Failed to load game','error'); });
}

function setupVaultEvents() {
  document.getElementById('vault-search')?.addEventListener('input', handleSearch);
  document.getElementById('vault-sort')?.addEventListener('change', handleSearch);
  document.getElementById('fav-filter-btn')?.addEventListener('click', ()=>{
    showFavsOnly = !showFavsOnly;
    document.getElementById('fav-filter-btn').classList.toggle('active', showFavsOnly);
    handleSearch();
  });
  document.getElementById('carousel-prev')?.addEventListener('click', ()=>{
    moveCarousel(-1); clearInterval(carouselTimer);
    setTimeout(startCarousel, 4000);
  });
  document.getElementById('carousel-next')?.addEventListener('click', ()=>{
    moveCarousel(1); clearInterval(carouselTimer);
    setTimeout(startCarousel, 4000);
  });
  window.addEventListener('resize', ()=>{ if(featuredGames.length) renderFeatured(); });
}