/* ============================================================
   Rapidity Homes — Move-In / Move-Out Inspection Report
   ============================================================
   CONTENTS (search these headers to jump around):
   - CONFIG & ICONS       constants: email target, inline SVGs
   - DATA MODEL           state object, freshRoom/freshItem/freshTenant/freshKV
   - INIT & RENDER        init(), render(), renderTenants(), renderKV(), renderThumbs()
   - EVENT HANDLERS       delegated 'input'/'change'/'click' listeners on document
   - PHOTO CAPTURE        camera input + downscaling
   - SIGNATURE PAD        canvas drawing + resize-safe logic
   - PAYLOAD / DRAFTS     buildPayload(), restoreFromPayload(), autosave to localStorage
   - PDF GENERATION       renderPrintHTML(), buildPdfBlob() (html2canvas + jsPDF)
   - SEND TO PM           submitWithAttachments() — real multipart POST to FormSubmit
   ============================================================ */

const LANDLORD_EMAIL = "info@rapidityhomes.com";
const CAMERA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8a2 2 0 012-2h1.5l1-1.5h7l1 1.5H18a2 2 0 012 2v10a2 2 0 01-2 2H6a2 2 0 01-2-2V8z"/><circle cx="12" cy="13" r="3.2"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const FLAG_SVG = '<svg viewBox="0 0 24 24" fill="#0d1112"><path d="M5 2.5v19h1.6v-6.8h11.2c.6 0 .9-.7.5-1.1l-2.7-3.1 2.7-3.1c.4-.4.1-1.1-.5-1.1H6.6V2.5H5z"/></svg>';

const DEFAULT_ROOMS = [
  { name:"Kitchen", items:["Walls & Ceiling","Floor","Windows & Screens","Light Fixtures & Outlets","Cabinets & Hardware","Range / Oven","Refrigerator","Sink & Disposal"] },
  { name:"Living Room", items:["Walls & Ceiling","Floor & Carpet","Windows & Screens","Doors","Light Fixtures & Outlets"] },
  { name:"Bedroom 1", items:["Walls & Ceiling","Floor & Carpet","Windows & Screens","Doors","Closet","Light Fixtures & Outlets"] },
  { name:"Bathroom 1", items:["Walls & Ceiling","Floor","Tub / Shower","Toilet","Sink / Vanity","Light Fixtures & Fan"] },
];

let state = { mode:"Move-In", rooms:[], photos:{}, tenants:[], keys:[], otherItems:[] };
let roomIdSeq = 0, itemIdSeq = 0, tenantIdSeq = 0, kvIdSeq = 0;
const DRAFT_KEY = 'rapidity_inspection_draft';

function freshRoom(tpl){ roomIdSeq++; return { id:"room"+roomIdSeq, name: tpl.name, items: tpl.items.map(l=>freshItem(l)) }; }
function freshItem(label){ itemIdSeq++; return { id:"item"+itemIdSeq, name:label, status:"unreviewed", notes:"" }; }
function itemStatus(item){
  if(item.status) return item.status;
  return item.ok === false ? 'flag' : 'ok'; // backwards-compat with older saved data
}
function freshTenant(name){ tenantIdSeq++; return { id:"tenant"+tenantIdSeq, name: name || "" }; }
function freshKV(name){ kvIdSeq++; return { id:"kv"+kvIdSeq, name: name || "", count:"" }; }

function init(){
  setupSignaturePad(document.getElementById('sigTenant'));
  setupSignaturePad(document.getElementById('sigLandlord'));
  const restored = tryLoadDraft();
  if(!restored){
    state.rooms = DEFAULT_ROOMS.map(freshRoom);
    state.tenants = [freshTenant('')];
    state.keys = ['Front Door','Mail Box','Laundry Room','Storage Room'].map(freshKV);
    state.otherItems = ['Pool Pass','Garage Opener'].map(freshKV);
    render();
    renderTenants();
    renderKV();
  }
  const tenantDateField = document.getElementById('tenantDate');
  if(!tenantDateField.value){
    const now = new Date();
    tenantDateField.value = now.toISOString().slice(0,10);
  }
}

function render(){
  const c = document.getElementById('roomsContainer');
  c.innerHTML = '';
  state.rooms.forEach(room=>{
    const div = document.createElement('div');
    div.className = 'room';
    div.innerHTML = `
      <div class="room-head">
        <input type="text" value="${escapeAttr(room.name)}" data-room="${room.id}" data-field="name">
        <button class="icon-btn" data-action="delroom" data-room="${room.id}">${X_SVG}<span class="icon-label">Remove</span></button>
      </div>
      <div class="items"></div>
      <button class="add-link" data-action="additem" data-room="${room.id}">+ Add item</button>
    `;
    const itemsWrap = div.querySelector('.items');
    room.items.forEach(item=>{
      const row = document.createElement('div');
      row.className = 'item';
      row.innerHTML = `
        <div class="item-row">
          <button class="state-circle state-${itemStatus(item)==='unreviewed' ? '' : itemStatus(item)}" data-action="cyclestatus" data-room="${room.id}" data-item="${item.id}" title="${itemStatus(item)==='ok' ? 'OK' : itemStatus(item)==='flag' ? 'Flag' : 'Not reviewed — tap to mark'}" aria-label="Status for ${escapeAttr(item.name)}: ${itemStatus(item)==='ok' ? 'OK' : itemStatus(item)==='flag' ? 'Flag' : 'Not reviewed'}. Tap to change.">${itemStatus(item)==='flag' ? FLAG_SVG : ''}</button>
          <input class="item-name" type="text" value="${escapeAttr(item.name)}" data-room="${room.id}" data-item="${item.id}" data-field="name">
        </div>
        <div class="note-row">
          <input class="item-note" type="text" placeholder="Add note" value="${escapeAttr(item.notes)}" data-room="${room.id}" data-item="${item.id}" data-field="notes">
          <button class="icon-btn" data-action="photo" data-item="${item.id}">${CAMERA_SVG}<span class="icon-label">Photo</span></button>
        </div>
        <div class="thumbs" data-item="${item.id}"></div>
      `;
      itemsWrap.appendChild(row);
      renderThumbs(row.querySelector('.thumbs'), item.id);
    });
    c.appendChild(div);
  });
  document.getElementById('dateLabel').textContent = state.mode === 'Move-In' ? 'Date of Occupancy' : 'Date of Vacating';
  document.getElementById('segMoveIn').classList.toggle('active', state.mode === 'Move-In');
  document.getElementById('segMoveOut').classList.toggle('active', state.mode === 'Move-Out');
}

function renderKV(){
  const keysC = document.getElementById('keysContainer');
  keysC.innerHTML = '';
  state.keys.forEach(k=>{
    keysC.innerHTML += `
      <div class="kv-row">
        <input class="kv-name" type="text" value="${escapeAttr(k.name)}" data-kv="${k.id}" data-kvfield="name" data-kvgroup="keys">
        <span class="kv-count-label"># received</span>
        <input class="kv-count" type="number" min="0" inputmode="numeric" value="${escapeAttr(k.count)}" data-kv="${k.id}" data-kvfield="count" data-kvgroup="keys">
      </div>
    `;
  });
  const otherC = document.getElementById('otherItemsContainer');
  otherC.innerHTML = '';
  state.otherItems.forEach(k=>{
    otherC.innerHTML += `
      <div class="kv-row">
        <input class="kv-name" type="text" value="${escapeAttr(k.name)}" data-kv="${k.id}" data-kvfield="name" data-kvgroup="otherItems">
        <span class="kv-count-label"># received</span>
        <input class="kv-count" type="number" min="0" inputmode="numeric" value="${escapeAttr(k.count)}" data-kv="${k.id}" data-kvfield="count" data-kvgroup="otherItems">
      </div>
    `;
  });
}
function renderTenants(){
  const c = document.getElementById('tenantsContainer');
  c.innerHTML = '';
  state.tenants.forEach(t=>{
    const row = document.createElement('div');
    row.className = 'tenant-row';
    row.innerHTML = `
      <input type="text" placeholder="Tenant name" value="${escapeAttr(t.name)}" data-tenant="${t.id}">
      ${state.tenants.length > 1 ? `<button class="icon-btn" data-action="removetenant" data-tenant="${t.id}">${X_SVG}</button>` : ''}
    `;
    c.appendChild(row);
  });
}
function renderThumbs(container, itemId){
  container.innerHTML = '';
  (state.photos[itemId]||[]).forEach((src, idx)=>{
    const t = document.createElement('div');
    t.className = 'thumb';
    t.innerHTML = `<img src="${src}"><button class="rm" data-action="rmphoto" data-item="${itemId}" data-idx="${idx}">×</button>`;
    container.appendChild(t);
  });
}

function escapeAttr(s){ return (s||'').replace(/"/g,'&quot;'); }

document.addEventListener('input', e=>{
  const t = e.target;
  if(t.dataset.tenant){
    const tenant = state.tenants.find(x=>x.id===t.dataset.tenant);
    if(tenant) tenant.name = t.value;
    scheduleSave();
    return;
  }
  if(t.dataset.kv){
    const list = state[t.dataset.kvgroup];
    const row = list && list.find(x=>x.id===t.dataset.kv);
    if(row) row[t.dataset.kvfield] = t.value;
    scheduleSave();
    return;
  }
  const roomId = t.dataset.room, itemId = t.dataset.item, field = t.dataset.field;
  if(roomId && field){
    const room = state.rooms.find(r=>r.id===roomId);
    if(room){
      if(itemId){
        const item = room.items.find(i=>i.id===itemId);
        if(item){ item[field] = t.value; }
      } else if(field==='name') room.name = t.value;
    }
  }
  scheduleSave();
});

document.addEventListener('change', e=>{
  if(e.target.name === 'mold') document.getElementById('moldRow').classList.toggle('show-loc', e.target.value === 'yes');
  if(e.target.name === 'paint') document.getElementById('paintRow').classList.toggle('show-loc', e.target.value === 'yes');
  scheduleSave();
});

document.addEventListener('click', e=>{
  const btn = e.target.closest('button');
  if(!btn) return;
  const action = btn.dataset.action;

  if(btn.id === 'btnAddTenant'){
    state.tenants.push(freshTenant(''));
    renderTenants(); scheduleSave();
  }
  else if(action === 'removetenant'){
    state.tenants = state.tenants.filter(x=>x.id!==btn.dataset.tenant);
    renderTenants(); scheduleSave();
  }
  else if(action === 'addkey'){
    state.keys.push(freshKV(''));
    renderKV(); scheduleSave();
  }
  else if(action === 'addotheritem'){
    state.otherItems.push(freshKV(''));
    renderKV(); scheduleSave();
  }
  else if(btn.id === 'btnAddRoom' || btn.id === 'btnAddRoomTop'){
    state.rooms.push(freshRoom({name:"New Room", items:["Walls & Ceiling","Floor","Windows & Screens","Doors","Light Fixtures & Outlets"]}));
    render(); scheduleSave();
    const rooms = document.querySelectorAll('.room');
    if(rooms.length) rooms[rooms.length-1].scrollIntoView({behavior:'smooth', block:'start'});
  }
  else if(btn.id === 'segMoveIn'){ state.mode = 'Move-In'; render(); scheduleSave(); }
  else if(btn.id === 'segMoveOut'){ state.mode = 'Move-Out'; render(); scheduleSave(); }
  else if(btn.id === 'toggleLandlord'){
    const sec = document.getElementById('landlordSection');
    const show = sec.style.display === 'none';
    sec.style.display = show ? 'block' : 'none';
    btn.textContent = show ? '– Hide Property Manager sign-off' : 'Property Manager: open sign-off — in-person walkthrough only';
    if(show){
      requestAnimationFrame(()=>{
        const c = document.getElementById('sigLandlord');
        if(c && c._resize) c._resize();
        sec.scrollIntoView({ behavior:'smooth', block:'start' });
      });
    }
  }
  else if(action === 'delroom'){
    if(confirm('Remove this room?')){ state.rooms = state.rooms.filter(r=>r.id!==btn.dataset.room); render(); scheduleSave(); }
  }
  else if(action === 'additem'){
    const room = state.rooms.find(r=>r.id===btn.dataset.room);
    room.items.push(freshItem('New Item')); render(); scheduleSave();
  }
  else if(action === 'cyclestatus'){
    const room = state.rooms.find(r=>r.id===btn.dataset.room);
    const item = room && room.items.find(i=>i.id===btn.dataset.item);
    if(item){
      const current = itemStatus(item);
      item.status = current === 'unreviewed' ? 'ok' : current === 'ok' ? 'flag' : 'unreviewed';
      delete item.ok; // fully migrate off the old boolean field once touched
      render(); scheduleSave();
    }
  }
  else if(action === 'photo'){ openPhotoPicker(btn.dataset.item); }
  else if(action === 'rmphoto'){
    const arr = state.photos[btn.dataset.item] || [];
    arr.splice(Number(btn.dataset.idx),1);
    state.photos[btn.dataset.item] = arr;
    renderThumbs(btn.closest('.thumbs'), btn.dataset.item);
    scheduleSave();
  }
  else if(btn.dataset.clear){ clearSig(document.getElementById(btn.dataset.clear)); scheduleSave(); }
});

let pendingItemId = null;
const fileInput = document.createElement('input');
fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.capture = 'environment';
fileInput.style.display = 'none';
document.body.appendChild(fileInput);
function openPhotoPicker(itemId){ pendingItemId = itemId; fileInput.value=''; fileInput.click(); }
fileInput.addEventListener('change', ()=>{
  const file = fileInput.files[0];
  if(!file || !pendingItemId) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      const maxW = 900;
      const scale = Math.min(1, maxW/img.width);
      canvas.width = img.width*scale; canvas.height = img.height*scale;
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      if(!state.photos[pendingItemId]) state.photos[pendingItemId] = [];
      state.photos[pendingItemId].push(dataUrl);
      const thumbsEl = document.querySelector(`.thumbs[data-item="${pendingItemId}"]`);
      if(thumbsEl) renderThumbs(thumbsEl, pendingItemId);
      scheduleSave();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

function setupSignaturePad(canvas){
  function resize(){
    const rect = canvas.getBoundingClientRect();
    if(rect.width === 0 || rect.height === 0) return; // hidden (e.g. PM section not yet opened) — skip
    const ratio = window.devicePixelRatio || 1;
    const newWidth = Math.round(rect.width*ratio), newHeight = Math.round(rect.height*ratio);
    if(canvas.width === newWidth && canvas.height === newHeight) return; // no real change — mobile browsers
    // fire spurious resize events on scroll (address bar collapsing), and resizing a canvas
    // always wipes it, so skipping no-ops is what stops the signature from vanishing.
    const hadContent = canvas.width > 0 && canvas.height > 0;
    const preserved = hadContent ? canvas.toDataURL() : null;
    canvas.width = newWidth; canvas.height = newHeight;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 1.8; ctx.lineCap='round'; ctx.strokeStyle = '#e8eaea';
    if(preserved){
      const img = new Image();
      img.onload = ()=> ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = preserved;
    }
  }
  resize();
  canvas._resize = resize;
  window.addEventListener('resize', resize);
  let drawing = false, last = null;
  function pos(e){
    const rect = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return { x: p.clientX-rect.left, y: p.clientY-rect.top };
  }
  function start(e){ drawing = true; last = pos(e); e.preventDefault(); }
  function move(e){
    if(!drawing) return;
    const ctx = canvas.getContext('2d');
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke();
    last = p; e.preventDefault();
  }
  function end(){ if(drawing){ drawing=false; scheduleSave(); } }
  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, {passive:false});
  canvas.addEventListener('touchmove', move, {passive:false});
  canvas.addEventListener('touchend', end);
}
function clearSig(canvas){ canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height); }

/* ---------- Shared payload builder ---------- */
function buildPayload(){
  return {
    address: document.getElementById('fAddress').value,
    tenant: state.tenants.map(t=>t.name).filter(Boolean).join(', '),
    email: document.getElementById('fEmail').value,
    phone: document.getElementById('fPhone').value,
    landlord: document.getElementById('fLandlord').value,
    date: document.getElementById('fDate').value,
    mode: state.mode,
    mold: document.querySelector('input[name=mold]:checked').value,
    moldLoc: document.getElementById('fMoldLoc').value,
    paint: document.querySelector('input[name=paint]:checked').value,
    paintLoc: document.getElementById('fPaintLoc').value,
    tenantName: document.getElementById('tenantName').value,
    tenantDate: document.getElementById('tenantDate').value,
    landlordName: document.getElementById('landlordName').value,
    landlordDate: document.getElementById('landlordDate').value,
    sigTenant: document.getElementById('sigTenant').toDataURL(),
    sigLandlord: document.getElementById('sigLandlord').toDataURL(),
    state: state
  };
}
function restoreFromPayload(data){
  document.getElementById('fAddress').value = data.address||'';
  document.getElementById('fEmail').value = data.email||'';
  document.getElementById('fPhone').value = data.phone||'';
  document.getElementById('fLandlord').value = data.landlord||'';
  document.getElementById('fDate').value = data.date||'';
  document.querySelector(`input[name=mold][value="${data.mold||'no'}"]`).checked = true;
  document.getElementById('moldRow').classList.toggle('show-loc', data.mold === 'yes');
  document.getElementById('fMoldLoc').value = data.moldLoc||'';
  document.querySelector(`input[name=paint][value="${data.paint||'no'}"]`).checked = true;
  document.getElementById('paintRow').classList.toggle('show-loc', data.paint === 'yes');
  document.getElementById('fPaintLoc').value = data.paintLoc||'';
  document.getElementById('tenantName').value = data.tenantName||'';
  document.getElementById('tenantDate').value = data.tenantDate||'';
  document.getElementById('landlordName').value = data.landlordName||'';
  document.getElementById('landlordDate').value = data.landlordDate||'';
  state = data.state || state;
  if(!state.tenants || !state.tenants.length){
    // backwards-compat with older saved data that only had a single `tenant` string
    state.tenants = data.tenant ? [freshTenant(data.tenant)] : [freshTenant('')];
  }
  if(!state.keys) state.keys = ['Front Door','Mail Box','Laundry Room','Storage Room'].map(freshKV);
  if(!state.otherItems) state.otherItems = ['Pool Pass','Garage Opener'].map(freshKV);
  roomIdSeq = 9999; itemIdSeq = 9999; tenantIdSeq = 9999; kvIdSeq = 9999;
  render();
  renderTenants();
  renderKV();
  loadSigImage(document.getElementById('sigTenant'), data.sigTenant);
  loadSigImage(document.getElementById('sigLandlord'), data.sigLandlord);
}
function loadSigImage(canvas, dataUrl){
  if(!dataUrl) return;
  const img = new Image();
  img.onload = ()=>{ canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height); };
  img.src = dataUrl;
}

/* ---------- Autosave (local draft) ---------- */
let saveTimer;
function scheduleSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 700); }
function saveDraft(){
  try{
    localStorage.setItem(DRAFT_KEY, JSON.stringify(buildPayload()));
    const el = document.getElementById('saveStatus');
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(()=> el.classList.remove('show'), 1600);
  }catch(e){ /* storage unavailable — silently skip */ }
}
function tryLoadDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if(!raw) return false;
    restoreFromPayload(JSON.parse(raw));
    return true;
  }catch(e){ return false; }
}

/* ---------- Manual backup export / import ---------- */
document.getElementById('btnExport').addEventListener('click', ()=>{
  const data = buildPayload();
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const addr = (data.address||'inspection').replace(/[^a-z0-9]+/gi,'_').toLowerCase();
  a.href = url; a.download = `${addr}_${data.mode||'move'}.json`;
  a.click();
});
document.getElementById('btnImportTrigger').addEventListener('click', ()=> document.getElementById('btnImport').click());
document.getElementById('btnClearDraft').addEventListener('click', ()=>{
  if(confirm('Clear the saved draft on this device and start a fresh form?')){
    try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
    location.reload();
  }
});
document.getElementById('btnDebugPdf').addEventListener('click', async ()=>{
  const btn = document.getElementById('btnDebugPdf');
  const original = btn.textContent;
  btn.textContent = 'Generating…';
  try{
    const blob = await buildPdfBlob();
    console.log('Debug PDF size (bytes):', blob.size);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'debug_generated_report.pdf';
    a.click();
  }catch(err){
    console.error('Debug PDF generation failed:', err);
    alert('PDF generation failed — check the console for details.');
  } finally {
    btn.textContent = original;
  }
});
document.getElementById('btnImport').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{ restoreFromPayload(JSON.parse(reader.result)); saveDraft(); };
  reader.readAsText(file);
});
document.getElementById('btnPrint').addEventListener('click', ()=> window.print());

/* ---------- Build an actual rendered PDF (photos, notes, signature included) ---------- */
function photosRowHTML(itemId){
  const photos = state.photos[itemId] || [];
  if(!photos.length) return '';
  const imgs = photos.map(src => `<img src="${src}" style="width:200px;height:150px;object-fit:cover;border-radius:6px;margin:8px 10px 4px 0;border:1px solid #ddd;">`).join('');
  return `<div style="display:flex; flex-wrap:wrap;">${imgs}</div>`;
}
function renderPrintHTML(data, logoDataUrl){
  const logoHTML = logoDataUrl
    ? `<img src="${logoDataUrl}" style="height:36px; filter:invert(1) grayscale(1) brightness(.25);">`
    : `<div style="font-family:Arial,Helvetica,sans-serif; font-size:20px; font-weight:bold; letter-spacing:2px; color:#111;">RAPIDITY HOMES</div>`;
  const roomsHTML = data.state.rooms.map(room => `
    <div style="margin-bottom:16px; page-break-inside:avoid;">
      <div style="font-size:15px; font-weight:bold; border-bottom:1px solid #999; padding:0 0 5px; margin-bottom:6px;">${room.name}</div>
      ${room.items.map(item => `
        <div style="font-size:11.5px; padding:5px 0; border-bottom:1px solid #eee; page-break-inside:avoid;">
          <span style="font-weight:bold; color:${itemStatus(item)==='ok' ? '#3a8a5a' : itemStatus(item)==='flag' ? '#b3402f' : '#888'};">${itemStatus(item)==='ok' ? 'OK' : itemStatus(item)==='flag' ? 'Needs attention' : 'Not reviewed'}</span>
          &nbsp;— ${item.name}
          ${item.notes ? `<div style="color:#555; margin-top:2px;">${item.notes}</div>` : ''}
          ${photosRowHTML(item.id)}
        </div>
      `).join('')}
    </div>
  `).join('');
  return `
    <div style="text-align:center; margin-bottom:22px;">
      ${logoHTML}
      <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#555; margin-top:8px;">Move-In / Move-Out Inspection</div>
    </div>
    <table style="width:100%; font-size:12px; margin-bottom:22px; border-collapse:collapse;">
      <tr><td style="padding:3px 0;"><b>Address:</b> ${data.address || '—'}</td><td style="padding:3px 0;"><b>Tenant:</b> ${data.tenant || '—'}</td></tr>
      <tr><td style="padding:3px 0;"><b>Email:</b> ${data.email || '—'}</td><td style="padding:3px 0;"><b>Phone:</b> ${data.phone || '—'}</td></tr>
      <tr><td style="padding:3px 0;"><b>${data.mode === 'Move-In' ? 'Date of Occupancy' : 'Date of Vacating'}:</b> ${data.date || '—'}</td><td style="padding:3px 0;"><b>Agent:</b> ${data.landlord || '—'}</td></tr>
      <tr><td style="padding:3px 0;" colspan="2"><b>Report Type:</b> ${data.mode}</td></tr>
    </table>
    ${roomsHTML}
    <div style="font-size:12px; margin:18px 0; page-break-inside:avoid;">
      <div style="font-weight:bold; margin-bottom:6px;">Keys Received</div>
      ${data.state.keys.filter(k=>k.name).map(k=>`<div>${k.name}: ${k.count || '0'}</div>`).join('') || '<div>—</div>'}
      <div style="font-weight:bold; margin:10px 0 6px;">Other Items Received</div>
      ${data.state.otherItems.filter(k=>k.name).map(k=>`<div>${k.name}: ${k.count || '0'}</div>`).join('') || '<div>—</div>'}
    </div>
    <div style="font-size:12px; margin:18px 0; page-break-inside:avoid;">
      <div><b>Visible mold:</b> ${data.mold === 'yes' ? 'Yes — ' + (data.moldLoc || '') : 'No'}</div>
      <div><b>Disturbed paint:</b> ${data.paint === 'yes' ? 'Yes — ' + (data.paintLoc || '') : 'No'}</div>
    </div>
    <div style="margin-top:26px; page-break-inside:avoid;">
      <div style="font-size:11px; color:#666; margin-bottom:4px;">Tenant Signature</div>
      <img src="${data.sigTenant}" style="height:55px; border-bottom:1px solid #999; display:block;">
      <div style="font-size:11.5px; margin-top:6px;">${data.tenantName || '—'} &nbsp;·&nbsp; ${data.tenantDate || '—'}</div>
    </div>
    <div style="margin-top:26px; page-break-inside:avoid;">
      <div style="font-size:11px; color:#666; margin-bottom:4px;">Property Manager Signature</div>
      <div style="height:55px; border-bottom:1px solid #999;"></div>
      <div style="font-size:11.5px; margin-top:6px;">&nbsp;</div>
    </div>
  `;
}
function recolorSignature(dataUrl, hex){
  return new Promise((resolve)=>{
    if(!dataUrl){ resolve(dataUrl); return; }
    const img = new Image();
    const fallback = ()=> resolve(dataUrl);
    img.onerror = fallback;
    img.onload = ()=>{
      try{
        if(!img.width || !img.height){ fallback(); return; }
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        const imgData = ctx.getImageData(0,0,c.width,c.height);
        const d = imgData.data;
        for(let i=0;i<d.length;i+=4){
          if(d[i+3] > 0){ d[i]=r; d[i+1]=g; d[i+2]=b; }
        }
        ctx.putImageData(imgData,0,0);
        resolve(c.toDataURL('image/png'));
      }catch(e){ fallback(); }
    };
    img.src = dataUrl;
  });
}
function getLogoDataUrl(){
  return new Promise((resolve)=>{
    const imgEl = document.querySelector('header img');
    if(!imgEl){ resolve(null); return; }
    const finish = ()=>{
      try{
        const w = imgEl.naturalWidth, h = imgEl.naturalHeight;
        if(!w || !h){ resolve(null); return; }
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(imgEl, 0, 0);
        resolve(c.toDataURL('image/png'));
      }catch(e){ resolve(null); } // e.g. tainted canvas — fall back gracefully rather than blanking the PDF
    };
    if(imgEl.complete && imgEl.naturalWidth){ finish(); }
    else{
      imgEl.addEventListener('load', finish, { once:true });
      imgEl.addEventListener('error', ()=> resolve(null), { once:true });
      setTimeout(()=> resolve(null), 4000);
    }
  });
}
async function buildPdfBlob(){
  const data = buildPayload();
  data.sigTenant = await recolorSignature(data.sigTenant, '#151515');
  data.sigLandlord = await recolorSignature(data.sigLandlord, '#151515');
  const logoDataUrl = await getLogoDataUrl();
  const container = document.createElement('div');
  // Positioned within the normal viewport (not far off-screen) but behind everything else
  // via a negative z-index — off-screen coordinates and `position:fixed` both caused
  // blank captures with jsPDF's .html() helper, so we render on-screen-but-hidden instead,
  // and call html2canvas directly ourselves for full control.
  container.style.cssText = 'position:fixed; top:0; left:0; width:720px; padding:36px; font-family:Arial,Helvetica,sans-serif; color:#111; background:#fff; z-index:-999;';
  container.innerHTML = renderPrintHTML(data, logoDataUrl);
  document.body.appendChild(container);

  // Let images/layout settle before capture
  await new Promise(r => setTimeout(r, 50));

  const canvas = await html2canvas(container, {
    scale: 2,
    backgroundColor: '#ffffff',
    width: 720,
    windowWidth: 720,
    useCORS: true
  });
  document.body.removeChild(container);

  if(!canvas.width || !canvas.height){
    throw new Error('html2canvas produced an empty canvas');
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF('p','pt','a4');
  const marginPt = 20;
  const pageWidthPt = 555; // A4 width (595pt) minus margins
  const pageHeightPt = 802; // A4 height (842pt) minus margins
  const pxToPt = pageWidthPt / canvas.width;
  const pageHeightPx = Math.floor(pageHeightPt / pxToPt);

  let renderedPx = 0;
  let firstPage = true;
  while(renderedPx < canvas.height){
    const sliceHeightPx = Math.min(pageHeightPx, canvas.height - renderedPx);
    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = canvas.width;
    pageCanvas.height = sliceHeightPx;
    pageCanvas.getContext('2d').drawImage(
      canvas, 0, renderedPx, canvas.width, sliceHeightPx, 0, 0, canvas.width, sliceHeightPx
    );
    const imgData = pageCanvas.toDataURL('image/jpeg', 0.92);
    if(!firstPage) pdf.addPage();
    pdf.addImage(imgData, 'JPEG', marginPt, marginPt, pageWidthPt, sliceHeightPx * pxToPt);
    renderedPx += sliceHeightPx;
    firstPage = false;
  }

  const blob = pdf.output('blob');
  console.log('Generated PDF size (bytes):', blob.size, '| canvas:', canvas.width, 'x', canvas.height);
  if(blob.size < 3000){
    throw new Error(`Generated PDF looks empty (${blob.size} bytes) — aborting send`);
  }
  return blob;
}

/* ---------- Real multipart form submission (FormSubmit only attaches files this way, not via /ajax/) ---------- */
function submitWithAttachments(fields, files){
  return new Promise((resolve)=>{
    let iframe = document.getElementById('fsFrame');
    if(!iframe){
      iframe = document.createElement('iframe');
      iframe.id = 'fsFrame'; iframe.name = 'fsFrame'; iframe.style.display = 'none';
      document.body.appendChild(iframe);
    }
    const form = document.createElement('form');
    form.action = `https://formsubmit.co/${LANDLORD_EMAIL}`;
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.target = 'fsFrame';
    form.style.display = 'none';

    Object.entries(fields).forEach(([name, value])=>{
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.appendChild(input);
    });

    files.forEach(({name, blob, filename})=>{
      const input = document.createElement('input');
      input.type = 'file'; input.name = name; input.style.display = 'none';
      const dt = new DataTransfer();
      dt.items.add(new File([blob], filename, {type: blob.type}));
      input.files = dt.files;
      form.appendChild(input);
    });

    document.body.appendChild(form);

    let settled = false;
    const finish = ()=>{ if(settled) return; settled = true; form.remove(); resolve(); };
    iframe.addEventListener('load', finish, { once:true });
    setTimeout(finish, 10000); // fallback in case the load event doesn't fire

    form.submit();
  });
}

/* ---------- Send to Property Manager (auto-email, real PDF attached) ---------- */
document.getElementById('btnSend').addEventListener('click', async ()=>{
  const btn = document.getElementById('btnSend');
  const data = buildPayload();
  btn.disabled = true; const original = btn.textContent; btn.textContent = 'Preparing PDF…';
  try{
    const pdfBlob = await Promise.race([
      buildPdfBlob(),
      new Promise((_, reject)=> setTimeout(()=> reject(new Error('PDF build timed out')), 20000))
    ]);
    const addrSlug = (data.address||'inspection').replace(/[^a-z0-9]+/gi,'_').toLowerCase();
    const jsonBlob = new Blob([JSON.stringify(data)], {type:'application/json'});
    btn.textContent = 'Sending…';
    await submitWithAttachments(
      {
        _subject: `Inspection – ${data.address || 'Unknown address'} (${data.mode})`,
        _captcha: 'false',
        Address: data.address,
        Tenant: data.tenant,
        Email: data.email,
        Phone: data.phone,
        Mode: data.mode,
        Date: data.date
      },
      [
        { name:'attachment', blob: pdfBlob, filename: `${addrSlug}_inspection.pdf` },
        { name:'attachment2', blob: jsonBlob, filename: `${addrSlug}_data.json` }
      ]
    );
    btn.textContent = 'Sent ✓';
    try{ localStorage.removeItem(DRAFT_KEY); }catch(e){}
    setTimeout(()=>{
      document.querySelector('main').style.display = 'none';
      document.getElementById('thankYou').style.display = 'block';
    }, 700);
  }catch(err){
    console.error('Send to Property Manager failed:', err);
    alert("Couldn't send automatically — use the download icon above as a backup and email it directly.");
    btn.textContent = original;
  } finally {
    setTimeout(()=>{ btn.disabled=false; if(btn.textContent==='Sent ✓') btn.textContent = original; }, 3000);
  }
});

try{
  init();
}catch(err){
  console.error('Failed to initialize the inspection form:', err);
  document.body.innerHTML = `
    <div style="max-width:420px; margin:80px auto; padding:0 24px; text-align:center; font-family:sans-serif; color:#d5d5d5;">
      <h2 style="color:#fff;">Something went wrong loading this form</h2>
      <p>Please refresh the page. If this keeps happening, contact Rapidity Homes directly instead of using this form.</p>
    </div>`;
}
document.getElementById('btnAnother').addEventListener('click', ()=> location.reload());