let events = [];
let statusMap = {};
let defaultInvitee = 'sflourentzou@gmail.com';

const $events = document.getElementById('events');
const template = document.getElementById('eventTemplate');
const statusText = document.getElementById('statusText');

function fmtDate(e){
  if(e.allDay) return e.startDate + (e.endDate && e.endDate!==e.startDate ? ` → ${e.endDate}` : '');
  const s = new Date(e.startDateTime);
  const en = e.endDateTime ? new Date(e.endDateTime) : null;
  return `${s.toLocaleString('el-CY',{dateStyle:'medium',timeStyle:'short'})}${en?` – ${en.toLocaleTimeString('el-CY',{hour:'2-digit',minute:'2-digit'})}`:''}`;
}

function googleTemplateUrl(e){
  const base='https://calendar.google.com/calendar/render?action=TEMPLATE';
  let dates='';
  if(e.allDay){
    const end=e.endDate||nextDate(e.startDate);
    dates=`${e.startDate.replaceAll('-','')}/${end.replaceAll('-','')}`;
  } else {
    const start=new Date(e.startDateTime).toISOString().replace(/[-:]/g,'').replace('.000','');
    const end=new Date(e.endDateTime||new Date(new Date(e.startDateTime).getTime()+7200000).toISOString()).toISOString().replace(/[-:]/g,'').replace('.000','');
    dates=`${start}/${end}`;
  }
  const p=new URLSearchParams({text:e.title,dates,details:[e.description||'',e.originalSource?`Original source: ${e.originalSource}`:''].filter(Boolean).join('\n\n'),location:e.location||'',ctz:'Europe/Nicosia'});
  return `${base}&${p.toString()}`;
}

function nextDate(d){const x=new Date(`${d}T00:00:00Z`);x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)}
function selectedIds(){return [...document.querySelectorAll('.select-event:checked')].map(x=>x.dataset.id)}
function inviteMapFor(ids){const o={};ids.forEach(id=>{const c=document.querySelector(`.invite-checkbox[data-id="${CSS.escape(id)}"]`);o[id]=Boolean(c?.checked)});return o}

async function post(url,body){
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();
  if(!r.ok) throw new Error(data.error||'Request failed');
  return data;
}

function render(){
  $events.innerHTML='';
  if(!events.length){$events.innerHTML='<p class="muted">Δεν υπάρχουν ακόμη συγχρονισμένες εκδηλώσεις.</p>';return}
  events.forEach((e,i)=>{
    const node=template.content.cloneNode(true);
    const card=node.querySelector('.event-card');
    const sel=node.querySelector('.select-event');
    const inv=node.querySelector('.invite-checkbox');
    const invNow=node.querySelector('.invite-now');
    const del=node.querySelector('.delete-one');
    sel.dataset.id=e.id; inv.dataset.id=e.id;
    node.querySelector('.event-number').textContent=`#${i+1}`;
    node.querySelector('.event-title').textContent=e.title;
    const meta=[fmtDate(e),e.location,e.cost,e.category].filter(Boolean).join(' · ');
    node.querySelector('.meta').textContent=meta;
    node.querySelector('.description').textContent=e.description||'';
    const source=node.querySelector('.source-link');
    source.href=e.originalSource||'#'; if(!e.originalSource) source.classList.add('hidden');
    node.querySelector('.google-link').href=googleTemplateUrl(e);
    if((e.city||'').toLowerCase().includes('limassol')||(e.city||'').toLowerCase().includes('λεμεσ')) node.querySelector('.limassol-badge').classList.remove('hidden');
    const st=statusMap[e.id];
    if(st?.inCalendar){
      node.querySelector('.calendar-badge').classList.remove('hidden');
      del.classList.remove('hidden');
      if(e.inviteAllowed!==false) invNow.classList.remove('hidden');
    }
    if(e.inviteAllowed===false){inv.disabled=true;inv.parentElement.title='Δεν επιτρέπεται πρόσκληση για αυτή την κατηγορία';}
    del.addEventListener('click',()=>deleteIds([String(e.id)]));
    invNow.addEventListener('click',()=>inviteIds([String(e.id)]));
    card.dataset.id=e.id;
    $events.appendChild(node);
  });
}

async function refresh(){
  statusText.textContent='Ανανέωση…';
  const d=await fetch('/api/events',{cache:'no-store'}).then(r=>r.json());
  events=d.events||[]; defaultInvitee=d.defaultInvitee||defaultInvitee;
  render();
  if(events.length){
    try{statusMap=await post('/api/status',{ids:events.map(e=>String(e.id))});}
    catch(err){statusMap={};statusText.textContent='Το interface φορτώθηκε, αλλά το Google Calendar API δεν έχει ακόμη συνδεθεί.';render();return}
  }
  render(); statusText.textContent='Έτοιμο';
}

async function addIds(ids){
  if(!ids.length)return;
  statusText.textContent='Καταχώριση…';
  try{await post('/api/add',{ids,invite:inviteMapFor(ids),invitee:defaultInvitee});await refresh();}
  catch(e){statusText.textContent=e.message}
}
async function deleteIds(ids){
  if(!ids.length)return;
  statusText.textContent='Διαγραφή…';
  try{await post('/api/delete',{ids});await refresh();}
  catch(e){statusText.textContent=e.message}
}
async function inviteIds(ids){
  if(!ids.length)return;
  statusText.textContent='Αποστολή πρόσκλησης…';
  try{await post('/api/invite',{ids,invitee:defaultInvitee});await refresh();}
  catch(e){statusText.textContent=e.message}
}

document.getElementById('refreshBtn').onclick=refresh;
document.getElementById('addSelected').onclick=()=>addIds(selectedIds());
document.getElementById('deleteSelected').onclick=()=>deleteIds(selectedIds());
document.getElementById('inviteSelected').onclick=()=>inviteIds(selectedIds());
document.getElementById('selectAll').onchange=e=>document.querySelectorAll('.select-event').forEach(c=>c.checked=e.target.checked);
refresh();
