import {readFileSync,writeFileSync} from 'node:fs';

function replaceOnce(text,from,to,label){
  if(!text.includes(from)) throw new Error(`bootstrap2 patch not found: ${label}`);
  return text.replace(from,to);
}

// 1) Extend map groups dynamically from the real property registry.
let d=readFileSync('./data.js','utf8');
const dynamicGroups=`
// Runtime-generated canonical area groups. Any locatable property with a new areaKey
// automatically creates/extends a selectable detailed map group.
if(mapGroups.arsos){mapGroups.arsos.isAreaGroup=true;mapGroups.arsos.district='Λεμεσός';mapGroups.arsos.community='Άρσος';}
if(mapGroups.pafos){mapGroups.pafos.isAreaGroup=true;mapGroups.pafos.district='Πάφος';mapGroups.pafos.community='Άγιος Νικόλαος Πάφου';}
for(const [key,p] of Object.entries(properties)){
  if(!p?.areaKey||!p?.sheet||!p?.plan||p?.block==null||p?.parcel==null)continue;
  let g=mapGroups[p.areaKey];
  if(!g||!g.isAreaGroup){g=mapGroups[p.areaKey]={title:'',keys:[],isAreaGroup:true,district:p.district||'—',community:p.community||p.municipality||p.areaKey};}
  g.isAreaGroup=true;g.district=g.district||p.district||'—';g.community=g.community||p.community||p.municipality||p.areaKey;
  if(!g.keys.includes(key))g.keys.push(key);
}
for(const [key,g] of Object.entries(mapGroups))if(g?.isAreaGroup)g.title=(g.community||key)+' — Ιδιόκτητα & προς αγορά';
`;
d=replaceOnce(d,'\nexport const areas={',dynamicGroups+'\nexport const areas={','dynamic area groups');
writeFileSync('./data.runtime.js',d,'utf8');

// Make viewer/core imports use the runtime registry.
let v=readFileSync('./viewer.js','utf8').replace("from './data.js';","from './data.runtime.js';");
let c=readFileSync('./server.js','utf8').replace("from './data.js';","from './data.runtime.js';");

// 2) Generalize viewer navigation and add an all-areas landing page.
v=replaceOnce(v,"function relevantGroup(p){return p?.areaKey==='arsos'?'arsos':p?.areaKey==='pafos'?'pafos':null;}","function relevantGroup(p){return p?.areaKey&&mapGroups[p.areaKey]?.isAreaGroup?p.areaKey:null;}",'generic relevantGroup');
const helper=`
function areaGroups(){return Object.entries(mapGroups).filter(([,g])=>g?.isAreaGroup&&g.keys?.length);}
function areaNavOptions(current=''){
  const groups=areaGroups();
  const districts=[...new Set(groups.map(([,g])=>g.district||'—'))].sort((a,b)=>String(a).localeCompare(String(b),'el'));
  return '<option value="">ΕΠΙΛΟΓΗ ΠΕΡΙΟΧΗΣ</option>'+districts.map(d=>'<optgroup label="'+esc(d)+'">'+groups.filter(([,g])=>(g.district||'—')===d).sort((a,b)=>String(a[1].community||a[0]).localeCompare(String(b[1].community||b[0]),'el')).map(([k,g])=>'<option value="'+esc(k)+'"'+(k===current?' selected':'')+'>'+esc(g.community||k)+'</option>').join('')+'</optgroup>').join('');
}
function areaLandingPage(){
  const groups=areaGroups(),districts=[...new Set(groups.map(([,g])=>g.district||'—'))].sort((a,b)=>String(a).localeCompare(String(b),'el'));
  const sections=districts.map(d=>'<section><h2>'+esc(d)+'</h2><div class="areaGrid">'+groups.filter(([,g])=>(g.district||'—')===d).sort((a,b)=>String(a[1].community||a[0]).localeCompare(String(b[1].community||b[0]),'el')).map(([k,g])=>{const owned=g.keys.filter(x=>properties[x]?.kind==='owned').length,cand=g.keys.filter(x=>properties[x]?.kind==='candidate').length;return '<a class="areaCard" href="/map?group='+encodeURIComponent(k)+'&mpp=2"><strong>'+esc(g.community||k)+'</strong><span>'+g.keys.length+' ακίνητα · '+owned+' ιδιόκτητα · '+cand+' προς αγορά</span><b>ΑΝΟΙΓΜΑ ΧΑΡΤΗ →</b></a>';}).join('')+'</div></section>').join('');
  return '<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Όλες οι περιοχές</title><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:#f4f4f0;color:#171717}.bar{background:#111;color:#fff;padding:15px 18px;display:flex;gap:18px;align-items:center}.bar a{color:#fff;text-decoration:none}.wrap{max-width:1200px;margin:auto;padding:24px}.intro{color:#555;margin-bottom:24px}.areaGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.areaCard{display:flex;flex-direction:column;gap:9px;padding:18px;background:#fff;border:1px solid #ccc;border-radius:10px;text-decoration:none;color:#171717;box-shadow:0 1px 4px #0001}.areaCard:hover{border-color:#777;box-shadow:0 2px 8px #0002}.areaCard strong{font-size:19px}.areaCard span{color:#555}.areaCard b{font-size:12px;color:#2457c5;margin-top:5px}h2{margin-top:28px}</style></head><body><div class="bar"><strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a href="/properties">Όλα τα ακίνητα</a></div><div class="wrap"><h1>ΟΛΕΣ ΟΙ ΠΕΡΙΟΧΕΣ</h1><p class="intro">Επίλεξε την περιοχή του λεπτομερούς κτηματολογικού χάρτη. Οι περιοχές δημιουργούνται αυτόματα από τα καταχωρημένα ακίνητα.</p>'+sections+'</div></body></html>';
}
`;
v=replaceOnce(v,'\nfunction mapPage(group,mpp){','\n'+helper+'\nfunction mapPage(group,mpp){','area navigation helpers');
v=replaceOnce(v,'.topbar a{color:#fff;text-decoration:none}',".topbar a{color:#fff;text-decoration:none}.areaNavWrap{margin-left:4px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:6px}.areaNavWrap select{max-width:250px;padding:7px 9px;border-radius:6px;border:1px solid #888;background:#fff;color:#111;font-weight:700}",'area selector CSS');
v=replaceOnce(v,'<strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a data-maplink="arsos" href="/map?group=arsos&mpp=2">Άρσος</a><a data-maplink="pafos" href="/map?group=pafos&mpp=2">Άγιος Νικόλαος</a><a href="/properties">Όλα τα ακίνητα</a>','<strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a href="/map">Όλες οι περιοχές</a><label class="areaNavWrap">ΠΕΡΙΟΧΗ <select id="areaNav">${areaNavOptions(group)}</select></label><a href="/properties">Όλα τα ακίνητα</a>','map topbar area selector');
v=v.replace('<a href="/map?group=arsos&mpp=2">Χάρτης Άρσους</a><a href="/map?group=pafos&mpp=2">Άγιος Νικόλαος</a>','<a href="/map">Χάρτες / Περιοχές</a>');
v=replaceOnce(v,"document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open');applyOwnedFilters();","const areaNav=document.getElementById('areaNav');if(areaNav)areaNav.addEventListener('change',()=>{if(areaNav.value&&areaNav.value!==GROUP){save();location.href='/map?group='+encodeURIComponent(areaNav.value)+'&mpp=2';}});document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open');applyOwnedFilters();",'area selector behavior');
v=v.replace("group==='arsos'?'Χάρτης Άρσους':'Χάρτης Αγίου Νικολάου'","'Χάρτης '+(mapGroups[group]?.community||municipalityText(p)||group)");

// User-confirmed adjacency in Pentakomo: Governors small and large fields touch.
v=v.replace("pafos:{touching:[['IDI0008','IDI0010',0]],close:[]}","pafos:{touching:[['IDI0008','IDI0010',0]],close:[]},\n  pentakomo:{touching:[['IDI0022','IDI0023',0]],close:[]}");

// Replace hidden Arsos default with an all-areas landing; any valid dynamic group is accepted.
v=replaceOnce(v,"if(u.pathname==='/map'){const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),page=mapPage(group,mpp);","if(u.pathname==='/'||(u.pathname==='/map'&&!u.searchParams.get('group'))){const page=areaLandingPage();res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(page);}if(u.pathname==='/map'){const group=u.searchParams.get('group'),mpp=Number(u.searchParams.get('mpp')||2),page=mapPage(group,mpp);",'all areas landing route');
v=replaceOnce(v,"if(req.method==='GET'&&u.pathname==='/map.svg'&&['arsos','pafos'].includes(u.searchParams.get('group')||'arsos')&&Number(u.searchParams.get('mpp')||2)===2)","if(req.method==='GET'&&u.pathname==='/map.svg'&&mapGroups[u.searchParams.get('group')||'']?.isAreaGroup&&Number(u.searchParams.get('mpp')||2)===2)",'generic map svg cache route');
writeFileSync('./viewer.js',v,'utf8');

// 3) Generic DLS matching by exact cadastral locator within district.
// Do NOT assume that every property in a human area group shares one VIL_CODE.
const districtCodeExpr="const DISTRICT_CODE={'Λεμεσός':5,'ΛΕΜΕΣΟΣ':5,'LEMESOS':5,'Πάφος':6,'ΠΑΦΟΣ':6,'PAFOS':6};const districtCode=p=>DISTRICT_CODE[p?.district]||null;";
c=replaceOnce(c,"const AREA={arsos:{dist:5,vil:322},pafos:{dist:6,vil:218}};",districtCodeExpr,'district code mapping');

const oldFetch=`async function fetchPropertyBatch(group,props){
  const ac=AREA[group];if(!ac)throw new Error(\`Unsupported area \${group}\`);
  const nums=[...new Set(props.filter(hasLocator).map(p=>Number(p.parcel)).filter(Number.isFinite))];
  if(!nums.length)return[];
  const parcelWhere=nums.map(n=>\`PARCEL_NBR=\${n}\`).join(' OR ');
  const where=\`DIST_CODE=\${ac.dist} AND VIL_CODE=\${ac.vil} AND (\${parcelWhere})\`;
  const j=await query(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false,resultRecordCount:1000},2,8000);
  return j.features||[];
}`;
const newFetch=`async function fetchPropertyBatch(group,props){
  const loc=props.filter(hasLocator),clauses=[];
  for(const p of loc){const dist=districtCode(p);if(!dist)continue;const q=x=>String(x).replaceAll("'","''");clauses.push("(DIST_CODE="+dist+" AND SHEET='"+q(p.sheet)+"' AND PLAN_NBR='"+q(p.plan)+"' AND BLCK_CODE="+Number(p.block)+" AND PARCEL_NBR="+Number(p.parcel)+")");}
  if(!clauses.length)return[];
  const where=clauses.join(' OR ');
  const j=await query(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false,resultRecordCount:1000},2,10000);
  return j.features||[];
}`;
c=replaceOnce(c,oldFetch,newFetch,'exact per-property district locator batch');

const oldCad=`async function cadastralParcels(group,ext){
  const ac=AREA[group];if(!ac)return[];const all=[];
  for(let offset=0,page=0;page<5;page++,offset+=1000){
    const j=await query(PARCELS,{f:'json',where:\`DIST_CODE=\${ac.dist} AND VIL_CODE=\${ac.vil}\`,geometry:\`\${ext.xmin},\${ext.ymin},\${ext.xmax},\${ext.ymax}\`,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,PARCEL_NBR,BLCK_CODE,SHEET,PLAN_NBR',returnGeometry:true,returnZ:false,resultOffset:offset,resultRecordCount:1000,orderByFields:'OBJECTID'},2,10000);
    const fs=j.features||[];all.push(...fs);if(!j.exceededTransferLimit||fs.length<1000)break;
  }
  return all;
}`;
const newCad=`async function cadastralParcels(group,ext){
  const groupProps=(mapGroups[group]?.keys||[]).map(k=>properties[k]).filter(Boolean),districts=[...new Set(groupProps.map(districtCode).filter(Boolean))];if(!districts.length)return[];const where=districts.length===1?'DIST_CODE='+districts[0]:'('+districts.map(d=>'DIST_CODE='+d).join(' OR ')+')',all=[];
  for(let offset=0,page=0;page<8;page++,offset+=1000){
    const j=await query(PARCELS,{f:'json',where,geometry:\`\${ext.xmin},\${ext.ymin},\${ext.xmax},\${ext.ymax}\`,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,PARCEL_NBR,BLCK_CODE,SHEET,PLAN_NBR',returnGeometry:true,returnZ:false,resultOffset:offset,resultRecordCount:1000,orderByFields:'OBJECTID'},2,12000);
    const fs=j.features||[];all.push(...fs);if(!j.exceededTransferLimit||fs.length<1000)break;
  }
  return all;
}`;
c=replaceOnce(c,oldCad,newCad,'district viewport cadastral overlay');

// Keep only the viewer-level loader created by bootstrap.js. Remove the core SVG loader
// before first paint, which eliminates the visible duplicate.
c=c.replace('${loader}${script}','${script}');
writeFileSync('./server.js',c,'utf8');

// 4) Run the already-tested viewer bootstrap (zoom/pan/high-res/highlights/UI fixes).
await import('./bootstrap.js?multi='+Date.now());
