let events=[];let statusMap={};
const $events=document.getElementById('events');
const template=document.getElementById('eventTemplate');
const statusText=document.getElementById('statusText');
const connectBtn=document.getElementById('connectBtn');
const globalInviteEmail=document.getElementById('globalInviteEmail');
const globalInviteAll=document.getElementById('globalInviteAll');

function nextDate(d){const x=new Date(`${d}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)}
function fmtDate(e){if(e.allDay)return e.startDate+(e.endDate&&e.endDate!==e.startDate?` → ${e.endDate}`:'');const s=new Date(e.startDateTime);const en=e.endDateTime?new Date(e.endDateTime):null;return `${s.toLocaleString('el-CY',{dateStyle:'medium',timeStyle:'short'})}${en?` – ${en.toLocaleTimeString('el-CY',{hour:'2-digit',minute:'2-digit'})}`:''}`}
function googleTemplateUrl(e){const base='https://calendar.google.com/calendar/render?action=TEMPLATE';let dates='';if(e.allDay){const end=e.endDate||nextDate(e.startDate);dates=`${e.startDate.replaceAll('-','')}/${end.replaceAll('-','')}`}else{const start=new Date(e.startDateTime).toISOString().replace(/[-:]/g,'').replace('.000','');const end=new Date(e.endDateTime||new Date(new Date(e.startDateTime).getTime()+7200000).toISOString()).toISOString().replace(/[-:]/g,'').replace('.000','');dates=`${start}/${end}`}const p=new URLSearchParams({text:e.title,dates,details:[e.description||'',e.originalSource?`Original source: ${e.originalSource}`:''].filter(Boolean).join('\n\n'),location:e.location||'',ctz:'Europe/Nicosia'});return `${base}&${p}`}
function selectedIds(){return [...document.querySelectorAll('.select-event:checked')].map(x=>x.dataset.id)}
function validEmail(v){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v||'').trim())}
function eventById(id){return events.find(e=>String(e.id)===String(id))}
function inviteTargets(ids){const out={};for(const id of ids){const esc=CSS.escape(id);const input=document.querySelector(`.invite-email[data-id="${esc}"]`);const value=input?.value.trim();if(value)out[id]=value}return out}
function invitationMap(ids){if(globalInviteAll.checked){const email=globalInviteEmail.value.trim();if(!validEmail(email))throw new Error('Συμπλήρωσε έγκυρο email στη Μαζική πρόσκληση.');const out={};for(const id of ids){const e=eventById(id);if(e&&e.inviteAllowed!==false)out[id]=email}return out}return inviteTargets(ids)}
async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
function isLimassol(e){const s=[e.city,e.location,e.district].filter(Boolean).join(' ').toLowerCase();return s.includes('limassol')||s.includes('λεμεσ')}

function render(){
  $events.innerHTML='';
  if(!events.length){$events.innerHTML='<p class="muted">Δεν υπάρχουν ακόμη εκδηλώσεις. Εισήγαγε JSON από την αναζήτηση του ChatGPT.</p>';return}
  events.forEach((e,i)=>{
    const node=template.content.cloneNode(true);
    const card=node.querySelector('.event-card');
    const sel=node.querySelector('.select-event');
    const inv=node.querySelector('.invite-checkbox');
    const email=node.querySelector('.invite-email');
    const invNow=node.querySelector('.invite-now');
    const del=node.querySelector('.delete-one');
    sel.dataset.id=e.id;inv.dataset.id=e.id;email.dataset.id=e.id;
    node.querySelector('.event-number').textContent=`#${i+1}`;
    node.querySelector('.event-title').textContent=e.title;
    node.querySelector('.meta').textContent=[fmtDate(e),e.location,e.cost,e.category].filter(Boolean).join(' · ');
    node.querySelector('.description').textContent=e.description||'';
    const source=node.querySelector('.source-link');source.href=e.originalSource||'#';if(!e.originalSource)source.classList.add('hidden');
    node.querySelector('.google-link').href=googleTemplateUrl(e);
    if(isLimassol(e))node.querySelector('.limassol-badge').classList.remove('hidden');
    const st=statusMap[e.id];
    if(st?.inCalendar){node.querySelector('.calendar-badge').classList.remove('hidden');del.classList.remove('hidden');if(e.inviteAllowed!==false)invNow.classList.remove('hidden')}
    if(e.inviteAllowed===false){inv.disabled=true;email.disabled=true;inv.parentElement.title='Δεν επιτρέπεται πρόσκληση για αυτή την εκδήλωση'}
    email.addEventListener('input',()=>{if(!email.disabled)inv.checked=Boolean(email.value.trim())});
    inv.addEventListener('change',()=>{if(inv.checked&&!email.value.trim())email.focus()});
    del.onclick=()=>deleteIds([String(e.id)]);
    invNow.onclick=()=>inviteIds([String(e.id)]);
    card.dataset.id=e.id;
    $events.appendChild(node);
  });
  syncGlobalMode();
}

async function refresh(){
  statusText.textContent='Ανανέωση…';
  const health=await fetch('/api/health',{cache:'no-store'}).then(r=>r.json());
  connectBtn.classList.toggle('hidden',health.calendarConnected);
  const d=await fetch('/api/events',{cache:'no-store'}).then(r=>r.json());
  events=d.events||[];
  render();
  if(events.length&&health.calendarConnected){try{statusMap=await post('/api/status',{ids:events.map(e=>String(e.id))})}catch{statusMap={}}}else statusMap={};
  render();
  statusText.textContent=health.calendarConnected?'Έτοιμο':'Το Google Calendar δεν έχει συνδεθεί ακόμη.';
}

async function addIds(ids){
  if(!ids.length)return;
  try{
    const invites=invitationMap(ids);
    for(const [id,email] of Object.entries(invites)){
      if(!validEmail(email)){statusText.textContent=`Μη έγκυρο email για την εκδήλωση #${events.findIndex(e=>String(e.id)===String(id))+1}.`;return}
    }
    statusText.textContent=Object.keys(invites).length?'Καταχώριση και αποστολή πρόσκλησης…':'Καταχώριση…';
    await post('/api/add',{ids,invite:invites});
    await refresh();
  }catch(e){statusText.textContent=e.message}
}

async function deleteIds(ids){if(!ids.length)return;statusText.textContent='Διαγραφή…';try{await post('/api/delete',{ids});await refresh()}catch(e){statusText.textContent=e.message}}

async function inviteIds(ids){
  if(!ids.length)return;
  try{
    const targets=invitationMap(ids);
    for(const id of ids){const ev=eventById(id);if(ev?.inviteAllowed!==false&&!targets[id]){statusText.textContent='Συμπλήρωσε email παραλήπτη πριν στείλεις πρόσκληση.';return}}
    for(const email of Object.values(targets)){if(!validEmail(email)){statusText.textContent='Συμπλήρωσε έγκυρο email παραλήπτη.';return}}
    statusText.textContent='Αποστολή πρόσκλησης…';
    await post('/api/invite',{ids,invite:targets});
    await refresh();
  }catch(e){statusText.textContent=e.message}
}

function syncGlobalMode(){
  const on=globalInviteAll.checked;
  document.querySelectorAll('.invite-checkbox,.invite-email').forEach(el=>{
    const ev=eventById(el.dataset.id);
    el.disabled=on||ev?.inviteAllowed===false;
  });
  globalInviteEmail.disabled=!on;
}

globalInviteAll.onchange=syncGlobalMode;
globalInviteEmail.disabled=true;
document.getElementById('refreshBtn').onclick=refresh;
document.getElementById('addSelected').onclick=()=>addIds(selectedIds());
document.getElementById('deleteSelected').onclick=()=>deleteIds(selectedIds());
document.getElementById('inviteSelected').onclick=()=>inviteIds(selectedIds());
document.getElementById('selectAll').onchange=e=>document.querySelectorAll('.select-event').forEach(c=>c.checked=e.target.checked);
document.getElementById('eventFile').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;try{const data=JSON.parse(await f.text());const arr=Array.isArray(data)?data:data.events;if(!Array.isArray(arr))throw new Error('Το JSON πρέπει να είναι array ή {events:[...]}');await post('/api/import',{events:arr});document.getElementById('importStatus').textContent=`Εισήχθησαν ${arr.length} εκδηλώσεις.`;await refresh()}catch(err){document.getElementById('importStatus').textContent=err.message}};
refresh();
