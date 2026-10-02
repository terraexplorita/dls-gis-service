import {readFileSync,writeFileSync} from 'node:fs';

let b=readFileSync('./bootstrap.js','utf8');
const marker="writeFileSync(runtimePath,s,'utf8');\nawait import('./viewer.runtime.js');";
if(!b.includes(marker)) throw new Error('bootstrap2: final bootstrap marker not found');

const injected=String.raw`
// ---- bootstrap2 post-processing: generic multi-area viewer + dynamic DLS area resolution ----
const areaBootstrap = \`\n// Dynamic canonical map groups derived from real property areaKey values.\nfor(const [k,p] of Object.entries(properties)){\n  if(!p?.areaKey||!p?.sheet||!p?.plan||p?.parcel==null)continue;\n  const key=p.areaKey;\n  if(!mapGroups[key]||!mapGroups[key].isAreaGroup)mapGroups[key]={title:'',keys:[],isAreaGroup:true,district:p.district||'—',community:p.community||p.municipality||key,areaKey:key};\n  const g=mapGroups[key];g.isAreaGroup=true;g.district=g.district||p.district||'—';g.community=g.community||p.community||p.municipality||key;g.areaKey=key;\n  if(!g.keys.includes(k))g.keys.push(k);\n}\nfor(const [key,g] of Object.entries(mapGroups)){if(g?.isAreaGroup)g.title=(g.community||key)+' — Ιδιόκτητα & προς αγορά';}\n\`;
s=s.replace("import {properties,mapGroups} from './data.js';","import {properties,mapGroups} from './data.js';"+areaBootstrap);
s=s.replace("function relevantGroup(p){return p?.areaKey==='arsos'?'arsos':p?.areaKey==='pafos'?'pafos':null;}","function relevantGroup(p){return p?.areaKey&&mapGroups[p.areaKey]?.isAreaGroup?p.areaKey:null;}");

const navHelper=\`\nfunction areaNavOptions(current=''){\n  const groups=Object.entries(mapGroups).filter(([,g])=>g?.isAreaGroup&&g.keys?.length);\n  const districts=[...new Set(groups.map(([,g])=>g.district||'—'))].sort((a,b)=>String(a).localeCompare(String(b),'el'));\n  return '<option value="">ΕΠΙΛΟΓΗ ΠΕΡΙΟΧΗΣ</option>'+districts.map(d=>'<optgroup label="'+esc(d)+'">'+groups.filter(([,g])=>(g.district||'—')===d).sort((a,b)=>String(a[1].community).localeCompare(String(b[1].community),'el')).map(([k,g])=>'<option value="'+esc(k)+'"'+(k===current?' selected':'')+'>'+esc(g.community||k)+'</option>').join('')+'</optgroup>').join('');\n}\n\`;
s=s.replace("function mapPage(group,mpp){",navHelper+"\nfunction mapPage(group,mpp){");
s=s.replace(".topbar a{color:#fff;text-decoration:none}",".topbar a{color:#fff;text-decoration:none}.areaNavWrap{margin-left:4px;font-size:12px;font-weight:800;display:flex;align-items:center;gap:6px}.areaNavWrap select{max-width:240px;padding:7px 9px;border-radius:6px;border:1px solid #888;background:#fff;color:#111;font-weight:700}");
s=s.replace('<strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a data-maplink="arsos" href="/map?group=arsos&mpp=2">Άρσος</a><a data-maplink="pafos" href="/map?group=pafos&mpp=2">Άγιος Νικόλαος</a><a href="/properties">Όλα τα ακίνητα</a>','<strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><label class="areaNavWrap">ΠΕΡΙΟΧΗ <select id="areaNav">${areaNavOptions(group)}</select></label><a href="/properties">Όλα τα ακίνητα</a>');
s=s.replace("document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open');applyOwnedFilters();","const areaNav=document.getElementById('areaNav');if(areaNav)areaNav.addEventListener('change',()=>{if(areaNav.value&&areaNav.value!==GROUP){save();location.href='/map?group='+encodeURIComponent(areaNav.value)+'&mpp=2';}});document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open');applyOwnedFilters();");
s=s.replace("group==='arsos'?'Χάρτης Άρσους':'Χάρτης Αγίου Νικολάου'","'Χάρτης '+(mapGroups[group]?.community||municipalityText(p)||group)");

// Keep exactly one loading indicator: the SVG/core loader. Remove the viewer-level duplicate.
s=s.replace('<div class="viewerLoading" id="viewerLoading">ΦΟΡΤΩΣΗ ΧΑΡΤΗ…</div>','');
s=s.replace("const innerLoader=doc.getElementById('map-loading');if(innerLoader)innerLoader.remove();const clarityStyle=doc.createElementNS('http://www.w3.org/2000/svg','style');clarityStyle.textContent='.parcel-number{display:none!important}';","const clarityStyle=doc.createElementNS('http://www.w3.org/2000/svg','style');clarityStyle.textContent='.parcel-number{display:none!important}';");

// Generate a runtime core with dynamic area discovery, then make viewer spawn it.
let ss=readFileSync('./server.js','utf8');
ss=ss.replace("import {properties,mapGroups} from './data.js';","import {properties,mapGroups} from './data.js';"+areaBootstrap);
ss=ss.replace("const AREA={arsos:{dist:5,vil:322},pafos:{dist:6,vil:218}};","const AREA_CACHE=new Map([['arsos',{dist:5,vil:322}],['pafos',{dist:6,vil:218}]]);");
const resolver=\`\nasync function resolveArea(group,props=[]){\n  if(AREA_CACHE.has(group))return AREA_CACHE.get(group);\n  const p=(props||[]).find(hasLocator);\n  if(!p)throw new Error('No cadastral locator available to resolve area '+group);\n  const q=v=>String(v).replaceAll("'","''");\n  const where=\\\`SHEET='\\\${q(p.sheet)}' AND PLAN_NBR='\\\${q(p.plan)}' AND BLCK_CODE=\\\${Number(p.block)} AND PARCEL_NBR=\\\${Number(p.parcel)}\\\`;\n  const j=await query(PARCELS,{f:'json',where,outFields:'DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR',returnGeometry:false,resultRecordCount:50},2,8000);\n  const exact=(j.features||[]).filter(f=>exactFeature([f],p));\n  const uniq=new Map();for(const f of exact){const a=f.attributes||{},dist=Number(a.DIST_CODE),vil=Number(a.VIL_CODE);if(Number.isFinite(dist)&&Number.isFinite(vil))uniq.set(dist+'|'+vil,{dist,vil});}\n  if(uniq.size!==1)throw new Error('Could not uniquely resolve DLS area for '+group+' from '+(p.code||p.title||p.parcel));\n  const ac=[...uniq.values()][0];AREA_CACHE.set(group,ac);console.log('DLS area resolved',group,ac);return ac;\n}\n\`;
ss=ss.replace("function safeFeature(fs,p){const exact=exactFeature(fs,p);if(exact)return exact;const loose=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel);});if(loose.length===1){console.warn(`PARCEL_LOOSE_MATCH ${p.code||p.title||p.parcel}`);return loose[0];}return null;}","function safeFeature(fs,p){const exact=exactFeature(fs,p);if(exact)return exact;const loose=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel);});if(loose.length===1){console.warn(`PARCEL_LOOSE_MATCH ${p.code||p.title||p.parcel}`);return loose[0];}return null;}"+resolver);
ss=ss.replace("const ac=AREA[group];if(!ac)throw new Error(`Unsupported area ${group}`);","const ac=await resolveArea(group,props);");
ss=ss.replace("const ac=AREA[group];if(!ac)return[];const all=[];","const ac=await resolveArea(group,(mapGroups[group]?.keys||[]).map(k=>properties[k]).filter(Boolean));const all=[];");
writeFileSync('./server.runtime.js',ss,'utf8');
s=s.replace("spawn(process.execPath,['server.js']","spawn(process.execPath,['server.runtime.js']");
s=s.replaceAll('v=3.13','v=3.14').replaceAll('viewer v3.13','viewer v3.14');

writeFileSync(runtimePath,s,'utf8');
await import('./viewer.runtime.js');`;

b=b.replace(marker,injected);
writeFileSync('./bootstrap.stage.js',b,'utf8');
await import('./bootstrap.stage.js?'+Date.now());
