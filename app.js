// Plain classic scripts (no type="module") — this is deliberate. ES module imports get
// blocked by the browser when a page is opened straight from disk (file://) or from any
// preview surface that doesn't serve it as a real HTTP origin. The Firebase "compat" build
// works as ordinary globals instead, so this app runs the same whether it's double-clicked
// locally, dropped in a sandbox preview, or deployed to GitHub Pages.
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let savedPlaceKeys = new Set(); // `${lat.toFixed(5)},${lon.toFixed(5)}` for quick star-state lookup

// No login screen: every visitor is signed in anonymously behind the scenes so their
// saved places / history / shared routes persist in Firestore, scoped to this browser.
// Clearing site data or switching browsers starts a fresh, empty "account".
auth.signInAnonymously().catch(err => console.error('Anonymous sign-in failed:', err));

// ---------------- Map setup ----------------
const map = L.map('map', { zoomControl:false }).setView([49.1579, -121.9514], 12); // Chilliwack, BC
L.control.zoom({ position:'bottomright' }).addTo(map);

const streetLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'' }).addTo(map);
const terrainLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom:17, attribution:'' });

let terrainOn = false;
document.getElementById('terrainBtn').addEventListener('click', (e)=>{
  terrainOn = !terrainOn;
  e.currentTarget.classList.toggle('active', terrainOn);
  if(terrainOn){ map.removeLayer(streetLayer); terrainLayer.addTo(map); }
  else { map.removeLayer(terrainLayer); streetLayer.addTo(map); }
});
document.getElementById('darkBtn').addEventListener('click', (e)=>{
  document.getElementById('map').classList.toggle('dark');
  e.currentTarget.classList.toggle('active');
});

function pinIcon(color){
  const svg = `<svg viewBox="0 0 34 44" xmlns="http://www.w3.org/2000/svg">
    <path d="M17 1C8.2 1 1 8.1 1 16.8 1 28.5 17 43 17 43s16-14.5 16-26.2C33 8.1 25.8 1 17 1z" fill="${color}" stroke="#16232B" stroke-width="1.6"/>
    <circle cx="17" cy="16.5" r="6.2" fill="#F7F8F5" stroke="#16232B" stroke-width="1.2"/>
  </svg>`;
  return L.divIcon({ html:`<div class="joogle-pin">${svg}</div>`, className:'', iconSize:[34,44], iconAnchor:[17,44], popupAnchor:[0,-38] });
}
const amberPin = pinIcon('#E8871E');
const trailPin = pinIcon('#2F6E4F');
let searchMarker = null;

function placeKey(lat, lon){ return `${(+lat).toFixed(5)},${(+lon).toFixed(5)}`; }

// ---------------- Search ----------------
const searchInput = document.getElementById('searchInput');
const resultsBox = document.getElementById('results');
let debounceTimer;

function starSvg(filled){
  return `<svg width="15" height="15" viewBox="0 0 24 24" fill="${filled ? '#E8871E' : 'none'}" stroke="${filled ? '#E8871E' : 'currentColor'}" stroke-width="2"><polygon points="12 2 15.1 8.6 22 9.6 17 14.6 18.2 21.5 12 18.1 5.8 21.5 7 14.6 2 9.6 8.9 8.6 12 2"/></svg>`;
}

function runSearch(q){
  if(!q || q.length < 3){ resultsBox.classList.remove('show'); resultsBox.innerHTML=''; return; }
  fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=0&limit=6&q=${encodeURIComponent(q)}`)
    .then(r=>r.json())
    .then(data=>{
      if(!data.length){ resultsBox.innerHTML = '<div class="result-item"><span class="r-info"><span class="r-name">No spots found.</span><span class="r-type">try a broader search</span></span></div>'; resultsBox.classList.add('show'); return; }
      resultsBox.innerHTML = data.map((d,i) => {
        const key = placeKey(d.lat, d.lon);
        const isSaved = savedPlaceKeys.has(key);
        return `<div class="result-item" data-idx="${i}">
          <span class="r-info">
            <span class="r-name">${d.display_name.split(',')[0]}</span>
            <span class="r-type">${(d.type||'place').replace(/_/g,' ')}</span>
          </span>
          <button class="icon-btn ${isSaved?'saved':''}" data-save-idx="${i}" title="Save place">${starSvg(isSaved)}</button>
        </div>`;
      }).join('');
      resultsBox.classList.add('show');
      resultsBox._data = data;
    })
    .catch(()=>{ resultsBox.innerHTML = '<div class="result-item"><span class="r-info"><span class="r-name">Search hiccup — try again.</span></span></div>'; resultsBox.classList.add('show'); });
}

searchInput.addEventListener('input', (e)=>{
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(()=>runSearch(e.target.value.trim()), 400);
});
document.getElementById('searchBtn').addEventListener('click', ()=>runSearch(searchInput.value.trim()));
searchInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') runSearch(searchInput.value.trim()); });

resultsBox.addEventListener('click', (e)=>{
  const saveBtn = e.target.closest('[data-save-idx]');
  const item = e.target.closest('.result-item');
  const data = resultsBox._data;
  if(!data) return;

  if(saveBtn){
    const d = data[parseInt(saveBtn.dataset.saveIdx)];
    toggleSavePlace({ name: d.display_name.split(',')[0], address: d.display_name, lat: +d.lat, lon: +d.lon }, saveBtn);
    return;
  }
  if(item && item.dataset.idx !== undefined){
    const d = data[parseInt(item.dataset.idx)];
    const lat = +d.lat, lon = +d.lon;
    if(searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat,lon], {icon:amberPin}).addTo(map)
      .bindPopup(popupHtml(d.display_name.split(',')[0], d.display_name, lat, lon)).openPopup();
    map.setView([lat,lon], 15, {animate:true});
    resultsBox.classList.remove('show');
    searchInput.value = d.display_name.split(',')[0];
    logSearchHistory({ name: d.display_name.split(',')[0], lat, lon });
  }
});

function popupHtml(name, address, lat, lon){
  const key = placeKey(lat, lon);
  const isSaved = savedPlaceKeys.has(key);
  return `<b>${name}</b><br>${address}
    <div class="popup-save"><button class="pill-btn ${isSaved?'primary':'ghost'}" data-popup-save='${JSON.stringify({name,address,lat,lon}).replace(/'/g,"&apos;")}'>${isSaved ? 'Saved ★' : 'Save this place'}</button></div>`;
}
map.on('popupopen', (e)=>{
  const btn = e.popup._contentNode.querySelector('[data-popup-save]');
  if(btn) btn.addEventListener('click', ()=>{
    const p = JSON.parse(btn.dataset.popupSave.replace(/&apos;/g,"'"));
    toggleSavePlace(p, null);
    btn.textContent = savedPlaceKeys.has(placeKey(p.lat,p.lon)) ? 'Saved ★' : 'Save this place';
    btn.className = 'pill-btn ' + (savedPlaceKeys.has(placeKey(p.lat,p.lon)) ? 'primary' : 'ghost');
  });
});

document.addEventListener('click', (e)=>{
  if(!e.target.closest('.search-wrap')) resultsBox.classList.remove('show');
});

// ---------------- Locate me ----------------
document.getElementById('locateBtn').addEventListener('click', ()=>{
  if(!navigator.geolocation){ alert("This browser won't tell Joogle Maps where you are."); return; }
  navigator.geolocation.getCurrentPosition(pos=>{
    const {latitude, longitude} = pos.coords;
    map.setView([latitude, longitude], 15, {animate:true});
    L.marker([latitude, longitude], {icon:trailPin}).addTo(map).bindPopup('<b>You are here</b><br>(probably)').openPopup();
  }, ()=> alert('Location blocked — Joogle Maps respects a firm "no".'));
});

// ---------------- Routing ----------------
let routeMode = false, routePoints = [], routeLine = null, routeMarkers = [], lastRoute = null;
const routeBtn = document.getElementById('routeBtn');
const routeCard = document.getElementById('routeCard');
const rcHint = document.getElementById('rcHint');
const rcDist = document.getElementById('rcDist');
const rcTime = document.getElementById('rcTime');
const rcActions = document.getElementById('rcActions');
const rcTitleText = document.getElementById('rcTitleText');

function resetRoute(){
  routePoints = [];
  routeMarkers.forEach(m=>map.removeLayer(m)); routeMarkers=[];
  if(routeLine){ map.removeLayer(routeLine); routeLine=null; }
  rcDist.textContent='–'; rcTime.textContent='–';
  rcHint.textContent = 'Click a start point, then an end point on the map.';
  rcActions.style.display = 'none';
  rcTitleText.textContent = 'Route plotted';
  lastRoute = null;
}

routeBtn.addEventListener('click', ()=>{
  routeMode = !routeMode;
  routeBtn.classList.toggle('active', routeMode);
  routeCard.classList.toggle('show', routeMode);
  if(routeMode) resetRoute();
});
document.getElementById('rcClose').addEventListener('click', ()=>{
  routeMode=false; routeBtn.classList.remove('active'); routeCard.classList.remove('show'); resetRoute();
});

map.on('click', (e)=>{
  if(!routeMode) return;
  if(routePoints.length >= 2) resetRoute();
  routePoints.push(e.latlng);
  const marker = L.marker(e.latlng, {icon: routePoints.length===1 ? trailPin : amberPin}).addTo(map);
  routeMarkers.push(marker);

  if(routePoints.length === 1){
    rcHint.textContent = 'Start pinned. Click your destination.';
  } else {
    rcHint.textContent = 'Calculating the trail…';
    const [a,b] = routePoints;
    fetch(`https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`)
      .then(r=>r.json())
      .then(data=>{
        if(!data.routes || !data.routes.length){ rcHint.textContent='No route found between those points.'; return; }
        const route = data.routes[0];
        const coords = route.geometry.coordinates.map(c=>[c[1],c[0]]);
        if(routeLine) map.removeLayer(routeLine);
        routeLine = L.polyline(coords, {color:'#E8871E', weight:5, opacity:0.9, className:'route-line'}).addTo(map);
        map.fitBounds(routeLine.getBounds(), {padding:[60,60]});
        rcDist.textContent = (route.distance/1000).toFixed(1) + ' km';
        const mins = Math.round(route.duration/60);
        rcTime.textContent = mins < 60 ? mins+' min' : Math.floor(mins/60)+'h '+(mins%60)+'m';
        rcHint.textContent = 'Click anywhere to plot a new route.';
        rcActions.style.display = 'flex';
        lastRoute = {
          startLat:a.lat, startLon:a.lng, endLat:b.lat, endLon:b.lng,
          distanceM: route.distance, durationS: route.duration
        };
      })
      .catch(()=>{ rcHint.textContent='Routing service is out for a walk. Try again shortly.'; });
  }
});

document.getElementById('shareBtn').addEventListener('click', async ()=>{
  if(!lastRoute) return;
  if(!currentUser){ whenReady(()=>document.getElementById('shareBtn').click()); return; }
  const shareBtn = document.getElementById('shareBtn');
  shareBtn.disabled = true; shareBtn.textContent = 'Sharing…';
  try{
    const docRef = await db.collection('routes').add({
      ownerId: currentUser.uid,
      public: true,
      ...lastRoute,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const link = `${location.origin}${location.pathname}?route=${docRef.id}`;
    await navigator.clipboard.writeText(link).catch(()=>{});
    shareBtn.textContent = 'Link copied!';
  } catch(err){
    shareBtn.textContent = 'Share failed';
  } finally {
    setTimeout(()=>{ shareBtn.disabled = false; shareBtn.textContent = 'Copy share link'; }, 2200);
  }
});

// Load a shared route from URL, if present
async function loadSharedRouteFromURL(){
  const params = new URLSearchParams(location.search);
  const routeId = params.get('route');
  if(!routeId) return;
  try{
    const snap = await db.collection('routes').doc(routeId).get();
    if(!snap.exists) return;
    const r = snap.data();
    const start = L.latLng(r.startLat, r.startLon), end = L.latLng(r.endLat, r.endLon);
    L.marker(start, {icon:trailPin}).addTo(map);
    L.marker(end, {icon:amberPin}).addTo(map);
    fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`)
      .then(res=>res.json())
      .then(data=>{
        if(!data.routes || !data.routes.length) return;
        const coords = data.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]);
        const line = L.polyline(coords, {color:'#E8871E', weight:5, opacity:0.9}).addTo(map);
        map.fitBounds(line.getBounds(), {padding:[60,60]});
      });
    rcTitleText.textContent = 'Shared route';
    rcDist.textContent = (r.distanceM/1000).toFixed(1) + ' km';
    const mins = Math.round(r.durationS/60);
    rcTime.textContent = mins < 60 ? mins+' min' : Math.floor(mins/60)+'h '+(mins%60)+'m';
    rcHint.textContent = 'Someone shared this trail with you.';
    routeCard.classList.add('show');
  } catch(err){ /* silently ignore a bad/missing route link */ }
}

// ---------------- Auth (silent/anonymous — no login screen) ----------------
auth.onAuthStateChanged((user)=>{
  currentUser = user;
  if(user){
    subscribeSavedPlaces();
    subscribeHistory();
  } else {
    savedPlaceKeys.clear();
    renderEmptyPanel('savedList', 'Star a place from search or a map pin to save it here.');
    renderEmptyPanel('historyList', 'Your last searches will show up here.');
  }
});

// A handful of actions (star, history log, share) fire before the anonymous
// sign-in round trip finishes on a cold load — queue the retry instead of
// dropping the action or showing a login prompt.
function whenReady(fn){
  if(currentUser){ fn(); return; }
  const unsub = auth.onAuthStateChanged((user)=>{ if(user){ unsub(); fn(); } });
}

// ---------------- Saved places ----------------
async function toggleSavePlace(p, btn){
  if(!currentUser){ whenReady(()=>toggleSavePlace(p, btn)); return; }
  const key = placeKey(p.lat, p.lon);
  if(savedPlaceKeys.has(key)){
    const existing = window._savedDocs?.find(d => placeKey(d.lat,d.lon) === key);
    if(existing) await db.collection('places').doc(existing.id).delete();
  } else {
    await db.collection('places').add({
      ownerId: currentUser.uid, name:p.name, address:p.address||'', lat:p.lat, lon:p.lon,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  }
  if(btn){ btn.classList.toggle('saved'); btn.innerHTML = starSvg(btn.classList.contains('saved')); }
}

function subscribeSavedPlaces(){
  db.collection('places').where('ownerId','==',currentUser.uid).orderBy('createdAt','desc')
    .onSnapshot((snap)=>{
      const items = [];
      savedPlaceKeys.clear();
      snap.forEach(d=>{ const data = {id:d.id, ...d.data()}; items.push(data); savedPlaceKeys.add(placeKey(data.lat,data.lon)); });
      window._savedDocs = items;
      renderPanelList('savedList', items, (item)=>`
        <div class="pi-info"><div class="pi-name">${item.name}</div><div class="pi-sub">${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}</div></div>
      `, (item)=>{
        if(searchMarker) map.removeLayer(searchMarker);
        searchMarker = L.marker([item.lat,item.lon], {icon:amberPin}).addTo(map).bindPopup(popupHtml(item.name, item.address, item.lat, item.lon)).openPopup();
        map.setView([item.lat,item.lon], 15, {animate:true});
        document.getElementById('savedPanel').classList.remove('open');
      }, async (item)=>{ await db.collection('places').doc(item.id).delete(); },
      'Nothing saved yet — star a place from search or a map pin.');
    });
}

// ---------------- Search history ----------------
async function logSearchHistory(entry){
  if(!currentUser){ whenReady(()=>logSearchHistory(entry)); return; }
  await db.collection('history').add({ ownerId: currentUser.uid, ...entry, timestamp: firebase.firestore.FieldValue.serverTimestamp() });
  // trim to last 20
  db.collection('history').where('ownerId','==',currentUser.uid).orderBy('timestamp','desc').limit(50)
    .onSnapshot((snap)=>{
      const docs = snap.docs;
      if(docs.length > 20){ docs.slice(20).forEach(d=> db.collection('history').doc(d.id).delete()); }
    }, ()=>{});
}

function subscribeHistory(){
  db.collection('history').where('ownerId','==',currentUser.uid).orderBy('timestamp','desc').limit(20)
    .onSnapshot((snap)=>{
      const items = []; snap.forEach(d=> items.push({id:d.id, ...d.data()}));
      renderPanelList('historyList', items, (item)=>`
        <div class="pi-info"><div class="pi-name">${item.name}</div><div class="pi-sub">${item.lat.toFixed(4)}, ${item.lon.toFixed(4)}</div></div>
      `, (item)=>{
        if(searchMarker) map.removeLayer(searchMarker);
        searchMarker = L.marker([item.lat,item.lon], {icon:amberPin}).addTo(map).bindPopup(popupHtml(item.name, '', item.lat, item.lon)).openPopup();
        map.setView([item.lat,item.lon], 15, {animate:true});
        document.getElementById('historyPanel').classList.remove('open');
      }, async (item)=>{ await db.collection('history').doc(item.id).delete(); },
      'No searches yet — look something up.');
    });
}

// ---------------- Panels ----------------
function renderEmptyPanel(id, msg){ document.getElementById(id).innerHTML = `<div class="panel-empty">${msg}</div>`; }

function renderPanelList(id, items, infoHtml, onClick, onDelete, emptyMsg){
  const el = document.getElementById(id);
  if(!items.length){ renderEmptyPanel(id, emptyMsg); return; }
  el.innerHTML = items.map((item,i)=>`
    <div class="panel-item" data-idx="${i}">
      ${infoHtml(item)}
      <button class="pi-del" data-del-idx="${i}" title="Remove">✕</button>
    </div>`).join('');
  el.querySelectorAll('.panel-item').forEach((node,i)=>{
    node.addEventListener('click', (e)=>{
      if(e.target.closest('[data-del-idx]')) return;
      onClick(items[i]);
    });
  });
  el.querySelectorAll('[data-del-idx]').forEach((btn,i)=>{
    btn.addEventListener('click', (e)=>{ e.stopPropagation(); onDelete(items[i]); });
  });
}

document.getElementById('savedBtn').addEventListener('click', ()=>{
  document.getElementById('historyPanel').classList.remove('open');
  document.getElementById('savedPanel').classList.toggle('open');
});
document.getElementById('historyBtn').addEventListener('click', ()=>{
  document.getElementById('savedPanel').classList.remove('open');
  document.getElementById('historyPanel').classList.toggle('open');
});
document.getElementById('savedPanelClose').addEventListener('click', ()=> document.getElementById('savedPanel').classList.remove('open'));
document.getElementById('historyPanelClose').addEventListener('click', ()=> document.getElementById('historyPanel').classList.remove('open'));

loadSharedRouteFromURL();
