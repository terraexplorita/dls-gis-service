import http from 'node:http';
import {spawn} from 'node:child_process';
import {URL} from 'node:url';
import {properties,mapGroups} from './data.js';

const PORT=Number(process.env.PORT||10000);
const CORE_PORT=Number(process.env.CORE_PORT||10001);
const CORE=`http://127.0.0.1:${CORE_PORT}`;
const SVG_CACHE=new Map();

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));}
function money(v){return v==null?'—':new Intl.NumberFormat('el-CY',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);}
function num(v,d=2){return new Intl.NumberFormat('el-CY',{minimumFractionDigits:d,maximumFractionDigits:d}).format(v);}
function relevantGroup(p){return p?.areaKey==='arsos'?'arsos':p?.areaKey==='pafos'?'pafos':null;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const confirmedRelations={
  arsos:{touching:[['IDI0006','AKI0003',0]],close:[['AKI0008','AKI0010',5.3282120023810196],['AKI0006','AKI0009',150.94178419997496],['IDI0016','AKI0004',194.07610717315976]]},
  pafos:{touching:[['IDI0008','IDI0010',0]],close:[]}
};

function relationBlock(group){
  const rel=confirmedRelations[group]||{touching:[],close:[]};
  const pair=([a,b,d],touching=false)=>{
    const pa=properties[a],pb=properties[b];if(!pa||!pb)return'';
    const label=touching?'ΕΦΑΠΤΕΤΑΙ':d<=50?'ΠΑΡΑ ΠΟΛΥ ΚΟΝΤΑ':'ΠΟΛΥ ΚΟΝΤΑ';
    const distance=touching?'0 m':`${num(d)} m`;
    return `<div class="relrow"><div><a data-detail href="/property/${a}?from=${group}">${esc(pa.code)}</a> ↔ <a data-detail href="/property/${b}?from=${group}">${esc(pb.code)}</a></div><div class="reldist">${distance} — ${label}</div></div>`;
  };
  const touch=rel.touching.length?rel.touching.map(x=>pair(x,true)).join(''):'<div class="none">Καμία επιβεβαιωμένη σχέση.</div>';
  const close=rel.close.length?rel.close.map(x=>pair(x,false)).join(''):'<div class="none">Καμία επιβεβαιωμένη σχέση.</div>';
  return `<div class="relbox"><div class="smallcap">ΕΠΙΒΕΒΑΙΩΜΕΝΕΣ DLS ΣΧΕΣΕΙΣ</div><h2>ΑΚΙΝΗΤΑ ΠΟΥ ΕΦΑΠΤΟΝΤΑΙ</h2>${touch}<h2>ΑΚΙΝΗΤΑ ΠΟΥ ΕΙΝΑΙ ΠΟΛΥ ΚΟΝΤΑ</h2>${close}</div>`;
}

function sidebar(group){
  const items=(mapGroups[group]?.keys||[]).map(k=>[k,properties[k]]).filter(([,p])=>p);
  const row=([k,p])=>`<div class="vrow ${p.kind}" data-property-key="${k}"><a data-detail class="vtitle" href="/property/${k}?from=${group}">${esc(p.code)} — ${esc(p.title)}</a><div class="vmeta">${p.kind==='owned'?`Ιδιοκτησία ${esc(p.share||'100%')} · Εγγρ. ${esc(p.registration||'—')}`:`${esc(p.priceType||'Τιμή')}: <strong>${esc(money(p.price))}</strong>`}</div><div class="vlinks"><a data-detail href="/property/${k}?from=${group}">Details</a>${p.sourceUrl?` · <a href="${esc(p.sourceUrl)}" target="_blank">Source ↗</a>`:' · <span>χωρίς source</span>'}</div></div>`;
  const owned=items.filter(([,p])=>p.kind==='owned').map(row).join('');
  const candidates=items.filter(([,p])=>p.kind==='candidate').map(row).join('');
  return `<div class="vsideHead"><a class="allprops" href="/properties">ΟΛΑ ΤΑ ΑΚΙΝΗΤΑ</a></div>${relationBlock(group)}<h2>ΙΔΙΟΚΤΗΤΑ ΑΚΙΝΗΤΑ</h2>${owned}<h2>ΑΚΙΝΗΤΑ ΠΡΟΣ ΑΓΟΡΑ</h2>${candidates}`;
}

function mapPage(group,mpp){
  const g=mapGroups[group];if(!g)return null;
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(g.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:Arial,sans-serif;color:#171717}.topbar{height:54px;background:#111;color:#fff;display:flex;align-items:center;padding:0 14px;gap:16px}.topbar a{color:#fff;text-decoration:none}.app{height:calc(100vh - 54px);display:grid;grid-template-columns:minmax(0,1fr) 430px}.mapwrap{position:relative;overflow:hidden;background:#ddd;cursor:grab;touch-action:none}.mapwrap.dragging{cursor:grabbing}.mapobj{position:absolute;left:0;top:0;border:0;transform-origin:0 0;will-change:transform;clip-path:inset(0 620px 0 0)}.controls{position:absolute;z-index:4;left:14px;top:14px;display:flex;flex-direction:column;gap:7px}.controls button{width:46px;height:46px;border:1px solid #777;background:#fff;border-radius:7px;font-size:24px;font-weight:700;box-shadow:0 1px 5px #0003;cursor:pointer}.controls .fit{width:82px;font-size:13px}.hint{position:absolute;left:14px;bottom:14px;background:#fffffff0;padding:8px 11px;border-radius:6px;font-size:13px;z-index:4}.sidebar{overflow:auto;background:#fff;border-left:1px solid #ccc;padding:16px}.vsideHead{display:flex;justify-content:flex-end;position:sticky;top:-16px;background:#fff;padding:4px 0 12px;z-index:3}.allprops{background:#111;color:#fff!important;padding:10px 13px;border-radius:6px;text-decoration:none;font-weight:700}.sidebar h2{font-size:17px;margin:16px 0 8px}.vrow{padding:10px 11px;margin:0 0 8px;border-radius:7px;border:1px solid #ddd;transition:background .12s,border-color .12s,box-shadow .12s}.vrow:hover,.vrow.is-hover{background:#fff8c9;border-color:#d7b300;box-shadow:0 0 0 2px #f1d94a55}.vrow.owned{border-left:5px solid #27883c}.vrow.candidate{border-left:5px solid #d64b25}.vtitle{display:block;font-size:15px;font-weight:700;color:#111;text-decoration:none;line-height:1.3}.vmeta{font-size:14px;color:#444;margin-top:5px}.vlinks{font-size:13px;margin-top:6px}.vlinks a,.relrow a{color:#2457c5}.vlinks span{color:#888}.relbox{border:1px solid #ddd;background:#f8f8f6;border-radius:9px;padding:11px;margin-bottom:14px}.relbox h2{font-size:14px;margin:10px 0 6px}.smallcap{font-size:11px;color:#666;font-weight:700;letter-spacing:.04em}.relrow{padding:7px 0;border-top:1px solid #e5e5e5;font-size:13px}.reldist{font-weight:700;margin-top:3px}.none{font-size:13px;color:#777}.sideToggle{display:none;margin-left:auto;background:#fff;color:#111;border:0;border-radius:5px;padding:7px 10px}@media(max-width:900px){.app{grid-template-columns:1fr}.sidebar{position:absolute;right:0;top:54px;bottom:0;width:min(90vw,430px);z-index:6;box-shadow:-3px 0 10px #0003;transform:translateX(100%);transition:.2s}.sidebar.open{transform:none}.sideToggle{display:block}}
</style></head><body><div class="topbar"><strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a data-maplink="arsos" href="/map?group=arsos&mpp=2">Άρσος</a><a data-maplink="pafos" href="/map?group=pafos&mpp=2">Άγιος Νικόλαος</a><a href="/properties">Όλα τα ακίνητα</a><button class="sideToggle" id="sideToggle">Λίστα</button></div><div class="app"><div class="mapwrap" id="mapwrap"><object id="mapobj" class="mapobj" data="/map.svg?group=${encodeURIComponent(group)}&mpp=${mpp}" type="image/svg+xml"></object><div class="controls"><button id="zin">+</button><button id="zout">−</button><button class="fit" id="fit">Fit all</button></div><div class="hint">Wheel: zoom · σύρε: μετακίνηση</div></div><aside class="sidebar" id="sidebar">${sidebar(group)}</aside></div><script>
(()=>{const GROUP=${JSON.stringify(group)},MPP=${JSON.stringify(mpp)},wrap=document.getElementById('mapwrap'),obj=document.getElementById('mapobj'),side=document.getElementById('sidebar');let mapW=1000,mapH=1000,totalW=1620,totalH=1000,scale=1,x=0,y=0,drag=false,lastX=0,lastY=0,moved=false,loaded=false,svgDoc=null;const stateKey='mapState:'+GROUP;const clamp=()=>{const vw=wrap.clientWidth,vh=wrap.clientHeight,sw=mapW*scale,sh=mapH*scale;x=sw<=vw?(vw-sw)/2:Math.min(0,Math.max(vw-sw,x));y=sh<=vh?(vh-sh)/2:Math.min(0,Math.max(vh-sh,y))};const apply=()=>{clamp();obj.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')'};const save=()=>{if(!loaded)return;sessionStorage.setItem(stateKey,JSON.stringify({scale:scale,x:x,y:y,mpp:MPP,scrollTop:side.scrollTop}));sessionStorage.setItem('lastMapGroup',GROUP)};const fit=()=>{const vw=wrap.clientWidth,vh=wrap.clientHeight;scale=Math.min(vw/mapW,vh/mapH);x=(vw-mapW*scale)/2;y=(vh-mapH*scale)/2;apply()};const restore=()=>{try{const s=JSON.parse(sessionStorage.getItem(stateKey)||'null');if(s&&Number(s.mpp)===Number(MPP)){scale=Number(s.scale)||1;x=Number(s.x)||0;y=Number(s.y)||0;side.scrollTop=Number(s.scrollTop)||0;apply();return true}}catch{}return false};const zoom=(factor,cx=wrap.clientWidth/2,cy=wrap.clientHeight/2)=>{const old=scale,ns=Math.max(.15,Math.min(12,scale*factor));x=cx-(cx-x)*(ns/old);y=cy-(cy-y)*(ns/old);scale=ns;apply();save()};const parcelPath=key=>{if(!svgDoc)return null;for(const a of svgDoc.querySelectorAll('a')){if(a.getAttribute('href')==='/property/'+key)return a.querySelector('path')}return null};const setHighlight=(key,on)=>{const p=parcelPath(key);if(!p)return;if(on){if(!p.dataset.hlStroke){p.dataset.hlStroke=p.getAttribute('stroke')||'';p.dataset.hlWidth=p.getAttribute('stroke-width')||'';p.dataset.hlOpacity=p.getAttribute('fill-opacity')||''}p.setAttribute('stroke','#ffd400');p.setAttribute('stroke-width','7');p.setAttribute('fill-opacity','.92');p.style.filter='drop-shadow(0 0 5px #ffcc00)'}else{if(p.dataset.hlStroke)p.setAttribute('stroke',p.dataset.hlStroke);if(p.dataset.hlWidth)p.setAttribute('stroke-width',p.dataset.hlWidth);if(p.dataset.hlOpacity)p.setAttribute('fill-opacity',p.dataset.hlOpacity);p.style.filter=''}};obj.addEventListener('load',()=>{try{const doc=obj.contentDocument,svg=doc.documentElement,img=doc.querySelector('image');svgDoc=doc;totalW=Number(svg.getAttribute('width'))||svg.viewBox.baseVal.width;totalH=Number(svg.getAttribute('height'))||svg.viewBox.baseVal.height;mapW=img?Number(img.getAttribute('width')):Math.max(1,totalW-620);mapH=img?Number(img.getAttribute('height')):totalH;obj.style.width=totalW+'px';obj.style.height=totalH+'px';doc.addEventListener('wheel',e=>{e.preventDefault();const r=wrap.getBoundingClientRect();zoom(e.deltaY<0?1.22:.82,e.clientX-r.left,e.clientY-r.top)},{passive:false});doc.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag=true;moved=false;lastX=e.clientX;lastY=e.clientY;wrap.classList.add('dragging');e.preventDefault()});doc.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=e.clientX;lastY=e.clientY;apply();e.preventDefault()});doc.addEventListener('pointerup',e=>{drag=false;wrap.classList.remove('dragging');save();if(moved){e.preventDefault();e.stopPropagation()}},true);doc.addEventListener('click',e=>{if(e.target.closest&&e.target.closest('a'))save()},true);loaded=true;if(!restore())fit();sessionStorage.setItem('lastMapGroup',GROUP)}catch(err){console.error(err)}});wrap.addEventListener('wheel',e=>{if(e.target===wrap){e.preventDefault();const r=wrap.getBoundingClientRect();zoom(e.deltaY<0?1.22:.82,e.clientX-r.left,e.clientY-r.top)}},{passive:false});document.getElementById('zin').onclick=()=>zoom(1.35);document.getElementById('zout').onclick=()=>zoom(.74);document.getElementById('fit').onclick=()=>{fit();save()};window.addEventListener('pagehide',save);window.addEventListener('beforeunload',save);window.addEventListener('resize',()=>{apply();save()});document.querySelectorAll('a[data-detail]').forEach(a=>a.addEventListener('click',save));document.querySelectorAll('[data-property-key]').forEach(row=>{const key=row.dataset.propertyKey;row.addEventListener('mouseenter',()=>{row.classList.add('is-hover');setHighlight(key,true)});row.addEventListener('mouseleave',()=>{row.classList.remove('is-hover');setHighlight(key,false)})});document.querySelectorAll('a[data-maplink]').forEach(a=>a.addEventListener('click',e=>{if(a.dataset.maplink===GROUP)e.preventDefault()}));document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open')})();
</script></body></html>`;
}

function propertyRelations(key){
  const rows=[];
  for(const [group,rel] of Object.entries(confirmedRelations)){
    for(const [a,b,d] of rel.touching||[]){
      if(a===key||b===key){const other=a===key?b:a;rows.push({other,distance:0,label:'ΕΦΑΠΤΕΤΑΙ',group});}
    }
    for(const [a,b,d] of rel.close||[]){
      if(a===key||b===key){const other=a===key?b:a;rows.push({other,distance:d,label:d<=50?'ΠΑΡΑ ΠΟΛΥ ΚΟΝΤΑ':'ΠΟΛΥ ΚΟΝΤΑ',group});}
    }
  }
  return rows;
}

function propertyPage(key,p,from){
  const group=relevantGroup(p);
  const field=(label,value)=>value==null||value===''?'':`<div class="kv"><b>${esc(label)}</b><span>${esc(value)}</span></div>`;
  const area=p.registeredArea!=null?`${p.registeredArea.toLocaleString('el-CY')} m²`:null;
  const unitArea=p.unitArea!=null?`${p.unitArea.toLocaleString('el-CY')} m²`:null;
  const typeLabel=p.kind==='owned'?'ΙΔΙΟΚΤΗΤΟ':'ΠΡΟΣ ΑΓΟΡΑ';
  const financial=p.kind==='candidate'?`${field('Τιμή',p.price!=null?money(p.price):null)}${field('Τύπος τιμής',p.priceType)}${field('Ημερομηνία πλειστηριασμού',p.auctionDate)}`:'';
  const sourceField=p.sourceUrl?`<div class="kv wide"><b>URL ΑΡΧΙΚΗΣ ΠΗΓΗΣ</b><a href="${esc(p.sourceUrl)}" target="_blank">${esc(p.sourceUrl)}</a></div>`:'';
  const sourceButton=p.sourceUrl?`<a class="btn secondary" href="${esc(p.sourceUrl)}" target="_blank">Αρχική πηγή ↗</a>`:'';
  const relations=propertyRelations(key);
  const relationHtml=relations.length?relations.map(r=>{const op=properties[r.other];return `<div class="relationItem"><div><a href="/property/${r.other}?from=${r.group}">${esc(op?.code||r.other)}${op?.title?` — ${esc(op.title)}`:''}</a></div><div><b>${esc(r.label)}</b> · ${r.distance===0?'0 m':`${num(r.distance)} m`}</div></div>`}).join(''):'<p class="muted">Δεν υπάρχει καταχωρημένη επιβεβαιωμένη σχέση με άλλο ακίνητο.</p>';
  const fallback=group?`/map?group=${group}&mpp=2`:'/properties';
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.code)} — ${esc(p.title)}</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f4f4f0;color:#171717}.bar{position:sticky;top:0;background:#111;color:#fff;padding:12px 16px;display:flex;gap:10px;align-items:center;z-index:5}.bar a{color:#fff;text-decoration:none}.mapbtn{background:#fff!important;color:#111!important;border-radius:6px;padding:9px 13px;font-weight:700}.spacer{flex:1}.wrap{max-width:1200px;margin:0 auto;padding:22px}.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:18px;margin-bottom:18px}.tag{display:inline-block;padding:5px 9px;border-radius:999px;font-size:12px;font-weight:700;background:${p.kind==='owned'?'#dff2e2':'#fde2d8'}}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:11px}.kv{background:#fafafa;border:1px solid #eee;border-radius:7px;padding:10px}.kv.wide{grid-column:1/-1}.kv b{display:block;font-size:11px;color:#666;text-transform:uppercase;margin-bottom:5px}.kv span,.kv a{font-size:15px;overflow-wrap:anywhere}.btn{display:inline-block;background:#111;color:#fff!important;border-radius:6px;padding:9px 12px;text-decoration:none;margin-right:8px}.secondary{background:#385b9b}.relationItem{padding:11px 0;border-top:1px solid #eee}.relationItem:first-child{border-top:0}.relationItem a{color:#2457c5;font-weight:700;text-decoration:none}.muted{color:#777}</style></head><body><div class="bar"><a id="backMap" class="mapbtn" href="${fallback}">← ΧΑΡΤΗΣ</a>${group?`<a id="areaMap" href="${fallback}">${group==='arsos'?'Χάρτης Άρσους':'Χάρτης Αγίου Νικολάου'}</a>`:''}<a href="/properties">Όλα τα ακίνητα</a><span class="spacer"></span></div><div class="wrap"><div class="card"><span class="tag">${typeLabel}</span><h1>${esc(p.code)} — ${esc(p.title)}</h1>${sourceButton}</div><div class="card"><h2>Στοιχεία ακινήτου</h2><div class="grid">${field('Κωδικός εγγραφής',p.code)}${field('Τύπος',typeLabel)}${field('Κατάσταση',p.status)}${field('Τίτλος / όνομα ακινήτου',p.title)}${field('Αριθμός εγγραφής',p.registration)}${field('Ποσοστό ιδιοκτησίας / μερίδιο',p.share)}${field('Επαρχία',p.district)}${field('Κοινότητα / Δήμος',p.community)}${field('Αριθμός τεμαχίου',p.parcel)}${field('Εμβαδόν τεμαχίου',area)}${field('Εμβαδόν μονάδας',unitArea)}${field('Πολεοδομική ζώνη',p.zone)}${field('Πρόσβαση δρόμου',p.roadAccess)}${field('Απόσταση από θάλασσα',p.seaDistance!=null?`${p.seaDistance} m`:null)}${financial}${sourceField}</div></div>${p.notes?`<div class="card"><h2>Σημειώσεις</h2><p>${esc(p.notes)}</p></div>`:''}<div class="card"><h2>Σχέσεις με άλλα ακίνητα</h2>${relationHtml}</div></div><script>(()=>{const expected=${JSON.stringify(group)},from=${JSON.stringify(from||'')},fallback=${JSON.stringify(fallback)};function canBack(){try{const r=new URL(document.referrer);if(r.origin!==location.origin)return false;if(!expected)return r.pathname==='/map'||r.pathname==='/map.svg';return (r.pathname==='/map'||r.pathname==='/map.svg')&&r.searchParams.get('group')===expected}catch{return false}}function goMap(e){e.preventDefault();if(canBack()||from===expected)history.back();else location.href=fallback}document.getElementById('backMap').addEventListener('click',goMap);const a=document.getElementById('areaMap');if(a)a.addEventListener('click',goMap)})();</script></body></html>`;
}

const core=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(CORE_PORT)},stdio:'inherit'});
core.on('exit',(code,signal)=>{console.error('Core server exited',code,signal);process.exit(code||1)});

let coreReadyPromise=null;
function waitForCore(){
  if(coreReadyPromise)return coreReadyPromise;
  coreReadyPromise=(async()=>{
    for(let i=0;i<60;i++){
      try{const r=await fetch(CORE+'/health',{signal:AbortSignal.timeout(1500)});if(r.ok)return true;}catch{}
      await sleep(250);
    }
    coreReadyPromise=null;throw new Error('Core GIS service did not become ready');
  })();
  return coreReadyPromise;
}

async function fetchCoreBuffer(path){
  await waitForCore();
  const r=await fetch(new URL(path,CORE),{signal:AbortSignal.timeout(120000)});
  const buf=Buffer.from(await r.arrayBuffer());if(!r.ok)throw new Error(`Core ${r.status} for ${path}`);
  const headers={};r.headers.forEach((v,k)=>{if(!['transfer-encoding','content-encoding','content-length'].includes(k))headers[k]=v});
  return{status:r.status,buf,headers};
}
async function cachedSvg(path){
  if(SVG_CACHE.has(path))return SVG_CACHE.get(path);
  const p=fetchCoreBuffer(path).then(x=>{x.headers['cache-control']='public, max-age=3600';x.headers['content-length']=String(x.buf.length);return x}).catch(e=>{SVG_CACHE.delete(path);throw e});
  SVG_CACHE.set(path,p);return p;
}
async function proxy(req,res){
  await waitForCore();
  const target=new URL(req.url,CORE);const headers={};for(const[k,v]of Object.entries(req.headers))if(v!=null&&!['host','content-length'].includes(k))headers[k]=v;
  const r=await fetch(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:req,duplex:'half',signal:AbortSignal.timeout(120000)});
  const out={};r.headers.forEach((v,k)=>{if(!['transfer-encoding','content-encoding','content-length'].includes(k))out[k]=v});const buf=Buffer.from(await r.arrayBuffer());out['content-length']=String(buf.length);res.writeHead(r.status,out);res.end(buf);
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://local');
    if(u.pathname==='/map'){
      const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),page=mapPage(group,mpp);
      if(!page){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Unknown group'}));}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(page);
    }
    if(u.pathname.startsWith('/property/')){
      const key=u.pathname.split('/').pop(),p=properties[key];if(!p){res.writeHead(404,{'content-type':'text/html; charset=utf-8'});return res.end('<h1>Δεν βρέθηκε ακίνητο</h1>');}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(propertyPage(key,p,u.searchParams.get('from')));
    }
    if(req.method==='GET'&&u.pathname==='/map.svg'&&['arsos','pafos'].includes(u.searchParams.get('group')||'arsos')&&Number(u.searchParams.get('mpp')||2)===2){const x=await cachedSvg(u.pathname+u.search);res.writeHead(x.status,x.headers);return res.end(x.buf);}
    await proxy(req,res);return;
  }catch(e){console.error('viewer request error',e);if(!res.headersSent){res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}))}}
});

server.listen(PORT,()=>{
  console.log(`DLS viewer v2.7 listening on ${PORT}; core on ${CORE_PORT}`);
  waitForCore().then(()=>Promise.allSettled([cachedSvg('/map.svg?group=arsos&mpp=2'),cachedSvg('/map.svg?group=pafos&mpp=2')])).then(()=>console.log('DLS viewer map cache warmed')).catch(e=>console.error('cache warm skipped',e.message));
});
process.on('SIGTERM',()=>{core.kill('SIGTERM');server.close(()=>process.exit(0))});